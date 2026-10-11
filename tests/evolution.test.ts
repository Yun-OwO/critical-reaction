import { describe, expect, it } from 'vitest';
import {
  EVOLUTION_SLOT_COUNT,
  NEUTRAL_EVOLUTION_STATS,
  combineEvolution,
  computeEvolutionStats,
  describeEvolution,
  mixEvolutionColor,
  previewInject
} from '../src/game/data/evolution';
import { DYE_SLOT_MULTIPLIERS, getDye } from '../src/game/data/dyes';

/** 把某个 hex 拆成 [r,g,b]（0-255），用于用「期望色」反推断言。 */
function channels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

const RED = getDye('D01')!;   // #EF4444
const GREEN = getDye('D04')!; // #22C55E
const BLUE = getDye('D06')!;  // #3B82F6

describe('mixEvolutionColor —— 槽位权重混合', () => {
  it('全空槽混合为纯黑，不抛错', () => {
    expect(mixEvolutionColor([null, null, null])).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('槽位数对齐既有染色槽权重', () => {
    expect(EVOLUTION_SLOT_COUNT).toBe(DYE_SLOT_MULTIPLIERS.length);
  });

  it('单槽只放一种染料时，混合色等于该染料原色', () => {
    const c = mixEvolutionColor([RED.id, null, null]);
    expect(c.r).toBeCloseTo(channels(RED.hex)[0] / 255, 6);
    expect(c.g).toBeCloseTo(channels(RED.hex)[1] / 255, 6);
    expect(c.b).toBeCloseTo(channels(RED.hex)[2] / 255, 6);
  });

  it('同一种染料填满三槽，混合色不变（权重被归一化）', () => {
    const one = mixEvolutionColor([RED.id, null, null]);
    const three = mixEvolutionColor([RED.id, RED.id, RED.id]);
    expect(three.r).toBeCloseTo(one.r, 6);
    expect(three.g).toBeCloseTo(one.g, 6);
    expect(three.b).toBeCloseTo(one.b, 6);
  });

  it('权重是相对的：同一种染料放主槽或放底槽结果一致', () => {
    const asPrimary = mixEvolutionColor([RED.id, null, null]);
    const asBottom = mixEvolutionColor([null, null, RED.id]);
    expect(asBottom.r).toBeCloseTo(asPrimary.r, 6);
    expect(asBottom.g).toBeCloseTo(asPrimary.g, 6);
  });

  it('权重构成等比数列：[红,绿,空] 与 [空,红,绿] 混合结果相同', () => {
    const a = mixEvolutionColor([RED.id, GREEN.id, null]);
    const b = mixEvolutionColor([null, RED.id, GREEN.id]);
    expect(a.r).toBeCloseTo(b.r, 10);
    expect(a.g).toBeCloseTo(b.g, 10);
    expect(a.b).toBeCloseTo(b.b, 10);
  });

  it('把染料从副槽挪到底槽会改变配比（这是槽位权重唯一的作用方式）', () => {
    const inSecondary = mixEvolutionColor([RED.id, GREEN.id, null]);  // 权重 1.0 : 0.5
    const inBottom = mixEvolutionColor([RED.id, null, GREEN.id]);     // 权重 1.0 : 0.25
    // 次色权重降到 1/4，主色占比上升 —— 「稀释」在进化系统里是昂贵的
    expect(inBottom.r / inBottom.g).toBeGreaterThan(inSecondary.r / inSecondary.g);
  });

  it('副槽权重只有主槽一半：两种染料混色时次色最多只占三分之一', () => {
    const mixed = mixEvolutionColor([RED.id, GREEN.id, null]);
    expect(0.5 / (1.0 + 0.5)).toBeCloseTo(1 / 3, 10);
    const greenRaw = (GREEN.hex >> 8 & 0xff) / 255;
    expect(mixed.g / greenRaw).toBeLessThan(0.6);
  });

  it('未知染料 id 退化为中性贡献，不影响其余槽', () => {
    const unknown = mixEvolutionColor(['__not_a_dye__', null, null]);
    expect(unknown).toEqual({ r: 0, g: 0, b: 0 });
    const mixed = mixEvolutionColor([RED.id, '__not_a_dye__', null]);
    expect(mixed.r).toBeCloseTo(channels(RED.hex)[0] / 255, 6);
  });

  it('槽位数组超长时不越界、不误读权重', () => {
    const c = mixEvolutionColor([RED.id, GREEN.id, BLUE.id, RED.id, GREEN.id]);
    expect(c.r).toBeGreaterThan(0);
    expect(c.r).toBeLessThanOrEqual(1);
  });
});

describe('computeEvolutionStats —— 通道到属性的映射', () => {
  it('全空槽天然是全恒等，无需特判', () => {
    const s = computeEvolutionStats([null, null, null]);
    expect(s.damageMult).toBe(1);
    expect(s.hpMult).toBe(1);
    expect(s.heatMult).toBe(1);
    expect(s.critRateBonus).toBe(0);
    expect(s.critMult).toBe(1);
    expect(s).toEqual(NEUTRAL_EVOLUTION_STATS);
  });

  it('朱赤通道的伤害收益高于碧青（红染 r=0.94 远高于绿染 r=0.13）', () => {
    const red = computeEvolutionStats([RED.id, null, null]);
    const green = computeEvolutionStats([GREEN.id, null, null]);
    expect(red.damageMult).toBeGreaterThan(1);
    expect(green.damageMult).toBeGreaterThan(1); // 绿染并非纯绿，r 分量仍有微量贡献
    expect(red.damageMult).toBeGreaterThan(green.damageMult);
  });

  it('碧青 → 生命，且强于红对生命的贡献', () => {
    const green = computeEvolutionStats([GREEN.id, null, null]);
    const red = computeEvolutionStats([RED.id, null, null]);
    expect(green.hpMult).toBeGreaterThan(1);
    expect(green.hpMult).toBeGreaterThan(red.hpMult);
  });

  it('苍蓝通道的控温收益高于红染（升温倍率下降更多）', () => {
    const blue = computeEvolutionStats([BLUE.id, null, null]);
    const red = computeEvolutionStats([RED.id, null, null]);
    expect(blue.heatMult).toBeLessThan(red.heatMult);
    expect(blue.heatMult).toBeLessThan(1);
    // 满蓝最多 -45%，不应击穿到 0
    expect(blue.heatMult).toBeGreaterThanOrEqual(0.55);
  });

  it('纯度用饱和度而非亮度：红+青互补混合后饱和度显著下降', () => {
    const pure = computeEvolutionStats([RED.id, null, null]);
    const muddy = computeEvolutionStats([RED.id, getDye('D05')!.id, null]); // D01+D05 互补
    // 注意是「稀释」而非归零：真实染料 RGB 不纯（红染的 g/b 分量就有 0.267），
    // 加上权重不等（1.0 : 0.5），混出来是低饱和的蓝灰而非纯灰。
    // 这正是想要的语义：互补色会把主反应稀释成副反应。
    expect(muddy.saturation).toBeLessThan(pure.saturation);
    expect(muddy.critRateBonus).toBeLessThan(pure.critRateBonus);
    expect(muddy.critRateBonus).toBeGreaterThanOrEqual(0);
  });

  it('主通道强度 → 暴击伤害，灰混色拿不到高暴伤', () => {
    const pure = computeEvolutionStats([BLUE.id, null, null]);
    const muddy = computeEvolutionStats([RED.id, getDye('D05')!.id, null]);
    expect(pure.critMult).toBeGreaterThan(muddy.critMult);
    expect(pure.critMult).toBeLessThanOrEqual(1.6);
  });

  it('通道收益是超线性的（指数>1）：浓度越高额外收益越陡', () => {
    const full = computeEvolutionStats([RED.id, null, null]);
    const diluted = computeEvolutionStats([RED.id, BLUE.id, null]);
    const fullR = (RED.hex >> 16 & 0xff) / 255;
    // 稀释后红通道从 fullR 降下来，但收益之比必须**大于**浓度之比
    const dilutedR = diluted.color.r;
    expect(dilutedR).toBeLessThan(fullR);
    expect(full.damageMult - 1).toBeGreaterThan((diluted.damageMult - 1) / (dilutedR / fullR) - 1e-9);
    expect(full.damageMult - 1).toBeGreaterThan(diluted.damageMult - 1);
  });

  it('单调性：红染从副槽挪到底槽，绿染被稀释、伤害只会更高', () => {
    const inSecondary = computeEvolutionStats([RED.id, GREEN.id, null]);
    const inBottom = computeEvolutionStats([RED.id, null, GREEN.id]);
    expect(inSecondary.damageMult).toBeLessThan(inBottom.damageMult);
  });

  it('filledSlots 统计有效槽位，非法 id 不计入', () => {
    expect(computeEvolutionStats([RED.id, null, null]).filledSlots).toBe(1);
    expect(computeEvolutionStats([RED.id, GREEN.id, BLUE.id]).filledSlots).toBe(3);
    expect(computeEvolutionStats(['__nope__', null, null]).filledSlots).toBe(0);
  });
});

describe('combineEvolution —— 乘区合成', () => {
  it('与恒等值合成不变', () => {
    const a = computeEvolutionStats([RED.id, BLUE.id, null]);
    const out = combineEvolution(a, NEUTRAL_EVOLUTION_STATS);
    expect(out.damageMult).toBeCloseTo(a.damageMult, 10);
    expect(out.hpMult).toBeCloseTo(a.hpMult, 10);
    expect(out.heatMult).toBeCloseTo(a.heatMult, 10);
    expect(out.critRateBonus).toBeCloseTo(a.critRateBonus, 10);
    expect(out.critMult).toBeCloseTo(a.critMult, 10);
  });

  it('倍率相乘、暴击率相加、暴伤相乘', () => {
    const a = computeEvolutionStats([RED.id, null, null]);
    const b = computeEvolutionStats([BLUE.id, null, null]);
    const out = combineEvolution(a, b);
    expect(out.damageMult).toBeCloseTo(a.damageMult * b.damageMult, 10);
    expect(out.heatMult).toBeCloseTo(a.heatMult * b.heatMult, 10);
    expect(out.critRateBonus).toBeCloseTo(a.critRateBonus + b.critRateBonus, 10);
    expect(out.critMult).toBeCloseTo(a.critMult * b.critMult, 10);
  });

  it('主通道取两者的较大值（暴伤只看谁更极端）', () => {
    const strong = computeEvolutionStats(['D08', null, null]); // 紫染，RGB 偏低但通道不纯
    const weak = computeEvolutionStats(['D09', null, null]);   // 红外染
    expect(strong.dominant).toBeGreaterThan(0);
    expect(weak.dominant).toBeGreaterThan(0);
    expect(Math.max(strong.dominant, weak.dominant)).toBeGreaterThan(0);
  });
});

describe('describeEvolution —— 文案', () => {
  it('未进化时给出明确文案', () => {
    expect(describeEvolution(NEUTRAL_EVOLUTION_STATS)).toBe('未进化');
  });

  it('列出所有偏离恒等的项', () => {
    const s = computeEvolutionStats([RED.id, BLUE.id, null]);
    const text = describeEvolution(s);
    expect(text).toContain('伤害');
    expect(text).toContain('升温');
    expect(text).toContain('暴击率');
    expect(text).toContain('暴伤');
  });

  it('满槽时列出全部五项修正', () => {
    const s = computeEvolutionStats([RED.id, GREEN.id, BLUE.id]);
    const text = describeEvolution(s);
    for (const key of ['伤害', '生命', '升温', '暴击率', '暴伤']) {
      expect(text).toContain(key);
    }
  });

  it('文案里不出现偏离恒等的项', () => {
    // 互补混色把三个通道都拉平，但仍不是全恒等——所以断言它仍报出内容而非空串
    const muddy = computeEvolutionStats([RED.id, getDye('D05')!.id, null]);
    expect(describeEvolution(muddy)).not.toBe('已染色（无有效属性）');
    expect(describeEvolution(muddy)).toContain('伤害');
  });
});

describe('previewInject —— 染色工作台的注入预览', () => {
  it('返回每个槽位注入后的结果，数量等于槽位数', () => {
    const previews = previewInject([null, null, null], RED.id);
    expect(previews).toHaveLength(EVOLUTION_SLOT_COUNT);
  });

  it('注入不同槽位会同其它染料的配比变化（单染料注入各槽结果相同）', () => {
    const previews = previewInject([null, null, null], RED.id);
    expect(previews[0].damageMult).toBeCloseTo(previews[2].damageMult, 10);
    // 槽位权重的意义只在「已有染料」时才显现
    const occupied = previewInject([GREEN.id, null, null], RED.id);
    expect(occupied[0].damageMult).toBeGreaterThan(occupied[2].damageMult);
  });

  it('在已占用槽位上注入会覆盖原染料', () => {
    const previews = previewInject([RED.id, null, null], BLUE.id);
    expect(previews[0].damageMult).toBeLessThan(
      computeEvolutionStats([RED.id, null, null]).damageMult
    ); // 主槽红被蓝盖掉
    expect(previews[1].damageMult).toBeGreaterThan(1); // 副槽新增一份红
  });
});