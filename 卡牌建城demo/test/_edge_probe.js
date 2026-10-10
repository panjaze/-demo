/* 打印卡框边缘亮度剖面，人工定位框体边界 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const res = await page.evaluate(async () => {
    const im = new Image(); im.src = 'assets/ui/card-frame-v5.png'; await im.decode();
    const W = im.width, H = im.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = (x, y) => { const i = (y * W + x) * 4; return Math.round((d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1)); };
    const mx = Math.round(H / 2), my = Math.round(W / 2);
    const left = [], right = [], top = [], bot = [];
    for (let k = 0; k < 80; k += 4) { left.push(k + ':' + lum(k, mx)); right.push((W - 1 - k) + ':' + lum(W - 1 - k, mx)); }
    for (let k = 0; k < 60; k += 4) { top.push(k + ':' + lum(my, k)); bot.push((H - 1 - k) + ':' + lum(my, H - 1 - k)); }
    // 右下角水印区亮度（对比左下角同位置）
    const cw = Math.round(W * 0.20), chh = Math.round(H * 0.13);
    let wmSum = 0, ctrSum = 0, n = 0;
    for (let y = H - chh; y < H; y++) for (let x = W - cw; x < W; x++) { wmSum += lum(x, y); n++; }
    for (let y = H - chh; y < H; y++) for (let x = 0; x < cw; x++) { ctrSum += lum(x, y); }
    return { W, H, left, right, top, bot, wmAvg: Math.round(wmSum / n), blAvg: Math.round(ctrSum / n) };
  });
  console.log('L', JSON.stringify(res.left));
  console.log('R', JSON.stringify(res.right));
  console.log('T', JSON.stringify(res.top));
  console.log('B', JSON.stringify(res.bot));
  console.log('右下角平均亮度', res.wmAvg, '  左下角', res.blAvg);
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
