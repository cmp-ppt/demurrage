/**
 * Pruebas de las alertas meteorológicas.  Ejecutar con:  node tests/clima.test.js
 * El fixture reproduce la forma de respuesta de Open-Meteo.
 */
var C = require("../js/clima.js");

var fallas = 0, total = 0;
function chequear(nombre, obtenido, esperado){
  total++;
  var ok = obtenido === esperado;
  if(!ok) fallas++;
  console.log((ok ? "  PASS " : "  FALLA") + " | " + nombre + " -> " + obtenido + (ok ? "" : "  (esperado " + esperado + ")"));
}
function bloque(t){ console.log("\n" + t); }

/* Un día: calma hasta las 12, se levanta el viento en la tarde, calma de noche. */
var horas = [], viento = [], rafaga = [], direccion = [], visibilidad = [];
for(var h = 0; h < 24; h++){
  horas.push("2026-09-10T" + String(h).padStart(2,"0") + ":00");
  viento.push(h >= 13 && h <= 19 ? (h === 16 ? 27.4 : 22.5) : 11.0);
  rafaga.push(h >= 13 && h <= 19 ? (h === 16 ? 34.0 : 26.0) : 15.0);
  direccion.push(215);
  visibilidad.push(h === 6 ? 800 : 24000);
}
var PRONOSTICO = {hourly: {time: horas, wind_speed_10m: viento, wind_gusts_10m: rafaga,
                           wind_direction_10m: direccion, visibility: visibilidad}};
var MARINO = {hourly: {time: horas,
  wave_height: horas.map(function(_, i){ return i >= 15 && i <= 18 ? 2.6 : 1.2; }),
  wave_period: horas.map(function(){ return 11; })}};

/* ---------------------------------------------------------------- */
bloque("Armado de la serie");
var serie = C.combinar(PRONOSTICO, MARINO);
chequear("24 horas", serie.length, 24);
chequear("hora local sin desfase", serie[13].hora.getHours(), 13);
chequear("viento de las 16", serie[16].viento, 27.4);
chequear("ola cruzada del servicio marino", serie[16].ola, 2.6);
var sinMar = C.combinar(PRONOSTICO, null);
chequear("sin datos marinos la serie sigue", sinMar.length, 24);
chequear("y la ola queda nula", sinMar[16].ola, null);

/* ---------------------------------------------------------------- */
bloque("Evaluación contra los umbrales del terminal");
chequear("11 kn opera", C.evaluar(serie[3]).nivel, "ok");
chequear("22,5 kn detiene el embarque", C.evaluar(serie[13]).nivel, "aviso");
chequear("27,4 kn es alerta", C.evaluar(serie[16]).nivel, "alerta");
chequear("la razón se nombra", C.evaluar(serie[13]).motivos[0], "viento 22.5 kn");
chequear("visibilidad de 800 m es alerta", C.evaluar(serie[6]).nivel, "alerta");
chequear("marejada 2,6 m es alerta", C.evaluar({ola:2.6}).nivel, "alerta");
chequear("marejada 2,1 m es aviso", C.evaluar({ola:2.1}).nivel, "aviso");
chequear("ráfaga de 32 kn con viento bajo igual alerta",
  C.evaluar({viento:14, rafaga:32}).nivel, "alerta");
chequear("justo en 20 kn ya detiene", C.evaluar({viento:20}).nivel, "aviso");
chequear("19,9 kn todavía opera", C.evaluar({viento:19.9}).nivel, "ok");
chequear("umbral configurable", C.evaluar({viento:18}, {vientoAviso:15, vientoAlerta:25}).nivel, "aviso");

/* ---------------------------------------------------------------- */
bloque("Ventanas de condición adversa");
var v = C.ventanas(serie);
chequear("dos ventanas: la niebla de la mañana y el viento de la tarde", v.length, 2);
chequear("la primera es la de las 06", v[0].desde.getHours(), 6);
chequear("dura una hora", v[0].horas, 1);
chequear("la segunda parte a las 13", v[1].desde.getHours(), 13);
chequear("y termina a las 20", v[1].hasta.getHours(), 20);
chequear("siete horas seguidas", v[1].horas, 7);
chequear("se queda con el nivel más alto del tramo", v[1].nivel, "alerta");
chequear("reporta el viento máximo", v[1].vientoMax, 27.4);
chequear("y la ola máxima", v[1].olaMax, 2.6);
chequear("nombra las causas", v[1].causas.sort().join(","), "marejada,ráfagas,viento");

