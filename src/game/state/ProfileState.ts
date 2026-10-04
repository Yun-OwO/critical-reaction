import { dyes } from '../data/dyes';
import {
  aggregateGearEffects,
  applyDeathLoss,
  bankFoundGear,
  defaultLoadout,
  getGear,
  loadoutGearIds,
  normalizeLoadout,
  normalizeWarehouse,
  purchaseGear,
  toggleEquipGear,
  type GearLoadout,
  type GearSlot,
  type GearWarehouse,
  type ResolvedGearEffects
} from '../data/gear';
import { relicDefs, isRelicUnlocked, EMPTY_RELIC_PROGRESS, type RelicProgress } from '../data/relics';
import { MAX_WEAPON_LEVEL, weaponUpgradeCost, weapons } from '../data/weapons';
import { storageGet, storageSet } from './storage';

const STORAGE_KEY = 'profile';

export interface ProfileState {
  samples: number;
  equippedDyeId: string;
  /** 染色工作台选择的副染料（与主染料一起混色写入底槽） */
  equippedDyeSubId: string | null;
  /** 累计探险进度（用于遗物解锁） */
  progress: RelicProgress;
  /** 已解锁的遗物 id 列表 */
  unlockedRelics: string[];
  /** 当前激活的遗物 id（只能一个；为空表示未激活） */
  activeRelicId: string | null;
  /** 遗物升级等级（id → level 0-2，用样本在展示柜升级） */
  relicLevels: Record<string, number>;
  /** 武器等级（§7.3：1 起始，满级 3 解锁形态） */
  weaponLevels: Record<string, number>;
  /** 各武器已选形态 id（未满级时无效） */
  weaponForms: Record<string, string | null>;
  /**
   * 装备仓库（永久资产）：装备 id → 持有数量。
   * 用样本在装备库购买获得；撤离带出的战利品也写入这里。
   */
  warehouse: GearWarehouse;
  /** 携带槽：出击时生效的装备，死亡时从仓库扣除（搜打撤的得失来源）。 */
  loadout: GearLoadout;
}

export const profileState: ProfileState = {
  samples: 0,
  equippedDyeId: dyes[0]?.id ?? '',
  equippedDyeSubId: null,
  progress: { ...EMPTY_RELIC_PROGRESS },
  unlockedRelics: [],
  activeRelicId: null,
  relicLevels: {},
  weaponLevels: Object.fromEntries(weapons.map((w) => [w.id, 1])),
  weaponForms: Object.fromEntries(weapons.map((w) => [w.id, null])),
  warehouse: {},
  loadout: defaultLoadout()
};

/** 从 indexedDB 异步加载档案（返回是否成功加载到数据）。 */
export async function loadProfileFromStorage(): Promise<boolean> {
  try {
    const stored = await storageGet<Partial<ProfileState>>(STORAGE_KEY);
    if (!stored) return false;
    if (typeof stored.samples === 'number') profileState.samples = Math.max(0, stored.samples);
    if (typeof stored.equippedDyeId === 'string' && dyes.some((d) => d.id === stored.equippedDyeId)) {
      profileState.equippedDyeId = stored.equippedDyeId;
    }
    if (typeof stored.equippedDyeSubId === 'string' && dyes.some((d) => d.id === stored.equippedDyeSubId)) {
      profileState.equippedDyeSubId = stored.equippedDyeSubId;
    } else if (stored.equippedDyeSubId === null) {
      profileState.equippedDyeSubId = null;
    }
    if (stored.progress) {
      const p = stored.progress;
      profileState.progress = {
        samples: typeof p.samples === 'number' ? Math.max(0, p.samples) : 0,
        kills: typeof p.kills === 'number' ? Math.max(0, p.kills) : 0,
        bestDepth: typeof p.bestDepth === 'number' ? Math.max(0, p.bestDepth) : 0,
        bestLayer: typeof p.bestLayer === 'number' ? Math.max(0, p.bestLayer) : 0,
        bossKills: typeof p.bossKills === 'number' ? Math.max(0, p.bossKills) : 0
      };
    }
    if (Array.isArray(stored.unlockedRelics)) {
      profileState.unlockedRelics = stored.unlockedRelics.filter((id) => relicDefs.some((r) => r.id === id));
    }
    if (typeof stored.activeRelicId === 'string' && relicDefs.some((r) => r.id === stored.activeRelicId)) {
      profileState.activeRelicId = stored.activeRelicId;
    }
    if (stored.relicLevels && typeof stored.relicLevels === 'object') {
      const levels: Record<string, number> = {};
      for (const [id, level] of Object.entries(stored.relicLevels)) {
        if (relicDefs.some((r) => r.id === id) && typeof level === 'number') {
          levels[id] = Math.min(2, Math.max(0, Math.floor(level)));
        }
      }
      profileState.relicLevels = levels;
    }
    if (stored.weaponLevels && typeof stored.weaponLevels === 'object') {
      for (const [id, level] of Object.entries(stored.weaponLevels)) {
        if (weapons.some((w) => w.id === id) && typeof level === 'number') {
          profileState.weaponLevels[id] = Math.min(MAX_WEAPON_LEVEL, Math.max(1, Math.floor(level)));
        }
      }
    }
    if (stored.weaponForms && typeof stored.weaponForms === 'object') {
      for (const [id, formId] of Object.entries(stored.weaponForms)) {
        const weapon = weapons.find((w) => w.id === id);
        if (!weapon) continue;
        profileState.weaponForms[id] = typeof formId === 'string' && weapon.forms.some((f) => f.id === formId)
          ? formId
          : null;
      }
    }
    // 旧存档没有这两个字段：normalize* 会把缺失/非法数据清洗成空仓库与空携带槽
    profileState.warehouse = normalizeWarehouse(stored.warehouse);
    profileState.loadout = normalizeLoadout(stored.loadout, profileState.warehouse);
    return true;
  } catch {
    return false;
  }
}

