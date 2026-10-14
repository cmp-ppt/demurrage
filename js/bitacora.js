/**
 * Bitácora del puerto: qué días estuvo cerrado, con restricción o abierto,
 * y por qué.
 *
 * El pronóstico dice lo que va a pasar; esto registra lo que pasó. No son
 * lo mismo y no se pueden mezclar: el puerto se cierra por mar de fondo,
 * sí, pero también por un paro del personal portuario ajeno a la empresa,
 * por mantención del terminal o por una falla de equipo, y de eso ningún
 * modelo meteorológico se entera. Cuando al liquidar una recalada hay que
 * explicar tres días de detención, lo que sirve es este registro escrito el
 * día que ocurrió, no la reconstrucción de memoria tres meses después.
 *
 * Un evento cubre días, y opcionalmente las horas dentro de esos días. La
 * primera versión era solo por jornada —el cierre se decide y se comunica
 * así— pero un puerto que cierra a las 14:00 y reabre a las 06:30 del día
 * siguiente no son dos días cerrados, y al liquidar esa diferencia son
 * horas de laytime que alguien va a discutir.
 *
 * Las horas son opcionales a propósito. Sin ellas el evento cubre las
 * jornadas completas, que es como se comunica y como quedaron registrados
 * los eventos anteriores; con ellas se acota. Un formulario que exija la
 * hora se llena tarde o no se llena, y un registro escrito el mismo día sin
 * hora vale más que uno exacto que nadie escribió.
 */
