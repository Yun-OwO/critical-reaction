# Hades 对标打磨清单（critical-reaction）

> 研究对象：《Hades》（Supergiant Games, 2020，1.0 版本口径）。
> 产出目的：给「临界反应」提供一份**可直接落到文件与行号**的打磨路线，不是设计随笔。
> 撰写方式：先逐个读本仓库源码（`GameScene.ts` 7026 行、`upgrades.ts`、`weapons.ts`、`rooms.ts`、`biomes.ts`、`GameState.ts`、`feedback.ts` 等），
> 再用 websearch 检索 Hades 的可验证机制细节；**凡未能从公开资料确认的数值，一律标注 `[待确认]`，不做编造**。
> 约束：本文档只做规划，**不修改任何游戏代码**。

---

## 0. 阅读须知：三条与「在进行的改动」对齐的硬约束

本文档的所有特效类建议都必须服从以下三条约束（它们来自当前正在进行的改动方向，不冲突、不返工）：

1. **禁止再新增「每次命中 `new` 一个对象 + 一条 tween」的特效路径。**
   证据：`GameScene.ts` 现有 `this.tweens.add` 142 处、`this.add.circle` 123 处、`this.add.graphics` 20 处，
   其中绝大多数在 `meleeAttack` / `registerHit` / `impactHitAt` / `spawnElectronFlow` / `damagePlayer` / `killEnemy` 的**每命中路径**上。

   **池子已经建好了**：`src/game/utils/Fx.ts` 的 `FxPool`（空闲链表 + 硬上限 FIFO 逐出 + 零运行时分配 + `burst/sparkCone/ring` 高层接口）
   与 `src/game/utils/Quality.ts` 的 `LoadMonitor`（自适应负载分级 `MAX_PARTICLES` low 360 / medium 800 / high 1400 × `LOAD_PARTICLES` 四档缩放）。
   **当前缺口不是「建池」而是「接线」：`GameScene` 尚未 import 这两个文件**（`grep "from '.*Fx'"` 在 `scenes/` 与 `visual/` 下无命中）。
   本清单 P0-1 因此定位为**整合**，不重复造池。

2. **地面/装饰/雾气等静态对象必须走 `registerCullable()` 离屏裁剪**（`GameScene.ts:1174-1176`、`1158-1172`）。
   任何新增地物、瓦片、地面特效都必须登记，否则会加剧「400+ 地面贴图对象」的渲染压力
   （`biomes.ts:226` 的 `maxTiles: 420` 就是这条约束的上限阀）。

3. **任何视觉强度开关必须经过质量分档**。现有两套配置：`visual/quality.ts:19-24` 的 `getVisualProfile()`（`glowLayers` / `particleScale` / `bloomEnabled`）与新写的 `utils/Quality.ts` 的 `QualityTier` + `LoadMonitor`。建议以 `utils/Quality.ts` 为**运行时**权威（它有自适应负载降档），`visual/quality.ts` 保留给 Bloom/辉光这类静态档位——两者需要一次明确的职责划分，否则会出现「用户设了高质量、负载监控又把它降到低」的冲突。
   低档 `glowLayers: 1 / particleScale: 0.55 / bloomEnabled: false` 是移动端基线，新特效在低档必须能优雅降级或直接关闭。

---

## 一、Hades 的核心设计支柱（含可验证机制细节）

### 支柱 1：打击手感是「分层系统」，不是「一次调大数值」

Hades 的打击感由**至少六个正交通道**叠加，且每个通道都有**明确的强度层级**：

| 通道 | Hades 的做法（可验证） | 关键点 |
|---|---|---|
| 命中定格 hit-lag | Hades / Hades II 在命中瞬间有**轻微屏幕冻结**；Hades II 的 NexusMods 有一个专门的 mod 叫 **「Disable Hit Lag - Hades II」**，描述为 *"Disables the slight screen freeze when hitting with attacks"* | 有，且短。定格是**克制**的，不是格斗游戏式的长停顿 |
| 命中闪白 | 敌人被击中时有白色 overlay 提亮（学术界在分析 Hades 攻击预警时也提到 *"the enemy holds a pose and is colored with a white overlay"*，说明白闪是本作的通用视觉语言） | 白闪同时承担「命中确认」和「攻击预警」两种职责，靠**时长/位置**区分 |
| 击退 knockback | 大多数武器自带击退；**波塞冬祝福线的核心就是强化击退**，并有专属结算：**把敌人砸向墙体触发 wall slam 额外伤害** | 击退不是纯位移，是**通往额外伤害的输入** |
| 环境杀 | 撞墙（wall slam）、推入尖刺/岩浆/柱子都是有效输出手段 | 环境是玩家资源 |
| 护甲与破甲 | 敌人有**黄色护甲条**：护甲期间**免疫眩晕与击退**；护甲被打空时**短暂眩晕** | 护甲层的存在让「击退/眩晕」这类控制不是无脑强 |
| 分级反馈 | 普通命中 / 精英 / Boss / 玩家受击 是**四档不同的强度**。Supergiant 开发者在直播中明确说过 *"I changed the hit stun tuning… it should feel kind of more appropriately big when you get hit by those guys"* —— 说明**击退/硬直是按敌人类型逐个调的**，不是全局一个数 |

**落地要点**：普通命中必须比击杀**安静得多**。所有事件都拉满 = 神经系统停止读取任何反馈（"过度 juice" 失败模式）。

### 支柱 2：敌人意图必须 100% 可读（公平性高于一切）

- **攻击前摇 = 白色 overlay + 定格 pose**（见上文引用）。敌人在出手前会**摆一个明显姿势并被白光覆盖**，玩家读得懂就能躲。
- **远程/范围攻击有地面预警**。本项目已有同类实现：`enemyBeamAttack` 有 0.55s 瞄准预警（`GameScene.ts:5805-5833`），Boss 有 slam/aoe 预警圈（`6042-6049`、`6203-6210`）。
- **刷怪有 spawn ring**：敌人出现前地面先出现生成环，玩家可以据此走位。Hades 社区分析（Medium《How Hades Creates a Responsive Underworld》）明确把 *"enemy spawn rings"* 列为关键反馈机制，评价其 *"also informative … allows for a little bit of strategy, informing players clearly where and when enemies will spawn."*
  本项目已有 `telegraphSpawn` 0.7s 红菱形标记（`GameScene.ts:1917-1931`），方向正确。

### 支柱 3：Boon 系统的深度来自「槽位互斥 + 前置条件 + 稀有度掷骰」三件套

Hades 的祝福系统（1.0 版本，Hades II 结构类似）：

- **5 个互斥能力槽**：Attack / Special / Cast / Dash / Call（后期解锁）。同槽只能装一个，后拿的**顶掉**先拿的。
- **被动槽无上限**：所有"buff 类"祝福（Hermes 的加速、各种 dead-end boons）**不占槽**，可以无限堆。
- **稀有度是掷出来的，不是固定的**：Common / Rare / Epic / **Heroic**（注意是 Heroic，不是 Mythic）。
  公开资料描述的流程是：*"For the remaining empty boon slots, roll for rarity, starting with Legendary/Duo boons and finishing with Common boons."*
- **等级（Lv）与稀有度是两条正交的成长轴**：稀有度抬数值，Pom of Power 抬等级，且**等级收益递减**
  （*"The first 2-3 level ups will give a somewhat substantial buff… but later levels will grant far smaller boosts."*）。
  Hades II 里有个被广泛引用的经验法则：**Lv.2 Common ≈ Lv.1 Rare**。
- **前置条件池（真正的构筑深度来源）**：
  - 每个神 **5 个核心 boons**（对应 5 槽）+ 若干 dead-end / tier-2 boons；
  - **Duo boons** 需要**两个不同神各出一个核心祝福**才进池；
  - **Legendary boons** 需要该神的 tier-2 祝福作为前置；
  - 不满足前置时，*"the target may not be in the pool yet"* —— 这是「规划感」的来源：玩家会**为了 Duo 而有意识地先拿两个核心**。

