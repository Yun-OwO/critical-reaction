/**
 * 移动端 UI 缩放与触摸控件钳制（纯函数，不依赖 Phaser，便于单测）。
 *
 * 适配背景：
 * 内部分辨率固定按「长边 1920 + 设备宽高比」生成，再交给 Phaser.Scale.FIT 缩放到窗口。
 * 桌面窗口的 CSS 像素与设计单位接近 1:1，等比缩放即可保证观感一致；
 * 移动端窗口 CSS 像素少但 PPI 高，等比缩放后文字落到屏幕上会小到不可读，
 * 因此需要按「设计单位 → CSS 像素」的实际换算再补偿放大一次，并对上限做钳制。
 */

/** 视口指标：设计单位尺寸 + 真实 CSS 像素尺寸。 */
export interface ViewportMetrics {
  /** 画布内部分辨率（设计单位） */
  width: number;
  height: number;
  /** 视口 CSS 像素宽 */
  cssWidth: number;
  /** 视口 CSS 像素高 */
  cssHeight: number;
  /** 是否触屏设备 */
  touch: boolean;
}

/** CSS 安全区（刘海/圆角/手势条），单位为 CSS 像素。 */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 目标最小可读字号（CSS px）。 */
export const MIN_READABLE_CSS = 11;
/** 可读性推算所用的基准设计字号：与 UIScene 里最小的 HUD 文本一致。 */
export const BASE_FONT_DESIGN = 14;
/** UI 放大上限：继续放大会明显遮挡战场，收益被视野损失抵消。 */
export const MAX_MOBILE_UI_SCALE = 1.6;
/** 控件与屏幕边缘的最小留白（CSS px）。 */
export const CONTROL_EDGE_PAD_CSS = 8;
/** 摇杆指示球行程占底盘半径的比例：留出余量，保证指示球始终落在底盘内。 */
export const JOYSTICK_TRAVEL_RATIO = 0.72;
/** 摇杆死区占行程的比例：低于该位移不产生移动输入，避免手指微抖导致漂移。 */
export const JOYSTICK_DEADZONE_RATIO = 0.22;

/** 触屏设备判定（统一入口，避免各场景各写一份产生分歧）。 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/** 读取当前窗口的视口指标；浏览器 API 不可用时退化为设计单位 1:1。 */
export function currentViewportMetrics(width: number, height: number, touch: boolean): ViewportMetrics {
  const cssWidth = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : width;
  const cssHeight = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : height;
  return { width, height, cssWidth, cssHeight, touch };
}

/** FIT 缩放下 1 个设计单位对应的 CSS 像素数。 */
export function cssPerUnit(m: ViewportMetrics): number {
  if (m.width <= 0 || m.height <= 0 || m.cssWidth <= 0 || m.cssHeight <= 0) return 0;
  return Math.min(m.cssWidth / m.width, m.cssHeight / m.height);
}

/**
 * 动作控件（摇杆/按钮）几何缩放因子。
 * 只按 1920 设计稿等比缩放，保持控件相对屏幕的比例恒定——这是控件原本的尺寸表现。
 * 移动端可读性补偿只应作用于文字/HUD，若一并作用于控件会把按钮顶到挤占战场。
 */
export function computeGeometryScale(m: ViewportMetrics): number {
  return clamp(m.width / 1920, 0.5, 1);
}

/**
 * UI 几何缩放因子。
 * - 桌面端：与控件几何一致，仅按 1920 设计稿宽度等比缩放。
 * - 触屏端：额外按可读性反推下限，使基准设计字号落到 CSS 像素上不小于 MIN_READABLE_CSS，
 *   并整体钳制在 [0.5, MAX_MOBILE_UI_SCALE] 内。
 */
export function computeUiScale(m: ViewportMetrics): number {
  const base = computeGeometryScale(m);
  if (!m.touch) return base;
  const per = cssPerUnit(m);
  if (per <= 0) return base;
  const readable = MIN_READABLE_CSS / (BASE_FONT_DESIGN * per);
  return clamp(Math.max(base, readable), 0.5, MAX_MOBILE_UI_SCALE);
}

/** 控件边缘留白（设计单位）：安全区与固定留白取较大者后再换算。 */
export function controlEdgePad(m: ViewportMetrics, safeInsetCss: number): number {
  const css = Math.max(CONTROL_EDGE_PAD_CSS, safeInsetCss);
  const per = cssPerUnit(m);
  return per > 0 ? css / per : css;
}