var calma = C.ventanas(C.combinar({hourly:{time:horas, wind_speed_10m: horas.map(function(){ return 8; })}}, null));
chequear("un día sin condiciones adversas no genera ventanas", calma.length, 0);

/* ---------------------------------------------------------------- */
bloque("Ventana operativa");
var op = C.ventanaOperativa(serie, null, new Date(2026, 8, 10, 8, 0));
chequear("desde las 08 quedan 5 horas operables", op.horas, 5);
chequear("se cierra a las 13", op.hasta.getHours(), 13);
chequear("ahora se puede operar", op.operableAhora, true);
var enPlena = C.ventanaOperativa(serie, null, new Date(2026, 8, 10, 16, 0));
chequear("en plena alerta no hay ventana", enPlena.horas, 0);
chequear("y lo dice", enPlena.operableAhora, false);

/* ---------------------------------------------------------------- */
bloque("Rumbo y URLs");
chequear("215° es SW", C.rumbo(215), "SW");
chequear("0° es N", C.rumbo(0), "N");
chequear("350° vuelve a N", C.rumbo(350), "N");
chequear("sin dato, sin rumbo", C.rumbo(null), "");
chequear("la URL pide nudos", C.urlPronostico().indexOf("wind_speed_unit=kn") > 0, true);
chequear("y la hora local del puerto", C.urlPronostico().indexOf("America%2FSantiago") > 0, true);
chequear("la marina pide altura de ola", C.urlMarino().indexOf("wave_height") > 0, true);
/* El muelle está en tierra y el modelo marino solo tiene celdas de mar: si se
   pidiera la marejada en el mismo punto que el viento, volvería vacía. */
chequear("el punto marino no es el del muelle",
  C.urlMarino().indexOf("longitude=" + C.PUERTO.lon) > 0, false);
chequear("y está mar adentro, al oeste", C.PUERTO.lonMar < C.PUERTO.lon, true);
chequear("a la misma latitud del terminal", C.PUERTO.latMar, C.PUERTO.lat);
/* Punta Totoralillo, no Caldera: el punto anterior caía 20 km al sur. */
/* El sitio de atraque, no el terminal en tierra: el viento que detiene el
   embarque se mide en la nave. 26,8547 era el punto que devuelve Windy al
   buscar el puerto por nombre, y cae 770 m al sur, en el área de proceso. */
chequear("latitud del sitio de atraque", Math.abs(C.PUERTO.lat + 26.8478) < 1e-6, true);
chequear("longitud del terminal", Math.abs(C.PUERTO.lon + 70.8147) < 1e-6, true);


/* ---------------------------------------------------------------- */
bloque("Estados del puerto");
/* El nivel que calcula `evaluar` es interno; el puerto tiene tres estados y
   sus palabras viven en un solo lugar para que la cifra grande, la tabla y
   las ventanas de alerta no digan tres cosas distintas de lo mismo. */
chequear("bajo los umbrales, abierto", C.estadoPuerto("ok").titulo, "ABIERTO");
chequear("en aviso, con restricción", C.estadoPuerto("aviso").titulo, "CON RESTRICCIÓN");
chequear("en alerta, cerrado", C.estadoPuerto("alerta").titulo, "CERRADO");
chequear("la forma corta de la tabla", C.estadoPuerto("aviso").corto, "Restringido");
chequear("y el rótulo largo", C.estadoPuerto("alerta").rotulo, "Puerto cerrado");
chequear("un nivel desconocido no inventa un cuarto estado",
  C.estadoPuerto("loquesea").titulo, "ABIERTO");
chequear("sin nivel tampoco", C.estadoPuerto(undefined).titulo, "ABIERTO");
/* La clave es la que elige el color del panel: tiene que existir para los
   tres, o el estado intermedio se pinta como «sin datos». */
chequear("clave de abierto", C.estadoPuerto("ok").clave, "abierto");
chequear("clave de restringido", C.estadoPuerto("aviso").clave, "restringido");
chequear("clave de cerrado", C.estadoPuerto("alerta").clave, "cerrado");