### 支柱 4：关卡节奏 = 门上可见的奖励 + 分叉选择 + 固定长度

- **门上直接显示奖励**：*"The reward for each chamber is visible on its entrance door, and is obtained after clearing the chamber."* 这是 Hades 房间链的核心信息设计——**选择发生在进门前**，而不是清完怪才知道给什么。
- **固定总长**：*"A total number of 73 chambers may be encountered in a run."* Tartarus Boss 在第 14 间、Asphodel 第 24 间、Elysium 第 36 间。
  Hades II 的门符号表也确认了「双神门 = Trial of the Gods（选一边，另一边会来打你）」这类**风险换双份奖励**的分支。
- **单局时长**：多数玩家单局 **23–30 分钟**（社区统计口径）；首次通关常在 30+ 分钟。这决定了「一局里祝福选择次数」大约是 **8–15 次**。
- **NPC 房是一次性的**：Sisyphus（Tartarus）/ Eurydice（Asphodel）/ Patroclus（Elysium），每局各最多出现一次，门上是 `!` 符号。

### 支柱 5：进度与叙事——死亡是叙事的一部分，且有明确的容错阀

- **God Mode（已核实）**：*"God Mode grants 20% damage resistance, increasing by 2% each time a run ends in death (rather than escape). The damage resistance caps at 80%."*
  这不是「简单模式」，而是**把「失败」显式转化为「变强」**的机制，且玩家可随时开关、无惩罚（Hades II 还允许把上限从 20% 调到 80%）。
- **剧本体量**：Hades 剧本 **30 万字**，*"at least two thirds of that script is fully voiced"*，社区常引用 **20,000+ 台词** 的录制量（Hades II 是 40 万字 / 3 万句）。
- **局外成长**：Mirror of Night（Darkness 购买）、Keepsake（起手携带物选择）、House Contractor。
  关键是**每一项都是「选择」而不是「堆数值」**——Keepsake 让你决定这局的起手风格。

### 支柱 6：UI/UX——信息只在需要时出现

- **敌人不常驻血条**。Hades 的敌人血条是**被打才出现**的（这是它能同时保持画面干净与战斗可读的关键）。
- **不显示浮动伤害数字**（Hades 的战斗画面里没有漫天飘的数字，伤害通过**血条分段、白闪次数、击退节奏、音效音高**传达）。
  `[待确认]`：无法从官方文档逐字确认「完全无伤害数字」，但主流游玩录屏与 UI 资料库截图中均未见战斗内浮动伤害数字。
- **祝福卡三要素齐全**：图标 / 名称 / 稀有度色 / **效果的具体数值**（例如 "Attack Damage: +50%"）。
  卡面上直接写清楚**这局它到底给你加了多少**，不做模糊描述。
- **反面教材**：Hades 的**祝福查看面板不暂停游戏**，社区为此抱怨过（Reddit *"Why does the game not pause when you press select…"*、Steam 讨论 *"When you hit Select to see the specifics of your boons, the game should pause…"*）。
  这说明「查看/选择类 UI 必须暂停」是被玩家明确要求的，Hades 是**没做好**的那一方。

### 支柱 7：操作手感——冲刺是核心资源，不是位移

- **冲刺全程无敌**：Hades Wiki 明确 *"While Dashing, Zagreus is immune to all damage."*
- **冲刺是短距传送**：可以穿过**敌人的攻击、墙体、柱子、敌人本体、坑洞**（攻略 *"dashing actually teleports you forward… you can pass through any obstacle in your path"*）。
  这让冲刺同时承担：闪避 / 走位 / 穿位移 三种职责，是 Hades 手感的**根**。
- **初始 1 冲刺，Mirror 可买 2 冲刺**（新手推荐买双冲刺，容错翻倍）。

### 支柱 8：反馈必须「可预期 + 可学习」

把支柱 1、2 合起来看，Hades 的底层原则是：**每一次负面事件，玩家都能在事前看到提示，并在事后学会规律。**
敌人白闪 → 你学会躲；地面生成环 → 你学会走位；护甲条 → 你学会先破甲再上控制。
反过来说，任何「玩家无法提前得知、也无法通过学习规避」的伤害，都是设计债。

---

## 二、逐项对照本项目现状

图例：✅ 已有且达标 ／ 🟡 有但做得不够 ／ ❌ 缺失

### 支柱 1 打击手感：🟡 体系是商业级的，但**特效产出方式**是作坊级的

**已有（且做得相当好，值得肯定）：**

| 项 | 位置 | 说明 |
|---|---|---|
| 反馈分层表 | `src/game/visual/feedback.ts:47-63` | 7 档 `light/normal/elite/kill/bossHit/playerHurt/meltdown`，hitStop 26–110ms、屏震、zoom punch 全部集中在此表。注释里写清了「普通命中必须比击杀安静得多」的层级原则——这正是 Hades 的做法 |
| 输入缓冲 | `feedback.ts:66-67` | `ATTACK_BUFFER_SEC=0.12 / DASH_BUFFER_SEC=0.14`，落在业界标准 80–150ms 区间 |
| 屏震治理 | `feedback.ts:76-107` `ShakeGovernor` | 「更强覆盖更弱、更弱只续期不打断」——这条比 Hades 的做法更显式，是好设计 |
| 命中定格 | `GameScene.ts:1236-1239` `applyHitStop` | 取 `max(设定值, 2个实际帧)`，防低帧率吞掉定格；且定格期间**攻击冷却与输入缓冲照常推进**（`865-938`），不会把攻速祝福的收益吃掉 |
| 集中入口 | `GameScene.ts:1242-1249` `applyFeedback` | 各调用点不再自行拼数值 |
| 音高抖动 | `feedback.ts:130-132` `pitchJitter` | 已用于受击/击杀/命中音 |
| 挤压拉伸 | `feedback.ts:113-124` | `playPlayerSquash` 在攻击/冲刺/受击都调用了 |
| 音效四重节流 | `src/game/utils/SfxLimiter.ts` | 工作区未提交改动把 `maxVoices` 从 5 抬到 12，注释写明「密集战斗下削音明显，玩家反馈音效糊掉」——判断正确 |
| 战斗文本对象池 | `GameScene.ts:454`、`613-630` | `obtainCombatText/recycleCombatText`，避免 Text 频繁建销 |
| 破层反馈 | `GameScene.ts:5328-5336` | 破层时 pip 消失 + 环冲击 + 浮字 + 音 + 屏震，四通道齐全 |

**缺失 / 不够：**

1. **❌ 每次命中都在新建对象 + 新建 tween**（本次改造方向，必须解决）
   - `meleeAttack`：每次挥斩新建 `container` + 5 个 `Graphics`（`3862-3877`），
     一条 trail 定时器**每 20ms 再新建一个 Graphics**、重复 10 次（`3904-3930`），
     再加 8 个火花 `circle` 各配一条 tween（`3933-3950`）→ **单次挥斩 ≈ 25 个对象 + 30+ 条 tween**。
   - `impactHitAt`（`3957-3995`）：每个命中点新建切割 Graphics + 冲击环 + 10 个火花。
     360° 特殊攻击打 8 个敌人 = 8 次调用 = **88 个对象**。
   - `registerHit`（`4520-4543`）：每个命中新建白闪 circle + 冲击环 + 6 火花。
   - `spawnElectronFlow`（`4566-4582`）：每颗电子一个 circle + tween（默认 6 颗）。
   - `damagePlayer`（`5428-5442`）：受击飞散 3–8 个电子，各配 tween。
   - 全仓库 `this.tweens.add` 142 处 / `this.add.circle` 123 处 / `this.add.graphics` 20 处。
   - **Hades 的对照**：它的常规命中反馈是「白闪 + 击退 + 音」，几乎不生成新对象；
     大场面特效只留给精英/Boss/击杀。本项目的特效**总量对、但分配方式错**——
     普通命中和击杀用的是同一套重特效，正好违反了 `feedback.ts` 自己写下的层级原则。

