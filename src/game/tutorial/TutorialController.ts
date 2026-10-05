import Phaser from 'phaser';
import { gameState } from '../state/GameState';
import { profileState, saveProfile } from '../state/ProfileState';
import { on } from '../events/EventBus';
import { isTouchDevice } from '../ui/uiScale';

/**
 * 新手引导（首次进入游戏后逐步骤解锁，完成/跳过后永久关闭）。
 *
 * 设计原则（商业级引导的三个硬指标）：
 * 1. 不打断：全程可正常操作，提示条常驻顶部但不拦截输入；
 * 2. 可恢复：步骤进度跨场景/跨死亡保留（模块级），完成状态跨会话持久化（profile）；
 * 3. 有指向：触屏端用脉动光环圈出对应按钮/区域，桌面端以键位文案引导。
 *
 * 两段式：大厅段（武器架/染色台/装备库）→ 战斗段（攻击/电子/模式/特殊/面板/撤离）。
 * 移动端提示条按可读性放大字号（设计稿 1:1 在手机上太小，实测反馈 v0.2）。
 */

type TutorialWhere = 'lobby' | 'battle';
type StationKind = 'weapon' | 'dye' | 'gear';

interface TutorialStep {
  id: string;
  where: TutorialWhere;
  title: string;
  descTouch: string;
  descDesktop: string;
  highlight: 'attack' | 'mode' | 'status' | 'core' | 'world-extract' | null;
  /** 大厅站点步骤的完成条件键 */
  station?: StationKind;
}

const STEPS: TutorialStep[] = [
  {
    id: 'weapon', where: 'lobby', title: '武器架 · 输出核心',
    descTouch: '走到武器架按 E：可升级武器、切换形态，武器等级贯穿整局',
    descDesktop: '走到武器架按 E：可升级武器、切换形态，武器等级贯穿整局',
    highlight: null, station: 'weapon'
  },
  {
    id: 'dye', where: 'lobby', title: '染色台 · 光谱属性',
    descTouch: '走到染色台按 E：主染料决定攻击属性，敌人有光谱弱点，克制伤害更高',
    descDesktop: '走到染色台按 E：主染料决定攻击属性，敌人有光谱弱点，克制伤害更高',
    highlight: null, station: 'dye'
  },
  {
    id: 'gear', where: 'lobby', title: '装备库 · 搜打撤核心',
    descTouch: '走到装备库按 E：用样本买装备→携带出击→撤离带回/死亡丢失，死了会肉疼',
    descDesktop: '走到装备库按 E：用样本买装备→携带出击→撤离带回/死亡丢失，死了会肉疼',
    highlight: null, station: 'gear'
  },
  {
    id: 'attack', where: 'battle', title: '基础攻击',
    descTouch: '靠近敌人，点击「攻」按钮发起攻击，连点可持续输出',
    descDesktop: '靠近敌人，点击 鼠标左键 / 空格 发起攻击，按住可连击',
    highlight: 'attack'
  },
  {
    id: 'electron', where: 'battle', title: '收集自由电子',
    descTouch: '击败敌人会掉落发光电子，走近拾取——环绕在角色旁的卫星就是你的弹药',
    descDesktop: '击败敌人会掉落发光电子，走近拾取——环绕在角色旁的卫星就是你的弹药',
    highlight: 'core'
  },
  {
    id: 'mode', where: 'battle', title: '氧化 / 还原',
    descTouch: '点「R」切换攻击模式：氧化=夺取电子打伤害，还原=注入电子降温护盾',
    descDesktop: '按 R 切换攻击模式：氧化=夺取电子打伤害，还原=注入电子降温护盾',
    highlight: 'mode'
  },
  {
    id: 'special', where: 'battle', title: '特殊攻击',
    descTouch: '有自由电子时，长按「攻」蓄力后松开：消耗全部电子释放强化一击',
    descDesktop: '有自由电子时，按住攻击蓄力后松开：消耗全部电子释放强化一击',
    highlight: 'attack'
  },
  {
    id: 'status', where: 'battle', title: '状态面板',
    descTouch: '点「☰」查看祝福 / 装备 / 属性一览（打开时游戏暂停）',
    descDesktop: '按 TAB 查看祝福 / 装备 / 属性一览（打开时游戏暂停）',
    highlight: 'status'
  },
  {
    id: 'extract', where: 'battle', title: '撤离结算',
    descTouch: '清空房间后走到发光的撤离点，长按 E 带走样本——死亡会丢失一切！',
    descDesktop: '清空房间后走到发光的撤离点，长按 E 带走样本——死亡会丢失一切！',
    highlight: 'world-extract'
  }
];

