/**
 * Sincronización con Supabase por REST (PostgREST).
 *
 * La nube es opcional: sin configurar, la app funciona igual contra el
 * navegador. Con configuración, el historial de embarques se comparte entre
 * las personas que abran la misma URL.
 *
 * La regla de conflicto es simple y explícita: gana el registro con
 * `actualizado_en` más reciente. Sin bloqueos ni versiones — dos personas
 * editando el mismo embarque a la vez es raro en esta operación, y una regla
 * que nadie entiende es peor que una regla tosca que todos entienden.
 *
 * La fusión y el mapeo van separados de la red para poder probarlos con Node.
 */
(function(global){
  "use strict";

  var CLAVE_CFG = "demurrage-ppt.nube.v1";
  var estadoActual = "off";          // off | sincronizando | ok | error
  var ultimoError = "";
  var oyentes = [];

  /* ─────────────────────── configuración ───────────────────────── */

  function configPorDefecto(){
    // js/config.js puede traer los valores del proyecto; si no, van vacíos.
    var c = global.CONFIG_NUBE || {};
    return {url: c.url || "", anonKey: c.anonKey || "", tabla: c.tabla || "demurrage_embarques"};
  }

  function config(){
    var guardada = null;
    try{ guardada = JSON.parse(localStorage.getItem(CLAVE_CFG) || "null"); }catch(e){ guardada = null; }
    var base = configPorDefecto();
    if(!guardada) return base;
    /* Desconectar tiene que poder más que la configuración del repositorio.
       Desde que js/config.js trae el proyecto —para que el enlace sirva a
       todo el equipo— borrar lo guardado volvía a caer en ella, y el botón
       prometía que el historial volvía a ser solo de este equipo sin que
       fuera cierto. La decisión se guarda, no se deduce de un hueco. */
    if(guardada.desconectado) return {url:"", anonKey:"", tabla: base.tabla};
    return {
      url: normalizarUrl(guardada.url || base.url),
      anonKey: guardada.anonKey || base.anonKey || "",
      tabla: guardada.tabla || base.tabla || "demurrage_embarques"
    };
  }

  /**
   * Revisa la clave antes de guardarla. Devuelve el problema o "" si sirve.
   *
   * Supabase muestra dos claves juntas en la misma pantalla y la peligrosa
   * está debajo. La publicable está pensada para el navegador —lo que la
   * contiene son las políticas RLS—; la secreta salta RLS por completo y es
   * para servidores. Pegada acá quedaría en un sitio público y le daría a
   * cualquiera acceso de administrador a la base: no solo a esta tabla, a
   * todas las del proyecto.
   *
   * Vale para los dos formatos: el nuevo (sb_publishable_ / sb_secret_) y el
   * antiguo, donde las dos son JWT y lo que las distingue es el `role` de su
   * carga útil.
   */
  /**
   * Deja la URL del proyecto en su forma útil.
   *
   * El panel de Supabase muestra la dirección en tres lugares y no siempre
   * igual: en Data API sale con «/rest/v1» pegado, porque ahí es la base de
   * la API de datos. Pegada tal cual, la app termina pidiendo
   * «…/rest/v1/auth/v1/token» y el servidor contesta «Invalid path specified
   * in request URL» — un mensaje que no sugiere en absoluto que sobra un
   * pedazo de URL. Es más barato aceptar las tres formas que explicar cuál
   * de las tres es.
   *
   * Se recortan solo los sufijos conocidos de la API, no la ruta entera:
   * una instalación propia de Supabase puede vivir bajo un prefijo y
   * llevárselo por delante la dejaría inservible.
   */
  function normalizarUrl(u){
    var t = String(u || "").trim();
    if(!t) return "";
    t = t.split("#")[0].split("?")[0];               // ancla y parámetros
    if(!/^https?:\/\//i.test(t)) t = "https://" + t;  // pegada sin esquema
    t = t.replace(/\/(rest|auth|storage|realtime|functions)\/v\d+(\/.*)?$/i, "");
    return t.replace(/\/+$/, "");
  }

  function revisarKey(k){
    var clave = (k || "").trim();
    if(!clave) return "Falta la clave del proyecto.";
    if(/^sb_secret_/i.test(clave)){
      return "Esa es la clave SECRETA (sb_secret_…). No puede ir en el navegador: " +
             "salta las políticas RLS y le daría acceso de administrador a cualquiera " +
             "que abra el sitio. Usa la publicable (sb_publishable_…).";
    }
    if(/^service_role$/i.test(clave)) return "Pega la clave, no el nombre del rol.";
    var rol = rolDeJwt(clave);
    if(rol === "service_role"){
      return "Esa es la clave service_role. No puede ir en el navegador: salta las " +
             "políticas RLS y le daría acceso de administrador a cualquiera que abra " +
             "el sitio. Usa la anon / publicable.";
    }
    return "";
  }

  /** Rol declarado dentro de un JWT de Supabase, o "" si no es un JWT. */
  function rolDeJwt(clave){
    var partes = String(clave).split(".");
    if(partes.length !== 3) return "";
    try{
      var b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
      while(b64.length % 4) b64 += "=";
      var crudo = (typeof atob === "function")
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("binary");
      var carga = JSON.parse(crudo);
      return carga && carga.role ? String(carga.role) : "";
    }catch(e){ return ""; }
  }

  function configurar(cfg){
    try{
      localStorage.setItem(CLAVE_CFG, JSON.stringify({
        url: normalizarUrl(cfg.url),
        anonKey: (cfg.anonKey || "").trim(),
        tabla: (cfg.tabla || "").trim() || "demurrage_embarques"
      }));
    }catch(e){ /* almacenamiento bloqueado */ }
    fijarEstado(activa() ? "sincronizando" : "off");
  }

  function olvidar(){
    try{
      localStorage.setItem(CLAVE_CFG, JSON.stringify({desconectado: true}));
    }catch(e){ /* almacenamiento bloqueado */ }
    fijarEstado("off");
  }

  /** Vuelve a la configuración que trae el sitio, deshaciendo un desconectar. */
  function reconectarPorDefecto(){
    try{ localStorage.removeItem(CLAVE_CFG); }catch(e){}
    fijarEstado(activa() ? "sincronizando" : "off");
  }

  function activa(){
    var c = config();
    return !!(c.url && c.anonKey && c.tabla);
  }

  /* ─────────────────────────── estado ──────────────────────────── */

  function fijarEstado(e, mensaje){
    estadoActual = e;
    ultimoError = mensaje || "";
    oyentes.forEach(function(f){ try{ f(e, ultimoError); }catch(err){} });
  }
  function estado(){ return estadoActual; }
  function error(){ return ultimoError; }
  function alCambiar(f){ oyentes.push(f); }

  /* ───────────────────── mapeo registro ↔ fila ─────────────────── */

  /** Fecha con que se ordena el embarque en la nube. */
  function fechaDe(reg, L){
    var c = reg.campos || {};
    var d = (L && L.parseFechaHora)
      ? (L.parseFechaHora(c.primeraEspia) || L.parseFechaHora(c.inicioCarga) || L.parseFechaHora(c.nor))
      : null;
    return d ? d.toISOString() : null;
  }

  function aFila(reg, L){
    return {
      codigo: (reg.campos.codigo || "").trim(),
      nave: reg.campos.nave || "",
      fecha: fechaDe(reg, L),
      campos: reg.campos,
      deducciones: reg.deducciones || [],
      actualizado_en: reg.actualizadoEn || new Date().toISOString()
    };
  }

  function deFila(fila){
    return {
      id: "sb:" + fila.codigo,
      campos: fila.campos || {},
      deducciones: fila.deducciones || [],
      actualizadoEn: fila.actualizado_en || null
    };
  }

  /**
   * Fusiona la lista local con la remota. Empareja por código de embarque y
   * se queda con el más reciente; lo que existe solo en un lado, se conserva.
   * Los registros sin código quedan siempre en local: sin clave no hay
   * forma de emparejarlos ni de subirlos.
   */
  function fusionar(locales, remotos){
    var porCodigo = {}, sueltos = [];
    function clave(r){ return ((r.campos && r.campos.codigo) || "").trim().toUpperCase(); }
    function marca(r){ return r.actualizadoEn ? Date.parse(r.actualizadoEn) || 0 : 0; }

    (locales || []).forEach(function(r){
      var k = clave(r);
      if(!k){ sueltos.push(r); return; }
      porCodigo[k] = r;
    });
    (remotos || []).forEach(function(r){
      var k = clave(r);
      if(!k) return;
      var actual = porCodigo[k];
      if(!actual || marca(r) > marca(actual)){
        // El id local se conserva: es con lo que la interfaz abre la recalada.
        if(actual) r = Object.assign({}, r, {id: actual.id});
        porCodigo[k] = r;
      }
    });
    return Object.keys(porCodigo).map(function(k){ return porCodigo[k]; }).concat(sueltos);
  }

  /**
   * De la lista ya fusionada, cuáles hay que subir: los que no están en la
   * nube y los que allá están más viejos.
   *
   * Subir todo lo local sin mirar es lo que destruye el trabajo ajeno: si otra
   * persona corrigió un embarque hace un minuto y yo empujo mi copia vieja,
   * su corrección desaparece. Primero se lee, se fusiona, y recién entonces se
   * sube lo que de verdad es más nuevo.
   */
  function pendientesDeSubir(fusionados, remotos){
    function clave(r){ return ((r.campos && r.campos.codigo) || "").trim().toUpperCase(); }
    function marca(r){ return r && r.actualizadoEn ? Date.parse(r.actualizadoEn) || 0 : 0; }
    var enNube = {};
    (remotos || []).forEach(function(r){ enNube[clave(r)] = r; });
    return (fusionados || []).filter(function(r){
      var k = clave(r);
      if(!k) return false;                       // sin código no se puede subir
      var rem = enNube[k];
      return !rem || marca(r) > marca(rem);
    });
  }

  /* ────────────────────────────── red ──────────────────────────── */

  /* La cabecera lleva la anon key como apikey y el token del usuario como
     Authorization. Antes iban las dos con la anon key, que es lo que hacía
     que cualquiera con la URL pudiera leer y escribir: para PostgREST esa
     petición es `anon`, y una política que exija `authenticated` la rechaza.
     Sin sesión no se pide nada, en vez de pedirlo y recibir 401. */
  function cabeceras(token, extra){
    var c = config();
    var h = {apikey: c.anonKey, Authorization: "Bearer " + token};
    for(var k in (extra || {})) h[k] = extra[k];
    return h;
  }

  var SESION = (typeof module === "object" && module.exports)
    ? null : global.Sesion;

  /** Token del usuario, renovándolo si hace falta. */
  function conToken(){
    if(!SESION) return Promise.reject(new Error("Falta el módulo de sesión."));
    return SESION.token(config());
  }

  /** ¿Hay proyecto configurado Y sesión iniciada? Es lo que habilita la red. */
  function lista(){
    return activa() && !!(SESION && SESION.activa());
  }

  function listar(){
    if(!lista()) return Promise.resolve([]);
    var c = config();
    fijarEstado("sincronizando");
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + c.tabla + "?select=*&order=fecha.desc.nullslast",
                 {method:"GET", headers: cabeceras(tk)});
    })
      .then(function(res){
        if(!res.ok) throw new Error("HTTP " + res.status + " al leer " + c.tabla);
        return res.json();
      })
      .then(function(filas){
        fijarEstado("ok");
        return (Array.isArray(filas) ? filas : []).map(deFila);
      })
      .catch(function(err){ fijarEstado("error", err.message); throw err; });
  }

  function guardar(reg, L){
    if(!lista()) return Promise.resolve(false);
    var fila = aFila(reg, L);
    if(!fila.codigo) return Promise.resolve(false);   // sin clave no se sube
    var c = config();
    fijarEstado("sincronizando");
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + c.tabla, {
        method: "POST",
        headers: cabeceras(tk, {"Content-Type":"application/json",
                            Prefer:"resolution=merge-duplicates,return=minimal"}),
        body: JSON.stringify(fila)
      });
    }).then(function(res){
      if(!res.ok) throw new Error("HTTP " + res.status + " al guardar " + fila.codigo);
      fijarEstado("ok");
      return true;
    }).catch(function(err){ fijarEstado("error", err.message); return false; });
  }

  function eliminar(codigo){
    if(!lista() || !codigo) return Promise.resolve(false);
    var c = config();
    fijarEstado("sincronizando");
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + c.tabla + "?codigo=eq." + encodeURIComponent(codigo),
                 {method:"DELETE", headers: cabeceras(tk, {Prefer:"return=minimal"})});
    })
      .then(function(res){
        if(!res.ok) throw new Error("HTTP " + res.status + " al eliminar " + codigo);
        fijarEstado("ok");
        return true;
      }).catch(function(err){ fijarEstado("error", err.message); return false; });
  }

  /* ───────────── libro de reportería de la temporada ──────────── */

  var TABLA_TEMP = "demurrage_temporada";

  /**
   * El libro es uno solo y se reemplaza entero.
   *
   * No se fusiona por partes a propósito: llega como un Excel completo que
   * el área comercial regenera cada vez, y mezclar la mitad de uno con la
   * mitad de otro daría una temporada que no existe en ninguna planilla y
   * que nadie podría auditar. Gana el último que lo cargó, igual que en el
   * mesón: el libro nuevo reemplaza al viejo.
   */
  function subirTemporada(datos, meta){
    if(!lista() || !datos || !datos.recaladas || !datos.recaladas.length){
      return Promise.resolve(false);
    }
    var c = config();
    var fila = {
      id: "actual",
      datos: datos,
      origen: (meta && meta.origen) || "",
      cargado_por: (meta && meta.quien) || "",
      actualizado_en: new Date().toISOString()
    };
    fijarEstado("sincronizando");
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_TEMP, {
        method: "POST",
        headers: cabeceras(tk, {"Content-Type":"application/json",
                            Prefer:"resolution=merge-duplicates,return=minimal"}),
        body: JSON.stringify(fila)
      });
    }).then(function(res){
      if(!res.ok) throw new Error("HTTP " + res.status + " al subir el libro de reportería");
      fijarEstado("ok");
      return true;
    }).catch(function(err){ fijarEstado("error", err.message); return false; });
  }

  /** Trae el libro compartido, o null si no hay ninguno todavía. */
  function bajarTemporada(){
    if(!lista()) return Promise.resolve(null);
    var c = config();
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_TEMP + "?id=eq.actual&select=*",
                   {headers: cabeceras(tk)});
    }).then(function(res){
      /* Que la tabla no exista todavía no es un error que deba romper la
         sincronización: el equipo puede estar usando la app con el esquema
         viejo, y los embarques tienen que seguir viajando igual. */
      if(res.status === 404) return null;
      if(!res.ok) throw new Error("HTTP " + res.status + " al leer el libro de reportería");
      return res.json();
    }).then(function(filas){
      var f = Array.isArray(filas) ? filas[0] : null;
      if(!f || !f.datos) return null;
      return {datos: f.datos, origen: f.origen || "",
              quien: f.cargado_por || "", actualizadoEn: f.actualizado_en || ""};
    }).catch(function(){ return null; });
  }

  /* ─────────────── bitácora del puerto ─────────────── */

  var TABLA_BITACORA = "demurrage_bitacora";

  /**
   * Una fila por evento, no un blob con la lista entera.
   *
   * El libro de reportería sí se reemplaza completo —llega como un Excel
   * que el área comercial regenera— pero la bitácora se escribe a mano y de
   * a poco, desde tres computadores distintos. Guardarla entera en una fila
   * haría que quien guarde último borre los eventos que los otros dos
   * acababan de registrar, y nadie se enteraría hasta que al liquidar
   * faltara el día del paro.
   */
  function subirEventos(eventos){
    if(!lista() || !eventos || !eventos.length) return Promise.resolve(false);
    var c = config();
    var filas = eventos.map(function(ev){
      return {
        id: ev.id, desde: ev.desde, hasta: ev.hasta, estado: ev.estado,
        causa: ev.causa || "", nota: ev.nota || "",
        registrado_por: ev.registradoPor || "",
        actualizado_en: ev.actualizadoEn || new Date().toISOString()
      };
    });
    /* La bitácora no toca el estado global de conexión, ni para bien ni
       para mal. Es una tabla accesoria que puede no existir todavía —el SQL
       se corre aparte— y con `fijarEstado("error")` acá, un proyecto sin
       esa tabla ponía toda la app en «Sin conexión» mientras los embarques
       y la temporada viajaban perfectamente. El aviso de que la bitácora no
       se comparte va en su propio panel, no en el chip de la cabecera. */
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_BITACORA, {
        method: "POST",
        headers: cabeceras(tk, {"Content-Type":"application/json",
                            Prefer:"resolution=merge-duplicates,return=minimal"}),
        body: JSON.stringify(filas)
      });
    }).then(function(res){
      if(!res.ok) throw new Error("HTTP " + res.status + " al subir la bitácora");
      return true;
    }).catch(function(){ return false; });
  }

  function borrarEvento(id){
    if(!lista() || !id) return Promise.resolve(false);
    var c = config();
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_BITACORA + "?id=eq." + encodeURIComponent(id),
                   {method:"DELETE", headers: cabeceras(tk, {Prefer:"return=minimal"})});
    }).then(function(res){ return res.ok; }).catch(function(){ return false; });
  }

  /** Los eventos compartidos. Lista vacía si la tabla no existe todavía. */
  function listarEventos(){
    if(!lista()) return Promise.resolve([]);
    var c = config();
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_BITACORA + "?select=*&order=desde.desc",
                   {headers: cabeceras(tk)});
    }).then(function(res){
      /* Que la tabla no exista todavía no puede romper la sincronización de
         los embarques: el equipo puede estar con el esquema viejo. */
      if(res.status === 404) return [];
      if(!res.ok) throw new Error("HTTP " + res.status + " al leer la bitácora");
      return res.json();
    }).then(function(filas){
      return (Array.isArray(filas) ? filas : []).map(function(f){
        return {id: f.id, desde: f.desde, hasta: f.hasta, estado: f.estado,
                causa: f.causa || "", nota: f.nota || "",
                registradoPor: f.registrado_por || "",
                actualizadoEn: f.actualizado_en || ""};
      });
    }).catch(function(){ return []; });
  }

  /* ─────────── planillas de turno (ACUMULADO EMBARQUE) ─────────── */

  var TABLA_TURNOS = "demurrage_turnos";

  /**
   * Una fila por mes. El mes es la unidad porque es lo que trae cada
   * planilla: tres personas cargan meses distintos y con el almacén entero
   * en una sola fila, quien guarde último borra el mes que otro acabó de
   * cargar. Dentro de un mes se reemplaza completo —la planilla del último
   * día ya trae el acumulado— y de eso se encarga `merge-duplicates`.
   *
   * Como la bitácora, no toca el estado global de conexión: la tabla puede
   * no existir todavía —el SQL se corre aparte— y poner la app en «Sin
   * conexión» por eso mandaría a buscar un problema de red que no existe.
   */
  function subirTurnos(mapa, claves){
    var lista2 = claves && claves.length ? claves : Object.keys(mapa || {});
    if(!lista() || !lista2.length) return Promise.resolve(false);
    var c = config();
    var filas = lista2.map(function(k){
      var m = (mapa || {})[k] || {};
      return {
        mes: k,
        total_mineral: Number(m.totalMineral) || 0,
        total_otros: Number(m.totalOtros) || 0,
        por_nave: m.porNave || [],
        archivo: m.archivo || "",
        cargado_por: m.cargadoPor || "",
        actualizado_en: m.actualizadoEn || new Date().toISOString()
      };
    });
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_TURNOS, {
        method: "POST",
        headers: cabeceras(tk, {"Content-Type":"application/json",
                            Prefer:"resolution=merge-duplicates,return=minimal"}),
        body: JSON.stringify(filas)
      });
    }).then(function(res){
      if(!res.ok) throw new Error("HTTP " + res.status + " al subir las planillas de turno");
      return true;
    }).catch(function(){ return false; });
  }

  /** Los meses compartidos, como mapa. Vacío si la tabla no existe todavía. */
  function listarTurnos(){
    if(!lista()) return Promise.resolve({});
    var c = config();
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + TABLA_TURNOS + "?select=*&order=mes.desc",
                   {headers: cabeceras(tk)});
    }).then(function(res){
      if(res.status === 404) return [];
      if(!res.ok) throw new Error("HTTP " + res.status + " al leer las planillas de turno");
      return res.json();
    }).then(function(filas){
      var out = {};
      (Array.isArray(filas) ? filas : []).forEach(function(f){
        if(!f || !f.mes) return;
        out[f.mes] = {
          totalMineral: Number(f.total_mineral) || 0,
          totalOtros: Number(f.total_otros) || 0,
          porNave: Array.isArray(f.por_nave) ? f.por_nave : [],
          archivo: f.archivo || "",
          cargadoPor: f.cargado_por || "",
          actualizadoEn: f.actualizado_en || ""
        };
      });
      return out;
    }).catch(function(){ return {}; });
  }

  /** Comprueba credenciales contra la tabla, sin traer datos. */
  function probar(){
    var c = config();
    if(!c.url || !c.anonKey) return Promise.reject(new Error("Falta la URL o la anon key."));
    if(!SESION || !SESION.activa()) return Promise.reject(new Error("Inicia sesión antes de probar la conexión."));
    return conToken().then(function(tk){
      return fetch(c.url + "/rest/v1/" + c.tabla + "?select=codigo&limit=1", {headers: cabeceras(tk)});
    })
      .then(function(res){
        if(res.status === 404) throw new Error("La tabla «" + c.tabla + "» no existe en ese proyecto.");
        if(res.status === 401 || res.status === 403) throw new Error("Sesión rechazada (HTTP " + res.status + "). Revisa las políticas RLS: tienen que permitir a «authenticated».");
        if(!res.ok) throw new Error("HTTP " + res.status);
        fijarEstado("ok");
        return true;
      });
  }

  var api = {
    config: config, configurar: configurar, olvidar: olvidar, activa: activa,
    estado: estado, error: error, alCambiar: alCambiar,
    aFila: aFila, deFila: deFila, fusionar: fusionar, pendientesDeSubir: pendientesDeSubir,
    lista: lista, revisarKey: revisarKey, reconectarPorDefecto: reconectarPorDefecto, rolDeJwt: rolDeJwt, normalizarUrl: normalizarUrl,
    listar: listar, guardar: guardar, eliminar: eliminar, probar: probar,
    subirTemporada: subirTemporada, bajarTemporada: bajarTemporada, TABLA_TEMP: TABLA_TEMP,
    subirEventos: subirEventos, borrarEvento: borrarEvento, listarEventos: listarEventos,
    TABLA_BITACORA: TABLA_BITACORA,
    subirTurnos: subirTurnos, listarTurnos: listarTurnos, TABLA_TURNOS: TABLA_TURNOS
  };
  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Nube = api;

})(typeof window !== "undefined" ? window : globalThis);
