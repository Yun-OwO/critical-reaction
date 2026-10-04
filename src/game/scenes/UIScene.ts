import Phaser from 'phaser';
import { on } from '../events/EventBus';
import { gameState } from '../state/GameState';
import { mobileInput } from '../input/mobileInput';
import { haptic } from '../utils/haptic';
import { getWeapon } from '../data/weapons';
import { ROOM_THEMES, getLayerName } from '../data/rooms';
import type { RoomDef } from '../data/rooms';
import { getDye } from '../data/dyes';
import { ElectronCoreWidget } from '../ui/electronCoreWidget';
import { BASE_COLORS, STATE_COLORS, hexString } from '../visual/palette';
import { describeElectronState } from '../combat/electronState';
import { BALANCE } from '../data/balance';
import { describeLoad } from '../combat/load';
import {
  computeGeometryScale,
  computeTouchControlLayout,
  computeUiScale,
  currentViewportMetrics,
  hudRightEdge,
  isTouchDevice,
  readSafeAreaInsets,
  type TouchControlLayout
} from '../ui/uiScale';

let persistentTouchEnabled = false;

/** 仅在文本变化时才 setText（Phaser Text.setText 会无条件重光栅化画布，每帧调用是严重 CPU 浪费）。 */
function setTextSafe(text: Phaser.GameObjects.Text, value: string): void {
  if (text.text !== value) text.setText(value);
}

function setColorSafe(text: Phaser.GameObjects.Text, value: string): void {
  if (text.style.color !== value) text.setColor(value);
}

/** UIScene 访问 GameScene 运行时数据的最小接口（避免循环依赖）。 */
interface GameSceneRef {
  enemies: { view: { visible: boolean; x: number; y: number } }[];
  boss: { view: { visible: boolean; x: number; y: number }; phase: number; config: { name: string; color: number } } | null;
  roomDoors: { x: number; y: number; target: RoomDef }[];
  scene: Phaser.Scenes.ScenePlugin;
}

/** 温度状态分段（设计文档 §6.1 温度标度，色值取自 STATE_COLORS）。 */
const TEMP_STATES = [
  { max: 20, label: '低温', color: hexString(STATE_COLORS.tempCold) },
  { max: 60, label: '稳定', color: hexString(STATE_COLORS.tempStable) },
  { max: 80, label: '过热', color: hexString(STATE_COLORS.tempOverheat) },
  { max: 95, label: '临界', color: hexString(STATE_COLORS.tempCritical) },
  { max: 101, label: '熔毁', color: hexString(STATE_COLORS.tempMeltdown) }
];

export class UIScene extends Phaser.Scene {
  private freeElectronText!: Phaser.GameObjects.Text;
  private dyeText!: Phaser.GameObjects.Text;
  private dashText!: Phaser.GameObjects.Text;
  private eventText!: Phaser.GameObjects.Text;
  private electronDeltaText!: Phaser.GameObjects.Text;
  private bossNameText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private roomText!: Phaser.GameObjects.Text;
  private boonText!: Phaser.GameObjects.Text;
  private tempLabel!: Phaser.GameObjects.Text;
  private tempStateLabel!: Phaser.GameObjects.Text;
  // ---- EHP 血条 ----
  private ehpBarFill!: Phaser.GameObjects.Rectangle;
  private shieldBarFill!: Phaser.GameObjects.Rectangle;
  /** 电子轨道生命核心（§14.3）：价电子轨道 + 原子核 + 护盾弧 + 自由电子卫星。 */
  private electronCore!: ElectronCoreWidget;
  private ehpLabel!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;
  /** 电子态（§2.1）：与攻击模式无关，由价电子亏损/自由电子持有量推导。 */
  private electronStateText!: Phaser.GameObjects.Text;
  /** 染料槽图形化（§14.5）：主/副/底 三个色块 + 纯度。 */
  private dyeChips: { bg: Phaser.GameObjects.Rectangle; swatch: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; purity: Phaser.GameObjects.Text }[] = [];
  // ---- 温度计 ----
  private tempFill!: Phaser.GameObjects.Rectangle;
  private tempTicks!: Phaser.GameObjects.Graphics;
  // ---- Boss 血条 ----
  private bossBarBg!: Phaser.GameObjects.Rectangle;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private bossPhasePips: Phaser.GameObjects.Arc[] = [];
  // ---- 全屏层 ----
  private vignette!: Phaser.GameObjects.Image;
  private dangerVignette!: Phaser.GameObjects.Image;
  private indicatorGfx!: Phaser.GameObjects.Graphics;
  private touchControls: Phaser.GameObjects.GameObject[] = [];
  private unlisten: Array<() => void> = [];
  private joystickBase!: Phaser.GameObjects.Arc;
  private joystickThumb!: Phaser.GameObjects.Arc;
  private joystickPointerId = -1;
  private attackPointerId = -1;
  private isMobile = false;
  /** 触摸控件布局：HUD 避让与控件摆放共用同一份数据，保证两者不会互相遮挡。 */
  private controlLayout: TouchControlLayout | null = null;
  /** 攻击按钮（特殊攻击蓄力/触发反馈用）。 */
  private attackBtnCircle!: Phaser.GameObjects.Arc;
  private attackBtnText!: Phaser.GameObjects.Text;
  /** HUD 布局缓存。 */
  private ehpBarW = 340;
  /** UI 几何缩放因子：1920 宽设计稿基准。内部分辨率随设备缩小时等比缩放，
   *  保证控件在屏幕上的实际大小与贴边位置恒定（移动端画布更小，不缩放会显示过大且错位）。 */
  private s = 1;
  /** 动作控件专用缩放：只按设计稿等比，不含移动端可读性补偿，保持控件原有尺寸手感。 */
  private touchScale = 1;
  /** create 时的内部分辨率：resize 事件用它判断比例是否真的变了（FIT 窗口缩放不改变内部分辨率） */
  private createdW = 0;
  private createdH = 0;
  /** 防止 resize 风暴中重复排队重启 */
  private relayoutQueued = false;

