"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const modulePath = path.join(__dirname, "../feedback.js");
const feedback = fs.existsSync(modulePath) ? require(modulePath) : {};
const input = (overrides = {}) => ({ type: "observation", plant: "芦苇", park: "公园东岸", date: "2025-05-12", detail: "在岸边观察到成片的芦苇。", ...overrides });
const item = (overrides = {}) => ({ id: "saved-1", ...input(), createdAt: "2026-10-22T02:30:00.000Z", ...overrides });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const token = () => json({ token: "short-lived-token", expiresAt: "2099-01-01T00:00:00.000Z" });
function client(fetch, options = {}) {
  assert.equal(typeof feedback.createFeedbackClient, "function", "public feedback client is available");
  let sequence = 0;
  return feedback.createFeedbackClient({ fetch, uuid: () => "00000000-0000-4000-8000-" + String(++sequence).padStart(12, "0"), ...options });
}

test("validation allows empty optional fields and normalizes only boundary whitespace", () => {
  assert.equal(typeof feedback.validateFeedback, "function");
  const result = feedback.validateFeedback(input({ plant: "", park: "  ", date: "", detail: "  第一行的观察记录。\n第二行保留原文。  ", source: "discarded" }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, { type: "observation", plant: "", park: "", date: "", detail: "第一行的观察记录。\n第二行保留原文。" });
});

test("validation rejects unknown plant names, types and non-calendar dates", () => {
  assert.equal(typeof feedback.validateFeedback, "function");
  for (const overrides of [{ plant: "不存在的植物" }, { type: "unknown" }, { date: "2025-02-29" }, { date: "2025-13-01" }, { date: "0000-01-01" }, { date: "25-01-01" }]) {
    assert.equal(feedback.validateFeedback(input(overrides)).valid, false);
  }
  assert.equal(feedback.validateFeedback(input({ date: "2024-02-29" })).valid, true);
});

test("detail and park limits count Unicode code points with inclusive boundaries", () => {
  assert.equal(typeof feedback.validateFeedback, "function");
  for (const length of [10, 600]) assert.equal(feedback.validateFeedback(input({ detail: "🌱".repeat(length), park: "🌱".repeat(80) })).valid, true);
  for (const length of [9, 601]) assert.ok(feedback.validateFeedback(input({ detail: "🌱".repeat(length) })).errors.detail);
  assert.ok(feedback.validateFeedback(input({ park: "🌱".repeat(81) })).errors.park);
});

test("a validated submission gets a token then sends one public payload and prepends persisted item", async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push([url, options]);
    return url.endsWith("/api/form-token") ? token() : json({ item: item() }, 201);
  });
  const result = await api.submit(input());
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], "https://shishui-feedback.coolharp512.chatgpt.site/api/form-token");
  assert.equal(calls[1][0], "https://shishui-feedback.coolharp512.chatgpt.site/api/feedback");
  assert.deepEqual(JSON.parse(calls[1][1].body), { requestId: "00000000-0000-4000-8000-000000000001", token: "short-lived-token", ...input() });
  assert.equal(calls[1][1].credentials, "omit");
  assert.equal(api.getState().submitStatus, "success");
  assert.deepEqual(api.getState().items, [item()]);
});

