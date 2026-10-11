/* _probe_seam.js —— 定位 _roadvisual_verify 两项 seam 失败的根因
 * 候选解释：
 *  A. 官道 preset 相邻格之间的缝（14,8↔15,8）铺路前已是路 → Δ≈0 假失败
 *  B. 官道 preset（15,8）与新铺带状路（15,7）交界真断点
 *  C. 新铺带状路之间的缝（15,6↔15,7）真断点
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
    Sandbox.scale = 1; Sandbox.centerOn(9, 8); Sandbox.render(); UI.render();
    window.__px = function (wx, wy) {   // 世界坐标（格单位，如 15.0,8.5）
      const T = CFG.map.tile * Sandbox.scale;
      const d = Sandbox.ctx.getImageData(Math.round((Sandbox.offX + wx * T) * Sandbox.dpr),
                                         Math.round((Sandbox.offY + wy * T) * Sandbox.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
  });
  const dist = (a, b) => Math.round(Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2));
  const pts = [
    ['14,8↔15,8 缝(15.0,8.5)', 15.0, 8.5],
    ['15,8↔15,7 缝(15.5,8.0)', 15.5, 8.0],
    ['15,7↔15,6 缝(15.5,7.0)', 15.5, 7.0],
    ['15,8 路心(15.5,8.5)',    15.5, 8.5],
    ['14,8 路心(14.5,8.5)',    14.5, 8.5],
    ['15,7 路心(15.5,7.5)',    15.5, 7.5],
  ];
  const before = await page.evaluate((pts) => pts.map(p => window.__px(p[1], p[2])), pts);
  const st0 = await page.evaluate(() => ({
    r14: !!Game.state.roads['14,8'], r15x8: !!Game.state.roads['15,8'], r15x7: !!Game.state.roads['15,7'],
    off14: Game.isOfficialRoad(14, 8), off15x8: Game.isOfficialRoad(15, 8), off15x7: Game.isOfficialRoad(15, 7),
    rec15x8: !!(Sandbox.reclaimCells && Sandbox.reclaimCells['15,8']),
  }));
  await page.evaluate(() => {
    [[15, 7], [15, 6]].forEach(([gx, gy]) => { if (!Game.isRoadAt(gx, gy)) Game.placeRoad(gx, gy); });
    Sandbox.render(); UI.render();
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate((pts) => pts.map(p => window.__px(p[1], p[2])), pts);
  const st1 = await page.evaluate(() => ({
    r15x7: !!Game.state.roads['15,7'], r15x6: !!Game.state.roads['15,6'],
  }));
  console.log('铺路前状态:', JSON.stringify(st0));
  console.log('铺路后状态:', JSON.stringify(st1));
  pts.forEach((p, i) => {
    console.log(p[0] + '  前=' + before[i].join(',') + '  后=' + after[i].join(',') + '  Δ=' + dist(before[i], after[i]));
  });
  await browser.close();
})();
