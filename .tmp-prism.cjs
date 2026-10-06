const fs = require('fs');
const p = 'src/game/scenes/GameScene.ts';
let s = fs.readFileSync(p, 'utf8');
let ok = true;
const rep = (a, b) => { if (!s.includes(a)) { console.error('MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

// 体积棱柱渲染：接在 tints 循环之后、decorations 循环之前
rep(
  '      terrainGfx.closePath();\n' +
  '      terrainGfx.fillPath();\n' +
  '    }\n' +
  '    for (const deco of terrain.decorations) {',
  '      terrainGfx.closePath();\n' +
  '      terrainGfx.fillPath();\n' +
  '    }\n\n' +
  '    // ---- 体积化地形（v0.2.3）：高地格绘制等距棱柱（顶面菱形 + 左右侧面挤出厚度）----\n' +
  '    // 三阶色板：顶面 = accent 原色，左面 darken(28)，右面 darken(45)；厚度 12/20/28 三档\n' +
  '    const isoBlock = (gx: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, height: number, top: number, rim: number): void => {\n' +
  '      const topY = y - height;\n' +
  "      const sideL = Phaser.Display.Color.IntegerToColor(top).darken(28).color;\n" +
  "      const sideR = Phaser.Display.Color.IntegerToColor(top).darken(45).color;\n" +
  '      // 左侧面（朝左下的可见面）\n' +
  '      gx.fillStyle(sideL, 1);\n' +
  '      gx.beginPath();\n' +
  '      gx.moveTo(x - w / 2, y);\n' +
  '      gx.lineTo(x, y + h / 2);\n' +
  '      gx.lineTo(x, y + h / 2 + height);\n' +
  '      gx.lineTo(x - w / 2, y + height);\n' +
  '      gx.closePath();\n' +
  '      gx.fillPath();\n' +
  '      // 右侧面（朝右下的可见面）\n' +
  '      gx.fillStyle(sideR, 1);\n' +
  '      gx.beginPath();\n' +
  '      gx.moveTo(x + w / 2, y);\n' +
  '      gx.lineTo(x, y + h / 2);\n' +
  '      gx.lineTo(x, y + h / 2 + height);\n' +
  '      gx.lineTo(x + w / 2, y + height);\n' +
  '      gx.closePath();\n' +
  '      gx.fillPath();\n' +
  '      // 顶面（上移 height）\n' +
  '      gx.fillStyle(top, 1);\n' +
  '      gx.beginPath();\n' +
  '      gx.moveTo(x, y - h / 2 - height);\n' +
  '      gx.lineTo(x + w / 2, y - height);\n' +
  '      gx.lineTo(x, y + h / 2 - height);\n' +
  '      gx.lineTo(x - w / 2, y - height);\n' +
  '      gx.closePath();\n' +
  '      gx.fillPath();\n' +
  '      // 顶面边缘线（群系强调色，勾勒体积轮廓）\n' +
  '      gx.lineStyle(1.2, rim, 0.5);\n' +
  '      gx.strokePath();\n' +
  '    };\n' +
  '    for (const blk of terrain.blocks) {\n' +
  '      isoBlock(terrainGfx, blk.x, blk.y, blk.w, blk.h, blk.height, blk.top, blk.rim);\n' +
  '    }\n' +
  '    for (const deco of terrain.decorations) {'
);

fs.writeFileSync(p, s);
console.log(ok ? 'PRISM RENDER OK' : 'MISSED');
