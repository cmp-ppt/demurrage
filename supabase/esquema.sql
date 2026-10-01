-- ============================================================
-- demurrage-ppt · tabla de embarques
-- Ejecutar en Supabase: SQL Editor → New query → Run.
-- ============================================================

create table if not exists public.demurrage_embarques (
  codigo          text primary key,          -- CNN-EMB-XXX: identifica la recalada
  nave            text,
  fecha           timestamptz,               -- 1ª espía (o inicio de carguío / NOR)
  campos          jsonb not null,            -- el formulario completo
  deducciones     jsonb not null default '[]'::jsonb,
  actualizado_en  timestamptz not null default now()
);

create index if not exists demurrage_embarques_fecha_idx
  on public.demurrage_embarques (fecha desc nulls last);

-- `actualizado_en` la escribe el cliente y NO la pisa el servidor.
-- La pregunta que decide un conflicto es "cuándo se editó este embarque", y eso
-- solo lo sabe quien lo editó: si el servidor pusiera now() en cada escritura,
-- una copia vieja subida después parecería la más nueva y ganaría.
-- Solo se rellena cuando llega nula.
create or replace function public.demurrage_fecha_por_defecto()
returns trigger language plpgsql as $$
begin
  if new.actualizado_en is null then
    new.actualizado_en = now();
  end if;

  -- Y no se retrocede: si llega una versión más vieja que la guardada, se
  -- ignora. Dos personas guardando a la vez producen peticiones que pueden
  -- llegar desordenadas, y sin esta guarda una copia vieja que aterriza
  -- última revive y borra la corrección de la otra.
  if TG_OP = 'UPDATE' and new.actualizado_en < old.actualizado_en then
    return old;
  end if;

  return new;
end $$;

drop trigger if exists demurrage_embarques_tocar on public.demurrage_embarques;
create trigger demurrage_embarques_tocar
  before insert or update on public.demurrage_embarques
  for each row execute function public.demurrage_fecha_por_defecto();

-- ============================================================
-- LIBRO DE REPORTERÍA DE LA TEMPORADA
--
-- Una sola fila. El libro es uno: el de la temporada en curso, con las
-- recaladas liquidadas, los tiempos, las detenciones, el clima y el plan
-- de embarque. Quien lo carga lo comparte con el equipo, y el siguiente
-- que lo cargue lo reemplaza entero.
--
-- No se fusiona por partes a propósito. El libro llega como un Excel
-- completo que el área comercial regenera cada vez; mezclar la mitad de
-- uno con la mitad de otro daría una temporada que no existe en ninguna
-- planilla y que nadie podría auditar.
-- ============================================================

create table if not exists public.demurrage_temporada (
  id              text primary key default 'actual',
  datos           jsonb not null,            -- recaladas, tiempos, detenciones, clima, plan
  origen          text,                      -- nombre del archivo que se cargó
  cargado_por     text,                      -- correo de quien lo subió
  actualizado_en  timestamptz not null default now(),
  constraint demurrage_temporada_una_fila check (id = 'actual')
);

-- Misma regla que los embarques: la marca la escribe el cliente y no se
-- retrocede. Dos personas cargando el libro el mismo día producen
-- peticiones que pueden llegar desordenadas, y sin esta guarda una versión
-- vieja que aterriza última reemplaza a la nueva.
create or replace function public.demurrage_temporada_fecha()
returns trigger language plpgsql as $$
begin
  if new.actualizado_en is null then
    new.actualizado_en = now();
  end if;
  if TG_OP = 'UPDATE' and new.actualizado_en < old.actualizado_en then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists demurrage_temporada_tocar on public.demurrage_temporada;
create trigger demurrage_temporada_tocar
  before insert or update on public.demurrage_temporada
  for each row execute function public.demurrage_temporada_fecha();

alter table public.demurrage_temporada enable row level security;

drop policy if exists demurrage_temporada_auth on public.demurrage_temporada;
create policy demurrage_temporada_auth
  on public.demurrage_temporada
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- BITÁCORA DEL PUERTO
--
-- Qué días estuvo el puerto cerrado o con restricción, y por qué. El
-- pronóstico dice lo que va a pasar; esto registra lo que pasó, y no solo
-- por clima: un paro del personal portuario ajeno a la empresa cierra el
-- terminal igual que una marejada, y de eso ningún modelo se entera.
--
-- Una fila por evento, no un blob con la lista entera como en la
-- temporada. El libro de reportería llega como un Excel que se regenera
-- completo; la bitácora se escribe a mano y de a poco desde tres
-- computadores. Con la lista en una sola fila, quien guardara último
-- borraría los eventos que los otros dos acababan de registrar, y nadie se
-- enteraría hasta que al liquidar faltara el día del paro.
-- ============================================================

create table if not exists public.demurrage_bitacora (
  id              text primary key,
  desde           date not null,
  hasta           date not null,
  estado          text not null,             -- abierto | restringido | cerrado
  causa           text not null default '',
  nota            text not null default '',
  registrado_por  text not null default '',  -- correo de quien lo anotó
  actualizado_en  timestamptz not null default now(),
  constraint demurrage_bitacora_rango  check (hasta >= desde),
  constraint demurrage_bitacora_estado check (estado in ('abierto','restringido','cerrado'))
);

-- Buscar por mes es lo único que hace la aplicación con esta tabla.
create index if not exists demurrage_bitacora_desde on public.demurrage_bitacora (desde desc);

