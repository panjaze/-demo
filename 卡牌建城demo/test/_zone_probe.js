/* 探测卡框分区：顶部标题带 / 插画窗 / 羊皮纸区 的纵向范围 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const res = await page.evaluate(async () => {
    const im = new Image(); im.src = 'assets/ui/cards/road-v5.png'; await im.decode();
    const W = 200, H = Math.round(200 * im.height / im.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0, W, H);
    const rows = [];
    for (let y = 0; y < H; y++) {
      const d = g.getImageData(0, y, W, 1).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < W; i++) { r += d[i * 4]; gg += d[i * 4 + 1]; b += d[i * 4 + 2]; }
      rows.push([Math.round(r / W), Math.round(gg / W), Math.round(b / W)]);
    }
    const marks = [];
    for (let y = 0; y < H; y++) {
      const [r, gg, b] = rows[y];
      const blue = b > r + 12 && b > 55 && b < 190;      // 蓝图带
      const parch = r > 150 && gg > 130 && b < 150 && r > b + 30;   // 羊皮纸
      marks.push((blue ? 'B' : (parch ? 'P' : '.')) );
    }
    // 压缩成区间
    const runs = []; let cur = marks[0], st = 0;
    for (let y = 1; y <= H; y++) {
      if (y === H || marks[y] !== cur) { runs.push(cur + ' ' + (st / H).toFixed(3) + '-' + (y / H).toFixed(3)); st = y; cur = marks[y]; }
    }
    return { H, runs: runs.filter(x => x[0] !== '.') };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
