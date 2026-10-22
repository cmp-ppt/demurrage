# demurrage-ppt

Calculadora de **laytime, demurrage/despatch y muellaje** para embarques en
**Puerto Punta Totoralillo (PPT)**.

Dashboard operacional que lee directamente el libro *Registro de Tiempos de Embarque*
(`CNN-EMB-XXX.xlsx`) y entrega el estado completo de la recalada: laytime permitido,
tiempo usado, balance, el monto en dólares que corresponde cobrar o pagar, la
composición del tiempo, el ranking de causas de detención y los índices del embarque.

Sigue el design system CMP (ISA-101 High Performance HMI + identidad de marca) usado
en el resto de las aplicaciones operacionales de Punta Totoralillo.

## Qué hace

| Bloque | Detalle |
|---|---|
| **Una sola vista** | **Operación** y **Clima**, nada más. Operación junta la temporada y la recalada abierta en un scroll, señalizadas con un rótulo de banda cada una y con la misma estructura: una tira de siete fichas y debajo la lectura en prosa. Lo que se consulta —los dos libros, el charter party, las 21 categorías, el detalle de la temporada— se pliega; lo que se lee queda arriba. |
| **Historial** | Cada embarque que cargas se guarda solo y queda en un desplegable de la barra superior, agrupado por mes y con el más reciente arriba. Se elige por fecha y se abre. El código de embarque lo identifica: reimportar actualiza, no duplica. |
| **Modo presentación** | Botón *Presentar*: pantalla completa con una idea por lámina, tipografía dimensionada para proyectar a tres o cuatro metros, navegación con flechas y exportación a PDF de una página por lámina. |
| **Veredicto** | Semáforo de la recalada con criterio explícito, y una lectura en prosa generada de los datos: lo que alguien repite después de la reunión. |
| **Time sheet en dinero** | La misma cascada, valorizada al rate del contrato: se ve cuánto descontó cada excepción. |
| **NOR en PDF** | Arrastras el Notice of Readiness de la agencia y se completan arribo, NOR presentado, free pratique y NOR aceptado. Muestra qué leyó para que lo compares con el papel antes de calcular, y avisa si las fechas no son coherentes o si el nombre de la nave no calza con el del registro de tiempos. |
| **Importación** | Arrastras el `.xlsx` del RTE y se completan nave, código, tonelaje, eslora, espías, horas de mantenimiento y las horas de cada categoría de detención. El archivo se lee en el navegador; no se sube a ningún servidor. |
| **Laytime** | Inicio por NOR + turn time (12 h por defecto), por 1ª espía, o «lo primero que ocurra» entre la expiración del turn time y el inicio de operaciones, que es la redacción del charter party de CMP. Allowed por tasa de embarque (t/día) o por horas fijas. Régimen SHINC, SHEX o SATSHEX, con festivos. |
| **Deducciones** | Las 21 categorías del RTE, cada una con su casilla de "descuenta del laytime". Se pueden agregar conceptos propios. |
| **Resultado** | Cifra protagonista con el **demurrage** (pro rata sobre el rate diario) o el **despatch**, más KPIs de allowed, usado, balance y muellaje. El despatch se pacta como **% del demurrage rate** o con **tarifa propia en US$/día**, según lo diga el contrato. Cada campo recalcula al editarlo. |
| **Gráficos** | Donut de composición del tiempo, **anillo de utilización del laytime** —el número que decide la recalada, en verde bajo 100 % y en rojo con el exceso pintado encima—, barras de causas ordenadas, cascada del time sheet con la línea del *allowed*, y medidores DF/U/FO. Todo en SVG dibujado a mano, sin librerías. |
| **Muellaje** | `Muellaje US$ = tarifa (US$/m eslora/hora) × eslora × NWH`, con `NWH = (última espía − 1ª espía) − mtto. terminal − nave a la gira`. Misma fórmula de la hoja MUELLAJE. |
| **Productividad** | Tonelaje partido en tres cifras que no son la misma: **embarcado** (pesómetro CT-09), **calado** (draft survey) y el que alimenta el cálculo, con la diferencia entre correa y draft escrita. Más tasa de operación efectiva, promedio horaria y diaria, **leídas del RTE, no recalculadas**; si el libro no trae el bloque, la app las calcula y lo dice. La tasa diaria se compara contra la pactada en el charter party. |
| **Tendencias** | Curvas de la temporada: rate de carga por recalada contra el objetivo del contrato, y % de detenciones controlables. Dos gráficos separados, nunca uno con dos ejes. |
| **Libro compartido** | El libro de reportería también viaja: quien lo carga lo sube y los demás lo reciben al entrar, sin repetir el Excel. Es una sola fila que se reemplaza entera —el libro llega completo desde el área comercial y mezclar dos mitades daría una temporada que no existe en ninguna planilla— y gana el último que lo cargó. |
| **Conexión oculta** | El bloque de conexión con la nube no se muestra cuando todo funciona: el proyecto viene en `js/config.js` y cada persona solo entra con su cuenta. Aparece cuando falta configurar o la sincronización falla, y se fuerza con `?nube` en la dirección. |
| **Sesión** | Con un proyecto de Supabase configurado, la app pide correo y contraseña antes de mostrar nada, y lo que viaja al servidor es el token del usuario, no la anon key. Las políticas RLS exigen `authenticated`: sin login no hay lectura ni escritura, aunque el sitio esté publicado. Las cuentas las crea el administrador en el panel de Supabase — aquí no hay registro. Sin proyecto configurado no se pide nada: la app calcula contra el navegador y exigir login para una cuenta local sería pedir permiso para usar una calculadora. |
| **NOR en bloque** | El CNN-EMB no trae el NOR y el libro de reportería sí. Con los dos cargados, un botón trae el NOR de cada recalada guardada y le pone el inicio del laytime en «lo primero que ocurra», que es lo que hace que el NOR sirva de algo. Pide confirmación con las cifras a la vista y nombra las que no pudo emparejar. |
| **Conciliación** | Cuando la recalada abierta también está en el libro de reportería, la vista compara las dos cifras y descompone la diferencia en causas con monto: el rate del contrato, el NOR que el CNN-EMB no trae, el tonelaje del draft survey contra el del Bill of Lading. Un botón adopta los datos del contrato. En la CNN-EMB-434 la brecha baja de US$ 619.551 a US$ 14.867, y lo que queda son las deducciones, que son dos listas distintas. El emparejado usa nombre **y fecha**: tres naves de la temporada 2026 tienen dos recaladas, y cuando las fechas no deciden el panel dice que no concilia en vez de elegir una. |
| **Temporada** | Una banda dentro de Operación, con **filtros de trimestre y mes en su propio rótulo**: resumen ejecutivo en siete fichas y, plegado, el detalle —demurrage por trimestre, dónde se va el tiempo, detenciones, clima, atribución de la espera, exposición del plan, estadía y demurrage nave por nave, la tabla completa y el plan. Se alimenta del libro *Reportería Demurrages … PUNTA TOTORALILLO.xlsx*, que trae lo ya liquidado con el armador; no recalcula nada. |
| **Clima** | Panel de condiciones en el terminal con datos en línea (Open-Meteo, sin clave ni cuenta): viento, ráfagas, marejada y visibilidad hora a hora a 3 días, con el estado del puerto en tres niveles —**abierto**, **con restricción** (viento 20 kn, marejada 2,0 m o visibilidad 2 km) y **cerrado** (25 kn, ráfaga 30, ola 2,5 m o 1 km)— y las ventanas adversas ya agrupadas. Los umbrales son editables y parten en **20 nudos** de viento. |
| **Índices** | DF, U y FO encadenados como en RESUMEN_TIEMPOS: `disponibles = total − mtto. terminal`, `operativas = disponibles − tiempos de nave`, y luego `DF = disponibles/total`, `U = operativas/disponibles`, `FO = op. efectiva/operativas`. |

