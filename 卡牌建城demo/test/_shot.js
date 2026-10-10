/* 界面截图：政策三选一 / 遗物三选一 / 事件牌 / 主界面 / 抽卡 */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/test/';
const TAG = process.argv[2] || 'shot';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (window.Tutorial && Tutorial.hide) Tutorial.hide();
    UI.setModal(null);
    if (Game.state.policy && Game.state.policy.p1) Game.state.policy.p1.offer = null;
    document.getElementById('menu').classList.add('hidden');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + TAG + '_main.png' });

  await page.evaluate(() => {
    Game.state.castle.level = 4;
    Game.state.policy.p1.offer = [{ key: 'till', tier: 2 }, { key: 'siege', tier: 1 }, { key: 'pioneer', tier: 0 }];
    UI.setModal('policy');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: DIR + TAG + '_policy.png' });
  console.log('policy cards: ' + JSON.stringify(await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#policy-cards .card').forEach(function (c) {
      const r = c.getBoundingClientRect();
      out.push({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    const body = document.querySelector('.modal-body');
    const hint = document.getElementById('policy-hint');
    out.push({
      bodyClient: body.clientHeight, bodyScroll: body.scrollHeight,
      hintBottom: hint ? Math.round(hint.getBoundingClientRect().bottom) : null,
      bodyTop: Math.round(body.getBoundingClientRect().top),
      bodyBottom: Math.round(body.getBoundingClientRect().bottom),
    });
    return out;
  })));

  await page.evaluate(() => { UI.setModal('reward'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + TAG + '_reward.png' });

  await page.evaluate(() => { Game.state.events.p1.offer = 'locust'; UI.setModal('event'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + TAG + '_event.png' });

  await page.evaluate(() => { UI.setModal('shop'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + TAG + '_shop.png' });

  await browser.close();
  console.log('shots -> ' + DIR + TAG + '_*.png');
})().catch(e => { console.error(e.message); process.exit(1); });
