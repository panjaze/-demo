/* 从顶栏圆槽裁出方形宝石底座（品质徽章底） */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
/* source 178x250，圆环中心约 (89,137)，半径约 78 → 取 156x156 方裁 */
const BOX = { cx: 0.5, cy: 0.548, r: 0.44 };
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const url = await page.evaluate(async (BOX) => {
    const im = new Image(); im.src = 'assets/ui/topbar/slot-circle.png'; await im.decode();
    const r = BOX.r * im.width;
    const cx = BOX.cx * im.width, cy = BOX.cy * im.height;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    g.drawImage(im, cx - r, cy - r, r * 2, r * 2, 0, 0, 256, 256);
    return cv.toDataURL('image/png');
  }, BOX);
  fs.writeFileSync(DIR + 'assets/ui/icons/gem-socket.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('ok gem-socket.png');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
