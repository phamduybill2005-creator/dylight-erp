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

test("native permission is requested on the first user gesture, once across page changes", async () => {
  const { watchDesktopPermission } = helpers();
  assert.equal(typeof watchDesktopPermission, "function", "automatic permission flow is missing");
  let prompts = 0;
  class BrowserNotification {
    static permission = "default";
    static requestPermission() { prompts++; return Promise.resolve("default"); }
  }
  const events = new EventTarget();
  Object.assign(events, { Notification: BrowserNotification, isSecureContext: true, navigator: { userActivation: { isActive: true } } });
  global.window = events;
  try {
    const clean = watchDesktopPermission();
    assert.equal(prompts, 0, "mounting alone must not ask without a user gesture");
    events.dispatchEvent(new Event("click"));
    assert.equal(prompts, 1);
    await new Promise(setImmediate);
    events.dispatchEvent(new Event("keydown"));
    clean();
    const cleanNextPage = watchDesktopPermission();
    events.dispatchEvent(new Event("click"));
    assert.equal(prompts, 1, "dismissing the prompt must not cause repeated requests after navigation");
    cleanNextPage();
  } finally { delete global.window; }
});

test("permission flow respects existing grants, blocks and unsupported browsers", () => {
  const { watchDesktopPermission } = helpers();
  assert.equal(typeof watchDesktopPermission, "function");
  let prompts = 0;
  class BrowserNotification {
    static permission = "granted";
    static requestPermission() { prompts++; return Promise.resolve("granted"); }
  }
  const events = new EventTarget();
  Object.assign(events, { Notification: BrowserNotification, isSecureContext: true, navigator: { userActivation: { isActive: true } } });
  global.window = events;
  try {
    for (const permission of ["granted", "denied"]) {
      BrowserNotification.permission = permission;
      const clean = watchDesktopPermission();
      events.dispatchEvent(new Event("click"));
      clean();
    }
    delete events.Notification;
    const clean = watchDesktopPermission();
    events.dispatchEvent(new Event("click"));
    clean();
    assert.equal(prompts, 0);
  } finally { delete global.window; }
});

test("non-user events do not request permission and unmount removes pending listeners", () => {
  const { watchDesktopPermission } = helpers();
  assert.equal(typeof watchDesktopPermission, "function");
  let prompts = 0;
  class BrowserNotification {
    static permission = "default";
    static requestPermission() { prompts++; return Promise.resolve("granted"); }
  }
  const activation = { isActive: false };
  const events = new EventTarget();
  Object.assign(events, { Notification: BrowserNotification, isSecureContext: true, navigator: { userActivation: activation } });
  global.window = events;
  try {
    const clean = watchDesktopPermission();
    events.dispatchEvent(new Event("click"));
    assert.equal(prompts, 0);
    activation.isActive = true;
    events.dispatchEvent(new Event("keydown"));
    assert.equal(prompts, 1);
    clean();
    // A fresh module models a new document where no gesture has occurred yet.
    const nextClean = helpers().watchDesktopPermission();
    nextClean();
    events.dispatchEvent(new Event("click"));
    assert.equal(prompts, 1);
  } finally { delete global.window; }
});

test("the first click still requests permission when a child stops event bubbling", () => {
  const { watchDesktopPermission } = helpers();
  let prompts = 0;
  const listeners = [];
  class BrowserNotification {
    static permission = "default";
    static requestPermission() { prompts++; return Promise.resolve("granted"); }
  }
  global.window = {
    Notification: BrowserNotification, isSecureContext: true, navigator: { userActivation: { isActive: true } },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      const index = listeners.findIndex((listener) => listener.type === type && listener.fn === fn && listener.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  try {
    const clean = watchDesktopPermission();
    // A child that stops propagation is reached after the window's capture phase.
    listeners.filter((listener) => listener.type === "click" && listener.capture?.capture === true).forEach((listener) => listener.fn());
    assert.equal(prompts, 1);
    clean();
    assert.equal(listeners.length, 0);
  } finally { delete global.window; }
});
