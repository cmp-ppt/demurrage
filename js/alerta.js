/**
 * Cuándo avisar por correo de una condición fuera de rango, y qué decir.
 *
 * Decide, no envía: todo lo que toca la red vive en scripts/alerta-clima.js,
 * y acá queda lo que se puede probar sin pedirle nada a nadie.
 *
 * ── La regla ──
 *
 * Viento SOSTENIDO sobre 18 nudos durante al menos una hora seguida. La
 * ráfaga no dispara nada: una ráfaga es un pico de segundos, y un aviso que
 * salta con cada pico se vuelve ruido que nadie mira —y entonces el aviso
 * que importa tampoco se mira.
 *
 * Los 18 nudos son MENOS que los 20 del terminal a propósito. 20 es el
 * límite de operación: a esa velocidad el embarque se detiene y queda
 * escrito en el RTE. El aviso tiene que llegar antes de eso, cuando todavía
 * se puede decidir algo —apurar el cierre de bodega, avisar a la agencia—,
 * no cuando ya ocurrió. Por eso el tablero sigue pintando el estado del
 * puerto con 20/25 y el correo avisa en 18: no son dos definiciones de lo
 * mismo que se contradicen, son el límite y su antesala.
 *
 * La marejada y la visibilidad NO disparan: van como dato. Se informan en el
 * correo —y se marcan cuando pasan del umbral del puerto— para que quien lo
 * lea sepa con qué mar se junta el viento, pero no mandan un correo por su
 * cuenta. Es decisión de la operación: el aviso es de viento.
 *
 * Tiene una consecuencia que conviene tener presente: una marejada de 3 m
 * con viento calmo no genera correo. El tablero sí la pinta como puerto
 * cerrado; el correo calla.
 *
 * ── Y se avisa al CRUZAR, no mientras dure ──
 *
 * Un correo por revisión con viento sobre 18 nudos durante dos días son
 * cuarenta correos iguales, y a los tres primeros nadie los abre. Lo que
 * cambia la decisión del turno es el momento en que el pronóstico pasa a
 * fuera de rango, y el momento en que vuelve.
 */
