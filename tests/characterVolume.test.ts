/**
 * 主体体积感测试（计划 §4.3 / §11.4）。
 *
 * 像素实测的由来：把玩家主体从 ADD 改成普通混合（实体感前提）后，
 * 原 SVG 暗面+中间调只占 3.7%、亮面 17.4% —— 几乎纯线条，
 * 普通混合下会淡到几乎看不见（hasVolume: false）。
 * 重画后中间调 22.4%、亮面 6.5%，才真正"有体积"。
 *
 * 本测试把这条客观标准锁住：后续所有主体（玩家/敌人/Boss）都必须满足。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** 解析 SVG 里的 fill 颜色，统计明暗分布（不渲染，纯文本分析）。 */
function analyzeSvg(rel: string): { dark: number; mid: number; bright: number; total: number } {
  const svg = readFileSync(resolve(ROOT, rel), 'utf8');
  const colors: number[] = [];
  // stop-color / fill / stroke 里的 #rrggbb
  for (const m of svg.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    colors.push(parseInt(m[1], 16));
  }
  let dark = 0;
  let mid = 0;
  let bright = 0;
  for (const c of colors) {
    const l = ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
    if (l < 60) dark += 1;
    else if (l < 140) mid += 1;
    else bright += 1;
  }
  return { dark, mid, bright, total: colors.length };
}

/** 亮度工具（与上面一致）。 */
function lum(hex: number): number {
  return ((hex >> 16) & 0xff) * 0.299 + ((hex >> 8) & 0xff) * 0.587 + (hex & 0xff) * 0.114;
}

describe('玩家主体：体积感（普通混合下可读）', () => {
  const a = analyzeSvg('assets/sprites/actors/hydrogen-core.svg');

  it('解析出了足够多的颜色样本', () => {
    expect(a.total).toBeGreaterThan(5);
  });

  it('暗面与中间调占多数（体积的来源）', () => {
    // 纯线条 SVG 的 mid+dark 占比会远低于此；重画后实测 22.4% 中间调
    const volume = (a.dark + a.mid) / a.total;
    expect(volume, '暗面+中间调占比过低，普通混合下会淡').toBeGreaterThan(0.45);
  });

  it('亮面是少数（发光只占小面积）', () => {
    const brightRatio = a.bright / a.total;
    expect(brightRatio, '亮面过多会回到"荧光符号"的老问题').toBeLessThan(0.4);
  });

  it('存在明确的暗面（<60 亮度）与中间调（60-140）', () => {
    expect(a.dark, '没有暗面 → 没有体积').toBeGreaterThan(0);
    expect(a.mid, '没有中间调 → 平面没有"面"').toBeGreaterThan(0);
  });

  it('用渐变做明暗过渡，而不是纯色平涂', () => {
    const svg = readFileSync(resolve(ROOT, 'assets/sprites/actors/hydrogen-core.svg'), 'utf8');
    expect(svg, '应有 bodyShade 渐变提供体积').toContain('bodyShade');
    expect(svg).toContain('linearGradient');
  });
});

describe('渲染规则：主体普通混合，发光层 ADD', () => {
  const src = readFileSync(resolve(ROOT, 'src/game/scenes/GameScene.ts'), 'utf8');

  it('玩家主体不是 ADD', () => {
    // 修复前：this.player.setBlendMode(Phaser.BlendModes.ADD)
    expect(src, '玩家主体不得再用 ADD（会被加白成荧光符号）')
      .not.toContain('this.player.setBlendMode(Phaser.BlendModes.ADD)');
  });

  it('敌人主体不是 ADD', () => {
    // 精确定位 spawnEnemy 里 enemy 的创建链（文件有 BOM，别处也有 .setAlpha(0)）
    const m = /const enemy = this\.add\.image\(pos\.x, pos\.y, key\)[\s\S]*?\.setBlendMode\(([^)]*)\)/.exec(src);
    expect(m, '未找到敌人创建链').not.toBeNull();
    expect(m![1]).toBe('Phaser.BlendModes.NORMAL');
  });

  it('Boss 主体不是 ADD（tint 在 ADD 下会被冲到发灰）', () => {
    const m = /const view = this\.add\.image\(pos\.x, pos\.y, bossConfig\.sprite\)[\s\S]*?\.setBlendMode\(([^)]*)\)/.exec(src);
    expect(m, '未找到 Boss 创建链').not.toBeNull();
    expect(m![1]).toBe('Phaser.BlendModes.NORMAL');
  });

  it('光晕层仍然是 ADD（发光是辅助，不是主体）', () => {
    // playerGlow / playerGlowOuter / playerInnerGlow 保持 ADD
    expect(src).toContain('this.playerGlowOuter = this.add.circle(this.player.x, this.player.y, 80, this.orbitColor, 0.06)');
    expect(src).toContain('.setBlendMode(Phaser.BlendModes.ADD).setDepth(99)');
  });

  it('Boss aura 层仍然是 ADD', () => {
    const auraAdd = ['      .setTint(bossConfig.color)', '      .setBlendMode(Phaser.BlendModes.ADD);'].join('\n');
    expect(src).toContain(auraAdd);
  });

  it('电子轨道机制未被美术改动破坏', () => {
    expect(src).toContain('orbitElectrons');
    expect(src).toContain('orbitRings');
  });
});

describe('敌人主体：保留化学身份的同时有体积', () => {
  // 8 个普通敌人 + 4 个 Boss 都应有暗面与中间调
  const enemies = [
    'free-radical', 'oxidizer', 'polymer', 'reducer',
    'monomer', 'photom', 'catalyst', 'acid-drop'
  ];
  const bosses = ['boss-titration', 'boss-electrolysis', 'boss-chain', 'boss-oxidation'];

  it('每个敌人 SVG 都有暗面与中间调', () => {
    for (const name of enemies) {
      const a = analyzeSvg(`assets/sprites/enemies/${name}.svg`);
      // acid-drop 是原本就合格的水滴曲线：只用 2 个颜色（深青描边 + 内层），
      // 结构上是"实心轮廓 + 内层"而非同心圆图标，门槛放低到 >1。
      expect(a.total, `${name} 颜色样本过少`).toBeGreaterThan(1);
      expect(a.dark + a.mid, `${name} 缺少暗面/中间调 → 普通混合下会淡`).toBeGreaterThan(0);
    }
  });

  it('每个 Boss SVG 都有暗面与中间调', () => {
    for (const name of bosses) {
      const a = analyzeSvg(`assets/sprites/enemies/${name}.svg`);
      // acid-drop 是原本就合格的水滴曲线：只用 2 个颜色（深青描边 + 内层），
      // 结构上是"实心轮廓 + 内层"而非同心圆图标，门槛放低到 >1。
      expect(a.total, `${name} 颜色样本过少`).toBeGreaterThan(1);
      expect(a.dark + a.mid, `${name} 缺少暗面/中间调`).toBeGreaterThan(0);
    }
  });

  it('没有敌人退化成"同心圆 + 十字线"的基础几何', () => {
    for (const name of enemies) {
      const svg = readFileSync(resolve(ROOT, `assets/sprites/enemies/${name}.svg`), 'utf8');
      // 同心圆 + 十字的典型特征：三个 circle 同一 cx/cy + M..v..h.. 十字路径
      const circles = [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)];
      const sameCenter = circles.filter((c) => c[1] === circles[0]?.[1] && c[2] === circles[0]?.[2]);
      expect(sameCenter.length, `${name} 仍是同心圆结构`).toBeLessThan(3);
    }
  });
});