# 批次 7：敌人多层电子 · 炮特殊攻击重调 · 新攻击方式 · 遗物柜菱形网格对齐 · UI 精简与移动端重塑

## 执行进度（已核实，2026-09-23 恢复会话时）
- [x] 敌人多层电子（每层独立满血、破层、圆点可视）：RuntimeEnemy `electronLayers/layerPips`、`spawnEnemy(enemy, layer)`、`damageEnemy()` 已收拢 4 处伤害点、`killEnemy` 清 pip。
- [x] 炮激光全局 ≤5 点、稀疏→密集、打满后仅击退：`laserAttack` 已用 `hitFractions=[0.22,0.39,0.56,0.69,0.79]` + `nextHit` 实现。
- [~] 新攻击（2/3 层怪 + Boss 特色）：普通怪 ranged 射线 / tank 投弹 / acid 酸雾已接入（`gameState.layer>=1` 门控）；辅助方法 `throwBomb/updateBombs、spawnSmoke/updateSmokeClouds、enemyBeamAttack` 已存在并已挂入更新循环与 tearDown。**未完成项**：`RuntimeBoss.specialtyTimer`（字段已加到 interface L167、初始化在 L4366）尚无分发逻辑 —— 需在 `updateBoss` 专属攻击区（L4492 附近，oxidation meltdown 块之前）插入特色攻击分发块。
- [ ] 遗物柜菱形网格对齐大厅 2:1 iso：CSS 仍是 `--gx*-34px / --gz*20px`。
- [ ] UI：移除死监听、`.is-exiting` 动画、面板分区+overflow 滚动。
- [ ] 验证：typecheck + test。

## Context（背景）
《临界反应》为 Phaser4+TS 游戏。本轮以下目标：
1. 让 2/3 层怪物具备"多层电子"（类似 Boss 多段，最多 3 层）。
2. 炮（reaction-cannon）的特殊攻击（激光）整段周期内**每个敌人最多承受 5 次伤害**，出伤密度由稀疏到密集。
3. 怪物/Boss 新增攻击方式：射线、投掷炸弹、酸雾、烟雾（模糊视野）。**只在 2/3 层怪出现**；Boss 也有，且 1/2/3 层 Boss 必须各具特色。
4. 遗物柜"2.5D 菱形网格"按**大厅地图同款等距菱形公式**对齐。
5. 染色工作台/遗物柜效果更丰富（用 Phaser 可选增强，非硬性）。
6. 移除未实际使用的 UI。
7. 用分区/分组 + overflow 滚动缩小 UI 面积，改善移动端观感与操作。
8. typecheck + 52/52 测试通过。

## 关键现状（已确认）
- 敌人：`RuntimeEnemy`（GameScene.ts L38-68）只有单一 `hp/maxHp`，无层数。`spawnEnemy`(L893)+`telegraphSpawn`(L1150) 目前不收 layer。死亡判定 `if(enemy.hp<=0) killEnemy` 散落在 5 个伤害点（L2676/2680、2771/2775、3144/3149、3916/3918、4080/4082）。治疗点 L3236/L3302 直接改 hp，勿动。
- 大厅菱形网格：`LobbyScene.ts` Lobby `drawIsometricGrid` 用标准 2:1 iso：`x=cx+(col-row)*halfW, y=cy+(col+row)*halfH`。遗物柜当前 CSS `.relic-slot` 用 `--gx/-34px, --gz/+20px`（约 1.7:1，与大厅不一致，gz 方向相反）。
- 炮特殊攻击 `laserAttack`(L2585)：`totalMs=700, tickMs=60, baseDmg=2`，当前每 60ms 对束内敌人反复掉血。
- Boss：`bosses.ts` 3 层 Boss = 滴定巨像/titration(layer0)、电解领主/electrolysis(layer1)、链式反应母体/chain(layer2)，最终氧化之主/final。Boss 用轨道电子 `bossElectronCount`（自有模型，本轮不动）。
- 敌人 AI 分支在 `updateEnemies`(L3119) kind 分支；Boss 专属攻击区在 `updateBoss`（L4287 附近）。

## 实施步骤

