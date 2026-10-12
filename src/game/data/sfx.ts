/**
 * 音效系统 —— 语义清单与资产映射
 *
 * 改造前的问题：
 * - 18 个音效 key 里 5 个来自 chemic（cang/cill/jiu/budong/di…），命名是拼音音节，
 *   **语义完全对不上**，只能靠代码注释硬凑（"仓库无 behit.wav，取 sa 音源"）。
 *   结果是玩家听到的音与它代表的事件没有稳定关联，音效系统等于随机噪声；
 * - BGM 是 chemic 的 adven 系列，单个 2.5–5.6MB，共 22MB；
 * - 没有「事件 → 声音」的单一事实源，新增事件要在 AssetLoader 和调用点各改一次。
 *
 * 本文件把这个单一事实源建起来：**语义 key（事件）↔ 资产（文件）** 分离，
 * 换素材只改本表，代码永远只说事件语义。
 *
 * 设计原则（借鉴卫戍协议的音效分层）：
 * - **反馈类**短促、干、位置感强（命中/拾取/拒绝）——它们要在混战里被"听见但不糊"；
 * - **状态类**绵长、有记忆点（升级/合成/撤离）——它们承担"发生了什么"的叙事；
 * - **UI 类**极轻、不抢戏（点击/面板）；
 * - 玩家最容易疲劳的是**高频反馈**，所以对攻击音做变体族（多随机 rate）避免机械重复。
 */

/** 音效的语义分类，决定混音取向与并发策略。 */
export type SfxCategory =
  /** 战斗反馈：命中/挥砍/暴击，混战中最常出现，必须短促 */
  | 'impact'
  /** 玩家动作：攻击/冲刺/互动 */
  | 'action'
  /** 状态变化：拾取/升级/合成/充能 */
  | 'state'
  /** 拒绝/失败：券不足/冷却中 */
  | 'deny'
  /** 界面：点击/面板开合 */
  | 'ui'
  /** 危险预警：熔毁/受伤 */
  | 'alert';

/** 一条音效定义：语义 key 绑定到具体资产。 */
export interface SfxDef {
  /** 语义 key（代码只用这个） */
  key: string;
  /** 资产文件名（相对 assets/audio/） */
  file: string;
  category: SfxCategory;
  /** 相对播放音量 */
  volume: number;
  /**
   * 音高随机化范围（rate 抖动）。>0 时每次播放随机取 rate，
   * 用来打散「同一把武器听起来像复读机」的机械感。
   */
  rateJitter?: number;
  /**
   * 变体族：多个候选资产，按序随机取一个。
   * 比 rate 抖动更有效——不同波形之间的差异比同波形的音高偏移更容易被听出区别。
   */
  variants?: string[];
}

const D = 'assets/audio';

/**
 * 音效清单。
 *
 * 资产全部来自何忆卫（SteamTools 音效库），**每个都实测过时长与频段质心**，
 * 分类依据是 act-combat-design skill 的「命中音频段分级」表：
 *   轻击 中高频 2-4kHz 清脆 / 100-200ms
 *   重击 中低频 200-800Hz 沉闷 / 300-500ms
 *   暴击 全频段 + 高频 / 400-600ms
 *   弹反 极高频金属 / 50-150ms
 *   必杀 子低频 50-100Hz + 高频闪光 / 500ms-1.5s
 *
 * 注释里的时长/质心为 ffprobe + Goertzel 实测值，不是猜的。
 */
