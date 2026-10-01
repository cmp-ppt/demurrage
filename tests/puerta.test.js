/**
 * Prueba de la puerta: que sin sesión no se lea nada y que lo que viaja al
 * servidor sea el token del usuario y no la anon key.
 *   node tests/puerta.test.js
 *
 * Levanta un Supabase de mentira —auth + PostgREST, lo justo— que rechaza
 * explícitamente la anon key en las rutas de datos. Esa es la comprobación
 * que importa: si algún día alguien vuelve a poner la anon key en la
 * cabecera Authorization, el sitio publicado queda abierto a cualquiera que
 * dé con la URL, y ninguna prueba de lógica lo notaría.
 *
 * Necesita Playwright. Sin él se omite, como el resto de las de navegador.
 */
var fs = require("fs"), path = require("path"), http = require("http"), os = require("os");
var XLSX = require("../js/vendor/xlsx.full.min.js");
var raiz = path.join(__dirname, "..");

var chromium;
try { chromium = require("/opt/node22/lib/node_modules/playwright").chromium; }
catch(e){
  try { chromium = require("playwright").chromium; }
  catch(e2){
    console.log("\nPrueba de la puerta omitida: Playwright no está disponible.");
    process.exit(0);
  }
}

var ANON = "anon-key-publica";
var USUARIOS = {"hector@cmp.cl": "clave-buena"};

/* ───────────────────────── Supabase de mentira ───────────────────── */
function supabaseFalso(vidaSegundos){
  var tokens = {}, refrescos = {}, filas = {}, n = 0, refrescosPedidos = 0;
  var temporada = null;   // el libro compartido: una sola fila
  var turnos = {};        // las planillas de turno: una fila por mes
  function emitir(email){
    var a = "acc" + (++n), r = "ref" + n;
    tokens[a] = email; refrescos[r] = email;
    return {access_token:a, refresh_token:r, expires_in: vidaSegundos, user:{email:email, id:"u"+n}};
  }
  function cuerpo(req){
    return new Promise(function(ok){ var b = ""; req.on("data", function(d){ b += d; }); req.on("end", function(){ ok(b); }); });
  }
  var srv = http.createServer(function(req, res){
    var u = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    if(req.method === "OPTIONS"){ res.writeHead(204); return res.end(); }

    if(u.pathname === "/auth/v1/token"){
      /* Como los despliegues reales de Supabase: la petición de auth tiene
         que traer `apikey` Y `Authorization: Bearer <clave del proyecto>`.
         Mandando solo la primera, el servidor contesta 401 y en la pantalla
         se lee «correo o contraseña incorrectos» — con el resultado de que
         NINGÚN usuario puede entrar aunque la clave esté bien. */
      if(req.headers.apikey !== ANON || req.headers.authorization !== "Bearer " + ANON){
        res.writeHead(401, {"Content-Type":"application/json"});
        return res.end(JSON.stringify({}));
      }
      return cuerpo(req).then(function(txt){
        var b = {};
        try{ b = JSON.parse(txt || "{}"); }catch(e){}
        if(u.searchParams.get("grant_type") === "refresh_token"){
          refrescosPedidos++;
          var em = refrescos[b.refresh_token];
          if(!em){ res.writeHead(400, {"Content-Type":"application/json"});
                   return res.end(JSON.stringify({error_description:"Invalid Refresh Token"})); }
          delete refrescos[b.refresh_token];   // Supabase quema el anterior
          res.writeHead(200, {"Content-Type":"application/json"});
          return res.end(JSON.stringify(emitir(em)));
        }
        if(USUARIOS[b.email] && USUARIOS[b.email] === b.password){
          res.writeHead(200, {"Content-Type":"application/json"});
          return res.end(JSON.stringify(emitir(b.email)));
        }
        res.writeHead(400, {"Content-Type":"application/json"});
        res.end(JSON.stringify({error_description:"Invalid login credentials"}));
      });
    }
    if(u.pathname === "/auth/v1/logout"){ res.writeHead(204); return res.end(); }

    if(u.pathname.indexOf("/rest/v1/") === 0){
      var t = (req.headers.authorization || "").replace(/^Bearer /, "");
      // La anon key no autoriza: es el papel de la política `to authenticated`.
      if(t === ANON || !tokens[t]){
        res.writeHead(401, {"Content-Type":"application/json"});
        return res.end(JSON.stringify({message:"JWT expired or invalid"}));
      }
      /* La bitácora no existe en este proyecto falso, a propósito: es el
         estado real de un Supabase al que todavía no le corrieron el SQL, y
         PostgREST contesta 404 a una tabla que no está en su caché. */
      if(u.pathname.indexOf("/rest/v1/demurrage_bitacora") === 0){
        res.writeHead(404, {"Content-Type":"application/json"});
        return res.end(JSON.stringify({code:"42P01",
          message:'relation "public.demurrage_bitacora" does not exist'}));
      }
      /* Las planillas de turno sí existen en este proyecto falso —al
         contrario de la bitácora— para recorrer el camino bueno: una fila
         por mes, y cargar un mes no toca los otros. */
      if(u.pathname.indexOf("/rest/v1/demurrage_turnos") === 0){
        if(req.method === "GET"){
          res.writeHead(200, {"Content-Type":"application/json"});
          return res.end(JSON.stringify(Object.keys(turnos).map(function(k){ return turnos[k]; })));
        }
        if(req.method === "POST"){
          return cuerpo(req).then(function(txt){
            try{
              var b = JSON.parse(txt || "[]");
              (Array.isArray(b) ? b : [b]).forEach(function(f){
                if(f && f.mes) turnos[f.mes] = f;
              });
            }catch(e){}
            res.writeHead(201); res.end();
          });
        }
      }
      /* El libro de reportería: una fila, se reemplaza entera. */
      if(u.pathname.indexOf("/rest/v1/demurrage_temporada") === 0){
        if(req.method === "GET"){
          res.writeHead(200, {"Content-Type":"application/json"});
          return res.end(JSON.stringify(temporada ? [temporada] : []));
        }
        if(req.method === "POST"){
          return cuerpo(req).then(function(txt){
            try{ temporada = JSON.parse(txt || "null"); }catch(e){}
            res.writeHead(201); res.end();
          });
        }
      }
      if(req.method === "GET"){
        res.writeHead(200, {"Content-Type":"application/json"});
        return res.end(JSON.stringify(Object.keys(filas).map(function(k){ return filas[k]; })));
      }
      if(req.method === "POST"){
        return cuerpo(req).then(function(txt){
          try{ var f = JSON.parse(txt || "{}"); if(f.codigo) filas[f.codigo] = f; }catch(e){}
          res.writeHead(201); res.end();
        });
      }
      if(req.method === "DELETE"){ res.writeHead(204); return res.end(); }
    }
    res.writeHead(404); res.end();
  });
  return new Promise(function(listo){
    srv.listen(0, "127.0.0.1", function(){
      listo({srv: srv, puerto: srv.address().port,
             filas: filas, refrescos: function(){ return refrescosPedidos; },
             temporada: function(){ return temporada; },
             turnos: function(){ return turnos; }});
    });
  });
}

