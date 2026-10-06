import Phaser from 'phaser';
import { getVisualQuality, setVisualQuality, visualEffectsSummary, visualQualityLabel } from '../game/visual/quality';
import { applyAdaptiveResolution, getSettings, toggleSetting, type AspectRatio } from '../game/state/SettingsState';
import { dyes, resolveMix, getMixPreview } from '../game/data/dyes';
import { relicDefs, getRelicEffect, getRarityColor, getRarityLabel, isRelicUnlocked, type UnlockKind, type RelicProgress } from '../game/data/relics';
import { gameState } from '../game/state/GameState';
import { profileState, setActiveRelic, equipDyePair, upgradeRelic, getRelicLevel, relicUpgradeCost, getWeaponLevel, getWeaponForm, upgradeWeapon, setWeaponForm, buyGear, getWarehouseCount, toggleGearSlot, unequipGearSlot } from '../game/state/ProfileState';
import { MAX_WEAPON_LEVEL, weaponUpgradeCost, weapons } from '../game/data/weapons';
import { GEAR_RARITY_META, GEAR_SLOTS, GEAR_SLOT_META, gearsForSlot, getGear, warehouseCount, type GearSlot } from '../game/data/gear';

type Tab = '画面' | '声音' | '操作' | '游戏性' | '开发者';
const tabs: Tab[] = ['画面', '声音', '操作', '游戏性'];
let activeTab: Tab = '画面';

function isMobile(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showPanel(id: 'settings-panel' | 'dye-panel' | 'relic-panel' | 'weapon-panel' | 'gear-panel'): void {
  const settings = element<HTMLElement>('settings-panel');
  const dye = element<HTMLElement>('dye-panel');
  const relic = element<HTMLElement>('relic-panel');
  const weapon = element<HTMLElement>('weapon-panel');
  const gear = element<HTMLElement>('gear-panel');
  [settings, dye, relic, weapon, gear].forEach((panel) => panel?.classList.remove('is-exiting'));
  settings?.toggleAttribute('hidden', id !== 'settings-panel');
  dye?.toggleAttribute('hidden', id !== 'dye-panel');
  relic?.toggleAttribute('hidden', id !== 'relic-panel');
  weapon?.toggleAttribute('hidden', id !== 'weapon-panel');
  gear?.toggleAttribute('hidden', id !== 'gear-panel');
  updateHints();
}

function updateHints(): void {
  const settingsHint = element<HTMLElement>('settings-hint');
  const mobile = isMobile();
  if (settingsHint) {
    settingsHint.textContent = mobile ? '点击右侧数值修改' : '点击右侧数值修改 · ←/→ 调整画面质量 · Esc 返回';
  }
}

function boolLabel(v: boolean): string { return v ? '开启' : '关闭'; }
function numLabel(v: number, suffix: string): string { return `${v}${suffix}`; }

function renderSettings(): void {
  const content = element<HTMLElement>('settings-content');
  if (!content) return;
  const settings = getSettings();
  const aspectLabels: Record<AspectRatio, string> = { '16:9': '16:9', '20:9': '20:9', auto: '自动' };
  const rows = activeTab === '画面'
    ? [
        ['画面比例', aspectLabels[settings.aspectRatio], 'aspect-ratio'],
        ['光影质量', visualQualityLabel(getVisualQuality()), 'quality'],
        ['Bloom 光晕', boolLabel(settings.bloomEnabled), 'bloom'],
        ['动态环境光', boolLabel(settings.ambientEnabled), 'ambient'],
        ['动态阴影', boolLabel(settings.shadowEnabled), 'shadow'],
        ['屏幕震动', boolLabel(settings.shakeEnabled), 'shake']
      ]
    : activeTab === '声音'
      ? [['主音量', numLabel(settings.volume, '%'), 'volume'], ['音效', boolLabel(settings.effectsEnabled), 'effects'], ['环境音', boolLabel(settings.ambientSoundEnabled), 'ambient-sound'], ['冲刺反馈', boolLabel(settings.dashSoundEnabled), 'dash-sound']]
      : activeTab === '操作'
        ? [['移动方式', 'WASD / 摇杆', 'movement'], ['攻击方式', '左键 / 空格', 'attack'], ['冲刺方式', '鼠标右键', 'dash'], ['状态切换', 'R 键', 'mode']]
        : activeTab === '开发者'
          ? [
              ['调试叠层（FPS）', boolLabel(settings.devOverlayEnabled), 'dev-overlay'],
              ['显示碰撞箱', boolLabel(settings.devHitboxEnabled), 'dev-hitbox']
            ]
          : [['自动瞄准', '视野内单位', 'aim'], ['电子反馈', boolLabel(settings.electronFeedbackEnabled), 'electron-feedback'], ['辅助提示', boolLabel(settings.hintsEnabled), 'hints']];
  content.innerHTML = rows.map(([label, value, key]) => `<div class="setting-row"><span class="setting-label">${label}</span><button class="setting-value" type="button" data-setting="${key}">${value}<span class="setting-chevron">›</span></button></div>`).join('');
  content.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach((button) => {
    button.addEventListener('click', () => adjustSetting(button.dataset.setting ?? ''));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === activeTab);
  });
}

