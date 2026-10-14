/**
 * Pruebas del aviso por correo.   node tests/alerta.test.js
 *
 * Nada de red: acá se prueba lo que decide si se manda el correo y qué dice,
 * que es donde un error se traduce en cuarenta correos iguales o, peor, en
 * ninguno la noche que el puerto cerró.
 */
var A = require("../js/alerta.js");
var C = require("../js/clima.js");

var fallas = 0, total = 0;
function chequear(nombre, obtenido, esperado, tol){
  total++;
  var ok = (typeof esperado === "number")
    ? Math.abs(obtenido - esperado) <= (tol === undefined ? 1e-9 : tol)
    : obtenido === esperado;
  if(!ok) fallas++;
  console.log((ok ? "  PASS " : "  FALLA") + " | " + nombre + " -> " + obtenido +
    (ok ? "" : "  (esperado " + esperado + ")"));
}
function bloque(t){ console.log("\n" + t); }

/* Una serie horaria como la que arma CLIMA.combinar. */
var BASE = new Date(2026, 9, 14, 12, 0);
function serie(horas){
  return horas.map(function(h, i){
    var d = new Date(BASE.getTime() + i * 3600000);
    return {iso: d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" +
                 String(d.getDate()).padStart(2,"0") + "T" +
                 String(d.getHours()).padStart(2,"0") + ":00",
            hora: d, viento: h.v == null ? 8 : h.v, rafaga: h.r == null ? 12 : h.r,
            ola: h.o == null ? 1.0 : h.o, visibilidad: h.vis == null ? 20000 : h.vis,
            direccion: 220, periodo: 11};
  });
}

/* ---------------------------------------------------------------- */
bloque("El peor nivel de la ventana");
/* Se queda con el peor y no con el primero: si en 24 h hay una hora con
   restricción y otra de cierre, lo que hay que comunicar es el cierre. */
var mixta = A.peorEnVentana(serie([{}, {v:21}, {}, {v:26}, {}]), {ahora: BASE});
chequear("manda el peor, no el primero", mixta.nivel, "alerta");
chequear("y dice desde cuándo", mixta.desdeIso.slice(-5), "15:00");
chequear("cuenta las horas fuera de rango", mixta.horasFuera, 2);
chequear("todo bajo umbral es ok", A.peorEnVentana(serie([{}, {}, {}]), {ahora: BASE}).nivel, "ok");
chequear("sin horas fuera, cero", A.peorEnVentana(serie([{}, {}]), {ahora: BASE}).horasFuera, 0);
/* Viento de 20 kn detiene el embarque pero la nave sigue amarrada: eso es
   restricción, no cierre. Es el umbral que rige en el terminal. */
chequear("20 nudos es restricción", A.peorEnVentana(serie([{v:20}]), {ahora: BASE}).nivel, "aviso");
chequear("25 nudos es cierre", A.peorEnVentana(serie([{v:25}]), {ahora: BASE}).nivel, "alerta");
chequear("marejada de 2,5 m también", A.peorEnVentana(serie([{o:2.5}]), {ahora: BASE}).nivel, "alerta");
chequear("y la ráfaga de 30 kn", A.peorEnVentana(serie([{r:30}]), {ahora: BASE}).nivel, "alerta");
/* Lo que cae fuera de la ventana no se mira: un cierre dentro de tres días
   no es motivo para despertar a nadie hoy. */
/* Doce horas en calma y después viento: con ventana de 6 h no se ve. */
var lejos = serie(Array(12).fill({}).concat(Array(40).fill({v:30})));
chequear("lo de pasado mañana no entra", A.peorEnVentana(lejos, {ahora: BASE, horas: 6}).nivel, "ok");
chequear("con la ventana larga sí", A.peorEnVentana(lejos, {ahora: BASE, horas: 48}).nivel, "alerta");
chequear("una serie vacía no revienta", A.peorEnVentana([], {ahora: BASE}).nivel, "ok");
chequear("sin serie tampoco", A.peorEnVentana(null, {ahora: BASE}).nivel, "ok");

/* ---------------------------------------------------------------- */
bloque("Cuándo se manda el correo");
/* La regla: al cruzar, no mientras dure. Un correo por revisión con viento
   sobre 20 nudos durante dos días son cuarenta correos iguales. */
