/**
 * 表现事件契约（全局升级执行规格 T02 / §I.1）
 *
 * 解决的问题：表现目前直接写在 `GameScene` 的战斗代码里（`spinSlash()` 里
 * 直接 add 火花、`updateBoss()` 里直接画圈），导致三个后果：
 *   1. 画质/静音/特效开关无法统一治理——每处各写各的；
 *   2. 换房/重开时过期特效与危险回调可能残留；
 *   3. 表现随机消耗战斗 `this.rng`（见 T01 记录 §2.3），
 *      开关特效会改变后续战斗随机序列。
 *
 * 契约要点（规格 §I.1）：
 *   - `world` 用 `SurfacePoint`（x / z / height 语义明确），不用「屏幕 x/y +
 *     一个含糊的 depth」；
 *   - `startTime` 来自**权威模拟时钟**并带 run/room 标识，暂停冻结危险 phase、
 *     表现时钟继续；
 *   - `phase` 区分 start/active/hit/recover/end/cancel，不能所有命中复用 start。
 *
 * 本模块是纯类型 + 纯函数，不引用 Phaser，可单测。
 */

import type { SurfacePoint } from './viewSpace';

/** 表现事件的 phase。`hit` 与 `active` 分开是刻意的：命中反馈必须由真实判定触发。 */
export type VisualPhase = 'start' | 'active' | 'hit' | 'recover' | 'end' | 'cancel';

/**
 * 表现事件种类。命名遵循 `Vfx_<来源>_<事件>_<段位>` 的思路，
 * 但保持 `域.名` 的点分层级，便于按域过滤与统计。
 */
export type VisualKind =
  // 玩家
  | 'player.melee.basic'
  | 'player.cannon.basic'
  | 'player.charge.loop'
  | 'player.melee.special'
  | 'player.cannon.special'
  | 'player.dash'
  | 'player.mode.change'
  | 'player.hurt'
  // Boss 通用
  | 'boss.slam'
  | 'boss.aoe'
  | 'boss.shot'
  | 'boss.phase'
  | 'boss.defeat'
  // Boss 专属
  | 'boss.titration.acid'
  | 'boss.electrolysis.beam'
  | 'boss.chain.bomb'
  | 'boss.oxidation.smoke'
  // 世界 / UI 反馈
  | 'world.enemy.death'
  | 'world.electron.transfer'
  | 'world.pickup'
  | 'world.hazard';

/** 演出档（规格 §D2）。范围大不等于核心不透明，档位只约束**装饰**层。 */
export type VisualTier = 'G0' | 'G1' | 'G2' | 'G3';

/** 事件重要性：预算紧张时的优先级（与音频优先级同构，信息价值优先）。 */
export type VisualImportance = 'critical' | 'important' | 'normal' | 'cosmetic';

export interface VisualEvent {
  /** 同一次判定的去重标识。同一 eventId 重复投递只生效一次。 */
  eventId: string;
  /** 事件来源实体（玩家 id / 敌人 id / boss id / 房间 id），用于取消与归属。 */
  entityId: string;
  /** 局标识。换局后旧事件不再消费。 */
  runId: string;
  /** 房间标识。换房时该房间的事件被批量 cancel。 */
  roomId: string;
  kind: VisualKind;
  phase: VisualPhase;
  /** 世界坐标（x / z / height），不是屏幕坐标。 */
  world: SurfacePoint;
  /** 屏幕方向（弧度），用于朝向性特效；无方向时为 0。 */
  direction: number;
  /** 玩家当前反应态（影响配色与趋势）。 */
  mode: 'oxidized' | 'reduced';
  /** 0..1，事件强度（伤害占比、蓄力进度等）。 */
  intensity: number;
  /** 权威模拟时钟（秒），不是 performance.now()。 */
  startTime: number;
  /** 事件预计持续（秒）。 */
  duration: number;
  tier: VisualTier;
  importance: VisualImportance;
  /** 附加数据（命中点数、层数等），避免为每种事件扩张类型。 */
  data?: Record<string, number | string | boolean>;
}

/** 每个事件种类的默认档位与重要性。避免调用点各写一套。 */
const KIND_DEFAULTS: Record<VisualKind, { tier: VisualTier; importance: VisualImportance }> = {
  'player.melee.basic': { tier: 'G0', importance: 'normal' },
  'player.cannon.basic': { tier: 'G0', importance: 'normal' },
  'player.charge.loop': { tier: 'G0', importance: 'cosmetic' },
  'player.melee.special': { tier: 'G2', importance: 'important' },
  'player.cannon.special': { tier: 'G2', importance: 'important' },
  'player.dash': { tier: 'G1', importance: 'important' },
  'player.mode.change': { tier: 'G1', importance: 'normal' },
  'player.hurt': { tier: 'G1', importance: 'critical' },
  'boss.slam': { tier: 'G3', importance: 'important' },
  'boss.aoe': { tier: 'G3', importance: 'important' },
  'boss.shot': { tier: 'G0', importance: 'normal' },
  'boss.phase': { tier: 'G3', importance: 'critical' },
  'boss.defeat': { tier: 'G3', importance: 'important' },
  'boss.titration.acid': { tier: 'G1', importance: 'normal' },
  'boss.electrolysis.beam': { tier: 'G3', importance: 'important' },
  'boss.chain.bomb': { tier: 'G1', importance: 'normal' },
  'boss.oxidation.smoke': { tier: 'G1', importance: 'normal' },
  'world.enemy.death': { tier: 'G1', importance: 'normal' },
  'world.electron.transfer': { tier: 'G0', importance: 'normal' },
  'world.pickup': { tier: 'G0', importance: 'normal' },
  'world.hazard': { tier: 'G1', importance: 'important' }
};

