(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WetlandGuide = api;
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", function () { api.init(root.document); });
    } else {
      api.init(root.document);
    }
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function asText(value) {
    return value == null ? "" : String(value);
  }

  function filterPlants(plants, query, habit) {
    var tokens = asText(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
    var category = habit || "all";
    return plants.filter(function (plant) {
      var text = (asText(plant.name) + " " + asText(plant.search)).toLowerCase();
      var habits = asText(plant.habit).split(/\s+/);
      return (category === "all" || habits.indexOf(category) !== -1) &&
        tokens.every(function (token) { return text.indexOf(token) !== -1; });
    });
  }

  function initFilters(document) {
    var search = document.getElementById("plant-search");
    var habit = document.getElementById("habit-filter");
    var count = document.getElementById("result-count");
    var noResults = document.getElementById("no-results");
    var clear = document.getElementById("clear-filters");
    if (!search || !habit) return;
    var plants = Array.from(document.querySelectorAll("[data-plant-card]")).map(function (card) {
      return { name: card.dataset.name, search: card.dataset.search, habit: card.dataset.habit, card: card };
    });
    function update() {
      var visible = new Set(filterPlants(plants, search.value, habit.value));
      plants.forEach(function (plant) { plant.card.hidden = !visible.has(plant); });
      if (count) count.textContent = "显示 " + visible.size + " / " + plants.length + " 张植物卡片";
      if (noResults) noResults.hidden = visible.size !== 0;
    }
    search.addEventListener("input", update);
    habit.addEventListener("change", update);
    if (clear) clear.addEventListener("click", function () {
      search.value = "";
      habit.value = "all";
      update();
      search.focus();
    });
    document.querySelectorAll('a[href^="#plant-"]').forEach(function (link) {
      var targetId = link.getAttribute("href").slice(1);
      if (!plants.some(function (plant) { return plant.card.id === targetId; })) return;
      link.addEventListener("click", function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        search.value = "";
        habit.value = "all";
        update(); // Reveal the target before the anchor's normal fragment navigation.
      });
    });
    update();
  }

  function initPhotos(document) {
    var dialog = document.getElementById("photo-dialog");
    var title = document.getElementById("photo-title");
    var image = document.getElementById("photo-image");
    var original = document.getElementById("photo-original");
    var close = document.getElementById("photo-close");
    if (!dialog || typeof dialog.showModal !== "function" || !title || !image || !original || !close) return;
    var opener = null;
    document.querySelectorAll(".photo-open").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        var name = link.dataset.name || "植物";
        title.textContent = name + " · 照片";
        image.src = link.href;
        image.alt = name + "照片放大图";
        original.href = link.href;
        try {
          dialog.showModal();
        } catch (error) {
          return; // The ordinary image link remains usable without dialog support.
        }
        event.preventDefault();
        opener = link;
        close.focus();
      });
    });
    close.addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener("click", function (event) {
      var bounds = dialog.getBoundingClientRect();
      if (event.target === dialog &&
          (event.clientX < bounds.left || event.clientX > bounds.right ||
           event.clientY < bounds.top || event.clientY > bounds.bottom)) {
        dialog.close();
      }
    });
    dialog.addEventListener("close", function () {
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    });
  }

  function init(document) {
    if (!document || document.documentElement.dataset.wetlandInitialized === "true") return;
    initFilters(document);
    initPhotos(document);
    document.querySelectorAll("[data-js-enable]").forEach(function (control) {
      control.disabled = false;
    });
    document.documentElement.dataset.wetlandInitialized = "true";
  }

  return {
    filterPlants: filterPlants,
    init: init
  };
}));

