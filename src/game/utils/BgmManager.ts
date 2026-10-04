/**
 * BGM 随机播放（参考 Chemic adven.js playRandomBgm）：随机选曲避免与上首重复，播完后自动随机下一首。
 *
 * 全游戏共享一份播放状态（模块级单例）：大厅与战斗共用同一池曲目，
 * 场景切换时继续播放而不会叠加/重启；音量跟随设置中的主音量。
 */
import Phaser from 'phaser';
import { getSettings } from '../state/SettingsState';

const BGM_KEYS = ['bgm-0', 'bgm-1', 'bgm-2', 'bgm-3', 'bgm-4'];
const BGM_VOLUME = 0.22;

let currentSound: Phaser.Sound.BaseSound | null = null;
let running = false;
let lastIndex = -1;

export class BgmManager {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 启动 BGM：若已在播则跳过（跨场景续播）。 */
  public start(): void {
    if (running) return;
    running = true;
    this.playRandom();
  }

  public stop(): void {
    running = false;
    if (currentSound) {
      currentSound.stop();
      currentSound = null;
    }
  }

  private playRandom(): void {
    if (!running) return;
    // 避免与上首重复
    let idx = Phaser.Math.Between(0, BGM_KEYS.length - 1);
    if (idx === lastIndex) {
      idx = (idx + 1) % BGM_KEYS.length;
    }
    lastIndex = idx;
    if (currentSound) currentSound.stop();
    try {
      const volume = BGM_VOLUME * (getSettings().volume / 100);
      currentSound = this.scene.sound.add(BGM_KEYS[idx], { volume });
      currentSound.once('complete', () => this.playRandom());
      currentSound.play();
    } catch { /* audio 未解锁时静默 */ }
  }
}
