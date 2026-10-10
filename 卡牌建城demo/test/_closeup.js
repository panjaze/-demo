/* 局部放大截图：顶栏 / 单张手牌 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/test/';
const TAG = process.argv[2] || 'close';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
  await page.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (window.Tutorial && Tutorial.hide) Tutorial.hide();
    UI.setModal(null);
    document.getElementById('menu').classList.add('hidden');
    Game.state.res.energy = 128; Game.state.res.food = 76;
    Game.state.soldiers = 12;
  });
  await page.waitForTimeout(400);
  const top = await page.$('#topbar');
  await top.screenshot({ path: DIR + TAG + '_topbar.png' });

  const report = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#topbar .tb-res, #topbar .tb-clock').forEach(function (el) {
      const r = el.getBoundingClientRect();
      out.push({ cls: el.className, x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), txt: el.textContent.trim().replace(/\s+/g, ' ') });
    });
    const tb = document.getElementById('topbar').getBoundingClientRect();
    out.push({ topbar: [Math.round(tb.x), Math.round(tb.width), Math.round(tb.height)] });
    const c = document.querySelector('#hand-slots .card');
    if (c) { const r = c.getBoundingClientRect(); out.push({ card: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }); }
    return out;
  });
  console.log(JSON.stringify(report));

  const card = await page.$('#hand-slots .card');
  if (card) await card.screenshot({ path: DIR + TAG + '_card.png' });
  const slots = await page.$('#hand-slots');
  if (slots) await slots.screenshot({ path: DIR + TAG + '_hand.png' });
  const corner = await page.$('#corner-ui');
  if (corner) await corner.screenshot({ path: DIR + TAG + '_corner.png' });
  await browser.close();
  console.log('shots -> ' + TAG);
})().catch(e => { console.error(e.message); process.exit(1); });
