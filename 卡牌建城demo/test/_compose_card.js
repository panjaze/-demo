/* 卡面合成：v3 框 + 场景插画 → 成品卡图（窗口区 cover 铺满）
 * 用法：node test/_compose_card.js  （SCENES 清单批量合成） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 窗口区在 card-frame-v3.png（裁后）中的归一化位置
const WIN = { x1: 0.085, y1: 0.165, x2: 0.915, y2: 0.612 };
const SCENES = [
  { scene: 'assets/ui/art/farm-scene.png',    out: 'cards/building-v3.png' },
];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const files = await page.evaluate(async ({ SCENES, WIN }) => {
    const frame = new Image();
    frame.src = 'assets/ui/card-frame-v3.png';
    await frame.decode();
    const orn = new Image();                    // 角花（深底金花，screen 混合融入木框）
    orn.src = 'assets/ui/ornament-raw.png';
    await orn.decode();
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
      // ★ 内衬描边：窗口双线（外深内金）—— 精修 B
      g.strokeStyle = 'rgba(30,22,14,.9)'; g.lineWidth = Math.max(2, cv.width * 0.008);
      g.strokeRect(wx, wy, ww, wh);
      g.strokeStyle = 'rgba(217,169,63,.8)'; g.lineWidth = Math.max(1, cv.width * 0.003);
      g.strokeRect(wx + cv.width * 0.007, wy + cv.width * 0.007, ww - cv.width * 0.014, wh - cv.width * 0.014);
      // ★ 四角角花：screen 混合（深底融进木框，金花叠加），源为左上角花旋转四角
      const osize = cv.width * 0.30;
      g.globalCompositeOperation = 'screen';
      [[0, 0, 0], [cv.width, 0, Math.PI / 2], [cv.width, cv.height, Math.PI], [0, cv.height, -Math.PI / 2]]
        .forEach(function (cn) {
          g.save(); g.translate(cn[0], cn[1]); g.rotate(cn[2]);
          g.drawImage(orn, 0, 0, osize, osize);
          g.restore();
        });
      g.globalCompositeOperation = 'source-over';
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
