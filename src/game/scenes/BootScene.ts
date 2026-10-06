import Phaser from 'phaser';
import { loadGameAssets } from '../utils/AssetLoader';
import { loadProfileFromStorage } from '../state/ProfileState';

/**
 * 加载泵兜底（v0.2.3.1）：Loader 的推进完全依赖 SceneEvents.UPDATE（由 RAF 驱动）。
 * 若页面被系统节流（隐藏 iframe / 后台标签 / 部分移动端省电模式），RAF 停摆 →
 * 队列卡在 POPULATED → complete 永不触发 → 黑屏。
 * 三重保险：
 *  1. window 定时器每 300ms 手动泵一次 Loader.update（幂等，RAF 正常时无副作用）；
 *  2. 12 秒强制收尾：调引擎内建 loadComplete() 清队列放行；
 *  3. 'loaderror' 事件也计入完成，单个资源 404 不再阻塞整体。
 * 遵循「游戏永不阻塞于资源」原则：缺失纹理走降级渲染。
 */
const LOAD_TIMEOUT_SEC = 12;

export class BootScene extends Phaser.Scene {
  private settled = false;

  public constructor() {
    super('BootScene');
  }

  public preload(): void {
    // 等待 HTML 开始界面触发加载
    this.load.on('progress', (value: number) => {
      const pct = Math.round(value * 100);
      try { (window as unknown as { updateLoadProgress?: (pct: number, label: string) => void }).updateLoadProgress?.(pct, `正在加载资源 ${pct}%`); } catch { /* noop */ }
    });
    this.load.on('complete', () => this.settle());
    this.load.on('loaderror', (file: unknown) => {
      console.warn('[BootScene] 资源加载失败，跳过:', (file as { key?: string }).key);
    });
    // 加载泵兜底：window 定时器不受 RAF 节流影响
    const pump = window.setInterval(() => {
      try { (this.load as unknown as { update?: () => void }).update?.(); } catch { /* noop */ }
    }, 300);
    window.setTimeout(() => {
      window.clearInterval(pump);
      this.settle(true);
    }, LOAD_TIMEOUT_SEC * 1000);
    loadGameAssets(this);
  }

  /** 统一收口：complete 与超时都走这里，保证 finishLoad 只调一次。 */
  private settle(timedOut = false): void {
    if (this.settled) return;
    this.settled = true;
    if (timedOut) {
      try {
        (this.load as unknown as { loadComplete?: () => void }).loadComplete?.();
        console.warn('[BootScene] 资源加载超时，已跳过未完成项进入游戏');
      } catch { /* noop */ }
    }
    try { (window as unknown as { finishLoad?: () => void }).finishLoad?.(); } catch { /* noop */ }
  }

  public create(): void {
    const g = this.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(1, 1, 1);
    g.generateTexture('fog-p', 2, 2);
    g.destroy();
    // 等 overlay 淡出后再切场景
    this.time.delayedCall(800, () => {
      void loadProfileFromStorage().finally(() => {
        this.scene.start('LobbyScene');
      });
    });
  }
}
