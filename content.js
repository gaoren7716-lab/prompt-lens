/* PromptLens · content script
 * 入口一：鼠标悬停图片 → 左上角浮现「反推提示词」按钮
 * 入口二：右键图片 → 菜单「反推这张图的提示词」
 * 结果：页面右侧浮层卡片（Shadow DOM 隔离样式），分块展示 + 一键复制
 */
(() => {
  if (window.__PROMPT_LENS_LOADED__) return;
  window.__PROMPT_LENS_LOADED__ = true;

  const CSS = `
    :host { all: initial; }
    .pl-fab {
      position: fixed; z-index: 2147483000;
      display: flex; align-items: center; gap: 6px;
      padding: 6px 11px; border-radius: 999px; cursor: pointer;
      font: 600 13px/1.2 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      color: #fff; background: linear-gradient(135deg, #7c5cff, #b45cff);
      box-shadow: 0 6px 18px rgba(124, 92, 255, .45);
      user-select: none; pointer-events: auto;
      transition: opacity .12s ease, transform .12s ease;
    }
    .pl-fab:hover { transform: translateY(-1px); }
    .pl-fab.pl-loading { opacity: .75; cursor: progress; }

    .pl-panel {
      position: fixed; top: 16px; right: 16px; z-index: 2147483001;
      width: 400px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
      display: flex; flex-direction: column;
      border-radius: 14px; overflow: hidden;
      background: var(--pl-bg, #ffffff); color: var(--pl-fg, #1c1c1e);
      box-shadow: 0 18px 50px rgba(0,0,0,.28), 0 0 0 1px var(--pl-border, rgba(0,0,0,.08));
      font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
      animation: pl-in .18s ease;
    }
    @keyframes pl-in { from { opacity: 0; transform: translateY(-8px); } }
    .pl-head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; font-weight: 700; font-size: 14px;
      background: linear-gradient(135deg, #7c5cff, #b45cff); color: #fff;
      cursor: move; user-select: none;
    }
    .pl-grip { opacity: .7; font-size: 12px; letter-spacing: -1px; }
    .pl-panel.pl-dragging { user-select: none; }
    .pl-head .pl-spacer { flex: 1; }
    .pl-x { cursor: pointer; opacity: .85; padding: 0 4px; font-size: 16px; line-height: 1; }
    .pl-x:hover { opacity: 1; }
    .pl-thumb { padding: 12px 14px 0; }
    .pl-thumb img {
      width: 100%; max-height: 190px; object-fit: contain;
      border-radius: 10px; background: var(--pl-thumb-bg, #f2f2f7); display: block;
    }
    .pl-body { padding: 12px 14px; overflow: auto; }
    .pl-block { margin-bottom: 14px; }
    .pl-block:last-child { margin-bottom: 0; }
    .pl-btitle {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      font-size: 12px; font-weight: 700; letter-spacing: .3px;
      color: var(--pl-muted, #8a8a8e); margin-bottom: 5px;
    }
    .pl-copy {
      cursor: pointer; border: 1px solid var(--pl-border, rgba(0,0,0,.12));
      background: transparent; color: var(--pl-muted, #8a8a8e);
      border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600;
    }
    .pl-copy:hover { color: #7c5cff; border-color: #7c5cff; }
    .pl-text {
      white-space: pre-wrap; word-break: break-word;
      background: var(--pl-code-bg, #f6f6f9); border-radius: 8px;
      padding: 9px 11px; font-size: 13px; line-height: 1.65;
      font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    }
    .pl-en .pl-text { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 12.5px; }
    .pl-loading { display: flex; align-items: center; gap: 9px; padding: 22px 4px; color: var(--pl-muted, #8a8a8e); }
    .pl-dot { width: 8px; height: 8px; border-radius: 50%; background: #7c5cff; animation: pl-pulse 1s infinite ease-in-out; }
    .pl-dot:nth-child(2) { animation-delay: .15s; }
    .pl-dot:nth-child(3) { animation-delay: .3s; }
    @keyframes pl-pulse { 0%,100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
    .pl-err { color: #d0342c; background: rgba(208,52,44,.08); border-radius: 8px; padding: 10px 12px; font-size: 13px; }
    .pl-foot {
      display: flex; gap: 8px; padding: 11px 14px;
      border-top: 1px solid var(--pl-border, rgba(0,0,0,.08));
    }
    .pl-btn {
      flex: 1; cursor: pointer; text-align: center;
      border: 1px solid var(--pl-border, rgba(0,0,0,.12)); background: transparent;
      color: var(--pl-fg, #1c1c1e); border-radius: 8px; padding: 7px 0;
      font-size: 12.5px; font-weight: 600;
    }
    .pl-btn:hover { border-color: #7c5cff; color: #7c5cff; }
    .pl-btn.pl-primary { background: linear-gradient(135deg, #7c5cff, #b45cff); color: #fff; border-color: transparent; }
    .pl-btn.pl-primary:hover { filter: brightness(1.06); color: #fff; }
  `;

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  let fabHost, fab, fabShadow;
  let panelHost, panelShadow;
  let currentImg = null;
  let busy = false;
  let hideTimer = null;
  let lastUrl = "";
  let hoverEnabled = true;
  let autoCopy = false;
  let panelPos = null;

  loadPrefs();
  loadPanelPos();

  window.addEventListener("resize", () => {
    const node = panelShadow?.querySelector(".pl-panel");
    if (node && panelPos) applyPanelPos(node);
  });

  /* ============ 悬停按钮 ============ */

  function ensureFab() {
    if (fabHost) return;
    fabHost = document.createElement("div");
    fabHost.style.cssText =
      "position:fixed;z-index:2147483000;left:0;top:0;pointer-events:none;";
    fabShadow = fabHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    fab = document.createElement("div");
    fab.className = "pl-fab";
    fab.textContent = "✨ 反推提示词";
    fabShadow.appendChild(style);
    fabShadow.appendChild(fab);
    document.documentElement.appendChild(fabHost);

    fab.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (currentImg) startAnalyze(pickUrl(currentImg));
    });
    fab.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    fab.addEventListener("mouseleave", () => scheduleHide());
  }

  function pickUrl(img) {
    return img.currentSrc || img.src || (img.tagName === "IMG" ? img.getAttribute("src") : "");
  }

  function isGoodImage(el) {
    if (!el || el.tagName !== "IMG") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 90 || r.height < 90) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const u = pickUrl(el);
    return !!u && !u.startsWith("chrome-extension://");
  }

  function showFab(img) {
    if (!hoverEnabled) return;
    ensureFab();
    currentImg = img;
    const r = img.getBoundingClientRect();
    const x = Math.min(Math.max(8, r.left + 8), innerWidth - 160);
    const y = Math.min(Math.max(8, r.top + 8), innerHeight - 60);
    fab.style.left = x + "px";
    fab.style.top = y + "px";
    fab.style.opacity = "1";
    fab.style.pointerEvents = "auto";
    fab.classList.toggle("pl-loading", busy);
    fab.textContent = busy ? "⏳ 正在反推…" : "✨ 反推提示词";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (fab) {
        fab.style.opacity = "0";
        fab.style.pointerEvents = "none";
      }
    }, 260);
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (isGoodImage(e.target)) {
        clearTimeout(hideTimer);
        showFab(e.target);
      }
    },
    true
  );
  document.addEventListener("mouseout", (e) => {
    if (e.target.tagName === "IMG") scheduleHide();
  }, true);
  window.addEventListener("scroll", scheduleHide, true);

  /* ============ 结果面板 ============ */

  function ensurePanel() {
    if (panelHost && document.documentElement.contains(panelHost)) return;
    panelHost = document.createElement("div");
    panelShadow = panelHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent =
      (prefersDark
        ? `:host{--pl-bg:#1c1c1e;--pl-fg:#f2f2f7;--pl-muted:#98989f;
             --pl-code-bg:#2c2c2e;--pl-thumb-bg:#2c2c2e;--pl-border:rgba(255,255,255,.12);}`
        : "") + CSS;
    panelShadow.appendChild(style);
    document.documentElement.appendChild(panelHost);
  }

  function render(html) {
    ensurePanel();
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    panelShadow.querySelectorAll(".pl-panel").forEach((n) => n.remove());
    const node = wrap.firstElementChild;
    panelShadow.appendChild(node);
    applyPanelPos(node);
    bindDrag(node);
  }

  /* ============ 拖动窗口 + 记住位置 ============ */

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function applyPanelPos(node) {
    if (!panelPos) return;
    node.style.right = "auto";
    node.style.left = clamp(panelPos.x, 0, Math.max(0, innerWidth - 200)) + "px";
    node.style.top = clamp(panelPos.y, 0, Math.max(0, innerHeight - 60)) + "px";
  }

  function bindDrag(node) {
    const head = node.querySelector(".pl-head");
    if (!head || head.dataset.bound) return;
    head.dataset.bound = "1";

    head.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target?.dataset?.act) return; // 点关闭按钮时不要拖
      const r = node.getBoundingClientRect();
      node.style.right = "auto";
      node.style.left = r.left + "px";
      node.style.top = r.top + "px";
      node.classList.add("pl-dragging");

      const startX = e.clientX;
      const startY = e.clientY;
      const baseX = r.left;
      const baseY = r.top;

      const onMove = (ev) => {
        node.style.left =
          clamp(baseX + ev.clientX - startX, 0, Math.max(0, innerWidth - r.width)) + "px";
        node.style.top =
          clamp(baseY + ev.clientY - startY, 0, Math.max(0, innerHeight - 48)) + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        node.classList.remove("pl-dragging");
        const r2 = node.getBoundingClientRect();
        panelPos = { x: Math.round(r2.left), y: Math.round(r2.top) };
        try {
          chrome.storage.local.set({ panelPos });
        } catch (err) {
          /* 忽略 */
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
  }

  function panelShell(imageUrl, inner) {
    return `
      <div class="pl-panel">
        <div class="pl-head" title="拖动我可移动窗口">
          <span class="pl-grip">⣿</span>
          <span>✨ PromptLens</span>
          <span class="pl-spacer"></span>
          <span class="pl-x" data-act="close" title="关闭">✕</span>
        </div>
        ${imageUrl ? `<div class="pl-thumb"><img src="${escapeAttr(imageUrl)}" alt=""></div>` : ""}
        <div class="pl-body">${inner}</div>
        <div class="pl-foot">
          <button class="pl-btn pl-primary" data-act="copy-all">复制全部</button>
          <button class="pl-btn" data-act="retry">重新生成</button>
          <button class="pl-btn" data-act="options">设置</button>
        </div>
      </div>`;
  }

  function showLoading(imageUrl) {
    render(
      panelShell(
        imageUrl,
        `<div class="pl-loading">
           <span class="pl-dot"></span><span class="pl-dot"></span><span class="pl-dot"></span>
           <span>正在分析图片，通常 5–20 秒…</span>
         </div>`
      )
    );
  }

  function showError(imageUrl, msg) {
    render(
      panelShell(
        imageUrl,
        `<div class="pl-err">${escapeHtml(msg)}</div>`
      )
    );
  }

  function showResult(imageUrl, text) {
    const blocks = parseBlocks(text)
      .map((b) => {
        const isEn = /prompt|negative/i.test(b.title) || /^[\x00-\x7F\s,.-]+$/.test(b.body);
        return `<div class="pl-block ${isEn ? "pl-en" : ""}">
            <div class="pl-btitle"><span>${escapeHtml(b.title)}</span>
              <button class="pl-copy" data-copy="${escapeAttr(b.body)}">复制</button>
            </div>
            <div class="pl-text">${escapeHtml(b.body)}</div>
          </div>`;
      })
      .join("");
    render(panelShell(imageUrl, blocks));
    if (autoCopy) copy(text, null);
  }

  function parseBlocks(text) {
    const clean = text.replace(/^```[a-z]*\n?|```$/gim, "").trim();
    const parts = clean.split(/【([^】]{1,24})】/);
    if (parts.length < 3) return [{ title: "反推结果", body: clean }];
    const out = [];
    for (let i = 1; i < parts.length; i += 2) {
      const title = parts[i].trim();
      const body = (parts[i + 1] || "").trim();
      if (body) out.push({ title, body });
    }
    return out.length ? out : [{ title: "反推结果", body: clean }];
  }

  /* ============ 面板事件 ============ */

  document.addEventListener(
    "click",
    (e) => {
      const path = e.composedPath?.() || [];
      const el = path.find((n) => n?.dataset?.act || n?.dataset?.copy);
      if (!el) return;
      e.stopPropagation();
      e.preventDefault();

      if (el.dataset.copy !== undefined) {
        copy(el.dataset.copy, el);
        return;
      }
      switch (el.dataset.act) {
        case "close":
          panelHost?.remove();
          panelHost = null;
          break;
        case "copy-all": {
          const txt = [...panelShadow.querySelectorAll(".pl-block")]
            .map(
              (b) =>
                b.querySelector(".pl-btitle span")?.textContent + "\n" +
                b.querySelector(".pl-text")?.textContent
            )
            .join("\n\n");
          copy(txt, el);
          break;
        }
        case "retry":
          if (lastUrl) startAnalyze(lastUrl);
          break;
        case "options":
          chrome.runtime.sendMessage({ action: "openOptions" });
          break;
      }
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelHost) {
      panelHost.remove();
      panelHost = null;
    }
  });

  /* ============ 分析流程 ============ */

  async function startAnalyze(imageUrl) {
    if (!imageUrl || busy) return;
    lastUrl = imageUrl;
    busy = true;
    if (fab) {
      fab.classList.add("pl-loading");
      fab.textContent = "⏳ 正在反推…";
    }
    showLoading(imageUrl);
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "analyze", imageUrl }, (r) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: "扩展已更新，请刷新本页面后重试。" });
          } else {
            resolve(r || { ok: false, error: "没有收到返回结果" });
          }
        });
      });
      if (res?.ok) showResult(imageUrl, res.text);
      else showError(imageUrl, res?.error || "反推失败");
    } catch (err) {
      showError(imageUrl, err?.message || String(err));
    } finally {
      busy = false;
      if (fab) {
        fab.classList.remove("pl-loading");
        fab.textContent = "✨ 反推提示词";
      }
    }
  }

  /* ============ 工具 ============ */

  function copy(text, btn) {
    const done = () => {
      if (btn && btn.textContent) {
        const old = btn.textContent;
        btn.textContent = "已复制 ✓";
        setTimeout(() => (btn.textContent = old), 1400);
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      /* 忽略 */
    }
    ta.remove();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, "&#96;");
  }

  function loadPrefs() {
    try {
      chrome.storage.sync.get({ hoverEnabled: true, autoCopy: false }, (cfg) => {
        hoverEnabled = cfg.hoverEnabled !== false;
        autoCopy = cfg.autoCopy === true;
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  function loadPanelPos() {
    try {
      chrome.storage.local.get({ panelPos: null }, (r) => {
        panelPos = r?.panelPos || null;
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.hoverEnabled) hoverEnabled = changes.hoverEnabled.newValue !== false;
    if (changes.autoCopy) autoCopy = changes.autoCopy.newValue === true;
  });

  /* ============ 来自右键菜单 / popup 的指令 ============ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action === "startAnalyze") {
      startAnalyze(msg.imageUrl);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.action === "ping") {
      sendResponse({ ok: true });
      return true;
    }
  });
})();
