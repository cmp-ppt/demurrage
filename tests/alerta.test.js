/**
 * Pruebas del aviso por correo.   node tests/alerta.test.js
 *
 * Nada de red: acá se prueba lo que decide si se manda el correo y qué dice,
 * que es donde un error se traduce en cuarenta correos iguales o, peor, en
 * ninguno la noche que el viento se puso sobre el umbral.
 */
var A = require("../js/alerta.js");

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

/* Una serie horaria como la que arma CLIMA.combinar: una muestra por hora. */
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
function ventana(s, opciones){
  opciones = opciones || {};
  opciones.ahora = BASE;
  return A.peorEnVentana(s, opciones);
}

/* ---------------------------------------------------------------- */
bloque("El umbral es el viento SOSTENIDO");
/* 18 nudos sostenidos, no 20: 20 es el límite de operación del terminal y a
   esa altura el embarque ya se detuvo. El aviso llega antes, cuando todavía
   se puede decidir algo. */
chequear("17 kn no dispara", ventana(serie([{v:17}, {v:17}])).fuera, false);
chequear("18 kn sí", ventana(serie([{v:18}])).fuera, true);
chequear("y 19 también", ventana(serie([{v:19}])).fuera, true);

bloque("La ráfaga NO dispara");
/* Es lo que se pidió: una ráfaga es un pico de segundos, y un aviso que
   salta con cada pico se vuelve ruido que nadie mira —y entonces el aviso
   que importa tampoco se mira. */
chequear("ráfaga de 35 kn con viento de 10 no dispara nada",
  ventana(serie([{v:10, r:35}, {v:10, r:38}])).fuera, false);
chequear("ni una de 50", ventana(serie([{v:9, r:50}])).fuera, false);
/* Pero la ráfaga se informa cuando ya hay aviso por viento sostenido: quien
   lee el correo necesita saber a qué atenerse. */
var conRafaga = ventana(serie([{v:21, r:34}, {v:22, r:36}]));
chequear("cuando hay aviso, la ráfaga máxima viaja en el dato", conRafaga.maxRafaga, 36);
chequear("y el sostenido máximo también", conRafaga.maxViento, 22);
chequear("el motivo dice «sostenido»",
  /viento sostenido 22 kn/.test(conRafaga.motivos.join(" ")), true);

bloque("Sostenido quiere decir seguido");
/* Una muestra del pronóstico ES una hora, así que con horasSeguidas=1 basta
   una hora completa sobre el umbral, que es lo pedido. */
chequear("una hora sobre el umbral basta",
  ventana(serie([{}, {v:19}, {}])).horasSeguidas, 1);
/* Subiendo la exigencia, la hora suelta se descarta y el tramo largo no. */
var dos = {umbral: {vientoSostenido:18, horasSeguidas:2, ola:2.0, visibilidad:2000}};
chequear("con dos horas exigidas, una suelta no alcanza",
  ventana(serie([{}, {v:19}, {}]), dos).fuera, false);
chequear("dos seguidas sí", ventana(serie([{}, {v:19}, {v:19}, {}]), dos).fuera, true);
/* Y el corte es de verdad: dos horas separadas por una tranquila no son un
   tramo de dos. */
chequear("dos horas separadas no son un tramo seguido",
  ventana(serie([{v:19}, {}, {v:19}]), dos).fuera, false);
chequear("se cuentan los tramos por separado",
  ventana(serie([{v:19}, {}, {v:19}])).tramos, 2);
chequear("y las horas fuera de rango se suman",
  ventana(serie([{v:19}, {}, {v:19}])).horasFuera, 2);

bloque("Cuándo empieza");
/* Lo que se comunica es cuándo empieza, no cuándo es peor: es lo que da o
   quita margen para decidir. */