Sin nube, todo queda en el navegador (`localStorage`). Con un proyecto de Supabase
conectado, el historial se comparte: quien abra el sitio ve y edita los mismos embarques.
Se configura en «Datos y contrato → Sincronización» o dejando los valores en
`js/config.js`; el SQL de la tabla está en `supabase/esquema.sql`.

**Sobre la seguridad**: la *anon key* de Supabase viaja en el navegador, es pública por
diseño. Lo único que separa estos datos de cualquiera que abra el sitio son las políticas
RLS. El esquema trae dos opciones y deja activa la de acceso anónimo, que sirve para
partir; acá hay montos de demurrage y tarifas de contrato, así que si el sitio queda
público en Netlify corresponde la opción B, que exige usuario autenticado.

**Conflictos**: gana el registro con `actualizado_en` más reciente, y esa marca la pone
quien edita, no el servidor. Un disparador en la base ignora las escrituras más viejas que
lo guardado, para que una copia rezagada que llega tarde no reviva y borre la corrección
de otra persona.

### Clima y alertas

El panel de clima consulta **Open-Meteo** (API abierta, sin clave ni registro) para el
sitio de atraque (**26°50′52″S 70°48′53″W**, donde está la nave y donde se mide: el
viento que detiene el embarque es el del costado del buque, no el de tierra adentro)
y devuelve dos series horarias: el pronóstico
atmosférico (viento, ráfagas, dirección, visibilidad, precipitación) y el marino
(altura, período y dirección de la marejada), a tres días.

