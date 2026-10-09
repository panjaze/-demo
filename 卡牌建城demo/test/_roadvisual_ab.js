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
  // A：不铺路，同机位截图
  const clip = { x: 587, y: 147, width: 220, height: 260 };
  await page.screenshot({ path: OUTDIR + '_实机_AB_无路.png', clip });
  // B：铺支路后同机位截图
  await page.evaluate(() => {
    [[11, 8], [11, 9], [11, 10], [11, 11]].forEach(([gx, gy]) => Game.placeRoad(gx, gy));
    UI.render();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUTDIR + '_实机_AB_有路.png', clip });
  console.log('done');
  await browser.close();
})();
