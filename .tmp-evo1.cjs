const fs = require('fs');

// ---- 1. GameState: dyeEvolution 字段 ----
{
  const p = 'src/game/state/GameState.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('dyeEvolution')) {
    s = s.replace(
      '  /** 已拥有的觉醒祝福 id（每局各一次） */\n  ownedSpecialBoons: string[];',
      `  /** 已拥有的觉醒祝福 id（每局各一次） */\n  ownedSpecialBoons: string[];\n  /** 进化系统：各染料颜色的进化等级（局内染料房喂养，colorist 式属性成长） */\n  dyeEvolution: Record<string, number>;`
    );
    s = s.replace(
      '  /** 觉醒「祝福槽位 +1」的可用次数 */\n  extraBoonSlots: 0,\n  /** 已拥有的觉醒祝福 id（每局各一次） */\n  ownedSpecialBoons: []\n};',
      '  /** 觉醒「祝福槽位 +1」的可用次数 */\n  extraBoonSlots: 0,\n  /** 已拥有的觉醒祝福 id（每局各一次） */\n  ownedSpecialBoons: [],\n  /** 进化等级（染料 id → 等级） */\n  dyeEvolution: {}\n};'
    );
    s = s.replace(
      '    extraBoonSlots: 0,\n    ownedSpecialBoons: [],',
      '    extraBoonSlots: 0,\n    ownedSpecialBoons: [],\n    dyeEvolution: {},'
    );
  }
  fs.writeFileSync(p, s);
  console.log('gameState dyeEvolution:', s.includes('dyeEvolution: {}') ? 'ok' : 'check');
}

