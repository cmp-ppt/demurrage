/**
 * Pruebas del consolidado por trimestre.  node tests/trimestres.test.js
 *
 * Las regresiones al final son contra la temporada 2026 real de Punta
 * Totoralillo: si el día de mañana alguien cambia una suma, estas cifras
 * dejan de cuadrar y se nota antes de presentarlas a gerencia.
 */
var T = require("../js/trimestres.js");

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
function F(s){ var m = /(\d{4})-(\d{2})-(\d{2})/.exec(s); return new Date(+m[1], +m[2]-1, +m[3]); }

/* ---------------------------------------------------------------- */
bloque("Agregación básica");
var datos = {
  recaladas: [
    {trimestre:"Q1", nave:"UNO",  cargo:100000, demurrage:50000, despatch:0,
     nor:F("2026-01-01"), atb:F("2026-01-06"), eta:F("2026-01-02"),
     laycanDesde:F("2026-01-01"), laycanHasta:F("2026-01-05")},
    {trimestre:"Q1", nave:"DOS",  cargo:100000, demurrage:0, despatch:-10000,
     nor:F("2026-02-01"), atb:F("2026-02-02"), eta:F("2026-02-10"),
     laycanDesde:F("2026-02-01"), laycanHasta:F("2026-02-05")},
    {trimestre:"Q2", nave:"TRES", cargo:200000, demurrage:300000, despatch:0,
     nor:F("2026-04-01"), atb:F("2026-04-11"), eta:F("2026-03-20"),
     laycanDesde:F("2026-04-01"), laycanHasta:F("2026-04-05")}
  ],
  tiempos: [
    {trimestre:"Q1", nave:"UNO",  esperaAmarre:5, operacionCarga:6, timeAllowed:7},
    {trimestre:"Q1", nave:"DOS",  esperaAmarre:1, operacionCarga:5, timeAllowed:7},
    {trimestre:"Q2", nave:"TRES", esperaAmarre:10, operacionCarga:9, timeAllowed:7}
  ],
  detenciones: [
    {trimestre:"Q1", categoria:"WEATHER", dias:2, costo:20000},
    {trimestre:"Q1", categoria:"WEATHER", dias:1, costo:10000},
    {trimestre:"Q1", categoria:"TERMINAL MAINTENANCE", dias:4, costo:40000},
    {trimestre:"Q2", categoria:"GENERAL CONGESTION", dias:8, costo:80000}
  ],
  clima: [
    {trimestre:"Q1", causa:"Marejada", dias:2},
    {trimestre:"Q2", causa:"Viento", dias:3}
  ]
};
var qs = T.porTrimestre(datos);
chequear("dos trimestres", qs.length, 2);
chequear("en orden Q1, Q2", qs[0].trimestre + "," + qs[1].trimestre, "Q1,Q2");
chequear("naves de Q1", qs[0].naves, 2);
chequear("demurrage de Q1", qs[0].demurrage, 50000);
chequear("el despatch se guarda como magnitud", qs[0].despatch, 10000);
chequear("el neto lo resta", qs[0].neto, 40000);
chequear("US$ por tonelada", qs[0].usdPorTonelada, 40000/200000, 1e-9);
chequear("naves en demurrage", qs[0].enDemurrage, 1);
chequear("naves en despatch", qs[0].enDespatch, 1);

/* ---------------------------------------------------------------- */
bloque("Espera contra operación — la comparación que importa");
chequear("espera de Q1", qs[0].espera, 6);
chequear("operación de Q1", qs[0].operacion, 11);
chequear("allowed de Q1", qs[0].allowed, 14);
chequear("las dos naves de Q1 cargaron dentro del allowed", qs[0].dentroDelAllowed, 2);
chequear("la de Q2 no", qs[1].dentroDelAllowed, 0);
chequear("uso del allowed en Q1", qs[0].usoDelAllowed, 11/14*100, 1e-9);
/* La nave con demurrage esperó 5 días; la de despatch, 1. Separar los dos
   promedios es lo que muestra que la espera y el monto van juntos. */
chequear("espera media con demurrage", qs[0].esperaConDemurrage, 5);
chequear("espera media sin demurrage", qs[0].esperaSinDemurrage, 1);

