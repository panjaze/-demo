const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    const info = {
      reclaimLoaded: !!Sandbox.reclaimImg,
      reclaimCellsType: typeof Sandbox.reclaimCells,
      reclaimCellCount: Sandbox.reclaimCells ? Object.keys(Sandbox.reclaimCells).length : -1,
      has51: !!(Sandbox.reclaimCells && Sandbox.reclaimCells['5,9']),
      has38: !!(Sandbox.reclaimCells && Sandbox.reclaimCells['3,8']),
    };
    // 手动铺路 + 单独调 drawRoads 抓异常
    [[3, 10], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [3, 8]].forEach(([gx, gy]) => Game.placeRoad(gx, gy));
    try {
      const cv = document.createElement('canvas'); cv.width = 1740; cv.height = 900;
      const cx = cv.getContext('2d');
      Sandbox.drawRoads.call(Sandbox, cx, 60);
      info.drawOK = true;
    } catch (e) { info.drawOK = false; info.drawErr = e.message; }
    return info;
  });
  console.log(JSON.stringify(out, null, 1));
  console.log('errs:', errs.length ? errs : 'none');
  await browser.close();
})();
