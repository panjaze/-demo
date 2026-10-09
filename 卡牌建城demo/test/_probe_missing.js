/* 探：为什么 13,8 / 14,8 / 15,8 贴了官道素材却几乎没变化 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
    Sandbox.scale = 1; Sandbox.centerOn(9, 8); Sandbox.render();
  });

  const out = await page.evaluate(() => {
    // 1) 素材每格的不透明像素覆盖率 + 包围盒 + 平均色
    const rec = Sandbox.reclaimImg;
    const st = rec.width / CFG.map.cols;
    const oc = document.createElement('canvas');
    oc.width = rec.width; oc.height = rec.height;
    const octx = oc.getContext('2d');
    octx.drawImage(rec, 0, 0);
    function tileStat(gx, gy) {
      const d = octx.getImageData(gx * st, gy * st, st, st).data;
      let n = 0, r = 0, g = 0, b = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
      for (let y = 0; y < st; y++) for (let x = 0; x < st; x++) {
        const i = (y * st + x) * 4;
        if (d[i + 3] > 40) {
          n++; r += d[i]; g += d[i + 1]; b += d[i + 2];
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
      const tot = st * st;
      return {
        cov: +(n / tot * 100).toFixed(1),
        rgb: n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null,
        bbox: n ? [minx, miny, maxx, maxy] : null,
        covCenter: (function () {
          let c = 0, t = 0;
          for (let y = st * 0.35; y < st * 0.65; y++) for (let x = st * 0.35; x < st * 0.65; x++) {
            const i = ((y | 0) * st + (x | 0)) * 4; t++; if (d[i + 3] > 40) c++;
          }
          return +(c / t * 100).toFixed(1);
        })(),
      };
    }
    const stats = {};
    [[3, 9], [3, 8], [11, 8], [12, 8], [13, 8], [14, 8], [15, 8]].forEach(([gx, gy]) => {
      stats[gx + ',' + gy] = tileStat(gx, gy);
    });

    // 2) 画布可视范围 & 这些格是否在屏内
    const vis = [];
    [[13, 8], [14, 8], [15, 8], [3, 9]].forEach(([gx, gy]) => {
      const r = Sandbox.tileRect(gx, gy);
      vis.push({ cell: gx + ',' + gy, x: Math.round(r.x), y: Math.round(r.y), inside: r.x >= 0 && r.y >= 0 && r.x + r.w <= Sandbox.cw && r.y + r.h <= Sandbox.ch });
    });
    return { stats, vis, cw: Sandbox.cw, ch: Sandbox.ch, camX: Math.round(Sandbox.camX), camY: Math.round(Sandbox.camY), st };
  });
  console.log(JSON.stringify(out, null, 2));

  // 3) 铺路后逐格打网格采样
  await page.evaluate(() => {
    [[3, 10], [3, 9], [3, 8], [3, 7], [3, 6], [11, 8], [13, 8], [14, 8], [15, 8]].forEach(([gx, gy]) => {
      if (!Game.isRoadAt(gx, gy)) Game.placeRoad(gx, gy);
    });
    Sandbox.render();
  });
  await page.waitForTimeout(300);
  const grid = await page.evaluate(() => {
    function gridof(gx, gy) {
      const r = Sandbox.tileRect(gx, gy), T = CFG.map.tile * Sandbox.scale;
      const rows = [];
      for (let j = 0; j < 5; j++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          const x = r.x + (i + 0.5) / 5 * T, y = r.y + (j + 0.5) / 5 * T;
          const d = Sandbox.ctx.getImageData(Math.round(x * Sandbox.dpr), Math.round(y * Sandbox.dpr), 1, 1).data;
          line.push(d[0] + ',' + d[1] + ',' + d[2]);
        }
        rows.push(line.join(' | '));
      }
      return rows;
    }
    const o = {};
    [[11, 8], [13, 8], [14, 8], [15, 8]].forEach(([gx, gy]) => { o[gx + ',' + gy] = gridof(gx, gy); });
    o.inRoads = Object.keys(Game.state.roads).filter(k => k.indexOf(',8') > 0);
    return o;
  });
  for (const k in grid) {
    console.log('\n=== ' + k + ' ===');
    if (Array.isArray(grid[k])) grid[k].forEach(l => console.log('  ' + l));
    else console.log('  ' + JSON.stringify(grid[k]));
  }
  await browser.close();
})();