test("invalid fields never send a network request", async () => {
  const api = client(async () => { assert.fail("invalid fields must not reach HTTP"); });
  const result = await api.submit(input({ detail: "太短" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.detail);
});

test("a failed response after POST is uncertain and retries reuse request ID", async () => {
  const ids = [];
  const api = client(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    ids.push(JSON.parse(options.body).requestId);
    if (ids.length === 1) throw new TypeError("connection lost after save");
    return json({ item: item() });
  });
  assert.equal((await api.submit(input())).ok, false);
  assert.equal(api.getState().submitStatus, "uncertain");
  assert.match(api.getState().submitMessage, /暂未确认/);
  assert.equal((await api.submit(input())).ok, true);
  assert.deepEqual(ids, ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000001"]);
});

for (const tokenFailure of ["network", "rate-limit"]) {
  test("an uncertain logical submission stays uncertain when its retry token fails: " + tokenFailure, async () => {
    const ids = [];
    let tokenRequests = 0;
    const api = client(async (url, options) => {
      if (url.endsWith("/api/form-token")) {
        tokenRequests++;
        if (tokenRequests === 2) {
          if (tokenFailure === "rate-limit") return json({ error: "请求较多，请稍后再试。" }, 429);
          throw new TypeError("token service offline");
        }
        return token();
      }
      ids.push(JSON.parse(options.body).requestId);
      if (ids.length === 1) throw new TypeError("connection lost after save");
      return json({ item: item() });
    });
    await api.submit(input());
    await api.submit(input());
    assert.equal(api.getState().submitStatus, "uncertain");
    assert.match(api.getState().submitMessage, /暂未确认/);
    assert.doesNotMatch(api.getState().submitMessage, /尚未发送/);
    assert.equal((await api.submit(input())).ok, true);
    assert.deepEqual(ids, ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000001"]);
  });
}

test("a later rejected retry cannot settle an uncertain earlier POST, but editing clears uncertainty", async () => {
  let posts = 0;
  let tokensUnavailable = false;
  const api = client(async url => {
    if (url.endsWith("/api/form-token")) {
      if (tokensUnavailable) throw new TypeError("offline");
      return token();
    }
    if (++posts === 1) throw new TypeError("connection lost after save");
    return json({ error: "请求较多，请稍后再试。" }, 429);
  });
  await api.submit(input());
  await api.submit(input());
  assert.equal(api.getState().submitStatus, "uncertain");
  tokensUnavailable = true;
  api.edit();
  await api.submit(input());
  assert.equal(api.getState().submitStatus, "error");
  assert.match(api.getState().submitMessage, /尚未发送/);
});

test("a known rejected POST followed by token failure never says the logical submission was not sent", async () => {
  let tokenRequests = 0;
  const api = client(async url => {
    if (url.endsWith("/api/form-token")) {
      if (++tokenRequests > 1) throw new TypeError("offline");
      return token();
    }
    return json({ error: "请求较多，请稍后再试。" }, 429);
  });
  await api.submit(input());
  await api.submit(input());
  assert.equal(api.getState().submitStatus, "error");
  assert.doesNotMatch(api.getState().submitMessage, /尚未发送/);
});

test("an explicit edit and a confirmed success each invalidate the prior request ID", async () => {
  const ids = [];
  const api = client(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    ids.push(JSON.parse(options.body).requestId);
    if (ids.length === 1) throw new TypeError("offline");
    return json({ item: item({ id: "saved-" + ids.length }) });
  });
  await api.submit(input());
  api.edit();
  await api.submit(input());
  await api.submit(input());
  assert.equal(new Set(ids).size, 3);
});

test("changed payload cannot reuse a request ID from an uncertain submission", async () => {
  const ids = [];
  const api = client(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    ids.push(JSON.parse(options.body).requestId);
    throw new TypeError("offline");
  });
  await api.submit(input());
  await api.submit(input({ park: "公园西岸" }));
  assert.equal(new Set(ids).size, 2);
});

test("repeat clicks during a submission cannot create another token or POST", async () => {
  let release;
  let posts = 0;
  let tokens = 0;
  const api = client(async (url) => {
    if (url.endsWith("/api/form-token")) { tokens++; return token(); }
    posts++;
    return new Promise(resolve => { release = resolve; });
  });
  const first = api.submit(input());
  const second = await api.submit(input());
  assert.equal(second.busy, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tokens, 1);
  assert.equal(posts, 1);
  release(json({ item: item() }));
  await first;
});

test("HTTP 429 is a clear retryable error and never a publication success", async () => {
  const api = client(async url => url.endsWith("/api/form-token") ? token() : json({ error: "请求较多，请稍后再试。" }, 429));
  assert.equal((await api.submit(input())).ok, false);
  assert.equal(api.getState().submitStatus, "error");
  assert.match(api.getState().submitMessage, /稍后/);
  assert.equal(api.getState().items.length, 0);
});

test("token-fetch failure reports not sent instead of uncertain publication", async () => {
  const api = client(async () => { throw new TypeError("offline"); });
  await api.submit(input());
  assert.equal(api.getState().submitStatus, "error");
  assert.match(api.getState().submitMessage, /尚未发送/);
});

test("a POST timeout aborts its request and preserves retry identity", async () => {
  const ids = [];
  const api = client(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    ids.push(JSON.parse(options.body).requestId);
    if (ids.length === 1) return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    return json({ item: item() });
  }, { timeoutMs: 5 });
  await api.submit(input());
  assert.equal(api.getState().submitStatus, "uncertain");
  await api.submit(input());
  assert.equal(ids[0], ids[1]);
});

