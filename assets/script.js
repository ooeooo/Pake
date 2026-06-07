// ==UserScript==
// @name         ChatGPT 新会话 Thinking 模式锁定（DOM 点击版）
// @namespace    https://chatgpt.com/
// @version      1.2.0
// @description  仅在 ChatGPT 新会话首页加载或点击“新聊天”后，通过 DOM 点击一次把模型模式切换为 Thinking 进阶。
// @author       Codex
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function installChatGPTThinkingDomClickLock() {
  "use strict";

  const FLAG = "__chatgptThinkingDomClickLockInstalled__";
  const URL_CHANGE_EVENT = "__chatgptThinkingDomClickLockUrlChange__";
  const DEBUG = false;

  if (window[FLAG]) {
    return;
  }

  Object.defineProperty(window, FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const ADVANCED_MODE_RE = /^(进阶|advanced|thinking\s*进阶|思考\s*进阶)$/i;
  const THINKING_MODE_RE = /^(thinking|think|思考|推理)$/i;
  const MODEL_BUTTON_RE = /^(instant|thinking|think|即时|快速|思考|推理|进阶|advanced|thinking\s*进阶|思考\s*进阶)$/i;
  const STRENGTH_LABEL_RE = /^(强度|strength|effort|thinking effort|reasoning effort)$/i;
  const NEW_CHAT_RE = /^(新聊天|new chat)$/i;

  let running = false;
  let triggerId = 0;
  let queuedTrigger = null;

  function log(...args) {
    if (DEBUG) {
      console.debug("[ChatGPT Thinking Lock]", ...args);
    }
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function textOf(element) {
    if (!element) {
      return "";
    }

    return normalize(
      element.innerText ||
      element.textContent ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
    );
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }

  function visibleElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(isVisible);
  }

  function renderedElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter((element) => {
      if (!element || !(element instanceof Element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none";
    });
  }

  function dispatchMouseSequence(element, eventTypes) {
    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    for (const type of eventTypes) {
      try {
        const EventCtor = type.startsWith("pointer") && window.PointerEvent
          ? window.PointerEvent
          : window.MouseEvent;
        element.dispatchEvent(new EventCtor(type, eventInit));
      } catch {
        // 个别事件构造失败时跳过，后续 click/focus 仍会继续。
      }
    }
  }

  function domHover(element) {
    if (!element) {
      return false;
    }

    element.scrollIntoView({ block: "center", inline: "center" });
    dispatchMouseSequence(element, [
      "pointerover",
      "mouseover",
      "pointerenter",
      "mouseenter",
      "pointermove",
      "mousemove"
    ]);

    try {
      element.focus({ preventScroll: true });
    } catch {
      // 非可聚焦元素忽略。
    }

    return true;
  }

  function domClick(element) {
    if (!element) {
      return false;
    }

    element.scrollIntoView({ block: "center", inline: "center" });

    dispatchMouseSequence(element, [
      "pointerover",
      "mouseover",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click"
    ]);

    try {
      element.click();
    } catch {
      return false;
    }

    return true;
  }

  function isChatGPTHost() {
    return location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com";
  }

  function isNewChatPath() {
    return isChatGPTHost() && location.pathname === "/";
  }

  function hasConversationTurns() {
    return Boolean(document.querySelector([
      "main article",
      "main [data-testid^='conversation-turn']",
      "main [data-message-author-role]",
      "main [data-testid='message-turn']"
    ].join(",")));
  }

  function hasVisibleComposer() {
    const main = document.querySelector("main");
    if (!main || !isVisible(main)) {
      return false;
    }

    return visibleElements([
      "[role='textbox']",
      "textarea",
      "[contenteditable='true']"
    ].join(","), main).length > 0;
  }

  function isNewSession() {
    return isNewChatPath() && hasVisibleComposer() && !hasConversationTurns();
  }

  function temporarilyRevealForClick(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return;
    }

    const style = getComputedStyle(element);
    if (style.visibility !== "hidden" && style.opacity !== "0" && style.pointerEvents !== "none") {
      return;
    }

    element.style.visibility = "visible";
    element.style.opacity = "1";
    element.style.pointerEvents = "auto";
  }

  function isAdvancedText(value) {
    return ADVANCED_MODE_RE.test(normalize(value));
  }

  function isThinkingModeText(value) {
    return THINKING_MODE_RE.test(normalize(value));
  }

  function findModelButton() {
    const main = document.querySelector("main");
    if (!main) {
      return null;
    }

    const buttons = visibleElements("button,[role='button']", main);
    return buttons.find((button) => {
      const label = textOf(button);
      const rect = button.getBoundingClientRect();
      const hasMenuState = button.hasAttribute("aria-expanded");
      return hasMenuState &&
        MODEL_BUTTON_RE.test(label) &&
        rect.width <= 260 &&
        rect.height <= 64;
    }) || null;
  }

  function menuRoots() {
    const menuRoots = visibleElements([
      "[role='menu']",
      "[role='listbox']",
      "[data-radix-popper-content-wrapper]"
    ].join(","));

    return menuRoots.length > 0 ? menuRoots : [document];
  }

  function findThinkingMenuItem() {
    const roots = menuRoots();
    for (const root of roots) {
      const items = visibleElements([
        "[role='menuitemradio']",
        "[role='menuitem']",
        "[role='option']",
        "button"
      ].join(","), root);

      const exact = items.find((item) => isThinkingModeText(textOf(item)));
      if (exact) {
        return exact;
      }
    }

    return null;
  }

  function findStrengthButton(thinkingItem) {
    const thinkingRect = thinkingItem ? thinkingItem.getBoundingClientRect() : null;
    const roots = menuRoots();

    for (const root of roots) {
      const candidates = renderedElements([
        "button[aria-label]",
        "button[role='menuitem']",
        "[role='menuitem']"
      ].join(","), root).filter((candidate) => {
        const label = normalize(candidate.getAttribute("aria-label") || textOf(candidate));
        const hasStrengthLabel = STRENGTH_LABEL_RE.test(label);
        const hasStrengthIcon = Boolean(candidate.querySelector("svg use[href*='#715504']"));

        if (!hasStrengthLabel && !hasStrengthIcon) {
          return false;
        }

        if (!thinkingRect) {
          return true;
        }

        const rect = candidate.getBoundingClientRect();
        const sameRow = Math.abs(
          (rect.top + rect.height / 2) - (thinkingRect.top + thinkingRect.height / 2)
        ) <= Math.max(22, thinkingRect.height / 2);

        return sameRow && rect.left >= thinkingRect.left;
      });

      if (candidates[0]) {
        return candidates[0];
      }
    }

    return null;
  }

  function findAdvancedMenuItem() {
    const roots = menuRoots();
    for (const root of roots) {
      const items = visibleElements([
        "[role='menuitemradio']",
        "[role='menuitem']",
        "[role='option']",
        "button"
      ].join(","), root);

      const exact = items.find((item) => isAdvancedText(textOf(item)));
      if (exact) {
        return exact;
      }
    }

    return null;
  }

  function waitFor(getter, timeoutMs = 8000, intervalMs = 100) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const tick = () => {
        let value = null;
        try {
          value = getter();
        } catch {
          value = null;
        }

        if (value) {
          resolve(value);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }

        setTimeout(tick, intervalMs);
      };

      tick();
    });
  }

  async function ensureAdvancedOnce(reason, token) {
    if (token !== triggerId) {
      return;
    }

    if (running) {
      queuedTrigger = { reason, token };
      return;
    }

    running = true;

    try {
      if (token !== triggerId || !isNewChatPath()) {
        return;
      }

      const ready = await waitFor(isNewSession, 12000, 150);
      if (token !== triggerId || !ready || !isNewSession()) {
        log("跳过：不是新会话", reason, location.href);
        return;
      }

      const modelButton = await waitFor(findModelButton, 12000, 150);
      if (token !== triggerId || !modelButton || !isNewSession()) {
        log("跳过：未找到新会话模型按钮", reason);
        return;
      }

      if (isAdvancedText(textOf(modelButton))) {
        log("已是 Thinking 进阶", reason);
        return;
      }

      log("打开模型菜单", reason, textOf(modelButton));
      domClick(modelButton);

      const thinkingItem = await waitFor(findThinkingMenuItem, 6000, 100);
      if (token !== triggerId || !thinkingItem || !isNewSession()) {
        log("跳过：未找到 Thinking 菜单项", reason);
        return;
      }

      log("悬停 Thinking 以显示强度按钮", textOf(thinkingItem));
      domHover(thinkingItem);

      const strengthButton = await waitFor(() => findStrengthButton(thinkingItem), 4000, 100);
      if (token !== triggerId || !strengthButton || !isNewSession()) {
        log("跳过：未找到 Thinking 强度按钮", reason);
        return;
      }

      temporarilyRevealForClick(strengthButton);
      log("打开 Thinking 强度菜单", textOf(strengthButton));
      domClick(strengthButton);

      const advancedItem = await waitFor(findAdvancedMenuItem, 5000, 100);
      if (token !== triggerId || !advancedItem || !isNewSession()) {
        log("跳过：未找到进阶选项", reason);
        return;
      }

      log("选择进阶", textOf(advancedItem));
      domClick(advancedItem);

      await waitFor(() => {
        const currentButton = findModelButton();
        return currentButton && isAdvancedText(textOf(currentButton));
      }, 5000, 150);
    } finally {
      running = false;
      if (queuedTrigger && queuedTrigger.token === triggerId) {
        const queued = queuedTrigger;
        queuedTrigger = null;
        setTimeout(() => {
          void ensureAdvancedOnce(queued.reason, queued.token);
        }, 0);
      } else {
        queuedTrigger = null;
      }
    }
  }

  function triggerOnce(reason, delay = 300) {
    if (!isNewChatPath()) {
      return;
    }

    const token = ++triggerId;
    setTimeout(() => {
      void ensureAdvancedOnce(reason, token);
    }, delay);
  }

  function installUrlHooks() {
    let lastHref = location.href;

    for (const method of ["pushState", "replaceState"]) {
      const nativeMethod = history[method];
      if (typeof nativeMethod !== "function") {
        continue;
      }

      history[method] = function patchedHistoryMethod(...args) {
        const result = nativeMethod.apply(this, args);
        window.dispatchEvent(new Event(URL_CHANGE_EVENT));
        return result;
      };
    }

    window.addEventListener("popstate", () => {
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    });

    window.addEventListener(URL_CHANGE_EVENT, () => {
      const previousHref = lastHref;
      const currentHref = location.href;
      lastHref = currentHref;

      if (previousHref === currentHref || !isNewChatPath()) {
        return;
      }

      try {
        const previousUrl = new URL(previousHref, currentHref);
        if (previousUrl.hostname === location.hostname && previousUrl.pathname === "/") {
          return;
        }
      } catch {
        // URL 解析失败时保守地允许当前首页入口执行一次。
      }

      triggerOnce("url-change", 300);
    });
  }

  function installNewChatClickHook() {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("a[data-testid='create-new-chat-button'],a[href='/']")
        : null;

      if (!target) {
        return;
      }

      const label = textOf(target);
      if (NEW_CHAT_RE.test(label) || target.getAttribute("data-testid") === "create-new-chat-button") {
        triggerOnce("new-chat-click", 400);
      }
    }, true);
  }

  installUrlHooks();
  installNewChatClickHook();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => triggerOnce("dom-ready", 300), { once: true });
  } else {
    triggerOnce("initial", 300);
  }
})();