/* ──────────────────────── servidor del sitio ─────────────────────── */
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
  console.log("\nLa puerta, en un navegador real");
  var api = await supabaseFalso(3600);
  var sitio = await servir();
  var nav = await chromium.launch();
  var ctx = await nav.newContext({viewport:{width:1280, height:900}});
  var pg = await ctx.newPage();
  var errores = [];
  pg.on("pageerror", function(e){ errores.push(String(e)); });
  pg.on("dialog", function(d){ d.accept(); });
  var autorizaciones = [];
  pg.on("request", function(r){
    if(/\/rest\/v1\//.test(r.url())) autorizaciones.push(r.headers()["authorization"] || "");
  });

  var URL_API = "http://127.0.0.1:" + api.puerto;
  var base = "http://127.0.0.1:" + sitio.puerto + "/";
  var visible = function(){ return pg.evaluate(function(){ return !document.getElementById("puerta").hidden; }); };
  var chip = function(){ return pg.evaluate(function(){ return document.getElementById("nube-estado").textContent; }); };

  try{
    /* El sitio publicado trae el proyecto en js/config.js —es lo que hace que
       compartir el enlace sirva— así que la puerta aparece de entrada. El
       caso «sin proyecto» es el de una publicación en modo standalone: se
       reproduce desconectando, que es la decisión que manda sobre el
       archivo. */
    await pg.goto(base, {waitUntil:"networkidle"});
    chequear("el sitio publicado pide cuenta desde la primera visita", (await visible()) === true);

    await pg.evaluate(function(){
      localStorage.setItem("demurrage-ppt.nube.v1", JSON.stringify({desconectado:true}));
    });
    await pg.reload({waitUntil:"networkidle"});
    await pg.waitForTimeout(300);
    chequear("desconectado, no pide login", (await visible()) === false);

    /* Se guarda la URL COMO LA MUESTRA EL PANEL en Data API, con «/rest/v1»
       pegado. Pegada tal cual, la app pedía «…/rest/v1/auth/v1/token» y
       Supabase contestaba «Invalid path specified in request URL». Guardarla
       así en la prueba es lo que impide que vuelva a pasar. */
    await pg.evaluate(function(a){
      localStorage.setItem("demurrage-ppt.nube.v1", JSON.stringify(
        {url:a + "/rest/v1", anonKey:"anon-key-publica", tabla:"demurrage_embarques"}));
    }, URL_API);
    await pg.reload({waitUntil:"networkidle"});
    await pg.waitForTimeout(400);
    chequear("con proyecto y sin sesión, la puerta cierra el paso", (await visible()) === true);
    chequear("y el chip avisa que los cambios no están llegando",
      /sin conectar/i.test(await chip()), await chip());
    /* Apuntar al proyecto equivocado se diagnostica como «no me acuerdo de
       la clave» si la pantalla no dice a dónde se está conectando. */
    var rotulo = await pg.evaluate(function(){ return document.getElementById("puerta-proyecto").textContent; });
    chequear("la puerta nombra el proyecto al que se conecta",
      rotulo.indexOf("127.0.0.1") >= 0, rotulo);
    chequear("y ya sin el /rest/v1 que trae el panel",
      rotulo.indexOf("/rest/v1") === -1, rotulo);

    chequear("sin sesión no se pide ni un dato al servidor",
      autorizaciones.length === 0, autorizaciones.length + " peticiones");

    await pg.fill("#puerta-email", "hector@cmp.cl");
    await pg.fill("#puerta-clave", "equivocada");
    await pg.click("#btn-entrar"); await pg.waitForTimeout(700);
    var aviso = (await pg.evaluate(function(){ return document.getElementById("puerta-aviso").textContent; })).trim();
    chequear("una clave mala no abre la puerta", (await visible()) === true);
    chequear("y lo dice en castellano", /incorrect/i.test(aviso), aviso);

    await pg.fill("#puerta-clave", "clave-buena");
    await pg.click("#btn-entrar"); await pg.waitForTimeout(1200);
    chequear("la clave buena entra", (await visible()) === false);
    /* El servidor de mentira responde 401 si falta la cabecera Authorization
       con la clave del proyecto. Que se haya entrado demuestra que va. */
    chequear("la petición de auth llevó las dos cabeceras que exige Supabase", true,
      "apikey + Authorization Bearer <clave>");
    chequear("la cabecera muestra quién entró",
      (await pg.evaluate(function(){ return document.getElementById("sesion-quien").textContent; })) === "hector@cmp.cl");
    chequear("el chip pasa a «En línea»", /en línea/i.test(await chip()), await chip());

    /* Y sigue diciéndolo con la bitácora respondiendo 404. La tabla se crea
       corriendo el SQL aparte, así que faltar es su estado normal durante
       días; cuando subir un evento ponía el estado global en error, la app
       entera decía «Sin conexión» mientras los embarques y la temporada
       viajaban perfectamente. Un dato accesorio que no se comparte no puede
       parecer una caída de la red. */
    await pg.evaluate(function(){
      /* Un evento local pendiente: sin nada que subir, el camino que
         rompía ni siquiera se recorre y la prueba pasaría sin probar. */
      localStorage.setItem("demurrage-ppt.bitacora.v1", JSON.stringify([{
        id:"ev-prueba", desde:"2026-09-21", hasta:"2026-09-22", estado:"cerrado",
        causa:"Paro o movilización portuaria", nota:"", registradoPor:"hector@cmp.cl",
        actualizadoEn:"2026-09-22T10:00:00.000Z"
      }]));
    });
    await pg.reload({waitUntil:"networkidle"});
    await pg.waitForTimeout(2500);
    chequear("con la bitácora sin tabla, el chip sigue en «En línea»",
      /en línea/i.test(await chip()), await chip());
    chequear("y el evento no se pierde: queda guardado en el equipo",
      await pg.evaluate(function(){
        return JSON.parse(localStorage.getItem("demurrage-ppt.bitacora.v1") || "[]").length;
      }), 1);

    /* ── Las planillas de turno van y vuelven ──
       Antes vivían solo en el localStorage del navegador que las cargó, y
       las otras dos personas tenían que arrastrar las mismas nueve
       planillas para ver el tonelaje del mes. Lo que se comprueba acá es el
       viaje completo: se carga una, llega al servidor, se borra lo local y
       vuelve a bajar. Sin la segunda mitad la prueba pasaría con una app
       que sube y nunca lee. */
    var tmpT = fs.mkdtempSync(path.join(os.tmpdir(), "puerta-turno-"));
    var planillaT = path.join(tmpT, "DATOS_TURNO_PPT_30-09-2026.xlsx");
    (function(){
      var wb = XLSX.utils.book_new();
      /* La hoja real deja la columna A vacía. Las cifras son las de
         septiembre: 706.510 de pellet feed más 107.074 de sinter. */
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["Tonelaje acumulado Mes"],
        ["Pellet Feed", "PM", "CNN", "TOTAL"],
        ["CHINA TRIUMPH", null, null, 135872],
        ["PIGI", null, null, 198027],
        ["NISEKO QUEEN", null, null, 165200],
        ["MINERAL COMOROS", null, null, 207411],
        ["TOTAL", null, null, 706510],
        [],
        ["Sinter Feed", "Cancha 1", "Cancha 3", "HSF"],
        ["CHINA TRIUMPH", null, null, 65022],
        ["NISEKO QUEEN", null, null, 42052],
        ["TOTAL", null, null, 107074]
      ].map(function(f){ return [null].concat(f); })), "ACUMULADO EMBARQUE");
      fs.writeFileSync(planillaT, Buffer.from(XLSX.write(wb, {type:"array", bookType:"xlsx"})));
    })();
    await pg.setInputFiles("#archivo", planillaT);
    await pg.waitForTimeout(2000);
    var subido = api.turnos()["2026-09"];
    chequear("la planilla cargada llega al servidor", !!subido,
      JSON.stringify(Object.keys(api.turnos())));
    chequear("con el tonelaje del mes", subido ? Number(subido.total_mineral) : 0, 813584);
    chequear("y con quién la cargó", subido ? subido.cargado_por : "", "hector@cmp.cl");
    chequear("no viajó la anon key al subirla",
      autorizaciones.every(function(a){ return a.indexOf(ANON) === -1; }),
      autorizaciones.join(" , "));

    /* Y la vuelta: otro navegador, sin nada guardado, tiene que verla. */
    await pg.evaluate(function(){ localStorage.removeItem("demurrage-ppt.turnos.v1"); });
    await pg.reload({waitUntil:"networkidle"});
    await pg.waitForTimeout(2500);
    var bajado = await pg.evaluate(function(){
      var m = JSON.parse(localStorage.getItem("demurrage-ppt.turnos.v1") || "{}");
      return m["2026-09"] ? m["2026-09"].totalMineral : null;
    });
    chequear("y un navegador sin nada guardado la recibe", bajado, 813584);

    /* La comprobación que importa: lo que viaja es el token del usuario. */
    chequear("ya hubo peticiones de datos", autorizaciones.length > 0, autorizaciones.length + "");
    chequear("ninguna llevó la anon key en Authorization",
      autorizaciones.every(function(a){ return a.indexOf(ANON) === -1; }),
      autorizaciones.join(" , "));
    chequear("todas llevaron un Bearer de sesión",
      autorizaciones.every(function(a){ return /^Bearer acc\d+$/.test(a); }),
      autorizaciones.join(" , "));

    /* El token dura una hora y la app se deja abierta todo el día: si no se
       renueva sola, la primera petición después del almuerzo falla con 401 y
       el usuario ve un error donde debería ver sus recaladas. Se envejece la
       sesión guardada a mano y se comprueba que pide una nueva. */
    var antes = api.refrescos();
    await pg.evaluate(function(){
      var s = JSON.parse(localStorage.getItem("demurrage-ppt.sesion.v1"));
      s.expiraEn = Date.now() + 30000;     // dentro del margen de dos minutos
      localStorage.setItem("demurrage-ppt.sesion.v1", JSON.stringify(s));
    });
    autorizaciones.length = 0;
    // El botón vive dentro de un bloque plegado: se dispara sin abrirlo.
    await pg.evaluate(function(){ document.getElementById("btn-nube-sincronizar").click(); });
    await pg.waitForTimeout(1200);
    chequear("un token por vencer se renueva solo", api.refrescos() > antes,
      (api.refrescos() - antes) + " renovación(es)");
    chequear("y la petición sale con el token nuevo",
      autorizaciones.length > 0 && /^Bearer acc\d+$/.test(autorizaciones[autorizaciones.length-1]),
      autorizaciones.join(" , "));
    chequear("la puerta no reaparece por renovar", (await visible()) === false);

    await pg.reload({waitUntil:"networkidle"});
    await pg.waitForTimeout(500);
    chequear("la sesión sobrevive a recargar", (await visible()) === false);

    await pg.click("#btn-salir"); await pg.waitForTimeout(700);
    chequear("al salir vuelve la puerta", (await visible()) === true);

    /* Nadie se queda afuera de su propio cálculo porque se cayó la red. */
    await pg.click("#btn-sin-conectar"); await pg.waitForTimeout(400);
    chequear("se puede seguir sin conectar", (await visible()) === false);
    chequear("pero el chip lo deja dicho", /sin conectar/i.test(await chip()), await chip());

    /* ── El libro de reportería, compartido ──────────────────────────
       Una persona lo carga y las otras dos lo ven sin repetir el Excel. Sin
       esto, dos tercios del equipo veían la banda Temporada en blanco. */
    await pg.evaluate(function(){
      localStorage.removeItem("demurrage-ppt.nube.v1");   // vuelve a la del sitio
    });
    await pg.goto(base, {waitUntil:"networkidle"});
    await pg.evaluate(function(a){
      localStorage.setItem("demurrage-ppt.nube.v1", JSON.stringify(
        {url:a, anonKey:"anon-key-publica", tabla:"demurrage_embarques"}));
    }, URL_API);
    await pg.reload({waitUntil:"networkidle"});
    await pg.waitForTimeout(400);
    await pg.fill("#puerta-email", "hector@cmp.cl");
    await pg.fill("#puerta-clave", "clave-buena");
    await pg.click("#btn-entrar"); await pg.waitForTimeout(1000);

    var libro = path.join(raiz, "tests", "fixtures", "reporteria.xlsx");
    if(fs.existsSync(libro)){
      await pg.setInputFiles("#archivo-rep", libro);
      await pg.waitForTimeout(2500);
      var subido = api.temporada();
      chequear("quien carga el libro lo comparte",
        !!(subido && subido.datos && subido.datos.recaladas && subido.datos.recaladas.length),
        subido ? subido.datos.recaladas.length + " recaladas · por " + subido.cargado_por : "no subió");

      /* Otra persona: navegador limpio, misma sesión de otro usuario. */
      var otro = await nav.newContext({viewport:{width:1280, height:900}});
      var pg2 = await otro.newPage();
      var errs2 = [];
      pg2.on("pageerror", function(e){ errs2.push(String(e)); });
      await pg2.goto(base, {waitUntil:"networkidle"});
      await pg2.evaluate(function(a){
        localStorage.setItem("demurrage-ppt.nube.v1", JSON.stringify(
          {url:a, anonKey:"anon-key-publica", tabla:"demurrage_embarques"}));
      }, URL_API);
      await pg2.reload({waitUntil:"networkidle"});
      await pg2.fill("#puerta-email", "hector@cmp.cl");
      await pg2.fill("#puerta-clave", "clave-buena");
      await pg2.click("#btn-entrar"); await pg2.waitForTimeout(2500);
      var visto = await pg2.evaluate(function(){
        return {rotulo: document.getElementById("rep-origen").textContent,
                recaladas: document.getElementById("t-recaladas").textContent,
                meses: Object.keys(JSON.parse(
                  localStorage.getItem("demurrage-ppt.turnos.v1") || "{}")).sort().join(",")};
      });
      chequear("el segundo navegador recibe el libro sin cargar nada",
        /recaladas/.test(visto.rotulo) && visto.recaladas !== "—",
        visto.rotulo + " · resumen: " + visto.recaladas);
      /* Y la planilla de turno que cargó el primero. Es la razón de ser de
         la tabla: la carga uno y la ven los tres, sin repetir el Excel. */
      chequear("y también la planilla de turno del primero",
        visto.meses === "2026-09", visto.meses || "(ninguna)");
      chequear("el rótulo del bloque nombra los dos libros",
        /recaladas/.test(visto.rotulo) && /mes de turno/.test(visto.rotulo), visto.rotulo);
      chequear("y sin errores al adoptarlo", errs2.length === 0, errs2.join(" | ") || "ninguno");
      await otro.close();
    }else{
      console.log("  (sin tests/fixtures/reporteria.xlsx: se omite el libro compartido)");
    }

    chequear("ningún error de navegador en todo el recorrido",
      errores.length === 0, errores.join(" | ") || "ninguno");
  }catch(e){
    console.log("\nLa prueba no pudo completarse: " + e.message);
    fallas++; total++;
  }finally{
    await nav.close(); sitio.srv.close(); api.srv.close();
  }

  console.log("\n" + (fallas === 0 ? "TODO OK" : "HAY FALLAS") + ": " + (total - fallas) + "/" + total + " comprobaciones.");
  process.exit(fallas === 0 ? 0 : 1);
})();