/* ---------------------------------------------------------------- */
bloque("Laycan");
chequear("UNO llegó dentro", T.estadoLaycan(datos.recaladas[0]), "dentro");
chequear("DOS llegó tarde",  T.estadoLaycan(datos.recaladas[1]), "tarde");
chequear("TRES llegó antes", T.estadoLaycan(datos.recaladas[2]), "antes");
chequear("sin fechas no se inventa", T.estadoLaycan({nave:"X"}), null);
chequear("conteo de Q1", qs[0].laycan.dentro + "/" + qs[0].laycan.tarde, "1/1");

/* ---------------------------------------------------------------- */
bloque("Detenciones por categoría");
chequear("dos categorías en Q1", qs[0].detenciones.length, 2);
chequear("la mayor primero", qs[0].detenciones[0].categoria, "TERMINAL MAINTENANCE");
chequear("WEATHER suma sus dos eventos", qs[0].detenciones[1].dias, 3);
chequear("y su costo", qs[0].detenciones[1].costo, 30000);
chequear("cuenta los eventos", qs[0].detenciones[1].eventos, 2);
chequear("días detenidos de Q1", qs[0].diasDetenidos, 7);
chequear("días de clima de Q1", qs[0].diasClima, 2);

/* ---------------------------------------------------------------- */
bloque("Totales de la temporada");
var t = T.total(qs);
chequear("naves", t.naves, 3);
chequear("demurrage", t.demurrage, 350000);
chequear("despatch", t.despatch, 10000);
chequear("neto", t.neto, 340000);
chequear("espera total", t.espera, 16);
chequear("operación total", t.operacion, 20);
chequear("dentro del allowed", t.dentroDelAllowed, 2);
chequear("sin trimestres, todo en cero", T.total([]).neto, 0);

/* ---------------------------------------------------------------- */
bloque("Cruce por nave: la misma nave en dos trimestres");
/* PIGI, NISEKO QUEEN y MINERAL BOTSWANA aparecen dos veces en la temporada
   real. Sin desempatar por trimestre, la segunda recalada heredaría los
   tiempos de la primera y la espera saldría mal en los dos. */
var repetida = T.porTrimestre({
  recaladas: [
    {trimestre:"Q2", nave:"PIGI", cargo:1000, demurrage:100, despatch:0},
    {trimestre:"Q3", nave:"PIGI", cargo:1000, demurrage:200, despatch:0}
  ],
  tiempos: [
    {trimestre:"Q2", nave:"PIGI", esperaAmarre:4, operacionCarga:1, timeAllowed:2},
    {trimestre:"Q3", nave:"PIGI", esperaAmarre:11, operacionCarga:7, timeAllowed:7}
  ]
});
chequear("Q2 toma su propia espera", repetida[0].espera, 4);
chequear("Q3 toma la suya", repetida[1].espera, 11);

/* ---------------------------------------------------------------- */
bloque("Recalada sin tiempos: entra en los montos, no en el promedio");
var parcial = T.porTrimestre({
  recaladas: [
    {trimestre:"Q1", nave:"CON", cargo:1000, demurrage:100, despatch:0},
    {trimestre:"Q1", nave:"SIN", cargo:1000, demurrage:900, despatch:0}
  ],
  tiempos: [{trimestre:"Q1", nave:"CON", esperaAmarre:3, operacionCarga:2, timeAllowed:5}]
});
chequear("las dos suman al demurrage", parcial[0].demurrage, 1000);
chequear("solo una aporta tiempos", parcial[0].conTiempos, 1);
chequear("y la espera es la suya", parcial[0].espera, 3);

/* ---------------------------------------------------------------- */
bloque("Diagnóstico");
var d = T.diagnostico(qs);
chequear("nombra el peor trimestre", d.peorTrimestre.trimestre, "Q2");
chequear("escribe varias frases", d.frases.length >= 3, true);
chequear("dice que la espera manda",
  d.frases.some(function(f){ return f.indexOf("espera previa al amarre") >= 0; }), true);
