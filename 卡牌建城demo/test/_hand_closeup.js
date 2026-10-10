/* 手牌区特写截图（验收卡牌美术用）：2x 缩放 + 裁切手牌栏 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    if (window.Menu) Menu.start(true);
    if (window.Tutorial) Tutorial.choose(false);   // 新局会弹选择界面，选"跳过"
    /* start(true) 会 reset —— 手牌要在 reset 之后塞 */
    Game.state.hand = [{ key: 'farm' }, { key: 'barracks' }, { key: 'dirt' }, { key: 'harvest' }, null];
    Game.state.res.energy = 60;
    if (window.UI) UI.render();
  });
  await page.waitForTimeout(800);
  /* 诊断：父链 computed + 注入一张裸框图层做亮度对照 */
  const diag = await page.evaluate(() => {
    let el = document.querySelector('#hand-slots .card'), out = [];
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.filter !== 'none' || parseFloat(cs.opacity) < 1 || cs.mixBlendMode !== 'normal')
        out.push(el.id || el.className + ' → filter:' + cs.filter + ' opacity:' + cs.opacity + ' blend:' + cs.mixBlendMode);
      el = el.parentElement;
    }
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:140px;z-index:99999;' +
      "background:#f2e8d0 url('assets/ui/card-frame.png') center/100% 100% no-repeat;";
    document.body.appendChild(probe);
    return out;
  });
  console.log('父链压暗源:', JSON.stringify(diag));
  const r = await page.evaluate(() => {
    const b = document.querySelector('#hand-slots .card').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await page.screenshot({ path: 'test/_art_card_one.png',
    clip: { x: r.x - 4, y: r.y - 4, width: r.w + 8, height: r.h + 8 } });
  await page.screenshot({ path: 'test/_art_probe_bare.png', clip: { x: 0, y: 0, width: 200, height: 140 } });
  await page.screenshot({ path: 'test/_art_hand_closeup.png', clip: { x: 0, y: 580, width: 1280, height: 140 } });
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e.message); process.exit(1); });
