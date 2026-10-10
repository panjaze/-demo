/* 卡面合成：v3 框 + 场景插画 → 成品卡图（窗口区 cover 铺满）
 * 用法：node test/_compose_card.js  （SCENES 清单批量合成） */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 窗口区在 assets/ui/card-frame-v5.png 中的归一化位置（第六十五次修订：母版裁边 7px 后重校）
const WIN = { x1: 0.0790, y1: 0.1921, x2: 0.9210, y2: 0.6363 };
const SCENES = [
  { scene: 'assets/ui/art/farm-scene.png',     out: 'cards/farm-v5.jpg' },
  { scene: 'assets/ui/art/atelier-scene.png',  out: 'cards/atelier-v5.jpg' },
  { scene: 'assets/ui/art/power-scene.png',    out: 'cards/power-v5.jpg' },
  { scene: 'assets/ui/art/barracks-scene.png', out: 'cards/barracks-v5.jpg' },
  { scene: 'assets/ui/art/tower-scene.png',    out: 'cards/tower-v5.jpg' },
  { scene: 'assets/ui/art/road-scene.png',     out: 'cards/road-v5.jpg' },
  { scene: 'assets/ui/art/effect-scene.png',   out: 'cards/effect-v5.jpg' },
  { scene: 'assets/ui/art/upgrade-scene.png',  out: 'cards/upgrade-v5.jpg' },
  /* ★ 政策 / 遗物 / 事件三类（第六十五次修订）：同框同插画体系，与手牌卡一致 */
  { scene: 'assets/ui/art/policy-farm-scene.png',     out: 'cards/policy-farm-v5.jpg' },
  { scene: 'assets/ui/art/policy-war-scene.png',      out: 'cards/policy-war-v5.jpg' },
  { scene: 'assets/ui/art/policy-balance-scene.png',  out: 'cards/policy-balance-v5.jpg' },
  { scene: 'assets/ui/art/relic-econ-scene.png',      out: 'cards/relic-econ-v5.jpg' },
  { scene: 'assets/ui/art/relic-war-scene.png',       out: 'cards/relic-war-v5.jpg' },
  { scene: 'assets/ui/art/event-bad-scene.png',       out: 'cards/event-bad-v5.jpg' },
  { scene: 'assets/ui/art/event-choice-scene.png',    out: 'cards/event-choice-v5.jpg' },
  { scene: null,                                      out: 'cards/empty-v5.jpg' },   // 空手牌槽：只留框，不画插画
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
      const art = s.scene ? new Image() : null;
      if (art) { art.src = s.scene; await art.decode(); }
      /* ★ 输出宽 640：显示端最大 190px，3 倍余量足够，体积只有原图 ~1/4（作品集要能秒开） */
      const OUT_W = 640;
      const cv = document.createElement('canvas');
      cv.width = OUT_W; cv.height = Math.round(OUT_W * frame.height / frame.width);
      const g = cv.getContext('2d');
      g.drawImage(frame, 0, 0, cv.width, cv.height);
      if (!art) { out.push({ name: s.out, url: cv.toDataURL('image/jpeg', 0.88) }); continue; }
      // 窗口区 cover 铺满场景插画
      const wx = WIN.x1 * cv.width, wy = WIN.y1 * cv.height;
      const ww = (WIN.x2 - WIN.x1) * cv.width, wh = (WIN.y2 - WIN.y1) * cv.height;
      const scale = Math.max(ww / art.width, wh / art.height);
      const aw = art.width * scale, ah = art.height * scale;
      g.save();
      g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
      g.drawImage(art, wx + (ww - aw) / 2, wy + (wh - ah) / 2, aw, ah);
      g.restore();
      /* ★ JPEG q0.88：卡面无透明通道，同类画质下体积约为 PNG 的 1/20 */
      out.push({ name: s.out, url: cv.toDataURL('image/jpeg', 0.88) });
    }
    return out;
  }, { SCENES, WIN });
  const fs = require('fs');
  for (const f of files) {
    fs.writeFileSync('D:/工程/自研/卡牌建城demo/assets/ui/' + f.name, Buffer.from(f.url.split(',')[1], 'base64'));
    console.log('合成: ' + f.name);
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
