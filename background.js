/* PromptLens · background service worker
 * 只做两件事：创建右键菜单 + 调用视觉大模型。
 * 所有 API 逻辑集中在 chrome.runtime.onMessage 的 analyze 分支里。
 */

const DEFAULT_TEMPLATE = `你是一位资深的 AI 绘画提示词工程师。请仔细观察这张图片，反推出可以复用于 AI 生图（Midjourney / Stable Diffusion / Flux / 即梦 / 豆包）的提示词。

严格按以下格式输出，不要使用 Markdown 标题符号，不要输出任何多余解释：

【中文描述】
用一段中文客观描述画面（100-150 字）：主体与动作表情、服装造型、场景环境、构图景别、镜头角度、光影、色调、材质、艺术风格、画质。

【英文 Prompt】
输出一条英文提示词，逗号分隔的标签短语，40-80 个词，按「主体 → 细节 → 环境 → 构图镜头 → 光影 → 风格 → 画质」顺序排列。只输出提示词本身。

【反向提示词】
输出英文 Negative Prompt，20-40 个词。

【标签】
8-15 个中文关键词，用顿号分隔。`;

const DEFAULT_SETTINGS = {
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "",
  model: "glm-4v-flash",
  template: DEFAULT_TEMPLATE,
  maxTokens: 1500,
  hoverEnabled: true,
  autoCopy: false
};

/* 只收录「支持图片输入」的模型——也就是能真正反推提示词的模型。
 * 纯文本模型（glm-4-flash、deepseek-v4-flash、gpt-3.5-turbo 等没有视觉编码器的）看不了图，
 * 一律不放进来。清单核实时间：2026-09-09。
 *
 * 注意：判断「能不能看图」不能只看厂商，必须看具体模型名——同一家厂商往往文本版和视觉版并存，
 * 例如 DeepSeek 目前只有 deepseek-v4-flash-vision-exp 能看图，其余全是纯文本。
 */