// ---- 2. GameScene: 染料房 → 进化房 ----
{
  const p = 'src/game/scenes/GameScene.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

  // 2a. 字段清理
  rep(`  private dyeRoomKind: 'vat' | 'palette' = 'vat';\n`, '');
  rep(`  private dyeRoomSlot = 1;\n`, '');

  // 2b. spawnDyeRoom 重写：三色染料光团，无槽位/调色盘
  const spawnStart = '  private spawnDyeRoom(): void {';
  const spawnEnd = '  /** 吸收染料 → 写入目标槽位（按槽位权重立即生效），随后清空所有装置。 */';
  const a = s.indexOf(spawnStart);
  const b = s.indexOf(spawnEnd);
  if (a < 0 || b < 0 || b <= a) { console.error('spawnDyeRoom anchors fail'); ok = false; }
  else {
    const newSpawn = `  private spawnDyeRoom(): void {
    const offer = this.roomDef.dye;
    if (!offer || offer.choices.length === 0) return;
    // 进化系统：染色房 = 获得染料 → 喂养进化（colorist 式：染料喂养载体，属性随等级线性成长）
    const n = offer.choices.length;
    const baseY = this.diamondCy - 420;
    offer.choices.forEach((dyeId, i) => {
      const dye = getDye(dyeId);
      if (!dye) return;
      const hex = parseInt(dye.color.replace('#', ''), 16);
      const pos = this.clampToPlayArea(this.diamondCx + (i - (n - 1) / 2) * 340, baseY);
      const halo = this.add.circle(pos.x, pos.y, 46, hex, 0.16)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      this.tweens.add({ targets: halo, scale: { from: 0.9, to: 1.3 }, alpha: { from: 0.1, to: 0.26 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      const view = this.add.circle(pos.x, pos.y, 30, hex, 0.42)
        .setStrokeStyle(3, hex, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
      const lvl = gameState.dyeEvolution[dyeId] ?? 0;
      const label = this.add.text(pos.x, pos.y - 74,
        dye.name + ' 染料 [E]\\n' + dye.effect + '\\n进化 Lv.' + lvl + ' → ' + (lvl + 1), {
          color: dye.color, fontFamily: 'monospace', fontSize: '16px', align: 'center'
        }).setOrigin(0.5).setDepth(7);
      this.dyeStations.push({ x: pos.x, y: pos.y, dyeId: entry_dyeId_guard(dyeId), view, halo, label });
    });
  }

  // 占位守卫（保持 dyeStations 类型不变）
  function entry_dyeId_guard(id: string): string { return id; }
`;
    s = s.slice(0, a) + newSpawn + '\n' + s.slice(b);
    console.log('spawnDyeRoom rewritten');
  }

  // 2c. absorbDye 重写：进化等级 + 线性成长
  const absStart = '  /** 吸收染料 → 写入目标槽位（按槽位权重立即生效），随后清空所有装置。 */';
  const absEnd = '  /**\n   * 将染料写入指定槽位并按槽位权重立即生效：';
  const a2 = s.indexOf(absStart);
  const b2 = s.indexOf(absEnd);
  if (a2 < 0 || b2 < 0 || b2 <= a2) { console.error('absorbDye anchors fail'); ok = false; }
  else {
    const newAbsorb = `  /** 吸收染料 → 进化等级 +1（线性属性成长），随后清空所有装置。 */
  private absorbDye(dyeId: string): void {
    const dye = getDye(dyeId);
    if (!dye) return;
    // 进化：等级 +1 → 该染料效果 +30% 基准值（colorist 式喂养）
    gameState.dyeEvolution[dyeId] = (gameState.dyeEvolution[dyeId] ?? 0) + 1;
    const lvl = gameState.dyeEvolution[dyeId];
    this.applyDyeEffect(dye.effectType, dye.effectValue * 0.3);
    if (dye.secondEffect) this.applyDyeEffect(dye.secondEffect.type, dye.secondEffect.value * 0.3);
    // 主槽联动：同色则纯度随等级成长；首次吸收自动设为主染料
    if (!gameState.dyeSlots[0].dyeId) {
      gameState.dyeSlots[0].dyeId = dyeId;
      gameState.dyeSlots[0].purity = 0.5;
      gameState.dyeColor = dye.hex;
      this.orbitColor = gameState.dyeColor;
    } else if (gameState.dyeSlots[0].dyeId === dyeId) {
      gameState.dyeSlots[0].purity = Math.min(1, gameState.dyeSlots[0].purity + 0.15);
    }
    this.showFloatingText(this.player.x, this.player.y - 78, dye.name + ' 进化 Lv.' + lvl, dye.color);
    emit('dye', { name: dye.name + '（进化 Lv.' + lvl + '）' });
    this.playSfx('sfx-ding', 0.9);
    this.playTone(880, 0.14, 'sine', 0.06);
    for (const station of this.dyeStations) {
      station.view.destroy();
      station.halo.destroy();
      station.label.destroy();
    }
    this.dyeStations = [];
  }

`;
    s = s.slice(0, a2) + newAbsorb + s.slice(b2);
    console.log('absorbDye rewritten');
  }

  // 2d. 光谱克制：主染料进化等级线性加成
  rep(
    '    // 如果主染料的互补色 = 目标弱点，伤害+30%',
    '    // 如果主染料的互补色 = 目标弱点，伤害+30% + 进化等级 ×6%（进化系统线性成长）'
  );
  rep(
    '    if (complementary[mainDyeId] === target.weaknessDyeId) return 0.3;',
    '    if (complementary[mainDyeId] === target.weaknessDyeId) {\n      return 0.3 + 0.06 * (gameState.dyeEvolution[mainDyeId] ?? 0);\n    }'
  );

  // 2e. 电子压制链加入进化全局加成（每总等级 +1%）
  rep(
    '    const mult = this.electronState.damageMult * this.gearDamageMult * w.damageMult\n      * this.reactionDamageMult()',
    '    const evolutionLevels = Object.values(gameState.dyeEvolution ?? {}).reduce((sum, v) => sum + v, 0);\n    const mult = this.electronState.damageMult * this.gearDamageMult * w.damageMult\n      * (1 + evolutionLevels * 0.01)\n      * this.reactionDamageMult()'
  );

  fs.writeFileSync(p, s);
  console.log('GameScene evolution:', ok ? 'OK' : 'MISSED');
}
