/**
 * 帧时间采样与统计（T00 / 规格 §F1、§F3）
 *
 * 为什么不能只看 FPS：
 *   - 平均 60 FPS 不能证明没有低帧；
 *   - JS 提交耗时不能证明 GPU/合成呈现没掉帧；
 *   - 只留平均会把坏帧洗掉。
 * 所以这里同时给出分位数、low%、卡顿计数与「项目可归因」分类。
 *
 * 诚实边界：
 *   - 本模块只测**能直接观测到**的量（rAF 间隔、CPU 段耗时）。
 *   - GPU 耗时**不伪造**：拿不到计时扩展时 `gpuMs` 为 null，调用方必须按
 *     「证据缺项」处理，不得用 0 或 CPU 值替代。
 *   - hit-stop 等**设计内的定格**会真实占用帧时间，统计时单独标注，
 *     但绝不能因此删除这些样本（规格 §F1）。
 */

/** 单帧样本。 */
export interface FrameSample {
  /** rAF 间隔（毫秒） */
  frameMs: number;
  /** update + render 提交耗时（毫秒），拿不到时为 null */
  cpuMs: number | null;
  /** 是否处于设计内的命中定格 */
  hitStop: boolean;
  /** 是否处于后台/非交互区间（这类样本不计入验收） */
  inactive: boolean;
}

/** 统计结果。分位数单位毫秒。 */
export interface FrameStats {
  count: number;
  /** 帧间隔均值 */
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  maxMs: number;
  /** 1% low（最慢 1% 帧间隔的均值取倒数） */
  low1: number;
  /** 0.1% low */
  low01: number;
  /** 平均 FPS（由平均帧间隔导出，不用帧数/时间混算） */
  fps: number;
  /** 超过一帧预算（> missedVsyncMs）的帧数 */
  missedVsync: number;
  /** 超过卡顿线（> hitchMs）的帧数 */
  hitches: number;
  /** 其中处于命中定格的帧数（设计内，需单独看） */
  hitStopFrames: number;
  /** 排除非交互区间后的有效样本数 */
  activeCount: number;
  /** GPU 耗时（毫秒）；无计时扩展时为 null */
  gpuMs: number | null;
}

/** 分位数（线性插值，输入需已排序）。 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * low% 定义：取最慢 k 比例帧的**均值**再取倒数。
 * 注意不能用「某个分位数取倒数」冒充——两者结果不同。
 */
export function computeLow(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const take = Math.max(1, Math.round(sorted.length * fraction));
  const worst = sorted.slice(sorted.length - take);
  const mean = worst.reduce((a, b) => a + b, 0) / worst.length;
  return mean > 0 ? 1000 / mean : 0;
}

export interface StatsOptions {
  /** 超过此值算错过一次刷新 */
  missedVsyncMs: number;
  /** 超过此值算卡顿 */
  hitchMs: number;
}

/** CPU 段耗时（update + render 提交）的统计。 */
export interface CpuStats {
  count: number;
  avgMs: number;
  p95: number;
  p99: number;
  maxMs: number;
}

/** CPU 耗时统计；没有样本时返回 null（不伪造）。 */
export function computeCpuStats(samples: readonly FrameSample[]): CpuStats | null {
  const cpu = samples
    .filter((s) => !s.inactive && s.cpuMs !== null)
    .map((s) => s.cpuMs as number)
    .sort((a, b) => a - b);
  if (cpu.length === 0) return null;
  const sum = cpu.reduce((a, b) => a + b, 0);
  return {
    count: cpu.length,
    avgMs: sum / cpu.length,
    p95: percentile(cpu, 0.95),
    p99: percentile(cpu, 0.99),
    maxMs: cpu[cpu.length - 1]
  };
}

/**
 * 统计一批样本。`inactive` 样本（后台/切换显示模式）不计入验收统计，
 * 但 `hitStop` 样本**计入**——它们是真的占用了帧时间。
 */
export function computeStats(samples: readonly FrameSample[], opts: StatsOptions): FrameStats {
  const active = samples.filter((s) => !s.inactive);
  const frames = active.map((s) => s.frameMs).sort((a, b) => a - b);
  const cpu = active.map((s) => s.cpuMs).filter((v): v is number => v !== null);

  if (frames.length === 0) {
    return {
      count: 0, avgMs: 0, p50: 0, p95: 0, p99: 0, p999: 0, maxMs: 0,
      low1: 0, low01: 0, fps: 0, missedVsync: 0, hitches: 0,
      hitStopFrames: 0, activeCount: 0, gpuMs: null
    };
  }

  const sum = frames.reduce((a, b) => a + b, 0);
  const avg = sum / frames.length;
  // GPU 耗时不在这里推断：拿不到计时扩展就是 null，由调用方标注证据缺项

  return {
    count: samples.length,
    avgMs: avg,
    p50: percentile(frames, 0.5),
    p95: percentile(frames, 0.95),
    p99: percentile(frames, 0.99),
    p999: percentile(frames, 0.999),
    maxMs: frames[frames.length - 1],
    low1: computeLow(frames, 0.01),
    low01: computeLow(frames, 0.001),
    fps: avg > 0 ? 1000 / avg : 0,
    missedVsync: frames.filter((f) => f > opts.missedVsyncMs).length,
    hitches: frames.filter((f) => f > opts.hitchMs).length,
    hitStopFrames: active.filter((s) => s.hitStop).length,
    activeCount: active.length,
    gpuMs: null
  };
}

