/* 带状路加深标定：在真实默认底图(vivid)+默认相机下，扫候选混合参数
 * 两条线同时盯：
 *   路心 vs 同格草地 Δ 要 >= 55（看得清）
 *   路肩(±0.42格) Δ 要 <= 22（仍是条带，不退回铺满格的方块）
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';

const BASE = { pig: { color: '#ab9060', alpha: 0.45, mode: 'source-over', width: 0.48 }, width: 0.50 };
const mk = (core, cw, extra) => Object.assign({}, BASE, {
  coreWidth: cw, core: { color: core.color, alpha: core.alpha, mode: 'lighten' },
}, extra || {});

const CANDIDATES = [
  { name: '心.48/宽.26', v: mk({ color: '#e3cfa0', alpha: 0.48 }, 0.26) },
  { name: '心.50/宽.28', v: mk({ color: '#e5d2a3', alpha: 0.50 }, 0.28) },
  { name: '心.52/宽.28', v: mk({ color: '#e7d4a6', alpha: 0.52 }, 0.28) },
  { name: '心.55/宽.30', v: mk({ color: '#ecd9ab', alpha: 0.55 }, 0.30) },
  { name: '心.50/宽.28+缘', v: mk({ color: '#e5d2a3', alpha: 0.50 }, 0.28, { edge: { color: '#5f4d36', alpha: 0.30, mode: 'multiply' }, edgeWidth: 0.62 }) },
  { name: '心.52/宽.30+缘', v: mk({ color: '#e7d4a6', alpha: 0.52 }, 0.30, { edge: { color: '#5f4d36', alpha: 0.30, mode: 'multiply' }, edgeWidth: 0.62 }) },
  { name: '心.55/宽.30+缘', v: mk({ color: '#ecd9ab', alpha: 0.55 }, 0.30, { edge: { color: '#5f4d36', alpha: 0.30, mode: 'multiply' }, edgeWidth: 0.62 }) },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null);
  });

  const orig = await page.evaluate(() => JSON.parse(JSON.stringify(CFG.mapVisual.road.ribbon)));

  const rows = [];
  for (const c of CANDIDATES) {
    const r = await page.evaluate(({ cand, orig }) => {
      // 先全清道路，恢复基线
      Game.state.roads = {};
      (CFG.map.initialRoads || []).forEach(p => Game.placeRoad(p.gx, p.gy));
      const RB = CFG.mapVisual.road.ribbon;
      Object.keys(RB).forEach(k => { RB[k] = orig[k]; });
      if (cand) Object.keys(cand).forEach(k => { RB[k] = cand[k]; });
      Sandbox.render();

      const T = CFG.map.tile * Sandbox.scale;
      const samp = (gx, gy, ox, oy) => {
        const t = Sandbox.tileRect(gx, gy);
        const x = t.x + (0.5 + ox) * T, y = t.y + (0.5 + oy) * T;
        const d = Sandbox.ctx.getImageData(Math.round(x * Sandbox.dpr), Math.round(y * Sandbox.dpr), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const d3 = (a, b) => Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));

      // ① 从主城起步逐格延伸出一条连通合法的路（优先挑非官道格，必要时用官道格桥接），
      //    直到凑够 4 个非官道格 —— 官道格有素材贴回本来就够清楚，要补的是玩家自己开的新路
      const path = [];
      const nonOffCount = () => path.filter(c => !Game.isOfficialRoad(c[0], c[1])).length;
      const inView = (gx, gy) => {
        const t = Sandbox.tileRect(gx, gy);
        return t.x >= 0 && t.y >= 0 && t.x + t.w <= Sandbox.cw && t.y + t.h <= Sandbox.ch;
      };
      for (let step = 0; step < 14 && nonOffCount() < 4; step++) {
        let found = null;
        for (const wantNonOff of [true, false]) {
          for (let gy = 0; gy < CFG.map.rows && !found; gy++)
            for (let gx = 0; gx < CFG.map.cols && !found; gx++) {
              if (!Game.canPlaceRoad(gx, gy)) continue;
              if (wantNonOff && Game.isOfficialRoad(gx, gy)) continue;
              if (!inView(gx, gy)) continue;
              found = [gx, gy];
            }
          if (found) break;
        }
        if (!found) break;
        Game.placeRoad(found[0], found[1]);
        path.push(found);
      }
      // ② 清空回到无路基线，采 baseline
      Game.state.roads = {};
      (CFG.map.initialRoads || []).forEach(p => Game.placeRoad(p.gx, p.gy));
      Sandbox.render();
      const shot = c => ({ core: samp(c[0], c[1], 0, 0), sh: [samp(c[0], c[1], 0, 0.42), samp(c[0], c[1], 0, -0.42), samp(c[0], c[1], 0.42, 0), samp(c[0], c[1], -0.42, 0)] });
      const base = path.map(shot);
      path.forEach(c => Game.placeRoad(c[0], c[1]));   // 整条路重铺（保证连通）
      Sandbox.render();
      const aft = path.map(shot);

      // ③ 只统计非官道格。
      //    ★ 路肩只在「直线格」的**垂直方向**采样：相邻格的路面是从格心连到格心的，
      //      所以沿路方向本来就该全是路（转角格尤其明显），测它毫无意义 —— 我第一版
      //      无差别四方向取 max，把"沿路方向"当成了"路肩"，得出路肩被铺满的假结论。
      const idx = [], shIdx = [];
      path.forEach((c, i) => {
        if (Game.isOfficialRoad(c[0], c[1])) return;
        const [gx, gy] = c;
        const has = (x, y) => Game.isRoadAt(x, y);
        const h = has(gx - 1, gy) || has(gx + 1, gy);
        const v = has(gx, gy - 1) || has(gx, gy + 1);
        idx.push(i);
        if (h && !v) shIdx.push({ i, j: 0 });        // 水平路 → 看上下路肩
        else if (v && !h) shIdx.push({ i, j: 2 });   // 竖直路 → 看左右路肩(索引2/3)
      });
      const core = [], sh = [];
      idx.forEach(i => core.push(d3(base[i].core, aft[i].core)));
      shIdx.forEach(s => {
        const jj = (s.j === 2) ? 2 : 0;
        sh.push(d3(base[s.i].sh[jj], aft[s.i].sh[jj]));
        sh.push(d3(base[s.i].sh[jj + 1], aft[s.i].sh[jj + 1]));
      });
      core.sort((a, b) => a - b);
      return {
        cells: idx.map(i => path[i].join(',')),
        coreMin: core[0], coreMed: core[Math.floor(core.length / 2)], coreMax: core[core.length - 1],
        shMax: core.length ? Math.max.apply(null, sh) : -1,
        sample: idx.length ? aft[idx[0]].core.join(',') : '',
      };
    }, { cand: c.v, orig });
    rows.push({ name: c.name, ...r });
  }

  console.log('候选'.padEnd(16) + '路心Δ(最小/中位/最大)'.padEnd(26) + '路肩Δ最大  路心最终色');
  rows.forEach(r => {
    console.log(r.name.padEnd(16) +
      (r.coreMin + ' / ' + r.coreMed + ' / ' + r.coreMax).padEnd(26) +
      String(r.shMax).padEnd(11) + r.sample);
  });
  console.log('\n采样格:', rows[0].cells.join(' '));
  await browser.close();
})();