(function(global){
  "use strict";

  var MS_DIA = 86400000;

  /* Los tres estados son los mismos que usa el pronóstico, con las mismas
     palabras: que el puerto esté «cerrado» tiene que querer decir lo mismo
     venga del modelo o de la bitácora. `peso` ordena por gravedad, para
     cuando dos eventos caen el mismo día. */
  var ESTADOS = {
    abierto:     {clave:"abierto",     rotulo:"Abierto",         peso:0},
    restringido: {clave:"restringido", rotulo:"Con restricción", peso:1},
    cerrado:     {clave:"cerrado",     rotulo:"Cerrado",         peso:2}
  };

  /* Causas frecuentes en el terminal. No es una lista cerrada —el campo
     admite cualquier texto— pero tenerlas escritas evita que el mismo
     motivo quede registrado de cuatro formas distintas y después no se
     pueda sumar. */
  var CAUSAS = [
    "Condiciones de mar",
    "Viento",
    "Paro o movilización portuaria",
    "Mantención del terminal",
    "Falla de equipo",
    "Instrucción de la autoridad marítima",
    "Otra"
  ];

  /* ───────────────────────── fechas ───────────────────────── */

  /** "YYYY-MM-DD" de una fecha local. Nunca toISOString: eso pasa a UTC y
      en Chile corre el día para atrás durante toda la tarde. */
  function aIso(d){
    if(!(d instanceof Date) || isNaN(d)) return "";
    var dos = function(n){ return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + dos(d.getMonth() + 1) + "-" + dos(d.getDate());
  }

  /** Fecha local a medianoche desde "YYYY-MM-DD". */
  function deIso(s){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if(!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }

  function hoyIso(ahora){ return aIso(ahora ? new Date(ahora) : new Date()); }

  /** "HH:MM" si es una hora del día; "" si no. Acepta "9:5" y "09:05". */
  function aHora(t){
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t == null ? "" : t).trim());
    if(!m) return "";
    var h = +m[1], mi = +m[2];
    if(h > 23 || mi > 59) return "";
    return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  }

  /** Minutos desde la medianoche, para comparar dos horas. */
  function enMinutos(t){
    var h = aHora(t);
    return h ? (+h.slice(0, 2)) * 60 + (+h.slice(3)) : null;
  }

  /**
   * Cuánto duró el evento, en horas.
   *
   * Sin horas, el evento cubre jornadas completas y son 24 por día: es lo
   * que se comunica cuando se cierra el puerto «el martes y el miércoles».
   * Con horas, se cuenta desde la de inicio hasta la de término, que es lo
   * que se va a citar al liquidar.
   */
  function largoEnHoras(ev){
    if(!ev) return 0;
    var dias = largoEnDias(ev.desde, ev.hasta);
    if(!dias) return 0;
    var hd = enMinutos(ev.horaDesde), hh = enMinutos(ev.horaHasta);
    if(hd === null && hh === null) return dias * 24;
    if(hd === null) hd = 0;
    if(hh === null) hh = 24 * 60;
    var min = (dias - 1) * 24 * 60 + (hh - hd);
    return min > 0 ? min / 60 : 0;
  }

  /** El rango como se lee: «21-09 14:00 → 22-09 06:30». */
  function rotuloRango(ev){
    if(!ev || !ev.desde) return "";
    var hd = aHora(ev.horaDesde), hh = aHora(ev.horaHasta);
    var unDia = ev.desde === ev.hasta;
    if(unDia && !hd && !hh) return ev.desde;
    if(unDia) return ev.desde + " " + (hd || "00:00") + " → " + (hh || "24:00");
    return ev.desde + (hd ? " " + hd : "") + " → " + ev.hasta + (hh ? " " + hh : "");
  }

  /** Días de diferencia entre dos ISO, inclusivo. */
  function largoEnDias(desde, hasta){
    var a = deIso(desde), b = deIso(hasta);
    if(!a || !b) return 0;
    return Math.round((b - a) / MS_DIA) + 1;
  }

  /* ───────────────────────── eventos ──────────────────────── */

  var contador = 0;
  function nuevoId(ahora){
    contador++;
    return "ev-" + (ahora || Date.now()).toString(36) + "-" + contador.toString(36);
  }

  /**
   * Deja un evento en forma canónica. Si el rango viene al revés lo da
   * vuelta en vez de rechazarlo: marcar «del viernes al lunes» arrastrando
   * hacia atrás en el calendario es un gesto normal, no un error.
   */
  function normalizar(ev, ahora){
    if(!ev) return null;
    var desde = String(ev.desde || "").slice(0, 10);
    var hasta = String(ev.hasta || desde).slice(0, 10);
    if(!deIso(desde)) return null;
    if(!deIso(hasta)) hasta = desde;
    var horaDesde = aHora(ev.horaDesde), horaHasta = aHora(ev.horaHasta);
    if(deIso(hasta) < deIso(desde)){
      var t = desde; desde = hasta; hasta = t;
      var th = horaDesde; horaDesde = horaHasta; horaHasta = th;
    }
    /* Dentro del mismo día el que da vuelta el rango es el reloj, no el
       calendario: «de 18:00 a 06:00» marcado en un solo día es casi siempre
       el arrastre al revés, igual que con las fechas. */
    if(desde === hasta && horaDesde && horaHasta && enMinutos(horaHasta) < enMinutos(horaDesde)){
      var tm = horaDesde; horaDesde = horaHasta; horaHasta = tm;
    }
    var estado = ESTADOS[ev.estado] ? ev.estado : "cerrado";
    return {
      id: ev.id || nuevoId(ahora),
      desde: desde,
      hasta: hasta,
      horaDesde: horaDesde,
      horaHasta: horaHasta,
      estado: estado,
      causa: String(ev.causa || "").trim(),
      nota: String(ev.nota || "").trim(),
      registradoPor: String(ev.registradoPor || "").trim(),
      actualizadoEn: ev.actualizadoEn || new Date(ahora || Date.now()).toISOString()
    };
  }

  /**
   * Reparos que impiden guardar. Son pocos a propósito: el registro tiene
   * que poder escribirse rápido el mismo día, y un formulario que discute
   * se llena tarde o no se llena.
   */
  function validar(ev){
    var fuera = [];
    if(!ev || !deIso(ev.desde)) { fuera.push("Falta el día del evento."); return fuera; }
    if(!ESTADOS[ev.estado]) fuera.push("Falta el estado del puerto.");
    if(!String(ev.causa || "").trim()) fuera.push("Falta la causa: es lo que se va a citar al liquidar.");
    /* Un rango largo casi siempre es un clic mal arrastrado. No se prohíbe
       —un paro puede durar semanas— pero no pasa en silencio. */
    if(largoEnDias(ev.desde, ev.hasta) > 60) fuera.push("El rango supera los 60 días: revisa las fechas.");
    return fuera;
  }

  /** Los días ISO que cubre un evento, ambos extremos incluidos. */
  function dias(ev){
    var a = deIso(ev && ev.desde), b = deIso(ev && ev.hasta);
    if(!a || !b || b < a) return [];
    var out = [], d = new Date(a);
    while(d <= b){ out.push(aIso(d)); d = new Date(d.getTime() + MS_DIA); }
    return out;
  }

  /**
   * Mapa día → evento que manda ese día. Cuando dos se solapan gana el más
   * grave: si el puerto estaba cerrado por paro y además con restricción
   * por viento, el día estuvo cerrado. Registrar los dos es correcto —son
   * causas distintas— pero el calendario muestra uno.
   */
  function porDia(eventos){
    var mapa = {};
    (eventos || []).forEach(function(ev){
      dias(ev).forEach(function(iso){
        var actual = mapa[iso];
        if(!actual || ESTADOS[ev.estado].peso > ESTADOS[actual.estado].peso) mapa[iso] = ev;
      });
    });
    return mapa;
  }

  /** Todos los eventos que tocan un día, del más grave al menos. */
  function delDia(eventos, iso){
    return (eventos || []).filter(function(ev){ return dias(ev).indexOf(iso) >= 0; })
      .sort(function(a, b){ return ESTADOS[b.estado].peso - ESTADOS[a.estado].peso; });
  }

  /* ───────────────────────── colección ────────────────────── */

  function agregar(lista, ev, ahora){
    var norm = normalizar(ev, ahora);
    if(!norm) return (lista || []).slice();
    var copia = (lista || []).filter(function(x){ return x.id !== norm.id; });
    copia.push(norm);
    return ordenar(copia);
  }

  function eliminar(lista, id){
    return (lista || []).filter(function(x){ return x.id !== id; });
  }

  /** Del más reciente al más antiguo, que es como se lee una bitácora. */
  function ordenar(lista){
    return (lista || []).slice().sort(function(a, b){
      if(a.desde !== b.desde) return a.desde < b.desde ? 1 : -1;
      return (b.actualizadoEn || "") > (a.actualizadoEn || "") ? 1 : -1;
    });
  }

  /**
   * Une lo local con lo que hay en la nube. Por id y por marca de tiempo,
   * nunca «gana el último que guardó»: son tres personas registrando
   * eventos distintos el mismo día, y reemplazar la lista entera haría
   * desaparecer el evento del otro sin que nadie se entere.
   */
  function fusionar(locales, remotos){
    var por = {};
    function marca(r){ return r && r.actualizadoEn ? Date.parse(r.actualizadoEn) || 0 : 0; }
    (locales || []).forEach(function(r){ if(r && r.id) por[r.id] = r; });
    (remotos || []).forEach(function(r){
      if(!r || !r.id) return;
      if(!por[r.id] || marca(r) > marca(por[r.id])) por[r.id] = r;
    });
    return ordenar(Object.keys(por).map(function(k){ return por[k]; }));
  }

  /** Los que hay que subir: los que la nube no tiene o tiene más viejos. */
  function pendientesDeSubir(lista, remotos){
    var por = {};
    (remotos || []).forEach(function(r){ if(r && r.id) por[r.id] = r; });
    return (lista || []).filter(function(r){
      var alla = por[r.id];
      if(!alla) return true;
      return (Date.parse(r.actualizadoEn) || 0) > (Date.parse(alla.actualizadoEn) || 0);
    });
  }

  /* ───────────────────────── calendario ───────────────────── */

  /**
   * La rejilla de un mes, en semanas que empiezan el lunes. Devuelve
   * siempre semanas completas, rellenando con los días del mes vecino
   * marcados `fuera`: una rejilla con huecos se lee peor que una con días
   * apagados, y además permite ver un evento que cruza de mes.
   */
  function rejillaMes(anio, mes){
    var primero = new Date(anio, mes, 1);
    /* getDay() da 0 para domingo; acá la semana parte el lunes. */
    var corrimiento = (primero.getDay() + 6) % 7;
    var inicio = new Date(anio, mes, 1 - corrimiento);
    var semanas = [], d = new Date(inicio);
    while(true){
      var semana = [];
      for(var i = 0; i < 7; i++){
        semana.push({iso: aIso(d), dia: d.getDate(), fuera: d.getMonth() !== mes});
        d = new Date(d.getTime() + MS_DIA);
      }
      semanas.push(semana);
      if(d.getMonth() !== mes && d > primero) break;
    }
    return semanas;
  }

  /** Cuántos días de cada estado hay en un rango, para el pie del mes. */
  function resumen(eventos, desdeIso, hastaIso){
    var mapa = porDia(eventos);
    var out = {cerrado: 0, restringido: 0, abierto: 0, total: 0};
    var a = deIso(desdeIso), b = deIso(hastaIso);
    if(!a || !b) return out;
    for(var d = new Date(a); d <= b; d = new Date(d.getTime() + MS_DIA)){
      out.total++;
      var ev = mapa[aIso(d)];
      if(ev) out[ev.estado]++;
    }
    return out;
  }

  var api = {
    ESTADOS: ESTADOS, CAUSAS: CAUSAS,
    aIso: aIso, deIso: deIso, hoyIso: hoyIso, largoEnDias: largoEnDias,
    aHora: aHora, enMinutos: enMinutos, largoEnHoras: largoEnHoras, rotuloRango: rotuloRango,
    normalizar: normalizar, validar: validar, dias: dias,
    porDia: porDia, delDia: delDia,
    agregar: agregar, eliminar: eliminar, ordenar: ordenar,
    fusionar: fusionar, pendientesDeSubir: pendientesDeSubir,
    rejillaMes: rejillaMes, resumen: resumen
  };

  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Bitacora = api;

})(typeof window !== "undefined" ? window : globalThis);
