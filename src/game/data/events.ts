/**
 * 局内事件系统 —— 数据驱动的事件与纯函数结算
 *
 * 现状（改造前）：`RoomType` 里早就有 `'event'`，但 `GameScene.ts:1847` 只会
 * `spawnInstrument()`，没有任何事件内容；`src/game/events/EventBus.ts` 是个 20 行的 pub/sub。
 * 换句话说「事件房」是一个空壳。
 *
 * 设计参考：
 * - 明日方舟集成战略的「不期而遇」—— 选项普遍是**消耗换收益**，代价写在脸上；
 * - Hades 的「可预期」—— 每个选项都给出确定的收益/代价，不做黑箱。
 *
 * **硬约束**：`resolve` 必须是纯函数（入参 ctx + rng，出参是一组增量），
 * 绝不直接改 `gameState`。这样整张事件表可以被单测穷举，而不用跑 Phaser。
 * 应用增量是 `GameScene` 的事（下一片 S2.2）。
 *
 * 颜色语义沿用化学主题：朱赤=氧化、碧青=还原、苍蓝=催化。
 */

import { dyes } from './dyes';

/** 事件结算所需的局内快照（只读，不含任何 Phaser 对象）。 */
export interface EventContext {
  /** 局内货币催化券 */
  coupons: number;
  ehp: number;
  ehpMax: number;
  valence: number;
  maxValence: number;
  temperature: number;
  layer: number;
  /** 持有染料数 */
  dyeCount: number;
  /** 携带装备数（搜打撤，带出才保得住） */
  gearCount: number;
  /** 已装备祝福数 */
  boonCount: number;
  kills: number;
  /** 本局已触发的事件 id */
  seen: readonly string[];
}

export type Rng = () => number;

/** 结算结果：一组**增量**。约定与既有状态一致：正数增加、负数减少。 */
export interface EventOutcome {
  /** 展示给玩家的结果文案 */
  text: string;
  coupons?: number;
  ehp?: number;
  ehpMax?: number;
  temperature?: number;
  freeElectrons?: number;
  /** 获得的染料 id */
  dyes?: string[];
  /** 写进本局标记位，供后续事件的 `available` 判定 */
  flags?: string[];
  /** 下一个战斗房的敌人 HP 倍率（道德抉择的代价） */
  nextCombatHpMult?: number;
}

export interface EventCost {
  coupons?: number;
  ehp?: number;
}

export interface EventOption {
  id: string;
  label: string;
  /**
   * 明示代价。集成战略的「不期而遇」都把代价写在选项上——
   * 玩家能做决策的前提是代价可见，否则「消耗换收益」只是隐藏惩罚。
   */
  hint?: string;
  cost?: EventCost;
  /** 当前是否可选（券不够、状态不符就置灰）。缺省视为总是可选。 */
  available?: (ctx: EventContext) => boolean;
  resolve: (ctx: EventContext, rng: Rng) => EventOutcome;
}

export interface EventDef {
  id: string;
  title: string;
  flavor: string;
  /** 抽取权重 */
  weight: number;
  /** 每局只出现一次 */
  once?: boolean;
  /**
   * 「这件事现在是否发生」。
   * 只用于那种**整个事件当下就不成立**的情况（如温度太低就没必要进低温冷柜）。
   * 「你能不能做某个交易」应该挂在选项上（`EventOption.available`），
   * 否则玩家会发现自己从没抽到过某个事件，而不是发现某个选项灰了——后者信息量更大。
   */
  available?: (ctx: EventContext) => boolean;
  options: EventOption[];
}

// ── 工具 ────────────────────────────────────────────────────────────────────

function pickDye(rng: Rng): string {
  return dyes[Math.floor(rng() * dyes.length) % dyes.length].id;
}

/** 券够不够。事件选项的置灰判定与结算必须用同一把尺子，否则会出现「能点但扣成负数」。 */
export function canAfford(ctx: EventContext, cost?: EventCost): boolean {
  if (!cost) return true;
  if (cost.coupons && ctx.coupons < cost.coupons) return false;
  if (cost.ehp && ctx.ehp < cost.ehp) return false; // 花光 EHP 会丢一个价电子，允许但不默认
  return true;
}

export function optionAvailable(opt: EventOption, ctx: EventContext): boolean {
  if (!canAfford(ctx, opt.cost)) return false;
  return opt.available ? opt.available(ctx) : true;
}

// ── 事件表 ──────────────────────────────────────────────────────────────────

