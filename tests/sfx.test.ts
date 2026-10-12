import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PRIORITY,
  SFX_TABLE,
  allSfxFiles,
  getSfxDef,
  resolveSfxFiles,
  type SfxCategory
} from '../src/game/data/sfx';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('音效清单的基本完整性', () => {
  it('语义 key 唯一', () => {
    const keys = SFX_TABLE.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每个定义都有资产文件、音量与分类', () => {
    for (const d of SFX_TABLE) {
      expect(d.file.length, d.key).toBeGreaterThan(0);
      expect(d.volume, d.key).toBeGreaterThan(0);
      expect(d.volume, d.key).toBeLessThanOrEqual(1);
      expect(['impact', 'action', 'state', 'deny', 'ui', 'alert']).toContain(d.category);
    }
  });

  it('音高抖动在合理范围内（太小无效果，太大跑调）', () => {
    for (const d of SFX_TABLE) {
      if (d.rateJitter === undefined) continue;
      expect(d.rateJitter, d.key).toBeGreaterThan(0);
      expect(d.rateJitter, d.key).toBeLessThanOrEqual(0.25);
    }
  });
});

describe('音效资产真实存在（避免加载后 __MISSING 式静默失败）', () => {
  it('allSfxFiles 列出的每个文件都在 assets/audio 下', () => {
    const files = allSfxFiles();
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(existsSync(resolve(__dirname, '../assets/audio', f)), `资产缺失: ${f}`).toBe(true);
    }
  });

  it('每个定义的 file 字段都在磁盘上', () => {
    for (const d of SFX_TABLE) {
      expect(existsSync(resolve(__dirname, '../assets/audio', d.file)), `${d.key} → ${d.file}`).toBe(true);
    }
  });

  it('变体族里的每个变体也都在磁盘上', () => {
    for (const d of SFX_TABLE) {
      if (!d.variants) continue;
      expect(d.variants.length, d.key).toBeGreaterThan(1);
      for (const v of d.variants) {
        expect(existsSync(resolve(__dirname, '../assets/audio', v)), `${d.key} 变体 ${v}`).toBe(true);
      }
    }
  });
});

describe('变体族与优先级', () => {
  it('最高频的挥砍音必须有变体族（否则像复读机）', () => {
    const swing = getSfxDef('swing')!;
    expect(swing.variants).toBeDefined();
    expect(swing.variants!.length).toBeGreaterThanOrEqual(3);
  });

  it('resolveSfxFiles 对无变体者返回单元素', () => {
    expect(resolveSfxFiles(getSfxDef('pickup')!)).toEqual(['ding.wav']);
  });

  it('allSfxFiles 去重', () => {
    const files = allSfxFiles();
    expect(new Set(files).size).toBe(files.length);
  });

  it('优先级：战斗反馈 > 危险 > 动作 > 状态 > 拒绝 > UI', () => {
    const order: SfxCategory[] = ['impact', 'alert', 'action', 'state', 'deny', 'ui'];
    for (let i = 1; i < order.length; i += 1) {
      expect(CATEGORY_PRIORITY[order[i - 1]], order[i - 1]).toBeGreaterThan(CATEGORY_PRIORITY[order[i]]);
    }
  });
});

describe('命中的音频分段符合 act-combat-design 的频段分级', () => {
  /**
   * skill 的分级表要求轻击清脆中高频、重击沉闷中低频。
   * 这里锁住"轻击/重击是两个不同资产"这条下限——
   * 若两者指向同一文件，分级就形同虚设。
   */
  it('轻击与重击用不同资产', () => {
    expect(getSfxDef('hit-light')!.file).not.toBe(getSfxDef('hit-heavy')!.file);
  });

  it('暴击与危险预警音量高于普通命中（要能在混战里穿透）', () => {
    expect(getSfxDef('crit')!.volume).toBeGreaterThan(getSfxDef('hit-light')!.volume);
    expect(getSfxDef('meltdown')!.volume).toBeGreaterThan(getSfxDef('hit-light')!.volume);
  });

  it('UI 音一律轻于战斗反馈音（不抢戏）', () => {
    const maxUi = Math.max(...SFX_TABLE.filter((d) => d.category === 'ui').map((d) => d.volume));
    const minImpact = Math.min(...SFX_TABLE.filter((d) => d.category === 'impact').map((d) => d.volume));
    expect(maxUi, 'UI 音不得盖过战斗反馈').toBeLessThan(minImpact);
  });

  it('反馈类都有音高抖动（打散机械重复）', () => {
    for (const d of SFX_TABLE.filter((x) => x.category === 'impact')) {
      expect(d.rateJitter, d.key).toBeDefined();
    }
  });
});

describe('key 查询', () => {
  it('未知 key 返回 undefined 而不是抛错', () => {
    expect(getSfxDef('__nope__')).toBeUndefined();
  });

  it('关键事件都有专属音效（不是全部挤在通用键上）', () => {
    for (const key of ['hit-light', 'crit', 'hurt', 'swing', 'cast', 'pickup', 'deny', 'meltdown']) {
      expect(getSfxDef(key), key).toBeDefined();
    }
  });
});