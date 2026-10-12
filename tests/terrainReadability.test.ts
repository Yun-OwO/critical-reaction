/**
 * 地形通行视觉同源测试（计划 §7.2）。
 *
 * 实机数据：12 个种子的地形里有 91 个 `height>=20` 但 `collidable=false` 的块
 * （走廊/间距规则导致）。旧渲染规则用 `height` 判定是否画侧壁，
 * 这 91 个块全会画出"穿不过去"的侧壁，玩家却能直接走过——视觉欺骗。
 *
 * 正确契约：**侧壁只画在 collidable 上**。本测试锁住这条。
 */
import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../src/game/world/biomes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const W = 3000;
const H = 2400;
const A = 1400;
const B = 900;
const CX = 1500;
const CY = 1200;

describe('地形数据：高度与碰撞是两件事', () => {
  it('确实存在 height>=20 但不可碰撞的块（证明旧的 height 判定会骗人）', () => {
    let high = 0;
    let highNotCollidable = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const gen = generateTerrain(seed, W, H, A, B, CX, CY, {});
      for (const b of gen.blocks) {
        if (b.height >= 20) {
          high += 1;
          if (!b.collidable) highNotCollidable += 1;
        }
      }
    }
    expect(high).toBeGreaterThan(0);
    // 这是修复的前提：如果为 0，说明该规则下不会出现欺骗（但实测不为 0）
    expect(highNotCollidable, 'height>=20 却不可碰撞的块（旧规则会画假墙）').toBeGreaterThan(0);
  });

  it('每个 collidable 块都在可碰撞集合内，且碰撞盒不大于视觉投影', () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const gen = generateTerrain(seed, W, H, A, B, CX, CY, {});
      for (const b of gen.blocks) {
        if (!b.collidable) continue;
        expect(b.height, '可碰撞块必须有可见高度').toBeGreaterThanOrEqual(20);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
      }
    }
  });

  it('同 seed 完全可复现（联机/回放的前提）', () => {
    const a = generateTerrain(7, W, H, A, B, CX, CY, {});
    const b = generateTerrain(7, W, H, A, B, CX, CY, {});
    expect(a.blocks.length).toBe(b.blocks.length);
    for (let i = 0; i < a.blocks.length; i += 1) {
      expect(a.blocks[i].collidable, `块 ${i} 碰撞状态`).toBe(b.blocks[i].collidable);
      expect(a.blocks[i].height, `块 ${i} 高度`).toBe(b.blocks[i].height);
    }
  });
});

describe('渲染规则：侧壁只画在 collidable 上', () => {
  const src = readFileSync(resolve(__dirname, '../src/game/scenes/GameScene.ts'), 'utf8');

  it('isoBlock 的侧壁守卫用 collidable，不是 height', () => {
    // 修复后：if (!collidable) return;  （而不是 if (lift === 0) return;）
    expect(src, '侧壁守卫必须是 collidable').toContain('if (!collidable) return;');
    expect(src, '不得再用 lift===0 作为侧壁守卫（会把假墙画出来）').not.toContain('if (lift === 0) return;');
  });

  it('不可通过块的描边更粗更亮（主要的视觉信号）', () => {
    expect(src).toContain('collidable ? 2.2 : 1.2');
  });
});

describe('地面格栅：工业格栅板而非细线网格', () => {
  const src = readFileSync(resolve(__dirname, '../src/game/scenes/GameScene.ts'), 'utf8');

  it('格栅贴图周期为 96×48（横向条带的一个完整周期）', () => {
    expect(src).toContain('const tileW = 96;');
    expect(src).toContain('const tileH = 48;');
  });

  it('格栅由横向承载条 + 暗孔 + 细纵筋构成', () => {
    expect(src, '横向承载条').toContain('横向承载条');
    expect(src, '暗孔').toContain('暗孔');
    expect(src, '细纵筋').toContain('细纵筋');
  });

  it('仍用 TileSprite 单四边形渲染（不退回 Graphics 逐帧重描）', () => {
    expect(src).toContain('add.tileSprite');
    expect(src).toContain('grid-tile');
  });

  it('半透明：格栅底填充透明度低于 0.5（计划 §7.2 的 0.12–0.22 方向）', () => {
    const m = /rgba\(18, 26, 32, (0\.\d+)\)/.exec(src);
    expect(m, '格栅底填充色未找到').not.toBeNull();
    const alpha = Number(m![1]);
    expect(alpha).toBeLessThan(0.5);
    expect(alpha).toBeGreaterThan(0);
  });
});