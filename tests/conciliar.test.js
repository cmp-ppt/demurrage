/**
 * Pruebas de la conciliación entre el time sheet propio y lo liquidado.
 * Ejecutar con:  node tests/conciliar.test.js
 */
var C = require("../js/conciliar.js");

var fallas = 0, total = 0;
function chequear(nombre, obtenido, esperado, tolerancia){
  total++;
  var ok;
  if(typeof esperado === "number"){
    ok = Math.abs(obtenido - esperado) <= (tolerancia === undefined ? 1e-6 : tolerancia);
  }else{
    ok = obtenido === esperado;
  }
  if(!ok) fallas++;
  console.log((ok ? "  PASS " : "  FALLA") + " | " + nombre + " -> " + obtenido + (ok ? "" : "  (esperado " + esperado + ")"));
}
function bloque(t){ console.log("\n" + t); }

/* ---------------------------------------------------------------- */
bloque("Normalización de nombres de nave");
chequear("quita el prefijo MN", C.normalizar("MN CHINA TRIUMPH"), "CHINA TRIUMPH");
chequear("quita M/V", C.normalizar("M/V Star Ariadne"), "STAR ARIADNE");
chequear("quita acentos y puntuación", C.normalizar("NAVIOS  PHOÉNIX."), "NAVIOS PHOENIX");
chequear("no come el nombre si no hay prefijo", C.normalizar("SEACON AFRICA"), "SEACON AFRICA");
// "MN" es prefijo, pero una nave que empiece por esas letras no debe perderlas.
chequear("no confunde prefijo con nombre", C.normalizar("MNEMOSYNE"), "MNEMOSYNE");

/* ---------------------------------------------------------------- */
bloque("Distancia de edición");
chequear("iguales", C.distancia("CHINA TRIUMPH", "CHINA TRIUMPH"), 0);
chequear("una letra cambiada", C.distancia("CHINA THIUMPH", "CHINA TRIUMPH"), 1);
chequear("vacío contra algo", C.distancia("", "ABC"), 3);

/* ---------------------------------------------------------------- */
bloque("Emparejar la recalada abierta con su fila de temporada");
var temporada = [
  {nave:"CHINA TRIUMPH", rate:41906, cargo:200894, demurrage:601264, despatch:0},
  {nave:"STAR ARIADNE",  rate:25000, cargo:180000, demurrage:0, despatch:-12000},
  {nave:"NAVIOS PHOENIX", rate:30000, cargo:170000, demurrage:50000, despatch:0}
];
chequear("coincidencia exacta", C.emparejar("CHINA TRIUMPH", temporada).fila.rate, 41906);
chequear("la exacta se marca como exacta", C.emparejar("CHINA TRIUMPH", temporada).exacta, true);
/* El caso real: el CNN-EMB-434 escribe "MN CHINA THIUMPH" y la reportería
   "CHINA TRIUMPH". Emparejar por igualdad exacta dejaba fuera justo la
   recalada donde la diferencia era de US$ 619.552. */
var aprox = C.emparejar("MN CHINA THIUMPH", temporada);
chequear("tolera una letra cambiada", aprox.fila.nave, "CHINA TRIUMPH");
chequear("y avisa que no fue exacta", aprox.exacta, false);
chequear("una nave que no está no se inventa", C.emparejar("CAPE HORN", temporada), null);
/* Dos naves distintas del mismo armador pueden diferir en pocas letras:
   conciliar contra la equivocada es peor que no conciliar. */
chequear("no empareja naves realmente distintas",
  C.emparejar("STAR ARIADNE", [{nave:"STAR ARIANNA", rate:1}]), null);
chequear("sin temporada no empareja", C.emparejar("CHINA TRIUMPH", []), null);
chequear("sin nombre no empareja", C.emparejar("", temporada), null);