test("malformed success JSON cannot be shown as published", async () => {
  const api = client(async url => url.endsWith("/api/form-token") ? token() : json({ ok: true }));
  await api.submit(input());
  assert.equal(api.getState().submitStatus, "uncertain");
  assert.equal(api.getState().items.length, 0);
});

test("public list distinguishes initial loading, loaded empty and failed reads", async () => {
  let release;
  let failures = false;
  const api = client(async () => {
    if (failures) throw new TypeError("offline");
    return new Promise(resolve => { release = resolve; });
  });
  const pending = api.load();
  assert.equal(api.getState().listStatus, "loading");
  release(json({ items: [], nextCursor: null }));
  await pending;
  assert.equal(api.getState().listStatus, "loaded");
  assert.equal(api.getState().items.length, 0);
  failures = true;
  await api.load();
  assert.equal(api.getState().listStatus, "error");
});

test("pagination uses opaque cursor, appends without duplicates and retries same failed page", async () => {
  const calls = [];
  const api = client(async url => {
    calls.push(url);
    if (calls.length === 1) return json({ items: [item()], nextCursor: "cursor+/= value" });
    if (calls.length === 2) throw new Error("offline");
    return json({ items: [item(), item({ id: "saved-2", createdAt: "2026-10-21T00:00:00.000Z" })], nextCursor: null });
  });
  await api.load();
  await api.loadMore();
  assert.equal(api.getState().items.length, 1);
  await api.loadMore();
  assert.equal(calls[1], "https://shishui-feedback.coolharp512.chatgpt.site/api/feedback?cursor=cursor%2B%2F%3D%20value");
  assert.equal(calls[2], calls[1]);
  assert.deepEqual(api.getState().items.map(row => row.id), ["saved-1", "saved-2"]);
  assert.equal(api.getState().nextCursor, null);
});

test("a failed refresh retains a confirmed new message and success status", async () => {
  const api = client(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    if (options.method === "POST") return json({ item: item() });
    throw new Error("GET failed");
  });
  await api.submit(input());
  await api.load();
  assert.deepEqual(api.getState().items, [item()]);
  assert.equal(api.getState().submitStatus, "success");
  assert.equal(api.getState().listStatus, "error");
});

test("an earlier in-flight list cannot erase a subsequently confirmed message", async () => {
  let release;
  const api = client(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    if (options.method === "POST") return json({ item: item() });
    return new Promise(resolve => { release = resolve; });
  });
  const initial = api.load();
  await api.submit(input());
  release(json({ items: [], nextCursor: null }));
  await initial;
  assert.deepEqual(api.getState().items, [item()]);
});

test("submission time is explicitly Beijing time across UTC date boundaries", () => {
  assert.equal(typeof feedback.formatBeijingTime, "function");
  assert.equal(feedback.formatBeijingTime("2026-10-21T18:30:00.000Z"), "2026-10-22 02:30（北京时间）");
});

