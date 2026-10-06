/**
 * 程序化地图生成：柏林噪声驱动的群系 / 地形 / 地物（借鉴哈迪斯的群系观）。
 *
 * 三层噪声叠加（全部种子化，同种子同地图）：
 *  - 低频 (0.09)：群系分区——固定 5 种化学群系成片分布（结晶带/腐蚀沼/催化热土/惰性灰域/溶剂海）
 *  - 中频 (0.35)：地形变化——亮块高地与暗色洼地，给地面「高低差」的视觉语言
 *  - 高频 (0.3)：地物散布——每个群系按各自密度撒装饰（纹理/液洼）
 *
 * 纯函数模块：不依赖 Phaser，输出渲染指令由 GameScene 消费（一次性绘制，无每帧成本）。
 */

/** mulberry32 种子随机（与战斗 sim 同款算法族，确定性有保证）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 经典 Perlin 2D：种子置换表 + 梯度插值，输出约 [-1, 1]。 */
export class Perlin2D {
  private readonly perm: Uint8Array;

  public constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) p[i] = i;
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i += 1) this.perm[i] = p[i & 255];
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static grad(hash: number, x: number, y: number): number {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  public noise(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = Perlin2D.fade(xf);
    const v = Perlin2D.fade(yf);
    const p = this.perm;
    const aa = p[p[xi] + yi];
    const ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi];
    const bb = p[p[xi + 1] + yi + 1];
    const x1 = Perlin2D.grad(aa, xf, yf) * (1 - u) + Perlin2D.grad(ba, xf - 1, yf) * u;
    const x2 = Perlin2D.grad(ab, xf, yf - 1) * (1 - u) + Perlin2D.grad(bb, xf - 1, yf - 1) * u;
    return x1 * (1 - v) + x2 * v; // 约 [-1, 1]
  }
}

export interface Biome {
  id: string;
  name: string;
  /** 群系底色淡染 */
  tint: number;
  tintAlpha: number;
  /** 地形亮块（高地）强调色 */
  accent: number;
  /** 液洼颜色（null = 无液洼群系） */
  puddleColor: number | null;
  /** 装饰纹理（Chemic 资产键） */
  decorKeys: string[];
  /** 装饰密度 0-1 */
  density: number;
}

/** 固定 5 种化学群系（组合由噪声决定，种类不随机——保证视觉语言可控）。 */
export const BIOMES: readonly Biome[] = [
  { id: 'crystalline', name: '结晶带', tint: 0x1b3a5c, tintAlpha: 0.16, accent: 0x67e8f9, puddleColor: null, decorKeys: ['tex-rock', 'tex-mushroom'], density: 0.5 },
  { id: 'corrosive', name: '腐蚀沼', tint: 0x14361f, tintAlpha: 0.18, accent: 0x5cffb1, puddleColor: 0x5cffb1, decorKeys: ['tex-flower', 'tex-mushroom'], density: 0.6 },
  { id: 'catalytic', name: '催化热土', tint: 0x3a1e10, tintAlpha: 0.2, accent: 0xff8a4c, puddleColor: 0xff8a4c, decorKeys: ['tex-thick', 'tex-rock'], density: 0.45 },
  { id: 'inert', name: '惰性灰域', tint: 0x1c2126, tintAlpha: 0.14, accent: 0x64748b, puddleColor: null, decorKeys: ['tex-rock'], density: 0.3 },
  { id: 'solvent', name: '溶剂海', tint: 0x122a4a, tintAlpha: 0.16, accent: 0x38bdf8, puddleColor: 0x38bdf8, decorKeys: ['tex-flower', 'tex-anthemy'], density: 0.55 }
];

export interface TerrainTint {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  alpha: number;
}

export interface TerrainDecoration {
  x: number;
  y: number;
  texture: string;
  puddle: boolean;
  puddleColor: number;
  biomeId: string;
}

export interface TerrainGeneration {
  /** 每格群系 id（调试/单测用） */
  biomeGrid: string[][];
  /** 群系/地形染色块（一次性 Graphics 绘制） */
  tints: TerrainTint[];
  /** 地物（纹理装饰 + 液洼） */
  decorations: TerrainDecoration[];
  /** 出现过的群系（单测断言分布） */
  biomesPresent: string[];
}

