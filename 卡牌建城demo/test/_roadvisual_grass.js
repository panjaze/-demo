const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const OUTDIR = 'D:/工程/自研/图片素材/美术风格测试/';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null); UI.render();
  });
  const r = await page.evaluate(() => {
    // x=3 纵线先接通，再向东走干净草地：官道(5,9)(7,9) 与非官道(4,9)(6,9) 交替
    const P = [[3, 10], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [3, 8]];
    let ok = 0; const fail = [];
    P.forEach(([gx, gy]) => { if (Game.placeRoad(gx, gy)) ok++; else fail.push(gx + ',' + gy); });
    UI.render();
    const cv = document.getElementById('sandbox');
    const rc = cv.getBoundingClientRect();
    const k = rc.width / cv.offsetWidth;
    const t = Sandbox.tileRect(5, 9);
    return { ok, fail, cx: rc.left + (t.x + t.w / 2) * k, cy: rc.top + (t.y + t.h / 2) * k };
  });
  console.log(JSON.stringify(r));
  await page.waitForTimeout(400);
  const w = 340, h = 220;
  await page.screenshot({ path: OUTDIR + '_实机_草地路线.png',
    clip: { x: r.cx - w / 2, y: r.cy - h / 2, width: w, height: h } });
  console.log('done');
  await browser.close();
})();
