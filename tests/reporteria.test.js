/**
 * Pruebas del lector del libro de reportería.  node tests/reporteria.test.js
 */
var XLSX = require("../js/vendor/xlsx.full.min.js");
var R = require("../js/reporteria.js");

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
function libro(hojas){
  var wb = XLSX.utils.book_new();
  Object.keys(hojas).forEach(function(n){
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojas[n]), n);
  });
  return XLSX.read(XLSX.write(wb, {type:"array", bookType:"xlsx"}), {type:"array", cellDates:true});
}
var D = function(y,m,d,h,mi){ return new Date(y, m-1, d, h||0, mi||0); };

var CAB_REC = ["Quarter","VESSEL","INCO","PRODUCT","LAYCAN FROM","LAYCAN TO","ETA/ATA",
               "NOR DATE","CARGO","ATB","LOADING START","LOADING FINISHED","DEM RATE",
               "DEMURRAGE","DESPATCH","Comments"];

/* ---------------------------------------------------------------- */
bloque("Una fila por recalada");
var wb = libro({
  "PUNTA TOTORALILLO": [
    CAB_REC,
    ["Q1","STAR ARIADNE","CFR","MIX",D(2025,12,19),D(2025,12,25),D(2025,12,26),D(2025,12,26),
     204175,D(2026,1,2,16,6),D(2026,1,2,17,30),D(2026,1,8,9,7),38196,280316.24,null,"congestión"],
    ["Q1","SEACON AFRICA","CFR","ATACAMA",D(2026,1,6),D(2026,1,14),D(2026,1,9),D(2026,1,9),
     203160,D(2026,1,9,19,54),D(2026,1,9,21,22),D(2026,1,15,5,56),33500,null,-30347.82,""],
    [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null,6420314.16,null,null,null,null,null,null,null]
  ]
});
var r = R.desdeLibro(wb);
var rec = r.datos.recaladas;
chequear("dos recaladas (la fila de totales no cuenta)", rec.length, 2);
chequear("nave", rec[0].nave, "STAR ARIADNE");
chequear("trimestre", rec[0].trimestre, "Q1");
chequear("tonelaje", rec[0].cargo, 204175);
chequear("demurrage", rec[0].demurrage, 280316.24);
chequear("sin despatch queda en cero", rec[0].despatch, 0);
chequear("el despatch conserva su signo del libro", rec[1].despatch, -30347.82);
chequear("y esa fila no tiene demurrage", rec[1].demurrage, 0);
chequear("lee el ATB con hora", rec[0].atb.getHours() + ":" + rec[0].atb.getMinutes(), "16:6");
chequear("arrastra el comentario", rec[0].comentario, "congestión");

/* ---------------------------------------------------------------- */
bloque("Detenciones: la hoja repite la nave solo en su primera fila");
var wbd = libro({
  "PUNTA TOTORALILLO": [CAB_REC],
  "Delays": [
    ["mt/day", 30000],
    ["QUARTER","VESSEL","LAYCAN START","ETA/ATA","NOR DATE","CARGO","TIME ALLOWED",
     "NET TIME USED","LOADING START","LOADING COMPLETED","DELAYS AS PER AGENTS SOF",
     "START"," END","DEMURRAGE RATE","TOTAL TIME BY DELAY","ESTIMATED COST OF DELAYS",
     "details","TERMINAL COMMENTS","OBSERVACIONES"],
    ["Q1","STAR ARIADNE",null,null,null,null,null,null,null,null,"GENERAL CONGESTION",
     D(2025,12,24,6,0),D(2025,12,31,15,0),38196,7.38,281695.5,"Terminal ocupado","",""],
    [null,null,null,null,null,null,null,null,null,null,"TERMINAL MAINTENANCE",
     D(2026,1,3,3,27),D(2026,1,3,4,32),38196,0.05,1724.12,"","Detención línea","Colación"],
    [null,null,null,null,null,null,null,null,null,null,"OTHER TERMINAL DELAYS",
     D(2026,1,3,6,34),D(2026,1,3,7,15),38196,0.03,1087.53,"","",""]
  ]
});
var det = R.desdeLibro(wbd).datos.detenciones;
chequear("tres detenciones", det.length, 3);
chequear("la primera trae su nave", det[0].nave, "STAR ARIADNE");
chequear("la segunda la hereda", det[1].nave, "STAR ARIADNE");
chequear("y también el trimestre", det[2].trimestre, "Q1");
chequear("días de la primera", det[0].dias, 7.38);
chequear("costo de la primera", det[0].costo, 281695.5);
chequear("categoría de la tercera", det[2].categoria, "OTHER TERMINAL DELAYS");
chequear("comentario del terminal", det[1].comentarioTerminal, "Detención línea");