export interface TerrainOptions {
  biomeScale?: number;
  terrainScale?: number;
  decorScale?: number;
  cellW?: number;
  cellH?: number;
  maxDecorations?: number;
}

const DEFAULTS: Required<TerrainOptions> = {
  biomeScale: 0.09,
  terrainScale: 0.35,
  decorScale: 0.3,
  cellW: 96,
  cellH: 48,
  maxDecorations: 34
};

/**
 * 生成整张地图的群系/地形/地物。
 * 约束：地物落在菱形可行区内（isometric 菱形边界 margin 0.94）、避开中心出生区。
 */
export function generateTerrain(
  seed: number,
  worldW: number,
  worldH: number,
  diamondA: number,
  diamondB: number,
  diamondCx: number,
  diamondCy: number,
  options: TerrainOptions = {}
): TerrainGeneration {
  const opt = { ...DEFAULTS, ...options };
  const biomeNoise = new Perlin2D(seed);
  const terrainNoise = new Perlin2D(seed + 7919);
  const decorNoise = new Perlin2D(seed + 104729);
  const rng = mulberry32(seed + 999331);

  const cols = Math.floor(worldW / opt.cellW);
  const rows = Math.floor(worldH / opt.cellH);
  const biomeGrid: string[][] = [];
  const tints: TerrainTint[] = [];
  const decorations: TerrainDecoration[] = [];
  const biomesPresent = new Set<string>();

  for (let row = 0; row < rows; row += 1) {
    biomeGrid[row] = [];
    for (let col = 0; col < cols; col += 1) {
      const cx = col * opt.cellW + opt.cellW / 2;
      const cy = row * opt.cellH + opt.cellH / 2;

      // 群系：低频噪声分 5 档（成片分布）
      const bn = biomeNoise.noise(col * opt.biomeScale, row * opt.biomeScale);
      const band = Math.min(4, Math.max(0, Math.floor(((bn + 1) / 2) * 5)));
      const biome = BIOMES[band];
      biomeGrid[row][col] = biome.id;
      biomesPresent.add(biome.id);

      const inDiamond = Math.abs(cx - diamondCx) / diamondA + Math.abs(cy - diamondCy) / diamondB <= 0.94;
      if (!inDiamond) continue;

      // 地形：中频噪声 → 高地亮块 / 洼地暗块
      const tn = terrainNoise.noise(col * opt.terrainScale, row * opt.terrainScale);
      if (tn > 0.42) {
        tints.push({ x: cx, y: cy, w: opt.cellW, h: opt.cellH, color: biome.accent, alpha: 0.1 });
      } else if (tn < -0.48) {
        tints.push({ x: cx, y: cy, w: opt.cellW, h: opt.cellH, color: 0x000000, alpha: 0.16 });
      }

      // 群系底色淡染：每 2×2 格画一次（成片、控制图形数量）
      if (col % 2 === 0 && row % 2 === 0) {
        tints.push({ x: cx + opt.cellW / 2, y: cy + opt.cellH / 2, w: opt.cellW * 2, h: opt.cellH * 2, color: biome.tint, alpha: biome.tintAlpha });
      }

      // 地物：高频噪声 + 群系密度（液洼或纹理装饰）
      if (decorations.length < opt.maxDecorations) {
        const dn = decorNoise.noise(col * opt.decorScale, row * opt.decorScale);
        if (dn > 0.52 - biome.density * 0.25 && rng() < biome.density) {
          const px = cx + (rng() - 0.5) * opt.cellW * 0.6;
          const py = cy + (rng() - 0.5) * opt.cellH * 0.6;
          if (Math.abs(px - diamondCx) < 260 && Math.abs(py - diamondCy) < 160) continue; // 出生区
          if (biome.puddleColor !== null && rng() < 0.4) {
            decorations.push({ x: px, y: py, texture: '__puddle', puddle: true, puddleColor: biome.puddleColor, biomeId: biome.id });
          } else {
            const texIdx = Math.floor(rng() * biome.decorKeys.length) % biome.decorKeys.length;
            decorations.push({ x: px, y: py, texture: biome.decorKeys[texIdx], puddle: false, puddleColor: 0, biomeId: biome.id });
          }
        }
      }
    }
  }

  return { biomeGrid, tints, decorations, biomesPresent: Array.from(biomesPresent) };
}
