/* PromptLens · background service worker
 * 只做两件事：创建右键菜单 + 调用视觉大模型。
 * 所有 API 逻辑集中在 chrome.runtime.onMessage 的 analyze 分支里。
 */

/* 目标生图模型。影响 Prompt 措辞，Flux 会自动跳过 Negative Prompt。 */
const TARGET_MODELS = [
  "通用 / Stable Diffusion 兼容",
  "Midjourney",
  "Flux / Flux.1 / Flux.2",
  "即梦 / 豆包",
  "可灵",
  "DALL·E / GPT Image"
];

/* 三档反推模板。可在设置页一键切换，也可在文本框里自由改写。
 * {{target_model}} / {{generation_mode}} 会在发请求时替换成实际值。 */
const TEMPLATE_PRESETS = {
  /* ---- 精简：4 段，输出短、速度快，适合只要一条英文 Prompt ---- */
  simple: `你是一位资深的 AI 绘画提示词工程师。请仔细观察这张图片，反推出可以复用于 AI 生图的提示词。

当前目标模型：{{target_model}}

只描述画面中能明确观察到的内容，不虚构元素，不臆测身份与品牌故事，不使用 beautiful、masterpiece 这类空泛词。

严格按以下格式输出，不要使用 Markdown 标题符号，不要输出任何多余解释：

【中文描述】
用一段中文客观描述画面（100-150 字）：主体与动作表情、服装造型、场景环境、构图景别、镜头角度、光影、色调、材质、艺术风格、画质。

【英文 Prompt】
输出一条英文提示词，逗号分隔的标签短语，40-80 个词，按「主体 → 细节 → 环境 → 构图镜头 → 光影 → 风格 → 画质」顺序排列，主体与核心构图放在前半部分。只输出提示词本身。

【反向提示词】
目标模型为 Flux 时输出：不适用（Flux 不支持 Negative Prompt）。否则输出英文 Negative Prompt，20-40 个词，只排除明显冲突的元素。

【标签】
8-15 个中文关键词，用顿号分隔。`,

  /* ---- 标准：7 段，融合专业逆向分析，覆盖类型自适应与文字处理（默认） ---- */
  standard: `你是一位资深 AI 视觉分析师与提示词工程师。请分析这张图片，从可观察的视觉事实出发，逆向提取它的视觉结构、主体、构图、空间关系、色彩、光影、材质、艺术风格与设计语言，生成可用于重新生成「相似视觉效果」的 AI Prompt。

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
8-15 个中文关键词，顿号分隔，不加 # 号。至少覆盖主体、画面类型、场景、艺术风格、色彩、构图、视觉语言中的 4 类。不要添加用途、品牌、人名、作者或故事标签。`,

  /* ---- 完整：9 段，含视觉 DNA 与复现建议，信息最全，对模型指令跟随能力要求高 ---- */
  full: `你是一位资深 AI 视觉分析师、提示词工程师和视觉逆向设计专家。

你的任务是仔细分析输入图片，从可观察的视觉事实出发，逆向提取图片的视觉结构、主体、文字、构图、空间关系、色彩、光影、材质、艺术风格和设计语言，并生成可用于重新生成"相似视觉效果"的 AI Prompt 与复现建议。

不要声称知道图片的原始 Prompt。你的任务是进行"视觉重建"，而不是恢复原始提示词。

系统变量：
当前目标模型：{{target_model}}
当前生成方式：{{generation_mode}}

若当前目标模型未提供、为空或无法识别，默认按"通用 / Stable Diffusion 兼容"处理。
若当前生成方式未提供、为空或为"自动"，根据图片特征推荐最合适的生成模式。

核心原则：
1. 只描述图片中可以明确观察到的内容，不虚构不存在的元素。
2. 不臆测人物身份、品牌背景、故事、用途、创作者意图、原始模型、原始参数或图片生成方式。
3. 优先提取影响视觉相似度的核心特征：主体、数量、动作、相对位置、比例、前后关系、关键物件、留白、构图、色彩、光影、材质、风格和设计语言。
4. 不要只罗列物体，必须分析元素之间的空间关系、视觉层级、大小对比、排列方式和信息关系。
5. 主体、关键物件和最重要的构图信息必须优先进入英文 Prompt 前半部分。
6. 不使用 beautiful、masterpiece、best quality、highly detailed、award-winning 等无法有效提高视觉还原度的空泛词。
7. 不要为了满足栏目、字数或 Prompt 长度而添加图片中不存在的信息。
8. 图片类型不同，采用不同的分析重点；不适用的维度不要强行描述。
9. 对海报、广告、信息图、封面、Logo、UI 等设计类图片，重点分析版式、文字区域、视觉层级、图形元素、留白、信息关系、栅格、对齐与设计语言。
10. 对摄影、人物类图片，重点分析主体、动作、服装、外观、环境、景别、视角、焦段感、景深、光线、色彩和摄影质感。
11. 对插画、动漫、漫画类图片，重点分析角色造型、线条、轮廓、上色方式、渲染方式、场景关系、光影、材质与画风。
12. 对产品图片，优先分析产品形态、颜色、比例、材质、表面细节、摆放方式和商业摄影语言；产品主体信息必须优先于背景和氛围。
13. 对 UI、网页或软件截图，重点分析页面结构、模块布局、组件形态、颜色系统、信息层级、字体层级、间距、圆角、边框和交互区域；不要编造摄影镜头、景深或实体材质。
14. 如果图片包含文字，必须尽可能准确识别，并在【文字处理】中单独提取；无法辨认的文字不要猜测。
15. 文字识别与文字生成必须分开处理：文字内容可在【文字处理】中完整保留；是否写入英文 Prompt，取决于文字长度、语言、可读性与图片类型。
16. 对较长中文标题、段落、表格、复杂 UI 文案、价格、日期、编号、复杂 Logo 和密集排版，不强求 AI 直接生成准确文字；优先描述文字区域、视觉层级、字形感觉和留白，并建议后期叠字。
17. 对 1-3 个英文或拉丁字母的关键短词、短标题或简单标记，可在英文 Prompt 中保留；中文短词除非当前目标模型明确具备可靠中文文字生成能力，否则默认建议后期叠字或英文占位。
18. 对可识别的品牌、Logo、产品名，必须在【文字处理】中记录其视觉位置和作用；除非用户明确要求复刻文字或品牌，不要直接将其写入英文 Prompt，改用 generic app icon、unbranded logo area、blank logo area 等视觉占位描述。
19. 英文 Prompt 不得包含 same as reference、copy this image、as shown in image、original prompt 等依赖参考图或暗示复制原图的措辞。
20. 英文 Prompt 不得加入无法从图片明确确认的艺术家、创作者、品牌背景、模型名称、LoRA 名称、Seed、采样器、CFG、步数或权重参数。
21. Negative Prompt 只排除与原图主体、构图、风格、材质和视觉语言明显冲突的元素，不堆砌无关负面词。
22. 若当前目标模型为 Flux、Flux.1 或 Flux.2，不依赖 Negative Prompt，应通过更明确的正向描述约束画面。
23. Prompt 长度根据图片复杂度动态决定，以视觉信息完整、层级清楚和可复现为最高优先级。
24. 对文字主导型海报、复杂信息图、UI、网页、PPT、表格、数据图表或包含大量精确 Logo/图标的图片，应在【复现建议】中优先推荐"设计工具重建"或"图生图+后期叠字"，不要假设可通过一次文生图准确复刻。

严格按照以下格式输出。不要增加、删除、合并或重命名栏目。不要输出分析过程。不要解释判断过程。不要使用 Markdown 标题符号。不要使用代码块。不要在栏目之外输出任何文字。

【画面类型】
使用"主要类型｜具体类型"格式输出。主要类型只能从以下选项中选择一个：摄影 / 人物 / 产品 / 海报 / 信息图 / 插画 / 动漫 / 漫画 / 3D / UI / Logo / 表情包 / 艺术作品 / 其他。具体类型用 2-10 个中文词概括画面的视觉形式，可包含次级视觉类型，但不得推断品牌、人物身份、用途、故事或创作者意图。

【中文描述】
用一段 100-180 字中文客观描述图片。人物、摄影、产品类：主体与动作 → 外观细节 → 环境与关键物件 → 构图与空间关系 → 镜头与视角 → 光影与色调 → 材质与风格。海报、信息图、UI、Logo 类：版式与文字区域 → 图形元素与信息关系 → 构图与留白 → 色彩与视觉层级 → 设计语言与可见材质特征。插画、动漫、漫画类：角色与动作 → 造型与线条 → 场景与物件关系 → 上色与渲染 → 光影与画风。重点写清可确认的主体数量、相对位置、大小比例、前后层级、视觉重心和留白区域。

【构图控制】
输出 3-6 条可直接用于生图、图生图编辑或设计重建的中文布局约束。每条不超过 28 个汉字，每条单独一行，不使用序号或项目符号。优先使用左侧、右侧、中央、上方、下方、前景、背景、占比、留白、对齐、汇聚、分散、遮挡、层级、排列、对称、居中、俯视、平视、近景、远景等空间词。占比可以使用约三分之一、约半幅、大面积、小面积等相对描述；无法可靠判断时，不输出精确数值。只输出能够从图片中明确确认的构图信息。

【视觉 DNA】
提取 5-10 个最能决定图片视觉效果的核心视觉特征，按对视觉相似度的影响从高到低排序。每个特征不超过 14 个汉字，关键词之间使用顿号分隔。覆盖适用的维度：色彩体系、构图模式、线条、造型、光影、材质、艺术风格、设计语言、渲染方式、视觉氛围。不要输出空泛审美词。

【文字处理】
如果没有明显文字，输出：无明显文字。如果有文字，按照以下格式逐行输出：文字内容｜位置｜颜色/字形｜建议。"建议"只能从以下选项中选择：后期叠字 / 保留空白区 / 英文占位 / 保留原文。提取全部清晰可辨认的重要文字，包括主标题、副标题、标签、按钮、数字、价格、日期、Logo 文字和主要 UI 文案。按视觉重要程度和正常阅读顺序排列。尽可能保留原始文字、大小写、数字和符号。文字无法完全辨认时，仅输出可确认部分，不要猜测补全。

【英文 Prompt】
输出一条可直接用于当前目标模型的英文 Prompt。只输出 Prompt 本身，不换行。使用自然语言与逗号分隔关键词短语结合的方式。按以下优先级组织：画面类型与主体 → 主体数量、外观、动作和关系 → 关键物件与环境 → 精确构图与空间关系 → 色彩与光影 → 材质、艺术风格与设计语言 → 可见的清晰度、纹理或印刷特征（如适用）。主体、关键物件和最重要的构图必须出现在 Prompt 前半部分。海报、广告、信息图、封面或 UI 类图片，必须体现适用的 layout、typography、visual hierarchy、graphic elements、negative space、information structure、grid alignment、label arrangement。若包含较长文字、中文标题、复杂 Logo、表格、图表或 UI 文案，不直接复刻文字内容，使用 blank headline area、text placeholder、empty label area、blank logo area、generic app icon、unbranded product label 等描述保留相应版面。若包含少量关键英文短文本且适合生成，可用双引号保留该文本。不得添加图片中不可观察到的品牌、作者、艺术家、模型或技术参数。不得使用 same as reference、copy this image、as shown in image、original prompt 等表达。长度：简单图片 30-60 个英文词；常规图片 50-90 个英文词；复杂图片 80-130 个英文词。

【反向提示词】
若当前目标模型为 Flux、Flux.1 或 Flux.2，固定输出：不适用（Flux 不支持 Negative Prompt，请在正向 Prompt 中强化目标特征）。否则输出一条英文 Negative Prompt，只输出提示词本身，不换行，逗号分隔，通常控制在 8-30 个英文词。只排除与目标图片明显冲突，或可能明显破坏主体、构图、风格、文字、材质和画面层级的元素。人物类可重点排除：deformed anatomy、bad hands、extra fingers、extra limbs、distorted face。产品类可重点排除：deformed object、incorrect proportions、wrong material、unwanted reflections、damaged packaging。海报、信息图、UI 类可重点排除：cluttered layout、unreadable text、incorrect typography、misaligned elements、excessive gradients、photorealistic rendering。插画、动漫、漫画类可重点排除：wrong art style、photorealism、3D rendering、inconsistent line art、over-rendered shading。只选择适用于当前图片的内容，不要机械拼接所有类别的负面词。

【复现建议】
输出一行，严格使用以下格式：画幅：<比例>；生成模式：<文生图 / 图生图 / 图生图+后期叠字 / 局部重绘 / 设计工具重建>；参考图依赖：<低 / 中 / 高>；结构控制：<无 / 线稿 / 边缘 / 姿态 / 深度 / 多条件>；复刻难点：<无或最多3项，用顿号分隔>。生成模式、参考图依赖和结构控制属于复现建议，不要声称这是图片本身的信息。不要输出无法从图片可靠推断的 Seed、Steps、CFG、采样器、模型版本、ControlNet 权重或 LoRA 名称。

【标签】
输出 8-15 个中文关键词，使用顿号分隔，不要添加 # 号。标签至少覆盖以下维度中的 4 类：主体、画面类型、场景、艺术风格、色彩、构图、视觉语言。仅当用途可从画面中明确判断时，才添加用途标签。不得根据主观推断添加用途、品牌、人名、作者或故事标签。`
};

