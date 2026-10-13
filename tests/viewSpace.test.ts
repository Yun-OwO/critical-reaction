/**
 * 2.5D 辅助视图空间的等价性与可逆性测试（T01）。
 *
 * 这些断言的作用不是“证明数学好看”，而是**锁死 T06/T07 依赖的前提**：
 *   1. 视图基 + 拟合系数必须与现有屏幕投影公式逐点等价 —— 否则美术/反射
 *      与实际绘制会各走各的，AO 会压错地方；
 *   2. forward 必须是投影的零空间方向 —— 否则“深度”只是随手取的一个数；
 *   3. 视图深度必须能区分“同屏幕位置但抬高了的表面” —— 否则 SSR 无从求交；
 *   4. worldToView / viewToWorld 必须严格互逆。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISO,
  createViewTransform,
  marchScreenRay,
  normalizeNormal,
  reflect,
  screenToViewPlane,
  unprojectToGround,
  viewToScreen,
  viewToWorld,
  worldToScreen,
  worldToScreenDirect,
  worldToView,
  type IsoConfig,
  type SurfacePoint
} from '../src/game/visual/viewSpace';

const ISO: IsoConfig = DEFAULT_ISO;
const T = createViewTransform(ISO);

/** 采样点：覆盖地面、抬起表面、房间对角与原点附近。 */
const POINTS: SurfacePoint[] = [
  { x: 0, z: 0, height: 0 },
  { x: 1, z: 0, height: 0 },
  { x: 0, z: 1, height: 0 },
  { x: 0, z: 0, height: 1 },
  { x: 2400, z: 1200, height: 0 },
  { x: 2400, z: 1200, height: 64 },
  { x: -1200, z: 800, height: 32 },
  { x: 17.5, z: 233.25, height: 9.75 },
  { x: 1234.5, z: -678.25, height: 0 }
];

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

describe('viewSpace：forward 是等距投影的零空间方向', () => {
  it('forward 与两个屏幕行向量都正交', () => {
    const rowX = { x: ISO.axisX, y: ISO.axisZ, z: 0 };
    const rowY = { x: 0, y: ISO.axisY, z: ISO.heightCoef };
    const f = T.forward;
    const d1 = f.x * rowX.x + f.y * rowX.y + f.z * rowX.z;
    const d2 = f.x * rowY.x + f.y * rowY.y + f.z * rowY.z;
    expect(d1).toBe(0);
    expect(d2).toBe(0);
  });

  it('forward / right / up 互相正交且为单位向量', () => {
    const lens = [T.forward, T.right, T.up].map((v) => Math.hypot(v.x, v.y, v.z));
    for (const l of lens) expect(close(l, 1, 1e-12)).toBe(true);
    const pairs: Array<[{ x: number; y: number; z: number }, { x: number; y: number; z: number }]> = [
      [T.forward, T.right],
      [T.forward, T.up],
      [T.right, T.up]
    ];
    for (const [a, b] of pairs) {
      expect(a.x * b.x + a.y * b.y + a.z * b.z).toBe(0);
    }
  });
});

describe('viewSpace：视图路径与现有屏幕公式逐点等价', () => {
  it.each(POINTS.map((p) => [p] as const))('worldToScreen ≡ worldToScreenDirect：%o', (p) => {
    const viaView = worldToScreen(p, T, ISO);
    const direct = worldToScreenDirect(p, ISO);
    expect(close(viaView.sx, direct.sx, 1e-8)).toBe(true);
    expect(close(viaView.sy, direct.sy, 1e-8)).toBe(true);
  });

  it('非零 origin 也能等价（大厅用 origin = 房间中心）', () => {
    const cfg: IsoConfig = { ...ISO, originX: 2400, originY: 1200 };
    const t = createViewTransform(cfg);
    for (const p of POINTS) {
      const a = worldToScreen(p, t, cfg);
      const b = worldToScreenDirect(p, cfg);
      expect(close(a.sx, b.sx, 1e-8)).toBe(true);
      expect(close(a.sy, b.sy, 1e-8)).toBe(true);
    }
  });
});

