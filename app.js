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

  var ISSUE_URL = "https://github.com/acwangyan-cloud/shishui/issues/new";
  var FIELD_NAMES = ["type", "plant", "park", "date", "detail", "source"];

  function asText(value) {
    return value == null ? "" : String(value);
  }

  function characterCount(value) {
    return Array.from(value).length;
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

  function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-").map(Number);
    var year = parts[0];
    var month = parts[1];
    var day = parts[2];
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  }

  function isSourceUrl(value) {
    if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
    try {
      var url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function validateFeedback(input) {
    var data = {};
    var errors = {};
    FIELD_NAMES.forEach(function (name) { data[name] = asText(input && input[name]).trim(); });
    if (data.type !== "observation" && data.type !== "correction") {
      errors.type = "请选择观察记录或资料纠错。";
    }
    if (characterCount(data.park) > 80) errors.park = "地点请控制在 80 个字符以内。";
    if (data.date && !isCalendarDate(data.date)) errors.date = "请填写有效日期（年-月-日）。";
    var detailLength = characterCount(data.detail);
    if (detailLength < 10 || detailLength > 600) errors.detail = "详细说明请填写 10–600 个字符。";
    if (data.source && (characterCount(data.source) > 300 || !isSourceUrl(data.source))) {
      errors.source = "参考链接请使用完整的 http:// 或 https:// 地址，并控制在 300 个字符以内。";
    }
    return { valid: Object.keys(errors).length === 0, errors: errors, data: data };
  }

  function buildIssueDraft(input) {
    var validation = validateFeedback(input);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors, title: "", body: "", url: "", tooLong: false };
    }
    var data = validation.data;
    var typeLabel = data.type === "correction" ? "资料纠错" : "观察记录";
    var title = "[" + typeLabel + "] " + (data.plant || "未指定植物");
    var body = [
      "类型：" + typeLabel,
      "植物：" + (data.plant || "未指定植物"),
      "地点：" + (data.park || "未填写"),
      "日期：" + (data.date || "未填写"),
      "",
      "详细说明：",
      data.detail,
      "",
      "参考链接：" + (data.source || "未填写"),
      "",
      "说明：这是一份用户提供、尚待核实的记录或纠错建议，不代表现场水质测量或已验证的治理效果。",
      "提交前请再次检查内容，勿包含个人联系方式、他人隐私或不适合公开的信息。"
    ].join("\n");
    var url = ISSUE_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
    var tooLong = url.length > 7500;
    return { valid: true, errors: {}, title: title, body: body, url: tooLong ? ISSUE_URL : url, tooLong: tooLong };
  }

  function createFeedbackSession() {
    var currentDraft = null;
    return {
      preview: function (input) {
        var draft = buildIssueDraft(input);
        currentDraft = draft.valid ? draft : null;
        return draft;
      },
      invalidate: function () { currentDraft = null; },
      getDraft: function () { return currentDraft; }
    };
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

  function initFeedback(document) {
    var form = document.getElementById("feedback-form");
    var preview = document.getElementById("feedback-preview");
    var previewText = document.getElementById("feedback-preview-text");
    var githubLink = document.getElementById("feedback-github-link");
    var status = document.getElementById("feedback-status");
    var edit = document.getElementById("feedback-edit");
    var download = document.getElementById("feedback-download");
    if (!form || !preview || !previewText || !githubLink || !status) return false;
    var session = createFeedbackSession();
    var view = document.defaultView;

    function readFields() {
      var input = {};
      FIELD_NAMES.forEach(function (name) {
        var field = form.elements.namedItem(name);
        input[name] = field ? field.value : "";
      });
      return input;
    }

    function setErrors(errors) {
      FIELD_NAMES.forEach(function (name) {
        form.querySelectorAll('[name="' + name + '"]').forEach(function (field) {
          if (typeof field.setCustomValidity === "function") field.setCustomValidity(errors[name] || "");
        });
      });
    }

    function invalidatePreview() {
      var hadDraft = Boolean(session.getDraft());
      session.invalidate();
      preview.hidden = true;
      previewText.textContent = "";
      githubLink.removeAttribute("href");
      githubLink.setAttribute("aria-disabled", "true");
      setErrors({});
      status.textContent = hadDraft ? "内容已修改，请重新预览后再前往 GitHub。" : "";
    }

    function focusDetail() {
      var detail = form.elements.namedItem("detail");
      if (detail) detail.focus();
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      invalidatePreview();
      var input = readFields();
      var validation = validateFeedback(input);
      setErrors(validation.errors);
      var nativeValid = form.reportValidity();
      if (!validation.valid || !nativeValid) {
        status.textContent = "请检查标出的字段。内容尚未发送，也未保存。";
        return;
      }
      var draft = session.preview(input);
      previewText.textContent = draft.title + "\n\n" + draft.body;
      preview.hidden = false;
      githubLink.href = draft.url;
      githubLink.target = "_blank";
      githubLink.rel = "noopener noreferrer";
      githubLink.setAttribute("aria-disabled", "false");
      githubLink.textContent = draft.tooLong ? "打开 GitHub，手动粘贴草稿" : "前往 GitHub 检查并提交";
      status.textContent = draft.tooLong
        ? "草稿较长，已完整保留。请选中复制下方文字，或下载文本后复制，再到 GitHub 粘贴；不会自动填入或提交。"
        : "已生成本地预览，尚未发送。前往 GitHub 后仍需登录、检查并由你提交；提交的 issue 将公开。";
      preview.setAttribute("tabindex", "-1");
      preview.focus();
    });
    // Native validation is invoked explicitly above after Unicode-aware checks.
    form.noValidate = true;
    form.addEventListener("input", invalidatePreview);
    form.addEventListener("change", invalidatePreview);
    form.addEventListener("reset", invalidatePreview);
    githubLink.addEventListener("click", function (event) {
      if (!session.getDraft()) event.preventDefault();
    });
    if (edit) edit.addEventListener("click", function () {
      invalidatePreview();
      focusDetail();
    });
    if (download) download.addEventListener("click", function () {
      var draft = session.getDraft();
      if (!draft) return;
      if (!view || !view.URL || typeof view.URL.createObjectURL !== "function") {
        status.textContent = "此浏览器暂不支持下载，请选中复制预览文字。";
        return;
      }
      var blob = new view.Blob([draft.title + "\n\n" + draft.body], { type: "text/plain;charset=utf-8" });
      var objectUrl = view.URL.createObjectURL(blob);
      var anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "湿地植物反馈草稿.txt";
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      view.setTimeout(function () { view.URL.revokeObjectURL(objectUrl); }, 1000);
      status.textContent = "已请求下载文本草稿。下载不等于提交，内容尚未发送至 GitHub。";
    });
    document.querySelectorAll(".feedback-for").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        var plant = form.elements.namedItem("plant");
        if (plant) plant.value = link.dataset.name || "";
        invalidatePreview();
        var participate = document.getElementById("participate");
        if (participate) participate.scrollIntoView({ block: "start" });
        focusDetail();
      });
    });
    invalidatePreview();
    return true;
  }

  function init(document) {
    if (!document || document.documentElement.dataset.wetlandInitialized === "true") return;
    initFilters(document);
    initPhotos(document);
    var feedbackReady = initFeedback(document);
    document.querySelectorAll("[data-js-enable]").forEach(function (control) {
      if (control.form && control.form.id === "feedback-form" && !feedbackReady) return;
      control.disabled = false;
    });
    document.documentElement.dataset.wetlandInitialized = "true";
  }

  return {
    filterPlants: filterPlants,
    validateFeedback: validateFeedback,
    buildIssueDraft: buildIssueDraft,
    createFeedbackSession: createFeedbackSession,
    init: init
  };
}));
