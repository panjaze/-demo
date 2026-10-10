/* 装饰件去底 + 去白边：从四边洪泛填充抠掉背景色，再向内腐蚀 2px 杀掉浅色光晕
 * （全局色键会把水晶高光/石头亮部一起抠掉，洪泛只清与边缘连通的背景）
 * 用法：node test/_key_bg.js <相对assets的路径> ...   原地覆盖 */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const FILES = process.argv.slice(2);
const TH = 46;          // 与底色的最大通道差阈值
const ERODE = 2;        // 腐蚀像素数（去光晕）
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  for (const rel of FILES) {
    const r = await page.evaluate(async ({ rel, TH, ERODE }) => {
      const im = new Image(); im.src = 'assets/ui/' + rel; await im.decode();
      const W = im.width, H = im.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const px = g.getImageData(0, 0, W, H), d = px.data;
      // 背景色 = 四角中点采样的中位数
      const cs = [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]].map(([x, y]) => {
        const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]];
      });
      const bg = [0, 1, 2].map(k => cs.map(c => c[k]).sort((a, b) => a - b)[2]);
      const near = (i) => Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) <= TH;
      // 洪泛：从边界所有"近底色"像素向内扩散
      const bgMask = new Uint8Array(W * H);
      const stack = [];
      for (let x = 0; x < W; x++) { stack.push(x, x + (H - 1) * W); }
      for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
      while (stack.length) {
        const p = stack.pop();
        if (bgMask[p]) continue;
        const i = p * 4;
        if (d[i + 3] === 0 || near(i)) { bgMask[p] = 1; }
        else continue;
        const x = p % W, y = (p / W) | 0;
        if (x > 0) stack.push(p - 1);
        if (x < W - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - W);
        if (y < H - 1) stack.push(p + W);
      }
      for (let p = 0; p < W * H; p++) if (bgMask[p]) d[p * 4 + 3] = 0;
      // 腐蚀：3x3 最小值滤波 × ERODE 次（把边缘往里收，去掉浅色描边）
      for (let it = 0; it < ERODE; it++) {
        const src = new Uint8ClampedArray(d);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let m = 255;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= H || xx < 0 || xx >= W) { m = 0; continue; }
            m = Math.min(m, src[(yy * W + xx) * 4 + 3]);
          }
          d[(y * W + x) * 4 + 3] = m;
        }
      }
      g.putImageData(px, 0, 0);
      return cv.toDataURL('image/png');
    }, { rel, TH, ERODE });
    fs.writeFileSync(DIR + 'assets/ui/' + rel, Buffer.from(r.split(',')[1], 'base64'));
    console.log('键出 + 去光晕:', rel);
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
