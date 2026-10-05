/**
 * 平衡配置（设计文档 §4 战斗数值 / §6 温度 / §13 经济）
 *
 * 为什么要有这一个文件：数值散落在 5600 行的 GameScene 里时，
 * 任何平衡调整都变成"全项目搜索 + 猜"，且极易改一半漏一半。
 * 这里集中所有会直接改变手感的数字，并写清**为什么是这个值**。
 *
 * 调整规则：只改这里；GameScene 只负责消费。改完跑 npm test，部分区间有单测保护。
 */

export const BALANCE = {
  player: {
    /** 加速度：氧化态更快（进攻倾向），还原态更稳（防守倾向） */
    accelOxidized: 3080,
    accelReduced: 2420,
    /** 最大速度（px/s）：基础 440 + 15% 机动性 */
    maxVelocity: 506,
    /**
     * 高速反向时的加速度保留系数（<1 会降低加速度）。
     * 曾取 0.8 用于抑制反向飘移，但实测让转向明显发钝（"很重"），
     * 故放开为 1.0：转向灵敏度优先，飘移由下面的 drag 收敛。
     */
    reverseAccelFactor: 1.0,
    /**
     * 无输入轴向的速度衰减（px/s²）。Phaser 的 drag 只在「该轴加速度为 0」时生效，
     * 因此这个值实际决定两件事：松开后的刹车距离，以及转向时"旧方向"分量归零的快慢。
     * 取 2600 使归零时间（≈0.2s）接近加速到满速的时间，转向更贴近直角而非画弧。
     */
    stopDrag: 2600
  },
  dash: {
    /** 冲刺初速与最大速度放宽值 */
    velocity: 900,
    maxVelocity: 1200,
    /** 位移持续时间 */
    motionSeconds: 0.16,
    /** 二段冲刺窗口：在此时限内可再冲一次 */
    windowSeconds: 0.45,
    /** 两次冲刺之间的最小间隔 */
    nextReadySeconds: 0.1,
    /** 基础冲刺冷却（再乘 §4.3 负载倍率） */
    cooldownSeconds: 0.8
  },
  temperature: {
    /** 战斗中的基础升温（/s）：用户标定 = 原 0.12 的 40% */
    riseBase: 0.048,
    /** 战斗中的温度相关升温系数（越热升得越快）：用户标定 = 原 0.28 的 40% */
    riseHeatScale: 0.112,
    /** 战斗中的自然散热（/s） */
    coolInCombat: 0.12,
    /** 非战斗散热（/s）：这是"温度逼你撤离"之外的缓冲，不能太快 */
    coolOutOfCombat: 0.6,
    /**
     * 反应热除数：每次氧化/还原命中的升温 = |ΔH| / 此值。
     * 氧化命中是高频事件（一层 80-120 次），除数过小（旧值 30 → 远程怪 +9.5°/击）
     * 会让反应热完全淹没被动升温，"还没见到 Boss 就熔毁"。240 使一整层
     * 大约落在 45-55°（过热边缘），Boss 战才有机会逼近临界。
     */
    reactionHeatDivisor: 240,
    /**
     * 还原态吸热降温（§2.2 还原 = 吸热方向）：每次向敌人注入 1 颗电子降温此值。
     * 定位：还原态是本作唯一的"主动控温"手段——高热时切还原既安全又降温，
     * 但击杀效率低于氧化，构成「输出 vs 控温」的真实取舍。1.6 × 每次 3-5 颗注入
     * ≈ 每个怪 -6~-8°，热危机时切还原约两三个怪就能拉回稳定区。
     */
    reduceCoolPerCapture: 1.6,
    /** 波次冷却随温度缩短的上限与系数（§6.1 过热 ⇒ 敌人更凶） */
    waveCooldownMin: 0.6,
    waveCooldownBase: 4,
    waveCooldownHeatScale: 3.2
  },
  overload: {
    /**
     * 过载触发阈值：温度超过第二阈值（60° 过热线）即进入过载。
     * 定位变更：过载从"自由电子满仓"改为纯温度机制——高温本身就是必须管理的状态，
     * 还原态降温（reduceCoolPerCapture）成为唯一主动解法，避免玩家在电子满仓时
     * 被"满仓=过载"的隐性条件莫名其妙扣血。
     */
    tempThreshold: 60,
    /** 过载自损（HP/s）：高温灼烧，速率温和（0.4/s ≈ 250 秒燃尽满血），压力而非秒杀 */
    selfDamagePerSec: 0.4,
    /** 触发后的宽限期（秒）：温度冲线瞬间给玩家反应时间（切还原/撤离） */
    graceSec: 2.5,
    /** 过载期间的伤害补偿倍率：冒险顶热输出的回报 */
    damageMult: 1.25
  },
  samples: {
    /** 击杀基础样本 */
    killBase: 1,
    /** 每多少度额外 +1 样本（温度换收益） */
    killHeatDivisor: 25,
    /** 撤离完成的基础奖励（与携带样本相加后再乘撤离点倍率） */
    extractionBase: 2,
    extractionHeatDivisor: 20
  },
  economy: {
    /**
     * 死亡是否丢失携带样本。
     * 设计依据 §13.1：样本是"撤离带出"的资源；§1.2 核心循环「死亡丢失未保险样本」。
     * 死亡仍然保留累计击杀/深度/Boss 进度（Fail forward 体现在成长，而不是样本）。
     */
    loseCarriedSamplesOnDeath: true,
    /** 遗物升级花费（Lv1→2 / Lv2→3） */
    relicUpgradeCosts: [15, 30] as const,
    /** 武器升级花费（Lv1→2 / Lv2→3，见 weapons.ts 同步维护） */
    weaponUpgradeCosts: [8, 20] as const
  },
  combat: {
    /** 伤害数字上限展示（超过则折叠为 "999+"，避免长数字糊住战斗区） */
    damageNumberCap: 999,
    /** 命中定格期间钟停上限，防止祝福叠满后顿感变卡顿 */
    maxHitStop: 0.12,
    /**
     * 失控取消（卫戍协议 11-limits「取消而非截断」的同款规则）：对电子储备 ≥80%
     * 的目标单发夺取 ≥7 颗 → 整击取消（一颗都拿不到）。无限堆单发倍率反而亏输出，
     * 正确打法是先普攻削储备再倾泻爆发——把数值上限做成负向决策。
     */
    runawayCancelThreshold: 10,
    runawayFullRatio: 0.8,
    /** 波次等价替换（卫戍协议 08「换怪不换难度」）：加权抽中后按此概率换成战力相近的同类敌人 */
    equivalentSwapChance: 0.5,
    /** 等价替换的战力容差（±25% 内视为等价） */
    equivalentSwapTolerance: 0.25,
    /** 敌人轨道电子换算：每这么多点 maxHp 一颗电子（线性，容量 8 封顶） */
    enemyHpPerElectron: 55
  },
  /** 反应层数（借鉴 bonds 层系统）：电子转移累积催化层数，全局线性加成 + 里程碑掉落 */
  reaction: {
    /** 每层全局伤害 +0.2%（线性，不设乘区叠加，防指数崩坏） */
    damagePerLayer: 0.002,
    /** 反失控硬上限：999 层后不再增长 */
    layerCap: 999,
    /** 里程碑掉落：按序领取，层数只增不减 */
    milestones: [
      { at: 25, reward: 'samples', amount: 10, label: '样本 +10' },
      { at: 50, reward: 'electron', amount: 1, label: '自由电子 +1' },
      { at: 100, reward: 'cool', amount: 30, label: '降温 30°' },
      { at: 200, reward: 'damage', amount: 0.10, label: '永久伤害 +10%' },
      { at: 400, reward: 'electron', amount: 2, label: '自由电子 +2' }
    ] as const
  },
  /** 祝福池局内禁用（卫戍协议「每局随机禁用盟约」）：强制每局换 build、防背版 */
  upgrades: {
    runDisabledCount: 2
  }
} as const;

