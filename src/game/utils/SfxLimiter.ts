/**
 * 音效节流器（借鉴卫戍协议 audio.js 的 SfxLimiter 四重闸）：
 * - 总并发上限（maxVoices 窗口内总播放数）
 * - 单音源冷却（同一 key 两次播放最小间隔）
 * - 全局最小间隔（任意两声响之间）
 * - 单 key 叠音上限（同一音效窗口内最多同时几条）
 *
 * 纯时间窗实现（不跟踪真实音频结束），调用方在 playSfx 入口处
 * `if (!limiter.tryPlay(key, now)) return;` 即可。never throws。
 */
export interface SfxLimiterOptions {
  /** 窗口内总播放上限 */
  maxVoices?: number;
  /** 同一音源两次播放的最小间隔 ms */
  perSourceCooldownMs?: number;
  /** 全局任意两声响的最小间隔 ms */
  minGapMs?: number;
  /** 同一音源在窗口内的叠音上限 */
  maxOverlapPerKey?: number;
  /** 统计窗口 ms（超过即从计数中淘汰） */
  windowMs?: number;
}

const DEFAULTS = {
  maxVoices: 8,
  perSourceCooldownMs: 160,
  minGapMs: 45,
  maxOverlapPerKey: 2,
  windowMs: 1000
};

export class SfxLimiter {
  private readonly opts: Required<SfxLimiterOptions>;
  /** key → 最近播放时间戳列表（窗口内） */
  private recent = new Map<string, number[]>();
  private lastAnyPlay = -Infinity;

  public constructor(options: SfxLimiterOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** 尝试占一个播放名额：true=允许播放，false=被节流。 */
  public tryPlay(key: string, now: number): boolean {
    try {
      const { maxVoices, perSourceCooldownMs, minGapMs, maxOverlapPerKey, windowMs } = this.opts;
      if (now - this.lastAnyPlay < minGapMs) return false;
      let list = this.recent.get(key);
      if (list) {
        list = list.filter((t) => now - t < windowMs);
      } else {
        list = [];
      }
      // 全窗口总量
      let total = 0;
      for (const times of this.recent.values()) {
        for (const t of times) if (now - t < windowMs) total += 1;
      }
      if (total >= maxVoices) {
        this.recent.set(key, list);
        return false;
      }
      if (list.length >= maxOverlapPerKey) {
        this.recent.set(key, list);
        return false;
      }
      const lastOfKey = list.length > 0 ? list[list.length - 1] : -Infinity;
      if (now - lastOfKey < perSourceCooldownMs) {
        this.recent.set(key, list);
        return false;
      }
      list.push(now);
      this.recent.set(key, list);
      this.lastAnyPlay = now;
      // 防泄漏：条目过多时整体清理过期项
      if (this.recent.size > 200) {
        for (const [k, times] of this.recent) {
          const alive = times.filter((t) => now - t < windowMs);
          if (alive.length === 0) this.recent.delete(k);
          else this.recent.set(k, alive);
        }
      }
      return true;
    } catch {
      return true; // 节流器自身异常不阻断音效
    }
  }

  /** 清空状态（场景切换时调用）。 */
  public reset(): void {
    this.recent.clear();
    this.lastAnyPlay = -Infinity;
  }
}
