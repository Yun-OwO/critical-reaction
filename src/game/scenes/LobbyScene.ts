import Phaser from 'phaser';
import { dyes } from '../data/dyes';
import { equipDye, profileState } from '../state/ProfileState';
import { getSettings } from '../state/SettingsState';
import { getVisualProfile } from '../visual/quality';
import { projectXZ, depthFromXZ } from '../utils/projection';
import { mobileInput, resetQueuedActions } from '../input/mobileInput';
import { computeUiScale, currentViewportMetrics, isTouchDevice } from '../ui/uiScale';
import { BgmManager } from '../utils/BgmManager';

interface LobbyPoint {
  /** XZ world coordinate (isometric ground plane). */
  wx: number;
  wz: number;
  /** Screen-space position (computed). */
  x: number;
  y: number;
  label: string;
  radius: number;
  action: 'start' | 'dye' | 'relic' | 'weapon' | 'gear' | 'settings';
}

export class LobbyScene extends Phaser.Scene {
  private bgm: BgmManager | null = null;
  /** UI 缩放：移动端屏幕小、PPI 高，等比缩放后文字不可读，需按 CSS 像素密度补偿放大。 */
  private uiScale = 1;
  /** create 时的内部分辨率：用于判断 resize 是否真的改变了比例（FIT 窗口缩放不算） */
  private createdW = 0;
  private createdH = 0;
  /** 防止 resize 风暴中重复排队重启 */
  private relayoutQueued = false;
  private readonly worldWidth = 2400;
  private readonly worldHeight = 1200;
  private readonly cx = 1200;
  private readonly cy = 600;
  private readonly halfTileW = 48;
  private readonly halfTileH = 24;
  private readonly tileN = 30;

  private player!: Phaser.GameObjects.Image;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private playerShadowOuter!: Phaser.GameObjects.Ellipse;
  private playerShadowMid!: Phaser.GameObjects.Ellipse;
  private playerShadowInner!: Phaser.GameObjects.Ellipse;
  private playerBaseScale = 76 / 128;
  private ambientLight!: Phaser.GameObjects.Rectangle;
  private keys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private prompt!: Phaser.GameObjects.Text;
  private points: LobbyPoint[] = [];
  private selectedDye = 0;
  private lastDirection = new Phaser.Math.Vector2(1, 0);

  public constructor() {
    super('LobbyScene');
  }

