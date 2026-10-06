import Phaser from 'phaser';
import { emit } from '../events/EventBus';
import { reactions } from '../data/reactions';
import { getWeapon, resolveWeaponModifiers } from '../data/weapons';
import { getWeaponForm, getWeaponLevel } from '../state/ProfileState';
import { getGear, pickGearDrop, GEAR_RARITY_META } from '../data/gear';
import { COMBAT_POOL, EXTRACTION_DEFS, ROOM_THEMES, buildComposition, generateRoomDoors, generateStartRoom, makeCombatWaves, getLayerName, getLayerProgress, getLayerHpScale, getLayerSpeedScale, createFinalBossRoom, pickExtraction, settleExtractionSamples } from '../data/rooms';
import type { EnemyKind, ExtractionDef, InstrumentOffer, RoomDef, RoomEnemyDef, RoomReward, RoomType, ShopOffer } from '../data/rooms';
import { getBossConfigForLayer } from '../data/bosses';
import { BALANCE } from '../data/balance';
import { ATTACK_BUFFER_SEC, DASH_BUFFER_SEC, FEEDBACK, ShakeGovernor, hitTierFor, pitchJitter, squashCurve, stretchCurve } from '../visual/feedback';
import type { FeedbackTier } from '../visual/feedback';
import { describeElectronState, overloadTick } from '../combat/electronState';
import type { ElectronState } from '../combat/electronState';
import { BAG_UPGRADE_AMOUNT, BAG_UPGRADE_COST, loadDashCdMult, loadSpeedMult, describeLoad } from '../combat/load';
import { pickBoons, getBoonDef, sampleDisabledBoons, rollSpecialChoices, BOON_POOL, SPECIAL_BOONS } from '../data/upgrades';
import type { BoonDef, BoonRarity } from '../data/upgrades';
import { SCHOOL_COLORS, RARITY_COLORS, RARITY_LABELS, SCHOOL_NAMES, SCHOOL_SYMBOLS, SLOT_ICONS, SLOT_NAMES, formatBoonDesc } from '../data/upgrades';
import { gameState } from '../state/GameState';
import type { ReactionMode } from '../state/GameState';
import { damagePlayerState, gainFreeElectrons, resetRun } from '../state/GameState';
import { profileState, saveProfile, applyProgress, getActiveRelicDef, getRelicLevel, getLoadoutEffects, loseGearOnDeath, bankCarriedGear } from '../state/ProfileState';
import { dyes, getDye, resolveMix, DYE_SLOT_MULTIPLIERS } from '../data/dyes';
import type { DyeEffectType } from '../data/dyes';
import { relicDefs } from '../data/relics';
import { mobileInput, resetQueuedActions } from '../input/mobileInput';
import { haptic, hapticFire, hapticHit, hapticHurt } from '../utils/haptic';
import {
  CAPTURE_ANIM,
  ELECTRON_PAIR_ANIM,
  ELECTRON_PAIR_LIFETIME,
  ORBIT_CAPACITY,
  SINGLE_HIT_MAX_HP,
  annihilatePair,
  captureElectron,
  createOrbit,
  orbitVisualParams,
  pickSlotToward
} from '../combat/orbit';
import type { OrbitState, OrbitVisualState } from '../combat/orbit';
import { diamondS as computeDiamondS, projectInside } from '../utils/diamond';
import type { Diamond } from '../utils/diamond';
import { getVisualProfile } from '../visual/quality';
import { depthFromXZ, projectXZ } from '../utils/projection';
import { getSettings } from '../state/SettingsState';
import { computeUiScale, currentViewportMetrics } from '../ui/uiScale';
import { BgmManager } from '../utils/BgmManager';
import { SfxLimiter } from '../utils/SfxLimiter';
import { generateTerrain } from '../world/biomes';
import { addLayers, claimMilestones, isRunawayCancel, reactionDamageMult } from '../combat/reaction';
import { TutorialController } from '../tutorial/TutorialController';

interface RuntimeEnemy {
  view: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Arc;
  innerHalo: Phaser.GameObjects.Arc;
  outerHalo: Phaser.GameObjects.Arc;
  hp: number;
  maxHp: number;
  speed: number;
  kind: EnemyKind;
  /** 多层电子：当前剩余层数（每层独立满血，最多 3 层，类似 Boss 多段）。 */
  electronLayers: number;
  /** 多层电子可视圆点（随破层减少）。 */
  layerPips: Phaser.GameObjects.Arc[];
  attackTimer: number;
  shotTimer: number;
  stunTimer: number;
  pushX: number;
  pushY: number;
  orbit: OrbitState | null;
  enteredCombat: boolean;
  orbitAngle: number;
  orbitArcs: Phaser.GameObjects.Arc[];
  chargeTimer: number;
  chargeActive: boolean;
  /** 燃烧/腐蚀 DoT：剩余秒数、每跳伤害、特效色。 */
  dotTimer: number;
  dotTick: number;
  dotDamage: number;
  dotColor: number;
  /** 移速倍率（减速效果）。 */
  slowMult: number;
  /** 光谱弱点染料 ID（攻击该染料克制颜色+30%伤害）。 */
  weaknessDyeId: string | null;
  /** 是否已死亡（防止同一帧内多次结算导致重复计数）。 */
  dead: boolean;
  /** 精英怪：金色标识环 + 属性强化（精英房专属）。 */
  isElite: boolean;
  eliteRing: Phaser.GameObjects.Rectangle | null;
}

interface RuntimeProjectile {
  view: Phaser.GameObjects.Shape;
  vx: number;
  vy: number;
  target?: RuntimeEnemy | null;
  bossTarget?: boolean;
  glow?: Phaser.GameObjects.Shape;
  glow2?: Phaser.GameObjects.Shape;
  boost?: number;
}

interface RuntimeEnemyProjectile {
  view: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
}

interface RoomDoor {
  x: number;
  y: number;
  target: RoomDef;
  platform: Phaser.GameObjects.Ellipse;
  icon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
}

/** 已脱离轨道的电子对：互绕漂浮，存在时间结束后自动破碎。 */
interface ReactionPair {
  x: number;
  y: number;
  angle: number;
  spin: number;
  life: number;
  mine: Phaser.GameObjects.Arc;
  theirs: Phaser.GameObjects.Arc;
}

interface AcidPool {
  view: Phaser.GameObjects.Arc;
  halo: Phaser.GameObjects.Arc;
  radius: number;
  ttl: number;
  tick: number;
}

/** 击杀掉落的自由电子：接触拾取 +1，是特殊攻击的强化资源（可囤积在地面）。 */
interface ElectronDrop {
  view: Phaser.GameObjects.Arc;
  halo: Phaser.GameObjects.Arc;
  /** 电子已满时提示的冷却（秒）。 */
  fullHintCd: number;
}

/** 投掷炸弹：抛向落点，到达后 AoE 爆炸伤害玩家。 */
interface ThrownBomb {
  view: Phaser.GameObjects.Arc;
  fromX: number; fromY: number;
  toX: number; toY: number;
  ttl: number; // 剩余飞行时间
  total: number;
  radius: number;
}

/** 烟雾云：在地图某处产生，模糊玩家视野（深色遮罩，非 ADD）。 */
interface SmokeCloud {
  view: Phaser.GameObjects.Arc;
  ttl: number;
  maxTtl: number;
}

interface RuntimeBoss {
  view: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Arc;
  innerHalo: Phaser.GameObjects.Arc;
  outerHalo: Phaser.GameObjects.Arc;
  config: import('../data/bosses').BossConfig;
  phase: 1 | 2 | 3;
  slamTimer: number;
  slamTelegraph: Phaser.GameObjects.Arc | null;
  orbits: OrbitState[];
  orbitArcs: Phaser.GameObjects.Arc[][];
  orbitRings: Phaser.GameObjects.Ellipse[];
  orbitAngle: number;
  shotTimer: number;
  aoeTimer: number;
  /** 链式反应母体：分裂小怪计时器 */
  splitTimer: number;
  /** 氧化之主：温度熔毁倒计时 */
  meltdownTimer: number;
  /** 电解领主：麻痹效果计时器 */
  stunTimer: number;
  /** 各 Boss 专属攻击（射线/投弹/酸雾/烟雾）计时器 */
  specialtyTimer: number;
  /** Boss 所属层 */
  layer: number;
}

const BOSS_ORBIT_RADII = [118, 150, 182, 214, 246, 278, 310, 342];
const BOSS_ORBIT_COLORS = [0xff8a4c, 0xffa34c, 0xfde047, 0xc6f15a, 0x67e8f9, 0x5cd6f2, 0x9d8cff, 0xff5c7a];

/** 特殊攻击长按蓄力时长（秒）。 */
const SPECIAL_CHARGE_SEC = 0.45;

/** 裂变冲击基础范围半径（像素），受 AOE 倍率影响。 */
const FISSION_RADIUS = 200;

/** 毒雾 / 酸池的持续结算间隔（秒），与描述「每秒」一致。 */
const POOL_TICK_SEC = 1.0;

interface OrbitRing {
  radius: number;
  tiltX: number;
  spin: number;
  spinSpeed: number;
  speed: number;
  phase: number;
  graphics: Phaser.GameObjects.Graphics;
}

/** 环绕卫星（自由电子的实体化）：数量实时映射 gameState.freeElectrons（上限=电子扩容上限 5）。 */
interface OrbitSatellite {
  electron: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Arc;
  glowLayers: Phaser.GameObjects.Arc[];
  innerHalo: Phaser.GameObjects.Arc;
  outerHalo: Phaser.GameObjects.Arc;
  /** 平滑后的透明度：获得/失去电子时淡入淡出而不是闪现消失 */
  alpha: number;
}

export class GameScene extends Phaser.Scene {
  private readonly worldWidth = 4800;
  private readonly worldHeight = 2400;
  private readonly diamondCx = this.worldWidth / 2;
  private readonly diamondCy = this.worldHeight / 2;
  private readonly diamondA = this.worldWidth / 2;
  private readonly diamondB = this.worldHeight / 2;
  private orbitRings: OrbitRing[] = [];
  /** 环绕卫星池：长度 = 自由电子上限（商店扩容后 5），显示数量 = 当前自由电子数 */
  private orbitElectrons: OrbitSatellite[] = [];
  private static readonly ORBIT_ELECTRON_SLOTS = 6;
  private orbitColor = 0x67e8f9;
  private glowSmoothX: number[] = [];
  private glowSmoothY: number[] = [];
  private readonly diamond: Diamond = {
    cx: this.diamondCx,
    cy: this.diamondCy,
    a: this.diamondA,
    b: this.diamondB
  };
  private isTouch = false;
  private orbitSegments = 48;
  private enemyProjectiles: RuntimeEnemyProjectile[] = [];
  private acidPools: AcidPool[] = [];
  private bombs: ThrownBomb[] = [];
  private smokeClouds: SmokeCloud[] = [];
  private reactionPairs: ReactionPair[] = [];
  private electronDrops: ElectronDrop[] = [];
  private boss: RuntimeBoss | null = null;
  private player!: Phaser.GameObjects.Image;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private readonly playerBaseScale = 92 / 128;
  private attackRecoil = 0;
  private boundaryGraphics!: Phaser.GameObjects.Graphics;
  private boundaryWarning!: Phaser.GameObjects.Arc;
  private keys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private enemies: RuntimeEnemy[] = [];
  private projectiles: RuntimeProjectile[] = [];
  private interactKey!: Phaser.Input.Keyboard.Key;
  private attackKey!: Phaser.Input.Keyboard.Key;
  private modeKey!: Phaser.Input.Keyboard.Key;
  private weaponKey!: Phaser.Input.Keyboard.Key;
  private bgm: BgmManager | null = null;
  private attackTimer = 0;
  private hitStopTimer = 0;
  /** 屏震治理器：保证「更强覆盖更弱」，避免连击把重击震感洗掉。 */
  private readonly shakeGovernor = new ShakeGovernor();
  /** 攻击输入缓冲计时：按下时攻击尚在冷却，则在窗口内自动补发。 */
  private attackBufferTimer = 0;
  /** 冲刺输入缓冲计时。 */
  private dashBufferTimer = 0;
  /** 玩家挤压拉伸动画计时（攻击/冲刺/受击的重量感）。 */
  private playerSquashTimer = 0;
  private playerSquashTotal = 0;
  private playerSquashStrength = 0.12;
  private playerSquashStretch = false;
  private attackHoldTimer = 0;
  private specialAttackReady = false;
  private prevAttackHeld = false;
  /** PC 鼠标左键是否按住（左键长按与空格一样可蓄力特殊攻击）。 */
  private mouseAttackHeld = false;
  /** 本次长按是否已在按下瞬间出过普攻，避免松开时重复攻击。 */
  private pressAttackFired = false;
  /** 蓄力满后等待释放的状态（脉冲提示"释放以触发特殊攻击"）。 */
  private specialCharged = false;
  private chargePulseSounded = false;
  /** 特殊攻击蓄力视觉：外圈 + 内圈 + 提示文字 */
  private specialChargeFx: {
    color: number;
    outer: Phaser.GameObjects.Arc;
    inner: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
    /** 蓄力期间显示的武器本体（剑刃/炮管）。 */
    weapon: Phaser.GameObjects.Container;
    /** 武器尖端/炮口的充能光团（蓄力动画用）。 */
    tipGlow: Phaser.GameObjects.Arc;
    tipCore: Phaser.GameObjects.Arc;
    /** 持久化的充能进度圆（不再每帧重建）。 */
    fill: Phaser.GameObjects.Arc;
  } | null = null;
  /** 祝福「分子壁垒」生成的护盾墙。 */
  private shieldWalls: { x: number; y: number; angle: number; halfW: number; halfH: number; view: Phaser.GameObjects.Rectangle; ttl: number }[] = [];
  /** 祝福「共振冲刺」：冲刺后下一次攻击强化数值。 */
  private nextAttackBoost = 0;
  /** 护盾外圈视觉。 */
  private shieldViz: Phaser.GameObjects.Arc | null = null;
  /** 祝福「氧化雾 / 腐蚀扩散」生成的持续结算场地池。 */
  private mistPools: { view: Phaser.GameObjects.Arc; halo: Phaser.GameObjects.Arc; x: number; y: number; radius: number; ttl: number; maxTtl: number; tick: number; count: number; color: number }[] = [];
  // ---- 房间链状态 ----
  private roomDef: RoomDef = generateStartRoom();
  private roomDoorTargets: RoomDef[] = [];
  private roomDoors: RoomDoor[] = [];
  private roomWaveCooldown = 0;
  private roomEnterTimer = 0;
  private roomClearTimer = 0;
  private travelTimer = 0;
  private pendingSpawns = 0;
  private runWaveCounter = 0;
  private roomClearRewardGiven = false;
  private extractionEnabled = false;
  private extractionPressureTimer = 0;
  private chest: { view: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; reward: RoomReward; gearDrop: string | null; opened: boolean } | null = null;
  private merchant: { view: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; offer: ShopOffer; bought: boolean } | null = null;
  private instrument: { view: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; offer: InstrumentOffer; used: boolean } | null = null;
  /** 染料房：染料罐 / 调色盘装置（每个 station 提供一个可吸收的染料 id） */
  private dyeStations: { x: number; y: number; dyeId: string; view: Phaser.GameObjects.Arc; halo: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }[] = [];
  /** 染料房形态：'vat' 染缸 3 选 1（填副槽/底槽），'palette' 调色盘（主+副混色填底槽） */
  /** 染料房写入的目标槽位（1 副槽 / 2 底槽） */
  /** 房间内辅助视觉对象（宝箱/商人/撤离区光效等），换房时统一销毁。 */
  private roomProps: Phaser.GameObjects.GameObject[] = [];
  /** 敌人生成预告的定时器与标记，换房时统一取消，防止旧预告在新房间落地。 */
  private spawnTelegraphs: Phaser.Time.TimerEvent[] = [];
  private telegraphMarkers: Phaser.GameObjects.Rectangle[] = [];
  private roomBannerText!: Phaser.GameObjects.Text;
  private roomTintRect!: Phaser.GameObjects.Rectangle;
  private dashCount = 0;
  private dashNextReadyTimer = 0;
  private dashWindowTimer = 0;
  private dashMotionTimer = 0;
  private playerDying = false;
  private playerOrbitState: OrbitVisualState = 'idle';
  private playerOrbitTimer = 0;
  private lastDirection = new Phaser.Math.Vector2(1, 0);
  private extractZone: Phaser.GameObjects.Rectangle | null = null;
  private extractionText: Phaser.GameObjects.Text | null = null;
  /** 当前撤离房呈现的撤离点类型（进房时按温度/试剂/Boss 进度选定，§6.4） */
  private extractionDef: ExtractionDef = EXTRACTION_DEFS.vent;
  private roomBoundaryColor = 0x67e8f9;
  private upgradeChoices: BoonDef[] = [];
  private upgradeSelectionActive = false;
  private boonPickup: { glow: Phaser.GameObjects.Arc; ring: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text; choices: BoonDef[] } | null = null;
  private ambientLight!: Phaser.GameObjects.Rectangle;
  // ---- 祝福状态（电子轨道系统） ----
  /** 氧化模式额外夺取电子数（过载打击、链式反应、玻璃大炮） */
  private boonExtraElectronOxidize = 0;
  /** 还原模式额外填充电子数（散热涂层联动） */
  private boonExtraElectronReduce = 0;
  /** 暴击时额外夺取电子数（活性位点 / 紫染·红外染） */
  private boonCritBonus = 0;
  /** 每清完房间恢复的价电子数（自修复） */
  private boonHealValencePerRoom = 0;
  /** 攻击冷却缩减%（催化加速） */
  private boonCdReduction = 0;
  /** 移动速度加成%（降低活化能） */
  private boonMoveSpeedBonus = 0;
  /** 裂变冲击：特殊攻击范围夺取数量 */
  private boonFissionCount = 0;
  /** 链式反应：弹射夺取最近敌人的电子数 */
  private boonChainCount = 0;
  /** 核聚变：特殊攻击夺取电子倍率 */
  private boonSpecialElectronMult = 1;
  /** AOE 范围倍率（橙染 / 等离子体） */
  private boonAoeMult = 1;
  /** 特殊攻击专用 AOE 倍率（v0.2.2：与 boonAoeMult 分离，避免「特殊范围+50%」误作用于普通攻击） */
  private boonSpecialAoeMult = 1;
  /** 引爆冲刺：冲刺爆炸夺取数量 */
  private boonDetonateCount = 0;
  /** 玻璃大炮：受伤额外失去价电子数 */
  private boonGlassCannonPenalty = 0;
  /** 点燃DOT：攻击附加燃烧秒数 */
  private boonIgniteDuration = 0;
  /** 酸蚀：攻击减速+DOT秒数 */
  private boonAcidDuration = 0;
  /** 腐蚀扩散：酸池每秒夺取电子数 */
  private boonCorrodeDps = 0;
  /** 等离子体：额外夺取电子数 */
  private boonPlasmaBonus = 0;
  /** 氧化雾：毒雾每秒夺取电子数 */
  private boonMistDps = 0;
  /** 散热涂层：温度上升减速% */
  private boonHeatReduction = 0;
  /** 碳键护甲：攻击回血价电子数 */
  private boonShieldHeal = 0;
  /** 晶格冲击：眩晕额外夺取电子数 */
  private boonLatticeBonus = 0;
  /** 分子壁垒：护盾墙持续秒数 */
  private boonWallDuration = 0;
  /** 碳纤冲刺：冲刺获得的护盾值 */
  private boonDashShield = 0;
  /** 活性位点：暴击概率 */
  private boonCritChanceVal = 0;
  /** 共振冲刺：下一次攻击电子倍率 */
  private boonEchoMult = 1;

  // 遗物效果字段
  private relicHealOnKill = 0;
  private relicAtkSpeedBonus = 0;
  private relicCdReduction = 0;
  private relicMaxShield = 0;
  private relicMoveSpeedBonus = 0;
  private relicOxidizeBonus = 0;
  private relicReduceBonus = 0;
  private relicCritChance = 0;
  private relicThornsChance = 0;
  private relicThornsDamage = 0;
  private relicMaxValence = 0;
  /* ── 装备（搜打撤核心循环）：出击时由携带槽汇总，死亡丢失 ── */
  private gearDamageMult = 1;
  private gearSampleMult = 1;
  private gearMoveSpeedPct = 0;
  private gearCdReduction = 0;
  private gearMaxShield = 0;
  /** 临时电子夺取倍率（共振冲刺等，攻击时设置，攻击后清除） */
  private electronMult = 1;
  /** 电子类祝福折算：每 +1 颗电子请求 → 0.35 压制概率（v0.2.2 平衡：+N 颗 ≈ +35%×N） */
  private static readonly ELECTRON_TO_PRESSURE = 0.35;
  /** 全局压制软上限：所有电子类祝福叠加后压制概率不超过此值（防 +N 颗线性爆炸） */
  private static readonly MAX_PRESSURE_BONUS = 2.2;
  /** 单次交互的电子请求上限（失控取消之外的软保险，防极端构筑瞬杀）。 */
  private static readonly MAX_ELECTRON_REQUEST = 8;
  private playerShadowOuter!: Phaser.GameObjects.Ellipse;
  private playerShadowMid!: Phaser.GameObjects.Ellipse;
  private playerShadowInner!: Phaser.GameObjects.Ellipse;
  private playerGlow!: Phaser.GameObjects.Arc;
  private playerGlowOuter!: Phaser.GameObjects.Arc;
  private playerInnerGlow!: Phaser.GameObjects.Arc;
  private waveIndex = 0;
  private waveTimer = 0;
  private waveSpawnCooldown = 0;
  private bossOrbitDmgScale = 1;
  private motionTrailTimer = 0;
  private parallaxFogLayers: Phaser.GameObjects.Arc[] = [];
  /** 战斗文本对象池：伤害数字/浮字/电子计数复用，避免频繁创建销毁 Text 造成纹理与 GC 压力。 */
  private combatTextPool: Phaser.GameObjects.Text[] = [];

  /** 地面装备掉落：稀有度光柱 + 磁吸拾取（搜打撤的「搜」可视化核心）。 */
  private gearDrops: { beam: Phaser.GameObjects.Ellipse; halo: Phaser.GameObjects.Arc; icon: Phaser.GameObjects.Text; def: import('../data/gear').GearDef; x: number; y: number }[] = [];

  /**
   * 结算战报面板（撤离成功 / 死亡丢失）：搜打撤的核心反馈，
   * 「带出了什么 / 丢了什么」必须在回到大厅前明明白白呈现。
   * @param title 标题（撤离成功 · XX / 实验事故）
   * @param colorHex 主题色（成功青绿 / 死亡红）
   * @param rows 明细行（label + 数值）
   * @param gears 装备清单（icon/name/rarity 色/是否丢失）
   * @param foot 底部注脚
   */
  private reportContinue: (() => void) | null = null;
  private reportContinueHandler: (() => void) | null = null;

  private showRunReport(
    title: string,
    colorHex: string,
    rows: { label: string; value: string; total?: boolean }[],
    gears: { id: string; lost: boolean }[],
    foot: string,
    onContinue?: () => void
  ): void {
    const overlay = document.getElementById('report-overlay');
    const panel = document.getElementById('report-panel');
    if (!overlay || !panel) return;
    // 不再自动退出：等待玩家点「继续」（或面板外暗区）
    this.reportContinue = onContinue ?? null;
    const continueHandler = (): void => {
      const cb = this.reportContinue;
      this.reportContinue = null;
      this.hideRunReport();
      cb?.();
    };
    this.reportContinueHandler = continueHandler;
    const gearHtml = gears.length === 0
      ? '<span class="report-gear none">无装备进出</span>'
      : gears.map((g) => {
          const def = getGear(g.id);
          if (!def) return '';
          const meta = GEAR_RARITY_META[def.rarity];
          return `<span class="report-gear${g.lost ? ' lost' : ''}" style="--gc:${meta.color}">${def.icon} ${def.name}${g.lost ? ' ✕' : ''}</span>`;
        }).join('');
    panel.style.setProperty('--rc', colorHex);
    panel.innerHTML = `
      <div class="report-title">${title}</div>
      <div class="report-rows">${rows.map((r) => `<div class="report-row${r.total ? ' total' : ''}"><span>${r.label}</span><b>${r.value}</b></div>`).join('')}</div>
      <div class="report-gears">${gearHtml}</div>
      <div class="report-foot">${foot}</div>
      <button id="report-continue" type="button">继 续</button>`;
    overlay.classList.add('show');
    overlay.classList.remove('fade-out');
    document.getElementById('report-continue')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reportContinueHandler?.();
    });
    overlay.onclick = (e) => {
      if (e.target === overlay) this.reportContinueHandler?.();
    };
  }

  /** 关闭战报面板（回大厅前调用）。 */
  private hideRunReport(): void {
    const overlay = document.getElementById('report-overlay');
    if (!overlay) return;
    overlay.classList.add('fade-out');
    window.setTimeout(() => overlay.classList.remove('show', 'fade-out'), 600);
  }

  /** 状态面板开关（TAB / ☰ 按钮）：打开即暂停游戏，快照当前祝福/装备/属性。 */
  private statusPanelOpen = false;
  private onStatusPanelKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    this.toggleStatusPanel();
  };

  public toggleStatusPanel(): void {
    const overlay = document.getElementById('status-overlay');
    if (!overlay) return;
    if (this.statusPanelOpen) {
      overlay.classList.remove('show');
      this.statusPanelOpen = false;
      this.scene.resume();
      return;
    }
    if (this.playerDying || this.upgradeSelectionActive) return;
    // 其它 DOM 面板（设置/染色/遗物/装备库）打开时不叠加
    if (document.querySelector('.ui-panel:not([hidden])')) return;
    this.buildStatusPanel();
    overlay.classList.add('show');
    this.statusPanelOpen = true;
    this.tutorial?.notifyStatusPanel();
    this.scene.pause();
  }

  /** 构建状态面板快照：电子状态 → 属性 → 祝福 → 装备 → 武器。 */
  private buildStatusPanel(): void {
    const body = document.getElementById('status-panel-body');
    if (!body) return;
    const st = this.electronState;
    const load = describeLoad(gameState.samples, gameState.bagCapacity);
    const pressure = 1 + this.electronPressureBonus(gameState.mode);
    const moveBonus = Math.round(this.boonMoveSpeedBonus + this.relicMoveSpeedBonus + this.gearMoveSpeedPct + st.moveSpeedBonus);
    const cdRed = Math.min(80, Math.round(this.boonCdReduction + this.relicCdReduction + this.gearCdReduction * 100 + st.cdReduction));
    const critPct = Math.round((this.boonCritChanceVal + this.relicCritChance / 100) * 100);
    const row = (label: string, value: string): string => `<div class="report-row"><span>${label}</span><b>${value}</b></div>`;
    const tempState = gameState.temperature >= 95 ? '熔毁' : gameState.temperature >= 80 ? '临界' : gameState.temperature >= 60 ? '过热' : gameState.temperature >= 20 ? '稳定' : '低温';
    const boonHtml = gameState.equippedBoons.length > 0
      ? gameState.equippedBoons.map((b) => `<span class="status-boon">${b.icon} ${b.name} <em>Lv.${b.level + 1}</em></span>`).join('')
      : '<span class="status-boon" style="border-style:dashed;opacity:.4">暂无祝福</span>';
    const gearHtml = (['armor', 'core', 'bag', 'boots'] as const).map((slot) => {
      const id = profileState.loadout[slot];
      const def = id ? getGear(id) : null;
      const meta = { armor: '🛡', core: '⚛', bag: '🎒', boots: '🥾' }[slot];
      return `<span class="status-boon${def ? '' : '" style="border-style:dashed;opacity:.4'}">${meta} ${def ? def.name : slot + ' 空'}</span>`;
    }).join('');
    const lootCount = gameState.carriedGear.length;
    const weapon = getWeapon(gameState.currentWeapon);
    const wLevel = getWeaponLevel(gameState.currentWeapon);
    body.innerHTML = `
      <div class="status-grid">
        <div class="status-col">
          <h2>电子状态</h2>
          ${row('价电子', `${gameState.valence} / ${gameState.maxValence}（氧化态 ${gameState.oxidationState}）`)}
          ${row('电子HP', `${Math.max(0, Math.ceil(gameState.ehp))} / ${gameState.ehpMax}${gameState.shieldHp > 0 ? `（护盾 ${Math.ceil(gameState.shieldHp)}）` : ''}`)}
          ${row('自由电子', `${gameState.freeElectrons} / ${gameState.maxFreeElectrons}${st.overloaded ? ' · 过载中！' : ''}`)}
          ${row('伤害倍率', `×${(st.damageMult * this.gearDamageMult * this.weaponMods.damageMult).toFixed(2)}`)}
          ${row('电子压制', `×${pressure.toFixed(2)}（伤害%已转译）`)}
          ${row('催化层数', gameState.reactionLayers + ' / ' + BALANCE.reaction.layerCap + '（伤害 +' + (BALANCE.reaction.damagePerLayer * gameState.reactionLayers * 100).toFixed(1) + '%）')}
          <h2>机动与节奏</h2>
          ${row('移速加成', `+${moveBonus}%${load.band.speedMult < 1 ? `（负载 -${Math.round((1 - load.band.speedMult) * 100)}%）` : ''}`)}
          ${row('冷却缩减', `${cdRed}%`)}
          ${row('暴击率', `${critPct}%`)}
          ${row('负载', `${load.percent}% · ${load.band.label}`)}
          ${row('温度', `${Math.round(gameState.temperature)}° · ${tempState}`)}
        </div>
        <div class="status-col">
          <h2>祝福（${gameState.equippedBoons.length}/4）</h2>
          <div class="status-boons">${boonHtml}</div>
          ${row('本局禁用', gameState.disabledBoons.map((id) => getBoonDef(id)?.name ?? id).join('、') || '无')}
          <h2>装备（携带出击 · 死亡丢失）</h2>
          <div class="status-gear">${gearHtml}</div>
          <h2>战利品</h2>
          ${row('已搜刮装备', `${lootCount} 件（撤离入库 / 死亡丢失）`)}
          ${row('携带样本', `${gameState.samples} / ${gameState.bagCapacity}`)}
          <h2>武器</h2>
          ${row('当前武器', `${weapon.name} Lv.${wLevel + 1}`)}
          ${row('样本收益', `×${this.gearSampleMult.toFixed(2)}`)}
        </div>
      </div>`;
  }
  /** UI 缩放因子（1920 设计稿基准）：内部分辨率缩小时等比缩放浮字/提示字号，保持屏幕观感。 */
  private uiScale = 1;

  /** 从池中取出一条战斗文本（无可用则新建），调用方负责用完后 recycle。 */
  private obtainCombatText(): Phaser.GameObjects.Text {
    const t = this.combatTextPool.pop();
    if (t) {
      t.setActive(true).setVisible(true);
      return t;
    }
    return this.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '22px', fontStyle: 'bold',
      color: '#FFFFFF', stroke: '#0A0E1A', strokeThickness: 4
    }).setOrigin(0.5).setDepth(999).setActive(true);
  }

  /** 回收战斗文本到池中（隐藏并停用，不再销毁）。 */
  private recycleCombatText(t: Phaser.GameObjects.Text): void {
    this.tweens.killTweensOf(t);
    t.setActive(false).setVisible(false);
    this.combatTextPool.push(t);
  }
  /** 熔毁倒计时（温度 ≥95 时 15s 一轮，到期重创玩家；设计文档 §6.1）。 */
  private meltdownTimer = 15;
  /** 临界温度（≥80）的周期性震屏计时器。 */
  private heatShakeTimer = 0;
  /** 特殊攻击"电子不足"提示的节流计时器。 */
  private specialDenyHintTimer = 0;
  /** 过载警告去重（本次过载episode只提示一次）。 */
  private overloadWasActive = false;
  /** 高温危险脉冲（单一常驻对象，程序化脉动，不逐帧创建）。 */
  private heatPulseViz!: Phaser.GameObjects.Arc;
  /** 离屏裁剪登记表：装饰/雾气等与世界无关观感的对象，出视野后跳过渲染提交。 */
  private cullables: { obj: Phaser.GameObjects.GameObject; factor: number; pad: number }[] = [];
  /** 命中定格期间的输入缓冲（攻击/冲刺各一条，定格结束立即执行）。 */
  private pendingAttackBuffered = false;
  private pendingDashBuffered = false;

  public constructor() {
    super('GameScene');
  }

  public create(): void {
    this.input.mouse?.disableContextMenu();
    resetRun();
    // 本局禁用祝福（卫戍协议「每局禁用盟约」简化版）：强制换 build 防背版
    gameState.disabledBoons = sampleDisabledBoons(BOON_POOL, BALANCE.upgrades.runDisabledCount);
    this.resetBoonState();
    // 状态面板：TAB 开关（窗口级监听，场景暂停时依然可用），遮罩点击空白处关闭
    this.input.keyboard?.addCapture('TAB');
    window.addEventListener('keydown', this.onStatusPanelKey);
    document.getElementById('status-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.toggleStatusPanel();
    });
    // 面板内常驻关闭按钮：移动端无键盘，且面板可能盖满遮罩，空白处点击不可靠
    document.getElementById('status-close')?.addEventListener('click', () => this.toggleStatusPanel());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onStatusPanelKey);
      if (this.statusPanelOpen) {
        this.statusPanelOpen = false;
        document.getElementById('status-overlay')?.classList.remove('show');
      }
      this.tutorial?.destroy();
      this.tutorial = null;
    });
    // 从 ProfileState 恢复染色工作台的染料搭配（主/副 → 混色底槽）
    const equipped = dyes.find((d) => d.id === profileState.equippedDyeId);
    if (equipped) {
      gameState.dyeSlots[0].dyeId = equipped.id;
      gameState.dyeSlots[0].purity = 1;
      const sub = dyes.find((d) => d.id === profileState.equippedDyeSubId);
      if (sub) {
        gameState.dyeSlots[1].dyeId = sub.id;
        gameState.dyeSlots[1].purity = 0.5;
        const mix = resolveMix(equipped.id, sub.id);
        if (mix) {
          gameState.dyeSlots[2].dyeId = mix.resultId;
          gameState.dyeSlots[2].purity = 0.25;
        }
      }
      gameState.dyeColor = equipped.hex;
      this.orbitColor = equipped.hex;
    }
    // 应用染色槽效果（主/副/底三槽）
    this.applyDyeSlotEffects();
    // 应用遗物效果
    this.applyRelicEffects();
    // 应用携带装备效果（搜打撤：出击前从仓库选定的 loadout）
    this.applyGearEffects();
    this.playerDying = false;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.acidPools = [];
    this.electronDrops = [];
    // 对象池随场景重启重建（旧池内是已销毁对象）
    this.combatTextPool = [];
    this.gearDrops = [];
    this.boss = null;
    this.orbitRings = [];
    this.reactionMilestoneBonus = 0;
    this.claimedMilestones = 0;
    this.sfxLimiter.reset();
    this.reactionPairs = [];
    this.dashCount = 0;
    this.dashNextReadyTimer = 0;
    this.dashWindowTimer = 0;
    this.dashMotionTimer = 0;
    // 初始即处于氧化态（base 态已移除），轨道颜色与模式一致
    this.orbitColor = 0xff8a4c;
    this.isTouch = this.sys.game.device.input.touch;
    // 移动端屏幕小、PPI 高：等比缩放后文字会小到不可读，需按实际 CSS 像素密度补偿放大
    this.uiScale = computeUiScale(currentViewportMetrics(this.scale.width, this.scale.height, this.isTouch));
    // 轨道细分按质量档（低 24 / 中 36 / 高 48），减少每帧 Graphics 重建成本
    this.orbitSegments = getVisualProfile().orbitSegments;
    this.cameras.main.setBackgroundColor('#0A0E1A');
    this.ambientLight = this.add.rectangle(this.diamondCx, this.diamondCy, this.worldWidth, this.worldHeight, 0x10253a, getVisualProfile().ambientAlpha * 1.8)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(-3);
    this.drawGrid();
    this.runSeed = Phaser.Math.Between(1, 1073741823);
    this.createAtmosphere();
    this.add.ellipse(this.diamondCx, this.diamondCy, 206, 104)
      .setStrokeStyle(8, 0x06b6d4, 0.12)
      .setAngle(-12)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.player = this.add.image(this.diamondCx, this.diamondCy, 'hydrogen-core').setDisplaySize(92, 92);
    const shadowAlpha = getVisualProfile().shadowAlpha;
    this.playerShadowOuter = this.add.ellipse(this.player.x, this.player.y + 40, 180, 54, 0x003355, shadowAlpha * 0.25)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
    this.playerShadowMid = this.add.ellipse(this.player.x, this.player.y + 38, 130, 40, 0x002244, shadowAlpha * 0.45)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
    this.playerShadowInner = this.add.ellipse(this.player.x, this.player.y + 36, 96, 30, 0x001133, shadowAlpha * 0.7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-1);
    this.player.setBlendMode(Phaser.BlendModes.ADD);
    // 真实 Glow 滤镜（WebGL + 中高质量档）：在既有硬边 ADD 光晕之上再叠一层柔和外发光
    this.playerFilterGlow = this.attachGlow(this.player);
    this.playerGlowOuter = this.add.circle(this.player.x, this.player.y, 80, this.orbitColor, 0.06)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(99);
    this.playerInnerGlow = this.add.circle(this.player.x, this.player.y, 32, this.orbitColor, 0.18)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(99);
    this.playerGlow = this.add.circle(this.player.x, this.player.y, 56, this.orbitColor, 0.12)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(99);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(true);
    this.playerBody.setDrag(BALANCE.player.stopDrag, BALANCE.player.stopDrag);
    // 基础最大速度 +15%，叠加移速加成（染料/祝福/遗物/装备）
    const baseMaxVel = Math.round(506 * (1 + (this.boonMoveSpeedBonus + this.relicMoveSpeedBonus + this.gearMoveSpeedPct) / 100));
    this.playerBody.setMaxVelocity(baseMaxVel, baseMaxVel);
    this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight);
    // 相机跟随：roundPixels=false —— 取整跟随在非整数缩放下会产生阶梯式卡顿（角色本体不抖但镜头一顿一顿）。
    // lerp 决定镜头追赶角色的紧密程度：过小会让镜头明显滞后于转向，产生"拖沓/重"的观感
    this.cameras.main.startFollow(this.player, false, 0.1, 0.1);
    // 监听窗口大小变化，调整相机缩放以扩展视野（场景停止时移除，避免跨场景残留监听）
    const gameW = this.scale.game.config.width as number;
    const gameH = this.scale.game.config.height as number;
    const onResize = (gameSize: Phaser.Structs.Size): void => {
      const cam = this.cameras.main;
      if (!cam) return;
      const scaleX = gameSize.width / gameW;
      const scaleY = gameSize.height / gameH;
      const scale = Math.max(scaleX, scaleY);
      cam.setZoom(scale);
      this.baseZoom = scale;
    };
    this.scale.on('resize', onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize);
    });
    // 初始化当前缩放
    {
      const cam = this.cameras.main;
      const scaleX = this.scale.width / gameW;
      const scaleY = this.scale.height / gameH;
      const scale = Math.max(scaleX, scaleY);
      cam.setZoom(scale);
      this.baseZoom = scale;
    }
    this.createWorldBoundary();
    this.createOrbitSystem();
    this.startRun();
    // 新手引导：在 startRun 之后启动（首次运行逐步骤引导，老玩家自动跳过）
    this.tutorial = new TutorialController(this, 'battle');
    this.tutorial.start();
    // 战斗 BGM：与大厅共享同一播放池（已在播则续播，不叠加）
    this.bgm = new BgmManager(this);
    this.bgm.start();
    this.keys = {
      up: this.input.keyboard!.addKey('W'),
      down: this.input.keyboard!.addKey('S'),
      left: this.input.keyboard!.addKey('A'),
      right: this.input.keyboard!.addKey('D')
    };
    this.interactKey = this.input.keyboard!.addKey('E');
    this.attackKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.modeKey = this.input.keyboard!.addKey('R');
    this.weaponKey = this.input.keyboard!.addKey('Q');
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() && !pointer.wasTouch) this.requestDash();
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown() || pointer.wasTouch) return;
      // 按下即出普攻（保证点击零延迟响应）；按住不放则转入蓄力，松开触发特殊攻击
      this.mouseAttackHeld = true;
      this.pressAttackFired = true;
      this.attack();
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.mouseAttackHeld = false;
    });
    this.input.on('pointerupoutside', () => { this.mouseAttackHeld = false; });
    this.roomTintRect = this.add.rectangle(this.diamondCx, this.diamondCy, this.worldWidth, this.worldHeight, 0x67e8f9, 0.05)
      .setDepth(-2).setBlendMode(Phaser.BlendModes.ADD);
    // 高温危险脉冲：常驻单对象
    this.heatPulseViz = this.add.circle(this.player.x, this.player.y, 100, 0xff4d6d, 0)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(98).setVisible(false);
    const _showHints = getSettings().hintsEnabled;
    if (_showHints) {
      const _isMob = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      this.add.text(40 * this.uiScale, 40 * this.uiScale, '反应釜 / 房间探索', {
        color: '#FFFFFF',
        fontFamily: 'monospace',
        fontSize: `${Math.round(24 * this.uiScale)}px`
      });
      this.add.text(40 * this.uiScale, 78 * this.uiScale, _isMob ? '摇杆移动   攻击   冲刺   R 状态   E 互动' : 'WASD 移动   左键/空格攻击   长按蓄力特殊攻击(消耗自由电子强化)   右键冲刺   R 状态   E 互动', {
        color: '#67E8F9',
        fontFamily: 'monospace',
        fontSize: `${Math.round(16 * this.uiScale)}px`
      });
    }
    this.scene.launch('UIScene');
    this.cameras.main.fadeIn(1200, 10, 14, 26);
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

  public update(_: number, delta: number): void {
    if (this.playerDying) {
      this.playerBody.setAcceleration(0, 0);
      return;
    }
    const dt = delta / 1000;    // 命中定格：命中瞬间短暂冻结世界，强化打击感
    // 新手引导：条件轮询 + 高亮动画（放在定格早退之前，冻结期间引导仍可见）
    this.tutorial?.update(dt);
    // 氧化态/还原态修正每帧重算：电子数变化立即反映到伤害、移速、冷却与护盾。
    // 过载是温度机制：超过第二阈值（过热线）即触发，与自由电子是否满仓无关
    this.electronState = describeElectronState(
      gameState.valence,
      gameState.maxValence,
      gameState.freeElectrons,
      gameState.maxFreeElectrons,
      gameState.temperature >= BALANCE.overload.tempThreshold
    );
    // 过载：温度超限 → 每秒自损换取伤害强化。
    // 有宽限期供玩家反应（切还原态降温是唯一解法），触发瞬间给出明确警告。
    if (this.electronState.overloaded) {
      if (!this.overloadWasActive) {
        this.overloadWasActive = true;
        this.showFloatingText(this.player.x, this.player.y - 112, '过载！温度超限', '#FF8A4C');
        this.showFloatingText(this.player.x, this.player.y - 88, `每秒自损 ${BALANCE.overload.selfDamagePerSec} · 切还原态降温`, '#94A3B8');
        this.playSfx('sfx-dd', 0.7);
      }
      this.overloadTickTimer += dt;
      if (overloadTick(this.overloadTickTimer - BALANCE.overload.graceSec)) {
        this.overloadTickTimer -= 1;
        const selfDamage = BALANCE.overload.selfDamagePerSec;
        gameState.ehp = Math.max(0, gameState.ehp - selfDamage);
        if (gameState.ehp <= 0 && !this.playerDying) this.playerDeath();
        this.showFloatingText(this.player.x, this.player.y - 92, `过载 -${selfDamage}`, '#FF8A4C');
      }
    } else {
      this.overloadWasActive = false;
      if (this.overloadTickTimer !== 0) this.overloadTickTimer = 0;
    }
    // §7 武器等级/形态修正每帧刷新（道尔顿需要当前负载比值）
    const loadRatio = gameState.bagCapacity > 0 ? gameState.samples / gameState.bagCapacity : 0;
    this.weaponMods = resolveWeaponModifiers(
      gameState.currentWeapon,
      getWeaponLevel(gameState.currentWeapon),
      getWeaponForm(gameState.currentWeapon),
      loadRatio
    );
    // 形态自损（居里 / 核素）：把"高输出"的代价做成持续压力，而不是一次性数值
    if (this.weaponMods.selfDamagePerSec > 0) {
      this.formSelfDamageTimer += dt;
      if (overloadTick(this.formSelfDamageTimer)) {
        this.formSelfDamageTimer -= 1;
        const self = this.weaponMods.selfDamagePerSec;
        gameState.ehp = Math.max(0, gameState.ehp - self);
        if (gameState.ehp <= 0 && !this.playerDying) this.playerDeath();
        this.showFloatingText(this.player.x, this.player.y - 108, `辐射 -${self}`, '#C4B5FD');
      }
    } else if (this.formSelfDamageTimer !== 0) {
      this.formSelfDamageTimer = 0;
    }
    // 屏震治理与输入缓冲必须早于定格早退推进，否则定格期间的按键会被吞掉
    this.shakeGovernor.tick(dt);
    if (this.attackBufferTimer > 0) this.attackBufferTimer = Math.max(0, this.attackBufferTimer - dt);
    if (this.dashBufferTimer > 0) this.dashBufferTimer = Math.max(0, this.dashBufferTimer - dt);
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      // 定格期间按压冷却/蓄力仍正常推进，避免攻速祝福缩短的间隔被命中定格吞掉
      this.attackTimer -= dt;
      // 输入缓冲（商业手感标准）：定格期间按下的攻击/冲刺在定格结束后立即执行
      if (Phaser.Input.Keyboard.JustDown(this.attackKey)) this.pendingAttackBuffered = true;
      if (mobileInput.dashQueued) {
        this.pendingDashBuffered = true;
        mobileInput.dashQueued = false;
      }
      resetQueuedActions();
      return;
    }
    const accelBase = gameState.mode === 'oxidized' ? BALANCE.player.accelOxidized : BALANCE.player.accelReduced;
    // §2.1 氧化态（失去价电子提速） + §4.3 负载（携带样本越多越慢）
    const speedBoon = this.boonMoveSpeedBonus + this.relicMoveSpeedBonus + this.gearMoveSpeedPct + this.electronState.moveSpeedBonus; // 移动速度加成
    const loadMult = loadSpeedMult(gameState.samples, gameState.bagCapacity);
    const accel = accelBase * (1 + speedBoon / 100) * loadMult;
    const direction = new Phaser.Math.Vector2(
      Number(this.keys.right.isDown) - Number(this.keys.left.isDown),
      Number(this.keys.down.isDown) - Number(this.keys.up.isDown)
    );
    if (mobileInput.active) {
      direction.set(mobileInput.moveX, mobileInput.moveY);
    }
    if (direction.lengthSq() > 0.001) {
      if (mobileInput.active) {
        // 移动端：拖动幅度决定加速度大小，朝向始终归一化
        const mag = direction.length();
        this.lastDirection.set(direction.x / mag, direction.y / mag);
      } else {
        direction.normalize();
        this.lastDirection.copy(direction);
      }
      // 高速度时反向移动：曾额外降低 20% 加速度以抑制飘移，但会让转向明显发钝，
      // 系数改由 balance 配置（当前 1.0 = 不做惩罚），转向灵敏度优先
      const vx = this.playerBody.velocity.x;
      const vy = this.playerBody.velocity.y;
      const speedSq = vx * vx + vy * vy;
      let effAccel = accel;
      if (speedSq > 40000) {
        const dot = (vx * direction.x + vy * direction.y) / Math.sqrt(speedSq);
        if (dot < -0.2) effAccel = accel * BALANCE.player.reverseAccelFactor;
      }
      this.playerBody.setAcceleration(direction.x * effAccel, direction.y * effAccel);
    } else {
      this.playerBody.setAcceleration(0, 0);
    }
    this.attackTimer -= dt;
    gameState.weaponSwitchCd = Math.max(0, gameState.weaponSwitchCd - dt);
    gameState.dashCd = Math.max(0, gameState.dashCd - dt);
    this.dashNextReadyTimer = Math.max(0, this.dashNextReadyTimer - dt);
    this.dashWindowTimer = Math.max(0, this.dashWindowTimer - dt);
    this.dashMotionTimer = Math.max(0, this.dashMotionTimer - dt);
    const BASE_MAX_VEL = BALANCE.player.maxVelocity;
    // 移速加成（黄染/降低活化能/电子加速器/氧化态）与 §4.3 负载同时作用于最大速度与加速度
    const maxVel = Math.round(BASE_MAX_VEL * (1 + speedBoon / 100) * loadMult);
    if (this.dashMotionTimer <= 0 && this.playerBody.maxVelocity.x !== maxVel) {
      this.playerBody.setMaxVelocity(maxVel, maxVel);
      this.playerBody.setVelocity(
        Phaser.Math.Clamp(this.playerBody.velocity.x, -maxVel, maxVel),
        Phaser.Math.Clamp(this.playerBody.velocity.y, -maxVel, maxVel)
      );
    }
    if (this.dashWindowTimer <= 0 && this.dashCount === 1) {
      this.dashCount = 0;
      // §4.3 负载：携带越重，冲刺恢复越慢；装备(靴子)可缩减
      gameState.dashCd = Math.max(gameState.dashCd, this.dashCooldownSeconds());
    }
    // 长按特殊攻击：按住即蓄力渲染（无冷却，消耗自由电子作为释放资源）；
    // 满蓄后释放必触发特殊攻击。
    // PC 鼠标左键按住与空格等效；再与实时按键状态相与，松手事件丢失也不会卡在蓄力态
    const mouseHeld = this.mouseAttackHeld && this.input.mousePointer.leftButtonDown();
    const attackHeld = this.attackKey.isDown || mouseHeld || mobileInput.attackHeld;
    const attackJustDown = attackHeld && !this.prevAttackHeld;
    if (attackJustDown) {
      // 新一轮按下：重置状态
      this.attackHoldTimer = 0;
      this.specialAttackReady = false;
      this.specialCharged = false;
    }
    if (attackHeld) {
      this.attackHoldTimer += dt;
      // 自由电子不足：无法蓄力/释放特殊攻击（节流提示，与冷却期提示同一套语言）
      if (gameState.freeElectrons <= 0) {
        this.clearSpecialChargeFx(false);
        this.specialCharged = false;
        if (this.specialDenyHintTimer <= 0) {
          this.specialDenyHintTimer = 0.9;
          this.showFloatingText(this.player.x, this.player.y - 88, '特殊攻击需要自由电子', '#94A3B8');
          this.playSfx('sfx-duong', 0.5); // 语义同 Chemic duong=失败/不足
          this.playTone(200, 0.05, 'sine', 0.03);
        }
      } else {
        this.specialDenyHintTimer = 0;
        const progress = Math.min(1, this.attackHoldTimer / SPECIAL_CHARGE_SEC);
        this.updateSpecialChargeFx(progress);
        if (progress >= 1) this.specialCharged = true;
        if (this.specialCharged) this.updateSpecialChargePulse();
      }
    } else {
      // 释放：满蓄必放特殊攻击，否则为普通攻击
      if (this.specialCharged) {
        this.clearSpecialChargeFx(true);
        this.specialAttack();
      } else if (!this.pressAttackFired && this.attackHoldTimer > 0) {
        // 鼠标在按下瞬间已出过普攻，此处不再补刀
        if (this.attackTimer <= 0) this.attack();
        else this.attackBufferTimer = ATTACK_BUFFER_SEC; // 冷却中：记入输入缓冲，冷却一结束立即补发
      }
      this.attackHoldTimer = 0;
      this.specialAttackReady = false;
      this.specialCharged = false;
      this.chargePulseSounded = false;
      this.pressAttackFired = false;
      this.clearSpecialChargeFx(false);
    }
    this.prevAttackHeld = attackHeld;
    // 输入缓冲补发：冷却结束后立刻兑现玩家"早一点点按"的意图（松手后才会补发，避免蓄力中途插入普攻）
    if (this.attackBufferTimer > 0 && this.attackTimer <= 0 && !attackHeld) {
      this.attackBufferTimer = 0;
      this.attack();
    }
    if (this.dashBufferTimer > 0 && gameState.dashCd <= 0 && this.dashCount === 0) {
      this.dashBufferTimer = 0;
      this.doDash();
    }
    // 消费命中定格期间的缓冲输入
    if (this.pendingAttackBuffered) {
      this.pendingAttackBuffered = false;
      this.attack();
    }
    if (this.pendingDashBuffered) {
      this.pendingDashBuffered = false;
      this.requestDash();
    }
    if (Phaser.Input.Keyboard.JustDown(this.modeKey) || mobileInput.modeQueued) this.toggleMode();
    if (Phaser.Input.Keyboard.JustDown(this.weaponKey) || mobileInput.weaponSwitchQueued) this.switchWeapon();
    if (mobileInput.dashQueued) this.requestDash();
    const speed = Math.hypot(this.playerBody.velocity.x, this.playerBody.velocity.y);
    // 移动残影：低质量档完全关闭（冲刺的定向残影保留）；中高质量用更淡更短的单层拖尾
    const trailEnabled = getVisualProfile().bloomEnabled;
    if (trailEnabled && speed > 80) {
      this.motionTrailTimer += dt;
      if (this.motionTrailTimer > 0.045) {
        this.motionTrailTimer = 0;
        const trail = this.add.image(this.player.x, this.player.y, 'hydrogen-core')
          .setDisplaySize(78, 78)
          .setAlpha(0.1)
          .setTint(this.orbitColor)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(this.player.depth - 1);
        this.tweens.add({ targets: trail, alpha: 0, scale: trail.scale * 0.7, duration: 140, onComplete: () => trail.destroy() });
      }
    } else {
      this.motionTrailTimer = 0;
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyProjectiles(dt);
    this.updateShieldWalls(dt);
    this.updateReactionPairs(dt);
    this.updateAcidPools(dt);
    this.updateBombs(dt);
    this.updateSmokeClouds(dt);
    this.updateMistPools(dt);
    this.updateGearDrops(dt);
    this.updateElectronDrops(dt);
    this.updateBoss(dt);
    this.updateRoom(dt);
    this.updateExtraction(dt);
    resetQueuedActions();
    this.updateBoundaryFeedback();
    this.updatePlayerAnimation(dt);
    this.enforceDiamondBounds();
    // 护盾自然衰减（v0.2.2）：停止获取即流失，护盾不再是永久存档
    if (gameState.shieldHp > 0) {
      gameState.shieldHp = Math.max(0, gameState.shieldHp - delta * BALANCE.shield.decayPerSec);
    }
    const heatRatio = Phaser.Math.Clamp(gameState.temperature / 100, 0, 1);
    const inCombat = this.countAliveHostiles() > 0;
    // 战斗外温度缓慢下降，战斗内温度上升
    if (inCombat) {
      const heatBoon = this.boonHeatReduction; // 散热涂层：升温速率降低 %
      // §7 本生灯形态：放热 +50%（伤害换温度压力）
      const rise = (dt * BALANCE.temperature.riseHeatScale * heatRatio + dt * BALANCE.temperature.riseBase) * (1 - heatBoon / 100) * this.weaponMods.heatMult;
      gameState.temperature = Math.min(100, gameState.temperature + rise);
    } // 自然散热已移除（v0.2.2）：温度只升不降——还原注入/里程碑/水池是唯一降温手段
    // 高温危险脉冲：单一常驻圆做程序化脉动（此前每帧新建圆+补间，60 个/秒叠加成红色残影涂抹）
    if (heatRatio > 0.5) {
      const pulse = (Math.sin(this.time.now * 0.006) + 1) / 2;
      this.heatPulseViz.setVisible(true)
        .setPosition(this.player.x, this.player.y)
        .setFillStyle(0xff4d6d, (heatRatio - 0.5) * 0.07)
        .setScale(1 + 0.8 * pulse);
    } else if (this.heatPulseViz.visible) {
      this.heatPulseViz.setVisible(false);
    }
    // 温度分级机制（设计文档 §6.1）：临界震屏预警 / 熔毁倒计时重创
    if (gameState.temperature >= 95) {
      this.meltdownTimer -= dt;
      if (this.meltdownTimer <= 0) {
        this.meltdownTimer = 15;
        this.showFloatingText(this.player.x, this.player.y - 96, '熔毁！', '#FF4D6D');
        this.damagePlayer();
        this.damagePlayer();
        this.damagePlayer();
        this.cameras.main.flash(300, 255, 70, 50);
        this.cameraShake(200, 0.01);
        this.playTone(60, 0.5, 'sawtooth', 0.12);
      }
    } else {
      this.meltdownTimer = 15;
    }
    if (gameState.temperature >= 80) {
      this.heatShakeTimer -= dt;
      if (this.heatShakeTimer <= 0) {
        this.heatShakeTimer = 2.2;
        this.cameraShake(120, 0.0012);
        this.playTone(180, 0.08, 'sawtooth', 0.03);
      }
    } else {
      this.heatShakeTimer = 0;
    }
    this.updateOrbitSystem(dt);
    this.updateLighting(dt);
    this.cullOffscreen();
  }

  /** 离屏裁剪：视差装饰出视野后直接隐藏，跳过渲染提交（移动端有效减负）。 */
  private cullOffscreen(): void {
    if (this.cullables.length === 0) return;
    const view = this.cameras.main.worldView;
    for (const c of this.cullables) {
      const obj = c.obj as unknown as { x: number; y: number; visible: boolean; setVisible(v: boolean): unknown };
      const pad = c.pad;
      // 视差换算：屏幕位置 = obj - scroll*(1-sf)，反向推到对象坐标系判定是否出屏
      const sf = c.factor;
      const offscreen = obj.x < view.x * sf - pad || obj.x > view.right * sf + pad
        || obj.y < view.y * sf - pad || obj.y > view.bottom * sf + pad;
      const vis = !offscreen;
      if (vis !== obj.visible) obj.setVisible(vis);
    }
  }

  /** 登记可裁剪的视差装饰（factor 为 scrollFactor，pad 为余量；出视野即隐藏跳过渲染提交）。 */
  private registerCullable(obj: Phaser.GameObjects.GameObject, factor: number, pad = 320): void {
    this.cullables.push({ obj, factor, pad });
  }

  private updateLighting(_: number): void {
    const profile = getVisualProfile();
    const heat = Phaser.Math.Clamp((gameState.temperature - 20) / 80, 0, 1);
    const dangerRed = heat > 0.5 ? (heat - 0.5) * 2 : 0;
    const modeColor = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
    const baseR = Phaser.Math.Linear(16, (modeColor >> 16) & 0xff, heat * 0.32);
    const baseG = Phaser.Math.Linear(37, (modeColor >> 8) & 0xff, heat * 0.32);
    const baseB = Phaser.Math.Linear(58, modeColor & 0xff, heat * 0.32);
    const red = Phaser.Math.Linear(baseR, 255, dangerRed * 0.4);
    const green = Phaser.Math.Linear(baseG, 40, dangerRed * 0.5);
    const blue = Phaser.Math.Linear(baseB, 30, dangerRed * 0.5);
    const ambientAlpha = getSettings().ambientEnabled ? profile.ambientAlpha + heat * 0.06 : 0;
    this.ambientLight.setFillStyle((Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue), ambientAlpha);
    const shadowOn = profile.shadowsEnabled && getSettings().shadowEnabled;
    const sa = shadowOn ? profile.shadowAlpha : 0;
    this.playerShadowOuter.setPosition(this.player.x, this.player.y + 40).setAlpha(sa * 0.25).setDepth(depthFromXZ(this.player.y, 80));
    this.playerShadowMid.setPosition(this.player.x, this.player.y + 38).setAlpha(sa * 0.45).setDepth(depthFromXZ(this.player.y, 80));
    this.playerShadowInner.setPosition(this.player.x, this.player.y + 36).setAlpha(sa * 0.7).setDepth(depthFromXZ(this.player.y, 80));
    this.playerGlow.setPosition(this.player.x, this.player.y).setFillStyle(this.orbitColor, 0.12).setDepth(depthFromXZ(this.player.y, 98));
    this.playerInnerGlow.setPosition(this.player.x, this.player.y).setFillStyle(this.orbitColor, 0.18).setDepth(depthFromXZ(this.player.y, 98));
    this.playerGlowOuter.setPosition(this.player.x, this.player.y).setFillStyle(this.orbitColor, 0.06).setDepth(depthFromXZ(this.player.y, 97));
    this.player.setDepth(depthFromXZ(this.player.y, 100));
    // Glow 滤镜颜色随状态色（氧化/还原/染色）实时同步
    if (this.playerFilterGlow) this.playerFilterGlow.color = this.orbitColor;
  }

  private apply2p5D(view: Phaser.GameObjects.GameObject & { setPosition: (x: number, y: number) => unknown; setDepth: (depth: number) => unknown; setScale: (scale: number) => unknown }, x: number, z: number, layer: number, baseScale = 1): void {
    const projected = projectXZ({ x, z }, {
      originX: 0,
      originY: 0,
      axisX: 1,
      axisZ: 0.52,
      depthScale: 0.00002
    });
    view.setPosition(projected.x, projected.y);
    view.setDepth(depthFromXZ(projected.depth, layer));
    view.setScale(baseScale * projected.scale);
  }

  private applyDepthLayer(view: Phaser.GameObjects.GameObject & { setDepth: (depth: number) => unknown }, y: number, layer: number): void {
    view.setDepth(depthFromXZ(y, layer));
  }

  /**
   * 屏震请求。强度与时长分级来自 feedback.ts，并交由 ShakeGovernor 治理：
   * 更强的冲击覆盖，更弱的冲击不打断正在进行的强震（否则连击会把爆炸震感洗掉）。
   */
  private cameraShake(duration: number, intensity: number): void {
    if (!getSettings().shakeEnabled) return;
    // Phaser 的 intensity 是相对视口宽度的比例（位移 = intensity * camera.width）。
    // 这里的换算系数决定"手感单位 → 屏幕位移"的整体幅度：系数越大晃得越狠，
    // 过大时受击会糊掉画面（看不到敌人后续动作），故整体收敛一档（时长/幅度各 -20%）。
    const applied = this.shakeGovernor.request(Math.max(1, duration * 1.6), intensity * 3.2);
    if (!applied) return;
    this.cameras.main.shake(applied.duration, applied.magnitude, true);
  }

  /** 施加命中定格：时长与「至少 2 个实际帧」取较大者（防低帧率下单帧吞掉定格）。 */
  private applyHitStop(seconds: number): void {
    const fps = this.game.loop.actualFps;
    this.hitStopTimer = Math.max(this.hitStopTimer, seconds, fps > 10 ? 2 / fps : seconds);
  }

  /** 按反馈等级施加定格 + 屏震 + 缩放冲击，集中入口避免各调用点自行拼数值。 */
  private applyFeedback(tier: FeedbackTier): void {
    // 教程条件：对敌伤害（排除玩家受击/熔毁的自伤反馈）
    if (tier !== 'playerHurt' && tier !== 'meltdown') this.tutorial?.notifyAttackHit();
    const spec = FEEDBACK[tier];
    if (spec.hitStop > 0) this.applyHitStop(spec.hitStop);
    if (spec.shakeIntensity > 0) this.cameraShake(spec.shakeDuration, spec.shakeIntensity);
    if (spec.zoomFactor > 1) this.punchZoom(spec.zoomFactor, spec.zoomDuration);
  }

  /** 当前基准缩放（随窗口尺寸/画面比例调整，zoom punch 的回弹目标）。 */
  private baseZoom = 1;

  /** 玩家核心的 Phaser 4 Filter 辉光（WebGL + 中高质量档才启用，否则为 null）。 */
  private playerFilterGlow: Phaser.Filters.Glow | null = null;
  /** 氧化态/还原态修正（§2.1）：每帧由电子账目推导，供伤害/移速/冷却/护盾/过载消费。 */
  private electronState: ElectronState = describeElectronState(1, 1, 0, 2);
  /** 反应催化：里程碑永久加成与已领进度（每局重置） */
  private reactionMilestoneBonus = 0;
  private claimedMilestones = 0;
  /** 音效四重节流（总并发/单源冷却/全局间隔/叠音上限） */
  private sfxLimiter = new SfxLimiter();
  /** 自适应难度：本局已推进房间数 / 本房间已用秒数 / 累计房间耗时 */
  private roomsCleared = 0;
  private roomElapsed = 0;
  private totalElapsed = 0;
  /** 本局地图种子：柏林噪声群系/地形/地物的生成源（每局随机） */
  private runSeed = 1;
  /** 反应层数全局伤害倍率 */
  private reactionDamageMult(): number {
    return reactionDamageMult(gameState.reactionLayers, BALANCE.reaction.damagePerLayer, this.reactionMilestoneBonus);
  }

  /** 电子转移累积催化层数：999 封顶，里程碑按序领取并结算奖励。 */
  private gainReactionLayers(gain: number): void {
    if (gain <= 0) return;
    gameState.reactionLayers = addLayers(gameState.reactionLayers, gain, BALANCE.reaction.layerCap);
    const claim = claimMilestones(gameState.reactionLayers, this.claimedMilestones, BALANCE.reaction.milestones);
    this.claimedMilestones = claim.claimedCount;
    for (const m of claim.rewards) {
      switch (m.reward) {
        case 'samples': gameState.samples = Math.min(gameState.bagCapacity, gameState.samples + m.amount); break;
        case 'electron': gameState.freeElectrons = Math.min(gameState.maxFreeElectrons, gameState.freeElectrons + m.amount); break;
        case 'cool': gameState.temperature = Math.max(0, gameState.temperature - m.amount); break;
        case 'damage': this.reactionMilestoneBonus += m.amount; break;
      }
      this.showFloatingText(this.player.x, this.player.y - 128, '⚗ 催化里程碑：' + m.label, '#5CFFB1');
      this.playSfx('sfx-liang', 0.7);
    }
  }
  /** 新手引导（仅首次运行激活，完成/跳过后永久关闭） */
  private tutorial: TutorialController | null = null;
  /** 过载自损的按秒累加器。 */
  private overloadTickTimer = 0;
  /** 当前武器的等级/形态修正（每帧刷新，供射程、范围、放热、自损消费）。 */
  private weaponMods = resolveWeaponModifiers('platinum-knife', 1, null, 0);
  /** 形态自损的按秒累加器（居里/核素）。 */
  private formSelfDamageTimer = 0;

  /**
   * 挂载 Phaser 4 的 Glow 滤镜（v4 用 Filters 取代了 v3 的 postFX）。
   *
   * 为什么不是所有对象都挂：filter 会把对象重渲染到离屏纹理再叠一层 pixi 滤镜，
   * 成本明显高于 ADD 混合的假光晕。因此只给「玩家核心 / Boss / 精英怪」这类
   * 需要质感的关键对象启用，且仅在 WebGL 与中高质量档下生效。
   */
  private attachGlow(target: Phaser.GameObjects.Image): Phaser.Filters.Glow | null {
    return this.attachGlowFor(target, this.orbitColor, 3.5);
  }

  /** 同上，但可指定颜色与强度（Boss / 精英怪使用自身主题色）。 */
  private attachGlowFor(target: Phaser.GameObjects.Image, color: number, strength: number): Phaser.Filters.Glow | null {
    const rendererType = (this.sys.game.renderer as { type?: number } | undefined)?.type;
    if (rendererType !== Phaser.WEBGL) return null;
    if (getVisualProfile().glowLayers < 3) return null;
    try {
      target.enableFilters();
      return target.filters?.internal.addGlow(color, strength, 0, 1, false, 3, 14) ?? null;
    } catch {
      // 滤镜不可用时静默回退到既有的 ADD 假光晕，不影响游戏运行
      return null;
    }
  }

  /** 播放一次玩家挤压（攻击/受击）或拉伸（冲刺），给动作加上重量感。 */
  private playPlayerSquash(strength: number, duration: number, stretch = false): void {
    // 已在播放时不打断更强烈的形变
    if (this.playerSquashTimer > 0 && duration < this.playerSquashTotal) return;
    this.playerSquashStrength = strength;
    this.playerSquashTotal = duration;
    this.playerSquashTimer = duration;
    this.playerSquashStretch = stretch;
  }

  /** 由计时器推导当前形变系数（无形变时返回 1,1）。 */
  private playerImpactScale(): { x: number; y: number } {
    if (this.playerSquashTimer <= 0 || this.playerSquashTotal <= 0) return { x: 1, y: 1 };
    const elapsed = this.playerSquashTotal - this.playerSquashTimer;
    return this.playerSquashStretch
      ? stretchCurve(elapsed, this.playerSquashTotal, this.playerSquashStrength)
      : squashCurve(elapsed, this.playerSquashTotal, this.playerSquashStrength);
  }

  /** 镜头缩放冲击：击杀/Boss 事件时短暂放大后回弹（商业动作游戏打击感标准件）。 */
  private punchZoom(factor = 1.02, duration = 130): void {
    if (!getSettings().shakeEnabled) return;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    this.tweens.add({
      targets: cam,
      zoom: this.baseZoom * factor,
      duration: Math.round(duration * 0.4),
      yoyo: true,
      ease: 'Sine.out',
      onComplete: () => cam.setZoom(this.baseZoom)
    });
  }

  private drawGrid(): void {
    // 网格光栅化到 96×48 周期贴图 + TileSprite（单四边形渲染）。
    // 此前用 Graphics 每帧重描约 2600 个菱形，是移动端最大的 CPU 渲染瓶颈。
    const texKey = 'grid-tile';
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    const halfTileW = 48;
    const halfTileH = 24;
    const canvasTex = this.textures.createCanvas(texKey, halfTileW * 2, halfTileH * 2);
    const ctx = canvasTex?.getContext();
    if (ctx && canvasTex) {
      ctx.strokeStyle = 'rgba(42, 96, 128, 0.8)';
      ctx.lineWidth = 1;
      const diamond = (cx0: number, cy0: number): void => {
        ctx.beginPath();
        ctx.moveTo(cx0, cy0 - halfTileH);
        ctx.lineTo(cx0 + halfTileW, cy0);
        ctx.lineTo(cx0, cy0 + halfTileH);
        ctx.lineTo(cx0 - halfTileW, cy0);
        ctx.closePath();
        ctx.stroke();
      };
      // 中心完整菱形 + 四角被裁切的菱形，平铺后还原完整网格晶格
      diamond(halfTileW, halfTileH);
      diamond(0, 0);
      diamond(halfTileW * 2, 0);
      diamond(0, halfTileH * 2);
      diamond(halfTileW * 2, halfTileH * 2);
      canvasTex!.refresh();
    }
    const gridTile = this.add.tileSprite(this.diamondCx, this.diamondCy, this.worldWidth, this.worldHeight, texKey)
      .setAlpha(0.55);
    // 网格呼吸：6.5s 极缓明暗振荡，实验室「通电」感（不新增绘制调用）
    this.tweens.add({
      targets: gridTile, alpha: { from: 0.45, to: 0.62 },
      duration: 6500, yoyo: true, repeat: -1, ease: 'Sine.inOut'
    });
    this.add.rectangle(this.diamondCx, this.diamondCy, this.worldWidth, this.worldHeight, 0x06131e, 0.12)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(-1);
    // Grid glow highlights at intersections
    for (let i = 0; i < 8; i += 1) {
      const gx = Phaser.Math.Between(200, this.worldWidth - 200);
      const gy = Phaser.Math.Between(200, this.worldHeight - 200);
      const glow = this.add.circle(gx, gy, 60, 0x06b6d4, 0.03)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-1);
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.015, to: 0.06 },
        scale: { from: 0.8, to: 1.6 },
        duration: Phaser.Math.Between(2000, 4000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut'
      });
    }
  }

  private createOrbitSystem(): void {
    const profile = getVisualProfile();
    const configs = [
      { radius: 96, tiltX: 0.42, spinSpeed: 0.55, speed: 1.6, phase: 0 },
      { radius: 72, tiltX: 1.08, spinSpeed: -0.85, speed: 2.4, phase: 2.1 },
      { radius: 112, tiltX: 0.78, spinSpeed: 0.32, speed: 1.05, phase: 4.3 }
    ];
    configs.forEach((config) => {
      const graphics = this.add.graphics().setDepth(-2);
      this.orbitRings.push({ ...config, spin: 0, graphics });
    });
    // 场景重启会重跑 create：销毁上一轮卫星再重建，避免池翻倍累积
    for (const sat of this.orbitElectrons) {
      sat.electron.destroy();
      sat.glow.destroy();
      sat.glowLayers.forEach((gl) => gl.destroy());
      sat.innerHalo.destroy();
      sat.outerHalo.destroy();
    }
    this.orbitElectrons = [];
    // 卫星池：5 槽位（= 商店扩容后的自由电子上限），显示数量实时跟随 gameState.freeElectrons。
    // 电子是自由电子的实体化：拾取/消耗时淡入淡出，「电子即生命」在角色身上直接可读。
    for (let i = 0; i < GameScene.ORBIT_ELECTRON_SLOTS; i += 1) {
      const glow = this.add.circle(0, 0, 18, this.orbitColor, profile.glowAlpha * 0.35)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(6);
      const electron = this.add.circle(0, 0, 6, 0xfde047)
        .setStrokeStyle(3, 0xffffff)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(6);
      const glowLayers = Array.from({ length: Math.min(profile.glowLayers, 3) }, (_, layer) =>
        this.add.circle(0, 0, 18 + layer * 14, this.orbitColor, profile.glowAlpha * (0.25 - layer * 0.06))
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(6)
      );
      const innerHalo = this.add.circle(0, 0, 12, this.orbitColor, 0.06)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(5);
      const outerHalo = this.add.circle(0, 0, 36, this.orbitColor, 0.04)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(5);
      this.orbitElectrons.push({ electron, glow, glowLayers, innerHalo, outerHalo, alpha: 0 });
      this.glowSmoothX[i] = 0;
      this.glowSmoothY[i] = 0;
    }
    this.updateOrbitSystem(0);
  }

  private projectOrbit(ring: OrbitRing, angle: number): { x: number; y: number; z: number } {
    const x1 = Math.cos(angle) * ring.radius;
    const y1 = Math.sin(angle) * ring.radius * Math.cos(ring.tiltX);
    const z1 = Math.sin(angle) * ring.radius * Math.sin(ring.tiltX);
    const cosSpin = Math.cos(ring.spin);
    const sinSpin = Math.sin(ring.spin);
    this.projTmp.x = x1 * cosSpin - y1 * sinSpin;
    this.projTmp.y = x1 * sinSpin + y1 * cosSpin;
    this.projTmp.z = z1;
    return this.projTmp;
  }

  /** projectOrbit 的复用临时对象（避免每帧 ~150 次对象分配造成 GC 压力）。 */
  private projTmp = { x: 0, y: 0, z: 0 };
  /** 轨道描边点的复用数组。 */
  private orbitPts: Phaser.Math.Vector2[] = [];

  private updateOrbitSystem(dt: number): void {
    const cx = this.player.x;
    const cy = this.player.y;
    this.playerOrbitTimer = Math.max(0, this.playerOrbitTimer - dt);
    const state: OrbitVisualState = this.playerOrbitTimer > 0 ? this.playerOrbitState : 'idle';
    const params = orbitVisualParams(state);
    const flicker = params.flicker && Math.floor(this.time.now / 60) % 2 === 0;
    const lineColor = flicker ? 0xffffff : state === 'idle' ? this.orbitColor : params.color;
    const hpRatio = gameState.ehpMax > 0 ? Phaser.Math.Clamp(gameState.ehp / gameState.ehpMax, 0, 1) : 1;
    const quality = getVisualProfile();
    const electronAlpha = Phaser.Math.Clamp((0.55 + 0.45 * hpRatio) * params.electronAlpha, 0, 1);
    const jx = params.jitter > 0 ? Phaser.Math.FloatBetween(-params.jitter, params.jitter) : 0;
    const jy = params.jitter > 0 ? Phaser.Math.FloatBetween(-params.jitter, params.jitter) : 0;
    this.orbitRings.forEach((ring) => {
      ring.spin += ring.spinSpeed * params.spinMultiplier * dt;
      ring.graphics.clear();
      ring.graphics.lineStyle(2.5, lineColor, params.lineAlpha);
      // 复用预分配的点数组，避免每帧分配 3×(segments+1) 个 Vector2
      if (this.orbitPts.length !== this.orbitSegments + 1) {
        this.orbitPts = Array.from({ length: this.orbitSegments + 1 }, () => new Phaser.Math.Vector2());
      }
      for (let index = 0; index <= this.orbitSegments; index += 1) {
        const p = this.projectOrbit(ring, (index / this.orbitSegments) * Math.PI * 2);
        this.orbitPts[index].set(cx + p.x + jx, cy + p.y + jy);
      }
      ring.graphics.strokePoints(this.orbitPts, true);
    });
    // 卫星数量 = 当前自由电子数（电子即生命的实体化），获得/消耗时淡入淡出
    const visibleCount = Phaser.Math.Clamp(gameState.freeElectrons, 0, this.orbitElectrons.length);
    this.orbitElectrons.forEach((sat, satIndex) => {
      const targetAlpha = satIndex < visibleCount ? electronAlpha : 0;
      sat.alpha += (targetAlpha - sat.alpha) * Math.min(1, dt * 14);
      if (sat.alpha < 0.02) {
        sat.electron.setVisible(false);
        sat.glow.setVisible(false);
        sat.glowLayers.forEach((g) => g.setVisible(false));
        sat.innerHalo.setVisible(false);
        sat.outerHalo.setVisible(false);
        return;
      }
      const ring = this.orbitRings[satIndex % this.orbitRings.length];
      // 同环上的卫星按可见数均分相位，多颗电子不叠影
      const angle = this.time.now * 0.001 * ring.speed + ring.phase + (satIndex * Math.PI * 2) / Math.max(visibleCount, 1);
      const p = this.projectOrbit(ring, angle);
      const depthScale = 0.8 + ((p.z / ring.radius) + 1) * 0.35;
      const targetX = cx + p.x + jx;
      const targetY = cy + p.y + jy;
      const smooth = 0.35;
      this.glowSmoothX[satIndex] += (targetX - this.glowSmoothX[satIndex]) * smooth;
      this.glowSmoothY[satIndex] += (targetY - this.glowSmoothY[satIndex]) * smooth;
      const gx = this.glowSmoothX[satIndex];
      const gy = this.glowSmoothY[satIndex];
      const a = sat.alpha;
      sat.electron
        .setVisible(true)
        .setPosition(targetX, targetY)
        .setDepth(p.z > 0 ? 7 : -4)
        .setScale(depthScale * params.electronScale)
        .setAlpha(a)
        .setFillStyle(flicker ? 0xffffff : 0xfde047);
      sat.glow
        .setVisible(true)
        .setPosition(gx, gy)
        .setDepth(p.z > 0 ? 6 : -3)
        .setScale(depthScale * params.electronScale * 1.08)
        .setFillStyle(this.orbitColor, quality.glowAlpha * 0.35)
        .setAlpha(quality.bloomEnabled ? a * quality.glowAlpha * 0.6 : 0);
      sat.glowLayers.forEach((glow, index) => {
        const enabled = quality.bloomEnabled && index < quality.glowLayers;
        glow.setVisible(true)
          .setPosition(gx, gy)
          .setDepth(p.z > 0 ? 5 : -2)
          .setScale(depthScale * params.electronScale * (1.08 + index * 0.25))
          .setFillStyle(this.orbitColor, quality.glowAlpha * (0.25 - index * 0.08))
          .setAlpha(enabled ? a * quality.glowAlpha * 0.4 / (index + 1.8) : 0);
      });
      const haloPulse = 0.8 + 0.2 * Math.sin(this.time.now * 0.003 + satIndex * 2.1);
      sat.innerHalo
        .setVisible(true)
        .setPosition(gx, gy)
        .setDepth(p.z > 0 ? 5 : -2)
        .setScale(depthScale * params.electronScale * 0.85 * haloPulse)
        .setAlpha(quality.bloomEnabled ? a * 0.08 : 0);
      sat.outerHalo
        .setVisible(true)
        .setPosition(gx, gy)
        .setDepth(p.z > 0 ? 4 : -3)
        .setScale(depthScale * params.electronScale * (2.2 + 0.3 * Math.sin(this.time.now * 0.002 + satIndex)))
        .setAlpha(quality.bloomEnabled ? a * 0.05 : 0);
    });
  }

  /** 切换玩家电子轨道的战斗状态；持续时间取较长者，避免弱反馈覆盖强反馈。 */
  private setPlayerOrbitState(state: OrbitVisualState, duration: number): void {
    this.playerOrbitState = state;
    this.playerOrbitTimer = Math.max(this.playerOrbitTimer, duration);
  }

  private diamondS(x: number, y: number): number {
    return Math.abs(x - this.diamondCx) / this.diamondA + Math.abs(y - this.diamondCy) / this.diamondB;
  }

  private clampToPlayArea(x: number, y: number, maxS = 0.85): { x: number; y: number } {
    const s = this.diamondS(x, y);
    if (s > maxS) {
      const k = maxS / s;
      const clampedX = this.diamondCx + (x - this.diamondCx) * k;
      const clampedY = this.diamondCy + (y - this.diamondCy) * k;
      console.warn(`[Boundary] 生成坐标 (${x}, ${y}) 超出菱形网格边界 (s=${s.toFixed(2)})，已修正为 (${clampedX.toFixed(0)}, ${clampedY.toFixed(0)})`);
      return { x: clampedX, y: clampedY };
    }
    return { x, y };
  }

  private enforceDiamondBounds(): void {
    const dx = this.player.x - this.diamondCx;
    const dy = this.player.y - this.diamondCy;
    const s = Math.abs(dx) / this.diamondA + Math.abs(dy) / this.diamondB;
    if (s >= 0.995) {
      const k = 0.985 / s;
      this.player.x = this.diamondCx + dx * k;
      this.player.y = this.diamondCy + dy * k;
      this.playerBody.velocity.scale(0.35);
    }
  }

  private spawnEnemy(key: string, x: number, y: number, kind: EnemyKind, hp: number, speed: number, layer: number = this.roomDef.layer, isElite = false): void {
    const pos = this.clampToPlayArea(x, y);
    const layers = Math.min(3, Math.max(1, layer + 1));
    const size = key === 'polymer' ? 132 : 116;
    const eliteScale = isElite ? 1.16 : 1;
    const aura = this.add.image(pos.x, pos.y, key)
      .setDisplaySize((size + 16) * eliteScale, (size + 16) * eliteScale)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    const enemy = this.add.image(pos.x, pos.y, key)
      .setDisplaySize(size * eliteScale, size * eliteScale)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    const glowColor = isElite
      ? 0xffb020
      : kind === 'chaser' ? 0xff5c7a : kind === 'ranged' ? 0xff8a4c : kind === 'tank' ? 0x5cffb1 : kind === 'healer' ? 0x67e8f9 : 0xfde047;
    const enemyGlow = this.add.circle(pos.x, pos.y, size * 0.75, glowColor, 0)
      .setBlendMode(Phaser.BlendModes.ADD);
    // 内外光晕 α 值仅 0.03-0.04，肉眼几乎不可见；低质量档（移动端）不创建，省 2 个绘制调用/怪
    const halosVisible = getVisualProfile().glowLayers >= 2;
    const innerHalo = this.add.circle(pos.x, pos.y, size * 0.55, glowColor, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(halosVisible);
    const outerHalo = this.add.circle(pos.x, pos.y, size * 1.1, glowColor, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(halosVisible);
    const spawnRing = this.add.circle(pos.x, pos.y, 10, glowColor, 0)
      .setStrokeStyle(3, glowColor, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: spawnRing, scale: { from: 0.3, to: 4 }, alpha: 0, duration: 500, onComplete: () => spawnRing.destroy() });
    this.tweens.add({ targets: [enemy, aura], alpha: 1, scale: { from: 0.4, to: 1 }, duration: 400, ease: 'Back.out' });
    this.tweens.add({ targets: enemyGlow, alpha: 0.08, duration: 400 });
    this.tweens.add({ targets: innerHalo, alpha: 0.04, duration: 500 });
    this.tweens.add({ targets: outerHalo, alpha: 0.03, duration: 600 });
    this.tweens.add({
      targets: [enemy, aura],
      scale: { from: 0.94 * eliteScale, to: 1.06 * eliteScale },
      angle: { from: -6, to: 6 },
      duration: 900 + Phaser.Math.Between(0, 300),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
      delay: 400
    });
    // 多层电子：层数 ≥2 时在怪上方生成可视圆点
    const layerPips: Phaser.GameObjects.Arc[] = [];
    if (layers > 1) {
      for (let i = 0; i < layers; i++) {
        const pip = this.add.circle(pos.x, pos.y - size * 0.62 - 8, 4, 0x5a8bff, 0.9)
          .setStrokeStyle(1.5, 0xbae6fd, 1)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(101);
        layerPips.push(pip);
      }
    }
    // 精英怪：旋转金色标识环
    let eliteRing: Phaser.GameObjects.Rectangle | null = null;
    if (isElite) {
      eliteRing = this.add.rectangle(pos.x, pos.y, size * eliteScale * 0.95, size * eliteScale * 0.95, 0xffb020, 0)
        .setStrokeStyle(2.5, 0xffb020, 0.85)
        .setAngle(45)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(100);
      this.tweens.add({ targets: eliteRing, angle: 405, duration: 3600, repeat: -1, ease: 'Linear' });
      this.showFloatingText(pos.x, pos.y - size, '精英', '#FFB020');
      // 精英怪数量少（每波 2-3 只），值得挂真实 Glow 滤镜与普通怪拉开质感差距
      this.attachGlowFor(enemy, 0xffb020, 5);
    }
    this.enemies.push({
      view: enemy,
      aura,
      glow: enemyGlow,
      innerHalo,
      outerHalo,
      hp,
      maxHp: hp,
      electronLayers: layers,
      layerPips,
      speed,
      kind,
      attackTimer: 1 + this.enemies.length * 0.4,
      shotTimer: 1.5,
      stunTimer: 0,
      pushX: 0,
      pushY: 0,
      orbit: createOrbit(hp, layers, BALANCE.combat.enemyHpPerElectron),
      enteredCombat: false,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitArcs: [],
      chargeTimer: 4 + Math.random() * 2,
      chargeActive: false,
      dotTimer: 0,
      dotTick: 0,
      dotDamage: 0,
      dotColor: 0,
      slowMult: 1,
      weaknessDyeId: this.getEnemyWeakness(kind),
      dead: false,
      isElite,
      eliteRing
    });
  }

  /** 根据敌人类型返回光谱弱点染料 ID。 */
  private getEnemyWeakness(kind: EnemyKind): string | null {
    switch (kind) {
      case 'chaser': return 'D01';   // 红
      case 'ranged': return 'D06';   // 蓝
      case 'tank': return 'D05';     // 青
      case 'healer': return 'D04';   // 绿
      case 'acid': return 'D03';     // 黄
      case 'sniper': return 'D02';   // 橙
      case 'summoner': return 'D07'; // 紫
      case 'shielder': return 'D08'; // 紫外
      default: return null;
    }
  }

  /** 计算攻击者对目标的光谱克制伤害加成。 */
  private getSpectralBonus(target: RuntimeEnemy): number {
    if (!target.weaknessDyeId) return 0;
    // 检查玩家当前主染料是否克制目标
    const mainDyeId = gameState.dyeSlots[0].dyeId;
    if (!mainDyeId) return 0;
    const dye = dyes.find((d) => d.id === mainDyeId);
    if (!dye) return 0;
    // 互补色克制：红↔青、蓝↔橙、绿↔紫
    const complementary: Record<string, string> = {
      D01: 'D05', D05: 'D01', D06: 'D02', D02: 'D06', D04: 'D07', D07: 'D04'
    };
    // 如果主染料的互补色 = 目标弱点，伤害+30% + 进化等级 ×6%（进化系统线性成长）
    if (complementary[mainDyeId] === target.weaknessDyeId) {
      return 0.3 + 0.06 * (gameState.dyeEvolution[mainDyeId] ?? 0);
    }
    // 如果主染料 = 目标弱点，伤害+30%
    if (mainDyeId === target.weaknessDyeId) return 0.3;
    return 0;
  }

  // ======================= 房间链 =======================

  private startRun(): void {
    this.roomDef = generateStartRoom();
    this.runWaveCounter = 0;
    this.waveIndex = 0;
    this.roomWaveCooldown = 0;
    this.roomClearTimer = 0;
    this.roomClearRewardGiven = false;
    this.enterRoom(this.roomDef);
  }

  private enterRoom(room: RoomDef): void {
    this.roomDef = room;
    gameState.roomIndex = room.depth;
    gameState.layer = room.layer;
    gameState.currentRoomType = room.type;
    gameState.roomState = 'enter';
    gameState.chosenDoor = 0;
    gameState.doorChoices = [];
    this.waveIndex = 0;
    this.roomWaveCooldown = 0;
    this.roomEnterTimer = 0.9;
    this.roomClearTimer = 0;
    this.pendingSpawns = 0;
    this.roomClearRewardGiven = false;
    this.extractionEnabled = false;
    this.extractionPressureTimer = 0;
    this.roomDoors = [];
    this.roomDoorTargets = [];
    this.chest = null;
    this.merchant = null;
    this.instrument = null;
    this.dyeStations = [];
    this.player.setPosition(this.diamondCx, this.diamondCy);
    this.playerBody.reset(this.diamondCx, this.diamondCy);
    if (room.type === 'treasure') this.spawnChest();
    if (room.type === 'shop') this.spawnMerchant();
    if (room.type === 'event') this.spawnInstrument();
    if (room.type === 'dye') this.spawnDyeRoom();
    if (room.type === 'extraction') {
      this.createExtractionZone();
      if (this.extractZone) this.extractZone.setVisible(false);
      if (this.extractionText) this.extractionText.setText(`${this.extractionDef.name}（清怪后解锁）`);
    }
    if (room.type === 'finalBoss') {
      // 最终 Boss 房：显示特殊提示
      gameState.finalBossActive = true;
      this.showRoomBanner('最终决战 · 滴定巨像', '#FF2200');
    }
    if (room.type === 'pool') {
      this.spawnPool();
    }
    this.applyRoomTheme(room);
    this.cameras.main.fadeIn(350, 10, 14, 26);
  }

  private updateRoom(dt: number): void {
    // 自适应难度计时：房间内推进秒数（战斗/撤离房均计）
    if (gameState.roomState !== 'travel') {
      this.roomElapsed += dt;
      this.totalElapsed += dt;
    }
    switch (gameState.roomState) {
      case 'enter': {
        this.roomEnterTimer -= dt;
        if (this.roomEnterTimer <= 0) {
          if (this.roomDef.type === 'combat' || this.roomDef.type === 'extraction' || this.roomDef.type === 'boss' || this.roomDef.type === 'finalBoss' || this.roomDef.type === 'elite') {
            gameState.roomState = 'combat';
            this.spawnRoomWave(this.roomDef, this.waveIndex);
          } else if (this.roomDef.type === 'pool') {
            // 水池房：自动回血，直接清空
            this.onRoomCleared();
          } else {
            this.onRoomCleared();
          }
        }
        break;
      }
      case 'combat': {
        this.roomWaveCooldown = Math.max(0, this.roomWaveCooldown - dt);
        if (this.countAliveHostiles() + this.pendingSpawns === 0 && this.roomWaveCooldown <= 0) {
          if (this.waveIndex + 1 < this.roomDef.waves.length) {
            this.waveIndex += 1;
            this.roomWaveCooldown = Math.max(BALANCE.temperature.waveCooldownMin, BALANCE.temperature.waveCooldownBase - (gameState.temperature / 100) * BALANCE.temperature.waveCooldownHeatScale);
            this.spawnRoomWave(this.roomDef, this.waveIndex);
          } else {
            this.onRoomCleared();
          }
        }
        break;
      }
      case 'cleared': {
        this.roomClearTimer -= dt;
        // 祝福光团存在时允许交互（Hades 风格：拾取后才生成出口）
        if (this.boonPickup) {
          this.updateRoomInteractions(dt);
        } else if (this.roomClearTimer <= 0) {
          if (this.roomDef.type === 'extraction') {
            this.extractionEnabled = true;
            if (this.extractZone) this.extractZone.setVisible(true);
            if (this.extractionText) this.extractionText.setText(this.extractionLabel(true));
            gameState.roomState = 'choose';
          } else if (this.roomDef.type === 'finalBoss') {
            // 最终 Boss 击败 → 通关撤离开启：搜打撤的最后一环是把成果带出去
            gameState.runComplete = true;
            this.showRoomBanner('通关！撤离点已开启 · 带走你的成果', '#FFD700');
            emit('run', { type: 'complete', kills: gameState.kills, samples: gameState.samples });
            this.createExtractionZone();
            this.extractionEnabled = true;
            gameState.roomState = 'choose';
          } else {
            this.spawnDoors();
            gameState.roomState = 'choose';
          }
        }
        break;
      }
      case 'choose':
        this.updateRoomInteractions(dt);
        break;
      case 'travel': {
        this.travelTimer -= dt;
        if (this.travelTimer <= 0) {
          // 必须先取出目标房间再清理，否则 roomDoorTargets 被清空后取到 undefined
          const next = this.roomDoorTargets[gameState.chosenDoor];
          this.tearDownRoomEntities();
          this.enterRoom(next);
        }
        break;
      }
    }
  }

  private countAliveHostiles(): number {
    return this.enemies.filter((e) => e.view.visible).length + (this.boss?.view.visible ? 1 : 0);
  }

  private spawnRoomWave(room: RoomDef, waveIdx: number): void {
    const cfg = room.waves[waveIdx];
    // 无波次配置时直接返回，交由 updateRoom 判定为已清空（避免 cfg 未定义导致更新循环崩溃）
    if (!cfg) return;
    this.runWaveCounter += 1;
    if (cfg.boss) {
      this.telegraphBossSpawn();
      return;
    }
    const hpScale = (getLayerHpScale(room.layer) + this.runWaveCounter * 0.18) * (cfg.elite ? 2 : 1);
    const speedBonus = getLayerSpeedScale(room.layer) + (cfg.elite ? 14 : 0);
    const roster = buildComposition(cfg, cfg.count, Math.random, BALANCE.combat.equivalentSwapChance);
    for (const def of roster) {
      let angle = Math.random() * Math.PI * 2;
      let dist = 600 + Math.random() * 800;
      let x = this.diamondCx + Math.cos(angle) * dist;
      let y = this.diamondCy + Math.sin(angle) * dist * 0.5;
      // 最佳实践：禁止玩家 400px 内直接刷新，重掷至多 5 次
      for (let t = 0; t < 5 && Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 400; t += 1) {
        angle = Math.random() * Math.PI * 2;
        dist = 600 + Math.random() * 800;
        x = this.diamondCx + Math.cos(angle) * dist;
        y = this.diamondCy + Math.sin(angle) * dist * 0.5;
      }
      const pos = this.clampToPlayArea(x, y);
      this.telegraphSpawn(def, pos.x, pos.y, Math.round(def.baseHp * hpScale), def.baseSpeed + speedBonus, cfg.elite ?? false);
    }
    const layerStr = getLayerName(room.layer);
    this.showRoomBanner(`⚡ 波 ${waveIdx + 1}/${room.waves.length} · ${layerStr}`, '#FDE047');
  }

  /** 敌人生成预告：红色菱形标记 0.7s 后实体化（最佳实践：危险可预判） */
  private telegraphSpawn(def: RoomEnemyDef, x: number, y: number, hp: number, speed: number, isElite = false): void {
    const marker = this.add.rectangle(x, y, 46, 46, 0xff4d6d, 0.55)
      .setAngle(45).setStrokeStyle(3, isElite ? 0xffb020 : 0xff4d6d, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(8);
    this.tweens.add({ targets: marker, alpha: { from: 0.4, to: 0.9 }, scale: { from: 0.8, to: 1.15 }, duration: 350, yoyo: true, repeat: 1 });
    this.telegraphMarkers.push(marker);
    this.pendingSpawns += 1;
    const timer = this.time.delayedCall(700, () => {
      marker.destroy();
      this.telegraphMarkers = this.telegraphMarkers.filter((m) => m !== marker);
      this.spawnEnemy(def.key, x, y, def.kind, hp, speed, this.roomDef.layer, isElite);
      this.pendingSpawns -= 1;
    });
    this.spawnTelegraphs.push(timer);
  }

  private telegraphBossSpawn(): void {
    const pos = this.clampToPlayArea(this.diamondCx, this.diamondCy - 700);
    const marker = this.add.rectangle(pos.x, pos.y, 150, 150, 0xff4d6d, 0.45)
      .setAngle(45).setStrokeStyle(5, 0x9d4edd, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(8);
    this.tweens.add({ targets: marker, alpha: { from: 0.3, to: 0.8 }, scale: { from: 0.7, to: 1.1 }, duration: 450, yoyo: true, repeat: 1 });
    this.telegraphMarkers.push(marker);
    this.pendingSpawns += 1;
    const timer = this.time.delayedCall(900, () => {
      marker.destroy();
      this.telegraphMarkers = this.telegraphMarkers.filter((m) => m !== marker);
      this.pendingSpawns -= 1;
      this.trySpawnBoss();
    });
    this.spawnTelegraphs.push(timer);
  }

  private onRoomCleared(): void {
    this.roomClearTimer = 0.45;
    this.roomClearRewardGiven = true;
    // 自适应难度：通关越快 → 升温越多（快节奏推高压，慢节奏给缓冲）
    this.roomsCleared += 1;
    this.applyPacingHeat();
    this.playSfx('sfx-ding', 0.9);
    emit('room', { type: 'cleared', roomIndex: gameState.roomIndex, roomType: this.roomDef.type, layer: gameState.layer });
    // 祝福「自修复」：每清完房间恢复HP（数值随强化等级提升）
    if (this.boonHealValencePerRoom > 0) {
      const heal = Math.round(this.boonHealValencePerRoom);
      gameState.ehp = Math.min(gameState.ehpMax, gameState.ehp + heal);
      this.showFloatingText(this.player.x, this.player.y - 60, `+${heal} HP`, '#5CFFB1');
    }
    const layerStr = this.roomDef.type === 'finalBoss' ? '最终决战' : getLayerName(gameState.layer);
    this.showRoomBanner(`${layerStr} · 房间清空 · 出口已解锁`, '#5CFFB1');
    // 精英房：清空即结算样本奖励，并掉落一件装备（搜打撤的「搜」）
    if (this.roomDef.type === 'elite' && this.roomDef.reward) {
      this.applyReward(this.roomDef.reward, '精英房');
      if (this.roomDef.gearDrop) this.spawnGearDrop(this.roomDef.gearDrop, this.player.x + Phaser.Math.Between(-160, 160), this.player.y + Phaser.Math.Between(-110, 110));
    }
    // 战斗房/精英房清空后刷新普通祝福光团；Boss 房给「觉醒祝福」（特殊池，见 SPECIAL_BOONS）
    if (this.roomDef.type === 'combat' || this.roomDef.type === 'boss' || this.roomDef.type === 'elite') {
      gameState.roomState = 'cleared';
      this.roomClearTimer = 999; // 阻止 cleared case 提前触发
      const isBoss = this.roomDef.type === 'boss';
      this.time.delayedCall(400, () => this.spawnBoonPickup(isBoss ? this.rollSpecialChoices(3) : this.rollBoonChoices(3), isBoss));
    } else {
      gameState.roomState = 'cleared';
    }
  }

  /**
   * 自适应难度：按本房间清空的快慢给温度压力。
   * 快（< par 秒）= 高压，慢（> par ×2）= 低压，形成「推进越快越危险」的节奏曲线。
   */
  private applyPacingHeat(): void {
    const par = BALANCE.temperature.pacingParSeconds;
    const ratio = Phaser.Math.Clamp(this.roomElapsed / Math.max(1, par), 0, 3);
    // 快 → 接近 maxRise；慢 → 衰减到 minRise
    const t = Phaser.Math.Clamp(1 - (ratio - 0.5) / 1.5, 0, 1);
    const rise = BALANCE.temperature.pacingMinRise
      + (BALANCE.temperature.pacingMaxRise - BALANCE.temperature.pacingMinRise) * t;
    gameState.temperature = Phaser.Math.Clamp(gameState.temperature + rise, 0, 100);
    this.roomElapsed = 0;
  }

  private showRoomBanner(text: string, color: string): void {
    const flash = this.add.text(this.diamondCx, this.diamondCy - 160, text, {
      color, fontFamily: 'monospace', fontSize: `${Math.round(30 * this.uiScale)}px`
    }).setOrigin(0.5).setDepth(9999).setAlpha(0);
    this.tweens.add({
      targets: flash, alpha: { from: 0, to: 1 }, y: flash.y - 30, duration: 500, ease: 'Cubic.out',
      onComplete: () => this.tweens.add({
        targets: flash, alpha: 0, y: flash.y - 20, duration: 800, delay: 600, onComplete: () => flash.destroy()
      })
    });
  }

  /** Hades 式祝福选择：战斗/ Boss 房清空后弹出 3 选 1（水平横条布局） */
  private showUpgradeSelection(): void {
    this.upgradeSelectionActive = true;
    if (this.upgradeChoices.length === 0) this.upgradeChoices = this.rollBoonChoices(3);

    const overlay = document.getElementById('upgrade-overlay');
    const cards = document.getElementById('upgrade-cards');
    const title = document.getElementById('upgrade-title');
    const subtitle = document.getElementById('upgrade-subtitle');
    if (!overlay || !cards) return;
    cards.innerHTML = '';

    // 标题显示学派名（三个祝福取第一个的学派）
    const firstSchool = this.upgradeChoices[0].school;
    const schoolColor = SCHOOL_COLORS[firstSchool];
    if (title) {
      title.textContent = SCHOOL_SYMBOLS[firstSchool] + ' ' + SCHOOL_NAMES[firstSchool];
      title.style.setProperty('--school-color', schoolColor.light);
      title.style.setProperty('--school-glow', schoolColor.glow);
    }
    if (subtitle) subtitle.textContent = '选择一项祝福';

    this.upgradeChoices.forEach((boon, i) => {
      const school = SCHOOL_COLORS[boon.school];
      const rarityColor = RARITY_COLORS[boon.rarity];
      const equipped = gameState.equippedBoons.find((b) => b.slot === boon.slot);
      const sameId = gameState.equippedBoons.find((b) => b.id === boon.id);
      const slotName = SLOT_NAMES[boon.slot];
      const slotIcon = SLOT_ICONS[boon.slot];

      // 强化预览：同祝福已装备且未满级时，展示强化后的效果数值
      let desc = formatBoonDesc(boon);
      let replaceHtml = equipped ? `<div class="card-replace">⚠ 替换 ${slotName}：${equipped.name}</div>` : '';
      if (sameId) {
        if (sameId.level < 2) {
          const nextLevel = sameId.level + 1;
          const nextVal = this.boonRarityValue(boon, nextLevel);
          desc = formatBoonDesc({ ...boon, rarityScale: { ...boon.rarityScale, [boon.rarity]: nextVal } });
          replaceHtml = `<div class="card-replace" style="color:#5CFFB1">⬆ 强化 ${boon.name} → Lv.${nextLevel + 1}</div>`;
        } else {
          replaceHtml = `<div class="card-replace" style="color:#94a3b8">${boon.name} 已满级</div>`;
        }
      }

      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.style.setProperty('--card-color', school.light);
      card.style.setProperty('--card-glow', school.glow);
      card.style.setProperty('--rarity-color', rarityColor);
      card.innerHTML = `
        <div class="card-icon-top">${SCHOOL_SYMBOLS[boon.school]}</div>
        <div class="card-name">${boon.name}${sameId ? ` <span style="color:#5CFFB1">Lv.${sameId.level + 1}</span>` : ''}</div>
        <div class="card-rarity" style="background:${rarityColor};color:#06111d">${RARITY_LABELS[boon.rarity]}</div>
        <div class="card-desc">${desc}</div>
        ${replaceHtml}
        <div class="card-slot-icon">${slotIcon}</div>
      `;
      card.addEventListener('click', () => this.selectUpgrade(i));
      cards.appendChild(card);
    });

    overlay.classList.add('show');
    overlay.classList.remove('fade-out');

    const skipBtn = document.getElementById('upgrade-skip');
    if (skipBtn) {
      skipBtn.onclick = () => this.closeBoonOverlay();
    }
  }

  /** 关闭祝福选择面板（跳过时调用） */
  private closeBoonOverlay(): void {
    if (!this.upgradeSelectionActive) return;
    this.upgradeSelectionActive = false;

    const overlay = document.getElementById('upgrade-overlay');
    const getEl = document.getElementById('upgrade-get');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.classList.remove('show', 'fade-out');
        document.querySelectorAll('.upgrade-card').forEach((c) =>
          c.classList.remove('selected', 'not-selected')
        );
      }, 450);
    }
    if (getEl) getEl.className = '';
    this.upgradeChoices = [];
    this.roomClearTimer = 0.1;
    emit('state-changed');
  }

  /** 生成祝福选项：排除已满级（Lv.3）的祝福，避免玩家选到无收益的选项。 */
  private rollBoonChoices(count: number): BoonDef[] {
    const maxed = new Set(gameState.equippedBoons.filter((b) => b.level >= 2).map((b) => b.id));
    for (const id of gameState.disabledBoons) maxed.add(id); // 本局禁用祝福不进卡池
    const picked = pickBoons(count, Math.random, maxed);
    return picked.length > 0 ? picked : pickBoons(count);
  }

  /** 抽取觉醒祝福：排除已拥有的，每局各一次。 */
  private rollSpecialChoices(count: number): BoonDef[] {
    return rollSpecialChoices(count, gameState.ownedSpecialBoons);
  }

  private selectUpgrade(index: number): void {
    if (!this.upgradeSelectionActive || index >= this.upgradeChoices.length) return;
    this.upgradeSelectionActive = false;
    const boon = this.upgradeChoices[index];
    const school = SCHOOL_COLORS[boon.school];
    this.playSfx('sfx-ga', 0.8); // 语义同 Chemic ga=合成成功
    this.time.delayedCall(160, () => this.playSfx('sfx-liang', 0.8)); // 升级清脆音

    // 重复祝福 → 强化（最多 Lv.3）；新祝福 → 替换同槽位旧祝福
    const existing = gameState.equippedBoons.find((b) => b.id === boon.id);
    let getLabel: string;
    if (existing) {
      if (existing.level < 2) {
        this.revertBoonEffect(boon, existing.level);
        existing.level += 1;
        this.applyBoonEffect(boon, existing.level);
        getLabel = `${boon.icon} ${boon.name} Lv.${existing.level + 1} 强化!`;
      } else {
        getLabel = `${boon.icon} ${boon.name} 已满级`;
      }
    } else {
      const replaced = gameState.equippedBoons.find((b) => b.slot === boon.slot);
      if (replaced) {
        const replacedDef = getBoonDef(replaced.id);
        if (replacedDef) this.revertBoonEffect(replacedDef, replaced.level);
      }
      const isSpecial = SPECIAL_BOONS.some((b) => b.id === boon.id);
      if (isSpecial) {
        // 觉醒祝福：独立槽位互不替换，每局各一次
        gameState.ownedSpecialBoons.push(boon.id);
        gameState.equippedBoons.push({ id: boon.id, name: boon.name, icon: boon.icon, slot: boon.slot, school: boon.school, level: 0 });
        this.applyBoonEffect(boon, 0);
        getLabel = `✦ ${boon.icon} ${boon.name} 觉醒!`;
      } else if (replaced && gameState.extraBoonSlots > 0) {
        // 「祝福槽位 +1」觉醒：新祝福不替换旧祝福，消耗一次额外槽位并存
        gameState.extraBoonSlots -= 1;
        gameState.equippedBoons.push({ id: boon.id, name: boon.name, icon: boon.icon, slot: boon.slot, school: boon.school, level: 0 });
        this.applyBoonEffect(boon, 0);
        getLabel = `${boon.icon} ${boon.name}（启用额外槽位，余 ${gameState.extraBoonSlots}）`;
      } else {
        if (replaced) {
          const replacedDef = getBoonDef(replaced.id);
          if (replacedDef) this.revertBoonEffect(replacedDef, replaced.level);
        }
        gameState.equippedBoons = gameState.equippedBoons.filter((b) => b.slot !== boon.slot);
        gameState.equippedBoons.push({ id: boon.id, name: boon.name, icon: boon.icon, slot: boon.slot, school: boon.school, level: 0 });
        this.applyBoonEffect(boon, 0);
        getLabel = `${boon.icon} ${boon.name}`;
      }
    }

    // 卡片选择动画
    const cards = document.querySelectorAll('.upgrade-card');
    cards.forEach((card, i) => {
      if (i === index) {
        card.classList.add('selected');
      } else {
        card.classList.add('not-selected');
      }
    });

    // 显示获得提示
    const getEl = document.getElementById('upgrade-get');
    if (getEl) {
      getEl.style.setProperty('--get-color', school.light);
      getEl.textContent = getLabel;
      getEl.className = 'show';
    }

    this.playSfx('sfx-click', 0.8);
    hapticHit();

    // Phaser 侧特效
    const flash = this.add.circle(this.diamondCx, this.diamondCy, 60, school.primary, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(220);
    this.tweens.add({ targets: flash, scale: { from: 0.3, to: 5 }, alpha: 0, duration: 500, onComplete: () => flash.destroy() });

    // 淡出面板
    this.time.delayedCall(600, () => {
      const overlay = document.getElementById('upgrade-overlay');
      if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => {
          overlay.classList.remove('show', 'fade-out');
          cards.forEach((c) => c.classList.remove('selected', 'not-selected'));
        }, 450);
      }
      if (getEl) getEl.className = '';
      this.upgradeChoices = [];
      this.roomClearTimer = 0.1;
      emit('state-changed');
    });
  }

  /** 是否装备了指定祝福。 */
  private hasBoon(id: string): boolean {
    return gameState.equippedBoons.some((b) => b.id === id);
  }

  /** 指定祝福在强化等级下的生效数值（未装备返回 0）。 */
  private boonValue(id: string): number {
    if (!this.hasBoon(id)) return 0;
    const def = getBoonDef(id);
    if (!def) return 0;
    return this.boonRarityValue(def, this.getBoonLevel(id));
  }

  /** 祝福强化等级（0-2）。 */
  private getBoonLevel(id: string): number {
    return gameState.equippedBoons.find((b) => b.id === id)?.level ?? 0;
  }

  /**
   * 祝福在指定强化等级下的数值。
   * 取「稀有度阶梯」与「每级 +50% 线性成长」中的较大值，保证每级强化都有实际提升。
   * level=0 时即该祝福的基础数值（与原行为一致）。
   */
  private boonRarityValue(def: BoonDef, level: number): number {
    const order: BoonRarity[] = ['common', 'rare', 'epic', 'mythic'];
    const baseIdx = Math.max(0, order.indexOf(def.rarity));
    const base = def.rarityScale[def.rarity];
    const ladder = def.rarityScale[order[Math.min(order.length - 1, baseIdx + level)]];
    return Math.max(ladder, base * (1 + 0.5 * level));
  }

  /** 重置所有祝福状态字段（新局/重生时调用）。 */
  private resetBoonState(): void {
    this.boonExtraElectronOxidize = 0;
    this.boonExtraElectronReduce = 0;
    this.boonCritBonus = 0;
    this.boonHealValencePerRoom = 0;
    this.boonCdReduction = 0;
    this.boonMoveSpeedBonus = 0;
    this.boonFissionCount = 0;
    this.boonChainCount = 0;
    this.boonSpecialElectronMult = 1;
    this.boonAoeMult = 1;
    this.boonSpecialAoeMult = 1;
    this.boonDetonateCount = 0;
    this.boonGlassCannonPenalty = 0;
    this.boonIgniteDuration = 0;
    this.boonAcidDuration = 0;
    this.boonCorrodeDps = 0;
    this.boonPlasmaBonus = 0;
    this.boonMistDps = 0;
    this.boonHeatReduction = 0;
    this.boonShieldHeal = 0;
    this.boonLatticeBonus = 0;
    this.boonWallDuration = 0;
    this.boonDashShield = 0;
    this.boonCritChanceVal = 0;
    this.boonEchoMult = 1;
    // 遗物效果重置
    this.relicHealOnKill = 0;
    this.relicAtkSpeedBonus = 0;
    this.relicCdReduction = 0;
    this.relicMaxShield = 0;
    this.relicMoveSpeedBonus = 0;
    this.relicOxidizeBonus = 0;
    this.relicReduceBonus = 0;
    this.relicCritChance = 0;
    this.relicThornsChance = 0;
    this.relicThornsDamage = 0;
    this.relicMaxValence = 0;
  }

  /** 护盾上限：基础 100 + 遗物/装备加成，再乘 §2.1 还原态的自由电子加成。 */
  private shieldCap(): number {
    // v0.2.2：基础护盾上限 100 → 10（冲刺/攻击刷盾不再无敌）
    const base = BALANCE.shield.baseMax + this.relicMaxShield + this.gearMaxShield;
    return Math.round(base * (1 + this.electronState.shieldBonusPct / 100));
  }
  /** 上次获得同源护盾的时间（收益递减窗口判定）。 */
  private lastShieldGainAt = -9999;
  /** 护盾获取：上限约束 + 1.2s 窗口内重复获取收益减半（反「一直冲刺无敌」）。 */
  private gainShield(amount: number, source: string): void {
    const now = this.time.now;
    const sinceLast = now - this.lastShieldGainAt;
    let gain = amount;
    if (sinceLast < BALANCE.shield.refreshWindowSec * 1000) {
      gain = Math.max(1, Math.floor(gain * 0.5));
    }
    this.lastShieldGainAt = now;
    gameState.shieldHp = Math.min(this.shieldCap(), gameState.shieldHp + gain);
    this.showFloatingText(this.player.x, this.player.y - 62, `护盾+${gain}`, '#34D399');
  }

  /** 冲刺冷却 = §4.3 负载倍率 × 装备(靴子)冷却缩减。 */
  private dashCooldownSeconds(): number {
    return BALANCE.dash.cooldownSeconds * loadDashCdMult(gameState.samples, gameState.bagCapacity) * (1 - this.gearCdReduction);
  }

  /**
   * 电子压制加成（本作伤害模型的统一转译）：
   * 游戏以「电子」为单位造成伤害，纯粹的 HP 伤害%几乎无效，
   * 因此所有百分比加成（氧化态/装备/武器形态/等级）统一转译为——
   * 每次氧化命中按 (倍率-1) 额外夺取电子、还原命中额外注入电子
   * （≥1 保底，小数部分按概率掷出），让「伤害越高 → 拆电子越快」真实成立。
   */
  private electronPressureBonus(mode: 'oxidized' | 'reduced'): number {
    const w = this.weaponMods;
    // 压制软上限：所有加成叠加后不超过 MAX_PRESSURE_BONUS（v0.2.2：+N 颗不再线性爆炸）
    const clampPressure = (value: number): number => Math.min(GameScene.MAX_PRESSURE_BONUS, value);
    const evolutionLevels = Object.values(gameState.dyeEvolution ?? {}).reduce((sum, v) => sum + v, 0);
    const mult = this.electronState.damageMult * this.gearDamageMult * w.damageMult
      * (1 + evolutionLevels * 0.01)
      * this.reactionDamageMult()
      * (mode === 'oxidized' ? w.oxidizeMult : w.reduceMult);
    return clampPressure(Math.max(0, mult - 1));
  }

  /** 电子压制结算：夺取（负向 delta）或注入（正向）n 颗，≥1 保底 + 小数概率。 */
  private applyElectronPressure(
    orbit: OrbitState,
    mode: 'oxidized' | 'reduced',
    onElectron: () => void,
    onInertify?: () => void
  ): void {
    // v0.2.2：软上限——单次交互最多请求 8 颗（此前叠满增益可到 15+，直接瞬杀多层怪）
    let pressure = Math.min(GameScene.MAX_ELECTRON_REQUEST, this.electronPressureBonus(mode) * this.electronMult);
    while (pressure >= 1) {
      pressure -= 1;
      if (mode === 'oxidized') {
        if (orbit.count <= 0) return;
        annihilatePair(orbit);
        this.gainReactionLayers(1);
        onElectron();
      } else {
        // 秒杀防护（v0.2.2）：距容量 ≤1 时注入只造成「饱和吸收」（过量试剂），
        // 不计数、不惰化——高电子数怪不再被还原攻击单点秒杀
        if (orbit.count >= orbit.capacity - 1) {
          onElectron();
          return;
        }
        const result = captureElectron(orbit);
        onElectron();
        if (result.inertified && onInertify) {
          onInertify();
          return;
        }
      }
    }
    if (pressure > 0 && Math.random() < pressure) {
      if (mode === 'oxidized') {
        if (orbit.count <= 0) return;
        annihilatePair(orbit);
        this.gainReactionLayers(1);
        onElectron();
      } else {
        // 秒杀防护（同上）：饱和吸收不惰化
        if (orbit.count >= orbit.capacity - 1) {
          onElectron();
          return;
        }
        const result = captureElectron(orbit);
        onElectron();
        if (result.inertified && onInertify) onInertify();
      }
    }
  }

  /**
   * 应用携带装备（搜打撤的「带」）：护甲换生存、核心换输出、背包换容量、靴子换机动。
   * 每次开局重算（直接赋值而非累加），保证反复进出局不会叠加。
   */
  private applyGearEffects(): void {
    const eff = getLoadoutEffects();
    this.gearDamageMult = eff.damageMult;
    this.gearSampleMult = eff.sampleMult;
    this.gearMoveSpeedPct = eff.moveSpeedPct;
    this.gearCdReduction = eff.dashCdReduce;
    this.gearMaxShield = eff.maxShield;
    // 背包容量与最大 EHP 是即时生效的派生值：扩容直接降低 §4.3 负载档位
    gameState.bagCapacity += eff.bagCapacity;
    gameState.ehpMax += eff.maxEhp;
    gameState.ehp = gameState.ehpMax;
    if (this.gearMaxShield > 0) {
      gameState.shieldHp = Math.min(gameState.shieldHp + this.gearMaxShield, this.shieldCap());
    }
  }

  /** 根据激活的遗物（单个），累积效果到状态字段。 */
  private applyRelicEffects(): void {
    const active = getActiveRelicDef();
    if (active) {
      this.applySingleRelicEffect(active.id, getRelicLevel(active.id));
    }
    // 应用护盾上限
    if (this.relicMaxShield > 0) {
      gameState.shieldHp = Math.min(gameState.shieldHp, this.shieldCap());
    }
    // 应用价电子上限（+n，叠在基础 1 上；撤离充能/水池/商人按此上限恢复）
    if (this.relicMaxValence > 0) {
      gameState.maxValence += this.relicMaxValence;
    }
  }

  private applySingleRelicEffect(relicId: string, level: number): void {
    const def = relicDefs.find((r) => r.id === relicId);
    if (!def) return;
    const effect = def.tiers[Math.min(level, 2)];
    switch (effect.type) {
      case 'heal_on_kill': this.relicHealOnKill += effect.value; break;
      case 'atk_speed': this.relicAtkSpeedBonus += effect.value; break;
      case 'cd_reduction': this.relicCdReduction += effect.value; break;
      case 'max_shield': this.relicMaxShield += effect.value; break;
      case 'move_speed': this.relicMoveSpeedBonus += effect.value; break;
      case 'oxidize_bonus': this.relicOxidizeBonus += effect.value; break;
      case 'reduce_bonus': this.relicReduceBonus += effect.value; break;
      case 'crit_chance': this.relicCritChance += effect.value; break;
      case 'thorns':
        // 反弹概率 = value%；反弹比例 = value/60（30%→50%、45%→75%、60%→100% 所受伤害）
        this.relicThornsChance += effect.value;
        this.relicThornsDamage = effect.value / 60;
        break;
      case 'max_valence': this.relicMaxValence += effect.value; break;
    }
  }

  /** 根据染色槽中装备的染料，累积加成到 boon state。 */
  private applyDyeSlotEffects(): void {
    const { dyeSlots } = gameState;
    for (let i = 0; i < dyeSlots.length; i++) {
      const slot = dyeSlots[i];
      if (!slot.dyeId) continue;
      const dye = getDye(slot.dyeId);
      if (!dye) continue;
      const mult = DYE_SLOT_MULTIPLIERS[i] ?? 0.25;
      this.applyDyeEffect(dye.effectType, dye.effectValue * mult);
      // 混色染料携带的第二条效果（主/副色各贡献一份）
      if (dye.secondEffect) this.applyDyeEffect(dye.secondEffect.type, dye.secondEffect.value * mult);
    }
  }

  /** 把单条染料效果按数值累加到对应状态字段。 */
  private applyDyeEffect(type: DyeEffectType, amount: number): void {
    switch (type) {
      case 'electron_ox':
        this.boonExtraElectronOxidize += amount;
        break;
      case 'electron_re':
        this.boonExtraElectronReduce += amount;
        break;
      case 'speed':
        this.boonMoveSpeedBonus += amount;
        break;
      case 'dot':
        this.boonIgniteDuration += amount;
        break;
      case 'cd':
        this.boonCdReduction += amount;
        break;
      case 'crit_bonus':
        this.boonCritBonus += amount;
        break;
      case 'armor_break':
        this.boonExtraElectronOxidize += amount;
        break;
      case 'aoe':
        this.boonAoeMult += amount;
        break;
      case 'temp':
        this.boonHeatReduction += amount;
        break;
    }
  }

  /**
   * 对敌人施加电子 DOT 效果：每隔 intervalMs 执行一次 callback（夺取电子）。
   * 持续 duration 秒。
   */
  private applyDotEffect(target: RuntimeEnemy, duration: number, intervalMs: number, callback: (t: RuntimeEnemy) => void): void {
    // 描述为「{n} 秒内每秒夺取 1 颗」→ 共结算 n 次（首个 tick 在 1 个间隔之后）
    const ticks = Math.max(1, Math.round((duration * 1000) / intervalMs));
    this.time.addEvent({
      delay: intervalMs,
      repeat: ticks - 1,
      callback: () => {
        if (!target.view.visible || !target.orbit || target.orbit.count <= 0) return;
        callback(target);
      }
    });
  }

  /**
   * 应用祝福效果到 gameState 和内部状态字段。
   * @param level 强化等级（0-2）
   * @param sign  1=应用，-1=回退（强化前先回退旧等级，保证净增量为新等级-旧等级）
   */
  private applyBoonEffect(boon: BoonDef, level = 0, sign = 1): void {
    const v = this.boonRarityValue(boon, level);
    switch (boon.id) {
      // ===== 觉醒祝福（Boss 后 · 独立槽位）=====
      case 'sp-vitality':
        gameState.ehpMax += sign * 20;
        gameState.ehp = Math.min(gameState.ehpMax, gameState.ehp + sign * 20);
        break;
      case 'sp-awaken':
        gameState.extraBoonSlots += sign;
        break;
      case 'sp-capacity':
        gameState.maxFreeElectrons = Math.min(6, gameState.maxFreeElectrons + sign);
        break;
      case 'sp-might':
        this.reactionMilestoneBonus += sign * 0.08;
        break;
      case 'sp-swift':
        this.boonMoveSpeedBonus += sign * 10;
        break;
      // ===== 氢·爆裂 (H) =====
      case 'h-atk-overload':
        // v0.2.2 平衡：+N 颗 → N × 0.35 压制概率（而非直接 +N 颗请求）
        this.boonExtraElectronOxidize += sign * v * GameScene.ELECTRON_TO_PRESSURE;
        break;
      case 'h-atk-chain':
        this.boonChainCount += sign * v;
        break;
      case 'h-sp-fission':
        this.boonFissionCount += sign * v;
        break;
      case 'h-sp-nuke':
        // 基准倍率 1，强化即叠加超出部分
        this.boonSpecialElectronMult += sign * (v - 1);
        break;
      case 'h-dash-detonate':
        this.boonDetonateCount += sign * v;
        break;
      case 'h-pass-glass':
        this.boonExtraElectronOxidize += sign * v * GameScene.ELECTRON_TO_PRESSURE;
        this.boonGlassCannonPenalty += sign;
        break;
      // ===== 氧·氧化 (O) =====
      case 'o-atk-ignite':
        this.boonIgniteDuration += sign * v;
        break;
      case 'o-atk-acid':
        this.boonAcidDuration += sign * v;
        break;
      case 'o-sp-corrode':
        this.boonCorrodeDps += sign * v;
        break;
      case 'o-sp-plasma':
        this.boonPlasmaBonus += sign * v;
        // 「特殊攻击范围 +50%」——固定 +50%，与强化等级无关
        // 等离子体「特殊攻击范围 +50%」：只作用于特殊攻击
        this.boonSpecialAoeMult += sign * 0.5;
        break;
      case 'o-dash-mist':
        this.boonMistDps += sign * v;
        break;
      case 'o-pass-temp':
        this.boonHeatReduction += sign * v;
        break;
      // ===== 碳·结构 (C) =====
      case 'c-atk-shield':
        this.boonShieldHeal += sign * v;
        break;
      case 'c-atk-lattice':
        this.boonLatticeBonus += sign * v;
        break;
      case 'c-sp-wall':
        this.boonWallDuration += sign * v;
        break;
      case 'c-sp-fortify':
        gameState.maxValence += sign * v;
        gameState.valence = Math.max(1, gameState.valence + sign * v);
        gameState.ehpMax = gameState.valence * 80;
        gameState.ehp = gameState.ehpMax;
        break;
      case 'c-dash-barrier':
        this.boonDashShield += sign * v;
        break;
      case 'c-pass-heal':
        this.boonHealValencePerRoom += sign * v;
        break;
      // ===== 催化剂 (cat) =====
      case 'cat-atk-speed':
        this.boonCdReduction += sign * v;
        break;
      case 'cat-atk-crit':
        this.boonCritChanceVal += sign * (v / 100);
        this.boonCritBonus += sign;
        break;
      case 'cat-sp-homing':
        break;
      case 'cat-sp-multi':
        break;
      case 'cat-dash-echo':
        // 基准倍率 1，强化即叠加超出部分
        this.boonEchoMult += sign * (v - 1);
        break;
      case 'cat-pass-movespeed':
        this.boonMoveSpeedBonus += sign * v;
        break;
    }
  }

  /** 回退指定等级的祝福效果（强化前调用，与 applyBoonEffect 严格对称）。 */
  private revertBoonEffect(boon: BoonDef, level: number): void {
    if (boon.id.startsWith('sp-')) {
      this.applyBoonEffect(boon, level, -1);
      return;
    }
    this.applyBoonEffect(boon, level, -1);
  }

  /**
   * 从敌人轨道直接夺取 count 颗电子。
   * 裂变冲击 / 等离子体 / 核聚变 / 毒雾·酸池 的公共出口。
   */
  private stealElectrons(target: RuntimeEnemy, count: number, color = '#FF5C7A'): void {
    if (!target.orbit || target.dead || !target.view.visible) return;
    const n = Math.floor(count);
    // 失控取消：对高储备目标单发夺取超限 → 整击取消（卫戍协议「取消而非截断」）
    if (isRunawayCancel(n, target.orbit.count, target.orbit.capacity, {
      threshold: BALANCE.combat.runawayCancelThreshold,
      fullRatio: BALANCE.combat.runawayFullRatio
    })) {
      this.showFloatingText(target.view.x, target.view.y - 70, '⚠ 临界失控 · 反应取消', '#FF4D6D');
      this.playSfx('sfx-duong', 0.8);
      emit('reaction', { type: 'runaway' });
      return;
    }
    let stolen = 0;
    for (let i = 0; i < n && target.orbit.count > 0; i++) {
      annihilatePair(target.orbit);
      stolen += 1;
      this.showElectronDelta(target.view.x + (i + 1) * 12, target.view.y - 56, -1, color);
    }
    this.gainReactionLayers(stolen);
    if (target.orbit.count <= 0) this.breakLayerOrKill(target);
  }

  /**
   * 特殊攻击命中结算：裂变冲击（范围夺取）、核聚变（本次夺取倍率）、等离子体（命中额外夺取）。
   * 由激光与旋风斩在命中敌人时调用。
   */
  private onSpecialHit(target: RuntimeEnemy, x: number, y: number): void {
    // 裂变冲击：以命中点为中心，对范围内敌人各夺取 n 颗电子
    if (this.boonFissionCount > 0) {
      const radius = FISSION_RADIUS * this.boonSpecialAoeMult;
      for (const enemy of this.enemies) {
        if (!enemy.view.visible || !enemy.orbit || !enemy.enteredCombat) continue;
        const d = Phaser.Math.Distance.Between(x, y, enemy.view.x, enemy.view.y);
        if (d > radius + enemy.view.displayWidth / 2) continue;
        this.stealElectrons(enemy, this.boonFissionCount * this.boonSpecialElectronMult, '#FF5C7A');
      }
      const ring = this.add.circle(x, y, radius, 0xff5c7a, 0)
        .setStrokeStyle(3, 0xff5c7a, 0.7)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);
      this.tweens.add({
        targets: ring,
        scale: { from: 0.45, to: 1.05 },
        alpha: { from: 0.9, to: 0 },
        duration: 340,
        onComplete: () => ring.destroy()
      });
    }
    // 核聚变：特殊攻击夺取电子数 ×n —— 以额外夺取的形式补齐基准 1 颗之外的差额
    const nukeExtra = Math.floor(this.boonSpecialElectronMult) - 1;
    if (nukeExtra > 0) this.stealElectrons(target, nukeExtra, '#FF6B35');
    // 等离子体：命中额外夺取 n 颗电子
    if (this.boonPlasmaBonus > 0) {
      this.stealElectrons(target, this.boonPlasmaBonus * this.boonSpecialElectronMult, '#67E8F9');
    }
  }

  private spawnDoors(): void {
    const targets = generateRoomDoors(this.roomDef);
    this.roomDoorTargets = targets;
    gameState.doorChoices = targets.map((t) => t.type);
    const n = targets.length;
    const baseY = this.diamondCy - 860;
    targets.forEach((target, i) => {
      const pos = this.clampToPlayArea(this.diamondCx + (i - (n - 1) / 2) * 330, baseY, 0.82);
      const theme = ROOM_THEMES[target.type];
      const platform = this.add.ellipse(pos.x, pos.y, 150, 70, theme.boundary, 0.16)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
      this.tweens.add({
        targets: platform,
        alpha: { from: 0.1, to: 0.28 },
        scaleX: { from: 0.9, to: 1.15 },
        scaleY: { from: 0.85, to: 1.1 },
        duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut'
      });
      const icon = this.add.text(pos.x, pos.y - 30, theme.icon, {
        color: `#${theme.boundary.toString(16).padStart(6, '0')}`,
        fontFamily: 'monospace', fontSize: '34px'
      }).setOrigin(0.5).setDepth(6);
      const extra = target.type === 'finalBoss' ? ' 最终决战' : target.type === 'boss' ? ' Boss' : '';
      const layerHint = target.layer !== this.roomDef.layer ? ` · ${getLayerName(target.layer)}` : '';
      const label = this.add.text(pos.x, pos.y + 28, `${theme.banner}${extra}${layerHint} [E]`, {
        color: '#D4E8EE', fontFamily: 'monospace', fontSize: '17px'
      }).setOrigin(0.5).setDepth(6);
      this.roomDoors.push({ x: pos.x, y: pos.y, target, platform, icon, label });
    });
  }

  private updateRoomInteractions(_dt: number): void {
    const interactPressed = Phaser.Input.Keyboard.JustDown(this.interactKey) || mobileInput.interactQueued;
    // 祝福光团拾取
    if (this.boonPickup) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.boonPickup.glow.x, this.boonPickup.glow.y) < 150;
      this.boonPickup.label.setAlpha(near ? 1 : 0);
      if (near && interactPressed) {
        resetQueuedActions();
        this.collectBoonPickup();
        return;
      }
    }
    for (let i = 0; i < this.roomDoors.length; i += 1) {
      const door = this.roomDoors[i];
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, door.x, door.y) < 180;
      door.label.setAlpha(near ? 1 : 0.6);
      if (near && interactPressed) {
        resetQueuedActions();
        gameState.chosenDoor = i;
        gameState.roomState = 'travel';
        this.travelTimer = 0.35;
        this.cameras.main.fadeOut(300, 10, 14, 26);
        this.playSfx('sfx-switch', 0.6);
        return;
      }
    }
    if (this.chest && !this.chest.opened) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.chest.view.x, this.chest.view.y) < 150;
      this.chest.label.setAlpha(near ? 1 : 0.6);
      if (near && interactPressed) {
        resetQueuedActions();
        this.openChest();
        return;
      }
    }
    if (this.merchant && !this.merchant.bought) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.merchant.view.x, this.merchant.view.y) < 150;
      this.merchant.label.setAlpha(near ? 1 : 0.6);
      if (near && interactPressed) {
        resetQueuedActions();
        this.buyFromMerchant();
      }
    }
    if (this.instrument && !this.instrument.used) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.instrument.view.x, this.instrument.view.y) < 150;
      this.instrument.label.setAlpha(near ? 1 : 0.6);
      if (near && interactPressed) {
        resetQueuedActions();
        this.useInstrument();
      }
    }
    for (const station of this.dyeStations) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, station.x, station.y) < 150;
      station.label.setAlpha(near ? 1 : 0.55);
      if (near && interactPressed) {
        resetQueuedActions();
        this.absorbDye(station.dyeId);
        return;
      }
    }
  }

  /**
   * 染料房（设计文档 §10.4）：
   * - 副槽/底槽有空位 → 染缸，摆放 3 个染料罐供 3 选 1
   * - 两槽已满 → 调色盘，把主槽 + 副槽混色写入底槽
   */
  private spawnDyeRoom(): void {
    const offer = this.roomDef.dye;
    if (!offer || offer.choices.length === 0) return;
    // 进化系统：染色房 = 获得染料 → 喂养进化（colorist 式：染料喂养载体，属性随等级线性成长）
    const n = offer.choices.length;
    const baseY = this.diamondCy - 420;
    offer.choices.forEach((dyeId, i) => {
      const dye = getDye(dyeId);
      if (!dye) return;
      const hex = parseInt(dye.color.replace('#', ''), 16);
      const pos = this.clampToPlayArea(this.diamondCx + (i - (n - 1) / 2) * 340, baseY);
      const halo = this.add.circle(pos.x, pos.y, 46, hex, 0.16)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      this.tweens.add({ targets: halo, scale: { from: 0.9, to: 1.3 }, alpha: { from: 0.1, to: 0.26 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      const view = this.add.circle(pos.x, pos.y, 30, hex, 0.42)
        .setStrokeStyle(3, hex, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
      const lvl = gameState.dyeEvolution[dyeId] ?? 0;
      const label = this.add.text(pos.x, pos.y - 74,
        dye.name + ' 染料 [E]\n' + dye.effect + '\n进化 Lv.' + lvl + ' → ' + (lvl + 1), {
          color: dye.color, fontFamily: 'monospace', fontSize: '16px', align: 'center'
        }).setOrigin(0.5).setDepth(7);
      this.dyeStations.push({ x: pos.x, y: pos.y, dyeId, view, halo, label });
    });
  }

  /** 吸收染料 → 进化等级 +1（线性属性成长），随后清空所有装置。 */
  private absorbDye(dyeId: string): void {
    const dye = getDye(dyeId);
    if (!dye) return;
    // 进化：等级 +1 → 该染料效果 +30% 基准值（colorist 式喂养）
    gameState.dyeEvolution[dyeId] = (gameState.dyeEvolution[dyeId] ?? 0) + 1;
    const lvl = gameState.dyeEvolution[dyeId];
    this.applyDyeEffect(dye.effectType, dye.effectValue * 0.3);
    if (dye.secondEffect) this.applyDyeEffect(dye.secondEffect.type, dye.secondEffect.value * 0.3);
    // 主槽联动：同色则纯度随等级成长；首次吸收自动设为主染料
    if (!gameState.dyeSlots[0].dyeId) {
      gameState.dyeSlots[0].dyeId = dyeId;
      gameState.dyeSlots[0].purity = 0.5;
      gameState.dyeColor = dye.hex;
      this.orbitColor = gameState.dyeColor;
    } else if (gameState.dyeSlots[0].dyeId === dyeId) {
      gameState.dyeSlots[0].purity = Math.min(1, gameState.dyeSlots[0].purity + 0.15);
    }
    this.showFloatingText(this.player.x, this.player.y - 78, dye.name + ' 进化 Lv.' + lvl, dye.color);
    emit('dye', { name: dye.name + '（进化 Lv.' + lvl + '）' });
    this.playSfx('sfx-ding', 0.9);
    this.playTone(880, 0.14, 'sine', 0.06);
    for (const station of this.dyeStations) {
      station.view.destroy();
      station.halo.destroy();
      station.label.destroy();
    }
    this.dyeStations = [];
  }

  /**
   * 将染料写入指定槽位并按槽位权重立即生效：
   * 先撤销旧染料的加成，再写入新染料并重新加成（保证增量对称、可反复替换）。
   */
  private applyDyeToSlot(slotIndex: number, dyeId: string): void {
    const dye = getDye(dyeId);
    if (!dye) return;
    this.applyDyeSlotDelta(slotIndex, -1);
    gameState.dyeSlots[slotIndex].dyeId = dyeId;
    gameState.dyeSlots[slotIndex].purity = DYE_SLOT_MULTIPLIERS[slotIndex];
    this.applyDyeSlotDelta(slotIndex, 1);
    if (slotIndex === 0) gameState.dyeColor = dye.hex;
  }

  /** 单槽染料效果的增量应用：sign = +1 加成 / -1 撤销（供中途替换染料使用）。 */
  private applyDyeSlotDelta(slotIndex: number, sign: number): void {
    const slot = gameState.dyeSlots[slotIndex];
    if (!slot.dyeId) return;
    const dye = getDye(slot.dyeId);
    if (!dye) return;
    const mult = DYE_SLOT_MULTIPLIERS[slotIndex] ?? 0.25;
    this.applyDyeEffect(dye.effectType, dye.effectValue * mult * sign);
    if (dye.secondEffect) this.applyDyeEffect(dye.secondEffect.type, dye.secondEffect.value * mult * sign);
  }

  /** 事件房：化学仪器（设计文档 §10.3），随机取一台，一次性交互。 */
  private spawnInstrument(): void {
    const offer = this.roomDef.instrument;
    if (!offer) return;
    const pos = this.clampToPlayArea(this.diamondCx, this.diamondCy - 500);
    const view = this.add.rectangle(pos.x, pos.y, 110, 82, 0xe879f9, 0.12)
      .setStrokeStyle(3, 0xe879f9, 0.95).setDepth(6);
    const glow = this.add.ellipse(pos.x, pos.y + 34, 130, 54, 0xe879f9, 0.15)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    this.tweens.add({ targets: glow, alpha: { from: 0.1, to: 0.26 }, scaleX: { from: 0.9, to: 1.2 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.roomProps.push(glow);
    const icon = this.add.text(pos.x, pos.y - 8, offer.icon, {
      color: '#F5D0FE', fontFamily: 'monospace', fontSize: '30px'
    }).setOrigin(0.5).setDepth(7);
    this.roomProps.push(icon);
    const label = this.add.text(pos.x, pos.y - 62, `${offer.name} [E]\n${offer.desc}`, {
      color: '#E879F9', fontFamily: 'monospace', fontSize: '16px', align: 'center'
    }).setOrigin(0.5).setDepth(7);
    this.instrument = { view, label, offer, used: false };
  }

  /** 使用仪器：结算温度/样本/还原充能，然后销毁装置。 */
  private useInstrument(): void {
    if (!this.instrument || this.instrument.used) return;
    const { offer } = this.instrument;
    this.instrument.used = true;
    if (offer.temperature !== 0) {
      gameState.temperature = Phaser.Math.Clamp(gameState.temperature + offer.temperature, 0, 100);
      this.showFloatingText(this.player.x, this.player.y - 96,
        `${offer.temperature > 0 ? '+' : ''}${offer.temperature}°C`,
        offer.temperature > 0 ? '#FF8A4C' : '#67E8F9');
    }
    if (offer.samples !== 0) {
      gameState.samples = Math.max(0, gameState.samples + offer.samples);
      this.showFloatingText(this.player.x, this.player.y - 60, `样本 +${offer.samples}`, '#FDE047');
    }
    if (offer.refill) {
      gameState.valence = gameState.maxValence;
      gameState.ehp = gameState.ehpMax;
      this.showFloatingText(this.player.x, this.player.y - 60, '还原充能 · 电子回满', '#5CFFB1');
      this.spawnElectronFlow(this.player.x + 60, this.player.y - 40, this.player.x, this.player.y, 0x5cffb1, 6);
    }
    this.playSfx('sfx-ding', 0.9);
    if (offer.samples > 0) emit('treasure', { kind: 'samples', amount: offer.samples });
    const { view, label } = this.instrument;
    this.tweens.add({ targets: [view, label], alpha: 0, scale: 1.3, duration: 260, onComplete: () => {
      view.destroy();
      label.destroy();
    } });
    this.instrument = null;
  }

  private spawnChest(): void {
    const pos = this.clampToPlayArea(this.diamondCx, this.diamondCy - 500);
    // 等距底座 + 发光箱体 + 浮动图标 + 扫描光带（美术规范：交互对象双层描边+扫描光带）
    const platform = this.add.ellipse(pos.x, pos.y + 34, 170, 64, 0xfde047, 0.07)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
    const view = this.add.rectangle(pos.x, pos.y, 96, 64, 0xfde047, 0.12)
      .setStrokeStyle(3, 0xfde047, 0.95).setDepth(6);
    const innerStroke = this.add.rectangle(pos.x, pos.y, 78, 48, 0xfff7c2, 0)
      .setStrokeStyle(1.5, 0xfff7c2, 0.55).setDepth(6);
    const glow = this.add.ellipse(pos.x, pos.y + 30, 120, 50, 0xfde047, 0.15)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    this.roomProps.push(platform, glow, innerStroke);
    this.tweens.add({ targets: glow, alpha: { from: 0.1, to: 0.25 }, scaleX: { from: 0.9, to: 1.2 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.tweens.add({ targets: view, scaleY: { from: 1, to: 1.04 }, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    // 扫描光带：自下而上掠过箱体
    const scan = this.add.rectangle(pos.x, pos.y + 20, 88, 3, 0xfff7c2, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
    this.roomProps.push(scan);
    this.tweens.add({ targets: scan, y: pos.y - 26, alpha: { from: 0.5, to: 0 }, duration: 1300, repeat: -1, delay: 300, ease: 'Sine.inOut' });
    // 环绕金色微尘
    for (let i = 0; i < 4; i += 1) {
      const spark = this.add.circle(pos.x + Phaser.Math.Between(-40, 40), pos.y + Phaser.Math.Between(-16, 20), 2, 0xffe9a3, 0.8)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
      this.roomProps.push(spark);
      this.tweens.add({ targets: spark, y: spark.y - 34, alpha: 0, duration: 1400 + i * 260, repeat: -1, delay: i * 380, ease: 'Sine.out' });
    }
    const label = this.add.text(pos.x, pos.y - 56, '🧰 宝箱 [E]', {
      color: '#FDE047', fontFamily: 'monospace', fontSize: '18px'
    }).setOrigin(0.5).setDepth(7);
    this.roomProps.push(label);
    this.chest = { view, label, reward: this.roomDef.reward ?? { kind: 'samples', amount: 3 }, gearDrop: this.roomDef.gearDrop, opened: false };
  }

  /** Hades 风格：房间清空后刷新祝福光团，玩家走近按 E 拾取后弹出选择 UI */
  private spawnBoonPickup(choices: BoonDef[], special = false): void {
    const firstSchool = choices[0].school;
    const school = special ? { primary: 0xfde047, light: '#FDE047' } : SCHOOL_COLORS[firstSchool];
    const pos = this.clampToPlayArea(this.diamondCx + (Math.random() - 0.5) * 200, this.diamondCy - 200);

    // 外层光晕
    const glow = this.add.circle(pos.x, pos.y, 48, school.primary, 0.18)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(10);
    this.tweens.add({ targets: glow, scale: { from: 0.9, to: 1.3 }, alpha: { from: 0.12, to: 0.28 }, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.roomProps.push(glow);

    // 内圈旋转环
    const ring = this.add.circle(pos.x, pos.y, 28, school.primary, 0)
      .setStrokeStyle(3, school.primary, 0.9).setDepth(11);
    this.tweens.add({ targets: ring, angle: 360, duration: 4000, repeat: -1, ease: 'Linear' });
    this.roomProps.push(ring);

    // 中心符号
    const symbol = this.add.circle(pos.x, pos.y, 18, school.primary, 0.35)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(12);
    this.tweens.add({ targets: symbol, alpha: { from: 0.3, to: 0.7 }, duration: 800, yoyo: true, repeat: -1 });
    this.roomProps.push(symbol);

    // 提示文字
    const label = this.add.text(pos.x, pos.y - 60, special ? '✦ 觉醒祝福 [E]' : '祝福 [E]', {
      color: school.light, fontFamily: 'monospace', fontSize: special ? '18px' : '16px'
    }).setOrigin(0.5).setDepth(13).setAlpha(0);
    this.roomProps.push(label);

    this.boonPickup = { glow, ring, label, choices };
  }

  /** 拾取祝福光团 → 弹出选择 UI → 选完后生成出口门 */
  private collectBoonPickup(): void {
    if (!this.boonPickup) return;
    this.upgradeChoices = this.boonPickup.choices;
    const school = SCHOOL_COLORS[this.upgradeChoices[0].school];

    // 光团收缩消失
    const { glow, ring } = this.boonPickup;
    this.tweens.add({ targets: [glow, ring], scale: 0, alpha: 0, duration: 250, ease: 'Back.easeIn',
      onComplete: () => { glow.destroy(); ring.destroy(); }
    });
    this.boonPickup.label.destroy();
    this.boonPickup = null;

    // 播放音效
    this.playSfx('sfx-ka', 0.8);
    this.playSfx('sfx-ding', 0.7);

    // 延迟弹出选择 UI
    this.time.delayedCall(300, () => this.showUpgradeSelection());
  }

  /** 水池房：玩家接触水池恢复 HP 和降低温度（仅触发一次） */
  private spawnPool(): void {
    const pos = this.clampToPlayArea(this.diamondCx, this.diamondCy);
    // 水池主体
    const pool = this.add.ellipse(pos.x, pos.y, 220, 140, 0x06b6d4, 0.12)
      .setStrokeStyle(4, 0x34d399, 0.9).setDepth(5);
    // 水池光晕
    const poolGlow = this.add.ellipse(pos.x, pos.y + 10, 260, 160, 0x34d399, 0.08)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
    this.roomProps.push(pool, poolGlow);
    this.tweens.add({ targets: poolGlow, alpha: { from: 0.05, to: 0.15 }, scaleX: { from: 0.95, to: 1.1 }, duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    // 水波纹动画
    for (let i = 0; i < 3; i += 1) {
      const ripple = this.add.circle(pos.x, pos.y, 30 + i * 25, 0x34d399, 0)
        .setStrokeStyle(2, 0x34d399, 0.4).setDepth(5);
      this.tweens.add({
        targets: ripple,
        scale: { from: 0.5, to: 2.5 },
        alpha: { from: 0.4, to: 0 },
        duration: 2500,
        delay: i * 800,
        repeat: -1,
        onComplete: () => ripple.destroy()
      });
    }
    const label = this.add.text(pos.x, pos.y - 90, '恢复水池', {
      color: '#34d399', fontFamily: 'monospace', fontSize: '22px'
    }).setOrigin(0.5).setDepth(7);
    const hint = this.add.text(pos.x, pos.y + 80, '接触恢复 HP · 降温', {
      color: '#6ee7b7', fontFamily: 'monospace', fontSize: '14px'
    }).setOrigin(0.5).setDepth(7).setAlpha(0.7);
    this.roomProps.push(label, hint);
    // 仅触发一次的恢复
    let poolUsed = false;
    this.time.addEvent({
      delay: 100,
      repeat: -1,
      callback: () => {
        if (!pool.active || poolUsed) return;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, pos.x, pos.y);
        if (d < 120) {
          poolUsed = true;
          // 完全恢复 HP
          gameState.ehp = gameState.ehpMax;
          // 恢复丢失的价电子
          if (gameState.valence < gameState.maxValence) {
            gameState.valence = gameState.maxValence;
          }
          // 降温
          gameState.temperature = Math.max(0, gameState.temperature - 30);
          // 视觉反馈
          this.showFloatingText(pos.x, pos.y - 60, '完全恢复', '#34d399');
          const flash = this.add.circle(pos.x, pos.y, 120, 0x34d399, 0.35)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);
          this.tweens.add({ targets: flash, scale: { from: 0.5, to: 2.5 }, alpha: 0, duration: 600, onComplete: () => flash.destroy() });
          // 水池变暗表示已使用
          pool.setAlpha(0.3);
          poolGlow.setAlpha(0.03);
          hint.setText('已使用').setAlpha(0.4);
          hapticHit();
        }
      }
    });
  }

  private openChest(): void {
    if (!this.chest || this.chest.opened) return;
    this.chest.opened = true;
    this.chest.label.setText('已开启');
    const reward = this.chest.reward;
    const x = this.chest.view.x;
    const y = this.chest.view.y;
    const burst = this.add.circle(x, y, 20, 0xfde047, 0)
      .setStrokeStyle(4, 0xfde047, 0.95).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: burst, scale: { from: 0.4, to: 3 }, alpha: 0, duration: 400, ease: 'Cubic.out', onComplete: () => burst.destroy() });
    this.cameraShake(60, 0.002);
    this.playSfx('sfx-click', 0.8);
    this.applyReward(reward, '宝箱');
    if (this.chest.gearDrop) this.spawnGearDrop(this.chest.gearDrop, x, y + 70);
    emit('treasure', { kind: reward.kind, amount: reward.amount });
  }

  /**
   * 获得一件装备战利品（搜打撤的「搜」）：
   * 暂存于 gameState.carriedGear，撤离成功才写入局外仓库，死亡则丢失。
   */
  private gainGearLoot(id: string, x: number, y: number): void {
    const def = getGear(id);
    if (!def) return;
    gameState.carriedGear.push(id);
    this.showFloatingText(x, y - 30, `装备 ${def.name}（撤离带出）`, GEAR_RARITY_META[def.rarity].color);
    this.playSfx('sfx-liang', 0.8);
    this.playTone(1320, 0.08, 'sine', 0.05);
  }

  /** 生成地面装备掉落：稀有度光柱 + 底部光环 + 浮动图标，玩家靠近磁吸拾取。 */
  private spawnGearDrop(id: string, x: number, y: number): void {
    const def = getGear(id);
    if (!def) return;
    const pos = this.clampToPlayArea(x, y);
    const rarityColor = GEAR_RARITY_META[def.rarity].color;
    const rarityHex = parseInt(rarityColor.slice(1), 16);
    // 稀有度光柱：自地面向上的竖直光带（搜打撤远距离可见性的标准信号）
    const beam = this.add.ellipse(pos.x, pos.y, 26, 240, rarityHex, 0.16)
      .setOrigin(0.5, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(7);
    this.tweens.add({ targets: beam, alpha: { from: 0.08, to: 0.22 }, scaleX: { from: 0.85, to: 1.12 }, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const halo = this.add.arc(pos.x, pos.y, 26, rarityHex, 0.25)
      .setStrokeStyle(2.5, rarityHex, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(7);
    this.tweens.add({ targets: halo, scale: { from: 2.4, to: 1 }, alpha: { from: 0, to: 1 }, duration: 320, ease: 'Cubic.out' });
    const icon = this.add.text(pos.x, pos.y - 30, def.icon, {
      fontFamily: 'monospace', fontSize: '22px', color: rarityColor,
      stroke: '#0A0E1A', strokeThickness: 3
    }).setOrigin(0.5).setDepth(8);
    this.gearDrops.push({ beam, halo, icon, def, x: pos.x, y: pos.y });
    this.playSfx('sfx-ziya', 0.5);
  }

  /** 地面装备更新：磁吸 + 拾取（与自由电子同一套手感参数）。 */
  private updateGearDrops(delta: number): void {
    this.gearDrops = this.gearDrops.filter((drop) => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.x, drop.y);
      if (dist < 170 && dist > 1) {
        const pull = 260 + (170 - dist) * 3.2;
        const ang = Phaser.Math.Angle.Between(drop.x, drop.y, this.player.x, this.player.y);
        drop.x += Math.cos(ang) * pull * delta;
        drop.y += Math.sin(ang) * pull * delta;
      }
      // 图标浮动（程序化，避免补间与磁吸位移互相覆盖）
      const bob = Math.sin(this.time.now * 0.004) * 6;
      drop.beam.setPosition(drop.x, drop.y);
      drop.halo.setPosition(drop.x, drop.y);
      drop.icon.setPosition(drop.x, drop.y - 30 - bob);
      if (dist >= 52) return true;
      this.gainGearLoot(drop.def.id, drop.x, drop.y);
      const pop = this.add.circle(drop.x, drop.y, 24, parseInt(GEAR_RARITY_META[drop.def.rarity].color.slice(1), 16), 0.4)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);
      this.tweens.add({ targets: pop, scale: 2.4, alpha: 0, duration: 260, onComplete: () => pop.destroy() });
      drop.beam.destroy();
      drop.halo.destroy();
      drop.icon.destroy();
      return false;
    });
  }

  private applyReward(reward: RoomReward, source: string): void {
    const x = this.player.x;
    const y = this.player.y - 62;
    if (reward.kind === 'samples') {
      // 装备「样本收益」加成统一作用于所有样本获取点（击杀/奖励/Boss/撤离）
      const amount = Math.round(reward.amount * this.gearSampleMult);
      gameState.samples += amount;
      this.showFloatingText(x, y, `${source} +${amount} 样本`, '#FDE047');
    } else if (reward.kind === 'freeElectron') {
      gainFreeElectrons(reward.amount);
      this.showElectronDelta(x, y, reward.amount, '#67E8F9', true);
    } else if (reward.kind === 'temperature') {
      gameState.temperature = Math.max(0, gameState.temperature - reward.amount);
      this.showFloatingText(x, y, `降温 ${reward.amount}°`, '#5CFFB1');
    }
  }

  /** 商店报价文案：必须让玩家在按 E 之前就知道买什么、花多少。 */
  private shopOfferText(offer: ShopOffer): string {
    const what = offer.item === 'electronMax'
      ? `自由电子上限 +${offer.amount}`
      : offer.item === 'heal'
        ? '电子恢复'
        : offer.item === 'temperature'
          ? `降温 ${offer.amount}°`
          : `背包扩容 +${offer.amount}`;
    return `🧪 催化剂台\n${what} · ${offer.cost} 样本 [E]`;
  }

  private spawnMerchant(): void {
    const pos = this.clampToPlayArea(this.diamondCx - 500, this.diamondCy - 300);
    // 等距底座 + 摊位霓虹 + 浮动图标（与宝箱同一套交互物视觉语言）
    const platform = this.add.ellipse(pos.x, pos.y + 38, 190, 70, 0xa78bfa, 0.07)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
    const view = this.add.rectangle(pos.x, pos.y, 90, 90, 0xa78bfa, 0.12)
      .setStrokeStyle(3, 0xa78bfa, 0.95).setDepth(6);
    const innerStroke = this.add.rectangle(pos.x, pos.y, 72, 72, 0xd8b4fe, 0)
      .setStrokeStyle(1.5, 0xd8b4fe, 0.55).setDepth(6);
    const glow = this.add.ellipse(pos.x, pos.y + 34, 130, 55, 0xa78bfa, 0.15)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    this.roomProps.push(platform, glow, innerStroke);
    this.tweens.add({ targets: glow, alpha: { from: 0.1, to: 0.25 }, scaleX: { from: 0.9, to: 1.2 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const icon = this.add.text(pos.x, pos.y - 4, '⚗', {
      color: '#D8B4FE', fontFamily: 'monospace', fontSize: '30px'
    }).setOrigin(0.5).setDepth(7);
    this.roomProps.push(icon);
    this.tweens.add({ targets: icon, y: icon.y - 8, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const offer = this.roomDef.shop ?? { cost: 5, item: 'electronMax' as const, amount: 1 };
    const label = this.add.text(pos.x, pos.y - 66, this.shopOfferText(offer), {
      color: '#D8B4FE', fontFamily: 'monospace', fontSize: '17px', align: 'center'
    }).setOrigin(0.5).setDepth(7);
    this.roomProps.push(label);
    this.merchant = { view, label, offer, bought: false };
  }

  private buyFromMerchant(): void {
    if (!this.merchant || this.merchant.bought) return;
    const offer = this.merchant.offer;
    if (gameState.samples < offer.cost) {
      this.showFloatingText(this.merchant.view.x, this.merchant.view.y - 80, '样本不足', '#FF5C7A');
      this.playTone(160, 0.1, 'square', 0.08);
      return;
    }
    gameState.samples -= offer.cost;
    this.merchant.bought = true;
    this.merchant.label.setText('已购买');
    if (offer.item === 'electronMax') {
      // 基础上限 3，催化剂台最多扩容两次 → 5
      gameState.maxFreeElectrons = Math.min(6, gameState.maxFreeElectrons + offer.amount);
      gainFreeElectrons(offer.amount);
      this.showFloatingText(this.merchant.view.x, this.merchant.view.y - 80, `自由电子上限 +${offer.amount}`, '#67E8F9');
    } else if (offer.item === 'heal') {
      gameState.ehp = gameState.ehpMax;
      if (gameState.valence < gameState.maxValence) {
        gameState.valence = gameState.maxValence;
        gameState.ehp = gameState.ehpMax;
      }
      this.showFloatingText(this.merchant.view.x, this.merchant.view.y - 80, '电子恢复', '#5CFFB1');
    } else if (offer.item === 'temperature') {
      gameState.temperature = Math.max(0, gameState.temperature - offer.amount);
      this.showFloatingText(this.merchant.view.x, this.merchant.view.y - 80, `降温 ${offer.amount}°`, '#5CFFB1');
    } else if (offer.item === 'bag') {
      // §4.3 负载：扩容背包直接降低负载档位，是"搜打撤"中最值的样本去处
      gameState.bagCapacity += offer.amount;
      const load = describeLoad(gameState.samples, gameState.bagCapacity);
      this.showFloatingText(this.merchant.view.x, this.merchant.view.y - 80,
        `背包扩容 +${offer.amount}（负载 ${load.percent}% · ${load.band.label}）`, '#FDE047');
    }
    this.playSfx('sfx-click', 0.8);
    this.cameraShake(40, 0.0015);
  }

  private showFloatingText(x: number, y: number, text: string, color: string): void {
    const t = this.obtainCombatText();
    t.setFontSize(20 * this.uiScale)
      .setPosition(x, y)
      .setText(text)
      .setColor(color)
      .setAlpha(0)
      .setScale(1);
    const drift = Phaser.Math.Between(-12, 12);
    t.x += drift;
    this.tweens.add({
      targets: t, alpha: { from: 0, to: 1 }, x: t.x + drift * 1.5, y: y - 40, duration: 900, ease: 'Cubic.out',
      onComplete: () => this.recycleCombatText(t)
    });
  }

  private applyRoomTheme(room: RoomDef): void {
    const theme = ROOM_THEMES[room.type];
    this.roomBoundaryColor = theme.boundary;
    this.redrawBoundary();
    if (this.roomTintRect) this.roomTintRect.setFillStyle(theme.boundary, 0.05);
    const layerStr = room.type === 'finalBoss' ? '最终决战' : getLayerName(room.layer);
    const progress = room.type === 'finalBoss' ? '' : ` · ${getLayerProgress(room.layer, room.depth)}`;
    this.showRoomBanner(`${theme.banner} · ${layerStr}${progress}`, '#FFFFFF');
  }

  private tearDownRoomEntities(): void {
    this.roomDoors.forEach((door) => {
      door.platform.destroy();
      door.icon.destroy();
      door.label.destroy();
    });
    this.roomDoors = [];
    this.roomDoorTargets = [];
    if (this.chest) {
      this.chest.view.destroy();
      this.chest.label.destroy();
      this.chest = null;
    }
    if (this.merchant) {
      this.merchant.view.destroy();
      this.merchant.label.destroy();
      this.merchant = null;
    }
    if (this.instrument) {
      this.instrument.view.destroy();
      this.instrument.label.destroy();
      this.instrument = null;
    }
    this.dyeStations.forEach((s) => {
      s.view.destroy();
      s.halo.destroy();
      s.label.destroy();
    });
    this.dyeStations = [];
    if (this.boonPickup) {
      this.boonPickup.glow.destroy();
      this.boonPickup.ring.destroy();
      this.boonPickup.label.destroy();
      this.boonPickup = null;
    }
    if (this.extractZone) {
      this.extractZone.destroy();
      this.extractZone = null;
    }
    if (this.extractionText) {
      this.extractionText.destroy();
      this.extractionText = null;
    }
    this.enemies.forEach((enemy) => {
      enemy.view.destroy();
      enemy.aura?.destroy();
      enemy.glow?.destroy();
      enemy.innerHalo?.destroy();
      enemy.outerHalo?.destroy();
      enemy.orbitArcs.forEach((arc) => arc.destroy());
      enemy.eliteRing?.destroy();
    });
    this.enemies = [];
    if (this.boss) {
      this.boss.view.destroy();
      this.boss.aura?.destroy();
      this.boss.glow?.destroy();
      this.boss.innerHalo?.destroy();
      this.boss.outerHalo?.destroy();
      this.boss.orbitArcs.flat().forEach((arc) => arc.destroy());
      this.boss.orbitRings.forEach((ring) => ring.destroy());
      this.boss = null;
    }
    this.projectiles.forEach((p) => {
      p.view.destroy();
      p.glow?.destroy();
      p.glow2?.destroy();
    });
    this.projectiles = [];
    this.enemyProjectiles.forEach((p) => p.view.destroy());
    this.enemyProjectiles = [];
    this.acidPools.forEach((p) => p.view.destroy());
    this.acidPools = [];
    this.bombs.forEach((p) => p.view.destroy());
    this.bombs = [];
    this.smokeClouds.forEach((p) => p.view.destroy());
    this.smokeClouds = [];
    this.gearDrops.forEach((d) => {
      d.beam.destroy();
      d.halo.destroy();
      d.icon.destroy();
    });
    this.gearDrops = [];
    this.electronDrops.forEach((p) => {
      p.view.destroy();
      p.halo.destroy();
    });
    this.electronDrops = [];
    this.reactionPairs.forEach((p) => {
      p.mine.destroy();
      p.theirs.destroy();
    });
    this.reactionPairs = [];
    // 取消未落地的生成预告并销毁标记
    this.spawnTelegraphs.forEach((t) => t.remove(false));
    this.spawnTelegraphs = [];
    this.telegraphMarkers.forEach((m) => m.destroy());
    this.telegraphMarkers = [];
    // 销毁房间辅助视觉
    this.roomProps.forEach((p) => p.destroy());
    this.roomProps = [];
    this.pendingSpawns = 0;
    this.roomClearRewardGiven = false;
    this.extractionEnabled = false;
  }

  private createWorldBoundary(): void {
    this.boundaryGraphics = this.add.graphics();
    this.redrawBoundary();
    this.boundaryWarning = this.add.circle(this.player.x, this.player.y, 78, 0xff4d6d, 0)
      .setStrokeStyle(4, 0xff4d6d, 0)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  /** 按当前房间主题色重绘菱形边界描边。 */
  private redrawBoundary(): void {
    const vertices = [
      new Phaser.Math.Vector2(this.diamondCx, this.diamondCy - this.diamondB),
      new Phaser.Math.Vector2(this.diamondCx + this.diamondA, this.diamondCy),
      new Phaser.Math.Vector2(this.diamondCx, this.diamondCy + this.diamondB),
      new Phaser.Math.Vector2(this.diamondCx - this.diamondA, this.diamondCy)
    ];
    const color = this.roomBoundaryColor;
    this.boundaryGraphics.clear();
    this.boundaryGraphics.lineStyle(18, color, 0.08);
    this.boundaryGraphics.strokePoints([...vertices, vertices[0]], true);
    this.boundaryGraphics.lineStyle(8, color, 0.14);
    this.boundaryGraphics.strokePoints([...vertices, vertices[0]], true);
    this.boundaryGraphics.lineStyle(3, color, 0.85);
    this.boundaryGraphics.strokePoints([...vertices, vertices[0]], true);
  }

  private updateBoundaryFeedback(): void {
    const s = this.diamondS(this.player.x, this.player.y);
    const intensity = Phaser.Math.Clamp((s - 0.7) / 0.3, 0, 1);
    this.boundaryWarning.setPosition(this.player.x, this.player.y);
    this.boundaryWarning.setStrokeStyle(4, 0xff4d6d, intensity * 0.85);
    this.boundaryWarning.setScale(1 + Math.sin(this.time.now * 0.012) * 0.06 * intensity);
    this.boundaryGraphics.setAlpha(0.6 + intensity * 0.4);
    if (intensity >= 1) {
      this.boundaryGraphics.setAlpha(0.75 + Math.sin(this.time.now * 0.02) * 0.25);
    }
  }

  private updatePlayerAnimation(dt: number): void {
    const velocity = this.playerBody.velocity;
    const speed = velocity.length();
    const moving = speed > 24;
    const breathe = 1 + Math.sin(this.time.now * 0.0024) * 0.035;
    this.attackRecoil = Math.max(0, this.attackRecoil - dt * 5);
    const recoil = 1 + this.attackRecoil * 0.22;
    // 离散形变（攻击挤压 / 冲刺拉伸 / 受击挤压）叠加在运动形变之上
    this.playerSquashTimer = Math.max(0, this.playerSquashTimer - dt);
    const impact = this.playerImpactScale();
    if (moving) {
      const stretch = 1 + Math.min(speed / 360, 1) * 0.16;
      const squash = 1 / stretch;
      const nx = Math.abs(velocity.x) / (speed || 1);
      const ny = Math.abs(velocity.y) / (speed || 1);
      this.player.setScale(
        this.playerBaseScale * (1 + (nx * stretch + ny * squash - 1) * 0.6) * breathe * recoil * impact.x,
        this.playerBaseScale * (1 + (ny * stretch + nx * squash - 1) * 0.6) * breathe * recoil * impact.y
      );
      const targetAngle = Math.atan2(velocity.y, velocity.x) + Math.PI / 2;
      this.player.rotation = Phaser.Math.Angle.RotateTo(this.player.rotation, targetAngle, dt * 6);
    } else {
      this.player.setScale(this.playerBaseScale * breathe * recoil * impact.x, this.playerBaseScale * breathe * recoil * impact.y);
      this.player.rotation = Phaser.Math.Angle.RotateTo(this.player.rotation, 0, dt * 3);
    }
  }

  private switchWeapon(): void {
    if (gameState.weaponSwitchCd > 0) return;
    gameState.weaponSwitchCd = 0.35;
    gameState.currentWeapon = gameState.currentWeapon === 'platinum-knife' ? 'reaction-cannon' : 'platinum-knife';
    haptic(15);
    this.playSfx('sfx-switch', 0.7);
    const flash = this.add.circle(this.player.x, this.player.y, 40, 0xffffff, 0.35)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(100);
    this.tweens.add({ targets: flash, alpha: 0, scale: 2, duration: 250, onComplete: () => flash.destroy() });
  }

  private attack(): void {
    if (this.attackTimer > 0) return;
    const weapon = getWeapon(gameState.currentWeapon);
    // §7 武器等级 + 形态修正（形态需满级解锁）；道尔顿形态还会读取当前负载
    const wmods = this.weaponMods;
    // 祝福「催化加速」+ 遗物「催化剂碎片(冷却) / 共价键手套(攻速)」+ 装备(靴子) + §2.1 还原态（自由电子冷却缩减）
    const speedPct = Math.min(80, this.boonCdReduction + this.relicCdReduction + this.relicAtkSpeedBonus + this.electronState.cdReduction + this.gearCdReduction * 100);
    this.attackTimer = weapon.cooldown * (1 - speedPct / 100) * wmods.cooldownMult;
    // §2.1 氧化态（失去价电子提升出伤） × §7 武器等级/形态 × 攻/防模式倾向 × 装备(核心)
    const modeMult = gameState.mode === 'oxidized' ? wmods.oxidizeMult : wmods.reduceMult;
    const damage = weapon.baseDamage * this.electronState.damageMult * wmods.damageMult * modeMult * this.gearDamageMult;
    this.attackRecoil = 1;
    // 攻击预备动作：先向下挤压再回弹，让出招有发力感（迪士尼 squash & stretch）
    this.playPlayerSquash(0.1, 0.14);
    // 祝福「共振冲刺」：下一次攻击电子夺取倍率
    const boost = this.nextAttackBoost;
    this.nextAttackBoost = 0;
    this.electronMult = boost > 1 ? boost : 1;
    if (boost > 1) {
      this.showFloatingText(this.player.x, this.player.y - 62, '共鸣 ×' + boost, '#A78BFA');
    }
    const px = this.player.x + this.lastDirection.x * 34;
    const py = this.player.y + this.lastDirection.y * 34;

    const cam = this.cameras.main;
    const margin = 60;
    const inView = (x: number, y: number): boolean =>
      x >= cam.scrollX - margin &&
      x <= cam.scrollX + cam.width + margin &&
      y >= cam.scrollY - margin &&
      y <= cam.scrollY + cam.height + margin;
    const candidates: Array<{ x: number; y: number; enemy?: RuntimeEnemy; boss?: boolean }> = this.enemies
      .filter((enemy) => enemy.view.visible && inView(enemy.view.x, enemy.view.y))
      .map((enemy) => ({ x: enemy.view.x, y: enemy.view.y, enemy }));
    if (this.boss?.view.visible && inView(this.boss.view.x, this.boss.view.y)) {
      candidates.push({ x: this.boss.view.x, y: this.boss.view.y, boss: true });
    }
    const target = candidates.sort(
      (left, right) =>
        Phaser.Math.Distance.Between(this.player.x, this.player.y, left.x, left.y) -
        Phaser.Math.Distance.Between(this.player.x, this.player.y, right.x, right.y)
    )[0];

    if (weapon.type === 'melee') {
      this.meleeAttack(damage, boost);
    } else {
      this.rangedAttack(damage, target, boost);
    }

    this.setPlayerOrbitState('attack', weapon.cooldown);
    emit('damage', { amount: damage, mode: gameState.mode });
    this.electronMult = 1;
  }

  /** 计算朝向最近敌人（视野内）的瞄准角；无目标时回退到最后移动方向（与普攻/特殊攻击选目标逻辑一致） */
  private computeAimAngle(px: number, py: number): number {
    let aimAngle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
    const cam = this.cameras.main;
    const margin = 60;
    let nearestDist = Number.POSITIVE_INFINITY;
    const inView = (x: number, y: number): boolean =>
      x >= cam.scrollX - margin && x <= cam.scrollX + cam.width + margin &&
      y >= cam.scrollY - margin && y <= cam.scrollY + cam.height + margin;
    for (const enemy of this.enemies) {
      if (!enemy.view.visible || !inView(enemy.view.x, enemy.view.y)) continue;
      const d = Phaser.Math.Distance.Between(px, py, enemy.view.x, enemy.view.y);
      if (d < nearestDist) {
        nearestDist = d;
        aimAngle = Phaser.Math.Angle.Between(px, py, enemy.view.x, enemy.view.y);
      }
    }
    if (this.boss?.view.visible && inView(this.boss.view.x, this.boss.view.y)) {
      const d = Phaser.Math.Distance.Between(px, py, this.boss.view.x, this.boss.view.y);
      if (d < nearestDist) aimAngle = Phaser.Math.Angle.Between(px, py, this.boss.view.x, this.boss.view.y);
    }
    return aimAngle;
  }

  /** 特殊攻击蓄力反馈：按住攻击键时能量环充能，武器出现并播放蓄力动画（progress 0→1） */
  private updateSpecialChargeFx(progress: number): void {
    if (!this.specialChargeFx) {
      const color = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
      const outer = this.add.circle(this.player.x, this.player.y, 46, color, 0)
        .setStrokeStyle(4, color, 0.3)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(110);
      const inner = this.add.circle(this.player.x, this.player.y, 40, color, 0)
        .setStrokeStyle(2, 0xffffff, 0.55)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(110);
      const label = this.add.text(this.player.x, this.player.y - 84, '蓄力中', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#FDE047'
      }).setOrigin(0.5).setDepth(111).setAlpha(0);
      // 蓄力期间显示武器本体（光剑/炮管）+ 尖端充能光团
      const weaponDef = getWeapon(gameState.currentWeapon);
      const isMelee = weaponDef.type === 'melee';
      const tipOffset = isMelee ? weaponDef.range : 118;
      const weapon = this.add.container(this.player.x, this.player.y).setDepth(112);
      if (isMelee) {
        const drawBlade = (g: Phaser.GameObjects.Graphics, len: number, w: number, c: number, a: number): void => {
          g.fillStyle(c, a);
          g.fillRoundedRect(-2, -w / 2, len + 2, w, w / 2);
          g.fillCircle(0, 0, w / 2);
          g.fillCircle(len, 0, w / 2);
        };
        const glowOuter = this.add.graphics();
        drawBlade(glowOuter, weaponDef.range - 6, 20, color, 0.3);
        const glowMid = this.add.graphics();
        drawBlade(glowMid, weaponDef.range - 2, 10, color, 0.7);
        const core = this.add.graphics();
        drawBlade(core, weaponDef.range, 4, 0xffffff, 1);
        weapon.add([glowOuter, glowMid, core]);
      } else {
        const barrel = this.add.graphics();
        barrel.fillStyle(color, 0.85);
        barrel.fillRoundedRect(0, -14, 118, 28, 14);
        barrel.fillStyle(0xffffff, 0.9);
        barrel.fillRoundedRect(86, -9, 34, 18, 9);
        weapon.add(barrel);
      }
      const tipGlow = this.add.circle(tipOffset, 0, 6, color, 0.8)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(113);
      const tipCore = this.add.circle(tipOffset, 0, 3, 0xffffff, 1)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(113);
      weapon.add([tipGlow, tipCore]);
      this.specialChargeFx = { color, outer, inner, label, weapon, tipGlow, tipCore, fill: null as unknown as Phaser.GameObjects.Arc };
      // 通知移动端攻击按钮进入蓄力反馈
      emit('special', { phase: 'charge' });
      // 创建持久化充能进度圆
      const fillCircle = this.add.circle(this.player.x, this.player.y, 6, color, 0.12)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(110);
      this.specialChargeFx.fill = fillCircle;
    }
    const fx = this.specialChargeFx;
    const p = Phaser.Math.Clamp(progress, 0, 1);
    fx.outer.setPosition(this.player.x, this.player.y)
      .setRadius(44 + p * 28)
      .setStrokeStyle(4 + p * 4, fx.color, 0.25 + p * 0.55)
      .setAlpha(0.6 + 0.4 * Math.abs(Math.sin(this.time.now * 0.02)));
    fx.inner.setPosition(this.player.x, this.player.y)
      .setRadius(40 + p * 20)
      .setStrokeStyle(2 + p * 3, 0xffffff, 0.3 + p * 0.55);
    // 蓄力动画：武器自动瞄准最近敌人（与实际发射方向一致），随充能放大 + 抖动，尖端能量团膨胀
    const baseAngle = this.computeAimAngle(this.player.x, this.player.y);
    fx.weapon.setPosition(this.player.x, this.player.y)
      .setRotation(baseAngle + Math.sin(this.time.now * 0.022) * 0.1)
      .setScale(0.45 + p * 0.65);
    fx.tipGlow.setScale(1 + p * 2.4).setAlpha(0.5 + p * 0.5);
    fx.tipCore.setScale(1 + p * 2);
    // 充能进度：持久化圆随进度膨胀
    fx.fill.setPosition(this.player.x, this.player.y)
      .setRadius(6 + p * 30)
      .setAlpha(0.08 + p * 0.15);
    fx.label.setPosition(this.player.x, this.player.y - 84)
      .setAlpha(Math.min(1, p * 1.6));
    const stored = gameState.freeElectrons;
    fx.label.setText(stored > 0 ? `蓄力中 · ${stored}⚡强化` : '蓄力中').setColor('#FDE047');
  }

  /** 蓄力满后的脉冲提示状态：武器和环脉冲闪烁，提示玩家释放触发特殊攻击 */
  private updateSpecialChargePulse(): void {
    const fx = this.specialChargeFx;
    if (!fx) return;
    // 蓄力完成的瞬间音（一次），语义同 Chemic budong=射线蓄力完成
    if (!this.chargePulseSounded) {
      this.chargePulseSounded = true;
      this.playSfx('sfx-budong', 0.8);
    }
    const pulse = Math.sin(this.time.now * 0.012) * 0.5 + 0.5;
    fx.outer.setAlpha(0.7 + pulse * 0.3)
      .setStrokeStyle(8, fx.color, 0.7 + pulse * 0.3);
    fx.inner.setAlpha(0.5 + pulse * 0.5);
    const baseAngle = this.computeAimAngle(this.player.x, this.player.y);
    fx.weapon.setPosition(this.player.x, this.player.y)
      .setRotation(baseAngle + Math.sin(this.time.now * 0.03) * 0.06)
      .setScale(1.05 + pulse * 0.1);
    fx.tipGlow.setScale(3 + pulse * 1.2).setAlpha(0.7 + pulse * 0.3);
    fx.tipCore.setScale(2.5 + pulse * 0.8);
    fx.fill.setPosition(this.player.x, this.player.y)
      .setRadius(36 + pulse * 4).setAlpha(0.15 + pulse * 0.12);
    fx.label.setPosition(this.player.x, this.player.y - 84)
      .setText(gameState.freeElectrons > 0 ? `蓄力完成 · 释放（强化 ×${gameState.freeElectrons}）` : '蓄力完成 · 释放').setColor('#5CFFB1').setAlpha(1);
  }

  /** 清除蓄力视觉；burst=true 时播放充能完成爆闪 */
  private clearSpecialChargeFx(burst: boolean): void {
    const fx = this.specialChargeFx;
    this.specialChargeFx = null;
    if (fx) {
      if (burst) {
        const flash = this.add.circle(fx.outer.x, fx.outer.y, fx.outer.radius, fx.color, 0.5)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(110);
        this.tweens.add({
          targets: flash,
          scale: { from: 0.8, to: 2.6 },
          alpha: 0,
          duration: 240,
          onComplete: () => flash.destroy()
        });
        this.playTone(920, 0.09, 'sine', 0.05);
      }
      [fx.outer, fx.inner, fx.label, fx.weapon, fx.tipGlow, fx.tipCore, fx.fill].forEach((o) => {
        this.tweens.add({
          targets: o,
          alpha: 0,
          scale: 1.25,
          duration: 150,
          onComplete: () => o.destroy()
        });
      });
    }
    // 通知移动端攻击按钮：特殊攻击触发 / 蓄力取消
    emit('special', { phase: burst ? 'fire' : 'cancel' });
  }

  /** 特殊攻击：长按攻击键触发，无冷却；消耗全部自由电子强化。 */
  private specialAttack(): void {
    // 自由电子不足：硬性禁用（节流反馈，防移动端直接释放的漏网路径）
    if (gameState.freeElectrons <= 0) {
      if (this.specialDenyHintTimer <= 0) {
        this.specialDenyHintTimer = 0.9;
        this.showFloatingText(this.player.x, this.player.y - 88, '特殊攻击需要自由电子', '#94A3B8');
        this.playSfx('sfx-duong', 0.5);
        this.playTone(200, 0.05, 'sine', 0.03);
      }
      return;
    }
    // 消耗自由电子强化特殊攻击（单次上限 BALANCE.combat.specialMaxConsume）：
    // 伤害 +25%/颗；氧化态下每颗使命中额外夺取 1 颗电子
    const consumed = Math.min(gameState.freeElectrons, BALANCE.combat.specialMaxConsume);
    gameState.freeElectrons -= consumed;
    if (consumed > 0) {
      this.showElectronDelta(this.player.x, this.player.y - 62, -consumed, '#67E8F9', true);
      this.showFloatingText(this.player.x, this.player.y - 88, `特殊强化 ×${consumed}`, '#67E8F9');
      this.playTone(1200, 0.08, 'square', 0.05);
    }
    const weapon = getWeapon(gameState.currentWeapon);
    const px = this.player.x;
    const py = this.player.y;
    const cam = this.cameras.main;
    const margin = 60;
    const inView = (x: number, y: number): boolean =>
      x >= cam.scrollX - margin && x <= cam.scrollX + cam.width + margin &&
      y >= cam.scrollY - margin && y <= cam.scrollY + cam.height + margin;
    const candidates = this.enemies
      .filter((e) => e.view.visible && inView(e.view.x, e.view.y))
      .map((e) => ({ x: e.view.x, y: e.view.y, enemy: e }));
    if (this.boss?.view.visible && inView(this.boss.view.x, this.boss.view.y)) {
      candidates.push({ x: this.boss.view.x, y: this.boss.view.y, enemy: null as unknown as RuntimeEnemy });
    }
    const target = candidates.sort(
      (a, b) => Phaser.Math.Distance.Between(px, py, a.x, a.y) -
                Phaser.Math.Distance.Between(px, py, b.x, b.y)
    )[0];
    const aimAngle = target
      ? Phaser.Math.Angle.Between(px, py, target.x, target.y)
      : Math.atan2(this.lastDirection.y, this.lastDirection.x);
    if (weapon.type === 'ranged') {
      this.laserAttack(aimAngle, consumed);
      // 祝福「多相催化」：特殊攻击额外发射弹体
      const multiCount = this.boonValue('cat-sp-multi');
      if (multiCount > 0) {
        const spread = 0.25;
        for (let i = 0; i < multiCount; i++) {
          const offset = (i - (multiCount - 1) / 2) * spread;
          const extraAngle = aimAngle + offset;
          const ex = px + Math.cos(extraAngle) * 34;
          const ey = py + Math.sin(extraAngle) * 34;
          const glow2 = this.add.circle(ex, ey, 12, 0xa78bfa, 0.12)
            .setStrokeStyle(2, 0xa78bfa, 0.6).setBlendMode(Phaser.BlendModes.ADD);
          const glow = this.add.circle(ex, ey, 8, 0xa78bfa, 0.25)
            .setBlendMode(Phaser.BlendModes.ADD);
          const proj = this.add.circle(ex, ey, 4, 0xa78bfa)
            .setStrokeStyle(2, 0xffffff).setBlendMode(Phaser.BlendModes.ADD);
          const speed = 600;
          this.projectiles.push({
            view: proj, glow, glow2,
            vx: Math.cos(extraAngle) * speed,
            vy: Math.sin(extraAngle) * speed,
            target: target?.enemy ?? null,
            bossTarget: false
          });
        }
      }
    } else {
      this.spinSlash(consumed);
    }
    // 祝福「分子壁垒」：特殊攻击在朝向方向生成护盾墙，阻挡敌方弹幕
    const wallBoon = this.boonValue('c-sp-wall');
    if (wallBoon > 0) {
      this.spawnShieldWall(aimAngle, wallBoon);
    }
    // 祝福「腐蚀扩散」：特殊攻击在命中处留下酸池（范围内每秒夺取电子）
    if (this.boonCorrodeDps > 0) {
      const cx = target ? target.x : px + Math.cos(aimAngle) * 160;
      const cy = target ? target.y : py + Math.sin(aimAngle) * 160;
      this.spawnMist(cx, cy, this.boonCorrodeDps * this.boonSpecialElectronMult, 0x5cffb1, 90 * this.boonSpecialAoeMult, 5);
    }
    // 角色动画反馈：特殊攻击期间电子轨道进入爆发状态
    this.setPlayerOrbitState('special', 0.9);
  }

  /** 祝福「分子壁垒」：生成一面持续 seconds 秒的护盾墙（垂直朝向 aimAngle）。 */
  private spawnShieldWall(aimAngle: number, seconds: number): void {
    const px = this.player.x;
    const py = this.player.y;
    const angle = aimAngle + Math.PI / 2; // 墙面垂直于攻击方向
    const w = 300;
    const h = 190;
    const wx = px + Math.cos(aimAngle) * 175;
    const wy = py + Math.sin(aimAngle) * 175;
    const view = this.add.rectangle(wx, wy, w, h, 0x67e8f9, 0.12)
      .setStrokeStyle(3, 0x67e8f9, 0.8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(90)
      .setRotation(angle);
    this.tweens.add({ targets: view, alpha: { from: 0, to: 1 }, duration: 140 });
    this.shieldWalls.push({ x: wx, y: wy, angle, halfW: w / 2, halfH: h / 2, view, ttl: seconds });
    this.tweens.add({
      targets: view,
      scaleX: { from: 0.7, to: 1.04 },
      scaleY: { from: 1.1, to: 0.96 },
      duration: 200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });
  }

  private meleeAttack(baseDamage: number, boost = 0): void {
    const px = this.player.x;
    const py = this.player.y;
    const color = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
    const bladeLen = getWeapon(gameState.currentWeapon).range * this.boonSpecialAoeMult * this.weaponMods.rangeMult; // 特殊攻击专用 AOE
    const sweepHalf = Math.PI / 2; // 总扫角 180°

    // 自动朝向视野内最近的敌人（含 Boss），无目标时退回移动方向
    let aimAngle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
    const cam = this.cameras.main;
    const margin = 60;
    let nearestDist = Number.POSITIVE_INFINITY;
    const inView = (x: number, y: number): boolean =>
      x >= cam.scrollX - margin && x <= cam.scrollX + cam.width + margin &&
      y >= cam.scrollY - margin && y <= cam.scrollY + cam.height + margin;
    for (const enemy of this.enemies) {
      if (!enemy.view.visible || !inView(enemy.view.x, enemy.view.y)) continue;
      const d = Phaser.Math.Distance.Between(px, py, enemy.view.x, enemy.view.y);
      if (d < nearestDist) {
        nearestDist = d;
        aimAngle = Phaser.Math.Angle.Between(px, py, enemy.view.x, enemy.view.y);
      }
    }
    if (this.boss?.view.visible && inView(this.boss.view.x, this.boss.view.y)) {
      const d = Phaser.Math.Distance.Between(px, py, this.boss.view.x, this.boss.view.y);
      if (d < nearestDist) aimAngle = Phaser.Math.Angle.Between(px, py, this.boss.view.x, this.boss.view.y);
    }
    const angle = aimAngle;
    const hitDirectionX = Math.cos(angle) * 500;
    const hitDirectionY = Math.sin(angle) * 500;

    // 命中判定：剑刃横扫扇形内的所有敌人（仅针对敌人主体）
    const withinArc = (x: number, y: number, maxDist: number): boolean => {
      const dist = Phaser.Math.Distance.Between(px, py, x, y);
      if (dist > maxDist) return false;
      const a = Phaser.Math.Angle.Between(px, py, x, y);
      return Math.abs(Phaser.Math.Angle.Wrap(a - angle)) <= sweepHalf;
    };
    let hitCount = 0;
    for (const enemy of this.enemies) {
      if (!enemy.view.visible) continue;
      if (!withinArc(enemy.view.x, enemy.view.y, bladeLen + 22 + enemy.view.displayWidth / 2)) continue;
      const mode = gameState.mode;
      // 命中点沿挥砍方向略微外推，保证目标电子选择有明确方向
      const hx = enemy.view.x + Math.cos(angle) * 10;
      const hy = enemy.view.y + Math.sin(angle) * 10;
      if (enemy.orbit && enemy.enteredCombat && mode === 'oxidized') {
        this.oxidizeInteraction(enemy, hx, hy);
      } else if (enemy.orbit && enemy.enteredCombat && mode === 'reduced') {
        this.reduceInteraction(enemy, hx, hy);
      } else {
        this.registerHit(enemy, hitDirectionX, hitDirectionY);
      }
      this.impactHitAt(enemy.view.x, enemy.view.y, angle, color);
      hitCount += 1;
    }
    if (this.boss?.view.visible && withinArc(this.boss.view.x, this.boss.view.y, bladeLen + 80)) {
      this.hitBoss(Math.round(baseDamage * (1 + boost / 100)), this.boss.view.x, this.boss.view.y);
      this.impactHitAt(this.boss.view.x, this.boss.view.y, angle, color);
      hitCount += 1;
    }
    if (hitCount > 0) {
      // 命中定格 + 强烈震屏 + 重击反馈（晃动强度减弱 40%）
      this.applyHitStop(0.06);
      this.cameraShake(90, 0.0024);
      hapticHit();
      this.playSfx('sfx-saber-hit', 1);
      // 碳键护甲：攻击命中生成护盾，先于 EHP 吸收伤害（受护盾上限约束，避免无限回血）
      if (this.boonShieldHeal > 0) {
        this.gainShield(this.boonShieldHeal, 'attack');
      }
    }

    // 光剑视觉：多层剑刃绕玩家横扫（激光切割效果）
    const container = this.add.container(px, py).setDepth(100).setBlendMode(Phaser.BlendModes.ADD);
    const drawBlade = (g: Phaser.GameObjects.Graphics, len: number, w: number, c: number, a: number): void => {
      g.fillStyle(c, a);
      g.fillRoundedRect(-2, -w / 2, len + 2, w, w / 2);
      g.fillCircle(0, 0, w / 2);
      g.fillCircle(len, 0, w / 2);
    };
    const glowOuter = this.add.graphics();
    drawBlade(glowOuter, bladeLen - 6, 22, color, 0.3);
    const glowMid = this.add.graphics();
    drawBlade(glowMid, bladeLen - 2, 11, color, 0.7);
    const core = this.add.graphics();
    drawBlade(core, bladeLen, 5, 0xffffff, 1);
    const tipGlow = this.add.circle(bladeLen, 0, 11, color, 0.8);
    const tipCore = this.add.circle(bladeLen, 0, 4.5, 0xffffff, 1);
    container.add([glowOuter, glowMid, core, tipGlow, tipCore]);
    container.rotation = angle - sweepHalf;

    // 激光嗡鸣颤动
    this.tweens.add({
      targets: [core, tipCore],
      scaleX: { from: 0.96, to: 1.04 },
      scaleY: { from: 0.9, to: 1.1 },
      alpha: { from: 0.92, to: 1 },
      duration: 55,
      yoyo: true,
      repeat: 3
    });
    this.tweens.add({ targets: [tipGlow, glowMid], scale: { from: 0.9, to: 1.15 }, alpha: { from: 0.7, to: 1 }, duration: 70, yoyo: true, repeat: 2 });

    // 横扫动画（减慢速度：从 150ms 延长至 240ms）
    this.tweens.add({
      targets: container,
      rotation: angle + sweepHalf,
      duration: 240,
      ease: 'Sine.out'
    });
    this.tweens.add({ targets: container, alpha: 0, duration: 210, delay: 90 });
    this.time.delayedCall(310, () => container.destroy());

    // 光剑拖尾：横扫过程中每隔 20ms 在当前位置生成残影
    let lastTrailAngle = angle - sweepHalf;
    const trailTimer = this.time.addEvent({
      delay: 20,
      repeat: 10,
      callback: () => {
        const curRot = container.rotation;
        const trail = this.add.graphics().setDepth(99).setBlendMode(Phaser.BlendModes.ADD);
        const segLen = bladeLen;
        trail.lineStyle(3, color, 0.45);
        trail.beginPath();
        trail.moveTo(px + Math.cos(lastTrailAngle) * 18, py + Math.sin(lastTrailAngle) * 18);
        trail.lineTo(px + Math.cos(lastTrailAngle) * segLen, py + Math.sin(lastTrailAngle) * segLen);
        trail.strokePath();
        trail.lineStyle(6, color, 0.18);
        trail.beginPath();
        trail.moveTo(px + Math.cos(lastTrailAngle) * 14, py + Math.sin(lastTrailAngle) * 14);
        trail.lineTo(px + Math.cos(lastTrailAngle) * (segLen - 4), py + Math.sin(lastTrailAngle) * (segLen - 4));
        trail.strokePath();
        this.tweens.add({
          targets: trail,
          alpha: 0,
          duration: 280,
          onComplete: () => trail.destroy()
        });
        lastTrailAngle = curRot;
      }
    });
    this.time.delayedCall(300, () => trailTimer.remove());

    // 剑锋火花沿横扫轨迹飞溅
    for (let i = 0; i < 8; i += 1) {
      const t = i / 8;
      const sweepAngle = angle - sweepHalf + sweepHalf * 2 * t;
      const sx = px + Math.cos(sweepAngle) * bladeLen;
      const sy = py + Math.sin(sweepAngle) * bladeLen;
      const spark = this.add.circle(sx, sy, Phaser.Math.FloatBetween(1.5, 3.5), i % 2 === 0 ? 0xffffff : color, 0.9)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(101);
      const scatter = sweepAngle + Phaser.Math.FloatBetween(-0.7, 0.7);
      this.tweens.add({
        targets: spark,
        x: sx + Math.cos(scatter) * Phaser.Math.FloatBetween(16, 42),
        y: sy + Math.sin(scatter) * Phaser.Math.FloatBetween(16, 42),
        alpha: 0, scale: 0.15,
        duration: Phaser.Math.Between(90, 180),
        delay: t * 110,
        onComplete: () => spark.destroy()
      });
    }

    hapticFire();
    this.playSfx('sfx-saber-swing', 0.7);
  }

  /** 命中切割反馈：激光切割白线 + 冲击波环 + 沿剑刃方向火花 */
  private impactHitAt(x: number, y: number, angle: number, color: number): void {
    // 垂直于挥砍方向的激光切割亮线
    const cut = this.add.graphics().setDepth(105).setBlendMode(Phaser.BlendModes.ADD);
    const perp = angle + Math.PI / 2;
    const halfLen = 36;
    cut.lineStyle(5, 0xffffff, 1);
    cut.beginPath();
    cut.moveTo(x + Math.cos(perp) * halfLen, y + Math.sin(perp) * halfLen);
    cut.lineTo(x - Math.cos(perp) * halfLen, y - Math.sin(perp) * halfLen);
    cut.strokePath();
    cut.lineStyle(9, color, 0.7);
    cut.beginPath();
    cut.moveTo(x + Math.cos(perp) * halfLen * 0.8, y + Math.sin(perp) * halfLen * 0.8);
    cut.lineTo(x - Math.cos(perp) * halfLen * 0.8, y - Math.sin(perp) * halfLen * 0.8);
    cut.strokePath();
    this.tweens.add({ targets: cut, alpha: 0, scale: 1.35, duration: 150, onComplete: () => cut.destroy() });

    // 冲击波环
    const ring = this.add.circle(x, y, 10, 0xffffff, 0)
      .setStrokeStyle(4, color, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(104);
    this.tweens.add({ targets: ring, scale: { from: 0.4, to: 2.8 }, alpha: 0, duration: 230, ease: 'Cubic.out', onComplete: () => ring.destroy() });

    // 沿剑刃方向飞溅的切割火花
    for (let i = 0; i < 10; i += 1) {
      const sparkAngle = angle + Phaser.Math.FloatBetween(-0.55, 0.55);
      const spark = this.add.circle(x, y, Phaser.Math.FloatBetween(1.5, 3.5), i % 2 === 0 ? 0xffffff : color, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(106);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(sparkAngle) * Phaser.Math.FloatBetween(26, 68),
        y: y + Math.sin(sparkAngle) * Phaser.Math.FloatBetween(26, 68),
        alpha: 0, scale: 0.2,
        duration: Phaser.Math.Between(130, 260),
        onComplete: () => spark.destroy()
      });
    }
  }

  private rangedAttack(baseDamage: number, target: { x: number; y: number; enemy?: RuntimeEnemy; boss?: boolean } | undefined, boost = 0): void {
    this.playSfx('sfx-cil', 0.7); // 语义同 Chemic castSpell=释放法术弹幕
    const px = this.player.x + this.lastDirection.x * 34;
    const py = this.player.y + this.lastDirection.y * 34;
    const angle = target
      ? Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y)
      : Math.atan2(this.lastDirection.y, this.lastDirection.x);
    const color = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;

    const glow2 = this.add.circle(px, py, 18, color, 0.12)
      .setStrokeStyle(2.5, color, 0.6)
      .setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.circle(px, py, 12, color, 0.25)
      .setBlendMode(Phaser.BlendModes.ADD);
    const projectile = this.add.circle(px, py, 5, 0xfde047)
      .setStrokeStyle(3, 0xffffff)
      .setBlendMode(Phaser.BlendModes.ADD);
    const vx = Math.cos(angle) * 720;
    const vy = Math.sin(angle) * 720;
    this.projectiles.push({
      view: projectile, glow, glow2,
      vx, vy,
      target: target?.enemy ?? null,
      bossTarget: !!target?.boss,
      boost: boost || undefined
    });

    hapticFire();
    this.cameraShake(55, 0.0004);
    this.playSfx('sfx-cannon', 0.9);
  }

  /** 炮特殊攻击：持续激光束，由细到粗（最宽约 50px），持续伤害并短距击退敌人。
   *  electronBoost = 消耗的自由电子数：氧化态下首个接触的敌人与 Boss 各额外被夺取该数量的电子。 */
  private laserAttack(angle: number, electronBoost = 0): void {
    const color = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
    const oxidizedBoost = electronBoost > 0 && gameState.mode === 'oxidized';
    this.playSfx('sfx-jiu', 0.9); // 语义同 Chemic castRay=释放射线
    const beamLen = 2400;
    const totalMs = 700;
    const tickMs = 60;
    const pushForce = 140; // 沿光束方向的持续击退
    const interacted = new Set<RuntimeEnemy>();
    let bossStealDone = false;
    // 全局伤害预算：整段激光对束内最近敌人逐层击破电子层，命中时机从稀疏到密集；
    // §2.1 氧化态会把预算按出伤倍率提高（最多 9 层），打满后剩余时间仅击退、不再伤害。
    const baseHitFractions = [0.22, 0.39, 0.56, 0.69, 0.79];
    const tickBudget = Math.max(5, Math.min(9, Math.round(5 * this.electronState.damageMult * this.gearDamageMult * this.weaponMods.damageMult)));
    const hitFractions = baseHitFractions.concat([0.84, 0.88, 0.92, 0.95].slice(0, tickBudget - 5));
    let nextHit = 0;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);

    // 多层激光视觉：外发光 / 中段 / 白核（宽度随时间增长）
    const container = this.add.container(this.player.x, this.player.y)
      .setDepth(100).setBlendMode(Phaser.BlendModes.ADD);
    const mkRect = (height: number, fill: number, alpha: number): Phaser.GameObjects.Rectangle =>
      this.add.rectangle(0, 0, beamLen, height, fill, alpha).setOrigin(0, 0.5);
    const glowOuter = mkRect(30, color, 0.28);
    const glowMid = mkRect(16, color, 0.6);
    const core = mkRect(5, 0xffffff, 0.95);
    container.add([glowOuter, glowMid, core]);
    container.setRotation(angle);

    // 激光由细到粗：外 6→50px，中 4→28px，核 2→8px（smoothstep）；电子强化按颗加宽
    const beamWidthMult = (1 + 0.12 * electronBoost) * this.boonSpecialAoeMult * this.weaponMods.aoeMult;
    const grow = (p: number): void => {
      const e = p * p * (3 - 2 * p);
      glowOuter.setDisplaySize(beamLen, (6 + 44 * e) * beamWidthMult);
      glowMid.setDisplaySize(beamLen, (4 + 24 * e) * beamWidthMult);
      core.setDisplaySize(beamLen, (2 + 6 * e) * beamWidthMult);
    };
    grow(0);

    // 光束跟随玩家移动
    const followEvent = this.time.addEvent({
      delay: 16,
      repeat: Math.ceil(totalMs / 16),
      callback: () => container.setPosition(this.player.x, this.player.y)
    });

    // 伤害 / 击退 / 变粗 tick（Phaser 回调不传参；用本地计数器推进进度，避免 getProgress 首帧即满）
    const totalTicks = Math.floor(totalMs / tickMs) + 1;
    let tickCount = 0;
    const tickEvent = this.time.addEvent({
      delay: tickMs,
      repeat: Math.floor(totalMs / tickMs),
      callback: () => {
        tickCount += 1;
        const p = Math.min(1, tickCount / totalTicks);
        grow(p);
        // 祝福「分子间力」：激光自动追踪最近敌人
        if (this.hasBoon('cat-sp-homing')) {
          let best: RuntimeEnemy | null = null;
          let bestDist = Number.POSITIVE_INFINITY;
          for (const enemy of this.enemies) {
            if (!enemy.view.visible) continue;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.view.x, enemy.view.y);
            if (d < bestDist) {
              bestDist = d;
              best = enemy;
            }
          }
          const targetAngle = best
            ? Phaser.Math.Angle.Between(this.player.x, this.player.y, best.view.x, best.view.y)
            : this.boss?.view.visible
              ? Phaser.Math.Angle.Between(this.player.x, this.player.y, this.boss.view.x, this.boss.view.y)
              : angle;
          angle = Phaser.Math.Angle.RotateTo(angle, targetAngle, 0.14);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          container.setRotation(angle);
        }
        const halfW = (3 + 22 * p) * beamWidthMult; // 光束半宽（AOE 倍率 + 电子强化按颗加宽）
        let hit = false;
        // 本次 tick 是否存在伤害时机（命中时机会越靠越密）
        const prevHit = nextHit;
        while (nextHit < hitFractions.length && p >= hitFractions[nextHit]) nextHit += 1;
        const isDamageTick = nextHit > prevHit;
        // 束内最近敌人（供本 tick 结算 1 点全球伤害）
        let nearestEnemy: RuntimeEnemy | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const enemy of this.enemies) {
          if (!enemy.view.visible) continue;
          const rx = enemy.view.x - this.player.x;
          const ry = enemy.view.y - this.player.y;
          const t = Math.max(0, Math.min(1, (rx * dx + ry * dy) / beamLen));
          const projX = this.player.x + t * dx * beamLen;
          const projY = this.player.y + t * dy * beamLen;
          const dist = Phaser.Math.Distance.Between(enemy.view.x, enemy.view.y, projX, projY);
          if (dist > halfW + enemy.view.displayWidth / 2) continue;
          hit = true;
          // 首次接触到光束的敌人触发一次氧化/还原互动（不计入 5 点预算）
          if (!interacted.has(enemy) && enemy.orbit && enemy.enteredCombat) {
            interacted.add(enemy);
            const mode = gameState.mode;
            if (mode === 'oxidized') this.oxidizeInteraction(enemy, enemy.view.x, enemy.view.y);
            else this.reduceInteraction(enemy, enemy.view.x, enemy.view.y);
            this.onSpecialHit(enemy, enemy.view.x, enemy.view.y);
            // 特殊强化：额外夺取电子
            if (oxidizedBoost) this.stealElectrons(enemy, electronBoost, '#67E8F9');
          }
          // 无论是否有伤害，束内持续短距离击退（沿光束方向）
          enemy.pushX += dx * pushForce;
          enemy.pushY += dy * pushForce;
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestEnemy = enemy;
          }
        }
        // 伤害时机：对束内最近敌人结算"一层电子伤害"（以 maxHp 级别伤害触发破层），
        // 使大血量的多层怪被逐层击破（非只掉 1 点），总预算 5 层封顶
        if (isDamageTick) {
          const theme = color === 0xff8a4c ? '#FF8A4C' : '#FDE047';
          if (nearestEnemy) {
            this.damageEnemy(nearestEnemy, nearestEnemy.maxHp);
            this.showDamageNumber(nearestEnemy.view.x, nearestEnemy.view.y - 26, nearestEnemy.maxHp, theme);
          } else if (this.boss?.view.visible) {
            const rx = this.boss.view.x - this.player.x;
            const ry = this.boss.view.y - this.player.y;
            const t = Math.max(0, Math.min(1, (rx * dx + ry * dy) / beamLen));
            const projX = this.player.x + t * dx * beamLen;
            const projY = this.player.y + t * dy * beamLen;
            if (Phaser.Math.Distance.Between(this.boss.view.x, this.boss.view.y, projX, projY) < (60 + 30 * p) * this.boonSpecialAoeMult) {
              hit = true;
              this.hitBoss(1, this.boss.view.x, this.boss.view.y);
              // 特殊强化：整段光束对 Boss 一次性额外夺取
              if (oxidizedBoost && !bossStealDone) {
                bossStealDone = true;
                this.stealBossElectrons(this.boss, electronBoost);
              }
            }
          }
        } else if (this.boss?.view.visible) {
          const rx = this.boss.view.x - this.player.x;
          const ry = this.boss.view.y - this.player.y;
          const t = Math.max(0, Math.min(1, (rx * dx + ry * dy) / beamLen));
          const projX = this.player.x + t * dx * beamLen;
          const projY = this.player.y + t * dy * beamLen;
          if (Phaser.Math.Distance.Between(this.boss.view.x, this.boss.view.y, projX, projY) < (60 + 30 * p) * this.boonSpecialAoeMult) {
            hit = true;
          }
        }
        if (hit && tickCount % 4 === 0) {
          this.cameraShake(70, 0.0015);
          hapticHit();
        }
      }
    });

    this.time.delayedCall(totalMs, () => {
      this.tweens.add({ targets: container, alpha: 0, duration: 140, onComplete: () => container.destroy() });
    });
    this.time.delayedCall(totalMs + 170, () => {
      followEvent.remove();
      tickEvent.remove();
    });
    // 音效：连续播放 sfx-cannon，音量从 0 渐增到 0.9
    const sfxCount = 9;
    for (let i = 0; i < sfxCount; i++) {
      const t = i / (sfxCount - 1); // 0→1
      const vol = 0.05 + 0.85 * t;  // 0.05→0.9
      this.time.delayedCall(Math.round(totalMs * t), () => {
        this.playSfx('sfx-cannon', vol);
      });
    }
    this.time.delayedCall(Math.round(totalMs * 0.6), () => this.playSfx('sfx-saber-hit', 0.5));
  }

  /** 刀特殊攻击：360° 全周挥斩 3 次（沿用普攻光剑横扫视觉 + 火花特效）。
   *  electronBoost = 消耗的自由电子数：伤害 +25%/颗、范围 +12%/颗；氧化态下命中额外夺取该数量的电子。 */
  private spinSlash(electronBoost = 0): void {
    const color = gameState.mode === 'oxidized' ? 0xff8a4c : 0xfde047;
    const oxidizedBoost = electronBoost > 0 && gameState.mode === 'oxidized';
    const bladeLen = getWeapon(gameState.currentWeapon).range * this.boonSpecialAoeMult * this.weaponMods.rangeMult * (1 + 0.12 * electronBoost);
    const baseDmg = 18 * (1 + 0.25 * electronBoost) * this.electronState.damageMult * this.reactionDamageMult();
    const sweepHalf = Math.PI; // 360° 全周
    const perSlashMs = 320;

    // 起始朝向：视野内最近敌人（仅决定横扫起点，360° 覆盖所有方向）
    let aimAngle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
    {
      const cam = this.cameras.main;
      const margin = 60;
      let nearestDist = Number.POSITIVE_INFINITY;
      const inView = (x: number, y: number): boolean =>
        x >= cam.scrollX - margin && x <= cam.scrollX + cam.width + margin &&
        y >= cam.scrollY - margin && y <= cam.scrollY + cam.height + margin;
      for (const enemy of this.enemies) {
        if (!enemy.view.visible || !inView(enemy.view.x, enemy.view.y)) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.view.x, enemy.view.y);
        if (d < nearestDist) {
          nearestDist = d;
          aimAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.view.x, enemy.view.y);
        }
      }
      if (this.boss?.view.visible && inView(this.boss.view.x, this.boss.view.y)) {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.boss.view.x, this.boss.view.y);
        if (d < nearestDist) aimAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.boss.view.x, this.boss.view.y);
      }
    }

    const runSlash = (delayMs: number): void => {
      this.time.delayedCall(delayMs, () => {
        const px = this.player.x;
        const py = this.player.y;
        // 特殊攻击祝福（裂变冲击/核聚变/等离子体）只在第一斩结算，避免三斩重复叠加
        const isFirstSlash = delayMs === 0;
        // ---- 命中：360° 范围内所有敌人（每斩命中一次）----
        let hitCount = 0;
        for (const enemy of this.enemies) {
          if (!enemy.view.visible) continue;
          const dist = Phaser.Math.Distance.Between(px, py, enemy.view.x, enemy.view.y);
          if (dist > bladeLen + 22 + enemy.view.displayWidth / 2) continue;
          const mode = gameState.mode;
          const angleTo = Phaser.Math.Angle.Between(px, py, enemy.view.x, enemy.view.y);
          if (enemy.orbit && enemy.enteredCombat && mode === 'oxidized') {
            this.oxidizeInteraction(enemy, enemy.view.x + Math.cos(angleTo) * 10, enemy.view.y + Math.sin(angleTo) * 10);
          } else if (enemy.orbit && enemy.enteredCombat && mode === 'reduced') {
            this.reduceInteraction(enemy, enemy.view.x + Math.cos(angleTo) * 10, enemy.view.y + Math.sin(angleTo) * 10);
          } else {
            const spectralBonus = 1 + this.getSpectralBonus(enemy);
            const finalDmg = baseDmg * spectralBonus;
            this.damageEnemy(enemy, finalDmg);
            this.showDamageNumber(enemy.view.x, enemy.view.y - 30, finalDmg, color === 0xff8a4c ? '#FF8A4C' : '#FDE047');
            enemy.pushX += Math.cos(angleTo) * 150;
            enemy.pushY += Math.sin(angleTo) * 150;
          }
          if (isFirstSlash && enemy.enteredCombat) this.onSpecialHit(enemy, enemy.view.x, enemy.view.y);
          // 特殊强化：首斩命中额外夺取电子
          if (isFirstSlash && oxidizedBoost) this.stealElectrons(enemy, electronBoost, '#67E8F9');
          this.impactHitAt(enemy.view.x, enemy.view.y, angleTo, color);
          hitCount += 1;
        }
        if (this.boss?.view.visible) {
          const dist = Phaser.Math.Distance.Between(px, py, this.boss.view.x, this.boss.view.y);
          if (dist < bladeLen + 80) {
            this.hitBoss(baseDmg, this.boss.view.x, this.boss.view.y);
            // 特殊强化：首斩对 Boss 一次性额外夺取
            if (isFirstSlash && oxidizedBoost) this.stealBossElectrons(this.boss, electronBoost);
            this.impactHitAt(this.boss.view.x, this.boss.view.y, Phaser.Math.Angle.Between(px, py, this.boss.view.x, this.boss.view.y), color);
            hitCount += 1;
          }
        }
        if (hitCount > 0) {
          this.applyHitStop(0.06);
          this.cameraShake(80, 0.0025);
          hapticHit();
        }

        // ---- 视觉：光剑从 aimAngle-180° 横扫到 aimAngle+180°（360°）----
        const container = this.add.container(px, py).setDepth(100).setBlendMode(Phaser.BlendModes.ADD);
        const drawBlade = (g: Phaser.GameObjects.Graphics, len: number, w: number, c: number, a: number): void => {
          g.fillStyle(c, a);
          g.fillRoundedRect(-2, -w / 2, len + 2, w, w / 2);
          g.fillCircle(0, 0, w / 2);
          g.fillCircle(len, 0, w / 2);
        };
        const glowOuter = this.add.graphics();
        drawBlade(glowOuter, bladeLen - 6, 22, color, 0.3);
        const glowMid = this.add.graphics();
        drawBlade(glowMid, bladeLen - 2, 11, color, 0.7);
        const core = this.add.graphics();
        drawBlade(core, bladeLen, 5, 0xffffff, 1);
        const tipGlow = this.add.circle(bladeLen, 0, 11, color, 0.8);
        const tipCore = this.add.circle(bladeLen, 0, 4.5, 0xffffff, 1);
        container.add([glowOuter, glowMid, core, tipGlow, tipCore]);
        container.rotation = aimAngle - sweepHalf;
        this.tweens.add({ targets: container, rotation: aimAngle + sweepHalf, duration: perSlashMs, ease: 'Sine.out' });
        this.tweens.add({ targets: container, alpha: 0, duration: 200, delay: perSlashMs - 160 });
        this.time.delayedCall(perSlashMs + 80, () => container.destroy());

        // ---- 火花特效：沿横扫轨迹飞溅 ----
        for (let i = 0; i < 12; i += 1) {
          const t = i / 12;
          const sweepAngle = aimAngle - sweepHalf + sweepHalf * 2 * t;
          const sx = px + Math.cos(sweepAngle) * bladeLen;
          const sy = py + Math.sin(sweepAngle) * bladeLen;
          const spark = this.add.circle(sx, sy, Phaser.Math.FloatBetween(1.5, 3.5), i % 2 === 0 ? 0xffffff : color, 0.9)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(101);
          const scatter = sweepAngle + Phaser.Math.FloatBetween(-0.7, 0.7);
          this.tweens.add({
            targets: spark,
            x: sx + Math.cos(scatter) * Phaser.Math.FloatBetween(16, 42),
            y: sy + Math.sin(scatter) * Phaser.Math.FloatBetween(16, 42),
            alpha: 0,
            scale: 0.15,
            duration: Phaser.Math.Between(90, 180),
            delay: t * 110,
            onComplete: () => spark.destroy()
          });
        }

        // ---- 旋风斩刀光残影：每帧绘制上一段到当前段的扇形，连成一片扫掠光带 ----
        let lastAngle = aimAngle - sweepHalf;
        const trailEvent = this.time.addEvent({
          delay: 24,
          repeat: Math.ceil(perSlashMs / 24),
          callback: () => {
            const cur = container.rotation;
            const a0 = Math.min(lastAngle, cur);
            const a1 = Math.max(lastAngle, cur);
            if (a1 - a0 > 0.005) {
              // 刀光扇形：内部填充 + 外缘亮线，缓慢淡出形成连续拖尾
              const seg = this.add.graphics().setDepth(99).setBlendMode(Phaser.BlendModes.ADD);
              seg.fillStyle(color, 0.18);
              seg.beginPath();
              seg.moveTo(px, py);
              seg.arc(px, py, bladeLen, a0, a1, false);
              seg.closePath();
              seg.fillPath();
              seg.lineStyle(6, color, 0.4);
              seg.beginPath();
              seg.arc(px, py, bladeLen - 3, a0, a1, false);
              seg.strokePath();
              seg.lineStyle(3, 0xffffff, 0.28);
              seg.beginPath();
              seg.arc(px, py, bladeLen - 6, a0, a1, false);
              seg.strokePath();
              this.tweens.add({ targets: seg, alpha: 0, duration: 280, onComplete: () => seg.destroy() });
            }
            lastAngle = cur;
            // 少量火焰余烬
            const tipX = px + Math.cos(cur) * (bladeLen - 6);
            const tipY = py + Math.sin(cur) * (bladeLen - 6);
            const fire = this.add.circle(
              tipX + Phaser.Math.FloatBetween(-6, 6),
              tipY + Phaser.Math.FloatBetween(-6, 6),
              Phaser.Math.FloatBetween(4, 8),
              Phaser.Math.FloatBetween(0, 1) > 0.5 ? 0xfde047 : color,
              0.5
            ).setBlendMode(Phaser.BlendModes.ADD).setDepth(100);
            const scatter = cur + Phaser.Math.FloatBetween(-0.8, 0.8);
            this.tweens.add({
              targets: fire,
              x: tipX + Math.cos(scatter) * Phaser.Math.FloatBetween(8, 22),
              y: tipY + Math.sin(scatter) * Phaser.Math.FloatBetween(8, 22),
              scale: { from: 0.4, to: 1.7 },
              alpha: 0,
              duration: Phaser.Math.Between(140, 240),
              onComplete: () => fire.destroy()
            });
          }
        });
        this.time.delayedCall(perSlashMs + 60, () => trailEvent.remove());

        this.playSfx('sfx-saber-swing', 0.7);
        if (hitCount > 0) this.playSfx('sfx-saber-hit', 0.9);
      });
    };
    runSlash(0);
    runSlash(260);
    runSlash(520);
  }

  private updateProjectiles(delta: number): void {
    this.projectiles = this.projectiles.filter((projectile) => {
      const { view } = projectile;
      if (!projectile.target || !projectile.target.view.visible) {
        const nearest = this.enemies
          .filter((e) => e.view.visible && Phaser.Math.Distance.Between(view.x, view.y, e.view.x, e.view.y) < 200)
          .sort((a, b) =>
            Phaser.Math.Distance.Between(view.x, view.y, a.view.x, a.view.y) -
            Phaser.Math.Distance.Between(view.x, view.y, b.view.x, b.view.y)
          )[0];
        if (nearest) {
          projectile.target = nearest;
          projectile.bossTarget = false;
        } else if (this.boss?.view.visible && Phaser.Math.Distance.Between(view.x, view.y, this.boss.view.x, this.boss.view.y) < 300) {
          projectile.bossTarget = true;
        }
      }
      const aim: Phaser.GameObjects.Image | undefined = projectile.bossTarget
        ? this.boss?.view
        : projectile.target?.view;
      if (aim && aim.visible) {
        const speed = Math.hypot(projectile.vx, projectile.vy);
        const targetAngle = Phaser.Math.Angle.Between(view.x, view.y, aim.x, aim.y);
        const currentAngle = Math.atan2(projectile.vy, projectile.vx);
        const nextAngle = Phaser.Math.Angle.RotateTo(currentAngle, targetAngle, delta * 7);
        projectile.vx = Math.cos(nextAngle) * speed;
        projectile.vy = Math.sin(nextAngle) * speed;
      }
      const destroyProjectile = (): void => {
        projectile.glow?.destroy();
        projectile.glow2?.destroy();
        view.destroy();
      };
      const hitRadius = 48 * this.boonAoeMult; // 弹体命中半径（受 AOE 倍率影响）
      const target = this.enemies.find((enemy) => enemy.view.visible && Phaser.Math.Distance.Between(view.x, view.y, enemy.view.x, enemy.view.y) < hitRadius);
      if (target) {
        const mode = gameState.mode;
        if (target.orbit && target.enteredCombat && mode === 'oxidized') {
          this.oxidizeInteraction(target, view.x, view.y);
        } else if (target.orbit && target.enteredCombat && mode === 'reduced') {
          this.reduceInteraction(target, view.x, view.y);
        } else {
          this.registerHit(target, projectile.vx, projectile.vy);
        }
        destroyProjectile();
        return false;
      }
      if (this.boss?.view.visible && Phaser.Math.Distance.Between(view.x, view.y, this.boss.view.x, this.boss.view.y) < 116) {
        this.hitBoss(
          Math.round(18 * (1 + (projectile.boost ?? 0) / 100)),
          view.x,
          view.y
        );
        destroyProjectile();
        return false;
      }
      if (!view.active || view.x < 0 || view.x > this.worldWidth || view.y < 0 || view.y > this.worldHeight) {
        destroyProjectile();
        return false;
      }
      view.x += projectile.vx * delta;
      view.y += projectile.vy * delta;
      if (projectile.glow) {
        projectile.glow.setPosition(view.x, view.y);
        projectile.glow.setAlpha(0.15 + 0.1 * Math.sin(this.time.now * 0.02));
      }
      if (projectile.glow2) {
        projectile.glow2.setPosition(view.x, view.y);
        const pulse = 0.5 + 0.4 * Math.sin(this.time.now * 0.04);
        projectile.glow2.setAlpha(pulse * 0.2);
        const s = 1 + 0.15 * Math.sin(this.time.now * 0.05);
        projectile.glow2.setScale(s);
      }
      return true;
    });
  }

  private registerHit(target: RuntimeEnemy, vx: number, vy: number): void {
    const mode = gameState.mode;
    const baseDamage = mode === 'oxidized' ? 14 : 8;
    const spectralBonus = 1 + this.getSpectralBonus(target);
    const damage = baseDamage * spectralBonus;
    const hitX = target.view.x;
    const hitY = target.view.y;
    target.hp -= damage;
    hapticHit();
    target.stunTimer = Math.max(target.stunTimer, mode === 'reduced' ? 1.4 : 0.18);
    const speed = Math.hypot(vx, vy) || 1;
    target.pushX += (vx / speed) * 220;
    target.pushY += (vy / speed) * 220;
    const flashOverlay = this.add.circle(hitX, hitY, target.view.displayWidth / 2 + 10, 0xffffff, 0.55)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(5);
    this.tweens.add({ targets: flashOverlay, alpha: 0, scale: 1.4, duration: 110, onComplete: () => flashOverlay.destroy() });
    this.pulseEnemyOrbit(target);
    // 缩放冲击以当前基准为准（视图使用 setDisplaySize + idle 呼吸 tween，scale 不是 1）
    const baseScale = target.view.scale;
    this.tweens.add({ targets: target.view, scale: { from: baseScale * 1.14, to: baseScale }, duration: 140, ease: 'Cubic.out' });
    const impact = this.add.circle(hitX, hitY, 10, 0xffffff, 0)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: impact, scale: { from: 0.4, to: 2.2 }, alpha: 0, duration: 220, onComplete: () => impact.destroy() });
    for (let index = 0; index < 6; index += 1) {
      const spark = this.add.circle(hitX, hitY, 3, 0xfff7c2).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: spark,
        x: hitX + Phaser.Math.Between(-70, 70),
        y: hitY + Phaser.Math.Between(-70, 70),
        alpha: 0,
        scale: 0.2,
        duration: 240,
        onComplete: () => spark.destroy()
      });
    }
    this.showDamageNumber(hitX, hitY - 30, damage, mode === 'oxidized' ? '#FF8A4C' : mode === 'reduced' ? '#FDE047' : '#FFFFFF');
    // 反馈分层：普通命中保持克制（短定格 + 极轻屏震），精英命中才升级
    this.applyFeedback(hitTierFor(false, target.isElite));
    // 音高抖动：连续命中不出现机械的同一音高
    this.playTone(pitchJitter(220), 0.06, 'square', 0.07);
    if (mode === 'oxidized') {
      this.gainFreeElectronsWithFeedback(this.player.x, this.player.y - 62);
      this.spawnElectronFlow(hitX, hitY, this.player.x, this.player.y, 0x67e8f9, 6);
      this.playTone(880, 0.07, 'sine', 0.05);
    } else if (mode === 'reduced') {
      if (gameState.freeElectrons > 0) {
        gameState.freeElectrons -= 1;
        target.stunTimer = 1.4;
        this.spawnElectronFlow(this.player.x, this.player.y, hitX, hitY, 0xfde047, 6);
        this.showElectronDelta(this.player.x, this.player.y - 62, -1, '#FDE047', true);
      }
      this.playTone(520, 0.07, 'sine', 0.05);
    }
    this.spawnReaction(hitX, hitY, target.kind === 'ranged' ? 'O' : 'C');
    if (target.hp <= 0) this.breakLayerOrKill(target);
  }

  private spawnElectronFlow(fromX: number, fromY: number, toX: number, toY: number, color: number, count: number): void {
    if (!getSettings().electronFeedbackEnabled) return;
    for (let index = 0; index < count; index += 1) {
      const particle = this.add.circle(fromX + Phaser.Math.Between(-14, 14), fromY + Phaser.Math.Between(-14, 14), 4, color)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(6);
      this.tweens.add({
        targets: particle,
        x: toX,
        y: toY,
        delay: index * 45,
        duration: 260,
        ease: 'Cubic.in',
        onComplete: () => particle.destroy()
      });
    }
  }

  private showDamageNumber(x: number, y: number, amount: number, color: string): void {
    const text = this.obtainCombatText();
    text.setFontSize(24 * this.uiScale)
      .setPosition(x + Phaser.Math.Between(-14, 14), y)
      .setText(`${amount}`)
      .setColor(color)
      .setAlpha(1)
      .setScale(1);
    this.tweens.add({ targets: text, y: y - 64, alpha: 0, duration: 620, ease: 'Cubic.out', onComplete: () => this.recycleCombatText(text) });
  }

  /**
   * 电子数量变化的实时反馈：在单位上方显示 ±N e⁻ 计数动画；
   * 同时广播到 HUD，用于玩家侧电子计数 UI 更新。
   */
  private showElectronDelta(x: number, y: number, delta: number, color: string, hud = false): void {
    if (delta === 0) return;
    // 量级分级（卫戍协议 fx 排版语言）：大额数字放大强调；随机水平漂移让相邻数字永不互相遮挡
    const big = Math.abs(delta) >= 4;
    const drift = Phaser.Math.Between(-16, 16);
    const label = this.obtainCombatText();
    label.setFontSize((big ? 27 : 20) * this.uiScale)
      .setPosition(x + drift, y)
      .setText(`${delta > 0 ? '+' : ''}${delta} e\u207B`)
      .setColor(color)
      .setAlpha(1)
      .setScale(big ? 1.85 : 1.5);
    this.tweens.add({
      targets: label,
      x: x + drift * 2.2,
      y: y - (big ? 62 : 46),
      alpha: 0,
      scale: { from: big ? 1.85 : 1.5, to: big ? 1.15 : 1 },
      duration: big ? 780 : 640,
      ease: 'Cubic.out',
      onComplete: () => this.recycleCombatText(label)
    });
    if (hud) emit('electron', { delta, color });
  }

  /** 获得自由电子并给出计数反馈；受上限约束，按实际增量显示。 */
  private gainFreeElectronsWithFeedback(x: number, y: number): void {
    const before = gameState.freeElectrons;
    gainFreeElectrons(1);
    const gained = gameState.freeElectrons - before;
    if (gained > 0) this.showElectronDelta(x, y, gained, '#67E8F9', true);
  }

  /** 播放已加载的音效资源（受设置中音量/音效开关控制） */
  private playSfx(key: string, volume = 1, rate = 1): void {
    if (!getSettings().effectsEnabled) return;
    // 四重节流：总并发 8 / 单源冷却 160ms / 全局间隔 45ms / 叠音上限 2（借鉴卫戍协议 SfxLimiter）
    if (!this.sfxLimiter.tryPlay(key, this.time.now)) return;
    try {
      this.sound.play(key, { volume: volume * (getSettings().volume / 100), rate });
    } catch { /* 音频不可用时静默 */ }
  }

  private playTone(frequency: number, duration: number, type: OscillatorType, volume: number): void {
    const context = (this.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (!context) return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch {
      // 音频上下文不可用时静默跳过
      }
  }

  private updateEnemies(delta: number): void {
    this.enemies.forEach((enemy) => {
      if (!enemy.view.visible) return;
      if (enemy.stunTimer > 0) {
        enemy.stunTimer -= delta;
        // ADD 混合下 setTint 几乎不可见，僵直改用 alpha 频闪表达
        enemy.view.setAlpha(0.5 + 0.5 * Math.abs(Math.sin(this.time.now * 0.02)));
        enemy.aura.setPosition(enemy.view.x, enemy.view.y);
        enemy.glow.setPosition(enemy.view.x, enemy.view.y);
        if (enemy.innerHalo.visible) {
          enemy.innerHalo.setPosition(enemy.view.x, enemy.view.y);
          enemy.outerHalo.setPosition(enemy.view.x, enemy.view.y);
        }
        return;
      }
      enemy.view.clearTint();
      enemy.view.setAlpha(1);
      enemy.view.x += enemy.pushX * delta;
      enemy.view.y += enemy.pushY * delta;
      enemy.pushX *= Math.pow(0.001, delta);
      enemy.pushY *= Math.pow(0.001, delta);
      // 燃烧/腐蚀 DoT：每跳造成真实伤害并叠加灼烧闪白
      if (enemy.dotTimer > 0) {
        enemy.dotTimer -= delta;
        enemy.dotTick -= delta;
        if (enemy.dotTick <= 0) {
          enemy.dotTick = 0.5;
          this.damageEnemy(enemy, enemy.dotDamage);
          this.showDamageNumber(enemy.view.x, enemy.view.y - 30, enemy.dotDamage, `#${enemy.dotColor.toString(16).padStart(6, '0')}`);
          const burn = this.add.circle(enemy.view.x, enemy.view.y, 20, enemy.dotColor, 0.35)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
          this.tweens.add({ targets: burn, scale: 2, alpha: 0, duration: 300, onComplete: () => burn.destroy() });
        }
      }
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.view.x, enemy.view.y);
      if (!enemy.enteredCombat && distance < 520) {
        enemy.enteredCombat = true;
        this.activateOrbitArcs(enemy);
      }
      this.updateOrbitVisual(enemy, delta);
      // 温度档位（设计文档 §6.1）：过热(60-80)敌人 +10% 速度，临界(80+) +25%；高温同时缩短敌人攻击间隔（上限 -30%）
      const heatSpeedBonus = gameState.temperature >= 80 ? 0.25 : gameState.temperature >= 60 ? 0.1 : 0;
      const heatAtkMult = 1 - Phaser.Math.Clamp(gameState.temperature / 100, 0, 1) * 0.3;
      const moveTo = (stopDistance: number): void => {
        if (distance > stopDistance) {
          const heatSpeed = enemy.speed * (1 + heatSpeedBonus) * enemy.slowMult;
          const angle = Phaser.Math.Angle.Between(enemy.view.x, enemy.view.y, this.player.x, this.player.y);
          enemy.view.x += Math.cos(angle) * heatSpeed * delta;
          enemy.view.y += Math.sin(angle) * heatSpeed * delta;
        }
      };
      if (enemy.kind === 'ranged') {
        moveTo(460);
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0 && distance < 780) {
          enemy.shotTimer = 2.8 * heatAtkMult;
          // 2/3 层：远程怪偶发一次射线（蓄力光束）
          if (gameState.layer >= 1 && Math.random() < 0.35) {
            const aim = Math.atan2(this.player.y - enemy.view.y, this.player.x - enemy.view.x);
            this.enemyBeamAttack(enemy.view.x, enemy.view.y, aim);
          } else {
            const baseAngle = Phaser.Math.Angle.Between(enemy.view.x, enemy.view.y, this.player.x, this.player.y);
            const burstCount = 3;
            const spread = 0.22;
            for (let i = 0; i < burstCount; i += 1) {
              const angle = baseAngle + (i - (burstCount - 1) / 2) * spread;
              const shot = this.add.circle(enemy.view.x, enemy.view.y, 5, 0xff8a4c)
                .setStrokeStyle(2.5, 0xfff7c2)
                .setBlendMode(Phaser.BlendModes.ADD);
              const shotGlow = this.add.circle(enemy.view.x, enemy.view.y, 12, 0xff8a4c, 0.15)
                .setBlendMode(Phaser.BlendModes.ADD);
              this.enemyProjectiles.push({ view: shot, glow: shotGlow, vx: Math.cos(angle) * 280, vy: Math.sin(angle) * 280 });
            }
            this.playTone(300, 0.08, 'sawtooth', 0.04);
          }
        }
      } else if (enemy.kind === 'tank') {
        enemy.chargeTimer -= delta;
        if (enemy.chargeActive) {
          moveTo(0);
        } else if (enemy.chargeTimer <= 0 && distance < 500 && distance > 120) {
          enemy.chargeActive = true;
          enemy.chargeTimer = 0.6;
          const angle = Phaser.Math.Angle.Between(enemy.view.x, enemy.view.y, this.player.x, this.player.y);
          enemy.pushX += Math.cos(angle) * 600;
          enemy.pushY += Math.sin(angle) * 600;
          this.cameraShake(45, 0.002);
          this.playTone(120, 0.15, 'sawtooth', 0.06);
        } else {
          moveTo(70);
        }
        if (enemy.chargeActive) {
          enemy.chargeTimer -= delta;
          if (enemy.chargeTimer <= 0) {
            enemy.chargeActive = false;
            enemy.chargeTimer = (3.5 + Math.random() * 1.5) * heatAtkMult;
            if (distance < 88) {
              this.damagePlayer();
              this.cameraShake(60, 0.003);
            }
          }
        }
        // 2/3 层：坦克怪周期性向玩家投掷炸弹（飞行后 AoE 爆炸）
        if (gameState.layer >= 1) {
          enemy.shotTimer -= delta;
          if (enemy.shotTimer <= 0 && distance < 640 && distance > 150) {
            enemy.shotTimer = (4.5 + Math.random() * 1.5) * heatAtkMult;
            this.throwBomb(enemy.view.x, enemy.view.y, this.player.x, this.player.y);
          }
        }
      } else if (enemy.kind === 'chaser') {
        moveTo(70);
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0 && distance < 100) {
          enemy.shotTimer = 2.8 * heatAtkMult;
          this.damagePlayer();
          const aoe = this.add.circle(enemy.view.x, enemy.view.y, 60, 0xff4d6d, 0)
            .setStrokeStyle(3, 0xff4d6d, 0.85)
            .setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: aoe, scale: { from: 0.5, to: 2.5 }, alpha: 0, duration: 320, onComplete: () => aoe.destroy() });
          this.playTone(220, 0.12, 'square', 0.06);
        }
      } else if (enemy.kind === 'acid') {
        // 酸怪：2/3 层周期释放酸雾区域（DoT）
        moveTo(240);
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0 && gameState.layer >= 1 && distance < 480) {
          enemy.shotTimer = (4 + Math.random() * 2) * heatAtkMult;
          const ox = enemy.view.x + (Math.random() * 2 - 1) * 40;
          const oy = enemy.view.y + (Math.random() * 2 - 1) * 40;
          this.spawnAcidPool(ox, oy);
        }
      } else {
        moveTo(70);
      }
      if (enemy.kind === 'healer') {
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0) {
          enemy.shotTimer = 3 * heatAtkMult;
          const wounded = this.enemies
            .filter((ally) => ally !== enemy && ally.view.visible && ally.hp < ally.maxHp)
            .sort((left, right) => Phaser.Math.Distance.Between(enemy.view.x, enemy.view.y, left.view.x, left.view.y) - Phaser.Math.Distance.Between(enemy.view.x, enemy.view.y, right.view.x, right.view.y))[0];
          if (wounded) {
            wounded.hp = Math.min(wounded.maxHp, wounded.hp + 12);
            this.spawnElectronFlow(enemy.view.x, enemy.view.y, wounded.view.x, wounded.view.y, 0x5cffb1, 4);
            this.showDamageNumber(wounded.view.x, wounded.view.y - 30, 12, '#5CFFB1');
          }
        }
      } else if (enemy.kind === 'sniper') {
        // 狙击手：保持远距离，蓄力射击高伤害单发
        moveTo(580);
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0 && distance < 900) {
          enemy.shotTimer = 4.0 * heatAtkMult;
          const angle = Phaser.Math.Angle.Between(enemy.view.x, enemy.view.y, this.player.x, this.player.y);
          // 蓄力激光：先显示瞄准线
          const laser = this.add.graphics().setDepth(105).setBlendMode(Phaser.BlendModes.ADD);
          laser.lineStyle(2, 0x38bdf8, 0.9);
          laser.beginPath();
          laser.moveTo(enemy.view.x, enemy.view.y);
          laser.lineTo(enemy.view.x + Math.cos(angle) * 900, enemy.view.y + Math.sin(angle) * 900);
          laser.strokePath();
          this.tweens.add({ targets: laser, alpha: 0, duration: 400, onComplete: () => laser.destroy() });
          // 延迟后发射高伤弹
          this.time.delayedCall(400, () => {
            if (!enemy.view.visible) return;
            const shot = this.add.circle(enemy.view.x, enemy.view.y, 7, 0x38bdf8)
              .setStrokeStyle(3, 0xe0f2fe)
              .setBlendMode(Phaser.BlendModes.ADD);
            const shotGlow = this.add.circle(enemy.view.x, enemy.view.y, 18, 0x38bdf8, 0.2)
              .setBlendMode(Phaser.BlendModes.ADD);
            this.enemyProjectiles.push({ view: shot, glow: shotGlow, vx: Math.cos(angle) * 420, vy: Math.sin(angle) * 420 });
          });
          this.playSfx('sfx-dd', 0.6); // 语义同 Chemic：敌人攻击音
          this.playTone(600, 0.15, 'sine', 0.06);
        }
      } else if (enemy.kind === 'summoner') {
        // 召唤者：保持距离，周期性召唤小型 minions
        moveTo(400);
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0 && this.enemies.length < 12) {
          enemy.shotTimer = 6.0 * heatAtkMult;
          // 召唤 1-2 个小怪
          const count = Math.random() < 0.4 ? 2 : 1;
          for (let s = 0; s < count; s += 1) {
            const sa = Math.random() * Math.PI * 2;
            const sx = enemy.view.x + Math.cos(sa) * 80;
            const sy = enemy.view.y + Math.sin(sa) * 80;
            this.spawnElectronFlow(enemy.view.x, enemy.view.y, sx, sy, 0xc084fc, 3);
            this.telegraphSpawn({ key: 'free-radical', kind: 'chaser', baseHp: 18, baseSpeed: 72, weight: 1 }, sx, sy, 18, 72);
          }
          this.playTone(440, 0.12, 'triangle', 0.05);
        }
      } else if (enemy.kind === 'shielder') {
        // 护盾者：给附近友军加临时护盾（吸收一次伤害）
        moveTo(70);
        enemy.shotTimer -= delta;
        if (enemy.shotTimer <= 0) {
          enemy.shotTimer = 4.5 * heatAtkMult;
          const nearby = this.enemies
            .filter((ally) => ally !== enemy && ally.view.visible && Phaser.Math.Distance.Between(enemy.view.x, enemy.view.y, ally.view.x, ally.view.y) < 300)
            .slice(0, 2);
          for (const ally of nearby) {
            // 护盾视觉：金色光环
            const shield = this.add.circle(ally.view.x, ally.view.y, 28, 0xfbbf24, 0)
              .setStrokeStyle(3, 0xfbbf24, 0.85)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(102);
            this.tweens.add({ targets: shield, scale: { from: 0.8, to: 1.3 }, alpha: { from: 0.8, to: 0.3 }, duration: 800, yoyo: true, repeat: 1, onComplete: () => shield.destroy() });
            // 临时增加 HP
            ally.hp = Math.min(ally.maxHp + 15, ally.hp + 15);
          }
          if (nearby.length > 0) this.playTone(520, 0.1, 'sine', 0.04);
        }
      }
      const inside = projectInside(this.diamond, enemy.view.x, enemy.view.y, 0.96);
      enemy.view.setPosition(inside.x, inside.y);
      this.applyDepthLayer(enemy.view, enemy.view.y, 100);
      if (enemy.eliteRing) {
        enemy.eliteRing.setPosition(enemy.view.x, enemy.view.y);
      }
      this.applyDepthLayer(enemy.aura, enemy.view.y, 90);
      this.applyDepthLayer(enemy.glow, enemy.view.y, 89);
      this.applyDepthLayer(enemy.innerHalo, enemy.view.y, 88);
      this.applyDepthLayer(enemy.outerHalo, enemy.view.y, 87);
      enemy.aura.setPosition(enemy.view.x, enemy.view.y);
      enemy.glow.setPosition(enemy.view.x, enemy.view.y);
      const haloPulse = 0.7 + 0.3 * Math.sin(this.time.now * 0.003 + enemy.orbitAngle);
      if (enemy.innerHalo.visible) {
        enemy.innerHalo.setPosition(enemy.view.x, enemy.view.y).setAlpha(0.04 * haloPulse);
        enemy.outerHalo.setPosition(enemy.view.x, enemy.view.y).setAlpha(0.03 * haloPulse);
      }
      // 多层电子圆点跟随敌人生成位置上方
      if (enemy.layerPips.length > 0) {
        const pips = enemy.layerPips;
        const pipX = enemy.view.x - ((pips.length - 1) * 12) / 2;
        pips.forEach((pip, i) => pip.setPosition(pipX + i * 12, enemy.view.y - 74));
      }
      enemy.attackTimer -= delta;
      const meleeContact = enemy.kind === 'chaser' || enemy.kind === 'tank' || enemy.kind === 'acid';
      if (meleeContact && distance < 76 && enemy.attackTimer <= 0) {
        enemy.attackTimer = 1.5;
        this.damagePlayer();
      }
    });
  }

  private pulseEnemyOrbit(target: RuntimeEnemy): void {
    if (!target.orbit || !target.enteredCombat) return;
    target.orbitArcs.forEach((arc) => {
      if (!arc.visible) return;
      arc.setScale(1.9);
      arc.setFillStyle(0xffffff);
      arc.setStrokeStyle(1.5, 0xffffff, 1);
      this.tweens.add({
        targets: arc,
        scale: 1,
        duration: 180,
        ease: 'Cubic.out',
        onComplete: () => {
          arc.setFillStyle(0xff5c7a);
          arc.setStrokeStyle(1.5, 0xffffff, 0.85);
        }
      });
    });
  }

  private activateOrbitArcs(enemy: RuntimeEnemy): void {
    if (!enemy.orbit || enemy.orbitArcs.length > 0) return;
    for (let index = 0; index < ORBIT_CAPACITY; index += 1) {
      const arc = this.add.circle(enemy.view.x, enemy.view.y, 4.5, 0xff5c7a, 0.95)
        .setStrokeStyle(2.5, 0xffffff, 0.85)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(2)
        .setVisible(false);
      enemy.orbitArcs.push(arc);
    }
  }

  private updateOrbitVisual(enemy: RuntimeEnemy, delta: number): void {
    const orbit = enemy.orbit;
    if (!orbit || !enemy.enteredCombat) return;
    if (orbit.count <= 0 || enemy.stunTimer > 0) return;
    enemy.orbitAngle += delta * 1.8;
    const radius = enemy.view.displayWidth / 2 + 14;
    for (let index = 0; index < ORBIT_CAPACITY; index += 1) {
      const arc = enemy.orbitArcs[index];
      if (index < orbit.count) {
        const angle = enemy.orbitAngle + (index / orbit.count) * Math.PI * 2;
        arc.setPosition(
          enemy.view.x + Math.cos(angle) * radius,
          enemy.view.y + Math.sin(angle) * radius * 0.85
        );
        this.applyDepthLayer(arc, arc.y, 120);
        arc.setVisible(true);
      } else if (arc.visible) {
        arc.setVisible(false);
      }
    }
  }

  /**
   * 攻击方向瞄准：碰撞判定只针对敌人本体，命中后从该敌人的轨道电子中
   * 自动选取与攻击方向夹角最小的电子，返回其槽位索引（无可选电子返回 -1）。
   */
  private pickOrbitArcIndexToward(target: RuntimeEnemy, px: number, py: number): number {
    const orbit = target.orbit;
    if (!orbit || orbit.count <= 0) return -1;
    const indices: number[] = [];
    const angles: number[] = [];
    for (let index = 0; index < orbit.count; index += 1) {
      const arc = target.orbitArcs[index];
      if (!arc || !arc.visible) continue;
      indices.push(index);
      angles.push(Phaser.Math.Angle.Between(target.view.x, target.view.y, arc.x, arc.y));
    }
    if (indices.length === 0) return -1;
    const picked = pickSlotToward(angles, Phaser.Math.Angle.Between(target.view.x, target.view.y, px, py));
    return picked >= 0 ? indices[picked] : -1;
  }

  private oxidizeInteraction(target: RuntimeEnemy, hitX: number, hitY: number): void {
    const orbit = target.orbit!;
    const index = this.pickOrbitArcIndexToward(target, hitX, hitY);
    if (index < 0) {
      this.registerHit(target, hitX - target.view.x, hitY - target.view.y);
      return;
    }
    const px = hitX;
    const py = hitY;
    const arc = target.orbitArcs[index];
    const ax = arc.x;
    const ay = arc.y;
    // 与最后一个活跃槽位交换后弹出被湮灭电子，保持 arcs[0..count-1] 为活跃区
    const lastIndex = orbit.count - 1;
    const moved = target.orbitArcs[lastIndex];
    target.orbitArcs[lastIndex] = arc;
    target.orbitArcs[index] = moved;
    // 一次有效击中形成一对：仅抵消一颗
    annihilatePair(orbit);
    this.gainReactionLayers(1);
    // 电子对立即从轨道脱离：对应轨道槽位渐隐
    this.tweens.add({
      targets: arc,
      alpha: 0,
      scale: 0.4,
      duration: 260,
      ease: 'Sine.in',
      onComplete: () => {
        arc.setVisible(false);
        arc.setScale(1);
        arc.setAlpha(1);
      }
    });
    const mx = (px + ax) / 2;
    const my = (py + ay) / 2;
    // 氧化打击 Zap 线：从我方核心拉向命中电子的高亮电弧——
    // 「攻击从我出发」的方向性反馈，与敌人来袭弹（自外向内）形成明确区分
    const zap = this.add.graphics().setDepth(105).setBlendMode(Phaser.BlendModes.ADD);
    zap.lineStyle(10, this.orbitColor, 0.4);
    zap.beginPath();
    zap.moveTo(this.player.x, this.player.y);
    zap.lineTo(ax, ay);
    zap.strokePath();
    zap.lineStyle(3.5, 0xfff7c2, 0.95);
    zap.beginPath();
    zap.moveTo(this.player.x, this.player.y);
    zap.lineTo(ax, ay);
    zap.strokePath();
    this.tweens.add({ targets: zap, alpha: 0, duration: 150, onComplete: () => zap.destroy() });
    const ghostMine = this.add.circle(px, py, 4.5, 0xfde047).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
    const ghostEnemy = this.add.circle(ax, ay, 4.5, 0xff5c7a).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
    this.tweens.add({
      targets: [ghostMine, ghostEnemy],
      x: mx,
      y: my,
      duration: CAPTURE_ANIM.flyMs / 2,
      ease: 'Cubic.in',
      onComplete: () => {
        ghostMine.destroy();
        ghostEnemy.destroy();
        // 湮灭爆发：白核闪光 + 扩张冲击环，强化「这是我打出的电子对」的存在感
        const burstCore = this.add.circle(mx, my, 8, 0xffffff, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
        this.tweens.add({ targets: burstCore, scale: { from: 0.5, to: 2.2 }, alpha: 0, duration: 180, onComplete: () => burstCore.destroy() });
        const burstRing = this.add.circle(mx, my, 10, 0xfde047, 0)
          .setStrokeStyle(2.5, 0xfde047, 0.9)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
        this.tweens.add({ targets: burstRing, scale: { from: 0.4, to: 2 }, alpha: 0, duration: 260, onComplete: () => burstRing.destroy() });
        // 电子对脱离轨道，互绕漂浮至存在时间结束
        this.spawnReactionPair(mx, my);
        this.playTone(1400, 0.04, 'square', 0.05);
        this.playTone(150, 0.09, 'sawtooth', 0.06);
      }
    });
    const speed = Math.hypot(px - target.view.x, py - target.view.y) || 1;
    target.pushX += ((px - target.view.x) / speed) * 120;
    target.pushY += ((py - target.view.y) / speed) * 120;
    this.showElectronDelta(target.view.x, target.view.y - 56, -1, '#E0AAFF');
    this.cameraShake(40, 0.0015);
    this.spawnReaction(target.view.x, target.view.y, target.kind === 'ranged' ? 'O' : 'C');
    // 全部 N 颗电子成对抵消后，死亡判定
    if (orbit.count <= 0) this.breakLayerOrKill(target);
    // 暴击判定（活性位点 + 遗物「量子共振器」）
    const isCrit = Math.random() < (this.boonCritChanceVal + this.relicCritChance / 100);
    const critExtra = isCrit ? this.boonCritBonus : 0;    // 祝福额外夺取：过载打击/链式反应/玻璃大炮 + 共振冲刺倍率
    const extraHits = Math.floor((this.boonExtraElectronOxidize + this.relicOxidizeBonus / 10 + critExtra) * this.electronMult);
    for (let i = 0; i < extraHits && orbit.count > 0; i++) {
      annihilatePair(orbit);
      this.showElectronDelta(target.view.x + (i + 1) * 12, target.view.y - 56, -1, '#E0AAFF');
    }
    if (orbit.count <= 0) this.breakLayerOrKill(target);
    // 电子压制：伤害%加成转译为额外夺取（氧化态/装备/武器形态在此真实生效）
    this.applyElectronPressure(orbit, 'oxidized', () => {
      this.showElectronDelta(target.view.x + 12, target.view.y - 56, -1, '#E0AAFF');
    });
    if (orbit.count <= 0) this.breakLayerOrKill(target);
    if (isCrit) {
      this.showFloatingText(target.view.x, target.view.y - 72, '暴击！', '#FBBF24');
      this.playTone(1800, 0.06, 'square', 0.06);
    }
    // 点燃DOT（o-atk-ignite）：附加燃烧，每秒夺取1颗电子
    if (this.boonIgniteDuration > 0 && orbit.count > 0) {
      this.applyDotEffect(target, this.boonIgniteDuration, 1000, (t) => {
        if (t.orbit && t.orbit.count > 0 && t.view.visible) {
          annihilatePair(t.orbit);
          this.showElectronDelta(t.view.x, t.view.y - 56, -1, '#FF6B35');
          if (t.orbit.count <= 0) this.breakLayerOrKill(t);
        }
      });
    }
    // 酸蚀DOT（o-atk-acid）：减速+每秒夺取1颗电子
    if (this.boonAcidDuration > 0 && orbit.count > 0) {
      target.slowMult = 0.5;
      this.time.delayedCall(2000, () => { if (target.view) target.slowMult = 1; });
      this.applyDotEffect(target, this.boonAcidDuration, 1000, (t) => {
        if (t.orbit && t.orbit.count > 0 && t.view.visible) {
          annihilatePair(t.orbit);
          this.showElectronDelta(t.view.x, t.view.y - 56, -1, '#22C55E');
          if (t.orbit.count <= 0) this.breakLayerOrKill(t);
        }
      });
    }
    // 链式反应弹射（h-atk-chain）：弹射夺取最近敌人 n 颗电子
    if (this.boonChainCount > 0 && orbit.count > 0) {
      let nearest: RuntimeEnemy | null = null;
      let nearestDist = 300;
      for (const e of this.enemies) {
        if (e === target || !e.view.visible || !e.orbit || e.orbit.count <= 0) continue;
        const d = Phaser.Math.Distance.Between(target.view.x, target.view.y, e.view.x, e.view.y);
        if (d < nearestDist) { nearestDist = d; nearest = e; }
      }
      if (nearest) this.stealElectrons(nearest, this.boonChainCount, '#FF5C7A');
    }
    // 散热涂层联动：温度每低10度额外夺取1颗
    if (this.boonHeatReduction > 0 && gameState.temperature < 50) {
      const bonusFromTemp = Math.floor((50 - gameState.temperature) / 10);
      for (let i = 0; i < bonusFromTemp && orbit.count > 0; i++) {
        annihilatePair(orbit);
        this.showElectronDelta(target.view.x + (i + 1) * 12, target.view.y - 56, -1, '#67E8F9');
      }
      if (orbit.count <= 0) this.breakLayerOrKill(target);
    }
    // 晶格冲击：20%概率眩晕1秒，并额外夺取 n 颗电子（氧化攻击通用）
    if (this.boonLatticeBonus > 0 && orbit.count > 0 && Math.random() < 0.2) {
      target.stunTimer = Math.max(target.stunTimer, 1);
      this.showFloatingText(target.view.x, target.view.y - 72, '眩晕', '#FBBF24');
      this.stealElectrons(target, this.boonLatticeBonus, '#FBBF24');
    }
  }

  /** 生成一对已脱离轨道的电子对，互绕漂浮，存在时间结束后自动破碎。 */
  private spawnReactionPair(x: number, y: number): void {
    const mine = this.add.circle(x, y, 4.5, 0xfde047).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
    const theirs = this.add.circle(x, y, 4.5, 0xff5c7a).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
    this.reactionPairs.push({
      x,
      y,
      angle: Math.random() * Math.PI * 2,
      spin: Phaser.Math.FloatBetween(ELECTRON_PAIR_ANIM.spinMin, ELECTRON_PAIR_ANIM.spinMax),
      life: ELECTRON_PAIR_LIFETIME,
      mine,
      theirs
    });
  }

  /** 电子对状态更新：互绕、脉冲；存在时间结束自动破碎并清除。 */
  private updateReactionPairs(dt: number): void {
    this.reactionPairs = this.reactionPairs.filter((pair) => {
      pair.life -= dt;
      pair.angle += pair.spin * dt;
      const rx = Math.cos(pair.angle) * ELECTRON_PAIR_ANIM.radius;
      const ry = Math.sin(pair.angle) * ELECTRON_PAIR_ANIM.radius;
      const pulse = 1 + Math.sin(this.time.now * 0.02) * 0.15;
      pair.mine.setPosition(pair.x + rx, pair.y + ry).setScale(pulse);
      pair.theirs.setPosition(pair.x - rx, pair.y - ry).setScale(pulse);
      if (pair.life > 0) return true;
      this.shatterPair(pair.x, pair.y, pair.mine, pair.theirs);
      return false;
    });
  }

  /** 电子对到期破碎：十字闪光 + 火花，随后清除实体。 */
  private shatterPair(mx: number, my: number, mine: Phaser.GameObjects.Arc, theirs: Phaser.GameObjects.Arc): void {
    mine.destroy();
    theirs.destroy();
    const flash = this.add.circle(mx, my, 16, 0xffffff, 0.9).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.8,
      duration: 200,
      onComplete: () => {
        flash.destroy();
      }
    });
    for (let index = 0; index < 8; index += 1) {
      const spark = this.add.circle(mx, my, 3, index % 2 === 0 ? 0xe0aaff : 0xffffff)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: spark,
        x: mx + Phaser.Math.Between(-60, 60),
        y: my + Phaser.Math.Between(-60, 60),
        alpha: 0,
        scale: 0.2,
        duration: 240,
        onComplete: () => spark.destroy()
      });
    }
    this.playTone(1200, 0.05, 'square', 0.04);
    this.playTone(140, 0.08, 'sawtooth', 0.05);
  }

  private reduceInteraction(target: RuntimeEnemy, hitX: number, hitY: number): void {
    const orbit = target.orbit!;
    const px = hitX;
    const py = hitY;
    // 目标电子 = 最接近攻击方向的轨道电子；无既有电子时落在攻击方向对应的轨道槽位
    const aimIndex = this.pickOrbitArcIndexToward(target, px, py);
    const aimed = aimIndex >= 0 ? target.orbitArcs[aimIndex] : null;
    const radius = target.view.displayWidth / 2 + 14;
    const angle = Phaser.Math.Angle.Between(target.view.x, target.view.y, px, py);
    const slotX = aimed ? aimed.x : target.view.x + Math.cos(angle) * radius;
    const slotY = aimed ? aimed.y : target.view.y + Math.sin(angle) * radius;
    const ghost = this.add.circle(px, py, 4.5, 0xfde047).setBlendMode(Phaser.BlendModes.ADD).setDepth(6);
    this.tweens.add({
      targets: ghost,
      x: slotX,
      y: slotY,
      duration: CAPTURE_ANIM.flyMs,
      ease: CAPTURE_ANIM.flyEase,
      onComplete: () => {
        ghost.destroy();
        const result = captureElectron(orbit);
        const arc = target.orbitArcs[result.count - 1];
        if (arc) {
          // 入场动画：从槽位缩放弹入，透明度渐显，参数可配
          arc.setPosition(slotX, slotY);
          arc.setVisible(true);
          arc.setAlpha(0);
          arc.setScale(0.3);
          this.tweens.add({
            targets: arc,
            alpha: 1,
            scale: 1,
            duration: CAPTURE_ANIM.settleMs,
            ease: CAPTURE_ANIM.settleEase
          });
          const ring = this.add.circle(slotX, slotY, 10, 0xffffff, 0)
            .setStrokeStyle(2, 0xfde047, 0.9)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(6);
          this.tweens.add({
            targets: ring,
            scale: { from: 0.5, to: 2.2 },
            alpha: 0,
            duration: CAPTURE_ANIM.settleMs,
            onComplete: () => ring.destroy()
          });
        }
        if (aimed && aimed !== arc && aimed.visible) {
          // 同行电子共鸣脉冲
          aimed.setScale(CAPTURE_ANIM.resonateScale);
          this.tweens.add({ targets: aimed, scale: 1, duration: CAPTURE_ANIM.resonateMs, ease: 'Cubic.out' });
        }
        this.playTone(660, 0.06, 'sine', 0.05);
        // 还原态吸热降温（§2.2）：注入即吸热，还原是本作唯一的主动控温手段
        this.coolFromReduction(target.view.x, target.view.y);
        if (result.inertified) {
          this.overloadEnemy(target);
        } else {
          this.showElectronDelta(target.view.x, target.view.y - 56, 1, '#FDE047');
        }
        // 祝福额外填充 + 遗物「还原稳定器」：散热涂层联动等（受共振冲刺倍率影响）
        const extraHits = Math.floor((this.boonExtraElectronReduce + this.relicReduceBonus / 10) * this.electronMult);
        for (let i = 0; i < extraHits; i++) {
          const extraResult = captureElectron(orbit);
          this.showElectronDelta(target.view.x + (i + 1) * 12, target.view.y - 56, 1, '#FDE047');
          this.coolFromReduction(target.view.x, target.view.y);
          if (extraResult.inertified) {
            this.overloadEnemy(target);
            break;
          }
        }
        // 电子压制：伤害%加成转译为额外注入（还原态在此真实生效）
        if (!target.dead) {
          this.applyElectronPressure(orbit, 'reduced', () => {
            this.showElectronDelta(target.view.x + 12, target.view.y - 56, 1, '#FDE047');
            this.coolFromReduction(target.view.x, target.view.y);
          }, () => this.overloadEnemy(target));
        }
      }
    });
  }

  /**
   * 还原满 8 颗电子：立即触发死亡判定，并播放惰化破碎动画。
   */
  private overloadEnemy(target: RuntimeEnemy): void {
    const orbit = target.orbit!;
    const removed = orbit.count;
    for (let index = 0; index < ORBIT_CAPACITY; index += 1) {
      const arc = target.orbitArcs[index];
      if (!arc.visible) continue;
      for (let shard = 0; shard < 4; shard += 1) {
        const particle = this.add.circle(arc.x, arc.y, 3, shard % 2 === 0 ? 0xff5c7a : 0xfde047)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({
          targets: particle,
          x: arc.x + Phaser.Math.Between(-46, 46),
          y: arc.y + Phaser.Math.Between(-46, 46),
          alpha: 0,
          scale: 0.2,
          duration: 260,
          onComplete: () => particle.destroy()
        });
      }
      arc.setVisible(false);
    }
    orbit.count = 0;
    target.stunTimer = 2.5;
    this.showElectronDelta(target.view.x, target.view.y - 40, -removed, '#FDE047');
    this.cameraShake(60, 0.003);
    this.playTone(90, 0.25, 'sawtooth', 0.08);
    this.playTone(1320, 0.12, 'sine', 0.05);
    const burst = this.add.circle(target.view.x, target.view.y, 20, 0xffffff, 0)
      .setStrokeStyle(4, 0xfde047, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: burst, scale: { from: 0.5, to: 4 }, alpha: 0, duration: 360, onComplete: () => burst.destroy() });
    // 电子塞满容量 → 死亡判定（多层怪破层而非秒杀）
    this.breakLayerOrKill(target);
  }

  /** 当层生命/轨道电子耗尽结算：多层怪破一层（重建轨道供后续氧化继续），否则正常击杀。避免氧化一次即秒杀多层怪。 */
  private breakLayerOrKill(target: RuntimeEnemy): void {
    this.damageEnemy(target, target.maxHp);
    // 破层回充：剩余层数参与电子数换算（层数越多回充越多，多层怪真正耐打）
    target.orbit = createOrbit(target.maxHp, Math.max(1, target.electronLayers), BALANCE.combat.enemyHpPerElectron);
  }

  /** 对敌人造成伤害；多层电子下耗尽一层则回满血并破一层，否则真正击杀。 */
  private damageEnemy(target: RuntimeEnemy, amount: number): void {
    // v0.2.2：单次攻击最多破坏一层——溢出伤害不顺延到下一层（避免一击穿多层）
    target.hp -= amount;
    if (target.hp > 0) return;
    if (target.electronLayers > 1) {
      target.electronLayers -= 1;
      target.hp = target.maxHp; // 新层回满血，本次剩余伤害作废
      // 破层视觉：顶部圆点减一枚、环状冲击 + 浮字
      const pip = target.layerPips.pop();
      if (pip) this.tweens.add({ targets: pip, scale: 3, alpha: 0, duration: 250, onComplete: () => pip.destroy() });
      const ring = this.add.circle(target.view.x, target.view.y, 30, 0x5a8bff, 0)
        .setStrokeStyle(3, 0x67e8f9, 0.9).setBlendMode(Phaser.BlendModes.ADD).setDepth(60);
      this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 360, onComplete: () => ring.destroy() });
      this.showFloatingText(target.view.x, target.view.y - 56, '破层', '#67E8F9');
      this.playTone(460, 0.12, 'triangle', 0.06);
      this.cameraShake(30, 0.001);
      return;
    }
    this.killEnemy(target, target.view.x, target.view.y);
  }

  private killEnemy(target: RuntimeEnemy, x: number, y: number): void {
    if (target.dead) return;
    target.dead = true;
    target.layerPips.forEach((pip) => pip.destroy());
    target.eliteRing?.destroy();
    target.eliteRing = null;
    haptic(30);
    target.aura.setVisible(false);
    target.glow.setVisible(false);
    target.orbitArcs.forEach((arc) => arc.setVisible(false));
    const heatBonus = Math.floor(gameState.temperature / BALANCE.samples.killHeatDivisor);
    // 装备（低温样本仓）提升样本收益
    const killSamples = Math.round((BALANCE.samples.killBase + heatBonus) * this.gearSampleMult);
    gameState.samples += killSamples;
    gameState.kills += 1;
    // 遗物「电子心脏」：击杀回血
    if (this.relicHealOnKill > 0) {
      const healAmount = this.relicHealOnKill;
      gameState.ehp = Math.min(gameState.ehp + healAmount, gameState.ehpMax);
      this.showFloatingText(this.player.x, this.player.y - 40, `+${healAmount.toFixed(1)}`, '#22C55E');
    }
    this.playSfx('sfx-hit', 0.7);
    this.playTone(pitchJitter(110), 0.18, 'sawtooth', 0.08);
    // 击杀反馈：按层级给出定格 + 屏震 + 缩放冲击（精英怪更高一级）
    this.applyFeedback(target.isElite ? 'elite' : 'kill');
    if (target.maxHp <= SINGLE_HIT_MAX_HP) {
      const view = target.view;
      this.tweens.add({
        targets: view,
        scale: 0.05,
        alpha: 0,
        duration: 130,
        ease: 'Cubic.in',
        onComplete: () => view.setVisible(false)
      });
      this.playTone(500, 0.05, 'square', 0.05);
    } else {
      target.view.setVisible(false);
      const burst = this.add.circle(x, y, 14, 0xffffff, 0)
        .setStrokeStyle(4, 0x67e8f9, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: burst, scale: { from: 0.5, to: 5 }, alpha: 0, duration: 420, onComplete: () => burst.destroy() });
    }
    if (target.kind === 'acid') this.spawnAcidPool(x, y);
    // 击杀 40% 概率掉落自由电子（特殊攻击的强化资源，可囤积在地面）
    this.spawnElectronDrop(x, y);
  }

  private damagePlayer(): void {
    if (this.playerDying) return;
    hapticHurt();
    // 温度档位（设计文档 §6.1）：过热(60-80)敌人伤害 +10%，临界(80+) +20%
    const heatDmgMult = gameState.temperature >= 80 ? 1.2 : gameState.temperature >= 60 ? 1.1 : 1;
    const incoming = Math.round(10 * heatDmgMult);
    const result = damagePlayerState(incoming);
    // 玻璃大炮：受伤额外失去1个价电子
    if (this.boonGlassCannonPenalty > 0 && gameState.valence > 0) {
      gameState.valence -= this.boonGlassCannonPenalty;
      gameState.ehp = gameState.ehpMax;
      if (gameState.valence <= 0) {
        this.playerDeath();
        return;
      }
      this.showFloatingText(this.player.x, this.player.y - 80, '玻璃破碎！', '#FF4D2E');
    }
    if (result.died) {
      this.playerDeath();
      return;
    }
    this.applyFeedback('playerHurt');
    // 受击形变：向内挤压一下，配合屏震把"被打到"的信息做实
    this.playPlayerSquash(0.16, 0.2);
    this.playTone(pitchJitter(180), 0.1, 'square', 0.08);
    emit('damage', { amount: incoming, mode: 'enemy' });
    // 受击即时的电子反馈：轨道转为受击/失电子状态 + 本体白闪 + 电子飞散
    this.setPlayerOrbitState(result.lostElectron ? 'lost' : 'hurt', result.lostElectron ? 0.45 : 0.24);
    this.attackRecoil = Math.max(this.attackRecoil, 0.5);
    const flashOverlay = this.add.circle(this.player.x, this.player.y, 56, 0xffffff, 0.4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(5);
    this.tweens.add({ targets: flashOverlay, alpha: 0, scale: 1.3, duration: 120, onComplete: () => flashOverlay.destroy() });
    this.player.setTint(0xff8a8a);
    this.time.delayedCall(110, () => {
      if (!this.playerDying) this.applyModeTint();
    });
    // 飞散电子数量随伤害严重度变化
    const shardCount = result.lostElectron ? 8 : 3;
    for (let index = 0; index < shardCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const electron = this.add.circle(this.player.x, this.player.y, 4, 0xfde047)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(7);
      this.tweens.add({
        targets: electron,
        x: this.player.x + Math.cos(angle) * Phaser.Math.Between(56, 104),
        y: this.player.y + Math.sin(angle) * Phaser.Math.Between(56, 104),
        alpha: 0,
        duration: 300,
        onComplete: () => electron.destroy()
      });
    }
    if (result.lostElectron) {
      this.showElectronDelta(this.player.x, this.player.y - 62, -1, '#FF5C7A', true);
      this.cameraShake(80, 0.004);
      this.playTone(120, 0.2, 'sawtooth', 0.09);
      this.orbitColor = 0xff5c7a;
      const burst = this.add.circle(this.player.x, this.player.y, 24, 0xffffff, 0)
        .setStrokeStyle(4, 0xff5c7a, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: burst, scale: { from: 0.5, to: 4 }, alpha: 0, duration: 380, onComplete: () => burst.destroy() });
      this.time.delayedCall(400, () => {
        if (!this.playerDying) this.orbitColor = gameState.dyeColor || 0x67e8f9;
      });
    }
    // 遗物「价电子护盾」反伤效果：按比例反弹所受伤害
    if (this.relicThornsChance > 0 && Math.random() * 100 < this.relicThornsChance) {
      const thornsDmg = Math.max(1, Math.round(10 * this.relicThornsDamage));
      // 对最近的敌人造成反伤
      let nearestDist = Infinity;
      let nearestEnemy: RuntimeEnemy | null = null;
      for (const enemy of this.enemies) {
        if (!enemy.view.visible) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.view.x, enemy.view.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemy = enemy;
        }
      }
      if (nearestEnemy && nearestDist < 400) {
        nearestEnemy.hp -= thornsDmg;
        this.showDamageNumber(nearestEnemy.view.x, nearestEnemy.view.y - 30, thornsDmg, '#8B5CF6');
        if (nearestEnemy.hp <= 0) this.breakLayerOrKill(nearestEnemy);
      }
      this.showFloatingText(this.player.x, this.player.y - 80, '反伤！', '#8B5CF6');
    }
  }

  private applyModeTint(): void {
    this.player.setTint(gameState.mode === 'oxidized' ? 0xffb08a : 0xfff7c2);
  }

  private playerDeath(): void {
    if (this.playerDying) return;
    this.playerDying = true;
    this.upgradeSelectionActive = false;
    this.playSfx('sfx-behit', 1);
    // 关闭祝福选择面板（防止死亡时残留）
    const overlay = document.getElementById('upgrade-overlay');
    if (overlay) overlay.classList.remove('show', 'fade-out');
    const cards = document.getElementById('upgrade-cards');
    if (cards) cards.innerHTML = '';
    gameState.ehp = 0;
    this.playerBody.setAcceleration(0, 0);
    this.playerBody.setVelocity(0, 0);
    this.orbitElectrons.forEach((sat) => {
      this.tweens.add({
        targets: sat.electron,
        x: sat.electron.x + Phaser.Math.Between(-160, 160),
        y: sat.electron.y + Phaser.Math.Between(-160, 160),
        alpha: 0,
        duration: 600,
        ease: 'Cubic.out'
      });
      this.tweens.add({ targets: sat.glow, alpha: 0, duration: 300 });
    });
    this.orbitRings.forEach((ring) => {
      this.tweens.add({ targets: ring.graphics, alpha: 0, duration: 500 });
    });
    this.tweens.add({
      targets: this.player,
      scale: 0.05,
      alpha: 0,
      angle: 360,
      duration: 700,
      ease: 'Cubic.in'
    });
    const flash = this.add.circle(this.player.x, this.player.y, 40, 0xffffff, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, alpha: 0, scale: 3, duration: 500, onComplete: () => flash.destroy() });
    this.cameraShake(160, 0.006);
    this.playTone(60, 0.6, 'sawtooth', 0.1);
      this.time.delayedCall(1000, () => {
      emit('death', { samples: gameState.samples });
      // §13.1 + 核心循环「死亡丢失未保险样本」：携带样本随死亡丢失，
      // 但累计击杀/深度/Boss 进度照常记录（Fail forward 体现在成长而非样本）。
      // 修正前死亡会把携带样本全额存入档案，导致"送死比撤离更赚"，直接破坏搜打撤循环。
      const lostSamples = BALANCE.economy.loseCarriedSamplesOnDeath ? gameState.samples : 0;
      applyProgress({
        samples: lostSamples > 0 ? 0 : gameState.samples,
        kills: gameState.kills,
        bestDepth: Math.max(1, gameState.roomIndex),
        bestLayer: gameState.layer
      });
      // 隐藏关保护：撤离点为「隐藏撤离」时死亡，本局收益不丢失（样本/战利品入库）
      const hiddenProtection = this.extractionDef.id === 'hidden';
      let protectedSamples = 0;
      if (hiddenProtection) {
        protectedSamples = gameState.samples;
        bankCarriedGear(gameState.carriedGear);
        profileState.samples += protectedSamples;
        this.showFloatingText(this.player.x, this.player.y - 40, '隐藏关保护 · 收益已入库', '#FFD700');
      }
      // 搜打撤：死亡丢失携带装备与局内搜到的战利品（成功撤离才带得出去）
      const deathGear = loseGearOnDeath(gameState.carriedGear);
      saveProfile();
      // 死亡战报：丢失明明白白划线呈现，保留的成长给出 Fail forward 安慰
      this.showRunReport(
        '实验事故',
        '#FF5C7A',
        [
          { label: lostSamples > 0 ? '丢失样本' : '样本', value: hiddenProtection ? `+${protectedSamples}（入库）` : lostSamples > 0 ? `-${lostSamples}` : `${gameState.samples}` },
          { label: '丢失装备', value: hiddenProtection ? '已入库（隐藏关保护）' : deathGear.lost.length > 0 ? `${deathGear.lost.length} 件` : '—' },
          { label: '本次击杀', value: `${gameState.kills}` },
          { label: '到达深度', value: `第 ${gameState.layer + 1} 层 · 房间 ${gameState.roomIndex + 1}` },
          { label: '保留进度', value: '已记录', total: true }
        ],
        [
          ...(hiddenProtection ? [] : deathGear.lost.map((id) => ({ id, lost: true }))),
          ...(hiddenProtection ? [] : gameState.carriedGear.map((id) => ({ id, lost: true })))
        ],
        hiddenProtection ? '隐藏关保护生效 · 收益已入库（稀有样本资格已失去）' : '实验数据已保留 · 死亡永远带来成长'
      );
      resetRun();
      this.resetBoonState();
      this.reportContinue = () => {
        this.cameras.main.fadeOut(900, 10, 14, 26);
        this.time.delayedCall(950, () => {
          this.scene.stop('UIScene');
          this.scene.start('LobbyScene');
        });
      };
    });
  }

  private doDash(): void {
    const isSecondDash = this.dashCount === 1;
    this.dashCount = isSecondDash ? 0 : 1;
    this.dashNextReadyTimer = isSecondDash ? 0 : BALANCE.dash.nextReadySeconds;
    this.dashWindowTimer = isSecondDash ? 0 : BALANCE.dash.windowSeconds;
    if (isSecondDash) gameState.dashCd = this.dashCooldownSeconds();
    const dir = this.lastDirection.clone();
    this.dashMotionTimer = BALANCE.dash.motionSeconds;
    // 冲刺拉伸：沿移动方向拉长本体，让位移方向与速度感一致
    this.playPlayerSquash(0.16, 0.2, true);
    this.playSfx('sfx-huu', 0.5); // 语义同 Chemic huu=底部面板收起，作冲刺音
    this.playerBody.setMaxVelocity(BALANCE.dash.maxVelocity, BALANCE.dash.maxVelocity);
    this.playerBody.setVelocity(dir.x * BALANCE.dash.velocity, dir.y * BALANCE.dash.velocity);
    // ---- 冲刺祝福 ----
    // 碳纤冲刺：冲刺获得护盾（先于 EHP 吸收伤害）
    if (this.boonDashShield > 0) {
      this.gainShield(Math.round(this.boonDashShield), 'dash');
      const ring = this.add.circle(this.player.x, this.player.y, 70, 0x67e8f9, 0)
        .setStrokeStyle(3, 0x67e8f9, 0.8)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);
      this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
    }
    // 氧化雾：冲刺起点留下毒雾（每秒夺取敌人电子）
    if (this.boonMistDps > 0) {
      this.spawnMist(this.player.x, this.player.y, this.boonMistDps);
    }
    // 冲刺引爆：冲刺爆炸夺取范围内敌人各 n 颗电子
    if (this.boonDetonateCount > 0) {
      const detonateRadius = 180 * this.boonAoeMult;
      for (const enemy of this.enemies) {
        if (!enemy.view.visible) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.view.x, enemy.view.y);
        if (d < detonateRadius) {
          const mode = gameState.mode;
          if (enemy.orbit && enemy.enteredCombat) {
            if (mode === 'oxidized') this.oxidizeInteraction(enemy, enemy.view.x, enemy.view.y);
            else this.reduceInteraction(enemy, enemy.view.x, enemy.view.y);
            // 基础互动已取 1 颗，剩余按强化等级补齐
            this.stealElectrons(enemy, this.boonDetonateCount - 1, '#FF8A4C');
          } else {
            const spectralBonus = 1 + this.getSpectralBonus(enemy);
            const finalDmg = 5 * spectralBonus;
            this.damageEnemy(enemy, finalDmg);
            this.showDamageNumber(enemy.view.x, enemy.view.y - 30, finalDmg, '#FF8A4C');
          }
          const burst = this.add.circle(enemy.view.x, enemy.view.y, 22, 0xff8a4c, 0.5)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(90);
          this.tweens.add({ targets: burst, scale: 2.2, alpha: 0, duration: 240, onComplete: () => burst.destroy() });
        }
      }
    }
    // 共振冲刺：下一次攻击电子夺取倍率
    if (this.boonEchoMult > 1) {
      this.nextAttackBoost = this.boonEchoMult;
      this.showFloatingText(this.player.x, this.player.y - 62, '共鸣', '#A78BFA');
    }
    for (let index = 1; index <= 3; index += 1) {
      const ghost = this.add.image(
        this.player.x - dir.x * index * 26,
        this.player.y - dir.y * index * 26,
        'hydrogen-core'
      )
        .setDisplaySize(92, 92)
        .setAlpha(0.35)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: ghost, alpha: 0, duration: 260 + index * 40, onComplete: () => ghost.destroy() });
    }
    if (isSecondDash) {
      const burst = this.add.circle(this.player.x, this.player.y, 26, 0xffffff, 0)
        .setStrokeStyle(4, 0xfde047, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: burst, scale: { from: 0.8, to: 3.4 }, alpha: 0, duration: 260, onComplete: () => burst.destroy() });
      this.setPlayerOrbitState('attack', 0.34);
      this.playTone(520, 0.12, 'triangle', 0.08);
    } else {
      this.setPlayerOrbitState('attack', 0.18);
      this.playTone(340, 0.1, 'triangle', 0.05);
    }
  }

  private requestDash(): void {
    // 冷却中不丢弃输入：记入缓冲窗口，冷却一结束立即兑现（宽容 ≠ 纵容，窗口仅 DASH_BUFFER_SEC）
    if (gameState.dashCd > 0) {
      this.dashBufferTimer = DASH_BUFFER_SEC;
      return;
    }
    if (this.dashCount === 1 && this.dashNextReadyTimer > 0) {
      this.dashBufferTimer = DASH_BUFFER_SEC;
      return;
    }
    if (this.dashCount > 1) return;
    this.doDash();
  }

  private updateEnemyProjectiles(delta: number): void {
    this.enemyProjectiles = this.enemyProjectiles.filter((shot) => {
      const { view } = shot;
      view.x += shot.vx * delta;
      view.y += shot.vy * delta;
      shot.glow.setPosition(view.x, view.y);
      // 护盾墙拦截
      for (const wall of this.shieldWalls) {
        const dx = view.x - wall.x;
        const dy = view.y - wall.y;
        const cos = Math.cos(-wall.angle);
        const sin = Math.sin(-wall.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        if (Math.abs(lx) < wall.halfW && Math.abs(ly) < wall.halfH) {
          const hit = this.add.circle(view.x, view.y, 12, 0x67e8f9, 0.7)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(92);
          this.tweens.add({ targets: hit, scale: 2.2, alpha: 0, duration: 200, onComplete: () => hit.destroy() });
          shot.glow.destroy();
          view.destroy();
          return false;
        }
      }
      if (Phaser.Math.Distance.Between(view.x, view.y, this.player.x, this.player.y) < 50) {
        shot.glow.destroy();
        view.destroy();
        this.damagePlayer();
        return false;
      }
      if (computeDiamondS(this.diamond, view.x, view.y) > 1.05) {
        shot.glow.destroy();
        view.destroy();
        return false;
      }
      return true;
    });
  }

  private updateShieldWalls(delta: number): void {
    this.shieldWalls = this.shieldWalls.filter((wall) => {
      wall.ttl -= delta;
      if (wall.ttl <= 0) {
        this.tweens.killTweensOf(wall.view);
        this.tweens.add({ targets: wall.view, alpha: 0, scale: 0.6, duration: 160, onComplete: () => wall.view.destroy() });
        return false;
      }
      return true;
    });
  }

  private spawnAcidPool(x: number, y: number): void {
    const halo = this.add.circle(x, y, 110, 0x5cffb1, 0.04)
      .setBlendMode(Phaser.BlendModes.ADD);
    const view = this.add.circle(x, y, 90, 0x5cffb1, 0.16)
      .setStrokeStyle(3, 0x5cffb1, 0.6)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.acidPools.push({ view, halo, radius: 90, ttl: 6, tick: 0 });
  }

  private updateAcidPools(delta: number): void {
    this.acidPools = this.acidPools.filter((pool) => {
      pool.ttl -= delta;
      pool.halo.setPosition(pool.view.x, pool.view.y);
      pool.view.setAlpha(0.08 + Math.min(0.4, (pool.ttl / 6) * 0.4));
      pool.halo.setAlpha(0.02 + Math.min(0.03, (pool.ttl / 6) * 0.03));
      if (pool.ttl <= 0) {
        pool.halo.destroy();
        pool.view.destroy();
        return false;
      }
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, pool.view.x, pool.view.y) < pool.radius) {
        pool.tick -= delta;
        if (pool.tick <= 0) {
          pool.tick = 1.2;
          this.damagePlayer();
        }
      }
      return true;
    });
  }

  /** 投掷炸弹：向落点抛出一枚炸弹，飞行到点后 AoE 爆炸伤害玩家。 */
  private throwBomb(fromX: number, fromY: number, toX: number, toY: number): void {
    const view = this.add.circle(fromX, fromY, 9, 0x2f2f3a, 1)
      .setStrokeStyle(2, 0xff4d6d, 0.95)
      .setDepth(120);
    const total = 1.1;
    this.bombs.push({ view, fromX, fromY, toX, toY, ttl: total, total, radius: 130 });
    this.playTone(140, 0.1, 'square', 0.05);
  }

  private updateBombs(delta: number): void {
    this.bombs = this.bombs.filter((bomb) => {
      bomb.ttl -= delta;
      const p = 1 - Math.max(0, bomb.ttl / bomb.total);
      // 抛物线轨迹：x/y 线性插值，高度随 p 波动
      const x = bomb.fromX + (bomb.toX - bomb.fromX) * p;
      const y = bomb.fromY + (bomb.toY - bomb.fromY) * p;
      bomb.view.setPosition(x, y);
      bomb.view.setAlpha(0.5 + 0.5 * Math.sin(performance.now() * 0.02));
      if (bomb.ttl <= 0) {
        bomb.view.destroy();
        const ring = this.add.circle(x, y, 16, 0xff4d6d, 0.4)
          .setStrokeStyle(4, 0xff4d6d, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(90);
        this.tweens.add({ targets: ring, scale: { from: 0.4, to: bomb.radius / 14 }, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
        // 圆环预知区：0.45s 后二次判定，此处即时爆炸
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, x, y) < bomb.radius) {
          this.cameraShake(90, 0.005);
          this.damagePlayer();
        }
        return false;
      }
      return true;
    });
  }

  /** 生成烟雾云：深色遮罩模糊玩家视野，持续 fadeOut。 */
  private spawnSmoke(x: number, y: number, radius = 230, ttl = 5): void {
    const view = this.add.circle(x, y, radius, 0x0b1220, 0.42)
      .setDepth(115);
    this.smokeClouds.push({ view, ttl, maxTtl: ttl });
  }

  private updateSmokeClouds(delta: number): void {
    this.smokeClouds = this.smokeClouds.filter((cloud) => {
      cloud.ttl -= delta;
      cloud.view.setAlpha(0.42 * Math.max(0, cloud.ttl / cloud.maxTtl));
      if (cloud.ttl <= 0) {
        cloud.view.destroy();
        return false;
      }
      return true;
    });
  }

  /** 敌人/射线攻击：0.55s 瞄准预警（红色线束收缩提示）→ 发射光束 → 两次命中判定，玩家可闪避。 */
  private enemyBeamAttack(fx: number, fy: number, angle: number): void {
    const beamLen = 720;
    const width = 34;
    const warnMs = 550;

    // 1. 预警：红色细线从发射点指向命中方向，逐渐变亮收缩（提示玩家移开）
    const warn = this.add.graphics().setDepth(103).setBlendMode(Phaser.BlendModes.ADD);
    warn.lineStyle(2, 0xff4d6d, 0.45);
    warn.beginPath();
    warn.moveTo(fx, fy);
    warn.lineTo(fx + Math.cos(angle) * beamLen, fy + Math.sin(angle) * beamLen);
    warn.strokePath();
    this.tweens.add({
      targets: warn,
      alpha: { from: 0.3, to: 0.9 },
      duration: warnMs / 3,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });
    // 预警期结束销毁
    this.time.delayedCall(warnMs, () => {
      if (warn.active) {
        this.tweens.add({ targets: warn, alpha: 0, duration: 80, onComplete: () => warn.destroy() });
      }
    });

    // 2. 真实光束（延迟到预警之后）
    this.time.delayedCall(warnMs, () => {
      const laser = this.add.graphics().setDepth(104).setBlendMode(Phaser.BlendModes.ADD);
      laser.lineStyle(4, 0x38bdf8, 0.95);
      laser.beginPath();
      laser.moveTo(fx, fy);
      laser.lineTo(fx + Math.cos(angle) * beamLen, fy + Math.sin(angle) * beamLen);
      laser.strokePath();
      this.tweens.add({ targets: laser, alpha: 0, duration: 480, onComplete: () => laser.destroy() });

      const trigger = (): void => {
        const dxv = Math.cos(angle);
        const dyv = Math.sin(angle);
        const rx = this.player.x - fx;
        const ry = this.player.y - fy;
        const t = Math.max(0, Math.min(1, (rx * dxv + ry * dyv) / beamLen));
        const px = fx + t * dxv * beamLen;
        const py = fy + t * dyv * beamLen;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, px, py) < width + 20) {
          this.damagePlayer();
          this.cameraShake(60, 0.004);
        }
      };
      trigger();
      this.time.delayedCall(440, () => { if (laser.active) trigger(); });
      this.playTone(700, 0.12, 'sine', 0.06);
    });
  }

  /** 生成一片持续结算的场地池（氧化雾 / 腐蚀酸池）：范围内每秒夺取 count 颗电子。 */
  private spawnMist(x: number, y: number, count: number, color = 0x67e8f9, radius = 70, ttl = 4.5): void {
    const halo = this.add.circle(x, y, radius + 20, color, 0.06)
      .setBlendMode(Phaser.BlendModes.ADD);
    const view = this.add.circle(x, y, radius, color, 0.18)
      .setStrokeStyle(2, color, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.mistPools.push({ view, halo, x, y, radius, ttl, maxTtl: ttl, tick: 0, count, color });
    this.tweens.add({ targets: [view, halo], scale: { from: 0.4, to: 1 }, alpha: { from: 0, to: 1 }, duration: 300, ease: 'Cubic.out' });
  }

  private updateMistPools(delta: number): void {
    this.mistPools = this.mistPools.filter((pool) => {
      pool.ttl -= delta;
      const life = pool.ttl / pool.maxTtl;
      pool.view.setAlpha(0.08 + Math.min(0.25, life * 0.25));
      pool.halo.setAlpha(0.02 + Math.min(0.04, life * 0.04));
      if (pool.ttl <= 0) {
        this.tweens.add({ targets: [pool.view, pool.halo], alpha: 0, duration: 200, onComplete: () => { pool.view.destroy(); pool.halo.destroy(); } });
        return false;
      }
      // 对范围内敌人持续结算（每 POOL_TICK_SEC 秒一次，与描述「每秒」一致）
      pool.tick -= delta;
      if (pool.tick <= 0) {
        pool.tick = POOL_TICK_SEC;
        const css = `#${pool.color.toString(16).padStart(6, '0').toUpperCase()}`;
        for (const enemy of this.enemies) {
          if (!enemy.view.visible) continue;
          const d = Phaser.Math.Distance.Between(pool.x, pool.y, enemy.view.x, enemy.view.y);
          if (d > pool.radius + enemy.view.displayWidth / 2) continue;
          const mode = gameState.mode;
          if (enemy.orbit && enemy.enteredCombat) {
            if (mode === 'oxidized') this.oxidizeInteraction(enemy, enemy.view.x, enemy.view.y);
            else this.reduceInteraction(enemy, enemy.view.x, enemy.view.y);
            // 池子标称「每秒夺取 count 颗」，基础互动已取 1 颗，剩余补齐
            this.stealElectrons(enemy, pool.count - 1, css);
          } else {
            const spectralBonus = 1 + this.getSpectralBonus(enemy);
            const finalDmg = pool.count * 5 * spectralBonus;
            this.damageEnemy(enemy, finalDmg);
            this.showDamageNumber(enemy.view.x, enemy.view.y - 30, finalDmg, css);
          }
        }
      }
      return true;
    });
  }

  /** 击杀掉落自由电子（40% 概率）：接触拾取 +1，可囤积在地面作为特殊攻击资源。 */
  private spawnElectronDrop(x: number, y: number): void {
    if (Math.random() > 0.4) return;
    const halo = this.add.circle(x, y, 22, 0x67e8f9, 0.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const view = this.add.circle(x, y, 13, 0x67e8f9, 0.35)
      .setStrokeStyle(3, 0xe0f2fe, 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: [view, halo],
      y: y - 10,
      scale: { from: 1, to: 1.15 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });
    this.electronDrops.push({ view, halo, fullHintCd: 0 });
  }

  private updateElectronDrops(delta: number): void {
    this.electronDrops = this.electronDrops.filter((drop) => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.view.x, drop.view.y);
      // 磁吸：靠近时掉落物加速飞向玩家（商业动作游戏标准拾取手感）
      if (dist < 170 && dist > 1) {
        const pull = 260 + (170 - dist) * 3.2;
        const ang = Phaser.Math.Angle.Between(drop.view.x, drop.view.y, this.player.x, this.player.y);
        drop.view.x += Math.cos(ang) * pull * delta;
        drop.view.y += Math.sin(ang) * pull * delta;
      }
      if (dist >= 46) {
        drop.fullHintCd = Math.max(0, drop.fullHintCd - delta);
        return true;
      }
      // 已满时保留地面囤积（离开上限后再来拾取），节流提示
      if (gameState.freeElectrons >= gameState.maxFreeElectrons) {
        if (drop.fullHintCd <= 0) {
          drop.fullHintCd = 1.5;
          this.showFloatingText(this.player.x, this.player.y - 70, '自由电子已满', '#94A3B8');
        }
        return true;
      }
      gainFreeElectrons(1);
      this.showElectronDelta(this.player.x, this.player.y - 62, 1, '#67E8F9', true);
      this.spawnElectronFlow(drop.view.x, drop.view.y, this.player.x, this.player.y, 0x67e8f9, 5);
      this.playTone(990, 0.12, 'sine', 0.06);
      drop.view.destroy();
      drop.halo.destroy();
      return false;
    });
  }

  private trySpawnBoss(): void {
    if (gameState.bossActive || this.boss) return;
    gameState.bossActive = true;
    const isFinal = this.roomDef.type === 'finalBoss';
    const layer = this.roomDef.layer;
    const bossConfig = getBossConfigForLayer(layer, isFinal);
    const bossScale = isFinal ? 1.4 : 1 + layer * 0.15;
    const pos = this.clampToPlayArea(this.diamondCx, this.diamondCy - 700);
    const aura = this.add.image(pos.x, pos.y, bossConfig.sprite)
      .setDisplaySize(250 * bossScale, 250 * bossScale)
      .setAlpha(0.15)
      .setTint(bossConfig.color)
      .setBlendMode(Phaser.BlendModes.ADD);
    const view = this.add.image(pos.x, pos.y, bossConfig.sprite)
      .setDisplaySize(220 * bossScale, 220 * bossScale)
      .setTint(bossConfig.color)
      .setBlendMode(Phaser.BlendModes.ADD);
    // Boss 是本局最强的视觉焦点：挂真实 Glow 滤镜（WebGL + 中高质量档）
    this.attachGlowFor(view, bossConfig.color, 6);
    const bossGlow = this.add.circle(pos.x, pos.y, 180 * bossScale, bossConfig.color, 0.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const bossInnerHalo = this.add.circle(pos.x, pos.y, 120 * bossScale, bossConfig.color, 0.06)
      .setBlendMode(Phaser.BlendModes.ADD);
    const bossOuterHalo = this.add.circle(pos.x, pos.y, 280 * bossScale, bossConfig.color, 0.04)
      .setBlendMode(Phaser.BlendModes.ADD);
    const orbits: OrbitState[] = bossConfig.orbitCounts.map((count) => ({ count, capacity: ORBIT_CAPACITY, inertCount: 0 }));
    const orbitArcs = orbits.map(() => [] as Phaser.GameObjects.Arc[]);
    const orbitRings = BOSS_ORBIT_RADII.map((radius, idx) => this.add.ellipse(pos.x, pos.y, radius * 2, radius * 1.44, 0xffffff, 0)
      .setStrokeStyle(3.5, BOSS_ORBIT_COLORS[idx], 0.72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1));
    const boss: RuntimeBoss = {
      view, aura, glow: bossGlow, innerHalo: bossInnerHalo, outerHalo: bossOuterHalo,
      config: bossConfig, phase: 1, slamTimer: 2.5, slamTelegraph: null,
      orbits, orbitArcs, orbitRings, orbitAngle: 0, shotTimer: 3,
      aoeTimer: 6, splitTimer: 10, meltdownTimer: 60, stunTimer: 0, specialtyTimer: 5, layer
    };
    this.boss = boss;
    this.activateBossOrbitArcs(boss);
    emit('boss', { type: 'spawn', layer, final: isFinal, name: bossConfig.name });
    this.cameras.main.flash(250, isFinal ? 120 : 80, isFinal ? 20 : 40, isFinal ? 20 : 120);
    this.cameraShake(100, 0.004);
    this.punchZoom(1.06, 240);
    this.playTone(90, 0.5, 'sawtooth', 0.09);
    this.playTone(60, 0.4, 'sine', 0.06);
    const spawnRing = this.add.circle(pos.x, pos.y, 30, bossConfig.color, 0)
      .setStrokeStyle(6, bossConfig.color, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: spawnRing, scale: { from: 0.3, to: 6 }, alpha: 0, duration: 600, onComplete: () => spawnRing.destroy() });
  }

  private updateBoss(delta: number): void {
    const boss = this.boss;
    if (!boss || !boss.view.visible) return;
    const phaseCfg = boss.config.phases[boss.phase - 1];
    boss.orbitAngle += delta * (boss.phase === 1 ? 0.8 : boss.phase === 2 ? 1.2 : 1.6);
    this.updateBossOrbitVisual(boss);
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, boss.view.x, boss.view.y);
    const heatRatio = Phaser.Math.Clamp(gameState.temperature / 100, 0, 1);
    const heatAtkMult = 1 - heatRatio * 0.45;
    const speed = phaseCfg.speed * (1 + heatRatio * 0.7);

    // Boss 麻痹（电解领主阶段3效果）
    if (boss.stunTimer > 0) {
      boss.stunTimer -= delta;
    } else if (distance > 260) {
      const angle = Phaser.Math.Angle.Between(boss.view.x, boss.view.y, this.player.x, this.player.y);
      boss.view.x += Math.cos(angle) * speed * delta;
      boss.view.y += Math.sin(angle) * speed * delta;
      const inside = projectInside(this.diamond, boss.view.x, boss.view.y, 0.9);
      boss.view.setPosition(inside.x, inside.y);
      boss.aura.setPosition(boss.view.x, boss.view.y);
      boss.glow.setPosition(boss.view.x, boss.view.y);
    }

    // ===== 通用攻击：Slam =====
    boss.slamTimer -= delta;
    if (boss.slamTimer <= 0 && !boss.slamTelegraph) {
      boss.slamTimer = phaseCfg.slamCooldown * heatAtkMult;
      const slamRadius = boss.config.id === 'oxidation' ? 280 : 220;
      const telegraph = this.add.circle(boss.view.x, boss.view.y, slamRadius, 0xff4d6d, 0.05)
        .setStrokeStyle(4, 0xff4d6d, 0.8)
        .setBlendMode(Phaser.BlendModes.ADD);
      boss.slamTelegraph = telegraph;
      this.tweens.add({ targets: telegraph, alpha: { from: 0.25, to: 0.85 }, duration: 300, yoyo: true, repeat: 2 });
      this.time.delayedCall(900, () => {
        boss.slamTelegraph = null;
        telegraph.destroy();
        if (!boss.view.visible) return;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, boss.view.x, boss.view.y);
        if (d < slamRadius + 20) {
          this.damagePlayer();
          this.cameraShake(90, 0.004);
        }
        this.playTone(70, 0.3, 'sawtooth', 0.1);
        const shock = this.add.circle(boss.view.x, boss.view.y, 40, 0xffffff, 0)
          .setStrokeStyle(7, boss.config.color, 0.95)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: shock, scale: { from: 0.5, to: 6 }, alpha: 0, duration: 420, onComplete: () => shock.destroy() });
      });
    }

    // ===== 通用攻击：Shot =====
    boss.shotTimer -= delta;
    if (boss.shotTimer <= 0) {
      boss.shotTimer = phaseCfg.shotCooldown * heatAtkMult;
      const baseAngle = Phaser.Math.Angle.Between(boss.view.x, boss.view.y, this.player.x, this.player.y);
      for (let i = 0; i < phaseCfg.shotCount; i += 1) {
        const angle = baseAngle + (i - (phaseCfg.shotCount - 1) / 2) * phaseCfg.shotSpread;
        const shotColor = boss.config.id === 'electrolysis' ? 0x67e8f9 : boss.config.id === 'oxidation' ? 0xff6b35 : 0xff5c7a;
        const shot = this.add.circle(boss.view.x, boss.view.y, 7, shotColor)
          .setStrokeStyle(3, 0xfff7c2)
          .setBlendMode(Phaser.BlendModes.ADD);
        const shotGlow = this.add.circle(boss.view.x, boss.view.y, 16, shotColor, 0.15)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.enemyProjectiles.push({ view: shot, glow: shotGlow, vx: Math.cos(angle) * 300, vy: Math.sin(angle) * 300 });
      }
      this.playSfx('sfx-dd', 0.6); // 语义同 Chemic：敌方攻击音
      this.playTone(380, 0.1, 'sawtooth', 0.05);
    }

    // ===== 阶段转换 =====
    if (boss.phase === 1 && phaseCfg.transitionElectronThreshold !== undefined && this.bossElectronCount(boss) <= phaseCfg.transitionElectronThreshold) {
      boss.phase = 2;
      boss.view.setTint(Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(boss.config.color),
        Phaser.Display.Color.IntegerToColor(0xffffff), 100, 30
      ).color);
      // 各Boss阶段2特殊效果
      if (boss.config.id === 'titration') {
        this.spawnEnemy('free-radical', boss.view.x + 220, boss.view.y, 'chaser', 10, 90);
        this.spawnEnemy('free-radical', boss.view.x - 220, boss.view.y, 'chaser', 10, 90);
      } else if (boss.config.id === 'chain') {
        this.spawnEnemy('polymer', boss.view.x + 200, boss.view.y, 'tank', 15, 50);
        this.spawnEnemy('polymer', boss.view.x - 200, boss.view.y, 'tank', 15, 50);
        this.spawnEnemy('free-radical', boss.view.x, boss.view.y + 200, 'chaser', 10, 80);
      } else if (boss.config.id === 'oxidation') {
        gameState.temperature = Math.min(100, gameState.temperature + 30);
      }
      emit('boss', { type: 'phase', bossId: boss.config.id, phase: 2 });
      this.playTone(150, 0.4, 'sawtooth', 0.09);
    }

    // 阶段3转换（阶段2→3，电子数≤10）
    if (boss.phase === 2 && this.bossElectronCount(boss) <= 10) {
      boss.phase = 3;
      boss.view.setTint(0xffffff);
      if (boss.config.id === 'oxidation') {
        boss.meltdownTimer = 60;
        this.showFloatingText(boss.view.x, boss.view.y - 120, '高温熔毁！', '#FF3B30');
      } else if (boss.config.id === 'electrolysis') {
        boss.stunTimer = 3;
        this.showFloatingText(boss.view.x, boss.view.y - 120, '全屏麻痹！', '#67E8F9');
        this.cameras.main.flash(500, 100, 200, 255);
      } else if (boss.config.id === 'chain') {
        this.showFloatingText(boss.view.x, boss.view.y - 120, '全屏聚合！', '#FDE047');
      } else if (boss.config.id === 'titration') {
        this.showFloatingText(boss.view.x, boss.view.y - 120, '中和态！', '#9D4EDD');
      }
      emit('boss', { type: 'phase', bossId: boss.config.id, phase: 3 });
      this.playTone(100, 0.5, 'sawtooth', 0.12);
    }

    // ===== Boss专属攻击 =====
    // 特色攻击：按层分发（titration→酸雾, electrolysis→射线, chain→投弹, oxidation→烟雾）
    boss.specialtyTimer -= delta;
    if (boss.specialtyTimer <= 0) {
      const cooldown = { titration: 7, electrolysis: 6, chain: 5, oxidation: 4 }[boss.config.id] ?? 6;
      boss.specialtyTimer = cooldown;
      const bx = boss.view.x;
      const by = boss.view.y;
      if (boss.config.id === 'titration') {
        // 酸雾：围绕 Boss 撒三片酸池 + 伴随烟雾
        for (let i = 0; i < 3; i += 1) {
          const ang = (Math.PI * 2 * i) / 3 + Math.random() * 0.5;
          const dx = bx + Math.cos(ang) * 200;
          const dy = by + Math.sin(ang) * 200;
          this.spawnAcidPool(dx, dy);
        }
        this.spawnSmoke(bx, by, 220, 4);
        this.playTone(260, 0.3, 'sine', 0.05);
      } else if (boss.config.id === 'electrolysis') {
        // 射线：朝玩家方向扇形多道短促光束
        const base = Phaser.Math.Angle.Between(bx, by, this.player.x, this.player.y);
        const shots = 3;
        for (let i = 0; i < shots; i += 1) {
          this.enemyBeamAttack(bx, by, base + (i - (shots - 1) / 2) * 0.25);
        }
        this.playTone(700, 0.15, 'sine', 0.05);
      } else if (boss.config.id === 'chain') {
        // 投弹：向玩家抛多枚炸弹，爆炸伴随烟雾
        const count = boss.phase >= 3 ? 4 : boss.phase === 2 ? 3 : 2;
        for (let i = 0; i < count; i += 1) {
          const tx = this.player.x + (Math.random() - 0.5) * 120;
          const ty = this.player.y + (Math.random() - 0.5) * 120;
          this.throwBomb(bx, by, tx, ty);
          this.spawnSmoke(tx, ty, 160, 3.5);
        }
        this.playTone(140, 0.3, 'square', 0.05);
      } else if (boss.config.id === 'oxidation') {
        // 烟雾：模糊玩家视野 + 小幅震屏
        this.spawnSmoke(this.player.x, this.player.y, 260, 4.5);
        this.cameraShake(40, 0.003);
        this.playTone(110, 0.4, 'sawtooth', 0.05);
      }
    }

    // 链式反应母体：分裂小怪
    if (boss.config.id === 'chain' && boss.phase >= 1) {
      boss.splitTimer -= delta;
      if (boss.splitTimer <= 0) {
        boss.splitTimer = boss.phase === 1 ? 10 : boss.phase === 2 ? 7 : 5;
        const addCount = boss.phase === 1 ? 2 : boss.phase === 2 ? 3 : 4;
        for (let i = 0; i < addCount; i++) {
          const angle = (Math.PI * 2 * i) / addCount;
          this.spawnEnemy('free-radical', boss.view.x + Math.cos(angle) * 180, boss.view.y + Math.sin(angle) * 180, 'chaser', 8, 85);
        }
        this.playTone(500, 0.15, 'sine', 0.06);
      }
    }

    // 氧化之主：温度熔毁倒计时
    if (boss.config.id === 'oxidation' && boss.phase === 3) {
      boss.meltdownTimer -= delta;
      gameState.temperature = Math.min(100, gameState.temperature + delta * 0.8);
      if (boss.meltdownTimer <= 0) {
        this.damagePlayer();
        this.damagePlayer();
        this.damagePlayer();
        // 熔毁是全屏级危险：用最高的反馈层级（重定格 + 强震 + 缩放冲击）宣告
        this.applyFeedback('meltdown');
        this.cameras.main.flash(300, 255, 100, 50);
        boss.meltdownTimer = 15;
      }
    }

    // ===== 通用攻击：AOE =====
    boss.aoeTimer -= delta;
    if (boss.aoeTimer <= 0) {
      boss.aoeTimer = phaseCfg.aoeCooldown * heatAtkMult;
      const aoeRadius = boss.config.id === 'oxidation' ? 400 : 340;
      const telegraph = this.add.circle(boss.view.x, boss.view.y, aoeRadius, 0xff4d6d, 0)
        .setStrokeStyle(5, 0xff4d6d, 0.9)
        .setFillStyle(0xff4d6d, 0.08)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: telegraph, alpha: { from: 0.2, to: 0.9 }, duration: 400, yoyo: true, repeat: 3 });
      this.playTone(200, 0.3, 'sine', 0.06);
      this.time.delayedCall(1600, () => {
        telegraph.destroy();
        if (!boss.view.visible) return;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, boss.view.x, boss.view.y);
        if (d < aoeRadius) {
          this.damagePlayer();
          this.damagePlayer();
          this.cameraShake(130, 0.006);
        }
        for (let r = 0; r < 3; r += 1) {
          const shockwave = this.add.circle(boss.view.x, boss.view.y, 30, 0xffffff, 0)
            .setStrokeStyle(4 - r * 0.5, boss.config.color, 0.95)
            .setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({
            targets: shockwave,
            scale: { from: 0.5, to: 4 + r },
            alpha: 0,
            duration: 400 + r * 100,
            delay: r * 80,
            onComplete: () => shockwave.destroy()
          });
        }
        this.playTone(80, 0.4, 'sawtooth', 0.1);
      });
    }
  }

  private activateBossOrbitArcs(boss: RuntimeBoss): void {
    boss.orbits.forEach((_, layer) => {
      for (let index = 0; index < ORBIT_CAPACITY; index += 1) {
        const arc = this.add.circle(boss.view.x, boss.view.y, 5, BOSS_ORBIT_COLORS[layer], 0.95)
          .setStrokeStyle(2.5, 0xffffff, 0.85)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(3)
          .setVisible(true);
        boss.orbitArcs[layer].push(arc);
      }
    });
  }

  private updateBossOrbitVisual(boss: RuntimeBoss): void {
    boss.aura.setPosition(boss.view.x, boss.view.y);
    boss.glow.setPosition(boss.view.x, boss.view.y);
    const haloPulse = 0.7 + 0.3 * Math.sin(this.time.now * 0.002);
    boss.innerHalo.setPosition(boss.view.x, boss.view.y).setAlpha(0.06 * haloPulse);
    boss.outerHalo.setPosition(boss.view.x, boss.view.y).setAlpha(0.04 * haloPulse);
    boss.orbitRings.forEach((ring, layer) => {
      const orbit = boss.orbits[layer];
      const hasElectrons = orbit.count > 0;
      ring.setPosition(boss.view.x, boss.view.y);
      ring.setRotation(boss.orbitAngle * (layer % 2 === 0 ? 0.35 : -0.28));
      ring.setAlpha(hasElectrons ? 0.72 : 0.12);
    });
    boss.orbits.forEach((orbit, layer) => {
      const radius = BOSS_ORBIT_RADII[layer];
      for (let index = 0; index < ORBIT_CAPACITY; index += 1) {
        const arc = boss.orbitArcs[layer][index];
        const angle = boss.orbitAngle * (layer % 2 === 0 ? 1 : -1) + (index / ORBIT_CAPACITY) * Math.PI * 2;
        arc.setPosition(
          boss.view.x + Math.cos(angle) * radius,
          boss.view.y + Math.sin(angle) * radius * 0.72
        );
        arc.setVisible(index < orbit.count);
      }
    });
  }

  private bossElectronCount(boss: RuntimeBoss): number {
    return boss.orbits.reduce((total, orbit) => total + orbit.count, 0);
  }

  private hitBoss(_damage: number, hitX: number, hitY: number): void {
    const boss = this.boss;
    if (!boss || !boss.view.visible) return;
    const layer = this.pickBossOrbitLayer(boss, hitX, hitY);
    const orbit = boss.orbits[layer];
    if (gameState.mode === 'oxidized') {
      if (orbit.count <= 0) return;
      orbit.count -= 1;
      const arc = boss.orbitArcs[layer][orbit.count];
      this.tweens.add({ targets: arc, alpha: 0, scale: 0.3, duration: 220, onComplete: () => arc.setVisible(false) });
      this.showElectronDelta(boss.view.x, boss.view.y - 190, -1, '#E0AAFF');
      // 电子压制：伤害%加成对 Boss 同样生效（额外夺取）
      this.applyElectronPressure(orbit, 'oxidized', () => {
        const arc2 = boss.orbitArcs[layer][orbit.count];
        this.tweens.add({ targets: arc2, alpha: 0, scale: 0.3, duration: 220, onComplete: () => arc2.setVisible(false) });
        this.showElectronDelta(boss.view.x, boss.view.y - 190, -1, '#67E8F9');
      });
    } else {
      const result = captureElectron(orbit);
      if (result.inertified) {
        this.overloadBoss(boss, layer);
      } else {
        const arc = boss.orbitArcs[layer][result.count - 1];
        arc.setVisible(true).setAlpha(0).setScale(0.3);
        this.tweens.add({ targets: arc, alpha: 1, scale: 1, duration: CAPTURE_ANIM.settleMs, ease: CAPTURE_ANIM.settleEase });
        this.showElectronDelta(boss.view.x, boss.view.y - 190, 1, '#FDE047');
        // 电子压制：还原态对 Boss 额外注入（惰化则结束本次）
        this.applyElectronPressure(orbit, 'reduced', () => {
          const arc2 = boss.orbitArcs[layer][Math.max(0, orbit.count - 1)];
          arc2.setVisible(true).setAlpha(0).setScale(0.3);
          this.tweens.add({ targets: arc2, alpha: 1, scale: 1, duration: CAPTURE_ANIM.settleMs, ease: CAPTURE_ANIM.settleEase });
          this.showElectronDelta(boss.view.x, boss.view.y - 190, 1, '#FDE047');
        }, () => this.overloadBoss(boss, layer));
      }
    }
    const flashOverlay = this.add.circle(hitX, hitY, 110, 0xffffff, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(5);
    this.tweens.add({ targets: flashOverlay, alpha: 0, scale: 1.3, duration: 120, onComplete: () => flashOverlay.destroy() });
    const bossBaseScale = boss.view.scale;
    this.tweens.add({ targets: boss.view, scale: { from: bossBaseScale * 1.07, to: bossBaseScale }, duration: 140, ease: 'Cubic.out' });
    this.showDamageNumber(hitX, hitY - 60, 1, gameState.mode === 'oxidized' ? '#E0AAFF' : '#FDE047');
    this.applyFeedback(hitTierFor(true, false));
    this.playTone(pitchJitter(200), 0.06, 'square', 0.07);
    this.gainFreeElectronsWithFeedback(this.player.x, this.player.y - 62);
    this.spawnElectronFlow(hitX, hitY, this.player.x, this.player.y, 0x67e8f9, 5);
    this.checkBossDefeated(boss);
  }

  /** 特殊攻击强化（氧化态）：额外夺取 Boss 轨道电子，并结算击败判定。 */
  private stealBossElectrons(boss: RuntimeBoss, count: number): void {
    // 失控取消：Boss 同样受「过量试剂」规则约束（单发 ≥ 阈值且储备 ≥80%）
    const bossCap = boss.orbits.reduce((sum, o) => sum + o.capacity, 0);
    if (isRunawayCancel(count, this.bossElectronCount(boss), bossCap, {
      threshold: BALANCE.combat.runawayCancelThreshold,
      fullRatio: BALANCE.combat.runawayFullRatio
    })) {
      this.showFloatingText(boss.view.x, boss.view.y - 220, '⚠ 临界失控 · 反应取消', '#FF4D6D');
      this.playSfx('sfx-duong', 0.8);
      emit('reaction', { type: 'runaway' });
      return;
    }
    let stolen = 0;
    for (let i = 0; i < count; i += 1) {
      const layer = this.pickBossOrbitLayer(boss, boss.view.x, boss.view.y);
      const orbit = boss.orbits[layer];
      if (orbit.count <= 0) break;
      orbit.count -= 1;
      const arc = boss.orbitArcs[layer][orbit.count];
      this.tweens.add({ targets: arc, alpha: 0, scale: 0.3, duration: 220, onComplete: () => arc.setVisible(false) });
      this.showElectronDelta(boss.view.x, boss.view.y - 190, -1, '#67E8F9');
      stolen += 1;
    }
    this.gainReactionLayers(stolen);
    this.playTone(500, 0.06, 'square', 0.05);
    this.checkBossDefeated(boss);
  }

  /** Boss 全部轨道电子被夺取后的击败演出与结算。 */
  private checkBossDefeated(boss: RuntimeBoss): void {
    if (!boss.view.visible || this.bossElectronCount(boss) > 0) return;
    this.cameraShake(110, 0.005);
    this.playTone(60, 0.6, 'sawtooth', 0.1);
    const burst = this.add.circle(boss.view.x, boss.view.y, 40, 0xffffff, 0)
      .setStrokeStyle(8, 0x9d4edd, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: burst, scale: { from: 0.4, to: 8 }, alpha: 0, duration: 620, onComplete: () => burst.destroy() });
    this.defeatBoss(boss);
  }

  private pickBossOrbitLayer(boss: RuntimeBoss, x: number, y: number): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    boss.orbits.forEach((orbit, layer) => {
      if (orbit.count <= 0) return;
      const radius = BOSS_ORBIT_RADII[layer];
      const distance = Math.abs(Phaser.Math.Distance.Between(boss.view.x, boss.view.y, x, y) - radius);
      if (distance < bestDistance) {
        best = layer;
        bestDistance = distance;
      }
    });
    return best;
  }

  private overloadBoss(boss: RuntimeBoss, layer: number): void {
    const orbit = boss.orbits[layer];
    orbit.inertCount += 1;
    orbit.count = 0;
    boss.orbitArcs[layer].forEach((arc, i) => {
      arc.setVisible(false);
      const burst = this.add.circle(arc.x, arc.y, 5, BOSS_ORBIT_COLORS[layer]).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: burst, alpha: 0, scale: 3, duration: 350, delay: i * 20, onComplete: () => burst.destroy() });
    });
    const shockwave = this.add.circle(boss.view.x, boss.view.y, 20, 0xffffff, 0)
      .setStrokeStyle(5, BOSS_ORBIT_COLORS[layer], 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: shockwave, scale: { from: 0.4, to: 8 }, alpha: 0, duration: 500, ease: 'Cubic.out', onComplete: () => shockwave.destroy() });
    this.showElectronDelta(boss.view.x, boss.view.y - 190, -ORBIT_CAPACITY, '#FDE047');
    this.cameraShake(70, 0.003);
    this.playTone(100, 0.3, 'sawtooth', 0.08);
  }

  private defeatBoss(boss: RuntimeBoss): void {
    boss.view.setVisible(false);
    boss.aura.setVisible(false);
    boss.glow.setVisible(false);
    boss.slamTelegraph?.destroy();
    boss.slamTelegraph = null;
    boss.orbitRings.forEach((ring) => ring.destroy());
    boss.orbitArcs.flat().forEach((arc) => arc.destroy());
    gameState.bossActive = false;
    gameState.samples += Math.round(5 * this.gearSampleMult);
    this.cameraShake(160, 0.008);
    this.punchZoom(1.07, 320);
    this.playTone(60, 0.8, 'sawtooth', 0.12);
    this.playTone(40, 0.6, 'sine', 0.08);
    for (let i = 0; i < 4; i += 1) {
      const ring = this.add.circle(boss.view.x, boss.view.y, 30, 0xffffff, 0)
        .setStrokeStyle(5 - i, BOSS_ORBIT_COLORS[i] ?? 0x9d4edd, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ring,
        scale: { from: 0.3, to: 6 + i * 2 },
        alpha: 0,
        duration: 500 + i * 120,
        delay: i * 80,
        ease: 'Cubic.out',
        onComplete: () => ring.destroy()
      });
    }
    for (let i = 0; i < 20; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Between(40, 200);
      const spark = this.add.circle(boss.view.x, boss.view.y, Phaser.Math.Between(3, 7),
        BOSS_ORBIT_COLORS[i % BOSS_ORBIT_COLORS.length]).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: spark,
        x: boss.view.x + Math.cos(angle) * dist,
        y: boss.view.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.1,
        duration: Phaser.Math.Between(300, 600),
        ease: 'Cubic.out',
        onComplete: () => spark.destroy()
      });
    }
    const flash = this.add.circle(boss.view.x, boss.view.y, 30, 0xffffff, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, alpha: 0, scale: 12, duration: 700, onComplete: () => flash.destroy() });
    emit('boss', { type: 'defeat' });
    // Boss 必掉一件装备（搜打撤：高危换取高价值战利品）
    this.spawnGearDrop(pickGearDrop(), boss.view.x, boss.view.y - 40);
    applyProgress({ bossKills: 1, bestDepth: Math.max(1, gameState.roomIndex), bestLayer: gameState.layer });
    void saveProfile();
  }

  private spawnReaction(x: number, y: number, element: string): void {
    const reaction = element === 'O' ? reactions[0] : reactions[5];
    // v0.2.2：攻击反应热已移除——温度改由「通关推进速度」驱动（自适应难度，见 applyPacingHeat）
    // 反应只带来电子转移收益，不再直接惩罚输出频率
    emit('reaction', reaction);
    const ring = this.add.circle(x, y, 12, 0xffffff, 0)
      .setStrokeStyle(3, element === 'O' ? 0xff8a4c : 0x5cffb1, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring,
      scale: { from: 1, to: reaction.radius / 24 },
      alpha: 0,
      duration: 480,
      onComplete: () => ring.destroy()
    });
  }

  /**
   * 还原态吸热降温（§2.2 还原 = 吸热方向）：每次向敌人注入 1 颗电子触发一次。
   * 还原态因此成为本作唯一的主动控温手段——高热时的安全模式。
   */
  private coolFromReduction(x: number, y: number): void {
    this.gainReactionLayers(1); // 还原注入 = 催化层数 +1
    const before = gameState.temperature;
    gameState.temperature = Phaser.Math.Clamp(gameState.temperature - BALANCE.temperature.reduceCoolPerCapture, 0, 100);
    if (gameState.temperature === before) return;
    const ring = this.add.circle(x, y, 14, 0x67e8f9, 0)
      .setStrokeStyle(2, 0x67e8f9, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(7);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.5, to: 1.8 },
      alpha: 0,
      duration: 340,
      onComplete: () => ring.destroy()
    });
    this.playTone(420, 0.05, 'sine', 0.025);
  }

  private toggleMode(): void {
    haptic(20);
    this.tutorial?.notifyModeSwitched();
    this.reactionPairs.forEach((p) => { p.mine.destroy(); p.theirs.destroy(); });
    this.reactionPairs = [];
    const nextMode = gameState.mode === 'oxidized' ? 'reduced' : 'oxidized';
    gameState.mode = nextMode;
    gameState.oxidationState = nextMode === 'oxidized' ? -1 : 1;
    const color = nextMode === 'oxidized' ? 0xff8a4c : 0xfde047;
    const flash = nextMode === 'oxidized' ? [255, 138, 76] : [253, 224, 71];
    this.orbitColor = color;
    this.applyModeTint();
    this.attackRecoil = 1;
    const inhale = this.add.circle(this.player.x, this.player.y, 60, 0xffffff, 0)
      .setStrokeStyle(3, color, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: inhale,
      scale: { from: 2.4, to: 0.15 },
      alpha: { from: 0.95, to: 0 },
      duration: 240,
      ease: 'Cubic.in',
      onComplete: () => {
        inhale.destroy();
        this.spawnModeBurst(color);
      }
    });
    this.cameras.main.flash(150, Math.round(flash[0] * 0.4), Math.round(flash[1] * 0.4), Math.round(flash[2] * 0.4));
    this.cameraShake(70, 0.002);
    this.playTone(nextMode === 'oxidized' ? 660 : 330, 0.12, 'triangle', 0.06);
  }

  private spawnModeBurst(color: number): void {
    const ring = this.add.circle(this.player.x, this.player.y, 20, 0xffffff, 0)
      .setStrokeStyle(5, color, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.5, to: 7 },
      alpha: 0,
      duration: 450,
      ease: 'Cubic.out',
      onComplete: () => ring.destroy()
    });
    const ring2 = this.add.circle(this.player.x, this.player.y, 14, 0xffffff, 0)
      .setStrokeStyle(3, 0xffffff, 0.7)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring2,
      scale: { from: 0.3, to: 5 },
      alpha: 0,
      duration: 350,
      delay: 60,
      ease: 'Cubic.out',
      onComplete: () => ring2.destroy()
    });
    for (let index = 0; index < 22; index += 1) {
      const angle = (Math.PI * 2 * index) / 22;
      const dist = Phaser.Math.Between(80, 180);
      const size = Phaser.Math.Between(2, 5);
      const spark = this.add.circle(this.player.x, this.player.y, size, index % 2 === 0 ? color : 0xffffff)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: spark,
        x: this.player.x + Math.cos(angle) * dist,
        y: this.player.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.1,
        duration: Phaser.Math.Between(280, 450),
        ease: 'Cubic.out',
        onComplete: () => spark.destroy()
      });
    }
  }

  private createExtractionZone(): void {
    // 撤离点类型按进房时的实时状态选定（温度/试剂/Boss 进度），§6.4
    this.extractionDef = pickExtraction({
      temperature: gameState.temperature,
      freeElectrons: gameState.freeElectrons,
      bossKills: profileState.progress.bossKills
    });
    const def = this.extractionDef;
    const pos = this.clampToPlayArea(2400, 2000);
    const glow = this.add.ellipse(pos.x, pos.y, 340, 210, def.color, 0.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.roomProps.push(glow);
    this.tweens.add({ targets: glow, alpha: { from: 0.05, to: 0.18 }, scaleX: { from: 0.9, to: 1.2 }, scaleY: { from: 0.85, to: 1.15 }, duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.extractZone = this.add.rectangle(pos.x, pos.y, 180, 110, def.color, 0.06)
      .setStrokeStyle(2, def.color, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.extractionText = this.add.text(pos.x, pos.y, this.extractionLabel(), {
      color: `#${def.color.toString(16).padStart(6, '0')}`, fontFamily: 'monospace', fontSize: '18px', align: 'center'
    }).setOrigin(0.5);
  }

  /** 撤离点未激活/已激活两种文案。 */
  private extractionLabel(active = false): string {
    const def = this.extractionDef;
    if (active) return `${def.icon} ${def.name}\n按 E 撤离\n${def.desc}`;
    return `${def.icon} ${def.name}\n${def.desc}`;
  }

  /** 按实时状态复核撤离点类型并同步视觉（类型变化时才重绘）。 */
  private refreshExtractionDef(): void {
    const next = pickExtraction({
      temperature: gameState.temperature,
      freeElectrons: gameState.freeElectrons,
      bossKills: profileState.progress.bossKills
    });
    if (next.id === this.extractionDef.id) return;
    this.extractionDef = next;
    this.extractZone?.setStrokeStyle(2, next.color, 0.85).setFillStyle(next.color, 0.06);
    this.extractionText
      ?.setColor(`#${next.color.toString(16).padStart(6, '0')}`)
      .setText(this.extractionLabel(true));
  }

  private updateExtraction(delta: number): void {
    // 仅在撤离房清怪解锁后生效
    if (gameState.currentRoomType !== 'extraction' || !this.extractionEnabled || !this.extractZone || !this.extractionText) return;
    // 移动端交互容差：判定框外扩 90px（触屏站位精度低，实测反馈「无响应」）
    const zoneBounds = this.extractZone.getBounds();
    zoneBounds.x -= 90;
    zoneBounds.y -= 90;
    zoneBounds.width += 180;
    zoneBounds.height += 180;
    const nearZone = Phaser.Geom.Rectangle.Contains(zoneBounds, this.player.x, this.player.y);
    if (nearZone && (Phaser.Input.Keyboard.JustDown(this.interactKey) || mobileInput.interactQueued) && !gameState.extracting) {
      // 撤离瞬间按实时状态复核撤离点类型（升温/降温或补到试剂都会改变可用类型）
      this.refreshExtractionDef();
      gameState.extracting = true;
      // 设计文档 §6.4：温度超过 95 时，撤离倒计时减半
      const hold = this.extractionDef.holdSeconds * (gameState.temperature >= 95 ? 0.5 : 1);
      gameState.extraction = hold;
      this.extractionPressureTimer = 3;
      emit('extraction', { active: true });
    }
    if (gameState.extracting) {
      gameState.extraction = Math.max(0, gameState.extraction - delta);
      // 撤离压力：稳定化期间每 3s 预告生成一只追击者（最佳实践：撤离不可无压力）
      this.extractionPressureTimer -= delta;
      if (this.extractionPressureTimer <= 0) {
        this.extractionPressureTimer = 3;
        const angle = Math.random() * Math.PI * 2;
        const x = this.player.x + Math.cos(angle) * 700;
        const y = this.player.y + Math.sin(angle) * 700 * 0.5;
        const pos = this.clampToPlayArea(x, y);
        const def = COMBAT_POOL[0];
        this.telegraphSpawn(def, pos.x, pos.y, Math.round(def.baseHp * (1 + this.runWaveCounter * 0.1)), def.baseSpeed + gameState.roomIndex * 2);
      }
      this.extractionText.setText(`${this.extractionDef.name}稳定化中 ${gameState.extraction.toFixed(1)}s`);
      if (gameState.extraction <= 0) {
        gameState.extracting = false;
        const heatBonus = Math.floor(gameState.temperature / BALANCE.samples.extractionHeatDivisor);
        // 撤离才是"变现"：携带样本 + 完成奖励，再乘撤离点倍率与损坏率。
        // （修正前只结算完成奖励，携带的战利品反而不入账，与死亡入账形成倒挂）
        const carried = gameState.samples;
        // 装备「样本收益」加成只作用于撤离的基础+温度部分（携带样本已在获取时结算过）
        const settled = Math.round((BALANCE.samples.extractionBase + heatBonus) * this.gearSampleMult);
        // 通关撤离：一次性通关奖励（不打折、不吃倍率，账目单列）
        const clearBonus = gameState.runComplete ? BALANCE.samples.finalClearBonus : 0;
        const gained = settleExtractionSamples(carried + settled + clearBonus, this.extractionDef);
        // 稳定化反应消耗 1 自由电子作为试剂
        if (this.extractionDef.reagentCost > 0) {
          gameState.freeElectrons = Math.max(0, gameState.freeElectrons - this.extractionDef.reagentCost);
        }
        gameState.samples = gained;
        profileState.samples += gained;
        applyProgress({
          samples: gained,
          kills: gameState.kills,
          bestDepth: Math.max(1, gameState.roomIndex),
          bestLayer: gameState.layer
        });
        // 搜打撤：局内搜到的装备战利品成功撤离后写入局外仓库（携带装备自然保留）
        const bankedIds = [...gameState.carriedGear];
        const bankedGear = bankCarriedGear(gameState.carriedGear);
        saveProfile();
        // 结算战报：搜打撤的核心反馈——「带出了什么」必须明明白白
        this.showRunReport(
          gameState.runComplete ? '撤离成功 · 通关结算' : `撤离成功 · ${this.extractionDef.name}`,
          gameState.runComplete ? '#FFD700' : '#5CFFB1',
          [
            { label: '携带样本', value: `+${carried}` },
            { label: '完成奖励', value: `+${settled}` },
            ...(gameState.runComplete ? [{ label: '通关奖励', value: `+${BALANCE.samples.finalClearBonus}` }] : []),
            { label: '撤离点', value: `×${this.extractionDef.rewardMult}${this.extractionDef.lossRate > 0 ? ` · 损坏 ${Math.round(this.extractionDef.lossRate * 100)}%` : ''}` },
            { label: '入库装备', value: bankedGear > 0 ? `${bankedGear} 件` : '—' },
            { label: '总入账样本', value: `+${gained}`, total: true }
          ],
          bankedIds.map((id) => ({ id, lost: false })),
          gameState.runComplete ? '通关！全部实验成果已入库 · 实验记录永存' : '按 E 开始下一轮 · 装备已存入装备库'
        );
        this.playSfx('sfx-ga', 0.9);
        this.playSfx('sfx-ding', 0.9);
        emit('extraction', { active: false, success: true });
        this.cameras.main.flash(300, 50, 115, 125);
        this.reportContinue = () => {
          resetRun();
          this.resetBoonState();
          this.cameras.main.fadeOut(900, 10, 14, 26);
          this.time.delayedCall(950, () => {
            this.scene.stop('UIScene');
            this.scene.start('LobbyScene');
          });
        };
      }
    } else if (nearZone) {
      this.extractionText.setAlpha(1);
    } else {
      this.extractionText.setAlpha(0.35);
    }
  }

  private createParallaxFog(): void {
    const profile = getVisualProfile();
    const qualityScale = profile.bloomEnabled ? 1 : 0.5; // 低质量档雾团减半
    const layers = [
      { scrollFactor: 0.25, color: 0x0a3850, alpha: 0.10, y: this.worldHeight * 0.3, count: Math.round(18 * qualityScale) },
      { scrollFactor: 0.55, color: 0x1a0a3d, alpha: 0.08, y: this.worldHeight * 0.5, count: Math.round(14 * qualityScale) },
      { scrollFactor: 0.85, color: 0x0c6475, alpha: 0.06, y: this.worldHeight * 0.7, count: Math.round(10 * qualityScale) }
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.count; i += 1) {
        const x = Phaser.Math.Between(200, this.worldWidth - 200);
        const y = layer.y + Phaser.Math.Between(-300, 300);
        const r = Phaser.Math.Between(60, 160);
        const fog = this.add.circle(x, y, r, layer.color, layer.alpha)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setScrollFactor(layer.scrollFactor)
          .setDepth(-2);
        this.parallaxFogLayers.push(fog);
        this.registerCullable(fog, layer.scrollFactor, 360);
        this.tweens.add({
          targets: fog,
          x: fog.x + Phaser.Math.Between(-120, 120),
          alpha: { from: layer.alpha * 0.5, to: layer.alpha * 1.6 },
          scale: { from: 0.7, to: 1.4 },
          duration: Phaser.Math.Between(4000, 7000),
          yoyo: true,
          repeat: -1,
          delay: i * 220,
          ease: 'Sine.inOut'
        });
      }
    }
  }

  private createAtmosphere(): void {
    const profile = getVisualProfile();
    const fogSpots = [
      { x: 280, y: 260, r: 200, color: 0x0a3850 },
      { x: 1640, y: 760, r: 250, color: 0x3d1d62 },
      { x: 980, y: 950, r: 220, color: 0x0c6475 }
    ];
    for (const spot of fogSpots) {
      const particleCount = Math.max(4, Math.round(profile.fogParticlesPerSpot * 0.6));
      for (let i = 0; i < particleCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * spot.r;
        const size = Phaser.Math.Between(16, 44);
        const fogParticle = this.add.circle(
          spot.x + Math.cos(angle) * dist,
          spot.y + Math.sin(angle) * dist * 0.6,
          size, spot.color, 0.04 + Math.random() * 0.04
        ).setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0.5);
        this.registerCullable(fogParticle, 0.5, 260);
        this.tweens.add({
          targets: fogParticle,
          x: fogParticle.x + Phaser.Math.Between(-50, 50),
          y: fogParticle.y + Phaser.Math.Between(-25, 25),
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
    // 环境尘埃：微量上浮微粒（世界坐标、可裁剪、极低透明度）——空气在动的实验室感
    const dustCount = Math.max(6, Math.round(profile.fogParticlesPerSpot));
    for (let di = 0; di < dustCount; di += 1) {
      const dx = Math.random() * this.worldWidth;
      const dy = Math.random() * this.worldHeight;
      const mote = this.add.circle(dx, dy, Phaser.Math.FloatBetween(1.2, 2.8), 0x9fd8e8, 0.12)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-1);
      this.registerCullable(mote, 0, 120);
      this.tweens.add({
        targets: mote,
        y: dy - Phaser.Math.Between(60, 150),
        x: dx + Phaser.Math.Between(-40, 40),
        alpha: { from: 0.03, to: 0.16 },
        duration: Phaser.Math.Between(6000, 13000),
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 3000,
        ease: 'Sine.inOut'
      });
    }
    // ---- 哈迪斯式群系/地形层：柏林噪声一次性生成（群系底色/高地亮块/洼地/液洼/地物）----
    const terrain = generateTerrain(
      this.runSeed, this.worldWidth, this.worldHeight,
      this.diamondA, this.diamondB, this.diamondCx, this.diamondCy
    );
    const terrainGfx = this.add.graphics().setDepth(-1.5); // 网格之下、环境光之上：透过半透明网格读出地形
    for (const t of terrain.tints) {
      terrainGfx.fillStyle(t.color, t.alpha);
      // isometric 菱形块，与网格晶格同构
      terrainGfx.beginPath();
      terrainGfx.moveTo(t.x, t.y - t.h / 2);
      terrainGfx.lineTo(t.x + t.w / 2, t.y);
      terrainGfx.lineTo(t.x, t.y + t.h / 2);
      terrainGfx.lineTo(t.x - t.w / 2, t.y);
      terrainGfx.closePath();
      terrainGfx.fillPath();
    }

    // ---- 体积化地形（v0.2.3）：高地格绘制等距棱柱（顶面菱形 + 左右侧面挤出厚度）----
    // 三阶色板：顶面 = accent 原色，左面 darken(28)，右面 darken(45)；厚度 12/20/28 三档
    const isoBlock = (gx: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, height: number, top: number, rim: number): void => {
      const sideL = Phaser.Display.Color.IntegerToColor(top).darken(28).color;
      const sideR = Phaser.Display.Color.IntegerToColor(top).darken(45).color;
      // 左侧面（朝左下的可见面）
      gx.fillStyle(sideL, 1);
      gx.beginPath();
      gx.moveTo(x - w / 2, y);
      gx.lineTo(x, y + h / 2);
      gx.lineTo(x, y + h / 2 + height);
      gx.lineTo(x - w / 2, y + height);
      gx.closePath();
      gx.fillPath();
      // 右侧面（朝右下的可见面）
      gx.fillStyle(sideR, 1);
      gx.beginPath();
      gx.moveTo(x + w / 2, y);
      gx.lineTo(x, y + h / 2);
      gx.lineTo(x, y + h / 2 + height);
      gx.lineTo(x + w / 2, y + height);
      gx.closePath();
      gx.fillPath();
      // 顶面（上移 height）
      gx.fillStyle(top, 1);
      gx.beginPath();
      gx.moveTo(x, y - h / 2 - height);
      gx.lineTo(x + w / 2, y - height);
      gx.lineTo(x, y + h / 2 - height);
      gx.lineTo(x - w / 2, y - height);
      gx.closePath();
      gx.fillPath();
      // 顶面边缘线（群系强调色，勾勒体积轮廓）
      gx.lineStyle(1.2, rim, 0.5);
      gx.strokePath();
    };
    for (const blk of terrain.blocks) {
      isoBlock(terrainGfx, blk.x, blk.y, blk.w, blk.h, blk.height, blk.top, blk.rim);
    }
    // 碰撞体积（v0.2.3）：仅较高棱柱可碰撞——静态体略小于视觉（留出贴边走位空间）；
    // 敌人不与之碰撞（电子体穿行，避免 AI 卡死），玩家需要绕行
    const obstacles = this.physics.add.staticGroup();
    for (const blk of terrain.blocks) {
      if (!blk.collidable) continue;
      const body = obstacles.create(blk.x, blk.y + 6, 'biome-tloor');
      body.setVisible(false);
      body.setDisplaySize(76, 40);
      body.refreshBody();
    }
    this.physics.add.collider(this.playerBody, obstacles);

    for (const deco of terrain.decorations) {
      if (deco.puddle) {
        // 液洼：扁椭圆 + ADD 混合，化学溶剂质感
        const puddle = this.add.ellipse(deco.x, deco.y, Phaser.Math.Between(70, 130), Phaser.Math.Between(26, 44), deco.puddleColor, 0.14)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(-0.5);
        this.registerCullable(puddle, 0, 200);
        this.tweens.add({
          targets: puddle, alpha: { from: 0.08, to: 0.2 }, scaleX: { from: 0.94, to: 1.08 },
          duration: Phaser.Math.Between(2400, 4200), yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });
      } else {
        const prop = this.add.image(deco.x, deco.y, deco.texture)
          .setAlpha(0.92).setOrigin(0.5, 1).setDepth(0.15)
          .setRotation(Phaser.Math.FloatBetween(-0.12, 0.12));
        this.registerCullable(prop, 0, 200);
      }
    }

    // ---- 实物瓦片投影（v0.2.3）：群系专属地形实物，iso 倾斜贴地 + 深度按 y 排序 ----
    for (const tile of terrain.tiles) {
      const tileImg = this.add.image(tile.x, tile.y, tile.texture)
        .setOrigin(0.5, 1)
        .setAlpha(0.9)
        .setRotation(tile.rot);
      // 2.5D：scaleY 压缩 + 倾斜固定值模拟斜俯视；depth 按 y（越靠下越靠前）
      tileImg.setScale(0.55, 0.42);
      tileImg.setDepth(tile.y * 0.001 + 0.2);
      this.registerCullable(tileImg, 0, 220);
    }

    // ---- 群系大型地物（v0.2.3）：trap 实物，带 2.5D 投影（origin 底部 + lift 上浮）----
    for (const prop of terrain.props) {
      const propImg = this.add.image(prop.x, prop.y, prop.texture)
        .setOrigin(0.5, 1)
        .setAlpha(0.95);
      const pw = propImg.width * 0.5;
      const ph = propImg.height * 0.5;
      propImg.setDisplaySize(pw, ph);
      // 深度按 y 排序（越靠下越靠前），跟玩家/敌人同层体系（depth 由 y 决定）
      propImg.setDepth(prop.y * 0.001 + 0.25);
      // 底部椭圆阴影（接地感）
      const shadow = this.add.ellipse(prop.x, prop.y + 4, pw * 0.7, ph * 0.16, 0x000000, 0.3)
        .setDepth(prop.y * 0.001 + 0.24);
      this.registerCullable(propImg, 0, 260);
      this.registerCullable(shadow, 0, 260);
    }

    // 战斗布景：Chemic 花/石/蘑菇/炼金台密集贴地（原尺寸、贴着地面、跟随相机）
    // 约束：落在菱形地图内（|dx|/A+|dy|/B<=0.92）、彼此间距 >= 120、不进中心出生区；密度相对原 34 -50%
    const chemicKeys = ['tex-flower', 'tex-rock', 'tex-mushroom', 'tex-anthemy'];
    const decoPts: { x: number; y: number }[] = [];
    const inDiamond = (x: number, y: number, margin = 0.92): boolean =>
      Math.abs(x - this.diamondCx) / this.diamondA + Math.abs(y - this.diamondCy) / this.diamondB <= margin;
    let placed = 0;
    for (let i = 0; i < 400 && placed < 17; i += 1) {
      const x = Phaser.Math.Between(240, this.worldWidth - 240);
      const y = Phaser.Math.Between(240, this.worldHeight - 240);
      if (!inDiamond(x, y)) continue;
      if (Math.abs(x - this.diamondCx) < 200 && Math.abs(y - this.diamondCy) < 140) continue;
      if (decoPts.some((p) => Phaser.Math.Distance.Between(p.x, p.y, x, y) < 120)) continue;
      const key = chemicKeys[placed % chemicKeys.length];
      const deco = this.add.image(x, y, key)
        .setAlpha(0.92).setScrollFactor(1).setOrigin(0.5, 1).setDepth(0.15);
      deco.rotation = Phaser.Math.FloatBetween(-0.12, 0.12);
      decoPts.push({ x, y });
      placed += 1;
    }
    for (const x of [800, 2400]) {
      const column = this.add.rectangle(x, this.worldHeight / 2, 50, this.worldHeight, 0x06b6d4, 0.03)
        .setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0.4);
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
    for (let index = 0; index < (this.isTouch ? 8 : 12); index += 1) {
      const mist = this.add.circle(
        Phaser.Math.Between(120, this.worldWidth - 120),
        Phaser.Math.Between(140, this.worldHeight - 140),
        Phaser.Math.Between(16, 44),
        index % 3 === 0 ? 0x8b5cf6 : index % 3 === 1 ? 0x06b6d4 : 0x0c6475,
        0.06
      ).setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0.55);
      this.registerCullable(mist, 0.55, 260);
      this.tweens.add({
        targets: mist,
        x: mist.x + Phaser.Math.Between(-80, 80),
        y: mist.y + Phaser.Math.Between(-40, 40),
        scale: { from: 0.6, to: 1.3 },
        alpha: { from: 0.03, to: 0.1 },
        duration: Phaser.Math.Between(2400, 5200),
        yoyo: true,
        repeat: -1,
        delay: index * 100,
        ease: 'Sine.inOut'
      });
    }
    // Volumetric fog: clusters of blur particles along horizontal bands
    for (let band = 0; band < 5; band += 1) {
      const bandY = Phaser.Math.Between(200, this.worldHeight - 200);
      const bandCenterX = Phaser.Math.Between(400, this.worldWidth - 400);
      const bandColor = band % 2 === 0 ? 0x06b6d4 : 0x8b5cf6;
      const particleCount = profile.fogParticlesPerBand;
      for (let p = 0; p < particleCount; p += 1) {
        const ox = Phaser.Math.Between(-300, 300);
        const oy = Phaser.Math.Between(-15, 15);
        const size = Phaser.Math.Between(18, 50);
        const fog = this.add.circle(bandCenterX + ox, bandY + oy, size, bandColor, 0.08 + Math.random() * 0.05)
          .setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0.5);
        this.registerCullable(fog, 0.5, 260);
        this.tweens.add({
          targets: fog,
          x: fog.x + Phaser.Math.Between(-120, 120),
          y: fog.y + Phaser.Math.Between(-20, 20),
          alpha: { from: 0.05, to: 0.13 },
          scale: { from: 0.7, to: 1.35 },
          duration: Phaser.Math.Between(3000, 5500),
          yoyo: true,
          repeat: -1,
          delay: p * 180 + band * 200,
          ease: 'Sine.inOut'
        });
      }
    }
  }
}