describe('viewSpace：worldToView 与 viewToWorld 严格互逆', () => {
  it.each(POINTS.map((p) => [p] as const))('round-trip：%o', (p) => {
    const back = viewToWorld(worldToView(p, T), T);
    expect(close(back.x, p.x, 1e-9)).toBe(true);
    expect(close(back.z, p.z, 1e-9)).toBe(true);
    expect(close(back.height, p.height, 1e-9)).toBe(true);
  });
});

describe('viewSpace：视图深度能区分抬高表面', () => {
  it('同一 (x,z) 的高度不同 → vd 不同', () => {
    const ground = worldToView({ x: 500, z: 300, height: 0 }, T);
    const lifted = worldToView({ x: 500, z: 300, height: 64 }, T);
    expect(close(ground.vd, lifted.vd, 1e-9)).toBe(false);
  });

  it('抬高表面比地面更靠近相机（vd 更大）', () => {
    const ground = worldToView({ x: 500, z: 300, height: 0 }, T).vd;
    const lifted = worldToView({ x: 500, z: 300, height: 64 }, T).vd;
    expect(lifted).toBeGreaterThan(ground);
  });

  it('沿 forward 前进会同时改变 vd，但屏幕位置不变（这就是视线方向）', () => {
    const a = { x: 100, z: 100, height: 0 };
    const b = viewToWorld({ ...worldToView(a, T), vd: worldToView(a, T).vd + 10 }, T);
    const sa = worldToScreen(a, T, ISO);
    const sb = worldToScreen(b, T, ISO);
    expect(close(sa.sx, sb.sx, 1e-8)).toBe(true);
    expect(close(sa.sy, sb.sy, 1e-8)).toBe(true);
  });
});

describe('viewSpace：屏幕 → 视图平面与反投影', () => {
  it('screenToViewPlane 与 viewToScreen 互逆（深度固定）', () => {
    const vd = 42;
    for (const p of POINTS) {
      const v = worldToView(p, T);
      const s = viewToScreen({ ...v, vd }, T, ISO);
      const back = screenToViewPlane(s, T, ISO);
      expect(close(back.vx, v.vx, 1e-7)).toBe(true);
      expect(close(back.vy, v.vy, 1e-7)).toBe(true);
    }
  });

  it('unprojectToGround(height=0) 还原出原地面坐标', () => {
    for (const p of POINTS) {
      const s = worldToScreenDirect({ x: p.x, z: p.z, height: 0 }, ISO);
      const back = unprojectToGround(s, 0, T, ISO);
      expect(close(back.x, p.x, 1e-6)).toBe(true);
      expect(close(back.z, p.z, 1e-6)).toBe(true);
    }
  });

  it.each([0, 16, 48, 96])('反投影确实落在 height=%i 的水平面上', (height) => {
    for (const p of POINTS) {
      const s = worldToScreenDirect({ x: p.x, z: p.z, height }, ISO);
      const back = unprojectToGround(s, height, T, ISO);
      // 回代：还原出的 (x,z) 在该高度上的屏幕投影必须回到原屏幕点
      const check = worldToScreenDirect({ x: back.x, z: back.z, height }, ISO);
      expect(close(check.sx, s.sx, 1e-6)).toBe(true);
      expect(close(check.sy, s.sy, 1e-6)).toBe(true);
      // 同高度往返是恒等变换（这是反投影存在的意义）
      expect(close(back.x, p.x, 1e-6)).toBe(true);
      expect(close(back.z, p.z, 1e-6)).toBe(true);
    }
  });

  it('同一屏幕点按不同 height 反投影 → 得到同一视线上的不同点', () => {
    const s = worldToScreenDirect({ x: 400, z: 250, height: 0 }, ISO);
    const onGround = unprojectToGround(s, 0, T, ISO);
    const onTop = unprojectToGround(s, 48, T, ISO);
    expect(close(onGround.x, onTop.x, 1e-6)).toBe(false);
    expect(close(onGround.z, onTop.z, 1e-6)).toBe(false);
    // 但两者的屏幕投影仍回到同一点（这是反投影的定义）
    const back = worldToScreenDirect({ x: onTop.x, z: onTop.z, height: 48 }, ISO);
    expect(close(back.sx, s.sx, 1e-6)).toBe(true);
    expect(close(back.sy, s.sy, 1e-6)).toBe(true);
  });
});