/* ---------------------------------------------------------------- */
bloque("Naves con más de una recalada en la temporada");
/* La temporada 2026 tiene tres: NISEKO QUEEN, PIGI y MINERAL BOTSWANA.
   Quedarse con la primera del libro es tomar la equivocada la mitad de las
   veces. Con la NISEKO QUEEN eso conciliaba una recalada de Q3 contra la
   fila de Q2 —el NOR de abril sobre un carguío de septiembre— y el botón de
   adoptar metía 139 días de demurrage: US$ 4.655.597 que no existen en
   ninguna parte. */
var niseko = [
  {nave:"NISEKO QUEEN", trimestre:"Q2", rate:33417, cargo:52099, demurrage:260281.30, despatch:0,
   nor:new Date(2026,3,26,5,12), atb:new Date(2026,4,4,20,30),
   inicioCarga:new Date(2026,4,4,22,30), finCarga:new Date(2026,4,6,13,33)},
  {nave:"NISEKO QUEEN", trimestre:"Q3", rate:39471, cargo:206000, demurrage:1554170.63, despatch:0,
   nor:new Date(2026,7,1), atb:new Date(2026,8,10),
   inicioCarga:new Date(2026,8,10), finCarga:new Date(2026,8,16)}
];
var q3 = C.emparejar("MN NISEKO QUEEN", niseko, {finCarga:new Date(2026,8,15,18,31)});
chequear("la recalada de septiembre se empareja con Q3", q3.fila.trimestre, "Q3");
chequear("y trae su demurrage, no el de Q2", q3.fila.demurrage, 1554170.63);
chequear("no queda ambigua", q3.ambigua, false);
chequear("pero avisa que había dos candidatas", q3.candidatas, 2);
var q2 = C.emparejar("NISEKO QUEEN", niseko, {finCarga:new Date(2026,4,6,10,0)});
chequear("la recalada de mayo se empareja con Q2", q2.fila.trimestre, "Q2");
/* Sin fechas no hay forma de saber cuál es: no se concilia. */
var sinFecha = C.emparejar("NISEKO QUEEN", niseko, {});
chequear("sin fechas no elige una al azar", sinFecha.fila, null);
chequear("y lo declara ambigua", sinFecha.ambigua, true);
chequear("con motivo", /no hay fechas/.test(sinFecha.motivo), true);
/* Una fecha que no cuadra con ninguna tampoco autoriza a elegir. */
var lejos = C.emparejar("NISEKO QUEEN", niseko, {finCarga:new Date(2026,0,15)});
chequear("una fecha lejana a todas no empareja", lejos.fila, null);
chequear("con su motivo", /ninguna cuadra/.test(lejos.motivo), true);
/* Dos recaladas a menos de dos semanas no se distinguen con confianza:
   una recalada dura una semana. */
var juntas = C.emparejar("PIGI", [
  {nave:"PIGI", trimestre:"Q2", finCarga:new Date(2026,5,1,12,40), demurrage:66984},
  {nave:"PIGI", trimestre:"Q3", finCarga:new Date(2026,5,8,12,40), demurrage:100216}
], {finCarga:new Date(2026,5,4)});
chequear("dos fechas demasiado juntas quedan ambiguas", juntas.ambigua, true);
chequear("con su motivo", /demasiado parecidas/.test(juntas.motivo), true);
/* Una sola recalada no necesita fechas para nada. */
chequear("con una sola candidata las fechas no hacen falta",
  C.emparejar("CHINA TRIUMPH", temporada, {}).fila.rate, 41906);

/* ---------------------------------------------------------------- */
bloque("Conciliación — reproduce la CNN-EMB-434 contra la reportería 2026");
/* Lo que muestra el tablero hoy con los dos libros cargados:
     Recalada  : despatch US$ 18.287,50  (rate 30.000, inicio en 1ª espía)
     Temporada : demurrage US$ 601.264   (rate 41.906, NOR 14-ago)          */
var fila = {nave:"CHINA TRIUMPH", rate:41906, cargo:200894,
            demurrage:601264, despatch:0, nor:new Date(2026,7,14,7,54)};
