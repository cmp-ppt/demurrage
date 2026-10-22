#!/usr/bin/env node
/**
 * Revisa el pronóstico de Punta Totoralillo y manda un correo cuando el
 * puerto CRUZA el umbral de operación.   node scripts/alerta-clima.js
 *
 * Corre en GitHub Actions cada hora. Todo lo que decide vive en
 * js/alerta.js y js/clima.js —los mismos umbrales y la misma función de
 * evaluación que usa el tablero—; acá solo está lo que toca la red: pedir
 * el pronóstico, leer y escribir el último estado, y enviar.
 *
 * Variables de entorno:
 *   RESEND_API_KEY   clave de Resend            (sin ella no envía, solo informa)
 *   ALERTA_PARA      destinatarios, separados por coma
 *   ALERTA_DE        remitente verificado en Resend
 *   ALERTA_ESTADO    archivo donde guardar el último estado
 *   ALERTA_HORAS     horizonte en horas (24 por omisión)
 *   ALERTA_SIMULAR   "1" para no enviar nada y escribir el correo en pantalla
 *   ALERTA_FORZAR    "1" manda un correo de prueba con el estado actual, haya
 *                    cruzado el umbral o no, y NO guarda el estado. Sirve para
 *                    comprobar que el correo llega sin esperar a que haya
 *                    viento: con el pronóstico tranquilo no se manda nada, y
 *                    sin esto no habría forma de saber si está bien puesto.
 *   ALERTA_FIXTURE   JSON {pron, mar} con respuestas guardadas, en vez de
 *                    consultar la API. Sirve para probar el aviso sin red y
 *                    sin esperar a que haya temporal de verdad.
 */
var fs = require("fs"), path = require("path");
var CLIMA = require("../js/clima.js");
var ALERTA = require("../js/alerta.js");

var ESTADO = process.env.ALERTA_ESTADO || path.join(__dirname, "..", ".estado-alerta.json");
var HORAS = Number(process.env.ALERTA_HORAS) > 0 ? Number(process.env.ALERTA_HORAS) : ALERTA.HORAS;
var SIMULAR = process.env.ALERTA_SIMULAR === "1";
var FORZAR = process.env.ALERTA_FORZAR === "1";

function leerEstado(){
  try{ return JSON.parse(fs.readFileSync(ESTADO, "utf8")); }
  catch(e){ return null; }        // primera corrida, o se perdió el guardado
}

function guardarEstado(e){
  try{
    fs.mkdirSync(path.dirname(ESTADO), {recursive: true});
    fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2));
  }catch(err){
    /* Sin guardado el próximo aviso se repite, que es molesto pero inocuo.
       Perder el correo por no poder escribir un archivo sería peor. */
    console.error("No se pudo guardar el estado:", err.message);
  }
}

/**
 * Envía por Resend. Un fallo de envío sale con código distinto de cero para
 * que la corrida quede en rojo: un aviso que no llegó y nadie nota es peor
 * que no tener aviso, porque se confía en él.
 */
function enviar(msg){
  var clave = process.env.RESEND_API_KEY;
  var para = (process.env.ALERTA_PARA || "").split(",")
    .map(function(s){ return s.trim(); }).filter(Boolean);
  var de = process.env.ALERTA_DE || "";

  if(SIMULAR || !clave || !para.length || !de){
    console.log("\n--- correo (no enviado) ---");
    console.log("Para:", para.join(", ") || "(sin ALERTA_PARA)");
    console.log("De:", de || "(sin ALERTA_DE)");
    console.log("Asunto:", msg.asunto);
    console.log(msg.texto);
    console.log("--- fin ---\n");
    if(!SIMULAR && (!clave || !para.length || !de)){
      console.error("Falta RESEND_API_KEY, ALERTA_PARA o ALERTA_DE: no se envió.");
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {Authorization: "Bearer " + clave, "Content-Type": "application/json"},
    body: JSON.stringify({from: de, to: para, subject: msg.asunto, text: msg.texto})
  }).then(function(res){
    return res.text().then(function(txt){
      if(!res.ok) throw new Error("Resend respondió HTTP " + res.status + ": " + txt.slice(0, 300));
      console.log("Correo enviado a", para.join(", "));
      return true;
    });
  });
}

/* Con ALERTA_FIXTURE se arma la serie desde un archivo en vez de la API: el
   resto del recorrido —evaluar, cruzar, redactar, enviar— es idéntico. */
function obtener(){
  var f = process.env.ALERTA_FIXTURE;
  if(!f) return CLIMA.consultar(CLIMA.PUERTO, 3);
  var d = JSON.parse(fs.readFileSync(f, "utf8"));
  var serie = CLIMA.combinar(d.pron, d.mar || null);
  if(!serie.length) return Promise.reject(new Error("El fixture no trae horas."));
  return Promise.resolve({serie: serie, actual: (d.pron && d.pron.current) || null,
                          conMar: !!(d.mar && d.mar.hourly), consultadoEn: new Date()});
}

obtener().then(function(r){
  var actual = ALERTA.peorEnVentana(r.serie, {horas: HORAS});
  var anterior = leerEstado();
  var c = ALERTA.cruce(anterior, actual);

  console.log("Revisado:", new Date().toISOString());
  console.log("Ventana:", HORAS, "h ·", r.serie.length, "horas de pronóstico ·",
              r.conMar ? "con datos de mar" : "SIN datos de mar");
  console.log("Antes:", (anterior && anterior.nivel) || "(sin estado)",
              "· ahora:", actual.nivel,
              actual.motivos.length ? "(" + actual.motivos.join(" · ") + ")" : "");

  if(FORZAR){
    /* Prueba de cañería: se manda pase lo que pase y no se toca el estado
       guardado, para no comerse el aviso de verdad que venga después. */
    var prueba = ALERTA.mensaje(
      {tipo: actual.fuera ? "entra" : "vuelve", antes: null, ahora: actual.nivel},
      actual, {horas: HORAS});
    /* El asunto se rehace: reusar el de «vuelve» dejaba un «dentro de rango
       otra vez» que no viene a cuento en una prueba. */
    prueba.asunto = "[PRUEBA] [PPT] " + (actual.fuera
      ? "Viento sobre umbral — " + actual.motivos.join(" · ")
      : "Pronóstico dentro de rango");
    prueba.texto = "Correo de prueba lanzado a mano desde GitHub Actions. El estado " +
      "guardado no se modifica.\n\n" + prueba.texto;
    console.log("Envío forzado: es una prueba, el estado no se guarda.");
    return enviar(prueba).then(function(ok){ if(!ok) process.exitCode = 1; });
  }

  if(!c.avisar){
    console.log("Sin cruce de umbral: no se manda nada.");
    guardarEstado(ALERTA.estadoAGuardar(actual));
    return;
  }
  var msg = ALERTA.mensaje(c, actual, {horas: HORAS});
  return enviar(msg).then(function(ok){
    /* El estado se guarda solo si el correo salió. Si falló el envío, la
       próxima corrida tiene que volver a intentarlo: guardar ahora
       convertiría el fallo en un aviso que nunca se manda. */
    if(ok) guardarEstado(ALERTA.estadoAGuardar(actual));
    else process.exitCode = 1;
  });
}).catch(function(err){
  console.error("Falló la revisión:", err.message);
  process.exitCode = 1;
});