Con esas series arma tres cosas:

> **No es una estación meteorológica.** Open-Meteo entrega la salida de modelos globales
> (ECMWF y GFS, los mismos que usa Windy) interpolada a esas coordenadas, en celdas de 9 a
> 25 km. Sirve para anticipar, no para probar: un descuento de laytime por clima se
> respalda con el registro del terminal o un certificado oficial, no con esto.
>
> La marejada se pide unas millas al oeste (−70,88): el muelle está en tierra y el modelo
> marino solo tiene celdas de mar. Si aun así viene vacía, el panel lo dice — un dato
> ausente y un mar calmo no son lo mismo.

- **Estado operacional del muelle** — OPERABLE / DETENIDO / SEVERO, con el motivo
  escrito. No es un pronóstico bonito: es la lectura de si el shiploader opera.
- **Ventanas adversas** — las horas seguidas sobre umbral se agrupan en un solo aviso
  («hoy 14:00 → hoy 21:00 · 7 h · viento hasta 25 kn»), en vez de repetir hora por hora.
- **Ventana operativa** — cuántas horas quedan antes del próximo evento adverso.

Los umbrales por defecto salen de la operación de PPT y se editan en pantalla:

| Variable | Aviso | Alerta |
|---|---|---|
| Viento sostenido | **20 kn** | 25 kn |
| Ráfagas | — | 30 kn |
| Marejada (altura significativa) | 2,0 m | 2,5 m |
| Visibilidad | 2.000 m | 1.000 m |

### El aviso por correo

Aparte del panel, un trabajo de GitHub Actions revisa el pronóstico cada hora y manda
correo cuando **sale de rango**, con una regla distinta y a propósito más baja:

| | regla del correo |
|---|---|
| Viento **sostenido** | **18 kn o más** |
| Durante | al menos **1 hora seguida** |
| Ráfagas | **no disparan el aviso** |
| Marejada / visibilidad | 2,0 m / 2.000 m, con la misma exigencia de horas |

Los 18 kn son menos que los 20 del tablero porque son otra cosa: 20 es el **límite de
operación** —a esa velocidad el embarque se detiene y queda escrito en el RTE— y el
correo avisa **antes**, cuando todavía se puede apurar el cierre de bodega o llamar a
la agencia. No son dos definiciones del mismo umbral que se contradicen: son el límite
y su antesala.

La ráfaga queda fuera por pedido de la operación: es un pico de segundos, y un aviso
que salta con cada pico se vuelve ruido que nadie mira —y entonces el que importa
tampoco se mira—. Se informa en el cuerpo del correo cuando ya hay aviso por viento
sostenido, para saber a qué atenerse, pero nunca es la causa.

Se manda **al cruzar**, no mientras dure: uno al salir de rango y otro al volver. El
umbral vive en `js/alerta.js`; `horasSeguidas: 2` exigiría dos horas seguidas y
descartaría la hora suelta.

El panel **no reemplaza a Windy**: hay un enlace directo al punto del terminal para
mirar el mapa. Lo que agrega es el umbral aplicado y la alerta escrita, que es lo que
después se pega en un correo o se cita en un time sheet.

> La API es pública y responde por HTTPS. Si la red de CMP bloquea la salida a
> `api.open-meteo.com`, el panel lo dice en pantalla en vez de mostrar datos viejos.