var app = {
  tarifaDia: 30000, tonelaje: 202550, tasaDia: 30000,
  baseInicio: "amarre", nor: null, primeraEspia: new Date(2026,7,30,16,42),
  permitido: 162.04, horasUsadas: 132.78, neto: -18287.50
};
var c = C.conciliar(app, fila);
chequear("liquidado", c.liquidado, 601264);
chequear("propio", c.propio, -18287.5);
chequear("diferencia", c.diferencia, 619551.5, 0.01);
chequear("tres causas", c.causas.length, 3);
chequear("la primera es el rate", c.causas[0].clave, "rate");
chequear("la segunda es el NOR", c.causas[1].clave, "nor");
chequear("la tercera es el tonelaje", c.causas[2].clave, "tonelaje");
/* La causa del NOR es la que explica casi todo: 16,4 días de espera en rada
   a 41.906 US$/día. Es la que convierte un despatch en un demurrage. */
chequear("el NOR vale ~16,4 días de rate",
  Math.round(c.causas[1].monto), Math.round(16.36667 * 41906), 2000);
/* Dentro del laytime el rate no cambia nada: multiplica un exceso que no
   existe. No se le puede atribuir plata. */
chequear("el rate no suma monto si no hubo exceso", c.causas[0].monto, 0);
chequear("el despatch del libro entra con su signo",
  C.netoLiquidado({demurrage:0, despatch:-12000}), -12000);

bloque("Conciliación — sin diferencias que declarar");
var igual = C.conciliar(
  {tarifaDia:41906, tonelaje:200894, tasaDia:30000, nor:new Date(2026,7,14,7,54),
   permitido:160.72, horasUsadas:505.07, neto:601264},
  {nave:"CHINA TRIUMPH", rate:41906, cargo:200894, demurrage:601264, despatch:0,
   nor:new Date(2026,7,14,7,54)});
chequear("sin causas cuando todo calza", igual.causas.length, 0);
chequear("y sin diferencia", igual.diferencia, 0);
chequear("sin fila no concilia", C.conciliar(app, null), null);

bloque("Traer el NOR de la reportería a todo el historial");
/* El plan de embarque es otra fuente: de ahí sale el ETA nominado. Vacío en
   estas comprobaciones, que son sobre el NOR. */
var PLAN = [];
/* El CNN-EMB no trae el NOR: sale del PDF de la agencia o se escribe a mano,
   y por eso casi todo el historial quedó contando el laytime desde el
   amarre. Traerlo en bloque es la diferencia entre un despatch a favor y
   seiscientos mil dólares de demurrage, recalada por recalada. */
var historial = [
  {id:"r1", campos:{nave:"MN CHINA THIUMPH", codigo:"CNN-EMB-434", nor:"",
                    baseInicio:"amarre", finCarga:"2026-09-05T13:30"}},
  {id:"r2", campos:{nave:"NISEKO QUEEN", codigo:"CNN-EMB-420", nor:"",
                    baseInicio:"amarre", finCarga:"2026-09-15T18:31"}},
  {id:"r3", campos:{nave:"CAPE HORN", codigo:"CNN-EMB-999", nor:"",
                    baseInicio:"amarre", finCarga:"2026-07-01T10:00"}},
  {id:"r4", campos:{nave:"CHINA TRIUMPH", codigo:"CNN-EMB-434B",
                    nor:"2026-08-14T07:54", baseInicio:"loPrimero",
                    finCarga:"2026-09-05T13:30"}}
];
var libro = temporada.concat(niseko).map(function(f){
  return f.nor ? f : Object.assign({}, f, {nor:new Date(2026,7,14,7,54)});
});
var act = C.actualizarNor(historial, libro, PLAN);
chequear("cuatro recaladas revisadas", act.resumen.total, 4);
chequear("dos NOR agregados", act.resumen.agregados, 2);
chequear("uno ya estaba igual", act.resumen.iguales, 1);
chequear("uno sin emparejar", act.resumen.sinEmparejar, 1);
/* El NOR se guarda como la cadena local que usa el formulario, no como un
   Date: escribir un objeto ahí reventaba el recálculo de flota, y al
   serializarlo a JSON quedaba en UTC y el NOR se corría de hora en cualquier
   navegador fuera de Greenwich. */
