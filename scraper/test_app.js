const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");

function stubEl() {
  const el = {
    textContent: "",
    hidden: false,
    value: "",
    checked: false,
    disabled: false,
    className: "",
    href: "",
    download: "",
    selectedIndex: 0,
    options: [{ text: "Equilibrados (frecuencia + ausencia)" }],
    children: [],
    kids: [],
    handlers: {},
    style: {},
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    setAttribute() {},
    appendChild(node) {
      this.kids.push(node);
    },
    click() {
      this.wasClicked = true;
    },
    remove() {},
    contains(node) {
      return this.children.includes(node);
    },
  };
  let html = "";
  Object.defineProperty(el, "innerHTML", {
    get() {
      return html;
    },
    set(v) {
      html = v;
      if (v === "") this.kids = [];
    },
  });
  return el;
}

const nodes = {};
let downloadedLink = null;
let exportedBlob = null;
global.document = {
  addEventListener() {},
  body: {
    appendChild(node) {
      downloadedLink = node;
    },
  },
  getElementById(id) {
    if (!nodes[id]) {
      nodes[id] = stubEl();
      if (id === "periodo") {
        nodes[id].children = ["vespertina", "nocturna"].map((value) => ({
          dataset: { value },
          disabled: false,
          classList: { toggle() {} },
          setAttribute() {},
        }));
      }
      if (id === "cantidad") {
        nodes[id].children = [3, 4, 5, 6, 7].map((value) => ({
          dataset: { value: String(value) },
          classList: { toggle() {} },
          setAttribute() {},
        }));
      }
    }
    return nodes[id];
  },
  createElement(tag) {
    const node = stubEl();
    if (tag === "a") downloadedLink = node;
    return node;
  },
};
global.window = {};
window.TOMBOLA_NOW = new Date("2026-10-04T15:00:00Z"); // domingo al mediodía en Uruguay
const storedRecords = [
  {
    key: "2026-10-05|vespertina|balanced|100|5",
    date: "2026-10-05",
    period: "vespertina",
    strategy: "balanced",
    strategyLabel: "Equilibrados",
    window: 100,
    quantity: 5,
    numbers: [0, 1, 2, 3, 4],
    recordedAt: "2026-10-04T14:00:00-03:00",
    resultNumbers: null,
    hits: null,
  },
  {
    key: "2026-10-05|vespertina|cold|100|5",
    date: "2026-10-05",
    period: "vespertina",
    strategy: "cold",
    strategyLabel: "Fríos",
    window: 100,
    quantity: 5,
    numbers: [0, 1, 2, 3, 4],
    recordedAt: "2026-10-05T16:00:00-03:00",
    resultNumbers: null,
    hits: null,
  },
];
const storage = new Map([
  ["tombola.tracking.records.v1", JSON.stringify(storedRecords)],
  ["tombola.tracking.enabled.v1", "0"],
]);
window.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
};
window.URL = {
  createObjectURL(blob) { exportedBlob = blob; return "blob:mock-csv"; },
  revokeObjectURL() {},
};
window.setTimeout = (callback) => callback();
global.Blob = class MockBlob {
  constructor(parts, options) {
    this.content = parts.join("");
    this.type = options.type;
  }
};

eval(fs.readFileSync(path.join(root, "data", "tombola.js"), "utf8"));
const dataset = window.TOMBOLA_DATA;
dataset.calendar_month = "2026-10";
dataset.no_draw_dates = ["2026-10-12"];
dataset.draws = dataset.draws.filter((draw) => draw.date < "2026-10-05");
dataset.draws.push(
  { date: "2026-10-05", period: "vespertina", numbers: Array.from({ length: 20 }, (_, i) => i) },
  { date: "2026-10-05", period: "nocturna", numbers: Array.from({ length: 20 }, (_, i) => i + 20) },
  { date: "2026-10-06", period: "vespertina", numbers: Array.from({ length: 20 }, (_, i) => i + 40) },
);
eval(fs.readFileSync(path.join(root, "assets", "app.js"), "utf8"));

