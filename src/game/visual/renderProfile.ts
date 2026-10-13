/**
 * 渲染档位与预算（全局升级执行规格 T02 / §F2）
 *
 * 单一真相源：画质档的**数值**只在这里定义，`SettingsState` 只负责持久化与
 * 开关读取，避免出现「SettingsState 一份、visual/quality 一份、Quality 一份」
 * 互相打架的情况（规格 §I 允许触及范围里明确要求抽口）。
 *
 * 三个档保持同一套艺术语言（R 要求）；差别只在计算分辨率、采样数与数量。
 * 「低步数」不意味着删掉大范围辉光。
 */

import type { VisualImportance, VisualTier } from './visualEvent';

export type RenderPreset = 'performance' | 'balanced' | 'fine';

export interface RenderProfile {
  id: RenderPreset;
  label: string;
  /** 主画面 renderScale。默认档必须是 1 —— 不允许自动降主分辨率来达标。 */
  renderScale: number;
  /** 云密度场宽高比（相对主画面）。 */
  cloudScale: number;
  /** 近 / 远 Bloom 缓冲宽高比。 */
  glowNearScale: number;
  glowFarScale: number;
  /** 额外全分辨率 Bloom 层（精细档扩展，需验证）。 */
  glowThirdScale: number;
  /** 活跃微粒硬上限。 */
  maxParticles: number;
  /** 非重要环境粒子额度（重要反馈独占其余配额）。 */
  ambientParticleQuota: number;
  /** 关键反馈保留额度。 */
  criticalReserve: number;
  /** 动态受光热点上限。 */
  maxDynamicLights: number;
  /** SSR 射线步数 / 命中细化次数。 */
  ssrSteps: number;
  ssrRefine: number;
  /** SSR 射线缓冲宽高比。 */
  ssrBufferScale: number;
  /** AO 强度与半径（世界单位）。 */
  aoStrength: number;
  aoRadius: number;
  /** 额外 RT 总占用上限（MiB）。 */
  rtBudgetMiB: number;
  /** 可见世界 draw calls 告警线（不是达标保证）。 */
  drawCallWarn: number;
}

export const RENDER_PROFILES: Record<RenderPreset, RenderProfile> = {
  performance: {
    id: 'performance',
    label: '性能优先',
    renderScale: 1,
    cloudScale: 0.25,
    glowNearScale: 0.5,
    glowFarScale: 0.25,
    glowThirdScale: 0.25,
    maxParticles: 800,
    ambientParticleQuota: 200,
    criticalReserve: 200,
    maxDynamicLights: 2,
    ssrSteps: 16,
    ssrRefine: 3,
    ssrBufferScale: 0.5,
    aoStrength: 0.25,
    aoRadius: 16,
    rtBudgetMiB: 32,
    drawCallWarn: 100
  },
  balanced: {
    id: 'balanced',
    label: '均衡',
    renderScale: 1,
    cloudScale: 0.25,
    glowNearScale: 0.5,
    glowFarScale: 0.25,
    glowThirdScale: 0.25,
    maxParticles: 1000,
    ambientParticleQuota: 300,
    criticalReserve: 250,
    maxDynamicLights: 3,
    ssrSteps: 24,
    ssrRefine: 3,
    ssrBufferScale: 0.5,
    aoStrength: 0.28,
    aoRadius: 16,
    rtBudgetMiB: 40,
    drawCallWarn: 130
  },
  fine: {
    id: 'fine',
    label: '精细',
    renderScale: 1,
    cloudScale: 0.5,
    glowNearScale: 0.5,
    glowFarScale: 0.25,
    glowThirdScale: 0.125,
    maxParticles: 1400,
    ambientParticleQuota: 420,
    criticalReserve: 350,
    maxDynamicLights: 4,
    ssrSteps: 32,
    ssrRefine: 4,
    ssrBufferScale: 0.5,
    aoStrength: 0.32,
    aoRadius: 18,
    rtBudgetMiB: 56,
    drawCallWarn: 170
  }
};

/**
 * 演出档的起始参数（规格 §D2）。
 *
 * 这里的数字是**开发起始值**，不是已验证的视觉达标结论。
 * ΔY = 装饰层为正常色彩合成带来的线性亮度增量，仅用于离线诊断；
 * 热路径禁止 readPixels。
 */
export interface TierBudget {
  /** 包围直径相对 min(W,H) 的上限。 */
  spanRatio: number;
  /** ΔY > 0.25 的高亮面积占画面比例上限。 */
  brightAreaRatio: number;
  /** 峰值时长（秒）。 */
  peakSeconds: number;
  /** 单次爆发微粒上限。 */
  particles: number;
}

