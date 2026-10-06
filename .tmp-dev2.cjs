const fs = require('fs');
const p = 'src/game/scenes/UIScene.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

// 1. 调试叠层字段
rep(
  '  /** 祝福图标芯片列（左缘） */',
  '  /** 开发者调试叠层：右上角 FPS / 实体计数 / 碰撞箱状态 */\n' +
  '  private devOverlayText!: Phaser.GameObjects.Text;\n' +
  '  /** 祝福图标芯片列（左缘） */'
);

// 2. create：叠层文本（右上，常驻但可隐藏）
rep(
  '    this.boonChipLayer = this.add.container(0, 0).setDepth(12);',
  '    this.boonChipLayer = this.add.container(0, 0).setDepth(12);\n' +
  '    // 开发者调试叠层：右上角小字（FPS / 敌人数 / 碰撞箱状态），默认隐藏\n' +
  '    this.devOverlayText = this.add.text(W - 14 * s, 14 * s, \'\', {\n' +
  "      color: '#5CFFB1', fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`,\n" +
  '      align: \'right\', backgroundColor: \'#00000099\', padding: { x: 6 * s, y: 4 * s }\n' +
  '    }).setOrigin(1, 0).setScrollFactor(0).setDepth(9998).setVisible(false);'
);

// 3. update：驱动叠层与碰撞箱
rep(
  '    this.refreshDangerVignette();\n    this.drawOffscreenIndicators();',
  '    this.refreshDangerVignette();\n    this.drawOffscreenIndicators();\n    this.updateDevOverlay();'
);

// 4. 方法实现（插在 drawOffscreenIndicators 之前）
rep(
  '  /** 屏幕外单位指示器：靠近边缘的敌人在屏幕内侧显示方向箭头，避免"被屏幕外敌人打死"。 */',
  '  /**\n' +
  '   * 开发者调试叠层：右上角显示 FPS、敌人数、粒子/文本池占用与碰撞箱开关状态；\n' +
  '   * 并按设置切换 Arcade 物理调试绘制（碰撞箱）。仅在设置面板「开发者」页开启后生效。\n' +
  '   */\n' +
  '  private updateDevOverlay(): void {\n' +
  '    const settings = getSettings();\n' +
  '    const game = this.scene.get(\'GameScene\') as unknown as {\n' +
  '      scene: Phaser.Scenes.ScenePlugin;\n' +
  '      enemies?: { view: { visible: boolean } }[];\n' +
  '      combatTextPool?: unknown[];\n' +
  '      boss?: { view: { visible: boolean } } | null;\n' +
  '      physics?: { world?: { debugGraphic?: { clear(): void; setVisible(v: boolean): void } } };\n' +
  '    } | null;\n' +
  '    const on = settings.devOverlayEnabled;\n' +
  '    this.devOverlayText.setVisible(on);\n' +
  '    if (!on) {\n' +
  '      // 叠层关闭时同步关闭碰撞箱绘制，避免残留调试图形\n' +
  '      if (game && game.physics?.world?.debugGraphic) game.physics.world.debugGraphic.setVisible(false);\n' +
  '      return;\n' +
  '    }\n' +
  '    const fps = Math.round(this.game.loop.actualFps);\n' +
  '    const alive = game && game.enemies ? game.enemies.filter((e) => e.view.visible).length : 0;\n' +
  '    const boss = game && game.boss && game.boss.view.visible ? 1 : 0;\n' +
  '    const poolSize = game && game.combatTextPool ? game.combatTextPool.length : 0;\n' +
  '    const hitbox = settings.devHitboxEnabled ? \'开\' : \'关\';\n' +
  '    const active = game && game.scene.isActive() ? \'Game\' : \'Lobby\';\n' +
  '    setTextSafe(this.devOverlayText, `FPS ${fps} · ${active}\\n敌 ${alive} · Boss ${boss}\\n文本池 ${poolSize} · 碰撞箱 ${hitbox}`);\n' +
  '    // 碰撞箱：仅战斗场景支持（Arcade 物理世界在 GameScene）\n' +
  '    const dbg = game && game.physics?.world?.debugGraphic;\n' +
  '    if (dbg) dbg.setVisible(settings.devHitboxEnabled);\n' +
  '  }\n\n' +
  '  /** 屏幕外单位指示器：靠近边缘的敌人在屏幕内侧显示方向箭头，避免"被屏幕外敌人打死"。 */'
);

fs.writeFileSync(p, s);
console.log(ok ? 'DEV OVERLAY OK' : 'SOME MISSED');