chequear("el NOR llega a la 434 en formato de campo",
  act.lista[0].campos.nor, "2026-08-14T07:54");
chequear("y es una cadena, no un Date", typeof act.lista[0].campos.nor, "string");
/* Poner el NOR sin cambiar la base sería poner el dato y no usarlo: el
   laytime seguiría contando desde el amarre y nada cambiaría en pantalla. */
chequear("y con él la base pasa a «lo primero que ocurra»",
  act.lista[0].campos.baseInicio, "loPrimero");
chequear("la NISEKO QUEEN toma el NOR de su propia recalada",
  act.lista[1].campos.nor, "2026-08-01T00:00");
chequear("la que no está en el libro se queda como estaba",
  act.lista[2].campos.nor, "");
chequear("y se dice por qué",
  /no está en el libro/.test(act.detalle[2].motivo), true);
chequear("la que ya tenía el NOR correcto no se toca", act.detalle[3].estado, "igual");
/* No muta la lista original: quien aprieta el botón tiene que poder ver el
   detalle antes de aceptar. */
chequear("no toca el historial que recibe", historial[0].campos.nor, "");
chequear("ni la base del original", historial[0].campos.baseInicio, "amarre");

var reemplazo = C.actualizarNor(
  [{id:"x", campos:{nave:"CHINA TRIUMPH", nor:"2026-08-30T17:36",
                    baseInicio:"nor", finCarga:"2026-09-05T13:30"}}], libro, PLAN);
chequear("un NOR distinto se marca como reemplazo", reemplazo.resumen.reemplazados, 1);
chequear("y queda el anterior en el detalle",
  reemplazo.detalle[0].norAnterior.toISOString(), new Date(2026,7,30,17,36).toISOString());
chequear("una base que no era amarre no se toca",
  reemplazo.lista[0].campos.baseInicio, "nor");
chequear("sin historial no hay nada que hacer", C.actualizarNor([], libro, PLAN).resumen.total, 0);

/* La marca de edición decide qué copia manda en la nube. Sin tocarla, la
   recalada queda corregida en un navegador y no sube nunca; y el día que
   otra persona edite ese embarque, su copia —sin el NOR— gana y borra la
   corrección. */
var T = new Date(2026, 8, 21, 20, 30).getTime();
var sello = C.actualizarNor(
  [{id:"s", actualizadoEn:"2026-09-01T10:00:00.000Z",
    campos:{nave:"CHINA TRIUMPH", nor:"", baseInicio:"amarre", finCarga:"2026-09-05T13:30"}}],
  libro, PLAN, T);
chequear("la recalada corregida se vuelve a marcar",
  sello.lista[0].actualizadoEn, new Date(T).toISOString());
var intacta = C.actualizarNor(
  [{id:"s", actualizadoEn:"2026-09-01T10:00:00.000Z",
    campos:{nave:"CAPE HORN", nor:"", finCarga:"2026-07-01T10:00"}}],
  libro, PLAN, T);
chequear("la que no cambió conserva su marca",
  intacta.lista[0].actualizadoEn, "2026-09-01T10:00:00.000Z");

/* ---------------------------------------------------------------- */
chequear("aCampo redondea a la cadena del formulario",
  C.aCampo(new Date(2026,8,5,13,30)), "2026-09-05T13:30");
chequear("aCampo sin fecha devuelve vacío", C.aCampo(null), "");
/* Ida y vuelta: lo que escribe aCampo tiene que volver a leerse igual. */
var L = require("../js/laytime.js");
chequear("lo que escribe vuelve a leerse igual",
  L.parseFechaHora(C.aCampo(new Date(2026,7,14,7,54))).getTime(),
  new Date(2026,7,14,7,54).getTime());

/* ---------------------------------------------------------------- */
bloque("El ETA nominado sale del plan de embarque");
/* La columna ETA/ATA del libro de reportería no sirve: en 19 de las 33
   recaladas de 2026 es idéntica al NOR, o sea el arribo real. Llenar el
   campo desde ahí haría que la ficha dijera «arribó en su ETA» siempre. El
   plan sí nomina: fechas a las 00:00 fijadas con semanas de anticipación. */
