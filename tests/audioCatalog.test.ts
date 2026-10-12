import { describe, expect, it } from 'vitest';
import {
  LEGACY_SFX_ALIASES,
  allSfxEvents,
  filesOf,
  hasSfx,
  resetAudioRng,
  resolveSfx,
  soundIdsOf
} from '../src/game/audio/AudioCatalog';
import { SFX_TABLE } from '../src/game/data/sfx';

describe('AudioCatalog 语义解析', () => {
  it('清单里每个语义 key 都能解析出非空 soundId', () => {
    for (const def of SFX_TABLE) {
      const r = resolveSfx(def.key);
      expect(r, def.key).not.toBeNull();
      expect(r!.soundId.length, def.key).toBeGreaterThan(0);
      expect(r!.event, def.key).toBe(def.key);
    }
  });

  it('soundId 与注册规则一致（文件名去扩展名）', () => {
    // 这是 P0 的核心 bug：注册用 h_knife，播放却用 hit-light
    const r = resolveSfx('hit-light')!;
    expect(r.soundId).toBe('h_knife');
    expect(soundIdsOf('hit-light')).toEqual(['h_knife']);
  });

  it('变体族能解析出该族全部 soundId', () => {
    const swing = soundIdsOf('swing');
    expect(swing.length).toBeGreaterThanOrEqual(3);
    for (const id of swing) expect(id.length).toBeGreaterThan(0);
    // 每次解析都落在族内
    for (let i = 0; i < 30; i += 1) {
      expect(swing).toContain(resolveSfx('swing')!.soundId);
    }
  });

  it('显式变体索引可复现（测试用）', () => {
    const ids = soundIdsOf('swing');
    expect(resolveSfx('swing', { variantIndex: 0 })!.soundId).toBe(ids[0]);
    expect(resolveSfx('swing', { variantIndex: ids.length - 1 })!.soundId).toBe(ids[ids.length - 1]);
    // 越界索引被夹到族内，不返回 undefined
    expect(ids).toContain(resolveSfx('swing', { variantIndex: 99 })!.soundId);
  });

  it('未声明的语义返回 null（不抛错，让调用方走诊断）', () => {
    expect(resolveSfx('__nope__')).toBeNull();
    expect(hasSfx('__nope__')).toBe(false);
  });

  it('旧拼音 key 经别名映射到语义', () => {
    expect(resolveSfx('sfx-saber-hit')!.event).toBe('hit-light');
    expect(resolveSfx('sfx-liang')!.event).toBe('upgrade');
    // 解析出的 soundId 与语义路径一致
    expect(resolveSfx('sfx-saber-hit')!.soundId).toBe(resolveSfx('hit-light')!.soundId);
  });

  it('每个别名都指向真实存在的语义', () => {
    for (const [legacy, semantic] of Object.entries(LEGACY_SFX_ALIASES)) {
      expect(hasSfx(semantic), `${legacy} → ${semantic} 未声明`).toBe(true);
    }
  });

  it('filesOf 返回该语义需要的资产（含变体）', () => {
    expect(filesOf('hit-light')).toEqual(['h_knife.wav']);
    expect(filesOf('swing').length).toBeGreaterThanOrEqual(3);
    expect(filesOf('__nope__')).toEqual([]);
  });

  it('音频随机序列可重置（保证测试可复现）', () => {
    resetAudioRng(1234);
    const a = resolveSfx('swing')!.soundId;
    resetAudioRng(1234);
    const b = resolveSfx('swing')!.soundId;
    expect(a).toBe(b);
  });

  it('allSfxEvents 覆盖清单且无重复', () => {
    const events = allSfxEvents();
    expect(new Set(events).size).toBe(events.length);
    for (const def of SFX_TABLE) expect(events).toContain(def.key);
  });

  it('分类与优先级随解析结果带出', () => {
    const hit = resolveSfx('hit-light')!;
    expect(hit.category).toBe('impact');
    expect(hit.priority).toBeGreaterThan(resolveSfx('click')!.priority);
  });
});