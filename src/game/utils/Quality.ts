/**
 * 运行时负载监控（移植自参考项目「何忆卫」render/fx.js 的 `LOAD_PARTICLES` 模型）。
 *
 * 质量分档本身已有归属：`visual/quality.ts` 的「光影质量」档（auto/low/medium/high）
 * 负责按设备能力定基数，玩家也能在设置里手动固定。本模块只补它缺的另一半 ——
 * **运行时按实测帧率升降**：同一台设备在战斗高峰与空闲时的开销天差地别，
 * 静态分档救不了前者，于是给了两层缩放：
 *
 *     最终粒子上限 = 光影质量档的 maxParticles × 负载档衰减系数
 *
 * 这样低端机自动变"瘦"，而不是靠写死的低配分支牺牲表现力。
 */

/** 负载档 0-3 对粒子上限的衰减系数。 */
export const LOAD_PARTICLES = Object.freeze([1, 0.75, 0.55, 0.4]);

/**
 * 实测帧率驱动的负载档。每 500ms 收一次样：
 *  - 连续掉到 40fps 以下满 2s → 升一档（更省）；
 *  - 稳定 55fps 以上满 10s → 降一档（还回去）。
 *
 * 升快降慢是刻意的：玩家对"掉帧"远比对"粒子变少"敏感，宁可早收紧，
 * 也别在战斗里反复横跳造成视觉抖动。
 */
export class LoadMonitor {
  private accMs = 0;
  private frames = 0;
  private fps = 60;
  private badWindows = 0;
  private goodWindows = 0;
  private level = 0;

  public sample(deltaMs: number): void {
    // 首帧 / 切场景的大间隔不计入（否则一进场景就误判为卡顿）
    if (deltaMs > 250) { this.accMs = 0; this.frames = 0; return; }
    this.accMs += deltaMs;
    this.frames += 1;
    if (this.accMs < 500) return;
    const inst = (this.frames * 1000) / this.accMs;
    this.accMs = 0;
    this.frames = 0;
    // 指数平滑：单帧毛刺不该触发降档
    this.fps = this.fps * 0.55 + inst * 0.45;

    if (this.fps < 40) {
      this.badWindows += 1;
      this.goodWindows = 0;
      if (this.badWindows >= 4 && this.level < 3) { this.level += 1; this.badWindows = 0; }
    } else if (this.fps > 55) {
      this.goodWindows += 1;
      this.badWindows = 0;
      if (this.goodWindows >= 20 && this.level > 0) { this.level -= 1; this.goodWindows = 0; }
    } else {
      this.badWindows = 0;
      this.goodWindows = 0;
    }
  }

  public get loadLevel(): number { return this.level; }
  public get smoothedFps(): number { return this.fps; }
}