var vacio = T.diagnostico([]);
chequear("sin datos no inventa conclusiones", vacio.frases.length, 0);

/* ---------------------------------------------------------------- */
bloque("Filtros de trimestre y mes");
var temporada = {
  recaladas: [
    {trimestre:"Q1", nave:"ENERO",  cargo:1000, demurrage:100, despatch:0, finCarga:F("2026-01-20")},
    {trimestre:"Q1", nave:"MARZO",  cargo:1000, demurrage:200, despatch:0, finCarga:F("2026-03-10")},
    {trimestre:"Q2", nave:"ABRIL",  cargo:1000, demurrage:400, despatch:0, finCarga:F("2026-04-15")}
  ],
  tiempos: [
    {trimestre:"Q1", nave:"ENERO", esperaAmarre:2, operacionCarga:1, timeAllowed:3},
    {trimestre:"Q1", nave:"MARZO", esperaAmarre:5, operacionCarga:1, timeAllowed:3},
    {trimestre:"Q2", nave:"ABRIL", esperaAmarre:9, operacionCarga:1, timeAllowed:3}
  ],
  detenciones: [
    {trimestre:"Q1", nave:"ENERO", categoria:"WEATHER", dias:1, costo:10},
    {trimestre:"Q2", nave:"ABRIL", categoria:"WEATHER", dias:2, costo:20}
  ],
  clima: [{trimestre:"Q1", causa:"Marejada", dias:3}],
  plan: [{trimestre:"Q2", nave:"FUTURA", etd:F("2026-04-28")}]
};
chequear("sin filtro devuelve lo mismo", T.filtrar(temporada, {}).recaladas.length, 3);
var soloQ1 = T.filtrar(temporada, {trimestre:"Q1"});
chequear("Q1 deja dos recaladas", soloQ1.recaladas.length, 2);
/* Lo que cuelga de la recalada la sigue: los tiempos y las detenciones se
   cruzan por nave, no por su propia fecha. */
chequear("y arrastra sus tiempos", soloQ1.tiempos.length, 2);
chequear("y sus detenciones", soloQ1.detenciones.length, 1);
chequear("y su clima", soloQ1.clima.length, 1);
chequear("y deja fuera el plan de otro trimestre", soloQ1.plan.length, 0);

var soloMarzo = T.filtrar(temporada, {mes:2});
chequear("marzo deja una", soloMarzo.recaladas.length, 1);
chequear("y es la correcta", soloMarzo.recaladas[0].nave, "MARZO");
/* El clima del libro viene agregado por trimestre, sin nave: repartirlo entre
   los meses sería inventarlo, así que con filtro de mes se omite. */
chequear("con filtro de mes el clima se omite", soloMarzo.clima.length, 0);

var q1Enero = T.filtrar(temporada, {trimestre:"Q1", mes:0});
chequear("los dos filtros se combinan", q1Enero.recaladas.length, 1);
chequear("y es enero", q1Enero.recaladas[0].nave, "ENERO");
chequear("un filtro sin resultados no revienta",
  T.porTrimestre(T.filtrar(temporada, {trimestre:"Q4"})).length, 0);

/* El mes sale del término de carguío, que es la fecha del conocimiento de
   embarque: una nave que dio NOR en julio y terminó en agosto es de agosto. */
chequear("el mes es el del término de carguío",
  T.mesDe({nor:F("2026-07-24"), atb:F("2026-08-10"), finCarga:F("2026-08-17")}), 7);
chequear("sin término de carguío cae al amarre",
  T.mesDe({nor:F("2026-07-24"), atb:F("2026-08-10")}), 7);
chequear("sin ninguna fecha, null", T.mesDe({nave:"X"}), null);
chequear("meses disponibles, en orden",
  T.mesesDisponibles(temporada).map(function(m){ return m.nombre; }).join(" "), "ene mar abr");

