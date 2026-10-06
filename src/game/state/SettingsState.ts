import type Phaser from 'phaser';

const STORAGE_PREFIX = 'critical-reaction-setting-';

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (v === null) return defaultValue;
    return v !== 'off';
  } catch { return defaultValue; }
}

function writeBool(key: string, value: boolean): void {
  try { window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value ? 'on' : 'off'); } catch { /* noop */ }
}

function readString(key: string, defaultValue: string): string {
  try { return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? defaultValue; } catch { return defaultValue; }
}

function writeString(key: string, value: string): void {
  try { window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value); } catch { /* noop */ }
}

export type AspectRatio = '16:9' | '20:9' | 'auto';

export interface GameSettings {
  bloomEnabled: boolean;
  ambientEnabled: boolean;
  shadowEnabled: boolean;
  shakeEnabled: boolean;
  electronFeedbackEnabled: boolean;
  hintsEnabled: boolean;
  volume: number;
  effectsEnabled: boolean;
  ambientSoundEnabled: boolean;
  dashSoundEnabled: boolean;
  aspectRatio: AspectRatio;
  /** 开发者选项：右上角调试叠层（FPS 等） */
  devOverlayEnabled: boolean;
  /** 开发者选项：显示物理碰撞箱 */
  devHitboxEnabled: boolean;
}

const DEFAULTS: GameSettings = {
  bloomEnabled: true,
  ambientEnabled: true,
  shadowEnabled: true,
  shakeEnabled: true,
  electronFeedbackEnabled: true,
  hintsEnabled: true,
  volume: 100,
  effectsEnabled: true,
  ambientSoundEnabled: true,
  dashSoundEnabled: true,
  aspectRatio: 'auto',
  devOverlayEnabled: false,
  devHitboxEnabled: false
};

/**
 * 根据宽高比返回游戏内部分辨率。
 * 始终保持设备宽高比且长边 1920：完整视野 + 高清渲染（整体降分辨率会同时压缩视野并导致模糊）。
 * 渲染开销的取舍交给质量档（Bloom 后处理 / 光晕层数 / 粒子量 / 每帧重建），它们与分辨率无关。
 */
export function getResolutionForAspectRatio(ratio: AspectRatio): { width: number; height: number } {
  switch (ratio) {
    case '16:9': return { width: 1920, height: 1080 };
    case '20:9': return { width: 1920, height: 864 };
    case 'auto': {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // 按设备宽高比缩放到长边 1920（短边 ≤900 防止超宽屏过高），无黑边、控件贴真实屏幕角
      const long = Math.max(w, h);
      const short = Math.min(w, h);
      const shortPx = Math.min(900, Math.round(short * (1920 / long)));
      const landscape = w >= h;
      return { width: landscape ? 1920 : shortPx, height: landscape ? shortPx : 1920 };
    }
  }
}

export function getSettings(): GameSettings {
  return {
    bloomEnabled: readBool('bloom', DEFAULTS.bloomEnabled),
    ambientEnabled: readBool('ambient', DEFAULTS.ambientEnabled),
    shadowEnabled: readBool('shadow', DEFAULTS.shadowEnabled),
    shakeEnabled: readBool('shake', DEFAULTS.shakeEnabled),
    electronFeedbackEnabled: readBool('electron-feedback', DEFAULTS.electronFeedbackEnabled),
    hintsEnabled: readBool('hints', DEFAULTS.hintsEnabled),
    volume: parseInt(readString('volume', '100'), 10) || 100,
    effectsEnabled: readBool('effects', DEFAULTS.effectsEnabled),
    ambientSoundEnabled: readBool('ambient-sound', DEFAULTS.ambientSoundEnabled),
    dashSoundEnabled: readBool('dash-sound', DEFAULTS.dashSoundEnabled),
    aspectRatio: readString('aspect-ratio', DEFAULTS.aspectRatio) as AspectRatio,
    devOverlayEnabled: readBool('dev-overlay', DEFAULTS.devOverlayEnabled),
    devHitboxEnabled: readBool('dev-hitbox', DEFAULTS.devHitboxEnabled)
  };
}

/**
 * 按当前视口重算内部分辨率并应用到画布（比例只在视口真正变化后计算才有意义：
 * 触发全屏 / 退出全屏时窗口尺寸会变，模块加载时算的那份已经过期）。
 * 分辨率未变化时是安全的空操作，可放心重复调用。
 */
export function applyAdaptiveResolution(game: Phaser.Game): void {
  if (!game?.scale) return;
  const res = getResolutionForAspectRatio(getSettings().aspectRatio);
  if (game.scale.width === res.width && game.scale.height === res.height) return;
  // resize 内部会按 Scale 模式（FIT）重排画布并广播 resize 事件，
  // 各场景借此重算相机缩放 / UI 布局
  game.scale.resize(res.width, res.height);
}

const SHORT_KEY_MAP: Record<string, keyof GameSettings> = {
  bloom: 'bloomEnabled',
  shadow: 'shadowEnabled',
  ambient: 'ambientEnabled',
  shake: 'shakeEnabled',
  'electron-feedback': 'electronFeedbackEnabled',
  hints: 'hintsEnabled',
  effects: 'effectsEnabled',
  'ambient-sound': 'ambientSoundEnabled',
  'dash-sound': 'dashSoundEnabled',
};

export function toggleSetting(key: string): void {
  const settingsKey = SHORT_KEY_MAP[key] ?? (key as keyof GameSettings);
  const current = getSettings();
  const val = current[settingsKey];
  if (typeof val === 'boolean') {
    writeBool(key, !val);
  } else if (typeof val === 'number') {
    writeString(key, String(val));
  }
}
