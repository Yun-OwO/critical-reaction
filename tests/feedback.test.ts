import { describe, expect, it } from 'vitest';
import {
  ATTACK_BUFFER_SEC,
  DASH_BUFFER_SEC,
  FEEDBACK,
  ShakeGovernor,
  hitTierFor,
  pitchJitter,
  squashCurve,
  stretchCurve
} from '../src/game/visual/feedback';

describe('手感与反馈分层', () => {
  it('屏震治理：更强的冲击可以覆盖正在进行的弱震', () => {
    const gov = new ShakeGovernor();
    expect(gov.request(100, 0.01)).not.toBeNull();
    expect(gov.currentMagnitude).toBeCloseTo(0.01, 6);
    expect(gov.request(100, 0.2)).not.toBeNull();
    expect(gov.currentMagnitude).toBeCloseTo(0.2, 6);
  });

  it('屏震治理：弱冲击不打断正在进行的强震（否则连击会洗掉重击震感）', () => {
    const gov = new ShakeGovernor();
    gov.request(200, 0.5);
    expect(gov.request(50, 0.05)).toBeNull();
    // 强度保持不变，只小幅续期
    expect(gov.currentMagnitude).toBeCloseTo(0.5, 6);
  });

  it('屏震治理：震动结束后弱冲击可以重新触发', () => {
    const gov = new ShakeGovernor();
    gov.request(0.1, 0.5);
    gov.tick(0.2);
    expect(gov.currentMagnitude).toBe(0);
    expect(gov.request(50, 0.02)).not.toBeNull();
  });

  it('屏震治理：强度与时长非正的请求被忽略', () => {
    const gov = new ShakeGovernor();
    expect(gov.request(0, 0.5)).toBeNull();
    expect(gov.request(100, 0)).toBeNull();
    expect(gov.currentMagnitude).toBe(0);
  });

  it('反馈层级严格递增：普通命中必须明显弱于击杀与玩家受伤', () => {
    expect(FEEDBACK.light.shakeIntensity).toBeLessThan(FEEDBACK.normal.shakeIntensity);
    expect(FEEDBACK.normal.shakeIntensity).toBeLessThan(FEEDBACK.kill.shakeIntensity);
    expect(FEEDBACK.kill.shakeIntensity).toBeLessThan(FEEDBACK.playerHurt.shakeIntensity);
    expect(FEEDBACK.playerHurt.shakeIntensity).toBeLessThan(FEEDBACK.meltdown.shakeIntensity);
    expect(FEEDBACK.light.zoomFactor).toBe(1);
  });

  it('命中定格落在业界标定区间（约 40–120ms，避免"顿感"变"卡顿"）', () => {
    for (const tier of ['light', 'normal', 'elite', 'kill', 'bossHit', 'playerHurt', 'meltdown'] as const) {
      expect(FEEDBACK[tier].hitStop).toBeGreaterThanOrEqual(0.02);
      expect(FEEDBACK[tier].hitStop).toBeLessThanOrEqual(0.12);
    }
  });

  it('输入缓冲窗口落在 80–150ms（宽容但不纵容）', () => {
    expect(ATTACK_BUFFER_SEC).toBeGreaterThanOrEqual(0.08);
    expect(ATTACK_BUFFER_SEC).toBeLessThanOrEqual(0.15);
    expect(DASH_BUFFER_SEC).toBeGreaterThanOrEqual(0.08);
    expect(DASH_BUFFER_SEC).toBeLessThanOrEqual(0.15);
  });

  it('挤压曲线首尾回到 1，中途达到最大形变', () => {
    expect(squashCurve(0, 0.2).x).toBeCloseTo(1, 6);
    expect(squashCurve(0.2, 0.2).x).toBeCloseTo(1, 6);
    const mid = squashCurve(0.1, 0.2, 0.2);
    expect(mid.x).toBeCloseTo(1.2, 6);
    expect(mid.y).toBeCloseTo(0.8, 6);
  });

  it('挤压曲线对越界时间做夹取（不产生爆值）', () => {
    expect(squashCurve(-5, 0.2).x).toBeCloseTo(1, 6);
    expect(squashCurve(99, 0.2).x).toBeCloseTo(1, 6);
    expect(squashCurve(0.1, 0).x).toBe(1);
  });

  it('拉伸与挤压在数值上互补（方向感相反）', () => {
    const squash = squashCurve(0.1, 0.2, 0.2);
    const stretch = stretchCurve(0.1, 0.2, 0.2);
    expect(stretch.x).toBeCloseTo(squash.y, 6);
    expect(stretch.y).toBeCloseTo(squash.x, 6);
  });

  it('音高抖动幅度受控且可注入 rng 复现', () => {
    expect(pitchJitter(220, () => 0.5)).toBeCloseTo(220, 6); // 中位不偏移
    expect(pitchJitter(220, () => 0, 0.06)).toBeCloseTo(220 * 0.94, 6);
    expect(pitchJitter(220, () => 1, 0.06)).toBeCloseTo(220 * 1.06, 6);
  });

  it('由目标身份推导反馈等级', () => {
    expect(hitTierFor(true, false)).toBe('bossHit');
    expect(hitTierFor(false, true)).toBe('elite');
    expect(hitTierFor(false, false)).toBe('normal');
  });
});