### 1. 敌人多层电子（每层独立满血，最多 3 层）
- `RuntimeEnemy`（L38）新增 `electronLayers: number`（本层剩余层数）。
- `spawnEnemy`(L893) 与 `telegraphSpawn`(L1150) 增加 `layer` 与 `layers` 传参；`layers = clamp(layer+1,1,3)`（floor0=1, floor1=2, floor2=3）。调用点统一用 `this.roomDef.layer`（Boss 召唤的小怪同源，自动获得对应层数）。
- 新增 `damageEnemy(enemy, amount)`：`enemy.hp -= amount`；若 `hp<=0` 且 `electronLayers>1` → `electronLayers--`，`hp = maxHp`，触发"破层"视觉（光环闪光 + 浮字「破层」+ 减一圈）；否则调用 `killEnemy`。
- 把 5 处 `enemy.hp-=X; ...; if(hp<=0) killEnemy` 收拢为 `this.damageEnemy(enemy, X)`（保留各自的 showDamageNumber/击退/灼烧特效）。治疗点直接赋 `hp` 的不动。
- 层数可视：`spawnEnemy` 对 `layers>1` 在怪上方生成 N 个小圆点（随层数），破层时减少一枚，用于"类似 Boss 多段"的呈现。

### 2. 炮特殊攻击 → 整段全局 ≤5 点伤害，稀疏→密集；打满后仅击退
- 重写 `laserAttack`(L2585) 伤害调度为**全局伤害预算**：`remainingDamage = 5`，无论命中多少敌人都共用。
  - 将整个 `totalMs` 划出 5 个命中时机、时刻**递增密度**（稀疏→密集，间隔递减）。每个时机把 1 点伤害结算到**当时处于光束内的最近敌人**；`remainingDamage--`。
  - `remainingDamage <= 0` 后，后续光束 tick **只做击退(push)，不造成伤害**。
  - 首段命中仍触发对应的氧化/还原互动一次（保留），不计入 5 点预算（或计入，二选一，默认不计入、保持 5 点纯伤害预算）。
- 光束由细到粗的 `grow()`、追踪、敌人/Boss 命中判定、击退结构保留；`baseDmg` 调整为 1，命中固定 1 点（不随 spectralBonus 累加到 >5）。

### 3. 新增攻击方式（2/3 层怪才有；Boss 各有特色）
- 普通怪（在 `updateEnemies` 按 kind 分支 + `gameState.layer` 门控，layer≥1 启用）：
  - ranged → **射线**：蓄力后持续光束扫射（短占位攻击）。
  - tank → **投掷炸弹**：向玩家投掷，延迟落地 AoE 爆炸。
  - acid → **酸雾**：释放一片持续酸雾（滞空区域，DoT + 减速）。
  - 新增 **烟雾**：烟怪或特定技能生成烟雾区域，叠加半透明暗幕降低玩家视野（相机 overlay，临时 rect 遮罩）。
- Boss（`updateBoss` 专属攻击区 + `bosses.ts` 配置）各自特色：
  - 滴定巨像(titration/layer0) → **酸雾** 特色（+少量射线）。
  - 电解领主(electrolysis/layer1) → **射线** 特色（持续光束）。
  - 链式反应母体(chain/layer2) → **投掷炸弹** 特色。
  - 烟雾在各 Boss 高压阶段/炸弹爆炸处伴随出现（模糊视野机制通用）。
- 新增的弹体/区域统一放入既有 `this.enemyProjectiles` 与新增的区域列表，参与玩家碰撞结算（避免重复实现玩家受击逻辑）。

### 4. 遗物柜菱形网格对齐大厅
- 改 `.relic-slot` CSS（index.html）定位为大厅同款 2:1 iso：`left: calc(50% + (var(--gx) - var(--gz)) * 26px); top: calc(50% + (var(--gx) + var(--gz)) * 13px);`（替换当前 `--gx*-34px / --gz*20px`），方向与大厅一致。移动端等比缩放（用更小的单位）。
- `relicGridSlot`(Menu.ts) 返回的 gx/gz 结构不变，仅按新公式排布成菱形。