/* ---------------------------------------------------------------- */
bloque("Tiempos: espera antes del amarre");
var wbt = libro({
  "PUNTA TOTORALILLO": [CAB_REC],
  "Ops time VS Time allowed": [
    [], [null,null,null,null,null,null,null,null,null,null,null,null,null,"nota"], [],
    ["Quarter","VESSEL","NOR","BL DATE","Espera antes de amarre","Mal Tiempo",
     "Operación de Carga","average daily loading rate","Contract","TIME ALLOWED",
     "NET TIME USED","Delays from NOR to berth"],
    ["Q1","STAR ARIADNE",D(2025,12,26),D(2026,1,8),13.38,null,5.65,36132.73,30000,6.81,14.14,7.67],
    ["Q3","CHINA TRIUMPH",D(2026,8,14),D(2026,9,5),22.23,0.21,5.76,34900.15,30000,6.7,21.75,16.2]
  ]
});
var ti = R.desdeLibro(wbt).datos.tiempos;
chequear("dos filas de tiempos", ti.length, 2);
chequear("espera antes del amarre", ti[0].esperaAmarre, 13.38);
chequear("operación de carga", ti[0].operacionCarga, 5.65);
chequear("time allowed", ti[0].timeAllowed, 6.81);
chequear("mal tiempo ausente queda en cero", ti[0].malTiempo, 0);
chequear("y presente se lee", ti[1].malTiempo, 0.21);
chequear("CHINA TRIUMPH esperó 22,23 días", ti[1].esperaAmarre, 22.23);

/* ---------------------------------------------------------------- */
bloque("Clima: tres bloques lado a lado");
var wbc = libro({
  "PUNTA TOTORALILLO": [CAB_REC],
  "Weather Cause": (function(){
    var f = [];
    for(var i = 0; i < 12; i++) f.push([]);
    f.push(["Causa","Días",null,"Causa","Días",null,"Causa","Días"]);       // fila 13
    f.push(["Mal Tiempo",0,null,"Mal Tiempo",1.96,null,"Mal Tiempo",6.31]); // fila 14
    f.push(["Marejada",0,null,"Marejada",8.92,null,"Marejada",7.18]);
    f.push(["Viento",1.4,null,"Viento",0,null,"Viento",0]);
    f.push(["Visibilidad",0,null,"Visibilidad",0,null,"Visibilidad",0.61]);
    f.push(["Sin detención",88.6,null,"Sin detención",79.12,null,"Sin detención",47.9]);
    return f;
  })()
});
var cl = R.desdeLibro(wbc).datos.clima;
chequear("cuatro causas por trimestre, sin el complemento", cl.length, 12);
chequear("no incluye «Sin detención»",
  cl.filter(function(c){ return c.causa.indexOf("Sin") === 0; }).length, 0);
var q3m = cl.filter(function(c){ return c.trimestre === "Q3" && c.causa === "Marejada"; })[0];
chequear("marejada de Q3", q3m.dias, 7.18);
var q1v = cl.filter(function(c){ return c.trimestre === "Q1" && c.causa === "Viento"; })[0];
chequear("viento de Q1", q1v.dias, 1.4);

