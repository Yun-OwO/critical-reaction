# 更新记录 · Changelog

本仓每次有功能 / 内容更新都记在这里，方便使用者一眼知道更了啥。
格式参考 [Keep a Changelog](https://keepachangelog.com)；日期 YYYY-MM-DD。渲染版 → [`CHANGELOG.html`](CHANGELOG.html)。

> **EN** · What changed in each update, so users can see new features / content at a glance.

---

## v1.3 · 2026-07-13

> **本次主要**：新增**操作循环示意图规范**（按键即节点 / 键帽 / `▶ 开始`标记 / 冷热启动双入口 / 内外双环）+ **效果养成范式升级**（阅读顺序铁律 / **属性堆叠审计** / **连点里程碑** / 双峰形态口径 / 审计避坑清单）；三份样板（苍岚 ×2 / 烬羽）按新范式补图补审计。沉淀自一轮真实角色养成稿评审迭代。
>
> **对使用者**：pull 后**无需操作** —— 新增 1 个 reference + 范式细化 + 样板增图，既有流程不变。无破坏性变更。

### 新增 Added
- **操作循环示意图规范** —— [`references/operation-loop-diagram.md`](references/operation-loop-diagram.md)：**按键即节点**（键帽五语义色：核心技蓝 / 爆发金 / 填充灰 / 防御青 / 协作粉）+ `▶ 开始`标记 + **冷启 / 热启双入口** + **内圈维持 ＋ 外圈爆发双环**（含"维持工具箱"与"卡拍"范式）+ 排版铁律（网格对齐 / 少折线 / 标签不遮挡 / **美观优先**）。出图规则按文档规格分：**纯战斗设计分稿只出 C0**（不含养成）；养成稿 / 完整稿出 **C0 ＋ 满配对照**（满配图展示"养成买到的操作变化"）。
- **属性堆叠审计范式** —— [`references/effect-progression-design.md`](references/effect-progression-design.md) § 三：同属性跨来源（技能效果 ＋ 被动 ＋ 命座 ＋ 套装）**极限同刻**审计 —— 逐线极限构成 + 兜底类别（转化上限 / 幂衰减 / 行为限幅 / 单向阀 / 窗口时限，有几条写几条）+ 一句整体判定 + 极限单发校验；附 5 条审计避坑（同轴撞车 / 定位越界 / 入口过多 / 永续漏洞 / 演出冲突）。
- **连点里程碑视角（示例 ／ 推荐，节奏按项目定）** —— 同上 § 二：按**你项目玩家的实际购买节奏**画累计增益（分包由项目商业化设计定，「1+2 连点 / 3+4 连点 / 直奔收官」为常见 gacha 示例），每个连点包标注主题 + 同轴检查。

### 变更 Changed
- **效果养成范式 7 章按阅读顺序重排** —— 同上 § 一：**属性投放章必须排在技能附带效果与命座 / 养成物之后**（它汇总的正是前两处的投放，先读投放再读来源会来回翻）；操作循环图上移到壹章。
- **双峰形态（示例 ／ 推荐口径，按项目定）** —— 业界 gacha 常见「拐点 ＋ 收官」双峰（E2 / E6 付费节奏），并非必须逐级严格递增；具体形态按项目付费哲学定，通用提示是单峰过陡（单段 >35~40%，近半个新角色）有「X 命起玩」舆论风险。
- **数值建模硬标准 +1 项** —— [`references/design-doc-structure.md`](references/design-doc-structure.md)：**属性投放与堆叠审计**成为必配项（gacha 另配连点里程碑）。
- **完整稿贰章操作循环图规格** —— 同上：按 `operation-loop-diagram.md` 出 **C0 ＋ 满配对照两张**；分稿战斗设计稿只出 C0。
- **三份样板按新范式升级** —— 苍岚战斗设计稿补 C0 键帽循环图；苍岚养成稿升级为 C0 / 满配对照 ＋ 属性堆叠审计 ＋ 连点里程碑；烬羽完整稿升级为 C0 / 满配对照 ＋ 属性投放与堆叠审计章（含投放表 ＋ 极限堆叠横条图）。
- **完整稿 9 章序调整** —— 配队协力前移至**肆**（战斗行为与招式一脉，且让「养成命座 → 数值建模」相邻），资源系统改伍、养成命座改陆；模板 `blank-character-design-doc.html` 与样板烬羽同步（section 顺序 / SECTIONS / 评审备注编号 / 交叉引用），9 章表见 `design-doc-structure.md`。
- **循环图「拓扑先行」铁律** —— `operation-loop-diagram.md`：拓扑必须由角色机制推导（跑道型 / 自动环型 / 计量池型 / 双环型…），禁止套用他角图形 —— 两个角色的循环图形状雷同，先怀疑画错；铁律扩展到所有示意图（资源流转 / 堆叠 / 数值曲线同样不套皮换字）。样板烬羽、苍岚循环图均按各自机制重画（烬羽「自动自燃环 ＋ 按键加速器」、苍岚「势计量池 ＋ 按层出口」）。
- **样板阅读顺序修正** —— 苍岚养成稿操作循环图自伍章上移到壹章（先看循环，再看往循环上挂什么）；苍岚战斗设计稿移植图表 lightbox（此前缺失，插图不可点击放大）。
- **属性投放与堆叠审计独立成章** —— 完整稿由 9 章升为 **10 章**（新柒章，位于养成命座与数值建模之间）；模板 / 样板烬羽 / `design-doc-structure.md` 10 章表同步重编号；分稿养成稿维持在属性章内。苍岚投放表升级为「谁吃到 × 属性 × 来源与量」＋「面板词条优先级」双表。
- **样板图表评审级排版精修** —— 循环图按各自机制拓扑重画并做评审级排版（箭头对中 ／ 汇入圆点 ／ 间距留足），堆叠横条图按专业规格出图（网格 ＋ 坐标轴 ＋ 图例、标签不越界）。
- **堆叠审计呈现升级「五件套」** —— 投放表 → 来源构成横条图 → 📐 怎么算 / 为什么 / 结果 三问框 → 极限同刻判定表 → 兜底机制清单 ＋ 整体判定醒目条（`.philosophy`，不再淹在小字里）。苍岚补来源构成图与兜底清单，烬羽判定表补齐算式、兜底独立成块；模板 / 范式文档同步。
- **诚实精准铁律与审计口径细化** —— [`design-doc-structure.md`](references/design-doc-structure.md) 顶部新增 🔴 **诚实精准铁律**（一切内容按实际设计推导：有多少写多少、不多编不少写，结构底线 ＝ 该有的都有 ＋ 阅读顺序正确）；兜底机制明确「有几条写几条，别硬凑」、极限单发校验明确**同招对比**口径（入 `effect-progression-design.md` § 三）；**连点节奏表**入养成 / 命座章（与数值章里程碑两处呈现，均注明按项目商业化定）；两份样板及 md 源稿按铁律复核修正。
- **三问注解统一分行式** —— 所有「📐 怎么算 / 为什么 / (过程 /) 结果」注解统一为 anno-box 分行注解框（标题行 ＋ 每问一行）；摆放规则：有卡片承载的放进卡片内（与 SVG 同卡成一个视觉单元），无卡片承载的独立成块；样板同步。
- **样板双向诚实审计复核（编造 ↔ 遗漏）** —— 对两份样板做「引用处 vs 定义处逐条核对 ＋ 设计元素反查下游落点」的双向审计，修复口径矛盾与覆盖缺口 38 项（审计线补全、循环图冷 ／ 热双入口、资产清单补齐、失效交叉引用清零等），样板与 md 源稿全量对齐。

### 修复 Fixed
- 无破坏性修复；本次以范式 / 样板补全为主。

### 📁 本次涉及文件
- **新增（1）**：`references/operation-loop-diagram.md`
- **修改（13）**：`SKILL.md` · `README.md` · `CHANGELOG.md` + `CHANGELOG.html` · `references/effect-progression-design.md` · `references/design-doc-structure.md` · `templates/blank-character-design-doc.html` · `output/characters/cang-lan/苍岚-战斗设计.html` + `苍岚-养成与效果.html` + 两份 `md/` 源稿 · `output/characters/jin-yu/烬羽-战斗设计及养成效果.html` + `md/` 源稿
- **删除（0）**：无

---

## v1.2 · 2026-06-23

> **本次主要**：新增**完整角色稿模板** + **完整稿满配样板「烬羽」**，并把「角色设计稿」明确成**分稿 / 完整稿两种规格** + **文件命名规范** + **数值建模硬标准**；元规则 42 → 46 条、角色原型库去项目脱敏、只保留业界 F–Q 12 种。
>
> **对使用者**：pull 后**无需操作** —— 新增模板 / 样板 / 范式细化，既有「分稿」流程不变；想出一份到底的完整稿时多一套模板可用。无破坏性变更。

### 新增 Added
- **完整角色稿模板** —— [`templates/blank-character-design-doc.html`](templates/blank-character-design-doc.html)：通用 9 章（设计定位哲学 / 核心机制 / 招式详解 / 🟡 资源系统（深入，按角色）/ 养成命座 / 🟡 配队协力（按项目）/ 数值建模 / 资源清单 / 自检）+ **三类图骨架**（贰 操作循环示意图、肆 资源流转示意图、柒 数值建模 5 图）+ 完整协作交互层 + 图表 lightbox。
- **完整稿满配样板「烬羽」** —— [`output/characters/jin-yu/`](output/characters/jin-yu/)（延迟引爆型火术者，挂《星澜纪》gacha）：9 章全 + 10 图（操作循环 / 资源流转 / 数值建模 5 图）。作「完整稿」满配样板，区别于苍岚的「分稿」样板。
- **角色原型库 project-agnostic 化** —— [`character-archetypes.md`](references/character-archetypes.md)：移除项目脱敏的基础 5 种（A–E）+ R 延迟引爆，**只保留业界调研 F–Q 12 种**；各项目自家原型放本地 [知识区](knowledge-local/)。延迟引爆机制仍由完整稿样板「烬羽」演示。
- **4 条新元规则（K 组）** —— [`meta-rules.md`](references/meta-rules.md)：操作核心方向先对齐 / 消极动作不触发爆发 / 资源返现易空转（走限时窗）/ 异格不换皮三轴分流（元规则 42 → 46 条）。

### 变更 Changed
- **角色完整稿范式细化** —— [`design-doc-structure.md`](references/design-doc-structure.md) 明确**两种规格**：分稿（战斗设计稿 + 养成稿分开）/ 完整稿（一份 9 章），并给**判断逻辑**（用户明示按明示、没明示就问）。
- **文件命名规范** —— 同上：`角色名-战斗设计` / `角色名-养成与效果` / `角色名-战斗设计及养成效果` / `角色名-资源需求`；「审阅稿」是协作形态、不进文件名。
- **数值建模硬标准** —— 同上：无论完整稿还是分稿养成稿，数值建模必配 **5 图 + 三段注解 + 平衡自检表**，只写表不配图 = 不合格。
- **图表 lightbox 按界面 fit 完整显示** —— [`review-html-components.md`](references/review-html-components.md)：`width:94vw` + `max-height:88vh` + `height:auto`，宽图撑满、高图触顶自动等比缩到完整居中，都不被裁（废弃旧的固定 `width:min(1180px,…)`）。
- **苍岚分稿按命名规范重命名** —— `苍岚-战斗设计.html` + `苍岚-养成与效果.html`（原「审阅稿 / 效果与养成-gacha 演示」）。

### 修复 Fixed
- 无破坏性修复；本次以内容 / 范式补全为主。

### 📁 本次涉及文件
- **新增（3）**：`templates/blank-character-design-doc.html` · `output/characters/jin-yu/烬羽-战斗设计及养成效果.html` + `md/烬羽-战斗设计及养成效果.md`
- **修改（7）**：`SKILL.md` · `README.md` · `上手指南.html` · `CHANGELOG.md` + `CHANGELOG.html` · `references/design-doc-structure.md` · `references/review-html-components.md`（元规则 / 原型 计数随 `meta-rules.md` / `character-archetypes.md` 同步）
- **重命名（2）**：`output/characters/cang-lan/` 下 `苍岚-战斗设计` + `苍岚-养成与效果`（html + md/）
- **删除（0）**：无

---

## v1.1 · 2026-06-18

> **本次主要**：新增自我更新机制（🧪 试验性）+ 数值建模验证方法论 + gacha 示例项目，并让设计稿默认产出审阅 HTML。
>
> ⚠️ **行为变更**：设计稿产出 —— md 草稿确认后**默认随之产出审阅级 HTML**（原先需单独要）。
> **对使用者**：pull 后**无需操作** —— 自我更新默认关闭；设计稿产出默认多出 HTML 孪生；无破坏性变更。

### 新增 Added
- **自我更新机制（🧪 试验性）** —— 新增 [`knowledge-local/`](knowledge-local/)：下游 agent 在使用中**自动捕获**可复用洞察（`self-update/`）+ 用户**指定**的项目知识（`project-knowledge/`）。全留本地、**不进 git**、**默认关闭**（首次触发会问，因为耗 token）。带「写入前归属判定」triage。
- **数值建模验证方法论** —— [`numbers-and-progression.md`](references/numbers-and-progression.md) § 十：脚本化建模 → 独立 agent 对抗性交叉验证 → 设计稿内嵌可视化论证（每图「怎么算 / 为什么 / 结果」三问注解）。
- **命座 / 养成梯度健康自检阈值** —— § 五：满命总梯度 +80~120% 等 8 项经验基线，含养成物 / 套装阈值。
- **效果与养成设计范式** —— 新增 reference `effect-progression-design.md`：7 章结构 + 3 类图 + 数值注解四要素（怎么算 / 为什么 / 过程 / 结果）；以苍岚 gacha 演示稿为范例（references 22 → 23 份）。
- **gacha 示例项目《星澜纪》** —— [`conventions/example-conventions-gacha.md`](conventions/example-conventions-gacha.md)（3D 三人队 + 命座 + 养成物 + PVP）+ 配套 [苍岚 gacha 移植效果稿](output/characters/cang-lan/md/苍岚-养成与效果.md)（技能附带 / 命座 / 养成物效果 + § 十 数值验证演示）。
- **上手指南 conventions 概览图** —— [`上手指南.html`](上手指南.html) 第 ⑤ 节加「10 维度一图看全 + 买断 / gacha 双范例对比」。
- **本更新记录** —— `CHANGELOG.md` + 渲染版 `CHANGELOG.html`。

### 变更 Changed
- **设计稿产出默认配审阅 HTML** —— Phase 6：md 草稿确认 OK 后，**默认自动产出审阅级 HTML 孪生**（不用再单独要）。
- **加法增伤区稀释** —— § 四 增补「自拐被面板增伤稀释」边际算法 `S ÷ (1+P)`。
- **§ 五阈值取用说明** —— 明确「场景梯度 / PVP / 养成物」按定位 / 品类取用，单体 / 单机 / 无 PVP 角色对应项判 N/A。

### 修复 Fixed
- 上手指南「目录结构」树补上 `knowledge-local/`。
- references 份数纠正：文档原称「21 份」实为 22（漏数 `dual-arena-boss.md`），现按实际标注（初始 22 → 现 23）。
- 审阅 HTML 里 B 站嵌入由协议相对 `//player.bilibili.com` 改为 `https://`，file:// 本地打开也能放（与 YouTube 对齐）。

### 📁 本次涉及文件
- **新增（9）**：`knowledge-local/`（README + 2 占位）· `conventions/example-conventions-gacha.md` · `references/effect-progression-design.md` · `output/characters/cang-lan/md/苍岚-养成与效果.md` + 同名 `.html` · `CHANGELOG.md` + `CHANGELOG.html`
- **修改（7）**：`SKILL.md` · `README.md` · `USAGE.md` · `conventions/TEMPLATE.md` · `references/numbers-and-progression.md` · `上手指南.html` · `.gitignore`
- **删除（0）**：无

---

## v1.0 · 初始版本 · Initial

- **项目无关的 ACT 战斗设计方法论 + 行业知识库**：6 Phase 流程（角色 / Boss）、`conventions/TEMPLATE.md` 项目约定模板、22 份 references 知识库（角色原型 / Boss 范式 / 42 元规则 / 70+ 跨游戏借鉴 / 打击感 · 数值 · Boss AI 工程基线 / 审阅 HTML + 资源 xlsx 产出工具链）。
- **示例**：买断制示例项目《孤刃行》+ 示例角色「苍岚」+ 示例 Boss「孤鸦」（含审阅 HTML + 资源 xlsx）。
- **多 agent 可用**：纯 markdown，Claude Code / GPT / Claude.ai / Cursor 均可加载（见 [`USAGE.md`](USAGE.md)）。
