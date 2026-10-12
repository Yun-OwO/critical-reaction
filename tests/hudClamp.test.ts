import { describe, expect, it } from 'vitest';
import {
  MAX_HUD_WIDTH_RATIO,
  computeUiScale,
  hudMaxWidth,
  type ViewportMetrics
} from '../src/game/ui/uiScale';

function vp(width: number, height: number, cssW: number, cssH: number, touch: boolean): ViewportMetrics {
  return { width, height, cssWidth: cssW, cssHeight: cssH, touch };
}

describe('hudMaxWidth —— HUD 元素按屏宽封顶', () => {
  it('宽屏上不裁剪（设计尺寸小于上限）', () => {
    expect(hudMaxWidth(340, 1920)).toBe(340);
  });

  it('窄屏上按屏宽比例封顶', () => {
    // 1920x1080 设计稿，屏宽 800 → 上限 800*0.34 = 272，故 340 被裁到 272
    expect(hudMaxWidth(340, 800)).toBeCloseTo(272, 6);
  });

  it('默认比例就是导出的常量', () => {
    expect(hudMaxWidth(340, 1000)).toBeCloseTo(1000 * MAX_HUD_WIDTH_RATIO, 6);
  });

  it('可以指定自己的比例', () => {
    expect(hudMaxWidth(340, 1000, 0.5)).toBeCloseTo(340, 6); // 500 > 340，不裁
    expect(hudMaxWidth(340, 600, 0.5)).toBeCloseTo(300, 6);
  });

  it('屏宽非法时退化成设计尺寸而不是 0', () => {
    expect(hudMaxWidth(340, 0)).toBe(340);
    expect(hudMaxWidth(340, -100)).toBe(340);
  });
});

describe('移动端 UI 放大不会把 HUD 顶出屏幕', () => {
  /**
   * 这是「部分 UI 在移动端尺寸太大」的根因验证：
   * computeUiScale 在触屏上最高放大到 1.6 倍（为可读性），
   * 同一个 s 若直接乘在几何尺寸上，血条这类长条元素会顶出屏幕。
   */
  const phones = [
    { name: 'iPhone SE', w: 750, h: 1334, css: [375, 667] },
    { name: 'iPhone 14 Pro Max', w: 1284, h: 2778, css: [430, 932] },
    { name: '小屏安卓', w: 720, h: 1280, css: [360, 640] },
    { name: '超窄屏', w: 640, h: 1200, css: [320, 600] }
  ];

  it('血条在放大后仍按屏宽封顶，加上左侧留白不超出屏幕', () => {
    for (const p of phones) {
      const m = vp(p.w, p.h, p.css[0], p.css[1], true);
      const s = computeUiScale(m);
      const barW = hudMaxWidth(260 * s, p.w, 0.36);
      const barX = 40 * s;
      expect(barX + barW, `${p.name} 血条右缘超出屏幕`).toBeLessThanOrEqual(p.w);
    }
  });

  it('电子核心半径在放大后仍远小于屏宽', () => {
    for (const p of phones) {
      const m = vp(p.w, p.h, p.css[0], p.css[1], true);
      const s = computeUiScale(m);
      const coreR = Math.min(26 * s, p.w * 0.028);
      expect(coreR * 2, `${p.name} 核心直径过大`).toBeLessThan(p.w * 0.1);
    }
  });

  it('Boss 血条两侧留白不会退化成负数', () => {
    // 原实现 Math.min(620*s, W-320*s) 在窄屏上会得到极小值甚至负数，
    // 现改为再按屏宽比例封一个下限
    for (const p of phones) {
      const m = vp(p.w, p.h, p.css[0], p.css[1], true);
      const s = computeUiScale(m);
      const bossBarW = Math.max(Math.min(620 * s, p.w - 320 * s), p.w * 0.42);
      expect(bossBarW, `${p.name} Boss 血条非正`).toBeGreaterThan(0);
      expect(bossBarW, `${p.name} Boss 血条超出屏幕`).toBeLessThanOrEqual(p.w);
    }
  });
});

describe('房间横幅字号自适应（长文案不溢出）', () => {
  /** 与 GameScene.showRoomBanner 里的推算同构。 */
  function bannerFont(screenWidth: number, uiScale: number, text: string): number {
    const fit = (screenWidth * 0.9) / Math.max(1, text.length * 0.6);
    return Math.round(Math.min(30 * uiScale, fit));
  }

  it('短文案按原字号', () => {
    expect(bannerFont(1920, 1, '房间清空')).toBe(30);
  });

  it('长文案在窄屏上被压小', () => {
    const long = '第一层 · 房间清空 · 出口已解锁 · 催化反应稳定';
    const narrow = bannerFont(640, 1.6, long);
    // 未钳制时窄屏会得到 30*1.6 = 48，钳制后必须更小
    expect(narrow).toBeLessThan(48);
    expect(narrow).toBeGreaterThan(0);
    // 且随屏宽变小而变小（同一文案）
    expect(bannerFont(420, 1.6, long)).toBeLessThan(narrow);
  });

  it('估算宽度始终落在屏幕内', () => {
    const texts = ['房间清空', '第一层 · 房间清空 · 出口已解锁', 'A'.repeat(60)];
    for (const t of texts) {
      const font = bannerFont(640, 1.6, t);
      const estWidth = t.length * font * 0.6;
      expect(estWidth, `「${t.slice(0, 12)}…」横幅溢出`).toBeLessThanOrEqual(640);
    }
  });
});