/**
 * P0 音频契约对账测试。
 *
 * 计划里标记的最高优先级问题：
 *   AssetLoader 把 `h_knife.wav` 注册成 soundId `h_knife`（去掉扩展名），
 *   而 GameScene 播放的是语义 key `hit-light` —— 两边对不上。
 *
 * 这些测试先把「契约是否成立」钉住。它们必然失败（红灯），
 * 失败信息就是 P2 要修的问题清单。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSfx } from '../src/game/audio/AudioCatalog';

const ROOT = resolve(__dirname, '..');

/** AssetLoader 实际注册的 audio key（从源码抓，避免抄一份会过期的常量）。 */
function registeredAudioKeys(): string[] {
  const src = readFileSync(resolve(ROOT, 'src/game/utils/AssetLoader.ts'), 'utf8');
  // 清单驱动：key = 文件名去掉扩展名
  const fromCatalog = readFileSync(resolve(ROOT, 'src/game/data/sfx.ts'), 'utf8');
  const files = [...fromCatalog.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
  const variantFiles = [...fromCatalog.matchAll(/variants:\s*\[([^\]]+)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const all = new Set([...files, ...variantFiles]);
  return [...all].map((f) => f.replace(/\.[^.]+$/, ''));
}

/** 代码里所有 playSfx('...') 与 uiSfx('...') 用到的语义 key。 */
function playedSfxKeys(): string[] {
  const keys = new Set<string>();
  for (const f of ['src/game/scenes/GameScene.ts', 'src/game/scenes/UIScene.ts', 'src/game/scenes/LobbyScene.ts', 'src/ui/Menu.ts']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    for (const m of src.matchAll(/playSfx\(\s*'([^']+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/uiSfx\(\s*'([^']+)'/g)) keys.add(m[1]);
    // 三元形式：playSfx(cond ? 'a' : 'b', ...)
    for (const m of src.matchAll(/playSfx\(\s*[^,]*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
      keys.add(m[1]);
      keys.add(m[2]);
    }
  }
  return [...keys];
}

/** Menu.uiSfx('...') 用到的旧 key。 */
function menuSfxKeys(): string[] {
  const src = readFileSync(resolve(ROOT, 'src/ui/Menu.ts'), 'utf8');
  const keys = new Set<string>();
  for (const m of src.matchAll(/uiSfx\(\s*'([^']+)'/g)) keys.add(m[1]);
  return [...keys];
}

/** sfx.ts 清单里声明的语义 key。 */
function catalogKeys(): string[] {
  const src = readFileSync(resolve(ROOT, 'src/game/data/sfx.ts'), 'utf8');
  return [...src.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('P0 音频契约对账（红灯 = 待修）', () => {
  it('清单声明的语义 key 全部在代码里被播放', () => {
    const declared = catalogKeys();
    const played = new Set(playedSfxKeys());
    const unused = declared.filter((k) => !played.has(k));
    // 这是信息性断言：未使用的语义 key 说明清单有死条目或调用点漏接
    expect(unused, `未被播放的语义 key: ${unused.join(', ')}`).toEqual([]);
  });

  it('代码播放的每个语义 key 都在清单里声明', () => {
    const declared = new Set(catalogKeys());
    const unknown = playedSfxKeys().filter((k) => !declared.has(k));
    expect(unknown, `播放了未声明的 key: ${unknown.join(', ')}`).toEqual([]);
  });

  it('每个播放的语义 key 都能经 AudioCatalog 解析到已注册的 soundId', () => {
    // 计划 §2.1 的 bug：loader 注册 `h_knife`，播放端播 `hit-light`。
    // 正确契约不是「两者相等」，而是「语义 key 经目录解析出的 soundId，
    // 与 AssetLoader 的注册规则（文件名去扩展名）一致」。
    const registered = new Set(registeredAudioKeys());
    const broken: string[] = [];
    for (const key of playedSfxKeys()) {
      const r = resolveSfx(key);
      if (!r) {
        broken.push(`${key} → 目录解析失败`);
      } else if (!registered.has(r.soundId)) {
        broken.push(`${key} → ${r.soundId} 未注册`);
      }
    }
    expect(broken, `解析链路断裂: ${broken.join('; ')}`).toEqual([]);
  });

  it('Menu.uiSfx 不再使用旧拼音 key（当前应失败）', () => {
    const legacy = menuSfxKeys().filter((k) => k.startsWith('sfx-'));
    expect(legacy, `Menu 仍在使用旧 key: ${legacy.join(', ')}`).toEqual([]);
  });

  it('清单里每个 key 都指向真实存在的资产文件', () => {
    const src = readFileSync(resolve(ROOT, 'src/game/data/sfx.ts'), 'utf8');
    const files = [...src.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
    const variantFiles = [...src.matchAll(/variants:\s*\[([^\]]+)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    const all = new Set([...files, ...variantFiles]);
    const missing: string[] = [];
    for (const f of all) {
      try {
        readFileSync(resolve(ROOT, 'assets/audio', f));
      } catch {
        missing.push(f);
      }
    }
    expect(missing, `资产缺失: ${missing.join(', ')}`).toEqual([]);
  });
});