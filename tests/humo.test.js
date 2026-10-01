/**
 * Prueba de humo: abre la app en un navegador real y la recorre entera,
 * fallando si el navegador lanza un solo error.   node tests/humo.test.js
 *
 * Existe por un error que llegó publicado. Al retirar la vista Flota se borró
 * de paso `var serieClima = []`, que vivía entre sus funciones. El archivo
 * seguía siendo JavaScript válido —`node --check` pasaba—, las 414 pruebas
 * pasaban porque ninguna toca el DOM, y las comprobaciones de navegador que
 * corrí después miraban otras pestañas. El defecto solo aparecía al apretar
 * "Consultar condiciones", y lo encontró el usuario: "serieClima is not
 * defined".
 *
 * Un error de referencia no se ve leyendo; se ve ejecutando. Esta prueba
 * ejecuta: abre cada pestaña, carga un libro, aprieta los botones que
 * disparan cada render y exige cero errores de página.
 *
 * Necesita Playwright y un servidor local. Si falta alguno se omite sin
 * fallar, para que la suite siga corriendo donde no hay navegador.
 */
var fs = require("fs"), path = require("path"), http = require("http");
var raiz = path.join(__dirname, "..");

var chromium;
try { chromium = require("/opt/node22/lib/node_modules/playwright").chromium; }
catch(e){
  try { chromium = require("playwright").chromium; }
  catch(e2){
    console.log("\nPrueba de humo omitida: Playwright no está disponible.");
    process.exit(0);
  }
}