function cycleQuality(direction: number): void {
  const options = ['auto', 'low', 'medium', 'high'] as const;
  const index = options.indexOf(getVisualQuality());
  setVisualQuality(options[(index + direction + options.length) % options.length]);
  renderSettings();
}

function cycleAspectRatio(): void {
  const options: AspectRatio[] = ['16:9', '20:9', 'auto'];
  const settings = getSettings();
  const index = options.indexOf(settings.aspectRatio);
  const next = options[(index + 1) % options.length];
  try { localStorage.setItem('critical-reaction-setting-aspect-ratio', next); } catch { /* noop */ }
  renderSettings();
  // 延迟刷新页面以应用新的画面比例
  window.location.reload();
}

function adjustSetting(key: string): void {
  if (key === 'quality') { cycleQuality(1); return; }
  if (key === 'aspect-ratio') { cycleAspectRatio(); return; }
  if (key === 'volume') {
    const s = getSettings();
    const next = s.volume >= 100 ? 0 : s.volume + 25;
    try { localStorage.setItem('critical-reaction-setting-volume', String(next)); } catch { /* noop */ }
    renderSettings();
    return;
  }
  if (['bloom', 'shadow', 'ambient', 'shake', 'effects', 'ambient-sound', 'electron-feedback', 'hints', 'dash-sound', 'dev-overlay', 'dev-hitbox'].includes(key)) {
    toggleSetting(key);
    renderSettings();
    return;
  }
  renderSettings();
}

