import { describe, expect, it } from 'vitest';
import { dyes, getDye, getGenericMixDye, getMixPreview, resolveMix, MIX_TABLE } from '../src/game/data/dyes';

describe('dye mixing coverage', () => {
  it('every primary/secondary pairing resolves to a mix result', () => {
    for (const p of dyes) {
      for (const s of dyes) {
        const mix = resolveMix(p.id, s.id);
        expect(mix, `${p.id}+${s.id}`).not.toBeNull();
        expect(mix!.resultName).toBeTruthy();
        expect(mix!.resultColor).toMatch(/^#[0-9A-F]{6}$/);
        expect(mix!.resultEffect).toBeTruthy();
      }
    }
  });

  it('every mix result id is resolvable to a dye with at least one effect', () => {
    for (const p of dyes) {
      for (const s of dyes) {
        const mix = resolveMix(p.id, s.id)!;
        const dye = getDye(mix.resultId);
        expect(dye, `${p.id}+${s.id} -> ${mix.resultId}`).toBeDefined();
        expect(dye!.effectValue).toBeGreaterThan(0);
      }
    }
  });

  it('special recipes still win over generic mixing', () => {
    for (const m of MIX_TABLE) {
      expect(resolveMix(m.primary, m.secondary)?.resultId).toBe(m.resultId);
      expect(resolveMix(m.secondary, m.primary)?.resultId).toBe(m.resultId);
    }
  });

  it('generic mixing is order independent and blends both effects', () => {
    const ab = getGenericMixDye('D02', 'D08')!;
    const ba = getGenericMixDye('D08', 'D02')!;
    expect(ab.id).toBe(ba.id);
    expect(ab.color).toBe(ba.color);
    expect(ab.effectType).toBe('aoe');
    expect(ab.secondEffect?.type).toBe('armor_break');
  });

  it('preview always reports a color and an effect', () => {
    for (const p of dyes) {
      for (const s of dyes) {
        const preview = getMixPreview(p.id, s.id);
        expect(preview.color).toMatch(/^#[0-9A-F]{6}$/);
        expect(preview.name).not.toBe('—');
        expect(preview.effect).toMatch(/特殊配方|通用混色/);
      }
    }
  });

  it('preview effect text never drifts from the resolved dye definition', () => {
    for (const p of dyes) {
      for (const s of dyes) {
        const mix = resolveMix(p.id, s.id)!;
        const dye = getDye(mix.resultId)!;
        expect(getMixPreview(p.id, s.id).effect, `${p.id}+${s.id}`).toContain(dye.effect);
      }
    }
  });
});
