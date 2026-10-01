/**
 * Dashboard de laytime & demurrage — PPT.
 * Une el motor de cálculo, el lector del RTE y las primitivas de gráfico.
 */
(function(){
  "use strict";

  var L = window.Laytime, BIT = window.Bitacora, TUR = window.Turno, IMP = window.ImportarRTE, G = window.Graficos, FL = window.Flota, NOR = window.LeerNOR, LEC = window.Lectura, PRES = window.Presentacion, NUBE = window.Nube, CLIMA = window.Clima, REP = window.Reporteria, TRI = window.Trimestres, CONC = window.Conciliar, SESION = window.Sesion;
  var CLAVE = "demurrage-ppt.v2";
  var $ = function(id){ return document.getElementById(id); };

  /* Paleta: sale entera de los tokens CSS. Antes la mitad estaba escrita a
     mano aquí, y al pasar el tablero de oscuro a claro esas eran justo las
     que no se enteraban. El fallback solo cubre que la hoja no cargue. */
  function token(nombre, respaldo){
    var v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return v || respaldo;
  }
  /* El orden verde → azul → naranja es el orden de apilado y no se altera:
     es lo que mantiene separados los pares adyacentes en la validación. */
  var SERIE = {
    efectiva:      token("--serie-efectiva",      "#1F8A4C"),
    nocontrolable: token("--serie-nocontrolable", "#2362B0"),
    controlable:   token("--serie-controlable",   "#C25A22"),
    neutro:        token("--serie-neutro",        "#8798AE")
  };
  /* Colores de estado: se usan como color de cifra en fichas de 18 px, que
     no es «texto grande», así que son pasos más oscuros que los de serie.
     OK no es SERIE.efectiva por eso mismo. */
  var CRITICO = token("--alarm-critical", "#C62828");
  var OK      = token("--status-running", "#166B3B");
  var MAYOR   = token("--alarm-major",    "#A65A0B");
  var APAGADO = token("--op-text-3",      "#6E7C92");
  var TEXTO2  = token("--op-text-2",      "#54637A");
  var AVISO   = token("--alarm-warning",  "#8A6D0B");   // diferencia que hay que mirar, no falla

  var flota = [];          // recaladas de la temporada
  var ultimoTimeSheet = null;
  var conciliacionActual = null;   // fila del libro emparejada con la recalada abierta
  /* Puerta de servicio: ?nube en la dirección deja a la vista el bloque de
     conexión aunque todo esté bien, para cambiar de proyecto o desconectar
     sin tener que tocar el almacenamiento del navegador a mano. */
  var forzarNube = /[?&]nube(=|&|$)/.test(location.search);
  var serieClima = [];     // serie horaria del pronóstico, una vez consultado

  // Las horas vienen del libro: se editan solo si el registro trae un error.
  var horasBloqueadas = true;

  var CAMPOS = ["nave","codigo","tonelaje","eslora","tarifaMuelle",
                "eta","arribo","nor","freePratique","primeraEspia","inicioCarga",
                "finCarga","ultimaEspia","baseInicio","turnTime","baseTermino","modoPermitido","tasaDia",
                "horasFijas","modoConteo","tarifaDemurrage","modoDespatch","porcentajeDespatch",
                "tarifaDespatch","festivos",
                "horasMantenimientoMuellaje","horasGira","horasTotales","horasOpEfectiva",
                /* Valores propios del RTE: se guardan y viajan a la temporada. Solo
                   uno se edita, rteCalado, y tiene su propio enganche más abajo.
                   rteCaladoRte guarda el calado tal como vino en el CNN-EMB, que
                   es provisorio: sirve para saber si lo que hay en el campo lo
                   puso una persona o lo puso la importación. */
                "rteCalado","rteCaladoRte","rtePesometro08","rtePesometro09","rteTasaEfectiva","rteTasaHora",
                "rteTasaDia","rteHorasReloj","rteOrigenTonelaje"];

  /* ─────────────────────────── formato ─────────────────────────── */

  function usd(v){
    return "US$ " + (Math.round(v)).toLocaleString("es-CL");
  }
  function usdExacto(v){
    return "US$ " + (Math.round(v*100)/100).toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  /* Millones para las escalas: "US$ 4,24 M" cabe donde "US$ 4.243.851" se
     corta, y a tres metros de una pantalla de sala es lo que se alcanza a
     leer. Los montos exactos siguen en las fichas y en la tabla. */
  function usdCompacto(v){
    var n = Math.abs(v);
    if(n >= 1e6) return "US$ " + (v/1e6).toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:2}) + " M";
    if(n >= 1e4) return "US$ " + Math.round(v/1000).toLocaleString("es-CL") + " k";
    return usd(v);
  }
  function hrs(v){ return L.horasAHm(v); }
  function hDec(v){ return (Math.round(v*100)/100).toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:2}) + " h"; }
  /* Días decimales con cuatro cifras, que es como los expresa el Laytime
     Statement del área comercial: «14,3479 days at the rate of US$ 41.906,00
     per day». Con ese número a la vista la liquidación se puede rehacer en
     una calculadora sin traducir horas y minutos a fracción de día. */
  function diasDec(v){ return (v/24).toLocaleString("es-CL",{minimumFractionDigits:4,maximumFractionDigits:4}) + " d"; }
  function pct(v){ return (Math.round(v*10)/10).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1}) + " %"; }
  function fechaLarga(d){
    if(!d) return "—";
    return d.toLocaleDateString("es-CL",{day:"2-digit",month:"short",year:"numeric"}) + " " +
           String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
  }
  /* Sin el año: en la ficha compite con la hora por el ancho y el año ya
     está en la cabecera de la recalada. No se llama `fechaCorta` porque ese
     nombre ya está tomado más abajo por otra que recibe el id del campo, no
     la fecha; declararla dos veces deja ganar a la última y el error aparece
     recién al pintar. */
  function fechaFicha(d){
    if(!d) return "—";
    return d.toLocaleDateString("es-CL",{day:"2-digit",month:"short"}).replace(".","").replace("-"," ") + " " +
           String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
  }
  /** Date -> el formato que espera un <input type="datetime-local">, en hora local. */
  function aInput(d){
    if(!d) return "";
    var dos = function(n){ return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + dos(d.getMonth()+1) + "-" + dos(d.getDate()) +
           "T" + dos(d.getHours()) + ":" + dos(d.getMinutes());
  }
  function fh(id){ return L.parseFechaHora($(id).value); }
  function num(id){ var n = parseFloat($(id).value); return isNaN(n) ? 0 : n; }
  function esc(t){ return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  /* ──────────────────── tabla de deducciones ───────────────────── */

  var GRUPOS = [
    {lado:"puerto", titulo:"Detenciones del terminal", responsable:"Terminal"},
    {lado:"clima",  titulo:"Clima y fuerza mayor",     responsable:"Fuerza mayor"},
    {lado:"nave",   titulo:"Tiempos de la nave",       responsable:"Nave"},
    {lado:"otro",   titulo:"Otras deducciones",        responsable:"Otro"}
  ];
  function responsableDe(lado){
    for(var i=0;i<GRUPOS.length;i++){ if(GRUPOS[i].lado === lado) return GRUPOS[i].responsable; }
    return "Otro";
  }

  function filaDeduccion(d){
    var tr = document.createElement("tr");
    tr.dataset.lado = d.lado;
    tr.dataset.mantenimiento = d.mantenimiento ? "1" : "0";
    var nombre = d.lado === "otro"
      ? '<input type="text" class="d-nombre" value="'+esc(d.nombre).replace(/"/g,"&quot;")+'" placeholder="Concepto">'
      : '<span class="d-nombre">'+esc(d.nombre)+'</span>';
    tr.innerHTML =
      '<td>'+nombre+'</td>' +
      '<td class="n"><input type="number" class="d-horas" step="0.01" min="0" value="'+(d.horas||0)+'"' +
        (horasBloqueadas && d.lado !== "otro" ? " readonly" : "") + ' style="text-align:right"></td>' +
      '<td class="n"><input type="checkbox" class="d-descuenta"'+(d.descuenta?" checked":"")+'></td>' +
      '<td class="n">'+(d.lado === "otro" ? '<button type="button" class="btn-mini" title="Eliminar">&times;</button>' : '')+'</td>';
    var quitar = tr.querySelector(".btn-mini");
    if(quitar) quitar.addEventListener("click", function(){ tr.remove(); refrescarTotal(); });
    tr.querySelector(".d-horas").addEventListener("input", refrescarTotal);
    tr.querySelector(".d-descuenta").addEventListener("change", refrescarTotal);
    return tr;
  }

  function pintarDeducciones(lista){
    var cuerpo = $("deducciones");
    cuerpo.innerHTML = "";
    GRUPOS.forEach(function(g){
      var delGrupo = lista.filter(function(d){ return (d.lado || "otro") === g.lado; });
      if(!delGrupo.length && g.lado !== "otro") return;
      var tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="4" class="label-caps" style="background:var(--op-surface-2);padding:6px 8px">'+g.titulo+'</td>';
      cuerpo.appendChild(tr);
      delGrupo.forEach(function(d){ cuerpo.appendChild(filaDeduccion(d)); });
    });
    refrescarTotal();
  }

  function leerDeducciones(){
    var lista = [];
    Array.prototype.forEach.call($("deducciones").querySelectorAll("tr"), function(tr){
      var campo = tr.querySelector(".d-nombre");
      if(!campo) return;                                   // fila de encabezado de grupo
      var nombre = campo.tagName === "INPUT" ? campo.value.trim() : campo.textContent;
      var h = parseFloat(tr.querySelector(".d-horas").value);
      lista.push({
        nombre: nombre || "(sin nombre)",
        lado: tr.dataset.lado || "otro",
        mantenimiento: tr.dataset.mantenimiento === "1",
        horas: isNaN(h) ? 0 : h,
        descuenta: tr.querySelector(".d-descuenta").checked
      });
    });
    return lista;
  }

  function refrescarTotal(){
    var t = leerDeducciones().reduce(function(a,d){ return a + (d.descuenta ? d.horas : 0); }, 0);
    $("total-deducido").textContent = hrs(t);
  }

  function porDefecto(){
    return IMP.CATEGORIAS.map(function(c){
      return {nombre:c.clave, lado:c.lado, horas:0, descuenta:c.descuenta, mantenimiento:c.mantenimiento};
    });
  }

  /* ────────────────────────── importación ──────────────────────── */

  function avisoImport(html, clase){
    $("aviso-import").innerHTML = html ? '<div class="aviso '+(clase||"info")+'">'+html+'</div>' : "";
  }
  function red2(v){ return Math.round(v*100)/100; }

  function aplicarImportado(r){
    var d = r.datos;

    /* Si el libro es de otro embarque, los hitos de la agencia del anterior no
       pueden quedarse: el NOR define desde cuándo corre el laytime, y heredarlo
       de otra nave cambia el demurrage sin que se note. */
    var codigoNuevo = (d.codigo || "").trim().toUpperCase();
    var codigoActual = $("codigo").value.trim().toUpperCase();
    if(codigoNuevo && codigoActual && codigoNuevo !== codigoActual){
      ["eta","arribo","nor","freePratique"].forEach(function(k){ $(k).value = ""; });
      avisoNor("");
      $("baseInicio").value = "amarre";
    }
    if(d.nave)   $("nave").value = d.nave;
    if(d.codigo) $("codigo").value = d.codigo;
    if(d.tonelaje != null) $("tonelaje").value = d.tonelaje;
    if(d.eslora != null)   $("eslora").value = d.eslora;
    if(d.tarifaMuelle != null) $("tarifaMuelle").value = d.tarifaMuelle;
    if(d.primeraEspia) $("primeraEspia").value = d.primeraEspia;
    if(d.ultimaEspia)  $("ultimaEspia").value  = d.ultimaEspia;
    if(d.inicioEmbarque) $("inicioCarga").value = d.inicioEmbarque;
    if(d.finEmbarque)    $("finCarga").value    = d.finEmbarque;
    if(d.horasMantenimientoMuellaje != null) $("horasMantenimientoMuellaje").value = red2(d.horasMantenimientoMuellaje);
    if(d.horasGira != null) $("horasGira").value = red2(d.horasGira);
    if(d.horasTotales != null)    $("horasTotales").value = red2(d.horasTotales);
    if(d.horasOpEfectiva != null) $("horasOpEfectiva").value = red2(d.horasOpEfectiva);
    [["calado","rteCalado"], ["calado","rteCaladoRte"],
     ["pesometro08","rtePesometro08"], ["pesometro09","rtePesometro09"],
     ["tasaEfectiva","rteTasaEfectiva"], ["tasaHora","rteTasaHora"], ["tasaDia","rteTasaDia"],
     ["horasReloj","rteHorasReloj"]
    ].forEach(function(par){ $(par[1]).value = d[par[0]] == null ? "" : d[par[0]]; });
    $("rteOrigenTonelaje").value = d.origenTonelaje || "";
    // El NOR ya no se rellena con la 1ª espía: inventarlo cambia el demurrage
    // en silencio. Si falta, el laytime arranca en el amarre y se avisa.
    if(!$("nor").value) $("baseInicio").value = "amarre";

    var propias = leerDeducciones().filter(function(x){ return x.lado === "otro"; });
    pintarDeducciones(d.deducciones.map(function(x){
      return {nombre:x.nombre, lado:x.lado, horas:red2(x.horas), descuenta:x.descuenta, mantenimiento:x.mantenimiento};
    }).concat(propias));

    var html = "<strong>" + esc(d.nave || "Recalada") + "</strong> importada correctamente.";
    if(r.avisos.length) html += "<ul><li>" + r.avisos.map(esc).join("</li><li>") + "</li></ul>";
    avisoImport(html, r.avisos.length ? "warn" : "ok");
    verVista("operacion");   // primero visible, luego dibujar: un panel oculto mide 0
    aplicarCaladoDeTurno();  // el draft survey está en la planilla, no en el CNN-EMB
    calcular();
    plegarRecaladaSegunEstado();
    autoguardar();
  }

  /**
   * Tres libros distintos entran por la misma puerta y se distinguen por sus
   * hojas, no por el nombre del archivo ni por qué botón se apretó: la
   * planilla de turno arrastrada al botón del CNN-EMB se leía como un
   * registro de tiempos y fallaba con un error que no decía nada, y soltada
   * en la zona de la reportería se leía como libro de temporada —sin la hoja
   * PUNTA TOTORALILLO— y dejaba la temporada cargada en cero.
   *
   * Devuelve true si reconoció el libro y ya lo aplicó.
   */
  function enrutar(libro, nombre){
    var hojas = ((libro && libro.SheetNames) || []).map(function(n){
      return String(n).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    });
    if(hojas.indexOf("ACUMULADO EMBARQUE") >= 0){ aplicarTurno(libro, nombre); return true; }
    if(hojas.indexOf("PUNTA TOTORALILLO") >= 0){ aplicarReporteria(REP.desdeLibro(libro), nombre); return true; }
    return false;
  }

  function leerArchivo(archivo){
    if(!archivo) return;
    if(typeof XLSX === "undefined"){
      avisoImport("No se cargó el lector de Excel (js/vendor/xlsx.full.min.js). Ingresa los datos a mano.", "error");
      enfocarRecalada();
      return;
    }
    var lector = new FileReader();
    lector.onload = function(ev){
      try{
        var libro = XLSX.read(new Uint8Array(ev.target.result), {type:"array", cellDates:true});
        if(enrutar(libro, archivo.name)) return;
        aplicarImportado(IMP.desdeLibro(libro));
      }catch(err){
        avisoImport("No se pudo leer el archivo: " + esc(err.message), "error");
        enfocarRecalada();
      }
    };
    lector.onerror = function(){ avisoImport("No se pudo abrir el archivo.", "error"); enfocarRecalada(); };
    lector.readAsArrayBuffer(archivo);
  }

  /* ───────────────────────────── cálculo ───────────────────────── */

  function avisos(lista, clase){
    $("avisos").innerHTML = lista.length
      ? '<div class="aviso '+(clase||"warn")+'"><ul><li>' + lista.map(esc).join("</li><li>") + "</li></ul></div>"
      : "";
  }

  function calcular(){
    var baseInicio = $("baseInicio").value;
    var inicio = L.inicioLaytime({
      base: baseInicio, nor: fh("nor"),
      primeraEspia: fh("primeraEspia"), turnTime: num("turnTime"),
      inicioOperaciones: fh("inicioCarga")
    });
    var termino = $("baseTermino").value === "ultimaEspia" ? fh("ultimaEspia") : fh("finCarga");

    var errores = [];
    if(!inicio){
      errores.push(baseInicio === "amarre"
        ? "Falta la fecha/hora de 1ª espía."
        : "Falta la fecha/hora del NOR presentado.");
    }
    if(!termino) errores.push($("baseTermino").value === "ultimaEspia" ? "Falta la última espía." : "Falta el término de carguío.");
    if(inicio && termino && termino <= inicio) errores.push("El término del laytime es anterior o igual a su inicio.");

    var permitido = L.laytimePermitido({
      modo: $("modoPermitido").value, horasFijas: num("horasFijas"),
      tonelaje: num("tonelaje"), tasaDia: num("tasaDia")
    });
    if(permitido <= 0){
      errores.push(($("modoPermitido").value === "tasa" && !num("tonelaje"))
        ? "Falta el tonelaje embarcado: sin él no hay laytime que calcular."
        : "El laytime resulta 0: revisa el tonelaje y la tasa de embarque.");
    }

    var deduc = leerDeducciones();
    renderCabecera();
    renderResumenRecalada();
    renderProductividad();
    renderComposicion(deduc);
    renderCausas(deduc);
    renderMuellaje();
    renderIndices(deduc);

    if(errores.length){
      avisos(errores, "error");
      renderVacioTimeSheet(errores);
      renderUtilizacion(null);
      ultimoTimeSheet = null;
      renderVeredicto(contexto(null));
      renderConciliacion(null);
      guardar();
      return;
    }
    /* Hitos que se contradicen. No impiden calcular —el laytime sale igual—
       pero quedan a la vista de quien lee la ficha, y salen de campos que el
       CNN-EMB no trae y que sobreviven a un cambio de nave si nadie los
       borra. Van como aviso, no como error: el número es válido. */
    avisos(L.hitosIncoherentes({
      eta: fh("eta"), arribo: fh("arribo"), nor: fh("nor"),
      primeraEspia: fh("primeraEspia"), inicioCarga: fh("inicioCarga"), finCarga: fh("finCarga")
    }), "warn");

    var r = L.calcularTimeSheet({
      inicio: inicio, termino: termino,
      modoConteo: $("modoConteo").value,
      festivos: L.leerFestivos($("festivos").value),
      deducciones: deduc, permitido: permitido,
      tarifaDemurrage: num("tarifaDemurrage"),
      aplicaDespatch: $("aplicaDespatch").checked,
      modoDespatch: $("modoDespatch").value,
      porcentajeDespatch: num("porcentajeDespatch"),
      tarifaDespatch: num("tarifaDespatch")
    });

    renderResultado(r);
    renderKpis(r);
    renderUtilizacion(r, inicio, termino);
    ultimoTimeSheet = r;
    var ctx = contexto(r);
    renderVeredicto(ctx);
    renderConciliacion(r);
    guardar();
    autoguardar();      // el embarque queda en el historial sin pedirlo
  }

  /* ─────────────────────────── render ──────────────────────────── */

  function renderCabecera(){
    var nave = $("nave").value || "—", codigo = $("codigo").value || "—";
    $("nb-nave").textContent = nave;
    $("nb-codigo").textContent = codigo;
    $("bc-recalada").textContent = nave === "—" ? "Recalada sin cargar" : nave + " · " + codigo;
    // El rótulo de la banda dice de qué recalada hablan las fichas de abajo:
    // en una vista única, sin pestaña que lo separe, hace falta decirlo.
    $("banda-rec-n").textContent = nave === "—" ? "sin recalada cargada" : nave + " · " + codigo;
    var cargada = nave !== "—";
    $("nb-estado").textContent = cargada ? "Recalada cargada" : "Sin recalada";
    $("nb-pulse").style.background = cargada ? OK : APAGADO;
  }

  /* Cuántos caracteres entran en la ficha depende del ancho de la pantalla:
     a 1.500 px son catorce, a 1.920 son diecisiete. Contar letras obliga a
     elegir un número que va a estar mal en una de las dos, así que se mide:
     si la cifra no cabe en su fila, se achica. Es lo único que funciona
     igual en el notebook del terminal y en el monitor de la sala. */
  function ajustarCifra(el){
    el.className = "";
    var hueco = el.parentNode.clientWidth;
    if(!hueco) return;   // pestaña oculta: no hay ancho que medir todavía
    if(el.getBoundingClientRect().width > hueco) el.className = "cifra-larga";
  }

  /** Pinta una de las dos fichas de resultado: con cifra, o apagada con «n/a». */
  function fichaResultado(id, clase, valor, detalle){
    $("kpi-" + id).className = "kpi " + clase;
    var cifra = $("k-" + id);
    cifra.textContent = valor;
    ajustarCifra(cifra);
    $("k-" + id + "-sub").textContent = detalle;
  }

  /* Demurrage y despatch nunca ocurren juntos, así que cada uno tiene su
     ficha y la que no corresponde dice «n/a» en vez de un cero: un cero se
     lee como «no se cobró nada» y lo que pasa es que esa liquidación no
     aplica. Las dos son del mismo porte que el resto de la tira. */
  function renderResultado(r){
    if(r.esDemurrage){
      fichaResultado("demurrage", "demurrage", usdExacto(r.montoDemurrage),
        diasDec(r.horasDemurrage) + " \u00d7 " + usd(num("tarifaDemurrage")) + "/día");
      fichaResultado("despatch", "na", "n/a", "la nave se pasó del laytime");
    }else if($("aplicaDespatch").checked && r.horasDespatch > 0){
      fichaResultado("demurrage", "na", "n/a", "terminó dentro del laytime");
      // El detalle dice con qué rate se pagó, sea propio o derivado del demurrage.
      fichaResultado("despatch", "despatch", usdExacto(r.montoDespatch),
        diasDec(r.horasDespatch) + " \u00d7 " + usd(r.tarifaDespatchAplicada) + "/día");
    }else{
      fichaResultado("demurrage", "na", "n/a", "terminó dentro del laytime");
      fichaResultado("despatch", "na", "n/a", "no está pactado en el charter party");
    }
  }

  function renderKpis(r){
    $("k-allowed").textContent = hrs(r.permitido);
    /* La división entera, no solo la tasa. El laytime cambia de nave en
       nave y la ficha decía «30.000 t/día» sin decir sobre qué tonelaje,
       así que la cifra parecía moverse sola: con el dividendo a la vista,
       «6d 18:02 · 202.550 t ÷ 30.000 t/día» se comprueba mirándola. */
    $("k-allowed-sub").textContent = L.horasADias(r.permitido) +
      ($("modoPermitido").value === "tasa"
        ? " · " + num("tonelaje").toLocaleString("es-CL") + " t ÷ " +
          num("tasaDia").toLocaleString("es-CL") + " t/día"
        : " · horas fijas");

    $("k-usado").textContent = hrs(r.horasUsadas);
    $("k-usado-sub").textContent = "utilización " + pct(r.utilizacion);

    renderEta();
    renderEspera();

    $("k-balance").textContent = (r.balance < 0 ? "" : "+") + hrs(r.balance);
    $("k-balance").style.color = r.balance < 0 ? CRITICO : OK;
    $("k-balance-sub").textContent = r.balance < 0 ? "sobre el laytime" : "dentro del laytime";
    $("kpi-balance").querySelector(".ico-marca").style.color = r.balance < 0 ? CRITICO : OK;
  }

  /**
   * Productividad: se muestra lo que trae el RTE, no un recálculo.
   * La planilla divide por el tiempo de eventos registrados (131,55 h en la
   * CNN-EMB-434) y no por el reloj del embarque (138,15 h); recalcularlo por
   * fuera daría un número distinto al que la operación ya reporta.
   */
  /**
   * Qué tonelaje alimenta el laytime. Es la misma precedencia que aplica el
   * lector del CNN-EMB —calado sobre pesómetro— pero acá corre cada vez que
   * alguien escribe el calado, porque el draft survey no viene en el libro:
   * llega en un correo de la agencia días después del embarque.
   *
   * Si no hay ninguno de los dos devuelve null y no se toca nada: puede que
   * el tonelaje venga de la suma por bodegas o escrito a mano, y pisarlo con
   * un cero dejaría el laytime en cero sin que nadie lo haya pedido.
   */
  function tonelajeDelRegistro(){
    var calado = num("rteCalado"), p09 = num("rtePesometro09");
    if(calado > 0) return {valor: calado, origen: "calado"};
    if(p09 > 0)    return {valor: p09,    origen: "pesómetro CT-09"};
    return null;
  }

  function aplicarCalado(){
    var t = tonelajeDelRegistro();
    if(!t) return;
    $("tonelaje").value = String(t.valor);
    $("rteOrigenTonelaje").value = t.origen;
  }

  /**
   * El calado de la recalada abierta según las planillas de turno, o null.
   *
   * Cruza por el mismo emparejador de la conciliación, con los hitos y no
   * solo con el nombre: tres naves de la temporada tienen dos recaladas, y
   * ponerle a una el calado de la otra cambia el laytime sin que se note.
   */
  function caladoDeTurnoActual(){
    var lista = temporada && temporada.datos ? temporada.datos.recaladas : null;
    var nave = $("nave").value;
    if(!nave || !lista || !lista.length) return null;
    var par = CONC.emparejar(nave, lista, {finCarga: fh("finCarga"),
      inicioCarga: fh("inicioCarga"), primeraEspia: fh("primeraEspia")});
    if(!par || par.ambigua || !par.fila) return null;
    var c = CONC.caladoDeTurno(par.fila, turnos);
    return c && c.tm ? c : null;
  }

  /** Escribe de dónde sale el calado y cómo queda contra el BL del libro. */
  function pintarPistaCalado(c){
    var el = $("rteCalado-turno");
    if(!el) return;
    if(!c || !c.tm){ el.hidden = true; el.textContent = ""; return; }
    var mil = function(n){ return Math.round(n).toLocaleString("es-CL"); };
    var txt = "Planilla de turno de " + c.meses.join(" + ") + ": " + mil(c.tm) + " TM" +
      (c.partida ? ", sumando los dos meses porque la carga quedó partida" : "") + ".";
    if(c.bl){
      txt += " El libro declara " + mil(c.bl) + " TM de BL (" +
        (Math.abs(c.dif) < 1 ? "coinciden"
          : (c.dif > 0 ? "+" : "-") + mil(Math.abs(c.dif)) + " TM · " +
            Math.abs(c.pct).toFixed(2).replace(".", ",") + " %") + ").";
    }
    var escrito = num("rteCalado"), delRte = num("rteCaladoRte");
    if(escrito > 0 && Math.abs(escrito - c.tm) >= 1){
      txt += " Lo escrito acá —" + mil(escrito) + " TM— manda sobre las dos.";
    }else if(delRte > 0 && Math.abs(delRte - c.tm) >= 1){
      txt += " Reemplaza las " + mil(delRte) + " TM del CNN-EMB, que son provisorias.";
    }
    el.textContent = txt;
    el.hidden = false;
  }

  /**
   * Llena el calado desde la planilla de turno si está vacío.
   *
   * El draft survey no viene en el CNN-EMB —llega días después en un correo
   * de la agencia— pero sí está en la planilla de turno del mes en que
   * terminó la carga. Dejar el campo vacío esperando el correo significa
   * calcular el laytime con el pesómetro, que mide otra cosa.
   *
   * Lo escrito a mano no se toca nunca: si alguien puso una cifra, la puso
   * por algo, y sobrescribirla con la de la planilla cambiaría el demurrage
   * en silencio.
   */
  function aplicarCaladoDeTurno(){
    var c = caladoDeTurnoActual();
    if(!c){ pintarPistaCalado(null); return false; }
    var hay = num("rteCalado"), delRte = num("rteCaladoRte");
    /* Lo que escribió una persona no se toca: puede venir del correo de la
       agencia, que es la última palabra. Lo que puso la importación sí se
       reemplaza —el calado del CNN-EMB es el provisorio de la planilla de la
       nave, y la de turno trae el definitivo: CHINA TRIUMPH llegó con 202.550
       TM y su draft survey final son 200.894, las mismas del BL. */
    var aMano = hay > 0 && !(delRte > 0 && Math.abs(hay - delRte) < 1);
    if(aMano){ pintarPistaCalado(c); return false; }
    if(Math.abs(hay - c.tm) < 1){ pintarPistaCalado(c); return false; }
    $("rteCalado").value = String(Math.round(c.tm));
    aplicarCalado();
    pintarPistaCalado(c);
    return true;
  }

  function renderProductividad(){
    var mil = function(n){ return Math.round(n).toLocaleString("es-CL"); };
    pintarPistaCalado(caladoDeTurnoActual());
    var ton    = num("tonelaje");
    var calado = num("rteCalado");
    var p09    = num("rtePesometro09");
    var p08    = num("rtePesometro08");
    var reloj = num("rteHorasReloj"), eventos = num("horasTotales");

    /* ── Tonelaje: tres cifras distintas, no una sola con notas al pie ──
       El pesómetro mide lo que pasó por la correa; el calado es lo que la
       nave declara haber recibido. Que difieran es normal; cuánto difieren
       es lo que hay que mirar, y por eso va escrito. */
    $("p-pesometro").textContent = p09 ? mil(p09) : "—";
    $("p-pesometro-sub").textContent = !p09 ? "no viene en el libro"
      : (p08 ? "CT-08 " + mil(p08) + " TM" : "CT-08 sin registro");

    $("p-calado").textContent = calado ? mil(calado) : "—";
    if(calado && p09){
      var dif = calado - p09, pctDif = dif / p09 * 100;
      $("p-calado-sub").textContent = (dif >= 0 ? "+" : "") + mil(dif) + " TM (" +
        (dif >= 0 ? "+" : "") + pct(pctDif) + ") contra el pesómetro";
      // Media unidad porcentual entre correa y draft survey ya es diferencia a explicar.
      $("p-calado-sub").style.color = Math.abs(pctDif) > 0.5 ? AVISO : "";
    }else{
      $("p-calado-sub").textContent = calado ? "sin pesómetro con que contrastar" : "no viene en el libro";
      $("p-calado-sub").style.color = "";
    }

    $("p-tonelaje").textContent = ton ? mil(ton) : "—";
    var origen = $("rteOrigenTonelaje").value;
    $("p-tonelaje-sub").textContent = !ton ? "carga el registro de tiempos"
      : (origen ? "según " + origen : "alimenta el laytime");

    /* ── Tasas: del RTE si vienen; si no, calculadas y dicho en pantalla ──
       Antes quedaban en blanco sin explicación y parecía un defecto. */
    var tasaEf = num("rteTasaEfectiva"), tasaH = num("rteTasaHora"), tasaD = num("rteTasaDia");
    var calculadas = false;
    if(!tasaH && !tasaD){
      var c = L.tasasCalculadas({tonelaje: ton, horasEmbarque: eventos});
      if(c.tasaHora){ tasaH = c.tasaHora; tasaD = c.tasaDia; calculadas = true; }
    }

    $("p-tasa-efectiva").textContent = tasaEf ? mil(tasaEf) : "—";
    $("p-tasa-efectiva-sub").textContent = tasaEf
      ? "op. efectiva + cambio de turno"
      : "solo la entrega el RTE";

    $("p-tasa-hora").textContent = tasaH ? mil(tasaH) : "—";
    $("p-tasa-hora-sub").textContent = !tasaH ? "&nbsp;"
      : (calculadas ? "calculada · " : "") + hDec(eventos) + " de embarque";

    $("p-tasa-dia").textContent = tasaD ? mil(tasaD) : "—";

    // Contra la tasa pactada en el charter party, que es la que define el allowed.
    var pactada = $("modoPermitido").value === "tasa" ? num("tasaDia") : 0;
    if(tasaD && pactada){
      var d = (tasaD - pactada) / pactada * 100;
      $("p-tasa-dia-sub").textContent = (d >= 0 ? "+" : "") + pct(d) +
        " sobre lo pactado (" + mil(pactada) + ")";
      $("p-tasa-dia").style.color = d >= 0 ? OK : CRITICO;
    }else{
      $("p-tasa-dia-sub").textContent = tasaD ? (calculadas ? "calculada" : "reportada por el RTE") : " ";
      $("p-tasa-dia").style.color = "";
    }

    $("p-aviso").innerHTML = (reloj && eventos && Math.abs(reloj - eventos) > 0.5)
      ? '<div class="aviso warn">' + esc("El reloj del embarque marca " + hDec(reloj) +
          " y los eventos del RTE suman " + hDec(eventos) + ": hay " + hDec(Math.abs(reloj - eventos)) +
          " sin evento que las explique. Las tasas se calculan sobre las " +
          hDec(eventos) + ".") + "</div>"
      : "";
    $("prod-nota").textContent = calculadas
      ? "el libro no trae el bloque de tasas: calculadas por la app"
      : (tasaD ? "tomada del registro de tiempos, no recalculada" : "sin datos de productividad");
  }

  /**
   * Todo lo que el veredicto y las láminas necesitan, en un solo objeto.
   * Se arma de los mismos campos que ya alimentan el dashboard.
   */
  function contexto(r){
    var deduc = leerDeducciones();
    var causas = deduc.filter(function(d){ return d.horas > 0.001; })
      .map(function(d){ return {nombre:d.nombre, valor:d.horas, lado:d.lado}; })
      .sort(function(a,b){ return b.valor - a.valor; });
    var mantenimiento = suma(deduc, function(d){ return d.mantenimiento; });
    var reserva = suma(deduc, function(d){ return d.lado === "nave"; });
    var m = L.calcularMuellaje({
      primeraEspia: fh("primeraEspia"), ultimaEspia: fh("ultimaEspia"),
      horasMantenimiento: num("horasMantenimientoMuellaje"), horasGira: num("horasGira"),
      eslora: num("eslora"), tarifa: num("tarifaMuelle")
    });
    var nor = fh("nor"), espia = fh("primeraEspia");
    var h = {eta: fh("eta"), arribo: fh("arribo"), nor: nor, primeraEspia: espia,
             inicioCarga: fh("inicioCarga"), finCarga: fh("finCarga"), ultimaEspia: fh("ultimaEspia")};

    var calc = flota.map(FL.calcular);
    var agr = FL.agregado(calc);

    return {
      nave: $("nave").value, codigo: $("codigo").value,
      ts: r || null,
      tarifaDia: num("tarifaDemurrage"),
      controlable: suma(deduc, function(d){ return d.lado === "puerto"; }),
      noControlable: suma(deduc, function(d){ return d.lado === "clima" || d.lado === "nave"; }),
      opEfectiva: num("horasOpEfectiva"),
      causas: causas.map(function(c){ return {nombre:c.nombre, valor:c.valor}; }),
      causaMayor: causas.length ? {nombre:causas[0].nombre, horas:causas[0].valor} : null,
      esperaDias: (nor && espia && espia > nor) ? L.diasEntre(nor, espia) : 0,
      tonelaje: num("tonelaje"), tasaDia: num("rteTasaDia"),
      tasaEfectiva: num("rteTasaEfectiva"),
      tasaPactada: $("modoPermitido").value === "tasa" ? num("tasaDia") : 0,
      muellaje: m.monto,
      indices: L.indices({horasTotales: num("horasTotales"), horasMantenimiento: mantenimiento,
                          horasReserva: reserva, horasOperacionEfectiva: num("horasOpEfectiva")}),
      hitos: h,
      hitosTexto: {
        arribo: h.arribo ? fechaLarga(h.arribo) : "—",
        nor: nor ? fechaLarga(nor) : "—",
        primeraEspia: espia ? fechaLarga(espia) : "—",
        finCarga: h.finCarga ? fechaLarga(h.finCarga) : "—"
      },
      segmentosEstadia: [
        {nombre:"ETA hasta el NOR", desde:h.eta, hasta:nor, color:SERIE.neutro},
        {nombre:"Espera desde el NOR", desde:nor, hasta:espia, color:SERIE.nocontrolable},
        {nombre:"Amarre a inicio de carguío", desde:espia, hasta:h.inicioCarga, color:SERIE.neutro},
        {nombre:"Carguío", desde:h.inicioCarga, hasta:h.finCarga, color:SERIE.efectiva},
        {nombre:"Remate y desatraque", desde:h.finCarga, hasta:h.ultimaEspia, color:SERIE.neutro}
      ].filter(function(sg){ return sg.desde && sg.hasta && sg.hasta > sg.desde; }),
      color: {efectiva:SERIE.efectiva, nocontrolable:SERIE.nocontrolable, controlable:SERIE.controlable,
              neutro:SERIE.neutro, critico:CRITICO, ok:OK, aviso:MAYOR},
      flota: {
        recaladas: agr.recaladas, conDemurrage: agr.conDemurrage, conDespatch: agr.conDespatch,
        tonelaje: agr.tonelaje, neto: agr.neto, muellaje: agr.muellaje, pctControlable: agr.pctControlable,
        porNave: calc.map(function(x){
          return {nombre: x.nave,
                  valor: x.ts ? (x.ts.esDemurrage ? x.ts.montoDemurrage : -x.ts.montoDespatch) : 0};
        })
      }
    };
  }

  /** Semáforo y lectura sobre el dashboard. */
  function renderVeredicto(ctx){
    var e = LEC.estado(ctx);
    $("veredicto-sem").className = "lam-semaforo sem-" + e.nivel;
    $("veredicto-titulo").textContent = e.titulo;
    $("panel-veredicto").className = "panel " +
      (e.nivel === "critico" ? "acento-rojo" : e.nivel === "atencion" ? "acento-hematita" : "acento-verde");
    var frases = LEC.parrafos(ctx);
    $("veredicto-lectura").innerHTML = frases.length
      ? frases.map(function(f){ return "<p style='margin-bottom:6px'>" + esc(f) + "</p>"; }).join("")
      : "<p class='text-3'>Carga un registro de tiempos para ver la lectura de la recalada.</p>";
  }

  /**
   * Conciliación con la reportería.
   *
   * Solo aparece si la recalada abierta también está en el libro. Las dos
   * cifras no tienen por qué coincidir —una es el registro de tiempos del
   * terminal, la otra lo que se acordó con el armador— pero la diferencia
   * tiene que quedar descompuesta, porque casi siempre nace de un dato que
   * el CNN-EMB no trae y que nadie llenó: el rate del contrato y el NOR.
   */
  function renderConciliacion(r){
    var panel = $("panel-conciliacion");
    var nave = $("nave").value;
    var lista = temporada && temporada.datos ? temporada.datos.recaladas : null;
    /* Los hitos van al emparejado porque el nombre no alcanza: tres naves de
       la temporada 2026 tienen dos recaladas, y quedarse con la primera del
       libro es tomar la equivocada la mitad de las veces. */
    var par = (r && nave && lista) ? CONC.emparejar(nave, lista, {
      finCarga: fh("finCarga"), inicioCarga: fh("inicioCarga"), primeraEspia: fh("primeraEspia")
    }) : null;
    if(!par){ panel.hidden = true; conciliacionActual = null; return; }

    /* Nombre repetido y fechas que no deciden: se muestra el panel para
       decirlo, pero sin cifras y sin botón. Conciliar contra la recalada
       equivocada es peor que no conciliar. */
    if(par.ambigua){
      panel.hidden = false;
      conciliacionActual = null;
      $("conc-nota").textContent = "sin conciliar";
      ["liquidado","propio"].forEach(function(id){
        $("conc-" + id).textContent = "—";
        $("conc-" + id).style.color = "var(--op-text-1)";
        $("conc-" + id + "-tag").innerHTML = "&nbsp;";
      });
      $("conc-dif").textContent = "—";
      $("conc-dif").style.color = "var(--op-text-1)";
      $("conc-lista").innerHTML = "<li>" + esc(par.motivo) +
        ". Elige la recalada en el selector de arriba o completa el fin de carguío.</li>";
      $("btn-conc-adoptar").hidden = true;
      return;
    }

    /* El signo del libro: demurrage positivo, despatch negativo. El time
       sheet propio se traduce a esa convención para poder restarlos. */
    var neto = r.esDemurrage ? r.montoDemurrage : -r.montoDespatch;
    var c = CONC.conciliar({
      tarifaDia: num("tarifaDemurrage"), tonelaje: num("tonelaje"), tasaDia: num("tasaDia"),
      baseInicio: $("baseInicio").value, nor: fh("nor"), primeraEspia: fh("primeraEspia"),
      permitido: r.permitido, horasUsadas: r.horasUsadas, neto: neto
    }, par.fila);
    if(!c){ panel.hidden = true; conciliacionActual = null; return; }

    conciliacionActual = par.fila;
    panel.hidden = false;
    $("conc-nota").textContent = (par.exacta
        ? par.fila.nave + " · " + par.fila.trimestre
        : "emparejada con «" + par.fila.nave + "» — los nombres no son idénticos") +
      (par.candidatas > 1 ? " · la nave tiene " + par.candidatas + " recaladas, se eligió por fecha" : "");
    var cifra = function(id, v){
      $("conc-" + id).textContent = usdExacto(Math.abs(v));
      $("conc-" + id).style.color = v > 0 ? CRITICO : v < 0 ? OK : "var(--op-text-1)";
      $("conc-" + id + "-tag").textContent =
        v > 0 ? "demurrage a pagar" : v < 0 ? "despatch a favor" : "sin cargo";
    };
    cifra("liquidado", c.liquidado);
    cifra("propio", c.propio);
    $("conc-dif").textContent = usdExacto(Math.abs(c.diferencia));
    $("conc-dif").style.color = Math.abs(c.diferencia) > 1 ? MAYOR : OK;

    var items = c.causas.map(function(x){
      return "<li>" + esc(x.texto) +
        (Math.abs(x.monto) > 1 ? ' <strong class="tabular">' + esc(usdCompacto(Math.abs(x.monto))) + "</strong>" : "") +
        "</li>";
    });
    /* Lo que no alcanzan a explicar las tres causas son, sobre todo, las
       deducciones: las 21 categorías del terminal contra el LESS NOT TO
       COUNT de la agencia son dos listas distintas y no se cuadran desde
       aquí. Decirlo es más honesto que dejar el resto sin nombre. */
    if(Math.abs(c.sinExplicar) > 1000){
      items.push('<li class="text-3">Quedan ' + esc(usdCompacto(Math.abs(c.sinExplicar))) +
        " sin explicar: las deducciones del terminal y el LESS NOT TO COUNT de la agencia son dos listas distintas.</li>");
    }
    if(!items.length) items.push('<li class="text-3">Las dos fuentes coinciden.</li>');
    $("conc-lista").innerHTML = items.join("");
    /* El botón nombra la recalada de la que toma los datos. Si el emparejado
       se equivocó, se ve antes de apretar y no después. */
    $("btn-conc-adoptar").hidden = !c.causas.length;
    $("btn-conc-adoptar").textContent = "Usar los datos del contrato" +
      (par.fila.trimestre ? " (" + par.fila.trimestre +
        (par.fila.finCarga ? " · carga al " + fechaFicha(par.fila.finCarga) : "") + ")" : "");
  }

  /* ETA nominado contra arribo real. El ETA solo no dice nada —es una fecha
     que se fijó semanas antes—; lo que se mira es si la nave llegó cuando
     dijo. Un adelanto también importa: llegar antes del laycan no obliga al
     terminal a recibirla, pero sí arranca la conversación del NOR. */
  function renderEta(){
    var eta = fh("eta"), arribo = fh("arribo") || fh("nor");
    if(!eta){
      $("k-eta").textContent = "—";
      $("k-eta").style.color = "var(--op-text-1)";
      $("k-eta-sub").textContent = "sin ETA nominado";
      return;
    }
    $("k-eta").textContent = fechaFicha(eta);
    ajustarCifra($("k-eta"));
    if(!arribo){
      $("k-eta-sub").textContent = "sin arribo registrado";
      $("k-eta").style.color = "var(--op-text-1)";
      return;
    }
    var dias = L.diasEntre(eta, arribo) || -L.diasEntre(arribo, eta);
    var desfase = Math.abs(dias);
    /* Bajo un día manda el reloj; sobre un día, los días: "arribó 54h 10m
       después" obliga a dividir por 24 para saber si es mucho. */
    var cuanto = desfase < 1
      ? hrs(desfase*24)
      : (Math.round(desfase*10)/10).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1}) + " d";
    $("k-eta-sub").textContent = desfase < 1/24
      ? "arribó en su ETA"
      : "arribó " + cuanto + (dias > 0 ? " después" : " antes");
    /* El desfase iba en el borde de la ficha; ahora va en la cifra, que es
       donde el color no compite con la línea de marca. */
    $("k-eta").style.color = desfase >= 2 ? MAYOR : OK;
    $("kpi-eta").querySelector(".ico-marca").style.color = desfase >= 2 ? MAYOR : OK;
  }

  /** Espera entre el NOR presentado y el amarre: los días que la nave estuvo a la gira. */
  function renderEspera(){
    var nor = fh("nor"), espia = fh("primeraEspia");
    if(!nor || !espia || espia <= nor){
      $("k-espera").textContent = "—";
      $("k-espera").style.color = "var(--op-text-1)";
      $("k-espera-sub").textContent = nor ? "el amarre no es posterior al NOR" : "sin NOR de la agencia";
      return;
    }
    var dias = L.diasEntre(nor, espia);
    $("k-espera").textContent = (Math.round(dias*10)/10).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1}) + " d";
    $("k-espera-sub").textContent = hrs(dias*24);
    var tono = dias >= 7 ? CRITICO : dias >= 3 ? MAYOR : OK;
    $("k-espera").style.color = tono;
    $("kpi-espera").querySelector(".ico-marca").style.color = tono;
  }

  /** Donut de composición del tiempo: efectiva → no controlable → controlable. */
  function renderComposicion(deduc){
    var total = num("horasTotales");
    var efectiva = num("horasOpEfectiva");
    var controlable = suma(deduc, function(d){ return d.lado === "puerto"; });
    var noControlable = suma(deduc, function(d){ return d.lado === "clima" || d.lado === "nave"; });
    var resto = total - efectiva - controlable - noControlable;

    var segmentos = [
      {nombre:"Operación efectiva", valor:efectiva,      color:SERIE.efectiva},
      {nombre:"Detención no controlable", valor:noControlable, color:SERIE.nocontrolable},
      {nombre:"Detención controlable",    valor:controlable,   color:SERIE.controlable}
    ];
    if(resto > 0.05) segmentos.push({nombre:"Resto sin clasificar", valor:resto, color:SERIE.neutro});

    var suma_ = segmentos.reduce(function(a,s){ return a + s.valor; }, 0);
    segmentos.forEach(function(s){ s.detalle = hDec(s.valor) + " · " + pct(suma_ ? s.valor/suma_*100 : 0); });

    G.donut($("g-donut"), segmentos, {
      tam: 158, grosor: 24,
      centro: suma_ ? hDec(suma_).replace(" h","") : "—",
      centroSub: "horas totales"
    });

    $("ley-donut").innerHTML = segmentos.map(function(s){
      return '<div class="ley-item" style="justify-content:space-between;width:100%">' +
        '<span style="display:flex;align-items:center;gap:7px">' +
        '<span class="ley-sw" style="background:'+s.color+'"></span>' + esc(s.nombre) + '</span>' +
        '<span class="tabular text-2">' + hDec(s.valor) + '</span></div>';
    }).join("");

    var detenciones = controlable + noControlable;
    $("donut-nota").textContent = detenciones > 0
      ? pct(controlable / detenciones * 100) + " de las detenciones es controlable"
      : "";
  }

  /** Barras ordenadas + tabla de ranking con acumulado. */
  function renderCausas(deduc){
    var items = deduc.filter(function(d){ return d.horas > 0.001; })
      .map(function(d){ return {nombre:d.nombre, valor:d.horas, lado:d.lado}; })
      .sort(function(a,b){ return b.valor - a.valor; });

    G.barras($("g-pareto"), items.slice(0, 12), {
      color: SERIE.controlable,
      banda: 24,
      fmtValor: function(v){ return (Math.round(v*100)/100).toLocaleString("es-CL"); },
      fmtTip: function(v){ return hDec(v); },
      fmtEje: function(v){ return Math.round(v*10)/10; }
    });

    var total = items.reduce(function(a,i){ return a + i.valor; }, 0);
    var acum = 0;
    $("tb-ranking").innerHTML = items.length ? items.map(function(it, i){
      acum += it.valor;
      return "<tr><td class='rank'>"+(i+1)+"</td><td>"+esc(it.nombre)+"</td>" +
             "<td class='text-2'>"+responsableDe(it.lado)+"</td>" +
             "<td class='n'>"+hDec(it.valor)+"</td>" +
             "<td class='n'>"+pct(total ? it.valor/total*100 : 0)+"</td>" +
             "<td class='n text-2'>"+pct(total ? acum/total*100 : 0)+"</td></tr>";
    }).join("") : "<tr><td colspan='6' class='text-3'>Sin detenciones registradas.</td></tr>";
  }

  /**
   * El time sheet, ahora como comparación en vez de como resta.
   *
   * Eran dos cascadas: una en horas y otra «la misma, en dinero» que era la
   * de horas multiplicada por el rate —misma forma, otra escala— y ninguna
   * de las dos mostraba el permitido salvo como una línea suelta al pie.
   * Dos barras sobre la misma escala dicen lo mismo y además dejan ver de un
   * vistazo lo único que importa: cuánto sobresale el tiempo contado por
   * sobre el permitido. El dinero se fue al tooltip y a la nota, que es
   * donde una conversión lineal aporta sin ocupar un panel.
   */
  function renderBalance(r, inicio, termino){
    var tarifa = num("tarifaDemurrage");
    G.balanceLaytime($("g-balance"), {
      transcurridas: r.horasTranscurridas,
      excluidas:     r.horasExcluidas,
      deducidas:     r.horasDeducidas,
      usadas:        r.horasUsadas,
      permitido:     r.permitido
    }, {
      grosor: 26,
      colores: {
        dentro:      SERIE.efectiva,
        sobre:       CRITICO,
        regimen:     SERIE.neutro,
        deducciones: SERIE.nocontrolable,
        permitido:   SERIE.efectiva,
        sinUsar:     TEXTO2
      },
      fmt: function(v){ return hDec(v); },
      porHora: tarifa / 24,
      fmtDinero: function(v){ return usd(v); }
    });

    $("balance-nota").textContent = (inicio && termino)
      ? fechaLarga(inicio) + "  →  " + fechaLarga(termino) + "  ·  " + $("modoConteo").value
      : "\u00a0";

    /* Solo las categorías que de verdad hay en el gráfico: con SHINC el
       régimen de conteo no descuenta nada y su cuadradito quedaba ahí
       prometiendo un tramo que no existe. */
    var leyenda = [
      [SERIE.efectiva,      "Laytime usado",           r.horasUsadas],
      [CRITICO,             "Sobre el permitido",      r.balance < 0 ? -r.balance : 0],
      [SERIE.neutro,        "No cuenta · régimen",     r.horasExcluidas],
      [SERIE.nocontrolable, "No cuenta · deducciones", r.horasDeducidas]
    ].filter(function(l){ return l[2] > 0; });
    $("ley-balance").innerHTML = leyenda.map(function(l){
      return '<div class="ley-item"><span class="ley-sw" style="background:' + l[0] + '"></span>' + l[1] + "</div>";
    }).join("") + (tarifa > 0
      ? '<div class="ley-item text-3">cada hora vale ' + usd(tarifa/24) + " al rate de " + usd(tarifa) + "/día</div>"
      : '<div class="ley-item text-3">falta el demurrage rate</div>');
  }

  /**
   * Anillo de utilización del laytime: usado sobre permitido.
   *
   * Es el número que decide la recalada —bajo 100 % hay despatch, sobre 100 %
   * hay demurrage— y hasta ahora vivía como subtítulo de la ficha de laytime
   * usado. Sobre 100 % el anillo se completa y el exceso se pinta encima, para
   * que el desborde se vea como desborde y no como una fracción cualquiera.
   */
  function renderUtilizacion(r, inicio, termino){
    var nodo = $("g-utilizacion");
    if(!r || !r.permitido){
      G.donut(nodo, [], {tam:146});
      $("utilizacion-nota").innerHTML = "&nbsp;";
      G.balanceLaytime($("g-balance"), null, {});
      $("ley-balance").innerHTML = "";
      $("balance-nota").innerHTML = "&nbsp;";
      return;
    }
    renderBalance(r, inicio, termino);
    var u = r.utilizacion;
    var excedido = u > 100;
    var segmentos = excedido
      ? [{nombre:"Dentro del laytime", valor:100, color:SERIE.efectiva},
         {nombre:"Sobre el laytime",   valor:u - 100, color:CRITICO}]
      : [{nombre:"Laytime usado",  valor:u,       color:SERIE.efectiva},
         {nombre:"Sin usar",       valor:100 - u, color:SERIE.neutro}];

    G.donut(nodo, segmentos, {
      tam:146, grosor:20,
      centro: pct(u),
      centroColor: excedido ? CRITICO : OK,
      centroSub: excedido ? "sobre el laytime" : "del laytime"
    });
    $("utilizacion-nota").textContent = excedido
      ? L.horasAHm(r.horasDemurrage) + " por sobre las " + L.horasAHm(r.permitido) + " permitidas"
      : L.horasAHm(r.horasDespatch || r.balance) + " sin usar de las " + L.horasAHm(r.permitido) + " permitidas";
  }

  function renderVacioTimeSheet(faltantes){
    ["k-allowed","k-usado","k-balance","k-espera"].forEach(function(id){ $(id).textContent = "—"; });
    ["k-allowed-sub","k-usado-sub","k-balance-sub","k-espera-sub"].forEach(function(id){ $(id).innerHTML = "&nbsp;"; });
    renderEta();   // el ETA no depende del time sheet: se pinta igual
    // Lo que falta se nombra en la ficha de demurrage, que es la que el
    // usuario mira primero; un guion solo lo deja sin pista de qué cargar.
    fichaResultado("demurrage", "na", "—", (faltantes && faltantes.length)
      ? faltantes[0] + (faltantes.length > 1 ? " (y " + (faltantes.length - 1) + " dato más)" : "")
      : "Carga el registro de tiempos en el bloque «Recalada».");
    fichaResultado("despatch", "na", "—", "\u00a0");
  }

  function renderMuellaje(){
    var m = L.calcularMuellaje({
      primeraEspia: fh("primeraEspia"), ultimaEspia: fh("ultimaEspia"),
      horasMantenimiento: num("horasMantenimientoMuellaje"), horasGira: num("horasGira"),
      eslora: num("eslora"), tarifa: num("tarifaMuelle")
    });
    var tiempo = m.horasMuellaje ? hDec(m.horasMuellaje) : "—";
    var monto  = m.horasMuellaje ? usdExacto(m.monto) : "—";
    // Las fichas y el desglose muestran lo mismo: unas resumen, el otro explica.
    $("m-tiempo").textContent = tiempo;   $("m-tiempo-d").textContent = tiempo;
    $("m-nwh").textContent    = hDec(m.nwh); $("m-nwh-d").textContent = hDec(m.nwh);
    $("m-monto").textContent  = monto;    $("m-monto-d").textContent = monto;
    $("m-descuentos").textContent = hDec(m.descuentos);
    $("m-base").textContent = num("eslora").toLocaleString("es-CL") + " m × " + num("tarifaMuelle") + " US$/m/h";

    /* Cada ficha dice de dónde sale su cifra: si no, "NWH 129,80 h" obliga a
       abrir el desglose para saber qué se descontó. */
    $("m-tiempo-sub").textContent = m.horasMuellaje ? L.horasADias(m.horasMuellaje) : "faltan las espías";
    $("m-nwh-sub").textContent = m.horasMuellaje
      ? "(−) " + hDec(m.descuentos) + " de mtto. y gira" : "\u00a0";
    $("m-monto-sub").textContent = m.horasMuellaje
      ? num("eslora").toLocaleString("es-CL") + " m × " + num("tarifaMuelle") + " US$/m/h"
      : "\u00a0";
    ajustarCifra($("m-monto"));
  }

  function renderIndices(deduc){
    var mantenimiento = suma(deduc, function(d){ return d.mantenimiento; });
    var reserva = suma(deduc, function(d){ return d.lado === "nave"; });
    var i = L.indices({
      horasTotales: num("horasTotales"), horasMantenimiento: mantenimiento,
      horasReserva: reserva, horasOperacionEfectiva: num("horasOpEfectiva")
    });
    var hay = num("horasTotales") > 0;

    /* El subtítulo es la fracción a secas: el rótulo de la ficha ya dice cuál
       de los tres índices es, y "disponibles 131,55 h de 133,30 h" se partía
       en dos líneas que dejaban esta ficha 40 px más alta que las del
       muellaje, al lado. */
    medidor("df", hay ? i.df : null, hay ? hDec(i.disponibles) + " de " + hDec(num("horasTotales")) : "");
    medidor("u",  hay ? i.u  : null, hay ? hDec(i.operativas) + " de " + hDec(i.disponibles) : "");
    medidor("fo", hay ? i.fo : null, hay ? hDec(num("horasOpEfectiva")) + " de " + hDec(i.operativas) : "");
  }

  /** La pista del medidor es un paso más claro del mismo color de la barra. */
  function medidor(clave, valor, sub){
    var v = valor === null ? 0 : valor;
    var color = v >= 90 ? OK : v >= 70 ? MAYOR : CRITICO;
    $("i-"+clave).textContent = valor === null ? "—" : pct(v);
    $("i-"+clave).style.color = valor === null ? "var(--op-text-1)" : color;
    $("i-"+clave+"-bar").style.width = Math.max(0, Math.min(100, v)) + "%";
    $("i-"+clave+"-bar").style.background = color;
    $("i-"+clave+"-sub").textContent = sub || " ";
  }

  function suma(lista, filtro){
    return lista.filter(filtro).reduce(function(a,d){ return a + d.horas; }, 0);
  }

  /* ──────────────── Notice of Readiness (PDF) ──────────────────── */

  function avisoNor(html, clase){
    $("aviso-nor").innerHTML = html ? '<div class="aviso '+(clase||"info")+'">'+html+'</div>' : "";
  }

  /**
   * Los hitos leídos se escriben en los campos pero NO se calcula solo: un
   * dígito mal leído aquí son decenas de miles de dólares, así que primero
   * se muestra qué se leyó para que la persona lo compare con el papel.
   */
  function aplicarNor(r, nombreArchivo){
    var puestos = [];
    [["arribo","arribo","Arribo al puerto"],
     ["norPresentado","nor","NOR presentado"],
     ["freePratique","freePratique","Free pratique"]].forEach(function(par){
      if(r[par[0]]){
        $(par[1]).value = r[par[0]];
        puestos.push("<strong>" + par[2] + ":</strong> " + r[par[0]].replace("T", " "));
      }
    });

    if(!puestos.length){
      avisoNor("No se pudo leer ningún hito de " + esc(nombreArchivo) + ".<ul><li>" +
        r.avisos.map(esc).join("</li><li>") + "</li></ul>", "error");
      return;
    }

    var html = "Leído de <strong>" + esc(nombreArchivo) + "</strong>" +
      (r.nave ? " · nave <strong>" + esc(r.nave) + "</strong>" : "") +
      (r.viaje ? " · viaje " + esc(r.viaje) : "") +
      "<br>" + puestos.join(" &nbsp;·&nbsp; ") +
      "<br><em>Compáralos con el documento antes de calcular.</em>";

    var reparos = r.avisos.slice();
    // La nave del NOR y la del registro de tiempos deberían ser la misma.
    if(r.nave && $("nave").value){
      var p = NOR.parecido(r.nave, $("nave").value);
      if(p < 0.75){
        reparos.push("El NOR es de " + r.nave + " y la recalada cargada es " + $("nave").value +
          ": revisa que sean el mismo embarque.");
      }else if(p < 1){
        reparos.push("El nombre difiere entre documentos: el NOR dice " + r.nave +
          " y el registro de tiempos dice " + $("nave").value + ". Parece un error de tipeo en la planilla.");
      }
    }
    if(reparos.length) html += "<ul><li>" + reparos.map(esc).join("</li><li>") + "</li></ul>";
    avisoNor(html, reparos.length ? "warn" : "ok");

    /* Con NOR a la vista, el inicio por defecto deja de ser el amarre: el
       charter party de CMP cuenta desde que expira el turn time o desde que
       parte la operación, lo primero que ocurra. */
    if($("baseInicio").value === "amarre" && r.norPresentado) $("baseInicio").value = "loPrimero";
  }

  function leerPdfNor(archivo){
    if(!archivo) return;
    avisoNor("Leyendo " + esc(archivo.name) + "…", "info");
    var lector = new FileReader();
    lector.onload = function(ev){
      NOR.desdeArchivo(ev.target.result)
        .then(function(r){ aplicarNor(r, archivo.name); })
        .catch(function(err){ avisoNor("No se pudo leer el PDF: " + esc(err.message), "error"); });
    };
    lector.onerror = function(){ avisoNor("No se pudo abrir el archivo.", "error"); };
    lector.readAsArrayBuffer(archivo);
  }

  /* ─────────────────────────── flota ───────────────────────────── */

  /** Toma los campos actuales del formulario tal como están. */
  function camposActuales(){
    var c = {};
    CAMPOS.forEach(function(id){ c[id] = $(id).value; });
    c.aplicaDespatch = $("aplicaDespatch").checked;
    return c;
  }

  /** Campos de una recalada importada, con el charter party que esté puesto. */
  function camposDesdeImportacion(d){
    var c = camposActuales();
    c.nave = d.nave || "";
    c.codigo = d.codigo || "";
    if(d.tonelaje != null) c.tonelaje = String(d.tonelaje);
    if(d.eslora != null) c.eslora = String(d.eslora);
    if(d.tarifaMuelle != null) c.tarifaMuelle = String(d.tarifaMuelle);
    c.primeraEspia = d.primeraEspia || "";
    c.ultimaEspia = d.ultimaEspia || "";
    c.inicioCarga = d.inicioEmbarque || "";
    c.finCarga = d.finEmbarque || "";
    c.horasMantenimientoMuellaje = String(red2(d.horasMantenimientoMuellaje || 0));
    c.horasGira = String(red2(d.horasGira || 0));
    c.horasTotales = String(red2(d.horasTotales || 0));
    c.horasOpEfectiva = String(red2(d.horasOpEfectiva || 0));
    // El NOR, el ETA y el free pratique no están en el RTE: vienen del
    // documento de la agencia. Se dejan como estén en el formulario.

    /* Los valores propios del RTE también son de esta recalada: si no se
       sobrescriben, la nave importada hereda las tasas de la que esté
       cargada en el formulario. */
    c.rteCalado       = d.calado == null ? "" : String(d.calado);
    c.rteCaladoRte    = d.calado == null ? "" : String(d.calado);
    c.rtePesometro08  = d.pesometro08 == null ? "" : String(d.pesometro08);
    c.rtePesometro09  = d.pesometro09 == null ? "" : String(d.pesometro09);
    c.rteTasaEfectiva = d.tasaEfectiva == null ? "" : String(d.tasaEfectiva);
    c.rteTasaHora     = d.tasaHora == null ? "" : String(d.tasaHora);
    c.rteTasaDia      = d.tasaDia == null ? "" : String(d.tasaDia);
    c.rteHorasReloj   = d.horasReloj == null ? "" : String(d.horasReloj);
    c.rteOrigenTonelaje = d.origenTonelaje || "";
    return c;
  }

  /* La pestaña Flota ya no existe; sus avisos salen donde ocurre la acción,
     que es el bloque de recalada del dashboard. */
  function avisoFlota(html, clase){ avisoImport(html, clase); }

  function agregarAFlota(campos, deducciones){
    var registro = {campos: campos, deducciones: deducciones, actualizadoEn: new Date().toISOString()};
    flota = FL.agregar(flota, registro);
    NUBE.guardar(registro, L).then(pintarEstadoNube);
    refrescarSelector();
    if(!FL.guardar(flota)){
      avisoFlota("No se pudo guardar la temporada en este navegador (almacenamiento bloqueado). " +
                 "Los datos se ven ahora pero se pierden al cerrar.", "warn");
    }
    renderFlota();
    /* La tira de temporada suma el calado de los CNN-EMB guardados: con uno
       nuevo, esa cifra cambió aunque el libro sea el mismo. */
    if(temporada) renderTemporada();
  }

  /* renderFlota se retiró junto con su pestaña: la temporada ahora se
     dibuja desde el libro de reportería, que trae las 33 recaladas en vez
     de las que se hayan cargado sueltas. El almacén de flota sigue vivo:
     alimenta el historial del dashboard y las láminas de presentación. */
  function renderFlota(){ /* sin vista que dibujar */ }


  /* Las funciones de dibujo de la vista Flota se retiraron con ella:
     renderGantt, renderTendencias, renderDivergentes y renderTablaFlota
     escribían en nodos que ya no existen. Lo que mostraban vive ahora en
     la vista de temporada, alimentado por el libro de reportería. */

  function umbrales(){
    var u = {};
    for(var k in CLIMA.UMBRALES) u[k] = CLIMA.UMBRALES[k];
    try{
      var g = JSON.parse(localStorage.getItem(CLAVE_UMBRALES) || "null");
      if(g) for(var j in g) if(typeof g[j] === "number") u[j] = g[j];
    }catch(e){}
    return u;
  }

  function leerUmbralesDelFormulario(){
    var u = {
      vientoAviso: num("u-viento-aviso"), vientoAlerta: num("u-viento-alerta"),
      rafagaAlerta: num("u-rafaga"), olaAviso: num("u-ola-aviso"),
      olaAlerta: num("u-ola-alerta"), visibilidadAviso: num("u-vis"),
      visibilidadAlerta: Math.round(num("u-vis") / 2)
    };
    try{ localStorage.setItem(CLAVE_UMBRALES, JSON.stringify(u)); }catch(e){}
    return u;
  }

  function pintarUmbrales(){
    var u = umbrales();
    $("u-viento-aviso").value = u.vientoAviso;
    $("u-viento-alerta").value = u.vientoAlerta;
    $("u-rafaga").value = u.rafagaAlerta;
    $("u-ola-aviso").value = u.olaAviso;
    $("u-ola-alerta").value = u.olaAlerta;
    $("u-vis").value = u.visibilidadAviso;
    $("c-viento-sub").textContent = "umbral de operación: " + u.vientoAviso + " kn";
  }

  function avisoClima(html, clase){
    $("clima-aviso").innerHTML = html ? '<div class="aviso '+(clase||"info")+'">'+html+'</div>' : "";
  }

  function horaCorta(d){
    return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
  }
  function diaHora(d){
    var hoy = new Date();
    var mismoDia = d.toDateString() === hoy.toDateString();
    var manana = new Date(hoy.getTime() + 86400000).toDateString() === d.toDateString();
    var prefijo = mismoDia ? "hoy" : manana ? "mañana" :
      d.toLocaleDateString("es-CL", {weekday:"short", day:"2-digit", month:"short"});
    return prefijo + " " + horaCorta(d);
  }

  function consultarClima(){
    avisoClima("Consultando Open-Meteo…", "info");
    $("clima-consulta").textContent = "consultando…";
    CLIMA.consultar(CLIMA.PUERTO, 3).then(function(r){
      serieClima = r.serie;
      avisoClima(r.conMar ? "" :
        "El servicio marino no devolvió datos para este punto: las alertas van solo con viento y visibilidad.",
        "warn");
      // Modelo, no estación: decirlo en pantalla evita que alguien cite estas
      // cifras en un time sheet como si fueran la medición del terminal.
      $("clima-consulta").textContent = "modelo Open-Meteo · " + r.consultadoEn.toLocaleString("es-CL",
        {day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit"});
      renderClima();
    }).catch(function(err){
      avisoClima("No se pudo consultar el pronóstico: " + esc(err.message) +
        " Si el terminal bloquea salidas a internet, esta vista no va a funcionar desde la red interna.", "error");
      $("clima-consulta").textContent = "sin conexión";
    });
  }

  /* ═════════════ PLANILLAS DE TURNO: EL CALADO DEFINITIVO ═════════════
     La tercera fuente de la app, y la única que trae el draft survey final.
     El CNN-EMB da el pesómetro, el libro da el Bill of Lading, y el calado
     llega acá, en la planilla que el turno llena día a día. Se guarda un
     mes por entrada, con la clave «YYYY-MM». */

  var CLAVE_TURNOS = "demurrage-ppt.turnos.v1";
  var turnos = {};                 // "2026-09" -> {totalMineral, porNave, …}

  function turnosCargar(){
    try{
      var crudo = localStorage.getItem(CLAVE_TURNOS);
      var m = crudo ? JSON.parse(crudo) : {};
      return (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
    }catch(e){ return {}; }
  }
  function turnosGuardar(){
    try{ localStorage.setItem(CLAVE_TURNOS, JSON.stringify(turnos)); }catch(e){}
  }

  function avisoTurno(html, clase){ avisoRep(html, clase); }

  var turnosCompartidos = true;            // ¿la tabla de la nube existe?

  /**
   * Trae los meses compartidos y sube los propios.
   *
   * Se une por mes, no reemplazando el almacén: tres personas cargan
   * planillas de meses distintos y quien guardara último borraría el mes
   * que otro acabó de cargar. Eso se notaría tarde y mal —la ficha de un
   * mes apareciendo vacía— así que la fusión es por mes y por marca.
   */
  function turnosSincronizar(){
    if(!NUBE.lista()) return Promise.resolve(false);
    return NUBE.listarTurnos().then(function(remotos){
      var pendientes = TUR.mesesPendientes(turnos, remotos);
      var antes = Object.keys(turnos).length;
      turnos = TUR.fusionarMeses(turnos, remotos);
      turnosGuardar();
      /* Si llegó un mes nuevo, la ficha de TM embarcadas tiene que
         enterarse sin que nadie recargue la página. */
      if(Object.keys(turnos).length !== antes){
        pintarOrigenLibros();
        if(temporada) renderTemporada();
      }
      if(!pendientes.length) return true;
      return NUBE.subirTurnos(turnos, pendientes).then(function(ok){
        /* Que la tabla no exista todavía es lo normal hasta que alguien
           corra el SQL, y no es una caída de la red: los embarques y la
           temporada viajan igual. Se dice donde está el dato que no se
           comparte, no en el chip de la cabecera. */
        turnosCompartidos = ok;
        return ok;
      });
    }).catch(function(){ return false; });
  }

  /**
   * Guarda el mes que trae una planilla de turno. Reemplaza el mes entero:
   * la planilla del último día ya trae el acumulado, así que fusionar por
   * nave sumaría dos veces lo mismo.
   */
  function aplicarTurno(libro, nombreArchivo){
    var r = TUR.desdeLibro(libro, nombreArchivo);
    if(!r.periodo){
      avisoTurno("No se pudo leer el mes desde «" + esc(nombreArchivo) + "». " +
        "El nombre tiene que traer la fecha, como DATOS_TURNO_PPT_30-09-2026.xlsx.", "error");
      return;
    }
    if(!r.totalMineral){
      avisoTurno("«" + esc(nombreArchivo) + "» no trae tonelaje de pellet feed ni de sinter feed." +
        (r.avisos.length ? "<ul><li>" + r.avisos.map(esc).join("</li><li>") + "</li></ul>" : ""), "warn");
      return;
    }

    var clave = r.periodo.anio + "-" + String(r.periodo.mes + 1).padStart(2, "0");
    turnos[clave] = {
      totalMineral: r.totalMineral,
      totalOtros: r.totalOtros,
      porNave: r.porNave,
      archivo: nombreArchivo,
      actualizadoEn: new Date().toISOString()
    };
    turnosGuardar();
    pintarOrigenLibros();
    if(temporada) renderTemporada();
    /* Si la recalada abierta es de este mes y no tenía calado, ya lo tiene. */
    if(aplicarCaladoDeTurno()) calcular();

    var mil = function(n){ return Math.round(n).toLocaleString("es-CL"); };
    var html = "<strong>" + MES[r.periodo.mes] + " " + r.periodo.anio + "</strong>: " +
      mil(r.totalMineral) + " t embarcadas en " + r.porNave.length +
      (r.porNave.length === 1 ? " nave" : " naves") + "." +
      (r.totalOtros ? " (" + mil(r.totalOtros) + " t de concentrado y MLC quedan fuera: " +
        "no están en el libro de demurrage.)" : "");
    if(r.avisos.length){
      html += "<ul><li>" + r.avisos.map(esc).join("</li><li>") + "</li></ul>";
    }
    var clase = r.avisos.length ? "warn" : "ok";

    /* Y se comparte, que es lo que evita que las otras dos personas tengan
       que arrastrar las mismas nueve planillas en su navegador. El mensaje
       sale ya, sin esperar a la red: la planilla está leída y guardada
       pase lo que pase con Supabase. */
    if(!NUBE.lista()){
      avisoTurno(html + " Queda en este equipo: la app no está conectada a Supabase.", clase);
      return;
    }
    avisoTurno(html + " Compartiendo…", clase);
    turnos[clave].cargadoPor = SESION.usuario();
    NUBE.subirTurnos(turnos, [clave]).then(function(ok){
      turnosCompartidos = ok;
      avisoTurno(html + (ok
        ? " Compartida con el equipo."
        : " Queda en este equipo: falta crear la tabla <code>demurrage_turnos</code> " +
          "en Supabase (está en supabase/esquema.sql)."), ok ? clase : "warn");
    });
  }

  /* ══════════════════ BITÁCORA DEL PUERTO ══════════════════
     Lo que pasó, no lo que el modelo dice que va a pasar. Se escribe el
     mismo día y se cita meses después al liquidar una recalada, así que el
     formulario tiene que poder llenarse en quince segundos: día, estado,
     causa. El resto es opcional. */

  var CLAVE_BITACORA = "demurrage-ppt.bitacora.v1";
  var bitacora = [];
  var bitMes = new Date();                 // mes que se está mirando
  var bitEditando = null;                  // id del evento abierto, o null
  var bitArrastre = null;                  // {desde, hasta} mientras se arrastra
  var bitCompartida = true;                // ¿la tabla de la nube existe?

  function bitCargar(){
    try{
      var crudo = localStorage.getItem(CLAVE_BITACORA);
      var lista = crudo ? JSON.parse(crudo) : [];
      return Array.isArray(lista) ? BIT.ordenar(lista) : [];
    }catch(e){ return []; }
  }
  function bitGuardarLocal(){
    try{ localStorage.setItem(CLAVE_BITACORA, JSON.stringify(bitacora)); }catch(e){}
  }

  /* Trae lo de la nube y sube lo propio. Se une por id: son tres personas
     anotando eventos distintos y reemplazar la lista entera borraría el del
     otro sin que nadie se entere. */
  function bitSincronizar(){
    if(!NUBE.lista()) return Promise.resolve(false);
    return NUBE.listarEventos().then(function(remotos){
      var pendientes = BIT.pendientesDeSubir(bitacora, remotos);
      bitacora = BIT.fusionar(bitacora, remotos);
      bitGuardarLocal();
      renderBitacora();
      if(!pendientes.length) return true;
      return NUBE.subirEventos(pendientes).then(function(ok){
        /* Que la tabla no exista todavía es lo normal hasta que alguien
           corra el SQL, y no es motivo para decir que la app está sin
           conexión: los embarques y la temporada viajan igual. Se dice acá,
           donde está el dato que no se comparte. */
        bitCompartida = ok;
        if(!ok) bitAviso("Los eventos quedan en este equipo: falta crear la tabla " +
          "<code>demurrage_bitacora</code> en Supabase (está en supabase/esquema.sql).", "warn");
        return ok;
      });
    }).catch(function(){ return false; });
  }

  var MESES_LARGOS = ["enero","febrero","marzo","abril","mayo","junio","julio",
                      "agosto","septiembre","octubre","noviembre","diciembre"];
  var DOW = ["lun","mar","mié","jue","vie","sáb","dom"];

  function bitAviso(html, clase){
    $("bit-aviso").innerHTML = html ? '<div class="aviso ' + (clase || "info") + '">' + html + "</div>" : "";
  }

  function renderCalendario(){
    var anio = bitMes.getFullYear(), mes = bitMes.getMonth();
    $("bit-mes-rot").textContent = MESES_LARGOS[mes] + " " + anio;

    var mapa = BIT.porDia(bitacora);
    var hoy = BIT.hoyIso();
    var cont = $("bit-calendario");
    cont.innerHTML = "";
    var rejilla = document.createElement("div");
    rejilla.className = "cal";
    DOW.forEach(function(d){
      var h = document.createElement("div");
      h.className = "cal-dow"; h.textContent = d;
      rejilla.appendChild(h);
    });

    BIT.rejillaMes(anio, mes).forEach(function(semana){
      semana.forEach(function(dia){
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cal-dia" + (dia.fuera ? " fuera" : "") + (dia.iso === hoy ? " hoy" : "");
        b.dataset.iso = dia.iso;
        var ev = mapa[dia.iso];
        if(ev) b.classList.add(ev.estado);
        if(bitArrastre && dia.iso >= bitArrastre.desde && dia.iso <= bitArrastre.hasta) b.classList.add("sel");

        var n = document.createElement("span");
        n.className = "cal-n"; n.textContent = dia.dia;
        b.appendChild(n);
        if(ev){
          var c = document.createElement("span");
          c.className = "cal-causa"; c.textContent = ev.causa || BIT.ESTADOS[ev.estado].rotulo;
          b.appendChild(c);
          /* El título nativo alcanza: es una etiqueta de apoyo, no la
             información principal, y un tooltip propio acá sería una pieza
             más que mantener por nada. */
          var otros = BIT.delDia(bitacora, dia.iso);
          b.title = otros.map(function(x){
            return BIT.ESTADOS[x.estado].rotulo + ": " + (x.causa || "sin causa") +
                   (x.nota ? " — " + x.nota : "");
          }).join("\n");
        }
        rejilla.appendChild(b);
      });
    });
    cont.appendChild(rejilla);

    var ultimo = BIT.aIso(new Date(anio, mes + 1, 0));
    var r = BIT.resumen(bitacora, BIT.aIso(new Date(anio, mes, 1)), ultimo);
    $("bit-nota").textContent = r.cerrado || r.restringido
      ? r.cerrado + " d cerrado · " + r.restringido + " d con restricción en el mes"
      : "sin eventos este mes";
    $("bit-leyenda").innerHTML =
      '<span><i style="background:var(--alarm-critical)"></i>Cerrado</span>' +
      '<span><i style="background:var(--alarm-major)"></i>Con restricción</span>' +
      '<span><i style="background:var(--status-running)"></i>Abierto</span>';
  }

  function renderListaBitacora(){
    var tb = $("tb-bitacora");
    if(!bitacora.length){
      tb.innerHTML = '<tr><td colspan="6" class="text-3">Sin eventos registrados.</td></tr>';
      return;
    }
    tb.innerHTML = bitacora.map(function(ev){
      var dias = BIT.largoEnDias(ev.desde, ev.hasta);
      var rango = ev.desde === ev.hasta ? ev.desde : ev.desde + " → " + ev.hasta;
      return '<tr data-id="' + esc(ev.id) + '">' +
        "<td>" + esc(rango) + ' <span class="text-3">(' + dias + " d)</span></td>" +
        '<td style="color:' + (ev.estado === "cerrado" ? CRITICO : ev.estado === "restringido" ? MAYOR : OK) + '">' +
          esc(BIT.ESTADOS[ev.estado].rotulo) + "</td>" +
        "<td>" + esc(ev.causa || "—") + "</td>" +
        '<td class="text-2">' + esc(ev.nota || "") + "</td>" +
        '<td class="text-3">' + esc(ev.registradoPor || "") + "</td>" +
        '<td><button class="btn btn-mini-nav bit-abrir" type="button">Abrir</button></td>' +
      "</tr>";
    }).join("");
  }

  function renderBitacora(){ renderCalendario(); renderListaBitacora(); }

  /** Deja el formulario apuntando a un rango nuevo, sin evento detrás. */
  function bitNuevo(desde, hasta){
    bitEditando = null;
    $("bit-form-t").textContent = "Registrar un evento";
    $("bit-desde").value = desde || BIT.hoyIso();
    $("bit-hasta").value = hasta || desde || BIT.hoyIso();
    $("bit-estado").value = "cerrado";
    $("bit-causa").value = "";
    $("bit-nota-txt").value = "";
    $("bit-borrar").hidden = true;
    bitAviso("");
  }

  function bitAbrir(ev){
    bitEditando = ev.id;
    $("bit-form-t").textContent = "Editar el evento";
    $("bit-desde").value = ev.desde;
    $("bit-hasta").value = ev.hasta;
    $("bit-estado").value = ev.estado;
    $("bit-causa").value = ev.causa;
    $("bit-nota-txt").value = ev.nota;
    $("bit-borrar").hidden = false;
    bitAviso("");
  }

  /* Un clic en un día abre el evento que ya tenga; si no tiene, empieza uno
     nuevo ahí. Es lo que se espera de un calendario y ahorra el paso de
     buscar el evento en la tabla de abajo. */
  function bitClicDia(iso){
    var ya = BIT.delDia(bitacora, iso);
    if(ya.length) bitAbrir(ya[0]);
    else bitNuevo(iso, iso);
  }

  function bitGuardar(){
    var ev = {
      id: bitEditando || undefined,
      desde: $("bit-desde").value,
      hasta: $("bit-hasta").value || $("bit-desde").value,
      estado: $("bit-estado").value,
      causa: $("bit-causa").value,
      nota: $("bit-nota-txt").value,
      registradoPor: SESION.usuario() || ""
    };
    var norm = BIT.normalizar(ev);
    var reparos = BIT.validar(norm || ev);
    if(reparos.length){
      bitAviso("<ul><li>" + reparos.map(esc).join("</li><li>") + "</li></ul>", "warn");
      return;
    }
    bitacora = BIT.agregar(bitacora, norm);
    bitGuardarLocal();
    /* El mes que se mira salta al del evento: guardar algo y no verlo
       aparecer hace dudar de si se guardó. */
    var d = BIT.deIso(norm.desde);
    if(d) bitMes = new Date(d.getFullYear(), d.getMonth(), 1);
    renderBitacora();
    bitAviso("Guardado: " + esc(BIT.ESTADOS[norm.estado].rotulo.toLowerCase()) + " " +
      (norm.desde === norm.hasta ? "el " + norm.desde : "del " + norm.desde + " al " + norm.hasta) + ".", "ok");
    bitEditando = norm.id;
    $("bit-form-t").textContent = "Editar el evento";
    $("bit-borrar").hidden = false;
    if(NUBE.lista()) NUBE.subirEventos([norm]).then(pintarEstadoNube);
  }

  function bitBorrar(){
    if(!bitEditando) return;
    var ev = bitacora.filter(function(x){ return x.id === bitEditando; })[0];
    if(!ev) return;
    if(!confirm("¿Eliminar el evento del " + ev.desde +
                (ev.desde === ev.hasta ? "" : " al " + ev.hasta) + "?")) return;
    bitacora = BIT.eliminar(bitacora, bitEditando);
    bitGuardarLocal();
    if(NUBE.lista()) NUBE.borrarEvento(bitEditando).then(pintarEstadoNube);
    bitNuevo();
    renderBitacora();
  }

  function renderClima(){
    var u = umbrales();
    if(!serieClima.length) return;

    var ahora = new Date();
    var actual = serieClima.filter(function(p){ return p.hora <= ahora; }).pop() || serieClima[0];
    var e = CLIMA.evaluar(actual, u);
    var op = CLIMA.ventanaOperativa(serieClima, u, ahora);

    // Estado del puerto: abierto, con restricción o cerrado.
    var est = CLIMA.estadoPuerto(e.nivel);
    var hero = $("clima-hero");
    hero.className = "hero " + est.clave;
    $("clima-hero-rot").textContent = est.rotulo;
    $("clima-hero-val").textContent = est.titulo;
    $("clima-hero-val").style.color = TONO_CLIMA[e.nivel] || OK;
    $("clima-hero-sub").textContent = e.nivel === "ok"
      ? (op.horas ? "Ventana operativa de " + op.horas + " h, hasta " + diaHora(op.hasta) + "." : "Sin restricciones en las próximas horas.")
      : e.motivos.join(" · ") + ".";

    // Cifras actuales
    $("c-viento").textContent = actual.viento != null ? (Math.round(actual.viento*10)/10).toLocaleString("es-CL") : "—";
    $("c-viento").style.color = actual.viento >= u.vientoAlerta ? CRITICO : actual.viento >= u.vientoAviso ? MAYOR : OK;
    $("c-viento-sub").textContent = "umbral " + u.vientoAviso + " kn · rumbo " + CLIMA.rumbo(actual.direccion);
    $("c-rafaga").textContent = actual.rafaga != null ? Math.round(actual.rafaga) : "—";
    $("c-rafaga-sub").textContent = "severo sobre " + u.rafagaAlerta + " kn";
    $("c-ola").textContent = actual.ola != null ? actual.ola.toFixed(1) : "—";
    $("c-ola-sub").textContent = actual.ola != null ? "severo sobre " + u.olaAlerta + " m" : "sin dato marino";
    $("c-vis").textContent = actual.visibilidad != null ? (actual.visibilidad/1000).toFixed(1) : "—";
    $("c-vis-sub").textContent = "atención bajo " + (u.visibilidadAviso/1000).toFixed(1) + " km";

    /* Sin datos marinos, la ficha de marejada muestra "—", que a la distancia
       se lee como "mar calmo". Un dato ausente y una condición favorable no
       son lo mismo, menos cuando el criterio de detención depende de ellos. */
    var sinMarina = serieClima.every(function(p){ return p.ola == null; });
    $("kpi-marejada").style.opacity = sinMarina ? ".55" : "";
    if(sinMarina){
      avisoClima("El modelo marino no devolvió altura de ola para este punto: la marejada " +
        "queda sin evaluar y el estado del muelle sale solo de viento, ráfagas y visibilidad. " +
        "No lo leas como mar calmo.", "warn");
    }

    // Alertas
    var v = CLIMA.ventanas(serieClima, u).filter(function(w){ return w.hasta > ahora; });
    $("clima-alertas-nota").textContent = v.length
      ? v.length + (v.length === 1 ? " ventana" : " ventanas") + " en las próximas 72 h"
      : "sin condiciones adversas previstas";
    $("clima-alertas").innerHTML = v.length ? v.map(function(w){
      var clase = w.nivel === "alerta" ? "error" : "warn";
      var estadoW = CLIMA.estadoPuerto(w.nivel);
      var detalle = [];
      if(w.vientoMax != null) detalle.push("viento hasta " + Math.round(w.vientoMax) + " kn");
      if(w.rafagaMax != null) detalle.push("ráfagas " + Math.round(w.rafagaMax) + " kn");
      if(w.olaMax != null) detalle.push("marejada " + w.olaMax.toFixed(1) + " m");
      return '<div class="aviso ' + clase + '" style="margin-bottom:8px">' +
        "<strong>" + esc(diaHora(w.desde)) + " → " + esc(diaHora(w.hasta)) + "</strong> · " +
        w.horas + " h · <strong>" + esc(estadoW.titulo) + "</strong> · " + esc(detalle.join(" · ")) +
        "<br><span class='text-2'>Causa: " + esc(w.causas.join(", ")) + "</span></div>";
    }).join("") : '<p class="text-2">El puerto queda abierto las próximas 72 horas: nada llega a los umbrales.</p>';

    // Curva de viento contra el umbral
    var proximas = serieClima.filter(function(p){ return p.hora >= ahora; }).slice(0, 48);
    G.lineas($("g-viento"), proximas.map(function(p){
      return {etiqueta: diaHora(p.hora), corta: horaCorta(p.hora), valor: p.viento || 0};
    }), {
      color: SERIE.nocontrolable, alto: 210, referencia: u.vientoAviso,
      fmtEje: function(x){ return Math.round(x); },
      fmtValor: function(x){ return Math.round(x) + " kn"; },
      fmtTip: function(x){ return Math.round(x*10)/10 + " kn"; }
    });
    $("clima-curva-nota").textContent = "línea gris: umbral de " + u.vientoAviso + " kn · próximas " + proximas.length + " h";

    // Tabla
    $("tb-clima").innerHTML = proximas.map(function(p){
      var ev = CLIMA.evaluar(p, u);
      var color = TONO_CLIMA[ev.nivel] || OK;
      var texto = CLIMA.estadoPuerto(ev.nivel).corto;
      return "<tr><td class='text-2'>" + esc(diaHora(p.hora)) + "</td>" +
        "<td class='n'>" + (p.viento != null ? Math.round(p.viento*10)/10 : "—") + "</td>" +
        "<td class='n'>" + (p.rafaga != null ? Math.round(p.rafaga) : "—") + "</td>" +
        "<td class='text-2'>" + CLIMA.rumbo(p.direccion) + "</td>" +
        "<td class='n'>" + (p.ola != null ? p.ola.toFixed(1) : "—") + "</td>" +
        "<td class='n'>" + (p.visibilidad != null ? (p.visibilidad/1000).toFixed(1) + " km" : "—") + "</td>" +
        "<td style='color:" + color + "'>" + texto + "</td></tr>";
    }).join("");
  }

  /* ───────────────────────── nube ──────────────────────────────── */

  /* Un tono por estado del puerto, para que la cifra grande, la tabla y las
     ventanas no se pinten cada una por su cuenta. */
  var TONO_CLIMA = {ok:OK, aviso:MAYOR, alerta:CRITICO};
  var COLOR_NUBE = {off:APAGADO, sincronizando:MAYOR, ok:OK, error:CRITICO};
  var TEXTO_NUBE = {off:"Solo este equipo", sincronizando:"Sincronizando…", ok:"En línea", error:"Sin conexión"};

  function pintarEstadoNube(){
    var e = NUBE.estado();
    /* Con proyecto configurado pero sin sesión, el chip no puede decir
       «Solo este equipo» como si no hubiera nube: la hay, y los cambios no
       están llegando. Eso es lo que hay que ver de un vistazo. */
    var sinSesion = NUBE.activa() && !SESION.activa();
    $("nube-punto").style.background = sinSesion ? MAYOR : (COLOR_NUBE[e] || COLOR_NUBE.off);
    /* Con error, el motivo va escrito en el chip y no solo en el `title`:
       «Sin conexión» a secas manda a adivinar, y adivinar con tres personas
       en dos redes distintas cuesta una tarde. Recortado, que es un chip de
       cabecera y no un registro. */
    var motivo = e === "error" ? String(NUBE.error() || "") : "";
    $("nube-estado").textContent = sinSesion
      ? "Sin conectar · cambios locales"
      : (TEXTO_NUBE[e] || TEXTO_NUBE.off) +
        (motivo ? " · " + (motivo.length > 44 ? motivo.slice(0, 44) + "…" : motivo) : "");
    $("chip-nube").title = motivo ? "Sincronización: " + motivo : "Sincronización con la nube";
    var c = NUBE.config();
    var donde = NUBE.activa()
      ? c.tabla + " · " + c.url.replace(/^https?:\/\//, "")
      : "sin configurar";
    $("nube-nota").textContent = donde;
    /* El rótulo del bloque plegado dice si está conectada: así no hay que
       abrirlo para saberlo, que es lo único que se consulta a diario. */
    /* El bloque que se pega en js/config.js, con los valores de verdad: una
       clave publicable son 46 caracteres y copiarla a mano desde una captura
       es cómo se rompe esto en silencio. */
    $("nube-snippet").value =
      "window.CONFIG_NUBE = {\n" +
      '  url: "' + c.url + '",\n' +
      '  anonKey: "' + c.anonKey + '",\n' +
      '  tabla: "' + c.tabla + '"\n' +
      "};";
    $("nube-nota-pie").textContent = NUBE.activa()
      ? (SESION.activa() ? "en línea · " : "sin sesión · ") + donde
      : "sin configurar";

    /* El bloque solo aparece cuando hay algo que hacer. Funcionando no le
       sirve a nadie del muelle: el proyecto viene en js/config.js y cada
       persona solo entra con su cuenta. `?nube` lo fuerza, para el que
       administra. */
    var hayQueVerlo = !NUBE.activa() || NUBE.estado() === "error" || forzarNube;
    $("bl-nube").hidden = !hayQueVerlo;
    if(!hayQueVerlo) $("bl-nube").open = false;
  }

  /* ─────────────────────────── puerta ──────────────────────────── */

  /**
   * La puerta aparece solo si hay proyecto configurado y no hay sesión.
   *
   * Sin proyecto no se pide nada: la app calcula contra el navegador y
   * exigir login para hacer una cuenta local sería pedir permiso para usar
   * una calculadora. Con proyecto, en cambio, detrás de esta pantalla hay
   * montos de demurrage y tarifas de contrato de todo el equipo.
   */
  function pintarPuerta(){
    var hace = NUBE.activa() && !SESION.activa() && !seguirSinConectar;
    $("puerta").hidden = !hace;
    /* El foco entra al formulario: si la puerta aparece y el cursor sigue en
       la página de atrás, se escribe la contraseña en un campo del tablero. */
    if(hace) setTimeout(function(){ $("puerta-email").focus(); }, 40);
    /* Las cuentas son de un proyecto, no de una cuenta de Supabase: una del
       proyecto A no existe en el B y el servidor contesta «credenciales
       inválidas», igual que ante una clave mala. Ver el destino convierte
       media hora de probar contraseñas en un vistazo. */
    var c = NUBE.config();
    $("puerta-proyecto").textContent = c.url
      ? "Proyecto: " + c.url.replace(/^https?:\/\//, "")
      : "\u00a0";
    var quien = SESION.usuario();
    $("chip-sesion").hidden = !quien;
    if(quien) $("sesion-quien").textContent = quien;
  }

  /* Quien decide seguir sin conectar no vuelve a ver la puerta en esta
     visita, pero el chip de la cabecera dice que está solo. */
  var seguirSinConectar = false;

  function entrar(){
    var email = $("puerta-email").value.trim(), clave = $("puerta-clave").value;
    if(!email || !clave){ avisoPuerta("Escribe el correo y la contraseña.", "warn"); return; }
    $("btn-entrar").disabled = true;
    avisoPuerta("Entrando…", "info");
    SESION.iniciar(NUBE.config(), email, clave)
      .then(function(){
        $("puerta-clave").value = "";
        avisoPuerta("", "");
        pintarPuerta();
        pintarEstadoNube();
        /* Todo lo compartido, no solo los embarques y el libro. La bitácora
           y las planillas de turno quedaban esperando el relevo de los 60 s,
           así que quien entraba veía la ficha de TM embarcadas en «—» y el
           calendario sin los cierres durante un minuto, como si nadie
           hubiera cargado nada. */
        return Promise.all([sincronizar(true).then(bajarTemporadaCompartida),
                            bitSincronizar(), turnosSincronizar()]);
      })
      .then(function(){ pintarEstadoNube(); })
      .catch(function(err){
        var extra = /incorrect/i.test(err.message)
          ? " Revisa también que la cuenta exista <em>en este proyecto</em>: " +
            "las de Supabase no se comparten entre proyectos."
          : "";
        avisoPuerta(esc(err.message) + extra, "error");
      })
      .then(function(){ $("btn-entrar").disabled = false; });
  }

  function avisoPuerta(html, clase){
    $("puerta-aviso").innerHTML = html ? '<div class="aviso '+(clase||"info")+'">'+html+'</div>' : "";
  }

  function avisoNube(html, clase){
    $("nube-aviso").innerHTML = html ? '<div class="aviso '+(clase||"info")+'">'+html+'</div>' : "";
  }

  /**
   * Lee la nube, fusiona con lo local y sube solo lo que allá está más viejo.
   * El orden importa: subir primero pisaría el trabajo de otra persona.
   */
  function sincronizar(silencioso){
    if(!NUBE.activa()) return Promise.resolve(false);
    return NUBE.listar().then(function(remotos){
      var antes = flota.length;
      var fusion = NUBE.fusionar(flota, remotos);
      var subir = NUBE.pendientesDeSubir(fusion, remotos);

      /* Lo que baja de la nube no pasa por FL.cargar(), que es donde se
         migra la base «NOR aceptado» retirada: sin esto, una recalada vieja
         subida desde otro computador volvería con la base muerta. */
      flota = FL.ordenar(FL.migrar(fusion));
      FL.guardar(flota);
      refrescarSelector();

      return Promise.all(subir.map(function(r){ return NUBE.guardar(r, L); })).then(function(){
        if(!silencioso){
          var partes = [flota.length + " embarques en total"];
          if(flota.length > antes) partes.push((flota.length - antes) + " nuevos desde la nube");
          if(subir.length) partes.push(subir.length + " subidos");
          avisoNube("Sincronizado: " + partes.join(" · ") + ".", "ok");
        }
        pintarEstadoNube();
        return true;
      });
    }).catch(function(err){
      if(!silencioso) avisoNube("No se pudo sincronizar: " + esc(err.message), "error");
      return false;
    });
  }

  function cargarConfigNube(){
    var c = NUBE.config();
    $("nube-url").value = c.url;
    $("nube-key").value = c.anonKey;
    $("nube-tabla").value = c.tabla;
    pintarEstadoNube();
  }

  /* ─────────────── historial: guardado y selector ──────────────── */

  var MES = ["enero","febrero","marzo","abril","mayo","junio",
             "julio","agosto","septiembre","octubre","noviembre","diciembre"];

  /**
   * Guarda la recalada abierta sin pedir permiso. Solo si trae código de
   * embarque: es lo que la identifica, y sin él cada cálculo crearía una
   * entrada nueva en vez de actualizar la misma.
   */
  function autoguardar(){
    var codigo = $("codigo").value.trim();
    if(!codigo) return false;

    /* Si el contenido es idéntico al guardado, no se toca nada. Abrir un
       embarque para mirarlo no es editarlo, y cada subida innecesaria es otra
       petición en vuelo que puede llegar desordenada y resucitar una copia
       vieja. */
    var campos = camposActuales(), deducciones = leerDeducciones();
    var huella = JSON.stringify({campos: campos, deducciones: deducciones});
    var previo = null;
    flota.forEach(function(r){
      if((r.campos.codigo || "").trim().toUpperCase() === codigo.toUpperCase()) previo = r;
    });
    if(previo && JSON.stringify({campos: previo.campos, deducciones: previo.deducciones}) === huella){
      return false;
    }

    var registro = {campos: campos, deducciones: deducciones,
                    actualizadoEn: new Date().toISOString()};
    flota = FL.agregar(flota, registro);
    FL.guardar(flota);
    refrescarSelector();
    NUBE.guardar(registro, L).then(pintarEstadoNube);
    return true;
  }

  /** Fecha con la que se ordena y se rotula un embarque en el historial. */
  function fechaDe(reg){
    var c = reg.campos;
    return L.parseFechaHora(c.primeraEspia) || L.parseFechaHora(c.inicioCarga) ||
           L.parseFechaHora(c.nor) || null;
  }

  /** Reconstruye el desplegable: más reciente primero, agrupado por mes. */
  function refrescarSelector(){
    var sel = $("selector-recaladas");
    var elegido = sel.value;
    var orden = flota.slice().sort(function(a,b){
      var fa = fechaDe(a), fb = fechaDe(b);
      if(!fa && !fb) return 0;
      if(!fa) return 1;
      if(!fb) return -1;
      return fb - fa;                       // el embarque más reciente arriba
    });

    sel.innerHTML = "";
    sel.appendChild(new Option(flota.length
      ? "Historial · " + flota.length + (flota.length === 1 ? " embarque" : " embarques")
      : "Historial de embarques", ""));

    var grupoActual = null, grupo = null;
    orden.forEach(function(reg){
      var f = fechaDe(reg);
      var clave = f ? f.getFullYear() + "-" + f.getMonth() : "sin-fecha";
      if(clave !== grupoActual){
        grupoActual = clave;
        grupo = document.createElement("optgroup");
        grupo.label = f ? (MES[f.getMonth()] + " " + f.getFullYear()) : "Sin fecha";
        sel.appendChild(grupo);
      }
      var etiqueta = (f ? String(f.getDate()).padStart(2,"0") + " " + MES[f.getMonth()].slice(0,3) + " · " : "") +
        (reg.campos.nave || "(sin nombre)") +
        (reg.campos.codigo ? " · " + reg.campos.codigo : "");
      var op = new Option(etiqueta, reg.id);
      grupo.appendChild(op);
    });

    // Se mantiene marcado el embarque abierto.
    var abierto = null;
    var codigo = $("codigo").value.trim().toUpperCase();
    if(codigo){
      flota.forEach(function(r){
        if((r.campos.codigo || "").trim().toUpperCase() === codigo) abierto = r.id;
      });
    }
    sel.value = abierto || elegido || "";
  }

  function buscar(id){
    for(var i=0;i<flota.length;i++){ if(flota[i].id === id) return flota[i]; }
    return null;
  }

  /** Carga una recalada de la temporada en el formulario y va al dashboard. */
  function abrirRecalada(id){
    var reg = buscar(id);
    if(!reg) return;
    CAMPOS.forEach(function(k){ if(typeof reg.campos[k] === "string") $(k).value = reg.campos[k]; });
    $("aplicaDespatch").checked = reg.campos.aplicaDespatch !== false;
    pintarDeducciones(reg.deducciones || porDefecto());
    alternarPermitido();
    alternarDespatch();
    verVista("operacion");
    calcular();
    plegarRecaladaSegunEstado();
  }

  /* ─────────────── resumen de lo importado (solo lectura) ──────── */

  function fechaCorta(id){
    var d = fh(id);
    return d ? fechaLarga(d) : "—";
  }

  function renderResumenRecalada(){
    var filas = [
      ["Nave",                $("nave").value || "—"],
      ["Código de embarque",  $("codigo").value || "—"],
      ["Tonelaje",            num("tonelaje") ? num("tonelaje").toLocaleString("es-CL") + " t" : "—"],
      ["Eslora",              num("eslora") ? num("eslora").toLocaleString("es-CL") + " m" : "—"],
      ["Tarifa de muelle",    num("tarifaMuelle")
        ? num("tarifaMuelle").toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:2}) + " US$/m/h" : "—"],
      ["1ª espía",            fechaCorta("primeraEspia")],
      ["Última espía",        fechaCorta("ultimaEspia")],
      ["Inicio de carguío",   fechaCorta("inicioCarga")],
      ["Término de carguío",  fechaCorta("finCarga")],
      ["Total embarque",      num("horasTotales") ? hDec(num("horasTotales")) : "—"],
      ["Operación efectiva",  num("horasOpEfectiva") ? hDec(num("horasOpEfectiva")) : "—"],
      ["Mtto. terminal (muellaje)", hDec(num("horasMantenimientoMuellaje"))],
      ["Nave a la gira",      hDec(num("horasGira"))]
    ];
    $("recalada-resumen").innerHTML = "<tbody>" + filas.map(function(f){
      return "<tr><td class='text-2'>" + f[0] + "</td><td class='n'>" + esc(f[1]) + "</td></tr>";
    }).join("") + "</tbody>";

    $("recalada-origen").textContent = $("nave").value
      ? "importada del registro de tiempos"
      : "sin datos importados";
  }

  /* ────────────────────────── persistencia ─────────────────────── */

  function guardar(){
    try{
      var datos = {deducciones: leerDeducciones(), aplicaDespatch: $("aplicaDespatch").checked};
      CAMPOS.forEach(function(id){ datos[id] = $(id).value; });
      localStorage.setItem(CLAVE, JSON.stringify(datos));
    }catch(e){ /* almacenamiento bloqueado */ }
  }

  function restaurar(){
    var datos = null;
    try{ datos = JSON.parse(localStorage.getItem(CLAVE) || "null"); }catch(e){ datos = null; }
    if(!datos){ pintarDeducciones(porDefecto()); return false; }
    CAMPOS.forEach(function(id){ if(typeof datos[id] === "string") $(id).value = datos[id]; });
    if(typeof datos.aplicaDespatch === "boolean") $("aplicaDespatch").checked = datos.aplicaDespatch;
    pintarDeducciones(datos.deducciones && datos.deducciones.length ? datos.deducciones : porDefecto());
    return true;
  }

  /* ═══════════════════════ TEMPORADA POR TRIMESTRES ══════════════════
     El libro de reportería trae el demurrage ya liquidado con el armador.
     Acá no se recalcula nada: se agrega por trimestre y se muestra lo que
     los números dicen juntos, que es lo que el libro no hace explícito. */

  var temporada = null;      // {datos, trimestres, diagnostico}

  function avisoRep(html, clase){
    $("rep-aviso").innerHTML = html ? '<div class="aviso '+(clase||"info")+'">'+html+'</div>' : "";
  }

  function leerLibroReporteria(archivo){
    if(!archivo) return;
    if(typeof XLSX === "undefined"){
      avisoRep("No se cargó el lector de Excel (js/vendor/xlsx.full.min.js).", "error");
      return;
    }
    var lector = new FileReader();
    lector.onload = function(ev){
      try{
        var libro = XLSX.read(new Uint8Array(ev.target.result), {type:"array", cellDates:true});
        if(enrutar(libro, archivo.name)) return;
        /* Un libro que no es ninguno de los dos no se aplica a medias: sin la
           hoja de recaladas la temporada quedaría en cero y se perdería el
           libro que ya estaba cargado, por haber soltado el archivo
           equivocado en la zona. */
        avisoRep("«" + esc(archivo.name) + "» no trae la hoja PUNTA TOTORALILLO ni " +
          "ACUMULADO EMBARQUE: no se cargó nada.", "error");
      }catch(err){
        avisoRep("No se pudo leer el libro: " + esc(err.message), "error");
      }
    };
    lector.onerror = function(){ avisoRep("No se pudo abrir el archivo.", "error"); };
    lector.readAsArrayBuffer(archivo);
  }

  function aplicarReporteria(r, nombre){
    var trimestres = TRI.porTrimestre(r.datos);
    temporada = {datos: r.datos, trimestres: trimestres, diagnostico: TRI.diagnostico(trimestres)};
    guardarTemporada();
    /* El libro es lo que permite cruzar la recalada abierta con la planilla:
       el calado sale del mes de cierre, y el mes de cierre lo da el libro. */
    if(aplicarCaladoDeTurno()) calcular();

    var html = "<strong>" + esc(nombre || "Libro") + "</strong>: " +
      r.datos.recaladas.length + " recaladas en " + trimestres.length +
      (trimestres.length === 1 ? " trimestre." : " trimestres.");
    if(r.avisos.length) html += "<ul><li>" + r.avisos.map(esc).join("</li><li>") + "</li></ul>";
    avisoRep(html, r.avisos.length ? "warn" : "ok");

    /* Y se comparte. Cargar el libro en un navegador y dejarlo ahí obliga a
       las otras dos personas a repetir el mismo Excel para ver la temporada,
       que era justo lo que quedaba pendiente. */
    if(NUBE.lista()){
      NUBE.subirTemporada(r.datos, {origen: nombre || "", quien: SESION.usuario()})
        .then(function(ok){
          if(ok) avisoRep(html + " Compartido con el equipo.", r.avisos.length ? "warn" : "ok");
        });
    }

    verVista("operacion");
    pintarNorPendientes();
    pintarFiltros();
    aplicarFiltro();
    var b = $("bl-reporteria");
    /* Con la temporada cargada el bloque de carga estorba: lo que se mira son
       los trimestres. Se queda abierto solo si hay algo que hacer —un aviso
       que revisar, o NOR que traerle al historial. La primera versión lo
       plegaba siempre y dejaba el botón de los NOR enterrado adentro. */
    if(b) b.open = !!r.avisos.length || !$("rep-acciones").hidden;
    pintarOrigenLibros();
  }

  /**
   * El rótulo del bloque, con los dos libros.
   *
   * Decía solo las recaladas de la reportería. Con el libro cargado y sin
   * ninguna planilla de turno, la ficha de TM embarcadas queda en «—» y no
   * hay cómo saber por qué: el rótulo tiene que nombrar lo que falta.
   */
  function pintarOrigenLibros(nota){
    var partes = [];
    if(temporada && temporada.datos && temporada.datos.recaladas &&
       temporada.datos.recaladas.length){
      partes.push(temporada.datos.recaladas.length + " recaladas");
      var qs = (temporada.trimestres || []).map(function(q){ return q.trimestre; });
      if(qs.length) partes.push(qs.join(" · "));
    }
    var meses = Object.keys(turnos || {}).length;
    if(meses) partes.push(meses + (meses === 1 ? " mes de turno" : " meses de turno"));
    else if(partes.length) partes.push("sin planillas de turno");
    if(nota) partes.push(nota);
    $("rep-origen").textContent = partes.length ? partes.join(" · ") : "sin cargar";
  }

  var CLAVE_TEMP = "demurrage-ppt.temporada.v1";

  var CLAVE_TEMP_FECHA = "demurrage-ppt.temporada.fecha.v1";

  function guardarTemporada(marca){
    if(!temporada) return;
    try{
      // Solo los datos crudos: los trimestres se recalculan al abrir, para que
      // un cambio en la agregación alcance a lo ya guardado sin migraciones.
      localStorage.setItem(CLAVE_TEMP, JSON.stringify(temporada.datos));
      /* Con qué versión del libro compartido se corresponde lo guardado. Sin
         esto, cada apertura bajaría el de la nube aunque fuera el mismo, y no
         habría forma de saber si el de acá es más nuevo. */
      localStorage.setItem(CLAVE_TEMP_FECHA, String(marca || Date.now()));
    }catch(e){ /* almacenamiento bloqueado */ }
  }

  /* JSON no tiene fechas: vuelven como texto ISO y hay que rearmarlas, o la
     espera NOR→amarre saldría vacía en todo lo que no venga recién leído del
     Excel. Vale para lo que se recupera del navegador y para lo que baja de
     la nube, que llegan por el mismo camino. */
  function rehidratar(crudo){
    if(!crudo) return crudo;
    ["recaladas","tiempos","plan"].forEach(function(k){
      (crudo[k] || []).forEach(function(x){
        ["laycanDesde","laycanHasta","eta","nor","atb","inicioCarga","finCarga","etb","etd"].forEach(function(c){
          if(typeof x[c] === "string") x[c] = new Date(x[c]);
        });
      });
    });
    (crudo.detenciones || []).forEach(function(d){
      ["inicio","fin"].forEach(function(c){ if(typeof d[c] === "string") d[c] = new Date(d[c]); });
    });
    return crudo;
  }

  /** Deja una temporada en pantalla, venga de donde venga. */
  function adoptarTemporada(crudo, nota){
    if(!crudo || !crudo.recaladas || !crudo.recaladas.length) return false;
    rehidratar(crudo);
    var trimestres = TRI.porTrimestre(crudo);
    temporada = {datos: crudo, trimestres: trimestres, diagnostico: TRI.diagnostico(trimestres)};
    pintarOrigenLibros(nota);
    var b = $("bl-reporteria");
    pintarNorPendientes();
    if(b) b.open = !$("rep-acciones").hidden;
    pintarFiltros();
    aplicarFiltro();
    return true;
  }

  function restaurarTemporada(){
    var crudo = null;
    try{ crudo = JSON.parse(localStorage.getItem(CLAVE_TEMP) || "null"); }catch(e){ crudo = null; }
    return adoptarTemporada(crudo);
  }

  /**
   * Trae el libro que cargó otra persona del equipo.
   *
   * El libro es uno solo y se reemplaza entero: llega como un Excel completo
   * que el área comercial regenera cada vez. Solo se adopta si el de la nube
   * es más nuevo que el que ya hay acá, para que abrir la app no pise un
   * libro recién cargado con uno de la semana pasada.
   */
  function bajarTemporadaCompartida(){
    return NUBE.bajarTemporada().then(function(remoto){
      if(!remoto || !remoto.datos) return false;
      var mio = 0;
      try{ mio = Number(localStorage.getItem(CLAVE_TEMP_FECHA) || 0); }catch(e){ mio = 0; }
      var suyo = Date.parse(remoto.actualizadoEn) || 0;
      if(temporada && suyo <= mio) return false;
      if(!adoptarTemporada(remoto.datos,
           remoto.quien ? "cargado por " + remoto.quien : "de la nube")) return false;
      guardarTemporada(suyo);
      return true;
    }).catch(function(){ return false; });
  }

  /* ───────────────────────── render ──────────────────────────── */

  var filtroTemporada = {trimestre: "", mes: ""};

  /** Rellena los desplegables con lo que de verdad hay en los datos. */
  function pintarFiltros(){
    if(!temporada) return;
    var d = temporada.datos;
    var qs = {};
    (d.recaladas || []).forEach(function(r){ qs[r.trimestre] = true; });
    var trimestres = Object.keys(qs).sort();
    $("filtro-trimestre").innerHTML = '<option value="">Toda la temporada</option>' +
      trimestres.map(function(q){
        return '<option value="' + q + '"' + (filtroTemporada.trimestre === q ? " selected" : "") + ">" + q + "</option>";
      }).join("");
    $("filtro-mes").innerHTML = '<option value="">Todos</option>' +
      TRI.mesesDisponibles(d).map(function(m){
        return '<option value="' + m.mes + '"' + (String(filtroTemporada.mes) === String(m.mes) ? " selected" : "") +
          ">" + m.nombre + "</option>";
      }).join("");
  }

  /** Los datos que el tablero está mostrando ahora mismo. */
  function datosFiltrados(){
    return TRI.filtrar(temporada.datos, filtroTemporada);
  }

  function aplicarFiltro(){
    if(!temporada) return;
    // La recalada abierta puede estar en el libro que se acaba de cargar.
    if(ultimoTimeSheet) renderConciliacion(ultimoTimeSheet);
    var sub = datosFiltrados();
    var qs = TRI.porTrimestre(sub);
    temporada.vista = {datos: sub, trimestres: qs, diagnostico: TRI.diagnostico(qs)};
    var partes = [];
    if(filtroTemporada.trimestre) partes.push(filtroTemporada.trimestre);
    if(filtroTemporada.mes !== "") partes.push(TRI.MESES[Number(filtroTemporada.mes)]);
    $("filtro-nota").textContent = partes.length
      ? "mostrando " + partes.join(" · ") + " — " + sub.recaladas.length +
        (sub.recaladas.length === 1 ? " recalada" : " recaladas")
      : temporada.datos.recaladas.length + " recaladas · " +
        temporada.trimestres.map(function(q){ return q.trimestre; }).join(" · ");
    renderTemporada();
  }

  /**
   * Las chispas de la tira de temporada: bajo cada cifra, cómo se llegó a
   * ella trimestre a trimestre.
   *
   * Se arman sobre los mismos trimestres ya agregados que alimentan la
   * ficha, acumulando los mismos campos. Eso no es comodidad: garantiza que
   * el último punto de la chispa valga exactamente lo que dice la cifra de
   * arriba, sin volver a sumar por otro camino —que es justo como aparecen
   * las dos cifras que no cuadran y nadie sabe cuál creer.
   *
   * La exposición del plan se queda sin chispa a propósito: mira hacia
   * adelante, no es el acumulado de nada.
   */
  function pintarChispas(qs, t){
    /* Un trimestre solo no tiene trayectoria; dos ya son una dirección. */
    var hay = qs && qs.length > 1;
    var series = {
      "ch-neto":      {campo: function(a){ return a.neto; }, fmt: usdCompacto,
                       acento: t.neto > 0 ? CRITICO : OK},
      "ch-recaladas": {campo: function(a){ return a.naves; },
                       fmt: function(v){ return Math.round(v) + " recaladas"; }},
      "ch-tonelada":  {campo: function(a){ return a.usdPorTonelada; },
                       fmt: function(v){ return v.toFixed(2) + " US$/t"; }},
      "ch-espera":    {campo: function(a){ return a.espera; },
                       fmt: function(v){ return Math.round(v).toLocaleString("es-CL") + " d"; }},
      "ch-allowed":   {campo: function(a){ return a.usoDelAllowed; }, fmt: pct},
      "ch-liquidado": {campo: function(a){ return a.netoLiquidado; }, fmt: usdCompacto}
    };

    var pasos = hay ? TRI.acumulado(qs) : [];
    Object.keys(series).forEach(function(id){
      var nodo = $(id);
      if(!nodo) return;
      if(!hay){ while(nodo.firstChild) nodo.removeChild(nodo.firstChild); return; }
      var puntos = pasos.map(function(a){
        return {rotulo: a.trimestre, valor: series[id].campo(a)};
      });
      G.chispa(nodo, puntos, {acento: series[id].acento, formato: series[id].fmt});
    });
  }

  function renderTemporada(){
    if(!temporada) return;
    var v = temporada.vista || temporada;
    var qs = v.trimestres, d = v.diagnostico, t = d.total;
    if(!qs.length){
      $("temp-lectura").innerHTML = '<p class="text-3">El filtro no deja ninguna recalada.</p>';
      $("temp-hero").className = "kpi con-chispa na";
      $("temp-hero-val").textContent = "—";
      /* Sin recaladas el periodo no embarcó nada. Dejar la cifra anterior
         en pie la haría pasar por la del filtro nuevo. */
      $("t-embarcado").textContent = "—";
      $("t-embarcado-sub").textContent = "sin recaladas en el filtro";
      return;
    }

    // ── veredicto en prosa ──
    var critico = t.usdPorTonelada >= 1;
    var rot = $("temp-sem-txt");
    rot.textContent = critico ? "costo alto" : t.usdPorTonelada >= 0.5 ? "con costo" : "limpia";
    rot.style.color = critico ? CRITICO : t.usdPorTonelada >= 0.5 ? AVISO : OK;
    $("temp-lectura").innerHTML = d.frases.map(function(f){
      return '<p style="margin:0 0 8px">' + esc(f) + '</p>';
    }).join("");

    // ── cifra y fichas ──
    $("temp-hero").className = "kpi con-chispa " + (t.neto > 0 ? "demurrage" : "despatch");
    $("temp-hero-val").textContent = usdExacto(t.neto);
    ajustarCifra($("temp-hero-val"));
    $("t-recaladas").textContent = t.naves;
    $("t-recaladas-sub").textContent = t.enDemurrage + " con demurrage · " +
      (t.naves - t.enDemurrage) + " sin";
    $("t-tonelada").textContent = t.usdPorTonelada.toFixed(2);
    $("t-tonelada-sub").textContent = Math.round(t.cargo).toLocaleString("es-CL") + " t del libro";

    /* ── TM embarcadas del periodo, desde el calado ──
       El filtro de arriba recorta el libro; el calado está en los CNN-EMB
       guardados, que es otro archivo. Se cruzan por nombre y fecha con el
       mismo emparejador de la conciliación. */
    var recaladasPeriodo = (v.datos && v.datos.recaladas) || [];
    var mil = function(n){ return Math.round(n).toLocaleString("es-CL"); };

    /* Dos caminos para la misma cifra, y el bueno manda. La planilla de
       turno trae el calado del mes y es exacta; sumar nave por nave desde
       los CNN-EMB da 0,06 % de diferencia en la temporada, que es la que hay
       entre el draft survey y el Bill of Lading. Se usa la planilla solo si
       están TODAS las del periodo: con una faltando el total daría de menos
       sin decirlo. */
    var deTurno = CONC.embarcadoDeTurno(recaladasPeriodo, turnos);
    var emb = CONC.tonelajeEmbarcado(recaladasPeriodo, flota);
    var usaTurno = deTurno.completo && deTurno.total > 0;
    $("t-embarcado").textContent = usaTurno ? mil(deTurno.total)
                                            : (emb.total > 0 ? mil(emb.total) : "—");
    ajustarCifra($("t-embarcado"));
    /* El denominador va siempre: un total que cubre 8 de 14 naves se lee
       como el total del mes si no dice sobre cuántas está hecho, y con eso
       se presenta a gerencia una cifra que no es la que se embarcó. */
    if(usaTurno){
      /* De dónde sale la cifra, siempre: es la diferencia entre un número
         que se puede defender en una liquidación y uno que no. */
      $("t-embarcado-sub").textContent = deTurno.meses.length === 1
        ? "planilla de turno · calado del mes"
        : "planillas de turno · " + deTurno.meses.length + " meses";
    }else if(!emb.naves){
      $("t-embarcado-sub").textContent = "carga el libro de reportería";
    }else if(!emb.conDato){
      /* No hay cifra por ningún camino. El denominador va igual: «sin
         calado» a secas no dice de cuántas naves se está hablando, y es lo
         primero que se va a preguntar. */
      $("t-embarcado-sub").textContent = "sin calado de las " + emb.naves +
        (emb.naves === 1 ? " nave" : " naves") +
        (deTurno.faltan.length
          ? " · falta la planilla de " + (deTurno.faltan.length <= 3
              ? deTurno.faltan.join(", ")
              : deTurno.faltan.length + " meses")
          : "");
    }else{
      var partes = [emb.conDato + " de " + emb.naves + " naves"];
      partes.push(emb.conCalado === emb.conDato
        ? "todas por draft survey"
        : emb.conCalado + " por draft survey");
      if(deTurno.faltan.length) partes.push("sin planilla de " + deTurno.faltan.length +
        (deTurno.faltan.length === 1 ? " mes" : " meses"));
      $("t-embarcado-sub").textContent = partes.join(" · ");
    }
    /* Incompleto se ve, no se deduce: mismo tono de aviso que usa la ficha
       de liquidado cuando hay proyecciones. */
    /* Verde cuando la cifra sale de la planilla —es la exacta—, ámbar
       cuando está armada a pedazos desde los CNN-EMB. */
    $("kpi-t-embarcado").querySelector(".ico-marca").style.color = usaTurno ? OK
      : ((emb.conDato && emb.conDato < emb.naves) || deTurno.faltan.length) ? AVISO
      : "var(--cmp-blue-400)";
    /* Contra el libro, que es la otra cifra que alguien va a citar. */
    var detalle = [];
    if(usaTurno) detalle.push("Planilla de turno: " + mil(deTurno.total) + " t  (" + deTurno.meses.join(", ") + ")");
    if(emb.conDato) detalle.push("Calado de los CNN-EMB: " + mil(emb.total) + " t sobre " + emb.conDato + " naves");
    if(emb.naves) detalle.push("Libro (BL): " + mil(emb.cargoLibro) + " t sobre " + emb.naves + " naves");
    if(emb.pesometro > 0) detalle.push(mil(emb.pesometro) + " t vienen del pesómetro, no del calado");
    if(deTurno.faltan.length) detalle.push("Sin planilla de turno: " + deTurno.faltan.join(", "));
    $("kpi-t-embarcado").title = detalle.length ? detalle.join("\n") : "Sin datos para este periodo.";
    $("t-espera").textContent = Math.round(t.espera).toLocaleString("es-CL");
    /* La cifra es la suma de la espera de todas las naves, no un promedio,
       y sin decir sobre cuántas se lee como si fuera una sola espera. El
       denominador va al lado: si dice «11 naves» y la temporada tiene 33,
       hay veintidós que no cruzaron con la hoja de tiempos. */
    $("t-espera-sub").textContent = t.conTiempos
      ? t.conTiempos + " de " + t.naves + " naves" +
        (t.operacion > 0 ? " · " + (t.espera / t.operacion).toFixed(1) + " veces la carga" : "")
      : "ninguna nave cruzó con la hoja de tiempos";
    $("t-allowed").textContent = pct(t.usoDelAllowed);
    $("t-allowed-sub").textContent = t.dentroDelAllowed + " de " + t.conTiempos + " naves dentro del laytime";
    $("t-allowed").style.color = t.usoDelAllowed <= 100 ? OK : CRITICO;

    /* Lo cobrado y lo estimado, separados: es la diferencia entre lo que ya
       está en la cuenta y lo que todavía puede cambiar. */
    $("t-liquidado").textContent = usdCompacto(t.netoLiquidado);
    $("t-liquidado-sub").textContent = t.proyectadas
      ? t.proyectadas + " de " + t.naves + " son proyección · " + usdCompacto(t.demurrageProyectado)
      : "las " + t.naves + " recaladas están liquidadas";
    $("kpi-t-liquidado").querySelector(".ico-marca").style.color = t.proyectadas ? AVISO : "var(--cmp-blue-400)";
    $("temp-hero-sub").textContent = t.proyectadas
      ? usdCompacto(t.netoLiquidado) + " liquidados + " + usdCompacto(t.demurrageProyectado) + " proyectados"
      : usdCompacto(t.demurrage) + " menos " + usdCompacto(t.despatch) + " de despatch";

    pintarChispas(qs, t);

    // ── demurrage neto por trimestre ──
    G.barras($("g-temp-neto"), qs.map(function(q){
      return {nombre: q.trimestre + " · " + q.naves + " naves", valor: q.neto};
    }), {color: CRITICO,
         fmtValor: function(v){ return usdCompacto(v); },
         fmtEje:   function(v){ return usdCompacto(v); }});
    $("temp-neto-nota").textContent = "total " + usd(t.neto);

    // ── dónde se va el tiempo ──
    var SERIES = [
      {nombre: "Espera antes del amarre", color: CRITICO},
      {nombre: "Operación de carga",      color: SERIE.efectiva},
      {nombre: "Laytime permitido",       color: SERIE.nocontrolable}
    ];
    G.barrasAgrupadas($("g-temp-tiempo"), qs.map(function(q){
      return {nombre: q.trimestre, valores: [q.espera, q.operacion, q.allowed]};
    }), SERIES, {fmt: function(v){ return Math.round(v) + " d"; }});
    $("ley-temp-tiempo").innerHTML = SERIES.map(function(se){
      return '<div class="ley-item"><span class="ley-sw" style="background:'+se.color+'"></span>'+se.nombre+'</div>';
    }).join("");

    // ── detenciones por categoría ──
    var porCat = {};
    qs.forEach(function(q){
      q.detenciones.forEach(function(c){
        if(!porCat[c.categoria]) porCat[c.categoria] = {categoria:c.categoria, dias:0, costo:0};
        porCat[c.categoria].dias += c.dias;
        porCat[c.categoria].costo += c.costo;
      });
    });
    var cats = Object.keys(porCat).map(function(k){ return porCat[k]; })
      .sort(function(a,b){ return b.dias - a.dias; });
    G.barras($("g-temp-detenciones"), cats.map(function(c){
      return {nombre: c.categoria, valor: c.dias};
    }), {color: SERIE.controlable,
         fmtValor: function(v){ return v.toFixed(1) + " d"; },
         fmtEje:   function(v){ return v.toFixed(0) + " d"; }});
    $("temp-det-nota").textContent = t.diasDetenidos.toFixed(1) + " días en total";

    $("tb-temp-det").innerHTML = qs.reduce(function(filas, q){
      return filas.concat(q.detenciones.map(function(c){
        return "<tr><td>" + esc(c.categoria) + "</td><td>" + q.trimestre +
          '</td><td class="n tabular">' + c.dias.toFixed(2) +
          '</td><td class="n tabular">' + c.eventos +
          '</td><td class="n tabular">' + Math.round(c.costo).toLocaleString("es-CL") + "</td></tr>";
      }));
    }, []).join("") || '<tr><td colspan="5" class="text-3">Sin detenciones registradas.</td></tr>';

    // ── clima ──
    var causas = {};
    qs.forEach(function(q){
      q.clima.forEach(function(c){
        causas[c.causa] = causas[c.causa] || {};
        causas[c.causa][q.trimestre] = c.dias;
      });
    });
    var nombresCausa = Object.keys(causas);
    if(nombresCausa.length){
      G.barrasAgrupadas($("g-temp-clima"), nombresCausa.map(function(c){
        return {nombre: c, valores: qs.map(function(q){ return causas[c][q.trimestre] || 0; })};
      }), qs.map(function(q, i){
        return {nombre: q.trimestre, color: [SERIE.nocontrolable, SERIE.efectiva, SERIE.controlable][i % 3]};
      }), {fmt: function(v){ return v.toFixed(1) + " d"; }});
      $("temp-clima-nota").textContent = t.diasClima.toFixed(1) + " días perdidos por clima";
    }else{
      G.barrasAgrupadas($("g-temp-clima"), [], []);
      $("temp-clima-nota").textContent = "el libro no trae la hoja de clima";
    }

    renderAtribucion(qs);
    renderExposicion();
    renderPorNave(v);
    renderTablaTemporada(qs);
    renderPlan();
  }

  /**
   * A qué se atribuye la espera, según los comentarios del libro.
   * "Sin atribuir" se muestra con el mismo peso que las demás: en 2026 es la
   * mayor, y esconderla daría una foto falsa de lo que está explicado.
   */
  function renderAtribucion(qs){
    var a = TRI.atribucion(qs);
    if(!a.length){
      G.barras($("g-temp-atribucion"), []);
      $("temp-atrib-nota").textContent = "sin demurrage que atribuir";
      $("temp-atrib-aviso").innerHTML = "";
      return;
    }
    G.barras($("g-temp-atribucion"), a.map(function(x){
      return {nombre: x.causa + " · " + x.naves + (x.naves === 1 ? " nave" : " naves"), valor: x.monto};
    }), {color: CRITICO,
         fmtValor: function(v){ return usdCompacto(v); },
         fmtEje:   function(v){ return usdCompacto(v); }});

    var sin = a.filter(function(x){ return x.causa === TRI.SIN_ATRIBUIR; })[0];
    var total = a.reduce(function(m, x){ return m + x.monto; }, 0);
    $("temp-atrib-nota").textContent = "sobre " + usdCompacto(total) + " de demurrage";
    $("temp-atrib-aviso").innerHTML = sin
      ? '<div class="aviso warn">' + esc(usdCompacto(sin.monto) + " (" +
          Math.round(sin.monto / total * 100) + " %) está sin atribuir: " + sin.naves +
          " recaladas sin comentario en el libro, y son las más caras. " +
          "Escribir la causa al liquidar es lo que convierte esta cifra en algo con lo que negociar.") +
        "</div>"
      : "";
  }

  /** Supuestos del cálculo de exposición, tomados del formulario. */
  function supuestosExposicion(){
    return {
      tasaEmbarque: num("expo-tasa") || 30000,
      rate: num("expo-rate") || TRI.rateTipico(temporada ? temporada.trimestres : []),
      descuento: $("expo-desc").value === "" ? 1.13 : num("expo-desc")
    };
  }

  function renderExposicion(){
    if(!temporada) return;
    var plan = temporada.datos.plan || [];
    if(!$("expo-rate").value){
      $("expo-rate").value = Math.round(TRI.rateTipico(temporada.trimestres)) || "";
    }
    var ex = TRI.exposicionPlan(plan, supuestosExposicion());
    var calc = ex.filter(function(e){ return e.calculable; });

    G.barras($("g-temp-exposicion"), calc.map(function(e){
      return {nombre: e.nave + (e.amarreFueraDeLaycan ? " ⚠" : ""), valor: e.exposicion};
    }), {color: AVISO,
         fmtValor: function(v){ return v > 0 ? usdCompacto(v) : "—"; },
         fmtEje:   function(v){ return usdCompacto(v); }});

    var total = calc.reduce(function(m, e){ return m + e.exposicion; }, 0);
    var expuestas = calc.filter(function(e){ return e.exposicion > 0; }).length;
    $("t-expo").textContent = total > 0 ? usdCompacto(total) : "—";
    $("t-expo-sub").textContent = calc.length
      ? expuestas + " de " + calc.length + " recaladas del plan"
      : "sin plan cargado";
    $("kpi-t-expo").querySelector(".ico-marca").style.color = expuestas ? AVISO : "var(--cmp-blue-400)";
    $("temp-expo-nota").textContent = expuestas
      ? expuestas + " de " + calc.length + " recaladas expuestas · " + usdCompacto(total)
      : "ninguna recalada del plan queda expuesta";

    $("tb-exposicion").innerHTML = ex.map(function(e){
      if(!e.calculable){
        return "<tr><td>" + esc(e.nave) + '</td><td colspan="5" class="text-3">sin fechas suficientes en el plan</td></tr>';
      }
      return "<tr>" +
        "<td" + (e.amarreFueraDeLaycan ? ' style="color:' + CRITICO + '"' : "") + ">" +
          esc(e.nave) + (e.amarreFueraDeLaycan ? " · amarre fuera del laycan" : "") + "</td>" +
        '<td class="n tabular">' + (e.tonelaje ? Math.round(e.tonelaje).toLocaleString("es-CL") : "—") + "</td>" +
        '<td class="n tabular">' + (e.espera == null ? "—" : e.espera.toFixed(1) + " d") + "</td>" +
        '<td class="n tabular">' + e.allowed.toFixed(2) + " d</td>" +
        '<td class="n tabular">' + e.contado.toFixed(2) + " d</td>" +
        '<td class="n tabular" style="color:' + (e.exposicion > 0 ? AVISO : OK) + '">' +
          (e.exposicion > 0 ? usd(e.exposicion) : "—") + "</td>" +
        "</tr>";
    }).join("") || '<tr><td colspan="6" class="text-3">El libro no trae plan de embarque.</td></tr>';
  }

  /**
   * Lo que antes vivía en la pestaña Flota, ahora sobre las recaladas del
   * libro de reportería: son 33 con su demurrage liquidado, contra las que el
   * usuario alcanzara a cargar suelta desde los CNN-EMB.
   */
  function renderPorNave(v){
    var recs = [];
    v.trimestres.forEach(function(q){ recs = recs.concat(q.recaladas); });
    var tiempos = {};
    (v.datos.tiempos || []).forEach(function(t){
      tiempos[t.trimestre + "|" + t.nave.toUpperCase().trim()] = t;
    });
    var deT = function(r){ return tiempos[r.trimestre + "|" + String(r.nave).toUpperCase().trim()]; };

    // ── estadía: del NOR al término de carguío, con el amarre marcando el corte
    var conFechas = recs.filter(function(r){ return r.nor && r.finCarga; });
    G.gantt($("g-temp-gantt"), conFechas.map(function(r){
      var seg = [];
      if(r.atb && r.atb > r.nor) seg.push({desde:r.nor, hasta:r.atb, color:CRITICO, nombre:"Espera al amarre"});
      seg.push({desde: r.atb && r.atb > r.nor ? r.atb : r.nor, hasta: r.finCarga,
                color: SERIE.efectiva, nombre: "Amarrada y cargando"});
      return {nombre: r.nave + " · " + r.trimestre, segmentos: seg};
    }), {banda: 22});
    $("ley-temp-gantt").innerHTML =
      '<div class="ley-item"><span class="ley-sw" style="background:'+CRITICO+'"></span>Espera entre el NOR y el amarre</div>' +
      '<div class="ley-item"><span class="ley-sw" style="background:'+SERIE.efectiva+'"></span>Amarrada y cargando</div>';
    $("temp-gantt-nota").textContent = conFechas.length + " naves con fechas completas";

    // ── demurrage contra despatch, nave por nave
    G.divergentes($("g-temp-divergentes"), recs.map(function(r){
      return {nombre: r.nave, valor: r.demurrage > 0 ? r.demurrage : -Math.abs(r.despatch)};
    }).filter(function(x){ return x.valor !== 0; })
      .sort(function(a, b){ return b.valor - a.valor; }),
      {fmt: function(v){ return usdCompacto(Math.abs(v)); }, banda: 22});

    // ── rate de carga alcanzado, contra la tasa del contrato
    /* `lineas` rotula por `etiqueta` y abrevia con `corta`: con 33 naves el
       eje no admite el nombre entero. */
    var rates = recs.map(function(r){
      var t = deT(r);
      if(!t || !(t.tasaDiaria > 0)) return null;
      return {etiqueta: r.nave + " · " + r.trimestre,
              corta: String(r.nave).split(/\s+/)[0].slice(0, 8),
              valor: t.tasaDiaria};
    }).filter(Boolean);
    var pactada = 0;
    (v.datos.tiempos || []).forEach(function(t){ if(t.tasaContrato > 0) pactada = t.tasaContrato; });
    G.lineas($("g-temp-rate"), rates, {
      referencia: pactada || undefined,
      desdeCero: false,
      fmtEje:   function(x){ return Math.round(x/1000) + " k"; },
      fmtValor: function(x){ return Math.round(x).toLocaleString("es-CL") + " t/d"; }
    });
    $("temp-rate-nota").textContent = pactada
      ? "línea gris: tasa pactada de " + Math.round(pactada).toLocaleString("es-CL") + " t/día"
      : "t/día alcanzados";

    // ── la espera, recalada por recalada: la variable que decide
    var esperas = recs.map(function(r){
      var d = TRI.diasEntre(r.nor, r.atb);
      return d == null ? null : {nombre: r.nave, valor: d};
    }).filter(Boolean).sort(function(a, b){ return b.valor - a.valor; });
    G.barras($("g-temp-esperas"), esperas.slice(0, 12), {
      color: CRITICO,
      fmtValor: function(x){ return x.toFixed(1) + " d"; },
      fmtEje:   function(x){ return x.toFixed(0) + " d"; }
    });
    $("temp-espera-nota").textContent = esperas.length > 12
      ? "las 12 mayores de " + esperas.length + " · días entre NOR y amarre"
      : "días entre el NOR y el amarre";
  }

  function renderTablaTemporada(qs){
    var filas = [];
    qs.forEach(function(q){
      q.recaladas.forEach(function(r){
        var estado = TRI.estadoLaycan(r);
        var espera = TRI.diasEntre(r.nor, r.atb);
        var colorLaycan = estado === "tarde" ? CRITICO : estado === "antes" ? AVISO : "";
        filas.push("<tr>" +
          "<td>" + q.trimestre + "</td>" +
          "<td>" + esc(r.nave) + "</td>" +
          "<td>" + esc(r.inco || "—") + "</td>" +
          '<td class="n tabular">' + (r.cargo ? Math.round(r.cargo).toLocaleString("es-CL") : "—") + "</td>" +
          '<td' + (colorLaycan ? ' style="color:' + colorLaycan + '"' : "") + ">" + (estado || "—") + "</td>" +
          '<td class="n tabular">' + (espera == null ? "—" : espera.toFixed(1) + " d") + "</td>" +
          '<td class="n tabular">' + (r.rate ? Math.round(r.rate).toLocaleString("es-CL") : "—") + "</td>" +
          '<td class="n tabular" style="color:' + (r.demurrage ? CRITICO : "") + '">' +
            (r.demurrage ? Math.round(r.demurrage).toLocaleString("es-CL") : "—") + "</td>" +
          '<td class="n tabular" style="color:' + (r.despatch ? OK : "") + '">' +
            (r.despatch ? Math.round(Math.abs(r.despatch)).toLocaleString("es-CL") : "—") + "</td>" +
          "</tr>");
      });
    });
    $("tb-temporada").innerHTML = filas.join("") ||
      '<tr><td colspan="9" class="text-3">Sin recaladas.</td></tr>';
    var laycan = {antes:0, dentro:0, tarde:0};
    qs.forEach(function(q){
      laycan.antes += q.laycan.antes; laycan.dentro += q.laycan.dentro; laycan.tarde += q.laycan.tarde;
    });
    $("temp-tabla-nota").textContent = "laycan: " + laycan.dentro + " dentro · " +
      laycan.antes + " antes · " + laycan.tarde + " después";
  }

  /** Diagrama del plan: la ventana de laycan de cada nave que viene. */
  function renderPlan(){
    var plan = (temporada && temporada.datos.plan) || [];
    var conFechas = plan.filter(function(p){ return p.laycanDesde && p.laycanHasta; });
    if(!conFechas.length){
      $("g-temp-plan").innerHTML = "";
      $("ley-temp-plan").innerHTML = "";
      $("temp-plan-nota").textContent = "el libro no trae plan de embarque con fechas";
      return;
    }
    G.gantt($("g-temp-plan"), conFechas.map(function(p){
      var segmentos = [{desde: p.laycanDesde, hasta: p.laycanHasta, color: SERIE.nocontrolable, nombre: "Laycan"}];
      // El ETB dentro de la ventana es lo esperable; fuera, es la nave que ya
      // se sabe que va a esperar, y es la que conviene mirar antes de que pase.
      if(p.etb) segmentos.push({desde: p.etb, hasta: p.etd || p.etb,
        color: p.etb > p.laycanHasta ? CRITICO : SERIE.efectiva, nombre: "Estadía prevista"});
      return {nombre: p.nave + (p.tonelaje ? " · " + Math.round(p.tonelaje/1000) + " kt" : ""), segmentos: segmentos};
    }), {});
    $("ley-temp-plan").innerHTML =
      '<div class="ley-item"><span class="ley-sw" style="background:'+SERIE.nocontrolable+'"></span>Ventana de laycan</div>' +
      '<div class="ley-item"><span class="ley-sw" style="background:'+SERIE.efectiva+'"></span>Estadía prevista en ventana</div>' +
      '<div class="ley-item"><span class="ley-sw" style="background:'+CRITICO+'"></span>Amarre previsto fuera del laycan</div>';
    var fuera = conFechas.filter(function(p){ return p.etb && p.etb > p.laycanHasta; }).length;
    $("temp-plan-nota").textContent = conFechas.length + " recaladas planificadas" +
      (fuera ? " · " + fuera + " con amarre previsto fuera del laycan" : "");
  }

  /* ──────────────────────────── vistas ─────────────────────────── */

  function verVista(cual){
    $("vista-operacion").hidden = cual !== "operacion";
    $("vista-clima").hidden = cual !== "clima";
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function(t){
      t.classList.toggle("on", t.dataset.vista === cual);
    });
    window.scrollTo(0, 0);
    /* Las fichas que se pintaron con la vista oculta no tenían ancho que
       medir, así que la cifra quedó sin ajustar. Al mostrarla hay ancho: se
       remide. */
    if(cual === "operacion") ["k-demurrage","k-despatch","k-eta"].forEach(function(id){ ajustarCifra($(id)); });
  }

  /**
   * Trae el bloque de la recalada a la vista.
   * Antes esto era saltar a otra pestaña; ahora todo vive en el dashboard,
   * así que basta con abrir el bloque y desplazarse hasta él.
   */
  /**
   * El bloque de la recalada se abre solo cuando no hay nada cargado.
   * Con datos, se pliega: si no, el veredicto y la cifra quedan empujados
   * media pantalla hacia abajo por una tabla que ya se leyó una vez.
   * No se llama desde calcular(): cerrarlo mientras alguien corrige un dato
   * sería pelearle al usuario.
   */
  function plegarRecaladaSegunEstado(){
    var b = $("bl-datos");
    if(!b) return;
    var nave = $("nave").value, codigo = $("codigo").value;
    /* Se queda abierto solo si el cálculo no llegó a salir: ahí el bloque es
       el lugar donde se arregla. Un aviso no basta para dejarlo abierto —casi
       todo libro real trae alguno y entonces no se cerraría nunca—, pero
       tampoco puede quedar escondido: un aviso dentro de un bloque cerrado no
       existe. Por eso la cuenta va en el rótulo, que sí se ve plegado. */
    b.open = !(nave || codigo) || !ultimoTimeSheet;

    var nota = (nave || codigo) ? [nave, codigo].filter(Boolean).join(" · ") : "sin datos importados";
    var pendientes = $("aviso-import").querySelectorAll(".warn, .error").length +
                     $("aviso-nor").querySelectorAll(".warn, .error").length;
    var rot = $("recalada-origen");
    rot.textContent = nota + (pendientes ? "  ·  " + pendientes +
      (pendientes === 1 ? " aviso por revisar" : " avisos por revisar") : "");
    rot.style.color = pendientes ? AVISO : "";
  }

  /** Muestra una de las tres sub-pestañas del bloque de datos. */
  function verSubpanel(id){
    Array.prototype.forEach.call(document.querySelectorAll("#bl-datos .subpane"), function(p){
      p.hidden = p.id !== id;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#bl-datos .subtab"), function(t){
      t.classList.toggle("on", t.dataset.panel === id);
    });
  }

  function enfocarRecalada(){
    verVista("operacion");
    var b = $("bl-datos");
    if(!b) return;
    b.open = true;
    verSubpanel("pane-recalada");
    b.scrollIntoView({behavior:"smooth", block:"start"});
  }

  function alternarPermitido(){
    var porTasa = $("modoPermitido").value === "tasa";
    $("campo-tasa").hidden = !porTasa;
    $("campo-horas").hidden = porTasa;
  }

  function alternarDespatch(){
    var porTarifa = $("modoDespatch").value === "tarifa";
    $("campo-pct-despatch").hidden = porTarifa;
    $("campo-tarifa-despatch").hidden = !porTarifa;
  }

  /* ─────────────────────────── eventos ─────────────────────────── */

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function(t){
    t.addEventListener("click", function(){
      verVista(t.dataset.vista);
      // Los gráficos se miden contra el panel: hay que dibujar ya visible.
      if(t.dataset.vista === "operacion"){
        calcular();
        if(temporada) aplicarFiltro();
      }else if(t.dataset.vista === "clima"){
        if(serieClima.length) renderClima(); else consultarClima();
      }
    });
  });
  /* Los gráficos se miden contra el ancho de su panel, y un panel dentro de
     un <details> cerrado mide 0: se dibujarían al mínimo y se quedarían así
     al abrirlo. Se redibujan cuando el bloque se abre. */
  /**
   * ¿Hay NOR que traerle al historial? Decide si el botón se muestra y con
   * qué cifra. Se calcula de verdad —no basta con «hay libro y hay flota»—
   * porque ofrecer una acción que no va a cambiar nada es peor que no
   * ofrecerla.
   */
  function pintarNorPendientes(){
    var acciones = $("rep-acciones");
    if(!temporada || !temporada.datos || !flota.length){ acciones.hidden = true; return; }
    var r = CONC.actualizarNor(flota, temporada.datos.recaladas, temporada.datos.plan);
    var cambios = r.resumen.agregados + r.resumen.reemplazados + r.resumen.etas;
    acciones.hidden = !cambios;
    $("rep-acciones-nota").textContent = cambios
      ? cambios + " de " + r.resumen.total + " recaladas guardadas pueden tomar su NOR o su ETA"
      : "";
  }

  /* Traer los NOR del libro a todo el historial de una vez.
     Pide confirmación con las cifras a la vista: reescribe datos de muchas
     recaladas y el NOR es el que decide desde cuándo corre el laytime. */
  $("btn-nor-masivo").addEventListener("click", function(){
    if(!temporada || !temporada.datos){ return; }
    var r = CONC.actualizarNor(flota, temporada.datos.recaladas, temporada.datos.plan);
    var cambios = r.resumen.agregados + r.resumen.reemplazados + r.resumen.etas;
    if(!cambios){
      avisoRep("Ningún NOR que traer: " + r.resumen.iguales + " ya coinciden con el libro y " +
        r.resumen.sinEmparejar + " no se pudieron emparejar.", "info");
      return;
    }
    var texto = "Se van a cambiar " + cambios + " de " + r.resumen.total + " recaladas guardadas:\n\n" +
      "· " + r.resumen.agregados + " sin NOR lo reciben del libro de reportería\n" +
      "· " + r.resumen.reemplazados + " tienen un NOR distinto y se reemplaza\n" +
      "· " + r.resumen.etas + " reciben su ETA nominado del plan de embarque\n" +
      "· " + r.resumen.iguales + " ya coinciden\n" +
      "· " + r.resumen.sinEmparejar + " no se pudieron emparejar\n\n" +
      "A las que no tenían NOR se les pone además el inicio del laytime en «lo primero que ocurra», " +
      "que es lo que hace que el NOR sirva de algo. Un ETA ya puesto no se toca.\n\n¿Seguir?";
    if(!window.confirm(texto)) return;

    flota = FL.ordenar(r.lista);
    FL.guardar(flota);
    refrescarSelector();

    /* Si la recalada abierta es una de las que cambió, hay que volver a
       pintarla: si no, la pantalla sigue mostrando el cálculo viejo. */
    var codigo = $("codigo").value.trim().toUpperCase();
    var abierta = null;
    r.detalle.forEach(function(d){
      if(codigo && (d.codigo || "").trim().toUpperCase() === codigo &&
         (d.estado === "agregado" || d.estado === "reemplazado" || d.estado === "eta")) abierta = d;
    });
    if(abierta){
      if(abierta.nor){
        $("nor").value = aInput(abierta.nor);
        if($("baseInicio").value === "amarre") $("baseInicio").value = "loPrimero";
      }
      if(abierta.eta) $("eta").value = aInput(abierta.eta);
      calcular();
    }

    var sin = r.detalle.filter(function(d){ return d.estado === "sin emparejar"; });
    var html = "<strong>" + cambios + " recaladas actualizadas.</strong> " +
      r.resumen.agregados + " NOR agregados, " + r.resumen.reemplazados + " reemplazados, " +
      r.resumen.etas + " ETA del plan, " + r.resumen.iguales + " ya coincidían.";
    if(sin.length){
      html += "<ul><li>" + sin.map(function(d){
        return esc((d.nave || d.codigo || "sin nombre") + ": " + d.motivo);
      }).join("</li><li>") + "</li></ul>";
    }
    avisoRep(html, sin.length ? "warn" : "ok");
    pintarNorPendientes();   // ya no quedan NOR que traer: el botón se va

    /* Y suben. Corregir 28 recaladas en un navegador y dejarlas ahí no
       arregla nada para las otras dos personas del equipo. */
    if(NUBE.lista()){
      sincronizar(true).then(function(){
        avisoRep(html + " Se subieron a la nube.", sin.length ? "warn" : "ok");
      });
    }
  });

  /* Adoptar los datos del contrato: rate, NOR y tonelaje del Bill of Lading.
     No se aplican solos —cambiar el rate de una liquidación sin que nadie lo
     pida es exactamente lo que no debe hacer esta app— pero con un clic la
     recalada queda armada como el contrato manda. */
  $("btn-conc-adoptar").addEventListener("click", function(){
    if(!conciliacionActual) return;
    var d = CONC.datosDeContrato(conciliacionActual);
    var puestos = [];
    if(d.tarifaDemurrage){ $("tarifaDemurrage").value = d.tarifaDemurrage; puestos.push("rate " + usd(d.tarifaDemurrage) + "/día"); }
    if(d.tonelaje){ $("tonelaje").value = d.tonelaje; puestos.push("tonelaje " + d.tonelaje.toLocaleString("es-CL") + " t"); }
    if(d.nor){
      $("nor").value = aInput(d.nor);
      $("baseInicio").value = "loPrimero";
      puestos.push("NOR " + fechaLarga(d.nor) + " con inicio por turn time");
    }
    calcular();
    avisos(puestos.length ? ["Se tomaron de la reportería: " + puestos.join(" · ") + "."] : [], "ok");
  });

  $("bl-temp-detalle").addEventListener("toggle", function(){
    if($("bl-temp-detalle").open && temporada) aplicarFiltro();
  });

  $("selector-recaladas").addEventListener("change", function(e){
    if(e.target.value) abrirRecalada(e.target.value);
  });
  $("btn-cargar").addEventListener("click", function(){ $("archivo").click(); });
  $("btn-cargar-nor").addEventListener("click", function(){ $("archivo-nor").click(); });

  /* Arrastrar sigue funcionando, pero sobre la página entera en vez de sobre
     dos recuadros dentro de un bloque plegado. El destino lo decide la
     extensión: .xlsx es el libro de la nave, .pdf es el NOR de la agencia.
     Un recuadro de «arrastra aquí» que duplica un botón que ya está arriba
     ocupa sitio para no enseñar nada. */
  (function(){
    var velo = $("velo-soltar");
    var dentro = 0;
    document.addEventListener("dragenter", function(e){
      if(!(e.dataTransfer && e.dataTransfer.types &&
           Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0)) return;
      dentro++; velo.hidden = false;
    });
    document.addEventListener("dragover", function(e){ e.preventDefault(); });
    document.addEventListener("dragleave", function(){
      /* dragleave salta también al pasar de un elemento a otro dentro de la
         página: sin contar entradas y salidas el velo parpadea al cruzar
         cada panel. */
      if(--dentro <= 0){ dentro = 0; velo.hidden = true; }
    });
    document.addEventListener("drop", function(e){
      e.preventDefault();
      dentro = 0; velo.hidden = true;
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(!f) return;
      if(/\.pdf$/i.test(f.name)) leerPdfNor(f);
      else if(/\.xlsx?$|\.xlsm$/i.test(f.name)) leerArchivo(f);
      else avisos(["«" + f.name + "» no es un libro CNN-EMB (.xlsx) ni un NOR (.pdf)."], "warn");
    });
  })();
  $("archivo").addEventListener("change", function(e){ leerArchivo(e.target.files[0]); });
  $("btn-imprimir").addEventListener("click", function(){ window.print(); });
  $("btn-presentar").addEventListener("click", function(){
    if(!$("nave").value && !$("codigo").value){
      avisos(["Carga un registro de tiempos antes de presentar."], "warn");
      enfocarRecalada();
      return;
    }
    calcular();
    PRES.abrir(contexto(ultimoTimeSheet), {G:G, L:L, LEC:LEC});
  });
  $("pres-cerrar").addEventListener("click", function(){ PRES.cerrar(); });
  $("pres-anterior").addEventListener("click", function(){ PRES.mostrar(-1 + indiceActual()); });
  $("pres-siguiente").addEventListener("click", function(){ PRES.mostrar(1 + indiceActual()); });
  $("pres-imprimir").addEventListener("click", function(){ window.print(); });
  function indiceActual(){
    var pastillas = document.querySelectorAll("#pres-pasos .paso");
    for(var i=0;i<pastillas.length;i++){ if(pastillas[i].classList.contains("on")) return i; }
    return 0;
  }
  /* Cada campo recalcula al editarlo.
     Sin esto, cambiar el demurrage rate no hacía nada visible hasta apretar
     "Calcular", y el valor ni siquiera se guardaba —guardar() vive dentro de
     calcular()—, así que al recargar volvía al anterior. Un dato que se
     escribe y no se ve reflejado se lee como que la app no lo tomó.
     `change` cubre el salir del campo y los desplegables; `input` con
     retardo cubre el escribir mirando la cifra, sin recalcular por tecla. */
  (function(){
    var pendiente = null;
    function recalcularConRetardo(){
      clearTimeout(pendiente);
      pendiente = setTimeout(calcular, 400);
    }
    CAMPOS.forEach(function(id){
      var el = $(id);
      if(!el || id.indexOf("rte") === 0) return;   // los rte* van aparte (ver rteCalado)
      el.addEventListener("change", function(){ clearTimeout(pendiente); calcular(); });
      if(el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.addEventListener("input", recalcularConRetardo);
    });
    $("aplicaDespatch").addEventListener("change", calcular);

    /* El calado es el único rte* que se edita: el bucle de arriba los salta
       a todos, así que va suelto. Antes de recalcular reescribe el tonelaje,
       o el laytime seguiría saliendo del pesómetro. */
    $("rteCalado").addEventListener("change", function(){
      clearTimeout(pendiente); aplicarCalado(); calcular();
    });
    $("rteCalado").addEventListener("input", function(){
      clearTimeout(pendiente);
      pendiente = setTimeout(function(){ aplicarCalado(); calcular(); }, 400);
    });
  })();

  $("btn-calcular").addEventListener("click", function(){ calcular(); });
  $("modoPermitido").addEventListener("change", function(){ alternarPermitido(); calcular(); });
  $("modoDespatch").addEventListener("change", function(){ alternarDespatch(); calcular(); });
  $("btn-corregir").addEventListener("click", function(){
    var editor = $("recalada-editor");
    editor.hidden = !editor.hidden;
    $("btn-corregir").textContent = editor.hidden ? "Corregir datos importados" : "Ocultar edición";
  });

  $("btn-editar-horas").addEventListener("click", function(){
    horasBloqueadas = !horasBloqueadas;
    $("btn-editar-horas").textContent = horasBloqueadas ? "Corregir horas" : "Bloquear horas";
    pintarDeducciones(leerDeducciones());
  });

  $("btn-agregar").addEventListener("click", function(){
    var lista = leerDeducciones();
    lista.push({nombre:"", lado:"otro", horas:0, descuenta:true});
    pintarDeducciones(lista);
  });
  $("btn-limpiar").addEventListener("click", function(){
    if(!confirm("Se borrarán todos los datos ingresados. ¿Continuar?")) return;
    try{ localStorage.removeItem(CLAVE); }catch(e){}
    location.reload();
  });

  $("btn-flota-varios").addEventListener("click", function(){ $("archivos").click(); });

  $("archivos").addEventListener("change", function(e){
    var archivos = Array.prototype.slice.call(e.target.files || []);
    if(!archivos.length) return;
    if(typeof XLSX === "undefined"){
      avisoFlota("No se cargó el lector de Excel: no se pueden leer los libros.", "error");
      return;
    }
    var listos = 0, fallidos = [], reparos = [], subidas = [], pendientes = archivos.length;

    archivos.forEach(function(archivo){
      var lector = new FileReader();
      lector.onload = function(ev){
        try{
          var libro = XLSX.read(new Uint8Array(ev.target.result), {type:"array", cellDates:true});
          var r = IMP.desdeLibro(libro);
          var deduc = r.datos.deducciones.map(function(x){
            return {nombre:x.nombre, lado:x.lado, horas:red2(x.horas),
                    descuenta:x.descuenta, mantenimiento:x.mantenimiento};
          });
          var registro = {campos: camposDesdeImportacion(r.datos), deducciones: deduc,
                          actualizadoEn: new Date().toISOString()};
          flota = FL.agregar(flota, registro);
          subidas.push(registro);
          listos++;
          // Los avisos de cada libro no se pierden en la carga masiva.
          if(r.sinValores){
            reparos.push(archivo.name + ": el libro se guardó sin recalcular, sus horas de detención llegaron vacías.");
          }else if(r.avisos.length){
            reparos.push(archivo.name + ": " + r.avisos.join(" "));
          }
        }catch(err){
          fallidos.push(archivo.name + ": " + err.message);
        }
        if(--pendientes === 0) terminar();
      };
      lector.onerror = function(){
        fallidos.push(archivo.name + ": no se pudo abrir");
        if(--pendientes === 0) terminar();
      };
      lector.readAsArrayBuffer(archivo);
    });

    function terminar(){
      FL.guardar(flota);
      refrescarSelector();
      renderFlota();
      // Lo cargado en lote también viaja a la nube: si no, queda solo aquí.
      if(NUBE.activa()){
        Promise.all(subidas.map(function(r){ return NUBE.guardar(r, L); })).then(pintarEstadoNube);
      }
      var html = listos + (listos === 1 ? " recalada agregada" : " recaladas agregadas") + ".";
      var problemas = fallidos.concat(reparos);
      if(problemas.length) html += "<ul><li>" + problemas.map(esc).join("</li><li>") + "</li></ul>";
      avisoFlota(html, problemas.length ? "warn" : "ok");
      e.target.value = "";      // permite volver a cargar los mismos archivos
    }
  });

  $("btn-clima-consultar").addEventListener("click", consultarClima);
  $("btn-clima-umbrales").addEventListener("click", function(){
    var c = $("clima-umbrales");
    c.hidden = !c.hidden;
    $("btn-clima-umbrales").textContent = c.hidden ? "Umbrales" : "Ocultar umbrales";
  });
  ["u-viento-aviso","u-viento-alerta","u-rafaga","u-ola-aviso","u-ola-alerta","u-vis"].forEach(function(id){
    $(id).addEventListener("change", function(){ leerUmbralesDelFormulario(); pintarUmbrales(); renderClima(); });
  });

  $("puerta-form").addEventListener("submit", function(e){ e.preventDefault(); entrar(); });
  $("btn-sin-conectar").addEventListener("click", function(){
    seguirSinConectar = true;
    pintarPuerta();
    pintarEstadoNube();
  });
  $("btn-salir").addEventListener("click", function(){
    if(!confirm("Se cierra la sesión. El historial de este navegador se conserva. ¿Continuar?")) return;
    SESION.cerrar(NUBE.config()).then(function(){
      seguirSinConectar = false;
      pintarPuerta();
      pintarEstadoNube();
    });
  });

  $("btn-nube-guardar").addEventListener("click", function(){
    /* Se revisa antes de guardar: una clave secreta pegada acá queda en el
       almacenamiento del navegador y viaja en cada petición del sitio
       publicado. Rechazarla después de guardarla llega tarde. */
    var problema = NUBE.revisarKey($("nube-key").value);
    if(problema){ avisoNube(esc(problema), "error"); return; }
    NUBE.configurar({url:$("nube-url").value, anonKey:$("nube-key").value, tabla:$("nube-tabla").value});
    pintarEstadoNube();
    if(!NUBE.activa()){ avisoNube("Faltan la URL o la anon key.", "warn"); return; }
    /* Con proyecto pero sin sesión no hay nada que probar: la tabla exige
       usuario autenticado y la prueba devolvería 401. Se abre la puerta. */
    if(!SESION.activa()){
      seguirSinConectar = false;
      pintarPuerta();
      avisoNube("Proyecto guardado. Entra con tu cuenta para sincronizar.", "info");
      return;
    }
    avisoNube("Conectando…", "info");
    NUBE.probar()
      .then(function(){ return sincronizar(true); })
      .then(function(){
        avisoNube("Conectado. El historial ahora se comparte con quien abra este sitio.", "ok");
        pintarEstadoNube();
      })
      .catch(function(err){ avisoNube("No se pudo conectar: " + esc(err.message), "error"); pintarEstadoNube(); });
  });

  $("btn-nube-probar").addEventListener("click", function(){
    var mal = NUBE.revisarKey($("nube-key").value);
    if(mal){ avisoNube(esc(mal), "error"); return; }
    NUBE.configurar({url:$("nube-url").value, anonKey:$("nube-key").value, tabla:$("nube-tabla").value});
    avisoNube("Probando…", "info");
    NUBE.probar()
      .then(function(){ avisoNube("La tabla responde y las credenciales sirven.", "ok"); pintarEstadoNube(); })
      .catch(function(err){ avisoNube(esc(err.message), "error"); pintarEstadoNube(); });
  });

  $("btn-nube-sincronizar").addEventListener("click", function(){
    if(!NUBE.activa()){ avisoNube("Primero conecta un proyecto.", "warn"); return; }
    if(!SESION.activa()){ seguirSinConectar = false; pintarPuerta(); return; }
    avisoNube("Sincronizando…", "info");
    sincronizar(false).then(bajarTemporadaCompartida).then(pintarEstadoNube);
  });

  $("btn-nube-copiar").addEventListener("click", function(){
    var t = $("nube-snippet");
    t.select();
    var ok = false;
    try{ ok = document.execCommand("copy"); }catch(e){ ok = false; }
    /* El portapapeles moderno no siempre está disponible —requiere contexto
       seguro— así que si falla se dice, en vez de dejar creer que copió. */
    if(!ok && navigator.clipboard){
      navigator.clipboard.writeText(t.value).then(function(){
        $("nube-copiado").textContent = "copiado";
      }, function(){ $("nube-copiado").textContent = "no se pudo copiar: selecciónalo a mano"; });
      return;
    }
    $("nube-copiado").textContent = ok ? "copiado" : "no se pudo copiar: selecciónalo a mano";
  });

  $("btn-nube-olvidar").addEventListener("click", function(){
    if(!confirm("Se desconecta la nube. El historial local se conserva. ¿Continuar?")) return;
    NUBE.olvidar();
    SESION.olvidar();
    seguirSinConectar = false;
    pintarPuerta();
    cargarConfigNube();
    avisoNube("Desconectado. El historial vuelve a ser solo de este equipo.", "info");
  });

  $("archivo-nor").addEventListener("change", function(e){ leerPdfNor(e.target.files[0]); e.target.value = ""; });

  Array.prototype.forEach.call(document.querySelectorAll("#bl-datos .subtab"), function(t){
    t.addEventListener("click", function(){ verSubpanel(t.dataset.panel); });
  });

  $("filtro-trimestre").addEventListener("change", function(e){
    filtroTemporada.trimestre = e.target.value; aplicarFiltro();
  });
  $("filtro-mes").addEventListener("change", function(e){
    filtroTemporada.mes = e.target.value; aplicarFiltro();
  });
  $("btn-filtro-limpiar").addEventListener("click", function(){
    filtroTemporada = {trimestre:"", mes:""};
    pintarFiltros(); aplicarFiltro();
  });

  ["expo-tasa","expo-rate","expo-desc"].forEach(function(id){
    $(id).addEventListener("change", function(){ if(temporada) renderExposicion(); });
  });

  (function(){
    var zona = $("soltar-rep");
    if(!zona) return;
    zona.addEventListener("click", function(){ $("archivo-rep").click(); });
    $("archivo-rep").addEventListener("change", function(e){
      leerLibroReporteria(e.target.files[0]); e.target.value = "";
    });
    ["dragenter","dragover"].forEach(function(ev){
      zona.addEventListener(ev, function(e){ e.preventDefault(); zona.classList.add("sobre"); });
    });
    ["dragleave","drop"].forEach(function(ev){
      zona.addEventListener(ev, function(e){ e.preventDefault(); zona.classList.remove("sobre"); });
    });
    zona.addEventListener("drop", function(e){
      if(e.dataTransfer.files.length) leerLibroReporteria(e.dataTransfer.files[0]);
    });
  })();

  document.addEventListener("keydown", function(e){
    if(e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON"){
      e.preventDefault(); calcular();
    }
  });

  // Los gráficos se dibujan al ancho real del panel, así que hay que
  // redibujarlos cuando cambia el tamaño de la ventana.
  var temporizador = null;
  window.addEventListener("resize", function(){
    clearTimeout(temporizador);
    temporizador = setTimeout(function(){
      if(!$("vista-operacion").hidden) calcular();
      /* Las chispas se dibujan al ancho medido de su ficha, así que al
         cambiar el tamaño de la ventana hay que rehacerlas: un SVG de ancho
         fijo dentro de una ficha más angosta queda recortado. */
      if(!$("vista-operacion").hidden && temporada) renderTemporada();
      if(!$("vista-clima").hidden) renderClima();
    }, 180);
  });

  /* ─────────────────── eventos de la bitácora ──────────────────── */

  $("bit-mes-antes").addEventListener("click", function(){
    bitMes = new Date(bitMes.getFullYear(), bitMes.getMonth() - 1, 1); renderCalendario();
  });
  $("bit-mes-despues").addEventListener("click", function(){
    bitMes = new Date(bitMes.getFullYear(), bitMes.getMonth() + 1, 1); renderCalendario();
  });
  $("bit-hoy").addEventListener("click", function(){
    bitMes = new Date(); renderCalendario();
  });
  $("bit-guardar").addEventListener("click", bitGuardar);
  $("bit-borrar").addEventListener("click", bitBorrar);
  $("bit-limpiar").addEventListener("click", function(){ bitNuevo(); });

  /* Clic y arrastre sobre el calendario: marcar «ayer y hoy» es un gesto,
     no dos campos de fecha. Se escucha en el contenedor y no en cada día
     porque la rejilla se vuelve a dibujar entera en cada cambio y volver a
     enganchar cuarenta y dos botones cada vez es trabajo por nada. */
  (function(){
    var cal = $("bit-calendario"), arrastrando = false, ancla = null;

    function isoDe(ev){
      var b = ev.target.closest(".cal-dia");
      return b ? b.dataset.iso : null;
    }
    function pintarSeleccion(){
      cal.querySelectorAll(".cal-dia").forEach(function(b){
        var dentro = bitArrastre && b.dataset.iso >= bitArrastre.desde && b.dataset.iso <= bitArrastre.hasta;
        b.classList.toggle("sel", !!dentro);
      });
    }

    cal.addEventListener("mousedown", function(ev){
      var iso = isoDe(ev);
      if(!iso) return;
      ev.preventDefault();                 // sin esto el arrastre selecciona texto
      arrastrando = true; ancla = iso;
      bitArrastre = {desde: iso, hasta: iso};
      pintarSeleccion();
    });
    cal.addEventListener("mouseover", function(ev){
      if(!arrastrando) return;
      var iso = isoDe(ev);
      if(!iso) return;
      bitArrastre = iso < ancla ? {desde: iso, hasta: ancla} : {desde: ancla, hasta: iso};
      pintarSeleccion();
    });
    /* El soltar se escucha en el documento: si el puntero sale del
       calendario mientras se arrastra, el gesto igual termina y no queda la
       rejilla pegada en modo selección. */
    document.addEventListener("mouseup", function(){
      if(!arrastrando) return;
      arrastrando = false;
      var sel = bitArrastre;
      bitArrastre = null;
      pintarSeleccion();
      if(!sel) return;
      /* Un clic simple abre el evento del día; un arrastre de varios días
         siempre empieza uno nuevo, porque lo que se está diciendo es «este
         rango», no «edítame el del martes». */
      if(sel.desde === sel.hasta) bitClicDia(sel.desde);
      else bitNuevo(sel.desde, sel.hasta);
    });

    /* Teclado: la rejilla son botones, así que Enter y espacio llegan como
       clic y el arrastre no hace falta para registrar un día suelto. */
    cal.addEventListener("click", function(ev){
      if(arrastrando) return;
      var iso = isoDe(ev);
      if(iso && ev.detail === 0) bitClicDia(iso);
    });
  })();

  $("tb-bitacora").addEventListener("click", function(ev){
    if(!ev.target.classList.contains("bit-abrir")) return;
    var fila = ev.target.closest("tr");
    var elEv = bitacora.filter(function(x){ return x.id === fila.dataset.id; })[0];
    if(!elEv) return;
    bitAbrir(elEv);
    var d = BIT.deIso(elEv.desde);
    if(d){ bitMes = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendario(); }
  });

  /* ────────────────────────── arranque ─────────────────────────── */

  // Iconos y escena de puerto: se inyectan una vez, antes de pintar nada.
  document.getElementById("sprite-iconos").innerHTML = window.Escena.sprite();
  document.getElementById("escena-puerto").innerHTML = window.Escena.ESCENA;

  /* Silueta de fondo de cada banda: la flota para la temporada, el sitio de
     atraque para la recalada, mar y viento para el clima. Va por atributo
     en el HTML —`data-franja`— y no por id, para que agregar una banda sea
     escribir su tema y no tocar esta lista. */
  document.querySelectorAll("[data-franja]").forEach(function(nodo){
    if(nodo.querySelector(".banda-franja")) return;
    /* Después del rótulo, no al principio: la silueta es el relleno entre el
       título y los controles, y de primera empujaría el título a la derecha. */
    var marca = window.Escena.franja(nodo.dataset.franja);
    if(!marca) return;
    if(nodo.firstElementChild) nodo.firstElementChild.insertAdjacentHTML("afterend", marca);
    else nodo.insertAdjacentHTML("afterbegin", marca);
  });

  /* Marca de agua de cada panel: el mismo icono de su título, en grande y
     al borde del papel. Se inyecta acá y no en el HTML porque el icono ya
     está declarado una vez —en el título— y repetirlo a mano en quince
     paneles es quince ocasiones de que uno quede con el que no es. */
  document.querySelectorAll(".panel").forEach(function(panel){
    if(panel.querySelector(":scope > .panel-fondo")) return;
    /* Un motivo por segmento: si la cabecera de este panel ya lleva escena,
       la marca de agua sobra. No se apaga con `:has` en la hoja porque un
       navegador sin `:has` tira la regla entera y deja los dos motivos
       superpuestos, que es justo lo que se quiere evitar. */
    if(panel.querySelector(":scope > .panel-hd[data-franja]")) return;
    var uso = panel.querySelector(".panel-hd .panel-title use");
    if(!uso) return;
    panel.insertAdjacentHTML("afterbegin",
      '<svg class="panel-fondo" aria-hidden="true"><use href="' +
      uso.getAttribute("href") + '"></use></svg>');
  });
  if(typeof pdfjsLib !== "undefined"){
    pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
  }

  PRES.iniciar();
  pintarUmbrales();
  bitacora = bitCargar();
  turnos = turnosCargar();
  pintarOrigenLibros();
  $("bit-causas").innerHTML = BIT.CAUSAS.map(function(c){
    return '<option value="' + esc(c) + '"></option>';
  }).join("");
  bitNuevo();
  renderBitacora();
  /* Windy abre directo en el terminal, con la capa de oleaje puesta: que
     abra en el mapa del mundo y haya que buscar Caldera a mano es la clase
     de fricción que hace que el enlace no se use. El marcador lleva las
     coordenadas del puerto, no las del punto de mar donde se pide la
     marejada: quien abre Windy quiere mirar el muelle. */
  $("enlace-windy").href = "https://www.windy.com/" +
    CLIMA.PUERTO.lat + "/" + CLIMA.PUERTO.lon +
    "?waves," + CLIMA.PUERTO.lat + "," + CLIMA.PUERTO.lon + ",10,m:eyEagdJ";
  NUBE.alCambiar(pintarEstadoNube);
  flota = FL.cargar();
  refrescarSelector();
  cargarConfigNube();
  SESION.alCambiar(pintarEstadoNube);
  pintarPuerta();
  /* Se sincroniza solo con sesión: con proyecto configurado y sin entrar, la
     puerta está arriba y no hay token que mandar. */
  function relevo(){
    if(!NUBE.lista()) return;
    sincronizar(true);
    bajarTemporadaCompartida();
    /* La bitácora entra al mismo relevo: el cierre por paro lo anota quien
       esté en el terminal y los otros dos tienen que verlo sin recargar. */
    bitSincronizar();
    /* Y las planillas de turno: quien recibe la del fin de mes la carga una
       vez y el resto ve el tonelaje sin repetir el Excel. */
    turnosSincronizar();
  }
  if(NUBE.lista()) relevo();
  // Relevo periódico: otra persona puede estar cargando embarques ahora.
  if(NUBE.lista() || NUBE.activa()) setInterval(relevo, 60000);
  if(restaurarTemporada()) { /* se dibuja al abrir la pestaña */ }
  var habia = restaurar();
  alternarPermitido();
  alternarDespatch();
  if(habia){
    calcular();
    plegarRecaladaSegunEstado();
  }else{
    renderCabecera();
    renderResumenRecalada();
    renderProductividad();
    renderComposicion(leerDeducciones());
    renderCausas(leerDeducciones());
    renderMuellaje();
    renderIndices(leerDeducciones());
    renderVacioTimeSheet();
    enfocarRecalada();
  }
})();