chequear("de operable a restringido, se avisa", A.cruce({nivel:"ok"}, {nivel:"aviso"}).avisar, true);
chequear("y se dice que entró", A.cruce({nivel:"ok"}, {nivel:"aviso"}).tipo, "entra");
chequear("mientras siga igual, no se insiste", A.cruce({nivel:"aviso"}, {nivel:"aviso"}).avisar, false);
chequear("de restricción a cierre, se avisa", A.cruce({nivel:"aviso"}, {nivel:"alerta"}).avisar, true);
chequear("y se dice que empeoró", A.cruce({nivel:"aviso"}, {nivel:"alerta"}).tipo, "empeora");
chequear("al aflojar también", A.cruce({nivel:"alerta"}, {nivel:"aviso"}).tipo, "mejora");
chequear("y al volver a operable", A.cruce({nivel:"alerta"}, {nivel:"ok"}).tipo, "vuelve");
chequear("volver también se avisa", A.cruce({nivel:"alerta"}, {nivel:"ok"}).avisar, true);
/* Primera corrida, o estado perdido: avisar solo si está fuera de rango.
   Arrancar con un «todo en orden» que nadie pidió enseña a ignorar el
   remitente, y el primer aviso de verdad se pierde entre los demás. */
chequear("sin estado previo y todo en orden, no se manda nada",
  A.cruce(null, {nivel:"ok"}).avisar, false);
chequear("sin estado previo y fuera de rango, se manda",
  A.cruce(null, {nivel:"alerta"}).avisar, true);
chequear("un estado guardado con basura se trata como ausente",
  A.cruce({nivel:"loquesea"}, {nivel:"ok"}).avisar, false);

/* ---------------------------------------------------------------- */
bloque("Qué dice el correo");
var fuera = A.peorEnVentana(serie([{}, {v:26, r:31}]), {ahora: BASE});
var m = A.mensaje(A.cruce({nivel:"ok"}, fuera), fuera, {puerto:"Puerto Punta Totoralillo"});
chequear("el asunto lleva el estado", m.asunto.indexOf("Puerto cerrado") > 0, true);
chequear("y el motivo, que es lo que se lee en el teléfono",
  m.asunto.indexOf("viento 26 kn") > 0, true);
chequear("el cuerpo nombra el terminal",
  m.texto.indexOf("Puerto Punta Totoralillo") > 0, true);
chequear("dice desde cuándo", /Desde: .+13:00/.test(m.texto), true);
chequear("cuántas horas fuera de rango", /Horas fuera de rango/.test(m.texto), true);
/* De dónde sale el dato: un aviso automático sin procedencia no se puede
   contrastar ni discutir con nadie. */
chequear("y de dónde sale el pronóstico", m.texto.indexOf("Open-Meteo") > 0, true);
chequear("deja dicho que avisa al cruzar",
  /al cruzar el umbral/.test(m.texto), true);
var vuelta = A.mensaje(A.cruce({nivel:"alerta"}, {nivel:"ok"}), {nivel:"ok", motivos:[]}, {});
chequear("el de vuelta a operable es otro asunto",
  /operable otra vez/.test(vuelta.asunto), true);
chequear("y no inventa motivos", vuelta.texto.indexOf("Motivo:"), -1);

bloque("La fecha, como se lee");
chequear("día y hora del terminal", A.cuando("2026-10-14T18:00"), "mié 14 oct, 18:00");
chequear("basura no inventa fecha", A.cuando("x"), "");
chequear("sin nada tampoco", A.cuando(), "");

bloque("Lo que se guarda entre corridas");
var g = A.estadoAGuardar(fuera, Date.parse("2026-10-14T12:00:00Z"));
chequear("el nivel", g.nivel, "alerta");
chequear("y cuándo se revisó", g.revisadoEn, "2026-10-14T12:00:00.000Z");
chequear("sin nada, queda operable", A.estadoAGuardar(null).nivel, "ok");
/* El ciclo completo: lo guardado tiene que servir de «anterior». */
chequear("lo guardado sirve de anterior", A.cruce(g, {nivel:"alerta"}).avisar, false);

console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
process.exit(fallas === 0 ? 0 : 1);
