# 开发 TODO 清单

---

## Phase 0: 祝福系统重构

### Step 1: 更新祝福数据 (`src/game/data/upgrades.ts`)

- [ ] 更新 `BoonDef` 接口：移除 `rarityScale` 中的伤害数值，改为电子系统数值
- [ ] 更新所有24个祝福的 `desc` 描述文本
- [ ] 更新 `rarityScale` 数值（改为电子夺取数、CD缩减%等）
- [ ] 更新 `formatBoonDesc` 函数以支持新的占位符

### Step 2: 新增祝福状态字段 (`GameScene.ts`)

- [ ] 在 GameScene 类中新增字段：
  ```
  boonExtraElectronOxidize = 0
  boonExtraElectronReduce = 0
  boonElectronDmgMult = 1
  boonCritChance = 0
  boonCritMult = 2
  boonHealPerRoom = 0
  boonValenceBonus = 0
  boonCdReduction = 0
  boonMoveSpeedBonus = 0
  ```
- [ ] 在 `resetRun()` 中重置这些字段

### Step 3: 重写 `applyBoonEffect` (`GameScene.ts:1224`)

- [ ] 氢系祝福：设置 `boonExtraElectronOxidize` / `boonElectronDmgMult`
- [ ] 氧系祝福：设置 DOT 效果、范围参数
- [ ] 碳系祝福：设置 `boonHealPerRoom` / `boonValenceBonus` / 回血逻辑
- [ ] 催化系祝福：设置 `boonCdReduction` / `boonCritChance` / `boonMoveSpeedBonus`
- [ ] 移除所有 `gameState.dyeBonus += ...` 的旧逻辑

### Step 4: 修改氧化模式战斗逻辑 (`oxidizeInteraction`)

- [ ] 替换 `const extraHits = Math.floor(gameState.dyeBonus * 2)` 为新逻辑
- [ ] 加入暴击判定：`Math.random() < this.boonCritChance`
- [ ] 应用 `boonExtraElectronOxidize` 额外夺取
- [ ] 应用 `boonElectronDmgMult` 倍率
- [ ] 实现链式反应弹射（`h-atk-chain`）
- [ ] 实现点燃DOT（`o-atk-ignite`）

### Step 5: 修改还原模式战斗逻辑 (`reduceInteraction`)

- [ ] 替换 `const extraHits = Math.floor(gameState.dyeBonus * 2)` 为新逻辑
- [ ] 应用 `boonExtraElectronReduce` 额外填充

### Step 6: 修改攻击CD (`attack()`)

- [ ] 替换 `speedPct` 为 `this.boonCdReduction`

### Step 7: 修改冲刺逻辑 (`dash()`)

- [ ] 引爆冲刺：冲刺爆炸夺取范围内敌人电子
- [ ] 碳纤冲刺：冲刺回血
- [ ] 氧化雾：冲刺路径DOT
- [ ] 共振冲刺：设置 `nextAttackBoost` 为电子倍率

### Step 8: 修改特殊攻击逻辑

- [ ] 裂变冲击：特殊攻击范围夺取
- [ ] 核聚变：特殊攻击电子夺取翻倍
- [ ] 腐蚀扩散：酸池区域效果
- [ ] 等离子体：范围扩大 + 额外夺取

### Step 9: 修改房间清空逻辑

- [ ] 自修复：每清完房间恢复2个价电子的EHP

### Step 10: 修改受伤逻辑

- [ ] 玻璃大炮：受伤时额外失去1个价电子

### Step 11: 构建验证

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过

---

## Phase 1: Boss系统重构 + 4个新Boss

### Step 1: 创建Boss数据定义

- [ ] 新建 `src/game/data/bosses.ts`
- [ ] 定义 `BossConfig` / `BossPhaseConfig` / `BossAttackConfig` 接口
- [ ] 实现滴定巨像配置（layer 0）
- [ ] 实现电解领主配置（layer 1）
- [ ] 实现链式反应母体配置（layer 2）
- [ ] 实现氧化之主配置（final boss）

### Step 2: 扩展 RuntimeBoss 接口

- [ ] 在 `GameScene.ts` 中扩展 `RuntimeBoss` 接口
- [ ] 新增字段：`config`, `acidPools`, `adds`, `chainState`, `aoeTimer`

### Step 3: 重写 trySpawnBoss()

- [ ] 根据 `roomDef.layer` 选择Boss配置
- [ ] 使用粒子系统生成SVG精灵
- [ ] 初始化Boss专属状态

### Step 4: 重写 updateBoss()

- [ ] 通用逻辑：轨道旋转、移动
- [ ] 按Boss类型分发攻击逻辑

### Step 5: 实现滴定巨像攻击

- [ ] 阶段1：slam + 1way shot + 酸池
- [ ] 阶段2：3way shot + 碱池 + 中和波
- [ ] 阶段3：全屏爆炸（安全区躲避）

### Step 6: 实现电解领主攻击

- [ ] 阶段1：slam + 电弧beam（旋转激光）
- [ ] 阶段2：双元素弹（H2O分裂）
- [ ] 阶段3：全屏麻痹（减速50%）

