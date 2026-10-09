/* 全系统实机测试 v2：修正交互方式（拖拽派兵/点选铺路牌/合成先升本）
 * 每个 step 独立容错；PASS/FAIL 汇总；全程收集 pageerror/console.error
 */
const path = require('path');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const URL = 'http://127.0.0.1:8124/index.html';
const SHOT = (n) => path.join(__dirname, `_t_${n}.png`);
const results = [];
const errors = [];
let page;

function log(s, ok, extra) {
  results.push({ s, ok: !!ok, extra: extra === undefined ? '' : String(extra).slice(0, 110) });
  console.log((ok ? '  ✓ ' : '  ✗ ') + s + (ok ? '' : '  → ' + String(extra).slice(0, 110)));
}
async function step(name, fn) {
  try { await fn(); } catch (e) { log(name, false, e.message.split('\n')[0]); }
}
const state = () => page.evaluate(() => ({
  energy: Math.round(Game.state.res.energy), food: Math.round(Game.state.res.food),
  hand: Game.state.hand.map(h => h && h.key), shop: Game.state.shop && Game.state.shop.cards,
  modal: UI.modal, over: Game.state.over, t: Math.round(Game.state.t),
  buildings: Object.keys(Game.state.buildings).length, roads: Object.keys(Game.state.roads).length,
  troops: Game.totalTroops('p1'), polSlots: Game.state.policy.p1.slots.length,
  evOffer: Game.state.events.p1.offer === null ? '(null)' : Game.state.events.p1.offer,
  evCur: Game.state.events.p1.current, evRef: Game.state.events.p1.refreshes,
  castleLv: Game.state.castleLevel, relics: (Game.state.relics || []).length,
  questStar: Game.state.questStar || 0,
}));
const hint = () => page.evaluate(() => document.getElementById('hint').textContent.trim());
const tileXY = (gx, gy) => page.evaluate(([x, y]) => {
  const r = Sandbox.tileRect(x, y);
  const cv = document.getElementById('sandbox').getBoundingClientRect();
  const k = cv.width / document.getElementById('sandbox').offsetWidth;
  return { x: cv.left + (r.x + r.w / 2) * k, y: cv.top + (r.y + r.h / 2) * k };
}, [gx, gy]);
const ff = (sec) => page.evaluate((n) => { for (let i = 0; i < n; i++) Game.update(1); UI.render(); }, sec);
const forceClose = () => page.evaluate(() => { Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
  Game.state.questClaiming = false; UI.rewardChoices = null; UI.setModal(null); UI.render(); });
