export interface PositionXZ {
  x: number;
  z: number;
}

export interface ProjectionConfig {
  originX: number;
  originY: number;
  axisX: number;
  axisZ: number;
  depthScale: number;
}

export interface ProjectedPosition {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

export const DEFAULT_PROJECTION: ProjectionConfig = {
  originX: 0,
  originY: 0,
  axisX: 1,
  axisZ: 0.52,
  depthScale: 0.01
};

export function projectXZ(position: PositionXZ, config: ProjectionConfig = DEFAULT_PROJECTION): ProjectedPosition {
  const depth = position.x + position.z;
  const perspective = Math.max(0.82, Math.min(1.18, 1 + depth * config.depthScale));
  return {
    x: config.originX + position.x * config.axisX + position.z * config.axisZ,
    y: config.originY + position.z * 0.5,
    depth,
    scale: perspective
  };
}

export function projectIsoXZ(
  position: PositionXZ,
  originX: number,
  originY: number,
  halfTileWidth: number,
  halfTileHeight: number
): ProjectedPosition {
  return {
    x: originX + (position.x - position.z) * halfTileWidth,
    y: originY + (position.x + position.z) * halfTileHeight,
    depth: position.x + position.z,
    scale: 1
  };
}

export function distanceXZ(a: PositionXZ, b: PositionXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function angleXZ(from: PositionXZ, to: PositionXZ): number {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

export function depthFromXZ(z: number, layer = 0): number {
  return Math.round(z * 0.01) + layer;
}
