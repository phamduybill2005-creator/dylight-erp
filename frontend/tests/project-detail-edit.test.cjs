// Run from frontend: node --test tests/project-detail-edit.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadPayloadBuilder() {
  const modulePath = path.join(__dirname, "../src/lib/project-detail-edit.ts");
  if (!fs.existsSync(modulePath)) return undefined;
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(modulePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { exports: module.exports, module });
  return module.exports.buildProjectDetailUpdatePayload;
}

test("includes the edited internal deadline in the project update payload", () => {
  const buildProjectDetailUpdatePayload = loadPayloadBuilder();
  assert.equal(
    typeof buildProjectDetailUpdatePayload,
    "function",
    "project detail edit payload builder is not implemented",
  );

  const payload = buildProjectDetailUpdatePayload({
    memberIds: [3, 7],
    leadId: 3,
    name: "  Dự án A  ",
    code: "  DA001  ",
    existingCode: "OLD",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    internalDeadline: "2026-09-25",
    geoManager: "  GEO A  ",
    doscoManager: "  DOSCO B  ",
    groupName: "  AI開発  ",
    evaluation: "  Ghi chú  ",
  });

  assert.deepEqual({ ...payload }, {
    member_ids: [3, 7],
    lead_id: 3,
    name: "Dự án A",
    code: "DA001",
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    internal_deadline: "2026-09-25",
    geo_manager: "GEO A",
    dosco_manager: "DOSCO B",
    group_name: "AI開発",
    evaluation: "Ghi chú",
  });
});

test("clears the internal deadline when the edit field is empty", () => {
  const buildProjectDetailUpdatePayload = loadPayloadBuilder();
  assert.equal(typeof buildProjectDetailUpdatePayload, "function");

  const payload = buildProjectDetailUpdatePayload({
    memberIds: [],
    leadId: null,
    name: "Dự án B",
    code: "",
    existingCode: "DA002",
    startDate: "",
    endDate: "",
    internalDeadline: "",
    geoManager: "",
    doscoManager: "",
    groupName: "",
    evaluation: "",
  });

  assert.equal(payload.internal_deadline, null);
});
