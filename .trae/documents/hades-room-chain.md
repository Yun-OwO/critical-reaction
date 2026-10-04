# Hades 式房间链改造（P1 房间系统 + 更多房间）

## Context

当前《临界反应》的 `GameScene` 是单一开放战场（4800×2400 菱形区域），敌人自动波次生成、Boss 按击杀数阈值触发、撤离点为固定位置通风橱，**没有"房间"概念**。用户要求：按文档计划（美术资源列表 P1：房间/节点地图；开发参考与最佳实践：Hades 房间流程"清怪→奖励→出口预告"）开发，并**拓展更多房间**，采用 **Hades 式房间链**。

目标：把单一战场改造为房间链——进房→清怪→清空→解锁出口→选择下一房间（战斗/宝藏/商店/撤离 4 种 + Boss 房）→撤离房为终点。P2 的精英/事件/仪器房间仅预留扩展点，本次不实现。

## 数据模型：新增 `src/game/data/rooms.ts`（纯函数、零 Phaser 依赖、可单测）

- 类型：`RoomType = 'combat'|'treasure'|'shop'|'extraction'`；`RunRoomState = 'enter'|'combat'|'cleared'|'choose'|'travel'`
- `RoomEnemyDef`（key/kind/baseHp/baseSpeed/weight）、`RoomWaveConfig`（count/composition/boss?）、`RoomReward`（samples/freeElectron/temperature）、`ShopOffer`（cost/item/amount）、`RoomDef`（id/type/depth/waves/reward/shop/boss?）
- `ROOM_THEMES: Record<RoomType, RoomTheme>`（boundary 描边色、banner 名、icon 字形：剑/箱/币/门）
- 常量：`MAX_DEPTH = 5`（链深 0-5 共 6 房）、`BOSS_DEPTH = 3`、`COMBAT_POOL`（5 种敌人含 reducer 支援位，权重加权）
- 纯函数：`makeCombatWaves(depth, boss?)`、`buildComposition(cfg, count)`（count≥3 强制含 chaser/ranged/tank 各一）、`createRoom(type, depth, rng?)`、`generateStartRoom()`、`generateRoomDoors(depth, rng?)`（depthLeft≤1 返回 1 门强制撤离；==2 返回 2 门必含撤离；否则 3 门加权 combat50/treasure25/shop25；depth+1===BOSS_DEPTH 强制一门为 boss 战斗房；rng 可注入保证确定性）

## 状态与事件

- `GameState.ts`：追加 `roomIndex:number`、`roomState:RunRoomState`、`currentRoomType:RoomType`、`doorChoices:RoomType[]`、`chosenDoor:number`；`resetRun()` 同步重置（初始 enter/combat/0/[]/0）。rooms.ts 只单向 import 类型，无循环依赖。
- `EventBus.ts`：`GameEvent` union 追加 `'room' | 'treasure'`（纯增量）。

## GameScene 改造（核心，复用现有函数）

**新增私有字段**：`roomDef`、`roomDoorTargets: RoomDef[]`、`roomDoors`（门视图数组）、`roomWaveIndex`、`roomWaveCooldown`、`roomEnterTimer`、`roomClearTimer`、`travelTimer`、`pendingSpawns`、`runWaveCounter`、`extractionEnabled`、`chest`、`merchant`、`roomBannerText`、`roomTintRect`、`extractionPressureTimer`。

**create()**：删除 6 个硬编码 `spawnEnemy` 与 `createExtractionZone()` 调用，改 `this.startRun()`；提示文案"E 撤离"→"E 互动"。其余（网格/轨道/大气/UIScene/Bloom/fog）不动。

**update()**：删除原自动波次+Boss 阈值块（约 391-402 行），替换为 `this.updateRoom(dt)`；温度升温条件改用 `countAliveHostiles()`。

**房间状态机 `updateRoom(dt)`**：
- `enter`：roomEnterTimer 0.8s（房间横幅）→ 战斗/撤离房转 `combat`（spawnRoomWave 带预告），宝藏/商店房直接转 `cleared`
- `combat`：`countAliveHostiles() + pendingSpawns === 0` 且冷却结束 → 有下一波则波次+1 继续，否则 `onRoomCleared()`
- `cleared`：roomClearTimer 0.45s → 撤离房设 `extractionEnabled=true`（无门），否则 `spawnDoors()` 转 `choose`
- `choose`：`updateRoomInteractions(dt)`（门/宝箱/商人三合一最近交互，E 键）
- `travel`：travelTimer 0.35s + `cameras.main.fadeOut(300)` → `enterRoom(roomDoorTargets[chosenDoor])`

**波次与预告**：`spawnWave` → `spawnRoomWave(room, waveIdx)`（hpScale 用全局 `runWaveCounter` 保证难度连续；生成点禁玩家 400px 内重掷至多 5 次；clampToPlayArea）。新增 `telegraphSpawn`（红色旋转 45° 菱形预告 0.7s，`pendingSpawns` 严格配对增减后 `spawnEnemy`）与 `telegraphBossSpawn`（大菱形紫色描边 0.9s 后复用现有 `trySpawnBoss`）。