export const TIER_BUDGETS: Record<VisualTier, TierBudget> = {
  G0: { spanRatio: 0.2, brightAreaRatio: 0.02, peakSeconds: 0.05, particles: 24 },
  G1: { spanRatio: 0.45, brightAreaRatio: 0.05, peakSeconds: 0.08, particles: 64 },
  G2: { spanRatio: 0.9, brightAreaRatio: 0.08, peakSeconds: 0.1, particles: 180 },
  G3: { spanRatio: 1.4, brightAreaRatio: 0.12, peakSeconds: 0.12, particles: 240 }
};

/** 可读性保护阈值（规格 §D3）。 */
export const READABILITY = {
  /** 玩家本体保护半径（CSS px） */
  playerProtectPx: 18,
  /** 玩家保护区内装饰雾 alpha 上限 */
  playerProtectMaxAlpha: 0.08,
  /** 敌方弹道/危险边保护半径（CSS px） */
  hazardProtectPx: 6,
  /** 危险附近装饰新增 ΔY 上限 */
  hazardMaxDeltaY: 0.1,
  /** 同屏同时处于峰值的装饰 G2/G3 事件上限 */
  maxConcurrentPeak: 2
} as const;

/** 帧时间目标（规格 §F1）。60Hz 下 16.67ms。 */
export const FRAME_BUDGET = {
  targetFps: 60,
  frameMs: 1000 / 60,
  cpuP95Ms: 6,
  gpuP95Ms: 10,
  /** 1% low ≥59、0.1% low ≥58（仅容许测量/调度微抖） */
  low1Percent: 59,
  low01Percent: 58,
  /** 可见帧间隔 P99 ≤18ms */
  p99FrameMs: 18,
  /** 明显错过一轮刷新的判定线 */
  missedVsyncMs: 25,
  /** 项目可归因的卡顿判定线 */
  hitchMs: 1000 / 30
} as const;

/** 自动调节的迟滞参数（规格 §F3）。绝不允许先掉到 40fps 再收紧。 */
export const AUTO_TUNE = {
  windowMs: 1000,
  evaluateEveryMs: 250,
  /** 连续多少窗超成本线才收紧 */
  tightenWindows: 2,
  /** 连续多少窗有余量才恢复 */
  recoverWindows: 40,
  /** 收紧的起始成本线 */
  tightenCpuMs: 6,
  tightenGpuMs: 10,
  /** 恢复的成本线 */
  recoverCpuMs: 4,
  recoverGpuMs: 7,
  /** 收紧幅度（占原额度的比例） */
  stepFactor: 0.15
} as const;

/** 设置项 → 档位映射（供 UI 生成，不另建 localStorage key）。 */
export const PRESET_TO_QUALITY: Record<RenderPreset, 'low' | 'medium' | 'high'> = {
  performance: 'low',
  balanced: 'medium',
  fine: 'high'
};

const DEFAULT_PRESET: RenderPreset = 'balanced';

let currentPreset: RenderPreset = DEFAULT_PRESET;

export function getRenderPreset(): RenderPreset {
  return currentPreset;
}

export function setRenderPreset(p: RenderPreset): void {
  currentPreset = p;
}

export function getRenderProfile(): RenderProfile {
  return RENDER_PROFILES[currentPreset];
}

/**
 * 装饰额度分配（规格 §F3）。
 *
 * 收紧顺序固定：环境发射率 → 装饰余韵新增量 → 离屏/无贡献光源工作。
 * 关键反馈（critical/important）永不被削减；现存粒子自然结束，不整片消失。
 */
export interface EmissionAllowance {
  /** 环境装饰可再发射的比例 0..1 */
  ambient: number;
  /** 是否允许新增余韵 */
  afterglow: boolean;
  /** 关键反馈是否完整保留 */
  criticalIntact: boolean;
}

export function computeAllowance(profile: RenderProfile, intensity: number): EmissionAllowance {
  // intensity: 0..1，1 表示已完全收紧
  const clamped = Math.max(0, Math.min(1, intensity));
  return {
    ambient: Math.max(0, 1 - clamped),
    afterglow: clamped < 0.6,
    criticalIntact: true
  };
}

/** 某重要性是否可以在当前收紧程度下继续发射。 */
export function mayEmit(importance: VisualImportance, intensity: number): boolean {
  const a = computeAllowance(RENDER_PROFILES.balanced, intensity);
  if (importance === 'critical') return a.criticalIntact;
  if (importance === 'important') return true;
  if (importance === 'normal') return a.ambient > 0;
  return a.ambient > 0.5 && a.afterglow;
}

/** 关键反馈保留额度是否满足。 */
export function withinCriticalReserve(activeCritical: number, profile: RenderProfile): boolean {
  return activeCritical <= profile.criticalReserve;
}