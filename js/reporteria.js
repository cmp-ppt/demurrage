/**
 * Lector del libro "Reportería Demurrages <año> PUNTA TOTORALILLO".
 *
 * Es el registro comercial de la temporada: una fila por recalada con el
 * demurrage o despatch ya liquidado, más las hojas de apoyo que explican de
 * dónde salió cada cifra. No lo recalcula: lo lee. El motor de laytime de esta
 * app sirve para armar el time sheet de UNA recalada con el RTE del terminal;
 * este libro trae lo que se acordó con el armador, que es otra cosa y manda.
 *
 * Hojas que se usan:
 *   PUNTA TOTORALILLO          una fila por recalada, con demurrage/despatch
 *   Ops time VS Time allowed   espera antes del amarre vs operación de carga
 *   Delays                     cada detención con su categoría, días y costo
 *   Weather Cause              días perdidos por causa climática y trimestre
 *   Plan de embarque           laycan de las recaladas que vienen
 *
 * Defensivo a propósito: si una hoja falta o cambia de forma, devuelve lo que
 * pudo leer y un aviso, en vez de fallar. El libro lo mantienen personas.
 */
(function(global){
  "use strict";

  function normalizar(t){
    return String(t == null ? "" : t)
      .normalize("NFD").replace(/[̀-ͯ]/g,"")
      .toLowerCase().replace(/\s+/g," ").trim();
  }

  function hoja(libro, nombre){
    var objetivo = normalizar(nombre);
    for(var i=0;i<libro.SheetNames.length;i++){
      if(normalizar(libro.SheetNames[i]) === objetivo) return libro.Sheets[libro.SheetNames[i]];
    }
    return null;
  }

  function letra(i){
    var s = "";
    i = i + 1;
    while(i > 0){
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function celda(ws, ref){
    if(!ws) return null;
    var c = ws[ref];
    return (c && c.v !== undefined) ? c.v : null;
  }

  function texto(ws, col, fila){
    var v = celda(ws, col + fila);
    return v == null ? "" : String(v).trim();
  }

  function numero(v){
    if(v == null || v === "") return null;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/\./g,"").replace(",","."));
    return isNaN(n) ? null : n;
  }

  function num(ws, col, fila){ return numero(celda(ws, col + fila)); }

  /**
   * Celda de fecha (Date o serial de Excel) -> Date local, o null.
   *
   * Se redondea al minuto. El serial de Excel es un flotante y el viaje de
   * ida y vuelta pierde fracciones: 16:06 vuelve como 16:05:59,9. En este
   * libro todas las horas están anotadas al minuto, y un segundo de menos en
   * un ATB se arrastra hasta los días de espera que alimentan el análisis.
   */
  function fecha(ws, col, fila){
    var v = celda(ws, col + fila);
    var d = null;
    if(v instanceof Date) d = v;
    else if(typeof v === "number"){
      d = new Date(Math.round((v - 25569) * 86400000));
      d = new Date(d.getTime() + d.getTimezoneOffset()*60000);
    }
    if(!d || isNaN(d.getTime())) return null;
    return new Date(Math.round(d.getTime() / 60000) * 60000);
  }

  /** Última fila usada de la hoja, según su rango declarado. */
  function ultimaFila(ws, tope){
    if(!ws || !ws["!ref"]) return 0;
    var m = /:([A-Z]+)(\d+)$/.exec(String(ws["!ref"]).toUpperCase());
    return m ? Math.min(+m[2], tope || 5000) : 0;
  }

  var TRIMESTRES = {Q1:true, Q2:true, Q3:true, Q4:true};
  function trimestre(v){
    var t = String(v == null ? "" : v).trim().toUpperCase();
    return TRIMESTRES[t] ? t : null;
  }

  /** El trimestre de calendario de una fecha: Q1 enero-marzo … Q4 octubre-diciembre. */
  function trimestreDeFecha(d){
    var f = (d instanceof Date) ? d : new Date(d);
    return isNaN(f) ? null : "Q" + (Math.floor(f.getMonth() / 3) + 1);
  }

  /**
   * Recaladas cuyo trimestre declarado no cuadra con NINGUNA de sus fechas.
   *
   * Se exige que todos los hitos caigan en el mismo trimestre antes de
   * reclamar: una nave que atraca el 29 de septiembre y termina de cargar el
   * 2 de octubre cruza el corte de verdad, y el libro puede ponerla en
   * cualquiera de los dos con razón. Avisar ahí sería ruido, y un aviso que
   * se equivoca se deja de leer.
   */
  function desencajadas(recaladas){
    var HITOS = ["laycanDesde", "laycanHasta", "eta", "nor", "atb", "inicioCarga", "finCarga"];
    return (recaladas || []).map(function(r){
      if(!r.trimestre) return null;
      var qs = {}, fechas = [];
      HITOS.forEach(function(k){
        var q = r[k] ? trimestreDeFecha(r[k]) : null;
        if(q){ qs[q] = true; fechas.push(new Date(r[k])); }
      });
      var claves = Object.keys(qs);
      if(claves.length !== 1 || claves[0] === r.trimestre) return null;
      fechas.sort(function(a, b){ return a - b; });
      var iso = function(f){ return f.toISOString().slice(0, 10); };
      return {nave: r.nave, declarado: r.trimestre, porFecha: claves[0],
              desde: iso(fechas[0]), hasta: iso(fechas[fechas.length - 1])};
    }).filter(Boolean);
  }

  /* ─────────────────── una fila por recalada ─────────────────── */

  function leerRecaladas(ws){
    var out = [];
    if(!ws) return out;
    var fin = ultimaFila(ws, 400);
    for(var f = 2; f <= fin; f++){
      var q = trimestre(celda(ws, "A" + f));
      var nave = texto(ws, "B", f);
      if(!q || !nave) continue;
      out.push({
        trimestre: q,
        nave: nave,
        inco: texto(ws, "C", f),
        producto: texto(ws, "D", f),
        laycanDesde: fecha(ws, "E", f),
        laycanHasta: fecha(ws, "F", f),
        eta: fecha(ws, "G", f),
        nor: fecha(ws, "H", f),
        cargo: num(ws, "I", f),
        atb: fecha(ws, "J", f),
        inicioCarga: fecha(ws, "K", f),
        finCarga: fecha(ws, "L", f),
        rate: num(ws, "M", f),
        // Demurrage y despatch viven en columnas distintas y nunca coexisten:
        // el despatch viene con signo negativo en el libro.
        demurrage: num(ws, "N", f) || 0,
        despatch: num(ws, "O", f) || 0,
        comentario: texto(ws, "P", f)
      });
    }
    return out;
  }

  /* ──────── espera antes del amarre vs operación de carga ────── */

  function leerTiempos(ws){
    var out = [];
    if(!ws) return out;
    var fin = ultimaFila(ws, 400);
    for(var f = 5; f <= fin; f++){
      var q = trimestre(celda(ws, "A" + f));
      var nave = texto(ws, "B", f);
      if(!q || !nave) continue;
      out.push({
        trimestre: q,
        nave: nave,
        nor: fecha(ws, "C", f),
        esperaAmarre: num(ws, "E", f) || 0,
        malTiempo: num(ws, "F", f) || 0,
        operacionCarga: num(ws, "G", f) || 0,
        tasaDiaria: num(ws, "H", f),
        tasaContrato: num(ws, "I", f),
        timeAllowed: num(ws, "J", f) || 0,
        netTimeUsed: num(ws, "K", f) || 0,
        esperaNorAmarre: num(ws, "L", f) || 0
      });
    }
    return out;
  }

  /* ─────────────── cada detención, con su categoría ──────────── */

  function leerDetenciones(ws){
    var out = [];
    if(!ws) return out;
    var fin = ultimaFila(ws, 5000);
    var ultimoQ = null, ultimaNave = null;
    for(var f = 3; f <= fin; f++){
      // La hoja repite la nave solo en su primera fila: las siguientes quedan
      // en blanco y heredan. Sin arrastrar el último valor, cada detención
      // salvo la primera quedaría sin nave ni trimestre.
      var q = trimestre(celda(ws, "A" + f));
      var nave = texto(ws, "B", f);
      if(q) ultimoQ = q;
      if(nave) ultimaNave = nave;
      var categoria = texto(ws, "K", f);
      if(!categoria || !ultimoQ) continue;
      out.push({
        trimestre: ultimoQ,
        nave: ultimaNave || "",
        categoria: categoria,
        inicio: fecha(ws, "L", f),
        fin: fecha(ws, "M", f),
        rate: num(ws, "N", f),
        dias: num(ws, "O", f) || 0,
        costo: num(ws, "P", f) || 0,
        detalleSof: texto(ws, "Q", f),
        comentarioTerminal: texto(ws, "R", f),
        observacion: texto(ws, "S", f)
      });
    }
    return out;
  }

  /* ───────────── días perdidos por causa climática ───────────── */

  /**
   * La hoja arma tres bloques lado a lado —Q1 en A/B, Q2 en D/E, Q3 en G/H—,
   * cada uno con las causas en una columna y los días en la siguiente.
   * "Sin detención" es el complemento del trimestre, no una causa: se omite.
   */
  function leerClima(ws){
    var out = [];
    if(!ws) return out;
    var bloques = [["A","B","Q1"], ["D","E","Q2"], ["G","H","Q3"]];
    bloques.forEach(function(b){
      for(var f = 14; f <= 19; f++){
        var causa = texto(ws, b[0], f);
        var dias = num(ws, b[1], f);
        if(!causa || dias == null) continue;
        if(normalizar(causa).indexOf("sin detencion") === 0) continue;
        out.push({trimestre: b[2], causa: causa, dias: dias});
      }
    });
    return out;
  }

  /* ──────────────── laycan de lo que viene ───────────────────── */

  /**
   * El plan trae dos bloques: el vigente y una versión anterior. Se lee el que
   * arranca más abajo, que es el actualizado, y si no está, el de arriba.
   */
  function leerPlan(ws){
    if(!ws) return [];
    var fin = ultimaFila(ws, 200);
    var cabeceras = [];
    for(var f = 1; f <= fin; f++){
      if(normalizar(celda(ws, "B" + f)) === "trimestre") cabeceras.push(f);
    }
    if(!cabeceras.length) return [];
    var desde = cabeceras[cabeceras.length - 1] + 1;
    var out = [];
    for(var r = desde; r <= fin; r++){
      var q = trimestre(celda(ws, "B" + r));
      var nave = texto(ws, "J", r);
      if(!q || !nave) continue;
      out.push({
        trimestre: q,
        mes: texto(ws, "C", r),
        puerto: texto(ws, "D", r),
        laycanDesde: fecha(ws, "E", r),
        laycanHasta: fecha(ws, "F", r),
        eta: fecha(ws, "G", r),
        etb: fecha(ws, "H", r),
        etd: fecha(ws, "I", r),
        nave: nave,
        inco: texto(ws, "K", r),
        contrato: texto(ws, "L", r),
        destino: texto(ws, "M", r),
        producto: texto(ws, "N", r),
        tonelaje: num(ws, "Q", r)
      });
    }
    return out;
  }

  /* ───────────────────── punto de entrada ────────────────────── */

  function desdeLibro(libro){
    var avisos = [];
    var hRecaladas = hoja(libro, "PUNTA TOTORALILLO");
    var hTiempos   = hoja(libro, "Ops time VS Time allowed");
    var hDelays    = hoja(libro, "Delays");
    var hClima     = hoja(libro, "Weather Cause");
    var hPlan      = hoja(libro, "Plan de embarque");

    if(!hRecaladas) avisos.push("No se encontró la hoja PUNTA TOTORALILLO: sin ella no hay temporada que mostrar.");
    if(!hTiempos)   avisos.push("No se encontró «Ops time VS Time allowed»: no se puede separar la espera de la operación de carga.");
    if(!hDelays)    avisos.push("No se encontró la hoja Delays: las detenciones por categoría quedan vacías.");

    var datos = {
      recaladas:   leerRecaladas(hRecaladas),
      tiempos:     leerTiempos(hTiempos),
      detenciones: leerDetenciones(hDelays),
      clima:       leerClima(hClima),
      plan:        leerPlan(hPlan)
    };

    if(hRecaladas && !datos.recaladas.length){
      avisos.push("La hoja PUNTA TOTORALILLO no trajo ninguna recalada con trimestre y nave.");
    }

    /* El trimestre lo declara la columna A y es la que manda: no se deduce
       de la fecha, porque el libro es lo que se presenta y lo que se audita,
       y una app que «corrige» en silencio deja dos cifras distintas para la
       misma temporada sin que nadie sepa cuál citar.
       Pero cuando no cuadra hay que decirlo. Los trimestres son los del
       calendario —Q1 enero a marzo, Q4 octubre a diciembre— y una recalada
       cuyos hitos caen enteros en otro trimestre del que dice la columna A
       es un error de tipeo en el Excel, no un caso de borde. Pasó: MINERAL
       BOTSWANA, con laycan, NOR, atraque y carga los siete en octubre,
       rotulada Q3. Con eso Q4 no existía en el filtro y la nave entraba en
       los totales del trimestre equivocado. */
    desencajadas(datos.recaladas).forEach(function(d){
      avisos.push("«" + d.nave + "» dice " + d.declarado + " en la columna A, pero sus fechas " +
        "están todas en " + d.porFecha + " (" + d.desde + " a " + d.hasta + "). " +
        "Revisa el trimestre en el libro: así queda contada en el trimestre equivocado.");
    });

    /* Las dos hojas principales describen las mismas recaladas. Si una trae
       naves que la otra no, los promedios de espera salen sobre un universo
       distinto al de los montos, y nadie lo nota mirando el resultado. */
    if(datos.recaladas.length && datos.tiempos.length){
      /* La llave lleva el trimestre, igual que la de trimestres.js. Con el
         nombre solo, una nave que vuelve —NISEKO QUEEN está en Q2 y en Q3—
         daba por cubierto el Q3 porque existía su fila de Q2, y el aviso
         callaba mientras la espera de esa recalada quedaba fuera del total.
         Un aviso que no avisa es peor que no tenerlo. */
      var enTiempos = {};
      datos.tiempos.forEach(function(t){ enTiempos[t.trimestre + "|" + normalizar(t.nave)] = true; });
      var faltan = datos.recaladas.filter(function(r){
        return !enTiempos[r.trimestre + "|" + normalizar(r.nave)];
      });
      if(faltan.length){
        avisos.push("Sin tiempos de espera: " +
          faltan.map(function(r){ return r.nave + " (" + r.trimestre + ")"; }).join(", ") +
          ". Entran en los montos del trimestre pero no en el análisis de espera.");
      }
    }

    return {datos: datos, avisos: avisos};
  }

  var api = {
    trimestreDeFecha: trimestreDeFecha, desencajadas: desencajadas,
    desdeLibro: desdeLibro,
    leerRecaladas: leerRecaladas,
    leerTiempos: leerTiempos,
    leerDetenciones: leerDetenciones,
    leerClima: leerClima,
    leerPlan: leerPlan,
    normalizar: normalizar,
    letra: letra
  };

  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Reporteria = api;

})(typeof window !== "undefined" ? window : globalThis);
