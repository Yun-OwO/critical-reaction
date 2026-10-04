import { describe, expect, it } from 'vitest';
import {
  CAPTURE_ANIM,
  ELECTRON_PAIR_LIFETIME,
  ORBIT_CAPACITY,
  SINGLE_HIT_MAX_HP,
  annihilatePair,
  captureElectron,
  createOrbit,
  orbitVisualParams,
  pickSlotToward
} from '../src/game/combat/orbit';

describe('enemy orbit system', () => {
  it('single-hit enemies get no orbit', () => {
    expect(createOrbit(1)).toBeNull();
    expect(createOrbit(SINGLE_HIT_MAX_HP)).toBeNull();
  });

  it('multi-hit enemies get an orbit within capacity bounds', () => {
    for (const hp of [15, 35, 40, 55, 60, 70, 300]) {
      const orbit = createOrbit(hp);
      expect(orbit).not.toBeNull();
      expect(orbit!.count).toBeGreaterThanOrEqual(1);
      expect(orbit!.count).toBeLessThanOrEqual(ORBIT_CAPACITY);
    }
  });

  it('annihilation consumes exactly one electron per valid hit', () => {
    const orbit = createOrbit(40)!;
    orbit.count = 3;
    expect(annihilatePair(orbit)).toBe(true);
    expect(orbit.count).toBe(2);
    expect(annihilatePair(orbit)).toBe(true);
    expect(orbit.count).toBe(1);
    expect(annihilatePair(orbit)).toBe(true);
    expect(orbit.count).toBe(0);
    // 轨道清空后无法再成对
    expect(annihilatePair(orbit)).toBe(false);
    expect(orbit.count).toBe(0);
  });

  it('capture fills the orbit and inertifies exactly at capacity', () => {
    const orbit = createOrbit(70)!;
    orbit.count = 0;
    const results = [];
    for (let i = 0; i < ORBIT_CAPACITY; i += 1) {
      results.push(captureElectron(orbit));
    }
    expect(results[ORBIT_CAPACITY - 1].inertified).toBe(true);
    expect(orbit.count).toBe(0);
    expect(orbit.inertCount).toBe(1);
    expect(results.slice(0, ORBIT_CAPACITY - 1).every((r) => !r.inertified)).toBe(true);
  });

  it('targets the orbit electron closest to the attack direction', () => {
    const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    expect(pickSlotToward(angles, 0)).toBe(0);
    expect(pickSlotToward(angles, Math.PI / 2)).toBe(1);
    expect(pickSlotToward(angles, -Math.PI / 2)).toBe(3);
    // 跨 ±π 边界时仍取角度差最小者
    expect(pickSlotToward(angles, Math.PI * 0.95)).toBe(2);
    expect(pickSlotToward(angles, -Math.PI * 0.95)).toBe(2);
  });

  it('returns -1 when no electron is available for targeting', () => {
    expect(pickSlotToward([], 0)).toBe(-1);
  });

  it('survives 100 consecutive full interaction cycles without anomalies', () => {
    const orbit = createOrbit(70)!;
    for (let cycle = 0; cycle < 100; cycle += 1) {
      orbit.count = 0;
      let inertified = 0;
      while (inertified === 0) {
        const capture = captureElectron(orbit);
        if (capture.inertified) {
          inertified += 1;
        } else {
          expect(orbit.count).toBeLessThan(ORBIT_CAPACITY);
        }
      }
      expect(orbit.count).toBe(0);
      // 氧化湮灭：逐击成对抵消，N 次击中清空 N 颗
      orbit.count = 5;
      let hits = 0;
      while (annihilatePair(orbit)) {
        hits += 1;
        expect(orbit.count).toBeLessThan(ORBIT_CAPACITY);
      }
      expect(hits).toBe(5);
      expect(orbit.count).toBe(0);
    }
    expect(orbit.inertCount).toBe(100);
  });
});

describe('pair lifetime and capture animation config', () => {
  it('pair exists for a positive bounded lifetime', () => {
    expect(ELECTRON_PAIR_LIFETIME).toBeGreaterThan(0);
    expect(ELECTRON_PAIR_LIFETIME).toBeLessThan(5);
  });

  it('capture animation parameters are valid and configurable', () => {
    expect(CAPTURE_ANIM.flyMs).toBeGreaterThan(0);
    expect(CAPTURE_ANIM.settleMs).toBeGreaterThanOrEqual(CAPTURE_ANIM.flyMs);
    expect(CAPTURE_ANIM.resonateScale).toBeGreaterThan(1);
    expect(typeof CAPTURE_ANIM.flyEase).toBe('string');
    expect(typeof CAPTURE_ANIM.settleEase).toBe('string');
  });
});

describe('player orbit visual states', () => {
  it('idle is the neutral baseline', () => {
    const idle = orbitVisualParams('idle');
    expect(idle.spinMultiplier).toBe(1);
    expect(idle.electronScale).toBe(1);
    expect(idle.jitter).toBe(0);
    expect(idle.flicker).toBe(false);
  });

  it('combat states are visually distinguishable from idle and from each other', () => {
    const idle = orbitVisualParams('idle');
    const states = ['attack', 'hurt', 'lost'] as const;
    const seen = new Set<string>();
    for (const state of states) {
      const params = orbitVisualParams(state);
      expect(params.spinMultiplier).not.toBe(idle.spinMultiplier);
      expect(params.lineAlpha).toBeGreaterThan(idle.lineAlpha);
      expect(params.color).not.toBe(idle.color);
      seen.add(`${params.color}-${params.spinMultiplier}-${params.electronScale}-${params.flicker}`);
    }
    expect(seen.size).toBe(states.length);
  });

  it('hurt and lost states flicker while attack surges without jitter', () => {
    expect(orbitVisualParams('attack').flicker).toBe(false);
    expect(orbitVisualParams('attack').jitter).toBe(0);
    expect(orbitVisualParams('hurt').flicker).toBe(true);
    expect(orbitVisualParams('lost').flicker).toBe(true);
    expect(orbitVisualParams('lost').jitter).toBeGreaterThan(orbitVisualParams('hurt').jitter);
  });

  it('all states keep alpha and scale within renderable bounds', () => {
    for (const state of ['idle', 'attack', 'hurt', 'lost'] as const) {
      const params = orbitVisualParams(state);
      expect(params.lineAlpha).toBeGreaterThan(0);
      expect(params.lineAlpha).toBeLessThanOrEqual(1);
      expect(params.electronScale).toBeGreaterThan(0);
      expect(params.electronAlpha).toBeGreaterThan(0);
    }
  });
});
