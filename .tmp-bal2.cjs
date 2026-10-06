const fs = require('fs');
const p = 'src/game/scenes/GameScene.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

// ===== 1. 单次攻击最多破坏一层（溢出伤害不顺延） =====
rep(
  '  private damageEnemy(target: RuntimeEnemy, amount: number): void {\n' +
  '    target.hp -= amount;\n' +
  '    if (target.hp > 0) return;\n' +
  '    if (target.electronLayers > 1) {\n' +
  '      target.electronLayers -= 1;\n' +
  '      target.hp = target.maxHp;',
  '  private damageEnemy(target: RuntimeEnemy, amount: number): void {\n' +
  '    // v0.2.2：单次攻击最多破坏一层——溢出伤害不顺延到下一层（避免一击穿多层）\n' +
  '    target.hp -= amount;\n' +
  '    if (target.hp > 0) return;\n' +
  '    if (target.electronLayers > 1) {\n' +
  '      target.electronLayers -= 1;\n' +
  '      target.hp = target.maxHp; // 新层回满血，本次剩余伤害作废'
);

// ===== 2. 自适应难度：移除攻击反应热，改为随通关推进速度升温 =====
rep(
  '    // 反应热 = |ΔH| / reactionHeatDivisor（balance.ts）：氧化命中是高频事件，单次热度必须克制\n' +
  '    gameState.temperature = Phaser.Math.Clamp(gameState.temperature + Math.abs(reaction.deltaH) / BALANCE.temperature.reactionHeatDivisor, 0, 100);',
  '    // v0.2.2：攻击反应热已移除——温度改由「通关推进速度」驱动（自适应难度，见 applyPacingHeat）\n' +
  '    // 反应只带来电子转移收益，不再直接惩罚输出频率'
);

// 自适应难度实现：字段 + 每房计时 + 结算
rep(
  '  /** 本局地图种子：柏林噪声群系/地形/地物的生成源（每局随机） */\n  private runSeed = 1;',
  '  /** 本局地图种子：柏林噪声群系/地形/地物的生成源（每局随机） */\n  private runSeed = 1;\n' +
  '  /** 自适应难度：本局已推进房间数 / 本房间已用秒数 / 累计房间耗时 */\n' +
  '  private roomsCleared = 0;\n' +
  '  private roomElapsed = 0;\n' +
  '  private totalElapsed = 0;'
);

// 房间计时累加（updateRoom 顶部）+ 通关房结算
rep(
  '  private updateRoom(dt: number): void {\n    switch (gameState.roomState) {',
  '  private updateRoom(dt: number): void {\n' +
  '    // 自适应难度计时：房间内推进秒数（战斗/撤离房均计）\n' +
  "    if (gameState.currentRoomType !== 'travel') {\n" +
  '      this.roomElapsed += dt;\n' +
  '      this.totalElapsed += dt;\n' +
  '    }\n' +
  '    switch (gameState.roomState) {'
);

// 房间清空时按速度升温
rep(
  "  private onRoomCleared(): void {\n    this.roomClearTimer = 0.45;\n    this.roomClearRewardGiven = true;",
  "  private onRoomCleared(): void {\n    this.roomClearTimer = 0.45;\n    this.roomClearRewardGiven = true;\n" +
  '    // 自适应难度：通关越快 → 升温越多（快节奏推高压，慢节奏给缓冲）\n' +
  '    this.roomsCleared += 1;\n' +
  '    this.applyPacingHeat();'
);

// applyPacingHeat 实现（插在 onRoomCleared 之后）
rep(
  '  private showRoomBanner(text: string, color: string): void {',
  '  /**\n' +
  '   * 自适应难度：按本房间清空的快慢给温度压力。\n' +
  '   * 快（< par 秒）= 高压，慢（> par ×2）= 低压，形成「推进越快越危险」的节奏曲线。\n' +
  '   */\n' +
  '  private applyPacingHeat(): void {\n' +
  '    const par = BALANCE.temperature.pacingParSeconds;\n' +
  '    const ratio = Phaser.Math.Clamp(this.roomElapsed / Math.max(1, par), 0, 3);\n' +
  '    // 快 → 接近 maxRise；慢 → 衰减到 minRise\n' +
  '    const t = Phaser.Math.Clamp(1 - (ratio - 0.5) / 1.5, 0, 1);\n' +
  '    const rise = BALANCE.temperature.pacingMinRise\n' +
  '      + (BALANCE.temperature.pacingMaxRise - BALANCE.temperature.pacingMinRise) * t;\n' +
  '    gameState.temperature = Phaser.Math.Clamp(gameState.temperature + rise, 0, 100);\n' +
  '    this.roomElapsed = 0;\n' +
  '  }\n\n' +
  '  private showRoomBanner(text: string, color: string): void {'
);