var PLAN_REAL = [
  {nave:"CHINA TRIUMPH",  trimestre:"Q3", eta:new Date(2026,7,14), etb:new Date(2026,7,30), etd:new Date(2026,8,5)},
  {nave:"PIGI",           trimestre:"Q3", eta:new Date(2026,7,25), etb:new Date(2026,8,5),  etd:new Date(2026,8,11)},
  {nave:"NISEKO QUEEN",   trimestre:"Q3", eta:new Date(2026,7,1),  etb:new Date(2026,8,12), etd:new Date(2026,8,17)},
  {nave:"MANTENIMIENTO",  trimestre:"Q4", etb:new Date(2026,9,18), etd:new Date(2026,9,24)}
];
var pc = C.emparejarPlan("MN CHINA THIUMPH", PLAN_REAL, {finCarga:"2026-09-05T13:30"});
chequear("empareja pese al nombre mal escrito", pc.fila.nave, "CHINA TRIUMPH");
chequear("y trae el ETA nominado", pc.fila.eta.toISOString(), new Date(2026,7,14).toISOString());
chequear("a menos de un día del ETD planificado", pc.dias < 1, true);

/* Una nave puede estar dos veces en el histórico y una sola en el plan: la
   NISEKO QUEEN cargó en mayo y en septiembre y el plan solo tiene la de
   septiembre. La de mayo está a 134 días y no puede emparejar. */
chequear("la recalada de septiembre empareja",
  !!C.emparejarPlan("NISEKO QUEEN", PLAN_REAL, {finCarga:"2026-09-16T00:00"}), true);
chequear("la de mayo no",
  C.emparejarPlan("NISEKO QUEEN", PLAN_REAL, {finCarga:"2026-05-06T13:33"}), null);
chequear("una nave que no está en el plan no empareja",
  C.emparejarPlan("CAPE HORN", PLAN_REAL, {finCarga:"2026-09-05T13:30"}), null);
chequear("sin fechas no se elige a ciegas",
  C.emparejarPlan("CHINA TRIUMPH", PLAN_REAL, {}), null);
chequear("sin plan no hay nada que buscar",
  C.emparejarPlan("CHINA TRIUMPH", [], {finCarga:"2026-09-05T13:30"}), null);

/* En el lote: el ETA viaja junto al NOR, pero por su cuenta. Una recalada
   puede estar en el plan y no en el libro, o al revés. */
var conPlan = C.actualizarNor(
  [{id:"a", campos:{nave:"CHINA TRIUMPH", codigo:"CNN-EMB-434", nor:"", eta:"",
                    baseInicio:"amarre", finCarga:"2026-09-05T13:30"}}],
  libro, PLAN_REAL, T);
chequear("trae el ETA del plan", conPlan.lista[0].campos.eta, "2026-08-14T00:00");
chequear("y lo cuenta en el resumen", conPlan.resumen.etas, 1);
/* Un ETA que ya está puesto no se pisa: puede ser el del contrato de
   fletamento, que manda sobre el plan interno. */
var conEta = C.actualizarNor(
  [{id:"b", campos:{nave:"CHINA TRIUMPH", nor:"2026-08-14T07:54", eta:"2026-08-10T06:00",
                    baseInicio:"loPrimero", finCarga:"2026-09-05T13:30"}}],
  libro, PLAN_REAL, T);
chequear("un ETA ya puesto no se reemplaza", conEta.lista[0].campos.eta, "2026-08-10T06:00");
/* Y una recalada que no está en el libro pero sí en el plan igual recibe su
   ETA: son dos fuentes distintas y no tienen por qué coincidir. */
var soloPlan = C.actualizarNor(
  [{id:"c", campos:{nave:"GINKGO ARROW", nor:"", eta:"", finCarga:"2026-09-19T10:00"}}],
  libro, [{nave:"GINKGO ARROW", trimestre:"Q3", eta:new Date(2026,8,17), etd:new Date(2026,8,19)}], T);