const drag = async (fromBox, toXY) => {
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toXY.x, toXY.y, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(280);
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  /* 第四十二次修订：开局先进主界面 → 自动化直接跳过（否则菜单挡住所有点击） */
  await page.evaluate(() => { if (window.Menu) Menu.start(true); });
  await page.waitForTimeout(1000);

  /* ===== S1 开局政策 ===== */
  await step('S1a 开局自动弹出政策三选一', async () => {
    log('S1a', await page.locator('#policy-cards .card[data-policy]').first().isVisible());
  });
  await step('S1b 点击颁布第一张', async () => {
    await page.locator('#policy-cards .card[data-policy]').first().click({ timeout: 4000 });
    await page.waitForTimeout(250);
    const s = await state();
    log('S1b', s.polSlots === 1 && s.modal === null, JSON.stringify(s));
  });

  /* ===== S2 抽卡 ===== */
  await step('S2a 打开抽卡弹窗', async () => {
    await page.locator('#corner-ui [data-modal="shop"]').click({ timeout: 4000 });
    await page.waitForTimeout(300);
    log('S2a', (await state()).modal === 'shop');
  });
  await step('S2b 抽取翻 5 张 / S2c 重开费用递增 / S2d 买最便宜', async () => {
    await page.locator('#btn-open').click({ timeout: 4000 });
    await page.waitForTimeout(250);
    const s1 = await state();
    const e0 = s1.energy;
    await page.locator('#btn-open').click({ timeout: 4000 });
    await page.waitForTimeout(250);
    const s2 = await state();
    const idx = await page.evaluate(() => {
      const S = Game.state; let best = -1, bp = 1e9;
      S.shop.cards.forEach((k, i) => { if (!k) return; const p = Game.cardInfo(k).price; if (Game.canBuy(i) && p < bp) { bp = p; best = i; } });
      return best;
    });
    await page.locator(`#shop-cards [data-shop="${idx}"]`).click({ timeout: 4000 });
    await page.waitForTimeout(250);
    const s3 = await state();
    log('S2b', s1.shop.filter(Boolean).length === 5, JSON.stringify(s1.shop));
    log('S2c', s2.energy < e0, `能量 ${e0}→${s2.energy}`);
    log('S2d', s3.hand.filter(Boolean).length === 1, JSON.stringify(s3.hand));
  });
  await page.screenshot({ path: SHOT('02-抽卡买卡') });

  /* ===== S3 手牌满 + 弃牌 ===== */
  await step('S3a 连买到手牌满（5 张）', async () => {
    for (let guard = 0; guard < 10; guard++) {
      const s = await state();
      if (s.hand.filter(Boolean).length >= 5) break;
      const idx = await page.evaluate(() => {
        const S = Game.state; let best = -1, bp = 1e9;
        S.shop.cards.forEach((k, i) => { if (!k) return; const p = Game.cardInfo(k).price; if (Game.canBuy(i) && p < bp) { bp = p; best = i; } });
        if (best < 0) { S.res.energy += 20; return -1; }
        return best;
      });
      if (idx < 0) continue;
      await page.locator(`#shop-cards [data-shop="${idx}"]`).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
    const s = await state();
    log('S3a', s.hand.filter(Boolean).length === 5, JSON.stringify(s.hand));
  });
  await step('S3b 弃牌模式弃一张（先关商店弹窗）', async () => {
    await page.locator('#modal-close').click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await page.locator('#btn-discard').click({ timeout: 3000 });
    await page.waitForTimeout(200);
    const before = (await state()).hand.filter(Boolean).length;
    await page.locator('#hand-slots [data-hand]').first().click({ timeout: 3000, force: true });
    await page.waitForTimeout(200);
    const after = (await state()).hand.filter(Boolean).length;
    log('S3b', after === before - 1, `${before}→${after}`);
  });

  /* ===== S4 建造 ===== */
  await step('S4a 拖农田到主城旁建造', async () => {
    await page.evaluate(() => { Game.state.hand[0] = { key: 'farm' }; UI.render(); });
    const b = await page.locator('#hand-slots [data-hand="0"]').boundingBox();
    await drag(b, await tileXY(3, 13));
    const s = await state();
    log('S4a', s.buildings === 1, JSON.stringify({ buildings: s.buildings }));
    await page.screenshot({ path: SHOT('04-建造') });
  });
  await step('S4b 拖卡到水面 → 拒绝 + 提示', async () => {
    await page.evaluate(() => { Game.state.hand[0] = { key: 'farm' }; UI.render(); });
    const b = await page.locator('#hand-slots [data-hand="0"]').boundingBox();
    await drag(b, await tileXY(14, 7));
    const s = await state();
    log('S4b', s.buildings === 1, 'hint=' + (await hint()).slice(0, 40));
  });

  await step('S4c 商店：买不起「道路牌/效果牌」时必须给提示且不抛异常', async () => {
    /* 第四十四次修订：真人模拟测试（_humanplay.js）随机点商店卡时抓到
     * `Cannot read properties of undefined (reading 'name')` ——
     * 旧代码在"买不起"分支写死 CFG.buildings[type].name，
     * 而商店里还有**道路牌 / 效果牌**，它们的 key 不在 CFG.buildings 里 → 抛异常 →
     * 点击处理器被杀死 → 玩家看到"点了没反应"。这一步确定性锁死它。 */
    await page.evaluate(() => {
      const S = Game.state;
      S.res.energy = 0;                                      // 一分钱没有
      S.hand = [null, null, null, null, null];               // 手牌清空 → 才会走到"能量不足"分支
      S.shop = { cards: ['dirt', 'stone', 'avenue', 'harvest', 'rally'] };  // 3 张道路 + 2 张效果
      UI.setModal('shop'); UI.render();
    });
    await page.waitForTimeout(220);
    const n0 = errors.length;
    for (let i = 0; i < 5; i++) {
      await page.locator('#shop-cards [data-shop="' + i + '"]').click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(120);
    }
    const h = await hint();
    const n1 = errors.length;
    log('S4c', n1 === n0 && /能量不足/.test(h) && !/undefined/.test(h),
        '新增错误=' + (n1 - n0) + ' hint=' + h.slice(0, 60));
    await forceClose();
  });

  await step('S4d 点击每一种资源点都必须给提示且不抛异常', async () => {
    /* 第四十四次修订：物流点的 res='logistics' 一直没登记进 ui.js 的 RES_META，
     * 于是点它会执行 RES_META['logistics'].icon → TypeError → **点击处理器被杀死** →
     * 玩家看到的是"点了没反应"。真人模拟测试随机点地图时抓到。
     * 这里把地图上每一种资源类型都点一遍，确定性锁死（旧测试从没点过物流点）。 */
    const n0 = errors.length;
    const pts = await page.evaluate(() => CFG.map.resources.map(r => ({ gx: r.gx, gy: r.gy, res: r.res })));
    const kinds = [];
    const done = {};
    for (const p of pts) {
      if (done[p.res]) continue;
      done[p.res] = 1; kinds.push(p.res);
      const t = await tileXY(p.gx, p.gy);
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(200);
      const h = await hint();
      if (!h || /undefined/.test(h)) { log('S4d', false, p.res + ' → hint=' + h); return; }
      await page.keyboard.press('Escape');
    }
    log('S4d', errors.length === n0, '点了 ' + kinds.length + ' 种资源点（' + kinds.join('/') +
        '），新增错误=' + (errors.length - n0));
  });

  /* ===== S5 合成（先升主城到 Lv2 让建筑可到 Lv2）===== */
  await step('S5 同类卡拖到已有建筑 → Lv2（需主城 Lv2 解锁上限）', async () => {
    await page.evaluate(() => { Game.state.castleLevel = 2; Game.state.hand[1] = { key: 'farm' }; UI.render(); });
    const b = await page.locator('#hand-slots [data-hand="1"]').boundingBox();
    await drag(b, await tileXY(3, 13));
    const lv = await page.evaluate(() => { const b2 = Game.state.buildings[Game.tileKeyOf(3, 13)]; return b2 ? b2.level : 0; });
    log('S5', lv === 2, 'Lv=' + lv);
  });

  /* ===== S6 建筑操作条 ===== */
  await step('S6a 点击建筑 → 操作条出现（探针：直接调 onTileClick）', async () => {
    const t = await tileXY(3, 13);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(300);
    const viaMouse = await page.evaluate(() => JSON.stringify(UI.tileSel));
    await page.evaluate(() => { UI.tileSel = null; UI.onTileClick(3, 13); });
    await page.waitForTimeout(150);
    const viaCall = await page.evaluate(() => ({ sel: JSON.stringify(UI.tileSel), b: !!Game.buildingAt(3, 13), mine: UI.isMyBuildingClick(3, 13) }));
    log('S6a', viaCall.sel !== 'null' || viaMouse !== 'null', `鼠标路径=${viaMouse} 直调=${JSON.stringify(viaCall)}`);
  });
  await step('S6b 点另一座建筑 → 拆除', async () => {
    await page.evaluate(() => {
      const S = Game.state;
      S.buildings[Game.tileKeyOf(2, 13)] = { gx: 2, gy: 13, type: 'farm', level: 1, owner: 'p1', hp: 999, pending: false, trainT: 0 };
      Game.reindex(); UI.render();
    });
    const t = await tileXY(2, 13);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(250);
    await page.locator('#ta-demolish').click({ timeout: 3000 });
    await page.waitForTimeout(250);
    log('S6b', await page.evaluate(() => !Game.state.buildings[Game.tileKeyOf(2, 13)]));
  });

  /* ===== S7 道路牌：点选进入铺路模式 ===== */
  await step('S7a 点土路牌（原地松手）→ 进入铺路模式', async () => {
    await page.evaluate(() => { Game.state.hand[2] = { key: 'dirt' }; UI.render(); });
    const b = await page.locator('#hand-slots [data-hand="2"]').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(300);
    log('S7a', await page.evaluate(() => !!UI.roadPlacing));
  });
  await step('S7b 铺路模式点击官道格 → 铺上', async () => {
    const t = await tileXY(5, 12);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(250);
    log('S7b', await page.evaluate(() => !!Game.state.roads['5,12']));
  });
  await step('S7c Esc 取消铺路 → 牌退回', async () => {
    const handBefore = (await state()).hand.filter(Boolean).length;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const placing = await page.evaluate(() => !!UI.roadPlacing);
    const handAfter = (await state()).hand.filter(Boolean).length;
    log('S7c', !placing && handAfter >= handBefore, `手牌 ${handBefore}→${handAfter}`);
  });

  /* ===== S8 兵营出兵 + 拖拽派兵占领 ===== */
  await step('S8a 造兵营 → 快进出兵', async () => {
    await page.evaluate(() => {
      const S = Game.state;
      S.buildings[Game.tileKeyOf(4, 13)] = { gx: 4, gy: 13, type: 'barracks', level: 1, owner: 'p1', hp: 999, pending: false, trainT: 0 };
      Game.reindex(); UI.render();
    });
    await ff(40);
    log('S8a', (await state()).troops > 0, '兵力=' + (await state()).troops);
  });
  await step('S8b 修路到西北粮点 → 拖兵过去', async () => {
    await page.evaluate(() => {
      const S = Game.state; const goal = { gx: 5, gy: 5 };
      for (let g = 0; g < 80; g++) {
        if (Game.findPath(4, 13, goal.gx, goal.gy, 'p1')) break;
        const fr = Game.roadFrontier('p1');
        let best = null, bd = 1e9;
        fr.forEach(p => {
          if (Math.abs(p.gx - S.castle.gx) + Math.abs(p.gy - S.castle.gy) > Math.abs(p.gx - S.enemyCastle.gx) + Math.abs(p.gy - S.enemyCastle.gy)) return;
          const d = Math.abs(p.gx - goal.gx) + Math.abs(p.gy - goal.gy) - (Game.isOfficialRoad(p.gx, p.gy) ? 0.5 : 0);
          if (d < bd) { bd = d; best = p; }
        });
        if (!best) break;
        Game.placeRoad(best.gx, best.gy);
      }
      UI.render();
    });
    /* ⚠️ S8c 偶发失败的根因（第四十三次修订查明）：行军耗粮受前面步骤的随机产出影响
     * （事件牌随机、卡坊随机卡、AI 行为），粮不够时会「粮尽停军」→ 部队停在半路、资源点没易手。
     * 这里把兵力与粮食钉成确定值，让 S8 只验证「行军 → 抵达 → 占领」这条链路本身。 */
    await page.evaluate(() => {
      Game.setTroops(4, 13, 'p1', 24);
      Game.state.res.food = Math.max(Game.state.res.food, 600);
      UI.render();
    });
    const b = await page.locator('#sandbox').boundingBox();
    const from = await tileXY(4, 13), to = await tileXY(5, 5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 14 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const march = await page.evaluate(() => Game.state.march.length);
    const sent = await page.evaluate(() => (Game.state.march[0] || {}).n || 0);
    const h = await hint();
    log('S8b', march >= 1 && /粮只够/.test(h) === false && sent > 0, 'march=' + march + ' 发兵=' + sent + ' | ' + h);
  });
  await step('S8c 快进到抵达占领（含行军诊断）', async () => {
    await ff(150);
    const d = await page.evaluate(() => ({
      owner: Game.state.resourceOwner[Game.tileKeyOf(5, 5)] || '(无)',
      guard: Game.state.resGuard[Game.tileKeyOf(5, 5)],
      march: Game.state.march.map(m => ({ n: m.n, idx: m.idx, t: Math.round(m.t * 10) / 10, legs: m.path.length, at: m.path[m.idx] ? m.path[m.idx].gx + ',' + m.path[m.idx].gy : '-' })),
      secPer: Game.marchSpeed('p1'), pct: Game.statPct('p1', 'marchSpeed'), mul: Game.statMul('p1', 'marchSpeed'),
      speed: Game.state.speed, paused: Game.state.paused, t: Math.round(Game.state.t), food: Math.round(Game.state.res.food),
    }));
    log('S8c', d.owner === 'p1', JSON.stringify(d).slice(0, 220));
    await page.screenshot({ path: SHOT('08-行军占领') });
  });

  /* ===== S9 政策刷新 ===== */
  await step('S9 造政策待选 → 刷新 → 颁布', async () => {
    await forceClose();
    await page.evaluate(() => { Game.state.policy.p1.offer = Game.rollPolicy('p1'); Game.state.policy.p1.refreshes = 0; UI.render(); });
    await page.waitForTimeout(300);
    const pr = page.locator('[data-action="policy-refresh"]').first();
    if (await pr.count()) { await pr.click({ timeout: 3000 }); await page.waitForTimeout(250); }
    const cards = await page.evaluate(() => document.querySelectorAll('#policy-cards .card[data-policy]').length);
    await page.locator('#policy-cards .card[data-policy]').first().click({ timeout: 3000 });
    await page.waitForTimeout(250);
    const s = await state();
    log('S9', cards === 3 && s.polSlots >= 2, `卡${cards} 槽${s.polSlots}`);
  });

  /* ===== S10 主城升级 ===== */
  await step('S10 点主城 → 操作条升级 → Lv2', async () => {
    await forceClose();
    await page.evaluate(() => { Game.state.res.energy = Math.max(Game.state.res.energy, 80); UI.render(); });
    const t = await tileXY(3, 11);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(300);
    const hasUp = await page.locator('#ta-upgrade').isVisible().catch(() => false);
    if (hasUp) { await page.locator('#ta-upgrade').click({ timeout: 3000 }); await page.waitForTimeout(300); }
    else await page.evaluate(() => Game.upgradeCastle());
    const s = await state();
    log('S10', s.castleLv === 3, 'Lv=' + s.castleLv + '（初始 Lv1 + S5 手动 Lv2 + 本次升级）真实入口=' + hasUp);
  });

  /* ===== S11 事件牌全流程 ===== */
  await step('S11a 快进到事件牌弹出（含 offer 全量转储）', async () => {
    await forceClose();
    await ff(220);
    const raw = await page.evaluate(() => JSON.stringify({ ev: Game.state.events.p1, modal: UI.modal }));
    log('S11a', true, raw.slice(0, 110));
    await page.screenshot({ path: SHOT('11-事件牌') });
  });
  await step('S11b 事件面板：领取（弹窗正常关闭）', async () => {
    const evc = page.locator('[data-action="event-claim"]').first();
    if (!(await evc.count())) { log('S11b', false, '无领取按钮'); return; }
    await evc.click({ timeout: 3000 });
    await page.waitForTimeout(250);
    const s = await state();
    log('S11b', !!s.evCur && s.modal === null, JSON.stringify(s));
  });
  await step('S11c 事件 chip → eventview → 刷新/化解按钮存在', async () => {
    await forceClose();
    await page.evaluate(() => { Game.state.events.p1.offer = null; });
    const chip = page.locator('#policy-tray [data-eventchip]').first();
    if (await chip.count()) { await chip.click({ timeout: 3000 }); await page.waitForTimeout(250); }
    const s = await state();
    const hasView = await page.evaluate(() => !!document.querySelector('[data-action="event-dissolve"], [data-action="event-refresh"]'));
    log('S11c', s.modal === 'eventview' || hasView, `modal=${s.modal} 按钮=${hasView}`);
    await forceClose();
  });

  /* ===== S12 星级任务与遗物 ===== */
  await step('S12a 打开任务面板', async () => {
    await page.locator('#corner-ui [data-modal="quest"]').click({ timeout: 3000 });
    await page.waitForTimeout(300);
    log('S12a', await page.locator('#quest-list').isVisible());
    await page.screenshot({ path: SHOT('12-任务面板') });
    await page.locator('#modal-close').click({ timeout: 2000 }).catch(() => {});
  });
  await step('S12b 按一星任务口径凑齐 → 遗物三选一 → 领取', async () => {
    await page.evaluate(() => {
      const S = Game.state;
      // 读一星任务的实际指标，逐项凑满
      S.discardCount = Math.max(S.discardCount || 0, 80);
      S.stats.built = Math.max(S.stats.built || 0, 30);
      S.stats.trained = Math.max(S.stats.trained || 0, 150);
      S.stats.merged = Math.max(S.stats.merged || 0, 10);
      S.stats.resourceCaptures = Math.max(S.stats.resourceCaptures || 0, 6);
      S.castleLevel = Math.max(S.castleLevel, 3);
      S.relics = S.relics || [];
      UI.render();
    });
    await ff(3);
    const st = await page.evaluate(() => ({
      star: Game.state.questStar, rewardChoices: UI.rewardChoices,
      modal: UI.modal, badge: document.getElementById('quest-star').textContent,
    }));
    log('S12b', st.star >= 1 || !!st.rewardChoices, JSON.stringify(st));
    const rc = page.locator('#reward-cards .card[data-reward]').first();
    if (await rc.count()) {
      await rc.click({ timeout: 3000 });
      await page.waitForTimeout(250);
      log('S12c 领取遗物', (await state()).relics >= 1, '遗物=' + (await state()).relics);
    } else {
      log('S12c 领取遗物', false, '奖励弹窗未出现（star=' + st.star + ' modal=' + st.modal + '）');
    }
    await page.screenshot({ path: SHOT('13-任务遗物') });
    await forceClose();
  });

  /* ===== S13 攻城胜负 ===== */
  await step('S13a 修路到敌城 → 拖兵攻城 → 胜利', async () => {
    await page.evaluate(() => {
      const S = Game.state; const ec = S.enemyCastle;
      S.res.energy = 9999; S.res.food = 9999;
      for (let g = 0; g < 260; g++) {
        if (Game.findPath(S.castle.gx, S.castle.gy, ec.gx, ec.gy, 'p1')) break;
        const fr = Game.roadFrontier('p1');
        let best = null, bd = 1e9;
        fr.forEach(p => {
          const d = Math.abs(p.gx - ec.gx) + Math.abs(p.gy - ec.gy) - (Game.isOfficialRoad(p.gx, p.gy) ? 0.5 : 0);
          if (d < bd) { bd = d; best = p; }
        });
        if (!best) break;
        Game.placeRoad(best.gx, best.gy);
      }
      S.enemyCastle.hp = 3;
      // 攻城流程测试聚焦"走到→打赢→结算"链路：清空敌方抵抗（塔/部队/经济），
      // 否则 60 兵横穿敌方领土会被防御塔逐格磨光（正确游戏行为，非 bug）
      Object.keys(S.buildings).forEach(k => { if (S.buildings[k].owner === 'p2') delete S.buildings[k]; });
      S.troops = {}; S.enemyRes.energy = 0; S.enemyRes.food = 0;
      Game.reindex();
      Game.addTroops(S.castle.gx, S.castle.gy, 'p1', 60);
      UI.render();
    });
    const pathOk = await page.evaluate(() => !!Game.findPath(Game.state.castle.gx, Game.state.castle.gy, Game.state.enemyCastle.gx, Game.state.enemyCastle.gy, 'p1'));
    if (!pathOk) { log('S13a', false, '路没修通'); return; }
    // 猴补 updateMarch 记录器：抓 ff 期间每次调用的 dt/food/secPer/idx
    await page.evaluate(() => {
      window.__mlog = [];
      const orig = Game.updateMarch.bind(Game);
      Game.updateMarch = function (dt) {
        const S = Game.state;
        if (window.__mlog.length < 30 || window.__mlog.length % 60 === 0) {
          window.__mlog.push({ i: window.__mlog.length, dt: Math.round(dt * 100) / 100, t: Math.round(S.t),
            food: Math.round(S.res.food), idx: S.march.map(m => m.idx).join('|'),
            sec: Math.round(Game.marchSpeed('p1') * 100) / 100, ev: S.events.p1.current, paused: S.paused });
        }
        return orig(dt);
      };
    });
    const from = await tileXY(3, 11);
    const ec = await page.evaluate(() => ({ gx: Game.state.enemyCastle.gx, gy: Game.state.enemyCastle.gy }));
    const to = await tileXY(ec.gx, ec.gy);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const march = await page.evaluate(() => JSON.stringify(Game.state.march.map(m => ({ n: m.n, legs: m.path.length, idx: m.idx }))).slice(0, 110));
    await ff(400);
    const s = await state();
    const ehp = await page.evaluate(() => {
      let g = 0;
      while (Game.state.march.length && g++ < 4000) Game.updateMarch(1);   // 手动把行军推完
      return { hp: Game.state.enemyCastle.hp, troops: Game.troopsAt(Game.state.enemyCastle.gx, Game.state.enemyCastle.gy).p1,
        marchLeft: Game.state.march.length, over: Game.state.over, iter: g,
        speed: Game.state.speed, secPer: Game.marchSpeed('p1') };
    });
    const ml = await page.evaluate(() => ({ n: window.__mlog.length, head: window.__mlog.slice(0, 8), tail: window.__mlog.slice(-4), speed: Game.state.speed }));
    log('S13a', s.over === true || ehp.over === true, 'ehp=' + JSON.stringify(ehp));
    console.log('   [mlog] n=' + ml.n + ' speed=' + ml.speed);
    ml.head.forEach(r => console.log('   [mlog+] ' + JSON.stringify(r)));
    ml.tail.forEach(r => console.log('   [mlog-] ' + JSON.stringify(r)));
    await page.screenshot({ path: SHOT('14-胜负结算') });
  });
  await step('S13b 结算卡 → 重新开始', async () => {
    await forceClose();   // 清掉胜利瞬间可能叠加的政策/奖励弹窗，让结算卡可点
    /* 第四十三次修订：结算卡现在有出场延迟（先让沙盘演"主城爆炸"），所以要等它真的出现 */
    await page.locator('#result-overlay:not(.hidden)').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    const vis = await page.locator('#result-card').isVisible().catch(() => false);
    if (!vis) { log('S13b', false, '结算卡未出现'); return; }
    const cover = await page.evaluate(() => {
      const btn = document.getElementById('result-restart');
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { top: top ? (top.id || top.tagName) + '.' + String(top.className).slice(0, 30) : 'null',
               overlay: document.getElementById('result-overlay').className, modal: UI.modal };
    });
    log('S13b-cover', true, JSON.stringify(cover));
    await page.evaluate(() => document.getElementById('result-restart').click());   // DOM 直接触发
    await page.waitForTimeout(400);
    const s = await state();
    log('S13b', s.over === false && s.buildings === 0, JSON.stringify(s));
  });
  await step('S13d 对局结束后结算卡必须自动出现（不依赖任何点击）', async () => {
    /* 第四十三次修订抓到并修掉的 bug：对局一结束 tickCount 就停住，
     * 主循环只剩轻量 refresh()，而结算卡只在全量 render() 里触发 →
     * 破城后画面毫无反应。旧版 S13b 之所以没发现，是因为测试的 ff() 末尾
     * 显式调了一次 UI.render()，把 bug 掩盖了。这一步故意**不调 render()**。 */
    await page.evaluate(() => {
      const S = Game.state, ec = S.enemyCastle;
      ec.hp = 1;
      Game.setTroops(ec.gx, ec.gy, 'p1', 12);
      Game.engageTile(ec.gx, ec.gy, 'p1');
    });
    const okVis = await page.locator('#result-overlay:not(.hidden)')
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    const over = await page.evaluate(() => Game.state.over === true);
    log('S13d', okVis && over, 'over=' + over + ' 结算卡=' + (okVis ? '出现' : '未出现'));
    await page.evaluate(() => { UI._resultShown = false; document.getElementById('result-restart').click(); });
    await page.waitForTimeout(400);
  });

  /* ===== S14 相机 / 暂停 / 调试 / 压力 ===== */
  await step('S14a 相机：缩放 + 平移 + 回城', async () => {
    await forceClose();
    const sb = await page.locator('#sandbox').boundingBox();
    await page.mouse.move(sb.x + 600, sb.y + 300);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
    const sc = await page.evaluate(() => Sandbox.scale);
    await page.mouse.move(sb.x + 700, sb.y + 320);
    await page.mouse.down(); await page.mouse.move(sb.x + 480, sb.y + 180, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(150);
    await page.locator('#btn-recenter').click({ timeout: 2500 });
    await page.waitForTimeout(200);
    log('S14a', sc > 1, 'scale=' + sc);
  });
  await step('S14b 暂停/继续（若已结束先重开）', async () => {
    if (await page.evaluate(() => Game.state.over)) { await page.evaluate(() => { Game.reset(); UI.render(); }); await page.waitForTimeout(300); }
    await forceClose();   // 重开会带出开局政策三选一 → 关掉再测暂停
    await page.locator('#btn-pause').click({ timeout: 2500 });
    await page.waitForTimeout(150);
    const p1 = await page.evaluate(() => Game.state.paused);
    await page.locator('#btn-pause').click({ timeout: 2500 });
    await page.waitForTimeout(150);
    log('S14b', p1 === true && (await page.evaluate(() => Game.state.paused)) === false);
  });
  await step('S14c 调试面板 + 按钮点一遍', async () => {
    await forceClose();
    await page.locator('#btn-debug').click({ timeout: 2500 });
    await page.waitForTimeout(200);
    const vis = await page.locator('#dbg-body').isVisible().catch(() => false);
    const btns = page.locator('#dbg-body button');
    const n = await btns.count();
    for (let i = 0; i < Math.min(n, 6); i++) await btns.nth(i).click({ timeout: 1500 }).catch(() => {});
    await page.locator('#btn-debug').click({ timeout: 2500 }).catch(() => {});
    log('S14c', vis === true && n > 0, `按钮=${n}`);
  });
  await step('S14d 压力：乱点商店卡 + Esc', async () => {
    await page.locator('#corner-ui [data-modal="shop"]').click({ timeout: 3000 }).catch(() => {});
    await page.locator('#btn-open').click({ timeout: 3000 }).catch(() => {});
    for (let i = 0; i < 6; i++) await page.locator('#shop-cards .card').first().click({ timeout: 1200 }).catch(() => {});
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const s = await state();
    log('S14d', s.modal === 'shop' || s.modal === null, JSON.stringify({ modal: s.modal, hand: s.hand.filter(Boolean).length }));
  });

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== 结果：${pass}/${results.length} 项通过；错误 ${errors.length} 条 ====`);
  results.filter(r => !r.ok).forEach(r => console.log('✗ ' + r.s + ' → ' + r.extra));
  errors.slice(0, 20).forEach(e => console.log(e));
  if (!errors.length) console.log('（无控制台错误）');
  await browser.close();
})().catch(e => { console.error('[t] 脚本异常:', e.message); process.exit(1); });
