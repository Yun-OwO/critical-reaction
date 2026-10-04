import { describe, expect, it } from 'vitest';
import { reactions } from '../src/game/data/reactions';

describe('reaction table (R001-R006)', () => {
  it('defines all six MVP reactions', () => {
    expect(reactions).toHaveLength(6);
    expect(reactions.map((r) => r.id)).toEqual(['R001', 'R002', 'R003', 'R004', 'R005', 'R006']);
  });

  it('every reaction has runtime fields', () => {
    for (const reaction of reactions) {
      expect(reaction.reactants.length).toBeGreaterThan(0);
      expect(reaction.radius).toBeGreaterThan(0);
      expect(reaction.damage).toBeGreaterThan(0);
      expect(reaction.effectId).toBeTruthy();
    }
  });

  it('all MVP reactions are exothermic and raise temperature within tuned bounds', () => {
    for (const reaction of reactions) {
      expect(reaction.deltaH).toBeLessThan(0);
      const deltaT = Math.abs(reaction.deltaH) / 20;
      expect(deltaT).toBeGreaterThan(0);
      expect(deltaT).toBeLessThanOrEqual(15);
    }
  });
});