## Uso

Es un sitio estático, sin build ni dependencias que instalar.

```bash
# local
python3 -m http.server 8000     # y abrir http://localhost:8000
```

Publicado en GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.

> Ábrelo servido (`http.server` o GitHub Pages), no con doble clic sobre el archivo:
> abrir `index.html` como `file://` bloquea la carga de los scripts en algunos navegadores.

### Sin conexión

SheetJS va incluido en el repositorio (`js/vendor/xlsx.full.min.js`, Apache-2.0), así que la
lectura del `.xlsx` funciona sin internet y detrás del firewall corporativo. Lo único que se
pide fuera es la tipografía de Google Fonts; si está bloqueada, la página cae a las fuentes
del sistema y sigue operando igual.

## Pruebas

El motor de cálculo no depende del DOM, así que se prueba con Node sin dependencias:

```bash
node tests/laytime.test.js    # motor de laytime, muellaje e índices
node tests/flota.test.js      # alta, deduplicado y consolidado de temporada
node tests/leer-nor.test.js   # lectura del NOR en PDF
node tests/lectura.test.js    # semáforo, lectura y cascada en dinero
node tests/nube.test.js       # fusión de historial local y remoto
node tests/clima.test.js      # umbrales, ventanas adversas y ventana operativa
node tests/importar-rte.test.js  # lectura del libro CNN-EMB-XXX.xlsx
node tests/sesion.test.js        # vigencia del token, renovación y mensajes de error
node tests/puerta.test.js        # en navegador: sin sesión no se lee nada y viaja el token, no la anon key
node tests/conciliar.test.js     # emparejado de naves y descomposición de la diferencia
node tests/reporteria.test.js    # lectura del libro de reportería de la temporada
node tests/trimestres.test.js    # consolidado por trimestre y su diagnóstico
node tests/humo.test.js          # recorre la app en un navegador real
```

La prueba de humo es la única que necesita un navegador: abre la app con Playwright,
recorre las dos pestañas, carga un libro, cambia de sub-pestaña, recalcula y entra y sale
del modo presentación, exigiendo **cero errores de página**. Si Playwright no está
disponible se omite sin fallar.

Existe por un defecto que llegó publicado: al retirar la vista Flota se borró de paso
`var serieClima = []`, que vivía entre sus funciones. El archivo seguía siendo JavaScript
válido, las 414 pruebas seguían pasando —ninguna toca el DOM— y el fallo solo aparecía al
apretar «Consultar condiciones». Un error de referencia no se ve leyendo; se ve ejecutando.

Incluye regresiones contra datos reales del embarque **CNN-EMB-434 / MN CHINA TRIUMPH**:
NWH 113,5 h, muellaje US$ 57.865,705 y los índices DF 98,695 % / U 93,8254 % / FO 70,0233 %,
los mismos valores que entrega la planilla.

## Densidad

El dashboard se midió con una recalada cargada: de **1.862 px** de alto, 669 eran
cabeceras de panel y padding, 96 separación entre bloques y 136 leyendas. Casi la
mitad de la página sin un dato encima.

La pasada de densidad recorta **marco, no contenido** —cabeceras de 11 a 7 px de
padding, título un cuerpo más chico, sombras a un tercio, leyendas en una línea— y
ajusta las alturas de gráfico que dejaban hueco dentro de su propio panel (el donut
sobraba 40 px, el anillo 88). Quedó en 1.546 px con las mismas cifras y los mismos gráficos.

Después vino la parte estructural, que cambia dónde está cada cosa:

| | |
|---|---|
| **Muellaje** | De tabla de cinco filas a una franja con el total; el desglose se pliega. Se consulta como cifra y se desarma solo si alguien discute la factura. |
| **Índices** | Los tres medidores en fila. Apilados, dejaban 940 px de ancho para una barra de 9 px de alto. |
| **Datos de la recalada** | Recalada y charter party comparten un bloque con sub-pestañas. Las dos cargas —el libro de la nave y el NOR en PDF— son botones de la barra superior, y arrastrar funciona sobre la página entera: la extensión decide el destino. El rótulo sigue mostrando los avisos pendientes sin abrirlo. |
| **Productividad** | Una tira de seis en vez de dos de tres: las etiquetas ya dicen a qué familia pertenece cada cifra. |

