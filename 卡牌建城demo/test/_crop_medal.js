/* 自动裁切：去掉背景与右下角水印，方形紧裁 + 缩放到 256 */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const SRC = process.argv[2];
const OUT = process.argv[3];
const TH = parseFloat(process.argv[4] || '28');
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const out = await page.evaluate(async ({ SRC, TH }) => {
    const im = new Image(); im.src = SRC; await im.decode();
    const W = im.width, H = im.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const bg = [d[0], d[1], d[2]];
    let x1 = W, y1 = H, x2 = 0, y2 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x > W * 0.78 && y > H * 0.82) continue;      // 跳过右下角水印区
      const i = (y * W + x) * 4;
      const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      if (diff > TH) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
    }
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const r = Math.max(x2 - x1, y2 - y1) / 2;
    const S = 256;
    const cv2 = document.createElement('canvas'); cv2.width = S; cv2.height = S;
    const g2 = cv2.getContext('2d');
    g2.drawImage(im, cx - r, cy - r, r * 2, r * 2, 0, 0, S, S);
    /* 背景键出：离底色越近越透明（软阈值），得到带透明通道的徽章 */
    const px = g2.getImageData(0, 0, S, S);
    const dd = px.data;
    const K0 = 14, K1 = 40;
    for (let i = 0; i < dd.length; i += 4) {
      const d0 = Math.max(Math.abs(dd[i] - bg[0]), Math.abs(dd[i + 1] - bg[1]), Math.abs(dd[i + 2] - bg[2]));
      const a = d0 <= K0 ? 0 : (d0 >= K1 ? 255 : Math.round((d0 - K0) / (K1 - K0) * 255));
      dd[i + 3] = Math.min(dd[i + 3], a);
    }
    g2.putImageData(px, 0, 0);
    return { bbox: [x1, y1, x2, y2], W, H, url: cv2.toDataURL('image/png') };
  }, { SRC, TH });
  fs.writeFileSync(DIR + OUT, Buffer.from(out.url.split(',')[1], 'base64'));
  console.log('bbox', out.bbox, 'size', out.W + 'x' + out.H, '->', OUT);
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
