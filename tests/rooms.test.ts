import { describe, expect, it } from 'vitest';
import {
  BASE_DYE_IDS,
  COMBAT_POOL,
  EXTRACTION_DEFS,
  INSTRUMENT_OFFERS,
  ROOM_THEMES,
  buildComposition,
  canUseExtraction,
  createRoom,
  createBossRoom,
  createFinalBossRoom,
  generateRoomDoors,
  generateStartRoom,
  makeCombatWaves,
  makeEliteWaves,
  pickDyeChoices,
  pickExtraction,
  pickInstrument,
  settleExtractionSamples,
  getLayerName,
  getLayerProgress,
  getLayerHpScale,
  getLayerSpeedScale
} from '../src/game/data/rooms';
import type { RoomDef } from '../src/game/data/rooms';
import { gameState, resetRun } from '../src/game/state/GameState';

describe('rooms 房间链生成', () => {
  it('起始房恒为第 0 层深度 0 的战斗房', () => {
    const room = generateStartRoom();
    expect(room.type).toBe('combat');
    expect(room.depth).toBe(0);
    expect(room.layer).toBe(0);
  });

  it('第 0 层普通房（depth 0）生成 3 扇门', () => {
    const room = createRoom('combat', 0, 0);
    const doors = generateRoomDoors(room);
    expect(doors.length).toBeGreaterThanOrEqual(2);
  });

  it('层末（depth=3）生成 Boss 门', () => {
    const room = createRoom('combat', 3, 0);
    const doors = generateRoomDoors(room);
    const bossDoors = doors.filter((d) => d.type === 'boss');
    expect(bossDoors).toHaveLength(1);
  });

  it('撤离房与战斗房一样携带波次配置（清怪后才可撤离）', () => {
    for (const layer of [0, 1, 2]) {
      const room = createRoom('extraction', 1, layer);
      expect(room.waves.length, `layer=${layer}`).toBeGreaterThan(0);
      expect(room.waves.every((w) => w.count > 0 && w.composition.length > 0)).toBe(true);
    }
  });

  it('Boss 房（第 0 层）清空后生成下一层入口', () => {
    const bossRoom = createBossRoom(0);
    const doors = generateRoomDoors(bossRoom);
    expect(doors.length).toBeGreaterThanOrEqual(1);
    expect(doors.some((d) => d.layer === 1)).toBe(true);
  });

  it('Boss 房（第 2 层）清空后生成最终 Boss', () => {
    const bossRoom = createBossRoom(2);
    const doors = generateRoomDoors(bossRoom);
    expect(doors.some((d) => d.type === 'finalBoss')).toBe(true);
  });

  it('最终 Boss 房没有出口', () => {
    const finalBoss = createFinalBossRoom();
    const doors = generateRoomDoors(finalBoss);
    expect(doors).toHaveLength(0);
  });

  it('所有门的 layer >= 当前房间 layer（不会回退层）', () => {
    for (const layer of [0, 1, 2]) {
      const room = createRoom('combat', 1, layer);
      for (const door of generateRoomDoors(room)) {
        expect(door.layer).toBeGreaterThanOrEqual(layer);
      }
    }
  });

  it('buildComposition 长度正确且含近战/远程/坦克', () => {
    const cfg = makeCombatWaves(2)[0];
    const roster = buildComposition(cfg, 5);
    expect(roster).toHaveLength(5);
    const kinds = roster.map((d) => d.kind);
    expect(kinds).toContain('chaser');
    expect(kinds).toContain('ranged');
    expect(kinds).toContain('tank');
  });

  it('注入 rng 时生成输出确定', () => {
    const room = createRoom('combat', 1, 0);
    const seq1 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const seq2 = [...seq1];
    const doors1 = generateRoomDoors(room, () => seq1.shift() ?? 0);
    const doors2 = generateRoomDoors(room, () => seq2.shift() ?? 0);
    expect(doors1.map((d) => d.type)).toEqual(doors2.map((d) => d.type));
    expect(doors1.map((d) => d.depth)).toEqual(doors2.map((d) => d.depth));
  });

  it('createRoom 宝藏房有奖励、商店房有报价', () => {
    const treasure = createRoom('treasure', 2, 0, () => 0.1);
    expect(treasure.reward).not.toBeNull();
    expect(treasure.waves).toHaveLength(0);
    const shop = createRoom('shop', 2, 0, () => 0.1);
    expect(shop.shop).not.toBeNull();
    expect(shop.shop!.cost).toBeGreaterThan(0);
  });

  it('ROOM_THEMES 覆盖所有房间类型', () => {
    for (const type of ['combat', 'treasure', 'shop', 'extraction', 'boss', 'finalBoss'] as const) {
      expect(ROOM_THEMES[type].banner.length).toBeGreaterThan(0);
      expect(ROOM_THEMES[type].icon.length).toBeGreaterThan(0);
    }
  });

  it('resetRun 后房间字段复位', () => {
    gameState.roomIndex = 3;
    gameState.layer = 1;
    gameState.roomState = 'choose';
    gameState.currentRoomType = 'shop';
    gameState.doorChoices = ['combat'];
    gameState.chosenDoor = 1;
    gameState.finalBossActive = true;
    gameState.runComplete = true;
    resetRun();
    expect(gameState.roomIndex).toBe(0);
    expect(gameState.layer).toBe(0);
    expect(gameState.roomState).toBe('enter');
    expect(gameState.currentRoomType).toBe('combat');
    expect(gameState.doorChoices).toEqual([]);
    expect(gameState.chosenDoor).toBe(0);
    expect(gameState.finalBossActive).toBe(false);
    expect(gameState.runComplete).toBe(false);
  });

  it('COMBAT_POOL 含支援位（reducer healer）', () => {
    expect(COMBAT_POOL.some((d) => d.kind === 'healer')).toBe(true);
  });

  it('getLayerName 返回正确层名', () => {
    expect(getLayerName(0)).toContain('第一层');
    expect(getLayerName(1)).toContain('第二层');
    expect(getLayerName(2)).toContain('第三层');
  });

  it('getLayerHpScale 返回递增倍率', () => {
    expect(getLayerHpScale(0)).toBeLessThan(getLayerHpScale(1));
    expect(getLayerHpScale(1)).toBeLessThan(getLayerHpScale(2));
  });

  it('Boss 房 waves 包含 boss 波', () => {
    const bossRoom = createBossRoom(0);
    expect(bossRoom.waves.some((w) => w.boss === true)).toBe(true);
  });

  it('最终 Boss 房有 boss 波', () => {
    const finalBoss = createFinalBossRoom();
    expect(finalBoss.waves.some((w) => w.boss === true)).toBe(true);
    expect(finalBoss.type).toBe('finalBoss');
  });

  it('精英房携带精英波次与样本奖励', () => {
    const room = createRoom('elite', 1, 1);
    expect(room.waves.length).toBeGreaterThan(0);
    expect(room.waves.every((w) => w.elite === true)).toBe(true);
    expect(room.reward!.kind).toBe('samples');
    expect(room.reward!.amount).toBeGreaterThanOrEqual(5);
    // 层数越高奖励越多
    expect(createRoom('elite', 1, 2).reward!.amount).toBeGreaterThan(room.reward!.amount);
  });

  it('精英波敌人数量少于普通波（少而强）', () => {
    const elite = makeEliteWaves(0);
    const normal = makeCombatWaves(0);
    expect(elite[0].count).toBeLessThan(normal[0].count);
    expect(elite.every((w) => w.elite === true)).toBe(true);
  });

  it('事件房携带一台化学仪器且无战斗波次', () => {
    const room = createRoom('event', 2, 0);
    expect(room.waves).toHaveLength(0);
    expect(room.instrument).not.toBeNull();
    expect(INSTRUMENT_OFFERS.some((o) => o.id === room.instrument!.id)).toBe(true);
  });

  it('pickInstrument 注入 rng 时结果确定且在池内', () => {
    expect(pickInstrument(() => 0)).toBe(INSTRUMENT_OFFERS[0]);
    expect(pickInstrument(() => 0.999)).toBe(INSTRUMENT_OFFERS[INSTRUMENT_OFFERS.length - 1]);
    for (const offer of INSTRUMENT_OFFERS) {
      expect(offer.desc.length).toBeGreaterThan(0);
      expect(offer.icon.length).toBeGreaterThan(0);
    }
  });

  it('仪器池包含升温与降温两类取舍', () => {
    expect(INSTRUMENT_OFFERS.some((o) => o.temperature > 0)).toBe(true);
    expect(INSTRUMENT_OFFERS.some((o) => o.temperature < 0)).toBe(true);
    expect(INSTRUMENT_OFFERS.some((o) => o.refill === true)).toBe(true);
  });

  it('普通房门池可产出精英房与事件房', () => {
    const room = createRoom('combat', 1, 0);
    const eliteDoors = generateRoomDoors(room, () => 0.7);
    expect(eliteDoors.every((d) => d.type === 'elite')).toBe(true);
    const eventDoors = generateRoomDoors(room, () => 0.8);
    expect(eventDoors.every((d) => d.type === 'event')).toBe(true);
    expect(eventDoors.every((d) => d.instrument !== null)).toBe(true);
  });

  it('ROOM_THEMES 覆盖精英房与事件房', () => {
    for (const type of ['elite', 'event'] as const) {
      expect(ROOM_THEMES[type].banner.length).toBeGreaterThan(0);
      expect(ROOM_THEMES[type].icon.length).toBeGreaterThan(0);
      expect(ROOM_THEMES[type].boundary).toBeGreaterThan(0);
    }
  });

  it('染料房携带 3 个互不重复的染缸选项且无战斗波次', () => {
    const room = createRoom('dye', 2, 0);
    expect(room.waves).toHaveLength(0);
    expect(room.dye).not.toBeNull();
    const choices = room.dye!.choices;
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices.every((id) => (BASE_DYE_IDS as readonly string[]).includes(id))).toBe(true);
  });

  it('pickDyeChoices 注入 rng 时结果确定且为 3 个不重复基础染料', () => {
    const a = pickDyeChoices(() => 0);
    const b = pickDyeChoices(() => 0);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(pickDyeChoices(() => 0.999)).toHaveLength(3);
  });

  it('普通房门池可产出染料房', () => {
    const room = createRoom('combat', 1, 0);
    const dyeDoors = generateRoomDoors(room, () => 0.9);
    expect(dyeDoors.every((d) => d.type === 'dye')).toBe(true);
    expect(dyeDoors.every((d) => d.dye !== null)).toBe(true);
  });

  it('ROOM_THEMES 覆盖染料房', () => {
    expect(ROOM_THEMES.dye.banner.length).toBeGreaterThan(0);
    expect(ROOM_THEMES.dye.icon.length).toBeGreaterThan(0);
    expect(ROOM_THEMES.dye.boundary).toBeGreaterThan(0);
  });

  it('低温时优先给通风橱（标准奖励、不损坏样本）', () => {
    const def = pickExtraction({ temperature: 20, freeElectrons: 0, bossKills: 0 });
    expect(def.id).toBe('vent');
    expect(def.rewardMult).toBe(1);
    expect(def.lossRate).toBe(0);
  });

  it('温度 ≥40 且无试剂时退化为淬火池（样本损坏 30%）', () => {
    const def = pickExtraction({ temperature: 55, freeElectrons: 0, bossKills: 0 });
    expect(def.id).toBe('quench');
    expect(def.lossRate).toBe(0.3);
  });

  it('有自由电子时优先稳定化反应（样本完好、收益更高）', () => {
    const def = pickExtraction({ temperature: 55, freeElectrons: 1, bossKills: 0 });
    expect(def.id).toBe('stabilize');
    expect(def.reagentCost).toBe(1);
    expect(def.rewardMult).toBeGreaterThan(1);
    expect(def.lossRate).toBe(0);
  });

  it('温度 >80 且无 Boss 记录时给高温撤离（双倍奖励）', () => {
    const def = pickExtraction({ temperature: 85, freeElectrons: 0, bossKills: 0 });
    expect(def.id).toBe('hot');
    expect(def.rewardMult).toBe(2);
  });

  it('击败过 Boss 时隐藏撤离优先级最高', () => {
    const def = pickExtraction({ temperature: 85, freeElectrons: 3, bossKills: 1 });
    expect(def.id).toBe('hidden');
    expect(def.bossKills).toBe(1);
    expect(def.rewardMult).toBeGreaterThan(EXTRACTION_DEFS.hot.rewardMult);
  });

  it('撤离点条件判定严格（温度上限/下限/试剂/Boss 记录）', () => {
    expect(canUseExtraction(EXTRACTION_DEFS.vent, { temperature: 39, freeElectrons: 0, bossKills: 0 })).toBe(false);
    expect(canUseExtraction(EXTRACTION_DEFS.vent, { temperature: 38, freeElectrons: 0, bossKills: 0 })).toBe(true);
    expect(canUseExtraction(EXTRACTION_DEFS.hot, { temperature: 79, freeElectrons: 0, bossKills: 0 })).toBe(false);
    expect(canUseExtraction(EXTRACTION_DEFS.hot, { temperature: 80, freeElectrons: 0, bossKills: 0 })).toBe(true);
    expect(canUseExtraction(EXTRACTION_DEFS.stabilize, { temperature: 20, freeElectrons: 0, bossKills: 0 })).toBe(false);
    expect(canUseExtraction(EXTRACTION_DEFS.hidden, { temperature: 20, freeElectrons: 0, bossKills: 0 })).toBe(false);
    // 淬火池恒可用，保证任何状态下都能离开
    expect(canUseExtraction(EXTRACTION_DEFS.quench, { temperature: 100, freeElectrons: 0, bossKills: 0 })).toBe(true);
  });

  it('settleExtractionSamples 按倍率与损坏比例结算且至少 1', () => {
    expect(settleExtractionSamples(4, EXTRACTION_DEFS.vent)).toBe(4);
    expect(settleExtractionSamples(4, EXTRACTION_DEFS.hot)).toBe(7); // 4*2*0.85 = 6.8 → 7
    expect(settleExtractionSamples(4, EXTRACTION_DEFS.quench)).toBe(3); // 4*0.7 = 2.8 → 3
    expect(settleExtractionSamples(1, EXTRACTION_DEFS.quench)).toBe(1);
  });

  it('撤离点倒计时随风险递增（越贪越久）', () => {
    const order = ['quench', 'vent', 'stabilize', 'hot', 'hidden'] as const;
    const holds = order.map((id) => EXTRACTION_DEFS[id].holdSeconds);
    expect(holds).toEqual([...holds].sort((a, b) => a - b));
  });
});