assert(dataset && Array.isArray(dataset.draws), "dataset cargado");
assert.strictEqual(nodes["fecha-objetivo"].value, "2026-10-05", "el domingo selecciona el próximo sorteo");
assert.strictEqual(nodes["fecha-objetivo"].min, "2026-10-04", "no admite elegir fechas anteriores a hoy");
assert(nodes["overview-target"].textContent.includes("Vespertino 15:00"));
assert(nodes["overview-source"].textContent.length > 0);
assert(nodes["overview-tracking"].textContent.includes("2 jugadas"));
assert.strictEqual(nodes.periodo.children[0].disabled, false, "vespertino permitido de lunes a viernes");
assert.strictEqual(nodes.periodo.children[1].disabled, false, "nocturno permitido de lunes a viernes");
assert.strictEqual((nodes.heatmap.innerHTML.match(/<div /g) || []).length, 100);
assert.strictEqual((nodes["hot-list"].innerHTML.match(/<li>/g) || []).length, 10);
assert.strictEqual((nodes["due-list"].innerHTML.match(/<li>/g) || []).length, 10);
assert.strictEqual((nodes.recent.innerHTML.match(/<article/g) || []).length, 6);
assert.strictEqual(nodes.results.hidden, false);
assert.strictEqual(nodes.balls.kids.length, 0, "no sortea automáticamente al abrir");
assert(nodes["results-label"].textContent.includes("pulsá"));
assert(nodes["tracking-summary"].textContent.includes("2 jugadas guardadas"));
assert(nodes["tracking-summary"].textContent.includes("1 resueltas"));
assert(nodes["tracking-summary"].textContent.includes("1 pendientes"));
assert(nodes["tracking-list"].kids[0].textContent.includes("5/5 aciertos"));
assert(nodes["tracking-list"].kids[1].textContent.includes("Pendiente"), "no acredita una jugada registrada después del sorteo");
assert.strictEqual(nodes["strategy-performance"].kids.length, 1, "el gráfico resume estrategias con resultados resueltos");

const periodLabel = {
  vespertina: "Vespertino 15:00",
  nocturna: "Nocturno 21:00",
};
const targetDate = nodes["fecha-objetivo"].value;
const targetOrder = 0;
const periodOrder = { vespertina: 0, nocturna: 1 };
const expectedRecent = dataset.draws
  .slice()
  .filter((draw) =>
    draw.date < targetDate ||
    (draw.date === targetDate && periodOrder[draw.period] < targetOrder),
  )
  .sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return periodOrder[a.period] - periodOrder[b.period];
  })
  .slice(-6)
  .reverse()
  .map((draw) => `${draw.date}|${periodLabel[draw.period]}`);
const actualRecent = Array.from(
  nodes.recent.innerHTML.matchAll(
    /<div class="draw-head"><span>(.*?)<\/span><span>(.*?)<\/span><\/div>/g,
  ),
  (match) => {
    const [day, month, year] = match[1].split("/");
    return `${year}-${month}-${day}|${match[2]}`;
  },
);
assert.deepStrictEqual(actualRecent, expectedRecent, "sorteos recientes en orden cronológico inverso");

nodes.generar.handlers.click();
assert.deepStrictEqual(nodes.balls.kids.map((ball) => ball.textContent), ["00", "01", "02", "03", "04"]);
assert.strictEqual(nodes["registrar-jugada"].disabled, true, "muestra la jugada guardada y no permite sustituirla");