var tarde = ventana(serie([{}, {}, {v:19}, {v:27}, {v:19}]));
chequear("manda el primer tramo, no el más fuerte", tarde.desdeIso.slice(-5), "14:00");
chequear("y dice cuántas horas seguidas dura", tarde.horasSeguidas, 3);
chequear("con el máximo del tramo", tarde.maxViento, 27);

bloque("Marejada y visibilidad: dato, no gatillo");
/* Decisión de la operación: el aviso es de viento. Una marejada de 3 m con
   viento calmo no manda correo —el tablero sí la pinta como puerto cerrado,
   el correo calla— y eso es a propósito. */
chequear("3 m de marejada con viento calmo no avisan",
  ventana(serie([{o:3.0}, {o:3.2}])).fuera, false);
chequear("2,5 m tampoco", ventana(serie([{o:2.5}])).fuera, false);
chequear("ni la visibilidad en el suelo", ventana(serie([{vis:300}])).fuera, false);
chequear("el viento sigue siendo el único que dispara",
  ventana(serie([{v:19, o:0.5, vis:30000}])).fuera, true);
/* Pero se recogen, porque el correo las informa. */
var conMar = ventana(serie([{v:21, o:2.4, vis:1800}, {v:22, o:2.6, vis:900}]));
chequear("la marejada máxima del tramo se guarda", conMar.maxOla, 2.6);
chequear("y la visibilidad mínima", conMar.minVis, 900);
chequear("el motivo sigue siendo solo el viento",
  conMar.motivos.join(" · "), "viento sostenido 22 kn");

bloque("Lo que cae fuera de la ventana");
var lejos = serie(Array(12).fill({}).concat(Array(40).fill({v:30})));
chequear("lo de pasado mañana no entra", ventana(lejos, {horas: 6}).fuera, false);
chequear("con la ventana larga sí", ventana(lejos, {horas: 48}).fuera, true);
chequear("una serie vacía no revienta", ventana([]).fuera, false);
chequear("sin serie tampoco", ventana(null).fuera, false);

/* ---------------------------------------------------------------- */
bloque("Cuándo se manda el correo");
/* Al cruzar, no mientras dure: con viento sobre el umbral durante dos días
   son cuarenta correos iguales y a los tres primeros nadie los abre. */
chequear("de dentro a fuera de rango, se avisa",
  A.cruce({nivel:"ok"}, {nivel:"fuera"}).avisar, true);
chequear("y se dice que entró", A.cruce({nivel:"ok"}, {nivel:"fuera"}).tipo, "entra");
chequear("mientras siga fuera, no se insiste",
  A.cruce({nivel:"fuera"}, {nivel:"fuera"}).avisar, false);
chequear("al volver se avisa", A.cruce({nivel:"fuera"}, {nivel:"ok"}).avisar, true);
chequear("y se dice que volvió", A.cruce({nivel:"fuera"}, {nivel:"ok"}).tipo, "vuelve");
chequear("dentro de rango y sigue dentro, nada",
  A.cruce({nivel:"ok"}, {nivel:"ok"}).avisar, false);
/* Primera corrida, o estado perdido: avisar solo si está fuera de rango. */
chequear("sin estado previo y todo en orden, no se manda nada",
  A.cruce(null, {nivel:"ok"}).avisar, false);
chequear("sin estado previo y fuera de rango, se manda",
  A.cruce(null, {nivel:"fuera"}).avisar, true);
chequear("un estado guardado con basura se trata como ausente",
  A.cruce({nivel:"loquesea"}, {nivel:"ok"}).avisar, false);

/* ---------------------------------------------------------------- */
bloque("Qué dice el correo");
var fuera = ventana(serie([{}, {v:21, r:34}, {v:23, r:37}]));
var m = A.mensaje(A.cruce({nivel:"ok"}, fuera), fuera, {puerto:"Puerto Punta Totoralillo"});
chequear("el asunto habla de viento sobre umbral",
  /Viento sobre umbral/.test(m.asunto), true);
