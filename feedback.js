(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WetlandFeedback = api;
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", function () { api.init(root.document); });
    } else {
      api.init(root.document);
    }
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var API_ORIGIN = "https://shishui-feedback.coolharp512.chatgpt.site";
  var FIELD_NAMES = ["type", "plant", "park", "date", "detail"];
  var PLANTS = ["荇菜", "千屈菜", "睡莲", "荷", "芦苇", "假稻", "菖蒲", "黄菖蒲", "香蒲", "慈菇", "泽泻", "黑三棱", "黑藻", "水葱", "菰", "再力花", "荆三棱", "花蔺", "浮叶眼子菜", "篦齿眼子菜", "金鱼藻", "狐尾藻", "光叶眼子菜", "菹草", "苦草"];

  function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-").map(Number);
    var year = parts[0], month = parts[1], day = parts[2];
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }

  function validateFeedback(input) {
    var data = {}, errors = {};
    FIELD_NAMES.forEach(function (name) {
      data[name] = input && typeof input[name] === "string" ? input[name].trim() : "";
    });
    if (data.type !== "observation" && data.type !== "correction") errors.type = "请选择观察记录或内容纠错。";
    if (data.plant && PLANTS.indexOf(data.plant) === -1) errors.plant = "请从列表中选择植物，或选择未确定。";
    if (Array.from(data.park).length > 80) errors.park = "地点请控制在 80 个字符以内。";
    if (data.date && !isCalendarDate(data.date)) errors.date = "请填写有效日期（年-月-日）。";
    var length = Array.from(data.detail).length;
    if (length < 10 || length > 600) errors.detail = "观察或纠错内容请填写 10—600 个字符。";
    return { valid: Object.keys(errors).length === 0, errors: errors, data: data };
  }

  function publicItem(value) {
    if (!value || typeof value.id !== "string" || !value.id ||
        typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
        !FIELD_NAMES.every(function (name) { return typeof value[name] === "string"; }) ||
        !validateFeedback(value).valid) throw new Error("Invalid public feedback response");
    var result = { id: value.id };
    FIELD_NAMES.forEach(function (name) { result[name] = value[name]; });
    result.createdAt = value.createdAt;
    return result;
  }

  function mergeItems(first, second) {
    var seen = new Set();
    return first.concat(second).filter(function (item) {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); });
  }

  function createRequestId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("Secure random unavailable");
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function createFeedbackClient(options) {
    options = options || {};
    var requestFetch = options.fetch || globalThis.fetch.bind(globalThis);
    var origin = options.origin || API_ORIGIN;
    var uuid = options.uuid || createRequestId;
    var timeoutMs = options.timeoutMs || 15000;
    var notify = options.onChange || function () {};
    var pending = null;
    var successful = [];
    var successSequence = 0;
    var failedPageWasMore = false;
    var state = {
      items: [], nextCursor: null, listStatus: "idle", loadingMore: false,
      submitStatus: "idle", submitMessage: "", submitting: false
    };

    function getState() { return Object.assign({}, state, { items: state.items.slice() }); }
    function emit() { notify(getState()); }

    async function request(path, options) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        var response = await requestFetch(origin + path, Object.assign({ method: "GET", credentials: "omit", cache: "no-store" }, options, { signal: controller.signal }));
        if (!response.ok) {
          var errorBody;
          try { errorBody = await response.json(); } catch (error) { errorBody = null; }
          var httpError = new Error(errorBody && typeof errorBody.error === "string" ? errorBody.error : "服务暂时不可用，请稍后重试。");
          httpError.status = response.status;
          throw httpError;
        }
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    }

    async function submit(input) {
      if (state.submitting) return { ok: false, busy: true };
      var validation = validateFeedback(input);
      if (!validation.valid) return { ok: false, errors: validation.errors };
      var posted = false;
      state.submitting = true;
      state.submitStatus = "submitting";
      state.submitMessage = "正在提交留言…";
      emit();
      try {
        var fingerprint = JSON.stringify(validation.data);
        if (!pending || pending.fingerprint !== fingerprint) pending = { id: uuid(), fingerprint: fingerprint, posted: false, uncertain: false };
        var authorization = await request("/api/form-token");
        if (!authorization || typeof authorization.token !== "string" || !authorization.token) throw new Error("Missing form token");
        posted = true;
        pending.posted = true;
        var response = await request("/api/feedback", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ requestId: pending.id, token: authorization.token }, validation.data))
        });
        var saved = publicItem(response && response.item);
        successful.push({ item: saved, sequence: ++successSequence });
        state.items = mergeItems([saved], state.items);
        state.submitStatus = "success";
        state.submitMessage = "留言已公开，感谢分享。";
        pending = null;
        return { ok: true, item: saved };
      } catch (error) {
        // A later attempt cannot resolve an earlier lost response for this ID.
        if ((pending && pending.uncertain) || (posted && (!error.status || error.status >= 500))) {
          pending.uncertain = true;
          state.submitStatus = "uncertain";
          state.submitMessage = "暂未确认提交结果，内容已保留。请保持内容不变并重试，不会重复保存同一请求。";
        } else {
          state.submitStatus = "error";
          var connectionMessage = pending && pending.posted ? "暂时无法连接，未能重试提交。" : "暂时无法连接，留言尚未发送。";
          state.submitMessage = (error.status ? error.message : connectionMessage) + " 输入内容已保留，请稍后重试。";
        }
        return { ok: false };
      } finally {
        state.submitting = false;
        emit();
      }
    }

    async function loadPage(more) {
      if (state.listStatus === "loading") return { busy: true };
      if (more && !state.nextCursor) return { ok: true };
      var startSequence = successSequence;
      var path = "/api/feedback" + (more ? "?cursor=" + encodeURIComponent(state.nextCursor) : "");
      state.listStatus = "loading";
      state.loadingMore = more;
      failedPageWasMore = more;
      emit();
      try {
        var response = await request(path);
        if (!response || !Array.isArray(response.items) ||
            (response.nextCursor !== null && typeof response.nextCursor !== "string")) throw new Error("Invalid list response");
        var items = response.items.map(publicItem);
        var newlySaved = successful.filter(function (entry) { return entry.sequence > startSequence; }).map(function (entry) { return entry.item; });
        state.items = mergeItems(newlySaved, more ? mergeItems(state.items, items) : items);
        state.nextCursor = response.nextCursor;
        state.listStatus = "loaded";
        return { ok: true };
      } catch (error) {
        state.listStatus = "error";
        return { ok: false };
      } finally {
        state.loadingMore = false;
        emit();
      }
    }

    return {
      submit: submit,
      getState: getState,
      load: function () { return loadPage(false); },
      loadMore: function () { return loadPage(true); },
      retry: function () { return loadPage(failedPageWasMore); },
      edit: function () {
        if (state.submitting) return;
        pending = null;
        state.submitStatus = "idle";
        state.submitMessage = "";
        emit();
      }
    };
  }

  function formatBeijingTime(value) {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(value));
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day + " " + values.hour + ":" + values.minute + "（北京时间）";
  }

  function init(document, options) {
    if (!document) return null;
    var form = document.getElementById("feedback-form");
    if (!form || form.dataset.feedbackInitialized === "true") return null;
    var submitButton = document.getElementById("feedback-submit");
    var status = document.getElementById("feedback-status");
    var list = document.getElementById("feedback-list");
    var listStatus = document.getElementById("feedback-list-status");
    var retry = document.getElementById("feedback-retry");
    var more = document.getElementById("feedback-more");
    if (!submitButton || !status || !list || !listStatus || !retry || !more) return null;
    var resetting = false;
    var client;

    function appendText(parent, tag, className, text) {
      var element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    }

    function render(state) {
      status.textContent = state.submitMessage;
      status.dataset.state = state.submitStatus;
      form.setAttribute("aria-busy", String(state.submitting));
      FIELD_NAMES.forEach(function (name) { var field = form.elements.namedItem(name); if (field) field.disabled = state.submitting; });
      submitButton.disabled = state.submitting;
      submitButton.textContent = state.submitting ? "正在提交…" : "提交留言";
      list.replaceChildren();
      state.items.forEach(function (item) {
        var card = document.createElement("article");
        card.className = "feedback-entry";
        appendText(card, "h4", "feedback-entry-title", (item.type === "correction" ? "内容纠错" : "观察记录") + (item.plant ? " · " + item.plant : ""));
        var observation = [];
        if (item.park) observation.push(item.park);
        if (item.date) observation.push("观察日期：" + item.date);
        if (observation.length) appendText(card, "p", "feedback-entry-meta", observation.join(" · "));
        appendText(card, "p", "feedback-entry-detail", item.detail);
        var time = appendText(card, "time", "feedback-entry-time", formatBeijingTime(item.createdAt));
        time.setAttribute("datetime", item.createdAt);
        list.appendChild(card);
      });
      list.setAttribute("aria-busy", String(state.listStatus === "loading"));
      if (state.listStatus === "loading") listStatus.textContent = state.loadingMore ? "正在加载更多留言…" : "正在加载留言…";
      else if (state.listStatus === "error") listStatus.textContent = "留言加载失败，已显示的内容仍保留，请重试。";
      else if (!state.items.length) listStatus.textContent = "还没有留言，欢迎分享你的观察。";
      else listStatus.textContent = "已显示 " + state.items.length + " 条留言" + (state.nextCursor ? "。" : "，已全部加载。");
      retry.hidden = state.listStatus !== "error";
      more.hidden = !state.nextCursor || state.listStatus === "error";
      more.disabled = state.listStatus === "loading";
    }

    function setErrors(errors) {
      FIELD_NAMES.forEach(function (name) {
        var field = form.elements.namedItem(name);
        if (field && typeof field.setCustomValidity === "function") {
          field.setCustomValidity(errors[name] || "");
          if (errors[name]) field.setAttribute("aria-invalid", "true");
          else field.removeAttribute("aria-invalid");
        }
      });
    }

    client = createFeedbackClient(Object.assign({}, options, { onChange: render }));
    form.noValidate = true;
    form.dataset.feedbackInitialized = "true";
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (client.getState().submitting) return;
      var input = {};
      FIELD_NAMES.forEach(function (name) { var field = form.elements.namedItem(name); input[name] = field ? field.value : ""; });
      var validation = validateFeedback(input);
      setErrors(validation.errors);
      var nativeValid = form.reportValidity();
      if (!validation.valid || !nativeValid) {
        status.textContent = "请检查标出的字段，留言尚未发送。";
        status.dataset.state = "error";
        return;
      }
      var result = await client.submit(validation.data);
      if (result.ok) {
        resetting = true;
        form.reset();
        resetting = false;
      }
    });
    function edited() {
      if (resetting) return;
      setErrors({});
      client.edit();
    }
    form.addEventListener("input", edited);
    form.addEventListener("change", edited);
    form.addEventListener("reset", edited);
    retry.addEventListener("click", function () { client.retry(); });
    more.addEventListener("click", function () { client.loadMore(); });
    document.querySelectorAll(".feedback-for").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (client.getState().submitting) return;
        event.preventDefault();
        var plant = form.elements.namedItem("plant");
        if (plant) plant.value = link.dataset.name || "";
        edited();
        var participate = document.getElementById("participate");
        if (participate) participate.scrollIntoView({ block: "start" });
        var detail = form.elements.namedItem("detail");
        if (detail) detail.focus();
      });
    });
    client.load();
    return client;
  }

  return { validateFeedback: validateFeedback, createFeedbackClient: createFeedbackClient, formatBeijingTime: formatBeijingTime, init: init };
}));

