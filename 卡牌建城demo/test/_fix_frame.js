/* 修卡框母版：① 裁掉四周白边/杂边 ② 右下角水印用「镜像左下角」补掉
 * 用法：node test/_fix_frame.js  →  assets/ui/card-frame-clean.png */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const INSET = 7;                       // 四边各裁 7px（实测白边 6~11px）
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const out = await page.evaluate(async (INSET) => {
    const im = new Image(); im.src = 'assets/ui/card-frame-v5-raw.png'; await im.decode();
    const W = im.width, H = im.height;
    const cw = W - INSET * 2, ch = H - INSET * 2;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    g.drawImage(im, INSET, INSET, cw, ch, 0, 0, cw, ch);
    // 右下角水印：取同尺寸左下角水平镜像后覆盖
    const pw = Math.round(cw * 0.22), ph = Math.round(ch * 0.11);
    const tmp = document.createElement('canvas'); tmp.width = pw; tmp.height = ph;
    const tg = tmp.getContext('2d');
    tg.translate(pw, 0); tg.scale(-1, 1);
    tg.drawImage(cv, 0, ch - ph, pw, ph, 0, 0, pw, ph);
    g.drawImage(tmp, cw - pw, ch - ph);
    return { W, H, cw, ch, url: cv.toDataURL('image/png') };
  }, INSET);
  fs.writeFileSync(DIR + 'assets/ui/card-frame-v5.png', Buffer.from(out.url.split(',')[1], 'base64'));
  console.log('src', out.W + 'x' + out.H, '-> clean', out.cw + 'x' + out.ch);
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