### 5. 染色工作台/遗物柜更丰富效果（Phaser 可选）
- 沿用 CSS 方案为主（批次 6 已做菱形+浮空+颜色光晕）。本轮仅在小处增强（如激活遗物光晕、染色混色渐变动画），不引入 Phaser 重绘，控制范围。

### 6. 移除未使用 UI
- 删除 Menu.ts `quality-value` 死监听（HTML 无此 id）。
- 补齐 `.ui-panel.is-exiting` 动画规则（当前 panel-out keyframes 存在但未绑定，导致离开动画缺失）。
- 核实 `#mission-text` 是否仅 LabScene 使用；若确无使用，随 `lab-panel` 精简。`btn-fullscreen`/`back-home` 等沿用。

### 7. 移动端 UI 分区/分组 + overflow 滚动
- 设置/染色/遗物面板，容器改为 `display:flex; flex-direction:column` + 内容区 `overflow-y:auto`, 配合分区 `.wp-section`（标题分组）。缩小默认高度，移动端更紧凑。覆盖批次 6 已加的 600px 自适应尺寸略调。

## 涉及文件
- `src/game/scenes/GameScene.ts`（主体：多层电子、damageEnemy、炮激光重调、新攻击、Boss 特色）
- `src/game/data/rooms.ts`（如需要细调敌人 def/层缩放，最小改动）
- `src/game/data/bosses.ts`（Boss 特色攻击配置）
- `src/backend/ui/Menu.ts`（遗物/染色渲染微调、移除死监听）
- `index.html`（菱形 CSS 对齐、.is-exiting、面板分组+滚动、移动端）
- `.trae/documents/batch7-*.md` 计划文件

## 剩余实施步骤（精确定位，已核实行号，2026-09-23）

### A. Boss 特色攻击分发（唯一未完成的代码改动）
在 `updateBoss`(L4381) 专属攻击区 `// ===== Boss专属攻击 =====`（L4492）内、`oxidation` meltdown 块之前，新增 `specialtyTimer` 分发块（字段已存在 L167/L4366）：
- 递减 `boss.specialtyTimer -= delta`；`<=0` 时按层复位（layer0→7, layer1→6, layer2→5, final→4）并执行特色：
  - `titration`(layer0) → 酸雾：以 Boss 为中心在 3 个方位 `spawnAcidPool(x,y)`（已有方法 L4131），并伴随 `spawnSmoke`。
  - `electrolysis`(layer1) → 射线：`enemyBeamAttack(boss.view.x, boss.view.y, angleToPlayer)`（已有方法 L4217），一次性 2-3 道扇形。
  - `chain`(layer2) → 投弹：向玩家多枚 `throwBomb`（已有 L4163）+爆炸处 `spawnSmoke`。
  - `final/oxidation` → 烟雾：`spawnSmoke(player.x, player.y)` 玩家附近 + 小幅震屏。
- 复用现有方法，不新增玩家受击逻辑。

### B. 遗物柜菱形网格对齐大厅（index.html）
- 改为大厅同款 2:1 iso 公式：`.relic-slot` `left: calc(50% + ((var(--gx) - var(--gz)) * 26px)); top: calc(50% + ((var(--gx) + var(--gz)) * 13px));`（替换当前 L275-276 `--gx*-34px / --gz*20px`，方向统一为 +gz 向下、-gz 向上）。
- 移动端 @media 块（L435-441）同样改公式并等比缩小单位（如 18px/9px）。
- `Menu.ts reticGridSlot` 返回的 gx/gz 结构不变，仅按新排布成菱形。

### C. UI 精简与移动端分区滚动
- Menu.ts：移除 `quality-value` 死监听（HTML 无此 id）。
- index.html：补齐 `.ui-panel.is-exiting` 动画规则（`panel-out` keyframes 已存在 L248，给 `.is-exiting` 绑定 `animation: panel-out .18s ... forwards`）。
- 各面板（settings/dye/relic/lab）内容容器改 `display:flex; flex-direction:column` + 内容区 `overflow-y:auto`，标题分组 `.wp-section`；缩默认高度，移动端更紧凑。

## 验证
- `npm run typecheck` 无错误。
- `npm test` 全绿（52 或 62 项）。
- dev server `localhost:5174` 浏览器实测。