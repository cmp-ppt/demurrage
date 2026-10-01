/**
 * Pruebas del lector de la planilla de turno.  node tests/turno.test.js
 *
 * Los libros se arman acá a mano, con la forma de la hoja real: no se
 * versionan planillas de operación.
 */
var XLSX = require("../js/vendor/xlsx.full.min.js");
var T = require("../js/turno.js");

var fallas = 0, total = 0;
function chequear(nombre, obtenido, esperado, tol){
  total++;
  var ok = (typeof esperado === "number")
    ? Math.abs(obtenido - esperado) <= (tol === undefined ? 1e-6 : tol)
    : obtenido === esperado;
  if(!ok) fallas++;
  console.log((ok ? "  PASS " : "  FALLA") + " | " + nombre + " -> " + obtenido +
    (ok ? "" : "  (esperado " + esperado + ")"));
}
function bloque(t){ console.log("\n" + t); }

/* La hoja empieza en B4 y deja la columna A vacía, como la de verdad. */
function libro(filas, nombreHoja){
  var aoa = filas.map(function(f){ return [null].concat(f); });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombreHoja || "ACUMULADO EMBARQUE");
  return XLSX.read(XLSX.write(wb, {type:"array", bookType:"xlsx"}), {type:"array"});
}

/* Septiembre de verdad, con sus cifras: es el mes que el usuario verificó a
   mano contra la planilla —706.510 + 107.074— y el que tiene que seguir
   dando eso mismo si alguien toca el lector. */
var SEPTIEMBRE = [
  ["Tonelaje acumulado Mes"],
  ["Pellet Feed", "PM", "CNN", "TOTAL"],
  ["CHINA TRIUMPH",   41495,  94377, 135872],
  ["PIGI",            50968, 147059, 198027],
  ["NISEKO QUEEN",    32886, 132314, 165200],
  ["MINERAL COMOROS", 46527, 160884, 207411],
  [null, null, null, 0],
  ["TOTAL", 171876, 534634, 706510],
  [],
  ["Sinter Feed", "Cancha 1", "Cancha 3", "HSF"],
  ["CHINA TRIUMPH", null, null, 65022],
  ["NISEKO QUEEN",  null, null, 42052],
  [null, null, null, 0],
  ["TOTAL", null, null, 107074],
  [],
  ["Concentrado de cobre", "NOVIEMBRE", "DICIEMBRE", "CONCU"],
  ["GINKGO ARROW", null, null, 20896],
  ["TOTAL", null, null, 20896],
  [],
  ["MLC", null, null, "MLC"],
  ["TOTAL", null, null, 0]
];

/* ---------------------------------------------------------------- */
bloque("La hoja de septiembre");
var sep = T.desdeLibro(libro(SEPTIEMBRE), "DATOS_TURNO_PPT_30-09-2026.xlsx");
chequear("sin reparos", sep.avisos.length, 0);
/* 706.510 de pellet feed más 107.074 de sinter feed. */
chequear("mineral del mes", sep.totalMineral, 813584);
/* El concentrado de cobre no entra: GINKGO ARROW no está en ninguna de las
   32 filas del libro de demurrage, y sumarlo daría un total que no se puede
   contrastar contra nada. */
chequear("el concentrado va aparte", sep.totalOtros, 20896);
chequear("cuatro naves de mineral", sep.porNave.length, 4);

function nave(r, n){
  return r.porNave.filter(function(x){ return x.clave === n; })[0] || null;
}
/* Una nave puede cargar los dos productos y hay que sumarlos: las 200.894
   de CHINA TRIUMPH son exactamente su Bill of Lading. */
chequear("CHINA TRIUMPH suma sus dos productos", nave(sep, "CHINA TRIUMPH").tm, 135872 + 65022);
chequear("y queda dicho de cuáles vienen",
  nave(sep, "CHINA TRIUMPH").productos.join("+"), "Pellet Feed+Sinter Feed");
