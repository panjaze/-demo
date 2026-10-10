/* 图标拼板切分：横向 N 等分 → 每格自动紧裁 → 正方形 128px 透明底 PNG
 * 用法：node test/_crop_icons_row.js <src> <n> <name1,name2,...> */
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
        if (x > W * 0.78 && y > H * 0.82) continue;         // 水印区
        const k = (y * W + x) * 4;
        const diff = Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]);
        if (diff > 42) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
      }
      if (x2 <= x1) { res.push(null); continue; }
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const r = Math.max(x2 - x1, y2 - y1) / 2 * 1.06;
      const S = 128;
      const c2 = document.createElement('canvas'); c2.width = S; c2.height = S;
      const g2 = c2.getContext('2d');
      g2.drawImage(im, cx - r, cy - r, r * 2, r * 2, 0, 0, S, S);
      const px = g2.getImageData(0, 0, S, S), dd = px.data;
      for (let k = 0; k < dd.length; k += 4) {
        const d0 = Math.max(Math.abs(dd[k] - bg[0]), Math.abs(dd[k + 1] - bg[1]), Math.abs(dd[k + 2] - bg[2]));
        const a = d0 <= 16 ? 0 : (d0 >= 46 ? 255 : Math.round((d0 - 16) / 30 * 255));
        dd[k + 3] = Math.min(dd[k + 3], a);
      }
      g2.putImageData(px, 0, 0);
      res.push({ name: NAMES[i] || ('icon' + i), url: c2.toDataURL('image/png'), box: [x1, y1, x2, y2] });
    }
    return res;
  }, { SRC, N, NAMES });
  for (const o of outs) {
    if (!o) { console.log('空格：跳过'); continue; }
    fs.writeFileSync(DIR + 'assets/ui/icons/' + o.name + '.png', Buffer.from(o.url.split(',')[1], 'base64'));
    console.log(o.name, JSON.stringify(o.box));
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
