/**
 * Lector de la hoja «ACUMULADO EMBARQUE» de la planilla de turno.
 *
 * Es la tercera fuente de la app, y la única que trae el calado definitivo.
 * El CNN-EMB trae el pesómetro —lo que pasó por la correa— y a veces un
 * calado provisorio; el libro de reportería trae el Bill of Lading. El draft
 * survey final llega acá, en la planilla que el turno llena día a día, y es
 * el que se liquida.
 *
 * La hoja registra el tonelaje embarcado DENTRO de cada mes, abierto por
 * producto: Pellet Feed, Sinter Feed, Concentrado de cobre y MLC. Una misma
 * nave puede aparecer en dos bloques —carga los dos productos— y hay que
 * sumarlos: CHINA TRIUMPH son 135.872 t de pellet feed más 65.022 de sinter
 * feed, y las 200.894 resultantes son exactamente su BL.
 *
 * Y una nave que cruza el fin de mes aparece partida entre dos planillas.
 * MINERAL NAMIBIA son 115.584 t en abril y 89.078 en mayo: 204.662, que es
 * su BL al kilo. Por eso el módulo no decide el total de una nave por su
 * cuenta —no tiene cómo saber si le falta la mitad del mes vecino— y se
 * limita a leer lo que dice cada planilla. Juntar los meses es trabajo de
 * quien tenga las dos a la vista.
 *
 * El concentrado de cobre y el MLC se leen pero se marcan aparte: no están
 * en el libro de demurrage —GINKGO ARROW, GEIYO K, LINDEN ARROW no aparecen
 * en ninguna de sus 32 filas— y sumarlos al embarque de mineral daría un
 * total que no se puede contrastar contra nada.
 */
