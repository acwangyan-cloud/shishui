"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { filterPlants, validateFeedback, buildIssueDraft, createFeedbackSession } = require("../app.js");

const plants = [
  { name: "芦苇", search: "Phragmites australis 禾本科 叶鞘", habit: "emergent" },
  { name: "荇菜", search: "Nymphoides peltata 龙胆科 黄色花", habit: "floating" },
  { name: "水烛", search: "Typha angustifolia 香蒲科 叶鞘", habit: "emergent submerged" }
];
const validFeedback = (overrides = {}) => ({
  type: "observation", plant: "芦苇", park: "公园东岸", date: "2024-02-29",
  detail: "在岸边观察到成片的芦苇。", source: "https://example.org/record?id=1&view=full", ...overrides
});

test("search matches every whitespace-separated token case-insensitively", () => {
  assert.deepEqual(filterPlants(plants, "  PHRAGMITES\t 叶鞘 \n", "all"), [plants[0]]);
  assert.deepEqual(filterPlants(plants, "芦苇 黄色花", "all"), []);
});

test("search and category are combined, including a plant with multiple habits", () => {
  assert.deepEqual(filterPlants(plants, "叶鞘", "emergent"), [plants[0], plants[2]]);
  assert.deepEqual(filterPlants(plants, "叶鞘", "submerged"), [plants[2]]);
  assert.deepEqual(filterPlants(plants, "叶鞘", "floating"), []);
});

test("empty or whitespace search and all category restore all original records", () => {
  assert.deepEqual(filterPlants(plants, "\n \t", "all"), plants);
  assert.deepEqual(filterPlants(plants, "", "floating"), [plants[1]]);
  assert.equal(plants[0].habit, "emergent");
});

test("missing search data does not prevent name-only matching", () => {
  const record = { name: "水生植物", habit: "floating" };
  assert.deepEqual(filterPlants([record], "水生", "all"), [record]);
  assert.deepEqual(filterPlants(plants, "", "not-a-category"), []);
});

