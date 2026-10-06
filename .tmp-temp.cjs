const fs = require('fs');

// ---- 1. balance.ts: 温度压力加码 + 取消自然下降 ----
{
  const p = 'src/game/data/balance.ts';
  let b = fs.readFileSync(p, 'utf8');
  b = b.replace('    riseBase: 0.048,', '    riseBase: 0.075,');
  b = b.replace('    riseHeatScale: 0.112,', '    riseHeatScale: 0.14,');
  b = b.replace(
    '    /** 战斗内也缓慢下降（散热），但低于上升速率 */\n    coolInCombat: 0.12,',
    '    /** 战斗内自然散热 = 0（v0.2.2 设计决策：温度只升不降，唯一出路是还原注入/里程碑/水池） */\n    coolInCombat: 0,'
  );
  b = b.replace(
    '    /** 非战斗：缓慢降温 */\n    coolOutOfCombat: 0.6,',
    '    /** 非战斗自然降温 = 0（同上：温度压力常驻，撤离不再是唯一解） */\n    coolOutOfCombat: 0,'
  );
  b = b.replace(
    "  if (BALANCE.temperature.coolOutOfCombat <= BALANCE.temperature.riseBase) {\n    issues.push('非战斗散热必须大于战斗基础升温，否则温度不可回落');\n  }",
    "  // 自然散热已移除（v0.2.2）：温度只升不降，靠还原注入/里程碑/水池回落\n  if (BALANCE.temperature.coolInCombat !== 0 || BALANCE.temperature.coolOutOfCombat !== 0) {\n    issues.push('自然散热应为 0（设计决策：温度只升不降，降温走还原注入）');\n  }"
  );
  fs.writeFileSync(p, b);
  console.log('balance temp:', b.includes('riseBase: 0.075') ? 'ok' : 'FAILED');
}

// ---- 2. GameScene: 移除两条自然降温语句 ----
{
  const p = 'src/game/scenes/GameScene.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b2) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 55)); ok = false; return; } s = s.split(a).join(b2); };
  rep(
    '      gameState.temperature = Math.min(100, gameState.temperature + rise);\n      // 战斗内也缓慢下降（散热），但低于上升速率\n      gameState.temperature = Math.max(0, gameState.temperature - dt * BALANCE.temperature.coolInCombat);',
    '      gameState.temperature = Math.min(100, gameState.temperature + rise);'
  );
  rep(
    '    } else {\n      // 非战斗：缓慢降温\n      gameState.temperature = Math.max(0, gameState.temperature - dt * BALANCE.temperature.coolOutOfCombat);\n    }',
    '    } // 自然散热已移除（v0.2.2）：温度只升不降——还原注入/里程碑/水池是唯一降温手段'
  );
  fs.writeFileSync(p, s);
  console.log('gameScene cooling removal:', ok ? 'ok' : 'MISSED');
}
