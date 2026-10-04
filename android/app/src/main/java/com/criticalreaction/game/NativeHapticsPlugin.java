package com.criticalreaction.game;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 原生震动桥：navigator.vibrate 被 Chromium 手势策略拦截（非用户手势回调一律拒绝，
 * 命中反馈发生在 rAF 内部循环中，永远拿不到 user activation）， Vibrator 系统服务无此限制。
 * JS 侧通过 window.Capacitor.Plugins.NativeHaptics 调用，模式与 navigator.vibrate 完全一致。
 */
@CapacitorPlugin(name = "NativeHaptics")
public class NativeHapticsPlugin extends Plugin {

    private Vibrator vibrator() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager != null ? manager.getDefaultVibrator() : null;
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        Vibrator vibrator = vibrator();
        if (vibrator == null || !vibrator.hasVibrator()) {
            call.resolve();
            return;
        }
        try {
            // pattern: 数字（单段时长 ms）或数组（waveform：震动/停顿交替，同 navigator.vibrate）
            Object pattern = call.getData().get("pattern");
            if (pattern instanceof Number) {
                long ms = Math.max(1, Math.min(5000, (long) ((Number) pattern).doubleValue()));
                vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else if (pattern instanceof JSArray) {
                JSArray arr = (JSArray) pattern;
                int n = arr.length();
                long[] timings = new long[n];
                for (int i = 0; i < n; i++) {
                    double v = arr.getDouble(i);
                    timings[i] = Math.max(0, Math.min(5000, (long) v));
                }
                vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
            } else {
                vibrator.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE));
            }
        } catch (Exception ignored) {
            // 震动失败静默：反馈增强不应影响游戏逻辑
        }
        call.resolve();
    }
}
