/* 卡背处理：右下角水印用「镜像左下角」补掉 → 640 宽 JPEG
 * 用法：node test/_fix_cardback.js <src> <outName> */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const SRC = process.argv[2];
const NAME = process.argv[3] || 'back-v5.jpg';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const out = await page.evaluate(async ({ SRC }) => {
    const im = new Image(); im.src = SRC; await im.decode();
    const OUT_W = 640;
    const W = OUT_W, H = Math.round(OUT_W * im.height / im.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.drawImage(im, 0, 0, W, H);
    const pw = Math.round(W * 0.16), ph = Math.round(H * 0.075);
    const tmp = document.createElement('canvas'); tmp.width = pw; tmp.height = ph;
    const tg = tmp.getContext('2d');
    tg.translate(pw, 0); tg.scale(-1, 1);
    tg.drawImage(cv, 0, H - ph, pw, ph, 0, 0, pw, ph);
    g.drawImage(tmp, W - pw, H - ph);
    return cv.toDataURL('image/jpeg', 0.88);
  }, { SRC });
  fs.writeFileSync(DIR + 'assets/ui/cards/' + NAME, Buffer.from(out.split(',')[1], 'base64'));
  console.log('ok ->', NAME);
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
