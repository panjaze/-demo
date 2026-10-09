/* 给用户的交付图：同一相机、同一区域的「铺路前 / 铺路后」对照 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const OUTDIR = 'D:/工程/自研/图片素材/美术风格测试/';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
    Sandbox.scale = 1.6; Sandbox.centerOn(9, 8); Sandbox.render(); UI.render();
  });
  await page.waitForTimeout(300);
  const cv = await page.$('#sandbox');
  await cv.screenshot({ path: OUTDIR + '_对比_铺路前.png' });

  const placed = await page.evaluate(() => {
    const P = [[3, 10], [3, 9], [3, 8], [3, 7], [3, 6],
      [11, 8], [13, 8], [14, 8], [15, 8], [15, 7], [15, 6]];
    let ok = 0, already = 0; const fail = [];
    P.forEach(([gx, gy]) => {
      if (Game.isRoadAt(gx, gy)) { already++; return; }
      if (Game.placeRoad(gx, gy)) ok++; else fail.push(gx + ',' + gy);
    });
    Sandbox.render(); UI.render();
    return { ok, already, fail };
  });
  await page.waitForTimeout(400);
  await cv.screenshot({ path: OUTDIR + '_对比_铺路后.png' });
  console.log('铺路:', JSON.stringify(placed), ' errors:', errs.length ? errs : 'none');
  await browser.close();
})();
