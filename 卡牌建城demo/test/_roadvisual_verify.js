/* 开垦官道实机验证 v3（像素级断言，第三十八次修订）
 * 之前只能靠肉眼看截图；这里改成**程序化采样**：同一相机、同一批采样点，
 * 先测「无路」基线，再铺路后测一次，逐点算色彩差：
 *   · 路心 Δ 必须大        → 路确实画出来了
 *   · 格缝中点 Δ 必须大    → 路是连续的（不是一格一个胶囊/方块）
 *   · 垂直方向路肩 Δ 必须小 → 路是条带，不是铺满整格的正方形
 * 官道格走 A（贴素材），非官道格走 B（混色带状），两条一批判。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const OUTDIR = 'D:/工程/自研/图片素材/美术风格测试/';

/* 分段定义路线：每段自带走向（决定"路肩"该往哪采），这样 T 型路口那格不会误判。
 * ① x=3 纵线：全是官道格（走 A：贴底图真官道）
 * ② y=8 横线：官道格，含桥格 12,8（桥不画路面，露出底图木桥）
 * ③ x=15 往北两格：**纯非官道**（走 B：程序化带状路）——保证两条路径都被验到 */
const SEGMENTS = [
  { axis: 'v', cells: [[3, 10], [3, 9], [3, 8], [3, 7], [3, 6]] },
  { axis: 'h', cells: [[11, 8], [12, 8], [13, 8], [14, 8], [15, 8]] },
  { axis: 'v', cells: [[15, 8], [15, 7], [15, 6]] },
];


