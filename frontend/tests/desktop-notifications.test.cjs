const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function helpers() {
  const file = "src/lib/desktop-notifications.ts";
  const mod = fs.existsSync(path.resolve(__dirname, "..", file)) ? loadTypeScript(file) : {};
  assert.equal(typeof mod.showDesktopNotification, "function", "desktop notification helper is missing");
  return mod;
}

test("first new unread notification is reported even when initial inbox is empty", () => {
  const { createUnreadNotificationTracker } = helpers();
  const track = createUnreadNotificationTracker();
  assert.deepEqual(track([]), []);
  const first = { id: 1, is_read: false };
  assert.deepEqual(track([first]), [first]);
  assert.deepEqual(track([first]), []);
});

test("initial backlog, read records and previously seen records do not alert again", () => {
  const track = helpers().createUnreadNotificationTracker();
  assert.deepEqual(track([{ id: 1, is_read: false }]), []);
  assert.deepEqual(track([{ id: 2, is_read: true }, { id: 1, is_read: false }]), []);
  assert.deepEqual(track([]), []);
  assert.deepEqual(track([{ id: 1, is_read: false }]), []);
  assert.deepEqual(track([{ id: 3, is_read: false }]).map((n) => n.id), [3]);
});

test("desktop alert is shown while tab is hidden and focuses, closes and opens content on click", () => {
  const { showDesktopNotification } = helpers();
  let notification;
  let focused = 0;
  let opened = 0;
  let closed = 0;
  class BrowserNotification {
    static permission = "granted";
    constructor(title, options) { Object.assign(this, { title, options }); notification = this; }
    close() { closed += 1; }
  }
  global.window = { Notification: BrowserNotification, isSecureContext: true, focus: () => focused++ };
  global.document = { visibilityState: "hidden" };
  try {
    assert.equal(showDesktopNotification("New announcement", { body: "Meeting", tag: "notice-3" }, () => opened++), true);
    assert.equal(notification.title, "New announcement");
    assert.equal(notification.options.body, "Meeting");
    assert.equal(notification.options.tag, "notice-3");
    assert.equal(notification.options.icon, "/logo.png");
    notification.onclick();
    assert.equal(focused, 1);
    assert.equal(closed, 1);
    assert.equal(opened, 1);
  } finally { delete global.window; delete global.document; }
});

test("unsupported, blocked or not-yet-authorized browsers do not prompt during delivery", () => {
  const { showDesktopNotification, requestDesktopPermission } = helpers();
  assert.equal(showDesktopNotification("Notice"), false);
  let prompts = 0;
  class BrowserNotification {
    static permission = "denied";
    static requestPermission() { prompts++; return Promise.resolve("granted"); }
    constructor() { throw new Error("must not create a blocked notification"); }
  }
  global.window = { Notification: BrowserNotification, isSecureContext: true };
  try {
    assert.equal(showDesktopNotification("Notice"), false);
    BrowserNotification.permission = "default";
    assert.equal(showDesktopNotification("Notice"), false);
    assert.equal(prompts, 0);
    return requestDesktopPermission().then((permission) => {
      assert.equal(permission, "granted");
      assert.equal(prompts, 1);
    }).finally(() => delete global.window);
  } catch (error) { delete global.window; throw error; }
});

test("browser delivery failures are caught without breaking app updates", () => {
  const { showDesktopNotification } = helpers();
  class BrowserNotification {
    static permission = "granted";
    constructor() { throw new TypeError("notifications unavailable on this browser"); }
  }
  global.window = { Notification: BrowserNotification, isSecureContext: true };
  try { assert.equal(showDesktopNotification("Notice"), false); }
  finally { delete global.window; }
});

test("chat alerts for the open conversation when tab is hidden, but not while reading it", () => {
  const createChatNotificationTracker = helpers().createChatNotificationTracker;
  assert.equal(typeof createChatNotificationTracker, "function");
  const track = createChatNotificationTracker();
  const room = { id: 9, unread: 0, last_message_at: null, last_message: null };
  assert.deepEqual(track([room], 9, false), []);
  const first = { ...room, unread: 1, last_message_at: "2026-10-01T10:00:00", last_message: "Hello" };
  assert.deepEqual(track([first], 9, false), [first]);
  assert.deepEqual(track([first], 9, false), []);
  const second = { ...first, unread: 2, last_message_at: "2026-10-01T10:01:00", last_message: "Again" };
  assert.deepEqual(track([second], 9, true), []);
  const third = { ...second, unread: 3, last_message_at: "2026-10-01T10:02:00" };
  assert.deepEqual(track([third], null, true), [third]);
});

test("initial chat backlog is quiet and a new conversation alerts after the first refresh", () => {
  const createChatNotificationTracker = helpers().createChatNotificationTracker;
  assert.equal(typeof createChatNotificationTracker, "function");
  const track = createChatNotificationTracker();
  const old = { id: 1, unread: 2, last_message_at: "old", last_message: "Old message" };
  assert.deepEqual(track([old], null, false), []);
  const fresh = { id: 2, unread: 1, last_message_at: "new", last_message: "New message" };
  assert.deepEqual(track([fresh, old], null, false), [fresh]);
});

test("clicks are delivered to the current page after the original page unmounts", () => {
  const { showDesktopNotification, dispatchDesktopClick, DESKTOP_CLICK_EVENT } = helpers();
  assert.equal(typeof dispatchDesktopClick, "function");
  const events = new EventTarget();
  let notification;
  let oldClicks = 0;
  let currentClicks = 0;
  class BrowserNotification {
    static permission = "granted";
    constructor() { notification = this; }
    close() {}
  }
  global.window = { Notification: BrowserNotification, isSecureContext: true, focus() {}, dispatchEvent: (event) => events.dispatchEvent(event) };
  try {
    const oldHandler = () => oldClicks++;
    events.addEventListener(DESKTOP_CLICK_EVENT, oldHandler);
    showDesktopNotification("Chat", {}, () => dispatchDesktopClick({ kind: "chat", conversationId: 9 }));
    events.removeEventListener(DESKTOP_CLICK_EVENT, oldHandler);
    events.addEventListener(DESKTOP_CLICK_EVENT, (event) => {
      assert.deepEqual(event.detail, { kind: "chat", conversationId: 9 });
      currentClicks++;
    });
    notification.onclick();
    assert.equal(oldClicks, 0);
    assert.equal(currentClicks, 1);
  } finally { delete global.window; }
});

test("a live refresh arriving during a request is queued and overlapping requests stay serialized", async () => {
  const createRefreshQueue = helpers().createRefreshQueue;
  assert.equal(typeof createRefreshQueue, "function");
  let requests = 0;
  const finishes = [];
  const refresh = createRefreshQueue(() => { requests++; return new Promise((resolve) => finishes.push(resolve)); });
  refresh();
  refresh();
  refresh();
  assert.equal(requests, 1);
  finishes.shift()();
  await new Promise(setImmediate);
  assert.equal(requests, 2);
  finishes.shift()();
  await new Promise(setImmediate);
  assert.equal(requests, 2);
});
