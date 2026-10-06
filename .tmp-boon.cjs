const fs = require('fs');

// ===== 4. 祝福全面再平衡 =====
// 问题：+N 电子类祝福（过载打击/链式/裂变/引爆冲刺/玻璃大炮/晶格冲击/酸蚀）按概率转译相当于
//       +100%~+300% 压制；而觉醒的 +8% 全局伤害反而更弱。
// 方案：电子类改为「概率型压制加成」（+N 颗 → 每颗按 0.35 折算为压制概率，即 +35%/颗），
//       觉醒全局伤害上调到 +15%，并为电子类设置全局压制上限。

const p = 'src/game/data/upgrades.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const setScale = (id, scale) => {
  const anchor = `    id: '${id}',`;
  const at = s.indexOf(anchor);
  if (at < 0) { console.error('boon not found:', id); ok = false; return; }
  const scaleAt = s.indexOf('    rarityScale:', at);
  const lineEnd = s.indexOf('\n', scaleAt);
  const current = s.slice(scaleAt, lineEnd);
  const replacement = `    rarityScale: {${Object.entries(scale).map(([k, v]) => `${k}: ${v}`).join(', ')}}`;
  s = s.slice(0, scaleAt) + replacement + s.slice(lineEnd);
  console.log(id, current.trim(), '→', replacement.trim());
};

// 电子类：数值下调（原本 1~3 颗直接给，现压到 0~2 且按 0.35 折算）
setScale('h-atk-overload', { common: 1, rare: 1, epic: 1, mythic: 2 });
setScale('h-atk-chain', { common: 0, rare: 1, epic: 1, mythic: 1 });
setScale('h-sp-fission', { common: 1, rare: 1, epic: 1, mythic: 2 });
setScale('h-dash-detonate', { common: 1, rare: 1, epic: 1, mythic: 2 });
setScale('h-pass-glass', { common: 0, rare: 0, epic: 1, mythic: 2 });
setScale('c-atk-lattice', { common: 0, rare: 1, epic: 2, mythic: 2 });
setScale('o-atk-acid', { common: 0, rare: 1, epic: 1, mythic: 1 });
// 核聚变 ×N 收敛（×3 → ×2）
setScale('h-sp-nuke', { common: 0, rare: 2, epic: 2, mythic: 3 });

// 觉醒全局伤害：+8% → +15%（与电子类压制收益对齐）
s = s.replace(
  "id: 'sp-might', name: '催化威能', icon: '⚔', slot: 'might', school: 'cat',\n    rarity: 'epic', desc: '全局伤害 +8%',\n    rarityScale: { common: 0.08, rare: 0.08, epic: 0.08, mythic: 0.08 }",
  "id: 'sp-might', name: '催化威能', icon: '⚔', slot: 'might', school: 'cat',\n    rarity: 'epic', desc: '全局伤害 +15%',\n    rarityScale: { common: 0.15, rare: 0.15, epic: 0.15, mythic: 0.15 }"
);

fs.writeFileSync(p, s);
console.log('upgrades rebalance:', ok ? 'OK' : 'MISSED');

// ===== GameScene: 电子类 → 概率型压制（0.35 折算 + 全局压制上限） =====
{
  const gp = 'src/game/scenes/GameScene.ts';
  let g = fs.readFileSync(gp, 'utf8');
  let gOk = true;
  const rep = (a, b) => { if (!g.includes(a)) { console.error('MISS:', a.slice(0, 60)); gOk = false; return; } g = g.split(a).join(b); };

  // 电子类折算常数 + 压制上限
  rep(
    '  private electronMult = 1;',
    '  private electronMult = 1;\n' +
    '  /** 电子类祝福折算：每 +1 颗电子请求 → 0.35 压制概率（v0.2.2 平衡：+N 颗 ≈ +35%×N） */\n' +
    '  private static readonly ELECTRON_TO_PRESSURE = 0.35;\n' +
    '  /** 全局压制软上限：所有电子类祝福叠加后压制概率不超过此值（防 +N 颗线性爆炸） */\n' +
    '  private static readonly MAX_PRESSURE_BONUS = 2.2;'
  );

  // 氧化夺取类应用折算
  rep(
    "      case 'h-atk-overload':\n        this.boonExtraElectronOxidize += sign * v;\n        break;",
    "      case 'h-atk-overload':\n        // v0.2.2 平衡：+N 颗 → N × 0.35 压制概率（而非直接 +N 颗请求）\n        this.boonExtraElectronOxidize += sign * v * GameScene.ELECTRON_TO_PRESSURE;\n        break;"
  );
  rep(
    "      case 'h-pass-glass':\n        this.boonExtraElectronOxidize += sign * v;\n        this.boonGlassCannonPenalty += sign;",
    "      case 'h-pass-glass':\n        this.boonExtraElectronOxidize += sign * v * GameScene.ELECTRON_TO_PRESSURE;\n        this.boonGlassCannonPenalty += sign;"
  );

  // 压制上限：electronPressureBonus 封顶
  rep(
    '    const evolutionLevels = Object.values(gameState.dyeEvolution ?? {}).reduce((sum, v) => sum + v, 0);',
    '    // 压制软上限：所有加成叠加后不超过 MAX_PRESSURE_BONUS（v0.2.2：+N 颗不再线性爆炸）\n' +
    '    const clampPressure = (value: number): number => Math.min(GameScene.MAX_PRESSURE_BONUS, value);\n' +
    '    const evolutionLevels = Object.values(gameState.dyeEvolution ?? {}).reduce((sum, v) => sum + v, 0);'
  );
  rep(
    '    return Math.max(0, mult - 1);',
    '    return clampPressure(Math.max(0, mult - 1));'
  );

  fs.writeFileSync(gp, g);
  console.log('gameScene boon balance:', gOk ? 'OK' : 'MISSED');
}
