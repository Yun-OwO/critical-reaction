const fs = require('fs');
const p = 'src/game/scenes/UIScene.ts';
let s = fs.readFileSync(p, 'utf8');
const anchor = "      setTextSafe(chip.purity, `${Math.round((slot.purity ?? 0) * 100)}%`);";
if (!s.includes(anchor)) { console.error('anchor missing'); process.exit(1); }
const replacement = [
  '      // 进化系统：主槽显示进化等级，其余槽显示纯度',
  "      const evoLvl = i === 0 ? (gameState.dyeEvolution[slot.dyeId ?? ''] ?? 0) : 0;",
  '      setTextSafe(chip.purity, i === 0 && evoLvl > 0 ? `进化 Lv.${evoLvl}` : `${Math.round((slot.purity ?? 0) * 100)}%`);'
].join('\n');
s = s.split(anchor).join(replacement);
fs.writeFileSync(p, s);
console.log('chips evo lvl:', s.includes('进化 Lv.'));
