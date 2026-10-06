const fs = require('fs');

// ============ 3. rooms.ts: 电子层数上限 3 → 8 ============
{
  const p = 'src/game/data/rooms.ts';
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(
    '    const layers = Math.min(3, Math.max(1, layer + 1));',
    '    const layers = Math.min(8, Math.max(1, layer + 1)); // v0.2.2：上限 3→8（2/3 层怪强度上调）'
  );
  fs.writeFileSync(p, s);
  console.log('rooms layers 8:', s.includes('Math.min(8, Math.max(1, layer + 1))') ? 'ok' : 'FAILED');
}

// ============ balance.ts: 稀有样本 + 护盾改革段 ============
{
  const p = 'src/game/data/balance.ts';
  let b = fs.readFileSync(p, 'utf8');
  if (!b.includes('hiddenExtractionBonus')) {
    b = b.replace(
      '    finalClearBonus: 60',
      '    finalClearBonus: 60,\n    /** 隐藏撤离点「稀有样本」奖励（一次性，不吃倍率） */\n    hiddenExtractionBonus: 15'
    );
  }
  if (!b.includes('baseMax: 10')) {
    b = b.replace(
      '  dash: {',
      '  shield: {\n    /** 基础护盾上限（v0.2.2：100 → 10，杜绝冲刺/攻击刷盾无敌） */\n    baseMax: 10,\n    /** 护盾自然衰减（/s）：刷新护盾不再是永久存档，停止获取即流失 */\n    decayPerSec: 4\n  },\n  dash: {'
    );
  }
  fs.writeFileSync(p, b);
  console.log('balance:', b.includes('hiddenExtractionBonus') && b.includes('baseMax: 10') ? 'ok' : 'FAILED');
}