chequear("sin fila en el libro pero con fila en el plan, trae el ETA",
  soloPlan.lista[0].campos.eta, "2026-09-17T00:00");
chequear("y queda marcada como cambio de ETA", soloPlan.detalle[0].estado, "eta");

/* ---------------------------------------------------------------- */
bloque("Datos de contrato que la recalada puede adoptar");
var d = C.datosDeContrato(fila);
chequear("rate", d.tarifaDemurrage, 41906);
chequear("tonelaje", d.tonelaje, 200894);
chequear("NOR", d.nor.toISOString(), new Date(2026,7,14,7,54).toISOString());

/* ---------------------------------------------------------------- */
bloque("Toneladas embarcadas del periodo");
/* El filtro de arriba recorta el LIBRO; el calado vive en el CNN-EMB, que es
   otro archivo. La suma cruza los dos con el mismo emparejador que usa la
   conciliación, para no tener dos reglas de decidir si dos filas son la
   misma nave. */
var F = function(s){ var m=/(\d{4})-(\d{2})-(\d{2})/.exec(s); return new Date(+m[1],+m[2]-1,+m[3]); };
var libroMes = [
  {trimestre:"Q3", nave:"CHINA TRIUMPH", cargo:204175, finCarga:F("2026-09-05")},
  {trimestre:"Q3", nave:"MN PIGI",       cargo:180000, finCarga:F("2026-09-18")},
  {trimestre:"Q3", nave:"NISEKO QUEEN",  cargo:200000, finCarga:F("2026-09-28")}
];
function cnn(nave, fin, extra){
  return {campos: Object.assign({nave:nave, finCarga:fin}, extra || {})};
}
var conCalado = C.tonelajeEmbarcado(libroMes, [
  cnn("MN CHINA TRIUMPH", "2026-09-05T13:30", {rteCalado:"202550", rtePesometro09:"202000"}),
  cnn("PIGI",             "2026-09-18T10:00", {rteCalado:"181200"})
]);
/* Manda el calado sobre el pesómetro: es la misma precedencia que aplica el
   lector del CNN-EMB, y es lo que se liquida. */
chequear("suma los dos calados", conCalado.total, 202550 + 181200);
chequear("y no mira el pesómetro cuando hay calado", conCalado.pesometro, 0);
chequear("dice cuántas traen draft survey", conCalado.conCalado, 2);
chequear("y cuántas naves tiene el periodo", conCalado.naves, 3);
/* El denominador importa: sin él, un total parcial se lee como el total. */
chequear("la que no tiene CNN-EMB se cuenta aparte", conCalado.sinCnnEmb, 1);
chequear("el cargo del libro queda para contrastar", conCalado.cargoLibro, 584175);

/* Sin calado se cae al pesómetro, pero contado por separado. */
var soloPeso = C.tonelajeEmbarcado(libroMes, [
  cnn("MN CHINA TRIUMPH", "2026-09-05T13:30", {rtePesometro09:"202000"})
]);
chequear("sin calado usa el pesómetro", soloPeso.total, 202000);
chequear("y no lo cuenta como draft survey", soloPeso.conCalado, 0);
chequear("pero sí como dato", soloPeso.conDato, 1);

/* Una nave que no está en el periodo filtrado no suma: es lo que hace que
   el filtro de arriba funcione. */
var fuera = C.tonelajeEmbarcado(libroMes, [
  cnn("SEACON AFRICA", "2026-01-15T10:00", {rteCalado:"203160"})
]);
chequear("una nave ajena al periodo no suma", fuera.total, 0);
chequear("y el periodo sigue teniendo sus tres naves", fuera.naves, 3);
chequear("las tres quedan sin CNN-EMB", fuera.sinCnnEmb, 3);

/* Dos CNN-EMB que emparejan con la misma fila del libro —reimportar la misma
   recalada con otro código— sumarían el embarque dos veces. */