2. **❌ 同一敌人无受击硬直去重 → 数值/特效刷屏**
   `registerHit` 对同一敌人的每次命中都完整跑一遍「白闪+环+6火花+伤害数字」。
   激光束 `laserAttack` 每 60ms 一 tick（`4031-4208`，伤害时机 5–9 次）、
   弹体连射、DoT 每 0.5s 一跳（`4686-4689`）都会叠加。
   Hades 的做法是**同一敌人短时间内只保留一次可见命中反馈**，其余只结算数字。

3. **❌ 冲刺没有任何无敌帧**（详见支柱 7）

4. **🟡 伤害数字无限流**
   `showDamageNumber`（`4584-4593`）每次调用都出一条浮字，无「同一敌人 N ms 内合并」逻辑。
   Hades 干脆不显示伤害数字；本作伤害数字承载电子夺取量，应该保留，
   但需要按敌人做 **80–120ms 合并累加**，只在破层/击杀/暴击时弹大号。

### 支柱 2 敌人意图可读性：🟡 Boss/远程做得好，近战杂兵是「无预警伤害」

- ✅ 远程光束预警 0.55s：`GameScene.ts:5805-5833`（红色线束收缩）
- ✅ Boss 落点预警：`6042-6049`（slam）、`6203-6210`（AoE 圈）
- ✅ 刷怪预告 0.7s 红菱形：`1917-1931`、`1932-1947`（Boss）
- 🟡 坦克冲撞有 0.6s 前摇（`4741-4748`），但**只有音效和屏震，没有视觉预警标记**——玩家看不到「它要冲了」
- ❌ **近战怪 `chaser` 完全无预警**：`4771-4782`，`distance < 100` 时直接 `this.damagePlayer()`，
  红圈是**伤害结算之后**才播的（`4777-4780`）。这是典型的「玩家无法提前得知、也无法学习规避」的伤害。
- ❌ **玩家受伤后没有无敌窗口**：`damagePlayer()`（`5390-5477`）无任何 i-frame 记录。
  多个近战怪同时贴身 = 被连续秒杀，且每 hit 都跑一遍 `playerHurt` 档反馈（hitStop 92ms + 屏震 220ms），
  画面会完全糊掉。Hades 对此的处理是**受伤后短暂无敌 + 冲刺全程无敌**双保险。

### 支柱 3 Boon 构筑深度：🟡 槽位与替换做对了，**稀有度与组合**没做

**已有：**
- 24 个普通祝福 + 5 个觉醒祝福（`upgrades.ts:78-221`、`294-320`），四大化学学派主题清晰
- 替换/强化预览（`GameScene.ts:2034-2051`）：显示「⚠ 替换 X」/「⬆ 强化 → Lv.N」/「已满级」——信息完整度不输 Hades
- 卡片按当前武器切换文案（`upgrades.ts:40`、`132-135`、`197-200`、`206-209`；`GameScene.ts:2030`）
  —— **Hades 没有的贴心设计**，避免「写着加范围、实际加宽度」的错位感
- 觉醒祝福独立槽位、每局一次（`upgrades.ts:294-320`；`GameScene.ts:2141-2153`）
- 每局随机禁用 N 个祝福防背版（`upgrades.ts:252-259`；`GameScene.ts:2104`）
- 同祝福重复 → 强化至 Lv.3（`GameScene.ts:2123-2133`、`2232-2238`）

**缺失 / 不够：**

1. **❌ 稀有度不是掷出来的，是每个祝福写死的**
   `BoonDef.rarity` 是定义上的固定字段（`upgrades.ts:32`）。`formatBoonDesc`（`227-241`）与
   `showUpgradeSelection`（`2033`、`2061`）都直接读它。
   `rarityScale` 明明准备了 common/rare/epic/mythic 四档数值（`upgrades.ts:33`），
   但**只有该祝福固定那档会被读到**。
   后果：玩家永远不会遇到「这个过载打击这局是史诗」的惊喜，稀有度失去了它在 Hades 里的核心作用
   ——**同一个祝福在不同局里的强度方差**。这正是构筑重玩性的主要来源之一。

2. **❌ 无组合/前置条件（Duo）类祝福**
   Hades 的构筑规划感来自「为拿 Duo 而先凑两个核心」。本项目完全没有这层。
   而且本项目其实**有更好的载体**：化学主题天然支持「A 学派 + B 学派 → 反应」的组合逻辑，
   比 Hades 的「两神组合」更自洽。目前 24 个祝福全部是单学派单效果。

3. **🟡 `pickBoons` 的学派多样性是空转的**
   `upgrades.ts:273` 声明了 `usedSchools` 并 `add`，但**从来没有用它做过筛选**。
   注释写着「保证槽位/学派多样性」，实际只保证了槽位。三张卡可能同属一个学派。

4. **🟡 祝福池对槽位极不均衡**
   attack 槽 8 个、special 槽 8 个，而 dash 槽只有 4 个（`101`、`138`、`170`、`212`）、
   passive 槽 4 个（`106`、`142`、`174`、`217`）。
   `pickBoons` 第一轮优先选不同槽位（`276-285`），于是**中后期 dash/passive 的选择空间迅速枯竭**，
   选到第三四次时这两个槽基本只会重复。Hades 对此的解法是「被动槽不设上限」。

5. **🟡 每局禁用祝福对玩家不可见**
   `sampleDisabledBoons`（`upgrades.ts:252-259`）静默地把祝福移出卡池。
   Hades 的 Pact of Punishment 是把「我加了什么限制」明码标价给玩家看的。
   静默禁用会让玩家偶尔遇到「这局怎么总抽不到 X」的困惑，且无法形成决策。

### 支柱 4 关卡节奏：🟡 房间链结构完整，**门上无奖励预览**是最大缺口

**已有：**
- 三层结构 + 房间数递增：`rooms.ts:130` `ROOMS_PER_LAYER = [4,5,6]`，`getLayerName`（`362-364`）
- 10 种房间类型 + 主题色/图标：`rooms.ts:6`、`116-127`
- 门的生成规则（层末 Boss、倒数第二 Boss+宝藏、普通 3 门）：`rooms.ts:318-359`
- 撤离点 5 型 + 温度风险收益（通风橱/淬火/稳定化/高温双倍/隐藏）：`rooms.ts:409-445`
  —— **这是本作比 Hades 更有张力的设计**（Hades 的门是纯收益，本作的撤离门是风险定价）
- 自适应难度：快推 18°/房、慢推 4°/房（`GameScene.ts:1984-1993`；`balance.ts` `pacingMaxRise/pacingMinRise`）

**缺失 / 不够：**

1. **❌ 门上不显示奖励**
   `spawnDoors`（`GameScene.ts:2682-2711`）只画了 `ROOM_THEMES[type].icon` + 房间名。
   Hades 的核心信息设计就是 **「The reward for each chamber is visible on its entrance door」**——
   选择发生在进门前。本项目玩家走进门才知道给什么，「选门」退化成了「选房间类型」。
   本作其实有更丰富的门上信息可以放：**奖励类型（祝福学派 / 样本数 / 装备稀有度 / 撤离点种类与温度门槛）**。
   尤其是撤离房：`refreshExtractionDef`（`6601`）在进房时才定撤离点类型，
   而撤离点类型直接决定这局收益倍率（1× / 1.4× / 2× / 2.5×）——**这是最该前置到门上的信息**。

2. **🟡 普通房 3 扇门无权重、无去重**
   `rooms.ts:352-357`：从 9 种类型里**独立随机抽 3 次**，可能三扇门都是 `combat`。
   Hades 的门奖励是加权 + 去重的，保证「三扇门给你三种不同的理由」。

3. **🟡 清空房间的「奖励揭晓」时刻太轻**
   `onRoomCleared`（`1948-1978`）：一声 ding + 一条 banner + 400ms 后刷祝福光团。
   Hades 在这个节点有明显的**节奏转换**（战斗音乐退潮、奖励物件落地声、门开启）。
   本项目有 `BgmManager` 的状态派生选曲，但房间清空这个节点没有触发任何 BGM 层次变化。