/* ---------------------------------------------------------------- */
bloque("Liquidado contra proyectado");
var HOY = new Date(2026, 8, 14);   // 14-09-2026
function rec(extra){
  var base = {trimestre:"Q3", nave:"X", cargo:204175, demurrage:0, despatch:0,
              atb:new Date(2026,7,30,17,45), inicioCarga:new Date(2026,7,30,19,21),
              finCarga:new Date(2026,8,5,13,30)};
  for(var k in extra) base[k] = extra[k];
  return base;
}
chequear("una recalada terminada es liquidada", T.esProyectada(rec(), HOY), false);
chequear("si el carguío no termina, es proyección",
  T.esProyectada(rec({finCarga:new Date(2026,8,24)}), HOY), true);
/* Horas redondas Y tonelaje del plan: eso es una fila planificada. */
chequear("horas redondas con tonelaje de plan es proyección",
  T.esProyectada(rec({cargo:206000, atb:new Date(2026,8,10), inicioCarga:new Date(2026,8,10),
                      finCarga:new Date(2026,8,12)}), HOY), true);
/* SHANDONG RENAISSANCE: horas redondas pero tonelaje real y demurrage con
   decimales. Es una recalada liquidada con las horas mal transcritas. */
chequear("horas redondas con tonelaje real NO es proyección",
  T.esProyectada(rec({cargo:207295, atb:new Date(2026,5,24), inicioCarga:new Date(2026,5,25),
                      finCarga:new Date(2026,6,1), demurrage:40921.56}), HOY), false);
chequear("sin fila no revienta", T.esProyectada(null, HOY), false);
/* Al recuperar del navegador, JSON devuelve las fechas como texto ISO. Sin
   normalizarlas el módulo reventaba con «getHours is not a function», y la
   temporada guardada no se podía volver a abrir. */
chequear("aguanta fechas en texto",
  T.esProyectada({cargo:206000, atb:"2026-09-10T00:00:00.000Z".replace("Z",""),
                  inicioCarga:"2026-09-10T00:00:00", finCarga:"2026-09-12T00:00:00"}, HOY), true);
chequear("y el laycan también",
  T.estadoLaycan({eta:"2026-02-10T00:00:00", laycanDesde:"2026-02-01T00:00:00",
                  laycanHasta:"2026-02-05T00:00:00"}), "tarde");
chequear("y los días entre fechas",
  T.diasEntre("2026-01-01T00:00:00", "2026-01-06T00:00:00"), 5);
chequear("texto que no es fecha no se inventa", T.aFecha("cualquier cosa"), null);

var mezcla = T.porTrimestre({
  recaladas: [
    rec({nave:"REAL", demurrage:500000}),
    rec({nave:"PLAN", cargo:206000, demurrage:1500000,
         atb:new Date(2026,8,10), inicioCarga:new Date(2026,8,10), finCarga:new Date(2026,8,16)})
  ],
  tiempos: []
}, HOY);
chequear("una liquidada", mezcla[0].liquidadas, 1);
chequear("una proyectada", mezcla[0].proyectadas, 1);
chequear("el neto liquidado deja fuera la proyección", mezcla[0].netoLiquidado, 500000);
chequear("y el proyectado se guarda aparte", mezcla[0].demurrageProyectado, 1500000);
chequear("el total sigue siendo la suma de los dos", mezcla[0].neto, 2000000);
chequear("el diagnóstico lo advierte",
  T.diagnostico(mezcla).frases.some(function(f){ return f.indexOf("proyección") >= 0; }), true);

/* ---------------------------------------------------------------- */
bloque("Atribución de la espera");
chequear("muelle ocupado", T.causaPrincipal("Upon arrival terminal was occupied by MV PIGI"), "Muelle ocupado");
chequear("clima", T.causaPrincipal("port closed due to weather"), "Clima");
chequear("terminal", T.causaPrincipal("Terminal maintenance (molienda)"), "Terminal");
/* Caserones gana a «occupied» aunque aparezca después: decide con quién se
   negocia, y el muelle ocupado por un tercero no es congestión propia. */
chequear("Caserones gana a muelle ocupado",
  T.causaPrincipal("Upon arrival terminal was occupied by MV BUNUN DINASTY (CASERONES)"),
  "Congestión Caserones");
