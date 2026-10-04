(function () {
  "use strict";

  var PERIOD_LABEL = {
    vespertina: "Vespertino 15:00",
    nocturna: "Nocturno 21:00",
  };
  var PERIOD_ORDER = { vespertina: 0, nocturna: 1 };

  var STRATEGY_HINT = {
    balanced: "Combina números frecuentes con los que hace más en salir.",
    hot: "Prioriza los que más salieron en la ventana elegida.",
    due: "Prioriza los que hace más sorteos que no aparecen.",
    cold: "Prioriza los menos sorteados en la ventana elegida.",
    random: "Al azar, sin usar ninguna estadística.",
  };
  var TOTAL = 100;
  var TRACKING_RECORDS_KEY = "tombola.tracking.records.v1";

  var state = {
    periodo: "vespertina",
    fecha: "",
    cantidad: 5,
    estrategia: "balanced",
    ventana: 100,
  };

  var el = {
    meta: document.getElementById("dataset-meta"),
    fecha: document.getElementById("fecha-objetivo"),
    periodo: document.getElementById("periodo"),
    scheduleHint: document.getElementById("schedule-hint"),
    cantidad: document.getElementById("cantidad"),
    estrategia: document.getElementById("estrategia"),
    hint: document.getElementById("estrategia-hint"),
    ventana: document.getElementById("ventana"),
    generar: document.getElementById("generar"),
    results: document.getElementById("results"),
    resultsLabel: document.getElementById("results-label"),
    balls: document.getElementById("balls"),
    why: document.getElementById("why"),
    heatmap: document.getElementById("heatmap"),
    heatmapMeta: document.getElementById("heatmap-meta"),
    hotList: document.getElementById("hot-list"),
    dueList: document.getElementById("due-list"),
    recent: document.getElementById("recent"),
    strategyAccordion: document.getElementById("estrategias"),
    strategyLink: document.getElementById("estrategias-link"),
    footerRange: document.getElementById("footer-range"),
    dataUpdate: document.getElementById("data-update"),
    overviewTarget: document.getElementById("overview-target"),
    overviewTargetNote: document.getElementById("overview-target-note"),
    overviewSource: document.getElementById("overview-source"),
    overviewSourceNote: document.getElementById("overview-source-note"),
    overviewTracking: document.getElementById("overview-tracking"),
    overviewTrackingNote: document.getElementById("overview-tracking-note"),
    registerPick: document.getElementById("registrar-jugada"),
    trackingStatus: document.getElementById("tracking-status"),
    trackingSummary: document.getElementById("tracking-summary"),
    trackingList: document.getElementById("tracking-list"),
    trackingEmpty: document.getElementById("tracking-empty"),
    strategyChart: document.getElementById("strategy-performance"),
    strategyChartEmpty: document.getElementById("strategy-performance-empty"),
    exportTracking: document.getElementById("exportar-registro"),
  };

  var draws = [];
  var trackedPicks = [];
  var storageAvailable = true;
  var currentPick = null;
  var noDrawDates = new Set();

  function init() {
    var raw = window.TOMBOLA_DATA;
    if (!raw || !Array.isArray(raw.draws) || raw.draws.length === 0) {
      el.meta.textContent = "No se encontraron datos (data/tombola.js).";
      return;
    }

    draws = raw.draws
      .slice()
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        var periodOrder = { vespertina: 0, nocturna: 1 };
        return periodOrder[a.period] - periodOrder[b.period];
      });
    noDrawDates = new Set(Array.isArray(raw.no_draw_dates) ? raw.no_draw_dates : []);

    loadTracking();
    syncTrackedPicks();

    el.meta.textContent =
      draws.length.toLocaleString("es-UY") +
      " sorteos en el historial · " +
      fmtDate(draws[0].date) +
      " → " +
      fmtDate(draws[draws.length - 1].date);

    el.footerRange.textContent = raw.last_checked_at
      ? "Última consulta a la DNLQ: " + fmtDateTime(raw.last_checked_at) + "."
      : "Última consulta a la DNLQ: sin registrar.";

    var checkErrors = raw.last_check_errors || 0;
    el.overviewSource.textContent = raw.last_checked_at
      ? fmtDateTime(raw.last_checked_at)
      : "Sin consulta registrada";
    el.overviewSourceNote.textContent = checkErrors
      ? checkErrors + " errores de descarga · fuente DNLQ"
      : "Última comprobación del historial oficial";
    el.dataUpdate.textContent = checkErrors
      ? "La última consulta tuvo " + checkErrors + " errores de descarga."
      : raw.last_checked_at
      ? "La consulta automática se ejecuta al abrir la página desde python serve.py (cada 15 minutos como máximo)."
      : "Para actualizar desde la DNLQ, abrí la página con python serve.py.";

    var now = window.TOMBOLA_NOW || new Date();
    el.fecha.min = montevideoDate(now);
    var target = nextScheduledTarget(now);
    state.fecha = target.date;
    state.periodo = target.period;
    el.fecha.value = target.date;

    bindControls();
    updateTargetControls();
    renderHint();
    renderTracking();
    renderAll();
    showGeneratePrompt();
  }

  function renderHint() {
    el.hint.textContent = STRATEGY_HINT[state.estrategia] || "";
  }

  function bindControls() {
    el.periodo.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button");
      if (!btn || !el.periodo.contains(btn) || btn.disabled) return;
      state.periodo = btn.dataset.value;
      updateTargetControls();
      renderAll();
      invalidatePick();
    });

    el.fecha.addEventListener("change", function () {
      state.fecha = el.fecha.value;
      var available = availablePeriods(state.fecha);
      if (available.length && available.indexOf(state.periodo) === -1) {
        state.periodo = available[0];
      }
      updateTargetControls();
      renderAll();
      invalidatePick();
    });

    el.cantidad.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button");
      if (!btn || !el.cantidad.contains(btn)) return;
      Array.prototype.forEach.call(el.cantidad.children, function (b) {
        var active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-checked", String(active));
      });
      state.cantidad = parseInt(btn.dataset.value, 10);
      invalidatePick();
    });

    el.estrategia.addEventListener("change", function () {
      state.estrategia = el.estrategia.value;
      renderHint();
      invalidatePick();
    });

    el.ventana.addEventListener("change", function () {
      state.ventana = parseInt(el.ventana.value, 10);
      renderAll();
      invalidatePick();
    });

    el.generar.addEventListener("click", generate);
    el.registerPick.addEventListener("click", registerCurrentPick);
    el.exportTracking.addEventListener("click", exportTrackingCSV);
    el.strategyLink.addEventListener("click", function () {
      el.strategyAccordion.open = true;
    });
  }

  function loadTracking() {
    try {
      var stored = window.localStorage.getItem(TRACKING_RECORDS_KEY);
      var parsed = stored ? JSON.parse(stored) : [];
      trackedPicks = Array.isArray(parsed) ? parsed.filter(isValidTrackedPick) : [];
    } catch (error) {
      trackedPicks = [];
      storageAvailable = false;
      el.trackingStatus.textContent =
        "El navegador no permite guardar el registro localmente. Abrí la página con iniciar.bat.";
    }
  }

  function persistTracking() {
    try {
      window.localStorage.setItem(TRACKING_RECORDS_KEY, JSON.stringify(trackedPicks));
      return true;
    } catch (error) {
      storageAvailable = false;
      el.registerPick.disabled = true;
      el.trackingStatus.textContent =
        "No se pudo guardar en el navegador. Exportá el CSV y liberá espacio de almacenamiento.";
      return false;
    }
  }

  function pickKey(pick) {
    return [pick.date, pick.period, pick.strategy, pick.window, pick.quantity].join("|");
  }

  function findDraw(date, period) {
    for (var i = 0; i < draws.length; i++) {
      if (draws[i].date === date && draws[i].period === period) return draws[i];
    }
    return null;
  }

  function isValidTrackedPick(entry) {
    return Boolean(
      entry &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
      PERIOD_ORDER[entry.period] !== undefined &&
      ["balanced", "hot", "due", "cold", "random"].indexOf(entry.strategy) !== -1 &&
      typeof entry.key === "string" &&
      Number.isInteger(entry.window) && entry.window >= 0 &&
      Number.isInteger(entry.quantity) && entry.quantity >= 3 && entry.quantity <= 7 &&
      Array.isArray(entry.numbers) &&
      entry.numbers.length === entry.quantity &&
      entry.numbers.every(function (number) {
        return Number.isInteger(number) && number >= 0 && number < TOTAL;
      }) &&
      new Set(entry.numbers).size === entry.numbers.length &&
      typeof entry.recordedAt === "string"
    );
  }

  function recordedBeforeTarget(entry) {
    var dateParts = entry.date.split("-").map(Number);
    var utcHour = entry.period === "vespertina" ? 18 : 24;
    var targetTime = Date.UTC(
      dateParts[0],
      dateParts[1] - 1,
      dateParts[2],
      utcHour,
    );
    var recordedTime = Date.parse(entry.recordedAt);
    return Number.isFinite(recordedTime) && recordedTime < targetTime;
  }

  function syncTrackedPicks() {
    var changed = false;
    trackedPicks.forEach(function (entry) {
      var official = findDraw(entry.date, entry.period);
      if (!official || !recordedBeforeTarget(entry)) return;
      var officialNumbers = official.numbers.slice();
      var hits = entry.numbers.filter(function (number) {
        return officialNumbers.indexOf(number) !== -1;
      }).length;
      if (
        !Array.isArray(entry.resultNumbers) ||
        entry.resultNumbers.join(",") !== officialNumbers.join(",") ||
        entry.hits !== hits
      ) {
        entry.resultNumbers = officialNumbers;
        entry.hits = hits;
        entry.resolvedAt = window.TOMBOLA_DATA.last_checked_at || new Date().toISOString();
        changed = true;
      }
    });
    if (changed) persistTracking();
  }

  function isValidISODate(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || "")) return false;
    var parsed = new Date(isoDate + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate;
  }

  function scheduledPeriods(isoDate) {
    if (!isValidISODate(isoDate)) return [];
    if (noDrawDates.has(isoDate)) return [];
    var parsed = new Date(isoDate + "T00:00:00Z");
    var day = parsed.getUTCDay();
    if (day >= 1 && day <= 5) return ["vespertina", "nocturna"];
    if (day === 6) return ["nocturna"];
    return [];
  }

  function montevideoDate(now) {
    var parts = montevideoParts(now);
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function availablePeriods(isoDate, now) {
    var scheduled = scheduledPeriods(isoDate);
    if (scheduled.length === 0) return [];
    var current = montevideoDate(now || window.TOMBOLA_NOW || new Date());
    if (isoDate < current) return [];
    if (isoDate > current) return scheduled;

    var parts = montevideoParts(now || window.TOMBOLA_NOW || new Date());
    var nowMinutes = +parts.hour * 60 + +parts.minute;
    return scheduled.filter(function (period) {
      var drawMinutes = period === "vespertina" ? 15 * 60 : 21 * 60;
      return drawMinutes > nowMinutes;
    });
  }

  function montevideoParts(now) {
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Montevideo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .forEach(function (part) {
        if (part.type !== "literal") parts[part.type] = part.value;
      });
    return parts;
  }

  function nextScheduledTarget(now) {
    var parts = montevideoParts(now);

    var base = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
    var nowMinutes = +parts.hour * 60 + +parts.minute;
    for (var offset = 0; offset <= 7; offset++) {
      var candidate = new Date(base.getTime() + offset * 86400000);
      var isoDate = candidate.toISOString().slice(0, 10);
      var periods = availablePeriods(isoDate, now);
      for (var i = 0; i < periods.length; i++) {
        var period = periods[i];
        var drawMinutes = period === "vespertina" ? 15 * 60 : 21 * 60;
        if (offset > 0 || drawMinutes > nowMinutes) {
          return { date: isoDate, period: period };
        }
      }
    }
    throw new Error("No se encontró un próximo sorteo regular.");
  }

  function targetIsUpcoming() {
    return availablePeriods(state.fecha).indexOf(state.periodo) !== -1;
  }

  function updateTargetControls() {
    var available = availablePeriods(state.fecha);
    updateOverviewTarget(available);
    Array.prototype.forEach.call(el.periodo.children, function (button) {
      button.disabled = available.indexOf(button.dataset.value) === -1;
      var active = button.dataset.value === state.periodo && !button.disabled;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });

    if (available.length === 0) {
      var today = montevideoDate(window.TOMBOLA_NOW || new Date());
      if (!isValidISODate(state.fecha)) {
        el.scheduleHint.textContent = "Elegí una fecha válida para el sorteo objetivo.";
      } else if (state.fecha < today) {
        el.scheduleHint.textContent = "La fecha ya pasó. Elegí hoy o una fecha futura.";
      } else if (noDrawDates.has(state.fecha)) {
        el.scheduleHint.textContent = "El calendario oficial de la DNLQ indica que ese día no hay sorteos.";
      } else if (scheduledPeriods(state.fecha).length === 0) {
        el.scheduleHint.textContent = "No hay sorteo regular los domingos. Elegí una fecha de lunes a sábado.";
      } else {
        el.scheduleHint.textContent = "Los sorteos regulares de hoy ya comenzaron o finalizaron. Elegí un horario futuro.";
      }
    } else {
      el.scheduleHint.textContent =
        "DNLQ: lunes a viernes, 15:00 y 21:00; sábados, solo 21:00. " +
        "Objetivo: " + PERIOD_LABEL[state.periodo] + " · " + fmtDate(state.fecha) +
        (state.periodo === "nocturna" && available.indexOf("vespertina") !== -1
          ? ". Se incluirá el vespertino de ese día solo si ya figura en el historial."
          : ". Se usarán únicamente sorteos anteriores a este horario.") +
        " Verificá fechas especiales en el calendario oficial.";
    }
  }

  function updateOverviewTarget(available) {
    if (available.indexOf(state.periodo) !== -1) {
      el.overviewTarget.textContent = PERIOD_LABEL[state.periodo] + " · " + fmtDate(state.fecha);
      el.overviewTargetNote.textContent =
        state.periodo === "nocturna" && available.indexOf("vespertina") !== -1
          ? "El vespertino cuenta solo si ya está publicado"
          : "Solo se usan sorteos anteriores";
      return;
    }

    var today = montevideoDate(window.TOMBOLA_NOW || new Date());
    el.overviewTarget.textContent = "Sin sorteo disponible";
    el.overviewTargetNote.textContent = state.fecha < today
      ? "La fecha objetivo ya pasó"
      : noDrawDates.has(state.fecha)
      ? "El calendario DNLQ marca día sin sorteos"
      : scheduledPeriods(state.fecha).length === 0
      ? "No hay sorteo regular ese día"
      : "Los horarios de hoy ya pasaron";
  }

  function isBeforeTarget(draw) {
    if (draw.date !== state.fecha) return draw.date < state.fecha;
    return PERIOD_ORDER[draw.period] < PERIOD_ORDER[state.periodo];
  }

  function pool() {
    if (availablePeriods(state.fecha).indexOf(state.periodo) === -1) return [];
    var list = draws.filter(isBeforeTarget);
    if (state.ventana > 0 && list.length > state.ventana) {
      list = list.slice(list.length - state.ventana);
    }
    return list;
  }

  function stats(list) {
    var count = new Array(TOTAL).fill(0);
    var lastIdx = new Array(TOTAL).fill(-1);
    var i;
    for (i = 0; i < list.length; i++) {
      var nums = list[i].numbers;
      for (var j = 0; j < nums.length; j++) {
        count[nums[j]]++;
        lastIdx[nums[j]] = i;
      }
    }
    var absence = count.map(function (c, n) {
      return lastIdx[n] === -1 ? list.length : list.length - 1 - lastIdx[n];
    });
    return { count: count, absence: absence, total: list.length };
  }

  function weightedPick(candidates, weightFn, k) {
    var chosen = [];
    var bag = candidates.slice();
    while (chosen.length < k && bag.length > 0) {
      var weights = bag.map(weightFn);
      var sum = weights.reduce(function (a, b) {
        return a + b;
      }, 0);
      var idx;
      if (sum <= 0) {
        idx = Math.floor(Math.random() * bag.length);
      } else {
        var r = Math.random() * sum;
        idx = 0;
        while (idx < bag.length - 1 && (r -= weights[idx]) > 0) idx++;
      }
      chosen.push(bag[idx]);
      bag.splice(idx, 1);
    }
    return chosen;
  }

  function recommend(list, st) {
    var all = [];
    for (var n = 0; n < TOTAL; n++) all.push(n);
    var k = state.cantidad;

    if (state.estrategia === "random") {
      return weightedPick(all, function () {
        return 1;
      }, k);
    }

    var s = stats(list);
    var maxC = Math.max.apply(null, s.count);
    var minC = Math.min.apply(null, s.count);
    var maxA = Math.max.apply(null, s.absence);

    function norm(v, lo, hi) {
      return hi === lo ? 0.5 : (v - lo) / (hi - lo);
    }

    var weight;
    if (state.estrategia === "hot") {
      weight = function (n) {
        return Math.pow(norm(s.count[n], minC, maxC) + 0.05, 3);
      };
    } else if (state.estrategia === "cold") {
      weight = function (n) {
        return Math.pow(1 - norm(s.count[n], minC, maxC) + 0.05, 3);
      };
    } else if (state.estrategia === "due") {
      weight = function (n) {
        return Math.pow(norm(s.absence[n], 0, maxA) + 0.05, 3);
      };
    } else {
      weight = function (n) {
        var f = norm(s.count[n], minC, maxC) + 0.15;
        var a = norm(s.absence[n], 0, maxA) + 0.15;
        return f * a;
      };
    }

    var picked = weightedPick(all, weight, k);
    picked.sort(function (a, b) {
      return a - b;
    });
    return picked;
  }

  function generate() {
    var list = pool();
    if (availablePeriods(state.fecha).indexOf(state.periodo) === -1) {
      currentPick = null;
      el.results.hidden = false;
      el.balls.innerHTML = "";
      el.why.innerHTML = "";
      el.registerPick.hidden = true;
      el.resultsLabel.textContent = !isValidISODate(state.fecha)
        ? "Elegí una fecha válida para el sorteo objetivo."
        : state.fecha < montevideoDate(window.TOMBOLA_NOW || new Date())
        ? "La fecha elegida ya pasó. Seleccioná un sorteo futuro."
        : noDrawDates.has(state.fecha)
        ? "El calendario oficial de la DNLQ indica que ese día no hay sorteos."
        : scheduledPeriods(state.fecha).length === 0
        ? "No hay sorteo regular para la fecha elegida."
        : "Ese horario ya pasó. Seleccioná el próximo sorteo.";
      return;
    }
    if (list.length === 0) {
      currentPick = null;
      el.results.hidden = false;
      el.balls.innerHTML = "";
      el.why.innerHTML = "";
      el.registerPick.hidden = true;
      el.resultsLabel.textContent = "No hay sorteos anteriores disponibles para esa fecha y horario.";
      return;
    }

    var candidate = {
      date: state.fecha,
      period: state.periodo,
      strategy: state.estrategia,
      window: state.ventana,
      quantity: state.cantidad,
    };
    var key = pickKey(candidate);
    var existing = trackedPicks.find(function (entry) { return entry.key === key; });
    var picked = existing ? existing.numbers.slice() : recommend(list, state);
    var s = stats(list);
    currentPick = {
      key: key,
      date: state.fecha,
      period: state.periodo,
      strategy: state.estrategia,
      strategyLabel: strategyLabel(),
      window: state.ventana,
      quantity: state.cantidad,
      numbers: picked.slice(),
    };
    var etiqueta =
      PERIOD_LABEL[state.periodo] +
      " · " +
      fmtDate(state.fecha) +
      " · " +
      state.cantidad +
      " números · " +
      strategyLabel() +
      " · " +
      windowLabel(list.length) +
      (existing ? " · jugada ya registrada" : "");

    el.results.hidden = false;
    el.resultsLabel.textContent = etiqueta;
    el.balls.innerHTML = "";
    el.why.innerHTML = "";

    picked.forEach(function (n, i) {
      var li = document.createElement("li");
      li.textContent = pad(n);
      li.style.animationDelay = i * 70 + "ms";
      el.balls.appendChild(li);

      var tag = document.createElement("span");
      tag.innerHTML =
        "<b>" + pad(n) + "</b> · " +
        s.count[n] + " salidas · " +
        (s.absence[n] === 0 ? "salió en el último" : s.absence[n] + " sin salir");
      el.why.appendChild(tag);
    });

    el.registerPick.hidden = false;
    el.registerPick.disabled = Boolean(existing) || !storageAvailable || !targetIsUpcoming();
    el.registerPick.textContent = existing
      ? "Jugada ya registrada"
      : "Registrar jugada para seguimiento";
    el.trackingStatus.textContent = existing
      ? "Se muestra la primera jugada guardada para esta configuración."
      : "";
  }

  function showGeneratePrompt() {
    currentPick = null;
    el.results.hidden = false;
    el.resultsLabel.textContent = "Configurá la jugada y pulsá “Generar números”.";
    el.balls.innerHTML = "";
    el.why.innerHTML = "";
    el.registerPick.hidden = true;
    el.registerPick.disabled = true;
  }

  function invalidatePick() {
    currentPick = null;
    el.results.hidden = false;
    el.resultsLabel.textContent = "Configuración actualizada. Generá la jugada para ver los números.";
    el.balls.innerHTML = "";
    el.why.innerHTML = "";
    el.registerPick.hidden = true;
    el.registerPick.disabled = true;
    el.trackingStatus.textContent = "";
  }

  function registerCurrentPick() {
    if (!currentPick) return;
    if (!targetIsUpcoming()) {
      el.trackingStatus.textContent =
        "No se registran jugadas retroactivas: elegí un sorteo que todavía no haya comenzado.";
      return;
    }

    if (trackedPicks.some(function (entry) { return entry.key === currentPick.key; })) {
      el.trackingStatus.textContent =
        "Esta configuración para ese sorteo ya está registrada; se conserva la primera jugada.";
      return;
    }

    var record = {
      key: currentPick.key,
      date: currentPick.date,
      period: currentPick.period,
      strategy: currentPick.strategy,
      strategyLabel: currentPick.strategyLabel,
      window: currentPick.window,
      quantity: currentPick.quantity,
      numbers: currentPick.numbers.slice(),
      recordedAt: new Date().toISOString(),
      resultNumbers: null,
      hits: null,
    };
    trackedPicks.unshift(record);
    var saved = persistTracking();
    if (!saved) {
      trackedPicks.shift();
      renderTracking();
      return;
    }

    renderTracking();
    el.registerPick.disabled = true;
    el.registerPick.textContent = "Jugada registrada";
    el.resultsLabel.textContent += " · registrada";
    el.trackingStatus.textContent =
      "Jugada guardada antes del sorteo. Esta configuración conservará esta combinación.";
  }

  function renderTracking() {
    var resolved = trackedPicks.filter(function (entry) {
      return Number.isInteger(entry.hits);
    });
    var pending = trackedPicks.length - resolved.length;
    var hitTotal = resolved.reduce(function (sum, entry) { return sum + entry.hits; }, 0);
    var expectedTotal = resolved.reduce(function (sum, entry) {
      return sum + entry.numbers.length * 0.2;
    }, 0);
    var average = resolved.length ? hitTotal / resolved.length : 0;
    var expectedAverage = resolved.length ? expectedTotal / resolved.length : 0;
    el.overviewTracking.textContent = trackedPicks.length.toLocaleString("es-UY") +
      (trackedPicks.length === 1 ? " jugada" : " jugadas");
    el.overviewTrackingNote.textContent =
      resolved.length.toLocaleString("es-UY") + " resueltas · " +
      pending.toLocaleString("es-UY") + " pendientes";
    el.trackingSummary.textContent =
      trackedPicks.length.toLocaleString("es-UY") + " jugadas guardadas · " +
      resolved.length.toLocaleString("es-UY") + " resueltas · " +
      pending.toLocaleString("es-UY") + " pendientes" +
      (resolved.length
        ? " · promedio " + average.toLocaleString("es-UY", { maximumFractionDigits: 2 }) +
          " aciertos/jugada (azar esperado: " +
          expectedAverage.toLocaleString("es-UY", { maximumFractionDigits: 2 }) + ")"
        : "");

    renderStrategyPerformance(resolved);

    el.trackingList.innerHTML = "";
    trackedPicks.slice(0, 30).forEach(function (entry) {
      var item = document.createElement("li");
      item.className = Number.isInteger(entry.hits) ? "tracking-item is-resolved" : "tracking-item is-pending";
      var status = Number.isInteger(entry.hits)
        ? entry.hits + "/" + entry.numbers.length + " aciertos"
        : "Pendiente";
      item.textContent =
        fmtDate(entry.date) + " · " + PERIOD_LABEL[entry.period] + " · " +
        (entry.strategyLabel || entry.strategy) + " · ventana " + entry.window +
        " · " + entry.numbers.map(pad).join(" ") + " · " + status;
      el.trackingList.appendChild(item);
    });
    el.trackingEmpty.hidden = trackedPicks.length > 0;
  }

  function renderStrategyPerformance(resolved) {
    var labels = {
      balanced: "Equilibrados",
      hot: "Calientes",
      due: "Vencidos",
      cold: "Fríos",
      random: "Azar puro",
    };
    var groups = {};
    resolved.forEach(function (entry) {
      if (!groups[entry.strategy]) groups[entry.strategy] = { count: 0, hits: 0, expected: 0 };
      groups[entry.strategy].count++;
      groups[entry.strategy].hits += entry.hits;
      groups[entry.strategy].expected += entry.quantity * 0.2;
    });

    var order = ["balanced", "hot", "due", "cold", "random"];
    var keys = order.filter(function (strategy) { return groups[strategy]; });
    el.strategyChart.innerHTML = "";
    el.strategyChartEmpty.hidden = keys.length > 0;
    keys.forEach(function (strategy) {
      var group = groups[strategy];
      var average = group.hits / group.count;
      var expected = group.expected / group.count;
      var row = document.createElement("div");
      row.className = "performance-row";

      var details = document.createElement("div");
      details.className = "performance-details";
      var name = document.createElement("strong");
      name.textContent = labels[strategy];
      var figures = document.createElement("span");
      figures.textContent =
        group.count + (group.count === 1 ? " jugada resuelta" : " jugadas resueltas") +
        " · " + average.toLocaleString("es-UY", { maximumFractionDigits: 2 }) +
        " aciertos/jugada · azar " + expected.toLocaleString("es-UY", { maximumFractionDigits: 2 });
      details.appendChild(name);
      details.appendChild(figures);

      var bar = document.createElement("div");
      bar.className = "performance-bar";
      bar.setAttribute("role", "img");
      bar.setAttribute(
        "aria-label",
        labels[strategy] + ": " + average.toFixed(2) + " aciertos por jugada, azar esperado " + expected.toFixed(2),
      );
      var observed = document.createElement("span");
      observed.className = "performance-observed";
      observed.style.width = (Math.min(7, average) / 7 * 100) + "%";
      var baseline = document.createElement("i");
      baseline.className = "performance-baseline";
      baseline.style.left = (Math.min(7, expected) / 7 * 100) + "%";
      bar.appendChild(observed);
      bar.appendChild(baseline);

      row.appendChild(details);
      row.appendChild(bar);
      el.strategyChart.appendChild(row);
    });
  }

  function csvField(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function exportTrackingCSV() {
    var columns = [
      "fecha_objetivo", "horario", "registrada_en", "estrategia", "ventana",
      "cantidad", "numeros_recomendados", "resultado_oficial", "aciertos",
    ];
    var rows = [columns.map(csvField).join(";")];
    trackedPicks.forEach(function (entry) {
      rows.push([
        entry.date,
        PERIOD_LABEL[entry.period],
        entry.recordedAt,
        entry.strategyLabel || entry.strategy,
        entry.window === 0 ? "completa" : entry.window,
        entry.quantity,
        entry.numbers.map(pad).join(" "),
        Array.isArray(entry.resultNumbers) ? entry.resultNumbers.map(pad).join(" ") : "",
        Number.isInteger(entry.hits) ? entry.hits : "",
      ].map(csvField).join(";"));
    });

    try {
      var blob = new Blob(["\ufeff" + rows.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      });
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "seguimiento-tombola.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
      el.trackingStatus.textContent = "Registro exportado a CSV.";
    } catch (error) {
      el.trackingStatus.textContent = "No se pudo exportar el CSV en este navegador.";
    }
  }

  function strategyLabel() {
    var opt = el.estrategia.options[el.estrategia.selectedIndex];
    return opt ? opt.text.split(" (")[0] : "";
  }

  function windowLabel(n) {
    if (state.ventana === 0) return "historial completo (" + n.toLocaleString("es-UY") + " sorteos)";
    return "últimos " + n.toLocaleString("es-UY") + " sorteos";
  }

  function renderAll() {
    renderHeatmap();
    renderRank(el.hotList, "hot");
    renderRank(el.dueList, "due");
    renderRecent();
  }

  function renderHeatmap() {
    var list = pool();
    if (list.length === 0) {
      el.heatmap.innerHTML = "";
      el.heatmapMeta.textContent = "Sin datos";
      return;
    }
    var s = stats(list);
    var minC = Math.min.apply(null, s.count);
    var maxC = Math.max.apply(null, s.count);

    el.heatmapMeta.textContent =
      windowLabel(list.length) +
      " · anteriores a " +
      PERIOD_LABEL[state.periodo] +
      " del " +
      fmtDate(state.fecha);

    var html = "";
    for (var n = 0; n < TOTAL; n++) {
      var t = maxC === minC ? 0.5 : (s.count[n] - minC) / (maxC - minC);
      var c = mixColor(t);
      html +=
        '<div style="background:' + c + '" title="' + pad(n) + ": " +
        s.count[n] + ' salidas">' + pad(n) + "</div>";
    }
    el.heatmap.innerHTML = html;
  }

  function mixColor(t) {
    var cold = [185, 212, 245];
    var hot = [237, 118, 95];
    var rgb = cold.map(function (v, i) {
      return Math.round(v + (hot[i] - v) * t);
    });
    return "rgb(" + rgb.join(",") + ")";
  }

  function renderRank(node, mode) {
    var list = pool();
    if (list.length === 0) {
      node.innerHTML = "";
      return;
    }
    var s = stats(list);
    var rows = [];
    for (var n = 0; n < TOTAL; n++) {
      rows.push({ n: n, v: mode === "hot" ? s.count[n] : s.absence[n] });
    }
    rows.sort(function (a, b) {
      return b.v - a.v || a.n - b.n;
    });
    rows = rows.slice(0, 10);
    var max = rows[0].v || 1;

    node.innerHTML = rows
      .map(function (r) {
        var label = mode === "hot" ? r.v + " salidas" : r.v + " sorteos";
        return (
          '<li><span class="num">' + pad(r.n) + "</span>" +
          '<span class="bar"><i style="width:' +
          Math.round((r.v / max) * 100) + '%"></i></span>' +
          '<span class="val">' + label + "</span></li>"
        );
      })
      .join("");
  }

  function renderRecent() {
    var list = pool().slice(-6).reverse();
    el.recent.innerHTML = list
      .map(function (d) {
        return (
          '<article class="draw"><div class="draw-head"><span>' +
          fmtDate(d.date) +
          "</span><span>" +
          PERIOD_LABEL[d.period] +
          '</span></div><div class="draw-nums">' +
          d.numbers
            .map(function (n) {
              return "<span>" + pad(n) + "</span>";
            })
            .join("") +
          "</div></article>"
        );
      })
      .join("");
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function fmtDate(iso) {
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  function fmtDateTime(iso) {
    return new Intl.DateTimeFormat("es-UY", {
      timeZone: "America/Montevideo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  }

  init();
})();