function toggleFullscreen(): void {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

/* ── 染色工作台 ─────────────────────────────────── */

let dyePrimaryIdx = 0;
let dyeSecondaryIdx = 1;
/** 上一轮渲染注册的全局监听释放函数（面板反复打开时避免累积）。 */
let dyeWheelCleanup: (() => void) | null = null;

/** 将当前选择写入 gameState（实时应用），并持久化到档案（跨局生效）。 */
function applyDyeState(): void {
  const p = dyes[dyePrimaryIdx];
  const s = dyes[dyeSecondaryIdx];
  gameState.dyeSlots[0].dyeId = p.id;
  gameState.dyeSlots[0].purity = 1;
  gameState.dyeSlots[1].dyeId = s.id;
  gameState.dyeSlots[1].purity = 0.5;
  const mix = resolveMix(p.id, s.id);
  gameState.dyeSlots[2].dyeId = mix ? mix.resultId : null;
  gameState.dyeSlots[2].purity = 0.25;
  gameState.dyeColor = p.hex;
  equipDyePair(p.id, s.id);
}

function renderDyeWorkbench(): void {
  const content = element<HTMLElement>('dye-workbench-content');
  if (!content) return;
  const primary = dyes[dyePrimaryIdx];
  const secondary = dyes[dyeSecondaryIdx];
  const preview = getMixPreview(primary.id, secondary.id);

  // 左右滚轮：列出全部 9 色，居中项为当前选择
  const wheelItems = (kind: 'primary' | 'secondary', current: number): string =>
    dyes.map((d, i) =>
      `<div class="dye-wheel-item ${i === current ? 'sel' : ''}" data-dye-${kind}="${i}" style="--dc:${d.color}">
        <span class="dye-swatch-swatch"></span>
        <span class="dye-swatch-name">${d.name}</span>
      </div>`
    ).join('');

  // 滚轮外包一层相对定位容器，用于放置常驻的中央选择框
  const wheelCol = (kind: 'primary' | 'secondary', title: string, current: number): string =>
    `<div class="dye-col ${kind}">
      <div class="dye-col-title">${title}</div>
      <div class="dye-wheel-wrap">
        <div class="dye-wheel" data-wheel="${kind}">${wheelItems(kind, current)}</div>
        <div class="dye-wheel-frame"></div>
      </div>
    </div>`;

  let html = '<div class="dye-bench">';
  html += '<div class="dye-presets">';
  html += wheelCol('primary', '主染料 · 100%　滚动 / 点击选择', dyePrimaryIdx);
  html += `<div class="dye-center"><div class="dye-result filled" style="--dc:${preview.color}"></div>
    <div class="dye-result-name">${preview.name}</div>
    <div class="dye-result-effect">${preview.effect}</div></div>`;
  html += wheelCol('secondary', '副染料 · 50%　滚动 / 点击选择', dyeSecondaryIdx);
  html += '</div></div>';
  content.innerHTML = html;

  // 只更新中央结果色块，避免整面板重绘打断滚动
  const updateWheelResult = (): void => {
    const p = dyes[dyePrimaryIdx];
    const s = dyes[dyeSecondaryIdx];
    const pv = getMixPreview(p.id, s.id);
    const center = content.querySelector<HTMLElement>('.dye-center');
    if (!center) return;
    const res = center.querySelector<HTMLElement>('.dye-result');
    const name = center.querySelector<HTMLElement>('.dye-result-name');
    const effect = center.querySelector<HTMLElement>('.dye-result-effect');
    if (res) {
      res.classList.add('filled');
      res.style.setProperty('--dc', pv.color);
      res.classList.remove('flash'); void res.offsetWidth; res.classList.add('flash');
    }
    if (name) name.textContent = pv.name;
    if (effect) effect.textContent = pv.effect;
  };

  // 释放上一轮面板注册的全局监听，避免反复打开时累积
  if (dyeWheelCleanup) dyeWheelCleanup();
  const cleanups: Array<() => void> = [];

  const setupWheel = (kind: 'primary' | 'secondary'): void => {
    const wheel = content.querySelector<HTMLElement>(`[data-wheel="${kind}"]`);
    if (!wheel) return;
    const items = Array.from(wheel.querySelectorAll<HTMLElement>('.dye-wheel-item'));
    if (items.length === 0) return;

    const currentIndex = (): number => (kind === 'primary' ? dyePrimaryIdx : dyeSecondaryIdx);

    /**
     * 首尾项也要能被顶到正中，所以用实测像素补足上下内边距。
     * （原先的 calc(50% - 34px) 里百分比按容器「宽度」解析，PC 宽面板下会严重失准，
     *   导致首尾项永远无法居中、选中框与高亮项错位。）
     */
    const applyPadding = (): void => {
      const pad = Math.max(0, wheel.clientHeight / 2 - items[0].offsetHeight / 2);
      wheel.style.paddingTop = `${pad}px`;
      wheel.style.paddingBottom = `${pad}px`;
      // 选择框高度贴合实际行高，保证高亮项正好落在框内
      const frame = wheel.parentElement?.querySelector<HTMLElement>('.dye-wheel-frame');
      if (frame) frame.style.setProperty('--frame-h', `${items[0].offsetHeight + 10}px`);
    };

    const centerOn = (index: number, smooth: boolean): void => {
      const it = items[index];
      if (!it) return;
      const top = it.offsetTop - (wheel.clientHeight - it.offsetHeight) / 2;
      if (Math.abs(wheel.scrollTop - top) < 1) return;
      wheel.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    };

    /** 距滚动容器正中最近的项（一律以实际几何为准，避免索引漂移）。 */
    const nearestIndex = (): number => {
      const centerY = wheel.scrollTop + wheel.clientHeight / 2;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      items.forEach((it, i) => {
        const d = Math.abs(it.offsetTop + it.offsetHeight / 2 - centerY);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    };

    const commit = (index: number): void => {
      if (index === currentIndex()) return;
      if (kind === 'primary') dyePrimaryIdx = index; else dyeSecondaryIdx = index;
      items.forEach((it, i) => it.classList.toggle('sel', i === index));
      uiSfx('sfx-ziya', 0.4);
      applyDyeState(); // 实时应用
      updateWheelResult();
    };

    applyPadding();
    centerOn(currentIndex(), false);

    // PC 滚轮：主动步进一档并居中。若交给原生滚动，会与 scroll-snap 互相拉扯，
    // 滚一小段又被吸回原位，表现为「滚了没反应」。
    let acc = 0;
    const onWheel = (ev: WheelEvent): void => {
      acc += ev.deltaY;
      const idx = nearestIndex();
      // 已在首/尾时不再拦截，放行给外层面板继续滚动
      if ((acc < 0 && idx <= 0) || (acc > 0 && idx >= items.length - 1)) {
        acc = 0;
        return;
      }
      ev.preventDefault();
      if (Math.abs(acc) < 40) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      const next = Math.max(0, Math.min(items.length - 1, idx + dir));
      commit(next);
      centerOn(next, true);
    };
    wheel.addEventListener('wheel', onWheel, { passive: false });
    cleanups.push(() => wheel.removeEventListener('wheel', onWheel));

    // PC 点击：直接选中该项（此前只有 cursor:pointer，点击无响应）
    items.forEach((it, i) => {
      it.addEventListener('click', () => { commit(i); centerOn(i, true); });
    });

    // 触摸拖拽：滚动停止后吸附到最近项
    let timer = 0;
    const onScroll = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const idx = nearestIndex();
        commit(idx);
        centerOn(idx, false);
      }, 90);
    };
    wheel.addEventListener('scroll', onScroll, { passive: true });

    const onResize = (): void => { applyPadding(); centerOn(currentIndex(), false); };
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
  };

  setupWheel('primary');
  setupWheel('secondary');
  dyeWheelCleanup = () => { cleanups.forEach((fn) => fn()); dyeWheelCleanup = null; };
}