var duplicado = C.tonelajeEmbarcado(libroMes, [
  cnn("MN CHINA TRIUMPH", "2026-09-05T13:30", {rteCalado:"202550"}),
  cnn("CHINA TRIUMPH",    "2026-09-05T14:00", {rteCalado:"202550"})
]);
chequear("no suma dos veces la misma recalada", duplicado.total, 202550);
chequear("ni la cuenta dos veces", duplicado.conDato, 1);

/* Casos de borde: nada que cruzar. */
chequear("sin flota, cero", C.tonelajeEmbarcado(libroMes, []).total, 0);
chequear("sin flota, el periodo igual se describe", C.tonelajeEmbarcado(libroMes, []).sinCnnEmb, 3);
chequear("sin recaladas, cero naves", C.tonelajeEmbarcado([], []).naves, 0);
chequear("sin argumentos no revienta", C.tonelajeEmbarcado().total, 0);
/* Un CNN-EMB sin ninguna cifra de tonelaje no inventa una. */
chequear("sin tonelaje de ningún tipo no suma",
  C.tonelajeEmbarcado(libroMes, [cnn("MN CHINA TRIUMPH", "2026-09-05T13:30", {})]).conDato, 0);

/* ---------------------------------------------------------------- */
bloque("Toneladas del periodo según las planillas de turno");
/* Cuando están las planillas del mes, la cifra es exacta: la hoja
   «ACUMULADO EMBARQUE» es la fuente del draft survey. Sumar nave por nave
   da casi lo mismo —0,06 % en la temporada— pero «casi» no se presenta. */
var sept = [
  {trimestre:"Q3", nave:"CHINA TRIUMPH", cargo:200894, finCarga:F("2026-09-05")},
  {trimestre:"Q3", nave:"MINERAL COMOROS", cargo:206000, finCarga:F("2026-09-24")}
];
var planillas = {"2026-09": {totalMineral: 813584}, "2026-08": {totalMineral: 837421}};
var unMes = C.embarcadoDeTurno(sept, planillas);
chequear("un solo mes, la cifra de su planilla", unMes.total, 813584);
chequear("y queda completo", unMes.completo, true);
chequear("sin meses que falten", unMes.faltan.length, 0);

/* Dos meses: se suman las dos planillas. */
var dosMeses = C.embarcadoDeTurno(sept.concat([
  {trimestre:"Q3", nave:"PAN UNIVERSAL", cargo:203105, finCarga:F("2026-08-20")}
]), planillas);
chequear("dos meses se suman", dosMeses.total, 813584 + 837421);
chequear("y los nombra en orden", dosMeses.meses.join(","), "2026-08,2026-09");

/* La guarda que importa: con una planilla faltando, el total daría de menos
   sin decirlo. Se marca incompleto para que la ficha caiga al otro camino. */
var incompleto = C.embarcadoDeTurno(sept.concat([
  {trimestre:"Q3", nave:"JUDD", cargo:203513, finCarga:F("2026-06-10")}
]), planillas);
chequear("con un mes sin planilla, incompleto", incompleto.completo, false);
chequear("y dice cuál falta", incompleto.faltan.join(","), "2026-06");
chequear("sin planillas, nada completo", C.embarcadoDeTurno(sept, {}).completo, false);
chequear("sin recaladas tampoco", C.embarcadoDeTurno([], planillas).completo, false);
chequear("sin argumentos no revienta", C.embarcadoDeTurno().total, 0);

/* El mes sale del fin de carguío, no del NOR: una nave que empieza en
   agosto y termina en septiembre embarcó contra la planilla de septiembre,
   que es donde su tonelaje quedó anotado. */
chequear("el mes lo fija el fin de carguío",
  C.embarcadoDeTurno([{finCarga:F("2026-09-05"), nor:F("2026-08-14")}], planillas).meses[0],
  "2026-09");
/* Y si no hay fin de carguío todavía, se cae al atraque y luego al NOR. */
chequear("sin fin de carguío, manda el atraque",
  C.embarcadoDeTurno([{atb:F("2026-08-30"), nor:F("2026-08-14")}], planillas).meses[0],
  "2026-08");

console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
process.exit(fallas === 0 ? 0 : 1);