/** 跨场景/跨死亡的步骤进度（模块级：随页面刷新重置，随 profile 完成标记永久关闭）。 */
let resumeStepIndex = 0;

interface Unlisten {
  (): void;
}

export class TutorialController {
  private scene: Phaser.Scene;
  private sceneKind: TutorialWhere;
  private container: Phaser.GameObjects.Container | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private descText: Phaser.GameObjects.Text | null = null;
  private counterText: Phaser.GameObjects.Text | null = null;
  private dots: Phaser.GameObjects.Arc[] = [];
  private bannerBg: Phaser.GameObjects.Rectangle | null = null;
  private skipBtn: Phaser.GameObjects.Text | null = null;
  private hudRing: Phaser.GameObjects.Arc | null = null;
  private worldRing: Phaser.GameObjects.Arc | null = null;
  private unlisten: Unlisten[] = [];
  private stepIndex = resumeStepIndex;
  private finished = false;
  private isTouch: boolean;
  // 条件计数（战斗段）
  private moveDistance = 0;
  private attackHits = 0;
  private modeSwitches = 0;
  private specialFired = false;
  private statusOpened = false;
  // 条件计数（大厅段）
  private stations = new Set<StationKind>();
  private lastPos: { x: number; y: number } | null = null;
  private stepShownAt = 0;

  public constructor(scene: Phaser.Scene, sceneKind: TutorialWhere) {
    this.scene = scene;
    this.sceneKind = sceneKind;
    this.isTouch = isTouchDevice();
  }

  public start(): void {
    if (profileState.tutorialDone || this.finished) return;
    // 跳过不属于当前场景的步骤（大厅段在战斗里自动略过，反之亦然）
    while (this.stepIndex < STEPS.length && STEPS[this.stepIndex].where !== this.sceneKind) {
      this.stepIndex += 1;
      resumeStepIndex = this.stepIndex;
    }
    if (this.stepIndex >= STEPS.length) {
      this.complete();
      return;
    }
    this.buildUi();
    this.registerEvents();
    this.showStep(this.stepIndex);
  }

  /* ── UI ── */

