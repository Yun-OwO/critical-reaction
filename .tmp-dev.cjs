const fs = require('fs');

// ============ 1. 移除右下角染色芯片（创建 + 刷新 + 字段） ============
{
  const p = 'src/game/scenes/UIScene.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b) => { if (!s.includes(a)) { console.error('UI MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

  // 字段
  rep(
    '  private dyeChips: { bg: Phaser.GameObjects.Rectangle; swatch: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; purity: Phaser.GameObjects.Text }[] = [];\n',
    ''
  );
  rep('    this.dyeChips = [];\n', '');

  // create 块：三枚芯片 + 槽位标题
  const startMark = '    // ---- 右下：染料槽图形化（§14.5）+ 样本 / 模式 ----';
  const endMark = '    // ---- 右侧：温度计（设计文档 §14.4）----';
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark);
  if (a < 0 || b <= a) { console.error('chip create anchors fail'); ok = false; }
  else {
    s = s.slice(0, a) + '    // 右下染料槽芯片已移除（v0.2.2：进化等级改由状态面板与主槽徽标呈现）\n\n' + s.slice(b);
    console.log('chips create block removed');
  }

  // refreshDyeChips 方法整体删除
  const mStart = '  private refreshDyeChips(): void {';
  const mEnd = '  /** Boss 血条与阶段圆点。 */';
  const a2 = s.indexOf(mStart);
  const b2 = s.indexOf(mEnd);
  if (a2 < 0 || b2 <= a2) { console.error('refreshDyeChips anchors fail'); ok = false; }
  else {
    s = s.slice(0, a2) + s.slice(b2);
    console.log('refreshDyeChips removed');
  }
  // refresh() 里的调用
  rep('    this.refreshDyeChips();\n', '');

  fs.writeFileSync(p, s);
  console.log('UI dye chips removal:', ok ? 'ok' : 'MISSED');
}

// ============ 2. SettingsState: 开发者选项（FPS / 碰撞箱） ============
{
  const p = 'src/game/state/SettingsState.ts';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('devOverlayEnabled')) {
    s = s.replace(
      '  dashSoundEnabled: boolean;\n  aspectRatio: AspectRatio;\n}',
      '  dashSoundEnabled: boolean;\n  aspectRatio: AspectRatio;\n  /** 开发者选项：右上角调试叠层（FPS 等） */\n  devOverlayEnabled: boolean;\n  /** 开发者选项：显示物理碰撞箱 */\n  devHitboxEnabled: boolean;\n}'
    );
    s = s.replace(
      "  dashSoundEnabled: true,\n  aspectRatio: 'auto'\n};",
      "  dashSoundEnabled: true,\n  aspectRatio: 'auto',\n  devOverlayEnabled: false,\n  devHitboxEnabled: false\n};"
    );
    s = s.replace(
      "  aspectRatio: readString('aspect-ratio', DEFAULTS.aspectRatio) as AspectRatio\n  };",
      "  aspectRatio: readString('aspect-ratio', DEFAULTS.aspectRatio) as AspectRatio,\n    devOverlayEnabled: readBool('dev-overlay', DEFAULTS.devOverlayEnabled),\n    devHitboxEnabled: readBool('dev-hitbox', DEFAULTS.devHitboxEnabled)\n  };"
    );
    s = s.replace(
      "  'dash-sound': 'dashSoundEnabled',\n};",
      "  'dash-sound': 'dashSoundEnabled',\n  'dev-overlay': 'devOverlayEnabled',\n  'dev-hitbox': 'devHitboxEnabled',\n};"
    );
  }
  fs.writeFileSync(p, s);
  console.log('settings dev fields:', s.includes('devOverlayEnabled') && s.includes('dev-hitbox') ? 'ok' : 'FAILED');
}

// ============ 3. Menu.ts: 设置面板增加「开发者」标签页 ============
{
  const p = 'src/ui/Menu.ts';
  let s = fs.readFileSync(p, 'utf8');
  let ok = true;
  const rep = (a, b) => { if (!s.includes(a)) { console.error('MENU MISS:', a.slice(0, 60)); ok = false; return; } s = s.split(a).join(b); };

  rep(
    "type Tab = '画面' | '声音' | '操作' | '游戏性';",
    "type Tab = '画面' | '声音' | '操作' | '游戏性' | '开发者';"
  );
  rep(
    "        : [['自动瞄准', '视野内单位', 'aim'], ['电子反馈', boolLabel(settings.electronFeedbackEnabled), 'electron-feedback'], ['辅助提示', boolLabel(settings.hintsEnabled), 'hints']];",
    `        : activeTab === '开发者'
          ? [
              ['调试叠层（FPS）', boolLabel(settings.devOverlayEnabled), 'dev-overlay'],
              ['显示碰撞箱', boolLabel(settings.devHitboxEnabled), 'dev-hitbox']
            ]
          : [['自动瞄准', '视野内单位', 'aim'], ['电子反馈', boolLabel(settings.electronFeedbackEnabled), 'electron-feedback'], ['辅助提示', boolLabel(settings.hintsEnabled), 'hints']];`
  );
  rep(
    "  if (['bloom', 'shadow', 'ambient', 'shake', 'effects', 'ambient-sound', 'electron-feedback', 'hints', 'dash-sound'].includes(key)) {",
    "  if (['bloom', 'shadow', 'ambient', 'shake', 'effects', 'ambient-sound', 'electron-feedback', 'hints', 'dash-sound', 'dev-overlay', 'dev-hitbox'].includes(key)) {"
  );
  fs.writeFileSync(p, s);
  console.log('menu dev tab:', ok ? 'ok' : 'MISSED');
}
