/* 插画缩略图拼板：校验生成结果 */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const LIST = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const url = await page.evaluate(async (LIST) => {
    const CW = 300, CH = 200;
    const cv = document.createElement('canvas');
    cv.width = CW * 3; cv.height = CH * Math.ceil(LIST.length / 3);
    const g = cv.getContext('2d');
    g.fillStyle = '#222'; g.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < LIST.length; i++) {
      const im = new Image(); im.src = 'assets/ui/art/' + LIST[i] + '.png';
      await im.decode();
      const s = Math.max(CW / im.width, CH / im.height);
      const w = im.width * s, h = im.height * s;
      const x = (i % 3) * CW, y = Math.floor(i / 3) * CH;
      g.save(); g.beginPath(); g.rect(x, y, CW, CH); g.clip();
      g.drawImage(im, x + (CW - w) / 2, y + (CH - h) / 2, w, h);
      g.restore();
      g.fillStyle = '#fff'; g.font = '16px sans-serif';
      g.fillText(LIST[i], x + 6, y + 20);
    }
    return cv.toDataURL('image/png');
  }, LIST);
  fs.writeFileSync(DIR + 'test/_sheet.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('ok ' + DIR + 'test/_sheet.png');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