const PROVIDERS = [
  {
    id: "zhipu",
    name: "智谱 GLM（有永久免费视觉模型）",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    defaultModel: "glm-4v-flash",
    models: [
      { id: "glm-4v-flash", rank: 1, tag: "免费", label: "glm-4v-flash（免费 · 最快 · 推荐）" },
      { id: "glm-4.6v-flash", rank: 1, tag: "免费", label: "glm-4.6v-flash（免费 · 128K · 描述更细）" },
      { id: "glm-4.1v-thinking-flash", rank: 2, tag: "免费", label: "glm-4.1v-thinking-flash（免费 · 视觉推理更强）" },
      { id: "glm-4.6v", rank: 3, tag: "付费", label: "glm-4.6v（付费 · 视觉能力最强）" },
      { id: "glm-5v-turbo", rank: 4, tag: "旗舰", label: "glm-5v-turbo（付费 · 旗舰）" }
    ],
    note: "免费模型以控制台标注为准。注意：名字里多一个 x 的是付费版（glm-4-flashx、glm-4.1v-thinking-flashx），别选错。"
  },
  {
    id: "deepseek",
    name: "DeepSeek（深度求索）",
    baseUrl: "https://api.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys",
    defaultModel: "deepseek-v4-flash-vision-exp",
    models: [
      { id: "deepseek-v4-flash-vision-exp", rank: 1, tag: "便宜", label: "deepseek-v4-flash-vision-exp（唯一能看图 · 极便宜）" }
    ],
    note: "⚠️ DeepSeek 只有这一个模型能看图，2026-08-21 上线的实验版。deepseek-v4-flash / deepseek-v4-pro / V3 / R1 全是纯文本，填了会报「This model does not support image」。单图最多 384 tokens，价格与 V4-Flash 同价（输入 1 元/百万 token）。"
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    defaultModel: "Qwen/Qwen3-VL-32B-Instruct",
    models: [
      { id: "Qwen/Qwen3-VL-32B-Instruct", rank: 1, tag: "便宜", label: "Qwen3-VL-32B-Instruct（便宜够用 · 推荐）" },
      { id: "Qwen/Qwen3-VL-8B-Instruct", rank: 2, tag: "最便宜", label: "Qwen3-VL-8B-Instruct（最便宜）" },
      { id: "Qwen/Qwen3-VL-235B-A22B-Instruct", rank: 2, tag: "最强", label: "Qwen3-VL-235B-A22B（最强 · 贵）" },
      { id: "zai-org/GLM-4.6V", rank: 3, tag: "付费", label: "GLM-4.6V" }
    ],
    note: "旧模型 Qwen/Qwen2.5-VL-72B-Instruct 已从平台下架，已换成 Qwen3-VL 系列。"
  },
  {
    id: "dashscope",
    name: "阿里百炼 DashScope（通义千问）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    defaultModel: "qwen3-vl-plus",
    models: [
      { id: "qwen3-vl-plus", rank: 1, tag: "均衡", label: "qwen3-vl-plus（推荐）" },
      { id: "qwen3-vl-flash", rank: 1, tag: "便宜", label: "qwen3-vl-flash（最快最省）" },
      { id: "qwen-vl-max-latest", rank: 2, tag: "旧旗舰", label: "qwen-vl-max-latest（旧版旗舰，仍可用）" },
      { id: "qwen3-vl-235b-a22b-instruct", rank: 2, tag: "最强", label: "qwen3-vl-235b-a22b-instruct（开源旗舰）" }
    ],
    note: "以上均出自官方「Qwen-VL OpenAI 兼容」文档支持的模型清单。"
  },
  {
    id: "volcengine",
    name: "火山方舟（豆包）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    defaultModel: "doubao-1.5-vision-pro",
    models: [
      { id: "doubao-1.5-vision-pro", rank: 3, tag: "国内", label: "doubao-1.5-vision-pro（视觉理解）" },
      { id: "doubao-seed-2-1-turbo-260628", rank: 3, tag: "国内", label: "doubao-seed-2-1-turbo-260628（较新）" }
    ],
    note: "方舟通常要在控制台「推理接入点」创建后，把 ep- 开头的接入点 ID 填进模型名。方舟托管的 DeepSeek / GLM 版本目前仍是纯文本，看不了图；要视觉能力请选豆包 vision 系列，或改用 DeepSeek 官方的 vision-exp。"
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", rank: 3, tag: "海外", label: "gpt-4o-mini（最便宜）" },
      { id: "gpt-4.1-mini", rank: 3, tag: "海外", label: "gpt-4.1-mini（长上下文）" },
      { id: "gpt-5-mini", rank: 2, tag: "效果最好", label: "gpt-5-mini（效果最好）" }
    ],
    note: "三者 API 端都支持图片输入（gpt-4o 只是从 ChatGPT 下线，API 仍可用）。"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    defaultModel: "google/gemini-2.5-flash",
    models: [
      { id: "google/gemini-2.5-flash", rank: 3, tag: "海外", label: "google/gemini-2.5-flash（便宜）" },
      { id: "google/gemini-3.1-flash-lite", rank: 3, tag: "海外", label: "google/gemini-3.1-flash-lite（新 · 便宜）" }
    ],
    note: "旧模型 google/gemini-2.0-flash-001 已于 2026-06-01 关停，调用直接 404，已移除。OpenRouter 上找更多可选：openrouter.ai/models?modality=image%3Etext"
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容接口）",
    baseUrl: "",
    keyUrl: "",
    defaultModel: "",
    models: [],
    note: "任何提供 /chat/completions 且支持 image_url 的 OpenAI 兼容服务都能用：本地 Ollama / LM Studio、vLLM、中转站等。"
  }
];

/* 已关停 / 已下架的模型：用户如果还存着旧名字，自动换成可用的替代款。
 * 核实时间 2026-09-09。 */
const DEAD_MODELS = {
  "google/gemini-2.0-flash-001": "google/gemini-2.5-flash",
  "google/gemini-2.0-flash": "google/gemini-2.5-flash",
  "google/gemini-2.0-flash-lite": "google/gemini-2.5-flash",
  "google/gemini-2.0-flash-lite-001": "google/gemini-2.5-flash",
  "qwen/qwen2.5-vl-72b-instruct": "Qwen/Qwen3-VL-32B-Instruct",
  "qwen2-vl-72b-instruct": "qwen3-vl-plus",
  "doubao-vision-pro-32k": "doubao-1.5-vision-pro",
  // DeepSeek 纯文本版 → 官方视觉版（同价，2026-08-21 起可用）
  "deepseek-chat": "deepseek-v4-flash-vision-exp",
  "deepseek-reasoner": "deepseek-v4-flash-vision-exp",
  "deepseek-v3": "deepseek-v4-flash-vision-exp",
  "deepseek-r1": "deepseek-v4-flash-vision-exp",
  "deepseek-v4-flash": "deepseek-v4-flash-vision-exp",
  "deepseek-v4-pro": "deepseek-v4-flash-vision-exp"
};

