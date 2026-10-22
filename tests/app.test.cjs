"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { filterPlants, init } = require("../app.js");

const plants = [
  { name: "芦苇", search: "Phragmites australis 禾本科 叶鞘", habit: "emergent" },
  { name: "荇菜", search: "Nymphoides peltata 龙胆科 黄色花", habit: "floating" },
  { name: "水烛", search: "Typha angustifolia 香蒲科 叶鞘", habit: "emergent submerged" }
];

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

// Only the DOM surface used by catalogue initialization; event dispatch uses
// Node's real EventTarget so assertions exercise the actual production handlers.
function catalogueFixture() {
  function element(properties = {}, attributes = {}) {
    return Object.assign(new EventTarget(), {
      dataset: {}, value: "", hidden: false, textContent: "",
      getAttribute: (name) => attributes[name] ?? null
    }, properties);
  }
  const search = element();
  const habit = element({ value: "all" });
  const count = element();
  const noResults = element();
  const lotus = element({ id: "plant-he", dataset: { name: "荷", search: "Nelumbo nucifera", habit: "emergent" } });
  const floating = element({ id: "plant-xingcai", dataset: { name: "荇菜", search: "Nymphoides peltata", habit: "floating" } });
  const comparisonLink = element({}, { href: "#plant-he" });
  const unknownLink = element({}, { href: "#plant-missing" });
  const elements = new Map([
    ["plant-search", search], ["habit-filter", habit],
    ["result-count", count], ["no-results", noResults],
    ["plant-he", lotus], ["plant-xingcai", floating]
  ]);
  const document = {
    documentElement: { dataset: {} },
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => {
      if (selector === "[data-plant-card]") return [lotus, floating];
      if (selector === 'a[href^="#plant-"]') return [comparisonLink, unknownLink];
      return [];
    }
  };
  init(document);
  search.value = "荇菜";
  habit.value = "floating";
  search.dispatchEvent(new Event("input"));
  return { search, habit, count, noResults, lotus, floating, comparisonLink, unknownLink };
}

function linkClick(overrides = {}) {
  return Object.assign(new Event("click", { cancelable: true }), {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides
  });
}

test("a comparison link clears both filters and reveals its card before default navigation", () => {
  const fixture = catalogueFixture();
  assert.equal(fixture.lotus.hidden, true);
  assert.equal(fixture.floating.hidden, false);
  const click = linkClick();
  fixture.comparisonLink.dispatchEvent(click);
  assert.equal(fixture.lotus.hidden, false);
  assert.equal(fixture.search.value, "");
  assert.equal(fixture.habit.value, "all");
  assert.equal(fixture.floating.hidden, false);
  assert.equal(fixture.noResults.hidden, true);
  assert.match(fixture.count.textContent, /2\s*\/\s*2/);
  assert.equal(click.defaultPrevented, false);
});

test("modified comparison-link activations do not change the current page's filters", () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const fixture = catalogueFixture();
    const click = linkClick(modifier);
    fixture.comparisonLink.dispatchEvent(click);
    assert.equal(fixture.lotus.hidden, true);
    assert.equal(fixture.search.value, "荇菜");
    assert.equal(fixture.habit.value, "floating");
    assert.equal(click.defaultPrevented, false);
  }
});

test("links to unknown card IDs do not reset the catalogue", () => {
  const fixture = catalogueFixture();
  const click = linkClick();
  fixture.unknownLink.dispatchEvent(click);
  assert.equal(fixture.lotus.hidden, true);
  assert.equal(fixture.search.value, "荇菜");
  assert.equal(fixture.habit.value, "floating");
  assert.equal(click.defaultPrevented, false);
});

