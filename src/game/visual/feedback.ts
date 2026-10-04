/**
 * 手感与反馈分层（Game Feel / Juice）
 *
 * 设计依据（见《开发参考与最佳实践》扩展条目）：
 *   - 命中定格 40–80ms（Dead Cells / Nuclear Throne 标定区间）
 *   - 输入缓冲 80–150ms（Celeste / 格斗游戏标准），让"早一点点按"也生效
 *   - 屏震采用层级制而非"越响越好"：若每个事件都满强度重触发，反馈会互相淹没
 *   - 挤压拉伸取自迪士尼动画十二原则的 squash & stretch
 *
 * 本模块不依赖 Phaser，纯数据与纯函数，便于单测。
 */

/** 反馈等级：等级越高，反馈越强。routine 事件必须保持克制，否则重击不再有对比。 */
export type FeedbackTier =
  | 'light'
  | 'normal'
  | 'elite'
  | 'kill'
  | 'bossHit'
  | 'playerHurt'
  | 'meltdown';

export interface FeedbackSpec {
  /** 命中定格（秒） */
  hitStop: number;
  /** 屏震时长（秒，调用侧会再按既有约定换算） */
  shakeDuration: number;
  /**
   * 屏震强度。单位与 GameScene.cameraShake 的 intensity 参数一致
   * （内部再乘 4 转成 Phaser 的视口比例），因此这里的数量级必须与既有调用点对齐：
   * 普通命中约 1e-3，玩家受伤约 6e-3。
   */
  shakeIntensity: number;
  /** 镜头缩放冲击倍数（1 = 不缩放） */
  zoomFactor: number;
  /** 缩放冲击时长（毫秒） */
  zoomDuration: number;
}

/**
 * 反馈分级表（所有数值已按既有手感标定）。
 *
 * 关键约束是**层级**：普通命中必须比击杀安静得多，否则每个事件都拉满，
 * 玩家的神经系统会停止读取任何反馈（常见的"过度 juice"失败模式）。
 * 调整手感只改这张表，避免数值散落到各个调用点。
 */
export const FEEDBACK: Record<FeedbackTier, FeedbackSpec> = {
  // 极轻命中：只有定格，完全不晃屏
  light: { hitStop: 0.026, shakeDuration: 0, shakeIntensity: 0, zoomFactor: 1, zoomDuration: 0 },
  // 普通命中：比旧实现（0.0015）更克制，连打时是"节奏"而不是"噪音"
  normal: { hitStop: 0.038, shakeDuration: 60, shakeIntensity: 0.0009, zoomFactor: 1, zoomDuration: 0 },
  // 精英怪命中
  elite: { hitStop: 0.07, shakeDuration: 130, shakeIntensity: 0.0042, zoomFactor: 1.018, zoomDuration: 160 },
  // 击杀：定格略长 + 缩放冲击（"我确实干掉了它"）
  kill: { hitStop: 0.056, shakeDuration: 110, shakeIntensity: 0.0032, zoomFactor: 1.014, zoomDuration: 140 },
  // Boss 受击
  bossHit: { hitStop: 0.068, shakeDuration: 150, shakeIntensity: 0.0052, zoomFactor: 1.02, zoomDuration: 180 },
  // 玩家受伤：常规反馈里最强的一档，但屏震幅度必须收敛——受伤很频繁，
  // 幅度过大时画面几乎无法辨认，玩家反而读不出"我被打了"这个信息
  playerHurt: { hitStop: 0.092, shakeDuration: 220, shakeIntensity: 0.0062, zoomFactor: 1.028, zoomDuration: 220 },
  // 熔毁 / 终局事件
  meltdown: { hitStop: 0.11, shakeDuration: 300, shakeIntensity: 0.01, zoomFactor: 1.045, zoomDuration: 300 }
};

/** 输入缓冲窗口（秒）：按下的攻击/冲刺在此窗口内一旦可用就立即执行。 */
export const ATTACK_BUFFER_SEC = 0.12;
export const DASH_BUFFER_SEC = 0.14;

/**
 * 屏震治理器。
 *
 * 解决的问题：原实现每次调用都以 force=true 重触发相机震动，
 * 于是连续小命中会不断把大爆炸的震感"洗掉"，表现为又吵又无力。
 * 治理规则：更强或已结束的冲击可以覆盖；更弱的冲击不打断正在进行的强震，只小幅续期。
 */
export class ShakeGovernor {
  private remaining = 0;
  private magnitude = 0;

  /** 请求一次屏震；返回 null 表示本次不重新触发（应沿用在进行的强震）。 */
  public request(duration: number, magnitude: number): { duration: number; magnitude: number } | null {
    if (magnitude <= 0 || duration <= 0) return null;
    if (magnitude >= this.magnitude || this.remaining <= 0) {
      this.magnitude = magnitude;
      this.remaining = duration;
      return { duration, magnitude };
    }
    // 弱冲击：只延长一点，不重置强度
    this.remaining = Math.max(this.remaining, duration * 0.5);
    return null;
  }

  /** 每帧推进（dt 秒）。 */
  public tick(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.magnitude = 0;
    }
  }

  /** 当前生效的屏震强度（0 表示无震动）。 */
  public get currentMagnitude(): number {
    return this.remaining > 0 ? this.magnitude : 0;
  }
}

/**
 * 挤压拉伸曲线：elapsed ∈ [0,total] 时返回缩放系数。
 * t=0 与 t=total 均回到 1，中间达到最大形变 —— 用于攻击、冲刺、受击的"重量感"。
 */
export function squashCurve(elapsed: number, total: number, strength = 0.12): { x: number; y: number } {
  if (total <= 0) return { x: 1, y: 1 };
  const t = Math.max(0, Math.min(1, elapsed / total));
  const amount = Math.sin(Math.PI * t) * strength;
  return { x: 1 + amount, y: 1 - amount };
}

/** 拉伸（冲刺方向上的拉长）：与挤压相反，用于冲刺与投射物。 */
export function stretchCurve(elapsed: number, total: number, strength = 0.14): { x: number; y: number } {
  const squash = squashCurve(elapsed, total, strength);
  return { x: squash.y, y: squash.x };
}

/**
 * 音高抖动：连续同一种命中音会显得机械，加入 ±spread 的随机音高更接近商业动作游戏。
 * rng 可注入以保证单测确定性。
 */
export function pitchJitter(base: number, rng: () => number = Math.random, spread = 0.06): number {
  return base * (1 + (rng() * 2 - 1) * spread);
}

/** 反馈等级由"目标是否为精英/Boss"推导，保证调用侧一致。 */
export function hitTierFor(isBoss: boolean, isElite: boolean): FeedbackTier {
  if (isBoss) return 'bossHit';
  if (isElite) return 'elite';
  return 'normal';
}