import Phaser from 'phaser';
import { allSfxFiles } from '../data/sfx';

export function loadGameAssets(scene: Phaser.Scene): void {
  scene.load.setPath('assets');
  scene.load.svg('hydrogen-core', 'sprites/actors/hydrogen-core.svg', { width: 128, height: 128 });
  scene.load.svg('free-radical', 'sprites/enemies/free-radical.svg', { width: 96, height: 96 });
  scene.load.svg('oxidizer', 'sprites/enemies/oxidizer.svg', { width: 96, height: 96 });
  scene.load.svg('polymer', 'sprites/enemies/polymer.svg', { width: 112, height: 112 });
  scene.load.svg('reducer', 'sprites/enemies/reducer.svg', { width: 96, height: 96 });
  scene.load.svg('acid-drop', 'sprites/enemies/acid-drop.svg', { width: 96, height: 96 });
  scene.load.svg('photom', 'sprites/enemies/photom.svg', { width: 96, height: 96 });
  scene.load.svg('monomer', 'sprites/enemies/monomer.svg', { width: 96, height: 96 });
  scene.load.svg('catalyst', 'sprites/enemies/catalyst.svg', { width: 96, height: 96 });
  scene.load.svg('boss-titration', 'sprites/enemies/boss-titration.svg', { width: 192, height: 192 });
  scene.load.svg('boss-electrolysis', 'sprites/enemies/boss-electrolysis.svg', { width: 192, height: 192 });
  scene.load.svg('boss-chain', 'sprites/enemies/boss-chain.svg', { width: 192, height: 192 });
  scene.load.svg('boss-oxidation', 'sprites/enemies/boss-oxidation.svg', { width: 192, height: 192 });
  // 音效：语义清单驱动（data/sfx.ts 是「语义 key ↔ 资产」的唯一事实源）。
  // 改造前这里是 18 行硬编码，且 5 个 chemic 音源命名是拼音音节、语义对不上
  // （只能靠注释硬凑），导致音效与它代表的事件之间没有稳定关联。
  for (const file of allSfxFiles()) {
    // Phaser 的 audio key 不带扩展名
    const key = file.replace(/\.[^.]+$/, '');
    scene.load.audio(key, `audio/${file}`);
  }
  // BGM：chemic 的 adven 系列（5 首，单个 2.5-5.6MB，共 22MB）。
  // 何忆卫的 13 首 BGM 是完整配乐（含 intro/loop 分轨），本作用不上——它们是为
  // 有明确关卡结构的游戏做的，本作是单场景 roguelite，音乐只需要氛围层。
  for (let i = 0; i < 5; i += 1) scene.load.audio('bgm-' + i, 'audio/bgm-adven' + i + '.mp3');
  // Chemic 玻璃器皿：浅蓝描边扁平风，与本作描边几何语言不冲突，保留 PNG
  scene.load.image('tex-beaker', 'textures/beaker.png');
  scene.load.image('tex-flask', 'textures/flask.png');
  // 群系地物：手绘描边几何 SVG，化学主题（晶格 / 分子球棍 / 苯环 / 滴定管 / 高分子链）。
  // 原 chemic 的 rock/mushroom/flower/anthemy/thick 是像素手绘的花花草草，既与本作
  // 深色描边几何的场景风格割裂，也不贴化学题材，故整体重绘；raster 尺寸沿用原 PNG，
  // 以免影响 terrain 里按 width/height 推导的 2.5D 投影与底部阴影尺寸。
  scene.load.svg('chem-lattice', 'sprites/decor/lattice.svg', { width: 64, height: 64 });
  scene.load.svg('chem-molecule', 'sprites/decor/molecule.svg', { width: 64, height: 64 });
  scene.load.svg('chem-benzene', 'sprites/decor/benzene.svg', { width: 64, height: 64 });
  scene.load.svg('chem-burette', 'sprites/decor/burette.svg', { width: 64, height: 64 });
  scene.load.svg('chem-polymer', 'sprites/decor/polymer.svg', { width: 256, height: 64 });
  // 地面实物瓦片（v0.2.3）：tloor 中性石板 / tbc 群系色地表，2.5D 投影贴地
  scene.load.svg('biome-tloor', 'sprites/decor/tile-slab.svg', { width: 64, height: 64 });
  scene.load.svg('biome-tbc', 'sprites/decor/tile-surface.svg', { width: 375, height: 135 });
}