chequear("NISEKO QUEEN también", nave(sep, "NISEKO QUEEN").tm, 165200 + 42052);
chequear("la que carga un solo producto no se duplica", nave(sep, "PIGI").tm, 198027);
chequear("GINKGO ARROW no aparece entre las naves de mineral", nave(sep, "GINKGO ARROW"), null);
/* De mayor a menor: la lista se lee para encontrar una nave, no para
   recorrerla entera. MINERAL COMOROS son 207.411 contra las 207.252 de
   NISEKO QUEEN —165.200 de pellet más 42.052 de sinter—, así que la cabeza
   de la lista la decide la suma de los dos productos, no un solo bloque. */
chequear("ordenadas por tonelaje", sep.porNave[0].clave, "MINERAL COMOROS");
chequear("y la segunda es la que suma dos productos", sep.porNave[1].clave, "NISEKO QUEEN");

/* ---------------------------------------------------------------- */
bloque("El mes sale del nombre del archivo");
/* La hoja no trae la fecha en ninguna celda. Cargar septiembre creyendo que
   es agosto mueve un embarque entero de mes. */
chequear("día-mes-año", T.mesDeNombre("DATOS_TURNO_PPT_30-09-2026.xlsx").mes, 8);
chequear("y el año", T.mesDeNombre("DATOS_TURNO_PPT_30-09-2026.xlsx").anio, 2026);
chequear("con un dígito también", T.mesDeNombre("DATOS_TURNO_PPT_1-5-2026.xlsx").mes, 4);
chequear("un nombre sin fecha no inventa una", T.mesDeNombre("planilla.xlsx"), null);
/* 30 no es un mes: sin esta guarda, 30-09 se leería como el mes 30. */
chequear("no confunde el día con el mes", T.mesDeNombre("DATOS_09-30-2026.xlsx"), null);
chequear("sin nombre tampoco", T.mesDeNombre(), null);
var sinFecha = T.desdeLibro(libro(SEPTIEMBRE), "planilla.xlsx");
chequear("y lo avisa",
  sinFecha.avisos.some(function(a){ return a.indexOf("nombre del archivo") > 0; }), true);

/* ---------------------------------------------------------------- */
bloque("El total de la hoja contra la suma de sus naves");
/* Caso real de julio: la fórmula del TOTAL se quedó corta al agregar una
   nave y dejó fuera a PAN UNIVERSAL. La suma de las filas es la buena, pero
   la diferencia no puede pasar en silencio: son 28.312 t. */
var julio = T.desdeLibro(libro([
  ["Tonelaje acumulado Mes"],
  ["Sinter Feed", "Cancha 1", "Cancha 3", "HSF"],
  ["SHANDONG RENAISSANCE", null, null, 51443],
  ["CONQUISTADOR",         null, null, 27208],
  ["VOUTAKOS",             null, null, 47037],
  ["PAN UNIVERSAL",        null, null, 28312],
  ["TOTAL", null, null, 125688]
]), "DATOS_TURNO_PPT_31-07-2026.xlsx");
chequear("manda la suma de las filas", julio.totalMineral, 154000);
chequear("y el descuadre se avisa",
  julio.avisos.some(function(a){ return a.indexOf("no cuadra") > 0; }), true);
chequear("el aviso nombra el bloque",
  julio.avisos.some(function(a){ return a.indexOf("Sinter Feed") > 0; }), true);

/* ---------------------------------------------------------------- */
bloque("Hojas que no sirven");
var otra = T.desdeLibro(libro(SEPTIEMBRE, "Turno"), "DATOS_TURNO_PPT_30-09-2026.xlsx");
chequear("sin la hoja, lo dice",
  otra.avisos.some(function(a){ return a.indexOf("ACUMULADO EMBARQUE") > 0; }), true);
chequear("y no inventa toneladas", otra.totalMineral, 0);
var vacia = T.desdeLibro(libro([["Tonelaje acumulado Mes"], ["Pellet Feed"], ["TOTAL", null, null, 0]]),
                         "DATOS_TURNO_PPT_30-09-2026.xlsx");
chequear("una hoja sin naves lo dice",
  vacia.avisos.some(function(a){ return a.indexOf("no trae tonelaje") > 0; }), true);

/* ---------------------------------------------------------------- */
bloque("Nombres de nave");
/* La misma normalización que la conciliación: la planilla de turno escribe
   «Mineral Seychelles» y el libro «MINERAL SEYCHELLES». */
