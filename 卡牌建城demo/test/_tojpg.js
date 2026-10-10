/* PNG → JPEG 批量压缩（自动检测透明通道，有透明就跳过）
 * 用法：node test/_tojpg.js <相对路径> [<相对路径> ...] */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/';
const LIST = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  for (const rel of LIST) {
    const r = await page.evaluate(async (rel) => {
      const im = new Image(); im.src = rel; await im.decode();
      const W = im.width, H = im.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      let hasAlpha = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasAlpha = true; break; }
      if (hasAlpha) return { skip: true, W, H };
      return { url: cv.toDataURL('image/jpeg', 0.86), W, H };
    }, rel);
    if (r.skip) { console.log('跳过（含透明通道）:', rel, r.W + 'x' + r.H); continue; }
    const out = rel.replace(/\.png$/, '.jpg');
    fs.writeFileSync(DIR + out, Buffer.from(r.url.split(',')[1], 'base64'));
    const a = fs.statSync(DIR + rel).size, b = fs.statSync(DIR + out).size;
    console.log(rel, '->', out, (a / 1024 / 1024).toFixed(2) + 'MB -> ' + (b / 1024).toFixed(0) + 'KB');
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
