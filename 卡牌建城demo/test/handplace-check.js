/* 手牌「点击 → 放置」回归验证（第四十次修订）
 * 用户报障：点了卡牌卡死。实测基础流程本就通，卡在三个地方，这里逐条钉死：
 *   A 无处可建时**不进入**放置模式，并说清原因（防御塔需主城 Lv2）
 *   B 点了不能建的地方 → 退出模式（而不是只报错困住玩家）
 *   C 右键 / 点界面别处 → 退出模式（对齐提示文案）
 *   D 铺路不能贴着敌方主城隔空铺（与 AI 的前沿规则对称）
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';

let pass = 0, fail = [];
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail.push(name + (detail ? '  → ' + detail : '')); console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('http://127.0.0.1:8124/index.html?v=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    if (window.Menu) Menu.start(true);          // 第四十二次修订：跳过主界面
    /* 第四十八次修订：新局会弹「新手引导选择界面」，全屏遮罩会挡住后续模拟点击 —— 选"跳过"关掉 */
    if (window.Tutorial) Tutorial.choose(false);
    Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
    Game.state.questClaiming = false; if (UI.setModal) UI.setModal(null); UI.render();
  });

  // 点击某张手牌（按下与松开同点 = 点击而非拖拽）
  async function clickCard(idx) {
    const pos = await page.evaluate((i) => {
      const el = document.querySelector('[data-hand="' + i + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, idx);
    if (!pos) return false;
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(320);
    return true;
  }
  const state = () => page.evaluate(() => ({
    placeMode: UI.placeMode ? UI.placeMode.key : null,
    roadPlacing: !!UI.roadPlacing,
    hint: (document.getElementById('hint') || {}).textContent || '',
    buildings: Object.keys(Game.state.buildings).length,
  }));

  // ===== A 无处可建 → 不进模式 =====
  console.log('== A 防御塔（需主城 Lv2，主城 Lv1 时全图 0 格可建）==');
  const lv = await page.evaluate(() => Game.state.castleLevel);
  console.log('  主城等级 Lv' + lv);
  await page.evaluate(() => { Game.state.hand[0] = { key: 'tower' }; UI.render(); });
  await clickCard(0);
  let s = await state();
  ck('不进入放置模式', s.placeMode === null, 'placeMode=' + s.placeMode);
  ck('提示说清原因', /主城 Lv2/.test(s.hint), 'hint=' + s.hint);

  // ===== B/C 农田：进模式 → 各种取消路径 =====
  console.log('== B 农田（可建）==');
  await page.evaluate(() => { Game.state.hand[1] = { key: 'farm' }; UI.render(); });
  await clickCard(1);
  s = await state();
  ck('进入放置模式', s.placeMode === 'farm', 'placeMode=' + s.placeMode);

  // B1 点不可建格 → 退出
  const bad = await page.evaluate(() => {
    for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (Game.canBuildAt('farm', gx, gy)) continue;
      const t = Sandbox.tileRect(gx, gy);
      const cv = document.getElementById('sandbox'), r = cv.getBoundingClientRect();
      const k = r.width / cv.offsetWidth;
      const x = r.left + (t.x + t.w / 2) * k, y = r.top + (t.y + t.h / 2) * k;
      if (x > r.left + 12 && y > r.top + 12 && x < r.right - 12 && y < r.bottom - 12) return { gx, gy, x, y };
    }
    return null;
  });
  if (bad) {
    await page.mouse.move(bad.x, bad.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(320);
    s = await state();
    ck('点不可建格后退出放置模式', s.placeMode === null, 'placeMode=' + s.placeMode);
  } else ck('找得到不可建格用于测试', false);

  // B2 右键取消
  await clickCard(1);
  s = await state();
  const entered2 = s.placeMode === 'farm';
  await page.mouse.click(640, 360, { button: 'right' });
  await page.waitForTimeout(320);
  s = await state();
  ck('右键取消放置模式', entered2 && s.placeMode === null, '进入=' + entered2 + ' 退出后=' + s.placeMode);

  // B3 点顶栏（界面别处）取消
  await clickCard(1);
  s = await state();
  const entered3 = s.placeMode === 'farm';
  await page.mouse.move(640, 20); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(320);
  s = await state();
  ck('点界面别处取消放置模式', entered3 && s.placeMode === null, '进入=' + entered3 + ' 退出后=' + s.placeMode);

  // B4 正常建造仍然可用
  await clickCard(1);
  const spot = await page.evaluate(() => {
    for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (!Game.canBuildAt('farm', gx, gy)) continue;
      const t = Sandbox.tileRect(gx, gy);
      const cv = document.getElementById('sandbox'), r = cv.getBoundingClientRect();
      const k = r.width / cv.offsetWidth;
      const x = r.left + (t.x + t.w / 2) * k, y = r.top + (t.y + t.h / 2) * k;
      if (x > r.left + 12 && y > r.top + 12 && x < r.right - 12 && y < r.bottom - 12) return { gx, gy, x, y };
    }
    return null;
  });
  const before = (await state()).buildings;
  if (spot) {
    await page.mouse.move(spot.x, spot.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(400);
    s = await state();
    ck('点可建格能正常建造', s.buildings === before + 1, before + ' -> ' + s.buildings);
    ck('建造后退出放置模式', s.placeMode === null);
  } else ck('找得到可建格用于测试', false);

  // ===== D 铺路前沿：敌方主城旁不能铺 =====
  console.log('== D 铺路前沿（与 AI 对称）==');
  const roadChk = await page.evaluate(() => {
    const e = Game.state.enemyCastle;
    const out = { enemyCastle: e.gx + ',' + e.gy };
    // 敌方主城旁边的空地
    const near = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const gx = e.gx + dx, gy = e.gy + dy;
      if (gx < 0 || gy < 0 || gx >= CFG.map.cols || gy >= CFG.map.rows) return;
      near.push({ c: gx + ',' + gy, old: Game.canPlaceRoad(gx, gy), now: Game.canPlaceRoadFor('p1', gx, gy) });
    });
    out.near = near;
    out.p1Frontier = Game.roadFrontier('p1').length;
    out.p2Frontier = Game.roadFrontier('p2').length;
    return out;
  });
  console.log('  敌方主城 ' + roadChk.enemyCastle + ' 旁：' +
    roadChk.near.map(n => n.c + '(旧' + n.old + '/新' + n.now + ')').join(' '));
  console.log('  前沿格数 p1=' + roadChk.p1Frontier + ' p2=' + roadChk.p2Frontier);
  ck('玩家不能在敌方主城旁铺路', roadChk.near.every(n => !n.now));
  ck('己方前沿仍然有格可铺', roadChk.p1Frontier > 0, 'p1=' + roadChk.p1Frontier);
  ck('敌方前沿未被破坏', roadChk.p2Frontier > 0, 'p2=' + roadChk.p2Frontier);

  console.log('\n---- ' + pass + ' 通过 / ' + fail.length + ' 失败 ----');
  if (fail.length) fail.forEach(f => console.log('  ✗ ' + f));
  console.log('控制台错误:', errs.length ? errs : 'none');
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})();