  public constructor() {
    super('UIScene');
  }

  public create(): void {
    // UIScene 会被 LobbyScene 与 GameScene 各 launch 一次，同一实例的 create 会重复执行，
    // 而这些数组/指针字段不会随 shutdown 复位。若不显式清空，会累积上一轮已销毁的显示对象，
    // 之后 refreshDyeChips 等对其调用 setText 会因 canvas 已释放抛异常（drawImage of null），
    // 该异常会让 Phaser 主循环的下一帧不再排队，表现为整局画面永久冻结。
    this.dyeChips = [];
    this.touchControls = [];
    this.bossPhasePips = [];
    this.bossMaxElectrons = 0;
    this.unlisten = [];
    this.joystickPointerId = -1;
    this.attackPointerId = -1;
    this.isMobile = isTouchDevice();
    const W = this.scale.width;
    const H = this.scale.height;
    // 移动端屏幕小、PPI 高：等比缩放后文字会小到不可读，需按实际 CSS 像素密度补偿放大
    const metrics = currentViewportMetrics(W, H, this.isMobile);
    const s = this.s = computeUiScale(metrics);
    // 动作控件不参与可读性补偿：放大后会挤占战场并破坏原有操作手感
    this.touchScale = computeGeometryScale(metrics);
    // 控件布局先于 HUD 计算：HUD 的右下元素需要知道按钮组占据到哪里才能避让
    this.controlLayout = computeTouchControlLayout(metrics, this.touchScale, readSafeAreaInsets());
    this.createdW = this.scale.width;
    this.createdH = this.scale.height;
    this.relayoutQueued = false;
    // 内部分辨率变化（全屏切换重算比例）时重建全部 HUD/控件，让布局按新比例生效
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onGameResize, this);

    // ---- 全屏渐晕（静态暗角 + 动态危险红晕）：预烘焙成贴图，避免每帧重画描边环 ----
    this.vignette = this.buildVignette('ui-vignette', 0x020810, 0.016, 7).setDepth(1);
    this.dangerVignette = this.buildVignette('ui-danger-vignette', 0xff2040, 0.05, 6).setDepth(2);
    this.dangerVignette.setAlpha(0);

    // ---- 屏幕外单位指示器 ----
    this.indicatorGfx = this.add.graphics().setDepth(3);

    // ---- 左下：EHP 血条 + 价电子 + 自由电子 ----
    this.ehpBarW = (this.isMobile ? 260 : 340) * s;
    const barX = 40 * s;
    const coreR = (this.isMobile ? 26 : 32) * s;
    // 触屏端摇杆占左下角：状态栏顶部（核心中心上方 48+22）须落在摇杆底沿下方 8px。
    // 上限钳制保证血条底缘不出屏——极端矮屏宁可贴近摇杆也不能被裁剪。
    const barY = this.isMobile && this.controlLayout
      ? Math.min(
          H - 23 * s,
          Math.max(H - 66 * s, this.controlLayout.joyY + this.controlLayout.baseR + coreR + 78 * s)
        )
      : H - 66 * s;
    this.add.rectangle(barX - 3 * s, barY - 3 * s, this.ehpBarW + 6 * s, 26 * s, BASE_COLORS.panel, 0.72)
      .setStrokeStyle(1.5, BASE_COLORS.panelEdge, 0.9).setDepth(9).setOrigin(0, 0);
    this.add.rectangle(barX, barY, this.ehpBarW, 20 * s, 0x0b1e2d, 0.9)
      .setOrigin(0, 0).setDepth(10);
    this.ehpBarFill = this.add.rectangle(barX + 1, barY + 1, this.ehpBarW - 2, 18 * s, STATE_COLORS.tempCold, 1)
      .setOrigin(0, 0).setDepth(11);
    this.shieldBarFill = this.add.rectangle(barX + 1, barY - 6 * s, this.ehpBarW - 2, 5 * s, STATE_COLORS.shield, 0.95)
      .setOrigin(0, 0).setDepth(11);

    // ---- 电子轨道生命核心（§14.3）：置于血条左上方，成为左下角的视觉锚点 ----
    const coreX = barX + coreR + 4 * s;
    const coreY = barY - coreR - 22 * s;
    this.electronCore = new ElectronCoreWidget(this, coreX, coreY, coreR);

