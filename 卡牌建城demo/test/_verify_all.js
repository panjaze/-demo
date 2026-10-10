/* 综合验证截图：主界面 / 各类弹窗 / 手机横屏 */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/test/';
const TAG = process.argv[2] || 'v';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    if (window.Tutorial && Tutorial.hide) Tutorial.hide();
    UI.setModal(null);
    document.getElementById('menu').classList.add('hidden');
    Game.state.res.energy = 128; Game.state.res.food = 76; Game.state.soldiers = 12;
    Game.state.relics = ['blueprint', 'armory'];
    Game.state.policy.p1.slots = [{ key: 'till', tier: 2 }, { key: 'siege', tier: 0 }];
    UI.render();
  });
  await page.waitForTimeout(400);
  const shots = async (name) => { await page.screenshot({ path: DIR + TAG + '_' + name + '.png' }); };

  await shots('main');

  await page.evaluate(() => {
    Game.state.policy.p1.offer = [{ key: 'till', tier: 2 }, { key: 'siege', tier: 1 }, { key: 'pioneer', tier: 0 }];
    UI.setModal('policy');
  });
  await page.waitForTimeout(350); await shots('policy');

  await page.evaluate(() => {
    Game.state.policy.p1.offer = null;
    UI.setModal('policyview');
  });
  await page.waitForTimeout(350); await shots('policyview');

  await page.evaluate(() => { UI.setModal('reward'); });
  await page.waitForTimeout(350); await shots('reward');

  await page.evaluate(() => { Game.state.events.p1.offer = 'locust'; UI.setModal('event'); });
  await page.waitForTimeout(350); await shots('event');

  await page.evaluate(() => { Game.state.events.p1.offer = null; Game.state.events.p1.current = 'tradeRoute'; UI.setModal('eventview'); });
  await page.waitForTimeout(350); await shots('eventview');

  await page.evaluate(() => { UI.setModal('quest'); });
  await page.waitForTimeout(350); await shots('quest');

  await page.evaluate(() => { UI.setModal('shop'); });
  await page.waitForTimeout(350); await shots('shop');

  await page.evaluate(() => { UI.setModal('pool'); });
  await page.waitForTimeout(350); await shots('pool');

  await page.evaluate(() => { UI.setModal(null); document.getElementById('menu').classList.remove('hidden'); });
  await page.waitForTimeout(500); await shots('menu');

  // 手机横屏
  const m = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const merrs = [];
  m.on('pageerror', e => merrs.push(e.message));
  await m.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
  await m.waitForTimeout(1800);
  await m.evaluate(() => { if (window.Tutorial && Tutorial.hide) Tutorial.hide(); UI.setModal(null); document.getElementById('menu').classList.add('hidden'); });
  await m.waitForTimeout(400);
  await m.screenshot({ path: DIR + TAG + '_mobile.png' });
  await m.evaluate(() => { Game.state.policy.p1.offer = [{ key: 'till', tier: 2 }, { key: 'siege', tier: 1 }, { key: 'pioneer', tier: 0 }]; UI.setModal('policy'); });
  await m.waitForTimeout(400);
  await m.screenshot({ path: DIR + TAG + '_mobile_modal.png' });

  console.log('desktop 错误:', errs.length ? errs : '无');
  console.log('mobile 错误:', merrs.length ? merrs : '无');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