4. **🟡 「危险可预判」原则在撤离阶段反而失效**
   `updateExtraction`（`6615-6711`）每 3s 预告生成追击者（`6637-6646`）——这条做得对。
   但**高温熔毁**（`1126-1140`）的倒计时只有一条浮字，没有 HUD 上的持续可见读秒。
   熔毁是「秒杀级」事件，玩家必须能随时瞄到剩余时间。

### 支柱 5 进度与叙事：🟡 Fail-forward 已做对，**无叙事层、无 God Mode 等价物**

**已有（这部分完成度很高）：**
- 死亡战报明确列出丢失项：`GameScene.ts:5548-5563`（划线呈现丢失装备 + 保留进度）
- 「送死比撤离更赚」的漏洞已修：`5525-5534` 注释写明了这条
- 隐藏关死亡保护：`5536-5543`
- 局外成长（Mirror of Night 等价物）：遗物解锁/升级 + 武器等级/形态 + 装备仓库（`ProfileState.ts:176-225`、`264-314`）
- 进化系统（染料喂养）：`GameState.ts:85-86`、`GameScene.ts:2806-2834`
- 新手引导非打断式：`TutorialController.ts`（不拦截输入、进度跨死亡保留、完成永久关闭）

**缺失 / 不够：**

1. **❌ 无 God Mode 等价物**
   本项目的自适应难度（`applyPacingHeat`）是**双向压力**（快推更危险），方向正确，
   但它不给卡关玩家任何**累积性兜底**。
   Hades 的 God Mode：20% 起、每次死亡 +2%、封顶 80%。
   注意它的精髓不是「变简单」，而是**把「死了 N 次」这件事显式结算成一个玩家可查看的数值**，
   让失败本身可见地在积累价值。本项目已有的「反应催化层数」（`GameState.ts:77-78`）
   就是同构机制（电子转移累积 → 全局伤害 + 里程碑），但它是**局内**的，死亡即清零。
   需要一个**跨局**的版本。

2. **❌ 无叙事层**
   除房间 banner（`1995-2005`）与战报外，没有任何文本承载「这个实验室发生了什么」。
   小项目不需要 30 万字剧本，但需要**每局 3–5 句会变化的短文本**。
   本项目已有现成载体：`showRunReport`（`472-517`）的参数化文案、
   事件房仪器（`rooms.ts:54-60`，本生灯/冰浴/蒸馏器/电解池/核反应堆都有名字和代价）——
   给它们各配一句「实验记录」风格的 flavor text，成本极低。

### 支柱 6 UI/UX：✅ HUD 已达标，🟡 伤害数字与预警需要治理

**已有：**
- HUD 脏检查 `setTextSafe`：`UIScene.ts:30-32`（避免每帧重光栅化）
- 电子核心小组件 + Boss 血条 + 相位点：`UIScene.ts:82`、`90-92`
- 危险 vignette：`UIScene.ts:94-95`、`refreshDangerVignette`（`550`）
- 状态面板 TAB 快照（打开即暂停）：`GameScene.ts:534-611`
- 开发者叠层（FPS/对象池尺寸/种子）：`UIScene.ts:565-606`

**对照 Hades 的差异：**

1. **🟡 Hades 不显示伤害数字，本项目显示——但本项目是对的，别改**
   本项目的伤害数字承载的是**电子夺取量**（`showElectronDelta`，`4599-4622`），
   而电子是本作的核心资源与生命值，这条信息必须可见。
   需要做的不是删掉，而是**限流 + 分级**：小额合并、大额（≥4）放大——
   `4602` 已经做了量级分级，缺的是**按敌人的合并窗口**。

2. **🟡 敌人不常驻血条这点本项目已经对齐**
   本作用「电子层 + 层顶圆点」替代血条（`RuntimeEnemy.orbit`、`layerPips`），
   且破层有明确反馈（`5328-5336`）。比 Hades 的做法更贴合主题，**保持**。

3. **❌ 伤害/预警的视觉语言在描边几何风下会糊
   `registerHit` 的白闪用 ADD 混合的半透明白圆（`4520-4523`）。
   代码自己的注释已经发现了这个问题：`4666` 「ADD 混合下 `setTint` 几乎不可见」。
   对「深色底 + 明亮描边」的美术风格，ADD 白圆会把描边直接洗掉，
   命中瞬间目标反而**更难看清**。应该改成「描边提亮 + 短促形变」，而不是叠加白光。

### 支柱 7 操作手感：❌ 冲刺无无敌帧，是当前手感的最大短板

- 已有：二段冲刺（`doDash`，`5576-5655`）、冲刺窗口 0.45s、位移 0.16s（`balance.ts` `dash`）
- 已有：冲刺拉伸形变（`5585`）、冲刺祝福 4 个
- **❌ 冲刺期间可被任何来源伤害**：`damagePlayer()` 无任何无敌判定，`dashMotionTimer` 只用于速度恢复（`980-985`）。
  Hades 的冲刺是**全程无敌 + 短距传送**，这是它手感的根。
  本项目的冲刺目前只是「一段位移」，玩家没有「我冲进去打一套再出来」的资本。
- **❌ 玩家受伤后无无敌窗口**：与支柱 2 第 3 点同源。
- **🟡 冲刺没有穿越判定**：Hades 的冲刺可穿过弹幕与敌人本体。
  本项目弹幕碰撞在 `updateEnemyProjectiles`（`5670-5707`），冲刺期间照常结算。

### 支柱 8 反馈可预期可学习：🟡 系统层面有，但有两处违反

- ✅ 生成预告（`1917-1931`）、远程预警（`5805-5833`）、Boss 预警（`6042`、`6203`）
- ❌ 近战怪无预警（见支柱 2）——违反「可学习」
- ❌ 熔毁倒计时不可见读秒（见支柱 4 第 4 点）——违反「可预期」
- 🟡 过载有 2.5s 宽限期（`885-898`、`balance.ts` `overload.graceSec`）——这条做对了，
  触发瞬间有明确警告文本 + 音效，是「可学习」的正面样本，可以作为其他预警的模板

---

## 三、分级 TODO 清单

工作量口径：**小** ≤ 0.5 天 ／ **中** 1–3 天 ／ **大** ≥ 4 天。
所有特效类条目都必须以「复用粒子发射器 / 环形缓冲」实现，不得回到「每命中新建对象 + tween」。

### P0 — 影响核心手感，必须做

