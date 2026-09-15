// Run from frontend: node --test tests/project-item-workers.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadApi() {
  const requests = [];
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/api.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    process,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => "test-token", setItem() {}, removeItem() {} },
    window: {},
    Headers,
    FormData,
    console,
    fetch: async (url, init) => {
      requests.push({ url, method: init.method });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 19, worker_ids: [7] }),
      };
    },
  });
  return { ...module.exports, requests };
}

test("posts the selected person to the project-item worker endpoint", async () => {
  const { api, requests } = loadApi();

  const updated = await api.addProjectItemWorker(19, 7);

  assert.equal(updated.id, 19);
  assert.deepEqual(updated.worker_ids, [7]);
  assert.deepEqual(requests, [{
    url: "http://localhost:8000/api/v1/project-items/19/workers/7",
    method: "POST",
  }]);
});
