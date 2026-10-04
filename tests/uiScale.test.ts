import { describe, expect, it } from 'vitest';
import {
  BASE_FONT_DESIGN,
  CONTROL_EDGE_PAD_CSS,
  JOYSTICK_TRAVEL_RATIO,
  MAX_MOBILE_UI_SCALE,
  MIN_READABLE_CSS,
  clampControlCenter,
  computeGeometryScale,
  computeTouchControlLayout,
  computeUiScale,
  controlEdgePad,
  cssPerUnit,
  hudRightEdge,
  joystickTravel,
  parseSafeInsets,
  type ControlBox,
  type ViewportMetrics
} from '../src/game/ui/uiScale';

/** 构造视口指标（默认按长边 1920 的横屏设计稿）。 */
function metrics(
  width: number,
  height: number,
  cssWidth: number,
  cssHeight: number,
  touch: boolean
): ViewportMetrics {
  return { width, height, cssWidth, cssHeight, touch };
}

const BOX: ControlBox = { width: 1920, height: 864, padLeft: 100, padRight: 100, padTop: 40, padBottom: 60 };

describe('uiScale 移动端 UI 缩放', () => {
  it('桌面端仅按 1920 设计稿等比缩放', () => {
    expect(computeUiScale(metrics(1920, 1080, 1920, 1080, false))).toBeCloseTo(1);
    expect(computeUiScale(metrics(1440, 810, 1440, 810, false))).toBeCloseTo(0.75);
    expect(computeUiScale(metrics(960, 540, 960, 540, false))).toBeCloseTo(0.5);
  });

  it('桌面端不做移动端补偿（窄窗口也不放大）', () => {
    // 即使 CSS 视口很小，桌面端也不应触发可读性放大
    expect(computeUiScale(metrics(1920, 1080, 800, 450, false))).toBeCloseTo(1);
  });

  it('触屏端需求超过上限时被钳制，但仍明显放大', () => {
    // 典型横屏手机：CSS 844x390，内部分辨率 1920x887
    const m = metrics(1920, 887, 844, 390, true);
    const per = cssPerUnit(m);
    expect(MIN_READABLE_CSS / (BASE_FONT_DESIGN * per)).toBeGreaterThan(MAX_MOBILE_UI_SCALE);
    expect(computeUiScale(m)).toBeCloseTo(MAX_MOBILE_UI_SCALE);
    // 落屏字号必须高于未补偿的等比缩放（1.0），否则补偿没有意义
    expect(BASE_FONT_DESIGN * computeUiScale(m) * per).toBeGreaterThan(BASE_FONT_DESIGN * per * 1.5);
  });

  it('触屏端可读性需求在上限内时精确命中该值，且不小于等比缩放', () => {
    const m = metrics(1920, 900, 1280, 600, true);
    const per = cssPerUnit(m);
    const expected = MIN_READABLE_CSS / (BASE_FONT_DESIGN * per);
    expect(expected).toBeGreaterThan(1);
    expect(expected).toBeLessThan(MAX_MOBILE_UI_SCALE);
    expect(computeUiScale(m)).toBeCloseTo(expected);
  });

  it('触屏端不会因补偿而缩小（与等比缩放取较大值）', () => {
    // 平板接大屏：CSS 像素充足，可读性需求低于等比缩放
    const m = metrics(1920, 900, 1920, 900, true);
    expect(computeUiScale(m)).toBeCloseTo(1);
  });

  it('竖屏窄画布仍能放大到可读（不受 0.5 下限拖累）', () => {
    const m = metrics(887, 1920, 390, 844, true);
    expect(computeUiScale(m)).toBeGreaterThan(1);
  });

  it('cssPerUnit 取宽高两个方向比例的较小值', () => {
    expect(cssPerUnit(metrics(1920, 1000, 960, 900, false))).toBeCloseTo(0.5);
    expect(cssPerUnit(metrics(0, 0, 960, 900, false))).toBe(0);
  });
});

describe('uiScale 动作控件几何缩放', () => {
  it('只按 1920 设计稿等比缩放，触屏端不做放大', () => {
    // 手机横屏：内部分辨率长边 1920，几何缩放必然为 1（控件尺寸与设计稿一致）
    expect(computeGeometryScale(metrics(1920, 887, 844, 390, true))).toBeCloseTo(1);
    // 同一视口下 UI 缩放被补偿放大，两者必须分离
    expect(computeUiScale(metrics(1920, 887, 844, 390, true))).toBeGreaterThan(1);
  });

  it('与桌面端等比缩放一致且钳制在 [0.5, 1]', () => {
    expect(computeGeometryScale(metrics(1920, 1080, 1920, 1080, false))).toBeCloseTo(1);
    expect(computeGeometryScale(metrics(1440, 810, 1440, 810, false))).toBeCloseTo(0.75);
    expect(computeGeometryScale(metrics(800, 600, 1920, 1080, false))).toBeCloseTo(0.5);
  });
});

