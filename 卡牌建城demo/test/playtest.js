/* 实机玩家模拟 v3：完整玩家流程 + 回归验证两个卡死 bug */
const path = require('path');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const URL = 'http://127.0.0.1:8124/index.html';
const SHOT = (n) => path.join(__dirname, `_p3_${n}.png`);
const errors = [];
const log = (...a) => console.log('[play]', ...a);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push('[http] ' + r.status() + ' ' + r.url()); });
  const hint = () => page.evaluate(() => document.getElementById('hint').textContent.trim().slice(0, 60)).catch(() => '');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  /* 第四十二次修订：开局先进主界面 → 自动化直接跳过 */
  await page.evaluate(() => { if (window.Menu) Menu.start(true); });
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => ({
    energy: Math.round(Game.state.res.energy), hand: Game.state.hand.map(h => h && h.key),
    shop: Game.state.shop && Game.state.shop.cards, modal: UI.modal,
    over: Game.state.over, buildings: Object.keys(Game.state.buildings).length,
    polOffer: !!Game.state.policy.p1.offer, polSlots: Game.state.policy.p1.slots.length,
    polRefreshes: Game.state.policy.p1.refreshes,
    evOffer: Game.state.events.p1.offer, evCur: Game.state.events.p1.current, evRef: Game.state.events.p1.refreshes,
  }));

  /* ---- 1. 开局政策三选一：选一张 ---- */
  await page.locator('#policy-cards .card[data-policy]').first().click({ timeout: 4000 })
    .catch(e => log('⚠ 开局政策点击失败:', e.message.split('\n')[0]));
  log('1.颁布政策:', JSON.stringify(await state()), '| hint:', await hint());

  /* ---- 2. 抽卡：角标 → 弹窗 → 点「抽取」→ 重开一次 → 买最便宜的 ---- */
  await page.locator('#corner-ui [data-modal="shop"]').click({ timeout: 4000 }).catch(e => log('⚠ 角标失败:', e.message.split('\n')[0]));
  await page.waitForTimeout(300);
  await page.locator('#btn-open').click({ timeout: 4000 }).catch(e => log('⚠ 抽取按钮失败:', e.message.split('\n')[0]));
  await page.waitForTimeout(300);
  log('2.抽取后:', JSON.stringify(await state()), '| hint:', await hint());
  await page.screenshot({ path: SHOT('01-抽取') });
  // 重开一次（第二次收费）
  const rr = page.locator('#btn-reroll, [data-action="reroll"], .shop-foot button:not(#btn-open)').first();
  if (await rr.count()) { await rr.click({ timeout: 3000 }).catch(e => log('⚠ 重开失败:', e.message.split('\n')[0])); await page.waitForTimeout(250); log('2b.重开后:', JSON.stringify(await state())); }
  // 买一张最便宜的（遍历找 canBuy 为 true 的卡）
  const boughtIdx = await page.evaluate(() => {
    const S = Game.state;
    if (!S.shop || !S.shop.cards) return -1;
    let best = -1, bestPrice = 1e9;
    S.shop.cards.forEach((k, i) => {
      if (!k) return;
      const p = Game.cardInfo(k).price;
      if (S.res.energy >= p && p < bestPrice && Game.canBuy(i)) { best = i; bestPrice = p; }
    });
    return best;
  });
  if (boughtIdx >= 0) {
    await page.locator(`#shop-cards [data-shop="${boughtIdx}"]`).click({ timeout: 4000 }).catch(e => log('⚠ 买卡点击失败:', e.message.split('\n')[0]));
    await page.waitForTimeout(300);
    log('3.买卡后:', JSON.stringify(await state()), '| hint:', await hint());
  } else log('⚠ 没有买得起的卡（energy', (await state()).energy, '）');
  await page.screenshot({ path: SHOT('02-买卡后') });
  // 关掉抽卡弹窗
  await page.locator('#modal-close').click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(200);

  /* ---- 3. 拖卡建造 ---- */
  const handIdx = await page.evaluate(() => Game.state.hand.findIndex(h => h));
  if (handIdx >= 0) {
    const b = await page.locator(`#hand-slots [data-hand="${handIdx}"]`).boundingBox().catch(() => null);
    if (b) {
      const target = await page.evaluate(() => {
        const r = Sandbox.tileRect(3, 13);
        const cv = document.getElementById('sandbox').getBoundingClientRect();
        const k = cv.width / document.getElementById('sandbox').offsetWidth;
        return { x: cv.left + (r.x + r.w / 2) * k, y: cv.top + (r.y + r.h / 2) * k };
      });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 14 });
      await page.waitForTimeout(250);
      await page.mouse.up();
      await page.waitForTimeout(300);
      log('4.拖卡建造:', JSON.stringify(await state()), '| hint:', await hint());
      await page.screenshot({ path: SHOT('03-建造后') });
    }
  }

  /* ---- 4. 政策刷新回归（造一个待选 → 刷新两次 → 颁布）---- */
  await page.evaluate(() => { Game.state.policy.p1.offer = Game.rollPolicy('p1'); Game.state.policy.p1.refreshes = 0; });
  await page.locator('#btn-policy').click({ timeout: 4000 }).catch(e => log('⚠ 政策按钮失败:', e.message.split('\n')[0]));
  await page.waitForTimeout(300);
  log('5.政策待选:', JSON.stringify(await state()));
  const pr = page.locator('[data-action="policy-refresh"]').first();
  for (let i = 0; i < 2; i++) {
    if (await pr.count()) {
      await pr.click({ timeout: 3000 }).catch(e => log(`⚠ 政策刷新#${i + 1}失败:`, e.message.split('\n')[0]));
      await page.waitForTimeout(250);
      log(`5b.政策刷新#${i + 1}:`, JSON.stringify(await state()), '| hint:', await hint());
    }
  }
  // 刷新后应仍能看到 3 张可选卡（回归：之前刷新直接抛异常）
  const pickable = await page.evaluate(() => document.querySelectorAll('#policy-cards .card[data-policy]').length);
  log('5c.刷新后可选政策卡数（应为 3）:', pickable);
  await page.screenshot({ path: SHOT('04-政策刷新后') });
  await page.locator('#policy-cards .card[data-policy]').first().click({ timeout: 3000 }).catch(e => log('⚠ 颁布失败:', e.message.split('\n')[0]));
  await page.waitForTimeout(250);
  log('5d.颁布后:', JSON.stringify(await state()));

  /* ---- 5. 事件牌全流程（回归：刷新后领取按钮必须还在）---- */
  await page.evaluate(() => { for (let i = 0; i < 200; i++) Game.update(1); UI.render(); });
  await page.waitForTimeout(300);
  const s1 = await state();
  log('6.快进200s:', JSON.stringify(s1));
  if (s1.evOffer) {
    const evr = page.locator('[data-action="event-refresh"]').first();
    if (await evr.count()) {
      await evr.click({ timeout: 3000 }).catch(e => log('⚠ 事件刷新失败:', e.message.split('\n')[0]));
      await page.waitForTimeout(250);
      log('6b.事件刷新后:', JSON.stringify(await state()));
      // ★ 回归断言：刷新后领取按钮必须仍在
      const claimStill = await page.locator('[data-action="event-claim"]').count();
      const evCardStill = await page.evaluate(() => !!document.querySelector('#policy-cards .card-event'));
      log('6c.刷新后事件卡在?', evCardStill, '领取按钮在?', claimStill > 0, claimStill > 0 && evCardStill ? '✓ 回归通过' : '✗✗ 仍卡死！');
      await page.screenshot({ path: SHOT('05-事件刷新后') });
    }
    const evc = page.locator('[data-action="event-claim"]').first();
    if (await evc.count()) {
      await evc.click({ timeout: 3000 }).catch(e => log('⚠ 事件领取失败:', e.message.split('\n')[0]));
      await page.waitForTimeout(250);
      log('6d.事件领取后:', JSON.stringify(await state()), '| hint:', await hint());
      await page.screenshot({ path: SHOT('06-事件领取后') });
    } else log('✗✗ 领取按钮缺失（卡死复现）');
  } else log('（未弹事件牌，跳过）');

  /* ---- 6. 长跑 500s 稳定性 ---- */
  await page.evaluate(() => { for (let i = 0; i < 500; i++) Game.update(1); UI.render(); });
  await page.waitForTimeout(400);
  const s2 = await state();
  log('7.长跑500s:', JSON.stringify(s2));
  if (s2.energy < 0) log('✗✗ 能量为负（苛捐扣穿 bug 仍存在）:', s2.energy);
  else if (s2.energy >= 0) log('✓ 能量非负（钳制生效）:', s2.energy);
  await page.screenshot({ path: SHOT('07-长跑') });
  if (s2.over) {
    await page.locator('#result-restart').click({ timeout: 3000 }).catch(e => log('⚠ 重开失败:', e.message.split('\n')[0]));
    await page.waitForTimeout(300);
    log('8.重开后:', JSON.stringify(await state()));
  }

  console.log('\n==== 错误汇总（' + errors.length + ' 条） ====');
  errors.slice(0, 25).forEach(e => console.log(e));
  if (!errors.length) console.log('（无错误 ✓）');
  await browser.close();
})().catch(e => { console.error('[play] 脚本异常:', e.message); process.exit(1); });