chequear("sin comentario, sin atribuir", T.causaPrincipal(""), T.SIN_ATRIBUIR);
chequear("comentario que no calza con ninguna regla", T.causaPrincipal("agreed with all parties"), T.SIN_ATRIBUIR);
chequear("lista todas las causas mencionadas",
  T.causasEspera("terminal occupied (CASERONES), then closed due to swell").join("+"),
  "Congestión Caserones+Muelle ocupado+Clima");

var atrib = T.atribucion(T.porTrimestre({
  recaladas: [
    {trimestre:"Q1", nave:"A", cargo:1, demurrage:100, despatch:0, comentario:"terminal occupied"},
    {trimestre:"Q1", nave:"B", cargo:1, demurrage:200, despatch:0, comentario:"occupied (CASERONES)"},
    {trimestre:"Q1", nave:"C", cargo:1, demurrage:900, despatch:0, comentario:""},
    {trimestre:"Q1", nave:"D", cargo:1, demurrage:0,   despatch:-50, comentario:"clean operation"}
  ], tiempos: []
}, HOY));
chequear("tres causas con monto", atrib.length, 3);
chequear("cada monto se cuenta una sola vez",
  atrib.reduce(function(a,x){ return a + x.monto; }, 0), 1200);
chequear("«sin atribuir» va al final aunque sea el mayor",
  atrib[atrib.length-1].causa, T.SIN_ATRIBUIR);
chequear("y lleva su monto", atrib[atrib.length-1].monto, 900);
chequear("el despatch no entra en la atribución",
  atrib.filter(function(a){ return a.causa === "Clima"; }).length, 0);

/* ---------------------------------------------------------------- */
bloque("Exposición del plan");
var plan = [{
  trimestre:"Q4", nave:"FUTURA", tonelaje:206000,
  laycanDesde:new Date(2026,9,1), laycanHasta:new Date(2026,9,7),
  eta:new Date(2026,9,3), etb:new Date(2026,9,4), etd:new Date(2026,9,9)
}];
var ex = T.exposicionPlan(plan, {tasaEmbarque:30000, rate:37414, descuento:1.13})[0];
chequear("allowed = tonelaje / tasa", ex.allowed, 206000/30000, 1e-9);
/* El laytime arranca en el ETA porque cae dentro del laycan. */
chequear("inicio del laytime en el ETA", ex.inicioLaytime.getTime(), plan[0].eta.getTime());
chequear("bruto de ETA a ETD", ex.bruto, 6, 1e-9);
chequear("contado descuenta lo típico", ex.contado, 6 - 1.13, 1e-9);
chequear("cabe en el allowed: sin exposición", ex.exposicion, 0);
chequear("y el amarre está en ventana", ex.amarreFueraDeLaycan, false);

/* Nave que llega antes de que abra el laycan: el NOR no vale hasta entonces,
   así que el reloj parte en el inicio de la ventana, no en el ETA. */
var temprana = T.exposicionPlan([{
  nave:"TEMPRANA", tonelaje:206000,
  laycanDesde:new Date(2026,9,1), laycanHasta:new Date(2026,9,7),
  eta:new Date(2026,8,20), etb:new Date(2026,9,2), etd:new Date(2026,9,8)
}], {rate:37414})[0];
chequear("el reloj parte al abrir el laycan",
  temprana.inicioLaytime.getTime(), new Date(2026,9,1).getTime());
chequear("no le cobra los días de llegada anticipada", temprana.bruto, 7, 1e-9);

var tarde = T.exposicionPlan([{
  nave:"TARDE", tonelaje:206000,
  laycanDesde:new Date(2026,9,1), laycanHasta:new Date(2026,9,7),
  eta:new Date(2026,9,3), etb:new Date(2026,9,20), etd:new Date(2026,9,26)
}], {rate:37414, descuento:1.13})[0];
chequear("amarre fuera del laycan se marca", tarde.amarreFueraDeLaycan, true);
chequear("espera prevista", tarde.espera, 17, 1e-9);
chequear("hay exposición", tarde.exposicion > 0, true);
chequear("y es el exceso por el rate",
  tarde.exposicion, ((23 - 1.13) - 206000/30000) * 37414, 1e-6);

var sinFechas = T.exposicionPlan([{nave:"MANTENIMIENTO"}], {rate:37414})[0];
chequear("sin fechas no se estima", sinFechas.calculable, false);
chequear("y la exposición queda en cero", sinFechas.exposicion, 0);

