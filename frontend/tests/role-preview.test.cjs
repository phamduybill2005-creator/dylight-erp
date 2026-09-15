// Run from frontend: node --test tests/role-preview.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadApi() {
  const storage = new Map();
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const realUser = { id: 7, role: "ADMIN", full_name: "Test admin", manager_id: 3 };
  const requests = [];
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/api.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports, module, process, sessionStorage,
    localStorage: { getItem: () => "test-token", setItem() {} }, window: {},
    Headers, FormData, console,
    fetch: async (url, init) => {
      requests.push({ url, token: init.headers.get("Authorization") });
      return { ok: true, status: 200, json: async () => ({ ...realUser }) };
    },
  });
  return { ...module.exports, sessionStorage, requests };
}

test("saved retired preview clears and restores the real user without changing authentication", async () => {
  const { api, previewRole, sessionStorage, requests } = loadApi();
  sessionStorage.setItem("dylight_preview_role", "ACCOUNTANT");
  const user = await api.me();
  assert.equal(user.role, "ADMIN");
  assert.equal(user.id, 7);
  assert.equal(previewRole.get(), null);
  assert.equal(sessionStorage.getItem("dylight_preview_role"), null);
  assert.equal(requests[0].token, "Bearer test-token");
});

test("retired preview cannot be stored even by an outdated caller", () => {
  const { previewRole, sessionStorage } = loadApi();
  previewRole.set("ACCOUNTANT");
  assert.equal(sessionStorage.getItem("dylight_preview_role"), null);
});

test("remaining previews preserve real account identity and permissions", async () => {
  const { api, previewRole } = loadApi();
  for (const role of ["ADMIN", "DIRECTOR", "MANAGER", "MANAGER_MID", "FIELD_STAFF"]) {
    previewRole.set(role);
    assert.equal(previewRole.get(), role);
    const user = await api.me();
    assert.equal(user.role, role);
    assert.equal(user.id, 7);
    assert.equal(api.realUser().role, "ADMIN");
  }
  previewRole.set(null);
  assert.equal((await api.me()).role, "ADMIN");
});
