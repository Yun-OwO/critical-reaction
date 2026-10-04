export type ReactionMode = 'oxidized' | 'reduced';
export type WeaponId = 'platinum-knife' | 'reaction-cannon';
export type BoonSlot = 'attack' | 'special' | 'dash' | 'passive';
import type { RoomType, RunRoomState } from '../data/rooms';
import { BASE_BAG_CAPACITY } from '../combat/load';

export interface EquippedBoon {
  id: string;
  name: string;
  icon: string;
  slot: BoonSlot;
  school: string;
  /** 强化等级（0-2，重复祝福时 +1，最多 3 级） */
  level: number;
}

export interface DyeSlot {
  dyeId: string | null;
  purity: number;
}

export interface GameState {
  valence: number;
  maxValence: number;
  /** 当前价电子剩余 HP（EHP）。 */
  ehp: number;
  /** 单个价电子的 HP 上限。 */
  ehpMax: number;
  inner: number;
  maxInner: number;
  freeElectrons: number;
  maxFreeElectrons: number;
  oxidationState: number;
  temperature: number;
  mode: ReactionMode;
  extraction: number;
  extracting: boolean;
  samples: number;
  kills: number;
  dashCd: number;
  /** 护盾值：先于 EHP 吸收伤害（祝福「碳键护甲/碳纤冲刺」等获得）。 */
  shieldHp: number;
  /** 护盾剩余时间（秒），到期后护盾耗尽。 */
  shieldTtl: number;
  dyeBonus: number;
  dyeColor: number;
  bossActive: boolean;
  currentWeapon: WeaponId;
  weaponSwitchCd: number;
  /** 当前房间深度（0 起，层内计数）。 */
  roomIndex: number;
  /** 当前所在层（0-2）。 */
  layer: number;
  /** 房间状态机状态。 */
  roomState: RunRoomState;
  /** 当前房间类型（HUD 展示用）。 */
  currentRoomType: RoomType;
  /** 当前出口门的类型预览。 */
  doorChoices: RoomType[];
  /** 玩家选择的门索引（travel 过渡期消费）。 */
  chosenDoor: number;
  /** 是否进入最终 Boss 房（第 3 层 Boss 击败后选择继续）。 */
  finalBossActive: boolean;
  /** 通关标记：最终 Boss 击败后为 true。 */
  runComplete: boolean;
  /** 已装备的祝福（4 个槽位各 1 个）。 */
  equippedBoons: EquippedBoon[];
  /** 反应催化层数（电子转移累积，999 封顶；全局伤害线性加成+里程碑掉落）。 */
  reactionLayers: number;
  /** 本局禁用的祝福 id（每局随机抽样，强制换 build 防背版）。 */
  disabledBoons: string[];
  /** 染色槽：主/副/底（100%/50%/25%效果）。 */
  dyeSlots: [DyeSlot, DyeSlot, DyeSlot];
  /** 背包容量（§4.3 负载系统）：携带样本量 / 容量 决定移速与冲刺冷却。 */
  bagCapacity: number;
  /**
   * 局内搜到的装备战利品（搜打撤的「搜」）：
   * 撤离成功写入局外仓库，死亡则全部丢失。
   */
  carriedGear: string[];
}

export const gameState: GameState = {
  valence: 1,
  maxValence: 1,
  ehp: 100,
  ehpMax: 100,
  inner: 0,
  maxInner: 0,
  freeElectrons: 0,
  maxFreeElectrons: 3,
  oxidationState: -1,
  temperature: 20,
  mode: 'oxidized',
  extraction: 0,
  extracting: false,
  samples: 0,
  kills: 0,
  dashCd: 0,
  shieldHp: 0,
  shieldTtl: 0,
  dyeBonus: 0,
  dyeColor: 0,
  bossActive: false,
  currentWeapon: 'platinum-knife',
  weaponSwitchCd: 0,
  roomIndex: 0,
  layer: 0,
  roomState: 'enter',
  currentRoomType: 'combat',
  doorChoices: [],
  chosenDoor: 0,
  finalBossActive: false,
  runComplete: false,
  equippedBoons: [],
  /** 反应催化层数（电子转移累积，999 封顶；全局伤害线性加成+里程碑） */
  reactionLayers: 0,
  /** 本局禁用的祝福 id（每局随机抽样，强制换 build 防背版） */
  disabledBoons: [] as string[],
  dyeSlots: [{ dyeId: null, purity: 1 }, { dyeId: null, purity: 0.5 }, { dyeId: null, purity: 0.25 }],
  bagCapacity: BASE_BAG_CAPACITY,
  carriedGear: []
};

/** 获得自由电子，自动封顶。 */
export function gainFreeElectrons(amount: number): void {
  gameState.freeElectrons = Math.min(gameState.maxFreeElectrons, gameState.freeElectrons + amount);
}

export interface PlayerDamageResult {
  /** 是否有价电子被击碎。 */
  lostElectron: boolean;
  /** 是否死亡（全部价电子耗尽）。 */
  died: boolean;
}

/**
 * 玩家受伤结算：先扣当前电子 EHP，扣穿则失去一个价电子并溢出伤害，
 * 价电子全部耗尽时死亡。
 */
export function damagePlayerState(amount: number): PlayerDamageResult {
  if (amount <= 0) return { lostElectron: false, died: gameState.valence <= 0 };
  // 护盾优先吸收伤害
  if (gameState.shieldHp > 0) {
    const absorbed = Math.min(gameState.shieldHp, amount);
    gameState.shieldHp -= absorbed;
    amount -= absorbed;
  }
  gameState.ehp -= amount;
  let lostElectron = false;
  while (gameState.ehp <= 0 && gameState.valence > 0) {
    gameState.valence -= 1;
    gameState.ehp += gameState.ehpMax;
    lostElectron = true;
  }
  if (gameState.valence <= 0) {
    gameState.ehp = 0;
    return { lostElectron, died: true };
  }
  return { lostElectron, died: false };
}

export function resetRun(): void {
  Object.assign(gameState, {
    valence: 1,
    maxValence: 1,
    ehp: 100,
    ehpMax: 100,
    freeElectrons: 0,
    maxFreeElectrons: 3,
    oxidationState: -1,
    temperature: 20,
    mode: 'oxidized',
    extraction: 0,
    extracting: false,
    samples: 0,
    kills: 0,
    dashCd: 0,
    shieldHp: 0,
    shieldTtl: 0,
    dyeBonus: 0,
    dyeColor: 0,
    bossActive: false,
    currentWeapon: 'platinum-knife',
    weaponSwitchCd: 0,
    roomIndex: 0,
    layer: 0,
    roomState: 'enter',
    currentRoomType: 'combat',
    doorChoices: [],
    chosenDoor: 0,
    finalBossActive: false,
    runComplete: false,
    equippedBoons: [],
    reactionLayers: 0,
    disabledBoons: [],
    dyeSlots: [{ dyeId: null, purity: 1 }, { dyeId: null, purity: 0.5 }, { dyeId: null, purity: 0.25 }],
    bagCapacity: BASE_BAG_CAPACITY,
    carriedGear: []
  });
}