const nocturna = nodes.periodo.children[1];
nodes.periodo.handlers.click({ target: { closest: () => nocturna } });
assert(nodes["overview-target"].textContent.includes("Nocturno 21:00"));
assert(nodes.recent.innerHTML.includes("05/10/2026</span><span>Vespertino 15:00"));
assert(
  !nodes.recent.innerHTML.includes("05/10/2026</span><span>Nocturno 21:00"),
  "no usa el resultado nocturno que intenta anticipar",
);
assert.strictEqual(nodes.balls.kids.length, 0, "cambiar opciones invalida la jugada sin sortear otra");
nodes["generar"].handlers.click();
const nocturnaPick = nodes.balls.kids.map((ball) => ball.textContent);
assert.strictEqual(nodes["registrar-jugada"].disabled, false);
nodes["registrar-jugada"].handlers.click();
assert.strictEqual(JSON.parse(storage.get("tombola.tracking.records.v1")).length, 3);
assert.deepStrictEqual(
  JSON.parse(storage.get("tombola.tracking.records.v1"))[0].numbers.map((n) => String(n).padStart(2, "0")),
  nocturnaPick,
  "el registro guarda exactamente la combinación visible",
);

nodes.generar.handlers.click();
assert.deepStrictEqual(nodes.balls.kids.map((ball) => ball.textContent), nocturnaPick);
assert.strictEqual(nodes["registrar-jugada"].disabled, true, "no vuelve a sortear ni sobrescribe una configuración registrada");

nodes["fecha-objetivo"].value = "2026-10-10";
nodes["fecha-objetivo"].handlers.change();
assert.strictEqual(nodes.periodo.children[0].disabled, true, "el sábado no hay vespertino");
assert.strictEqual(nodes.periodo.children[1].disabled, false, "el sábado sí hay nocturno");
assert.strictEqual(nodes.balls.kids.length, 0);
nodes.generar.handlers.click();
nodes["registrar-jugada"].handlers.click();
assert.strictEqual(JSON.parse(storage.get("tombola.tracking.records.v1")).length, 4);

nodes["fecha-objetivo"].value = "2026-10-11";
nodes["fecha-objetivo"].handlers.change();
nodes.generar.handlers.click();
assert(nodes["results-label"].textContent.includes("No hay sorteo regular"));
assert(nodes["schedule-hint"].textContent.includes("domingos"));

nodes["fecha-objetivo"].value = "2026-10-03";
nodes["fecha-objetivo"].handlers.change();
nodes.generar.handlers.click();
assert(nodes["results-label"].textContent.includes("La fecha elegida ya pasó"));
assert.strictEqual(JSON.parse(storage.get("tombola.tracking.records.v1")).length, 4);

window.TOMBOLA_NOW = new Date("2026-10-05T19:00:00Z"); // lunes 16:00 en Uruguay
nodes["fecha-objetivo"].value = "2026-10-05";
nodes["fecha-objetivo"].handlers.change();
assert.strictEqual(nodes.periodo.children[0].disabled, true, "el vespertino de hoy ya pasó");
assert.strictEqual(nodes.periodo.children[1].disabled, false, "el nocturno de hoy aún no pasó");

window.TOMBOLA_NOW = new Date("2026-10-06T01:00:00Z"); // lunes 22:00 en Uruguay
nodes["fecha-objetivo"].handlers.change();
assert(nodes["schedule-hint"].textContent.includes("ya comenzaron o finalizaron"));
assert.strictEqual(JSON.parse(storage.get("tombola.tracking.records.v1")).length, 4);

nodes["fecha-objetivo"].value = "2026-10-12";
nodes["fecha-objetivo"].handlers.change();
assert(nodes["overview-target-note"].textContent.includes("calendario DNLQ"));
nodes.generar.handlers.click();
assert(nodes["schedule-hint"].textContent.includes("calendario oficial"));
assert(nodes["results-label"].textContent.includes("calendario oficial"));

nodes["exportar-registro"].handlers.click();
assert.strictEqual(downloadedLink.download, "seguimiento-tombola.csv");
assert.strictEqual(downloadedLink.href, "blob:mock-csv");
assert(exportedBlob.content.includes('"fecha_objetivo";"horario"'));
assert(exportedBlob.content.includes('"5"'), "CSV incluye los aciertos conciliados");
nodes["estrategias-link"].handlers.click();
assert.strictEqual(nodes.estrategias.open, true, "el enlace de estrategias abre el panel plegable");

console.log("OK: calendario, corte temporal, mapa, listas y recomendación.");
console.log("OK: generación explícita, jugada registrada fija, gráfico y exportación CSV.");
