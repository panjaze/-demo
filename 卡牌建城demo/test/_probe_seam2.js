/* _probe_seam2.js —— 完全复刻 _roadvisual_verify 的铺路顺序，逐 seam 点 dump 前后色 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const ALL = [[3,10],[3,9],[3,8],[3,7],[3,6],[11,8],[12,8],[13,8],[14,8],[15,8],[15,7],[15,6]];
const SEAMS = [
  ['14,8↔15,8 缝', 15.0, 8.5], ['11,8↔12,8 缝', 12.0, 8.5],
  ['15,8↔15,7 缝', 15.5, 8.0], ['15,7↔15,6 缝', 15.5, 7.0],
  ['3,10↔3,9 缝', 3.5, 9.5],   ['3,6 路心', 3.5, 6.5], ['15,6 路心', 15.5, 6.5],
];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
    Game.state.res.energy = 500;            // 主跑没加能量？先补足以排除能量变量
    Sandbox.scale = 1; Sandbox.centerOn(9, 8); Sandbox.render(); UI.render();
    window.__px = function (wx, wy) {
      const T = CFG.map.tile * Sandbox.scale;
      const d = Sandbox.ctx.getImageData(Math.round((Sandbox.offX + wx * T) * Sandbox.dpr),
                                         Math.round((Sandbox.offY + wy * T) * Sandbox.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
  });
  const dist = (a, b) => Math.round(Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2));
  const before = await page.evaluate((p) => p.map(x => window.__px(x[1], x[2])), SEAMS);
  const placed = await page.evaluate((ALL) => {
    const r = { ok: 0, already: 0, fail: [] };
    ALL.forEach(([gx, gy]) => {
      if (Game.isRoadAt(gx, gy)) { r.already++; return; }
      if (Game.placeRoad(gx, gy)) r.ok++; else r.fail.push(gx + ',' + gy);
    });
    Sandbox.render(); UI.render();
    return r;
  }, ALL);
  await page.waitForTimeout(300);
  const after = await page.evaluate((p) => p.map(x => window.__px(x[1], x[2])), SEAMS);
  console.log('铺路:', JSON.stringify(placed));
  SEAMS.forEach((s, i) => console.log(s[0] + '  前=' + before[i].join(',') + '  后=' + after[i].join(',') + '  Δ=' + dist(before[i], after[i])));
  await browser.close();
})();
