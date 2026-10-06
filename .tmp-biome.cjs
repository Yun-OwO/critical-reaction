const fs = require('fs');
const p = 'src/game/scenes/GameScene.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

// 1. import
rep(
  "import { SfxLimiter } from '../utils/SfxLimiter';",
  "import { SfxLimiter } from '../utils/SfxLimiter';\nimport { generateTerrain } from '../world/biomes';"
);

// 2. 字段：本局地图种子
rep(
  '  /** 音效四重节流（总并发/单源冷却/全局间隔/叠音上限） */\n  private sfxLimiter = new SfxLimiter();',
  '  /** 音效四重节流（总并发/单源冷却/全局间隔/叠音上限） */\n  private sfxLimiter = new SfxLimiter();\n  /** 本局地图种子：柏林噪声群系/地形/地物的生成源（每局随机） */\n  private runSeed = 1;'
);

// 3. create：设置种子（在 createAtmosphere 之前）
rep(
  '    this.drawGrid();\n    this.createAtmosphere();',
  '    this.drawGrid();\n    this.runSeed = Phaser.Math.Between(1, 1073741823);\n    this.createAtmosphere();'
);

// 4. createAtmosphere：柏林噪声群系层（一次性绘制 + 可裁剪地物）
rep(
  '    // 战斗布景：Chemic 花/石/蘑菇/炼金台密集贴地（原尺寸、贴着地面、跟随相机）',
  `    // ---- 哈迪斯式群系/地形层：柏林噪声一次性生成（群系底色/高地亮块/洼地/液洼/地物）----
    const terrain = generateTerrain(
      this.runSeed, this.worldWidth, this.worldHeight,
      this.diamondA, this.diamondB, this.diamondCx, this.diamondCy
    );
    const terrainGfx = this.add.graphics().setDepth(-1.5); // 网格之下、环境光之上：透过半透明网格读出地形
    for (const t of terrain.tints) {
      terrainGfx.fillStyle(t.color, t.alpha);
      // isometric 菱形块，与网格晶格同构
      terrainGfx.beginPath();
      terrainGfx.moveTo(t.x, t.y - t.h / 2);
      terrainGfx.lineTo(t.x + t.w / 2, t.y);
      terrainGfx.lineTo(t.x, t.y + t.h / 2);
      terrainGfx.lineTo(t.x - t.w / 2, t.y);
      terrainGfx.closePath();
      terrainGfx.fillPath();
    }
    for (const deco of terrain.decorations) {
      if (deco.puddle) {
        // 液洼：扁椭圆 + ADD 混合，化学溶剂质感
        const puddle = this.add.ellipse(deco.x, deco.y, Phaser.Math.Between(70, 130), Phaser.Math.Between(26, 44), deco.puddleColor, 0.14)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(-0.5);
        this.registerCullable(puddle, 0, 200);
        this.tweens.add({
          targets: puddle, alpha: { from: 0.08, to: 0.2 }, scaleX: { from: 0.94, to: 1.08 },
          duration: Phaser.Math.Between(2400, 4200), yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });
      } else {
        const prop = this.add.image(deco.x, deco.y, deco.texture)
          .setAlpha(0.92).setOrigin(0.5, 1).setDepth(0.15)
          .setRotation(Phaser.Math.FloatBetween(-0.12, 0.12));
        this.registerCullable(prop, 0, 200);
      }
    }

    // 战斗布景：Chemic 花/石/蘑菇/炼金台密集贴地（原尺寸、贴着地面、跟随相机）`
);

fs.writeFileSync(p, s);
console.log(ok ? 'BIOME LAYER OK' : 'MISSED');
