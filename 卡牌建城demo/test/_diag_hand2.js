/* 诊断 v2：真实开局条件下（不改相机、不改缩放）
 * A. 默认视口下的路面观感（用户实际看到的）
 * B. 道路牌点击 → 铺路 → 用完 tiles 后是否自动退出
 * C. 建筑牌：点了不可建格会怎样（会不会"卡死"）
 * D. 铺路模式下再点卡/取消路径
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null); UI.render();
  });

  // ===== A. 默认相机下的路面观感 =====
  const cam = await page.evaluate(() => ({
    scale: Sandbox.scale, tile: CFG.map.tile, tilePx: CFG.map.tile * Sandbox.scale,
    camX: Math.round(Sandbox.camX), camY: Math.round(Sandbox.camY),
    plate: CFG.mapVisual.activePlate,
  }));
  console.log('【默认相机】', JSON.stringify(cam));

  const roadLook = await page.evaluate(() => {
    const T = CFG.map.tile * Sandbox.scale;
    const samp = (gx, gy, ox, oy) => {
      const r = Sandbox.tileRect(gx, gy);
      const x = r.x + (0.5 + (ox || 0)) * T, y = r.y + (0.5 + (oy || 0)) * T;
      if (x < 0 || y < 0 || x > Sandbox.cw || y > Sandbox.ch) return null;
      const d = Sandbox.ctx.getImageData(Math.round(x * Sandbox.dpr), Math.round(y * Sandbox.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    // 主城周边：从主城出发铺 6 格（玩家早期真实会铺的位置）
    const sp = CFG.map.spawn.p1;
    const route = [[sp.gx, sp.gy - 1], [sp.gx, sp.gy - 2], [sp.gx + 1, sp.gy - 2], [sp.gx + 2, sp.gy - 2],
      [sp.gx + 2, sp.gy - 3], [sp.gx + 3, sp.gy - 3]];
    route.forEach(c => { if (!Game.isRoadAt(c[0], c[1])) Game.placeRoad(c[0], c[1]); });
    Sandbox.render();
    const T2 = T;
    // 路面带 vs 同格草地（离路心 0.42 格）对比
    const out = [];
    route.forEach(([gx, gy]) => {
      const core = samp(gx, gy, 0, 0);
      const grass1 = samp(gx, gy, 0, 0.42);
      const grass2 = samp(gx, gy, 0, -0.42);
      const grass3 = samp(gx, gy, 0.42, 0);
      const grass4 = samp(gx, gy, -0.42, 0);
      if (!core) { out.push({ cell: gx + ',' + gy, skip: 'offscreen' }); return; }
      const gr = [grass1, grass2, grass3, grass4].filter(Boolean);
      const gm = [0, 1, 2].map(i => Math.round(gr.reduce((a, c) => a + c[i], 0) / gr.length));
      const d = Math.round(Math.sqrt((core[0] - gm[0]) ** 2 + (core[1] - gm[1]) ** 2 + (core[2] - gm[2]) ** 2));
      out.push({ cell: gx + ',' + gy, core: core.join(','), grass: gm.join(','), contrast: d });
    });
    return { tilePx: T2, out };
  });
  console.log('【默认视口 · 路心 vs 同格草地】tile=' + roadLook.tilePx.toFixed(0) + 'px');
  roadLook.out.forEach(o => console.log('   ' + (o.skip ? o.cell + ' ' + o.skip :
    o.cell + '  路心 ' + o.core + '  草地 ' + o.grass + '  对比度 Δ=' + o.contrast)));

  // ===== B. 道路牌：tiles=1 铺完是否自动退出 =====
  const roadCard = await page.evaluate(() => {
    Game.state.hand[0] = { key: 'dirt' };
    UI.render();
    return Game.cardInfo('dirt');
  });
  console.log('【道路牌信息】', JSON.stringify(roadCard));

  const pos = await page.evaluate(() => {
    const el = document.querySelector('[data-hand="0"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(pos.x, pos.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  const st1 = await page.evaluate(() => ({
    roadPlacing: UI.roadPlacing, hand: Game.state.hand.map(h => h && h.key),
    hint: (document.getElementById('hint') || {}).textContent,
  }));
  console.log('【点道路牌后】', JSON.stringify(st1));

  if (st1.roadPlacing) {
    // 找一个可铺格并点击
    const spot = await page.evaluate(() => {
      for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++) {
        if (!Game.canPlaceRoad(gx, gy)) continue;
        const t = Sandbox.tileRect(gx, gy);
        const cv = document.getElementById('sandbox');
        const r = cv.getBoundingClientRect();
        const k = r.width / cv.offsetWidth;
        const x = r.left + (t.x + t.w / 2) * k, y = r.top + (t.y + t.h / 2) * k;
        // 必须落在视口内，否则点击打不到沙盘
        if (x > r.left + 12 && y > r.top + 12 && x < r.right - 12 && y < r.bottom - 12)
          return { gx, gy, x, y };
      }
      return null;
    });
    console.log('【可铺格】', JSON.stringify(spot));
    if (spot) {
      await page.mouse.move(spot.x, spot.y); await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(400);
      const st2 = await page.evaluate(() => ({
        roadPlacing: UI.roadPlacing, hand: Game.state.hand.map(h => h && h.key),
        roads: Object.keys(Game.state.roads).length,
        hint: (document.getElementById('hint') || {}).textContent,
      }));
      console.log('【铺完 1 格后】', JSON.stringify(st2));

      // 再点一下地图，看是否还卡在铺路模式
      await page.mouse.move(spot.x + 40, spot.y); await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(300);
      const st3 = await page.evaluate(() => ({
        roadPlacing: UI.roadPlacing, roads: Object.keys(Game.state.roads).length,
        hint: (document.getElementById('hint') || {}).textContent,
      }));
      console.log('【再点一格】', JSON.stringify(st3));
    }
  }

  // ===== C. 建筑牌点了不可建格 =====
  const st4 = await page.evaluate(() => {
    Game.state.hand[1] = { key: 'tower' };   // 防御塔：需主城 Lv2，大概率无处可建
    UI.render();
    return { info: Game.cardInfo('tower'), castleLv: Game.state.castleLv || (Game.state.castle && Game.state.castle.level) };
  });
  console.log('【防御塔卡】', JSON.stringify(st4));
  const pos2 = await page.evaluate(() => {
    const el = document.querySelector('[data-hand="1"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(pos2.x, pos2.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  const st5 = await page.evaluate(() => ({
    placeMode: UI.placeMode, hint: (document.getElementById('hint') || {}).textContent,
    canBuildCount: (function () {
      let n = 0; for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++)
        if (Game.canBuildAt('tower', gx, gy)) n++; return n;
    })(),
  }));
  console.log('【点防御塔卡后】', JSON.stringify(st5));

  // ===== D. 关键假设验证：placeMode 下点"不可建"的地方能不能退出 =====
  const st6 = await page.evaluate(() => {
    UI.placeMode = null; UI.roadPlacing = null;
    Game.state.hand[2] = { key: 'farm' };
    UI.render();
    return { hand: Game.state.hand.map(h => h && h.key) };
  });
  const pos3 = await page.evaluate(() => {
    const el = document.querySelector('[data-hand="2"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(pos3.x, pos3.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  const entered = await page.evaluate(() => ({ placeMode: UI.placeMode }));
  console.log('【进入放置模式】', JSON.stringify(entered));

  // 故意点一个远处"不可建"的格子
  const bad = await page.evaluate(() => {
    for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (!Game.canBuildAt('farm', gx, gy)) {
        const t = Sandbox.tileRect(gx, gy);
        const cv = document.getElementById('sandbox');
        const r = cv.getBoundingClientRect();
        const k = r.width / cv.offsetWidth;
        const x = r.left + (t.x + t.w / 2) * k, y = r.top + (t.y + t.h / 2) * k;
        if (x > r.left + 10 && y > r.top + 10 && x < r.right - 10 && y < r.bottom - 10)
          return { gx, gy, x, y };
      }
    }
    return null;
  });
  console.log('【不可建格】', JSON.stringify(bad));
  if (bad) {
    await page.mouse.move(bad.x, bad.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(350);
    const st7 = await page.evaluate(() => ({
      placeMode: UI.placeMode ? 'STILL-IN-PLACE-MODE' : null,
      hint: (document.getElementById('hint') || {}).textContent,
    }));
    console.log('【点了不可建格之后】', JSON.stringify(st7));
  }

  // 点沙盘之外（顶栏/商店栏）看看能否取消
  await page.mouse.move(640, 20); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(300);
  const st8 = await page.evaluate(() => ({ placeMode: UI.placeMode ? 'STILL-IN-PLACE-MODE' : null }));
  console.log('【点顶栏之后】', JSON.stringify(st8));

  // Esc 能否取消
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const st9 = await page.evaluate(() => ({
    placeMode: UI.placeMode ? 'STILL-IN-PLACE-MODE' : null,
    hint: (document.getElementById('hint') || {}).textContent,
  }));
  console.log('【按 Esc 之后】', JSON.stringify(st9));

  console.log('【控制台错误】', errs.length ? errs : 'none');
  await browser.close();
})();