test("valid feedback is normalized without changing embedded user text", () => {
  const result = validateFeedback(validFeedback({ park: "  公园东岸  ", detail: "  第一行记录有十个以上的字符。\n第二行保留。  " }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.data.park, "公园东岸");
  assert.equal(result.data.detail, "第一行记录有十个以上的字符。\n第二行保留。");
});

test("feedback permits empty optional fields but requires a known type and meaningful detail", () => {
  assert.equal(validateFeedback(validFeedback({ plant: "", park: "", date: "", source: "" })).valid, true);
  assert.equal(validateFeedback(validFeedback({ type: "other" })).valid, false);
  assert.ok(validateFeedback(validFeedback({ type: "other" })).errors.type);
  assert.ok(validateFeedback(validFeedback({ detail: " \n " })).errors.detail);
  assert.ok(validateFeedback(validFeedback({ detail: "123456789" })).errors.detail);
});

test("detail length uses Unicode code points with inclusive 10 and 600 limits", () => {
  for (const detail of ["字".repeat(10), "🌱".repeat(10), "字".repeat(600), "🌱".repeat(600)]) {
    assert.equal(validateFeedback(validFeedback({ detail })).valid, true);
  }
  for (const detail of ["🌱".repeat(9), "字".repeat(601), "🌱".repeat(601)]) {
    assert.ok(validateFeedback(validFeedback({ detail })).errors.detail);
  }
});

test("park and source enforce their limits without counting surrogate pairs twice", () => {
  assert.equal(validateFeedback(validFeedback({ park: "🌱".repeat(80) })).valid, true);
  assert.ok(validateFeedback(validFeedback({ park: "🌱".repeat(81) })).errors.park);
  assert.equal(validateFeedback(validFeedback({ source: "https://example.org/" + "a".repeat(280) })).valid, true);
  assert.ok(validateFeedback(validFeedback({ source: "https://example.org/" + "a".repeat(282) })).errors.source);
});

test("dates must be real calendar dates in YYYY-MM-DD format", () => {
  for (const date of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-00-01", "2024-01-00", "24-02-01", "0000-01-01", "2024-2-01", "2024-01-01T00:00:00Z"]) {
    assert.ok(validateFeedback(validFeedback({ date })).errors.date, date);
  }
  for (const date of ["2000-02-29", "1900-02-28", "2024-12-31"]) {
    assert.equal(validateFeedback(validFeedback({ date })).valid, true, date);
  }
});

test("sources accept only complete HTTP or HTTPS URLs", () => {
  for (const source of ["http://example.org/a", "HTTPS://example.org/资料?q=芦苇", "https://example.org/?a=1&b=2"]) {
    assert.equal(validateFeedback(validFeedback({ source })).valid, true, source);
  }
  for (const source of ["example.org", "https:", "https:example.org", "/relative", "ftp://example.org/a", "http://", "https://exa mple.org", "https://example.org/line\nbreak"]) {
    assert.ok(validateFeedback(validFeedback({ source })).errors.source, source);
  }
});

test("draft encoding keeps all field content in only the title and body query parameters", () => {
  const details = "观察内容保留 & # + ? = 和两行。\n第二行的植物仍待确认。";
  const draft = buildIssueDraft(validFeedback({ detail: details }));
  assert.equal(draft.valid, true);
  assert.equal(draft.tooLong, false);
  const url = new URL(draft.url);
  assert.equal(url.origin + url.pathname, "https://github.com/acwangyan-cloud/shishui/issues/new");
  assert.deepEqual([...url.searchParams.keys()], ["title", "body"]);
  assert.equal(url.searchParams.get("title"), "[观察记录] 芦苇");
  assert.equal(url.searchParams.get("body"), draft.body);
  assert.ok(draft.body.includes(details));
  assert.ok(draft.body.includes("https://example.org/record?id=1&view=full"));
  assert.ok(draft.body.includes("2024-02-29"));
});

test("corrections without a selected plant still produce a clearly labelled draft", () => {
  const draft = buildIssueDraft(validFeedback({ type: "correction", plant: "", park: "", date: "", source: "" }));
  assert.equal(draft.valid, true);
  assert.equal(draft.title, "[资料纠错] 未指定植物");
  assert.ok(draft.body.includes("未填写"));
});

test("long encoded drafts retain the complete text and fall back to an empty new-issue page", () => {
  const detail = "🌱".repeat(600);
  const draft = buildIssueDraft(validFeedback({ detail, park: "公".repeat(80), source: "https://example.org/" + "植".repeat(250) }));
  assert.equal(draft.valid, true);
  assert.equal(draft.tooLong, true);
  assert.equal(draft.url, "https://github.com/acwangyan-cloud/shishui/issues/new");
  assert.ok(draft.body.includes(detail));
  assert.ok(draft.body.includes("植".repeat(250)));
});

test("invalid feedback cannot produce a shareable issue draft", () => {
  const draft = buildIssueDraft(validFeedback({ detail: "太短" }));
  assert.equal(draft.valid, false);
  assert.equal(draft.url, "");
  assert.equal(draft.body, "");
});

test("editing invalidates a previously previewed draft so it cannot be reused", () => {
  assert.equal(typeof createFeedbackSession, "function");
  const session = createFeedbackSession();
  assert.equal(session.getDraft(), null);
  session.preview(validFeedback());
  assert.equal(session.getDraft().valid, true);
  session.invalidate();
  assert.equal(session.getDraft(), null);
  const replacement = session.preview(validFeedback({ type: "correction" }));
  assert.equal(session.getDraft(), replacement);
  assert.equal(replacement.title, "[资料纠错] 芦苇");
});

test("an invalid re-preview clears the previous valid draft", () => {
  assert.equal(typeof createFeedbackSession, "function");
  const session = createFeedbackSession();
  session.preview(validFeedback());
  assert.equal(session.preview(validFeedback({ detail: "短" })).valid, false);
  assert.equal(session.getDraft(), null);
});