Total: **1.862 → 1.287 px, un 31 % menos**. De dos pantallas de scroll a una y
media, sin perder un dato.

La regla al tocar esto: si un cambio quita un dato de la pantalla, no es densidad,
es recorte. El dato ocupa lo mismo; el envase, menos.

## Tres registros visuales

La capa operacional sigue ISA-101 (plana, para sala de control); sobre ella va la capa
de presentación del tablero (recuadros marcados, escena de puerto, iconografía); y
encima el **modo presentación**, dimensionado para proyectar: una idea por lámina,
tipografía en `clamp()` sobre el viewport y contraste alto. La misma vista sirve para
el proyector, para compartir pantalla y para el PDF, donde cada lámina es una página
con los tamaños fijados en puntos.

## La capa operacional y la de presentación

La capa operacional sigue ISA-101 (High Performance HMI): plana y callada, pensada
para sala de control. Estas vistas, en cambio, se presentan a gerencia — otro público
y otra distancia de lectura —, así que sobre esos mismos tokens va una **capa de
presentación**: recuadros marcados con acento de color, cabecera con escena de puerto,
iconografía de embarque y cifras de mayor tamaño.

Lo que no cambia entre un registro y otro son las reglas de los gráficos: marcas finas,
grilla recesiva, sin ejes dobles y la misma paleta de series validada.

La escena y los iconos son **SVG en línea, no imágenes**: la app tiene que verse igual
sin conexión y detrás del firewall, y una foto pesada compite con los datos.

## Decisiones de visualización

Tres cosas se apartan a propósito del reporte Power BI equivalente:

- **Sin eje doble en el Pareto.** La curva de % acumulado sobre las barras obliga a un
  segundo eje y, cuya alineación con el primero es arbitraria y sugiere correlaciones
  que no están en los datos. El acumulado va plegado bajo el mismo gráfico, como su vista de tabla.
- **El donut muestra tres categorías, no dos.** Un donut de dos porciones es una cifra
  disfrazada de gráfico: la composición completa (efectiva / no controlable /
  controlable) sí aporta, y el % controlable queda como nota del panel.
- **La paleta de series está validada, no elegida a ojo.** Los tres colores pasan las
  seis comprobaciones sobre la superficie oscura del panel: banda de luminosidad, piso
  de croma, separación bajo protanopia y deuteranopia, piso de visión normal y
  contraste. El orden verde → azul → naranja es el orden de apilado y no se altera:
  es lo que mantiene separados los pares que se tocan.

## Estructura

```
index.html                    dashboard, flota y clima en una sola página
css/cmp.css                   design system CMP (ISA-101 + marca)
js/app.js                     controlador: cálculo, render y persistencia
js/graficos.js                primitivas de gráfico en SVG (donut, barras, cascada, gantt, divergentes, líneas)
js/escena.js                  escena de puerto e iconos, en SVG en línea (sin imágenes externas)
js/flota.js                   temporada: alta, deduplicado por código y consolidado
js/laytime.js                 motor de cálculo (laytime, demurrage/despatch, muellaje, índices)
js/importar-rte.js            lectura del libro CNN-EMB-XXX.xlsx y clasificación de categorías
js/leer-nor.js                lectura del Notice of Readiness en PDF
js/lectura.js                 semáforo, lectura en prosa y cascada en dinero
js/presentacion.js            láminas para proyectar y para el PDF
js/nube.js                    sincronización con Supabase (leer, fusionar, subir)
js/clima.js                   clima del terminal: consulta, umbrales y ventanas adversas
js/sesion.js                  sesión contra Supabase Auth: login, renovación y cierre
js/conciliar.js               conciliación entre el time sheet propio y lo liquidado
img/cmp.png                   logo de CMP, del archivo de la presentación de la compañía
js/reporteria.js              lectura del libro de reportería de la temporada
js/trimestres.js              consolidado por trimestre y lectura de lo que dicen los números
js/vendor/xlsx.full.min.js    SheetJS 0.18.5 (Apache-2.0), incluido para operar sin internet
js/vendor/pdf.min.js          pdf.js 2.16.105 (Apache-2.0), ídem
tests/laytime.test.js         pruebas del motor
tests/flota.test.js           pruebas del consolidado de temporada
tests/leer-nor.test.js        pruebas del lector de NOR, con el texto real de un PDF escaneado
tests/lectura.test.js         pruebas del semáforo, la prosa y la cascada en dinero
tests/nube.test.js            pruebas de la fusión local/remoto y el orden de escritura
tests/clima.test.js           pruebas de umbrales, agrupación de ventanas y ventana operativa
tests/importar-rte.test.js    pruebas del lector del libro, con el bloque de tasas corrido de columna
tests/reporteria.test.js      pruebas del lector de reportería
tests/trimestres.test.js      pruebas del consolidado, con regresión contra la temporada 2026
supabase/esquema.sql          tabla, disparador y políticas RLS del historial compartido
docs/glosario.md              términos de charter party usados en la app
```

