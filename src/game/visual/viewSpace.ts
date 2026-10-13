/**
 * 2.5D 视觉辅助空间（全局升级执行规格 T01）
 *
 * 为什么需要这个文件：
 * SSR / AO / 粗糙反射都要在一个**有真实深度的视图空间**里做计算。
 * 但本作的坐标系现状是：`GameScene` 的世界就是一张 4800×2400 的**屏幕平面**
 * （角色、地形、道具都直接用屏幕 x/y 移动），障碍的“高度”只是绘制时把顶面
 * 菱形往上平移的 `lift`（`isoBlock()` 里 `y - h/2 - lift`）。
 *
 * 也就是说：直接拿屏幕 Y 当深度是错的（它同时混了 z 与 lift）；
 * 拿 Phaser 的 `depth`（排序值）当深度更错（它混了图层常量）。
 *
 * 这里把本作现有的等距投影写成**一个真正的正交相机**。现有投影是：
 *
 *   屏幕 sx = originX + x·axisX + z·axisZ
 *   屏幕 sy = originY + z·axisY + height·heightCoef
 *
 * 对世界坐标 (x, z, height) 这是一个 2×3 的正交投影。2×3 必然有零空间，
 * 那个零空间方向就是相机的**前向轴**——也就是可以当作“深度”的量。
 * 求出并归一化它，再配上由它导出的正交 right/up 基，就得到一个
 * 完全等价、且深度为 `dot(p, forward)` 的正交视图空间。
 *
 * 关键性质（都有单测守着，见 tests/viewSpace.test.ts）：
 *   - 世界 → 视图 → 屏幕 与「直接用屏幕公式」**逐点等价**；
 *   - 视图深度 vd 是相机前向距离，能区分「地面点」与「同屏幕位置但被抬高的顶面」；
 *   - 视图空间 → 世界是唯一解，屏幕平面对应的 vx/vy 可逆解出。
 *
 * 边界（必须如实记住，不得冒称完整 3D）：
 *   - 本作没有真正的三维几何。物体是 2D 精灵，height 是表现字段，不参与碰撞。
 *   - 因此 SSR 是对**辅助表面缓冲**做的射线求交：算法是真的，场景是 2.5D 简化的。
 *     任何文档/设置不得写成“完整 3D SSR”。
 *   - 世界 → 屏幕是 2×3 投影，**不可逆**。`unprojectToGround()` 需要外部给定
 *     height 假设，才能还原地面的 (x, z)。
 */

/** 本作实际使用的等距投影参数（与 GameScene.apply2p5D / LobbyScene.toScreen 一致）。 */
export interface IsoConfig {
  originX: number;
  originY: number;
  /** x 轴在屏幕 sx 上的投影长度（本作 = 1） */
  axisX: number;
  /** z 轴在屏幕 sx 上的投影（本作 = 0.52） */
  axisZ: number;
  /** z 轴在屏幕 sy 上的投影（本作 = 0.5） */
  axisY: number;
  /** 离地高度在屏幕 sy 上的系数：负号表示抬高（本作 height 越高 sy 越小） */
  heightCoef: number;
}

export const DEFAULT_ISO: Readonly<IsoConfig> = Object.freeze({
  originX: 0,
  originY: 0,
  axisX: 1,
  axisZ: 0.52,
  axisY: 0.5,
  heightCoef: -1
});

/** 地面/表面点：x、z 是地面平面坐标，height 是离地高度（单位：world-unit / 像素）。 */
export interface SurfacePoint {
  x: number;
  z: number;
  height: number;
}

/** 视图空间坐标：vx/vy 是屏幕平面内的正交分量，vd 是相机前向深度。 */
export interface ViewPoint {
  vx: number;
  vy: number;
  vd: number;
}

/** 屏幕点。 */
export interface ScreenPoint {
  sx: number;
  sy: number;
}

/** 正交视图变换：世界(x, z, height) ↔ 视图(vx, vy, vd) ↔ 屏幕(sx, sy)。 */
export interface ViewTransform {
  /** 正交基向量（已归一化，长度 = 1） */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** 屏幕 sx = originX + alpha·vx + beta·vy */
  alpha: number;
  beta: number;
  /** 屏幕 sy = originY + gamma·vx + delta·vy */
  gamma: number;
  delta: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** SurfacePoint → 内部三元组 (x, z, height)。 */
const toVec3 = (p: SurfacePoint): Vec3 => ({ x: p.x, y: p.z, z: p.height });

const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 0)) throw new Error('viewSpace: 无法归一化零向量');
  return { x: v.x / len, y: v.y / len, z: v.z / len };
};

