/* PromptLens · 设置页逻辑 */

/* 兜底用：background 拿不到时（例如直接以网页方式打开本页）不至于让模板框空白。
 * 内容与 background.js 的 TEMPLATE_PRESETS.standard 保持一致。 */
const LOCAL_TEMPLATE = `你是一位资深 AI 视觉分析师与提示词工程师。请分析这张图片，从可观察的视觉事实出发，逆向提取它的视觉结构、主体、构图、空间关系、色彩、光影、材质、艺术风格与设计语言，生成可用于重新生成「相似视觉效果」的 AI Prompt。

不要声称知道图片的原始 Prompt。你的任务是「视觉重建」，不是恢复原始提示词。

当前目标模型：{{target_model}}

核心约束：
1. 只描述图片中能明确观察到的内容，不虚构不存在的元素。
2. 不臆测人物身份、品牌背景、故事、用途、创作者意图或原始生成参数。
3. 必须分析元素之间的空间关系、视觉层级、大小对比与排列方式，不能只罗列物体。
4. 不使用 beautiful、masterpiece、best quality 等无法提高还原度的空泛词。
5. 主体、关键物件和最重要的构图信息必须优先进入英文 Prompt 前半部分。
6. 按图片类型切换分析重点：摄影与人物看主体动作、服装、环境、景别、视角、光影与摄影质感；海报、信息图、UI 看版式、文字区域、视觉层级、留白与设计语言；插画、动漫看角色造型、线条、上色、渲染与画风；产品看形态、颜色、比例、材质、表面细节与商业摄影语言。
7. 图片含文字时在【文字处理】中单独提取，无法辨认的不要猜；长中文、复杂排版、密集 UI 文案默认建议后期叠字，不要指望 AI 一次生成准确文字。
8. 品牌、Logo、产品名只记录位置和作用，用 blank logo area、generic app icon 等占位描述，不要写进英文 Prompt。
9. 英文 Prompt 不得出现 same as reference、copy this image、as shown in image 等措辞，不得添加艺术家名、模型名、LoRA、Seed、CFG 等参数。
10. 目标模型为 Flux 时不输出 Negative Prompt，改为强化正向描述。

严格按以下格式输出。不要增加、删除或重命名栏目，不要输出分析过程，不要使用 Markdown 标题符号或代码块，栏目之外不输出任何文字。

【画面类型】
主要类型｜具体类型。主要类型只能选一个：摄影 / 人物 / 产品 / 海报 / 信息图 / 插画 / 动漫 / 漫画 / 3D / UI / Logo / 表情包 / 艺术作品 / 其他。具体类型用 2-10 个中文词概括视觉形式。

【中文描述】
100-180 字中文客观描述。人物摄影产品类按「主体与动作 → 外观细节 → 环境与关键物件 → 构图与空间关系 → 镜头与视角 → 光影与色调 → 材质与风格」；海报信息图 UI 类按「版式与文字区域 → 图形元素与信息关系 → 构图与留白 → 色彩与视觉层级 → 设计语言」；插画动漫类按「角色与动作 → 造型与线条 → 场景与物件关系 → 上色与渲染 → 光影与画风」。写清主体数量、相对位置、大小比例、前后层级、视觉重心和留白。不适用的维度不要强行描述。

【构图控制】
3-6 条可直接用于生图的中文布局约束，每条不超过 28 字，单独一行，不使用序号。优先使用左侧、右侧、中央、上方、下方、前景、背景、占比、留白、对齐、对称、居中、近景、远景等空间词。只输出能明确确认的信息。

【文字处理】
无明显文字则输出：无明显文字。有文字则逐行输出：文字内容｜位置｜颜色或字形｜建议。建议只能是：后期叠字 / 保留空白区 / 英文占位 / 保留原文。按视觉重要程度排列，保留原始大小写、数字和符号，无法辨认的部分不要补全。

【英文 Prompt】
一条可直接用于当前目标模型的英文 Prompt，只输出 Prompt 本身，不换行，自然语言与逗号分隔关键词短语结合。顺序：画面类型与主体 → 数量外观动作关系 → 关键物件与环境 → 精确构图与空间关系 → 色彩与光影 → 材质风格与设计语言 → 可见的清晰度与纹理特征。主体与核心构图必须在前半部分。长文字、中文标题、复杂 Logo、表格与 UI 文案用 blank headline area、text placeholder、empty label area、blank logo area 等占位；少量关键英文短词可用双引号保留。长度按复杂度：简单 30-60 词，常规 50-90 词，复杂 80-130 词。

【反向提示词】
目标模型为 Flux 时固定输出：不适用（Flux 不支持 Negative Prompt，请在正向 Prompt 中强化目标特征）。否则输出一条英文 Negative Prompt，逗号分隔，8-30 个词，只排除与目标画面明显冲突的元素，按类型选择：人物类 deformed anatomy、bad hands、extra fingers、extra limbs、distorted face；产品类 deformed object、incorrect proportions、wrong material、unwanted reflections；海报信息图 UI 类 cluttered layout、unreadable text、incorrect typography、misaligned elements、photorealistic rendering；插画动漫类 wrong art style、photorealism、3D rendering、inconsistent line art。只选适用的，不要堆砌。

【标签】
8-15 个中文关键词，顿号分隔，不加 # 号。至少覆盖主体、画面类型、场景、艺术风格、色彩、构图、视觉语言中的 4 类。不要添加用途、品牌、人名、作者或故事标签。`;

