/* 卡面合成：v3 框 + 场景插画 → 成品卡图（窗口区 cover 铺满）
 * 用法：node test/_compose_card.js  （SCENES 清单批量合成） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 窗口区在 card-frame-v3.png（裁后）中的归一化位置
const WIN = { x1: 0.085, y1: 0.195, x2: 0.915, y2: 0.635 };
const SCENES = [
  { scene: 'assets/ui/art/farm-scene.png',    out: 'cards/building-v5.png' },
];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const files = await page.evaluate(async ({ SCENES, WIN }) => {
    const frame = new Image();
    frame.src = 'assets/ui/card-frame-v5.png';
    await frame.decode();
    const out = [];
    for (const s of SCENES) {
      const art = new Image();
      art.src = s.scene;
      await art.decode();
      const cv = document.createElement('canvas');
      cv.width = frame.width; cv.height = frame.height;
      const g = cv.getContext('2d');
      g.drawImage(frame, 0, 0);
      // 窗口区 cover 铺满场景插画
      const wx = WIN.x1 * cv.width, wy = WIN.y1 * cv.height;
      const ww = (WIN.x2 - WIN.x1) * cv.width, wh = (WIN.y2 - WIN.y1) * cv.height;
      const scale = Math.max(ww / art.width, wh / art.height);
      const aw = art.width * scale, ah = art.height * scale;
      g.save();
      g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
      g.drawImage(art, wx + (ww - aw) / 2, wy + (wh - ah) / 2, aw, ah);
      g.restore();
      out.push({ name: s.out, url: cv.toDataURL('image/png') });
    }
    return out;
  }, { SCENES, WIN });
  const fs = require('fs');
  for (const f of files) {
    fs.writeFileSync('D:/工程/自研/卡牌建城demo/assets/ui/' + f.name, Buffer.from(f.url.split(',')[1], 'base64'));
    console.log('合成: ' + f.out);
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