/** 控件钳制边界框（设计单位）。 */
export interface ControlBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

/**
 * 把控件中心钳制进安全区，保证「中心 ± 半径」完整落在屏幕内。
 * 半径大于可用空间时退化为能容纳的最大位置，不会出现区间反转。
 */
export function clampControlCenter(x: number, y: number, radius: number, box: ControlBox): { x: number; y: number } {
  const minX = box.padLeft + radius;
  const minY = box.padTop + radius;
  const maxX = Math.max(minX, box.width - box.padRight - radius);
  const maxY = Math.max(minY, box.height - box.padBottom - radius);
  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
}

/** 摇杆指示球行程（设计单位）：不超过底盘半径的比例上限，保证球不出底盘。 */
export function joystickTravel(baseRadius: number, ratio: number = JOYSTICK_TRAVEL_RATIO): number {
  return Math.max(0, baseRadius * ratio);
}

/** 解析 CSS 自定义属性里的安全区数值（形如 "44px"），空值/非法值按 0 处理。 */
export function parseSafeInsets(raw: Record<keyof SafeAreaInsets, string>): SafeAreaInsets {
  const read = (value: string): number => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return { top: read(raw.top), right: read(raw.right), bottom: read(raw.bottom), left: read(raw.left) };
}

/** 读取 :root 上由 CSS 注入的安全区（index.html 中 --safe-* + viewport-fit=cover 配合）。 */
export function readSafeAreaInsets(): SafeAreaInsets {
  const zero: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return zero;
  const style = getComputedStyle(document.documentElement);
  return parseSafeInsets({
    top: style.getPropertyValue('--safe-top'),
    right: style.getPropertyValue('--safe-right'),
    bottom: style.getPropertyValue('--safe-bottom'),
    left: style.getPropertyValue('--safe-left')
  });
}

/** 触摸控件布局（设计单位）。HUD 与控件共用同一份结果，避免各自推算导致遮挡。 */
export interface TouchControlLayout {
  box: ControlBox;
  baseR: number;
  thumbR: number;
  btnSmallR: number;
  btnAttackR: number;
  joyX: number;
  joyY: number;
  attackX: number;
  attackY: number;
  dashX: number;
  dashY: number;
  modeX: number;
  modeY: number;
  interactX: number;
  interactY: number;
  weaponX: number;
  weaponY: number;
  /** 状态面板按钮（TAB 的移动端等价物） */
  statusX: number;
  statusY: number;
  /** 按钮组占据区域的左沿：HUD 右对齐元素不得越过此线 */
  clusterLeft: number;
  /** 摇杆指示球行程 */
  travel: number;
  /** 摇杆死区 */
  deadzone: number;
  /** 摇杆手势生效的横向右边界 */
  joystickZoneRight: number;
  /** 摇杆占用区的上沿（设计单位）：触屏端左下状态栏必须整体落在这条线以下，否则与摇杆重叠 */
  joystickTop: number;
  /** 温度计允许的最低下沿（设计单位）：触屏端按钮组上沿，温度计不得越过它 */
  thermoBottomMax: number;
}

/**
 * 计算触摸控件布局。按钮与摇杆先按设计稿定位，再逐个钳制进安全区；
 * 摇杆横向额外让开按钮组，保证两只手的操作区互不侵占。
 * 所有结果都以设计单位表示，由调用侧直接创建显示对象。
 */