export function defaultTierFor(kind: VisualKind): VisualTier {
  return KIND_DEFAULTS[kind].tier;
}

export function defaultImportanceFor(kind: VisualKind): VisualImportance {
  return KIND_DEFAULTS[kind].importance;
}

/** 预算收紧时的牺牲顺序：数字越大越先被砍。 */
export function sacrificeOrder(importance: VisualImportance): number {
  return { cosmetic: 0, normal: 1, important: 2, critical: 3 }[importance];
}

export type VisualEventDraft = Omit<VisualEvent, 'tier' | 'importance'> & {
  tier?: VisualTier;
  importance?: VisualImportance;
};

/** 补齐默认值构造事件。调用点只需给必需字段。 */
export function makeVisualEvent(draft: VisualEventDraft): VisualEvent {
  const tier = draft.tier ?? defaultTierFor(draft.kind);
  const importance = draft.importance ?? defaultImportanceFor(draft.kind);
  return { ...draft, tier, importance };
}

/**
 * 事件收口：去重、按房间/局取消、过期丢弃。
 *
 * 这是规格 §D3 第 9 条（换房/死亡不补播过期攻击）与 §I.1 生命周期要求的实现。
 */
export class VisualEventGate {
  private readonly seen = new Set<string>();
  /** 限制 seen 集合增长，避免长局内存缓慢上升。 */
  private seenOrder: string[] = [];

  public constructor(private readonly maxSeen = 512) {}

  /** 同一 eventId 只接受一次。重复投递返回 false。 */
  public accept(e: VisualEvent): boolean {
    if (this.seen.has(e.eventId)) return false;
    this.seen.add(e.eventId);
    this.seenOrder.push(e.eventId);
    if (this.seenOrder.length > this.maxSeen) {
      const drop = this.seenOrder.shift();
      if (drop !== undefined) this.seen.delete(drop);
    }
    return true;
  }

  /** 换房：取消该房间所有未结束事件。 */
  public cancelRoom(roomId: string, active: VisualEvent[]): VisualEvent[] {
    return active.filter((e) => e.roomId !== roomId);
  }

  /** 换局/重开：清空全部。 */
  public reset(): void {
    this.seen.clear();
    this.seenOrder = [];
  }

  public get size(): number {
    return this.seen.size;
  }
}

/**
 * 时钟分离（规格 §I.1）。
 *
 * `SimClock` 随暂停/定格停止推进；`PresentationClock` 始终推进。
 * 危险几何（危区边、弹道芯）必须用 simTime；DOM 动效与纯余韵用 presentation。
 */
export class DualClock {
  private simTime = 0;
  private presentationTime = 0;
  private frozen = false;

  /** 推进一帧。`dt` 为真实帧间隔（秒）。 */
  public advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.presentationTime += dt;
    if (!this.frozen) this.simTime += dt;
  }

  /** 暂停 / hit-stop：冻结模拟时钟，表现时钟继续。 */
  public freeze(): void {
    this.frozen = true;
  }

  public resume(): void {
    this.frozen = false;
  }

  /** 条件冻结/解冻（供主循环每帧调用，避免忘记配对 resume）。 */
  public freezeIf(shouldFreeze: boolean): void {
    this.frozen = shouldFreeze;
  }

  public get sim(): number {
    return this.simTime;
  }

  public get presentation(): number {
    return this.presentationTime;
  }

  public get isFrozen(): boolean {
    return this.frozen;
  }

  /** 换房/重开时把两个时钟一起归零，避免跨局出现负时长。 */
  public reset(): void {
    this.simTime = 0;
    this.presentationTime = 0;
    this.frozen = false;
  }
}

/**
 * 表现随机源（规格 §D「表现 RNG 与战斗 RNG 分离」）。
 *
 * 这是 T01 记录的污染修复的落点：把纯表现随机从战斗 `RunRng` 里摘出来。
 * 表现 RNG 用独立种子，因此画质档/静音/VFX 开关变化**不会**改变战斗随机序列。
 */
export class FxRng {
  private state: number;

  public constructor(seed: number) {
    // 避免 0 状态（mulberry32 在 state=0 时恒为 0）
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0,1) */
  public float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max) 浮点。 */
  public real(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** [min,max] 整数。 */
  public between(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.float() * (max - min + 1));
  }

  public chance(p: number): boolean {
    return this.float() < p;
  }

  public reseed(seed: number): void {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
}