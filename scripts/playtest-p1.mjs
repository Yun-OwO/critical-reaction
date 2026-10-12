/**
 * P1 风格纵切的真实运行验收脚本。
 *
 * 计划 §11.1 的可信测试入口要求：
 *   - 走正常加载流程，不强停 BootScene 后声称资源正确；
 *   - 不在循环里反复 start 场景；
 *   - 用真实实例，不用带 query 的动态 import 改"另一个模块实例"。
 *
 * 用法（dev server 需先在 5173 跑）：
 *   node scripts/playtest-p1.mjs
 *
 * 输出：`.playtest/p1-report.json` + 每阶段截图（若浏览器窗口可见）。
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '.playtest');
const URL_BASE = process.env.PLAYTEST_URL ?? 'http://localhost:5173/';

const STAGES = [
  {
    name: 'boot-and-lobby',
    label: '启动与大厅',
    // 只等 BootScene 自然结束进 Lobby，不做任何场景强切
    script: `(() => {
      const g = window.__game;
      if (!g) return {ok:false, stage:'no-game'};
      const k = g.scene.getScenes(true).map(s => s.scene.key);
      return {ok:true, stage:k.join(',')};
    })()`
  },
  {
    name: 'game-ready',
    label: '进入战斗场景',
    script: `(() => {
      const g = window.__game;
      if (!g || !g.scene) return {ok:false, why:'no-scene'};
      const gs = g.scene.getScene('GameScene');
      if (!gs) return {ok:false, why:'no-gs'};
      const ready = !!(gs.player && gs.audio && gs.cullables && gs.cullables.length > 100);
      return {
        ok: ready,
        why: ready ? '' : 'scene-not-ready',
        cullables: gs.cullables ? gs.cullables.length : -1,
        audioVoices: gs.audio ? gs.audio.diagnostics().activeVoices : -1
      };
    })()`
  },
  {
    name: 'terrain-readable',
    label: '地形通行可读',
    script: `(() => {
      const g = window.__game;
      const gs = g.scene.getScene('GameScene');
      if (!gs || !gs.player) return {ok:false, why:'not-ready'};
      // 统计阻挡块与可走浅台：侧壁只应画在 collidable 上
      const blocks = gs.terrainObstacles ? gs.terrainObstacles.children.entries.length : 0;
      return {ok:true, collidableBodies: blocks};
    })()`
  },
  {
    name: 'audio-pipeline',
    label: '音频链路',
    script: `(() => {
      const g = window.__game;
      const gs = g.scene.getScene('GameScene');
      if (!gs || !gs.audio) return {ok:false, why:'no-audio'};
      gs.audio.resetDiagnostics();
      // 播几条不同语义（避开同语义冷却）
      const events = ['cast','spray','swing','crit','hurt','kill'];
      let ok = 0;
      for (const e of events) if (gs.audio.play({event:e}, gs.time.now)) ok += 1;
      const d = gs.audio.diagnostics();
      return {
        ok: d.unresolved.size === 0,
        played: ok + '/' + events.length,
        unresolved: [...d.unresolved.keys()],
        activeVoices: d.activeVoices,
        peakVoices: d.peakVoices
      };
    })()`
  },
  {
    name: 'audio-release',
    label: '声部真实释放',
    // 异步：等声音自然结束
    async: true,
    script: `(async () => {
      const gs = window.__game.scene.getScene('GameScene');
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (gs.audio.diagnostics().activeVoices === 0) break;
      }
      const before = gs.audio.diagnostics().activeVoices;
      gs.audio.play({event:'cast', volume:1}, gs.time.now);
      const during = gs.audio.diagnostics().activeVoices;
      let releasedAt = -1;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (gs.audio.diagnostics().activeVoices === 0) { releasedAt = i * 100; break; }
      }
      return {ok: before === 0 && during >= 1 && releasedAt >= 0, before, during, releasedAt};
    })()`
  },
  {
    name: 'mobile-panel-exits',
    label: '移动端面板出口',
    script: `(() => {
      const ids = ['status-overlay','event-overlay','report-overlay','upgrade-overlay'];
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? {exists:true, hasClose: !!el.querySelector('button')} : {exists:false};
      }
      // 事件面板必须有可点关闭按钮（计划 §9.3）
      const evBtn = document.getElementById('event-close');
      return {ok: !!evBtn, eventClose: !!evBtn, panels: out};
    })()`
  }
];

async function main() {
  console.log('P1 纵切验收 —— 目标:', URL_BASE);
  const report = { url: URL_BASE, startedAt: new Date().toISOString(), stages: [], summary: {} };

  // 用 fetch 探活（不启动浏览器：可视化验证需用户本机浏览器，见 docs）
  try {
    const res = await fetch(URL_BASE);
    report.httpStatus = res.status;
    console.log('  HTTP', res.status);
    if (!res.ok) throw new Error(`dev server 返回 ${res.status}`);
  } catch (err) {
    report.error = String(err);
    console.error('无法连接 dev server:', String(err));
    console.error('请先启动：node node_modules/vite/bin/vite.js --host');
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, 'p1-report.json'), JSON.stringify(report, null, 2));
    process.exit(2);
  }

  console.log('\n注意：本脚本只验证「服务可达 + 页面契约」。');
  console.log('真实的运行时断言（音频链路/声部释放/面板出口）需在浏览器中执行，');
  console.log('或用已安装的 browser 工具驱动 tab。本次不启动 headless 浏览器：');
  console.log('chromium 未安装成功时，工具管道返回 0 但什么都没测（计划 §11.1 明令禁止）。\n');

  report.stages.push({
    name: 'http-reachable',
    label: 'dev server 可达',
    ok: true,
    detail: { status: report.httpStatus }
  });

  let pass = 1;
  let fail = 0;
  for (const stage of STAGES) {
    // 未接浏览器驱动时标记为 skipped，不算通过也不算失败
    report.stages.push({ name: stage.name, label: stage.label, ok: null, skipped: true });
    console.log(`  [skip] ${stage.label}（需浏览器驱动）`);
  }
  report.summary = { pass, fail, skipped: STAGES.length };

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'p1-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n报告已写入 .playtest/p1-report.json`);
  console.log(`通过 ${pass} · 失败 ${fail} · 跳过 ${STAGES.length}（需浏览器）`);
}

main();