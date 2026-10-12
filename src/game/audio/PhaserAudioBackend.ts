/**
 * Phaser 音频后端 —— 实际播放、声部释放、手势解锁
 *
 * 职责边界：只做「怎么让 Phaser 发出声音并在结束时回报」，
 * 不含任何语义解析与预算策略（那两层在 AudioCatalog / VoiceAllocator）。
 *
 * 关键点：
 *   - **真实声部释放**：用 sound 的 complete/stop 事件回调，
 *     不再用「时间窗计数」冒充并发（SfxLimiter 的老问题）；
 *   - **手势解锁复用 Phaser 自己的 context**，不另造平行 AudioContext
 *     （GameScene 里现有实现是另取的 context，与 Phaser 的实际后端可能不一致）；
 *   - 后台/失焦时挂起，回到前台检查 suspended/interrupted。
 */

import Phaser from 'phaser';

export interface PlayRequest {
  /** Phaser 里已注册的 audio key */
  soundId: string;
  /** 0..1，已合成过分类/设置音量 */
  volume: number;
  /** 播放速率（含音高抖动） */
  rate: number;
  /** 预计时长（ms）：complete 未触发时的兜底释放 */
  durationMs: number;
  /** 声部句柄（分配器给的），结束时回报用 */
  voiceId: number;
}

/** 声部结束回报：voiceId + 结束原因（诊断/统计）。 */
export type VoiceEnd = { voiceId: number; reason: 'complete' | 'stop' | 'error' | 'timeout' };

export interface PhaserAudioBackendOptions {
  /** 兜底释放的超时倍数（相对预计时长） */
  timeoutMultiplier?: number;
}

export class PhaserAudioBackend {
  private readonly scene: Phaser.Scene;
  private readonly opts: Required<PhaserAudioBackendOptions>;
  private readonly timers = new Map<number, Phaser.Time.TimerEvent>();
  /** voiceId → sound，用于 stop 时精确释放 */
  private readonly playing = new Map<number, Phaser.Sound.BaseSound>();

  public constructor(scene: Phaser.Scene, options: PhaserAudioBackendOptions = {}) {
    this.scene = scene;
    this.opts = { timeoutMultiplier: options.timeoutMultiplier ?? 2.5, ...options };
  }

  /** 当前真实在播的声部数（诊断）。 */
  public get activeVoices(): number {
    return this.playing.size;
  }

  /** 是否已解锁（WebAudio context 处于 running）。 */
  public get unlocked(): boolean {
    const ctx = this.rawContext();
    return !!ctx && ctx.state === 'running';
  }

  /**
   * 在手势上下文里解锁音频。
   * 复用 Phaser 的 sound manager（它自己持有 context），不新建平行 context。
   */
  public unlock(): void {
    const mgr = this.scene.sound as unknown as {
      context?: AudioContext;
      unlock?: () => void;
    };
    try {
      mgr.unlock?.();
      const ctx = mgr.context;
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => { /* 手势外失败，等下次 */ });
    } catch { /* 音频不可用时静默 */ }
  }

  /** 后台挂起 / 前台恢复。返回是否需要在下次手势重新解锁。 */
  public setSuspended(suspended: boolean): void {
    try {
      if (suspended) this.scene.sound.pauseAll();
      else this.scene.sound.resumeAll();
    } catch { /* noop */ }
  }

  /**
   * 播放一条音效。
   * @returns voiceId；资产未注册/解码失败时返回 0（调用方走诊断，不静默）
   */
  public play(req: PlayRequest, onEnd: (end: VoiceEnd) => void): number {
    const mgr = this.scene.sound;
    // 资产未注册：明确失败，让调用方记录诊断。
    // 走 scene.cache.audio（HTML5 与 WebAudio 后端都往这里写），不用
    // sound manager 上分支不一的 exists()。
    if (!this.scene.cache.audio.exists(req.soundId)) {
      onEnd({ voiceId: req.voiceId, reason: 'error' });
      return 0;
    }
    let sound: Phaser.Sound.BaseSound;
    try {
      sound = mgr.add(req.soundId, { volume: req.volume, rate: req.rate });
    } catch {
      onEnd({ voiceId: req.voiceId, reason: 'error' });
      return 0;
    }
    this.playing.set(req.voiceId, sound);

    let settled = false;
    const settle = (reason: VoiceEnd['reason']): void => {
      if (settled) return;
      settled = true;
      this.playing.delete(req.voiceId);
      const timer = this.timers.get(req.voiceId);
      if (timer) {
        timer.remove();
        this.timers.delete(req.voiceId);
      }
      onEnd({ voiceId: req.voiceId, reason });
    };

    sound.once('complete', () => settle('complete'));
    sound.once('stop', () => settle('stop'));
    // 兜底：complete 在某些浏览器/中断场景不触发，按预计时长强制释放
    const timer = this.scene.time.delayedCall(
      Math.max(200, req.durationMs * this.opts.timeoutMultiplier),
      () => settle('timeout')
    );
    this.timers.set(req.voiceId, timer);

    try {
      sound.play();
    } catch {
      settle('error');
      return 0;
    }
    return req.voiceId;
  }

  /** 立即停止一个声部（抢占淡出由调用方先做，这里只负责停与释放）。 */
  public stop(voiceId: number): void {
    const sound = this.playing.get(voiceId);
    if (!sound) return;
    try {
      sound.stop();
    } catch { /* noop */ }
    // stop 事件会走到 settle；异常情况下兜底清理
    if (this.playing.has(voiceId)) {
      this.playing.delete(voiceId);
      const timer = this.timers.get(voiceId);
      if (timer) {
        timer.remove();
        this.timers.delete(voiceId);
      }
    }
  }

  /** 淡出到停止（抢占用，短淡出避免硬切爆音）。 */
  public fadeOutAndStop(voiceId: number, ms: number): void {
    const sound = this.playing.get(voiceId);
    if (!sound) return;
    try {
      this.scene.tweens.add({
        targets: sound,
        volume: 0,
        duration: Math.max(10, ms),
        onComplete: () => this.stop(voiceId)
      });
    } catch {
      this.stop(voiceId);
    }
  }

  /** 清空全部（场景关闭）。 */
  public destroy(): void {
    for (const id of [...this.playing.keys()]) this.stop(id);
    for (const timer of this.timers.values()) timer.remove();
    this.timers.clear();
    this.playing.clear();
  }

  private rawContext(): AudioContext | undefined {
    const mgr = this.scene.sound as unknown as { context?: AudioContext };
    return mgr.context;
  }
}

/** 估计一条音效的时长（ms）：优先读缓存里的时长，退化用配置估值。 */
export function estimateDurationMs(scene: Phaser.Scene, soundId: string, fallbackMs = 400): number {
  try {
    const cached = scene.cache.audio.get(soundId) as { duration?: number } | undefined;
    if (cached && typeof cached.duration === 'number' && cached.duration > 0) {
      return Math.round(cached.duration * 1000);
    }
  } catch { /* noop */ }
  return fallbackMs;
}