var TIPOS = {".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".png":"image/png"};

function servir(){
  return new Promise(function(listo){
    var srv = http.createServer(function(req, res){
      var rel = decodeURIComponent(req.url.split("?")[0]);
      if(rel === "/") rel = "/index.html";
      var f = path.join(raiz, rel);
      if(!f.startsWith(raiz) || !fs.existsSync(f)){ res.writeHead(404); res.end(); return; }
      res.writeHead(200, {"Content-Type": TIPOS[path.extname(f)] || "application/octet-stream"});
      res.end(fs.readFileSync(f));
    });
    srv.listen(0, "127.0.0.1", function(){ listo({srv: srv, puerto: srv.address().port}); });
  });
}

var fallas = 0, total = 0;
function chequear(nombre, ok, detalle){
  total++;
  if(!ok) fallas++;
  console.log((ok ? "  PASS " : "  FALLA") + " | " + nombre + (detalle ? " -> " + detalle : ""));
}

(async function(){
  var s = await servir();
  var base = "http://127.0.0.1:" + s.puerto + "/index.html";
  var navegador = await chromium.launch();
  var pagina = await navegador.newPage({viewport:{width:1600, height:1000}});

  var errores = [];
  pagina.on("pageerror", function(e){ errores.push(e.message); });
  pagina.on("console", function(m){
    // Google Fonts y la API del clima no están disponibles sin red: sus
    // fallos de carga no son defectos de la app.
    if(m.type() === "error" && !/fonts|ERR_|Failed to load resource/.test(m.text())){
      errores.push("console: " + m.text());
    }
  });

  function sinErrores(paso){
    var hubo = errores.splice(0);
    chequear(paso, hubo.length === 0, hubo.length ? hubo.join(" | ") : "sin errores");
  }

  console.log("\nRecorrido de la app en un navegador real");
  await pagina.goto(base, {waitUntil: "networkidle"});
  sinErrores("carga inicial");

  /* Con js/config.js trayendo el proyecto —que es lo que hace que el enlace
     sirva para todo el equipo— la puerta aparece en cada visita. El recorrido
     de humo no prueba la nube: entra por «Seguir sin conectar», que es el
     mismo camino de quien abre el sitio con la red caída. */
  var conPuerta = await pagina.evaluate(function(){
    return !document.getElementById("puerta").hidden;
  });
  chequear("la configuración del repositorio levanta la puerta sola", conPuerta,
    conPuerta ? "pide cuenta" : "no pidió cuenta: js/config.js está vacío");
  if(conPuerta){
    await pagina.click("#btn-sin-conectar");
    await pagina.waitForTimeout(300);
    sinErrores("seguir sin conectar");
  }

  // Cada pestaña dispara su propio render.
  var pestanas = await pagina.$$eval(".tab", function(ns){
    return ns.map(function(n){ return n.dataset.vista; });
  });
  for(var i = 0; i < pestanas.length; i++){
    await pagina.click('.tab[data-vista="' + pestanas[i] + '"]');
    await pagina.waitForTimeout(500);
    sinErrores("abrir pestaña " + pestanas[i]);
  }

  // El clima sin red tiene que fallar con un aviso, no con una excepción.
  await pagina.click('.tab[data-vista="clima"]');
  await pagina.waitForTimeout(300);
  await pagina.click("#btn-clima-consultar");
  await pagina.waitForTimeout(1500);
  sinErrores("consultar condiciones sin red");
  var aviso = await pagina.$eval("#clima-aviso", function(n){ return n.textContent.trim(); });
  chequear("el clima avisa en vez de reventar", aviso.length > 0 && !/is not defined/.test(aviso),
    aviso.slice(0, 80) || "(sin aviso)");
  await pagina.click("#btn-clima-umbrales");
  await pagina.waitForTimeout(300);
  sinErrores("abrir umbrales del clima");

  // La vista de operación, con una recalada de verdad.
  /* La bitácora: registrar «ayer y hoy cerrado» arrastrando en el
     calendario, que es el gesto para el que se hizo. Sin esto, lo único
     probado sería la lógica pura de bitacora.js, y el defecto que importa
     —que el arrastre no llegue al formulario— vive en el medio. */
  var hoyIso = await pagina.evaluate(function(){
    var d = new Date(), p = function(n){ return String(n).padStart(2,"0"); };
    return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
  });
  var ayerIso = await pagina.evaluate(function(){
    var d = new Date(Date.now() - 86400000), p = function(n){ return String(n).padStart(2,"0"); };
    return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
  });
  var celdaAyer = await pagina.$('.cal-dia[data-iso="' + ayerIso + '"]');
  var celdaHoy  = await pagina.$('.cal-dia[data-iso="' + hoyIso + '"]');
  chequear("el calendario abre en el mes de hoy", !!celdaAyer && !!celdaHoy,
    ayerIso + " / " + hoyIso);
  if(celdaAyer && celdaHoy){
    /* Sin esto el calendario queda fuera de la ventana y el ratón de
       Playwright, que trabaja en coordenadas de viewport, no lo toca: los
       eventos no llegan y la prueba pasa sin haber arrastrado nada. */
    await celdaAyer.scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(200);
    var ca = await celdaAyer.boundingBox(), ch = await celdaHoy.boundingBox();
    await pagina.mouse.move(ca.x + ca.width/2, ca.y + ca.height/2);
    await pagina.mouse.down();
    await pagina.mouse.move(ch.x + ch.width/2, ch.y + ch.height/2, {steps:8});
    await pagina.mouse.up();
    await pagina.waitForTimeout(300);
    var rango = await pagina.evaluate(function(){
      return document.getElementById("bit-desde").value + " → " + document.getElementById("bit-hasta").value;
    });
    chequear("arrastrar dos días llena el rango", rango, ayerIso + " → " + hoyIso);

    /* Sin causa no se guarda: es lo que se cita al liquidar. */
    await pagina.click("#bit-guardar"); await pagina.waitForTimeout(200);
    var sinCausa = await pagina.evaluate(function(){
      return {aviso: document.getElementById("bit-aviso").textContent,
              pintados: document.querySelectorAll(".cal-dia.cerrado").length};
    });
    chequear("sin causa no guarda y lo dice",
      /causa/i.test(sinCausa.aviso) && sinCausa.pintados === 0, JSON.stringify(sinCausa));

    await pagina.fill("#bit-causa", "Paro o movilización portuaria");
    await pagina.fill("#bit-nota-txt", "Personal portuario ajeno a la empresa.");
    await pagina.click("#bit-guardar"); await pagina.waitForTimeout(400);
    var guardado = await pagina.evaluate(function(){
      return {pintados: document.querySelectorAll(".cal-dia.cerrado").length,
              nota: document.getElementById("bit-nota").textContent,
              filas: document.querySelectorAll("#tb-bitacora tr[data-id]").length};
    });
    chequear("los dos días quedan pintados y en la tabla",
      guardado.pintados === 2 && guardado.filas === 1, JSON.stringify(guardado));
    /* El panel cuenta los días DEL MES que muestra, y tras guardar salta al
       mes del inicio del evento. Si «ayer y hoy» cruzan el cambio de mes
       —como el 30 de septiembre y el 1 de octubre— solo uno de los dos cae
       en ese mes. Exigir «2 d cerrado» hacía fallar la prueba un día al mes
       con la app funcionando perfectamente. */
    var enElMes = ayerIso.slice(0, 7) === hoyIso.slice(0, 7) ? 2 : 1;
    chequear("y el panel cuenta los días del mes que muestra",
      new RegExp(enElMes + " d cerrado").test(guardado.nota),
      guardado.nota + " (se esperaban " + enElMes + ")");
    sinErrores("registrar un evento en la bitácora");
  }

  /* Windy abre en el terminal, no en el mapa del mundo. */
  var windy = await pagina.getAttribute("#enlace-windy", "href");
  chequear("Windy apunta a Punta Totoralillo",
    windy.indexOf("-26.85") > 0 && windy.indexOf("-70.81") > 0, windy);

  await pagina.click('.tab[data-vista="operacion"]');
  await pagina.waitForTimeout(300);
  var libro = path.join(__dirname, "fixtures", "recalada.xlsx");
  if(fs.existsSync(libro)){
    await pagina.setInputFiles("#archivo", libro);
    await pagina.waitForTimeout(1800);
    sinErrores("importar un libro CNN-EMB");

    await pagina.click("#bl-datos > summary"); await pagina.waitForTimeout(300);
    var solapas = await pagina.$$eval("#bl-datos .subtab", function(ns){
      return ns.map(function(n){ return n.dataset.panel; });
    });
    for(var j = 0; j < solapas.length; j++){
      await pagina.click('.subtab[data-panel="' + solapas[j] + '"]');
      await pagina.waitForTimeout(250);
      sinErrores("sub-pestaña " + solapas[j]);

      /* Los campos agrupados se desbordaban de su grupo: el ancho mínimo
         intrínseco de un input datetime-local no cede, y los 32 px de borde
         y padding del grupo bastaban para empujarlo fuera. Se veía —la
         mitad del campo cortada— y nada fallaba. Esto lo mide. */
      var fuera = await pagina.evaluate(function(panel){
        var out = [];
        document.querySelectorAll("#" + panel + " .grupo").forEach(function(g){
          var gr = g.getBoundingClientRect();
          if(!gr.width) return;                    // grupo oculto: nada que medir
          g.querySelectorAll("input,select,textarea").forEach(function(i){
            if(i.type === "hidden" || i.offsetParent === null) return;
            var ir = i.getBoundingClientRect();
            if(ir.right > gr.right + 1) out.push(i.id + " +" + Math.round(ir.right - gr.right) + "px");
          });
        });
        return out;
      }, solapas[j]);
      chequear("ningún campo se sale de su grupo en " + solapas[j],
        fuera.length === 0, fuera.join(", "));
    }

    /* El NOR que cuenta es el presentado, el de la columna H del libro. El
       campo del aceptado y su base se retiraron: si vuelven a aparecer, hay
       dos NOR en pantalla otra vez y nadie sabe cuál manda. */
    var nor = await pagina.evaluate(function(){
      var sel = document.getElementById("baseInicio");
      return {aceptado: !!document.getElementById("norAceptado"),
              bases: Array.prototype.map.call(sel.options, function(o){ return o.value; }),
              presentado: !!document.getElementById("nor")};
    });
    chequear("solo queda el NOR presentado",
      !nor.aceptado && nor.presentado && nor.bases.indexOf("norAceptado") < 0,
      JSON.stringify(nor));

    /* Las siluetas de banda viven en el hueco entre el rótulo y los
       controles. Los dos defectos que tuvieron fueron de reparto de
       espacio, no de dibujo: flotada encima se metía debajo de
       «TRIMESTRE» y se leía como un resaltado, y con base `auto` en vez de
       cero partía «Datos de la recalada» en tres líneas para hacerle sitio.
       Las dos cosas se ven; ninguna falla sola. */
    function medirFranjas(){
      var mal = [];
      document.querySelectorAll("[data-franja]").forEach(function(b){
        if(!b.getBoundingClientRect().width) return;        // pestaña oculta
        var f = b.querySelectorAll(":scope > .banda-franja");
        var quien = b.dataset.franja + " en " + (b.textContent || "").trim().slice(0, 24);
        if(f.length !== 1){ mal.push(quien + ": " + f.length + " siluetas"); return; }
        var fr = f[0].getBoundingClientRect();
        Array.prototype.forEach.call(b.children, function(h){
          if(h === f[0]) return;
          var hr = h.getBoundingClientRect();
          if(!hr.width) return;
          if(fr.left < hr.right - 1 && hr.left < fr.right - 1) mal.push(quien + ": pisa «" + (h.textContent||"").trim().slice(0,18) + "»");
        });
        /* Y que no le esté robando ancho al rótulo. Contar líneas no sirve
           —el rótulo de un bloque lleva icono más texto y eso ya da dos
           rectángulos con el título entero—, así que se mide lo que
           importa directamente: se apaga la silueta y se vuelve a medir. Si
           el rótulo crece al apagarla, es que la silueta lo estaba
           apretando, que es exactamente el defecto que hubo. */
        var rot = b.firstElementChild;
        if(rot && rot !== f[0]){
          var con = rot.getBoundingClientRect().width;
          f[0].style.display = "none";
          var sin = rot.getBoundingClientRect().width;
          f[0].style.display = "";
          if(sin > con + 1) mal.push(quien + ": le quita " + Math.round(sin - con) + "px al rótulo");
        }
      });
      return mal;
    }
    var franjas = await pagina.evaluate(medirFranjas);
    chequear("las siluetas de banda no le quitan sitio al texto",
      franjas.length === 0, franjas.join(" · "));

    /* Y otra vez angosto, que es donde el reparto se pelea de verdad: a
       1.600 px sobra sitio para todos y el defecto del `flex-basis:auto` no
       llegaba a verse. A 1.150 px los dos bloques de carga comparten la
       fila y el rótulo pierde ancho si la silueta reclama el suyo. */
    await pagina.setViewportSize({width:1150, height:1000});
    await pagina.waitForTimeout(400);
    var franjasAngosto = await pagina.evaluate(medirFranjas);
    chequear("tampoco con la ventana angosta",
      franjasAngosto.length === 0, franjasAngosto.join(" · "));
    await pagina.setViewportSize({width:1600, height:1000});
    await pagina.waitForTimeout(400);

    /* Un motivo por panel. Los del detalle repetían icono de a tres —tres
       relojes, tres dólares— así que varios pasaron a llevar escena en la
       cabecera, y donde hay escena la marca de agua sobra. Los dos juntos
       son ruido, y es lo que pasaba con `:has` en un navegador que no lo
       soporta: la regla se cae entera y quedan superpuestos. */
    var dobles = await pagina.evaluate(function(){
      var mal = [];
      document.querySelectorAll(".panel").forEach(function(p){
        var hd = p.querySelector(":scope > .panel-hd[data-franja]");
        var agua = p.querySelector(":scope > .panel-fondo");
        if(hd && hd.querySelector(".banda-franja") && agua){
          mal.push(((p.querySelector(".panel-title") || {}).textContent || "?").trim());
        }
      });
      return mal;
    });
    chequear("ningún panel lleva escena y marca de agua a la vez",
      dobles.length === 0, dobles.join(" · "));

    /* Todo panel lleva un motivo de fondo: escena en la cabecera si la
       declaró, y si no la marca de agua con el icono de su propio título.
       La marca se inyecta leyendo el <use> del título, así que un panel sin
       ninguno de los dos —o con la marca equivocada— dice que el inyector
       dejó de encontrarlo. */
    var fondos = await pagina.evaluate(function(){
      var mal = [];
      document.querySelectorAll(".panel").forEach(function(p){
        var uso = p.querySelector(".panel-hd .panel-title use");
        if(!uso) return;
        var titulo = ((p.querySelector(".panel-title") || {}).textContent || "?").trim();
        if(p.querySelector(":scope > .panel-hd[data-franja] > .banda-franja")) return;
        var marcas = p.querySelectorAll(":scope > .panel-fondo");
        if(marcas.length !== 1){ mal.push(titulo + ": " + marcas.length + " marcas"); return; }
        var suyo = marcas[0].querySelector("use").getAttribute("href");
        if(suyo !== uso.getAttribute("href")) mal.push(titulo + ": " + suyo);
      });
      return mal;
    });
    chequear("todo panel lleva su motivo de fondo",
      fondos.length === 0, fondos.join(" · "));

    /* Cada icono es un <use> contra un símbolo del sprite. Escribir mal el
       nombre no lanza error: deja un hueco en blanco donde iba el icono. */
    var rotos = await pagina.evaluate(function(){
      var falta = [];
      document.querySelectorAll("svg use").forEach(function(u){
        var id = (u.getAttribute("href") || "").replace("#", "");
        if(id && !document.getElementById(id) && falta.indexOf(id) < 0) falta.push(id);
      });
      return falta;
    });
    chequear("todos los iconos apuntan a un símbolo del sprite",
      rotos.length === 0, rotos.join(", "));
    // Volver a la solapa de la recalada: el botón vive ahí.
    await pagina.click('.subtab[data-panel="pane-recalada"]'); await pagina.waitForTimeout(250);

    /* La conexión con la nube dejó de ser sub-pestaña y vive plegada al pie:
       sus controles tienen que seguir existiendo, o desconectar un proyecto
       se vuelve imposible sin borrar el almacenamiento a mano. */
    var nube = await pagina.evaluate(function(){
      return ["bl-nube","nube-url","nube-key","nube-tabla",
              "btn-nube-guardar","btn-nube-probar","btn-nube-sincronizar","btn-nube-olvidar"]
        .filter(function(id){ return !document.getElementById(id); });
    });
    chequear("los controles de la nube siguen alcanzables", nube.length === 0,
      nube.length ? "faltan: " + nube.join(", ") : "los ocho");

    /* Pero no a la vista: con el proyecto en js/config.js y todo funcionando,
       «en línea · demurrage_embarques · xxx.supabase.co» no le dice nada a
       nadie del muelle y abre preguntas que no tienen que hacerse. */
    var visible = await pagina.evaluate(function(){
      return !document.getElementById("bl-nube").hidden;
    });
    chequear("el bloque de la nube no se muestra funcionando", visible === false,
      visible ? "visible" : "oculto");

    /* El draft survey no viene en el CNN-EMB: llega en un correo de la
       agencia días después, y hasta que llegue el laytime sale del
       pesómetro. Escribirlo tiene que rehacer el tonelaje del cálculo, el
       laytime y la plata; si solo pintara la ficha del calado, el número
       cambiaría en pantalla y el demurrage seguiría con el viejo. */
    await pagina.click("#btn-corregir"); await pagina.waitForTimeout(300);
    var antes = await pagina.evaluate(function(){
      return {ton: document.getElementById("tonelaje").value,
              origen: document.getElementById("rteOrigenTonelaje").value,
              allowed: document.getElementById("k-allowed").textContent};
    });
    await pagina.fill("#rteCalado", "180000");
    await pagina.dispatchEvent("#rteCalado", "change");
    await pagina.waitForTimeout(600);
    var despues = await pagina.evaluate(function(){
      return {ton: document.getElementById("tonelaje").value,
              origen: document.getElementById("rteOrigenTonelaje").value,
              allowed: document.getElementById("k-allowed").textContent,
              sub: document.getElementById("k-allowed-sub").textContent};
    });
    chequear("el calado escrito pasa a ser el tonelaje del cálculo",
      despues.ton === "180000" && despues.origen === "calado",
      JSON.stringify(despues));
    /* 180.000 / 30.000 = 6 días = 144 h exactas. */
    chequear("y el laytime se rehace con esa cifra",
      despues.allowed.indexOf("144h") === 0 && despues.allowed !== antes.allowed,
      antes.allowed + " -> " + despues.allowed);
    chequear("la ficha muestra la división con el calado",
      despues.sub.indexOf("180.000 t") >= 0, despues.sub);
    sinErrores("escribir el calado");
    await pagina.click("#btn-corregir"); await pagina.waitForTimeout(200);

    /* El libro de reportería: sin él, renderTemporada no corre y las fichas
       de la temporada nunca se repintan, así que las comprobaciones de abajo
       pasarían sin haber ejercido nada. */
    var libroRep = path.join(__dirname, "fixtures", "reporteria.xlsx");
    var hayRep = fs.existsSync(libroRep);
    if(hayRep){
      await pagina.setInputFiles("#archivo-rep", libroRep);
      await pagina.waitForTimeout(2500);
      sinErrores("importar el libro de reportería");
      var pintada = await pagina.evaluate(function(){
        return document.getElementById("temp-hero-val").textContent;
      });
      chequear("la temporada se pinta", pintada !== "—" && pintada !== "", pintada);
    }

    /* TM embarcadas cruza dos fuentes que no se hablan: el filtro recorta el
       LIBRO y el calado vive en los CNN-EMB. Lo que se comprueba acá es la
       cañería —que el periodo filtrado llegue hasta la ficha—, porque la
       suma en sí ya tiene sus propias pruebas. El denominador de la ficha
       tiene que ser el mismo número de recaladas que muestra la tira. */
    var emb = await pagina.evaluate(function(){
      return {naves: document.getElementById("t-recaladas").textContent.trim(),
              sub: document.getElementById("t-embarcado-sub").textContent,
              valor: document.getElementById("t-embarcado").textContent.trim()};
    });
    chequear("TM embarcadas cuenta sobre las recaladas del filtro",
      emb.sub.indexOf(emb.naves) >= 0, JSON.stringify(emb));

    /* Y que siga cuadrando al mover el filtro, que es para lo que se pidió
       la ficha. Los dos desplegables solo ofrecen valores que existen en el
       libro, así que se toma el primer mes real en vez de inventar uno. */
    var meses = await pagina.$$eval("#filtro-mes option", function(ns){
      return ns.map(function(n){ return n.value; }).filter(function(v){ return v !== ""; });
    });
    chequear("el filtro ofrece meses del libro", meses.length > 0, meses.join(","));
    if(meses.length){
      await pagina.selectOption("#filtro-mes", meses[0]);
      await pagina.waitForTimeout(500);
      var filtrado = await pagina.evaluate(function(){
        return {naves: document.getElementById("t-recaladas").textContent.trim(),
                sub: document.getElementById("t-embarcado-sub").textContent};
      });
      chequear("filtrando por mes, la ficha sigue cuadrando con la tira",
        filtrado.sub.indexOf(filtrado.naves) >= 0, JSON.stringify(filtrado));
      await pagina.selectOption("#filtro-mes", "");
      await pagina.waitForTimeout(400);
    }
    sinErrores("filtrar la temporada");

    /* `con-chispa` viene del HTML y abre la fila donde se dibuja la chispa,
       pero renderTemporada reescribe el className entero de la ficha para
       ponerle «demurrage» o «despatch». Cuando se lo llevaba por delante, el
       contenedor medía 48 px —el mínimo— y la chispa salía como una rayita
       en medio de la ficha, sin que nada fallara. */
    var chispas = await pagina.evaluate(function(){
      return Array.prototype.map.call(document.querySelectorAll(".kpi-chispa"), function(n){
        var k = n.closest(".kpi");
        return {id: n.id, abre: k.classList.contains("con-chispa"),
                ancho: Math.round(n.getBoundingClientRect().width),
                ficha: Math.round(k.getBoundingClientRect().width)};
      });
    });
    var angostas = chispas.filter(function(c){ return !c.abre || c.ancho < c.ficha * 0.6; });
    chequear("las fichas con chispa le dan el ancho completo",
      chispas.length === 6 && angostas.length === 0,
      chispas.length + " fichas · " + JSON.stringify(angostas));

    /* Las dos cargas son botones arriba; arrastrar pasó a la página entera. */
    var carga = await pagina.evaluate(function(){
      return {nave: !!document.getElementById("btn-cargar"),
              nor: !!document.getElementById("btn-cargar-nor"),
              velo: !!document.getElementById("velo-soltar"),
              zonasViejas: !!document.getElementById("soltar") || !!document.getElementById("soltar-nor")};
    });
    chequear("están los dos botones de carga y el velo de arrastre",
      carga.nave && carga.nor && carga.velo && !carga.zonasViejas, JSON.stringify(carga));
    await pagina.click("#btn-calcular"); await pagina.waitForTimeout(700);
    sinErrores("recalcular");

    /* Los hitos del NOR van por su propio camino de render y el libro de
       prueba no los trae, así que sin esto la ficha de ETA nunca se pinta.
       Se agregó después de que `fechaFicha` naciera llamándose `fechaCorta`:
       había otra función con ese nombre más abajo, ganó la última y la ficha
       reventaba al recibir una fecha donde esperaba el id de un campo.
       `node --check` pasaba y ninguna prueba tocaba ese camino. */
    await pagina.evaluate(function(){
      var set = function(id, v){
        var e = document.getElementById(id);
        e.value = v; e.dispatchEvent(new Event("change", {bubbles:true}));
      };
      set("eta", "2026-08-28T08:00");
      set("arribo", "2026-08-30T14:10");
    });
    await pagina.waitForTimeout(700);
    sinErrores("pintar los hitos de ETA y arribo");
    var eta = await pagina.evaluate(function(){
      return document.getElementById("k-eta").textContent;
    });
    chequear("la ficha de ETA muestra la fecha", eta !== "—" && eta !== "", eta);

    /* El gráfico de utilización se dibuja en SVG y un fallo suyo no lanza
       error: deja el panel en blanco. Se cuentan las marcas. */
    var bal = await pagina.evaluate(function(){
      var svg = document.querySelector("#g-balance svg");
      return {marcas: svg ? svg.querySelectorAll("rect").length : 0,
              filas:  svg ? svg.querySelectorAll("text").length : 0,
              leyenda: document.getElementById("ley-balance").children.length};
    });
    /* La conciliación solo aparece con el libro de reportería cargado; sin
       él tiene que quedarse oculta y no reventar buscando una temporada que
       no existe. */
    var conc = await pagina.evaluate(function(){
      return document.getElementById("panel-conciliacion").hidden;
    });
    chequear("sin reportería, la conciliación se queda oculta", conc === true, String(conc));

    chequear("el balance de laytime dibuja sus barras", bal.marcas >= 2,
      bal.marcas + " marcas, " + bal.filas + " rótulos, " + bal.leyenda + " en la leyenda");

    await pagina.click("#btn-presentar"); await pagina.waitForTimeout(900);
    sinErrores("abrir modo presentación");
    await pagina.keyboard.press("ArrowRight"); await pagina.waitForTimeout(400);
    await pagina.keyboard.press("Escape"); await pagina.waitForTimeout(400);
    sinErrores("recorrer y cerrar la presentación");
  }else{
    console.log("  (sin tests/fixtures/recalada.xlsx: se omite la parte de la recalada)");
  }

  await navegador.close();
  s.srv.close();

  console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
  process.exit(fallas === 0 ? 0 : 1);
})().catch(function(e){
  console.log("\nLa prueba de humo no pudo completarse: " + e.message);
  process.exit(1);
});