// ============ GameScene: 六项接线 ============
{
  const p = 'src/game/scenes/GameScene.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b2) => { if (!s.includes(a)) { console.error('GS MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b2); };

  // 1. 隐藏撤离点移动端交互：判定框外扩
  rep(
    '    const nearZone = Phaser.Geom.Rectangle.Contains(this.extractZone.getBounds(), this.player.x, this.player.y);',
    '    // 移动端交互容差：判定框外扩 90px（触屏站位精度低，实测反馈「无响应」）\n' +
    '    const zoneBounds = this.extractZone.getBounds();\n' +
    '    zoneBounds.inflate(90, 90);\n' +
    '    const nearZone = Phaser.Geom.Rectangle.Contains(zoneBounds, this.player.x, this.player.y);'
  );

  // 1. 稀有样本奖励
  rep(
    '        const clearBonus = gameState.runComplete ? BALANCE.samples.finalClearBonus : 0;\n' +
    '        const gained = settleExtractionSamples(carried + settled + clearBonus, this.extractionDef);',
    '        const clearBonus = gameState.runComplete ? BALANCE.samples.finalClearBonus : 0;\n' +
    '        // 隐藏撤离点「稀有样本」：一次性 +15（不吃倍率，账目单列；修复「通过未刷新特殊奖励」）\n' +
    "        const hiddenBonus = this.extractionDef.id === 'hidden' ? BALANCE.samples.hiddenExtractionBonus : 0;\n" +
    '        const gained = settleExtractionSamples(carried + settled + clearBonus + hiddenBonus, this.extractionDef);'
  );
  rep(
    "            ...(gameState.runComplete ? [{ label: '通关奖励', value: `+${BALANCE.samples.finalClearBonus}` }] : []),",
    "            ...(gameState.runComplete ? [{ label: '通关奖励', value: `+${BALANCE.samples.finalClearBonus}` }] : []),\n" +
    "            ...(this.extractionDef.id === 'hidden' ? [{ label: '稀有样本', value: `+${BALANCE.samples.hiddenExtractionBonus}` }] : []),"
  );

  // 2. 隐藏关死亡保护（在 loseGearOnDeath 之前执行）
  rep(
    '      // 搜打撤：死亡丢失携带装备与局内搜到的战利品（成功撤离才带得出去）\n' +
    '      const deathGear = loseGearOnDeath(gameState.carriedGear);',
    '      // 隐藏关保护：撤离点为「隐藏撤离」时死亡，本局收益不丢失（样本/战利品入库）\n' +
    "      const hiddenProtection = this.extractionDef.id === 'hidden';\n" +
    '      let protectedSamples = 0;\n' +
    '      if (hiddenProtection) {\n' +
    '        protectedSamples = gameState.samples;\n' +
    '        bankCarriedGear(gameState.carriedGear);\n' +
    '        profileState.samples += protectedSamples;\n' +
    "        this.showFloatingText(this.player.x, this.player.y - 40, '隐藏关保护 · 收益已入库', '#FFD700');\n" +
    '      }\n' +
    '      // 搜打撤：死亡丢失携带装备与局内搜到的战利品（成功撤离才带得出去）\n' +
    '      const deathGear = loseGearOnDeath(gameState.carriedGear);'
  );
  // 死亡战报：保护时「保留进度」行改为收益入库、战利品不列丢失
  rep(
    "          { label: '丢失装备', value: deathGear.lost.length > 0 ? `${deathGear.lost.length} 件` : '—' },",
    "          { label: '丢失装备', value: hiddenProtection ? '已入库（隐藏关保护）' : deathGear.lost.length > 0 ? `${deathGear.lost.length} 件` : '—' },"
  );
  rep(
    "          { label: lostSamples > 0 ? '丢失样本' : '样本', value: lostSamples > 0 ? `-${lostSamples}` : `${gameState.samples}` },",
    "          { label: lostSamples > 0 ? '丢失样本' : '样本', value: hiddenProtection ? `+${protectedSamples}（入库）` : lostSamples > 0 ? `-${lostSamples}` : `${gameState.samples}` },"
  );
  rep(
    "        [\n" +
    "          ...deathGear.lost.map((id) => ({ id, lost: true })),\n" +
    "          ...gameState.carriedGear.map((id) => ({ id, lost: true }))\n" +
    "        ],",
    "        [\n" +
    "          ...(hiddenProtection ? [] : deathGear.lost.map((id) => ({ id, lost: true }))),\n" +
    "          ...(hiddenProtection ? [] : gameState.carriedGear.map((id) => ({ id, lost: true })))\n" +
    "        ],"
  );
  rep(
    "        '实验数据已保留 · 死亡永远带来成长'\n      );",
    "        hiddenProtection ? '隐藏关保护生效 · 收益已入库（稀有样本资格已失去）' : '实验数据已保留 · 死亡永远带来成长'\n      );"
  );

  // 4. 还原秒杀防护：容量-1 时不惰化，触发饱和吸收
  rep(
    "      } else {\n" +
    "        const result = captureElectron(orbit);\n" +
    "        onElectron();\n" +
    "        if (result.inertify" + "ed && onInertify) {\n" +
    "          onInertify();\n" +
    "          return;\n" +
    "        }\n" +
    "      }",
    "      } else {\n" +
    "        // 秒杀防护（v0.2.2）：距容量 ≤1 时注入只造成「饱和吸收」（过量试剂），\n" +
    "        // 不计数、不惰化——高电子数怪不再被还原攻击单点秒杀\n" +
    "        if (orbit.count >= orbit.capacity - 1) {\n" +
    "          onElectron();\n" +
    "          return;\n" +
    "        }\n" +
    "        const result = captureElectron(orbit);\n" +
    "        onElectron();\n" +
    "        if (result.inertified && onInertify) {\n" +
    "          onInertify();\n" +
    "          return;\n" +
    "        }\n" +
    "      }"
  );

  // 5. 护盾改革：基础上限走 BALANCE（100→10），攻击/冲刺护盾收益减半，叠加衰减
  rep(
    '  private shieldCap(): number {\n' +
    '    const base = 100 + this.relicMaxShield + this.gearMaxShield;\n' +
    '    return Math.round(base * (1 + this.electronState.shieldBonusPct / 100));\n' +
    '  }',
    '  private shieldCap(): number {\n' +
    '    // v0.2.2：基础护盾上限 100 → 10（冲刺/攻击刷盾不再无敌）\n' +
    '    const base = BALANCE.shield.baseMax + this.relicMaxShield + this.gearMaxShield;\n' +
    '    return Math.round(base * (1 + this.electronState.shieldBonusPct / 100));\n' +
    '  }\n' +
    '  /** 上次获得同源护盾的时间（收益递减窗口判定）。 */\n' +
    '  private lastShieldGainAt = -9999;\n' +
    '  /** 护盾获取：上限约束 + 1.2s 窗口内重复获取收益减半（反「一直冲刺无敌」）。 */\n' +
    '  private gainShield(amount: number, source: string): void {\n' +
    '    const now = this.time.now;\n' +
    '    const sinceLast = now - this.lastShieldGainAt;\n' +
    '    let gain = amount;\n' +
    '    if (sinceLast < BALANCE.shield.refreshWindowSec * 1000) {\n' +
    '      gain = Math.max(1, Math.floor(gain * 0.5));\n' +
    '    }\n' +
    '    this.lastShieldGainAt = now;\n' +
    '    gameState.shieldHp = Math.min(this.shieldCap(), gameState.shieldHp + gain);\n' +
    '    this.showFloatingText(this.player.x, this.player.y - 62, `护盾+${gain}`, \'#34D399\');\n' +
    '  }'
  );
  // 冲刺护盾走 gainShield（收益减半→机制合理：低上限+衰减+递减）
  rep(
    '    if (this.boonDashShield > 0) {\n' +
    '      const gain = Math.round(this.boonDashShield);\n' +
    '      gameState.shieldHp = Math.min(this.shieldCap(), gameState.shieldHp + gain);\n' +
    '      this.showFloatingText(this.player.x, this.player.y - 62, `护盾+${gain}`, \'#34D399\');\n' +
    '      const ring = this.add.circle(this.player.x, this.player.y, 70, 0x67e8f9, 0)\n' +
    '        .setStrokeStyle(3, 0x67e8f9, 0.8)\n' +
    '        .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);\n' +
    '      this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 300, onComplete: () => ring.destroy() });\n' +
    '    }',
    '    if (this.boonDashShield > 0) {\n' +
    '      this.gainShield(Math.round(this.boonDashShield), \'dash\');\n' +
    '      const ring = this.add.circle(this.player.x, this.player.y, 70, 0x67e8f9, 0)\n' +
    '        .setStrokeStyle(3, 0x67e8f9, 0.8)\n' +
    '        .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);\n' +
    '      this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 300, onComplete: () => ring.destroy() });\n' +
    '    }'
  );
  // 攻击护盾（原 ×10 直接刷）走 gainShield 且不再 ×10
  rep(
    '      if (this.boonShieldHeal > 0) {\n' +
    '        const gain = this.boonShieldHeal * 10;\n' +
    '        gameState.shieldHp = Math.min(this.shieldCap(), gameState.shieldHp + gain);\n' +
    '        this.showFloatingText(this.player.x, this.player.y - 62, `护盾+${gain}`, \'#34D399\');\n' +
    '      }',
    '      if (this.boonShieldHeal > 0) {\n' +
    '        this.gainShield(this.boonShieldHeal, \'attack\');\n' +
    '      }'
  );
  // 护盾自然衰减（update 主循环）
  rep(
    '    const heatRatio = Phaser.Math.Clamp(gameState.temperature / 100, 0, 1);',
    '    // 护盾自然衰减（v0.2.2）：停止获取即流失，护盾不再是永久存档\n' +
    '    if (gameState.shieldHp > 0) {\n' +
    '      gameState.shieldHp = Math.max(0, gameState.shieldHp - dt * BALANCE.shield.decayPerSec);\n' +
    '    }\n' +
    '    const heatRatio = Phaser.Math.Clamp(gameState.temperature / 100, 0, 1);'
  );

  // 6. 压制上限：单次 electronMult 请求封顶（超量伤害不再放大赛夺，怪不被秒杀）
  rep(
    '  private electronMult = 1;',
    '  private electronMult = 1;\n' +
    '  /** 单次交互的电子请求上限（失控取消之外的软保险，防极端构筑瞬杀）。 */\n' +
    '  private static readonly MAX_ELECTRON_REQUEST = 8;'
  );
  rep(
    '    let pressure = this.electronPressureBonus(mode) * this.electronMult;',
    '    // v0.2.2：软上限——单次交互最多请求 8 颗（此前叠满增益可到 15+，直接瞬杀多层怪）\n' +
    '    let pressure = Math.min(GameScene.MAX_ELECTRON_REQUEST, this.electronPressureBonus(mode) * this.electronMult);'
  );

  fs.writeFileSync(p, s);
  console.log('gameScene balance:', ok ? 'OK' : 'MISSED');
}