const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});

/**
 * 2×3 正交投影的零空间方向（未归一化）。
 *
 * 屏幕行向量：rowX = (axisX, axisZ, 0)，rowY = (0, axisY, heightCoef)
 * 求 f 使 f·rowX = 0 且 f·rowY = 0：
 *   axisX·fx + axisZ·fy = 0        → fx = -axisZ·fy / axisX
 *   axisY·fy + heightCoef·fz = 0  → fz = -axisY·fy / heightCoef
 * 取 fy = 1。
 */
function forwardAxis(cfg: IsoConfig): Vec3 {
  return { x: -cfg.axisZ / cfg.axisX, y: 1, z: -cfg.axisY / cfg.heightCoef };
}

/** 从等距配置构造正交视图变换（默认参数即本作实际使用的投影）。 */
export function createViewTransform(cfg: IsoConfig = DEFAULT_ISO): ViewTransform {
  const forward = normalize(forwardAxis(cfg));
  // 世界 up 取高度轴 (0,0,1)；退化时（forward 与其接近平行）改用 z 轴。
  const worldUp: Vec3 = Math.abs(forward.z) < 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = normalize(cross3(forward, worldUp));
  const up = cross3(right, forward);

  // 两个屏幕行向量都与 forward 正交，必然落在 span{right, up} 内，
  // 所以“屏幕分量 = 与该行向量的点积”是精确成立的（不是最小二乘近似）。
  const rowX: Vec3 = { x: cfg.axisX, y: cfg.axisZ, z: 0 };
  const rowY: Vec3 = { x: 0, y: cfg.axisY, z: cfg.heightCoef };

  return {
    right,
    up,
    forward,
    alpha: dot3(rowX, right),
    beta: dot3(rowX, up),
    gamma: dot3(rowY, right),
    delta: dot3(rowY, up)
  };
}

/** 世界点 → 视图空间。 */
export function worldToView(p: SurfacePoint, t: ViewTransform): ViewPoint {
  const v = toVec3(p);
  return {
    vx: dot3(v, t.right),
    vy: dot3(v, t.up),
    vd: dot3(v, t.forward)
  };
}

/** 视图空间 → 世界点。与 worldToView 严格互逆。 */
export function viewToWorld(v: ViewPoint, t: ViewTransform): SurfacePoint {
  return {
    x: v.vx * t.right.x + v.vy * t.up.x + v.vd * t.forward.x,
    z: v.vx * t.right.y + v.vy * t.up.y + v.vd * t.forward.y,
    height: v.vx * t.right.z + v.vy * t.up.z + v.vd * t.forward.z
  };
}

/**
 * 世界点 → 屏幕。
 * 走视图基 + 拟合系数（而不是直接套屏幕公式），使深度与屏幕同源；
 * 单测证明两条路径逐点等价。
 */
export function worldToScreen(p: SurfacePoint, t: ViewTransform, cfg: IsoConfig = DEFAULT_ISO): ScreenPoint {
  return viewToScreen(worldToView(p, t), t, cfg);
}

/** 视图空间 → 屏幕。 */
export function viewToScreen(v: ViewPoint, t: ViewTransform, cfg: IsoConfig = DEFAULT_ISO): ScreenPoint {
  return {
    sx: cfg.originX + t.alpha * v.vx + t.beta * v.vy,
    sy: cfg.originY + t.gamma * v.vx + t.delta * v.vy
  };
}

/** 直接的屏幕投影公式（保留为“参照实现”，供等价性测试比对）。 */
export function worldToScreenDirect(p: SurfacePoint, cfg: IsoConfig = DEFAULT_ISO): ScreenPoint {
  return {
    sx: cfg.originX + p.x * cfg.axisX + p.z * cfg.axisZ,
    sy: cfg.originY + p.z * cfg.axisY + cfg.heightCoef * p.height
  };
}

/**
 * 屏幕 → 视图平面对应分量（不含 vd）。用于 AO 半径采样等不需要深度的场合。
 *
 * 解 2×2：alpha·vx + beta·vy = rx，gamma·vx + delta·vy = ry
 */
export function screenToViewPlane(
  s: ScreenPoint,
  t: ViewTransform,
  cfg: IsoConfig = DEFAULT_ISO
): { vx: number; vy: number } {
  const det = t.alpha * t.delta - t.beta * t.gamma;
  if (Math.abs(det) < 1e-9) throw new Error('viewSpace: 屏幕投影不可逆（alpha·delta − beta·gamma ≈ 0）');
  const rx = s.sx - cfg.originX;
  const ry = s.sy - cfg.originY;
  return {
    vx: (t.delta * rx - t.beta * ry) / det,
    vy: (t.alpha * ry - t.gamma * rx) / det
  };
}