| # | 做什么 | 为什么（对应 Hades 哪条机制） | 改哪个文件 | 工作量 |
|---|---|---|---|---|
| 🟡 **P0-1** | **把 `GameScene` 的每命中路径接到已有的 `FxPool`**（`src/game/utils/Fx.ts`）。`FxPool` 已提供 `burst/sparkCone/ring/particle` 高层接口 + 硬上限 FIFO 逐出 + 零分配 opts，**缺的只是接线**（`scenes/` 下尚无 import）。按优先级：① `registerHit`(4507) 的 6 火花 → `burst`；② `impactHitAt`(3957) 的 10 火花 + 冲击环 → `sparkCone` + `ring`，切割 Graphics 改为预建池；③ `spawnElectronFlow`(4566) 的电子流 → `particle` 沿贝塞尔飞行；④ `damagePlayer`(5428) 受击飞散 → `burst`；⑤ `meleeAttack`(3904) 的 20ms 一条 trail → 单条预建弧线 Graphics 复用。**同时按 `FEEDBACK` tier 分配特效预算**：`normal` 只出 1 个火花簇 + 1 个环，`kill/elite/bossHit` 才出全套 | Hades 的常规命中反馈是「白闪 + 击退 + 音」，重特效只留给精英/Boss/击杀。本项目 `feedback.ts` 自己写下了这条层级原则，但特效产出没跟上：单次挥斩 ≈ 25 对象 + 30+ tween，8 敌命中的 360° 特殊 ≈ 88 对象。**池子已在，接线即可** | `GameScene.ts` `meleeAttack`(3785) / `impactHitAt`(3957) / `registerHit`(4507) / `spawnElectronFlow`(4566) / `damagePlayer`(5390) / `killEnemy`(5342)；`create()` 建 `FxPool` 实例并在 `update()` 末尾 `fx.update(delta)` | **中** |
| ✅ **P0-2** | **给冲刺加无敌帧**：`dashMotionTimer > 0` 期间免疫全部伤害（含 DoT、陷阱、环境）；同时给 `damagePlayer()` 加「受伤后 0.6–0.8s 无敌窗口」，窗口内不重复跑 `playerHurt` 反馈 | Hades：*"While Dashing, Zagreus is immune to all damage."* 冲刺是 Hades 手感的根——没有它玩家不敢贴脸输出。本项目近战怪（360° 挥斩是主输出）目前毫无切入资本 | `GameScene.ts` `doDash`(5576) / `damagePlayer`(5390)；新增字段 `playerInvulnTimer`；`balance.ts` 加 `dash.iframeSeconds`、`player.hurtIFrameSeconds` | **小** |
| ✅ **P0-3** | **近战怪 `chaser` 加 0.4–0.5s 攻击前摇**：蓄力期敌人描边提亮 + 脚下红色收缩圈（复用 `enemyBeamAttack` 的预警范式），前摇结束才判定伤害；伤害数字/红圈不再事后补播 | Hades 的敌人出手前会**摆 pose + 白色 overlay**，玩家读得懂就能躲。本项目 `chaser` 是 `distance < 100` 直接 `damagePlayer()`（4771-4782），玩家无法提前得知也无法学习规避——违反「反馈可预期可学习」 | `GameScene.ts` `updateEnemies`(4661) 的 chaser 分支；预警圈走 P0-1 的复用池 | **小** |
| 🟡 **P0-4** | **伤害数字按敌人合并**：每个 `RuntimeEnemy` 记 `lastDamageTextAt` 与 `pendingDamageSum`，80–120ms 窗口内累加只出一条；破层 / 击杀 / 暴击 / 大额（≥阈值）立即出独立大号浮字并清空累加 | Hades 干脆不显示伤害数字，靠血条分段 + 白闪次数传达。本项目的电子夺取量必须可见（这是核心资源），但当前激光每 60ms 一 tick、DoT 每 0.5s 一跳都会各出一条，密集战斗下数字会盖住战场 | `GameScene.ts` `RuntimeEnemy` 接口(63-95)、`registerHit`(4507)、`showDamageNumber`(4584)、`updateEnemies` DoT 分支(4686)、`spinSlash`(4262) | **小** |
| **P0-5** | **门上显示奖励**：`RoomDef` 增加 `preview` 字段（奖励类型 + 数值/学派/稀有度/撤离点类型与温度门槛），`spawnDoors` 在门图标上方渲染第二行奖励徽标；撤离房必须显示**撤离点种类与可用条件** | Hades：*"The reward for each chamber is visible on its entrance door."* 选择发生在进门前。本项目当前 `spawnDoors`(2682-2711) 只画房间类型图标，「选门」退化成「选房间类型」。撤离点倍率 1×/1.4×/2×/2.5× 是最该前置的信息 | `src/game/data/rooms.ts` `createRoom`(244) / `generateRoomDoors`(318)；`GameScene.ts` `spawnDoors`(2682) / `refreshExtractionDef`(6601) | **中** |
| ✅ **P0-6** | **把 `upgradeSelectionActive` 期间的战斗暂停接上**：祝福选择 overlay 打开时冻结 `update` 的战斗分支（保留相机与 UI 动画） | Hades 在这点上**是反面教材**（查看祝福不暂停，社区明确抱怨过）。本项目选择发生在房间清空后，风险低，但 Boss 房觉醒祝福与撤离前的空档会让玩家暴露在 `updateExtraction`(6615) 每 3s 生成的追击者火力下 | `GameScene.ts` `update`(865) 加 early-return；`selectUpgrade`(2114) / `closeBoonOverlay`(2080) 负责恢复 | **小** |

### P1 — 明显提升品质

| # | 做什么 | 为什么 | 改哪个文件 | 工作量 |
|---|---|---|---|---|
| **P1-1** | **稀有度改为掷骰**：`BoonDef.rarity` 改为「基础稀有度/权重上限」，抽取时按权重表（common 55 / rare 28 / epic 13 / mythic 4）掷出实际稀有度，存进 `EquippedBoon`；`rarityScale` 四档数值终于全部生效 | Hades 的稀有度是掷出来的（*"roll for rarity"*），同一祝福在不同局有强度方差——这是构筑重玩性的主要来源。本项目 `rarityScale` 准备了四档但只有写死那档会被读到（`formatBoonDesc:227-241`） | `upgrades.ts`(25-33, 227-241)；`GameState.ts` `EquippedBoon`(16-24)；`GameScene.ts` `showUpgradeSelection`(2008) / `boonRarityValue`(2232) | **中** |
| **P1-2** | **化学组合祝福（Duo 等价物）**：新增 6–8 个「A 学派 + B 学派 → 反应」的组合祝福，`requires: string[]` 前置（如 `['h-atk-overload','o-atk-ignite']` → 「燃烧链式反应」）；两个前置都持有才进卡池 | Hades 的 Duo boons 要求两个神各出一个核心，玩家会**为拿 Duo 而有意识地先凑组合**——这是「规划感」的唯一来源。化学主题天然支持这个逻辑，比 Hades 更自洽 | `upgrades.ts` 新增 `DUO_POOL` + `requires`；`GameScene.ts` `rollBoonChoices`(2102) 加前置判定 | **中** |
| 🟡 **P1-3** | **普通房 3 扇门去重 + 加权**：确保三扇门类型互不相同；给 `combat` 降权、`shop/treasure/event` 提权，并对 `extraction` 做条件门控 | Hades 的三扇门给你三种不同的理由，当前实现（`rooms.ts:352-357`）独立随机抽 3 次，可能三扇都是战斗房 | `rooms.ts` `generateRoomDoors`(318)；单测 `tests/rooms.test.ts` 补断言 | **小** |
| **P1-4** | **跨局容错（God Mode 等价物）**：新增「稳定度」档案值，每次死亡 +1，提供可开关的减伤（如 每点 -1.5%，封顶 30%），设置里明码显示当前值与效果；做成**显式可关** | Hades God Mode：20% 起、每次死亡 +2%、封顶 80%，可随时开关无惩罚。精髓是**把「死了 N 次」显式结算成玩家可见的数值**。本项目的反应催化（`GameState.ts:77-78`）是同构机制但是局内的，死亡清零 | `ProfileState.ts`(24-65)；`SettingsState.ts`；`GameScene.ts` `damagePlayer`(5390) / `playerDeath`(5483) | **小** |
| ✅ **P1-5** | **受伤后的屏幕边缘红闪**：复用 `UIScene.refreshDangerVignette` 的常驻 `dangerVignette`，加一次性 `hurtFlashTimer` 项并取 max 叠加，衰减 0.7s | Hades 受伤时有明确的屏幕边缘红闪。本项目 `dangerVignette` 已是常驻对象，只需加一次脉冲请求——**零新增对象** | `UIScene.ts` `refreshDangerVignette` / `GameScene.ts` `damagePlayer` | **小** |
| **P1-6** | **命中白闪改为「描边提亮 + 短促形变」**：弃用 ADD 白圆（`4520-4523`），改为敌人描边色 `lerp` 到白 + `scale` 短促脉冲（已有 `baseScale * 1.14 → baseScale` 的 tween 可直接复用） | 代码自己在 `4666` 已发现「ADD 混合下 setTint 几乎不可见」。对「深色底 + 明亮描边」风格，ADD 白圆会把描边洗掉，命中瞬间目标反而更难看清 | `GameScene.ts` `registerHit`(4507) / `damageEnemy`(5321) | **小** |
| **P1-7** | **房间清空的节奏断点**：清空瞬间触发 BGM 层次切换（BgmManager 已有状态派生选曲）+ 祝福光团落地时的低频冲击音 + 门开启的机械音 | Hades 在清空节点有明显的节奏转换（战斗音乐退潮 + 奖励落地声）。本项目 `onRoomCleared`(1948-1978) 只有一声 ding + banner，400ms 后光团静默出现 | `GameScene.ts` `onRoomCleared`(1948) / `spawnBoonPickup`(2946)；`BgmManager.ts` | **小** |
| ✅ **P1-8** | **熔毁倒计时 HUD 读秒**：把剩余秒数写进既有的温度态标签（`熔毁 12.3s`），最后 3s 转白并把脉冲频率翻倍 | 「可预期」硬要求。当前只有一条浮字，玩家必须盯着才知道什么时候炸 | `UIScene.ts` `refresh`；`GameScene` 暴露 `meltdownSecondsLeft` | **小** |
| ✅ **P1-9** | **坦克冲撞加视觉前摇**：`chargeActive` 之前插入一段蓄力期，立一条以敌人为原点、朝玩家实时对准的红色指向线，由宽收窄并脉冲提亮 | 当前只有音效 + 屏震（`chargeActive` 分支），玩家看不到它要冲向哪 | `GameScene.ts` `updateEnemies` tank 分支 | **小** |
| **P1-10** | **每局禁用祝福对玩家可见**：局开始时在 HUD 或状态面板显示「本局禁用：N 个」，点击可查看清单；或改为局前抽签展示 | Hades 的 Pact of Punishment 把限制明码标价。静默禁用（`upgrades.ts:252-259`）会让玩家困惑且无法决策 | `GameScene.ts` `create`(651) 禁用抽样处；`UIScene.ts` 状态面板 | **小** |
| ✅ **P1-11** | **`pickBoons` 学派多样性真正生效**：`usedSchools` 当前只 `add` 不筛选（`upgrades.ts:273`），补上「优先不同学派」的过滤 | 注释声称保证学派多样性，实际没做。三张卡同学派会让「四大化学学派」的主题感崩塌 | `upgrades.ts` `pickBoons`(265)；单测 `tests/upgrades.test.ts` 补断言 | **小** |

