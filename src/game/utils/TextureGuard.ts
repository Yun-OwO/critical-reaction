/**
 * 纹理缺失兜底：用 canvas 生成描边占位块顶替，取代 Phaser 默认的 `__MISSING` 棋盘格。
 *
 * 背景：BootScene 的注释一直写着「缺失纹理走降级渲染」，但从未实现。
 * 真缺纹理时（资源 404、SVG 解析失败、畸形报错被 loader 放过）Phaser 会
 * 画一张 32×32 的绿/洋红棋盘格。两个问题：
 *  1. **尺寸完全不对**——它是 32×32，而地物按各自原尺寸（64/128/375 等）布局，
 *     显示出来就是一块突兀的方块，与周围世界尺度脱节；
 *  2. 绿/洋红与全作「深色底 + 亮描边几何」的视觉语言毫不相干，非常扎眼。
 *
 * 这里的降级是「尺寸对齐的描边几何块」：同样是块，但**看起来像有意为之的占位**，
 * 而不是引擎在报错。
 *
 * 只补缺失的 key，已加载成功的一律不碰。
 */

import Phaser from 'phaser';

/** 地物/地形全部纹理 key。缺失任意一张都会走降级。 */
export const TERRAIN_TEXTURE_KEYS: readonly string[] = [
  'chem-lattice', 'chem-molecule', 'chem-benzene', 'chem-burette', 'chem-polymer',
  'biome-tloor', 'biome-tbc', 'tex-beaker', 'tex-flask'
];

/** 降级占位块的尺寸（key → [w, h]）：必须与原纹理一致，否则世界尺度会塌。 */
const FALLBACK_SIZES: Record<string, [number, number]> = {
  'chem-lattice': [64, 64],
  'chem-molecule': [64, 64],
  'chem-benzene': [64, 64],
  'chem-burette': [64, 64],
  'chem-polymer': [256, 64],
  'biome-tloor': [64, 64],
  'biome-tbc': [375, 135],
  'tex-beaker': [200, 200],
  'tex-flask': [200, 200]
};

/** 占位块描边色：取本作青调，肉眼能看出「这里本该有东西」。 */
const FALLBACK_COLOR = 0x67e8f9;


/** 已补过的 key，避免重复生成（BootScene 与场景重建都可能调用）。 */
const patched = new Set<string>();

/**
 * 为缺失的纹理生成占位块。返回实际修补的 key 列表（空数组表示全部就绪）。
 */
export function ensureFallbackTextures(scene: Phaser.Scene, keys: readonly string[] = TERRAIN_TEXTURE_KEYS): string[] {
  const fixed: string[] = [];
  for (const key of keys) {
    if (patched.has(key) || scene.textures.exists(key)) continue;
    const size = FALLBACK_SIZES[key] ?? [64, 64];
    drawFallback(scene, key, size[0], size[1]);
    patched.add(key);
    fixed.push(key);
    console.error(`[TextureGuard] 纹理缺失，已降级为占位块: ${key} (${size[0]}x${size[1]})`);
  }
  return fixed;
}

/** 画一块描边方块：深色填充 + 亮描边 + 内部一个对角，读作「有意的占位」而非「引擎报错」。 */
function drawFallback(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const g = scene.add.graphics();
  g.fillStyle(0x0b1420, 0.72).fillRect(1.5, 1.5, w - 3, h - 3);
  g.lineStyle(2.5, FALLBACK_COLOR, 0.95).strokeRect(1.5, 1.5, w - 3, h - 3);
  g.lineStyle(1.5, FALLBACK_COLOR, 0.5);
  g.beginPath();
  g.moveTo(6, 6);
  g.lineTo(w - 6, h - 6);
  g.strokePath();
  g.generateTexture(key, w, h);
  g.destroy();
}