/**
 * 平衡自检：供单测断言关键区间，避免手滑改出破坏体验的数值。
 * 返回违规项列表（空数组表示通过）。
 */
export function validateBalance(): string[] {
  const issues: string[] = [];
  if (BALANCE.player.maxVelocity < 200 || BALANCE.player.maxVelocity > 1200) {
    issues.push('maxVelocity 超出可玩区间 200-1200');
  }
  if (BALANCE.temperature.coolOutOfCombat <= BALANCE.temperature.riseBase) {
    issues.push('非战斗散热必须大于战斗基础升温，否则温度不可回落');
  }
  if (BALANCE.dash.cooldownSeconds <= 0) issues.push('冲刺冷却必须为正');
  if (BALANCE.samples.killHeatDivisor <= 0) issues.push('killHeatDivisor 必须为正，避免除零');
  if (BALANCE.overload.selfDamagePerSec <= 0) issues.push('过载自损速率必须为正');
  if (BALANCE.overload.tempThreshold < 60 || BALANCE.overload.tempThreshold > 80) {
    issues.push('过载阈值应落在过热区（60-80）之间，过低会长期过载、过高则机制无法触达');
  }
  if (BALANCE.economy.relicUpgradeCosts[1] <= BALANCE.economy.relicUpgradeCosts[0]) {
    issues.push('遗物升级花费必须递增');
  }
  if (BALANCE.economy.weaponUpgradeCosts[1] <= BALANCE.economy.weaponUpgradeCosts[0]) {
    issues.push('武器升级花费必须递增');
  }
  return issues;
}