  public create(): void {
    this.scene.launch('UIScene');
    this.cameras.main.setBackgroundColor('#071522');
    this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight);
    this.drawIsometricGrid();
    this.drawDiamondBoundary();
    this.createAtmosphere();
    this.createChemicDecorations();
    this.playLobbyBgm();
    this.createInteractionPoints();
    this.createPlayer();
    // roundPixels=false：取整跟随在非整数缩放下产生阶梯卡顿
    this.cameras.main.startFollow(this.player, false, 0.08, 0.08);
    // RESIZE 模式：视野随屏幕大小扩展
    const gameW = this.scale.game.config.width as number;
    const gameH = this.scale.game.config.height as number;
    this.scale.on('resize', this.onResize, this);
    this.createdW = this.scale.width;
    this.createdH = this.scale.height;
    this.relayoutQueued = false;
    {
      const cam = this.cameras.main;
      const scaleX = this.scale.width / gameW;
      const scaleY = this.scale.height / gameH;
      cam.setZoom(Math.max(scaleX, scaleY));
    }
    // 场景停止后移除 resize 监听（scale 管理器为游戏级，监听会跨场景残留）
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
    const isMobileDevice = isTouchDevice();
    this.uiScale = computeUiScale(currentViewportMetrics(this.scale.width, this.scale.height, isMobileDevice));
    const ui = this.uiScale;
    this.prompt = this.add.text(this.cx, this.worldHeight - 60, '', {
      color: '#FDE047', fontFamily: 'monospace', fontSize: `${Math.round(20 * ui)}px`
    }).setOrigin(0.5).setDepth(9999);
    this.add.text(40 * ui, 40 * ui, '反应站 / LOBBY', {
      color: '#FFFFFF', fontFamily: 'monospace', fontSize: `${Math.round(24 * ui)}px`
    }).setDepth(9999).setScrollFactor(0);
    this.add.text(40 * ui, 78 * ui, isMobileDevice ? '摇杆移动　E 交互' : 'WASD 移动　E 交互', {
      color: '#67E8F9', fontFamily: 'monospace', fontSize: `${Math.round(16 * ui)}px`
    }).setDepth(9999).setScrollFactor(0);
    this.cameras.main.fadeIn(1000, 7, 21, 34);
    const profile = getVisualProfile();
    if (profile.bloomEnabled && getSettings().bloomEnabled) {
      Phaser.Actions.AddEffectBloom(this.cameras.main, {
        threshold: 0.3,
        blurRadius: 6,
        blurSteps: 3,
        blurQuality: 1,
        blendAmount: 0.35
      });
    }
    this.createParallaxFog();
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    const cam = this.cameras.main;
    if (!cam) return;
    const gameW = this.scale.game.config.width as number;
    const gameH = this.scale.game.config.height as number;
    const scaleX = gameSize.width / gameW;
    const scaleY = gameSize.height / gameH;
    cam.setZoom(Math.max(scaleX, scaleY));
    // 内部分辨率变化（全屏切换重算比例）：重建场景让 uiScale 文本按新比例生效。
    // FIT 下普通窗口缩放不改变内部分辨率，不会走到重启。
    if ((gameSize.width !== this.createdW || gameSize.height !== this.createdH) && !this.relayoutQueued) {
      this.relayoutQueued = true;
      this.time.delayedCall(0, () => this.scene.restart());
    }
  }

  public update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const kbX = Number(this.keys.right.isDown) - Number(this.keys.left.isDown);
    const kbY = Number(this.keys.down.isDown) - Number(this.keys.up.isDown);
    const moveX = kbX || mobileInput.moveX;
    const moveY = kbY || mobileInput.moveY;
    const direction = new Phaser.Math.Vector2(moveX, moveY);
    if (direction.lengthSq() > 0.001) {
      direction.normalize();
      this.lastDirection.copy(direction);
      this.playerBody.setAcceleration(direction.x * 2200, direction.y * 2200);
    } else {
      this.playerBody.setAcceleration(0, 0);
    }
    this.updatePlayerAnimation(dt);
    this.enforceDiamondBounds();

    const nearest = this.findNearestPoint();
    this.prompt.setText(nearest ? `${nearest.label}　[E]` : '');
    if (nearest && (Phaser.Input.Keyboard.JustDown(this.interactKey) || mobileInput.interactQueued)) {
      mobileInput.interactQueued = false;
      this.interact(nearest.action);
    }
  }

  /* ── 2.5D Grid ─────────────────────────────────────────── */

  private toScreen(wx: number, wz: number): { x: number; y: number; depth: number } {
    const projected = projectXZ(
      { x: wx, z: wz },
      { originX: this.cx, originY: this.cy, axisX: 1, axisZ: 0.52, depthScale: 0.00002 }
    );
    return { x: projected.x, y: projected.y, depth: projected.depth };
  }

  private drawIsometricGrid(): void {
    const g = this.add.graphics().setAlpha(0.46);
    g.lineStyle(1.5, 0x245778, 0.7);
    for (let row = -this.tileN / 2; row <= this.tileN / 2; row += 1) {
      for (let col = -this.tileN / 2; col <= this.tileN / 2; col += 1) {
        const x = this.cx + (col - row) * this.halfTileW;
        const y = this.cy + (col + row) * this.halfTileH;
        g.beginPath();
        g.moveTo(x, y - this.halfTileH);
        g.lineTo(x + this.halfTileW, y);
        g.lineTo(x, y + this.halfTileH);
        g.lineTo(x - this.halfTileW, y);
        g.closePath();
        g.strokePath();
      }
    }
    this.add.rectangle(this.cx, this.cy, this.worldWidth, this.worldHeight, 0x06131e, 0.1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(-1);
  }

  private drawDiamondBoundary(): void {
    const a = this.worldWidth / 2;
    const b = this.worldHeight / 2;
    const vertices = [
      new Phaser.Math.Vector2(this.cx, this.cy - b),
      new Phaser.Math.Vector2(this.cx + a, this.cy),
      new Phaser.Math.Vector2(this.cx, this.cy + b),
      new Phaser.Math.Vector2(this.cx - a, this.cy)
    ];
    const g = this.add.graphics();
    g.lineStyle(16, 0x67e8f9, 0.12);
    g.strokePoints([...vertices, vertices[0]], true);
    g.lineStyle(3.5, 0x67e8f9, 0.7);
    g.strokePoints([...vertices, vertices[0]], true);
  }

  private enforceDiamondBounds(): void {
    const a = this.worldWidth / 2;
    const b = this.worldHeight / 2;
    const s = Math.abs(this.player.x - this.cx) / a + Math.abs(this.player.y - this.cy) / b;
    if (s > 1) {
      const k = 1 / s;
      const tx = this.cx + (this.player.x - this.cx) * k;
      const ty = this.cy + (this.player.y - this.cy) * k;
      this.player.setPosition(tx, ty);
    }
  }

  /* ── Depth ────────────────────────────────────────────── */

  private createParallaxFog(): void {
    const layers = [
      { scrollFactor: 0.3, color: 0x0a3850, alpha: 0.045, y: this.worldHeight * 0.25, count: 10 },
      { scrollFactor: 0.6, color: 0x1a0a3d, alpha: 0.035, y: this.worldHeight * 0.5, count: 8 },
      { scrollFactor: 0.8, color: 0x0c6475, alpha: 0.028, y: this.worldHeight * 0.75, count: 6 }
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.count; i += 1) {
        const x = Phaser.Math.Between(150, this.worldWidth - 150);
        const y = layer.y + Phaser.Math.Between(-200, 200);
        const r = Phaser.Math.Between(40, 110);
        const fog = this.add.circle(x, y, r, layer.color, layer.alpha)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setScrollFactor(layer.scrollFactor)
          .setDepth(-2);
        this.tweens.add({
          targets: fog,
          x: fog.x + Phaser.Math.Between(-80, 80),
          alpha: { from: layer.alpha * 0.5, to: layer.alpha * 1.6 },
          scale: { from: 0.7, to: 1.3 },
          duration: Phaser.Math.Between(4000, 6500),
          yoyo: true,
          repeat: -1,
          delay: i * 200,
          ease: 'Sine.inOut'
        });
      }
    }
  }

  /* ── Atmosphere ────────────────────────────────────────── */

  private createAtmosphere(): void {
    this.ambientLight = this.add.rectangle(this.cx, this.cy, this.worldWidth, this.worldHeight, 0x10253a, 0.18)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(-3);

    // Fog particle clusters
    const fogSpots = [
      { x: 600, y: 400, r: 200, color: 0x0a3850 },
      { x: 1800, y: 700, r: 250, color: 0x3d1d62 },
      { x: 1200, y: 900, r: 220, color: 0x0c6475 }
    ];
    for (const spot of fogSpots) {
      const count = Math.round(spot.r / 8);
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * spot.r;
        const size = Phaser.Math.Between(16, 44);
        const p = this.add.circle(
          spot.x + Math.cos(angle) * dist,
          spot.y + Math.sin(angle) * dist * 0.6,
          size, spot.color, 0.04 + Math.random() * 0.04
        ).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: p,
          x: p.x + Phaser.Math.Between(-50, 50),
          y: p.y + Phaser.Math.Between(-25, 25),
          alpha: { from: 0.025, to: 0.09 },
          scale: { from: 0.65, to: 1.35 },
          duration: Phaser.Math.Between(3000, 5500),
          yoyo: true,
          repeat: -1,
          delay: Math.random() * 1500,
          ease: 'Sine.inOut'
        });
      }
    }

    // Volumetric fog: clusters of blur particles along horizontal bands
    for (let band = 0; band < 5; band += 1) {
      const bandY = Phaser.Math.Between(200, this.worldHeight - 200);
      const bandCenterX = Phaser.Math.Between(300, this.worldWidth - 300);
      const bandColor = band % 2 === 0 ? 0x06b6d4 : 0x8b5cf6;
      const particleCount = Phaser.Math.Between(4, 7);
      for (let p = 0; p < particleCount; p += 1) {
        const ox = Phaser.Math.Between(-220, 220);
        const oy = Phaser.Math.Between(-12, 12);
        const size = Phaser.Math.Between(16, 42);
        const fog = this.add.circle(bandCenterX + ox, bandY + oy, size, bandColor, 0.04 + Math.random() * 0.03)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: fog,
          x: fog.x + Phaser.Math.Between(-90, 90),
          y: fog.y + Phaser.Math.Between(-18, 18),
          alpha: { from: 0.025, to: 0.09 },
          scale: { from: 0.7, to: 1.35 },
          duration: Phaser.Math.Between(2800, 5000),
          yoyo: true,
          repeat: -1,
          delay: p * 160 + band * 180,
          ease: 'Sine.inOut'
        });
      }
    }

    // Light columns
    for (const xPos of [600, 1800]) {
      const column = this.add.rectangle(xPos, this.cy, 50, this.worldHeight, 0x06b6d4, 0.03)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: column,
        alpha: { from: 0.02, to: 0.1 },
        scaleX: { from: 0.7, to: 1.4 },
        duration: 2800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut'
      });
    }

    // Mist particles
    for (let i = 0; i < 12; i += 1) {
      const mist = this.add.circle(
        Phaser.Math.Between(200, this.worldWidth - 200),
        Phaser.Math.Between(200, this.worldHeight - 200),
        Phaser.Math.Between(16, 44),
        i % 3 === 0 ? 0x8b5cf6 : i % 3 === 1 ? 0x06b6d4 : 0x0c6475,
        0.06
      ).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: mist,
        x: mist.x + Phaser.Math.Between(-80, 80),
        y: mist.y + Phaser.Math.Between(-40, 40),
        scale: { from: 0.7, to: 1.3 },
        alpha: { from: 0.02, to: 0.1 },
        duration: Phaser.Math.Between(2600, 4600),
        yoyo: true,
        repeat: -1,
        delay: i * 120,
        ease: 'Sine.inOut'
      });
    }
  }

  /** 大厅布景：Chemic 玻璃器皿稀疏散布、低视差压在地景之后（更远/背后），原尺寸不缩放。 */
  private createChemicDecorations(): void {
    const decos: { key: string; weight: number }[] = [
      { key: 'tex-flask', weight: 3 },
      { key: 'tex-beaker', weight: 2 }
    ];
    const totalW = decos.reduce((s, d) => s + d.weight, 0);
    const count = 4; // 稀疏（相对原 8 -50%）
    const a = this.worldWidth / 2;
    const b = this.worldHeight / 2;
    const decoPts: { x: number; y: number }[] = [];
    for (let i = 0; i < 300 && decoPts.length < count; i += 1) {
      let r = Math.random() * totalW;
      let pick = decos[0];
      for (const d of decos) { r -= d.weight; if (r <= 0) { pick = d; break; } }
      const x = Phaser.Math.Between(240, this.worldWidth - 240);
      const y = Phaser.Math.Between(240, this.worldHeight - 240);
      // 菱形地图内（|dx|/a+|dy|/b<=0.92）
      if (Math.abs(x - this.cx) / a + Math.abs(y - this.cy) / b > 0.92) continue;
      // 避开中心出生区
      if (Math.abs(x - this.cx) < 160 && Math.abs(y - this.cy) < 110) continue;
      // 不与已放置的重叠（最小间距 160，稀疏摆放）
      if (decoPts.some((p) => Phaser.Math.Distance.Between(p.x, p.y, x, y) < 160)) continue;
      const deco = this.add.image(x, y, pick.key)
        .setAlpha(0.35)
        .setScrollFactor(0.45) // 视差：压在地景之后，看起来更远/背后
        .setDepth(-1.5); // 位于地格之下，作背景
      this.tweens.add({
        targets: deco,
        y: y + 5,
        alpha: { from: 0.28, to: 0.45 },
        angle: { from: -5, to: 5 },
        duration: Phaser.Math.Between(2600, 4600),
        yoyo: true,
        repeat: -1,
        delay: i * 200,
        ease: 'Sine.inOut'
      });
      decoPts.push({ x, y });
    }
  }

  /** 大厅 BGM：随机播放 Chemic 冒险曲，不重复，播完续播。 */
  private playLobbyBgm(): void {
    if (!this.bgm) this.bgm = new BgmManager(this);
    this.bgm.start();
  }

  /* ── Interaction Points (in XZ world coords) ──────────── */

  private createInteractionPoints(): void {
    const defs: Array<{ wx: number; wz: number; label: string; radius: number; action: LobbyPoint['action'] }> = [
      { wx: 0, wz: -320, label: '反应核心：开始实验', radius: 160, action: 'start' },
      { wx: -520, wz: 0, label: '染色工作台：混色/装备染料', radius: 150, action: 'dye' },
      { wx: -260, wz: 200, label: '遗物展示柜：装备遗物', radius: 150, action: 'relic' },
      { wx: 260, wz: 200, label: '武器架：升级武器与形态', radius: 150, action: 'weapon' },
      { wx: 0, wz: 320, label: '装备库：购买/携带装备', radius: 150, action: 'gear' },
      { wx: 520, wz: 0, label: '设置终端：打开设置', radius: 150, action: 'settings' }
    ];

    this.points = defs.map((def) => {
      const { x, y, depth } = this.toScreen(def.wx, def.wz);
      return { ...def, x, y };
    });

    this.points.forEach((point) => {
      const scr = this.toScreen(point.wx, point.wz);
      const color = point.action === 'start' ? 0xfde047 : 0x67e8f9;
      const rx = 80;
      const ry = rx * 0.52;

      // Outer glow pulse
      const outerGlow = this.add.ellipse(scr.x, scr.y, rx * 3.2, ry * 3.2, color, 0.04)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depthFromXZ(scr.depth, -2));
      this.tweens.add({
        targets: outerGlow,
        alpha: { from: 0.02, to: 0.08 },
        scaleX: { from: 0.9, to: 1.15 },
        scaleY: { from: 0.85, to: 1.1 },
        duration: 2200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut'
      });

      // Radial glow on ground (ellipse for isometric tilt)
      this.add.ellipse(scr.x, scr.y, rx * 2.4, ry * 2.4, color, 0.08)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depthFromXZ(scr.depth, -1));

      // Platform ring (ellipse)
      this.add.ellipse(scr.x, scr.y, rx * 2, ry * 2, 0x102f43, 0.85)
        .setStrokeStyle(3, color, 0.9)
        .setDepth(depthFromXZ(scr.depth, 1));

      // Label
      const shortLabel = point.action === 'start' ? '反应核心'
        : point.action === 'dye' ? '染色台'
        : point.action === 'relic' ? '遗物柜'
        : point.action === 'weapon' ? '武器架'
        : point.action === 'gear' ? '装备库'
        : '设置终端';
      this.add.text(scr.x, scr.y - ry - 12, shortLabel, {
        color: '#D4E8EE', fontFamily: 'monospace', fontSize: `${Math.round(18 * this.uiScale)}px`
      }).setOrigin(0.5).setDepth(depthFromXZ(scr.depth, 2));
    });
  }

  private findNearestPoint(): LobbyPoint | null {
    let best: LobbyPoint | null = null;
    let bestDist = Infinity;
    for (const p of this.points) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y);
      if (d < p.radius && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  /* ── Player ────────────────────────────────────────────── */

  private createPlayer(): void {
    const scr = this.toScreen(0, 0);
    this.player = this.add.image(scr.x, scr.y, 'hydrogen-core')
      .setDisplaySize(76, 76)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.playerShadowOuter = this.add.ellipse(scr.x, scr.y + 38, 100, 30, 0x003355, 0.06)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
    this.playerShadowMid = this.add.ellipse(scr.x, scr.y + 36, 74, 24, 0x002244, 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
    this.playerShadowInner = this.add.ellipse(scr.x, scr.y + 34, 56, 18, 0x001133, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(true).setDrag(1200, 1200).setMaxVelocity(400, 400);
    this.keys = {
      up: this.input.keyboard!.addKey('W'),
      down: this.input.keyboard!.addKey('S'),
      left: this.input.keyboard!.addKey('A'),
      right: this.input.keyboard!.addKey('D')
    };
    this.interactKey = this.input.keyboard!.addKey('E');

    this.player.setDepth(depthFromXZ(scr.depth, 100));
    this.playerShadowOuter.setDepth(depthFromXZ(scr.depth, -1));
    this.playerShadowMid.setDepth(depthFromXZ(scr.depth, -1));
    this.playerShadowInner.setDepth(depthFromXZ(scr.depth, -1));
  }

  private updatePlayerAnimation(dt: number): void {
    const velocity = this.playerBody.velocity;
    const speed = velocity.length();
    const moving = speed > 24;
    const breathe = 1 + Math.sin(this.time.now * 0.0024) * 0.035;

    // Shadow tracks player
    const scr = this.toScreen(this.player.x, this.player.y);
    const sDepth = depthFromXZ(scr.depth, -1);
    this.playerShadowOuter.setPosition(this.player.x, this.player.y + 38).setDepth(sDepth);
    this.playerShadowMid.setPosition(this.player.x, this.player.y + 36).setDepth(sDepth);
    this.playerShadowInner.setPosition(this.player.x, this.player.y + 34).setDepth(sDepth);

    // Depth sort
    this.player.setDepth(depthFromXZ(scr.depth, 100));

    if (moving) {
      const stretch = 1 + Math.min(speed / 300, 1) * 0.14;
      const squash = 1 / stretch;
      const nx = Math.abs(velocity.x) / (speed || 1);
      const ny = Math.abs(velocity.y) / (speed || 1);
      this.player.setScale(
        this.playerBaseScale * (1 + (nx * stretch + ny * squash - 1) * 0.6) * breathe,
        this.playerBaseScale * (1 + (ny * stretch + nx * squash - 1) * 0.6) * breathe
      );
      const targetAngle = Math.atan2(velocity.y, velocity.x) + Math.PI / 2;
      this.player.rotation = Phaser.Math.Angle.RotateTo(this.player.rotation, targetAngle, dt * 6);
    } else {
      this.player.setScale(this.playerBaseScale * breathe);
      this.player.rotation = Phaser.Math.Angle.RotateTo(this.player.rotation, 0, dt * 3);
    }
  }

  /* ── Interaction Logic ─────────────────────────────────── */

  private interact(action: LobbyPoint['action']): void {
    if (action === 'start') {
      resetQueuedActions();
      this.scene.stop('UIScene');
      this.scene.start('GameScene');
    } else if (action === 'settings') {
      document.getElementById('open-settings')?.click();
    } else if (action === 'dye') {
      document.getElementById('open-dye-workbench')?.click();
    } else if (action === 'relic') {
      document.getElementById('open-relic-panel')?.click();
    } else if (action === 'weapon') {
      document.getElementById('open-weapon-panel')?.click();
    } else if (action === 'gear') {
      document.getElementById('open-gear-panel')?.click();
    }
  }
}