## Lo que muestra la temporada

El libro de reportería tiene el dato pero no la conclusión. Puestos juntos, los
números de 2026 dicen una sola cosa, y no es la que se esperaría:

| | Q1 | Q2 | Q3 | Temporada |
|---|---:|---:|---:|---:|
| Recaladas | 10 | 9 | 14 | **33** |
| Demurrage neto | US$ 1,09 M | US$ 962 k | **US$ 4,24 M** | **US$ 6,29 M** |
| Costo por tonelada | 0,61 | 0,65 | **1,65** | **1,08** |
| Espera antes del amarre | 106 d | 92 d | **220 d** | **418 d** |
| Operación de carga | 63 d | 38 d | 75 d | 176 d |
| Laytime permitido | 59 d | 49 d | 86 d | 194 d |

- **La carga no es el problema.** Usó 176 de los 194 días permitidos —el 91 %— y
  29 de 33 naves cargaron dentro del laytime.
- **La espera previa al amarre sí lo es**: 418 días, 2,4 veces el tiempo de carga.
- Las naves que pagaron demurrage esperaron **8,7 días** entre el NOR y el amarre;
  las que no, **1,2**. Es casi la única variable que las separa.
- Y las detenciones registradas **bajaron** en Q3 (20 días contra 62 en Q1)
  mientras el demurrage se cuadruplicaba: el terminal operó mejor y la cuenta
  subió igual.

### Lo cobrado y lo estimado, separados

De las 33 recaladas, **4 son proyección**: horas de amarre exactas a las 00:00
—un Statement of Facts anota minutos— y tonelaje del plan (198.000, 206.000) en
vez del pesómetro. Aportan **US$ 1,65 M**, y una sola de ellas, NISEKO QUEEN con
US$ 1,55 M, es el 37 % de Q3. Lo liquidado son **US$ 4,66 M**; el resto todavía
puede cambiar. La app lo separa en pantalla para que el total que se presenta no
mezcle una cosa con la otra.

### A qué se atribuye la espera

Los comentarios del libro se clasifican en cuatro causas, con una sola por
recalada para que los montos sumen:

| Causa | Demurrage | Naves |
|---|---:|---:|
| Muelle ocupado | US$ 1,11 M | 9 |
| Clima | US$ 575 k | 1 |
| Congestión Caserones | US$ 417 k | 3 |
| **Sin atribuir** | **US$ 4,32 M** | **11** |

El hallazgo incómodo es el último: **el 67 % del demurrage no tiene comentario**,
y son justamente las recaladas más caras. Esa fila se muestra con el mismo peso
que las demás porque esconderla daría una foto falsa de lo que está explicado.

### Exposición del plan

Para cada recalada planificada, cuánto habría en juego si el plan se cumple:

    inicio  = el más tardío entre ETA y apertura del laycan
    contado = (ETD − inicio) − descuento típico
    allowed = tonelaje / tasa de embarque
    exposición = máx(0, contado − allowed) × rate

Contrastado contra 2026: **mediana de error 11 %**, y el total sale **20 % por
encima** de lo real porque el modelo no sabe cuántos días de clima se
descontaron en cada caso. Es una exposición, no un pronóstico. Los tres
supuestos son editables en pantalla.

El amarre previsto fuera de la ventana de laycan se marca: son las naves que ya
se sabe que van a esperar, y todavía se pueden mover.