chequear("mayúsculas", T.normalizarNave("Mineral Seychelles"), "MINERAL SEYCHELLES");
chequear("quita el prefijo", T.normalizarNave("MN CHINA TRIUMPH"), "CHINA TRIUMPH");
chequear("y los acentos", T.normalizarNave("NAVIOS PHOÉNIX"), "NAVIOS PHOENIX");
var mixto = T.desdeLibro(libro([
  ["Tonelaje acumulado Mes"],
  ["Pellet Feed", "PM", "CNN", "TOTAL"],
  ["Mineral Seychelles", null, null, 100000],
  ["MINERAL SEYCHELLES", null, null, 107301],
  ["TOTAL", null, null, 207301]
]), "DATOS_TURNO_PPT_31-05-2026.xlsx");
chequear("la misma nave escrita de dos formas se junta", mixto.porNave.length, 1);
chequear("y suma las dos filas", mixto.porNave[0].tm, 207301);

/* ---------------------------------------------------------------- */
bloque("Tres personas cargando planillas de meses distintos");
/* La unidad compartida es el mes. Reemplazar el almacén completo por el de
   la nube —«gana el último que guardó»— haría desaparecer el mes que otro
   acabó de cargar, y nadie lo notaría hasta que la ficha de un mes
   apareciera vacía. */
function mes(tm, cuando){
  return {totalMineral: tm, totalOtros: 0, porNave: [],
          archivo: "DATOS_TURNO_PPT.xlsx", actualizadoEn: cuando};
}
var mio   = {"2026-09": mes(813584, "2026-10-01T10:00:00.000Z")};
var suyo  = {"2026-08": mes(837421, "2026-09-01T10:00:00.000Z")};
var unido = T.fusionarMeses(mio, suyo);
chequear("no se pierde el mes del otro", Object.keys(unido).sort().join(","), "2026-08,2026-09");
chequear("y cada uno conserva su cifra", unido["2026-08"].totalMineral, 837421);

/* Dentro de un mes sí manda el más reciente: la planilla del último día ya
   trae el acumulado, así que la versión nueva reemplaza, no suma. */
var mismoMesViejo = {"2026-09": mes(700000, "2026-09-20T10:00:00.000Z")};
chequear("la versión más nueva del mismo mes gana",
  T.fusionarMeses(mio, mismoMesViejo)["2026-09"].totalMineral, 813584);
var mismoMesNuevo = {"2026-09": mes(820000, "2026-10-02T10:00:00.000Z")};
chequear("y si la de la nube es más nueva, gana esa",
  T.fusionarMeses(mio, mismoMesNuevo)["2026-09"].totalMineral, 820000);
/* Un mes sin tonelaje no es un mes: dejarlo entrar pisaría una planilla
   buena con una fila vacía. */
chequear("una entrada sin tonelaje no entra",
  Object.keys(T.fusionarMeses({}, {"2026-07": {archivo:"x.xlsx"}})).length, 0);
chequear("ni desde lo local", Object.keys(T.fusionarMeses({"2026-07": {}}, {})).length, 0);
chequear("sin argumentos no revienta", Object.keys(T.fusionarMeses()).length, 0);

bloque("Qué meses hay que subir");
chequear("el que la nube no tiene", T.mesesPendientes(mio, suyo).join(","), "2026-09");
chequear("y el que allá está más viejo",
  T.mesesPendientes(mio, mismoMesViejo).join(","), "2026-09");
chequear("el que ya está igual no se sube",
  T.mesesPendientes(mio, mio).length, 0);
chequear("ni el que allá está más nuevo",
  T.mesesPendientes(mio, mismoMesNuevo).length, 0);
chequear("sin nada local, nada que subir", T.mesesPendientes({}, suyo).length, 0);
chequear("en orden de mes",
  T.mesesPendientes({"2026-09": mes(1,"2026-10-01T10:00:00.000Z"),
                     "2026-07": mes(1,"2026-10-01T10:00:00.000Z")}, {}).join(","),
  "2026-07,2026-09");
chequear("sin argumentos no revienta", T.mesesPendientes().length, 0);

console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
process.exit(fallas === 0 ? 0 : 1);
