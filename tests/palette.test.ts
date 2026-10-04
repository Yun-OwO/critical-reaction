import { describe, expect, it } from 'vitest';
import { dyes } from '../src/game/data/dyes';
import {
  BASE_COLORS,
  ELEMENT_COLORS,
  SPECTRUM_COLORS,
  STATE_COLORS,
  contrastRatio,
  hexString,
  relativeLuminance,
  spectrumGlyph
} from '../src/game/visual/palette';

describe('视觉基础层：调色板（§15）', () => {
  it('光谱色板与染料定义逐条一致（防止色值漂移导致展示与实战脱节）', () => {
    for (const dye of dyes) {
      const spectrum = SPECTRUM_COLORS[dye.id];
      expect(spectrum, `缺少染料 ${dye.id} 的光谱定义`).toBeDefined();
      expect(spectrum.name).toBe(dye.name);
      expect(spectrum.color).toBe(dye.hex);
      expect(spectrum.wavelength).toBe(dye.wavelength);
    }
    // 反向：光谱表不应有染料表以外的条目
    expect(Object.keys(SPECTRUM_COLORS)).toHaveLength(dyes.length);
  });

  it('每种光谱色都有色盲冗余字形，且字形互不重复（红绿色盲下仍可区分）', () => {
    const glyphs = Object.values(SPECTRUM_COLORS).map((s) => s.glyph);
    expect(glyphs.every((g) => g.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('光谱色两两之间不是仅靠色相区分（发光色也各不相同）', () => {
    const glows = Object.values(SPECTRUM_COLORS).map((s) => s.glow);
    expect(new Set(glows).size).toBe(glows.length);
  });

  it('未知染料 id 回退为通用菱形而不是抛错', () => {
    expect(spectrumGlyph('D01')).toBe('●');
    expect(spectrumGlyph('不存在的染料')).toBe('◇');
  });

  it('元素色板覆盖全部设计元素且都有形状语言', () => {
    for (const id of ['H', 'C', 'O', 'Na', 'Cl', 'Fe', 'U', 'cat']) {
      const entry = ELEMENT_COLORS[id];
      expect(entry, `缺少元素 ${id}`).toBeDefined();
      expect(entry.glyph.length).toBeGreaterThan(0);
    }
  });

  it('正文文本在面板底色上达到 WCAG AA 4.5:1', () => {
    expect(contrastRatio(BASE_COLORS.text, BASE_COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(BASE_COLORS.text, BASE_COLORS.panel)).toBeGreaterThanOrEqual(4.5);
    // 次要文本同样必须达标（原实现约 3:1，属于不合格）
    expect(contrastRatio(BASE_COLORS.textDim, BASE_COLORS.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('UI 描边/图标等非文本元素达到 3:1', () => {
    expect(contrastRatio(BASE_COLORS.panelEdge, BASE_COLORS.panel)).toBeGreaterThanOrEqual(3);
  });

  it('相对亮度与对比度计算符合 WCAG 定义', () => {
    expect(relativeLuminance(0x000000)).toBeCloseTo(0, 6);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 6);
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 3);
    // 对比度与前后景顺序无关
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(contrastRatio(0x000000, 0xffffff), 6);
  });

  it('对立语义的状态色必须可区分（氧化 vs 还原）', () => {
    expect(STATE_COLORS.oxidized).not.toBe(STATE_COLORS.reduced);
    // 温度阶梯逐级不同，避免玩家读不出当前温度阶段
    const ramp = [
      STATE_COLORS.tempCold,
      STATE_COLORS.tempStable,
      STATE_COLORS.tempOverheat,
      STATE_COLORS.tempCritical,
      STATE_COLORS.tempMeltdown
    ];
    expect(new Set(ramp).size).toBe(ramp.length);
    // 安全与警告必须可区分
    expect(BASE_COLORS.safe).not.toBe(BASE_COLORS.warning);
  });

  it('hexString 输出可用于 CSS 的六位十六进制', () => {
    expect(hexString(0x0a0e1a)).toBe('#0A0E1A');
    expect(hexString(0x000000)).toBe('#000000');
    expect(hexString(0xffffff)).toBe('#FFFFFF');
  });
});