    // 核心右侧的数值块：四行整体落在核心中心附近（行距 16，中心上方 31 到下方 17），
    // 避免向上顶进摇杆、向下压住血条
    const infoX = coreX + coreR + 16 * s;
    this.freeElectronText = this.add.text(infoX, coreY - 31 * s, '', {
      color: '#FFFFFF', fontFamily: 'monospace', fontSize: `${Math.round(15 * s)}px`
    }).setDepth(12);
    this.ehpLabel = this.add.text(infoX, coreY - 15 * s, '', {
      color: '#9FD8E8', fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`
    }).setDepth(12);
    this.modeLabel = this.add.text(infoX, coreY + 1 * s, '', {
      color: '#FFD199', fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`
    }).setDepth(12);
    // §2.1 氧化态/还原态修正（与"攻击模式"是两个不同概念，必须分开显示避免歧义）
    this.electronStateText = this.add.text(infoX, coreY + 17 * s, '', {
      color: hexString(BASE_COLORS.textDim), fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`
    }).setDepth(12);

    this.dashText = this.add.text(barX, barY + 34 * s, '', {
      color: '#9FD8E8', fontFamily: 'monospace', fontSize: `${Math.round(13 * s)}px`
    }).setDepth(12);

    // ---- 右下：染料槽图形化（§14.5）+ 样本 / 模式 ----
    // 移动端按钮组占据右下角，这里整体右对齐到按钮组左侧，避免被按钮压住
    const hudRight = this.hudRightEdge(W, s);
    const chipY = H - 62 * s;
    const chipW = 52 * s;
    const chipGap = 6 * s;
    const chipRight = hudRight;
    for (let i = 0; i < 3; i += 1) {
      const x = chipRight - chipW - i * (chipW + chipGap);
      const bg = this.add.rectangle(x + chipW / 2, chipY, chipW, 34 * s, 0x0b1e2d, 0.85)
        .setStrokeStyle(1.2, BASE_COLORS.panelEdge, 0.9).setDepth(11);
      const swatch = this.add.rectangle(x + 7 * s, chipY, 10 * s, 26 * s, BASE_COLORS.panel, 1)
        .setOrigin(0, 0.5).setDepth(12);
      const label = this.add.text(x + 22 * s, chipY - 7 * s, '', {
        color: hexString(BASE_COLORS.text), fontFamily: 'monospace', fontSize: `${Math.round(11 * s)}px`
      }).setDepth(12);
      const purity = this.add.text(x + 22 * s, chipY + 7 * s, '', {
        color: hexString(BASE_COLORS.textDim), fontFamily: 'monospace', fontSize: `${Math.round(9 * s)}px`
      }).setDepth(12);
      this.dyeChips.push({ bg, swatch, label, purity });
    }
    // 槽位标签（主/副/底）固定在色块上方
    const slotTitles = ['主', '副', '底'];
    this.dyeChips.forEach((chip, i) => {
      this.add.text(chip.bg.x, chipY - 26 * s, slotTitles[i], {
        color: '#9FD8E8', fontFamily: 'monospace', fontSize: `${Math.round(10 * s)}px`
      }).setOrigin(0.5).setDepth(12);
    });

    this.dyeText = this.add.text(hudRight, H - 22 * s, '', {
      color: '#FFFFFF', fontFamily: 'monospace', fontSize: `${Math.round(14 * s)}px`
    }).setOrigin(1, 1).setDepth(12);

    // ---- 右侧：温度计（设计文档 §14.4）----
    const thermoX = W - 44 * s;
    const thermoTop = 140 * s;
    // 触屏端温度计必须停在按钮组（E/☰）之上（thermoBottomMax 已含下方温度态文字的空间）；
    // 极矮屏上可缩到 64，仍优先保证不与按钮重叠
    const thermoNatural = Math.min(320 * s, H * 0.42);
    const thermoBottomLimit = this.isMobile && this.controlLayout
      ? Math.min(thermoTop + thermoNatural, this.controlLayout.thermoBottomMax)
      : thermoTop + thermoNatural;
    const thermoH = Phaser.Math.Clamp(thermoBottomLimit - thermoTop, 64 * s, thermoNatural);
    const thermoBottom = thermoTop + thermoH;
    this.add.rectangle(thermoX - 2 * s, thermoTop - 2 * s, 22 * s, thermoH + 4 * s, 0x06131e, 0.72)
      .setStrokeStyle(1.5, 0x2a6080, 0.9).setDepth(9).setOrigin(0, 0);
    this.add.rectangle(thermoX, thermoTop, 18 * s, thermoH, 0x0b1e2d, 0.9)
      .setOrigin(0, 0).setDepth(10);
    this.tempFill = this.add.rectangle(thermoX + 2 * s, thermoBottom - 2 * s, 14 * s, thermoH - 4 * s, 0x5CFFB1, 1)
      .setOrigin(0, 1).setDepth(11);
    this.tempTicks = this.add.graphics().setDepth(12);
    for (const t of [40, 60, 80, 95]) {
      const ty = thermoBottom - (thermoH - 4 * s) * (t / 100);
      const major = t === 80 || t === 95;
      this.tempTicks.lineStyle(major ? 2 : 1, major ? 0xff4d6d : 0x67e8f9, major ? 0.9 : 0.4);
      this.tempTicks.beginPath();
      this.tempTicks.moveTo(thermoX - (major ? 8 : 4) * s, ty);
      this.tempTicks.lineTo(thermoX + 18 * s + (major ? 8 : 4) * s, ty);
      this.tempTicks.strokePath();
    }
    this.tempLabel = this.add.text(thermoX + 9 * s, thermoTop - 26 * s, '', {
      color: '#67E8F9', fontFamily: 'monospace', fontSize: `${Math.round(14 * s)}px`
    }).setOrigin(0.5).setDepth(12);
    this.tempStateLabel = this.add.text(thermoX + 9 * s, thermoBottom + 8 * s, '', {
      color: '#5CFFB1', fontFamily: 'monospace', fontSize: `${Math.round(12 * s)}px`
    }).setOrigin(0.5).setDepth(12);

    // ---- 顶部：房间名 ----
    this.roomText = this.add.text(W / 2, 24 * s, '', {
      color: '#D4E8EE', fontFamily: 'monospace', fontSize: `${Math.round(20 * s)}px`, fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(12);

    // ---- 顶部：Boss 血条 ----
    const bossBarW = Math.min(620 * s, W - 320 * s);
    this.bossNameText = this.add.text(W / 2, 56 * s, '', {
      color: '#E0AAFF', fontFamily: 'monospace', fontSize: `${Math.round(16 * s)}px`, fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(12).setVisible(false);
    this.bossBarBg = this.add.rectangle(W / 2, 82 * s, bossBarW, 14 * s, 0x06131e, 0.8)
      .setStrokeStyle(1.5, 0x9d4edd, 0.95).setDepth(11).setOrigin(0.5, 0).setVisible(false);
    this.bossBarFill = this.add.rectangle(W / 2 - bossBarW / 2 + 2, 82 * s + 2, bossBarW - 4, 10 * s, 0x9d4edd, 1)
      .setOrigin(0, 0).setDepth(12).setVisible(false);
    for (let i = 0; i < 3; i += 1) {
      const pip = this.add.circle(W / 2 - 24 * s + i * 24 * s, 104 * s, 5 * s, 0x9d4edd, 0.25)
        .setStrokeStyle(1.5, 0xe0aaff, 0.9).setDepth(12).setVisible(false);
      this.bossPhasePips.push(pip);
    }

    this.eventText = this.add.text(W / 2, 140 * s, '', {
      color: '#FDE047', fontFamily: 'monospace', fontSize: `${Math.round(22 * s)}px`
    }).setOrigin(0.5).setAlpha(0).setDepth(12);
    this.electronDeltaText = this.add.text(barX + this.ehpBarW + 40 * s, barY + 10 * s, '', {
      color: '#67E8F9', fontFamily: 'monospace', fontSize: `${Math.round(20 * s)}px`, fontStyle: 'bold'
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(12);
    this.weaponText = this.add.text(W / 2, H - 34 * s, '', {
      color: '#A0A0A0', fontFamily: 'monospace', fontSize: `${Math.round(14 * s)}px`
    }).setOrigin(0.5, 1).setAlpha(0).setDepth(12);
    this.boonText = this.add.text(barX, barY - 130 * s, '', {
      color: '#a78bfa', fontFamily: 'monospace', fontSize: `${Math.round(13 * s)}px`, lineSpacing: 4
    }).setDepth(12).setAlpha(0);

    this.unlisten = [
      on('reaction', (payload) => { const p = payload as { type?: string }; haptic(20); this.showEvent(p?.type === 'runaway' ? '⚠ 临界失控 · 反应取消' : '反应触发 · 温度上升'); }),
      on('extraction', (payload) => {
        haptic(25);
        const result = payload as { success?: boolean };
        this.showEvent(result.success ? '撤离成功 · 样本已保存' : '撤离稳定化开始');
      }),
      on('boss', (payload) => {
        const data = payload as { type: string; name?: string; bossId?: string; phase?: number };
        if (data.type === 'spawn') {
          haptic(50);
          this.showEvent(`${data.name ?? 'Boss'} 出现！`);
        } else if (data.type === 'phase') {
          haptic(30);
          const phaseNames: Record<string, string> = {
            titration: '中和态 · 全屏爆炸',
            electrolysis: '短路 · 全屏麻痹',
            chain: '链式爆炸 · 分裂加速',
            oxidation: '高温熔毁 · 温度飙升'
          };
          this.showEvent(`${data.name ?? 'Boss'} 进入阶段${data.phase ?? 2} · ${phaseNames[data.bossId ?? ''] ?? '强化'}`);
        } else if (data.type === 'defeat') {
          haptic(60);
          this.showEvent('Boss 已击败 · 样本 +5');
        }
      }),
      on('dye', (payload) => {
        const data = payload as { name: string };
        this.showEvent(`染色生效：${data.name}`);
      }),
      on('electron', (payload) => {
        const data = payload as { delta: number; color: string };
        this.showElectronDelta(data.delta, data.color);
      }),
      on('room', () => {
        this.showEvent('房间清空 · 出口已解锁');
      }),
      on('treasure', (payload) => {
        const data = payload as { kind: string; amount: number };
        const label = data.kind === 'samples' ? `样本 +${data.amount}` : data.kind === 'freeElectron' ? `自由电子 +${data.amount}` : `降温 ${data.amount}°`;
        this.showEvent(`奖励：${label}`);
      }),
      on('special', (payload) => {
        const data = payload as { phase: string };
        this.onSpecialButtonFeedback(data.phase);
      })
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unlisten.forEach((off) => off());
      this.unlisten = [];
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onGameResize, this);
    });
    this.buildTouchControls();
    this.setTouchControlsVisible(persistentTouchEnabled);
    this.refreshElectronCore(0);
    this.refresh();
  }

  /** 内部分辨率变化（全屏切换后重算比例）：重建场景让 uiScale/控件布局按新比例生效。
   *  FIT 模式下普通窗口缩放不改变内部分辨率，不会走到重启。 */
  private onGameResize(gameSize: Phaser.Structs.Size): void {
    if (gameSize.width === this.createdW && gameSize.height === this.createdH) return;
    if (this.relayoutQueued) return;
    this.relayoutQueued = true;
    // 延迟一帧再重启：等 Phaser 结束本轮 resize 广播，避免在事件回调中同步销毁显示对象
    this.time.delayedCall(0, () => this.scene.restart());
  }

  /** 绘制同心描边环渐晕并烘焙为半分辨率贴图（缩放 2× 显示，天然柔化边缘，单四边形渲染）。 */
  private buildVignette(key: string, color: number, baseAlpha: number, rings: number): Phaser.GameObjects.Image {
    const W = this.scale.width;
    const H = this.scale.height;
    // 画布尺寸尚未就绪时（偶发的 0 高度）不烘焙纹理：generateTexture 会抛 IndexSizeError，
    // 而 Phaser 主循环一旦从这里抛异常就不会再排下一帧，整局画面会永久冻结。
    const texW = Math.ceil(W / 2);
    const texH = Math.ceil(H / 2);
    if (texW <= 0 || texH <= 0) return this.add.image(0, 0, '__DEFAULT').setVisible(false);
    if (this.textures.exists(key)) this.textures.remove(key);
    const gfx = this.add.graphics();
    const radius = Math.hypot(W, H) / 4; // 半分辨率坐标系
    const cx = W / 4;
    const cy = H / 4;
    for (let i = 0; i < rings; i += 1) {
      const t = i / (rings - 1);
      gfx.lineStyle(18, color, baseAlpha + t * baseAlpha * 2.2);
      gfx.strokeCircle(cx, cy, radius - i * 17 - 10);
    }
    gfx.generateTexture(key, texW, texH);
    gfx.destroy();
    return this.add.image(W / 2, H / 2, key).setScale(2, 2);
  }

  public update(_time: number, delta: number): void {
    // 轨道自转用真实时间推进（秒），与帧率解耦
    this.refreshElectronCore(Math.min(delta, 50) / 1000);
    this.refresh();
    this.refreshBossBar();
    this.refreshDangerVignette();
    this.drawOffscreenIndicators();
  }

  /** 电子轨道生命核心：把「电子即生命」渲染成可一眼读出缺失的轨道图。 */
  private refreshElectronCore(dt: number): void {
    // 原子核与轨道使用当前主槽染料色 / 模式色，保证染色变化立刻可见
    const mainDye = gameState.dyeSlots[0].dyeId ? getDye(gameState.dyeSlots[0].dyeId) : undefined;
    const coreColor = mainDye ? parseInt(mainDye.color.replace('#', ''), 16) : gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
    const ringColor = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
    this.electronCore.refresh({
      valence: gameState.valence,
      maxValence: gameState.maxValence,
      shieldHp: gameState.shieldHp,
      freeElectrons: gameState.freeElectrons,
      coreColor,
      ringColor,
      // 过载判定（与 GameScene 一致）：温度超过第二阈值
      overload: gameState.temperature >= BALANCE.overload.tempThreshold
    }, dt);
  }

  private refresh(): void {
    const ehpRatio = gameState.ehpMax > 0 ? Phaser.Math.Clamp(gameState.ehp / gameState.ehpMax, 0, 1) : 1;
    // EHP 血条：颜色随比例 青→黄→红（仅在值变化时更新，避免每帧触发渲染状态变更）
    const ehpColor = ehpRatio > 0.55 ? STATE_COLORS.tempCold : ehpRatio > 0.28 ? STATE_COLORS.tempOverheat : STATE_COLORS.tempMeltdown;
    const ehpW = Math.max(0, (this.ehpBarW - 2) * ehpRatio);
    if (this.ehpBarFill.width !== ehpW) this.ehpBarFill.width = ehpW;
    if (this.ehpBarFill.fillColor !== ehpColor) this.ehpBarFill.fillColor = ehpColor;
    this.shieldBarFill.visible = gameState.shieldHp > 0;
    if (gameState.shieldHp > 0) {
      const shieldW = Math.max(4, (this.ehpBarW - 2) * Math.min(1, gameState.shieldHp / 200));
      if (this.shieldBarFill.width !== shieldW) this.shieldBarFill.width = shieldW;
    }
    setTextSafe(this.freeElectronText, `自由电子 ${gameState.freeElectrons}/${gameState.maxFreeElectrons}`);
    setTextSafe(this.ehpLabel, `电子HP ${Math.max(0, Math.ceil(gameState.ehp))}/${gameState.ehpMax}${gameState.shieldHp > 0 ? `   护盾 ${Math.ceil(gameState.shieldHp)}` : ''}`);
    setTextSafe(this.modeLabel, gameState.mode === 'oxidized' ? '攻击模式：氧化夺取' : '攻击模式：还原充能');
    // §2.1 电子态：把真实生效的修正直接写出来，避免玩家只能靠猜
    const es = describeElectronState(
      gameState.valence,
      gameState.maxValence,
      gameState.freeElectrons,
      gameState.maxFreeElectrons,
      gameState.temperature >= BALANCE.overload.tempThreshold
    );
    const parts: string[] = [];
    if (es.damageMult > 1) parts.push(`伤害 ×${es.damageMult.toFixed(2)}`);
    if (es.moveSpeedBonus > 0) parts.push(`移速 +${es.moveSpeedBonus}%`);
    if (es.cdReduction > 0) parts.push(`冷却 -${es.cdReduction}%`);
    if (es.shieldBonusPct > 0) parts.push(`护盾上限 +${es.shieldBonusPct}%`);
    if (es.overloaded) parts.push(`过载 ${BALANCE.overload.selfDamagePerSec}/s（温度超限 · 还原态降温解除）`);
    setTextSafe(this.electronStateText, parts.length > 0 ? `电子态：${es.label} · ${parts.join(' · ')}` : `电子态：${es.label}`);
    setColorSafe(this.electronStateText, es.overloaded ? '#FF8A4C' : es.overOxidized ? '#FF4D6D' : es.lost > 0 ? '#FFD199' : hexString(BASE_COLORS.textDim));

    // 温度计
    const tempRatio = Phaser.Math.Clamp(gameState.temperature / 100, 0, 1);
    const roundedRatio = Math.round(tempRatio * 200) / 200;
    if (this.tempFill.scaleY !== roundedRatio) this.tempFill.scaleY = Math.max(0.001, roundedRatio);
    const tempState = TEMP_STATES.find((s) => gameState.temperature < s.max) ?? TEMP_STATES[TEMP_STATES.length - 1];
    const fillColor = gameState.temperature >= 95 ? STATE_COLORS.tempMeltdown : gameState.temperature >= 80 ? STATE_COLORS.tempCritical : gameState.temperature >= 60 ? STATE_COLORS.tempOverheat : gameState.temperature >= 20 ? STATE_COLORS.tempStable : STATE_COLORS.tempCold;
    if (this.tempFill.fillColor !== fillColor) this.tempFill.fillColor = fillColor;
    setTextSafe(this.tempLabel, `${Math.round(gameState.temperature)}°`);
    setColorSafe(this.tempLabel, tempState.color);
    setTextSafe(this.tempStateLabel, tempState.label);
    setColorSafe(this.tempStateLabel, tempState.color);
    if (gameState.temperature >= 80) {
      this.tempStateLabel.setAlpha(0.6 + 0.4 * Math.sin(this.time.now * 0.012));
    } else if (this.tempStateLabel.alpha !== 1) {
      this.tempStateLabel.setAlpha(1);
    }

    // §4.3 负载：携带样本 / 背包容量，直接决定移速与冲刺冷却
    const load = describeLoad(gameState.samples, gameState.bagCapacity);
    const loadWarn = load.band.speedMult < 1 ? ` · 移速 ${Math.round(load.band.speedMult * 100)}%` : '';
    // 搜打撤：局内战利品数量（撤离成功才带得出去，死亡丢失）
    const lootNote = gameState.carriedGear.length > 0 ? ` · 战利品 ${gameState.carriedGear.length}` : '';
    setTextSafe(this.dyeText, `样本 ${gameState.samples}/${gameState.bagCapacity} · 负载 ${load.percent}% ${load.band.label}${loadWarn}${lootNote}${gameState.reactionLayers > 0 ? ` · 催化 L${gameState.reactionLayers}` : ''}   [R] 切换氧化/还原`);
    setColorSafe(this.dyeText, load.band.speedMult < 0.75 ? '#FF8A4C' : load.band.speedMult < 1 ? '#FFD199' : hexString(BASE_COLORS.text));
    this.refreshDyeChips();
    setTextSafe(this.dashText, gameState.dashCd > 0 ? `冲刺冷却 ${gameState.dashCd.toFixed(1)}s` : this.isMobile ? '冲刺就绪' : '冲刺就绪 [鼠标右键]');
    const theme = ROOM_THEMES[gameState.currentRoomType];
    const layerStr = gameState.currentRoomType === 'finalBoss' ? '最终决战' : getLayerName(gameState.layer);
    setTextSafe(this.roomText, `${layerStr} · ${theme.banner}`);
    setColorSafe(this.roomText, `#${theme.boundary.toString(16).padStart(6, '0')}`);

    // 已装备祝福
    if (gameState.equippedBoons.length > 0) {
      const lines = gameState.equippedBoons.map((b) => {
        const slotLabel = { attack: 'ATK', special: 'SP', dash: 'DSH', passive: 'PSV' }[b.slot] ?? b.slot;
        const lv = b.level > 0 ? ` Lv.${b.level + 1}` : '';
        return `${b.icon} ${slotLabel} ${b.name}${lv}`;
      });
      const joined = lines.join('\n');
      if (this.boonText.text !== joined) this.boonText.setText(joined);
      this.boonText.setAlpha(0.8);
    } else if (this.boonText.alpha !== 0) {
      this.boonText.setText('').setAlpha(0);
    }
  }

  /**
   * 染料槽图形化（§14.5）：主 100% / 副 50% / 底 25%。
   * 有色块、槽位名、染料名与纯度百分比 —— 纯度即该槽效果的实际权重。
   */
  private refreshDyeChips(): void {
    gameState.dyeSlots.forEach((slot, i) => {
      const chip = this.dyeChips[i];
      if (!chip) return;
      const dye = slot.dyeId ? getDye(slot.dyeId) : undefined;
      if (dye) {
        const hex = parseInt(dye.color.replace('#', ''), 16);
        chip.swatch.setFillStyle(hex, 1);
        chip.bg.setStrokeStyle(1.2, hex, 0.75);
        setTextSafe(chip.label, dye.name);
        setColorSafe(chip.label, dye.color);
      } else {
        // 空槽：明确显示"未着色"，不依赖颜色传达状态
        chip.swatch.setFillStyle(BASE_COLORS.panel, 1);
        chip.bg.setStrokeStyle(1.2, BASE_COLORS.panelEdge, 0.9);
        setTextSafe(chip.label, '未着色');
        setColorSafe(chip.label, hexString(BASE_COLORS.neutral));
      }
      setTextSafe(chip.purity, `${Math.round((slot.purity ?? 0) * 100)}%`);
    });
  }

  /** Boss 血条与阶段圆点。 */
  private refreshBossBar(): void {
    const gs = this.scene.get('GameScene') as unknown as GameSceneRef | null;
    const boss = gs && gs.scene.isActive() ? gs.boss : null;
    const show = !!boss && boss.view.visible;
    this.bossNameText.setVisible(show);
    this.bossBarBg.setVisible(show);
    this.bossBarFill.setVisible(show);
    this.bossPhasePips.forEach((p) => p.setVisible(show));
    if (!boss || !show) return;
    const total = boss.config ? 1 : 1;
    void total;
    this.bossNameText.setText(boss.config.name);
    const count = gs ? this.countBossElectrons(gs) : 0;
    const maxCount = this.bossMaxElectrons ?? Math.max(1, count);
    if (count > (this.bossMaxElectrons ?? 0)) this.bossMaxElectrons = count;
    const ratio = Phaser.Math.Clamp(count / Math.max(1, maxCount), 0, 1);
    this.bossBarFill.width = Math.max(0, (this.bossBarBg.width - 4) * ratio);
    this.bossPhasePips.forEach((pip, i) => {
      pip.setFillStyle(i < boss.phase ? 0xfde047 : 0x9d4edd, i < boss.phase ? 1 : 0.25);
    });
  }

  private bossMaxElectrons = 0;

  private countBossElectrons(gs: GameSceneRef): number {
    // 通过运行时 Boss 对象读取轨道电子总数（GameScene.bossElectronCount 的等价内联）
    const boss = gs.boss as unknown as { orbits?: { count: number }[] } | null;
    if (!boss?.orbits) return 0;
    return boss.orbits.reduce((sum, o) => sum + o.count, 0);
  }

  /** 低 EHP / 高温危险红晕。 */
  private refreshDangerVignette(): void {
    const ehpRatio = gameState.ehpMax > 0 ? gameState.ehp / gameState.ehpMax : 1;
    const lowHp = ehpRatio < 0.3 ? (0.3 - ehpRatio) / 0.3 : 0;
    const lowHpPulse = lowHp * (0.35 + 0.3 * Math.sin(this.time.now * 0.008));
    const heat = Phaser.Math.Clamp((gameState.temperature - 60) / 40, 0, 1);
    const heatPulse = heat * (0.3 + 0.25 * Math.sin(this.time.now * (gameState.temperature >= 95 ? 0.016 : 0.006)));
    const alpha = Math.max(lowHpPulse, heatPulse);
    this.dangerVignette.setAlpha(alpha);
  }

  /** 屏幕外单位指示：敌人(红三角)/Boss(紫大三角)/出口门(主题色菱形)。 */
  private drawOffscreenIndicators(): void {
    this.indicatorGfx.clear();
    const gs = this.scene.get('GameScene') as unknown as GameSceneRef | null;
    if (!gs || !gs.scene.isActive()) return;
    const cam = (this.scene.get('GameScene') as Phaser.Scene).cameras.main;
    const view = cam.worldView;
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;
    const margin = 44;
    const maxX = W - margin;
    const maxY = H - margin;

    const plot = (wx: number, wy: number, color: number, size: number, diamond: boolean, alpha: number): void => {
      if (view.contains(wx, wy)) return;
      const dx = wx - view.centerX;
      const dy = wy - view.centerY;
      const ang = Math.atan2(dy, dx);
      const cos = Math.abs(Math.cos(ang)) < 1e-4 ? 1e-4 : Math.abs(Math.cos(ang));
      const sin = Math.abs(Math.sin(ang)) < 1e-4 ? 1e-4 : Math.abs(Math.sin(ang));
      const t = Math.min((maxX - cx) / cos, (maxY - cy) / sin);
      const ex = cx + Math.cos(ang) * t;
      const ey = cy + Math.sin(ang) * t;
      this.indicatorGfx.fillStyle(color, alpha);
      if (diamond) {
        this.indicatorGfx.save();
        this.indicatorGfx.translateCanvas(ex, ey);
        this.indicatorGfx.rotateCanvas(ang + Math.PI / 4);
        this.indicatorGfx.fillRect(-size, -size, size * 2, size * 2);
        this.indicatorGfx.restore();
      } else {
        this.indicatorGfx.save();
        this.indicatorGfx.translateCanvas(ex, ey);
        this.indicatorGfx.rotateCanvas(ang);
        this.indicatorGfx.fillTriangle(size * 1.4, 0, -size * 0.8, -size, -size * 0.8, size);
        this.indicatorGfx.restore();
      }
      this.indicatorGfx.lineStyle(1.5, 0xffffff, alpha * 0.5);
      if (diamond) {
        this.indicatorGfx.save();
        this.indicatorGfx.translateCanvas(ex, ey);
        this.indicatorGfx.rotateCanvas(ang + Math.PI / 4);
        this.indicatorGfx.strokeRect(-size, -size, size * 2, size * 2);
        this.indicatorGfx.restore();
      }
    };

    let drawn = 0;
    for (const enemy of gs.enemies) {
      if (drawn >= 14) break;
      if (!enemy.view.visible) continue;
      plot(enemy.view.x, enemy.view.y, 0xff5c7a, 7, false, 0.75);
      drawn += 1;
    }
    if (gs.boss && gs.boss.view.visible) {
      plot(gs.boss.view.x, gs.boss.view.y, 0xc084fc, 12, false, 0.95);
    }
    for (const door of gs.roomDoors) {
      const theme = ROOM_THEMES[door.target.type];
      plot(door.x, door.y, theme.boundary, 8, true, 0.85);
    }
  }

  private showEvent(message: string): void {
    this.eventText.setText(message).setAlpha(1);
    this.tweens.add({ targets: this.eventText, alpha: 0, delay: 900, duration: 500 });
  }

  private showElectronDelta(delta: number, color: string): void {
    this.tweens.killTweensOf(this.electronDeltaText);
    this.electronDeltaText
      .setText(`${delta > 0 ? '+' : ''}${delta} e\u207B`)
      .setColor(color)
      .setAlpha(1)
      .setScale(1.6);
    this.tweens.add({ targets: this.electronDeltaText, scale: 1, duration: 200, ease: 'Cubic.out' });
    this.tweens.add({ targets: this.electronDeltaText, alpha: 0, delay: 650, duration: 450 });
  }

  private flashWeaponName(): void {
    const w = getWeapon(gameState.currentWeapon);
    this.weaponText.setText(`[${w.name}]`);
    this.weaponText.setAlpha(1);
    this.tweens.killTweensOf(this.weaponText);
    this.tweens.add({ targets: this.weaponText, alpha: 0, delay: 800, duration: 400 });
  }

  /** HUD 右下角元素的右边界（设计单位）：移动端让开按钮组，避免相互遮挡。 */
  private hudRightEdge(W: number, s: number): number {
    const layout = this.controlLayout;
    return hudRightEdge(W - 40 * s, layout ? layout.clusterLeft : 0, 12 * s, this.isMobile && !!layout);
  }

  /** 触摸控件布局（只读访问：新手引导需要在对应按钮上画高亮光环）。 */
  public getControlLayout(): TouchControlLayout | null {
    return this.controlLayout;
  }

  private buildTouchControls(): void {
    const layout = this.controlLayout;
    if (!layout) return;
    const { baseR, thumbR, btnSmallR, btnAttackR } = layout;

    const attackBtn = this.addButton(layout.attackX, layout.attackY, btnAttackR, '攻', 0xfde047, (pointerId) => {
      this.attackPointerId = pointerId;
      mobileInput.attackHeld = true;
    });
    // 注意：攻击按钮不注册 pointerout 取消——长按蓄力期间手指轻微移出按钮不应中断充能
    this.attackBtnCircle = attackBtn.circle;
    this.attackBtnText = attackBtn.text;
    this.addButton(layout.dashX, layout.dashY, btnSmallR, '\u00BB', 0x67e8f9, () => {
      mobileInput.dashQueued = true;
    });
    this.addButton(layout.modeX, layout.modeY, btnSmallR, 'R', 0xff8a4c, () => {
      mobileInput.modeQueued = true;
    });
    this.addButton(layout.interactX, layout.interactY, btnSmallR, 'E', 0x5cffb1, () => {
      mobileInput.interactQueued = true;
    });
    this.addButton(layout.weaponX, layout.weaponY, btnSmallR, 'Q', 0xa78bfa, () => {
      mobileInput.weaponSwitchQueued = true;
      this.flashWeaponName();
    });
    this.addButton(layout.statusX, layout.statusY, btnSmallR, '☰', 0x67e8f9, () => {
      // 状态面板（暂停 + 属性/祝福/装备一览）：仅战斗中生效
      const gs = this.scene.get('GameScene') as unknown as { scene: Phaser.Scenes.ScenePlugin; toggleStatusPanel(): void } | undefined;
      if (gs && gs.scene.isActive()) gs.toggleStatusPanel();
    });

    this.joystickBase = this.add.circle(layout.joyX, layout.joyY, baseR, 0x06b6d4, 0.06)
      .setStrokeStyle(3, 0x67e8f9, 0.6)
      .setDepth(20);
    this.joystickThumb = this.add.circle(layout.joyX, layout.joyY, thumbR, 0x67e8f9, 0.22)
      .setStrokeStyle(3, 0xffffff, 0.8)
      .setDepth(21);
    this.touchControls.push(this.joystickBase, this.joystickThumb);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) return;
      if (!persistentTouchEnabled) {
        persistentTouchEnabled = true;
        this.setTouchControlsVisible(true);
      }
      if (pointer.x < layout.joystickZoneRight && this.joystickPointerId === -1) {
        this.joystickPointerId = pointer.id;
        this.updateJoystick(pointer);
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.joystickPointerId && pointer.isDown) this.updateJoystick(pointer);
    });
    const releaseJoystick = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id === this.joystickPointerId) {
        this.joystickPointerId = -1;
        mobileInput.moveX = 0;
        mobileInput.moveY = 0;
        mobileInput.active = false;
        this.joystickThumb.setPosition(this.joystickBase.x, this.joystickBase.y);
      }
      if (pointer.id === this.attackPointerId) {
        this.attackPointerId = -1;
        mobileInput.attackHeld = false;
      }
    };
    this.input.on('pointerup', releaseJoystick);
    this.input.on('pointerupoutside', releaseJoystick);
  }

  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.worldX - this.joystickBase.x;
    const dy = pointer.worldY - this.joystickBase.y;
    const dist = Math.hypot(dx, dy);
    // 钳制行程而非单纯钳制坐标：指示球永不越出底盘，超程后仍保持满量程方向输入
    const layout = this.controlLayout;
    const max = layout ? layout.travel : 0;
    const clamped = Math.min(dist, max);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    this.joystickThumb.setPosition(this.joystickBase.x + nx * clamped, this.joystickBase.y + ny * clamped);
    if (layout && clamped > layout.deadzone && max > 0) {
      mobileInput.active = true;
      // 非线性加速：小幅移动加速度小，大幅移动加速度大
      const t = Math.min(1, clamped / max);
      const curve = t * t * (3 - 2 * t); // smoothstep: 低区平缓，高区陡峭
      const magnitude = curve * 1.2;
      mobileInput.moveX = nx * magnitude;
      mobileInput.moveY = ny * magnitude;
    } else {
      mobileInput.active = false;
      mobileInput.moveX = 0;
      mobileInput.moveY = 0;
    }
  }

  private addButton(
    x: number,
    y: number,
    radius: number,
    label: string,
    color: number,
    down: (pointerId: number) => void,
    up?: () => void
  ): { circle: Phaser.GameObjects.Arc; text: Phaser.GameObjects.Text } {
    const circle = this.add.circle(x, y, radius, color, 0.08)
      .setStrokeStyle(3, color, 0.85)
      .setDepth(20);
    const text = this.add.text(x, y, label, {
      fontFamily: 'monospace',
      fontSize: `${Math.floor(radius * 0.6)}px`,
      color: '#FFFFFF'
    }).setOrigin(0.5).setDepth(21);
    circle.setInteractive(new Phaser.Geom.Circle(radius, radius, radius), Phaser.Geom.Circle.Contains);
    circle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      down(pointer.id);
      this.tweens.add({ targets: [circle, text], scale: 0.9, duration: 60, yoyo: true });
    });
    if (up) {
      circle.on('pointerout', () => up());
    }
    this.touchControls.push(circle, text);
    return { circle, text };
  }

  /** 特殊攻击反馈：攻击按钮蓄力脉冲 / 触发爆闪 / 取消复位 */
  private onSpecialButtonFeedback(phase: string): void {
    const circle = this.attackBtnCircle;
    const text = this.attackBtnText;
    if (!circle || !text) return;
    if (phase === 'charge') {
      this.tweens.killTweensOf([circle, text]);
      circle.setStrokeStyle(5, 0xfde047, 1);
      // 脉动幅度收敛（×1.06）：峰值会临时扩大按钮占位，过大会吞掉与 Q/R 的缝隙
      this.tweens.add({ targets: [circle, text], scale: 1.06, duration: 180, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    } else if (phase === 'fire') {
      this.tweens.killTweensOf([circle, text]);
      circle.setStrokeStyle(4, 0x5cffb1, 1);
      this.tweens.add({
        targets: [circle, text],
        scale: 1.5,
        duration: 90,
        yoyo: true,
        onComplete: () => {
          circle.setStrokeStyle(3, 0xfde047, 0.85);
          circle.setScale(1);
          text.setScale(1);
        }
      });
      const flash = this.add.circle(circle.x, circle.y, circle.radius, 0xffffff, 0.35).setDepth(22);
      this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
    } else if (phase === 'cancel') {
      this.tweens.killTweensOf([circle, text]);
      this.tweens.add({ targets: [circle, text], scale: 1, duration: 120 });
      circle.setStrokeStyle(3, 0xfde047, 0.85);
    }
  }

  private setTouchControlsVisible(visible: boolean): void {
    this.touchControls.forEach((control) => {
      (control as Phaser.GameObjects.Shape).setVisible(visible);
    });
  }
}
