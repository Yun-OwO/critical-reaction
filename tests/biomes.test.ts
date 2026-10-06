import { describe, expect, it } from 'vitest';
import { generateTerrain, Perlin2D, mulberry32, BIOMES } from '../src/game/world/biomes';

const W = 4800;
const H = 2400;
const A = 2400;
const B = 1200;

describe('柏林噪声基础', () => {
  it('输出落在约 [-1, 1] 且同种子确定', () => {
    const n1 = new Perlin2D(42);
    for (let i = 0; i < 200; i++) {
      const v = n1.noise(i * 0.13, i * 0.07);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.001);
    }
    const n2 = new Perlin2D(42);
    expect(n2.noise(3.7, 9.2)).toBe(n1.noise(3.7, 9.2));
  });

  it('不同种子产生不同噪声', () => {
    const a = new Perlin2D(1);
    const b = new Perlin2D(2);
    let differs = 0;
    for (let i = 0; i < 50; i++) {
      if (a.noise(i * 0.3, i * 0.3) !== b.noise(i * 0.3, i * 0.3)) differs += 1;
    }
    expect(differs).toBeGreaterThan(40);
  });

  it('mulberry32 同种子确定、不同种子不同', () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    const r3 = mulberry32(8);
    expect(r1()).toBe(r2());
    expect(r1()).not.toBe(r3());
  });
});

describe('程序化地图生成（群系/地形/地物）', () => {
  const gen = generateTerrain(12345, W, H, A, B, W / 2, H / 2);

  it('同种子生成完全一致（确定性）', () => {
    const again = generateTerrain(12345, W, H, A, B, W / 2, H / 2);
    expect(JSON.stringify(again.tints)).toBe(JSON.stringify(gen.tints));
    expect(JSON.stringify(again.decorations)).toBe(JSON.stringify(gen.decorations));
    expect(JSON.stringify(again.tiles)).toBe(JSON.stringify(gen.tiles));
  });

  it('大地图上全部 5 种群系都有分布', () => {
    expect(gen.biomesPresent.sort()).toEqual(BIOMES.map((b) => b.id).sort());
  });

  it('地物落在菱形可行区内且避开中心出生区', () => {
    for (const d of gen.decorations) {
      expect(Math.abs(d.x - W / 2) / A + Math.abs(d.y - H / 2) / B).toBeLessThanOrEqual(0.95);
      if (Math.abs(d.x - W / 2) < 260 && Math.abs(d.y - H / 2) < 160) {
        throw new Error('地物侵入中心出生区: ' + d.x + ',' + d.y);
      }
    }
  });

  it('地物数量受上限约束且非空', () => {
    expect(gen.decorations.length).toBeGreaterThan(5);
    expect(gen.decorations.length).toBeLessThanOrEqual(34);
  });

  it('液洼只出现在有液洼色的群系', () => {
    const puddleBiomes = new Set(BIOMES.filter((b) => b.puddleColor !== null).map((b) => b.id));
    for (const d of gen.decorations) {
      if (d.puddle) expect(puddleBiomes.has(d.biomeId)).toBe(true);
    }
  });
});

describe('体积化地形与实物瓦片（v0.2.3）', () => {
  const gen = generateTerrain(777, W, H, A, B, W / 2, H / 2);

  it('高地格生成棱柱：顶面用群系 accent，厚度三档', () => {
    expect(gen.blocks.length).toBeGreaterThan(10);
    const biomeById = new Map(BIOMES.map((b) => [b.id, b]));
    for (const blk of gen.blocks.slice(0, 30)) {
      expect(blk.height).toBeGreaterThanOrEqual(12);
      expect(blk.height).toBeLessThanOrEqual(28);
      // 顶面色属于该格群系 accent（查 tint 同色的群系）
      const biome = biomeById.get(blk.biomeId);
      expect(biome).toBeDefined();
      expect(blk.top).toBe(biome!.accent);
    }
  });

  it('实物瓦片只来自所在群系的地形池', () => {
    const biomeById = new Map(BIOMES.map((b) => [b.id, b]));
    for (const tile of gen.tiles) {
      const biome = biomeById.get(tile.biomeId);
      expect(biome).toBeDefined();
      expect(biome!.terrainTiles).toContain(tile.texture);
      expect(Math.abs(tile.rot)).toBeLessThanOrEqual(0.105);
    }
  });

  it('大型地物只来自所在群系的地物池，数量稀疏', () => {
    const biomeById = new Map(BIOMES.map((b) => [b.id, b]));
    expect(gen.props.length).toBeGreaterThan(0);
    expect(gen.props.length).toBeLessThanOrEqual(14);
    for (const prop of gen.props) {
      const biome = biomeById.get(prop.biomeId);
      expect(biome).toBeDefined();
      expect(biome!.propTiles).toContain(prop.texture);
    }
  });

  it('每个群系的地形池非空且纹理键合法', () => {
    const known = ['biome-tloor', 'biome-tbc'];
    for (const b of BIOMES) {
      expect(b.terrainTiles.length).toBeGreaterThan(0);
      for (const t of b.terrainTiles) expect(known).toContain(t);
    }
  });
});
