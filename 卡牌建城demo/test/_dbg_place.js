/* 调试：定位「点可建格建造」失败原因（严格复刻 handplace-check 流程） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    if (window.Menu) Menu.start(true);
    if (window.Tutorial) Tutorial.choose(false);
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null); UI.render();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { Game.state.hand[1] = { key: 'farm' }; UI.render(); });
  const pos = await page.evaluate(() => {
    const el = document.querySelector('[data-hand="1"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(pos.x, pos.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(320);
  console.log('placeMode =', await page.evaluate(() => UI.placeMode && UI.placeMode.key));
  const info = await page.evaluate(() => {
    const cv = document.getElementById('sandbox'), r = cv.getBoundingClientRect();
    const out = {
      canvas: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cw: [cv.width, cv.height], off: [cv.offsetWidth, cv.offsetHeight],
      cam: [Math.round(Sandbox.camX), Math.round(Sandbox.camY)],
    };
    const list = [];
    for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (!Game.canBuildAt('farm', gx, gy)) continue;
      const t = Sandbox.tileRect(gx, gy);
      const k = r.width / cv.offsetWidth;
      const x = r.left + (t.x + t.w / 2) * k, y = r.top + (t.y + t.h / 2) * k;
      list.push({ gx, gy, tx: Math.round(t.x), ty: Math.round(t.y), x: Math.round(x), y: Math.round(y), inside: (x > r.left + 12 && y > r.top + 12 && x < r.right - 12 && y < r.bottom - 12) });
    }
    out.candidates = list.length;
    out.first = list.find(v => v.inside) || null;
    out.sample = list.slice(0, 3);
    return out;
  });
  console.log(JSON.stringify(info));
  if (info.first) {
    console.log('命中元素:', await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : 'null'; }, info.first));
    const before = await page.evaluate(() => Object.keys(Game.state.buildings).length);
    await page.mouse.move(info.first.x, info.first.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => Object.keys(Game.state.buildings).length);
    console.log('buildings', before, '->', after, ' hint=', await page.evaluate(() => document.getElementById('hint').textContent));
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