export const eventDefs: EventDef[] = [
  // ── 纯收益：免费，但每局一次 ────────────────────────────────────────────
  {
    id: 'ev-scrap-notes',
    title: '废弃的实验记录',
    flavor: '抽屉底层压着一叠没人归档的数据。墨迹还是新的。',
    weight: 10,
    once: true,
    options: [
      {
        id: 'read',
        label: '通读全部记录',
        hint: '+18 催化券 · 每局一次',
        resolve: () => ({ text: '你把整叠记录换成了可兑现的价值。', coupons: 18 })
      },
      {
        id: 'shelve',
        label: '按原样归档',
        hint: '什么也不发生',
        resolve: () => ({ text: '你把它们塞回抽屉最底层。' })
      }
    ]
  },
  {
    id: 'ev-cold-storage',
    title: '低温冷柜',
    flavor: '柜门上结着白霜，压缩机还在低鸣。',
    weight: 8,
    once: true,
    available: (ctx) => ctx.temperature >= 45,
    options: [
      {
        id: 'chill',
        label: '钻进去降温',
        hint: '温度 -30',
        resolve: (ctx) => ({ text: `白霜贴上皮肤，反应慢了下来（温度 -30）。`, temperature: -30 })
      },
      {
        id: 'sample',
        label: '只取一管冷凝液',
        hint: '+10 催化券 · 温度 -8',
        resolve: () => ({ text: '冷凝液灌进试管，够兑一笔小钱。', coupons: 10, temperature: -8 })
      }
    ]
  },
  {
    id: 'ev-leaked-sample',
    title: '泄漏的样本',
    flavor: '地上有一小滩还没干的东西，在灯光下泛着虹。',
    weight: 9,
    once: true,
    options: [
      {
        id: 'collect',
        label: '收集起来',
        hint: '+2 自由电子',
        resolve: () => ({ text: '两枚自由电子顺着指尖爬进体内。', freeElectrons: 2 })
      },
      {
        id: 'leave',
        label: '让它流着',
        hint: '什么也不发生',
        resolve: () => ({ text: '液体在地面上继续扩散，反射着灯光。' })
      }
    ]
  },

  // ── 赌博 ────────────────────────────────────────────────────────────────
  {
    id: 'ev-purity-test',
    title: '纯度检测',
    flavor: '分析仪的屏幕上只有一个跳动的百分比。机器不告诉你它准不准。',
    weight: 10,
    options: [
      {
        id: 'gamble',
        label: '押上 20 券赌一次',
        hint: '成本 20 券 · 五成翻四倍',
        cost: { coupons: 20 },
        resolve: (_ctx, rng) =>
          rng() < 0.5
            ? { text: '读数跳到 81%。你把这一瓶卖了个好价。', coupons: 80 }
            : { text: '读数是 12%。样品废了，钱也进去了。', coupons: -20 }
      },
      {
        id: 'leave',
        label: '不赌',
        hint: '什么也不发生',
        resolve: () => ({ text: '你关掉仪器，转身走了。' })
      }
    ]
  },
  {
    id: 'ev-unstable-sample',
    title: '不稳定样本',
    flavor: '容器在轻轻震。标签写着「勿加热」。',
    weight: 8,
    options: [
      {
        id: 'brave',
        label: '徒手取样',
        hint: '成本 15 EHP · +40 券',
        cost: { ehp: 15 },
        available: (ctx) => ctx.ehp > 30,
        resolve: () => ({ text: '手套烧穿了，但瓶子在手里安静下来——值。', ehp: -15, coupons: 40 })
      },
      {
        id: 'walk-away',
        label: '绕开',
        hint: '什么也不发生',
        resolve: () => ({ text: '你从它旁边绕了过去。' })
      }
    ]
  },
  {
    id: 'ev-unlabeled-vial',
    title: '无标签试剂瓶',
    flavor: '瓶身上什么都没有，连颜色都被光照得辨不出。',
    weight: 7,
    options: [
      {
        id: 'open',
        label: '打开',
        hint: '结果未知',
        resolve: (_ctx, rng) => {
          const roll = rng();
          if (roll < 0.34) return { text: '瓶里是一管浓缩染料。', dyes: [pickDye(rng)] };
          if (roll < 0.67) return { text: '瓶底沉着几枚催化券。', coupons: 25 };
          return { text: '一股辛辣的气体冲上来，你咳了很久。', ehp: -20 };
        }
      },
      {
        id: 'leave',
        label: '不动它',
        hint: '什么也不发生',
        resolve: () => ({ text: '瓶子留在架子上。' })
      }
    ]
  },

  // ── 交易：券与其它资源的换手（有价差，所以可被反复套利）──────────────────
  {
    id: 'ev-dye-broker',
    title: '染料贩子',
    flavor: '他把货摊在地上，布料上摆着十几管颜色。他不还价，但也不抬价。',
    weight: 10,
    options: [
      {
        id: 'buy',
        label: '买一管染料',
        hint: '成本 30 券 · +1 随机染料',
        cost: { coupons: 30 },
        available: (ctx) => ctx.coupons >= 30,
        resolve: (_ctx, rng) => {
          const dye = pickDye(rng);
          const name = dyes.find((d) => d.id === dye)?.name ?? dye;
          return { text: `你买下了一管${name}。`, coupons: -30, dyes: [dye] };
        }
      },
      {
        id: 'refuse',
        label: '不买',
        hint: '什么也不发生',
        resolve: () => ({ text: '你摇摇头走开了。' })
      }
    ]
  },
  {
    id: 'ev-scrap-deal',
    title: '废料回收站',
    flavor: '回收站的传送带还在转。工人不问你的装备从哪来。',
    weight: 9,
    options: [
      {
        id: 'sell',
        label: '卖掉最旧的一件装备',
        hint: '−1 携带装备 · +45 券',
        available: (ctx) => ctx.gearCount > 0,
        resolve: () => ({
          text: '传送带吞下了它。数字在秤上跳了几下就停住了。',
          coupons: 45,
          flags: ['sold-gear']
        })
      },
      {
        id: 'keep',
        label: '不卖',
        hint: '什么也不发生',
        resolve: () => ({ text: '你按住了那件装备。' })
      }
    ]
  },
  {
    id: 'ev-electron-lender',
    title: '电子借贷',
    flavor: '柜台后面的人不问用途，只问你什么时候还。',
    weight: 8,
    options: [
      {
        id: 'borrow',
        label: '预支 60 券',
        hint: '+60 券 · 本局结束时少带一件战利品',
        resolve: () => ({
          text: '他数出六十张券，按了手印。',
          coupons: 60,
          flags: ['debt-carry']
        })
      },
      {
        id: 'decline',
        label: '不借',
        hint: '什么也不发生',
        resolve: () => ({ text: '你把手从柜台收回来。' })
      }
    ]
  },

  // ── 道德抉择：本局永久收益，代价是即时的 ────────────────────────────────
  {
    id: 'ev-human-trial',
    title: '以身试药',
    flavor: '受试者栏空着。笔就在桌上。',
    weight: 7,
    once: true,
    available: (ctx) => ctx.ehpMax > 60,
    options: [
      {
        id: 'sign',
        label: '签下名字',
        hint: '本局伤害 +12% · EHP 上限 −20',
        resolve: () => ({
          text: '针剂推进去的时候你笑了一下。剩下的路会更快，也会更薄。',
          ehpMax: -20,
          flags: ['trial-buff']
        })
      },
      {
        id: 'refuse',
        label: '不签',
        hint: '什么也不发生',
        resolve: () => ({ text: '你把笔放回了原处。' })
      }
    ]
  },
  {
    id: 'ev-sample-theft',
    title: '样本盗窃',
    flavor: '监控有二十秒的循环录像。二十秒够搬一箱。',
    weight: 7,
    options: [
      {
        id: 'steal',
        label: '搬走一箱',
        hint: '+55 券 · 下一战敌人 HP +15%',
        resolve: () => ({
          text: '箱子很沉，抬到门口时你才想起自己本来不该拿。',
          coupons: 55,
          nextCombatHpMult: 1.15,
          flags: ['stolen']
        })
      },
      {
        id: 'leave',
        label: '装作没看见',
        hint: '什么也不发生',
        resolve: () => ({ text: '你数着自己的脚步走过去了。' })
      }
    ]
  },
  {
    id: 'ev-burn-notes',
    title: '焚毁记录',
    flavor: '炉子已经预热好了。这里烧掉的不是纸。',
    weight: 6,
    once: true,
    options: [
      {
        id: 'burn',
        label: '烧掉一个祝福',
        hint: '−1 祝福 · +60 券',
        available: (ctx) => ctx.boonCount > 0,
        resolve: () => ({
          text: '纸卷着火苗塌下去，颜色和你手上的一样。',
          coupons: 60,
          flags: ['burned-boon']
        })
      },
      {
        id: 'keep',
        label: '留着',
        hint: '什么也不发生',
        resolve: () => ({ text: '你关上了炉门。' })
      }
    ]
  }
];

// ── 抽取 ────────────────────────────────────────────────────────────────────

export function availableEvents(ctx: EventContext): EventDef[] {
  return eventDefs.filter((def) => {
    if (def.once && ctx.seen.includes(def.id)) return false;
    return def.available ? def.available(ctx) : true;
  });
}

function weightedPick<T extends { weight: number }>(items: readonly T[], rng: Rng): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length) % items.length];
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/** 抽取一个当前局况下可出现的事件；池子空时返回 null（调用方应退化成普通房间）。 */
export function rollEvent(ctx: EventContext, rng: Rng): EventDef | null {
  return weightedPick(availableEvents(ctx), rng);
}

export function getEvent(id: string): EventDef | undefined {
  return eventDefs.find((d) => d.id === id);
}

/** 事件 id 是否已经记入本局标记（道德抉择的跨事件连锁判定用）。 */
export function hasFlag(ctx: EventContext, flag: string): boolean {
  return (ctx.seen ?? []).includes(`flag:${flag}`);
}