  private buildUi(): void {
    const W = this.scale_width();
    const H = this.scale_height();
    const s = Math.max(0.75, Math.min(1, W / 1920));
    // 移动端可读性放大：实测反馈 v0.2——设计稿 1:1 字号在手机上太小
    const touch = this.isTouch ? 1.35 : 1;
    this.container = this.scene.add.container(W / 2, 0).setScrollFactor(0).setDepth(9500);

    const panelW = Math.min((this.isTouch ? 900 : 860) * s * touch, W - 24);
    const panelH = (this.isTouch ? 118 : 92) * s;
    this.bannerBg = this.scene.add.rectangle(0, 20 * s, panelW, panelH, 0x06121e, 0.82)
      .setStrokeStyle(1.5, 0x67e8f9, 0.55)
      .setOrigin(0.5, 0);
    this.titleText = this.scene.add.text(0, (20 + 12) * s, '', {
      color: '#67E8F9', fontFamily: 'monospace', fontSize: `${Math.round(17 * s * touch)}px`, fontStyle: 'bold'
    }).setOrigin(0.5, 0);
    this.descText = this.scene.add.text(0, (20 + 40) * s, '', {
      color: '#C9DCE4', fontFamily: 'monospace', fontSize: `${Math.round(13 * s * touch)}px`,
      align: 'center', wordWrap: { width: panelW - 50 * s }
    }).setOrigin(0.5, 0);
    this.counterText = this.scene.add.text(panelW / 2 - 16 * s, (20 + 10) * s, '', {
      color: '#5C8FA3', fontFamily: 'monospace', fontSize: `${Math.round(11 * s * touch)}px`
    }).setOrigin(1, 0);
    this.container.add([this.bannerBg, this.titleText, this.descText, this.counterText]);

    this.dots = STEPS.map((_, i) => {
      const dot = this.scene.add.circle(-(STEPS.length - 1) * 11 * s + i * 22 * s, 20 * s + panelH + 13 * s, 4.5 * s, 0x274552, 0.9);
      container_add(this.container, dot);
      return dot;
    });

    this.skipBtn = this.scene.add.text(W - 24 * s, H - 30 * s, this.isTouch ? '跳过教程 ×' : '跳过教程 (Esc)', {
      color: '#7FA3B0', fontFamily: 'monospace', fontSize: `${Math.round(13 * s * touch)}px`
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(9500)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.complete(true));
    this.hudRing = this.scene.add.circle(0, 0, 60, 0x67e8f9, 0)
      .setScrollFactor(0).setDepth(9499).setStrokeStyle(3, 0x67e8f9, 0.9).setVisible(false);
    this.worldRing = this.scene.add.circle(0, 0, 130, 0xfde047, 0)
      .setDepth(8).setStrokeStyle(4, 0xfde047, 0.9).setVisible(false);
  }

  private scale_width(): number { return this.scene.scale.width; }
  private scale_height(): number { return this.scene.scale.height; }

  private showStep(index: number): void {
    this.stepIndex = index;
    resumeStepIndex = index;
    if (index >= STEPS.length) {
      this.complete();
      return;
    }
    const step = STEPS[index];
    const touch = this.isTouch;
    this.titleText?.setText(`◆ ${step.title}`);
    this.descText?.setText(touch ? step.descTouch : step.descDesktop);
    this.counterText?.setText(`${index + 1}/${STEPS.length}`);
    this.dots.forEach((dot, i) => {
      dot.setFillStyle(i < index ? 0x5cffb1 : i === index ? 0x67e8f9 : 0x274552, 0.95);
      dot.setScale(i === index ? 1.35 : 1);
    });
    this.stepShownAt = this.scene.time.now;
    if (this.container) {
      this.container.setAlpha(0.0);
      this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 260, ease: 'Cubic.out' });
    }
    this.updateHighlight();
  }

  private completeStep(): void {
    (this.scene as unknown as { playTone?(freq: number, dur: number, type?: OscillatorType, vol?: number): void })
      .playTone?.(660, 0.08, 'sine', 0.05);
    this.showStep(this.stepIndex + 1);
  }

  private complete(skipped = false): void {
    if (this.finished) return;
    this.finished = true;
    resumeStepIndex = 0;
    profileState.tutorialDone = true;
    void saveProfile();
    this.unlisten.forEach((off) => off());
    this.unlisten = [];
    this.skipBtn?.destroy();
    this.hudRing?.setVisible(false);
    this.worldRing?.setVisible(false);
    if (this.container) {
      this.scene.tweens.add({
        targets: this.container,
        alpha: 0,
        duration: 700,
        delay: skipped ? 0 : 1200,
        onComplete: () => {
          this.container?.destroy(true);
          this.container = null;
        }
      });
      this.titleText?.setText(skipped ? '教程已跳过' : '◆ 训练完成 · 实验记录已保存');
      this.descText?.setText(skipped ? '随时可在设置里重置教程' : '记住：氧化抢血，还原控温，活着撤离');
      this.counterText?.setText('');
    }
  }

  /* ── 事件与条件 ── */

  private registerEvents(): void {
    this.unlisten.push(
      on('special', (payload) => {
        if ((payload as { phase?: string }).phase === 'fire') this.specialFired = true;
      }),
      on('extraction', () => {
        if (!this.finished && this.stepIndex >= 0) this.complete();
      })
    );
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.complete(true);
    };
    window.addEventListener('keydown', onKey);
    this.unlisten.push(() => window.removeEventListener('keydown', onKey));
  }

  /** 外部通知入口：对敌命中（GameScene.applyFeedback 调用）。 */
  public notifyAttackHit(): void {
    this.attackHits += 1;
  }

  public notifyModeSwitched(): void {
    this.modeSwitches += 1;
  }

  public notifyStatusPanel(): void {
    this.statusOpened = true;
  }

  /** 大厅站点访问（LobbyScene.interact 调用）。 */
  public notifyStation(kind: StationKind): void {
    this.stations.add(kind);
  }

  /** 每帧驱动：轮询型条件 + 完成判定 + 高亮定位。 */
  public update(dt: number): void {
    if (this.finished || this.container == null) return;
    if (this.sceneKind === 'battle') {
      const player = (this.scene as unknown as { player?: Phaser.GameObjects.Image }).player;
      if (player) {
        if (this.lastPos) {
          this.moveDistance += Phaser.Math.Distance.Between(this.lastPos.x, this.lastPos.y, player.x, player.y);
        }
        this.lastPos = { x: player.x, y: player.y };
      }
    }
    this.updateHighlight();
    const step = STEPS[this.stepIndex];
    if (!step) return;
    // 步骤最小停留 600ms，防止上一操作的余波直接跳步
    if (this.scene.time.now - this.stepShownAt < 600) return;
    let done = false;
    switch (step.id) {
      case 'weapon': done = this.stations.has('weapon'); break;
      case 'dye': done = this.stations.has('dye'); break;
      case 'gear': done = this.stations.has('gear'); break;
      case 'attack': done = this.attackHits >= 3; break;
      case 'electron': done = gameState.freeElectrons >= 1; break;
      case 'mode': done = this.modeSwitches >= 1; break;
      case 'special': done = this.specialFired; break;
      case 'status': done = this.statusOpened; break;
      case 'extract': done = false; break; // 由 extraction 事件直接 complete
    }
    if (done) this.completeStep();
  }

  /** 高亮定位：HUD 目标读触摸控件布局，世界目标（撤离点）挂世界坐标。 */
  private updateHighlight(): void {
    if (this.finished || this.hudRing == null || this.worldRing == null) return;
    const step = STEPS[this.stepIndex];
    if (!step || !step.highlight) {
      this.hudRing.setVisible(false);
      this.worldRing.setVisible(false);
      return;
    }
    const t = this.scene.time.now * 0.004;
    const pulse = 0.55 + 0.4 * Math.sin(t);
    if (step.highlight === 'world-extract') {
      this.hudRing.setVisible(false);
      const zone = (this.scene as unknown as { extractZone?: Phaser.GameObjects.Rectangle }).extractZone;
      if (!zone) {
        this.worldRing.setVisible(false);
        return;
      }
      this.worldRing.setVisible(true).setPosition(zone.x, zone.y);
      this.worldRing.setStrokeStyle(4, 0xfde047, pulse);
      this.worldRing.setScale(1 + 0.12 * Math.sin(t));
      return;
    }
    this.worldRing.setVisible(false);
    if (!this.isTouch) {
      this.hudRing.setVisible(false);
      return; // 桌面端以键位文案引导，不画控件光环
    }
    const layout = (this.scene.scene.get('UIScene') as unknown as {
      getControlLayout?: () => { attackX: number; attackY: number; attackR: number; modeX: number; modeY: number; smallR: number; statusX: number; statusY: number } | null;
    }).getControlLayout?.();
    if (!layout) {
      this.hudRing.setVisible(false);
      return;
    }
    let x = 0;
    let y = 0;
    let r = 60;
    if (step.highlight === 'attack') {
      x = layout.attackX; y = layout.attackY; r = layout.attackR + 10;
    } else if (step.highlight === 'mode') {
      x = layout.modeX; y = layout.modeY; r = layout.smallR + 10;
    } else if (step.highlight === 'status') {
      x = layout.statusX; y = layout.statusY; r = layout.smallR + 10;
    } else if (step.highlight === 'core') {
      x = 120 * this.scale_width() / 1920;
      y = this.scale_height() - 150 * this.scale_width() / 1920;
      r = 64;
    }
    this.hudRing.setVisible(true).setPosition(x, y).setRadius(r);
    this.hudRing.setStrokeStyle(3, 0x67e8f9, pulse);
  }

  public destroy(): void {
    this.unlisten.forEach((off) => off());
    this.unlisten = [];
    this.container?.destroy(true);
    this.container = null;
    this.skipBtn?.destroy();
    this.hudRing?.destroy();
    this.worldRing?.destroy();
  }
}

/** container 兜底添加（container 在 buildUi 中已保证非空）。 */
function container_add(container: Phaser.GameObjects.Container | null, obj: Phaser.GameObjects.GameObject): void {
  container?.add(obj);
}