### Step 7: 实现链式反应母体攻击

- [ ] 阶段1：分裂（每10秒召唤2个小聚合物）
- [ ] 阶段2：链式爆炸（连锁AOE）
- [ ] 阶段3：聚合物墙（从四面推来）

### Step 8: 实现氧化之主攻击

- [ ] 阶段1：燃烧弹 + 火焰池
- [ ] 阶段2：爆燃（踩火焰池连锁爆炸）
- [ ] 阶段3：温度熔毁（温度自动飙升，60秒限时）

### Step 9: UI更新

- [ ] `UIScene.ts`：Boss名称根据 `boss.config.name` 显示
- [ ] Boss血条显示

### Step 10: 资源文件

- [ ] 创建 `assets/sprites/enemies/boss-chain.svg`
- [ ] 创建 `assets/sprites/enemies/boss-electrolysis.svg`
- [ ] 创建 `assets/sprites/enemies/boss-oxidation.svg`
- [ ] 在 `AssetLoader.ts` 中加载新精灵

### Step 11: 构建验证

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过

---

## Phase 2: 染色DNA系统

### Step 1: 扩展染料数据 (`src/game/data/dyes.ts`)

- [ ] 扩展 `DyeData` 接口（wavelength, effect, stability, temperatureDelta）
- [ ] 添加9种染料完整定义（红/橙/黄/绿/青/蓝/紫/紫外/红外）
- [ ] 实现混色表 `MIX_TABLE`
- [ ] 实现冲突色表

### Step 2: 染色槽系统 (`GameState.ts`)

- [ ] 新增 `DyeSlot` 接口
- [ ] 在 `GameState` 中新增 `dyeSlots: [DyeSlot, DyeSlot, DyeSlot]`
- [ ] 在 `resetRun()` 中重置染色槽

### Step 3: 颜色效果实现 (`GameScene.ts`)

- [ ] 红：氧化夺取+1
- [ ] 橙：AOE范围+20%
- [ ] 黄：移速+15%
- [ ] 绿：攻击附带3秒DOT
- [ ] 青：还原夺取+1
- [ ] 蓝：CD-15%
- [ ] 紫：真实伤害（无视内层电子）
- [ ] 紫外：攻击破甲
- [ ] 红外：攻击附带真实伤害

### Step 4: 敌人光谱弱点

- [ ] 在 `rooms.ts` 敌人定义中添加 `spectrum` 和 `weakness` 字段
- [ ] 在伤害计算中检查互补色克制（+30%伤害）

### Step 5: 染色UI

- [ ] `index.html`：添加3个染色槽UI
- [ ] `index.html`：添加混色面板
- [ ] `index.html`：添加颜色效果预览

### Step 6: 染色拾取/应用逻辑

- [ ] 敌人掉落染料（40%概率）
- [ ] 拾取染料填入空槽位
- [ ] 混色操作（两色混合产生新色）

### Step 7: 构建验证

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过

---

## Phase 3: 遗物/催化剂系统

### Step 1: 遗物数据 (`src/game/data/relics.ts`)

- [ ] 定义 `RelicData` 接口（id, name, effect, rarity, tier, upgrades）
- [ ] 实现10个遗物完整定义
- [ ] 实现3级升级数据

### Step 2: 遗物槽系统 (`GameState.ts`)

- [ ] 新增 `RelicSlot` 接口
- [ ] 在 `GameState` 中新增 `relicSlots: RelicSlot[]`（最多3槽）
- [ ] 在 `resetRun()` 中重置遗物槽

### Step 3: 遗物效果实现 (`GameScene.ts`)

- [ ] 惰性气体护符：`maxInner += 1`, 温度修正
- [ ] 铂网催化剂：祝福触发率+15%
- [ ] 酶配体：温度变化修正-20%
- [ ] 同位素标签：死亡保留20%样本
- [ ] 卤素吊坠：`boonExtraElectronOxidize += 1`
- [ ] 碱金属徽章：冲刺爆炸效果
- [ ] 液氮护符：初始温度-20, 攻击冰冻
- [ ] 石墨护符：召唤物数量+1
- [ ] 王水信物：破甲效果
- [ ] 辐射徽章：反应增强+50%

### Step 4: 遗物获取方式

- [ ] 宝藏房：随机掉落1个遗物
- [ ] 商店房：花费样本购买
- [ ] Boss击杀：100%掉落1个遗物
- [ ] 遗物选择UI：3选1

### Step 5: 遗物升级

- [ ] LobbyScene：遗物升级界面
- [ ] 使用样本升级遗物等级

### Step 6: 遗物UI

- [ ] `index.html`：遗物槽显示
- [ ] `index.html`：遗物选择面板
- [ ] `index.html`：遗物详情tooltip

### Step 7: 构建验证

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过

---

## 最终集成

- [ ] Phase 0-3 全部完成后，进行整体测试
- [ ] 检查祝福 + 染色 + 遗物的组合效果
- [ ] 平衡性调整
- [ ] 最终构建验证
