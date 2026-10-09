/* 诊断：① 路面观感（像素对比度）② 手牌「点击 → 放置」是否卡死
 * 只读诊断，不改任何文件
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // 关闭开局弹窗
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
    UI.render();
  });

  // ---------- ① 手牌点击流程 ----------
  const s0 = await page.evaluate(() => ({
    hand: Game.state.hand.map(h => h && h.key),
    handLen: Game.state.hand.length,
    energy: Game.state.res.energy,
    placeMode: UI.placeMode, roadPlacing: UI.roadPlacing,
    cardInfoFarm: Game.cardInfo('farm'),
  }));
  console.log('【开局状态】', JSON.stringify(s0));

  // 直接塞一张建筑卡进手牌（绕开商店，专注测点击放置）
  const injected = await page.evaluate(() => {
    const idx = Game.state.hand.indexOf(null);
    if (idx < 0) return { err: 'no-empty-slot' };
    Game.state.hand[idx] = { key: 'farm' };
    UI.render();
    return { key: 'farm', idx };
  });
  console.log('【注入手牌】', JSON.stringify(injected));
  await page.waitForTimeout(300);

  // 真实点击手牌卡片（按下与松开在同一点）
  const clicked = await page.evaluate((idx) => {
    const el = document.querySelector('[data-hand="' + idx + '"]');
    if (!el) return 'no-dom';
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, text: el.textContent.slice(0, 40) };
  }, injected.idx);
  console.log('【卡片 DOM】', JSON.stringify(clicked));

  if (clicked && clicked.x) {
    await page.mouse.move(clicked.x, clicked.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  const afterClick = await page.evaluate(() => ({
    placeMode: UI.placeMode, roadPlacing: UI.roadPlacing,
    hint: (document.getElementById('hint') || {}).textContent,
  }));
  console.log('【点击手牌后】', JSON.stringify(afterClick));

  // 若进入放置模式，找一个可建格并点它
  if (afterClick.placeMode) {
    const spot = await page.evaluate(() => {
      const key = UI.placeMode.key;
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          if (Game.canBuildAt(key, gx, gy)) {
            const t = Sandbox.tileRect(gx, gy);
            const cv = document.getElementById('sandbox');
            const r = cv.getBoundingClientRect();
            const k = r.width / cv.offsetWidth;
            return { gx, gy, x: r.left + (t.x + t.w / 2) * k, y: r.top + (t.y + t.h / 2) * k };
          }
        }
      }
      return null;
    });
    console.log('【可建格】', JSON.stringify(spot));
    if (spot) {
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => ({
        placeMode: UI.placeMode,
        buildings: Object.keys(Game.state.buildings).length,
        hint: (document.getElementById('hint') || {}).textContent,
        hand: Game.state.hand.map(h => h && h.key),
      }));
      console.log('【点击地图后】', JSON.stringify(res));
    }
  }

  // ---------- ② 路面观感测量 ----------
  const road = await page.evaluate(() => {
    Sandbox.scale = 1; Sandbox.centerOn(9, 8); Sandbox.render();
    const T = CFG.map.tile * Sandbox.scale;
    const samp = (gx, gy, ox, oy) => {
      const r = Sandbox.tileRect(gx, gy);
      const x = r.x + (0.5 + ox) * T, y = r.y + (0.5 + oy) * T;
      const d = Sandbox.ctx.getImageData(Math.round(x * Sandbox.dpr), Math.round(y * Sandbox.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const route = [[3, 10], [3, 9], [3, 8], [3, 7], [3, 6], [11, 8], [13, 8], [14, 8], [15, 8], [15, 7], [15, 6]];
    const before = route.map(c => samp(c[0], c[1], 0, 0));
    route.forEach(c => { if (!Game.isRoadAt(c[0], c[1])) Game.placeRoad(c[0], c[1]); });
    Sandbox.render();
    const after = route.map(c => samp(c[0], c[1], 0, 0));
    const d = (a, b) => Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));
    return route.map((c, i) => ({ cell: c.join(','), before: before[i].join(','), after: after[i].join(','), delta: d(before[i], after[i]) }));
  });
  console.log('【路面路心色差】');
  road.forEach(r => console.log('   ' + r.cell + '  Δ=' + String(r.delta).padStart(3) + '   ' + r.before + ' -> ' + r.after));
  const ds = road.map(r => r.delta).sort((a, b) => a - b);
  console.log('   最小 ' + ds[0] + '  中位 ' + ds[Math.floor(ds.length / 2)] + '  最大 ' + ds[ds.length - 1]);

  console.log('【控制台错误】', errs.length ? errs : 'none');
  await browser.close();
})();