const LOCAL_TARGET_MODELS = [
  "通用 / Stable Diffusion 兼容",
  "Midjourney",
  "Flux / Flux.1 / Flux.2",
  "即梦 / 豆包",
  "可灵",
  "DALL·E / GPT Image"
];

const FALLBACK = {
  settings: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    model: "glm-4v-flash",
    template: LOCAL_TEMPLATE,
    maxTokens: 2500,
    targetModel: "通用 / Stable Diffusion 兼容",
    hoverEnabled: true,
    autoCopy: false
  },
  presets: { standard: LOCAL_TEMPLATE },
  targetModels: LOCAL_TARGET_MODELS,
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
let PRESETS = {};

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
  PRESETS = def.presets && Object.keys(def.presets).length ? def.presets : FALLBACK.presets;
  const targetModels = def.targetModels?.length ? def.targetModels : FALLBACK.targetModels;

  PROVIDERS.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.name;
    $("provider").appendChild(opt);
  });

  targetModels.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    $("targetModel").appendChild(opt);
  });

  const cfg = await new Promise((r) => chrome.storage.sync.get(def.settings, r));
  $("baseUrl").value = cfg.baseUrl || "";
  $("apiKey").value = cfg.apiKey || "";
  $("model").value = cfg.model || def.settings.model || "";
  $("template").value = cfg.template || def.settings.template || LOCAL_TEMPLATE;
  $("maxTokens").value = cfg.maxTokens || 2500;
  $("targetModel").value = cfg.targetModel || def.settings.targetModel || targetModels[0];
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
    maxTokens: Number($("maxTokens").value) || 2500,
    targetModel: $("targetModel").value,
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

$("tplPreset").addEventListener("change", () => {
  const t = PRESETS[$("tplPreset").value];
  if (!t) {
    setStatus("这段预设没有加载到，请确认扩展已刷新（chrome://extensions/ 点 ↻）。", "err");
    return;
  }
  $("template").value = t;
  setStatus("已切换模板，记得点保存。", "");
});

$("reset").addEventListener("click", async () => {
  const def = await getDefaults();
  $("tplPreset").value = "standard";
  $("template").value = def.settings.template || LOCAL_TEMPLATE;
  $("maxTokens").value = def.settings.maxTokens || 2500;
  $("targetModel").value = def.settings.targetModel || LOCAL_TARGET_MODELS[0];
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
