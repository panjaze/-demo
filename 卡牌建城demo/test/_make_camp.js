/* 据点素材加工：① bbox 紧裁（跳过右下水印区）② 洪泛键出灰底 + 腐蚀去光晕 ③ 缩到 192 高
 * 用法：node test/_make_camp.js
 * 产出：assets/map/camp-food.png / camp-energy.png / camp-logistics.png（透明底） */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const JOBS = [
  { src: 'assets/map/_src-camp-food.png',      out: 'assets/map/camp-food.png' },
  { src: 'assets/map/_src-camp-energy.png',    out: 'assets/map/camp-energy.png' },
  { src: 'assets/map/_src-camp-logistics.png', out: 'assets/map/camp-logistics.png' },
];
const TH = 42, ERODE = 2, OUT_H = 192;
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  for (const job of JOBS) {
    const url = await page.evaluate(async ({ job, TH, ERODE, OUT_H }) => {
      const im = new Image(); im.src = job.src; await im.decode();
      const W = im.width, H = im.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      const bg = [d[0], d[1], d[2]];
      let x1 = W, y1 = H, x2 = 0, y2 = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (x > W * 0.80 && y > H * 0.84) continue;               // 跳过右下水印
        const i = (y * W + x) * 4;
        const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
        if (diff > TH * 1.6) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
      }
      const m = 4;
      x1 = Math.max(0, x1 - m); y1 = Math.max(0, y1 - m);
      x2 = Math.min(W - 1, x2 + m); y2 = Math.min(H - 1, y2 + m);
      const cw = x2 - x1 + 1, ch = y2 - y1 + 1;
      const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
      const g2 = c2.getContext('2d'); g2.drawImage(im, x1, y1, cw, ch, 0, 0, cw, ch);
      const px = g2.getImageData(0, 0, cw, ch), dd = px.data;
      const near = (i) => Math.max(Math.abs(dd[i] - bg[0]), Math.abs(dd[i + 1] - bg[1]), Math.abs(dd[i + 2] - bg[2])) <= TH;
      const mask = new Uint8Array(cw * ch), st = [];
      for (let x = 0; x < cw; x++) st.push(x, x + (ch - 1) * cw);
      for (let y = 0; y < ch; y++) st.push(y * cw, y * cw + cw - 1);
      while (st.length) {
        const q = st.pop(); if (mask[q]) continue;
        const i = q * 4;
        if (dd[i + 3] === 0 || near(i)) mask[q] = 1; else continue;
        const x = q % cw, y = (q / cw) | 0;
        if (x > 0) st.push(q - 1); if (x < cw - 1) st.push(q + 1);
        if (y > 0) st.push(q - cw); if (y < ch - 1) st.push(q + cw);
      }
      for (let q = 0; q < cw * ch; q++) if (mask[q]) dd[q * 4 + 3] = 0;
      for (let it = 0; it < ERODE; it++) {
        const src = new Uint8ClampedArray(dd);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          let mn = 255;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= ch || xx < 0 || xx >= cw) { mn = 0; continue; }
            mn = Math.min(mn, src[(yy * cw + xx) * 4 + 3]);
          }
          dd[(y * cw + x) * 4 + 3] = mn;
        }
      }
      g2.putImageData(px, 0, 0);
      const outH = OUT_H, outW = Math.round(cw * outH / ch);
      const c3 = document.createElement('canvas'); c3.width = outW; c3.height = outH;
      c3.getContext('2d').drawImage(c2, 0, 0, outW, outH);
      return c3.toDataURL('image/png');
    }, { job, TH, ERODE, OUT_H });
    fs.writeFileSync(DIR + job.out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('ok ->', job.out);
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
