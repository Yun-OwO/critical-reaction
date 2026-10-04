import { describe, expect, it } from 'vitest';
import { diamondS, projectInside } from '../src/game/utils/diamond';

const diamond = { cx: 0, cy: 0, a: 2400, b: 1200 };

describe('diamond math', () => {
  it('center has s = 0', () => {
    expect(diamondS(diamond, 0, 0)).toBe(0);
  });

  it('vertices lie exactly on the boundary (s = 1)', () => {
    expect(diamondS(diamond, 2400, 0)).toBeCloseTo(1);
    expect(diamondS(diamond, -2400, 0)).toBeCloseTo(1);
    expect(diamondS(diamond, 0, 1200)).toBeCloseTo(1);
    expect(diamondS(diamond, 0, -1200)).toBeCloseTo(1);
  });

  it('outside points exceed 1', () => {
    expect(diamondS(diamond, 2400, 1200)).toBeCloseTo(2);
    expect(diamondS(diamond, 4800, 0)).toBeCloseTo(2);
  });

  it('projectInside keeps interior points unchanged', () => {
    const result = projectInside(diamond, 100, 100, 0.9);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
  });

  it('projectInside pulls outside points back within maxS', () => {
    const result = projectInside(diamond, 2400, 1200, 0.85);
    expect(diamondS(diamond, result.x, result.y)).toBeCloseTo(0.85);
  });

  it('projectInside preserves direction from center', () => {
    const result = projectInside(diamond, 4800, 0, 0.5);
    expect(result.x).toBeCloseTo(1200);
    expect(result.y).toBeCloseTo(0);
  });
});
