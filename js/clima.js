/**
 * Condiciones meteorológicas y marinas de Punta Totoralillo.
 *
 * Los datos vienen de Open-Meteo: es gratis, no pide clave y responde con
 * CORS, así que el navegador consulta directo sin servidor de por medio.
 * No reemplaza a Windy para mirar el mapa; lo que hace es traer los números
 * y compararlos contra los umbrales de operación para levantar alertas.
 *
 * La evaluación va separada de la red para poder probarla sin internet.
 */
(function(global){
  "use strict";

  /* Puerto Punta Totoralillo: 26°50'52"S 70°48'53"W, el sitio de atraque.
     Es DONDE ESTÁ LA NAVE, que es donde se mide: el viento que detiene el
     embarque es el del shiploader y el costado del buque, no el de tierra
     adentro.

     Dos correcciones anteriores, para que nadie las repita. El primer valor
     —27,03 / 70,85— caía unos 20 km al sur, casi sobre Caldera, y devolvía
     el viento de otra bahía. El segundo —26,8547— era el punto que devuelve
     Windy al buscar el terminal por nombre, pero ése cae en tierra, en
     medio del área de proceso, 770 m al sur del sitio: cerro y terreno de
     por medio alteran el viento justo en lo que se quiere medir. */
  var PUERTO = {
    nombre: "Puerto Punta Totoralillo",
    lat: -26.8478, lon: -70.8147,
    /* La marejada se pide mar adentro, a la misma latitud del sitio: el
       modelo marino solo responde en celdas de mar, y tan pegado a la costa
       la celda puede ser de tierra y volver vacía. Son unas 3,5 millas al
       oeste, que es de donde le llega la marejada al terminal. */
    latMar: -26.8478, lonMar: -70.8800,
    zona: "America/Santiago"
  };

  /* Umbrales de operación. El de viento es el que rige en el terminal: sobre
     20 nudos se detiene el embarque, y así aparece en las observaciones del
     RTE ("Viento sobre 20 Nudos"). */
  var UMBRALES = {
    vientoAviso: 20,        // nudos sostenidos: se detiene el embarque
    vientoAlerta: 25,       // nudos sostenidos: condición severa
    rafagaAlerta: 30,       // nudos en ráfaga
    olaAviso: 2.0,          // metros de altura significativa
    olaAlerta: 2.5,
    visibilidadAviso: 2000, // metros
    visibilidadAlerta: 1000
  };

  var API = "https://api.open-meteo.com/v1/forecast";
  var API_MAR = "https://marine-api.open-meteo.com/v1/marine";

  /* ──────────────────────────── URLs ───────────────────────────── */

  function urlPronostico(p, dias){
    p = p || PUERTO;
    return API + "?latitude=" + p.lat + "&longitude=" + p.lon +
      "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility" +
      "&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m" +
      "&wind_speed_unit=kn&timezone=" + encodeURIComponent(p.zona || "auto") +
      "&forecast_days=" + (dias || 3);
  }

  function urlMarino(p, dias){
    p = p || PUERTO;
    return API_MAR + "?latitude=" + (p.latMar != null ? p.latMar : p.lat) +
      "&longitude=" + (p.lonMar != null ? p.lonMar : p.lon) +
      "&hourly=wave_height,wave_period,swell_wave_height" +
      "&timezone=" + encodeURIComponent(p.zona || "auto") +
      "&forecast_days=" + (dias || 3);
  }

  /* ───────────────────── armado de la serie ────────────────────── */

  function aFecha(iso){
    // Open-Meteo entrega hora local sin zona: "2026-09-09T14:00".
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ""));
    return m ? new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]) : null;
  }

  /**
   * Une el pronóstico atmosférico con el marino en una sola serie horaria.
   * El marino puede faltar (la API marina no cubre todos los puntos): en ese
   * caso la serie sigue, sin datos de ola, y las alertas lo dicen.
   */
  function combinar(pron, mar){
    var h = (pron && pron.hourly) || {};
    var tiempos = h.time || [];
    var olas = {}, periodos = {};
    if(mar && mar.hourly && mar.hourly.time){
      mar.hourly.time.forEach(function(t, i){
        olas[t] = mar.hourly.wave_height ? mar.hourly.wave_height[i] : null;
        periodos[t] = mar.hourly.wave_period ? mar.hourly.wave_period[i] : null;
      });
    }
    return tiempos.map(function(t, i){
      return {
        iso: t,
        hora: aFecha(t),
        viento: num(h.wind_speed_10m, i),
        rafaga: num(h.wind_gusts_10m, i),
        direccion: num(h.wind_direction_10m, i),
        visibilidad: num(h.visibility, i),
        ola: olas[t] == null ? null : olas[t],
        periodo: periodos[t] == null ? null : periodos[t]
      };
    }).filter(function(p){ return p.hora; });
  }

  function num(arr, i){
    var v = arr ? arr[i] : null;
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  /* ───────────────────────── evaluación ────────────────────────── */

  /** Nivel de una hora concreta: ok | aviso | alerta, con sus motivos. */
  function evaluar(p, u){
    u = u || UMBRALES;
    var motivos = [], nivel = "ok";
    function subir(n){ if(n === "alerta" || nivel === "ok") nivel = n; }

    if(p.viento != null){
      if(p.viento >= u.vientoAlerta){ subir("alerta"); motivos.push("viento " + redondear(p.viento) + " kn"); }
      else if(p.viento >= u.vientoAviso){ subir("aviso"); motivos.push("viento " + redondear(p.viento) + " kn"); }
    }
    if(p.rafaga != null && p.rafaga >= u.rafagaAlerta){
      subir("alerta"); motivos.push("ráfagas " + redondear(p.rafaga) + " kn");
    }
    if(p.ola != null){
      if(p.ola >= u.olaAlerta){ subir("alerta"); motivos.push("marejada " + p.ola.toFixed(1) + " m"); }
      else if(p.ola >= u.olaAviso){ subir("aviso"); motivos.push("marejada " + p.ola.toFixed(1) + " m"); }
    }
    if(p.visibilidad != null){
      if(p.visibilidad <= u.visibilidadAlerta){ subir("alerta"); motivos.push("visibilidad " + Math.round(p.visibilidad) + " m"); }
      else if(p.visibilidad <= u.visibilidadAviso){ subir("aviso"); motivos.push("visibilidad " + Math.round(p.visibilidad) + " m"); }
    }
    return {nivel: nivel, motivos: motivos};
  }

  function redondear(v){ return Math.round(v * 10) / 10; }

  /**
   * Los tres estados del puerto, con sus palabras en un solo lugar.
   *
   * El nivel que calcula `evaluar` es interno —ok / aviso / alerta— y se
   * pintaba en cuatro sitios distintos con palabras distintas: ABIERTO y
   * DETENIDO en la cifra grande, «Opera» y «Detiene» en la tabla, y nada en
   * las ventanas de alerta. Tres nombres para lo mismo obligan a traducir
   * mentalmente en cada panel.
   *
   * La correspondencia sale de los propios umbrales:
   *   ok      todo bajo los umbrales de aviso          -> ABIERTO
   *   aviso   viento 20 kn, marejada 2,0 m, vis. 2 km  -> CON RESTRICCIÓN
   *   alerta  viento 25 kn, ráfaga 30, ola 2,5, 1 km   -> CERRADO
   *
   * A 20 nudos el embarque se detiene pero la nave sigue amarrada: eso es
   * una restricción. Sobre 25, o con 2,5 m de marejada, la nave puede tener
   * que salir del sitio, y eso es un cierre.
   */
  var ESTADOS = {
    ok:     {clave:"abierto",     titulo:"ABIERTO",         rotulo:"Puerto abierto",         corto:"Abierto"},
    aviso:  {clave:"restringido", titulo:"CON RESTRICCIÓN", rotulo:"Puerto con restricción", corto:"Restringido"},
    alerta: {clave:"cerrado",     titulo:"CERRADO",         rotulo:"Puerto cerrado",         corto:"Cerrado"}
  };

  /** Estado del puerto para un nivel de `evaluar`. Ante algo desconocido, abierto. */
  function estadoPuerto(nivel){
    return ESTADOS[nivel] || ESTADOS.ok;
  }

  /**
   * Agrupa horas consecutivas con condición adversa en ventanas.
   * Una lista de 72 horas sueltas no se lee; "mañana de 14:00 a 21:00, viento
   * hasta 27 kn" sí.
   */
  function ventanas(serie, u){
    u = u || UMBRALES;
    var salida = [], actual = null;
    (serie || []).forEach(function(p){
      var e = evaluar(p, u);
      if(e.nivel === "ok"){
        if(actual){ salida.push(cerrar(actual)); actual = null; }
        return;
      }
      if(!actual){
        actual = {desde: p.hora, hasta: p.hora, nivel: e.nivel, puntos: [p], motivos: {}};
      }else{
        actual.hasta = p.hora;
        actual.puntos.push(p);
        if(e.nivel === "alerta") actual.nivel = "alerta";
      }
      e.motivos.forEach(function(m){ actual.motivos[m.split(" ")[0]] = true; });
    });
    if(actual) salida.push(cerrar(actual));
    return salida;
  }

  function cerrar(v){
    var vientos = v.puntos.map(function(p){ return p.viento; }).filter(function(x){ return x != null; });
    var rafagas = v.puntos.map(function(p){ return p.rafaga; }).filter(function(x){ return x != null; });
    var olas = v.puntos.map(function(p){ return p.ola; }).filter(function(x){ return x != null; });
    // La última hora marcada dura hasta el final de esa hora.
    var fin = new Date(v.hasta.getTime() + 3600000);
    return {
      desde: v.desde, hasta: fin, nivel: v.nivel,
      horas: v.puntos.length,
      vientoMax: vientos.length ? Math.max.apply(null, vientos) : null,
      rafagaMax: rafagas.length ? Math.max.apply(null, rafagas) : null,
      olaMax: olas.length ? Math.max.apply(null, olas) : null,
      causas: Object.keys(v.motivos)
    };
  }

  /** Horas seguidas operables desde ahora: cuánto queda antes del próximo cierre. */
  function ventanaOperativa(serie, u, desde){
    u = u || UMBRALES;
    desde = desde || new Date();
    var futuras = (serie || []).filter(function(p){ return p.hora >= desde; });
    var horas = 0;
    for(var i = 0; i < futuras.length; i++){
      if(evaluar(futuras[i], u).nivel !== "ok") break;
      horas++;
    }
    return {horas: horas, hasta: horas ? new Date(futuras[horas-1].hora.getTime() + 3600000) : null,
            operableAhora: futuras.length ? evaluar(futuras[0], u).nivel === "ok" : null};
  }

  /** 210° → "SSW". Ocho rumbos bastan para leer de un vistazo. */
  function rumbo(grados){
    if(grados == null) return "";
    var r = ["N","NE","E","SE","S","SW","W","NW"];
    return r[Math.round(((grados % 360) / 45)) % 8];
  }

  /* ──────────────────────────── red ────────────────────────────── */

  function consultar(p, dias){
    var puerto = p || PUERTO;
    return Promise.all([
      fetch(urlPronostico(puerto, dias)).then(exigirOk("pronóstico")),
      fetch(urlMarino(puerto, dias)).then(exigirOk("datos marinos")).catch(function(){ return null; })
    ]).then(function(r){
      var serie = combinar(r[0], r[1]);
      if(!serie.length) throw new Error("La respuesta no trae horas de pronóstico.");
      return {
        serie: serie,
        actual: (r[0] && r[0].current) || null,
        conMar: !!(r[1] && r[1].hourly),
        consultadoEn: new Date()
      };
    });
  }

  function exigirOk(que){
    return function(res){
      if(!res.ok) throw new Error("No se pudo obtener el " + que + " (HTTP " + res.status + ").");
      return res.json();
    };
  }

  var api = {
    ESTADOS: ESTADOS, estadoPuerto: estadoPuerto,
    PUERTO: PUERTO, UMBRALES: UMBRALES,
    urlPronostico: urlPronostico, urlMarino: urlMarino,
    combinar: combinar, evaluar: evaluar, ventanas: ventanas,
    ventanaOperativa: ventanaOperativa, rumbo: rumbo, consultar: consultar
  };
  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Clima = api;

})(typeof window !== "undefined" ? window : globalThis);
