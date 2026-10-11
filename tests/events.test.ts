import { describe, expect, it } from 'vitest';
import {
  availableEvents,
  canAfford,
  eventDefs,
  getEvent,
  hasFlag,
  optionAvailable,
  rollEvent,
  type EventContext,
  type Rng
} from '../src/game/data/events';
import { resetRun, gameState } from '../src/game/state/GameState';

/**
 * mulberry32。第一版用的是 Numerical Recipes 的 LCG，**连续种子的首个输出几乎不散**
 * （步长只有 1664525/2^32 ≈ 0.0004），400 次抽样全挤在权重区间的一小段里，
 * 直接把权重统计测成了假象。换成有 avalanche 的 mulberry32。
 */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx(over: Partial<EventContext> = {}): EventContext {
  return {
    coupons: 0,
    ehp: 100,
    ehpMax: 100,
    valence: 3,
    maxValence: 3,
    temperature: 20,
    layer: 0,
    dyeCount: 0,
    gearCount: 0,
    boonCount: 0,
    kills: 0,
    seen: [],
    ...over
  };
}

describe('事件表的基本完整性', () => {
  it('事件 id 唯一', () => {
    const ids = eventDefs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('选项 id 在各自事件内唯一', () => {
    for (const def of eventDefs) {
      const optIds = def.options.map((o) => o.id);
      expect(new Set(optIds).size, def.id).toBe(optIds.length);
    }
  });

  it('每个事件都有标题、氛围文案与至少两个选项', () => {
    for (const def of eventDefs) {
      expect(def.title.length, def.id).toBeGreaterThan(0);
      expect(def.flavor.length, def.id).toBeGreaterThan(0);
      expect(def.options.length, def.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('覆盖设计文档要求的四类抉择：纯收益/赌博/交易/道德', () => {
    const freebies = eventDefs.filter((d) =>
      d.options.some((o) => !o.cost && !/赌|押|买|卖|签|烧|搬|借/.test(o.label))
    );
    const gamble = eventDefs.filter((d) => d.options.some((o) => /赌|随机|未知|检/.test(o.label + (o.hint ?? ''))));
    const trade = eventDefs.filter((d) => d.options.some((o) => /买|卖|借|兑换/.test(o.label)));
    const moral = eventDefs.filter((d) => d.options.some((o) => /签|烧|搬/.test(o.label)));
    expect(freebies.length).toBeGreaterThanOrEqual(3);
    expect(gamble.length).toBeGreaterThanOrEqual(3);
    expect(trade.length).toBeGreaterThanOrEqual(2);
    expect(moral.length).toBeGreaterThanOrEqual(3);
  });

  it('带代价的选项都写了 hint（代价必须写在脸上）', () => {
    for (const def of eventDefs) {
      for (const opt of def.options) {
        if (opt.cost) expect(opt.hint, `${def.id}/${opt.id}`).toBeTruthy();
      }
    }
  });
});

describe('不变量：玩家永远不会被事件卡死', () => {
  it('任何局况下每个事件都有至少一个零代价且总是可选的选项', () => {
    // 用一组「最不利」的局况逐个验：没券、没装备、没祝福、血少、温度低
    const worst = ctx({ coupons: 0, gearCount: 0, boonCount: 0, ehp: 1, temperature: 0 });
    for (const def of eventDefs) {
      const safe = def.options.filter((o) => optionAvailable(o, worst));
      expect(safe.length, `${def.id} 在最不利局况下无路可走`).toBeGreaterThan(0);
      // 且安全选项不能是负收益
      for (const o of safe) {
        expect(o.cost ?? {}, `${def.id}/${o.id}`).toEqual({});
      }
    }
  });

  it('空局况（零资源）下仍然每个事件都能选', () => {
    for (const def of eventDefs) {
      expect(def.options.some((o) => optionAvailable(o, ctx())), def.id).toBe(true);
    }
  });
});

describe('canAfford / optionAvailable', () => {
  it('券不足则置灰', () => {
    expect(canAfford(ctx({ coupons: 29 }), { coupons: 30 })).toBe(false);
    expect(canAfford(ctx({ coupons: 30 }), { coupons: 30 })).toBe(true);
  });

  it('EHP 不足以支付代价时置灰（花光 EHP 会丢一个价电子）', () => {
    expect(canAfford(ctx({ ehp: 14 }), { ehp: 15 })).toBe(false);
    // 刚好够：允许玩家主动把自己打到掉一个价电子——代价已写在 hint 上
    expect(canAfford(ctx({ ehp: 15 }), { ehp: 15 })).toBe(true);
    expect(canAfford(ctx({ ehp: 1 }), { ehp: 15 })).toBe(false);
  });

  it('无 cost 视为总是付得起', () => {
    expect(canAfford(ctx({ coupons: 0, ehp: 1 }))).toBe(true);
  });

  it('选项级 available 与 cost 叠加判定', () => {
    const opt = getEvent('ev-unstable-sample')!.options[0];
    // ehp=30 时 available 钩子不满足（血太少不值得冒险）
    expect(optionAvailable(opt, ctx({ ehp: 30, coupons: 999 }))).toBe(false);
    expect(optionAvailable(opt, ctx({ ehp: 31, coupons: 999 }))).toBe(true);
    // EHP 不够付代价时，无论 available 是否通过都置灰
    expect(optionAvailable(opt, ctx({ ehp: 10 }))).toBe(false);
  });

  it('门槛下沉到选项：缺装备时事件照样抽得到，只是「卖」这一项灰掉', () => {
    const def = getEvent('ev-scrap-deal')!;
    // 事件本身仍然可见（玩家能读到 flavor，知道世界上有这个交易）
    expect(availableEvents(ctx({ gearCount: 0 })).some((d) => d.id === 'ev-scrap-deal')).toBe(true);
    expect(optionAvailable(def.options[0], ctx({ gearCount: 0 }))).toBe(false);
    expect(optionAvailable(def.options[0], ctx({ gearCount: 2 }))).toBe(true);
  });

  it('染料贩子在没钱时也可见，只是买不了（券与 available 双重把关）', () => {
    const def = getEvent('ev-dye-broker')!;
    expect(availableEvents(ctx({ coupons: 0 })).some((d) => d.id === 'ev-dye-broker')).toBe(true);
    expect(optionAvailable(def.options[0], ctx({ coupons: 29 }))).toBe(false);
    expect(optionAvailable(def.options[0], ctx({ coupons: 30 }))).toBe(true);
  });
});

describe('availableEvents —— 池子过滤', () => {
  it('once 事件在见过之后不再出现', () => {
    const first = ctx({ seen: [] });
    const after = ctx({ seen: ['ev-scrap-notes'] });
    expect(availableEvents(first).some((d) => d.id === 'ev-scrap-notes')).toBe(true);
    expect(availableEvents(after).some((d) => d.id === 'ev-scrap-notes')).toBe(false);
  });

  it('低温冷柜只在高温局况下出现', () => {
    expect(availableEvents(ctx({ temperature: 20 })).some((d) => d.id === 'ev-cold-storage')).toBe(false);
    expect(availableEvents(ctx({ temperature: 80 })).some((d) => d.id === 'ev-cold-storage')).toBe(true);
  });

  it('焚毁记录永远在池里，但身上没祝福时「烧」这一项灰掉', () => {
    const def = getEvent('ev-burn-notes')!;
    expect(availableEvents(ctx({ boonCount: 0 })).some((d) => d.id === 'ev-burn-notes')).toBe(true);
    expect(optionAvailable(def.options[0], ctx({ boonCount: 0 }))).toBe(false);
    expect(optionAvailable(def.options[0], ctx({ boonCount: 1 }))).toBe(true);
  });

  it('池子非空且全是合法事件', () => {
    const pool = availableEvents(ctx());
    expect(pool.length).toBeGreaterThan(0);
    for (const d of pool) expect(eventDefs).toContain(d);
  });
});

describe('rollEvent', () => {
  it('同 seed 完全可复现', () => {
    const c = ctx();
    const a = rollEvent(c, seeded(42));
    const b = rollEvent(c, seeded(42));
    expect(a?.id).toBe(b?.id);
  });

  it('只从可用池里抽', () => {
    const c = ctx({ temperature: 0, seen: eventDefs.filter((d) => d.once).map((d) => d.id) });
    const allowed = new Set(availableEvents(c).map((d) => d.id));
    for (let i = 0; i < 50; i += 1) {
      const e = rollEvent(c, seeded(i + 1));
      expect(e).not.toBeNull();
      expect(allowed.has(e!.id)).toBe(true);
    }
  });

  it('全部 once 事件都被见过之后，池里只剩可重复事件（不会真的抽空）', () => {
    const allSeen = ctx({ seen: eventDefs.map((d) => d.id), temperature: 60 });
    const pool = availableEvents(allSeen);
    const repeatable = eventDefs.filter((d) => !d.once).map((d) => d.id).sort();
    expect(pool.map((d) => d.id).sort()).toEqual(repeatable);
    // 池子非空，所以 rollEvent 的 null 分支是防御性的，按当前事件表不可达
    expect(rollEvent(allSeen, seeded(1))).not.toBeNull();
  });

  it('事件级门槛也会把事件挡在池外', () => {
    expect(availableEvents(ctx({ temperature: 20 })).some((d) => d.id === 'ev-cold-storage')).toBe(false);
    expect(availableEvents(ctx({ temperature: 60 })).some((d) => d.id === 'ev-cold-storage')).toBe(true);
  });

  it('权重越高出现越频繁（统计意义上的检查）', () => {
    const c = ctx({ boonCount: 1, temperature: 60 }); // 让全部 once 事件都可入池
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i += 1) {
      const e = rollEvent(c, seeded(i + 7));
      counts.set(e!.id, (counts.get(e!.id) ?? 0) + 1);
    }
    // 权重 10 的废记录 vs 权重 6 的焚毁记录：前者出现次数应当更多
    expect(counts.get('ev-scrap-notes')!).toBeGreaterThan(counts.get('ev-burn-notes')!);
    expect(counts.get('ev-burn-notes')!).toBeGreaterThan(0);
  });
});

describe('选项结算（纯函数）', () => {
  it('纯收益选项按文案给出确定的增量', () => {
    const def = getEvent('ev-scrap-notes')!;
    const out = def.options[0].resolve(ctx(), seeded(1));
    expect(out.coupons).toBe(18);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('冷却类选项给的是温度增量（负数=降温）', () => {
    const out = getEvent('ev-cold-storage')!.options[0].resolve(ctx(), seeded(1));
    expect(out.temperature).toBe(-30);
  });

  it('赌博选项在两个分支上都有合法结果，且必然扣掉成本', () => {
    const opt = getEvent('ev-purity-test')!.options[0];
    const win = opt.resolve(ctx(), () => 0.1);
    const lose = opt.resolve(ctx(), () => 0.9);
    expect(win.coupons).toBeGreaterThan(0);
    expect(lose.coupons).toBe(-20);
    // 赢面必须真的赚：本金 20，回报 80
    expect(win.coupons!).toBeGreaterThan(opt.cost!.coupons!);
  });

  it('随机事件的每个分支都返回可展示的结果', () => {
    const opt = getEvent('ev-unlabeled-vial')!.options[0];
    for (const seed of [0, 0.5, 0.9]) {
      const out = opt.resolve(ctx(), seeded(Math.floor(seed * 1000) + 1));
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.dyes !== undefined || out.coupons !== undefined || out.ehp !== undefined).toBe(true);
    }
  });

  it('交易类选项扣的券与 cost 声明一致（UI 文案不会骗人）', () => {
    const opt = getEvent('ev-dye-broker')!.options[0];
    const out = opt.resolve(ctx({ coupons: 100 }), seeded(9));
    expect(out.coupons).toBe(-(opt.cost!.coupons!));
    expect(out.dyes).toHaveLength(1);
  });

  it('道德抉择的收益是「本局永久」标记，代价是即时数值', () => {
    const out = getEvent('ev-human-trial')!.options[0].resolve(ctx(), seeded(1));
    expect(out.flags).toContain('trial-buff');
    expect(out.ehpMax).toBeLessThan(0);
  });

  it('样本盗窃把难度代价挂在 nextCombatHpMult 上', () => {
    const out = getEvent('ev-sample-theft')!.options[0].resolve(ctx(), seeded(1));
    expect(out.nextCombatHpMult).toBeGreaterThan(1);
    expect(out.coupons).toBeGreaterThan(0);
  });

  it('「不参与」类选项不改变任何数值', () => {
    const declines = eventDefs.flatMap((d) =>
      d.options.filter((o) => /不|离开|绕开|不动|装作|留着|没看见|拒绝/.test(o.label))
    );
    expect(declines.length).toBeGreaterThanOrEqual(8);
    for (const o of declines) {
      const out = o.resolve(ctx(), seeded(3));
      expect(o.cost, o.id).toBeUndefined();
      expect(
        out.coupons ?? 0, o.id
      ).toBe(0);
      expect(out.ehp ?? 0, o.id).toBe(0);
      expect(out.dyes, o.id).toBeUndefined();
    }
  });

  it('所有选项的结算都不修改传入的 ctx（纯函数）', () => {
    const snapshot = ctx({ coupons: 50, ehp: 80 });
    const before = JSON.stringify(snapshot);
    for (const def of eventDefs) {
      for (const opt of def.options) {
        opt.resolve(snapshot, seeded(5));
      }
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('hasFlag —— 跨事件连锁', () => {
  it('事件标记按 `flag:` 前缀存取，不会和事件 id 混淆', () => {
    expect(hasFlag(ctx({ seen: ['flag:trial-buff'] }), 'trial-buff')).toBe(true);
    expect(hasFlag(ctx({ seen: ['ev-sample-theft'] }), 'trial-buff')).toBe(false);
    expect(hasFlag(ctx(), 'trial-buff')).toBe(false);
  });

  it('缺 seen 字段时安全返回 false（旧快照兼容）', () => {
    const broken = { ...ctx(), seen: undefined } as unknown as EventContext;
    expect(hasFlag(broken, 'x')).toBe(false);
  });
});

describe('与 GameState 的字段对齐', () => {
  it('resetRun 会把 coupons 与 seenEvents 归零', () => {
    resetRun();
    gameState.coupons = 999;
    gameState.seenEvents = ['ev-scrap-notes'];
    resetRun();
    expect(gameState.coupons).toBe(0);
    expect(gameState.seenEvents).toEqual([]);
  });

  it('可以从 gameState 直接构造 EventContext（字段名一致）', () => {
    resetRun();
    gameState.coupons = 40;
    const built: EventContext = {
      coupons: gameState.coupons,
      ehp: gameState.ehp,
      ehpMax: gameState.ehpMax,
      valence: gameState.valence,
      maxValence: gameState.maxValence,
      temperature: gameState.temperature,
      layer: gameState.layer,
      dyeCount: gameState.dyeSlots.filter((s) => s.dyeId).length,
      gearCount: gameState.carriedGear.length,
      boonCount: gameState.equippedBoons.length,
      kills: gameState.kills,
      seen: gameState.seenEvents
    };
    expect(built.coupons).toBe(40);
    expect(canAfford(built, { coupons: 40 })).toBe(true);
  });
});