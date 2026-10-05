/**
 * 小地图布局（纯函数，便于单测）：房间树 → 画布坐标。
 *
 * 数据来源：GameScene 按进入顺序记录的节点与边（房间图是"线性主干 + 分支门"形态）。
 * 布局规则：
 *  - x 按房间深度（depth + 层偏移）分列；
 *  - y 按分支泳道（lane）：长子继承父泳道，其余兄弟依次向下开新泳道；
 *  - 同泳道同列冲突时向下顺延一格。
 */

import type { RoomType } from '../data/rooms';

export interface MapNode {
  id: number;
  type: RoomType;
  depth: number;
  layer: number;
}

export interface MapEdge {
  from: number;
  to: number;
}

export interface NodePos {
  id: number;
  x: number;
  y: number;
  lane: number;
  col: number;
}

export interface MinimapLayoutOptions {
  colWidth: number;
  rowHeight: number;
  padX: number;
  padY: number;
}

export const MINIMAP_DEFAULTS: MinimapLayoutOptions = {
  colWidth: 56,
  rowHeight: 40,
  padX: 30,
  padY: 34
};

/**
 * 房间树布局：返回 id → 坐标（左上原点）。
 * col = 层内深度 + 已过层数偏移（跨层连续向右），保证"走过的路径向右延伸"。
 */
export function layoutRoomTree(
  nodes: readonly MapNode[],
  edges: readonly MapEdge[],
  opts: MinimapLayoutOptions = MINIMAP_DEFAULTS
): Map<number, NodePos> {
  const { colWidth, rowHeight, padX, padY } = opts;
  const posById = new Map<number, NodePos>();
  if (nodes.length === 0) return posById;

  // 每个节点的列 = 层内深度 + 层偏移（跨层连续：新层从上一层最大深度 +2 开始，空一列分隔）
  const layerOffset = new Map<number, number>();
  const layerMaxDepth = new Map<number, number>();
  let lastLayer = -1;
  let offset = 0;
  for (const node of nodes) {
    if (node.layer !== lastLayer) {
      if (lastLayer >= 0) offset += (layerMaxDepth.get(lastLayer) ?? 0) + 2;
      lastLayer = node.layer;
      layerOffset.set(node.layer, offset);
    }
    const md = Math.max(layerMaxDepth.get(node.layer) ?? -1, node.depth);
    layerMaxDepth.set(node.layer, md);
    layerOffset.set(node.layer, offset);
  }
  const colOf = new Map<number, number>();
  for (const node of nodes) {
    colOf.set(node.id, (layerOffset.get(node.layer) ?? 0) + node.depth);
  }

  // 父边表（每节点取第一条入边为父）
  const parentOf = new Map<number, number>();
  for (const e of edges) {
    if (!parentOf.has(e.to)) parentOf.set(e.to, e.from);
  }

  // 泳道分配：长子继承父泳道，后续兄弟依次开新泳道
  const laneOf = new Map<number, number>();
  const childIndex = new Map<number, number>();
  let nextLane = 0;
  for (const node of nodes) {
    const parent = parentOf.get(node.id);
    if (parent === undefined) {
      laneOf.set(node.id, 0);
      nextLane = Math.max(nextLane, 1);
      continue;
    }
    const idx = childIndex.get(parent) ?? 0;
    childIndex.set(parent, idx + 1);
    const parentLane = laneOf.get(parent) ?? 0;
    if (idx === 0) {
      laneOf.set(node.id, parentLane);
      nextLane = Math.max(nextLane, parentLane + 1);
    } else {
      laneOf.set(node.id, nextLane);
      nextLane += 1;
    }
  }

  // 同泳道同列冲突：向下顺延
  const occupied = new Set<string>();
  for (const node of nodes) {
    const col = colOf.get(node.id) ?? 0;
    let lane = laneOf.get(node.id) ?? 0;
    while (occupied.has(col + ':' + lane)) lane += 1;
    occupied.add(col + ':' + lane);
    posById.set(node.id, {
      id: node.id,
      x: padX + col * colWidth,
      y: padY + lane * rowHeight,
      lane,
      col
    });
  }
  return posById;
}

/** 布局包围盒（用于把内容居中/缩放进面板）。 */
export function layoutBounds(pos: Map<number, NodePos>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
