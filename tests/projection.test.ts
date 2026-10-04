import { describe, expect, it } from 'vitest';
import { angleXZ, depthFromXZ, distanceXZ, projectIsoXZ, projectXZ } from '../src/game/utils/projection';

describe('2.5D projection', () => {
  it('projects x and z without mutating the source', () => {
    const source = { x: 10, z: 20 };
    const result = projectXZ(source);
    expect(result.x).toBe(20.4);
    expect(result.y).toBe(10);
    expect(source).toEqual({ x: 10, z: 20 });
  });

  it('keeps depth monotonic with world depth', () => {
    expect(projectXZ({ x: 0, z: 20 }).depth).toBeGreaterThan(projectXZ({ x: 0, z: 10 }).depth);
    expect(projectXZ({ x: 0, z: 20 }).scale).toBeGreaterThan(projectXZ({ x: 0, z: 10 }).scale);
  });

  it('supports isometric projection', () => {
    expect(projectIsoXZ({ x: 2, z: 1 }, 100, 50, 24, 12)).toEqual({ x: 124, y: 86, depth: 3, scale: 1 });
  });

  it('calculates distance and direction in xz space', () => {
    expect(distanceXZ({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    expect(angleXZ({ x: 0, z: 0 }, { x: 1, z: 0 })).toBe(0);
    expect(angleXZ({ x: 0, z: 0 }, { x: 0, z: 1 })).toBe(Math.PI / 2);
  });

  it('calculates stable render depth layers', () => {
    expect(depthFromXZ(240, 100)).toBe(102);
    expect(depthFromXZ(-240, 100)).toBe(98);
  });
});