export async function saveProfile(): Promise<void> {
  try {
    await storageSet(STORAGE_KEY, {
      samples: profileState.samples,
      equippedDyeId: profileState.equippedDyeId,
      equippedDyeSubId: profileState.equippedDyeSubId,
      progress: profileState.progress,
      unlockedRelics: profileState.unlockedRelics,
      activeRelicId: profileState.activeRelicId,
      relicLevels: profileState.relicLevels,
      weaponLevels: profileState.weaponLevels,
      weaponForms: profileState.weaponForms,
      warehouse: profileState.warehouse,
      loadout: profileState.loadout
    });
  } catch {
    return;
  }
}

export function equipDye(id: string): void {
  if (!dyes.some((dye) => dye.id === id)) return;
  profileState.equippedDyeId = id;
  void saveProfile();
}

/**
 * 保存染色工作台的整套染料搭配（主 + 副）。
 * 底槽混色结果由主副染料唯一确定，不单独存档。
 */
export function equipDyePair(primaryId: string, secondaryId: string | null): void {
  if (!dyes.some((dye) => dye.id === primaryId)) return;
  profileState.equippedDyeId = primaryId;
  profileState.equippedDyeSubId = secondaryId && dyes.some((dye) => dye.id === secondaryId) ? secondaryId : null;
  void saveProfile();
}

/** 遗物升级到下一级的花费（Lv1→2 / Lv2→3）。 */
export function relicUpgradeCost(level: number): number {
  return [15, 30][Math.min(level, 1)] ?? 30;
}

/** 用样本升级遗物（0-2 级）；样本不足返回 false。 */
export function upgradeRelic(id: string): boolean {
  const def = relicDefs.find((r) => r.id === id);
  if (!def) return false;
  const level = profileState.relicLevels[id] ?? 0;
  if (level >= 2) return false;
  const cost = relicUpgradeCost(level);
  if (profileState.samples < cost) return false;
  profileState.samples -= cost;
  profileState.relicLevels[id] = level + 1;
  void saveProfile();
  return true;
}

/** 读取遗物升级等级（0-2）。 */
export function getRelicLevel(id: string): number {
  return profileState.relicLevels[id] ?? 0;
}

/** 读取武器等级（1-3）。 */
export function getWeaponLevel(id: string): number {
  return profileState.weaponLevels[id] ?? 1;
}

/** 用样本升级武器（最高 3 级）；样本不足或已满级返回 false。 */
export function upgradeWeapon(id: string): boolean {
  if (!weapons.some((w) => w.id === id)) return false;
  const level = getWeaponLevel(id);
  const cost = weaponUpgradeCost(level);
  if (cost === null || profileState.samples < cost) return false;
  profileState.samples -= cost;
  profileState.weaponLevels[id] = Math.min(MAX_WEAPON_LEVEL, level + 1);
  void saveProfile();
  return true;
}

/** 选择武器形态（必须已满级且形态存在）；传 null 表示不使用形态。 */
export function setWeaponForm(weaponId: string, formId: string | null): void {
  const weapon = weapons.find((w) => w.id === weaponId);
  if (!weapon) return;
  if (getWeaponLevel(weaponId) < MAX_WEAPON_LEVEL) return;
  if (formId !== null && !weapon.forms.some((f) => f.id === formId)) return;
  profileState.weaponForms[weaponId] = formId;
  void saveProfile();
}

