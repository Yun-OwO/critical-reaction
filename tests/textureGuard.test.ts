import { describe, expect, it } from 'vitest';
import { TERRAIN_TEXTURE_KEYS } from '../src/game/utils/TextureGuard';
import { loadGameAssets } from '../src/game/utils/AssetLoader';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 纹理 key 对账 + 尺寸一致性。
 *
 * 这两件事都是「纹理缺失会直接毁掉一个房间」的问题：
 * - 代码引用了不存在的 key，运行时就是一张 Phaser 错误贴图；
 * - 降级占位块尺寸和原纹理不一致，虽然不再是棋盘格，但世界尺度会塌。
 */

/** 从 AssetLoader.ts 源码里抓出所有 load 的 key —— 对账必须基于真实加载列表，
 *  抄一份常量进测试只会让两边一起过期。 */
function registeredKeys(): string[] {
  const src = readFileSync(resolve(__dirname, '../src/game/utils/AssetLoader.ts'), 'utf8');
  const keys = [...src.matchAll(/scene\.load\.(?:svg|image|atlas|spritesheet)\(\s*'([^']+)'/g)].map((m) => m[1]);
  return [...new Set(keys)];
}

/** 代码里引用的地物 key（biomes 配置表 + GameScene 的战斗布景）。 */
function referencedKeys(): string[] {
  const biomeSrc = readFileSync(resolve(__dirname, '../src/game/world/biomes.ts'), 'utf8');
  const keys = [...biomeSrc.matchAll(/'(chem-[a-z]+|tex-beaker|tex-flask|biome-tloor|biome-tbc)'/g)].map((m) => m[1]);
  const gameSrc = readFileSync(resolve(__dirname, '../src/game/scenes/GameScene.ts'), 'utf8');
  for (const k of ['chem-lattice', 'chem-molecule', 'chem-benzene', 'chem-burette']) {
    if (gameSrc.includes(`'${k}'`)) keys.push(k);
  }
  return [...new Set(keys)];
}

describe('纹理 key 对账', () => {
  it('AssetLoader 里注册了全部地物 key', () => {
    const registered = new Set(registeredKeys());
    for (const key of TERRAIN_TEXTURE_KEYS) {
      expect(registered.has(key), `${key} 未在 AssetLoader 注册`).toBe(true);
    }
  });

  it('代码引用的每个地物 key 都在加载列表里（避免运行时 __MISSING）', () => {
    const registered = new Set(registeredKeys());
    for (const key of referencedKeys()) {
      if (key === '__puddle') continue;
      expect(registered.has(key), `${key} 被引用但没有加载`).toBe(true);
    }
  });

  it('加载列表没有重复 key', () => {
    const keys = registeredKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('资源文件真实存在', () => {
  it('AssetLoader 里引用的每个文件都在 assets/ 下', () => {
    const src = readFileSync(resolve(__dirname, '../src/game/utils/AssetLoader.ts'), 'utf8');
    const rels = [...src.matchAll(/scene\.load\.\w+\(\s*'[^']+'\s*,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(rels.length).toBeGreaterThan(10);
    for (const rel of rels) {
      expect(existsSync(resolve(__dirname, '../assets', rel)), `资源缺失: ${rel}`).toBe(true);
    }
  });
});

describe('SVG 画布尺寸与代码假设一致', () => {
  /**
   * GameScene 用 propImg.width/height 推导 2.5D 投影与阴影尺寸，
   * 而 SVG 的 viewBox 决定加载后的实际像素尺寸。两者如果脱节，
   * 小地物会被放大成大块、宽扁图会被当成方块。
   */
  it('每个地物 SVG 的 viewBox 与 AssetLoader 里声明的 raster 尺寸一致', () => {
    const src = readFileSync(resolve(__dirname, '../src/game/utils/AssetLoader.ts'), 'utf8');
    const decls = [...src.matchAll(/scene\.load\.svg\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)/g)];
    expect(decls.length).toBeGreaterThan(0);
    for (const [, key, rel, w, h] of decls) {
      const svg = readFileSync(resolve(__dirname, '../assets', rel), 'utf8');
      const vb = /viewBox="\s*0\s+0\s+(\d+)\s+(\d+)\s*"/.exec(svg);
      expect(vb, `${key} (${rel}) 缺少 viewBox`).not.toBeNull();
      expect(`${vb![1]}x${vb![2]}`, `${key} viewBox 与声明尺寸不符`).toBe(`${w}x${h}`);
    }
  });
});

describe('loadGameAssets 可重复调用（场景重建幂等）', () => {
  it('不抛异常', () => {
    const fake = {
      load: {
        setPath() {},
        svg() {}, image() {}, audio() {}
      }
    };
    expect(() => loadGameAssets(fake as unknown as Parameters<typeof loadGameAssets>[0])).not.toThrow();
  });
});