chequear("rate típico es la mediana", T.rateTipico([{recaladas:[
  {rate:20000},{rate:30000},{rate:40000}]}]), 30000);
chequear("sin rates, cero", T.rateTipico([]), 0);

/* ---------------------------------------------------------------- */
bloque("Regresión — temporada 2026 de Punta Totoralillo");
/* Cifras del libro de reportería, leídas con js/reporteria.js. */
var real = T.porTrimestre({
  recaladas: [].concat(
    rep("Q1", 10, 1130084.0, -41561.59, 1789232),
    rep("Q2",  9, 1019161.69, -57370.81, 1472475.18),
    rep("Q3", 14, 4271069.55, -27217.45, 2565368)
  ),
  tiempos: []
});
function rep(q, n, dem, des, cargo){
  // Una fila lleva el total del trimestre y las demás van en cero: lo que se
  // comprueba acá es la suma, no el reparto entre naves.
  var out = [{trimestre:q, nave:q+"-1", cargo:cargo, demurrage:dem, despatch:des}];
  for(var i = 2; i <= n; i++) out.push({trimestre:q, nave:q+"-"+i, cargo:0, demurrage:0, despatch:0});
  return out;
}
chequear("Q1 neto US$ 1.088.522", Math.round(real[0].neto), 1088522);
chequear("Q2 neto US$ 961.791",   Math.round(real[1].neto), 961791);
chequear("Q3 neto US$ 4.243.852", Math.round(real[2].neto), 4243852);
var tr = T.total(real);
chequear("temporada: 33 recaladas", tr.naves, 33);
chequear("demurrage US$ 6.420.315", Math.round(tr.demurrage), 6420315);
chequear("despatch US$ 126.150",    Math.round(tr.despatch), 126150);
chequear("neto US$ 6.294.165",      Math.round(tr.neto), 6294165);
chequear("US$ 1,08 por tonelada",   +tr.usdPorTonelada.toFixed(2), 1.08);

/* ---------------------------------------------------------------- */
bloque("El acumulado termina donde termina el total");
/* Cada ficha de la temporada lleva debajo una chispa con el camino hacia su
   cifra. Si el último punto de la chispa no vale lo mismo que la cifra que
   tiene encima, la ficha muestra dos números distintos del mismo dato y no
   hay forma de saber cuál creer. La invariante se exige acá, sobre la
   temporada real de las 33 recaladas. */
var pasos = T.acumulado(real);
var ultimo = pasos[pasos.length - 1];
chequear("un punto por trimestre", pasos.length, real.length);
chequear("último punto: neto", Math.round(ultimo.neto), Math.round(tr.neto));
chequear("último punto: recaladas", ultimo.naves, tr.naves);
chequear("último punto: US$ por tonelada", +ultimo.usdPorTonelada.toFixed(4), +tr.usdPorTonelada.toFixed(4));
chequear("último punto: espera", +ultimo.espera.toFixed(4), +tr.espera.toFixed(4));
chequear("último punto: uso del laytime", +ultimo.usoDelAllowed.toFixed(4), +tr.usoDelAllowed.toFixed(4));
chequear("último punto: liquidado", Math.round(ultimo.netoLiquidado), Math.round(tr.netoLiquidado));

/* Las razones se derivan del acumulado crudo, no se promedian entre
   trimestres. Con estos dos trimestres el promedio de las razones da 0,75
   US$/t y la razón de los totales da 0,60: el promedio de razones no es la
   razón de los totales, y la ficha muestra la segunda. */
var dosQ = T.porTrimestre({
  recaladas: [
    {trimestre:"Q1", nave:"A", cargo:100000, demurrage:100000, despatch:0},
    {trimestre:"Q2", nave:"B", cargo:400000, demurrage:200000, despatch:0}
  ], tiempos: [], detenciones: [], clima: []
});
var acc2 = T.acumulado(dosQ);
chequear("Q1 acumulado: 1,00 US$/t", +acc2[0].usdPorTonelada.toFixed(2), 1.00);
chequear("Q1+Q2 acumulado: 0,60 US$/t, no 0,75",
  +acc2[1].usdPorTonelada.toFixed(2), 0.60);