/* ── 遗物展示柜（2.5D 网格）────────────────── */

let selectedRelicId: string | null = null;

function relicHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * 2.5D 菱形网格坐标：index → 网格槽位。
 * 按 2:1 等距菱形铺开 10 个互不重叠的槽位（上-下-密 1/2/3/3/1），
 * 通过 --gx/--gz 注入，投影公式 left=50%+(Δgx*RX) / top=50%+(Σgx*RY)。
 */
function relicGridSlot(index: number): { gx: number; gz: number } {
  const slots = [
    { gx: 2, gz: 2 },     // 前排尖顶
    { gx: 0, gz: 2 }, { gx: 2, gz: 0 },   // 前排左/右
    { gx: -1, gz: 1 }, { gx: 0, gz: 0 }, { gx: 1, gz: -1 }, // 中排左/中/右
    { gx: -2, gz: 0 }, { gx: -1, gz: -1 }, { gx: 0, gz: -2 }, // 后一排
    { gx: -2, gz: -2 }  // 后排尖顶
  ];
  return slots[((index % 10) + 10) % 10];
}

function renderRelicPanel(): void {
  const content = element<HTMLElement>('relic-list-content');
  if (!content) return;
  const active = profileState.activeRelicId;
  let activeName = '';
  if (active) {
    const def = relicDefs.find((r) => r.id === active);
    activeName = def ? def.name : '';
  }
  const progress = profileState.progress;

  let html = '';
  // 状态条：当前激活
  html += `<div class="relic-activebar">`;
  html += activeName ? `<span class="relic-active-pill on">激活：${activeName}</span>` : `<span class="relic-active-pill">未激活 · 点击任意解锁遗物激活</span>`;
  html += `<span class="relic-active-tip">样本 ${profileState.samples} · 可用样本升级遗物</span>`;
  html += '</div>';

  // 2.5D 网格地面
  html += '<div class="relic-grid">';
  relicDefs.forEach((def, i) => {
    const slot = relicGridSlot(i);
    const unlocked = isRelicUnlocked(def, progress);
    const isActive = def.id === active;
    const rarityHex = relicHex(getRarityColor(def.rarity));
    const rarityLabel = getRarityLabel(def.rarity);
    const level = getRelicLevel(def.id);
    const effect = getRelicEffect(def, level).description;

    const stateCls = !unlocked ? 'locked' : isActive ? 'active' : 'idle';
    const selectCls = def.id === selectedRelicId ? ' selected' : '';

    html += `<button class="relic-slot ${stateCls}${selectCls}" data-relic-activate="${def.id}" style="
      --gx:${slot.gx}; --gz:${slot.gz};
      --rc:${rarityHex};">`;

    html += `<span class="relic-plinth"></span>`;
    if (!unlocked) {
      // 锁定态：剪影 + 解锁进度
      const pct = progressFor(def, progress);
      html += `<span class="relic-locked-icon">🔒</span>`;
      html += `<span class="relic-name">？？？</span>`;
      html += `<span class="relic-progress"><i style="width:${Math.min(100, pct)}%"></i></span>`;
    } else {
      html += `<span class="relic-icon">${def.icon}</span>`;
      html += `<span class="relic-name">${def.name}</span>`;
      html += `<span class="relic-rarity" style="background:${rarityHex}">${rarityLabel}</span>`;
      html += `<span class="relic-desc">Lv.${level + 1}/3</span>`;
      if (isActive) html += '<span class="relic-active-flag">已激活</span>';
      // 升级（样本消耗，最高 Lv.3）
      if (level < 2) {
        const cost = relicUpgradeCost(level);
        const afford = profileState.samples >= cost;
        html += `<span class="relic-upgrade${afford ? '' : ' disabled'}" data-relic-upgrade="${def.id}">升级 ${cost}样本</span>`;
      }
    }
    html += `</button>`;
    // 选中态：在磁贴下方显示具体效果提示
    if (def.id === selectedRelicId) {
      html += `<div class="relic-tip" style="--rc:${rarityHex}; left: calc(50% + ((${slot.gx} - ${slot.gz}) * var(--rx))); top: calc(50% + ((${slot.gx} + ${slot.gz}) * var(--ry)) + 44px);">
        <b>${def.name}</b> · ${effect}
      </div>`;
    }
  });
  html += '</div>';
  content.innerHTML = html;

  // 事件绑定：激活/放下 + 升级
  content.querySelectorAll<HTMLButtonElement>('[data-relic-activate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.relicActivate ?? '';
      const def = relicDefs.find((r) => r.id === id);
      if (!def || !isRelicUnlocked(def, profileState.progress)) return;
      selectedRelicId = id; // 记录当前选中项触发选中动画与效果提示
      const target = profileState.activeRelicId === id ? null : id;
      void setActiveRelic(target).then(() => {
        renderRelicPanel(); // 保持选中态，让激活动画（relic-select + relic-float）可见
      });
    });
  });
  content.querySelectorAll<HTMLElement>('[data-relic-upgrade]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); // 不触发磁贴的激活/放下
      const id = btn.dataset.relicUpgrade ?? '';
      if (upgradeRelic(id)) {
        uiSfx('sfx-liang', 0.8); // 升级成功
      } else {
        uiSfx('sfx-duong', 0.5); // 样本不足
      }
      renderRelicPanel();
    });
  });
}

