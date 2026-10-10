/* 真实渲染下的局部裁剪放大（clip 截图，2x） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/test/';
const TAG = process.argv[2] || 'zoom';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (window.Tutorial && Tutorial.hide) Tutorial.hide();
    UI.setModal(null);
    document.getElementById('menu').classList.add('hidden');
    Game.state.res.energy = 128; Game.state.res.food = 76; Game.state.soldiers = 12;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + TAG + '_topbar.png', clip: { x: 0, y: 0, width: 1280, height: 60 } });
  await page.screenshot({ path: DIR + TAG + '_corner.png', clip: { x: 980, y: 520, width: 300, height: 200 } });
  await page.screenshot({ path: DIR + TAG + '_hand.png', clip: { x: 380, y: 380, width: 520, height: 340 } });
  await browser.close();
  console.log('zoom shots -> ' + TAG);
})().catch(e => { console.error(e.message); process.exit(1); });
