import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { LabScene } from './game/scenes/LabScene';
import { LobbyScene } from './game/scenes/LobbyScene';
import { UIScene } from './game/scenes/UIScene';
import { mountMenuUi } from './ui/Menu';
import { flushHaptic } from './game/utils/haptic';
import { getSettings, getResolutionForAspectRatio } from './game/state/SettingsState';

const settings = getSettings();
const resolution = getResolutionForAspectRatio(settings.aspectRatio);

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: resolution.width,
  height: resolution.height,
  backgroundColor: '#0A0E1A',
  input: {
    activePointers: 4
  },
  fps: {
    target: 60,
    forceSetTimeOut: false
  },
  render: {
    antialias: true,
    pixelArt: false,
    // 像素取整：消除高速移动时的亚像素抖动残影，HUD/文本渲染也更锐利
    roundPixels: true,
    powerPreference: 'high-performance',
    transparent: false
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
      // 物理固定步 120fps：渲染帧与物理步错位时的微抖被细分（高刷屏更明显），轨迹仍确定性
      fps: 120
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: resolution.width,
    height: resolution.height
  },
  scene: [BootScene, LabScene, LobbyScene, GameScene, UIScene]
};

// 等待开始界面点击后再创建游戏（触发 preload）
function initGame(): void {
  // 内部分辨率在此刻按当前视口重算：开始菜单里可能已切全屏，
  // 模块加载时算的比例是全屏前的旧窗口尺寸，直接沿用会得到错误比例
  const current = getResolutionForAspectRatio(getSettings().aspectRatio);
  gameConfig.width = current.width;
  gameConfig.height = current.height;
  if (gameConfig.scale) {
    gameConfig.scale.width = current.width;
    gameConfig.scale.height = current.height;
  }
  const game = new Phaser.Game(gameConfig);
  mountMenuUi(game);
  if (import.meta.env.DEV) {
    // 仅开发环境：暴露实例供调试/自动化测试手动推进游戏循环
    (window as unknown as { __game: Phaser.Game }).__game = game;
  }
}

// 监听开始界面的 preload 触发
window.addEventListener('start-preload', () => { initGame(); }, { once: true });

// 解锁移动端震动：Android Chrome 要求用户手势激活 navigator.vibrate。
// down/keydown 时预热（15ms 为 Android 最短有效震动）并补发暂存震动；
// move 时仅补发暂存震动（攻击连发/摇杆拖动时震动可能被浏览器忽略，需在手势内补发）
const onDown = (): void => {
  try { navigator.vibrate?.(15); } catch { /* noop */ }
  flushHaptic();
};
const onMove = (): void => { flushHaptic(); };
window.addEventListener('pointerdown', onDown);
window.addEventListener('touchstart', onDown);
window.addEventListener('keydown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('touchmove', onMove);
