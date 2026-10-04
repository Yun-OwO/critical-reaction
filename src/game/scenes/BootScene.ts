import Phaser from 'phaser';
import { loadGameAssets } from '../utils/AssetLoader';
import { loadProfileFromStorage } from '../state/ProfileState';

export class BootScene extends Phaser.Scene {
  public constructor() {
    super('BootScene');
  }

  public preload(): void {
    // 等待 HTML 开始界面触发加载
    this.load.on('progress', (value: number) => {
      const pct = Math.round(value * 100);
      try { (window as any).updateLoadProgress?.(pct, `正在加载资源 ${pct}%`); } catch { /* noop */ }
    });
    this.load.on('complete', () => {
      try { (window as any).finishLoad?.(); } catch { /* noop */ }
    });
    loadGameAssets(this);
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
