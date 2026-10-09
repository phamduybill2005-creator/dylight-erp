const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function loadApi(status = 200) {
  const requests = [];
  const storage = new Map([["dylight_token", "synthetic-erp-jwt"]]);
  const location = { pathname: "/leave", search: "?request_id=42&action=approve", href: "" };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/api.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: module.exports, module, process, Headers, FormData, console,
    window: { location },
    localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: () => null, removeItem() {}, clear() {} },
    require: name => name === "./leave-links" ? loadTypeScript("src/lib/leave-links.ts") : require(name),
    fetch: async (url, init) => {
      requests.push({ url, method: init.method || "GET", body: init.body, auth: init.headers.get("Authorization") });
      return { ok: status === 200, status, json: async () => ({ id: 42, status: "PENDING", zalo: { status: "failed", reason: "send_failed" } }) };
    },
  });
  return { api: module.exports.api, requests, storage, location };
}

test("opening an exact linked leave only reads it; deciding needs an explicit authenticated POST", async () => {
  const { api, requests } = loadApi();
  assert.equal((await api.leave(42)).id, 42);
  assert.deepEqual(requests, [{ url: "http://localhost:8000/api/v1/leave/42", method: "GET", body: undefined, auth: "Bearer synthetic-erp-jwt" }]);
  await api.decideLeave(42, "REJECTED");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "http://localhost:8000/api/v1/leave/42/decide");
  assert.equal(requests[1].method, "POST");
  assert.deepEqual(JSON.parse(requests[1].body), { status: "REJECTED" });
});

test("a safe Zalo failure remains a successful ERP create response without resending", async () => {
  const { api, requests } = loadApi();
  const saved = await api.createLeave({ from_date: "2026-10-15", to_date: "2026-10-15", leave_type: "FULL", reason: "GIA ĐÌNH" });
  assert.equal(saved.id, 42);
  assert.deepEqual(saved.zalo, { status: "failed", reason: "send_failed" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
});

test("actual API 401 clears authentication but keeps a safe return to the same leave", async () => {
  const { api, storage, location } = loadApi(401);
  await assert.rejects(() => api.leave(42), /Phiên đăng nhập đã hết hạn/);
  assert.equal(storage.has("dylight_token"), false);
  assert.equal(location.href, "/login?next=%2Fleave%3Frequest_id%3D42");
});