/**
 * 滚动采样窗口。
 *
 * 用固定容量环形数组，热路径零分配。
 */
export class FrameRecorder {
  private readonly buf: FrameSample[];
  private head = 0;
  private filled = 0;
  private lastTs = 0;

  public constructor(private readonly capacity = 4096) {
    this.buf = new Array<FrameSample>(capacity);
  }

  /** 每帧调用一次，传入 rAF 时间戳（毫秒）与 CPU 段耗时。 */
  public push(
    ts: number,
    cpuMs: number | null,
    hitStop: boolean,
    inactive: boolean
  ): void {
    if (this.lastTs > 0) {
      const frameMs = ts - this.lastTs;
      // 首帧/切场景的大间隔不计入（会误判为卡顿）
      if (frameMs > 0 && frameMs < 1000) {
        this.buf[this.head] = { frameMs, cpuMs, hitStop, inactive };
        this.head = (this.head + 1) % this.capacity;
        this.filled = Math.min(this.filled + 1, this.capacity);
      }
    }
    this.lastTs = ts;
  }

  public get size(): number {
    return this.filled;
  }

  /** 按时间顺序导出样本。 */
  public samples(): FrameSample[] {
    const out: FrameSample[] = [];
    const start = this.filled < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.filled; i += 1) {
      out.push(this.buf[(start + i) % this.capacity]);
    }
    return out;
  }

  public stats(opts: StatsOptions, gpuMs: number | null = null): FrameStats {
    const s = computeStats(this.samples(), opts);
    // GPU 耗时只能来自真实计时扩展；没有就是 null，不猜
    return { ...s, gpuMs };
  }

  public reset(): void {
    this.head = 0;
    this.filled = 0;
    this.lastTs = 0;
  }
}

/**
 * 自动调节控制器（规格 §F3）。
 *
 * 与旧 `utils/Quality.ts` 的区别：旧实现「平均 FPS < 40 才收紧」，
 * 那是把已经掉帧当成可接受状态。这里按**成本线**判断，目标始终是稳 60。
 */
export class FrameBudgetController {
  private accMs = 0;
  private frames = 0;
  private bad = 0;
  private good = 0;
  private intensity = 0;

  public constructor(
    private readonly opts: {
      windowMs: number;
      tightenWindows: number;
      recoverWindows: number;
      overMs: number;
      underMs: number;
      step: number;
    }
  ) {}

  /**
   * 返回是否需要收紧/恢复。
   *
   * 判定粒度是「窗口」而不是单帧：单帧毛刺不该触发降档，
   * 但连续超线必须马上收紧 —— 所以 tightenWindows 很小、recoverWindows 很大。
   */
  public sample(costMs: number): 'tighten' | 'recover' | 'hold' {
    if (!Number.isFinite(costMs) || costMs <= 0) return 'hold';

    this.accMs += costMs;
    this.frames += 1;
    // 未攒满一窗就继续观察
    if (this.accMs < this.opts.windowMs) return 'hold';

    const avg = this.accMs / this.frames;
    this.accMs = 0;
    this.frames = 0;

    if (avg > this.opts.overMs) {
      this.bad += 1;
      this.good = 0;
    } else if (avg < this.opts.underMs) {
      this.good += 1;
      this.bad = 0;
    } else {
      // 处在成本线之间：既不收紧也不恢复，保持现状（迟滞带）
      this.bad = 0;
      this.good = 0;
    }

    if (this.bad >= this.opts.tightenWindows && this.intensity < 1) {
      this.bad = 0;
      this.intensity = Math.min(1, this.intensity + this.opts.step);
      return 'tighten';
    }
    if (this.good >= this.opts.recoverWindows && this.intensity > 0) {
      this.good = 0;
      this.intensity = Math.max(0, this.intensity - this.opts.step);
      return 'recover';
    }
    return 'hold';
  }

  /** 当前收紧强度 0..1，交给 computeAllowance 换算成装饰额度。 */
  public get load(): number {
    return this.intensity;
  }

  public reset(): void {
    this.bad = 0;
    this.good = 0;
    this.intensity = 0;
    this.frames = 0;
    this.accMs = 0;
  }
}