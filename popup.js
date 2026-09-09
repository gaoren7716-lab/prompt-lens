/* PromptLens · 弹出面板 */

const $ = (id) => document.getElementById(id);

chrome.storage.sync.get({ apiKey: "", model: "", baseUrl: "" }, (cfg) => {
  const el = $("state");
  if (cfg.apiKey) {
    el.className = "ok";
    el.textContent = "已配置 · " + (cfg.model || "未填模型");
  } else {
    el.className = "warn";
    el.textContent = "未配置 API Key，还不能反推";
  }
});

$("options").addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open("options.html");
});
