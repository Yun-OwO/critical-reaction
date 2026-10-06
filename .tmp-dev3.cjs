const fs = require('fs');
const p = 'src/game/scenes/UIScene.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

// 1. 字段（插在 boonChipKey 字段旁）
rep(
  "  private boonChipKey = '';",
  "  private boonChipKey = '';\n" +
  '  /** 开发者调试叠层：右上角 FPS / 敌人数 / 碰撞箱状态（设置面板「开发者」页开关） */\n' +
  '  private devOverlayText!: Phaser.GameObjects.Text;'
);

// 2. create：叠层文本
rep(
  '    this.boonChipLayer = this.add.container(0, 0).setDepth(12);',
  '    this.boonChipLayer = this.add.container(0, 0).setDepth(12);\n' +
  '    // 开发者调试叠层：右上角小字（FPS / 敌人数 / 碰撞箱），默认隐藏\n' +
  '    this.devOverlayText = this.add.text(W - 14 * s, 14 * s, \'\', {\n' +
  "      color: '#5CFFB1', fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`,\n" +
  "      align: 'right', backgroundColor: '#00000099', padding: { x: 6 * s, y: 4 * s }\n" +
  '    }).setOrigin(1, 0).setScrollFactor(0).setDepth(9998).setVisible(false);'
);

// 3. update 驱动
rep(
  '    this.drawOffscreenIndicators();\n  }',
  '    this.drawOffscreenIndicators();\n    this.updateDevOverlay();\n  }'
);

// 4. 实现（插在 drawOffscreenIndicators 定义前）
rep(
  '  private drawOffscreenIndicators(): void {',
  '  /**\n' +
  '   * 开发者调试叠层：右上角显示 FPS、敌人数、文本池占用与碰撞箱状态；\n' +
  '   * 并按设置切换 Arcade 物理调试绘制（碰撞箱）。仅在设置面板「开发者」页开启后生效。\n' +
  '   */\n' +
  '  private updateDevOverlay(): void {\n' +
  '    const settings = getSettings();\n' +
  '    const game = this.scene.get(\'GameScene\') as unknown as {\n' +
  '      scene: Phaser.Scenes.ScenePlugin;\n' +
  '      enemies?: { view: { visible: boolean } }[];\n' +
  '      combatTextPool?: unknown[];\n' +
  '      boss?: { view: { visible: boolean } } | null;\n' +
  '    } | null;\n' +
  '    const on = settings.devOverlayEnabled;\n' +
  '    this.devOverlayText.setVisible(on);\n' +
  '    if (!on) return;\n' +
  '    const fps = Math.round(this.game.loop.actualFps);\n' +
  '    const alive = game && game.enemies ? game.enemies.filter((e) => e.view.visible).length : 0;\n' +
  '    const boss = game && game.boss && game.boss.view.visible ? \'在场\' : \'—\';\n' +
  '    const poolSize = game && game.combatTextPool ? game.combatTextPool.length : 0;\n' +
  '    const hitbox = settings.devHitboxEnabled ? \'开\' : \'关\';\n' +
  '    const active = game && game.scene.isActive() ? \'战斗\' : \'大厅\';\n' +
  '    setTextSafe(this.devOverlayText, `FPS ${fps} · ${active}\\n敌 ${alive} · Boss ${boss}\\n文本池 ${poolSize} · 碰撞箱 ${hitbox}`);\n' +
  '    // 碰撞箱：切换 Arcade 物理调试绘制\n' +
  '    const physics = (game as unknown as { physics?: Phaser.Physics.Arcade.ArcadePhysics })?.physics;\n' +
  '    const world = physics?.world;\n' +
  '    if (world && typeof (world as unknown as { drawDebug?: boolean }).drawDebug === \'boolean\') {\n' +
  '      (world as unknown as { drawDebug: boolean }).drawDebug = settings.devHitboxEnabled;\n' +
  '    }\n' +
  '    if (world?.debugGraphic) {\n' +
  '      world.debugGraphic.setVisible(settings.devHitboxEnabled);\n' +
  '      if (!settings.devHitboxEnabled) world.debugGraphic.clear();\n' +
  '    }\n' +
  '  }\n\n' +
  '  private drawOffscreenIndicators(): void {'
);

fs.writeFileSync(p, s);
console.log(ok ? 'DEV OVERLAY OK' : 'SOME MISSED');