Eso cambia a quién le toca actuar. Si el costo viniera de la tasa de embarque,
sería del terminal; viniendo de la espera en rada, es de programación de naves y
de congestión de muelle, que se gestionan en otra parte y con otra gente.

## Sobre el libro de origen

Todo lo que la app lee de `RESUMEN_TIEMPOS` son **fórmulas** que apuntan a la hoja RTE.
Si el libro se guarda con una herramienta que no recalcula (LibreOffice, un script, una
exportación), esas celdas quedan sin valor y las horas de detención llegarían en cero
—con el laytime usado más alto de lo real—. La app detecta ese caso y lo avisa en vez
de calcular en silencio: ábrelo en Excel, guárdalo de nuevo y vuelve a cargarlo.

El lector busca cada rótulo **por su texto, en cualquier columna**, no por coordenada. La versión anterior exigía la etiqueta en B y el valor en C, y en la planilla real esos rótulos viven en celdas combinadas: Excel guarda el texto en la esquina superior izquierda del bloque, así que la lectura devolvía vacío y las tres tasas salían en blanco en el dashboard sin decir por qué. Ahora, si el bloque de veras no está, se avisa.

Un tonelaje de **cero no es un tonelaje**: es un dato ausente. El RTE rotula "CALADO" tanto el draft survey como una fila de detenciones que puede venir vacía, y ese cero, tomado como tonelaje, dejaba el laytime allowed en cero y el embarque entero sin resultado. La cadena calado → pesómetro CT-09 → suma por bodegas solo acepta cifras positivas, prefiere la fila que lleva la unidad `TM`, y dice de cuál de las tres salió el número.

La fila de salida de la hoja MUELLAJE cambió de rótulo tres veces en una sola temporada: **«Fecha/Hora última espía»** en la CNN-EMB-434, **«despacho AAMM.»** en la 406, 407, 409 y 410, y **«last line»** en la 408. Perseguir nombres es perder, así que se lee por estructura: la fila que sigue a la 1ª espía dentro del bloque. La hoja además trae su propio NWH y su muellaje; la app los lee y avisa si no coinciden con lo que calcula, porque un descuadre ahí es una fecha mal leída o una fórmula vieja, y se factura sobre eso.

El bloque de productividad vive en **`RTE!B195:D201` y `RTE!K199:U201`** (duplicado en
`RTEAM!C190:E196`). La app lo lee en vez de recalcularlo, porque la planilla divide por el
tiempo de **eventos registrados** y no por el reloj del embarque, y esos dos no coinciden:
en la CNN-EMB-434 el reloj marca 138,15 h y los eventos suman 131,55 h. Recalcular por
fuera daría 35.188 t/día donde la operación reporta 36.953. Cuando esa diferencia supera
media hora, la app la muestra: son horas del embarque que ningún evento del RTE explica.

El tonelaje que manda es el **calado** (`RTE!S201`), con el pesómetro CT-09 como respaldo
y la suma por bodegas como último recurso.

Los hitos del **NOR** no están en el registro de tiempos, porque los emite la agencia
marítima y no el puerto: se leen del PDF del Notice of Readiness, o se cargan a mano
en «Datos y contrato». El ETA nominado no viene en el NOR y siempre va a mano. No se rellenan solos, porque inventar
el NOR cambia el resultado en silencio: en la CNN-EMB-434, con los hitos reales del
documento de la agencia, el mismo embarque pasa de **US$ 18.288 de despatch** (laytime
desde el amarre) a **US$ 446.925 de demurrage** (desde el NOR presentado el 14 de agosto,
16,4 días antes del amarre). Cuál de los tres corre lo define el charter party.

## Supuestos del cálculo

Los valores por defecto son un punto de partida razonable, **no** una regla contractual:

- Se descuentan del laytime: eventos climáticos, fuerza mayor, incendio y todos los
  tiempos atribuibles a la nave (calado, deslastre, amarras, preparativo de maniobra).
- **No** se descuentan las detenciones del terminal (mantenimiento, atoros, correas,
  limpieza, cambio de turno, cambio de bodega, corridas): corren contra el fletador.
- Despatch por defecto en 50 % del demurrage rate, sobre *all time saved*.

Cada uno de estos criterios es editable en pantalla. El resultado definitivo depende
de la redacción del charter party y del Statement of Facts firmado por las partes.