**门与节点选择**：`spawnDoors()` 用 `generateRoomDoors(roomIndex)` 生成 2-3 门，排列在菱形上顶点方向（`diamondCx + (i-(n-1)/2)*330, diamondCy-860`，经 clampToPlayArea 0.82）；每门=椭圆地面光（主题色）+ 平台环 + 图标字形 + 标签"战斗房 [E]"，视觉复用 LobbyScene 交互点风格。`gameState.doorChoices` 同步类型预览。

**宝藏房**：`spawnChest()`（金色描边矩形 + 金光 + "宝箱 [E]"）；E 交互→`opened`→奖励 tween→`applyReward`（samples→floating text；freeElectron→`gainFreeElectrons`+`showElectronDelta`；temperature→降温）→`emit('treasure', ...)`。新增小工具 `showFloatingText(x,y,text,color)`（仿 showDamageNumber）。

**商店房**：`spawnMerchant()`（紫色平台 + "催化剂商人 [E]"）；E 交互→samples≥cost 扣款应用（electronMax→maxFreeElectrons+1；heal→回满 ehp；temperature→-20），不足显示"样本不足"；一次性购买。

**撤离房**：enterRoom 时创建 `extractZone` 但初始隐藏（"通风橱（清怪后解锁）"）；`updateExtraction()` 首行加闸 `if (currentRoomType!=='extraction' || !extractionEnabled || !this.extractZone) return`；cleared 后解锁，原 5s 稳定化流程不变；撤离期间 `extractionPressureTimer` 每 3s 预告生成一只 chaser（实践文档"撤离无压力"缺陷修复）。撤离成功→samples 存档→回 LobbyScene 逻辑不动。

**Boss**：`trySpawnBoss`/`defeatBoss` 原样保留；触发从"击杀阈值+waveIndex"改为房间波次 `boss:true`（telegraphBossSpawn 调用）；`countAliveHostiles` 已含 boss 可见判定，Boss 死后自然清空。

**房间主题**：`applyRoomTheme(room)`——重绘 `createWorldBoundary` 描边色为 `theme.boundary`（原 0x67e8f9 参数化）+ 全图 `roomTintRect`（主题色 0.05 alpha）+ 房间横幅淡入淡出。

**房间切换清理**：`tearDownRoomEntities()`（travel/死亡前调用）销毁门/宝箱/商人/撤离区/横幅/全部敌人（view+aura+glow+halos+orbitArcs）/Boss（含 orbitRings/orbitArcs）/projectiles/enemyProjectiles/acidPools/dyeDrops/reactionPairs，重置相关标志与数组；玩家轨道环保留。`enterRoom` 调 `applyRoomTheme` + 波次重置 + `fadeIn(350)`。

## UIScene 改动

- create() 增加 `roomText`（顶部居中）：`深度 ${roomIndex+1} · ${ROOM_THEMES[currentRoomType].banner}`
- 监听 `'treasure'`（奖励提示）、`'room'`（房间清空·出口已解锁）

## 文件清单

| 文件 | 操作 |
|---|---|
| `src/game/data/rooms.ts` | 新增（全部纯函数） |
| `tests/rooms.test.ts` | 新增（约 10 用例，见验证） |
| `src/game/state/GameState.ts` | 房间字段 + resetRun |
| `src/game/events/EventBus.ts` | union 追加 'room'/'treasure' |
| `src/game/scenes/GameScene.ts` | 主改造（状态机/波次/门/宝箱/商人/撤离闸/主题/清理） |
| `src/game/scenes/UIScene.ts` | 房间 HUD + 事件提示 |

不动：LobbyScene、main.ts、weapons/dyes/reactions/elements/relics/orbit/diamond/projection/haptic/mobileInput。

## 验证

- 自动化（必须全绿）：`npm run typecheck`、`npm test`（现有 35 用例不受影响 + 新增 rooms.test.ts）、`npm run build`
- rooms.test.ts 覆盖：start 房为 combat/depth0；depthLeft≤1 单门必撤离；==2 双门含撤离；中间 3 门类型∈{combat,treasure,shop}；BOSS_DEPTH 前恰好一门 boss 战斗房；门目标 depth 递增不变式；buildComposition 长度正确且含近战/远程/支援；注入 rng 输出确定；ROOM_THEMES 四键齐全；resetRun 后房间字段复位
- 手动验证：大厅进 GameScene→战斗房横幅+红色菱形预告（不在玩家 400px 内）→清怪开 3 门带图标→选门黑场过渡→宝藏/商店房交互→深度 3 Boss 房→撤离房清怪后解锁通风橱→5s 稳定化（有压力波）→回 LobbyScene 样本已存档；死亡/换房无残留实体。
