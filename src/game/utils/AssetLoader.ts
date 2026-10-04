import Phaser from 'phaser';

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
  scene.load.svg('boss-titration', 'sprites/enemies/boss-titration.svg', { width: 256, height: 256 });
  scene.load.svg('boss-electrolysis', 'sprites/enemies/boss-electrolysis.svg', { width: 256, height: 256 });
  scene.load.svg('boss-chain', 'sprites/enemies/boss-chain.svg', { width: 256, height: 256 });
  scene.load.svg('boss-oxidation', 'sprites/enemies/boss-oxidation.svg', { width: 256, height: 256 });
  // 音效（OGG）
  scene.load.audio('sfx-cannon', 'audio/LASRGun_Plasma Rifle Fire_03.ogg');
  scene.load.audio('sfx-saber-swing', 'audio/MOTRSrvo_Plasma Rifle Arm_01.ogg');
  scene.load.audio('sfx-saber-hit', 'audio/HIT_METAL_WRENCH_HEAVIEST_02.ogg');
  scene.load.audio('sfx-switch', 'audio/GUNMech_Mechanical_12.ogg');
  scene.load.audio('sfx-click', 'audio/MECHClik_Mine Deploy_02.ogg');
  // Chemic 音乐与音效（语义对照源项目 adven + index 玩法）
  for (let i = 0; i < 5; i++) scene.load.audio('bgm-' + i, 'audio/bgm-adven' + i + '.mp3');
  scene.load.audio('sfx-ding', 'audio/ding.wav');       // 拾取/成功获取
  scene.load.audio('sfx-cil', 'audio/cilllllll.wav');   // 施放/使用
  scene.load.audio('sfx-jiu', 'audio/jiu.wav');         // 释放射线
  scene.load.audio('sfx-budong', 'audio/budong.wav');   // 生成/充能
  scene.load.audio('sfx-hit', 'audio/di.wav');          // 命中/切换
  scene.load.audio('sfx-dd', 'audio/dd.wav');           // 打击/敌人攻击
  scene.load.audio('sfx-behit', 'audio/sa.wav');        // 受击（仓库无 behit.wav，取 sa 音源）
  scene.load.audio('sfx-ka', 'audio/ka.wav');           // 面板开合
  scene.load.audio('sfx-ta', 'audio/ta.wav');           // 进入/确认
  scene.load.audio('sfx-ga', 'audio/ga.wav');           // 合成成功
  scene.load.audio('sfx-liang', 'audio/liang.wav');     // 升级成功
  scene.load.audio('sfx-ziya', 'audio/ziya.wav');       // 选择切换
  scene.load.audio('sfx-da', 'audio/da.wav');           // 加入/应用
  scene.load.audio('sfx-duong', 'audio/duong.wav');     // 失败/不足
  scene.load.audio('sfx-huu', 'audio/huu.wav');         // 收起
  // Chemic 纹理（原尺寸平铺/粒子，不缩放）
  scene.load.image('tex-flower', 'textures/flower.png');
  scene.load.image('tex-rock', 'textures/rock.png');
  scene.load.image('tex-mushroom', 'textures/mushroom.png');
  scene.load.image('tex-anthemy', 'textures/anthemy.png');
  scene.load.image('tex-thick', 'textures/thick.png');
  scene.load.image('tex-beaker', 'textures/beaker.png');
  scene.load.image('tex-flask', 'textures/flask.png');
  scene.load.image('tex-shield', 'textures/shield.png');
  scene.load.image('tex-speed', 'textures/speed.png');
}