/**
 * 武器架（§7）：展示两把武器的等级与形态。
 * 形态必须满级才可选 —— 未满级时以锁定提示显示，避免玩家以为"选了没生效"。
 */
function renderWeaponPanel(): void {
  const content = element<HTMLElement>('weapon-list-content');
  if (!content) return;
  content.innerHTML = '';
  const samplesLine = `<div class="relic-active-tip" style="margin-bottom:8px">当前样本：${profileState.samples}</div>`;
  content.insertAdjacentHTML('beforeend', samplesLine);

  for (const weapon of weapons) {
    const level = getWeaponLevel(weapon.id);
    const cost = weaponUpgradeCost(level);
    const activeForm = getWeaponForm(weapon.id);
    const section = document.createElement('div');
    section.className = 'wp-section';
    const costLabel = cost === null ? '已满级' : `${cost} 样本升级`;
    section.innerHTML = `
      <h2>${weapon.name}　Lv.${level}/${MAX_WEAPON_LEVEL}</h2>
      <div class="setting-row">
        <span class="setting-label">${weapon.type === 'melee' ? '近战' : '远程'} · 基础伤害 ${weapon.baseDamage} · 间隔 ${weapon.cooldown.toFixed(2)}s</span>
        <button class="ui-button${cost === null ? ' disabled' : ''}" data-weapon-upgrade="${weapon.id}" ${cost === null ? 'disabled' : ''}>${costLabel}</button>
      </div>
      <div class="setting-row">
        <span class="setting-label">${level >= MAX_WEAPON_LEVEL ? '选择形态' : `形态在 Lv.${MAX_WEAPON_LEVEL} 解锁`}</span>
        <span class="setting-value">${activeForm ? (weapon.forms.find((f) => f.id === activeForm)?.name ?? '无') : '无'}</span>
      </div>
    `;
    const formList = document.createElement('div');
    formList.className = 'ui-tabs';
    formList.style.flexWrap = 'wrap';
    for (const form of weapon.forms) {
      const btn = document.createElement('button');
      btn.className = `ui-button${activeForm === form.id ? ' active' : ''}`;
      btn.textContent = form.name;
      btn.title = form.desc;
      btn.disabled = level < MAX_WEAPON_LEVEL;
      if (level < MAX_WEAPON_LEVEL) btn.classList.add('disabled');
      btn.addEventListener('click', () => {
        setWeaponForm(weapon.id, activeForm === form.id ? null : form.id);
        uiSfx('sfx-ka', 0.7);
        renderWeaponPanel();
      });
      formList.appendChild(btn);
    }
    section.appendChild(formList);
    // 形态说明直接列出，避免只能靠 hover 才能读到关键数值
    for (const form of weapon.forms) {
      const line = document.createElement('div');
      line.className = 'relic-active-tip';
      line.style.textAlign = 'left';
      line.textContent = `${form.name}：${form.desc}`;
      section.appendChild(line);
    }
    content.appendChild(section);
  }

  content.querySelectorAll<HTMLButtonElement>('[data-weapon-upgrade]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.weaponUpgrade ?? '';
      if (upgradeWeapon(id)) {
        uiSfx('sfx-liang', 0.8);
      } else {
        uiSfx('sfx-duong', 0.5);
      }
      renderWeaponPanel();
    });
  });
}

