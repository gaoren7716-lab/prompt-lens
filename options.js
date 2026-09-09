/* PromptLens · 设置页逻辑 */

/* 兜底用：background 拿不到时（例如直接以网页方式打开本页）不至于让模板框空白。
 * 与 background.js 的 DEFAULT_TEMPLATE 保持一致。 */
const LOCAL_TEMPLATE = `你是一位资深的 AI 绘画提示词工程师。请仔细观察这张图片，反推出可以复用于 AI 生图（Midjourney / Stable Diffusion / Flux / 即梦 / 豆包）的提示词。

严格按以下格式输出，不要使用 Markdown 标题符号，不要输出任何多余解释：

【中文描述】
用一段中文客观描述画面（100-150 字）：主体与动作表情、服装造型、场景环境、构图景别、镜头角度、光影、色调、材质、艺术风格、画质。

【英文 Prompt】
输出一条英文提示词，逗号分隔的标签短语，40-80 个词，按「主体 → 细节 → 环境 → 构图镜头 → 光影 → 风格 → 画质」顺序排列。只输出提示词本身。

【反向提示词】
输出英文 Negative Prompt，20-40 个词。

【标签】
8-15 个中文关键词，用顿号分隔。`;

const FALLBACK = {
  settings: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    model: "glm-4v-flash",
    template: LOCAL_TEMPLATE,
    maxTokens: 1500,
    hoverEnabled: true,
    autoCopy: false
  },
  providers: [
    {
      id: "custom",
      name: "自定义（OpenAI 兼容接口）",
      baseUrl: "",
      keyUrl: "",
      defaultModel: "",
      models: [],
      note: "填你自己的 OpenAI 兼容接口，模型必须支持图片输入。"
    }
  ]
};

const TEST_IMAGE =
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=384&q=70";

const $ = (id) => document.getElementById(id);
let PROVIDERS = [];

function setStatus(msg, cls) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = cls || "";
}

async function getDefaults() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: "getDefaults" }, (res) => {
        void chrome.runtime.lastError;
        resolve(res || FALLBACK);
      });
    } catch (e) {
      resolve(FALLBACK);
    }
  });
}

async function init() {
  const def = await getDefaults();
  PROVIDERS = def.providers?.length ? def.providers : FALLBACK.providers;

  PROVIDERS.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.name;
    $("provider").appendChild(opt);
  });

  const cfg = await new Promise((r) => chrome.storage.sync.get(def.settings, r));
  $("baseUrl").value = cfg.baseUrl || "";
  $("apiKey").value = cfg.apiKey || "";
  $("model").value = cfg.model || def.settings.model || "";
  $("template").value = cfg.template || def.settings.template || LOCAL_TEMPLATE;
  $("maxTokens").value = cfg.maxTokens || 1500;
  $("hoverEnabled").checked = cfg.hoverEnabled !== false;
  $("autoCopy").checked = cfg.autoCopy === true;

  syncProviderSelect();
}

/* 把该服务商「支持图片输入」的模型填进 datalist，
 * input 仍可手填，既给建议又不锁死。 */
function fillModels(p) {
  const dl = $("modelList");
  dl.innerHTML = "";
  (p?.models || []).forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.label = m.label || m.id;
    dl.appendChild(o);
  });
  const note = $("modelNote");
  if (note) note.textContent = p?.note || "";
}

function syncProviderSelect() {
  const cur = $("baseUrl").value.trim().replace(/\/+$/, "");
  const idx = PROVIDERS.findIndex((p) => p.baseUrl.replace(/\/+$/, "") === cur);
  $("provider").value = idx >= 0 ? String(idx) : String(PROVIDERS.length - 1);
  const p = PROVIDERS[Number($("provider").value)];
  if (p?.keyUrl) {
    $("keyLink").href = p.keyUrl;
    $("keyLink").style.display = "";
  } else {
    $("keyLink").style.display = "none";
  }
  fillModels(p);
}

$("provider").addEventListener("change", () => {
  const p = PROVIDERS[Number($("provider").value)];
  if (!p) return;
  if (p.baseUrl) $("baseUrl").value = p.baseUrl;
  if (p.defaultModel) $("model").value = p.defaultModel;
  syncProviderSelect();
});

$("baseUrl").addEventListener("change", syncProviderSelect);

$("save").addEventListener("click", () => {
  const data = {
    baseUrl: $("baseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim(),
    template: $("template").value,
    maxTokens: Number($("maxTokens").value) || 1500,
    hoverEnabled: $("hoverEnabled").checked,
    autoCopy: $("autoCopy").checked
  };
  if (!data.apiKey) {
    setStatus("⚠️ API Key 还是空的，填了才能真正使用。", "err");
    return;
  }
  chrome.storage.sync.set(data, () => {
    setStatus("✅ 已保存。回到网页，右键图片或悬停点按钮即可使用。", "ok");
  });
});

$("reset").addEventListener("click", async () => {
  const def = await getDefaults();
  $("template").value = def.settings.template || LOCAL_TEMPLATE;
  $("maxTokens").value = def.settings.maxTokens || 1500;
  setStatus("已恢复默认模板，记得点保存。", "");
});

$("test").addEventListener("click", async () => {
  const btn = $("test");
  btn.disabled = true;
  btn.textContent = "测试中…";
  setStatus("正在用一张示例图调用模型，请稍候（通常 5–20 秒）…", "");
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "analyze", imageUrl: TEST_IMAGE },
        (r) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: "请先点「保存设置」，再测试。" });
          } else {
            resolve(r || { ok: false, error: "没有返回结果" });
          }
        }
      );
    });
    if (res.ok) {
      setStatus("✅ 连接正常，返回示例：\n\n" + res.text.slice(0, 400), "ok");
    } else {
      setStatus("❌ " + res.error, "err");
    }
  } catch (e) {
    setStatus("❌ " + (e.message || e), "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "测试连接";
  }
});

init();
