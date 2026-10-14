/**
 * Cuándo avisar por correo de una condición fuera de rango, y qué decir.
 *
 * Decide, no envía: todo lo que toca la red vive en scripts/alerta-clima.js,
 * y acá queda lo que se puede probar sin pedirle nada a nadie.
 *
 * La regla es avisar al CRUZAR el umbral, no mientras se esté fuera de él.
 * Un correo por revisión con viento sobre 20 nudos durante dos días son
 * cuarenta correos iguales, y a los tres primeros nadie los abre. Lo que
 * cambia la decisión del turno es el momento en que el puerto pasa de
 * operable a no operable, y el momento en que vuelve.
 *
 * Los umbrales son los mismos de la aplicación —los de js/clima.js— y se
 * evalúan con la misma función. Dos definiciones de «fuera de rango», una
 * en la pantalla y otra en el correo, terminan discrepando el día que
 * alguien ajuste una y no la otra.
 */
(function(global){
  "use strict";

  var CLIMA = (typeof module === "object" && module.exports)
    ? require("./clima.js") : global.Clima;

  /* Mirar solo la hora actual avisa tarde: el turno necesita saber lo que
     viene para decidir si alcanza a terminar el embarque. Un día es el
     horizonte en que el pronóstico todavía es útil y el aviso accionable. */
  var HORAS = 24;

  var ORDEN = {ok: 0, aviso: 1, alerta: 2};

  /**
   * El peor nivel que trae la ventana, con la hora en que empieza y por qué.
   *
   * Se queda con el peor y no con el primero: si en las próximas 24 h hay
   * una hora con restricción y otra de cierre, lo que hay que comunicar es
   * el cierre.
   */
  function peorEnVentana(serie, opciones){
    opciones = opciones || {};
    var horas = opciones.horas || HORAS;
    var umbrales = opciones.umbrales || CLIMA.UMBRALES;
    var desde = opciones.ahora ? new Date(opciones.ahora) : new Date();
    var hasta = new Date(desde.getTime() + horas * 3600000);

    var peor = {nivel: "ok", motivos: [], desdeIso: "", horasFuera: 0, puntos: 0};
    (serie || []).forEach(function(p){
      if(!p.hora || p.hora < desde || p.hora > hasta) return;
      peor.puntos++;
      var e = CLIMA.evaluar(p, umbrales);
      if(e.nivel !== "ok") peor.horasFuera++;
      if(ORDEN[e.nivel] > ORDEN[peor.nivel]){
        peor.nivel = e.nivel;
        peor.motivos = e.motivos;
        peor.desdeIso = p.iso;
      }
    });
    return peor;
  }

  /**
   * ¿Hay que mandar correo?
   *
   * Sin estado anterior —la primera corrida, o después de que se pierda el
   * guardado— se avisa solo si la condición está fuera de rango. Arrancar
   * mandando un «todo en orden» que nadie pidió enseña a ignorar el remitente.
   */
  function cruce(anterior, actual){
    var antes = (anterior && ORDEN[anterior.nivel] != null) ? anterior.nivel : null;
    var ahora = actual && actual.nivel ? actual.nivel : "ok";
    if(antes === null){
      return ahora === "ok"
        ? {avisar: false, tipo: "sin-cambio", antes: null, ahora: ahora}
        : {avisar: true, tipo: "entra", antes: null, ahora: ahora};
    }
    if(antes === ahora) return {avisar: false, tipo: "sin-cambio", antes: antes, ahora: ahora};
    var tipo = ahora === "ok" ? "vuelve"
      : antes === "ok" ? "entra"
      : ORDEN[ahora] > ORDEN[antes] ? "empeora" : "mejora";
    return {avisar: true, tipo: tipo, antes: antes, ahora: ahora};
  }

  function dosDigitos(n){ return String(n).padStart(2, "0"); }

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
    var puerto = opciones.puerto || (CLIMA.PUERTO && CLIMA.PUERTO.nombre) || "el terminal";
    var est = CLIMA.estadoPuerto(c.ahora);
    var antes = c.antes ? CLIMA.estadoPuerto(c.antes) : null;
    var motivos = (actual && actual.motivos || []).join(" · ");

    var asunto = c.tipo === "vuelve"
      ? "[PPT] Puerto operable otra vez"
      : "[PPT] " + est.rotulo + (motivos ? " — " + motivos : "");

    var lineas = [];
    lineas.push(c.tipo === "vuelve"
      ? "El pronóstico vuelve a estar dentro de rango en " + puerto + "."
      : "El pronóstico da " + est.rotulo.toLowerCase() + " en " + puerto + ".");
    if(c.tipo !== "vuelve"){
      if(motivos) lineas.push("Motivo: " + motivos + ".");
      if(actual && actual.desdeIso) lineas.push("Desde: " + cuando(actual.desdeIso) + ".");
      if(actual && actual.horasFuera){
        lineas.push("Horas fuera de rango en las próximas " +
          (opciones.horas || HORAS) + ": " + actual.horasFuera + ".");
      }
    }
    if(antes) lineas.push("Antes: " + antes.rotulo.toLowerCase() + ".");
    /* De dónde sale, siempre: un aviso automático sin procedencia no se
       puede contrastar ni discutir. */
    lineas.push("");
    lineas.push("Pronóstico de Open-Meteo para " + puerto + ". Los umbrales son los " +
      "mismos del tablero: viento 20/25 kn, ráfaga 30 kn, marejada 2,0/2,5 m, " +
      "visibilidad 2.000/1.000 m.");
    lineas.push("Este aviso se manda al cruzar el umbral, no mientras dure la condición.");

    return {asunto: asunto, texto: lineas.join("\n"), nivel: c.ahora, tipo: c.tipo};
  }

  /** Lo que se guarda entre corridas para saber si hubo cruce. */
  function estadoAGuardar(actual, ahora){
    return {
      nivel: (actual && actual.nivel) || "ok",
      motivos: (actual && actual.motivos) || [],
      desdeIso: (actual && actual.desdeIso) || "",
      revisadoEn: new Date(ahora || Date.now()).toISOString()
    };
  }

  var api = {HORAS: HORAS, peorEnVentana: peorEnVentana, cruce: cruce,
             mensaje: mensaje, estadoAGuardar: estadoAGuardar, cuando: cuando};
  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Alerta = api;

})(typeof window !== "undefined" ? window : globalThis);