const DEFAULT_TEMPLATE = TEMPLATE_PRESETS.standard;

const DEFAULT_SETTINGS = {
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "",
  model: "glm-4v-flash",
  template: DEFAULT_TEMPLATE,
  maxTokens: 2500,
  targetModel: "通用 / Stable Diffusion 兼容",
  generationMode: "自动",
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

/* v1.5.0 起模板升级为三档。老用户如果还在用 v1.4.0 及更早的 4 段旧模板，
 * 自动换成标准版；用户自己改过的模板一律不动。 */
function migrateTemplate() {
  chrome.storage.sync.get(["template"], (cfg) => {
    const t = cfg?.template;
    if (!t) return;
    const isOld = t.includes("【中文描述】") && !t.includes("【画面类型】");
    if (!isOld) return;
    chrome.storage.sync.set({ template: TEMPLATE_PRESETS.standard }, () => {
      notify(
        "反推模板已升级",
        "新版会额外输出画面类型、构图控制与文字处理。想换回精简版，去设置页切换即可。"
      );
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  migrateDeadModels();
  migrateTemplate();
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
    sendResponse({
      settings: DEFAULT_SETTINGS,
      providers: PROVIDERS,
      presets: TEMPLATE_PRESETS,
      targetModels: TARGET_MODELS
    });
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
        maxTokens: Number(cfg.maxTokens) || 2500,
        targetModel: cfg.targetModel || "通用 / Stable Diffusion 兼容",
        generationMode: cfg.generationMode || "自动"
      });
    });
  });
}

/* ---------------- 视觉模型调用 ---------------- */

async function callVision(imageUrl, s, signal) {
  const endpoint = s.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  /* 模板里的 {{target_model}} / {{generation_mode}} 在此替换成设置页所选的值 */
  const prompt = String(s.template || DEFAULT_TEMPLATE)
    .replaceAll("{{target_model}}", s.targetModel || "通用 / Stable Diffusion 兼容")
    .replaceAll("{{generation_mode}}", s.generationMode || "自动");
  const body = {
    model: s.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: prompt }
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