export function computeTouchControlLayout(
  m: ViewportMetrics,
  geometryScale: number,
  insets: SafeAreaInsets
): TouchControlLayout {
  const W = m.width;
  const H = m.height;
  const s = geometryScale;
  const box: ControlBox = {
    width: W,
    height: H,
    padLeft: controlEdgePad(m, insets.left),
    padRight: controlEdgePad(m, insets.right),
    padTop: controlEdgePad(m, insets.top),
    padBottom: controlEdgePad(m, insets.bottom)
  };

  // 根据画面比例计算控件偏移：16:9 居中，20:9 向两侧展开
  const aspect = W / H;
  const spread = clamp((aspect - 1.778) / (2.222 - 1.778), 0, 1);
  const spreadOffset = spread * 120 * s;

  const baseR = (m.touch ? 95 : 110) * s;
  const thumbR = baseR * 0.42;
  const btnSmallR = (m.touch ? 58 : 70) * s;
  const btnAttackR = (m.touch ? 80 : 95) * s;
  const btnBaseX = m.touch ? W - 310 * s + spreadOffset : W - 230 * s;

  // 右侧按钮组三行（☰ → »/Q → 攻+E）行距 145，扣掉半径后仍留 ≥29px 视觉缝隙；
  // E 下移 60% 行距贴近攻击键（对角关系下与 Q 仍有 ≥36px 缝隙）、左移 24；
  // 攻左移 12：Q 与攻是对角相邻，蓄力脉动（×1.06）峰值也要保住缝隙。
  const attack = clampControlCenter(btnBaseX - 12 * s, H - 168 * s, btnAttackR, box);
  const dash = clampControlCenter(btnBaseX - 170 * s, H - 285 * s, btnSmallR, box);
  const mode = clampControlCenter(btnBaseX - 170 * s, H - 125 * s, btnSmallR, box);
  const interact = clampControlCenter(btnBaseX - 24 * s, H - 343 * s, btnSmallR, box);
  const weapon = clampControlCenter(btnBaseX + 130 * s, H - 285 * s, btnSmallR, box);
  const status = clampControlCenter(btnBaseX + 130 * s, H - 430 * s, btnSmallR, box);

  // 成对分离兜底：贴边钳制或未来调整行距时可能把两键挤到一起，
  // 沿连线迭代推开，直到任意两键间留出 12px（含描边）的最小缝隙
  const buttons = [
    { x: attack.x, y: attack.y, r: btnAttackR },
    { x: dash.x, y: dash.y, r: btnSmallR },
    { x: mode.x, y: mode.y, r: btnSmallR },
    { x: interact.x, y: interact.y, r: btnSmallR },
    { x: weapon.x, y: weapon.y, r: btnSmallR },
    { x: status.x, y: status.y, r: btnSmallR }
  ];
  for (let iter = 0; iter < 24; iter += 1) {
    let moved = false;
    for (let i = 0; i < buttons.length; i += 1) {
      for (let j = i + 1; j < buttons.length; j += 1) {
        const a = buttons[i];
        const b = buttons[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        const minDist = a.r + b.r + 12 * s;
        if (dist >= minDist) continue;
        const push = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const btn of buttons) {
    const c = clampControlCenter(btn.x, btn.y, btn.r, box);
    btn.x = c.x;
    btn.y = c.y;
  }

  const clusterLeft = Math.min(
    attack.x - btnAttackR,
    dash.x - btnSmallR,
    mode.x - btnSmallR,
    interact.x - btnSmallR
  );
  const joy = clampControlCenter(
    Math.min((m.touch ? 350 : 240) * s - spreadOffset, clusterLeft - 24 * s - baseR),
    H - (m.touch ? 260 : 230) * s,
    baseR,
    box
  );

  const travel = joystickTravel(baseR);
  const [attackPos, dashPos, modePos, interactPos, weaponPos, statusPos] = buttons;
  return {
    box,
    baseR,
    thumbR,
    btnSmallR,
    btnAttackR,
    joyX: joy.x,
    joyY: joy.y,
    attackX: attackPos.x,
    attackY: attackPos.y,
    dashX: dashPos.x,
    dashY: dashPos.y,
    modeX: modePos.x,
    modeY: modePos.y,
    interactX: interactPos.x,
    interactY: interactPos.y,
    weaponX: weaponPos.x,
    weaponY: weaponPos.y,
    statusX: statusPos.x,
    statusY: statusPos.y,
    clusterLeft,
    travel,
    deadzone: travel * JOYSTICK_DEADZONE_RATIO,
    joystickZoneRight: Math.min(W * 0.45, clusterLeft),
    joystickTop: joy.y - baseR,
    // 温度计避让按钮组里最高的一枚（☰）：28px = 10 缝隙 + 8 偏移 + 温度态文字高度
    thermoBottomMax: Math.min(interact.y - btnSmallR, status.y - btnSmallR) - 28 * s
  };
}

/**
 * HUD 右下角元素的右边界。
 * 底部按钮组占据右下角时，染料槽/负载行必须左移到按钮组之外，否则小屏上会被按钮压住。
 * @param baseRight 无遮挡时的右边界
 * @param clusterLeft 按钮组左沿
 * @param gap 与按钮组之间保留的空隙
 * @param avoid 是否实际存在需要避让的按钮组
 */
export function hudRightEdge(baseRight: number, clusterLeft: number, gap: number, avoid: boolean): number {
  return avoid ? Math.min(baseRight, clusterLeft - gap) : baseRight;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}