### P2 — 锦上添花

| # | 做什么 | 为什么 | 改哪个文件 | 工作量 |
|---|---|---|---|---|
| **P2-1** | dash/passive 槽补祝福：每槽从 4 个扩到 6–7 个 | `pickBoons` 第一轮优先选不同槽位，中后期这两槽选择空间迅速枯竭，第三四次基本只重复 | `upgrades.ts` | 中 |
| **P2-2** | 事件房 flavor text：5 台仪器（本生灯/冰浴/蒸馏器/电解池/核反应堆）各配 1–2 句「实验记录」风格文本，进房与使用后各播一句 | 低成本叙事层。Hades 用 30 万字剧本，小项目需要的是「每局 3–5 句会变化的短文本」，而本项目已有 `showRunReport`(472) 的参数化文案与仪器命名体系 | `rooms.ts`(54-60)；`GameScene.ts` `useInstrument`(2882) | 小 |
| **P2-3** | Boss 血条相位切换的节奏停顿：转阶段时 0.3s 定格 + 血条重绘动画 | Hades 的 Boss 转阶段有明确断点，给玩家「刚才那阶段结束了」的确认 | `GameScene.ts` `updateBoss`(6013)；`UIScene.ts` `refreshBossBar`(518) | 小 |
| **P2-4** | 连杀/连续命中 HUD 微反馈：连续命中 N 次不受伤，HUD 角落累计计数，受伤归零 | 让「打得干净」这件事可见。纯 HUD 文本，走 `setTextSafe` | `UIScene.ts` | 小 |
| **P2-5** | 冲刺穿越弹幕：`dashMotionTimer > 0` 时不与敌方弹幕结算（P0-2 的自然延伸，可一并做） | Hades 冲刺可穿过弹幕与敌人本体 | `GameScene.ts` `updateEnemyProjectiles`(5670) | 小 |
| **P2-6** | 每层换场过渡：进新层时一次 600ms 的全屏色带扫过 + 层名大字 | Hades 用楼梯过渡房间。本项目是 fadeOut/fadeIn，缺「进入新区域」的仪式感 | `GameScene.ts` `enterRoom`(1759) | 小 |
| ✅ **P2-7** | **质量分档职责划分**：明确 `utils/Quality.ts` 的 `QualityTier` + `LoadMonitor` 为运行时权威（自适应负载降档），`visual/quality.ts` 的 `getVisualProfile()` 只管 Bloom/辉光等静态档位；`LoadMonitor.sample()` 接进 `update()`，`FxPool.setLoadLevel()` 随之联动 | 两套并存会出现「用户设高质量、负载监控又降到低」的冲突。`MAX_PARTICLES`（low 360 / medium 800 / high 1400）× `LOAD_PARTICLES`（1 / 0.75 / 0.55 / 0.4）的两级缩放模型已经写好，只差接线与职责划分 | `utils/Quality.ts`；`visual/quality.ts:19-24`；`GameScene.ts` `update()` | 小 |
| ✅ **P2-8** | 祝福选择时支持键盘/触屏数字键 1-2-3 快选 | 当前只能点击卡片。PC 端高频操作 | `GameScene.ts` `showUpgradeSelection`(2008) | 小 |

### 附：完成记录（2026-10-11，对应提交 `69ac83e` … `51d33a9` 及其后）

状态标记：✅ 完成 ／ 🟡 部分完成 ／ 未标记 = 未动。

