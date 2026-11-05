const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("deadline entry identifies the project and links straight to its detail", () => {
  const Card = loadTypeScript("src/components/deadline-project-link.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Card, {
    project: { id: 42, code: "DA-042", name: "Dự án thử", internal_deadline: "2026-11-05" },
    due: "2026-11-05", onOpen() {},
  }));
  assert.match(html, /href="\/projects\/42"/);
  assert.match(html, /DA-042/);
  assert.match(html, /Dự án thử/);
  assert.match(html, /hạn nội bộ/);
});