(function(global){
  "use strict";

  /* Los bloques de la hoja, con el rótulo tal como viene en la columna B.
     `mineral` marca los que entran al embarque que el libro liquida. */
  var BLOQUES = [
    {clave: "pellet",      rotulo: "Pellet Feed",          mineral: true},
    {clave: "sinter",      rotulo: "Sinter Feed",          mineral: true},
    {clave: "concentrado", rotulo: "Concentrado de cobre", mineral: false},
    {clave: "mlc",         rotulo: "MLC",                  mineral: false}
  ];

  function normalizar(t){
    return String(t || "").toUpperCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]+/g, " ").trim();
  }

  /** Nombre de nave en la misma forma que usa la conciliación. */
  function normalizarNave(nave){
    return normalizar(nave).replace(/^(M ?[VN]|MOTONAVE|B ?M)\s+/, "").trim();
  }

  /** Busca una hoja por nombre, sin importar mayúsculas ni acentos. */
  function hoja(libro, nombre){
    if(!libro || !libro.SheetNames) return null;
    var objetivo = normalizar(nombre);
    for(var i = 0; i < libro.SheetNames.length; i++){
      if(normalizar(libro.SheetNames[i]) === objetivo) return libro.Sheets[libro.SheetNames[i]];
    }
    return null;
  }

  function celda(ws, ref){
    var c = ws && ws[ref];
    return c === undefined || c === null ? "" : c.v;
  }
  function numero(v){
    if(typeof v === "number") return isFinite(v) ? v : null;
    var t = String(v || "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
    if(!t) return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }

  /** ¿Esta fila de la columna B abre un bloque de producto? */
  function bloqueDe(texto){
    var t = normalizar(texto);
    if(!t) return null;
    for(var i = 0; i < BLOQUES.length; i++){
      if(t.indexOf(normalizar(BLOQUES[i].rotulo)) === 0) return BLOQUES[i];
    }
    return null;
  }

  /**
   * El mes de la planilla sale del nombre del archivo —DATOS_TURNO_PPT_
   * 30-09-2026— porque la hoja no lo trae escrito en ninguna celda. Se
   * devuelve para que la interfaz lo muestre y la persona confirme: cargar
   * septiembre creyendo que es agosto mueve un embarque entero de mes.
   */
  function mesDeNombre(nombre){
    var m = /(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/.exec(String(nombre || ""));
    if(!m) return null;
    var dia = +m[1], mes = +m[2], anio = +m[3];
    if(mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return {anio: anio, mes: mes - 1, dia: dia};
  }

  /**
   * Lee la hoja entera. Nunca lanza: devuelve los reparos en `avisos`, que
   * es como se comporta el resto de los lectores de la app.
   */
  function desdeLibro(libro, nombreArchivo){
    var avisos = [];
    var ws = hoja(libro, "ACUMULADO EMBARQUE");
    if(!ws){
      avisos.push("No se encontró la hoja «ACUMULADO EMBARQUE» en esta planilla de turno.");
      return {bloques: [], porNave: [], totalMineral: 0, totalOtros: 0,
              periodo: mesDeNombre(nombreArchivo), avisos: avisos};
    }

    /* Se recorre la columna B de arriba abajo: un rótulo de producto abre un
       bloque, «TOTAL» lo cierra, y lo de en medio son naves con su tonelaje
       en la columna E. Leer por posiciones fijas rompería con solo agregar
       una nave, que es lo que pasa cada mes. */
    var ref = ws["!ref"] || "A1:N60";
    var finFila = (/:[A-Z]+(\d+)/.exec(ref) || [0, 60])[1];
    var bloques = [], actual = null, porNave = {};

    for(var f = 1; f <= Math.min(Number(finFila), 400); f++){
      var b = celda(ws, "B" + f);
      var texto = String(b === null || b === undefined ? "" : b).trim();
      if(!texto) continue;

      var cab = bloqueDe(texto);
      if(cab){
        actual = {clave: cab.clave, rotulo: cab.rotulo, mineral: cab.mineral,
                  filas: [], totalHoja: null};
        bloques.push(actual);
        continue;
      }
      if(!actual) continue;

      if(normalizar(texto).indexOf("TOTAL") === 0){
        actual.totalHoja = numero(celda(ws, "E" + f));
        actual = null;                       // el bloque se cierra en su total
        continue;
      }

      var tm = numero(celda(ws, "E" + f));
      if(tm === null || tm === 0) continue;  // fila en blanco o arrastre de fórmula
      actual.filas.push({nave: texto, tm: tm});
      if(actual.mineral){
        var k = normalizarNave(texto);
        if(!porNave[k]) porNave[k] = {nave: texto, tm: 0, productos: []};
        porNave[k].tm += tm;
        porNave[k].productos.push(actual.rotulo);
      }
    }

    var totalMineral = 0, totalOtros = 0;
    bloques.forEach(function(bl){
      var suma = bl.filas.reduce(function(a, x){ return a + x.tm; }, 0);
      bl.suma = suma;
      if(bl.mineral) totalMineral += suma; else totalOtros += suma;
      /* El total escrito en la hoja contra el que sale de sumar sus filas.
         Si no cuadran, o la planilla trae una fórmula vieja o el lector se
         comió una fila, y en los dos casos hay que mirarlo antes de usar
         la cifra. */
      if(bl.totalHoja !== null && Math.abs(bl.totalHoja - suma) > 1){
        avisos.push("En «" + bl.rotulo + "» el total de la hoja (" +
          Math.round(bl.totalHoja).toLocaleString("es-CL") + ") no cuadra con la suma de sus naves (" +
          Math.round(suma).toLocaleString("es-CL") + ").");
      }
    });

    if(!totalMineral) avisos.push("La hoja no trae tonelaje de pellet feed ni de sinter feed.");

    var periodo = mesDeNombre(nombreArchivo);
    if(!periodo){
      avisos.push("No se pudo leer el mes desde el nombre del archivo: se esperaba algo como " +
        "DATOS_TURNO_PPT_30-09-2026.xlsx.");
    }

    return {
      bloques: bloques,
      porNave: Object.keys(porNave).map(function(k){
        return {clave: k, nave: porNave[k].nave, tm: porNave[k].tm,
                productos: porNave[k].productos};
      }).sort(function(a, b){ return b.tm - a.tm; }),
      totalMineral: totalMineral,
      totalOtros: totalOtros,
      periodo: periodo,
      avisos: avisos
    };
  }

  var api = {BLOQUES: BLOQUES, normalizarNave: normalizarNave,
             mesDeNombre: mesDeNombre, desdeLibro: desdeLibro};

  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Turno = api;

})(typeof window !== "undefined" ? window : globalThis);