chequear("y lleva el motivo, que es lo que se lee en el teléfono",
  m.asunto.indexOf("viento sostenido") > 0, true);
chequear("el cuerpo nombra el terminal",
  m.texto.indexOf("Puerto Punta Totoralillo") > 0, true);
chequear("dice desde cuándo y cuántas horas", /Desde: .+13:00 · 2 horas seguidas/.test(m.texto), true);
chequear("da el máximo sostenido", /Máximo sostenido en el tramo: 23 kn/.test(m.texto), true);
/* La ráfaga aparece, pero dicha como lo que es: información, no la causa. */
chequear("la ráfaga se informa sin ser la causa",
  /ráfagas de hasta 37 kn, que no disparan el aviso/.test(m.texto), true);
chequear("la regla queda escrita en el correo",
  /viento sostenido de 18 kn o más durante 1 hora seguida/.test(m.texto), true);
chequear("y que ráfaga, marejada y visibilidad no cuentan",
  /ráfagas, la marejada y la visibilidad NO disparan el aviso: se informan/.test(m.texto), true);

/* La mar y la visibilidad van en el cuerpo: no es lo mismo 21 nudos con mar
   llana que con 2,5 m de marejada, y eso cambia lo que se decide. */
var conDatos = ventana(serie([{}, {v:21, o:2.4, vis:1800}, {v:23, o:2.6, vis:900}]));
var m2 = A.mensaje(A.cruce({nivel:"ok"}, conDatos), conDatos, {});
chequear("el cuerpo informa la marejada del tramo",
  /En el tramo: marejada hasta 2,6 m/.test(m2.texto), true);
chequear("y la marca cuando pasa el umbral del puerto",
  /2,6 m \(sobre el umbral del puerto\)/.test(m2.texto), true);
chequear("con la visibilidad mínima",
  /visibilidad mínima 900 m \(bajo el umbral del puerto\)/.test(m2.texto), true);
/* Con mar tranquila se informa igual, pero sin la marca. */
var mansa = ventana(serie([{v:21, o:0.8, vis:30000}]));
var m3 = A.mensaje(A.cruce({nivel:"ok"}, mansa), mansa, {});
chequear("con mar llana se informa sin marcarla",
  /marejada hasta 0,8 m ·/.test(m3.texto) && m3.texto.indexOf("sobre el umbral") < 0,
  /marejada hasta 0,8 m/.test(m3.texto));
chequear("dice por qué 18 y no 20",
  /límite de operación del terminal son 20 kn/.test(m.texto), true);
chequear("y de dónde sale el pronóstico", m.texto.indexOf("Open-Meteo") > 0, true);
var vuelta = A.mensaje(A.cruce({nivel:"fuera"}, {nivel:"ok"}), {nivel:"ok", motivos:[]}, {});
chequear("el de vuelta es otro asunto", /dentro de rango otra vez/.test(vuelta.asunto), true);
chequear("y no inventa motivos", vuelta.texto.indexOf("Motivo:"), -1);

bloque("La fecha, como se lee");
chequear("día y hora del terminal", A.cuando("2026-10-14T18:00"), "mié 14 oct, 18:00");
chequear("basura no inventa fecha", A.cuando("x"), "");

bloque("Lo que se guarda entre corridas");
var g = A.estadoAGuardar(fuera, Date.parse("2026-10-14T12:00:00Z"));
chequear("el nivel", g.nivel, "fuera");
chequear("y cuándo se revisó", g.revisadoEn, "2026-10-14T12:00:00.000Z");
chequear("sin nada, queda dentro de rango", A.estadoAGuardar(null).nivel, "ok");
chequear("lo guardado sirve de anterior", A.cruce(g, {nivel:"fuera"}).avisar, false);
chequear("y detecta la vuelta", A.cruce(g, {nivel:"ok"}).avisar, true);

console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
process.exit(fallas === 0 ? 0 : 1);