// ===== 3. 等离子体「特殊攻击范围+50%」不再影响普通攻击 =====
// 新增专用字段 boonSpecialAoeMult，普通攻击路径改用它
rep(
  '  private boonAoeMult = 1;',
  '  private boonAoeMult = 1;\n' +
  '  /** 特殊攻击专用 AOE 倍率（v0.2.2：与 boonAoeMult 分离，避免「特殊范围+50%」误作用于普通攻击） */\n' +
  '  private boonSpecialAoeMult = 1;'
);
rep(
  '    this.boonAoeMult = 1;',
  '    this.boonAoeMult = 1;\n    this.boonSpecialAoeMult = 1;'
);
rep(
  '        this.boonAoeMult += sign * 0.5;',
  '        // 等离子体「特殊攻击范围 +50%」：只作用于特殊攻击\n' +
  '        this.boonSpecialAoeMult += sign * 0.5;'
);
// 激光/旋风斩/裂变/腐蚀等「特殊攻击」路径改用 boonSpecialAoeMult
rep(
  '            const radius = FISSION_RADIUS * this.boonAoeMult;',
  '            const radius = FISSION_RADIUS * this.boonSpecialAoeMult;'
);
rep(
  '      this.spawnMist(cx, cy, this.boonCorrodeDps * this.boonSpecialElectronMult, 0x5cffb1, 90 * this.boonAoeMult, 5);',
  '      this.spawnMist(cx, cy, this.boonCorrodeDps * this.boonSpecialElectronMult, 0x5cffb1, 90 * this.boonSpecialAoeMult, 5);'
);
rep(
  '    const bladeLen = getWeapon(gameState.currentWeapon).range * this.boonAoeMult * this.weaponMods.rangeMult; // 受 AOE 倍率影响',
  '    const bladeLen = getWeapon(gameState.currentWeapon).range * this.boonSpecialAoeMult * this.weaponMods.rangeMult; // 特殊攻击专用 AOE'
);
rep(
  '    const bladeLen = getWeapon(gameState.currentWeapon).range * this.boonAoeMult * this.weaponMods.rangeMult * (1 + 0.12 * electronBoost);',
  '    const bladeLen = getWeapon(gameState.currentWeapon).range * this.boonSpecialAoeMult * this.weaponMods.rangeMult * (1 + 0.12 * electronBoost);'
);
// 激光半宽：特殊攻击走 special，普攻弹体半径仍走 boonAoeMult
rep(
  '    const beamWidthMult = (1 + 0.12 * electronBoost) * this.boonAoeMult * this.weaponMods.aoeMult;',
  '    const beamWidthMult = (1 + 0.12 * electronBoost) * this.boonSpecialAoeMult * this.weaponMods.aoeMult;'
);
rep(
  '        if (Phaser.Math.Distance.Between(this.boss.view.x, this.boss.view.y, projX, projY) < (60 + 30 * p) * this.boonAoeMult) {',
  '        if (Phaser.Math.Distance.Between(this.boss.view.x, this.boss.view.y, projX, projY) < (60 + 30 * p) * this.boonSpecialAoeMult) {'
);
rep(
  '          if (Phaser.Math.Distance.Between(this.boss.view.x, this.boss.view.y, projX, projY) < (60 + 30 * p) * this.boonAoeMult) {',
  '          if (Phaser.Math.Distance.Between(this.boss.view.x, this.boss.view.y, projX, projY) < (60 + 30 * p) * this.boonSpecialAoeMult) {'
);

fs.writeFileSync(p, s);
console.log(ok ? 'BALANCE2 OK' : 'SOME MISSED');