describe('uiScale 触摸控件钳制', () => {
  it('边缘留白取安全区与固定留白的较大者并换算成设计单位', () => {
    const m = metrics(1920, 1080, 960, 540, false); // per = 0.5
    expect(controlEdgePad(m, 0)).toBeCloseTo(CONTROL_EDGE_PAD_CSS / 0.5);
    expect(controlEdgePad(m, 44)).toBeCloseTo(44 / 0.5);
  });

  it('控件中心被钳制在安全区内，中心 ± 半径完整可见', () => {
    const r = 50;
    expect(clampControlCenter(-500, -500, r, BOX)).toEqual({ x: 150, y: 90 });
    expect(clampControlCenter(9999, 9999, r, BOX)).toEqual({ x: 1770, y: 754 });
  });

  it('框内坐标不被改动', () => {
    expect(clampControlCenter(900, 400, 50, BOX)).toEqual({ x: 900, y: 400 });
  });

  it('半径超出可用空间时退化为最大可容纳位置，不产生反转区间', () => {
    const tiny: ControlBox = { width: 200, height: 200, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
    const pos = clampControlCenter(0, 0, 150, tiny);
    expect(pos.x).toBe(150);
    expect(pos.x).toBe(pos.y);
  });

  it('摇杆行程不超过底盘半径的比例上限', () => {
    expect(joystickTravel(100)).toBeCloseTo(100 * JOYSTICK_TRAVEL_RATIO);
    expect(joystickTravel(100)).toBeLessThan(100);
    expect(joystickTravel(0)).toBe(0);
    expect(joystickTravel(-5)).toBe(0);
  });
});

describe('uiScale 触摸控件布局与 HUD 避让', () => {
  const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
  // 典型横屏手机：内部分辨率长边 1920（1920x887），CSS 844x390
  const phone = metrics(1920, 887, 844, 390, true);

  function onPhone(): ReturnType<typeof computeTouchControlLayout> {
    return computeTouchControlLayout(phone, computeGeometryScale(phone), ZERO);
  }

  it('所有控件完整落在安全区内（含刘海留白）', () => {
    const l = onPhone();
    const inside = (x: number, y: number, r: number): boolean =>
      x - r >= l.box.padLeft - 1e-6 &&
      x + r <= phone.width - l.box.padRight + 1e-6 &&
      y - r >= l.box.padTop - 1e-6 &&
      y + r <= phone.height - l.box.padBottom + 1e-6;
    expect(inside(l.attackX, l.attackY, l.btnAttackR)).toBe(true);
    expect(inside(l.dashX, l.dashY, l.btnSmallR)).toBe(true);
    expect(inside(l.modeX, l.modeY, l.btnSmallR)).toBe(true);
    expect(inside(l.interactX, l.interactY, l.btnSmallR)).toBe(true);
    expect(inside(l.weaponX, l.weaponY, l.btnSmallR)).toBe(true);
    expect(inside(l.joyX, l.joyY, l.baseR)).toBe(true);
  });

  it('控件尺寸只走几何缩放，不受 UI 可读性补偿影响', () => {
    const l = onPhone();
    // 长边 1920 → 几何缩放 1，控件半径与设计稿完全一致
    expect(computeGeometryScale(phone)).toBeCloseTo(1);
    expect(l.baseR).toBeCloseTo(95);
    expect(l.btnAttackR).toBeCloseTo(80);
    expect(l.btnSmallR).toBeCloseTo(58);
  });

  it('摇杆让开按钮组，两只手的操作区不重叠', () => {
    const l = onPhone();
    expect(l.joyX + l.baseR).toBeLessThan(l.clusterLeft);
  });

  it('按钮组左沿位于屏内，且摇杆手势区不越过它', () => {
    const l = onPhone();
    expect(l.clusterLeft).toBeGreaterThan(0);
    expect(l.clusterLeft).toBeLessThan(phone.width);
    expect(l.joystickZoneRight).toBeLessThanOrEqual(l.clusterLeft);
  });

  it('UI 放大后若不避让，染料槽会压在攻击按钮上', () => {
    const s = computeUiScale(phone); // 移动端被补偿放大到 1.6
    const l = onPhone();
    const baseRight = phone.width - 40 * s;
    const chipsWidth = 3 * 52 * s + 2 * 6 * s;
    // 未避让：染料槽区间与攻击按钮区间相交（这就是要修复的遮挡）
    expect(baseRight - chipsWidth).toBeLessThan(l.attackX + l.btnAttackR);
    expect(baseRight).toBeGreaterThan(l.attackX - l.btnAttackR);
  });

  it('避让后染料槽与负载行整体落在按钮组左侧', () => {
    const s = computeUiScale(phone);
    const l = onPhone();
    const gap = 12 * s;
    const baseRight = phone.width - 40 * s;
    const safeRight = hudRightEdge(baseRight, l.clusterLeft, gap, true);
    const chipsWidth = 3 * 52 * s + 2 * 6 * s;
    expect(safeRight).toBeCloseTo(l.clusterLeft - gap);
    expect(safeRight).toBeLessThan(l.attackX - l.btnAttackR);
    expect(safeRight - chipsWidth).toBeGreaterThan(0);
  });

  it('无按钮组可避让时（桌面端）HUD 边界保持原位', () => {
    expect(hudRightEdge(1880, 1382, 19.2, false)).toBe(1880);
  });

  it('横屏多档屏高：按钮组行距、温度计、状态栏互不侵入', () => {
    // 2800 宽平板的常见视口高度（含浏览器 UI 占用后的有效高度）
    for (const cssH of [1100, 1272, 1440]) {
      const cssW = 2800;
      const w = 1920;
      const h = Math.min(900, Math.round(Math.min(cssW, cssH) * (1920 / cssW)));
      const m = metrics(w, h, cssW, cssH, true);
      const s = computeGeometryScale(m);
      const l = computeTouchControlLayout(m, s, ZERO);
      // ☰/Q 行距与 E/☰ 水平缝隙：扣除半径和描边后仍有可见空隙
      expect(l.weaponY - l.statusY).toBeGreaterThanOrEqual(2 * l.btnSmallR + 24 * s);
      expect(l.statusX - l.interactX).toBeGreaterThanOrEqual(2 * l.btnSmallR + 18 * s);
      // 任意两键中心距 ≥ 半径和（分离兜底生效）；攻键对 Q 的对角缝隙须容纳蓄力脉动峰值（×1.06）
      const centers: [number, number, number][] = [
        [l.attackX, l.attackY, l.btnAttackR],
        [l.dashX, l.dashY, l.btnSmallR],
        [l.modeX, l.modeY, l.btnSmallR],
        [l.interactX, l.interactY, l.btnSmallR],
        [l.weaponX, l.weaponY, l.btnSmallR],
        [l.statusX, l.statusY, l.btnSmallR]
      ];
      for (let i = 0; i < centers.length; i += 1) {
        for (let j = i + 1; j < centers.length; j += 1) {
          const d = Math.hypot(centers[i][0] - centers[j][0], centers[i][1] - centers[j][1]);
          expect(d).toBeGreaterThanOrEqual(centers[i][2] + centers[j][2] - 1e-6);
        }
      }
      const distAttackQ = Math.hypot(l.attackX - l.weaponX, l.attackY - l.weaponY);
      expect(distAttackQ).toBeGreaterThanOrEqual(l.btnAttackR * 1.06 + l.btnSmallR + 8 * s);
      // 温度计（含下方 8px 偏移 + 状态文字 14px）不侵入 E/☰ 按钮上沿
      const thermoTop = 140 * s;
      const natural = Math.min(320 * s, m.height * 0.42);
      const thermoH = Math.max(64 * s, Math.min(Math.min(thermoTop + natural, l.thermoBottomMax) - thermoTop, natural));
      expect(thermoTop + thermoH + 22 * s).toBeLessThanOrEqual(Math.min(l.interactY, l.statusY) - l.btnSmallR + 1e-6);
      // 状态栏顶部不压摇杆（核心中心上方 70 处是最高一行文本）
      const coreR = 26 * s;
      const barY = Math.min(m.height - 23 * s, Math.max(m.height - 66 * s, l.joyY + l.baseR + coreR + 78 * s));
      expect(barY - coreR - 70 * s).toBeGreaterThanOrEqual(l.joyY + l.baseR - 1e-6);
      // 血条、冲刺提示都不越出屏幕底缘（不裁剪）
      expect(barY + 23 * s).toBeLessThanOrEqual(m.height + 1e-6);
      expect(barY + 34 * s + 15 * s).toBeLessThanOrEqual(m.height + 1e-6);
    }
  });
});

describe('uiScale 安全区解析', () => {
  it('正常 px 值被解析', () => {
    expect(parseSafeInsets({ top: '44px', right: '12.5px', bottom: '0px', left: '8px' }))
      .toEqual({ top: 44, right: 12.5, bottom: 0, left: 8 });
  });

  it('空值与非法值按 0 处理', () => {
    expect(parseSafeInsets({ top: '', right: 'abc', bottom: 'calc(1px)', left: '-10px' }))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});