(function(global){
  "use strict";

  var CLIMA = (typeof module === "object" && module.exports)
    ? require("./clima.js") : global.Clima;

  /* Mirar solo la hora actual avisa tarde: el turno necesita saber lo que
     viene para decidir si alcanza a terminar el embarque. Un día es el
     horizonte en que el pronóstico todavía es útil y el aviso accionable. */
  var HORAS = 24;

  /**
   * El umbral del CORREO, que no es el del tablero.
   *
   * `horasSeguidas` cuenta muestras del pronóstico, y el pronóstico viene
   * por hora: una muestra ES una hora de viento sostenido. Con 1 basta con
   * que una hora completa pase de 18 nudos, que es lo pedido. Subirlo a 2
   * exige dos horas seguidas y descarta la hora suelta, por si el aviso
   * resulta ser más sensible de lo que conviene.
   */
  var UMBRAL = {
    vientoSostenido: 18,    // nudos a 10 m, media horaria — NO la ráfaga
    horasSeguidas: 1
  };

  /* Para marcar en el correo la marejada y la visibilidad cuando pasan del
     umbral de operación. No disparan nada: deciden si la cifra va dicha a
     secas o con un «sobre el umbral» al lado. Salen de los umbrales del
     tablero para no inventar un segundo juego de números. */
  function umbralesPuerto(){
    var u = (CLIMA && CLIMA.UMBRALES) || {};
    return {ola: u.olaAviso, visibilidad: u.visibilidadAviso};
  }

  function redondear(v){ return Math.round(v * 10) / 10; }

  /**
   * ¿Esta hora está fuera de rango?
   *
   * Solo el viento sostenido decide. La ráfaga, la marejada y la visibilidad
   * se leen y se informan, pero ninguna manda un correo por su cuenta.
   */
  function evaluarHora(p, umbral){
    umbral = umbral || UMBRAL;
    return {fuera: umbral.vientoSostenido != null && p.viento != null &&
                   p.viento >= umbral.vientoSostenido};
  }

  /**
   * Tramos seguidos de horas fuera de rango dentro de la ventana.
   *
   * Lo que convierte un pico en un aviso es que se sostenga: una hora
   * aislada sobre el umbral entre horas tranquilas no es una condición, es
   * el modelo moviéndose. Se cortan los tramos y se descarta el que no
   * llegue a `horasSeguidas`.
   */
  function rachas(serie, opciones){
    opciones = opciones || {};
    var umbral = opciones.umbral || UMBRAL;
    var minimo = umbral.horasSeguidas || 1;
    var desde = opciones.ahora ? new Date(opciones.ahora) : new Date();
    var hasta = new Date(desde.getTime() + (opciones.horas || HORAS) * 3600000);

    var out = [], actual = null;
    (serie || []).forEach(function(p){
      if(!p.hora || p.hora < desde || p.hora > hasta) return;
      var e = evaluarHora(p, umbral);
      if(!e.fuera){ actual = null; return; }
      if(!actual){
        actual = {desdeIso: p.iso, hastaIso: p.iso, horas: 0,
                  maxViento: 0, maxRafaga: 0, maxOla: 0, minVis: null,
                  motivos: []};
        out.push(actual);
      }
      actual.hastaIso = p.iso;
      actual.horas++;
      if(p.viento != null && p.viento > actual.maxViento) actual.maxViento = p.viento;
      if(p.rafaga != null && p.rafaga > actual.maxRafaga) actual.maxRafaga = p.rafaga;
      if(p.ola != null && p.ola > actual.maxOla) actual.maxOla = p.ola;
      if(p.visibilidad != null && (actual.minVis === null || p.visibilidad < actual.minVis)){
        actual.minVis = p.visibilidad;
      }
    });

    /* El motivo se arma al final con el extremo del tramo. Tomarlo de la
       primera hora dejaba el asunto diciendo 21 kn y el cuerpo 22: la misma
       condición contada de dos maneras. */
    return out.filter(function(r){ return r.horas >= minimo; }).map(function(r){
      r.motivos = ["viento sostenido " + redondear(r.maxViento) + " kn"];
      delete r.causas;
      return r;
    });
  }

  /**
   * El estado de la ventana: fuera de rango o no, y el primer tramo que lo
   * provoca. El primero y no el peor: lo que hay que comunicar es cuándo
   * empieza, porque es lo que da o quita margen para decidir.
   */
  function peorEnVentana(serie, opciones){
    opciones = opciones || {};
    var rs = rachas(serie, opciones);
    var primera = rs[0] || null;
    return {
      fuera: !!primera,
      nivel: primera ? "fuera" : "ok",      // dos estados: se cruza o no
      motivos: primera ? primera.motivos : [],
      desdeIso: primera ? primera.desdeIso : "",
      hastaIso: primera ? primera.hastaIso : "",
      horasSeguidas: primera ? primera.horas : 0,
      maxViento: primera ? primera.maxViento : 0,
      maxRafaga: primera ? primera.maxRafaga : 0,
      /* Como dato para el correo: no disparan, pero cambian lo que se
         decide con el aviso en la mano. */
      maxOla: primera ? primera.maxOla : 0,
      minVis: primera ? primera.minVis : null,
      horasFuera: rs.reduce(function(a, r){ return a + r.horas; }, 0),
      tramos: rs.length
    };
  }

  /**
   * ¿Hay que mandar correo?
   *
   * Sin estado anterior —la primera corrida, o después de que se pierda el
   * guardado— se avisa solo si la condición está fuera de rango. Arrancar
   * mandando un «todo en orden» que nadie pidió enseña a ignorar el remitente.
   */
  function cruce(anterior, actual){
    var ahora = (actual && actual.nivel === "fuera") ? "fuera" : "ok";
    var antes = (anterior && (anterior.nivel === "fuera" || anterior.nivel === "ok"))
      ? anterior.nivel : null;
    if(antes === null){
      return ahora === "ok"
        ? {avisar: false, tipo: "sin-cambio", antes: null, ahora: ahora}
        : {avisar: true, tipo: "entra", antes: null, ahora: ahora};
    }
    if(antes === ahora) return {avisar: false, tipo: "sin-cambio", antes: antes, ahora: ahora};
    return {avisar: true, tipo: ahora === "fuera" ? "entra" : "vuelve",
            antes: antes, ahora: ahora};
  }

  /** «mar 14 oct, 18:00», en la hora del terminal. */
  function cuando(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ""));
    if(!m) return "";
    var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    var MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return DIAS[d.getDay()] + " " + (+m[3]) + " " + MES[+m[2] - 1] + ", " +
           m[4] + ":" + m[5];
  }

  /**
   * El correo. Asunto corto y cuerpo sin adornos: se lee en el teléfono, de
   * noche, para decidir si hay que llamar a alguien.
   */
  function mensaje(c, actual, opciones){
    opciones = opciones || {};
    var umbral = opciones.umbral || UMBRAL;
    var puerto = opciones.puerto || (CLIMA.PUERTO && CLIMA.PUERTO.nombre) || "el terminal";
    var motivos = (actual && actual.motivos || []).join(" · ");

    var asunto = c.tipo === "vuelve"
      ? "[PPT] Pronóstico dentro de rango otra vez"
      : "[PPT] Viento sobre umbral" + (motivos ? " — " + motivos : "");

    var lineas = [];
    if(c.tipo === "vuelve"){
      lineas.push("El pronóstico vuelve a estar dentro de rango en " + puerto + ".");
    }else{
      lineas.push("El pronóstico sale de rango en " + puerto + ".");
      if(motivos) lineas.push("Motivo: " + motivos + ".");
      if(actual && actual.desdeIso){
        lineas.push("Desde: " + cuando(actual.desdeIso) +
          (actual.horasSeguidas ? " · " + actual.horasSeguidas +
            (actual.horasSeguidas === 1 ? " hora seguida" : " horas seguidas") : "") + ".");
      }
      if(actual && actual.maxViento){
        lineas.push("Máximo sostenido en el tramo: " + redondear(actual.maxViento) + " kn" +
          (actual.maxRafaga ? " (ráfagas de hasta " + redondear(actual.maxRafaga) +
            " kn, que no disparan el aviso)" : "") + ".");
      }
      /* La mar y la visibilidad del tramo, como dato. No disparan el aviso
         —el aviso es de viento— pero cambian lo que se decide: no es lo
         mismo 21 nudos con mar llana que con 2,5 m de marejada. */
      var up = umbralesPuerto();
      var ctx = [];
      if(actual && actual.maxOla){
        ctx.push("marejada hasta " + actual.maxOla.toFixed(1).replace(".", ",") + " m" +
          (up.ola != null && actual.maxOla >= up.ola ? " (sobre el umbral del puerto)" : ""));
      }
      if(actual && actual.minVis != null){
        ctx.push("visibilidad mínima " + Math.round(actual.minVis) + " m" +
          (up.visibilidad != null && actual.minVis <= up.visibilidad
            ? " (bajo el umbral del puerto)" : ""));
      }
      if(ctx.length) lineas.push("En el tramo: " + ctx.join(" · ") + ".");
      if(actual && actual.horasFuera > (actual.horasSeguidas || 0)){
        lineas.push("Horas fuera de rango en las próximas " +
          (opciones.horas || HORAS) + ": " + actual.horasFuera +
          " en " + actual.tramos + " tramos.");
      }
    }
    /* De dónde sale y con qué regla: un aviso automático sin procedencia no
       se puede contrastar ni discutir. */
    lineas.push("");
    lineas.push("Regla: viento sostenido de " + umbral.vientoSostenido + " kn o más durante " +
      (umbral.horasSeguidas || 1) +
      ((umbral.horasSeguidas || 1) === 1 ? " hora seguida" : " horas seguidas") +
      ". Las ráfagas, la marejada y la visibilidad NO disparan el aviso: se informan.");
    lineas.push("Pronóstico de Open-Meteo para el sitio de atraque. El límite de operación " +
      "del terminal son 20 kn: este aviso llega antes, para que quede margen de decisión.");
    lineas.push("Se manda al cruzar el umbral, no mientras dure la condición.");

    return {asunto: asunto, texto: lineas.join("\n"), nivel: c.ahora, tipo: c.tipo};
  }

  /** Lo que se guarda entre corridas para saber si hubo cruce. */
  function estadoAGuardar(actual, ahora){
    return {
      nivel: (actual && actual.nivel === "fuera") ? "fuera" : "ok",
      motivos: (actual && actual.motivos) || [],
      desdeIso: (actual && actual.desdeIso) || "",
      revisadoEn: new Date(ahora || Date.now()).toISOString()
    };
  }

  var api = {HORAS: HORAS, UMBRAL: UMBRAL,
             evaluarHora: evaluarHora, rachas: rachas, peorEnVentana: peorEnVentana,
             cruce: cruce, mensaje: mensaje, estadoAGuardar: estadoAGuardar, cuando: cuando};
  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Alerta = api;

})(typeof window !== "undefined" ? window : globalThis);