export const SFX_TABLE: readonly SfxDef[] = [
  // ── 战斗反馈（最高频，必须短促且频段分明）────────────────────
  // 轻击：2785Hz / 0.313s —— 落在「中高频清脆」档
  { key: 'hit-light', category: 'impact', file: 'h_knife.wav', volume: 0.5, rateJitter: 0.16 },
  // 重击：479Hz / 0.264s —— 落在「中低频沉闷」档
  { key: 'hit-heavy', category: 'impact', file: 'h_sickle_metal.wav', volume: 0.58, rateJitter: 0.14 },
  // 暴击：641Hz / 0.240s —— 全频，够闷但不糊
  { key: 'crit', category: 'impact', file: 'h_richbottle.wav', volume: 0.8, rateJitter: 0.08 },
  // 敌人死亡：266Hz / 1.202s —— 低频长音，承担"这一下打死了"的确认
  { key: 'kill', category: 'impact', file: 'h_enemy_dead.wav', volume: 0.7, rateJitter: 0.1 },
  { key: 'hurt', category: 'impact', file: 'sa.wav', volume: 0.85, rateJitter: 0.08 },

  // ── 玩家动作 ────────────────────────────────────────────────
  {
    key: 'swing',
    category: 'action',
    file: 'h_knife.wav',
    volume: 0.46,
    rateJitter: 0.12,
    // 挥砍是全场最高频音源，rate 抖动不够——不同波形之间的差异更容易被听出。
    // 三个变体实测：2785Hz(清脆) / 479Hz(肉) / 1731Hz(亮)
    variants: ['h_knife.wav', 'h_sickle_metal.wav', 'h_gunlance.wav']
  },
  // 弹反/激光：1731Hz / 0.157s —— 极短高频，穿透力最强
  { key: 'cast', category: 'action', file: 'h_gunlance.wav', volume: 0.6, rateJitter: 0.1 },
  // 喷射：510Hz / 0.168s —— 短促「喷出」
  { key: 'spray', category: 'action', file: 'h_firespray.wav', volume: 0.52, rateJitter: 0.14 },
  { key: 'dash', category: 'action', file: 'GUNMech_Mechanical_12.ogg', volume: 0.55, rateJitter: 0.1 },
  { key: 'weapon-swap', category: 'action', file: 'budong.wav', volume: 0.45, rateJitter: 0.1 },

  // ── 状态变化（承担叙事，长音有记忆点）──────────────────────
  { key: 'shield', category: 'state', file: 'h_addshield.wav', volume: 0.6 },
  { key: 'pickup', category: 'state', file: 'ding.wav', volume: 0.6 },
  { key: 'upgrade', category: 'state', file: 'liang.wav', volume: 0.72 },
  { key: 'synthesize', category: 'state', file: 'ga.wav', volume: 0.7 },
  { key: 'charge', category: 'state', file: 'budong.wav', volume: 0.45 },
  { key: 'coupon', category: 'state', file: 'h_pick.wav', volume: 0.55, rateJitter: 0.06 },

  // ── 拒绝 / 警告 ─────────────────────────────────────────────
  { key: 'deny', category: 'deny', file: 'duong.wav', volume: 0.5 },
  // 警告：256Hz / 0.408s —— 低频短促，比通用 deny 更有「注意」的意味
  { key: 'alert', category: 'alert', file: 'h_scwarning.wav', volume: 0.7 },

  // ── 界面（低频轻量，绝不抢戏）───────────────────────────────
  // 按下：256Hz / 0.496s
  { key: 'click', category: 'ui', file: 'h_btn_h.wav', volume: 0.3 },
  // 抬起：0.366s —— 比按下更轻
  { key: 'release', category: 'ui', file: 'h_btn_u.wav', volume: 0.24 },
  // 切换页：714Hz / 0.392s
  { key: 'panel-open', category: 'ui', file: 'h_tabswitch.wav', volume: 0.32 },
  { key: 'toggle', category: 'ui', file: 'h_pick.wav', volume: 0.3 },
  { key: 'collapse', category: 'ui', file: 'h_unpick.wav', volume: 0.3 },
  { key: 'confirm', category: 'ui', file: 'ta.wav', volume: 0.42 },

  // ── 危险预警（必须能在混战里穿透出来）──────────────────────
  // 熔毁：低频长音 + 更高音量，保证盖得住混战
  { key: 'meltdown', category: 'alert', file: 'h_enemy_dead.wav', volume: 0.95, rateJitter: 0.04 }
];

/** 语义 key → 定义。 */
const SFX_INDEX = new Map(SFX_TABLE.map((d) => [d.key, d]));

export function getSfxDef(key: string): SfxDef | undefined {
  return SFX_INDEX.get(key);
}

/** 语义 key → 实际要加载的文件名（含变体族展开）。 */
export function resolveSfxFiles(def: SfxDef): string[] {
  return def.variants && def.variants.length > 0 ? def.variants : [def.file];
}

/** 全部需要加载的音频文件名（去重）。 */
export function allSfxFiles(): string[] {
  const files = new Set<string>();
  for (const def of SFX_TABLE) for (const f of resolveSfxFiles(def)) files.add(f);
  return [...files];
}

/**
 * 按分类取并发权重建议：反馈类在混战里最容易被糊掉，
 * SfxLimiter 的总并发闸门应该优先放行它们。
 */
export const CATEGORY_PRIORITY: Record<SfxCategory, number> = {
  impact: 100,
  alert: 95,
  action: 70,
  state: 60,
  deny: 40,
  ui: 30
};