/**
 * 装备库（搜打撤局外经济）：
 * 上半部分是携带槽（出击生效、死亡丢失），下半部分按槽位列出可购买/可携带的装备。
 * 购买与携带分开成两个按钮，避免"点一下就既买了又带上了"的误操作。
 */
function renderGearPanel(): void {
  const content = element<HTMLElement>('gear-list-content');
  if (!content) return;

  let html = '';
  html += '<div class="relic-activebar">';
  html += `<span class="relic-active-pill on">样本 ${profileState.samples}</span>`;
  html += `<span class="relic-active-tip">仓库 ${warehouseCount(profileState.warehouse)} 件 · 撤离带出 · 死亡丢失</span>`;
  html += '</div>';

  // 携带槽：当前出击配置
  html += '<div class="gear-section"><h2>携带槽（出击生效 · 死亡丢失）</h2><div class="gear-loadout">';
  for (const slot of GEAR_SLOTS) {
    const meta = GEAR_SLOT_META[slot];
    const id = profileState.loadout[slot];
    const def = id ? getGear(id) : undefined;
    html += `<div class="gear-slot${def ? ' filled' : ''}">
      <span class="gear-slot-name">${meta.icon} ${meta.name}</span>
      <span class="gear-slot-item">${def ? def.name : '空'}</span>
      ${def ? `<button class="ui-button" data-gear-unequip="${slot}">卸下</button>` : ''}
    </div>`;
  }
  html += '</div></div>';

  // 商店 + 仓库：按槽位分组
  for (const slot of GEAR_SLOTS) {
    const meta = GEAR_SLOT_META[slot];
    html += `<div class="gear-section"><h2>${meta.icon} ${meta.name}</h2>`;
    for (const g of gearsForSlot(slot)) {
      const own = getWarehouseCount(g.id);
      const equipped = profileState.loadout[slot] === g.id;
      const affordable = profileState.samples >= g.price;
      const rarity = GEAR_RARITY_META[g.rarity];
      html += `<div class="setting-row gear-row${equipped ? ' equipped' : ''}">
        <span class="setting-label">
          <b style="color:${rarity.color}">${g.icon} ${g.name}</b><em class="gear-rarity" style="color:${rarity.color}">${rarity.name}</em><br>
          <span class="gear-desc">${g.desc} · 持有 ${own}</span>
        </span>
        <span class="gear-actions">
          <button class="ui-button" data-gear-buy="${g.id}" ${affordable ? '' : 'disabled'}>购买 ${g.price}样本</button>
          <button class="ui-button${equipped ? ' active' : ''}" data-gear-equip="${slot}|${g.id}" ${own > 0 ? '' : 'disabled'}>${equipped ? '卸下' : '携带'}</button>
        </span>
      </div>`;
    }
    html += '</div>';
  }
  content.innerHTML = html;

  content.querySelectorAll<HTMLButtonElement>('[data-gear-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (buyGear(btn.dataset.gearBuy ?? '')) uiSfx('sfx-liang', 0.8);
      else uiSfx('sfx-duong', 0.5);
      renderGearPanel();
    });
  });
  content.querySelectorAll<HTMLButtonElement>('[data-gear-equip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [slot, id] = (btn.dataset.gearEquip ?? '').split('|');
      toggleGearSlot(slot as GearSlot, id);
      uiSfx('sfx-ka', 0.7);
      renderGearPanel();
    });
  });
  content.querySelectorAll<HTMLButtonElement>('[data-gear-unequip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      unequipGearSlot(btn.dataset.gearUnequip as GearSlot);
      uiSfx('sfx-ka', 0.7);
      renderGearPanel();
    });
  });
}

