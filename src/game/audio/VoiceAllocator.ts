/**
 * 声部分配器 —— 真实活跃声部、优先级与抢占
 *
 * 替换 SfxLimiter 的两个缺陷：
 *   ① `maxVoices` 实际是「时间窗内播放次数」，不是真实同时活跃的声部数。
 *      音效还没播完就早已计入淘汰，长尾音可以轻易越过预算；
 *   ② 所有音共用一个全局 45ms 否决门，拾取/UI 被一次挥砍全挡住。
 *
 * 这里按「声音真正结束/被停止」释放额度，并引入优先级抢占：
 * 关键危险（受伤/熔毁）在预算耗尽时仍能启动，挤掉最低优先级的装饰音。
 *
 * 纯逻辑、可单测；不持有 Phaser 对象。
 */

/** 播放意图：分配器的输入。 */
export interface VoiceRequest {
  /** 语义 key（同一语义的多个变体共享额度口径） */
  event: string;
  /** 实际 soundId（变体之间分别计重叠） */
  soundId: string;
  /** 分类优先级，越大越重要 */
  priority: number;
  /** 期望时长（ms）：短音可按估值预占，真实结束时精确释放 */
  durationMs: number;
}

export interface VoiceAllocatorOptions {
  /** 真实同时活跃的声部上限 */
  maxVoices?: number;
  /** 同一 soundId 的同时重叠上限 */
  maxOverlapPerSound?: number;
  /** 同一语义 key 的最小间隔（ms） */
  perEventCooldownMs?: number;
  /** 最低优先级之间的抢占缓冲：低于该值不允许发起新音 */
  stealFloorPriority?: number;
  /** 抢占时的淡出时长（ms） */
  stealFadeMs?: number;
}

const DEFAULTS = {
  // 计划 §5.5 初始值：移动端 8 / 桌面 12，这里取中间值，运行时按设备再分档
  maxVoices: 10,
  maxOverlapPerSound: 2,
  perEventCooldownMs: 60,
  stealFloorPriority: 30,
  stealFadeMs: 30
};

/** 一条活跃声部的记录。 */
interface ActiveVoice {
  event: string;
  soundId: string;
  priority: number;
  /** 优先级相同时的插入序号，保证抢占顺序稳定 */
  seq: number;
}

/** 发起一次播放的结果。 */
export interface VoiceGrant {
  ok: boolean;
  /** 分配成功时返回本次占用的句柄 */
  voiceId: number;
  /** 因抢占而需要淡出的声部（带 voiceId，调用方据此淡出并释放） */
  steal: StolenVoice[];
  /** 被拒绝的原因（诊断用） */
  reason?: 'overlap' | 'event-cooldown' | 'voice-cap' | 'steal-disabled';
}

/** 被抢占的声部：带 voiceId，调用方直接淡出释放。 */
export interface StolenVoice {
  voiceId: number;
  event: string;
  soundId: string;
  priority: number;
}

export class VoiceAllocator {
  private readonly opts: Required<VoiceAllocatorOptions>;
  private active = new Map<number, ActiveVoice>();
  private nextVoiceId = 1;
  private seq = 0;
  /** event → 最近一次开始时间 */
  private lastStart = new Map<string, number>();

  public constructor(options: VoiceAllocatorOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** 当前活跃声部数（诊断/测试）。 */
  public get activeVoices(): number {
    return this.active.size;
  }

  /**
   * 申请一个声部。
   *
   * @param now 当前时间（ms），由调用方注入以便测试
   */
  public acquire(req: VoiceRequest, now: number): VoiceGrant {
    const { maxVoices, maxOverlapPerSound, perEventCooldownMs, stealFloorPriority } = this.opts;

    // 同一 soundId 重叠上限（群战里同波形堆叠成噪声）
    let sameSound = 0;
    for (const v of this.active.values()) if (v.soundId === req.soundId) sameSound += 1;
    if (sameSound >= maxOverlapPerSound) {
      return { ok: false, voiceId: 0, steal: [], reason: 'overlap' };
    }

    // 同一语义的最小间隔（挥砍/命中分别配置）
    const last = this.lastStart.get(req.event);
    if (last !== undefined && now - last < perEventCooldownMs) {
      return { ok: false, voiceId: 0, steal: [], reason: 'event-cooldown' };
    }

    if (this.active.size < maxVoices) {
      const voiceId = this.start(req);
      this.lastStart.set(req.event, now);
      return { ok: true, voiceId, steal: [] };
    }

    // 预算耗尽：高优先级音可以抢占最低优先级的装饰音
    if (req.priority < stealFloorPriority) {
      return { ok: false, voiceId: 0, steal: [], reason: 'steal-disabled' };
    }
    const victims = this.pickVictims(req.priority);
    if (victims.length === 0) {
      return { ok: false, voiceId: 0, steal: [], reason: 'voice-cap' };
    }
    for (const v of victims) this.active.delete(v.voiceId);
    const voiceId = this.start(req);
    this.lastStart.set(req.event, now);
    return { ok: true, voiceId, steal: victims };
  }

  /** 释放一个声部（声音自然结束、被停止、被抢占淡出完毕时调用）。 */
  public release(voiceId: number): void {
    this.active.delete(voiceId);
  }

  /** 清空（场景关闭/重启）。 */
  public reset(): void {
    this.active.clear();
    this.lastStart.clear();
  }

  private start(req: VoiceRequest): number {
    const voiceId = this.nextVoiceId++;
    this.seq += 1;
    this.active.set(voiceId, {
      event: req.event,
      soundId: req.soundId,
      priority: req.priority,
      seq: this.seq
    });
    return voiceId;
  }

  /** 选出可被本请求挤掉的声部：优先级严格更低者中优先级最低（并列取最早）。 */
  private pickVictims(priority: number): StolenVoice[] {
    const candidates: { id: number; v: ActiveVoice }[] = [];
    for (const [id, v] of this.active) {
      if (v.priority < priority) candidates.push({ id, v });
    }
    candidates.sort((a, b) => a.v.priority - b.v.priority || a.v.seq - b.v.seq);
    // 一次只抢一个，避免一次点击清空整片装饰音造成听觉断层
    return candidates.slice(0, 1).map(({ id, v }) => ({
      voiceId: id,
      event: v.event,
      soundId: v.soundId,
      priority: v.priority
    }));
  }
}
