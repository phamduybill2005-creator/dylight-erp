const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function setup(options) {
  let liveListener;
  let clean;
  let count = 0;
  const timers = new Map();
  let timerId = 0;
  const docListeners = new Map();
  const winListeners = new Map();
  const doc = { visibilityState: "hidden", addEventListener: (k, f) => docListeners.set(k, f), removeEventListener: (k) => docListeners.delete(k) };
  const win = { addEventListener: (k, f) => winListeners.set(k, f), removeEventListener: (k) => winListeners.delete(k) };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/use-auto-refresh.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, document: doc, window: win,
    setTimeout: (f, ms) => { const id = ++timerId; timers.set(id, { f, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    require: (name) => name === "react"
      ? { useRef: (value) => ({ current: value }), useEffect: (f) => { clean = f(); } }
      : { isLiveConnected: () => true, onLiveChange: (f) => { liveListener = f; return () => {}; } },
  });
  module.exports.useAutoRefresh(() => count++, options);
  return {
    live: (topic) => liveListener(topic),
    runTimer: (ms) => { const entry = [...timers].find(([, t]) => t.ms === ms); assert.ok(entry); timers.delete(entry[0]); entry[1].f(); },
    count: () => count, clean, timers, docListeners, winListeners,
  };
}

test("notification live events and fallback refresh run while tab is hidden", () => {
  const app = setup({ topics: ["notification"], background: true });
  app.live("notification");
  app.runTimer(150);
  assert.equal(app.count(), 1);
  app.runTimer(15000);
  assert.equal(app.count(), 2);
  app.clean();
  assert.equal(app.timers.size, 0);
  assert.equal(app.docListeners.size, 0);
  assert.equal(app.winListeners.size, 0);
});

test("ordinary page refreshes still pause in background and irrelevant topics are ignored", () => {
  const app = setup({ topics: ["notification"] });
  app.live("notification");
  app.runTimer(150);
  assert.equal(app.count(), 0);
  app.runTimer(15000);
  assert.equal(app.count(), 0);
  app.live("leave");
  assert.equal([...app.timers.values()].filter((t) => t.ms === 150).length, 0);
  app.clean();
});