| 项 | 结果 | 提交 |
|---|---|---|
| **P2-7** 质量分档职责划分 | ✅ `visual/quality.ts` 的 `VisualProfile` 新增 `maxParticles`（360/800/1400），粒子上限 = `maxParticles × LOAD_PARTICLES[负载档]`；`utils/Quality.ts` 只剩 `LoadMonitor` + `LOAD_PARTICLES` | `69ac83e` |
| **P0-1** FxPool 接线 | 🟡 已接 `impactHitAt`（切割亮线/冲击环/溅射火花）、`registerHit`（冲击环 + 6 火花）、`spawnModeBurst`。**未接** ③ `spawnElectronFlow` ④ `damagePlayer` 受击飞散 ⑤ `meleeAttack` 的 20ms trail；「按 `FEEDBACK` tier 分配特效预算」也未做 | `69ac83e` / `b594d0a` |
| **P0-4** 伤害数字合并 | 🟡 新增 `pendingDamageText/damageTextColor/damageTextFlushAt` + `addDamageNumber/flushDamageNumber`，110ms 定点窗口。已接 `registerHit` 与 DoT（文档点名的两个 spam 源）；**未接** `spinSlash`（低频，刻意保持即时） | `b594d0a` |
| **P1-11** 学派多样性 | ✅ 三级候选收敛（槽位+学派 → 槽位 → 学派 → 兜底），每级都是上一级超集故槽位优先语义不削弱。单测断言撞车率 <5%（旧实现约 60%） | `468d483` |
| **P1-3** 门去重 | 🟡 已做**加权去重抽样**（同类型最多一扇，三扇门必然互不相同）。**未做** combat 降权 / shop·treasure·event 提权 / extraction 条件门控 —— 属平衡判断，无实机验证不擅动 | `468d483` |
| **P0-2** 无敌帧 | ✅ `dashMotionTimer > 0` 全免疫 + `BALANCE.player.hurtIFrameSeconds`(0.7s) 受伤窗口，窗口内不重复结算也不重复播 `playerHurt` | `0abf682` |
| **P0-3** 近战怪前摇 | ✅ 新增 `windupTimer/windupRange/windupMark` 三字段 + `startMeleeWindup/cancelMeleeWindup/resolveMeleeWindup`。两条伤害路径都改为「先亮红圈、到点重新测距才结算」：追击者范围爆 0.35s（半径 100）、贴身接触伤害 0.3s（半径 76，仍保留贴脸压迫感）。前摇期**照常追击**（否则拉开距离就永远不会被打中）但不开新攻击；被僵直 / 被击杀会打断前摇。时长进 `BALANCE.combat` 便于调参 | `c27aff6` |
| **P1-9** 坦克冲撞前摇 | ✅ 新增 `chargeWindup/chargeMark` + `startChargeWindup/updateChargeWindup/endChargeWindup`。与清单原设想**不同**：原写的是「`chargeActive` 期画冲锋路径线」，即在已经冲出去之后画线 —— 那只能说明它正往哪冲，说明不了它**要**冲。改成冲锋**之前**蓄力 0.5s 并立指向线，期间钉在原地不再追击。期间玩家冲进 120px / 跑出 500px 会作废前摇（与发动条件一致）并留 0.6s 重试间隔；被僵直 / 被击杀同样打断。原有时序未动：`chargeTimer = 0.6` 仍在同帧被扣一次（有效冲刺约 0.3s），改前改后一致 | `24ac5d9` |
| **P1-5** 受伤屏幕红闪 | ✅ `UIScene` 加 `hurtFlashTimer` / `hurtFlashSeconds(0.7)` / `hurtFlashPeak(0.65)`，在 `refreshDangerVignette` 里算出 hurt 项后与低血、高温项**取 max**（同一条「屏幕边缘泛红」的视觉语言，故不另建贴图、不另加对象）。衰减挂在 `UIScene.update`，帧增量同样按 50ms 封顶，切后台再回来不会一次性闪完。`GameScene.flashDamageScreen()` 走 `TutorialController` 那套结构化可选访问（`flashDamage?.()`），UIScene 被先停掉时静默跳过。**与清单原设想的两处偏差**：① 不经 EventBus 加 `damage` 强度参数而是直接调 ScenePlugin —— `emit('damage')` 已存在、语义是事件广播，给它塞一个只给 HUD 用的展示参数是错位；② 用既有的 `0xff2040` 而非清单写的 `#FF2D55` —— vignette 贴图按颜色生成，换色等于多一张全屏贴图，而这点色差在边缘辉光下读不出来 | `51d33a9` |
| **P1-8** 熔毁倒计时读秒 | ✅ `GameScene` 暴露只读 getter `meltdownSecondsLeft`（温度 <95 时底层计时器本就被重置为满值 15，UI 据此能区分「在倒计时」和「暂时安全」），加进 `UIScene` 的 `GameSceneRef` 最小接口而非直接 import GameScene。显示上**不新建 Text**：直接把秒数写进既有的温度态标签（`熔毁 12.3s`），最后 3s 转白 `#FFFFFF`、脉冲频率由 0.012 加倍到 0.024。选这个做法是因为移动端温度计下方的空间是按「一行状态文字」预留的，多加一行会压到按钮组；而把读数并进玩家本来就会看的那一行，既零布局风险又零新增对象 | 本次提交 |
| **P0-6** 选卡冻结 | ✅ `update()` 在 `upgradeSelectionActive` 时 early-return（连带停掉过载自损 / DoT / 温度），粒子与引导仍在其上推进 | `0abf682` |
| **P2-8** 数字键快选 | ✅ 1/2/3 直选 + Esc 跳过；监听挂 window，故**所有**把 `upgradeSelectionActive` 置回 false 的路径都成对摘除 | `9f10fe4` |

**额外修的一个粒子 bug（与本清单无关，实测发现）**：`FxOpts.rot` 的语义是「局部 +Y 旋转量」，屏幕方向 = `90° + rot`。`sparkCone` 原先写 `po.rot = a`，拖尾**垂直于**速度；`impactHitAt` 写 `core.rot = perp`，切割线**顺着**刀刃。两者都差 90°。已分别改为 `a - π/2` 与 `angle`，并用 0°/45°/90°/-45° 四根标尺截图实测确认。

**未做的 P0/P1 及原因**：
- **P0-3 → 已改为上面那条 ✅**。原以为「与无敌帧叠加会显著改变难度、需实机调参」而不做，
  但把时长抽成 `BALANCE.combat.meleeWindupSeconds` / `contactWindupSeconds` 之后，
  「不擅动」的顾虑就只剩一个可调参数 —— 压迫感不够就调短，太难就调长，不该因为怕改数值
  而留着一个玩家躲不掉、也学不会的伤害。**仍需实机手感确认**。
- **P0-5 门上奖励**：牵动 `RoomDef` 数据结构与撤离点预览，工作量「中」，属下一轮
- **P1-1 稀有度掷骰**：直接改变构筑强度分布，需配合 P1-2 一起设计
- **P1-10**：纯视觉类，风险低

**验证方式的说明**：P0-3 与 P1-9 都用「直接驱动 `updateEnemies(delta)` 步进 + 读敌人状态」来断言，
而非只看画面。`updateEnemies` 的 `delta` 单位是**秒**不是毫秒（踩过一次坑）。P0-3 的预警圈有截图佐证；
P1-9 完成时桌面浏览器窗口已不可见、拿不到截图，只做了状态追踪（指向线生成 → 跟随玩家 → 发动时销毁 →
击杀/僵直/清场三条清理路径都置 `chargeMark = null`）。指向线本身是一个 Rectangle + 两个 tween，构造与
已在画面上验证过的 `enemyBeamAttack` 预警一致，但**外观未实机确认**。

P1-5 的验证反过来暴露了一个环境事实：**浏览器窗口被遮挡时 rAF 被节流到约 1fps**（不是暂停，
`document.visibilityState` 仍是 `visible`），于是 BootScene 看起来卡死、UIScene 长时间停在
LOADING(5)、`browser.screenshot` 也报「需要可见标签页」——三件事同源，都不是代码 bug。
排查时还有一个坑：把 `dangerVignette` 换成替身对象做断言后，它会一直留在实例上，
后续 `create()` 不再重跑，于是「读到的 alpha」其实是替身的，必须重启 UIScene 才能拿回真对象。

绕法是绕过游戏循环直接驱动被测方法。最终在**真实的 vignette Image** 上测到：
满血低温基线 0 → `flashDamage()` 后 0.604 →（每 100ms 步长被 50ms 封顶，故 timer 只从 0.7
走到 0.65）→ 0.557 / 0.511 / 0.464 … 线性衰减 → 归零回基线；`damagePlayer → flashDamageScreen`
的接线单独断言为 `hurtFlashTimer === 0.7`（玩家未死时）。另注：`damagePlayer` 在 `result.died`
时会早退，所以死亡那一击不闪红 —— 这是想要的行为。

要做真正的实机验证，需要先让桌面浏览器窗口可见。

P1-8 沿用同一套绕法：用动态 `import('/src/game/state/GameState.ts')` 拿到与游戏同一个
`gameState` 单例（直接 `window` 上没有暴露），设温度后同步调 `refresh()` 读真实 Text 的
文字与颜色 —— 50°/90° 无读秒，96° 显示 `熔毁 12.3s`（`#FF4D6D`），2.6s / 0.4s 时转白
`#FFFFFF`。另注：**页面里没有 `gameState` / `Phaser` 这些全局**，它们都是模块导入，
在 evaluate 里直接用会 `ReferenceError`，要走 `window.__game` 或动态 import。

---

## 四、值得抄 vs 不该抄

### ✅ 低成本高回报（优先做）

