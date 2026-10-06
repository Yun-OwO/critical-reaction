const { pathToFileURL } = await import("node:url");
const { httpGetJson, attachWs } = await import(pathToFileURL("G:/Users/Administrator/Documents/HBuilderProjects/临界反应/.cdp-helper.mjs").href);
globalThis.__suite = (async () => {
  const list = await httpGetJson('http://127.0.0.1:9226/json/list');
  const conn = await attachWs(list[0].webSocketDebuggerUrl);
  const evalPage = async (expr) => {
    const r = await conn.send('Runtime.evaluate', { expression: `(async () => { try { return JSON.stringify(await (${expr})); } catch (e) { return JSON.stringify({ __err: String(e) }); } })()`, awaitPromise: true, returnByValue: true });
    try { return JSON.parse(r.result.value); } catch { return r.result?.value ?? 'parse-fail'; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // 启动游戏（若未 boot）
  let boot = await evalPage('(() => !!window.__game)()');
  if (!boot) {
    await evalPage('(() => { document.querySelector(".start-btn")?.click(); return 1; })()');
    await sleep(7000);
    boot = await evalPage('(() => !!window.__game)()');
  }
  out.boot = boot;
  if (!boot) return out;

  // 进战斗（若在大厅）
  await evalPage(`(async () => {
    const lobby = window.__game.scene.getScene('LobbyScene');
    if (lobby.scene.isActive()) { lobby.interact('start'); }
    return 1;
  })()`);
  await sleep(4500);

  // 主断言套件
  out.results = await evalPage(`(async () => {
    const out = {};
    const g = window.__game;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const game = g.scene.getScene('GameScene');
    const ui = g.scene.getScene('UIScene');
    out.gameActive = game.scene.isActive();
    if (!out.gameActive) return out;

    // A. 电子上限 5：注入 6 颗 → HUD 5/5
    for (let i = 0; i < 6; i++) game.gainFreeElectronsWithFeedback(game.player.x, game.player.y);
    out.A_electronCap = ui.electronValText.text;

    // B. 特殊攻击最多消耗 3：5 颗放特殊 → 2/5
    game.specialAttack();
    await sleep(300);
    out.B_afterSpecial = ui.electronValText.text;

    // D. 攻击间隔 0.4s
    game.attackTimer = 0;
    game.attack();
    out.D_attackTimer = +game.attackTimer.toFixed(2);

    // C. 失控取消：满仓敌人单发 10 颗 → 电子不变
    const enemy = game.enemies.find((e) => e.view.visible && e.orbit);
    if (!enemy) {
      out.C = 'no-enemy-yet';
    } else {
      enemy.orbit.count = enemy.orbit.capacity;
      const before = enemy.orbit.count;
      game.stealElectrons(enemy, 10);
      out.C_cancelled = enemy.orbit.count === before && !enemy.dead;
      out.C_countAfter = enemy.orbit.count;
    }
    return out;
  })()`);

  // E. 战报继续按钮：直接死亡 → 报告 → 点继续 → 回大厅
  out.E = await evalPage(`(async () => {
    const g = window.__game;
    const game = g.scene.getScene('GameScene');
    if (!game.scene.isActive()) return { skipped: 'scene-inactive' };
    game.playerDeath();
    await sleep(1200);
    const btn = document.getElementById('report-continue');
    const overlayShown = document.getElementById('report-overlay')?.classList.contains('show') ?? false;
    if (!btn) return { reportShown: overlayShown, button: 'missing' };
    btn.click();
    await sleep(3500);
    const lobby = g.scene.getScene('LobbyScene');
    return { reportShown: overlayShown, clicked: true, lobbyActive: lobby.scene.isActive() };
  })()`);

  await conn.close();
  return out;
})();
await globalThis.__suite;