/* ---------------------------------------------------------------- */
bloque("Plan: manda el bloque de más abajo, que es el vigente");
var wbp = libro({
  "PUNTA TOTORALILLO": [CAB_REC],
  "Plan de embarque": [
    [],
    [null,"Trimestre","MES","PUERTO","INICIO LAYCAN","FIN LAYCAN","ETA/ATA","ETB/ATB","ETD",
     "NAVE","INCO","CONTRATO","DESTINO","PRODUCTO","CNN","ASF","TOTAL"],
    [null,"Q3","SEP","PPT",D(2026,8,14),D(2026,8,20),D(2026,8,14),D(2026,8,30),D(2026,9,5),
     "CHINA TRIUMPH","CFR","viejo","CHINA","MIX",135840,65000,200840],
    [],
    [null,"Trimestre","MES","PUERTO","INICIO LAYCAN","FIN LAYCAN","ETA/ATA","ETB/ATB","ETD",
     "NAVE","INCO","CONTRATO","DESTINO","PRODUCTO","CNN","ASF","TOTAL"],
    [null,"Q3","SEP","PPT",D(2026,8,14),D(2026,8,20),D(2026,8,14),D(2026,8,30),D(2026,9,5),
     "CHINA TRIUMPH","CFR","CMP-TRF-SPT26-03","CHINA","MIX",135872,65022,200894],
    [null,"Q4","OCT","PPT",D(2026,10,1),D(2026,10,7),D(2026,10,3),D(2026,10,4),D(2026,10,9),
     "MINERAL BOTSWANA","FOB","CMP-GLE-LTC-26-02","CHINA","CNN",204625,null,204625]
  ]
});
var pl = R.desdeLibro(wbp).datos.plan;
chequear("solo el bloque vigente", pl.length, 2);
chequear("toma el contrato actualizado", pl[0].contrato, "CMP-TRF-SPT26-03");
chequear("y el tonelaje actualizado", pl[0].tonelaje, 200894);
chequear("incluye lo que viene en Q4", pl[1].nave, "MINERAL BOTSWANA");

/* ---------------------------------------------------------------- */
bloque("Avisos cuando algo falta o no calza");
var soloRec = R.desdeLibro(libro({"PUNTA TOTORALILLO": [
  CAB_REC, ["Q1","UNO","CFR","MIX",null,null,null,null,1000,null,null,null,null,100,null,""]]}));
chequear("avisa que no hay hoja de tiempos",
  soloRec.avisos.some(function(a){ return a.indexOf("Ops time") >= 0; }), true);
chequear("avisa que no hay hoja de detenciones",
  soloRec.avisos.some(function(a){ return a.indexOf("Delays") >= 0; }), true);

var descuadre = R.desdeLibro(libro({
  "PUNTA TOTORALILLO": [
    CAB_REC,
    ["Q1","CON TIEMPOS","CFR","MIX",null,null,null,null,1000,null,null,null,null,100,null,""],
    ["Q1","SIN TIEMPOS","CFR","MIX",null,null,null,null,1000,null,null,null,null,900,null,""]],
  "Ops time VS Time allowed": [
    [], [], [],
    ["Quarter","VESSEL","NOR","BL DATE","Espera antes de amarre","Mal Tiempo",
     "Operación de Carga","rate","Contract","TIME ALLOWED","NET TIME USED","Delays"],
    ["Q1","CON TIEMPOS",null,null,3,null,2,null,30000,5,4,1]]
}));
chequear("nombra la nave sin tiempos",
  descuadre.avisos.some(function(a){ return a.indexOf("SIN TIEMPOS") >= 0; }), true);

/* La nave que vuelve: misma nave, dos trimestres, fila de tiempos en uno
   solo. Emparejando por nombre pelado el aviso callaba —«ya existe una fila
   de esa nave»— mientras la espera del otro trimestre quedaba fuera del
   total sin que nadie lo supiera. La llave lleva el trimestre. */
var vuelve = R.desdeLibro(libro({
  "PUNTA TOTORALILLO": [
    CAB_REC,
    ["Q2","NISEKO QUEEN","CFR","MIX",null,null,null,null,1000,null,null,null,null,100,null,""],
    ["Q3","NISEKO QUEEN","CFR","MIX",null,null,null,null,1000,null,null,null,null,900,null,""]],
  "Ops time VS Time allowed": [
    [], [], [],
    ["Quarter","VESSEL","NOR","BL DATE","Espera antes de amarre","Mal Tiempo",
     "Operación de Carga","rate","Contract","TIME ALLOWED","NET TIME USED","Delays"],
    ["Q2","NISEKO QUEEN",null,null,3,null,2,null,30000,5,4,1]]
}));
var avisoVuelve = vuelve.avisos.filter(function(a){ return a.indexOf("Sin tiempos de espera") === 0; })[0] || "";
chequear("avisa por el trimestre que no tiene fila de tiempos",
  avisoVuelve.indexOf("NISEKO QUEEN (Q3)") >= 0, true);