/* ---------------- 右键菜单 ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  migrateDeadModels();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "promptlens-image",
      title: "反推这张图的提示词",
      contexts: ["image"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "promptlens-image" || !tab?.id) return;
  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  const delivered = await sendToTab(tab.id, {
    action: "startAnalyze",
    imageUrl
  });

  // 页面没注入 content script（扩展商店页、特殊页面）时，自动补一次注入
  if (!delivered) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await sendToTab(tab.id, { action: "startAnalyze", imageUrl });
    } catch (e) {
      notify("无法在该页面运行", "请换到普通网页后再试。");
    }
  }
});

function migrateDeadModels() {
  chrome.storage.sync.get({ model: "" }, (cfg) => {
    const cur = (cfg.model || "").trim();
    const fix = DEAD_MODELS[cur.toLowerCase()];
    if (!fix) return;
    chrome.storage.sync.set({ model: fix }, () => {
      notify("已自动替换失效模型", `${cur} 已下线，改用 ${fix}`);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      void chrome.runtime.lastError; // 吞掉 "Receiving end does not exist"
      resolve(Boolean(res));
    });
  });
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message
    });
  } catch (e) {
    /* 忽略 */
  }
}

/* ---------------- 消息入口 ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "analyze") {
    handleAnalyze(msg.imageUrl)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true; // 异步响应
  }
  if (msg?.action === "openOptions") {
    chrome.runtime.openOptionsPage?.();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.action === "getDefaults") {
    sendResponse({ settings: DEFAULT_SETTINGS, providers: PROVIDERS });
    return false;
  }
});

async function handleAnalyze(imageUrl) {
  const s = await loadSettings();
  if (!s.apiKey) {
    throw new Error(
      "还没有配置 API Key。点击扩展图标 →「打开设置」填入密钥即可使用。"
    );
  }
  if (!s.baseUrl || !s.model) {
    throw new Error("接口地址或模型名为空，请在设置页补全。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  try {
    // 1) 优先直接把图片 URL 交给模型，省流量也最快
    try {
      return await callVision(imageUrl, s, controller.signal);
    } catch (err) {
      if (imageUrl.startsWith("data:")) throw err;
      // 2) 图片有防盗链 / 模型取不到图时，下载后转 base64 再试
      const dataUrl = await fetchAsDataUrl(imageUrl);
      if (!dataUrl) throw err;
      if (dataUrl.length > 4 * 1024 * 1024) {
        throw new Error("图片太大（超过约 3MB），换一张小一点的图试试。");
      }
      return await callVision(dataUrl, s, controller.signal);
    }
  } catch (err) {
    if (err.name === "AbortError") throw new Error("请求超时（90 秒），请重试。");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (cfg) => {
      resolve({
        baseUrl: (cfg.baseUrl || "").trim(),
        apiKey: (cfg.apiKey || "").trim(),
        model: (cfg.model || "").trim(),
        template: cfg.template || DEFAULT_TEMPLATE,
        maxTokens: Number(cfg.maxTokens) || 1500
      });
    });
  });
}

/* ---------------- 视觉模型调用 ---------------- */

async function callVision(imageUrl, s, signal) {
  const endpoint = s.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: s.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: s.template }
        ]
      }
    ],
    temperature: 0.4,
    max_tokens: s.maxTokens,
    stream: false
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + s.apiKey
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    throw new Error("网络请求失败：" + (e.message || e) + "（检查接口地址/网络代理）");
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(httpErrorText(res.status, raw));
  }

  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content))
    text = content
      .map((p) => (typeof p === "string" ? p : p?.text || ""))
      .join("")
      .trim();

  if (!text) {
    throw new Error(
      "模型没有返回内容：" + JSON.stringify(data).slice(0, 200)
    );
  }
  return text.trim();
}

function httpErrorText(status, raw) {
  let detail = "";
  try {
    const j = JSON.parse(raw);
    detail = j?.error?.message || j?.message || "";
  } catch (e) {
    detail = (raw || "").slice(0, 160);
  }
  const map = {
    400: "请求被拒绝（400）。最常见原因是这个模型不支持图片输入（纯文本模型看不了图），换一个视觉模型即可；其次才是请求格式问题",
    401: "API Key 无效（401）",
    403: "没有权限（403），检查 Key 是否开通了该模型",
    404: "接口地址或模型名错误（404）",
    429: "触发限流或额度不足（429）",
    500: "模型服务端错误（500），稍后重试",
    502: "网关错误（502），稍后重试",
    503: "服务不可用（503），稍后重试"
  };
  const head = map[status] || `请求失败（HTTP ${status}）`;
  return detail ? `${head}：${detail}` : head;
}

/* ---------------- 图片转 base64（回退用） ---------------- */

async function fetchAsDataUrl(url) {
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  } catch (e) {
    return null;
  }
}
