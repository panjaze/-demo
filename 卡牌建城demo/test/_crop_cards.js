/* 从 style-ref-2.jpg 第 1 板块裁切 4 张类型卡底图（归一化坐标，便于微调） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 归一化坐标（相对图宽高）—— 目测值，跑完看裁片再微调
const CARDS = [
  { name: 'building', x1: 0.0195, y1: 0.113, x2: 0.1300, y2: 0.413 },
  { name: 'effect',   x1: 0.1545, y1: 0.113, x2: 0.2650, y2: 0.413 },
  { name: 'road',     x1: 0.2895, y1: 0.113, x2: 0.3995, y2: 0.413 },
  { name: 'policy',   x1: 0.4245, y1: 0.113, x2: 0.5345, y2: 0.413 },
  { name: 'framev3',  x1: 0.0950, y1: 0.0420, x2: 0.9080, y2: 0.9260, out: 'card-frame-v3.png' },
  // 第 3 板块：顶栏资源条（木质横幅）
  { name: 'topbar',   x1: 0.6850, y1: 0.118, x2: 0.9950, y2: 0.223, out: 'topbar.png' },
  // 第 5 板块：事件弹窗（羊皮纸+木质框）
  { name: 'panel',    x1: 0.7850, y1: 0.280, x2: 0.9900, y2: 0.550, out: 'panel.png' },
  // 第 4 板块：按钮（开始战斗=蓝 / 取消=灰 / 确认=绿）
  { name: 'btn-blue',  x1: 0.4550, y1: 0.326, x2: 0.5570, y2: 0.385, out: 'btn-blue.png' },
  { name: 'btn-gray',  x1: 0.4550, y1: 0.393, x2: 0.5570, y2: 0.450, out: 'btn-gray.png' },
  { name: 'btn-green', x1: 0.4550, y1: 0.458, x2: 0.5570, y2: 0.516, out: 'btn-green.png' },
];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const files = await page.evaluate(async (CARDS) => {
    const img = new Image();
    img.src = 'assets/ui/style-ref-2.jpg';
    await img.decode();
    const out = [];
    for (const c of CARDS) {
      const sx = Math.round(c.x1 * img.width), sy = Math.round(c.y1 * img.height);
      const sw = Math.round((c.x2 - c.x1) * img.width), sh = Math.round((c.y2 - c.y1) * img.height);
      const cv = document.createElement('canvas');
      cv.width = sw; cv.height = sh;
      cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      out.push({ name: c.name, url: cv.toDataURL('image/png'), w: sw, h: sh });
    }
    return out;
  }, CARDS);
  const fs = require('fs');
  if (!fs.existsSync('D:/工程/自研/卡牌建城demo/assets/ui/crops')) fs.mkdirSync('D:/工程/自研/卡牌建城demo/assets/ui/crops', { recursive: true });
  for (const f of files) {
    fs.writeFileSync('D:/工程/自研/卡牌建城demo/assets/ui/crops/' + (f.out || f.name + '.png'), Buffer.from(f.url.split(',')[1], 'base64'));
    console.log(f.name + ': ' + f.w + 'x' + f.h);
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
