/* 探测圆环外接框（金属环亮像素 bbox） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const res = await page.evaluate(async () => {
    const im = new Image(); im.src = 'assets/ui/topbar/slot-circle.png'; await im.decode();
    const W = im.width, H = im.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    let x1 = W, y1 = H, x2 = 0, y2 = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mx > 120 && mx - mn < 45) {           // 亮且低饱和 = 金属
        n++; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
    }
    return { W, H, n, x1: x1 / W, x2: x2 / W, y1: y1 / H, y2: y2 / H };
  });
  console.log(JSON.stringify(res));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