chequear("y coincide con el total", +acc2[1].usdPorTonelada.toFixed(4),
  +T.total(dosQ).usdPorTonelada.toFixed(4));

/* Un trimestre solo no tiene trayectoria; cero trimestres tampoco. */
chequear("sin trimestres, ningún punto", T.acumulado([]).length, 0);
chequear("sin argumento, ningún punto", T.acumulado().length, 0);

/* ---------------------------------------------------------------- */
bloque("Recaladas provisorias: calculadas acá, no liquidadas");

/* El libro trae lo acordado con el armador; una fila provisoria la arma
   esta app porque el área comercial todavía no incorporó ese embarque. Lo
   que las separa es que la provisoria NO está cobrada, y la ficha de
   «Liquidado» tiene que reflejarlo o estaría diciendo que hay plata en la
   cuenta que nadie acordó. */
var conProv = T.porTrimestre({recaladas: [
  {trimestre:"Q4", nave:"LIQUIDADA", cargo:207232, demurrage:55000, despatch:0,
   nor:new Date("2026-10-15T06:00:00"), atb:new Date("2026-10-15T12:00:00"),
   inicioCarga:new Date("2026-10-15T14:00:00"), finCarga:new Date("2026-10-18T06:00:00")},
  {trimestre:"Q4", nave:"PROVISORIA", cargo:198002, demurrage:0, despatch:-11901,
   nor:new Date("2026-11-07T12:00:00"), atb:new Date("2026-11-08T06:00:00"),
   inicioCarga:new Date("2026-11-08T09:00:00"), finCarga:new Date("2026-11-13T18:00:00"),
   provisoria:true}
]}, new Date("2026-11-17T00:00:00"));
var q4 = conProv[0];
chequear("las dos están en el trimestre", q4.naves, 2);
chequear("pero solo una está liquidada", q4.liquidadas, 1);
chequear("y la provisoria se cuenta aparte", q4.provisorias, 1);
chequear("lo liquidado no incluye la provisoria", q4.netoLiquidado, 55000);
/* El despatch de la provisoria va a favor: con el demurrage solo, el pie de
   la ficha decía «aporta US$ 0» de una recalada que aporta −11.901. */
chequear("el neto no liquidado resta el despatch", q4.netoProyectado, -11901);
/* El neto del trimestre sí las suma a las dos: es lo que costó la
   temporada, liquidado o no. */
chequear("el neto del trimestre suma ambas", q4.neto, 43099);

/* Sin marca, la heurística de siempre: una fila del libro con fin de
   carguío pasado y tonelaje que no es múltiplo redondo está liquidada. */
var sinProv = T.porTrimestre({recaladas: [
  {trimestre:"Q4", nave:"LIQUIDADA", cargo:207232, demurrage:55000, despatch:0,
   nor:new Date("2026-10-15T06:00:00"), atb:new Date("2026-10-15T12:00:00"),
   inicioCarga:new Date("2026-10-15T14:00:00"), finCarga:new Date("2026-10-18T06:00:00")}
]}, new Date("2026-11-17T00:00:00"));
chequear("sin provisorias el conteo es cero", sinProv[0].provisorias, 0);
chequear("y todo queda liquidado", sinProv[0].liquidadas, 1);

/* La frase del diagnóstico tiene que nombrar lo provisorio por su nombre:
   «proyección» haría pensar en una nave que todavía no carga. */
var frases = T.diagnostico(conProv).frases.join(" ");
chequear("la prosa dice que no está liquidada", frases.indexOf("no está liquidada") >= 0, true);
chequear("y que es provisoria, no proyección", frases.indexOf("provisoria") >= 0, true);
/* Y con el neto, no con el demurrage solo: la frase decía «aportan US$ 0»
   de una recalada cuyo despatch vale US$ 11.901 a favor. */
chequear("la frase trae el neto, no el demurrage solo",
  frases.indexOf("11.901") >= 0, true);

console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
process.exit(fallas === 0 ? 0 : 1);
