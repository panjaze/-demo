/* 按钮牌拼板切分：横向 N 等分 → 每格按 bbox 紧裁（保持原比例，不强制方形）
 * 用法：node test/_crop_btn_row.js <src> <n> <name1,name2,...> */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const SRC = process.argv[2];
const N = parseInt(process.argv[3], 10);
const NAMES = (process.argv[4] || '').split(',').filter(Boolean);
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const outs = await page.evaluate(async ({ SRC, N, NAMES }) => {
    const im = new Image(); im.src = SRC; await im.decode();
    const W = im.width, H = im.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const bg = [d[0], d[1], d[2]];
    const res = [];
    for (let i = 0; i < N; i++) {
      const cx0 = Math.round(W * i / N), cx1 = Math.round(W * (i + 1) / N);
      let x1 = cx1, y1 = H, x2 = cx0, y2 = 0;
      for (let y = 0; y < H; y++) for (let x = cx0; x < cx1; x++) {
        if (x > W * 0.78 && y > H * 0.82) continue;
        const k = (y * W + x) * 4;
        const diff = Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]);
        if (diff > 40) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
      }
      if (x2 <= x1) { res.push(null); continue; }
      const w = x2 - x1 + 1, h = y2 - y1 + 1;
      const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      const g2 = c2.getContext('2d');
      g2.drawImage(im, x1, y1, w, h, 0, 0, w, h);
      /* 键出底色：圆角外的原背景要透明，否则九宫格拉伸时四角会露出灰底 */
      const px = g2.getImageData(0, 0, w, h), dd = px.data;
      for (let k = 0; k < dd.length; k += 4) {
        const d0 = Math.max(Math.abs(dd[k] - bg[0]), Math.abs(dd[k + 1] - bg[1]), Math.abs(dd[k + 2] - bg[2]));
        const a = d0 <= 14 ? 0 : (d0 >= 40 ? 255 : Math.round((d0 - 14) / 26 * 255));
        dd[k + 3] = Math.min(dd[k + 3], a);
      }
      g2.putImageData(px, 0, 0);
      res.push({ name: NAMES[i] || ('btn' + i), url: c2.toDataURL('image/png'), box: [x1, y1, w, h] });
    }
    return res;
  }, { SRC, N, NAMES });
  for (const o of outs) {
    if (!o) { console.log('空格：跳过'); continue; }
    fs.writeFileSync(DIR + 'assets/ui/buttons/' + o.name + '.png', Buffer.from(o.url.split(',')[1], 'base64'));
    console.log(o.name, JSON.stringify(o.box));
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