chequear("y no por el que sí la tiene",
  avisoVuelve.indexOf("(Q2)") >= 0, false);

var vacio = R.desdeLibro(libro({"OTRA": [["nada"]]}));
chequear("sin la hoja principal lo dice",
  vacio.avisos.some(function(a){ return a.indexOf("PUNTA TOTORALILLO") >= 0; }), true);
chequear("y no inventa recaladas", vacio.datos.recaladas.length, 0);

/* ---------------------------------------------------------------- */
bloque("El trimestre declarado contra las fechas de la fila");
/* Los trimestres son los del calendario: Q1 enero-marzo, Q4 octubre-diciembre.
   El libro los declara en la columna A y esa columna manda —no se deduce de
   la fecha, porque el libro es lo que se presenta y se audita— pero cuando no
   cuadra hay que decirlo. Pasó de verdad: MINERAL BOTSWANA con laycan, NOR,
   atraque y carga los siete en octubre, rotulada Q3. Con eso Q4 no aparecía
   en el filtro y la nave sumaba en el trimestre equivocado. */
function F(iso){ return new Date(iso + "T12:00:00"); }
chequear("enero es Q1", R.trimestreDeFecha(F("2026-01-15")), "Q1");
chequear("marzo también", R.trimestreDeFecha(F("2026-03-31")), "Q1");
chequear("abril es Q2", R.trimestreDeFecha(F("2026-04-01")), "Q2");
chequear("septiembre es Q3", R.trimestreDeFecha(F("2026-09-30")), "Q3");
chequear("octubre es Q4", R.trimestreDeFecha(F("2026-10-01")), "Q4");
chequear("y diciembre también", R.trimestreDeFecha(F("2026-12-31")), "Q4");
chequear("basura no da trimestre", R.trimestreDeFecha("x"), null);

var mal = R.desencajadas([{nave:"MINERAL BOTSWANA", trimestre:"Q3",
  laycanDesde:F("2026-10-01"), laycanHasta:F("2026-10-07"), eta:F("2026-10-03"),
  nor:F("2026-10-03"), atb:F("2026-10-04"), inicioCarga:F("2026-10-04"),
  finCarga:F("2026-10-09")}]);
chequear("la fila mal rotulada se detecta", mal.length, 1);
chequear("y se dice cuál debería ser", mal[0].porFecha, "Q4");
chequear("con lo que declara el libro", mal[0].declarado, "Q3");
chequear("y el rango de fechas que lo demuestra", mal[0].desde + " a " + mal[0].hasta,
  "2026-10-01 a 2026-10-09");

/* Lo que NO tiene que reclamar: una nave que cruza el corte de verdad. El
   libro puede ponerla en cualquiera de los dos trimestres con razón, y un
   aviso que se equivoca se deja de leer. */
chequear("una nave que cruza el corte no se reclama",
  R.desencajadas([{nave:"NEGONEGO", trimestre:"Q3",
    atb:F("2026-09-29"), inicioCarga:F("2026-09-30"), finCarga:F("2026-10-02")}]).length, 0);
chequear("ni la que cuadra con lo declarado",
  R.desencajadas([{nave:"JUDD", trimestre:"Q2", finCarga:F("2026-06-06")}]).length, 0);
/* Sin trimestre declarado no hay nada que contrastar: eso ya lo avisa el
   lector por otro lado. */
chequear("sin trimestre no se reclama",
  R.desencajadas([{nave:"SIN Q", finCarga:F("2026-10-02")}]).length, 0);
chequear("sin fechas tampoco",
  R.desencajadas([{nave:"SIN FECHAS", trimestre:"Q1"}]).length, 0);
chequear("sin recaladas no revienta", R.desencajadas().length, 0);

console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
process.exit(fallas === 0 ? 0 : 1);