/** 当前武器已选形态 id（未满级时返回 null）。 */
export function getWeaponForm(weaponId: string): string | null {
  if (getWeaponLevel(weaponId) < MAX_WEAPON_LEVEL) return null;
  return profileState.weaponForms[weaponId] ?? null;
}

/** 记录累计进度，并自动解锁满足条件的遗物。返回本次新增解锁的遗物。 */
export function applyProgress(partial: Partial<RelicProgress>): string[] {
  const p = profileState.progress;
  if (typeof partial.samples === 'number') p.samples = Math.max(p.samples, partial.samples);
  if (typeof partial.kills === 'number') p.kills += Math.max(0, partial.kills);
  if (typeof partial.bestDepth === 'number') p.bestDepth = Math.max(p.bestDepth, partial.bestDepth);
  if (typeof partial.bestLayer === 'number') p.bestLayer = Math.max(p.bestLayer, partial.bestLayer);
  if (typeof partial.bossKills === 'number') p.bossKills = Math.max(p.bossKills, partial.bossKills);

  const newlyUnlocked: string[] = [];
  for (const def of relicDefs) {
    if (profileState.unlockedRelics.includes(def.id)) continue;
    if (isRelicUnlocked(def, p)) {
      profileState.unlockedRelics.push(def.id);
      newlyUnlocked.push(def.id);
    }
  }
  if (newlyUnlocked.length > 0) void saveProfile();
  return newlyUnlocked;
}

/** 激活指定遗物（会替换当前激活的遗物）；传 null 表示放下。 */
export async function setActiveRelic(id: string | null): Promise<void> {
  if (id !== null && !profileState.unlockedRelics.includes(id)) return;
  if (id !== null && !relicDefs.some((r) => r.id === id)) return;
  profileState.activeRelicId = id;
  await saveProfile();
}

/** 当前激活的遗物定义。 */
export function getActiveRelicDef() {
  if (!profileState.activeRelicId) return undefined;
  return relicDefs.find((r) => r.id === profileState.activeRelicId);
}

/* ── 装备（搜打撤核心循环）────────────────────────────── */

/** 用样本购买 1 件装备入仓库；样本不足或未知装备返回 false。 */
export function buyGear(id: string): boolean {
  const res = purchaseGear(profileState.warehouse, profileState.samples, id);
  if (!res.ok) return false;
  profileState.warehouse = res.warehouse;
  profileState.samples = res.samples;
  void saveProfile();
  return true;
}

/** 仓库中某装备的持有数量。 */
export function getWarehouseCount(id: string): number {
  return profileState.warehouse[id] ?? 0;
}

/** 切换某槽位的携带装备（同槽同一件再次选择即卸下）。 */
export function toggleGearSlot(slot: GearSlot, id: string): void {
  const next = toggleEquipGear(profileState.loadout, profileState.warehouse, slot, id);
  if (next === profileState.loadout) return;
  profileState.loadout = next;
  void saveProfile();
}

/** 直接卸下某槽位。 */
export function unequipGearSlot(slot: GearSlot): void {
  if (!profileState.loadout[slot]) return;
  profileState.loadout = { ...profileState.loadout, [slot]: null };
  void saveProfile();
}

/** 当前携带的装备 id（按槽位顺序）。 */
export function getCarriedGearIds(): string[] {
  return loadoutGearIds(profileState.loadout);
}

/** 汇总当前携带装备的属性修正（出击时由 GameScene 消费）。 */
export function getLoadoutEffects(): ResolvedGearEffects {
  return aggregateGearEffects(getCarriedGearIds());
}

/**
 * 死亡结算：携带装备从仓库各扣 1 件，局内搜到的战利品全部丢失。
 * 返回丢失清单供 UI 提示。
 */
export function loseGearOnDeath(carriedLoot: readonly string[] = []): { lost: string[]; lostLoot: number } {
  const res = applyDeathLoss(profileState.warehouse, profileState.loadout, carriedLoot);
  profileState.warehouse = res.warehouse;
  profileState.loadout = res.loadout;
  void saveProfile();
  return { lost: res.lost, lostLoot: res.lostLoot };
}

/** 撤离结算：局内搜到的战利品写入仓库；返回实际入库件数。 */
export function bankCarriedGear(found: readonly string[]): number {
  const valid = found.filter((id) => getGear(id));
  if (valid.length === 0) return 0;
  profileState.warehouse = bankFoundGear(profileState.warehouse, valid);
  void saveProfile();
  return valid.length;
}

// 兼容旧式同步读取（新数据从 indexedDB 异步加载，启动时先 showStart 默认值）
void loadProfileFromStorage();