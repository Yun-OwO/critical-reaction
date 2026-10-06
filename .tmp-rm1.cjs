const fs = require('fs');

// ============ 1. 移除小地图（UIScene 渲染 + GameScene 追踪 + 纯模块） ============
{
  const p = 'src/game/scenes/UIScene.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b) => { if (!s.includes(a)) { console.error('UI MISS:', a.slice(0, 55)); ok = false; return; } s = s.split(a).join(b); };
  rep("import { layoutRoomTree, layoutBounds, type MapNode, type MapEdge, type NodePos } from '../ui/minimap';\n", '');
  rep(`  /** 小地图：紧凑态（当前+上一间）与展开态（完整走过路径树） */
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private minimapExpanded = false;
  private minimapLastKey = '';
  private keyM!: Phaser.Input.Keyboard.Key;`, '');
  rep(`    // ---- 右上：小地图（顶部房间文字改造：图标 + 树状走过路径；M 键/点击展开） ----
    this.minimapGfx = this.add.graphics().setScrollFactor(0).setDepth(15);
    const mmZone = this.add.zone(W - 92 * s, 30 * s, 170 * s, 62 * s).setScrollFactor(0).setDepth(16).setInteractive({ useHandCursor: true });
    mmZone.on('pointerdown', () => { this.minimapExpanded = !this.minimapExpanded; this.minimapLastKey = ''; });
    this.keyM = this.input.keyboard!.addKey('M');`, '');
  rep(`    this.refreshDangerVignette();
    this.drawOffscreenIndicators();
    this.drawMinimap();`,
`    this.refreshDangerVignette();
    this.drawOffscreenIndicators();`);
  // 删除 toggleMinimapIfKey + drawMinimap 两个方法（从注注释到 hudRightEdge 注释前）
  const startMark = '  /** M 键切换展开（桌面）。 */';
  const endMark = '  /** HUD 右下角元素的右边界（设计单位）：移动端让开按钮组，避免相互遮挡。 */';
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a >= 0 && b > a) {
    s = s.slice(0, a) + s.slice(b);
    console.log('removed minimap methods');
  } else {
    console.error('minimap method anchors not found');
    ok = false;
  }
  fs.writeFileSync(p, s);
  console.log('UIScene minimap removal:', ok ? 'ok' : 'MISSED');
}
{
  const p = 'src/game/scenes/GameScene.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b) => { if (!s.includes(a)) { console.error('GS MISS:', a.slice(0, 55)); ok = false; return; } s = s.split(a).join(b); };
  rep("import type { MapEdge, MapNode } from '../ui/minimap';\n", '');
  rep(`  /** 小地图：走过路径的房间图（节点=进入过的房间，边=实际走过的门） */
  private mapNodes: MapNode[] = [];
  private mapEdges: MapEdge[] = [];
  private mapSeen = new Set<number>();
  private mapCurrentId = -1;`, '');
  rep(`    this.mapNodes = [];
    this.mapEdges = [];
    this.mapSeen.clear();
    this.mapCurrentId = -1;`, '');
  rep(`    // 小地图追踪：走过路径 = 节点（进入过的房间）+ 边（实际通过的门）
    if (!this.mapSeen.has(room.id)) {
      this.mapSeen.add(room.id);
      this.mapNodes.push({ id: room.id, type: room.type, depth: room.depth, layer: room.layer });
    }
    if (this.roomDef && this.roomDef.id !== room.id && !this.mapEdges.some((e) => e.from === this.roomDef.id && e.to === room.id)) {
      this.mapEdges.push({ from: this.roomDef.id, to: room.id });
    }
    this.mapCurrentId = room.id;
`, '');
  rep(`  /** 小地图数据（只读访问：UIScene 绘制走过路径）。 */
  public getMinimapData(): { nodes: MapNode[]; edges: MapEdge[]; currentId: number } {
    return { nodes: this.mapNodes, edges: this.mapEdges, currentId: this.mapCurrentId };
  }

`, '');
  fs.writeFileSync(p, s);
  console.log('GameScene minimap removal:', ok ? 'ok' : 'MISSED');
}

// ============ 2. 音效叠加上限 8 → 5 ============
{
  const p = 'src/game/utils/SfxLimiter.ts';
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace('  maxVoices: 8,', '  maxVoices: 5,');
  s = s.replace(' * - 总并发上限（maxVoices 窗口内总播放数）', ' * - 总并发上限（maxVoices 窗口内总播放数，v0.2.2 = 5）');
  fs.writeFileSync(p, s);
  console.log('sfx maxVoices 5:', s.includes('maxVoices: 5,') ? 'ok' : 'FAILED');
}

// ============ 3. minimap.ts 删除 + 测试清理 ============
{
  fs.unlinkSync('src/game/ui/minimap.ts');
  console.log('minimap.ts deleted');
  const p = 'tests/reaction.test.ts';
  let s = fs.readFileSync(p, 'utf8');
  const start = s.indexOf("describe('小地图房间树布局'");
  if (start >= 0) {
    // 删除到最后一个 describe 块结尾（它是文件最后一段）
    const tail = '});\n';
    const lastEnd = s.lastIndexOf('});');
    s = s.slice(0, start).trimEnd() + '\n';
    fs.writeFileSync(p, s);
    console.log('minimap tests removed');
  }
}
