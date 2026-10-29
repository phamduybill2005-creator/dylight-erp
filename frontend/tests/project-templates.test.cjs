const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function loadTemplates() {
  const filename = path.join(__dirname, "../src/lib/project-templates.ts");
  if (!fs.existsSync(filename)) return {};
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: (name) => {
    assert.equal(name, "./groups");
    return loadTypeScript("src/lib/groups.ts");
  } });
  return exports;
}

const projects = [
  { id: 1, code: "2739-0124", name: "いちき串木野", group_name: "測量解析" },
  { id: 2, code: "0000-0000", name: "Sample - Phòng Bản đồ", group_name: "測量解析" },
  { id: 3, code: "BIM-01", name: "BIM project", group_name: "3次元設計" },
  { id: 4, code: "BIM-02", name: "BIM project 2", group_name: "Phòng BIM" },
  { id: 5, code: "2D-01", name: "Road project", group_name: "土木設計" },
  { id: 6, code: "AI-01", name: "AI project", group_name: "AI開発" },
  { id: 7, code: "0000-0000", name: "Sample - Phòng BIM", group_name: "3次元設計" },
  { id: 8, code: "BIM-X", name: "Deleted project", group_name: "3次元設計", is_deleted: true },
];

test("Bản đồ offers only its named Sample and automatically selects it", () => {
  const { projectTemplateOptions, selectedProjectTemplateId } = loadTemplates();
  assert.equal(typeof projectTemplateOptions, "function");
  for (const group of ["測量解析", "Phòng Bản đồ"]) {
    assert.deepEqual(Array.from(projectTemplateOptions(projects, group), p => p.id), [2]);
    assert.equal(selectedProjectTemplateId(projects, group, "1"), "2");
    assert.equal(selectedProjectTemplateId(projects, group, ""), "2");
  }
});

test("other departments only offer their own projects, including Vietnamese group aliases", () => {
  const { projectTemplateOptions } = loadTemplates();
  assert.equal(typeof projectTemplateOptions, "function");
  for (const [group, ids] of [["3次元設計", [3, 4, 7]], ["Phòng BIM", [3, 4, 7]], ["土木設計", [5]], ["AI開発", [6]]]) {
    assert.deepEqual(Array.from(projectTemplateOptions(projects, group), p => p.id), ids);
  }
  assert.deepEqual(Array.from(projectTemplateOptions(projects, "")), []);
});

test("switching groups clears stale source IDs while allowing no copy for other departments", () => {
  const { selectedProjectTemplateId } = loadTemplates();
  assert.equal(typeof selectedProjectTemplateId, "function");
  assert.equal(selectedProjectTemplateId(projects, "3次元設計", "2"), "");
  assert.equal(selectedProjectTemplateId(projects, "3次元設計", "3"), "3");
  assert.equal(selectedProjectTemplateId(projects, "3次元設計", ""), "");
  assert.equal(selectedProjectTemplateId(projects, "土木設計", "3"), "");
});

test("missing or deleted Bản đồ Sample never falls back to a real project", () => {
  const { projectTemplateOptions, selectedProjectTemplateId } = loadTemplates();
  assert.equal(typeof projectTemplateOptions, "function");
  const withoutSample = projects.filter(p => p.id !== 2);
  assert.deepEqual(Array.from(projectTemplateOptions(withoutSample, "測量解析")), []);
  assert.equal(selectedProjectTemplateId(withoutSample, "測量解析", "1"), "");
  const archived = projects.map(p => p.id === 2 ? { ...p, is_deleted: true } : p);
  assert.deepEqual(Array.from(projectTemplateOptions(archived, "測量解析")), []);
});

test("Sample matching tolerates case, spaces and dash variants without matching arbitrary projects", () => {
  const { projectTemplateOptions } = loadTemplates();
  assert.equal(typeof projectTemplateOptions, "function");
  const samples = [
    { id: 10, name: "  SAMPLE – Phòng Bản đồ  ", group_name: "Phòng Bản đồ" },
    { id: 11, name: "Sample - Phòng Bản đồ backup", group_name: "測量解析" },
    { id: 12, name: "Sample - Phòng Bản đồ", group_name: "土木設計" },
  ];
  assert.deepEqual(Array.from(projectTemplateOptions(samples, "測量解析"), p => p.id), [10]);
});
