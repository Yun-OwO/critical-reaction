export interface Diamond {
  cx: number;
  cy: number;
  a: number;
  b: number;
}

/** 归一化菱形距离：中心 0，边界 1，外部 >1。 */
export function diamondS(diamond: Diamond, x: number, y: number): number {
  return Math.abs(x - diamond.cx) / diamond.a + Math.abs(y - diamond.cy) / diamond.b;
}

/** 将点沿径向投影进菱形内（s <= maxS），已在内部时原样返回。 */
export function projectInside(
  diamond: Diamond,
  x: number,
  y: number,
  maxS = 1
): { x: number; y: number } {
  const s = diamondS(diamond, x, y);
  if (s <= maxS) return { x, y };
  const k = maxS / s;
  return {
    x: diamond.cx + (x - diamond.cx) * k,
    y: diamond.cy + (y - diamond.cy) * k
  };
}
