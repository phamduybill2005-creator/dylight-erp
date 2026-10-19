const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

const component = () => loadTypeScript("src/components/leave-withdraw-button.tsx");
const leave = { id: 42, user_id: 7, status: "PENDING", source: "LEAVE" };

test("only the sender of an undecided leave sees withdrawal", () => {
  const { canWithdrawLeave } = component();
  assert.equal(canWithdrawLeave(7, leave), true);
  assert.equal(canWithdrawLeave(8, leave), false);
  for (const status of ["APPROVED", "REJECTED", "CANCELED"]) {
    assert.equal(canWithdrawLeave(7, { ...leave, status }), false);
  }
  assert.equal(canWithdrawLeave(7, { ...leave, source: "SCHEDULE" }), false);
  assert.equal(canWithdrawLeave(7, { ...leave, source: null }), true);
});

test("withdraw button is accessible, busy-safe and hidden from other users", () => {
  const { LeaveWithdrawButton } = component();
  const render = (props) => renderToStaticMarkup(React.createElement(LeaveWithdrawButton,
    { leave, userId: 7, busy: false, withdrawing: false, onWithdraw() {}, ...props }));
  const normal = render({});
  assert.match(normal, /Thu hồi/);
  assert.match(normal, /type="button"/);
  assert.doesNotMatch(normal, / disabled=""/);
  assert.match(render({ busy: true }), / disabled=""/);
  assert.match(render({ busy: true, withdrawing: true }), /Đang thu hồi/);
  assert.equal(render({ userId: 8 }), "");
  assert.equal(render({ leave: { ...leave, status: "CANCELED" } }), "");
});