-- Misma guarda que las otras dos: la marca la escribe el cliente y no
-- retrocede, para que una corrección vieja que llega tarde no pise a la
-- nueva.
create or replace function public.demurrage_bitacora_fecha()
returns trigger language plpgsql as $$
begin
  if new.actualizado_en is null then
    new.actualizado_en = now();
  end if;
  if TG_OP = 'UPDATE' and new.actualizado_en < old.actualizado_en then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists demurrage_bitacora_tocar on public.demurrage_bitacora;
create trigger demurrage_bitacora_tocar
  before insert or update on public.demurrage_bitacora
  for each row execute function public.demurrage_bitacora_fecha();

alter table public.demurrage_bitacora enable row level security;

drop policy if exists demurrage_bitacora_auth on public.demurrage_bitacora;
create policy demurrage_bitacora_auth
  on public.demurrage_bitacora
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- PLANILLAS DE TURNO · ACUMULADO EMBARQUE
--
-- El tonelaje embarcado dentro de cada mes, que es la fuente del draft
-- survey definitivo: ni el CNN-EMB ni el libro de reportería lo traen. El
-- CNN-EMB trae el pesómetro y un calado provisorio; el libro trae el Bill
-- of Lading; el draft survey final queda en la planilla que el turno llena
-- día a día, y es el que se liquida.
--
-- Una fila por MES, no un blob con el almacén entero. Son tres personas
-- cargando planillas de meses distintos, y con todo en una fila quien
-- guardara último borraría el mes que otro acabó de cargar; nadie lo
-- notaría hasta que la ficha de ese mes apareciera vacía.
--
-- Dentro de un mes sí se reemplaza entero. La planilla del último día ya
-- trae el acumulado del mes, así que fusionar nave por nave sumaría dos
-- veces lo mismo.
-- ============================================================

create table if not exists public.demurrage_turnos (
  mes             text primary key,          -- "2026-09"
  total_mineral   numeric not null,          -- pellet feed + sinter feed
  total_otros     numeric not null default 0,-- concentrado de cobre y MLC, que van aparte
  por_nave        jsonb   not null default '[]'::jsonb,
  archivo         text    not null default '',
  cargado_por     text    not null default '',
  actualizado_en  timestamptz not null default now(),
  constraint demurrage_turnos_mes check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- Misma guarda que las otras tablas: la marca la escribe el cliente —es el
-- único que sabe cuándo se cargó esa planilla— y no retrocede, para que una
-- versión vieja que aterriza última no pise a la nueva.
create or replace function public.demurrage_turnos_fecha()
returns trigger language plpgsql as $$
begin
  if new.actualizado_en is null then
    new.actualizado_en = now();
  end if;
  if TG_OP = 'UPDATE' and new.actualizado_en < old.actualizado_en then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists demurrage_turnos_tocar on public.demurrage_turnos;
create trigger demurrage_turnos_tocar
  before insert or update on public.demurrage_turnos
  for each row execute function public.demurrage_turnos_fecha();

alter table public.demurrage_turnos enable row level security;

drop policy if exists demurrage_turnos_auth on public.demurrage_turnos;
create policy demurrage_turnos_auth
  on public.demurrage_turnos
  for all
  to authenticated
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────
-- SEGURIDAD
--
-- La clave publicable viaja en el navegador: es pública por diseño. Lo único
-- que separa estos datos de cualquiera que abra el sitio son estas políticas.
--
-- En Settings → API Keys hay dos. Va la de arriba —«Publishable key»,
-- sb_publishable_… , o la «anon» de los proyectos antiguos—, nunca la
-- «Secret key» (sb_secret_… / service_role): esa salta RLS y en un sitio
-- público le daría acceso de administrador a todas las tablas del proyecto.
-- La aplicación se niega a guardarla, pero conviene saberlo antes de copiar.
--
-- La activa exige usuario autenticado. Con el sitio publicado en Netlify,
-- una política `to anon` significa que quien dé con la URL puede leer y
-- escribir montos de demurrage y tarifas de contrato; la obscuridad del
-- enlace no es una medida de seguridad.
--
-- Las cuentas se crean a mano en el panel de Supabase
-- (Authentication → Users → Add user), no desde la aplicación: una
-- pantalla de registro abierta en un sitio público es el mismo agujero
-- con otra forma. Conviene además apagar el auto-registro en
-- Authentication → Providers → Email → "Enable sign ups".
-- ─────────────────────────────────────────────────────────────

alter table public.demurrage_embarques enable row level security;

-- Solo usuarios autenticados. Los tres del equipo ven y editan lo mismo:
-- no hay dueño por fila porque un embarque no es de quien lo cargó, es del
-- terminal, y la segunda persona que abre la recalada tiene que poder
-- corregirla.
drop policy if exists demurrage_anon_todo   on public.demurrage_embarques;
drop policy if exists demurrage_auth_todo   on public.demurrage_embarques;
create policy demurrage_auth_todo
  on public.demurrage_embarques
  for all
  to authenticated
  using (true)
  with check (true);

-- Para comprobar que la puerta está cerrada, desde el SQL Editor:
--   set role anon;
--   select count(*) from public.demurrage_embarques;   -- debe dar 0 filas
--   select count(*) from public.demurrage_temporada;   -- debe dar 0 filas
--   select count(*) from public.demurrage_bitacora;    -- debe dar 0 filas
--   select count(*) from public.demurrage_turnos;      -- debe dar 0 filas
--   reset role;
-- Si devuelve filas, quedó una política `to anon` viva: búscala con
--   select policyname, roles from pg_policies
--    where tablename = 'demurrage_embarques';
