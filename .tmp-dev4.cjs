const fs = require('fs');
const p = 'src/game/scenes/UIScene.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

// 1. 去重：移除第二次创建（保留第一个）
const dup =
  "    // 开发者调试叠层：右上角小字（FPS / 敌人数 / 碰撞箱状态），默认隐藏\n" +
  "    this.devOverlayText = this.add.text(W - 14 * s, 14 * s, '', {\n" +
  "      color: '#5CFFB1', fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`,\n" +
  '      align: \'right\', backgroundColor: \'#00000099\', padding: { x: 6 * s, y: 4 * s }\n' +
  '    }).setOrigin(1, 0).setScrollFactor(0).setDepth(9998).setVisible(false);\n';
const first = s.indexOf(dup);
if (first >= 0) {
  const second = s.indexOf(dup, first + 1);
  if (second > 0) s = s.slice(0, second) + s.slice(second + dup.length);
}

// 2. 用 Phaser 内建 API 重写 updateDevOverlay：
//    - FPS 直接读 game.loop.actualFps
//    - 碰撞箱用 Arcade physics 的 drawDebug / debugGraphic（引擎内建），不再自行绘制
const oldMethod = s.slice(
  s.indexOf('  /**\n   * 开发者调试叠层：右上角显示 FPS'),
  s.indexOf('  private drawOffscreenIndicators(): void {')
);
if (!oldMethod || oldMethod.length < 100) { console.error('old dev method not found'); ok = false; }
else {
  const newMethod =
    '  /**\n' +
    '   * 开发者调试叠层（设置面板「开发者」页开关）：\n' +
    '   * - FPS 直接读 Phaser 内建 `game.loop.actualFps`，无需自行统计帧间隔\n' +
    '   * - 碰撞箱直接切 Arcade Physics 内建调试开关 `world.drawDebug + world.debugGraphic`\n' +
    '   * 其余仅做读数展示（敌人数/Boss/文本池），不含任何自绘调试逻辑。\n' +
    '   */\n' +
    '  private updateDevOverlay(): void {\n' +
    '    const settings = getSettings();\n' +
    '    const on = settings.devOverlayEnabled;\n' +
    '    this.devOverlayText.setVisible(on);\n' +
    '    // 碰撞箱：Phaser 内建 Arcade 调试绘制（GameScene 的物理世界）\n' +
    '    const gameScene = this.scene.get(\'GameScene\') as unknown as\n' +
    '      { scene: Phaser.Scenes.ScenePlugin; physics?: Phaser.Physics.Arcade.ArcadePhysics } | null;\n' +
    '    const world = gameScene?.physics?.world;\n' +
    '    if (world) {\n' +
    '      // drawDebug 是引擎内建的布尔开关，debugGraphic 由引擎每帧自动重绘\n' +
    '      world.drawDebug = on && settings.devHitboxEnabled;\n' +
    '      if (world.debugGraphic) world.debugGraphic.setVisible(on && settings.devHitboxEnabled);\n' +
    '    }\n' +
    '    if (!on) return;\n' +
    '    const fps = Math.round(this.game.loop.actualFps); // Phaser 内建实测帧率\n' +
    '    const enemiesRef = (gameScene as unknown as { enemies?: { view: { visible: boolean } }[] } | null)?.enemies;\n' +
    '    const bossRef = (gameScene as unknown as { boss?: { view: { visible: boolean } } | null } | null)?.boss;\n' +
    '    const poolRef = (gameScene as unknown as { combatTextPool?: unknown[] } | null)?.combatTextPool;\n' +
    '    const alive = enemiesRef ? enemiesRef.filter((e) => e.view.visible).length : 0;\n' +
    '    const boss = bossRef && bossRef.view.visible ? \'在场\' : \'—\';\n' +
    '    const poolSize = poolRef ? poolRef.length : 0;\n' +
    '    const hitbox = settings.devHitboxEnabled ? \'开\' : \'关\';\n' +
    '    const active = gameScene && gameScene.scene.isActive() ? \'战斗\' : \'大厅\';\n' +
    '    setTextSafe(this.devOverlayText, `FPS ${fps} · ${active}\\n敌 ${alive} · Boss ${boss}\\n文本池 ${poolSize} · 碰撞箱 ${hitbox}`);\n' +
    '  }\n\n';
  s = s.replace(oldMethod, newMethod);
  console.log('devOverlay rewritten with Phaser built-ins');
}

fs.writeFileSync(p, s);
console.log(ok ? 'DEV4 OK' : 'MISSED');
