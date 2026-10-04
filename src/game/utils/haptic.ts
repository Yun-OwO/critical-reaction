export type HapticInput = number | number[];

// Android Chrome 的 navigator.vibrate 需要用户手势（user activation）上下文。
// Phaser 回调在内部事件循环（rAF preupdate）中派发，已脱离原生手势上下文，震动会被静默忽略。
// APK（Capacitor）内走原生 Vibrator 桥（NativeHapticsPlugin，无手势限制）；
// 浏览器内维持原策略：调用失败时暂存 pattern，待下次原生手势时由 flushHaptic 补发。
interface NativeBridge {
  Plugins?: {
    NativeHaptics?: {
      vibrate(options: { pattern: HapticInput }): Promise<unknown>;
    };
  };
}

function nativeVibrate(pattern: HapticInput): boolean {
  const bridge = (window as unknown as { Capacitor?: NativeBridge }).Capacitor;
  const plugin = bridge?.Plugins?.NativeHaptics;
  if (!plugin) return false;
  // 原生 Vibrator 无手势限制，直接发；失败不降级（避免双震动/重复补发）
  void plugin.vibrate({ pattern }).catch(() => { /* noop */ });
  return true;
}

let pending: HapticInput | null = null;

export function haptic(pattern: HapticInput = 15): void {
  if (nativeVibrate(pattern)) return;
  try {
    if (navigator.vibrate) {
      if (navigator.vibrate(pattern) === false) {
        pending = pattern;
      }
    }
  } catch { /* noop */ }
}

/** 在原生用户手势回调中调用：补发暂存的震动，并借此刷新激活状态 */
export function flushHaptic(): void {
  if (pending == null) return;
  const pattern = pending;
  pending = null;
  try { navigator.vibrate(pattern); } catch { /* noop */ }
}

/** 武器开火震动：短促双段脉冲 */
export function hapticFire(): void {
  haptic([20, 30]);
}

/** 命中/重击震动：多段脉冲，打击感更强 */
export function hapticHit(): void {
  haptic([40, 40, 70]);
}

/** 受击震动 */
export function hapticHurt(): void {
  haptic([35, 40, 35]);
}