(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
    Sandbox.scale = 1; Sandbox.centerOn(9, 8); Sandbox.render(); UI.render();
  });

  // ---- 注入采样器：把格子坐标换成画布像素，读真实画布（乘 dpr）----
  await page.evaluate(() => {
    window.__sample = function (gx, gy, ox, oy) {
      const T = CFG.map.tile * Sandbox.scale;
      const r = Sandbox.tileRect(gx, gy);
      const x = r.x + (0.5 + (ox || 0)) * T;
      const y = r.y + (0.5 + (oy || 0)) * T;
      const d = Sandbox.ctx.getImageData(Math.round(x * Sandbox.dpr), Math.round(y * Sandbox.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    window.__routeInfo = function () {
      const all = window.__ALL;
      const ter = CFG.map.terrain;
      return all.map(([gx, gy]) => ({
        gx, gy,
        off: Game.isOfficialRoad(gx, gy),
        paintable: !!(Sandbox.reclaimCells && Sandbox.reclaimCells[gx + ',' + gy]),
        water: !!(ter && ter[gy] && ter[gy][gx] === 'W'),
      }));
    };
    window.__ALL = null;
  });

  const ALL = [];
  SEGMENTS.forEach(s => s.cells.forEach(c => {
    if (!ALL.some(a => a[0] === c[0] && a[1] === c[1])) ALL.push(c);
  }));
  // 某格的走向：只属于一段才知道往哪采路肩；T 型路口（属于两段）跳过路肩判定
  const axisOf = {};
  SEGMENTS.forEach(s => s.cells.forEach(([gx, gy]) => {
    const k = gx + ',' + gy;
    axisOf[k] = (axisOf[k] && axisOf[k] !== s.axis) ? 'x' : s.axis;   // 'x' = 路口，跳过
  }));

  // 采样点集合：路心 / 相邻格中点（查连续性） / 垂直路肩（查是不是铺满整格的方块）
  const pts = [];
  const key = c => c[0] + ',' + c[1];
  const setCells = new Set(ALL.map(key));
  const hasCell = (x, y) => setCells.has(x + ',' + y);
  ALL.forEach(([gx, gy]) => {
    pts.push({ id: key([gx, gy]), kind: 'core', gx, gy, ox: 0, oy: 0 });
    if (hasCell(gx + 1, gy)) pts.push({ id: key([gx, gy]), kind: 'seam', gx, gy, ox: 0.5, oy: 0 });
    if (hasCell(gx - 1, gy)) pts.push({ id: key([gx, gy]), kind: 'seam', gx, gy, ox: -0.5, oy: 0 });
    if (hasCell(gx, gy + 1)) pts.push({ id: key([gx, gy]), kind: 'seam', gx, gy, ox: 0, oy: 0.5 });
    if (hasCell(gx, gy - 1)) pts.push({ id: key([gx, gy]), kind: 'seam', gx, gy, ox: 0, oy: -0.5 });
    const ax = axisOf[key([gx, gy])];
    const os = 0.38;
    if (ax === 'h') {
      pts.push({ id: key([gx, gy]), kind: 'shoulder', gx, gy, ox: 0, oy: -os });
      pts.push({ id: key([gx, gy]), kind: 'shoulder', gx, gy, ox: 0, oy: os });
    } else if (ax === 'v') {
      pts.push({ id: key([gx, gy]), kind: 'shoulder', gx, gy, ox: -os, oy: 0 });
      pts.push({ id: key([gx, gy]), kind: 'shoulder', gx, gy, ox: os, oy: 0 });
    }
  });

  async function sweep() {
    return page.evaluate((pts) => pts.map(p => window.__sample(p.gx, p.gy, p.ox, p.oy)), pts);
  }

  const base = await sweep();
  await page.screenshot({ path: OUTDIR + '_验证_铺路前.png' });

  const placed = await page.evaluate((ALL) => {
    let ok = 0, already = 0; const fail = [];
    ALL.forEach(([gx, gy]) => {
      if (Game.isRoadAt(gx, gy)) { already++; return; }
      if (Game.placeRoad(gx, gy)) ok++; else fail.push(gx + ',' + gy);
    });
    Sandbox.render(); UI.render();
    return { ok, already, fail };
  }, ALL);
  await page.waitForTimeout(400);
  const after = await sweep();
  await page.screenshot({ path: OUTDIR + '_验证_铺路后.png' });

  const info = await page.evaluate((ALL) => {
    window.__ALL = ALL;
    return window.__routeInfo();
  }, ALL);

  const dist = (a, b) => Math.round(Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));

  // ---- 汇总 ----
  const rows = pts.map((p, i) => ({
    cell: p.id, kind: p.kind, delta: dist(base[i], after[i]),
    before: base[i].join(','), after: after[i].join(','),
  }));
  const offMap = {};
  info.forEach(o => { offMap[o.gx + ',' + o.gy] = o; });
  const total = rows.filter(r => !(offMap[r.cell] || {}).water).length;

  /* ★ 第四十次修订：阈值从 25/20 提到 45/38。
   *   上一轮就是死在阈值太低——CORE_MIN=25 让"非官道格 Δ16~21"这种
   *   **人眼根本看不清**的路面也判了通过，还拿官道格的高 Δ 充数。
   *   Δ25 在 255 色阶上是肉眼勉强可辨的下限，作为"看得清"的标准不合格。 */
  const CORE_MIN = 45, SEAM_MIN = 38, SHOULDER_MAX = 22;
  let pass = 0, bad = [];
  const water = {};  // 桥/水格：不画路面（露出底图木桥），路心断言豁免
  rows.forEach(r => {
    const o = offMap[r.cell] || {};
    if (o.water) return;                       // 桥格本就不该变色，跳过
    const okv = r.kind === 'core' ? r.delta >= CORE_MIN
      : r.kind === 'seam' ? r.delta >= SEAM_MIN
        : r.delta <= SHOULDER_MAX;
    if (okv) pass++; else bad.push(`${r.cell} ${r.kind}${o.off ? '[官道' + (o.paintable ? '·A' : '·退化B') + ']' : '[非官道·B]'} Δ=${r.delta} (期望${r.kind === 'shoulder' ? '≤' + SHOULDER_MAX : '≥' + (r.kind === 'core' ? CORE_MIN : SEAM_MIN)})`);
  });

  // 官道格 vs 非官道格 的路心最终色，看两者是否够接近（交界处不突兀）
  const coreRows = rows.filter(r => r.kind === 'core');
  const parse = s => s.split(',').map(Number);
  const avg = arr => {
    const n = arr.length || 1;
    const s = arr.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
    return s.map(v => Math.round(v / n));
  };
  const colsA = coreRows.filter(r => { const o = offMap[r.cell]; return o && o.off && o.paintable; });
  const colsB = coreRows.filter(r => { const o = offMap[r.cell]; return o && !o.off; });
  const meanA = avg(colsA.map(r => parse(r.after)));
  const meanB = avg(colsB.map(r => parse(r.after)));

  console.log('铺路:', JSON.stringify(placed));
  console.log('官道/素材可用性:', JSON.stringify(info.filter(o => o.off)));
  console.log('--- 路心最终色 ---');
  coreRows.forEach(r => {
    const o = offMap[r.cell] || {};
    console.log(`  ${r.cell}\t${o.off ? (o.paintable ? 'A·官道素材' : 'B·官道无素材降级') : 'B·带状路'}\tΔ=${r.delta}\t${r.before} -> ${r.after}`);
  });
  console.log('A区均值:', meanA.join(','), ' B区均值:', meanB.join(','), ' 色差:', dist(meanA, meanB));
  console.log(`--- 断言 ${pass}/${total} 通过 ---`);
  if (bad.length) { console.log('❌ 未通过:'); bad.forEach(b => console.log('   ' + b)); }
  else console.log('✅ 全部通过：路心成路、格缝连续、路肩仍是草地（不再是铺满格子的方块）');
  fs.writeFileSync(OUTDIR + '_验证_采样数据.json', JSON.stringify({ placed, info, rows, meanA, meanB, pass, total: rows.length, bad }, null, 2));
  console.log('errors:', errs.length ? errs : 'none');
  await browser.close();
})();