/**
 * 屏幕点 → 地面平面 (x, z)，**必须给定高度假设** height。
 *
 * 因为世界→屏幕是 2×3 投影（不可逆），同一屏幕位置对应一条视线上的所有点。
 * 调用方必须说明自己在解哪一层（地面 height=0 / 障碍顶面 height=blk.height）。
 */
export function unprojectToGround(
  s: ScreenPoint,
  height: number,
  t: ViewTransform,
  cfg: IsoConfig = DEFAULT_ISO
): { x: number; z: number } {
  // 视平面上的点满足：screen = originX + alpha·vx + beta·vy（与 vd 无关）。
  // 世界点 p = vx·right + vy·up + vd·forward，其离地高度是
  //     height(p) = vx·right.z + vy·up.z + vd·forward.z
  // 要落在 height = H 这一水平面上，解出 vd。视平面的 (vx, vy) 自身已含一部分
  // 高度贡献（right.z / up.z 一般不为 0），必须减掉，不能直接用 H / forward.z。
  const plane = screenToViewPlane(s, t, cfg);
  const fz = t.forward.z;
  if (Math.abs(fz) < 1e-9) throw new Error('viewSpace: forward 与高度轴平行，无法按 height 反投影');
  const planeHeight = plane.vx * t.right.z + plane.vy * t.up.z;
  const vd = (height - planeHeight) / fz;
  const p = viewToWorld({ vx: plane.vx, vy: plane.vy, vd }, t);
  return { x: p.x, z: p.z };
}

/** 视图空间反射：R = D − 2(D·N)N。`d` 与 `n` 需为归一化向量。 */
export function reflect(d: ViewPoint, n: ViewPoint): ViewPoint {
  const k = 2 * (d.vx * n.vx + d.vy * n.vy + d.vd * n.vd);
  return {
    vx: d.vx - k * n.vx,
    vy: d.vy - k * n.vy,
    vd: d.vd - k * n.vd
  };
}

/** 视图法线归一化；零向量时退化为 +Y（屏幕向上），避免 NaN 传播。 */
export function normalizeNormal(n: ViewPoint): ViewPoint {
  const len = Math.hypot(n.vx, n.vy, n.vd);
  if (!(len > 0)) return { vx: 0, vy: 1, vd: 0 };
  return { vx: n.vx / len, vy: n.vy / len, vd: n.vd / len };
}

/** SSR 屏幕空间步进骨架（纯函数，便于单测；实际纹理采样由 T06 合成层提供）。 */
export interface RayHit {
  hit: boolean;
  /** 命中 UV（超出 [0,1] 时为越界值，confidence 已为 0） */
  u: number;
  v: number;
  /** 命中处步数（1 起）；未命中时为已走步数 */
  step: number;
  /** 0..1；离屏与贴边会降低置信度 */
  confidence: number;
}

export interface RayMarchOptions {
  /** 起点 UV（通常是被反射像素本身） */
  u0: number;
  v0: number;
  /** 反射方向在屏幕平面上的单位方向 */
  dirU: number;
  dirV: number;
  /** 最大步数 */
  steps: number;
  /** 每步 UV 增量倍率（dir 需已归一） */
  stepScale: number;
  /** 掠射自交偏置（视图单位） */
  bias: number;
  /** 命中厚度（视图单位）：深度差小于 bias+thickness 不算命中，避免自碰 */
  thickness: number;
  /** 起点视图深度 */
  depth0: number;
  /** 采样该 UV 处的视图深度；无有效表面返回 Infinity */
  depthAt: (u: number, v: number) => number;
}

export function marchScreenRay(o: RayMarchOptions): RayHit {
  for (let i = 1; i <= o.steps; i += 1) {
    const u = o.u0 + o.dirU * o.stepScale * i;
    const v = o.v0 + o.dirV * o.stepScale * i;
    if (u < 0 || u > 1 || v < 0 || v > 1) return { hit: false, u, v, step: i, confidence: 0 };
    const d = o.depthAt(u, v);
    if (!Number.isFinite(d)) continue;
    if (Math.abs(d - o.depth0) > o.bias + o.thickness) {
      // 越靠近画面边缘置信度越低（反射源可能已被裁出视口）
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const confidence = Math.max(0, Math.min(1, edge * 4));
      return { hit: true, u, v, step: i, confidence };
    }
  }
  return { hit: false, u: o.u0, v: o.v0, step: o.steps, confidence: 0 };
}