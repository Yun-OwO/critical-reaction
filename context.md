# 上下文快照（v0.2.3）

> 生成时间：2026-10-07。用于中断后续接，配合 `git log` 可直接复现工作区状态。
> 远程分支 `main` 已追平本地 `c543249`，所有提交已推送 GitHub。

---

## 一、项目概况

- **名称**：临界反应 / Critical Reaction，Phaser 4.2.1 + TypeScript strict + Vite dev（5173）+ vitest
- **仓库**：`https://github.com/Yun-OwO/critical-reaction`，包名 `com.criticalreaction.game`
- **当前版本**：`0.2.3`（`versionCode 5` / `versionName "0.2.3"`）
- **平台**：Android（Capacitor 8.5 + nodejs-mobile）
- **参考项目**：`../参考项目/` 下有 chemic（玩法与美术源）、geometry-duel（WebRTC 联机）、geometry-rogue（架构）、何忆卫（APK 逆向产物）

## 二、核心设计

- **电子即生命**：敌人靠清空轨道电子（capacity 8）击杀，不是扣 HP 数字
- **电子压制**：所有伤害%加成转译为概率型额外电子夺取/注入（`electronPressureBonus`）
- **搜打撤循环**：装备携带出击、撤离入库、死亡丢失；负载（样本/容量）影响移速与冲刺冷却
- **温度系统**：只升不降（v0.2.2 起）；还原态注入降温（1.6°/颗）；60° 过载自损、80° 临界、95° 熔毁倒计时

## 三、本轮已完成的功能

### 1. 程序化群系地图（`src/game/world/biomes.ts`）

- 三层柏林噪声（种子化 mulberry32 + Perlin2D）：群系分区 / 地形起伏 / 地物散布
- **5 种固定群系**，每种有：
  - `terrainTiles`：专属地面瓦片池（`biome-tloor` 石板、`biome-tbc` 面板）
  - `propTiles`：专属大型地物（`biome-trap-40..43` 为何忆卫设备残骸）
  - `decorKeys`：小型点缀（chemic 花/石/蘑菇/鹿角/厚丛）
  - `terrainCoverage`：瓦片覆盖概率
- **体积化地形**（`TerrainBlock`）：高地格生成等距棱柱——顶面菱形 + 左右侧面（darken 28/45）+ 挤出厚度 12/20/28 三档
- **2.5D 投影**：瓦片 `origin(0.5,1)` + scaleY 压缩；`depth = y*0.001 + 0.2`；底部椭圆阴影
- **碰撞与死路防护**：
  - 仅高度 ≥20 的棱柱可碰撞
  - 中央走廊 `|dx|<320` 禁用（门/宝箱/祝福/水池/撤离点全在走廊）
  - 碰撞棱柱切比雪夫间距 ≥2 格（`occupiedCells`）
  - 外圈 `|dy|/B ≤ 0.84` 禁用保证绕行
- **性能上限**：`maxTiles: 420` 防千级 Image 对象

### 2. 开发者调试叠层（设置 → 开发者标签）

- chemic 式帧率：引擎平滑值 + 本帧瞬时值 + 地图种子（可复现群系布局）
- 碰撞箱开关：`world.drawDebug` 每帧同步维持 + 按需 `createDebugGraphic()`（判空）

### 3. 其它已落地的系统

- **进化系统**（colorist 式染料喂养）：局内染料房 → `dyeEvolution[id]++` → 克制伤害 +6%/级、全局 +1%/级
- **哈迪斯式 HUD**：右下 ◆样本/▲负载/✦催化数值行；电子数/模式芯片/条右血量
- **自适应难度**：温度随通关推进速度上升（快推 18°/房，慢推 4°/房）
- **祝福平衡**：电子类折算 0.35 压制/颗，全局压制上限 2.2，觉醒催化威能 +15%
- **护盾改革**：基础上限 100→10，衰减 4/s，重复获取减半
- **单次攻击最多破一层**（溢出伤害不顺延）
- **音效叠加上限 5**（`SfxLimiter.maxVoices`）
- **战报等待点击**、最终 Boss 通关撤离、隐藏关死亡保护、稀有样本 +15

## 四、本轮修复的关键 bug（按时间倒序）

| 提交 | 问题 | 根因 |
|---|---|---|
| `c543249` | 开碰撞箱崩溃 `reading 'clear'` | `Arcade.World.debugGraphic` 默认 `undefined`，开了 `drawDebug` 却没创建图形 |
| `990ee88` | 开发者开关点了仍显示"关闭" | `SHORT_KEY_MAP` 缺 `dev-overlay`/`dev-hitbox` → fallback 键不存在 → 静默不写 localStorage |
| `06275cd` | 调试叠层无效 | World 每帧 clear 重绘，单次 `setVisible` 被覆盖 → 改为每帧同步维持 |
| `5ffa9d3` | 碰撞不生效 + 装饰被瓦片盖住 | 玩家物理体 92×92 全身（改脚底 56×28）；装饰 depth 固定 0.15 低于瓦片（改按 y 排序）
| `9554312` | 进大厅黑屏每帧抛 `reading 'isParent'` | 碰撞注册写在 `createAtmosphere()`，LobbyScene 复用时 `playerBody` 为 `undefined` |
| `28f7368` | 真实浏览器点开始后黑屏 | Loader 泵依赖 RAF，页面被系统节流时停摆，队列卡 `POPULATED`；加 300ms 手动泵 + 12s `loadComplete()` 兜底 |

## 五、重要经验教训

1. **不要用文本锚点脚本批量改代码**：半套执行会留下"字段声明在、create 创建丢失"的半残状态，排查成本极高。一律用 Edit 工具精确修改 + 每步验证
2. **改完立即 commit**：排查时 `git checkout` 会丢弃未提交改动（本轮一度丢了一批功能，靠幸存脚本重放恢复）
3. **先验证归因再改**：曾基于错误归因加 `maxParallelDownloads: 8`，后撤回
4. **不要在 iframe 里跑 WebGL 游戏做验证**：RAF 会被冻结，产生"卡死"假象
5. **Phaser 4 的坑**：`debugGraphic` 默认 undefined；`Loader.update` 依赖 RAF；静态组 `create` 需 `refreshBody()` 生效

## 六、当前状态

- tsc 无错、**221 测试全过**、构建成功、GitHub 已追平、APK 已装手机 + FTP 备份
- **待用户验证**：碰撞箱开启后棱柱/玩家碰撞盒位置是否正确，碰撞是否真阻挡

## 七、下一步（按优先级）

1. 等用户验证碰撞箱与碰撞效果
2. 群系渲染若仍有问题（贴图缺失），按 `depth 覆盖` 方向继续排查
3. 联机功能（已规划分层权威 + 确定性 Spec 下发，见 `docs/卫戍协议深研与改进方案.md`）
4. 参考 `docs/改进方案-基于参考项目研究.md` 的 P0 拆分路线治理 6000 行 GameScene
