/**
 * 视觉基础层：调色板与形状语言（设计文档 §15.3 基础色板 / §15.4 元素色板 / §15.5 光谱色板）
 *
 * 存在意义：
 *   1. 颜色只在这里定义一次，避免同一语义在不同文件里出现多个近似色值而"越改越脏"。
 *   2. 每个语义色都携带「形状/字形」冗余，用于色盲模式（§交付检查：关键颜色需同时提供形状或图案辅助）。
 *      —— 单靠颜色传达信息会把红绿色盲玩家挡在门外，冗余通道不是可选项。
 *
 * 命名约定：`名称` 用于代码，`hex` 为展示用字符串，`color` 为 Phaser 用的数值。
 */

/** 基础界面与场景色（§15.3）。 */
export const BASE_COLORS = {
  /** 背景底 */
  background: 0x0a0e1a,
  /** 网格线 */
  grid: 0x1a2233,
  /** 角色白 */
  pure: 0xffffff,
  /** 阴影 */
  shadow: 0x060810,
  /** 中性灰 */
  neutral: 0x4a5568,
  /** 警告 */
  warning: 0xff4d2e,
  /** 安全 */
  safe: 0x2effb8,
  /** 面板底色 */
  panel: 0x06131e,
  /**
   * 面板描边。
   * 原值 0x2a6080 在面板底色上对比度仅 2.75:1，低于 WCAG 对 UI 组件的 3:1 要求，
   * 因此在保持"细冷色描边"观感的前提下上调亮度至 4.0:1。
   */
  panelEdge: 0x3d7a9e,
  /** 文本主色 */
  text: 0xd4e8ee,
  /** 文本次要色（已按 WCAG 对比度上调，原 rgba(145,168,184,.5) 在深底上仅约 3:1） */
  textDim: 0x9fb4c4
} as const;

/** 元素色板（§15.4）：主色 / 辅色。 */
export interface ElementPalette {
  name: string;
  primary: number;
  secondary: number;
  /** 形状语言（§15.10）：圆=核、三角=攻击、方=防御、六边=稳定、菱形=能量 */
  glyph: string;
}

export const ELEMENT_COLORS: Record<string, ElementPalette> = {
  H: { name: '氢', primary: 0xe8f4ff, secondary: 0xa8e6ff, glyph: '○' },
  C: { name: '碳', primary: 0x3d3d4a, secondary: 0x1a1a24, glyph: '⬡' },
  O: { name: '氧', primary: 0xff3b30, secondary: 0xff6b35, glyph: '○' },
  Na: { name: '钠', primary: 0xffd60a, secondary: 0xffb800, glyph: '△' },
  Cl: { name: '氯', primary: 0x34c759, secondary: 0xa8e05f, glyph: '◇' },
  Fe: { name: '铁', primary: 0xc97b3a, secondary: 0x8b4513, glyph: '□' },
  U: { name: '铀', primary: 0x39ff14, secondary: 0x9d4edd, glyph: '⬡' },
  cat: { name: '催化剂', primary: 0x9d4edd, secondary: 0xe040fb, glyph: '⚡' }
};

/** 光谱色板（§15.5）：每种染料一个可区分色 + 发光色 + 形状冗余。 */
export interface SpectrumPalette {
  /** 中文色名，与 dyes.ts 的 name 一致 */
  name: string;
  color: number;
  glow: number;
  /**
   * 色盲冗余通道：形状 + 单字标记。
   * 红/绿、蓝/紫等组合在色觉缺陷下会并成一色，必须能靠形状与字形区分。
   */
  glyph: string;
  /** 波长区间，用于染料详情展示 */
  wavelength: string;
}

/** 光谱顺序与 dyes.ts 的 D01-D09 一一对应（有单测保证不漂移）。 */
export const SPECTRUM_COLORS: Record<string, SpectrumPalette> = {
  D01: { name: '红染', color: 0xef4444, glow: 0xfca5a5, glyph: '●', wavelength: '620-750nm' },
  D02: { name: '橙染', color: 0xf97316, glow: 0xfdba74, glyph: '◆', wavelength: '590-620nm' },
  D03: { name: '黄染', color: 0xeab308, glow: 0xfde047, glyph: '▲', wavelength: '570-590nm' },
  D04: { name: '绿染', color: 0x22c55e, glow: 0x86efac, glyph: '■', wavelength: '520-570nm' },
  D05: { name: '青染', color: 0x06b6d4, glow: 0x67e8f9, glyph: '✚', wavelength: '495-520nm' },
  D06: { name: '蓝染', color: 0x3b82f6, glow: 0x93c5fd, glyph: '▼', wavelength: '450-495nm' },
  D07: { name: '紫染', color: 0x8b5cf6, glow: 0xc4b5fd, glyph: '★', wavelength: '380-450nm' },
  D08: { name: '紫外染', color: 0x6a0dad, glow: 0xb388ff, glyph: '✳', wavelength: '<380nm' },
  D09: { name: '红外染', color: 0x991b1b, glow: 0xf87171, glyph: '⬟', wavelength: '>750nm' }
};

/** 混色结果的展示色（§15.6）。 */
export const MIX_COLORS = {
  white: { name: '白', color: 0xf0f0ff },
  gold: { name: '金', color: 0xffd700 },
  brown: { name: '棕', color: 0x92400e },
  dark: { name: '暗', color: 0x1a0a2e },
  heat: { name: '热', color: 0x7f1d1d }
} as const;

/** 语义色：模式 / 温度 / 稀有度等跨系统共用的状态色。 */
export const STATE_COLORS = {
  /** 氧化态（夺电子） */
  oxidized: 0xff8a4c,
  /** 还原态（充能） */
  reduced: 0xfde047,
  /** 温度分段（§6.1） */
  tempCold: 0x67e8f9,
  tempStable: 0x5cffb1,
  tempOverheat: 0xfde047,
  tempCritical: 0xff8a4c,
  tempMeltdown: 0xff4d6d,
  /** 护盾 */
  shield: 0xfde047,
  /** 精英 */
  elite: 0xffb020
} as const;

/** 十六进制数值转 CSS 字符串（Phaser 文本/描边用）。 */
export function hexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

/** 染料 id → 色盲冗余字形（未知 id 回退为通用菱形）。 */
export function spectrumGlyph(dyeId: string): string {
  return SPECTRUM_COLORS[dyeId]?.glyph ?? '◇';
}

/**
 * 相对亮度（WCAG 2.x）。用于对比度校验，
 * 让"文字在深色面板上是否可读"这件事可以自动化测试，而不是靠肉眼。
 */
export function relativeLuminance(color: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel((color >> 16) & 0xff);
  const g = channel((color >> 8) & 0xff);
  const b = channel(color & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（1:1 ~ 21:1）。 */
export function contrastRatio(foreground: number, background: number): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}