/* Y que los umbrales lleven a donde se dice: 20 kn restringe, 25 cierra. */
chequear("19 kn deja el puerto abierto",
  C.estadoPuerto(C.evaluar({viento:19}).nivel).titulo, "ABIERTO");
chequear("20 kn lo pasa a con restricción",
  C.estadoPuerto(C.evaluar({viento:20}).nivel).titulo, "CON RESTRICCIÓN");
chequear("25 kn lo cierra",
  C.estadoPuerto(C.evaluar({viento:25}).nivel).titulo, "CERRADO");
chequear("una ráfaga de 30 kn lo cierra aunque el sostenido esté bajo",
  C.estadoPuerto(C.evaluar({viento:12, rafaga:30}).nivel).titulo, "CERRADO");
chequear("2,0 m de marejada restringen",
  C.estadoPuerto(C.evaluar({ola:2.0}).nivel).titulo, "CON RESTRICCIÓN");
chequear("2,5 m cierran",
  C.estadoPuerto(C.evaluar({ola:2.5}).nivel).titulo, "CERRADO");

/* ---------------------------------------------------------------- */
/* Reintento ante un servidor que falla. Contra un servidor local, no contra
   Open-Meteo: la prueba tiene que correr sin red y sin gastarle consultas a
   nadie. Es lo que pasó de verdad —un 503 en pantalla— y el mensaje culpaba
   a la red del terminal, que no tenía nada que ver. */
var http = require("http");

function servidor(guion){
  var i = 0;
  var srv = http.createServer(function(q, r){
    var paso = guion[Math.min(i++, guion.length - 1)];
    r.writeHead(paso.codigo, {"Content-Type":"application/json"});
    r.end(JSON.stringify(paso.cuerpo || {}));
  });
  return new Promise(function(ok){
    srv.listen(0, "127.0.0.1", function(){
      ok({srv: srv, url: "http://127.0.0.1:" + srv.address().port + "/", pedidas: function(){ return i; }});
    });
  });
}

(async function(){
  bloque("Cuando Open-Meteo falla");
  /* 503 y después bien: la persona no tiene que apretar «Consultar» otra vez
     sin saber que con eso bastaba. */
  var s1 = await servidor([{codigo:503}, {codigo:503}, {codigo:200, cuerpo:{hourly:{time:[]}}}]);
  var ok1 = await C.pedir(s1.url, "pronóstico").then(function(){ return true; },
                          function(){ return false; });
  chequear("un 503 pasajero se reintenta y sale bien", ok1, true);
  chequear("y costó tres intentos", s1.pedidas(), 3);
  s1.srv.close();

  /* 503 que no cede: se rinde, pero diciendo qué pasó y cuántas veces. */
  var s2 = await servidor([{codigo:503}]);
  var err2 = await C.pedir(s2.url, "pronóstico").then(function(){ return null; },
                           function(e){ return e; });
  chequear("un 503 que no cede se rinde", err2 !== null, true);
  chequear("con el código a la vista", err2.status, 503);
  chequear("y cuántas veces se intentó", err2.intentos, 3);
  chequear("y con la URL para poder abrirla", err2.url, s2.url);
  s2.srv.close();

  /* Un 400 no se reintenta: la consulta está mal y repetirla da lo mismo. */
  var s3 = await servidor([{codigo:400}]);
  var err3 = await C.pedir(s3.url, "pronóstico").then(function(){ return null; },
                           function(e){ return e; });
  chequear("un 400 no se reintenta", s3.pedidas(), 1);
  chequear("y lo dice", err3.status, 400);
  s3.srv.close();

  /* Y el caso distinto: la petición no llegó a salir. Un cortafuegos que
     corta la conexión no es lo mismo que un servicio caído, y el mensaje de
     la app tiene que poder separarlos. */
  var err4 = await C.pedir("http://127.0.0.1:1/", "pronóstico").then(function(){ return null; },
                           function(e){ return e; });
  chequear("sin salida a internet se marca como problema de red", err4.red, true);
  chequear("y no trae código HTTP, porque no lo hubo", err4.status, undefined);

  console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
  process.exit(fallas === 0 ? 0 : 1);
})();

/* El resumen y el process.exit viven DENTRO del async de arriba: las
   comprobaciones de red terminan después que el resto del archivo, y un
   process.exit acá mataba el proceso antes de que corrieran —el archivo
   decía «TODO OK» sin haberlas ejecutado. */
