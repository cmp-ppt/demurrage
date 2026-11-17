/**
 * Consolidado de la temporada por trimestre y lectura de lo que dice.
 *
 * El libro de reportería tiene el dato pero no la conclusión. Lo que estas
 * funciones arman es la comparación que el libro no hace explícita:
 *
 *   la operación de carga cabe dentro del laytime permitido, casi siempre;
 *   lo que genera el demurrage es la espera ANTES del amarre.
 *
 * Esa distinción cambia a quién le corresponde actuar: si el problema fuera la
 * tasa de embarque, es del terminal; si es la espera en rada, es de
 * programación de naves y de congestión de muelle, que se gestionan en otra
 * parte y con otra gente.
 *
 * Sin dependencias del DOM: se usa desde el navegador y desde Node.
 */
(function(global){
  "use strict";

  var ORDEN = ["Q1", "Q2", "Q3", "Q4"];

  function porTrimestreOrden(a, b){
    return ORDEN.indexOf(a) - ORDEN.indexOf(b);
  }

  function normalizar(t){
    return String(t == null ? "" : t)
      .normalize("NFD").replace(/[̀-ͯ]/g,"")
      .toLowerCase().replace(/\s+/g," ").trim();
  }

  function suma(lista, f){
    return lista.reduce(function(acc, x){ return acc + (Number(f(x)) || 0); }, 0);
  }

  /**
   * Cualquier cosa que represente un instante -> Date, o null.
   *
   * Los datos llegan de dos lados: del libro recién leído, donde son Date, y
   * de localStorage, donde JSON los devolvió como texto ISO. Normalizar acá
   * evita que el módulo dependa de por dónde entró el dato: sin esto,
   * `esProyectada` reventaba con "getHours is not a function" al recuperar una
   * temporada guardada.
   */
  function aFecha(v){
    if(!v) return null;
    if(v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Días entre dos instantes, o null si falta alguno. */
  function diasEntre(a, b){
    a = aFecha(a); b = aFecha(b);
    if(!a || !b) return null;
    return (b.getTime() - a.getTime()) / 86400000;
  }

  /**
   * ¿La nave llegó dentro de su ventana de laycan?
   *   "antes"  -> el ETA precede al inicio del laycan (espera por contrato)
   *   "dentro" -> llegó en ventana
   *   "tarde"  -> llegó pasado el fin del laycan (el fletador puede cancelar)
   */
  function estadoLaycan(r){
    if(!r) return null;
    var eta = aFecha(r.eta), desde = aFecha(r.laycanDesde), hasta = aFecha(r.laycanHasta);
    if(!eta || !desde || !hasta) return null;
    if(eta < desde) return "antes";
    if(eta > hasta) return "tarde";
    return "dentro";
  }

  var MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

  /**
   * Mes al que pertenece una recalada: el del término de carguío.
   *
   * Es la fecha del conocimiento de embarque, que es como se cuenta un
   * embarque en el negocio. El amarre y el NOR pueden caer en el mes anterior
   * —la MINERAL SAO TOME dio NOR el 24 de julio y terminó el 17 de agosto— y
   * contarla por el NOR la pondría en un mes en el que no se embarcó nada.
   */
  function mesDe(r){
    var d = aFecha(r && (r.finCarga || r.atb || r.nor || r.eta));
    return d ? d.getMonth() : null;
  }

  /**
   * Recorta la temporada a un trimestre y/o un mes.
   *
   * Filtra por recalada y arrastra lo que cuelga de ella: los tiempos y las
   * detenciones se cruzan por nave, no por su propia fecha. Una detención
   * anotada el 2 de agosto pertenece a la recalada que estaba en el muelle,
   * y esa recalada puede ser de julio; filtrar las detenciones por su fecha
   * las separaría de la nave que las causó.
   */
  function filtrar(datos, filtro){
    datos = datos || {};
    filtro = filtro || {};
    var q = filtro.trimestre || "";
    var mes = (filtro.mes === "" || filtro.mes == null) ? null : Number(filtro.mes);

    if(!q && mes === null) return datos;

    var recaladas = (datos.recaladas || []).filter(function(r){
      if(q && r.trimestre !== q) return false;
      if(mes !== null && mesDe(r) !== mes) return false;
      return true;
    });

    var clave = {};
    recaladas.forEach(function(r){ clave[r.trimestre + "|" + normalizar(r.nave)] = true; });
    var quedan = function(x){ return !!clave[x.trimestre + "|" + normalizar(x.nave)]; };

    return {
      recaladas: recaladas,
      tiempos: (datos.tiempos || []).filter(quedan),
      detenciones: (datos.detenciones || []).filter(quedan),
      // El clima viene agregado por trimestre en el libro, sin nave: se recorta
      // por trimestre cuando hay, y con filtro de mes se omite porque no se
      // puede repartir un total trimestral entre sus meses sin inventarlo.
      clima: mes !== null ? [] : (datos.clima || []).filter(function(c){ return !q || c.trimestre === q; }),
      plan: (datos.plan || []).filter(function(p){
        if(q && p.trimestre !== q) return false;
        if(mes !== null){
          var d = aFecha(p.etd || p.etb || p.laycanDesde);
          if(!d || d.getMonth() !== mes) return false;
        }
        return true;
      })
    };
  }

  /** Meses presentes en los datos, en orden, para armar el desplegable. */
  function mesesDisponibles(datos){
    var vistos = {};
    ((datos && datos.recaladas) || []).forEach(function(r){
      var m = mesDe(r);
      if(m !== null) vistos[m] = true;
    });
    return Object.keys(vistos).map(Number).sort(function(a, b){ return a - b; })
      .map(function(m){ return {mes: m, nombre: MESES[m]}; });
  }

  /** Agrupa una lista por trimestre, sumando un campo. */
  function agruparPorTrimestre(lista, campo){
    var m = {};
    (lista || []).forEach(function(x){
      if(!x || !x.trimestre) return;
      m[x.trimestre] = (m[x.trimestre] || 0) + (Number(x[campo]) || 0);
    });
    return m;
  }

  /** Detenciones sumadas por categoría, de mayor a menor. */
  function categorias(detenciones){
    var m = {};
    (detenciones || []).forEach(function(d){
      var k = String(d.categoria || "").trim();
      if(!k) return;
      if(!m[k]) m[k] = {categoria: k, dias: 0, costo: 0, eventos: 0};
      m[k].dias += Number(d.dias) || 0;
      m[k].costo += Number(d.costo) || 0;
      m[k].eventos++;
    });
    return Object.keys(m).map(function(k){ return m[k]; })
      .sort(function(a, b){ return b.dias - a.dias; });
  }

  /**
   * Un objeto por trimestre con todo lo que el tablero necesita.
   *
   * `tiempos` se cruza por nombre de nave. Es lo único que hay para unir las
   * dos hojas —no existe un código de recalada en el libro comercial—, así que
   * una nave que se repite en la temporada (PIGI, NISEKO QUEEN y MINERAL
   * BOTSWANA aparecen dos veces) se desempata por trimestre.
   */
  function porTrimestre(datos, hoy){
    datos = datos || {};
    hoy = hoy || new Date();
    var recaladas = datos.recaladas || [];
    var tiempos = datos.tiempos || [];
    var detenciones = datos.detenciones || [];
    var clima = datos.clima || [];

    var indiceTiempos = {};
    tiempos.forEach(function(t){
      indiceTiempos[t.trimestre + "|" + normalizar(t.nave)] = t;
    });

    var pres = {};
    recaladas.forEach(function(r){
      if(!pres[r.trimestre]) pres[r.trimestre] = [];
      pres[r.trimestre].push(r);
    });

    return Object.keys(pres).sort(porTrimestreOrden).map(function(q){
      var lista = pres[q];
      var conTiempos = lista.map(function(r){
        return indiceTiempos[q + "|" + normalizar(r.nave)] || null;
      }).filter(Boolean);

      /* Lo cobrado y lo estimado se suman por separado: el total de la
         temporada va a una presentación, y mezclarlos infla la cifra. */
      lista.forEach(function(r){ r.proyectada = esProyectada(r, hoy); });
      var liquidadas = lista.filter(function(r){ return !r.proyectada; });
      var proyectadas = lista.filter(function(r){ return r.proyectada; });

      var demurrage = suma(lista, function(r){ return r.demurrage; });
      // El despatch viene negativo en el libro: se guarda como magnitud y el
      // neto lo resta, para que nadie tenga que adivinar el signo al leerlo.
      var despatch = Math.abs(suma(lista, function(r){ return r.despatch; }));
      var cargo = suma(lista, function(r){ return r.cargo; });

      var esperaDem = [], esperaSin = [];
      lista.forEach(function(r){
        var d = diasEntre(r.nor, r.atb);
        if(d == null) return;
        (r.demurrage > 0 ? esperaDem : esperaSin).push(d);
      });
      function promedio(v){ return v.length ? v.reduce(function(a,b){ return a+b; }, 0) / v.length : null; }

      var laycan = {antes: 0, dentro: 0, tarde: 0};
      lista.forEach(function(r){
        var e = estadoLaycan(r);
        if(e) laycan[e]++;
      });

      var dets = detenciones.filter(function(d){ return d.trimestre === q; });
      var operacion = suma(conTiempos, function(t){ return t.operacionCarga; });
      var allowed = suma(conTiempos, function(t){ return t.timeAllowed; });

      return {
        trimestre: q,
        naves: lista.length,
        enDemurrage: lista.filter(function(r){ return r.demurrage > 0; }).length,
        enDespatch: lista.filter(function(r){ return r.despatch !== 0; }).length,
        demurrage: demurrage,
        despatch: despatch,
        neto: demurrage - despatch,

        liquidadas: liquidadas.length,
        proyectadas: proyectadas.length,
        /* De las no liquidadas, cuántas son cálculo propio y no filas del
           libro: no es lo mismo una proyección del plan que un embarque ya
           cerrado que el libro aún no trae. */
        provisorias: lista.filter(function(r){ return !!r.provisoria; }).length,
        demurrageLiquidado: suma(liquidadas, function(r){ return r.demurrage; }),
        demurrageProyectado: suma(proyectadas, function(r){ return r.demurrage; }),
        /* El neto de lo no liquidado, con el despatch restado igual que en
           `netoLiquidado`. El demurrage solo alcanzaba mientras lo no
           liquidado eran proyecciones del plan, que nunca traen despatch;
           una recalada provisoria sí puede traerlo, y entonces «aporta
           US$ 0» sería falso: aporta a favor. */
        netoProyectado: suma(proyectadas, function(r){ return r.demurrage; }) -
                        Math.abs(suma(proyectadas, function(r){ return r.despatch; })),
        despatchLiquidado: Math.abs(suma(liquidadas, function(r){ return r.despatch; })),
        netoLiquidado: suma(liquidadas, function(r){ return r.demurrage; }) -
                       Math.abs(suma(liquidadas, function(r){ return r.despatch; })),
        cargo: cargo,
        usdPorTonelada: cargo > 0 ? (demurrage - despatch) / cargo : 0,

        espera: suma(conTiempos, function(t){ return t.esperaAmarre; }),
        operacion: operacion,
        allowed: allowed,
        // Naves cuya carga cupo dentro del laytime permitido: si son casi
        // todas, el problema no está en el muelle.
        dentroDelAllowed: conTiempos.filter(function(t){ return t.operacionCarga <= t.timeAllowed; }).length,
        conTiempos: conTiempos.length,
        usoDelAllowed: allowed > 0 ? operacion / allowed * 100 : 0,

        esperaConDemurrage: promedio(esperaDem),
        esperaSinDemurrage: promedio(esperaSin),
        laycan: laycan,

        detenciones: categorias(dets),
        diasDetenidos: suma(dets, function(d){ return d.dias; }),
        costoDetenciones: suma(dets, function(d){ return d.costo; }),
        clima: clima.filter(function(c){ return c.trimestre === q; })
                    .sort(function(a,b){ return b.dias - a.dias; }),
        diasClima: suma(clima.filter(function(c){ return c.trimestre === q; }), function(c){ return c.dias; }),
        recaladas: lista
      };
    });
  }

  /**
   * El camino hacia el total: un punto por trimestre con la temporada
   * sumada hasta ahí. Es lo que dibujan las chispas de la tira de fichas.
   *
   * Acumula los campos crudos y deriva las razones al final de cada paso.
   * Al revés —promediando el US$/t de cada trimestre— da otro número, y
   * entonces la chispa termina en un valor distinto al de la ficha que
   * tiene encima. El último punto de esta serie vale, campo por campo, lo
   * mismo que total(): hay una prueba que lo exige.
   */
  function acumulado(trimestres){
    var acc = {demurrage:0, despatch:0, cargo:0, naves:0, espera:0,
               operacion:0, allowed:0, netoLiquidado:0};
    return (trimestres || []).map(function(q){
      Object.keys(acc).forEach(function(k){ acc[k] += Number(q[k]) || 0; });
      return {
        trimestre: q.trimestre,
        demurrage: acc.demurrage, despatch: acc.despatch, cargo: acc.cargo,
        naves: acc.naves, espera: acc.espera,
        operacion: acc.operacion, allowed: acc.allowed,
        netoLiquidado: acc.netoLiquidado,
        neto: acc.demurrage - acc.despatch,
        usdPorTonelada: acc.cargo > 0 ? (acc.demurrage - acc.despatch) / acc.cargo : 0,
        usoDelAllowed: acc.allowed > 0 ? acc.operacion / acc.allowed * 100 : 0
      };
    });
  }

  /** Totales de la temporada, sobre los trimestres ya agregados. */
  function total(trimestres){
    trimestres = trimestres || [];
    var cargo = suma(trimestres, function(t){ return t.cargo; });
    var demurrage = suma(trimestres, function(t){ return t.demurrage; });
    var despatch = suma(trimestres, function(t){ return t.despatch; });
    var allowed = suma(trimestres, function(t){ return t.allowed; });
    var operacion = suma(trimestres, function(t){ return t.operacion; });
    return {
      trimestres: trimestres.length,
      naves: suma(trimestres, function(t){ return t.naves; }),
      enDemurrage: suma(trimestres, function(t){ return t.enDemurrage; }),
      demurrage: demurrage,
      despatch: despatch,
      neto: demurrage - despatch,
      liquidadas: suma(trimestres, function(t){ return t.liquidadas; }),
      proyectadas: suma(trimestres, function(t){ return t.proyectadas; }),
      provisorias: suma(trimestres, function(t){ return t.provisorias; }),
      netoProyectado: suma(trimestres, function(t){ return t.netoProyectado; }),
      demurrageLiquidado: suma(trimestres, function(t){ return t.demurrageLiquidado; }),
      demurrageProyectado: suma(trimestres, function(t){ return t.demurrageProyectado; }),
      netoLiquidado: suma(trimestres, function(t){ return t.netoLiquidado; }),
      cargo: cargo,
      usdPorTonelada: cargo > 0 ? (demurrage - despatch) / cargo : 0,
      espera: suma(trimestres, function(t){ return t.espera; }),
      operacion: operacion,
      allowed: allowed,
      usoDelAllowed: allowed > 0 ? operacion / allowed * 100 : 0,
      dentroDelAllowed: suma(trimestres, function(t){ return t.dentroDelAllowed; }),
      conTiempos: suma(trimestres, function(t){ return t.conTiempos; }),
      diasDetenidos: suma(trimestres, function(t){ return t.diasDetenidos; }),
      diasClima: suma(trimestres, function(t){ return t.diasClima; })
    };
  }

  /**
   * La conclusión en prosa: qué dicen estos números juntos.
   *
   * Se escribe acá y no en el render porque es una afirmación sobre los datos,
   * y como tal tiene que poder probarse sin abrir un navegador.
   */
  function diagnostico(trimestres){
    var t = total(trimestres);
    var frases = [];

    if(t.allowed > 0){
      frases.push("La operación de carga usó " + redondear(t.operacion, 1) + " de los " +
        redondear(t.allowed, 1) + " días permitidos (" + redondear(t.usoDelAllowed, 0) + " %): " +
        t.dentroDelAllowed + " de " + t.conTiempos + " naves cargaron dentro del laytime.");
    }
    if(t.operacion > 0 && t.espera > 0){
      frases.push("La espera previa al amarre sumó " + redondear(t.espera, 1) + " días, " +
        redondear(t.espera / t.operacion, 1) + " veces el tiempo de carga. Ahí está el demurrage, no en el muelle.");
    }

    var conDem = [], sinDem = [];
    trimestres.forEach(function(q){
      if(q.esperaConDemurrage != null) conDem.push(q.esperaConDemurrage);
      if(q.esperaSinDemurrage != null) sinDem.push(q.esperaSinDemurrage);
    });
    function prom(v){ return v.length ? v.reduce(function(a,b){ return a+b; },0)/v.length : null; }
    var pc = prom(conDem), ps = prom(sinDem);
    if(pc != null && ps != null){
      frases.push("Las naves que pagaron demurrage esperaron " + redondear(pc, 1) +
        " días entre el NOR y el amarre; las que no, " + redondear(ps, 1) + ".");
    }

    if(t.proyectadas > 0){
      /* «Proyección» y «provisoria» no son lo mismo y la frase tiene que
         distinguirlas: una proyección es una fila del plan que el libro
         todavía no cerró; una provisoria es un embarque ya cargado que el
         libro no trae y que calculó esta app. Las dos comparten lo único
         que decide esta frase —no están liquidadas— pero quien la lee en
         una reunión necesita saber de cuál está hablando. */
      var prov = t.provisorias || 0;
      var sueltas = t.proyectadas - prov;
      var que = [];
      if(sueltas > 0) que.push(sueltas + (sueltas === 1 ? " es proyección del plan" : " son proyección del plan"));
      if(prov > 0) que.push(prov + (prov === 1 ? " es provisoria (cálculo propio)" : " son provisorias (cálculo propio)"));
      frases.push(t.proyectadas + (t.proyectadas === 1 ? " recalada no está liquidada" : " recaladas no están liquidadas") +
        " —" + que.join(" y ") + "— y aportan " + moneda(t.netoProyectado) +
        " al total: lo liquidado son " + moneda(t.netoLiquidado) + ".");
    }

    var peor = null;
    trimestres.forEach(function(q){ if(!peor || q.neto > peor.neto) peor = q; });
    if(peor && trimestres.length > 1){
      var resto = trimestres.filter(function(q){ return q !== peor; });
      var promResto = resto.length ? suma(resto, function(q){ return q.neto; }) / resto.length : 0;
      if(promResto > 0){
        frases.push(peor.trimestre + " concentra " + moneda(peor.neto) + ", " +
          redondear(peor.neto / promResto, 1) + " veces el promedio de los demás trimestres.");
      }
    }

    return {
      total: t,
      peorTrimestre: peor,
      esperaConDemurrage: pc,
      esperaSinDemurrage: ps,
      frases: frases
    };
  }

  /* ═══════════════ 1. LIQUIDADO CONTRA PROYECTADO ═══════════════ */

  /**
   * ¿Esta fila es un hecho o una proyección?
   *
   * Importa porque el total de la temporada se presenta a gerencia, y mezclar
   * lo cobrado con lo estimado infla la cifra sin que se note. En la temporada
   * 2026 las cuatro últimas filas de Q3 son proyección y una sola de ellas
   * —NISEKO QUEEN, US$ 1,55 M— es el 37 % del trimestre.
   *
   * Dos señales:
   *   · el carguío todavía no termina — eso basta por sí solo;
   *   · amarre e inicio de carguío exactos a las 00:00 Y tonelaje múltiplo
   *     redondo de mil.
   *
   * Las horas redondas solas no alcanzan: SHANDONG RENAISSANCE las tiene y es
   * una recalada real, liquidada, con 207.295 t y un demurrage con decimales.
   * Lo que la separa de una proyección es el tonelaje: las planificadas llevan
   * la cifra del plan de embarque —198.000, 206.000— y las reales, lo que
   * marcó el pesómetro.
   */
  function esProyectada(r, hoy){
    if(!r) return false;
    /* Una recalada provisoria no viene del libro: la calculó esta app porque
       el área comercial todavía no la incorporó. No hace falta olfatearla
       —viene marcada— y lo que importa acá es que NO está liquidada, que es
       justo lo que separa esta lista de la otra. Sin esto, la ficha de
       «Liquidado» sumaría una cifra que nadie acordó con el armador y diría
       que está cobrada. */
    if(r.provisoria) return true;
    hoy = aFecha(hoy) || new Date();
    var fin = aFecha(r.finCarga);
    if(fin && fin > hoy) return true;
    var redonda = function(v){
      var d = aFecha(v);
      return !!d && d.getHours() === 0 && d.getMinutes() === 0;
    };
    var tonelajeDePlan = r.cargo > 0 && r.cargo % 1000 === 0;
    return redonda(r.atb) && redonda(r.inicioCarga) && tonelajeDePlan;
  }

  /* ═══════════════ 2. ATRIBUCIÓN DE LA ESPERA ═══════════════════ */

  /* Las reglas van de lo específico a lo general: "terminal occupied by MV X
     (CASERONES)" es congestión de Caserones antes que muelle ocupado a secas,
     y esa diferencia decide con quién se negocia. */
  var REGLAS = [
    {causa:"Congestión Caserones", re:/caserones/},
    {causa:"Muelle ocupado",       re:/occupied|ocupado|congestion|congestión|waiting|drifting|anchorage|fondeadero/},
    {causa:"Clima",                re:/weather|swell|wind|viento|marejada|humedad|humidity|clima|mal tiempo/},
    {causa:"Terminal",             re:/maintenance|mantenimiento|molienda|belt|correa|mooring lines parted|amarras/}
  ];
  var SIN_ATRIBUIR = "Sin atribuir";

  function normalizarTexto(t){
    return String(t == null ? "" : t)
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().replace(/\s+/g," ").trim();
  }

  /** Todas las causas que menciona un comentario, en orden de especificidad. */
  function causasEspera(comentario){
    var t = normalizarTexto(comentario);
    if(!t) return [];
    return REGLAS.filter(function(r){ return r.re.test(t); })
                 .map(function(r){ return r.causa; });
  }

  /**
   * Una sola causa por recalada, para poder repartir el monto sin contarlo dos
   * veces. Un comentario que nombra tres cosas se atribuye a la primera de la
   * lista: es la que bloqueó el amarre, las demás vinieron después.
   */
  function causaPrincipal(comentario){
    var c = causasEspera(comentario);
    return c.length ? c[0] : SIN_ATRIBUIR;
  }

  /**
   * Reparte el demurrage por causa. "Sin atribuir" es una categoría de pleno
   * derecho y suele ser la mayor: en 2026 las recaladas más caras no tienen
   * comentario. Esconderla daría una foto falsa de lo que está explicado.
   */
  function atribucion(trimestres){
    var m = {};
    (trimestres || []).forEach(function(q){
      (q.recaladas || []).forEach(function(r){
        if(!(r.demurrage > 0)) return;
        var causa = causaPrincipal(r.comentario);
        if(!m[causa]) m[causa] = {causa: causa, monto: 0, naves: 0};
        m[causa].monto += r.demurrage;
        m[causa].naves++;
      });
    });
    return Object.keys(m).map(function(k){ return m[k]; })
      .sort(function(a, b){
        // "Sin atribuir" va al final aunque sea el mayor: es el pendiente, no
        // un hallazgo, y encabezar la lista con él confunde la lectura.
        if(a.causa === SIN_ATRIBUIR) return 1;
        if(b.causa === SIN_ATRIBUIR) return -1;
        return b.monto - a.monto;
      });
  }

  /* ═══════════════ 3. EXPOSICIÓN DEL PLAN ══════════════════════ */

  /**
   * Lo que costaría una recalada planificada si el plan se cumple tal cual.
   *
   * El libro liquida con `demurrage = (net time used − allowed) × rate`, y eso
   * reproduce sus cifras con menos de 0,5 % de error. Hacia adelante el net
   * time used no existe todavía, así que se arma:
   *
   *   inicio   = el más tardío entre ETA y el inicio del laycan
   *              (el NOR no vale antes de que abra la ventana)
   *   bruto    = ETD − inicio
   *   contado  = bruto − descuento típico
   *   allowed  = tonelaje / tasa de embarque
   *   exposición = máx(0, contado − allowed) × rate
   *
   * Contrastado contra la temporada 2026: la mediana del error es 11 % y el
   * total queda 20 % por encima de lo real, porque el modelo no sabe cuántos
   * días de clima se descontaron en cada recalada. Es una exposición, no un
   * pronóstico: dice cuánto hay en juego si el plan se cumple, no lo que se va
   * a pagar.
   */
  function exposicionPlan(plan, sup){
    sup = sup || {};
    var tasaEmbarque = Number(sup.tasaEmbarque) || 30000;
    var rate = Number(sup.rate) || 0;
    var descuento = sup.descuento == null ? 1.13 : Number(sup.descuento);

    return (plan || []).map(function(p){
      var laycanDesde = aFecha(p.laycanDesde), laycanHasta = aFecha(p.laycanHasta);
      var eta = aFecha(p.eta), etb = aFecha(p.etb), etd = aFecha(p.etd);
      var inicio = eta || laycanDesde;
      if(inicio && laycanDesde && laycanDesde > inicio) inicio = laycanDesde;
      var bruto = diasEntre(inicio, etd);
      var allowed = p.tonelaje > 0 ? p.tonelaje / tasaEmbarque : null;
      var contado = bruto == null ? null : Math.max(0, bruto - descuento);
      var balance = (contado == null || allowed == null) ? null : allowed - contado;
      var monto = (balance != null && balance < 0) ? -balance * rate : 0;
      return {
        nave: p.nave,
        trimestre: p.trimestre,
        tonelaje: p.tonelaje,
        laycanDesde: laycanDesde,
        laycanHasta: laycanHasta,
        eta: eta, etb: etb, etd: etd,
        inicioLaytime: inicio,
        espera: diasEntre(inicio, etb),
        bruto: bruto,
        contado: contado,
        allowed: allowed,
        balance: balance,
        exposicion: monto,
        // El amarre previsto fuera de la ventana es la señal temprana: esa
        // nave ya se sabe que va a esperar, y todavía se puede mover.
        amarreFueraDeLaycan: !!(etb && laycanHasta && etb > laycanHasta),
        calculable: balance != null
      };
    });
  }

  /** Rate de demurrage representativo de la temporada: la mediana. */
  function rateTipico(trimestres){
    var rates = [];
    (trimestres || []).forEach(function(q){
      (q.recaladas || []).forEach(function(r){ if(r.rate > 0) rates.push(r.rate); });
    });
    if(!rates.length) return 0;
    rates.sort(function(a, b){ return a - b; });
    var m = Math.floor(rates.length / 2);
    return rates.length % 2 ? rates[m] : (rates[m-1] + rates[m]) / 2;
  }

  function redondear(n, d){
    var f = Math.pow(10, d || 0);
    return (Math.round((Number(n) || 0) * f) / f).toLocaleString("es-CL");
  }
  function moneda(n){
    return "US$ " + Math.round(Number(n) || 0).toLocaleString("es-CL");
  }

  var api = {
    ORDEN: ORDEN,
    porTrimestre: porTrimestre,
    total: total,
    acumulado: acumulado,
    diagnostico: diagnostico,
    categorias: categorias,
    estadoLaycan: estadoLaycan,
    esProyectada: esProyectada,
    causasEspera: causasEspera,
    causaPrincipal: causaPrincipal,
    atribucion: atribucion,
    exposicionPlan: exposicionPlan,
    rateTipico: rateTipico,
    SIN_ATRIBUIR: SIN_ATRIBUIR,
    agruparPorTrimestre: agruparPorTrimestre,
    aFecha: aFecha,
    filtrar: filtrar,
    mesDe: mesDe,
    mesesDisponibles: mesesDisponibles,
    MESES: MESES,
    diasEntre: diasEntre
  };

  if(typeof module === "object" && module.exports) module.exports = api;
  else global.Trimestres = api;

})(typeof window !== "undefined" ? window : globalThis);
