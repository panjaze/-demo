/* 铺路视觉实机验证 v2（第三十八次修订：开垦官道）
 * 2x DPR + 用 tileRect 精确换算格子屏幕坐标，逐区域裁剪放大，判定渲染质量
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const URL = 'http://127.0.0.1:8124/index.html';
const OUTDIR = 'D:/工程/自研/图片素材/美术风格测试/';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null); UI.render();
  });

  const info = await page.evaluate(() => ({
    reclaim: !!Sandbox.reclaimImg,
    scale: Sandbox.scale, camX: Math.round(Sandbox.camX), camY: Math.round(Sandbox.camY),
  }));
  console.log('环境:', JSON.stringify(info));

  // 铺混合路线
  const placed = await page.evaluate(() => {
    const P = [[3, 11], [3, 10], [3, 9], [3, 8], [3, 7], [3, 6],
      [8, 8], [9, 8], [10, 8], [11, 8], [13, 8], [14, 8], [15, 8],
      [11, 9], [11, 10], [11, 11], [20, 7], [21, 7], [22, 7], [22, 8], [22, 9]];
    let ok = 0; const fail = [];
    P.forEach(([gx, gy]) => { if (Game.placeRoad(gx, gy)) ok++; else fail.push(gx + ',' + gy); });
    UI.render();
    return { ok, fail };
  });
  console.log('铺路:', JSON.stringify(placed));
  await page.waitForTimeout(500);

  // 屏幕坐标换算（与 fulltest 相同的换算），并导出整图 + 指定区域裁剪
  const pts = await page.evaluate(() => {
    const cv = document.getElementById('sandbox');
    const r = cv.getBoundingClientRect();
    const k = r.width / cv.offsetWidth;
    const P = (gx, gy) => {
      const t = Sandbox.tileRect(gx, gy);
      return { x: r.left + (t.x + t.w / 2) * k, y: r.top + (t.y + t.h / 2) * k };
    };
    return {
      bridge: P(12, 8), offV: P(3, 8), offE1: P(14, 8), offE2: P(15, 8),
      branch: P(11, 10), branch2: P(11, 11), east: P(22, 8),
      junction: P(11, 9), plain: P(6, 12),
    };
  });
  console.log('关键点屏幕坐标:', JSON.stringify(pts));
  await page.screenshot({ path: OUTDIR + '实机铺路验证-2026-10-01.png' });

  // 用 CSS 像素坐标裁剪（playwright clip 用 CSS 像素，自动乘 dpr）
  async function crop(name, cx, cy, w, h, zoom) {
    const clip = { x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), width: w, height: h };
    const buf = await page.screenshot({ clip });
    const sharp = null; // 不引入 sharp，用 Python 后处理放大
    require('fs').writeFileSync(OUTDIR + '_实机_' + name + '.png', buf);
    console.log('crop', name, JSON.stringify(clip));
  }
  await crop('官道横线', (pts.bridge.x + pts.junction.x) / 2, pts.bridge.y, 340, 200);
  await crop('离官道支路', pts.branch.x, (pts.branch.y + pts.branch2.y) / 2, 220, 260);
  await crop('官道纵线', pts.offV.x, pts.offV.y, 220, 260);
  await crop('东侧官道', pts.offE1.x, pts.offE1.y, 260, 200);
  console.log('errors:', errs.length ? errs : 'none');
  await browser.close();
})();
