const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const URL = 'http://127.0.0.1:8931/图片素材/美术风格测试/road-preview.html?v=' + Date.now();
const OUT = 'D:/工程/自研/图片素材/美术风格测试/';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-proxy-server', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage({ viewport: { width: 2420, height: 1080 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const note = await page.textContent('#note');
  console.log('note:', (note || '').slice(0, 60));
  console.log('errors:', errs.length ? errs : 'none');
  await page.screenshot({ path: OUT + '铺路表现对比-2026-10-01.png', fullPage: true });
  await browser.close();
})();
