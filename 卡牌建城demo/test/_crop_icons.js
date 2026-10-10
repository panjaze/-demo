/* 资源图标裁切：从 res-icons.png（四联手绘图）按图标实际位置裁出 4 个独立 png */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8124/index.html');
  const out = await page.evaluate(async () => {
    const img = new Image();
    img.src = 'assets/ui/res-icons.png';
    await img.decode();
    const W = img.width, H = img.height;      // 1024×1024
    // 四个图标的中心（目测：横向不均匀，纵向居中）与裁切边长
    const centers = [
      { name: 'energy',  cx: 0.135, cy: 0.50 },
      { name: 'food',    cx: 0.375, cy: 0.50 },
      { name: 'soldier', cx: 0.615, cy: 0.50 },
      { name: 'pop',     cx: 0.865, cy: 0.50 },
    ];
    const S = Math.round(H * 0.24);           // 裁切边长 24%（≈246px）
    const files = [];
    for (const c of centers) {
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const g = cv.getContext('2d');
      const sx = Math.max(0, Math.min(W - S, c.cx * W - S / 2));
      const sy = Math.max(0, Math.min(H - S, c.cy * H - S / 2));
      g.drawImage(img, sx, sy, S, S, 0, 0, S, S);
      const url = cv.toDataURL('image/png');
      // 下载：借助 a[download] 不可行（无头），改用 fetch POST 到本地？—— 直接返回 dataURL
      files.push({ name: c.name, url });
    }
    return files;
  });
  // 用 CDP 的 Page.setDownloadBehavior 不可靠；直接把 dataURL 交给 node 写文件
  const fs = require('fs');
  for (const f of out) {
    const b64 = f.url.split(',')[1];
    fs.writeFileSync('D:/工程/自研/卡牌建城demo/assets/ui/icons/' + f.name + '.png', Buffer.from(b64, 'base64'));
  }
  console.log('裁切完成:', out.map(o => o.name).join(', '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
