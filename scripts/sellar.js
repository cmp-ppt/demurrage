#!/usr/bin/env node
/**
 * Sella index.html con la versión de cada archivo que carga.
 *
 * GitHub Pages sirve js/app.js con cache de diez minutos y el navegador se
 * lo queda más. Sin nada que distinga una versión de otra, publicar un
 * arreglo y que la persona lo vea son dos cosas distintas: pasó con el
 * panel de detenciones, que se arregló, se publicó, y al otro lado seguía
 * saliendo vacío con el JavaScript viejo.
 *
 * Esto le pone a cada <script src> y <link href> local un «?v=» con el
 * hash de SU contenido. El que no cambió conserva su URL y sigue en cache;
 * el que cambió estrena URL y se baja sí o sí. No hay build: esto se corre
 * a mano antes de commitear y el resultado queda versionado.
 *
 *   node scripts/sellar.js            sella
 *   node scripts/sellar.js --revisar  solo dice si falta sellar (CI)
 */
"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");

var RAIZ = path.join(__dirname, "..");
var INDEX = path.join(RAIZ, "index.html");
var revisar = process.argv.indexOf("--revisar") >= 0;

function hash(ruta){
  return crypto.createHash("sha1").update(fs.readFileSync(ruta)).digest("hex").slice(0, 8);
}

var html = fs.readFileSync(INDEX, "utf8");
var faltantes = [], sellados = 0;

/* Solo rutas locales y relativas: un CDN no es nuestro para versionar. */
var RE = /(<(?:script|link)\b[^>]*?\b(?:src|href)=")((?:js|css)\/[^"?]+)(\?v=[a-f0-9]+)?(")/g;
var salida = html.replace(RE, function(_, antes, ruta, _viejo, cierre){
  var abs = path.join(RAIZ, ruta);
  if(!fs.existsSync(abs)){ faltantes.push(ruta); return antes + ruta + (_viejo || "") + cierre; }
  sellados++;
  return antes + ruta + "?v=" + hash(abs) + cierre;
});

/* Una versión del conjunto, para que la app pueda decir cuál está corriendo
   y una captura de pantalla sirva para algo. */
/* El hash se calcula SIN la línea del meta, salto de línea incluido: si no,
   sellar un index ya sellado daría otra versión que sellar uno limpio, y la
   misma entrada tendría dos respuestas. */
var paraHash = salida.replace(/[ \t]*<meta name="version"[^>]*>\r?\n?/, "");
var global = crypto.createHash("sha1").update(paraHash).digest("hex").slice(0, 8);
if(/<meta name="version"[^>]*>/.test(salida)){
  salida = salida.replace(/<meta name="version"[^>]*>/, '<meta name="version" content="' + global + '">');
}else{
  salida = salida.replace(/(<meta charset="[^"]*">)/i, '$1\n<meta name="version" content="' + global + '">');
}

if(faltantes.length){
  console.error("No existen: " + faltantes.join(", "));
  process.exit(1);
}

if(revisar){
  if(salida === html){ console.log("index.html está sellado (" + sellados + " archivos, versión " + global + ")."); process.exit(0); }
  console.error("Falta sellar index.html: corre `node scripts/sellar.js` y commitea el cambio.");
  process.exit(1);
}

fs.writeFileSync(INDEX, salida);
console.log("Sellados " + sellados + " archivos. Versión " + global + ".");
