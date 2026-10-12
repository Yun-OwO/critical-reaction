/**
 * 音频总监 —— 游戏级音频服务（单一入口）
 *
 * 串联三层：AudioCatalog（语义→soundId）→ VoiceAllocator（预算与抢占）
 *           → PhaserAudioBackend（真实播放与声部释放）。
 *
 * 替代散落的三处入口：GameScene.playSfx / GameScene.playTone / Menu.uiSfx。
 *
 * 迁移策略（不一次性重写调用点）：
 *   阶段一（本次）：AudioDirector 落地并自测，GameScene.playSfx 与 Menu.uiSfx
 *                  改为转发到这里，语义 key 与旧拼音 key 都能解析；
 *   阶段二：逐批把调用点的旧 key 换成语义 key，删掉 LEGACY_SFX_ALIASES；
 *   阶段三：playTone 的裸 oscillator 也纳入统一混音。
 */

import Phaser from 'phaser';
import { resolveSfx } from './AudioCatalog';
import { VoiceAllocator, type VoiceRequest } from './VoiceAllocator';
import { PhaserAudioBackend, estimateDurationMs } from './PhaserAudioBackend';
import { getSettings } from '../state/SettingsState';

/** 播放请求：调用方只说语义。 */
export interface SfxPlayRequest {
  /** 语义 key（或迁移期的旧拼音 key） */
  event: string;
  /** 调用方的相对音量（在清单音量之上再乘） */
  volume?: number;
  /** 显式播放速率；缺省用清单的音高抖动 */
  rate?: number;
  /** 同一个判定的多次反馈共用一个 id，用于去重（命中+浮字+电子弹出只响一次） */
  dedupeId?: string;
  /** 世界坐标（预留：声像/距离衰减，本期先用本地/远近二值） */
  position?: { x: number; y: number };
  /** 本地玩家相关（受伤等不被距离衰减） */
  local?: boolean;
}

export interface AudioDiagnostics {
  /** 语义解析失败的事件（资产/声明缺失） */
  unresolved: Map<string, number>;
  /** 被预算拒绝的事件 */
  throttled: Map<string, number>;
  /** 真实活跃声部峰值 */
  peakVoices: number;
  /** 抢占总次数 */
  steals: number;
  /** 当前真实活跃声部数（用于验证声部是否被释放） */
  activeVoices: number;
}

export interface AudioDirectorOptions {
  scene: Phaser.Scene;
  /** 覆盖预算（测试/设备分档用） */
  maxVoices?: number;
  /** 诊断回调：解析失败时通知（每个 key 只报一次由调用方决定） */
  onUnresolved?: (event: string) => void;
}

export class AudioDirector {
  private readonly scene: Phaser.Scene;
  private readonly allocator: VoiceAllocator;
  private readonly backend: PhaserAudioBackend;
  private readonly onUnresolved?: (event: string) => void;
  private readonly unresolved = new Map<string, number>();
  private readonly throttled = new Map<string, number>();
  private peakVoices = 0;
  private steals = 0;

  /** 最近一次 dedupeId → 时间，抑制同一判定的重复反馈 */
  private recentDedupe = new Map<string, number>();
  private static readonly DEDUPE_MS = 90;

  public constructor(opts: AudioDirectorOptions) {
    this.scene = opts.scene;
    this.allocator = new VoiceAllocator({ maxVoices: opts.maxVoices });
    this.backend = new PhaserAudioBackend(opts.scene);
    this.onUnresolved = opts.onUnresolved;
  }

  /** 手势解锁（由真实 pointerdown/keydown 调用）。 */
  public unlock(): void {
    this.backend.unlock();
  }

  /** 后台/前台。 */
  public setSuspended(suspended: boolean): void {
    this.backend.setSuspended(suspended);
  }

  /**
   * 播放一条语义音效。
   * @returns 是否真正发出了声音（false = 被静音设置/解析失败/预算拒绝）
   */
  public play(req: SfxPlayRequest, now = this.scene.time.now): boolean {
    if (!getSettings().effectsEnabled) return false;
    if (this.isDeduped(req.dedupeId, now)) return false;

    const resolved = resolveSfx(req.event);
    if (!resolved) {
      const n = (this.unresolved.get(req.event) ?? 0) + 1;
      this.unresolved.set(req.event, n);
      this.onUnresolved?.(req.event);
      return false;
    }

    // 音量合成：设置主音量 × 调用方音量 × 清单音量
    const master = getSettings().volume / 100;
    const volume = Phaser.Math.Clamp(master * (req.volume ?? 1) * resolved.volume, 0, 1);
    // 速率：显式指定优先；否则用清单抖动（±rateJitter）
    const rate = req.rate ?? (resolved.rateJitter > 0 ? 1 + (Math.random() * 2 - 1) * resolved.rateJitter : 1);

    const durationMs = estimateDurationMs(this.scene, resolved.soundId);
    const voiceReq: VoiceRequest = {
      event: resolved.event,
      soundId: resolved.soundId,
      priority: resolved.priority,
      durationMs
    };

    const grant = this.allocator.acquire(voiceReq, now);
    if (!grant.ok) {
      const n = (this.throttled.get(resolved.event) ?? 0) + 1;
      this.throttled.set(resolved.event, n);
      return false;
    }
    if (grant.steal.length > 0) {
      this.steals += grant.steal.length;
      for (const victim of grant.steal) {
        // 抢占：短淡出后释放，不硬切（分配器已把额度让出）
        this.backend.fadeOutAndStop(victim.voiceId, 30);
      }
    }

    const voiceId = this.backend.play(
      { soundId: resolved.soundId, volume, rate, durationMs, voiceId: grant.voiceId },
      (end) => {
        // 真实声部释放：complete / stop / 兜底超时都会走到这里
        this.allocator.release(end.voiceId);
      }
    );
    if (voiceId === 0) {
      // 后端播放失败（资产未解码等）：把分配器占的额度还回去
      this.allocator.release(grant.voiceId);
      return false;
    }
    this.peakVoices = Math.max(this.peakVoices, this.backend.activeVoices);
    return true;
  }

  /** 诊断快照（测试/调试面板用）。 */
  public diagnostics(): AudioDiagnostics {
    return {
      unresolved: new Map(this.unresolved),
      throttled: new Map(this.throttled),
      peakVoices: this.peakVoices,
      steals: this.steals,
      /** 当前真实活跃声部数（区别于历史峰值 peakVoices） */
      activeVoices: this.backend.activeVoices
    };
  }

  /** 清空诊断计数。 */
  public resetDiagnostics(): void {
    this.unresolved.clear();
    this.throttled.clear();
    this.peakVoices = 0;
    this.steals = 0;
  }

  /** 场景关闭：停掉全部声部并清空调度状态。 */
  public destroy(): void {
    this.backend.destroy();
    this.allocator.reset();
    this.recentDedupe.clear();
  }

  private isDeduped(dedupeId: string | undefined, now: number): boolean {
    if (!dedupeId) return false;
    const last = this.recentDedupe.get(dedupeId);
    if (last !== undefined && now - last < AudioDirector.DEDUPE_MS) return true;
    this.recentDedupe.set(dedupeId, now);
    // 防增长
    if (this.recentDedupe.size > 256) {
      for (const [k, t] of this.recentDedupe) {
        if (now - t >= AudioDirector.DEDUPE_MS) this.recentDedupe.delete(k);
      }
    }
    return false;
  }
}