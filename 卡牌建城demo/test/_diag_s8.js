/* _diag_s8.js —— 专查 fulltest 里 S8c（行军→抵达→占领）的偶发失败
 * 运行：NODE_PATH=... node test/_diag_s8.js [轮数=20]
 *
 * 目的：fulltest 的 S8c 会偶发失败（march 已空但资源点未易手）。
 * 全流程复跑一次要 ~40s，太慢；这里只复现 S8 那一段，并逐秒留痕，
 * 用来判断到底是「游戏逻辑 bug」还是「测试对随机性敏感」。
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const URL = 'http://127.0.0.1:8124/index.html';
const N = parseInt(process.argv[2] || '20', 10);

const ff = (page, sec) => page.evaluate((n) => { for (let i = 0; i < n; i++) Game.update(1); UI.render(); }, sec);
const tileXY = (page, gx, gy) => page.evaluate(([x, y]) => {
  const r = Sandbox.tileRect(x, y);
  const cv = document.getElementById('sandbox').getBoundingClientRect();
  const k = cv.width / document.getElementById('sandbox').offsetWidth;
  return { x: cv.left + (r.x + r.w / 2) * k, y: cv.top + (r.y + r.h / 2) * k };
}, [gx, gy]);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  const summary = [];

  for (let round = 1; round <= N; round++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(URL + '?v=' + Date.now(), { waitUntil: 'load' });
    await page.waitForTimeout(1400);
    await page.evaluate(() => { if (window.Menu) Menu.start(true); });
    await page.waitForTimeout(900);
    /* ⚠️ 必须清掉开局的政策三选一弹窗：它盖在沙盘上，鼠标拖拽根本到不了 canvas（我第一版漏了这步，
     *   20 轮全失败、发兵=[]，纯属诊断脚本自己的锅）。fulltest 里是 S1 先颁布政策，所以没这个问题。 */
    await page.evaluate(() => {
      Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
      Game.state.questClaiming = false; UI.setModal(null); UI.render();
    });

    /* ---- 复现 S8a：造兵营 + 快进 40s ---- */
    await page.evaluate(() => {
      const S = Game.state;
      S.buildings[Game.tileKeyOf(4, 13)] = { gx: 4, gy: 13, type: 'barracks', level: 1, owner: 'p1', hp: 999, pending: false, trainT: 0 };
      Game.reindex(); UI.render();
    });
    await ff(page, 40);

    /* ---- 复现 S8b：修路 + 拖兵 ---- */
    await page.evaluate(() => {
      const S = Game.state; const goal = { gx: 5, gy: 5 };
      for (let g = 0; g < 80; g++) {
        if (Game.findPath(4, 13, goal.gx, goal.gy, 'p1')) break;
        const fr = Game.roadFrontier('p1');
        let best = null, bd = 1e9;
        fr.forEach(p => {
          if (Math.abs(p.gx - S.castle.gx) + Math.abs(p.gy - S.castle.gy) > Math.abs(p.gx - S.enemyCastle.gx) + Math.abs(p.gy - S.enemyCastle.gy)) return;
          const d = Math.abs(p.gx - goal.gx) + Math.abs(p.gy - goal.gy) - (Game.isOfficialRoad(p.gx, p.gy) ? 0.5 : 0);
          if (d < bd) { bd = d; best = p; }
        });
        if (!best) break;
        Game.placeRoad(best.gx, best.gy);
      }
      UI.render();
    });

    const before = await page.evaluate(() => {
      const S = Game.state;
      return {
        t: Math.round(S.t),
        onBarracks: (S.troops[Game.tileKeyOf(4, 13)] && S.troops[Game.tileKeyOf(4, 13)].p1) || 0,
        guard: S.resGuard[Game.tileKeyOf(5, 5)],
        owner: S.resourceOwner[Game.tileKeyOf(5, 5)] || '(无)',
        food: Math.round(S.res.food),
        enemyTroops: Game.totalTroops('p2'),
        evCur: S.events.p1.current,
        pathLegs: (function () { const p = Game.findPath(4, 13, 5, 5, 'p1'); return p ? p.length : -1; })(),
      };
    });

    const from = await tileXY(page, 4, 13), to = await tileXY(page, 5, 5);
    /* 只复现本条链路：把粮补足，排除「粮尽停军」这个已知变量。
     * 想复现最初的偶发失败，把下面这行注释掉即可（本脚本第一版正是靠它发现根因的）。 */
    await page.evaluate(() => { Game.state.res.food = Math.max(Game.state.res.food, 600); UI.render(); });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(280);

    const sent = await page.evaluate(() => (Game.state.march || []).map(m => ({ n: m.n, legs: m.path.length, idx: m.idx })));

    /* ---- 逐秒推进，留痕 ---- */
    const trace = [];
    let resolved = null;
    for (let s = 0; s < 150; s++) {
      await ff(page, 1);
      const d = await page.evaluate(() => ({
        g: Game.state.resGuard[Game.tileKeyOf(5, 5)],
        o: Game.state.resourceOwner[Game.tileKeyOf(5, 5)] || '',
        m: (Game.state.march || []).map(x => 'n' + x.n + '@' + (x.path[x.idx] ? x.path[x.idx].gx + ',' + x.path[x.idx].gy : '-')),
        // 目标点及其四邻的双方兵力，用来判断"谁杀谁"
        near: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(o => {
          const k = Game.tileKeyOf(5 + o[0], 5 + o[1]);
          const t = Game.state.troops[k];
          return (t ? ((t.p1 || 0) + 'p1/' + (t.p2 || 0) + 'p2') : '-');
        }).join(' '),
      }));
      if (s % 5 === 0 || (!resolved && d.m.length === 0)) trace.push(s + 's guard=' + d.g + ' own=' + (d.o || '-') + ' march=[' + d.m.join(' ') + '] near=' + d.near);
      if (!resolved && d.m.length === 0) resolved = 'march 在 ' + s + 's 前消失（此时 guard=' + d.g + ' own=' + (d.o || '无') + '）';
      if (d.o === 'p1') break;
    }

    const after = await page.evaluate(() => ({
      owner: Game.state.resourceOwner[Game.tileKeyOf(5, 5)] || '(无)',
      guard: Game.state.resGuard[Game.tileKeyOf(5, 5)],
      t: Math.round(Game.state.t), p1: Game.totalTroops('p1'), p2: Game.totalTroops('p2'),
    }));
    const ok = after.owner === 'p1';
    summary.push(ok);
    console.log((ok ? '✓' : '✗') + ' 第' + round + '轮  发兵=' + JSON.stringify(sent) + ' 路径' + before.pathLegs + '格'
      + ' | 出发前: 粮=' + before.food + ' 兵=' + before.onBarracks + ' 守军=' + before.guard + ' 敌兵=' + before.enemyTroops + ' 事件=' + (before.evCur || '无')
      + ' | 结果: own=' + after.owner + ' guard=' + after.guard + ' 终局我兵=' + after.p1);
    if (!ok) {
      console.log('   死因线索: ' + (resolved || 'march 未消失但也没占领'));
      trace.slice(0, 12).forEach(l => console.log('   ' + l));
    }
    if (errs.length) console.log('   ⚠ 控制台错误: ' + errs.join(' | '));
    await page.close();
  }

  const fail = summary.filter(x => !x).length;
  console.log('\n===== 合计 ' + N + ' 轮：成功 ' + (N - fail) + ' / 失败 ' + fail + ' =====');
  await browser.close();
})();