class Element extends EventTarget {
  constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ""; this._text = ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set innerHTML(value) { assert.fail("public feedback must never use HTML parsing"); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  setCustomValidity(value) { this.validationMessage = value; }
}

function fixture(fetch) {
  assert.equal(typeof feedback.init, "function");
  const elements = new Map();
  for (const id of ["feedback-form", "feedback-submit", "feedback-status", "feedback-list", "feedback-list-status", "feedback-retry", "feedback-more", "participate"]) elements.set(id, new Element());
  const fields = Object.entries(input()).map(([name, value]) => Object.assign(new Element(name === "detail" ? "textarea" : "input"), { name, value }));
  fields.namedItem = name => fields.find(field => field.name === name);
  const form = elements.get("feedback-form");
  form.elements = fields;
  form.reportValidity = () => fields.every(field => !field.validationMessage);
  form.reset = () => { fields.forEach(field => { field.value = field.name === "type" ? "observation" : ""; }); form.dispatchEvent(new Event("reset")); };
  const link = Object.assign(new Element("a"), { dataset: { name: "荷" } });
  const document = { getElementById: id => elements.get(id) || null, createElement: tag => new Element(tag), querySelectorAll: selector => selector === ".feedback-for" ? [link] : [] };
  const api = feedback.init(document, { fetch, uuid: () => "00000000-0000-4000-8000-000000000009" });
  return { elements, fields, form, link, api };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("DOM renders visitor punctuation as plain text and includes Beijing timestamp", async () => {
  const detail = "观察记录：<叶片> & 花朵，保留原来的换行。\n尚待核对。";
  const dom = fixture(async () => json({ items: [item({ detail })], nextCursor: null }));
  await settle();
  const list = dom.elements.get("feedback-list");
  assert.equal(list.children.length, 1);
  assert.ok(list.textContent.includes(detail));
  assert.ok(list.textContent.includes("2026-10-22 10:30（北京时间）"));
});

test("DOM keeps entered content on HTTP error and resets only confirmed success", async () => {
  let fail = true;
  const dom = fixture(async (url, options) => {
    if (url.endsWith("/api/form-token")) return token();
    if (options.method === "POST") return fail ? json({ error: "请稍后再试" }, 429) : json({ item: item() });
    return json({ items: [], nextCursor: null });
  });
  await settle();
  dom.form.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  assert.equal(dom.fields.namedItem("detail").value, "在岸边观察到成片的芦苇。");
  assert.equal(dom.elements.get("feedback-submit").disabled, false);
  fail = false;
  dom.form.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  assert.equal(dom.fields.namedItem("detail").value, "");
  assert.match(dom.elements.get("feedback-status").textContent, /留言已公开/);
  assert.equal(dom.elements.get("feedback-list").children.length, 1);
});

test("DOM error retry is distinct from empty list and reloads public messages", async () => {
  let fail = true;
  const dom = fixture(async () => { if (fail) throw new Error("offline"); return json({ items: [], nextCursor: null }); });
  await settle();
  assert.match(dom.elements.get("feedback-list-status").textContent, /加载失败/);
  assert.equal(dom.elements.get("feedback-retry").hidden, false);
  fail = false;
  dom.elements.get("feedback-retry").dispatchEvent(new Event("click"));
  await settle();
  assert.match(dom.elements.get("feedback-list-status").textContent, /还没有留言/);
  assert.equal(dom.elements.get("feedback-retry").hidden, true);
});

test("plant-card action preselects the plant and focuses detail without submitting", async () => {
  const dom = fixture(async () => json({ items: [], nextCursor: null }));
  await settle();
  const click = Object.assign(new Event("click", { cancelable: true }), { button: 0 });
  dom.link.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(dom.fields.namedItem("plant").value, "荷");
  assert.equal(dom.fields.namedItem("detail").focused, true);
  assert.equal(dom.api.getState().submitStatus, "idle");
});