describe('viewSpace：反射与法线工具', () => {
  it('normalizeNormal 归一化，零向量退化为 +Y', () => {
    const n = normalizeNormal({ vx: 3, vy: 4, vd: 0 });
    expect(close(Math.hypot(n.vx, n.vy, n.vd), 1, 1e-12)).toBe(true);
    const zero = normalizeNormal({ vx: 0, vy: 0, vd: 0 });
    expect(zero).toEqual({ vx: 0, vy: 1, vd: 0 });
  });

  it('正入射到 +Y 法线的平面 → 反射方向 vy 反号、其余不变', () => {
    const d = { vx: 0, vy: -1, vd: 0 };
    const n = { vx: 0, vy: 1, vd: 0 };
    const r = reflect(d, n);
    expect(close(r.vx, 0, 1e-12)).toBe(true);
    expect(close(r.vy, 1, 1e-12)).toBe(true);
    expect(close(r.vd, 0, 1e-12)).toBe(true);
  });

  it('反射保持方向模长（单位入射 → 单位反射）', () => {
    const d = normalizeNormal({ vx: 0.3, vy: -0.6, vd: 0.74 });
    const n = normalizeNormal({ vx: 0, vy: 1, vd: 0 });
    const r = reflect(d, n);
    expect(close(Math.hypot(r.vx, r.vy, r.vd), 1, 1e-12)).toBe(true);
  });
});

describe('viewSpace：SSR 屏幕射线步进骨架', () => {
  const opts = {
    u0: 0.5,
    v0: 0.5,
    dirU: 1,
    dirV: 0,
    steps: 16,
    stepScale: 0.02,
    bias: 1,
    thickness: 2,
    depth0: 100
  };

  it('未命中：深度处处与起点相同', () => {
    const r = marchScreenRay({ ...opts, depthAt: () => 100 });
    expect(r.hit).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.step).toBe(opts.steps);
  });

  it('命中：前方出现不同深度', () => {
    const r = marchScreenRay({
      ...opts,
      depthAt: (u) => (u > 0.56 ? 220 : 100)
    });
    expect(r.hit).toBe(true);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.u).toBeGreaterThan(0.56);
  });

  it('自碰被 bias+thickness 挡下', () => {
    // 深度只差 2，正好等于 thickness，不应判为命中
    const r = marchScreenRay({ ...opts, depthAt: () => 102 });
    expect(r.hit).toBe(false);
  });

  it('离屏立即返回未命中且置信度为 0', () => {
    // u0=0.99、stepScale=0.02 → 第 1 步 u=1.01 越界
    const r = marchScreenRay({
      ...opts,
      u0: 0.99,
      depthAt: () => 200
    });
    expect(r.hit).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.step).toBe(1);
  });

  it('Infinity（无有效表面）被跳过而不是当作命中', () => {
    let calls = 0;
    const r = marchScreenRay({
      ...opts,
      depthAt: () => {
        calls += 1;
        return calls < 6 ? Number.POSITIVE_INFINITY : 300;
      }
    });
    expect(r.hit).toBe(true);
    expect(r.step).toBe(6);
  });

  it('贴边命中置信度被压低（反射源可能被裁出视口）', () => {
    const near = marchScreenRay({ ...opts, u0: 0.02, depthAt: (u) => (u > 0.06 ? 200 : 100) });
    const mid = marchScreenRay({ ...opts, u0: 0.4, depthAt: (u) => (u > 0.44 ? 200 : 100) });
    expect(near.hit).toBe(true);
    expect(mid.hit).toBe(true);
    expect(near.confidence).toBeLessThan(mid.confidence);
  });
});