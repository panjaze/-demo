const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:8124/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const out = await page.evaluate(() => {
    const RB = CFG.mapVisual.road.ribbon;
    const T = 60;
    const c = document.createElement('canvas'); c.width = 200; c.height = 60;
    const x = c.getContext('2d');
    x.fillStyle = '#87a457'; x.fillRect(0, 0, 200, 60);
    x.lineCap = 'round';
    function pass(L, w) {
      x.globalCompositeOperation = L.mode; x.globalAlpha = L.alpha;
      x.strokeStyle = L.color; x.lineWidth = T * w;
      x.beginPath(); x.moveTo(20, 30); x.lineTo(180, 30); x.stroke();
    }
    pass(RB.edge, RB.edgeWidth); pass(RB.body, RB.width); pass(RB.lift, RB.liftWidth); pass(RB.core, RB.coreWidth);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    const d = x.getImageData(100, 0, 1, 60).data;
    let lo = -1, hi = -1;
    for (let i = 0; i < 60; i++) {
      const diff = Math.abs(d[i * 4] - 135) + Math.abs(d[i * 4 + 1] - 164) + Math.abs(d[i * 4 + 2] - 87);
      if (diff > 25) { if (lo < 0) lo = i; hi = i; }
    }
    return {
      params: RB,
      measuredWidthPx: hi - lo + 1,
      centerColor: d[30 * 4] + ',' + d[30 * 4 + 1] + ',' + d[30 * 4 + 2],
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
