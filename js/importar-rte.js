/**
 * Lector del "Registro de Tiempos de Embarque" (libro CNN-EMB-XXX.xlsx) de PPT.
 *
 * Extrae los datos de la recalada desde las hojas RESUMEN_TIEMPOS, RTE y MUELLAJE
 * y los deja listos para el motor de laytime.  El libro se lee con SheetJS en el
 * navegador; aquí solo se trabaja sobre el objeto workbook ya parseado.
 *
 * Es defensivo a propósito: si una hoja o una celda no está donde se espera,
 * devuelve un aviso en vez de fallar, y el usuario completa el dato a mano.
 */
(function(global){
  "use strict";

  /* Clasificación por defecto de cada categoría de detención del RTE.
       descuenta     -> el tiempo NO cuenta como laytime usado (manda el charter party).
       mantenimiento -> entra en el mantenimiento del terminal que rebaja la DF.
     Las categorías de lado "nave" son las reservas que rebajan la U. */
  var CATEGORIAS = [
    // --- Detenciones de puerto: corren contra el fletador (CMP) ---
    {clave:"Mtto. Mec.",                    lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Mtto. Eléctr.",                 lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Atoros",                        lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Corte correa",                  lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Cambio polines",                lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Daño estructural Lin. Embarque",lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Mtto correctivo operacion",     lado:"puerto", descuenta:false, mantenimiento:true},
    {clave:"Limpieza linea embarque",       lado:"puerto", descuenta:false, mantenimiento:false},
    {clave:"En espera de carga",            lado:"puerto", descuenta:false, mantenimiento:false},
    {clave:"Cambio turno IMOPAC",           lado:"puerto", descuenta:false, mantenimiento:false},
    {clave:"Corridas",                      lado:"puerto", descuenta:false, mantenimiento:false},
    {clave:"Cambio Bodega",                 lado:"puerto", descuenta:false, mantenimiento:false},
    {clave:"Calado Puerto",                 lado:"puerto", descuenta:false, mantenimiento:false},
    {clave:"Incendio",                      lado:"puerto", descuenta:true,  mantenimiento:false},
    // --- Excepciones habituales del C/P ---
    {clave:"Eventos climáticos",            lado:"clima",  descuenta:true,  mantenimiento:false},
    {clave:"Eventos de fuerza mayor",       lado:"clima",  descuenta:true,  mantenimiento:false},
    // --- Detenciones de la nave: tiempo del armador, no cuenta como laytime ---
    {clave:"Calado Nave",                   lado:"nave",   descuenta:true,  mantenimiento:false},
    {clave:"Deslastre",                     lado:"nave",   descuenta:true,  mantenimiento:false},
    {clave:"Amarras",                       lado:"nave",   descuenta:true,  mantenimiento:false},
    {clave:"Preparativo maniobra corrida nave", lado:"nave", descuenta:true, mantenimiento:false},
    {clave:"Otros Nave",                    lado:"nave",   descuenta:true,  mantenimiento:false}
  ];

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

  function celda(ws, ref){
    if(!ws) return null;
    var c = ws[ref];
    return (c && c.v !== undefined) ? c.v : null;
  }

  function numero(v){
    if(v == null || v === "") return null;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(",","."));
    return isNaN(n) ? null : n;
  }

  /** Convierte a "YYYY-MM-DDTHH:MM" un valor de celda (Date o serial de Excel). */
  function aInputDateTime(v){
    var d = null;
    if(v instanceof Date) d = v;
    else if(typeof v === "number"){                       // serial de Excel (base 1899-12-30)
      d = new Date(Math.round((v - 25569) * 86400000));
      d = new Date(d.getTime() + d.getTimezoneOffset()*60000);
    }else if(typeof v === "string"){
      var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v.trim());
      if(m) d = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]);
    }
    if(!d || isNaN(d.getTime())) return "";
    /* Al minuto más cercano, no truncado. El serial de Excel es un flotante y
       el viaje de ida y vuelta devuelve 18:53:59,9 por 18:54; truncar pierde
       ese minuto y el NWH sale 0,01 h corto, que en el muellaje de la SEACON
       AFRICA eran US$ 5 de diferencia contra lo que calcula la propia hoja. */
    d = new Date(Math.round(d.getTime() / 60000) * 60000);
    return d.getFullYear() + "-" +
      String(d.getMonth()+1).padStart(2,"0") + "-" +
      String(d.getDate()).padStart(2,"0") + "T" +
      String(d.getHours()).padStart(2,"0") + ":" +
      String(d.getMinutes()).padStart(2,"0");
  }

  /** Índice de columna (0=A) -> letra ("A", "B", ... "AA"). */
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

  /**
   * Busca en una hoja la fila cuya columna `col` contiene `texto` (comparación
   * laxa) y devuelve el valor de la columna `colValor` en esa fila.
   */
  function valorPorEtiqueta(ws, texto, col, colValor, maxFila){
    if(!ws) return null;
    var objetivo = normalizar(texto);
    for(var f=1; f<=(maxFila||60); f++){
      var etiqueta = normalizar(celda(ws, col + f));
      if(etiqueta && etiqueta.indexOf(objetivo) === 0) return celda(ws, colValor + f);
    }
    return null;
  }

  /** Números de fila cuya columna `col` empieza con `texto`. */
  function filasPorEtiqueta(ws, texto, col, maxFila){
    var objetivo = normalizar(texto), filas = [];
    if(!ws) return filas;
    for(var f=1; f<=(maxFila||240); f++){
      var etiqueta = normalizar(celda(ws, col + f));
      if(etiqueta && etiqueta.indexOf(objetivo) === 0) filas.push(f);
    }
    return filas;
  }

  /**
   * Valor de una etiqueta que aparece repetida, distinguida por su unidad.
   * En el RTE, "TOTAL TIEMPO DESDE INICIO EMBARQUE" aparece dos veces —una en
   * minutos y otra en horas— y no son la misma cantidad: la de minutos es el
   * reloj entre inicio y fin de embarque, y la de horas es la suma de los
   * eventos registrados. Confundirlas cambia todas las tasas.
   */
  function valorPorUnidad(ws, texto, colEtiq, colValor, colUnidad, unidad, maxFila){
    var filas = filasPorEtiqueta(ws, texto, colEtiq, maxFila);
    var objetivo = normalizar(unidad);
    for(var i=0;i<filas.length;i++){
      if(normalizar(celda(ws, colUnidad + filas[i])) === objetivo) return celda(ws, colValor + filas[i]);
    }
    return null;
  }


  /** Letra de columna ("A", "AB") -> índice 0-based. */
  function indice(col){
    var n = 0;
    for(var i=0;i<col.length;i++) n = n*26 + (col.charCodeAt(i) - 64);
    return n - 1;
  }

  /** Última fila y última columna del rango usado de la hoja. */
  function rango(ws){
    var vacio = {filas:0, cols:0};
    if(!ws || !ws["!ref"]) return vacio;
    var m = /^[A-Z]+\d+:([A-Z]+)(\d+)$/.exec(String(ws["!ref"]).toUpperCase());
    if(!m) return vacio;
    return {filas: +m[2], cols: indice(m[1]) + 1};
  }

  /**
   * Busca una etiqueta en CUALQUIER columna de la hoja.
   *
   * La versión anterior de este lector exigía que la etiqueta estuviera en una
   * columna fija y el valor en otra.  En el RTE real varios de esos rótulos
   * viven en celdas combinadas: Excel guarda el texto en la celda superior
   * izquierda del bloque, así que leer la columna equivocada devuelve vacío y
   * el dato se perdía sin decir nada.  Buscar por texto y no por coordenada
   * aguanta que la planilla cambie de formato, que es lo que efectivamente pasa.
   *
   * Devuelve las posiciones {f, c} halladas, con las coincidencias exactas
   * primero: así "CALADO" no se lleva el valor de "CALADO PUERTO".
   */
  function buscar(ws, texto, maxFila){
    if(!ws) return [];
    var objetivo = normalizar(texto);
    var r = rango(ws);
    var hastaFila = Math.min(r.filas, maxFila || 400);
    var hastaCol  = Math.min(r.cols, 60);
    var exactas = [], parciales = [];
    for(var f=1; f<=hastaFila; f++){
      for(var c=0; c<hastaCol; c++){
        var v = celda(ws, letra(c) + f);
        if(typeof v !== "string") continue;
        var t = normalizar(v);
        if(!t) continue;
        if(t === objetivo) exactas.push({f:f, c:c});
        else if(t.indexOf(objetivo) === 0) parciales.push({f:f, c:c});
      }
    }
    return exactas.concat(parciales);
  }

  /** Primer valor numérico a la derecha de {f,c}, en la misma fila. */
  function numeroDerecha(ws, f, c, hastaCol){
    for(var i=c+1; i<hastaCol; i++){
      var v = celda(ws, letra(i) + f);
      if(v === null || v === "") continue;
      var n = numero(v);
      if(n !== null) return n;
    }
    return null;
  }

  /** Textos a la derecha de {f,c}, normalizados (para leer la unidad). */
  function textosDerecha(ws, f, c, hastaCol){
    var out = [];
    for(var i=c+1; i<hastaCol; i++){
      var v = celda(ws, letra(i) + f);
      if(typeof v === "string" && normalizar(v)) out.push(normalizar(v));
    }
    return out;
  }

  /**
   * Valor numérico de una etiqueta, la busque donde la busque.
   * `unidad` es opcional y desempata etiquetas repetidas: en el RTE
   * "TOTAL TIEMPO DESDE INICIO EMBARQUE" aparece dos veces —una en minutos y
   * otra en horas— y no son la misma cantidad: la de minutos es el reloj entre
   * inicio y fin de embarque, y la de horas es la suma de los eventos
   * registrados.  Confundirlas cambia todas las tasas.
   */
  function valorEtiquetado(ws, texto, unidad, maxFila){
    var pos = buscar(ws, texto, maxFila);
    if(!pos.length) return null;
    var hastaCol = Math.min(rango(ws).cols, 60);
    var objetivo = unidad ? normalizar(unidad) : null;
    var suelto = null;
    for(var i=0;i<pos.length;i++){
      var n = numeroDerecha(ws, pos[i].f, pos[i].c, hastaCol);
      if(n === null) continue;
      if(!objetivo) return n;
      if(textosDerecha(ws, pos[i].f, pos[i].c, hastaCol).indexOf(objetivo) >= 0) return n;
      if(suelto === null) suelto = n;      // sin la unidad esperada: último recurso
    }
    return suelto;
  }

  /**
   * Igual que `valorEtiquetado`, pero exige que el valor sea positivo.
   *
   * Buscar la etiqueta en toda la hoja tiene un costo: "CALADO" también rotula
   * una fila de detenciones que puede venir en cero, y ese cero ganaba la
   * cadena del tonelaje —`0 != null`— y arrastraba el embarque entero a cero:
   * tonelaje 0, laytime allowed 0, sin resultado y sin explicación.
   * Un tonelaje de cero no es un tonelaje; es un dato ausente.
   */
  function tonelajeEtiquetado(ws, texto){
    var pos = buscar(ws, texto);
    var hastaCol = Math.min(rango(ws).cols, 60);
    var suelto = null;
    for(var i=0;i<pos.length;i++){
      var n = numeroDerecha(ws, pos[i].f, pos[i].c, hastaCol);
      if(n === null || n <= 0) continue;
      // La fila del bloque de productividad lleva "TM" al lado; la de
      // detenciones lleva horas o minutos. Esa es la que se quiere.
      if(textosDerecha(ws, pos[i].f, pos[i].c, hastaCol).indexOf("tm") >= 0) return n;
      if(suelto === null) suelto = n;
    }
    return suelto;
  }

  /**
   * Lee las horas por categoría desde RESUMEN_TIEMPOS
   * (fila 3 = etiquetas, fila 4 = horas), recorriendo las columnas B..AB.
   */
  function leerCategorias(ws){
    var encontrado = {};
    if(!ws) return encontrado;
    for(var i=1;i<=27;i++){                       // B..AB
      var col = letra(i);
      var etiqueta = celda(ws, col + "3");
      var horas = numero(celda(ws, col + "4"));
      if(etiqueta && horas !== null) encontrado[normalizar(etiqueta)] = horas;
    }
    return encontrado;
  }

  /**
   * El instante en que la nave deja el sitio, se llame como se llame.
   *
   * La hoja MUELLAJE abre con dos filas "Fecha/Hora": la primera es la 1ª
   * espía y la segunda es la salida. El rótulo de esa segunda fila cambió al
   * menos tres veces en la misma temporada —"última espía" en la CNN-EMB-434,
   * "despacho AAMM." en la 406, 407, 409 y 410, "last line" en la 408—, así
   * que perseguir nombres es perder. Lo estable es la estructura: la fila que
   * sigue a la 1ª espía dentro del bloque.
   *
   * Sin esto, cuatro de cinco libros de enero se quedaban sin muellaje y la
   * app solo avisaba del hueco, sin poder llenarlo.
   */
  function salidaDelSitio(ws){
    if(!ws) return null;
    var filas = [];
    for(var f = 1; f <= 30; f++){
      var etiqueta = normalizar(celda(ws, "A" + f));
      if(etiqueta && etiqueta.indexOf("fecha/hora") === 0) filas.push(f);
    }
    // La primera es la 1ª espía; la siguiente con valor es la salida.
    for(var i = 1; i < filas.length; i++){
      var v = celda(ws, "D" + filas[i]);
      if(v != null && v !== "") return v;
    }
    return null;
  }

  /**
   * Punto de entrada: recibe un workbook de SheetJS, devuelve los datos de la recalada.
   */
  function desdeLibro(libro){
    var avisos = [];
    var resumen  = hoja(libro, "RESUMEN_TIEMPOS");
    var rte      = hoja(libro, "RTE");
    var muellaje = hoja(libro, "MUELLAJE");

    if(!resumen)  avisos.push("No se encontró la hoja RESUMEN_TIEMPOS: las detenciones quedan en blanco.");
    if(!rte)      avisos.push("No se encontró la hoja RTE: nave, código y tonelaje quedan en blanco.");
    if(!muellaje) avisos.push("No se encontró la hoja MUELLAJE: espías, eslora y tarifa quedan en blanco.");

    var horasPorCategoria = leerCategorias(resumen);
    var deducciones = CATEGORIAS.map(function(c){
      var horas = horasPorCategoria[normalizar(c.clave)];
      return {
        nombre: c.clave,
        lado: c.lado,
        horas: horas === undefined ? 0 : horas,
        descuenta: c.descuenta,
        mantenimiento: c.mantenimiento,
        encontrada: horas !== undefined
      };
    });
    var noEncontradas = deducciones.filter(function(d){ return !d.encontrada; });

    var totalEmbarque   = horasPorCategoria[normalizar("TOTAL EMBARQUE")];
    var opEfectiva      = horasPorCategoria[normalizar("Tiempo Op. Efectiva")];

    /* Toda la fila 4 de RESUMEN_TIEMPOS son fórmulas que apuntan a RTE. Si el
       libro se guardó con una herramienta que no recalcula (LibreOffice, un
       script, una exportación), las celdas quedan sin valor y aquí llegarían
       ceros: una recalada sin detenciones y con el laytime inflado. Eso no
       puede pasar en silencio. */
    var sinValores = resumen && noEncontradas.length === deducciones.length && totalEmbarque === undefined;
    if(sinValores){
      avisos.push("El libro no trae los valores calculados de sus fórmulas: se guardó sin recalcular. " +
        "Ábrelo en Excel, guárdalo de nuevo y vuelve a cargarlo — si no, las horas de detención " +
        "quedan todas en cero y el laytime usado sale más alto de lo real.");
    }else if(resumen && noEncontradas.length){
      avisos.push("Categorías no halladas en RESUMEN_TIEMPOS (quedan en 0): " +
        noEncontradas.map(function(d){ return d.nombre; }).join(", ") + ".");
    }

    /* Bloque de productividad del RTE (filas ~195-201): tasas, pesómetros y
       calado. Se leen del libro en vez de recalcularse, porque la planilla
       divide por el tiempo de eventos registrados y no por el reloj. */
    var minutosReloj  = valorEtiquetado(rte, "TOTAL TIEMPO DESDE INICIO EMBARQUE", "MINUTOS");
    var horasEventos  = valorEtiquetado(rte, "TOTAL TIEMPO DESDE INICIO EMBARQUE", "HORAS");
    var tasaEfectiva  = valorEtiquetado(rte, "TASA DE OPERACIÓN EFECTIVA");
    var tasaHora      = valorEtiquetado(rte, "TASA PROMEDIO DE EMBARQUE HORA");
    var tasaDia       = valorEtiquetado(rte, "TASA PROMEDIO DE EMBARQUE DÍA");
    var pesometro08   = valorEtiquetado(rte, "TOTAL PESÓMETRO CORREA CT-08", "TM");
    var pesometro09   = tonelajeEtiquetado(rte, "TOTAL PESÓMETRO CORREA CT-09");
    var calado        = tonelajeEtiquetado(rte, "CALADO");

    /* El tonelaje que manda es el calado (draft survey); el pesómetro es el
       respaldo. La suma por bodegas (AH6) queda de último recurso. */
    var tonelaje = null, origenTonelaje = "";
    [[calado, "calado"], [pesometro09, "pesómetro CT-09"],
     [numero(celda(rte, "AH6")), "suma por bodegas"]].some(function(par){
      if(par[0] != null && par[0] > 0){ tonelaje = par[0]; origenTonelaje = par[1]; return true; }
      return false;
    });

    var datos = {
      nave:            celda(rte, "D4") || celda(resumen, "S1") || "",
      codigo:          celda(rte, "Y3") || celda(resumen, "P1") || "",
      inicioEmbarque:  aInputDateTime(celda(rte, "Y1")),
      finEmbarque:     aInputDateTime(celda(rte, "Y2")),
      tonelaje:        tonelaje,
      origenTonelaje:  origenTonelaje,
      calado:          calado,
      pesometro08:     pesometro08,
      pesometro09:     pesometro09,
      tasaEfectiva:    tasaEfectiva,
      tasaHora:        tasaHora,
      tasaDia:         tasaDia,
      horasReloj:      minutosReloj != null ? minutosReloj / 60 : null,
      horasEventos:    horasEventos,
      primeraEspia:    aInputDateTime(valorPorEtiqueta(muellaje, "Fecha/Hora 1a espía", "A", "D", 30)),
      ultimaEspia:     aInputDateTime(salidaDelSitio(muellaje)),
      horasMantenimientoMuellaje: numero(valorPorEtiqueta(muellaje, "Tiempo Terminal en Mantenimiento", "A", "D", 30)),
      horasGira:       numero(valorPorEtiqueta(muellaje, "Tiempo Nave a la gira", "A", "D", 30)) || 0,
      eslora:          numero(valorPorEtiqueta(muellaje, "Eslora Nave", "A", "D", 30)),
      tarifaMuelle:    numero(valorPorEtiqueta(muellaje, "Tarifa muelle", "A", "D", 30)),
      /* Las tres cifras del muellaje tal como las trae la hoja. Son las que
         se muestran: es el documento que se factura y el que le van a poner
         delante a uno. La app las recalcula igual, desde las espías, pero
         para contrastar —si no coinciden, una de las dos está mal y hay que
         saberlo antes de facturar, no después. */
      horasMuellajeLibro: numero(valorPorEtiqueta(muellaje, "Tiempo Muellaje", "A", "D", 30)),
      nwhLibro:        numero(valorPorEtiqueta(muellaje, "(NWH) Net Wharfage Hours", "A", "D", 30)),
      muellajeLibro:   numero(valorPorEtiqueta(muellaje, "MUELLAJE (US$)", "A", "D", 30)),
      horasTotales:    totalEmbarque === undefined ? null : totalEmbarque,
      horasOpEfectiva: opEfectiva === undefined ? null : opEfectiva,
      deducciones:     deducciones
    };

    /* El reloj del embarque y la suma de eventos deberían coincidir. Si no,
       hay tiempo del embarque que ningún evento del RTE cubre. */
    if(datos.horasReloj != null && datos.horasEventos != null){
      var hueco = datos.horasReloj - datos.horasEventos;
      if(Math.abs(hueco) > 0.5){
        avisos.push("Entre el inicio y el fin del embarque hay " +
          (Math.round(datos.horasReloj*100)/100).toLocaleString("es-CL") + " h de reloj, pero los eventos del RTE suman " +
          (Math.round(datos.horasEventos*100)/100).toLocaleString("es-CL") + " h: quedan " +
          (Math.round(Math.abs(hueco)*100)/100).toLocaleString("es-CL") + " h sin evento que las explique.");
      }
    }

    /* Antes, si el bloque de productividad no se hallaba, las tasas quedaban en
       blanco sin explicación y parecía un defecto de la app. Ahora se dice. */
    if(rte && tasaDia == null && tasaHora == null && tasaEfectiva == null){
      avisos.push("No se encontró el bloque de tasas del RTE (tasa de operación efectiva, " +
        "tasa promedio hora y día). La app las calcula a partir del tonelaje y las horas, " +
        "y lo indica en el panel; puede diferir de la planilla, que divide por el tiempo de " +
        "eventos registrados.");
    }
    if(rte && tonelaje == null){
      avisos.push("No se pudo leer el tonelaje embarcado: ni el calado, ni el pesómetro CT-09, " +
        "ni la suma por bodegas traen una cifra positiva. Sin tonelaje no hay laytime allowed — " +
        "escríbelo a mano en «Corregir datos importados».");
    }else if(rte && origenTonelaje !== "calado"){
      avisos.push("El tonelaje sale de " + origenTonelaje + ", no del calado. " +
        "El draft survey no viene en el CNN-EMB: cuando llegue el correo de la agencia, " +
        "escríbelo en «Corregir datos importados» › Calado y el laytime se rehace con esa cifra.");
    }

    /* Contraste con el muellaje que trae la propia hoja. Un descuadre sobre
       un dólar no es redondeo: o la app leyó mal una fecha, o la planilla
       quedó con una fórmula vieja. */
    if(datos.muellajeLibro != null && datos.primeraEspia && datos.ultimaEspia &&
       datos.eslora && datos.tarifaMuelle){
      var horas = (new Date(datos.ultimaEspia) - new Date(datos.primeraEspia)) / 3600000;
      var nwh = Math.round((horas - (datos.horasMantenimientoMuellaje || 0) -
                            (datos.horasGira || 0)) * 100) / 100;
      var propio = nwh * datos.eslora * datos.tarifaMuelle;
      if(Math.abs(propio - datos.muellajeLibro) > 1){
        avisos.push("El muellaje que calcula la app (US$ " +
          (Math.round(propio*100)/100).toLocaleString("es-CL") + ") no coincide con el de la hoja (US$ " +
          (Math.round(datos.muellajeLibro*100)/100).toLocaleString("es-CL") +
          "). Revisa las espías y las horas de mantenimiento antes de facturar.");
      }
    }

    if(!datos.primeraEspia) avisos.push("No se pudo leer la fecha/hora de 1ª espía.");
    if(!datos.ultimaEspia)  avisos.push("No se pudo leer la fecha/hora de última espía.");

    return {datos: datos, avisos: avisos, sinValores: !!sinValores};
  }

  var api = {
    CATEGORIAS: CATEGORIAS,
    desdeLibro: desdeLibro,
    aInputDateTime: aInputDateTime,
    letra: letra,
    normalizar: normalizar
  };

  if(typeof module === "object" && module.exports) module.exports = api;
  else global.ImportarRTE = api;

})(typeof window !== "undefined" ? window : globalThis);