| 项 | 成本 | 回报 | 说明 |
|---|---|---|---|
| **冲刺无敌帧 + 受伤无敌窗口**（P0-2） | 极低 | **极高** | 两个布尔/计时器判定。这是当前手感最大的短板，近战主输出的玩法目前没有切入资本 |
| **近战怪攻击前摇**（P0-3） | 低 | **极高** | 复用已有的 `enemyBeamAttack` 预警范式。把「不公平的伤害」变成「可学习的挑战」 |
| **伤害数字按敌人合并**（P0-4） | 极低 | 高 | 纯逻辑，零新增对象。清理战场可读性 |
| **门上奖励预览**（P0-5） | 中 | **极高** | 这是 Hades 房间链设计的**信息核心**。本项目的撤离点风险定价（1×→2.5×）本来就是加分项，前置到门上才真正发挥作用 |
| **稀有度掷骰**（P1-1） | 中 | **极高** | 四档数值早已写好（`rarityScale`），只是从没被掷过。等于白送的构筑重玩性 |
| **化学组合祝福**（P1-2） | 中 | **极高** | 化学主题天然支持「A+B→反应」，比 Hades 的两神组合更自洽。这是本项目**能超越 Hades 的地方**，不是模仿 |
| **跨局容错（God Mode 等价物）**（P1-4） | 低 | 高 | 已有 `reactionLayers` 同构机制可参考，只是要跨局持久化 + 显式可关 |
| **屏幕边缘红闪**（P1-5） | 极低 | 中 | 常驻对象加一次脉冲，零新增对象 |
| **熔毁倒计时 HUD 读秒**（P1-8） | 极低 | 高 | 「可预期」硬要求，秒杀级事件必须能看到剩余时间 |
| **击退撞墙加成伤害（wall slam）** | 中 | 高 | 已有 `pushX/pushY` 击退系统（`4518-4519`）与可碰撞棱柱（`biomes.ts:159`），只需在击退撞到 `terrainObstacles` 时补一次伤害结算。这是 Hades 最有打击感的反馈之一，且与本项目的 iso 棱柱地形天然契合 |

### ❌ 不该抄（商业体量成本，小项目做不划算）

| 项 | 为什么不做 |
|---|---|
| **全手绘 2D 骨骼动画 + 逐帧特效** | Supergiant 有专职动画团队与自研管线。本项目的「深色底 + 明亮描边几何」已经是**差异化优势**，不是妥协。用 squash/stretch（`feedback.ts:113-124`）+ 程序化描边形变就能达到同等打击感，且**性能成本低一个数量级** |
| **30 万字剧本 / 2 万句配音** | 不可能也不必要。替代方案见 P2-2：**每局 3–5 句会变化的参数化短文本**。本项目已有的 `showRunReport` 参数化文案体系就是正确的载体 |
| **8–9 个神 × 每神 20+ 祝福 = 200+ 祝福池** | 内容量与平衡成本不成正比。本项目 24 + 5 已经够用，**补组合祝福（P1-2）比补单体祝福数量的性价比高一个数量级**——组合带来的构筑方差远大于线性堆量 |
| **完整语音 + 定制管弦乐** | 已有的 `BgmManager` 状态派生选曲 + `SfxLimiter` 四重节流已经是合理投入。往上堆收益急剧递减 |
| **73 房间的长单局（23–30 分钟）** | Hades 是爬塔，本项目是**搜打撤**，单局本来就该更短。当前 `[4,5,6]+3Boss` 的结构是合理的，**不要照搬房间数**。该抄的是「门上可见奖励」这个信息设计，不是节奏长度 |
| **32 热度 / Hell Mode 那种深度自定义难度** | 面向的是已经通关几十次的核心玩家。本项目当前阶段更该做 P1-4 的向下容错（God Mode 等价物），而不是向上难度 |
| **每个神独立的「神恩/诅咒」事件房（Trial of the Gods 双神门）** | 本项目已有事件房（仪器取舍）、染料房、水池房、宝藏房、商店房——房型多样性已经不输。加双神门会稀释已有的化学仪器取舍设计 |
| **Keepsake / 起手携带物系统** | 本项目已有遗物（`relics.ts`）+ 装备携带槽（`loadout`）——**这两者的组合已经覆盖了 Keepsake 的功能**，且因为有「死亡丢失」的搜打撤张力，比 Hades 的纯增益 Keepsake 更有决策感。不要重复造 |

---

## 五、与在进行的改动的一致性说明

| 在进行的改动 | 本清单的处理 |
|---|---|
| **逐命中的「新建对象 + tween」特效 → 可复用粒子发射器** | **池子已落地**：`utils/Fx.ts` 的 `FxPool`（空闲链表、硬上限 FIFO 逐出、零运行时分配，`burst/sparkCone/ring/particle` 高层接口）+ `utils/Quality.ts` 的 `LoadMonitor`（自适应负载分级，`MAX_PARTICLES` low 360 / medium 800 / high 1400 × `LOAD_PARTICLES` 四档缩放）。**当前唯一缺口是接线**：`GameScene` 尚未 import 这两个文件。P0-1 因此从「建池（大）」降级为「接线（中）」，且不提出任何相反方案。P0-1 额外要求的是**按 `FEEDBACK` tier 分配特效预算**——这是池化之外容易漏掉的另一半：不仅要「复用对象」，还要「普通命中不该出重特效」 |
| **渲染性能优化（400+ 地面贴图对象）** | 本清单**不新增任何静态地面对象**。P0-5 的门上奖励徽标复用已有的 `roomDoors` 对象数组（`323`）并在 `tearDownRoomEntities`(3266) 统一销毁；P1-5/P1-8 明确要求复用已有的常驻对象（`dangerVignette`、HUD Text），零新增。所有涉及视觉强度的项已列为 P2-7，走 `getVisualProfile()` 分档 |

**优先级建议**：P0-2 / P0-3 / P0-4 是三个「小工作量、极大手感回报」的项，建议在 P0-1 的大规模特效改造**之前**先做——
它们不依赖特效层，可以立刻改善体验，且能为 P0-1 提供一个干净的验收基线（先让逻辑对，再让表现复用）。

---

## 附：Hades 数值的检索状态

| 数值/机制 | 状态 |
|---|---|
| God Mode 20% 起 / 每次死亡 +2% / 封顶 80% | ✅ 已确认（Hades Wiki + Polygon） |
| 冲刺全程无敌 | ✅ 已确认（Hades Wiki *"While Dashing, Zagreus is immune to all damage"*） |
| 稀有度 Common/Rare/Epic/**Heroic**，掷骰决定 | ✅ 已确认（注意不是 Mythic） |
| Duo/Legendary 需前置条件 | ✅ 已确认 |
| 每层 Boss 房位置（Tartarus 14 / Asphodel 24 / Elysium 36），总 73 房 | ✅ 已确认（Hades Wiki） |
| 门上显示奖励 | ✅ 已确认（Hades Wiki *"The reward for each chamber is visible on its entrance door"*） |
| 单局 23–30 分钟 | ✅ 社区统计口径，非官方数值 |
| 30 万字剧本 / 2/3 全语音 / 2 万+ 台词 | ✅ 已确认（Greg Kasavin 采访） |
| 攻击前摇 = 敌人定格 pose + 白色 overlay | ✅ 已确认（学术分析引用 + Supergiant 开发直播） |
| **命中定格（hit-lag）的具体毫秒数** | ⚠️ **未能确认**。Hades II 存在该机制（有专门的 "Disable Hit Lag" mod 佐证其存在与"slight"性质），但公开资料**未给出时长数值**。本项目 `feedback.ts:47-63` 自行标定的 26–110ms 分层区间是合理的独立设计，**不必对齐某个虚构的 Hades 数值** |
| **屏震的具体强度参数** | ⚠️ **未能确认**。Hades 的屏震强度无公开数据。本项目 `ShakeGovernor` 的治理规则（强覆盖弱、弱只续期）是比 Hades 更显式的好设计，**保持即可** |
| **敌人是否完全不显示血条** | ⚠️ **部分确认**。Hades 敌人被打时会出现血条，但战斗内**无浮动伤害数字**这一点仅有游玩录屏佐证，无官方文字确认 |
| Hades 祝福选择面板不暂停游戏 | ✅ 已确认（社区明确抱怨过，是**反面教材**而非值得抄的点） |