/** 计算解锁进度百分比（0-100）。 */
function progressFor(def: { unlock: { kind: UnlockKind; target: number } }, p: RelicProgress): number {
  let cur = 0;
  switch (def.unlock.kind) {
    case 'samples': cur = p.samples; break;
    case 'kills': cur = p.kills; break;
    case 'depth': cur = p.bestDepth; break;
    case 'layer': cur = p.bestLayer; break;
    case 'boss': cur = p.bossKills; break;
  }
  return (cur / Math.max(1, def.unlock.target)) * 100;
}

/** UI 音效（Chemic 语义：ka=面板开合, ziya=选择, da=应用, liang=升级成功, duong=失败）。 */
let uiGame: Phaser.Game | null = null;
function uiSfx(key: string, volume = 0.7): void {
  if (!uiGame) return;
  try { uiGame.sound.play(key, { volume }); } catch { /* noop */ }
}

export function mountMenuUi(game: Phaser.Game): void {
  uiGame = game;
  const mobile = isMobile();
  updateHints();
  // ---- 全屏切换后重算自适应比例 ----
  // 全屏/退出全屏会连发 fullscreenchange + resize，且浏览器落位时序不一：
  // 防抖到尺寸稳定后再按最终视口重算内部分辨率（模块加载时算的那份是全屏前的旧比例）。
  // 非全屏状态下的窗口缩放不重算：避免移动端地址栏收起/软键盘等频繁触发画布重建。
  let resolutionTimer = 0;
  const scheduleAdaptiveResolution = (): void => {
    window.clearTimeout(resolutionTimer);
    resolutionTimer = window.setTimeout(() => applyAdaptiveResolution(game), 150);
  };
  // 全屏后的多次确认：竖屏进入 → 全屏转横屏时，resize 事件可能在 fullscreenchange
  // 之前就到齐（防抖读到的是旧视口），且部分浏览器旋转动画分多帧落位。
  // 因此全屏切换后在 150ms / 500ms / 1200ms 三个时点各重算一次——
  // applyAdaptiveResolution 内部对"分辨率未变化"是空操作，重复调用安全。
  const onFullscreenChange = (): void => {
    scheduleAdaptiveResolution();
    window.setTimeout(() => applyAdaptiveResolution(game), 500);
    window.setTimeout(() => applyAdaptiveResolution(game), 1200);
  };
  const onWindowResize = (): void => {
    // APK（Capacitor）内没有 fullscreenElement，但沉浸式布局稳定后视口会变（如刚启动时
    // 状态栏 inset 尚未收起），必须跟着重算内部分辨率；浏览器里仍保持原判定避免地址栏抖动
    const inApp = typeof window !== 'undefined' && 'Capacitor' in window;
    if (document.fullscreenElement || inApp) scheduleAdaptiveResolution();
  };
  // 旋转事件（竖↔横）：全屏下旋转不触发 fullscreenchange，必须单独监听
  const onOrientationChange = (): void => {
    const inApp = typeof window !== 'undefined' && 'Capacitor' in window;
    if (document.fullscreenElement || inApp) {
      scheduleAdaptiveResolution();
      window.setTimeout(() => applyAdaptiveResolution(game), 600);
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onOrientationChange);
  window.screen?.orientation?.addEventListener?.('change', onOrientationChange);
  // 隐藏触发按钮：LobbyScene 交互点会调用 .click() 打开对应面板
  element<HTMLButtonElement>('open-settings')?.addEventListener('click', () => {
    uiSfx('sfx-ka'); // 面板打开
    showPanel('settings-panel');
    renderSettings();
  });
  element<HTMLButtonElement>('btn-fullscreen')?.addEventListener('click', toggleFullscreen);
  element<HTMLButtonElement>('back-home')?.addEventListener('click', () => {
    const settings = element<HTMLElement>('settings-panel');
    settings?.classList.add('is-exiting');
    window.setTimeout(() => {
      settings?.setAttribute('hidden', '');
      settings?.classList.remove('is-exiting');
      updateHints();
    }, 180);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      uiSfx('sfx-hit', 0.5); // 标签切换（源：di=切换）
      activeTab = (button.dataset.tab ?? '画面') as Tab;
      renderSettings();
    });
  });
  // 染色工作台
  element<HTMLButtonElement>('open-dye-workbench')?.addEventListener('click', () => {
    uiSfx('sfx-ka'); // 面板打开
    showPanel('dye-panel');
    renderDyeWorkbench();
  });
  element<HTMLButtonElement>('dye-back')?.addEventListener('click', () => {
    const panel = element<HTMLElement>('dye-panel');
    panel?.classList.add('is-exiting');
    window.setTimeout(() => { panel?.setAttribute('hidden', ''); panel?.classList.remove('is-exiting'); updateHints(); }, 180);
  });
  // 遗物展示柜
  element<HTMLButtonElement>('open-relic-panel')?.addEventListener('click', () => {
    uiSfx('sfx-ka'); // 面板打开
    showPanel('relic-panel');
    renderRelicPanel();
  });
  element<HTMLButtonElement>('relic-back')?.addEventListener('click', () => {
    const panel = element<HTMLElement>('relic-panel');
    panel?.classList.add('is-exiting');
    window.setTimeout(() => { panel?.setAttribute('hidden', ''); panel?.classList.remove('is-exiting'); updateHints(); }, 180);
  });
  // 武器架
  element<HTMLButtonElement>('open-weapon-panel')?.addEventListener('click', () => {
    uiSfx('sfx-ka'); // 面板打开
    showPanel('weapon-panel');
    renderWeaponPanel();
  });
  element<HTMLButtonElement>('weapon-back')?.addEventListener('click', () => {
    const panel = element<HTMLElement>('weapon-panel');
    panel?.classList.add('is-exiting');
    window.setTimeout(() => { panel?.setAttribute('hidden', ''); panel?.classList.remove('is-exiting'); updateHints(); }, 180);
  });
  // 装备库（搜打撤局外经济）
  element<HTMLButtonElement>('open-gear-panel')?.addEventListener('click', () => {
    uiSfx('sfx-ka'); // 面板打开
    showPanel('gear-panel');
    renderGearPanel();
  });
  element<HTMLButtonElement>('gear-back')?.addEventListener('click', () => {
    const panel = element<HTMLElement>('gear-panel');
    panel?.classList.add('is-exiting');
    window.setTimeout(() => { panel?.setAttribute('hidden', ''); panel?.classList.remove('is-exiting'); updateHints(); }, 180);
  });
  if (!mobile) {
    window.addEventListener('keydown', (event) => {
      const settingsHidden = element<HTMLElement>('settings-panel')?.hasAttribute('hidden');
      if (settingsHidden) return;
      if (event.key === 'Escape') {
        const settings = element<HTMLElement>('settings-panel');
        if (settings && !settings.hasAttribute('hidden')) {
          settings.classList.add('is-exiting');
          window.setTimeout(() => {
            settings.setAttribute('hidden', '');
            settings.classList.remove('is-exiting');
            updateHints();
          }, 180);
        }
      }
      if (event.key === 'ArrowLeft') cycleQuality(-1);
      if (event.key === 'ArrowRight') cycleQuality(1);
    });
  }
  renderSettings();
}
