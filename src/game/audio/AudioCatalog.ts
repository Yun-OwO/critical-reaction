/**
 * 音频语义目录 —— 语义事件到实际 soundId 的解析
 *
 * P0 发现的核心 bug（tests/audioContract.test.ts 钉住）：
 *   AssetLoader 用「文件名去扩展名」注册 soundId（`h_knife.wav` → `h_knife`），
 *   而 GameScene 播放的是语义 key（`hit-light`）。两边毫无交集，
 *   结果是**所有战斗音效实际都播不出来**，只是被 `try/catch` 静默吞掉了。
 *
 * 本模块把「语义 key ↔ soundId」的映射收敛到一处，并向上提供：
 *   - resolve(key)：语义 key → 已注册的 soundId（含变体族随机）
 *   - 解析失败时返回 null，由调用方走诊断路径，不允许再静默吞掉
 *
 * 变体族的随机来自独立的 `rng`，**不消耗战斗 RNG**（静音不能改变掉落/暴击结果）。
 */

import { CATEGORY_PRIORITY, SFX_TABLE, type SfxCategory, type SfxDef } from '../data/sfx';
import { mulberry32 } from '../utils/RunRng';

export type { SfxCategory };

/** 一条解析结果：真正要播的 soundId + 该条的混音参数。 */
export interface ResolvedSfx {
  /** Phaser 里已注册的 audio key */
  soundId: string;
  /** 语义 key（节流/诊断用，同一语义的多个变体共享一个 key） */
  event: string;
  category: SfxCategory;
  /** 清单声明的相对音量（调用方的音量在此基础上再乘） */
  volume: number;
  /** 音高抖动比例；0 表示不抖 */
  rateJitter: number;
  /** 分类优先级（声部竞争时用） */
  priority: number;
}

interface CatalogEntry {
  def: SfxDef;
  /** 变体族对应的 soundId 列表（含主 file） */
  soundIds: string[];
  priority: number;
}

/** 语义 key → 条目。 */
const CATALOG = new Map<string, CatalogEntry>();
for (const def of SFX_TABLE) {
  const ids = def.variants && def.variants.length > 0 ? def.variants : [def.file];
  CATALOG.set(def.key, {
    def,
    soundIds: ids.map((f) => f.replace(/\.[^.]+$/, '')),
    priority: CATEGORY_PRIORITY[def.category] ?? 0
  });
}

/** 旧的拼音 key → 新语义 key 的兼容映射（迁移期用，迁移完成后删除）。 */
export const LEGACY_SFX_ALIASES: Readonly<Record<string, string>> = {
  'sfx-saber-hit': 'hit-light',
  'sfx-saber-swing': 'swing',
  'sfx-cannon': 'cast',
  'sfx-behit': 'hurt',
  'sfx-dd': 'hit-heavy',
  'sfx-ding': 'pickup',
  'sfx-liang': 'upgrade',
  'sfx-ga': 'synthesize',
  'sfx-duong': 'deny',
  'sfx-click': 'click',
  'sfx-ka': 'panel-open',
  'sfx-huu': 'collapse',
  'sfx-ta': 'confirm',
  'sfx-ziya': 'toggle',
  'sfx-jiu': 'spray',
  'sfx-budong': 'charge',
  'sfx-hit': 'alert',
  'sfx-cil': 'charge',
  'sfx-switch': 'weapon-swap'
};

/**
 * 独立的音频表现随机源。
 * 与战斗 RNG 分离：静音/音量变化/变体重选都不能影响掉落、暴击等判定结果。
 */
class AudioRng {
  private next: () => number;
  private seed: number;
  constructor(seed = 0x1a2b3c4d) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }
  float(): number {
    return this.next();
  }
  /** 变体族索引。 */
  index(n: number): number {
    if (n <= 1) return 0;
    return Math.min(n - 1, Math.floor(this.next() * n));
  }
}

const audioRng = new AudioRng();

/** 供测试重置音频随机序列。 */
export function resetAudioRng(seed?: number): void {
  audioRng['seed'] = seed ?? 0x1a2b3c4d;
  audioRng['next'] = mulberry32(seed ?? 0x1a2b3c4d);
}

/**
 * 解析语义 key → 可播放的 soundId。
 *
 * @param key 语义 key 或旧拼音 key（兼容期内都接受）
 * @param opts.variantIndex 指定变体索引（测试用；缺省随机）
 * @returns 解析结果；未注册/未声明时返回 null
 */
export function resolveSfx(
  key: string,
  opts: { variantIndex?: number } = {}
): ResolvedSfx | null {
  const semantic = LEGACY_SFX_ALIASES[key] ?? key;
  const entry = CATALOG.get(semantic);
  if (!entry) return null;
  const n = entry.soundIds.length;
  const idx = opts.variantIndex ?? audioRng.index(n);
  const soundId = entry.soundIds[Math.min(n - 1, Math.max(0, idx))];
  if (!soundId) return null;
  return {
    soundId,
    event: semantic,
    category: entry.def.category,
    volume: entry.def.volume,
    rateJitter: entry.def.rateJitter ?? 0,
    priority: entry.priority
  };
}

/** 是否存在该语义（含旧别名）的声明。 */
export function hasSfx(key: string): boolean {
  return CATALOG.has(LEGACY_SFX_ALIASES[key] ?? key);
}

/** 全部语义 key（诊断/测试用）。 */
export function allSfxEvents(): string[] {
  return [...CATALOG.keys()];
}

/** 某语义的全部 soundId（含变体）。 */
export function soundIdsOf(key: string): string[] {
  const semantic = LEGACY_SFX_ALIASES[key] ?? key;
  return [...(CATALOG.get(semantic)?.soundIds ?? [])];
}

/** 该语义需要的全部资产文件名（加载对账用）。 */
export function filesOf(key: string): string[] {
  const semantic = LEGACY_SFX_ALIASES[key] ?? key;
  const def = CATALOG.get(semantic)?.def;
  if (!def) return [];
  return def.variants && def.variants.length > 0 ? [...def.variants] : [def.file];
}