/* _humanplay.js —— 真人模拟实机测试（第四十四次修订新增）
 *
 * 运行：NODE_PATH=... node test/_humanplay.js [局数=1] [倍速=4] [目标游戏秒=1800]
 *
 * 与 fulltest 的区别：fulltest 走的是"验证过的固定剧本"，本脚本**不预设剧本**——
 * 它像一个没看过攻略的玩家那样，靠读界面和提示决定下一步，并且**只用真实鼠标事件**
 * （点、拖、滚轮、平移），绝不直接调 Game.xxx 去推进游戏。
 *
 * 自动盯这几类问题：
 *   ① 控制台 / 页面异常
 *   ② **死点击**：点了之后状态与提示文案都没变（既没生效、也没给出反馈）
 *   ③ 提示与行为矛盾：提示说"出发了"但 march 是空的之类
 *   ④ 卡死：连续 N 拍状态毫无变化
 *   ⑤ 结算卡是否自动出现（第四十三次修订修过的那个 bug 的回归）
 */
const { chromium } = require('playwright-core');
const CHROME = 'C:/Users/123/.agent-browser/browsers/chrome-154.0.8037.57/chrome.exe';
const URL = 'http://127.0.0.1:8124/index.html';
const OUT = 'D:/工程/自研/图片素材/美术风格测试/';

const SESSIONS = parseInt(process.argv[2] || '1', 10);
const SPEED = parseInt(process.argv[3] || '4', 10);
const TARGET_T = parseInt(process.argv[4] || '1800', 10);

const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let page;
const problems = [];
function note(kind, msg) { problems.push(kind + ' | ' + msg); console.log('   ⚠ ' + kind + ' | ' + msg); }

const digest = () => page.evaluate(() => {
  const S = Game.state;
  return JSON.stringify({
    t: Math.round(S.t), e: Math.round(S.res.energy), f: Math.round(S.res.food),
    b: Object.keys(S.buildings).length, troops: Game.totalTroops('p1'),
    lv: S.castleLevel, hand: S.hand.filter(Boolean).length, roads: Object.keys(S.roads).length,
    march: S.march.length, over: S.over, modal: UI.modal,
    hint: document.getElementById('hint').textContent.trim().slice(0, 40),
  });
});
const st = () => page.evaluate(() => {
  const S = Game.state;
  return {
    t: Math.round(S.t), e: Math.round(S.res.energy), f: Math.round(S.res.food),
    b: Object.keys(S.buildings).length, troops: Game.totalTroops('p1'),
    lv: S.castleLevel, hand: S.hand.filter(Boolean).length, march: S.march.length,
    over: S.over, modal: UI.modal, road: Object.keys(S.roads).length,
    star: S.questStar || 0, relics: (S.relics || []).length, polSlots: S.policy.p1.slots.length,
    polOffer: !!(S.policy.p1.offer && S.policy.p1.offer.length),
    evOffer: S.events.p1.offer, quest: S.questClaiming, res: !!S.result,
  };
});
const hint = () => page.evaluate(() => document.getElementById('hint').textContent.trim());
const closeModal = async () => {
  const m = await page.evaluate(() => UI.modal);
  if (m && m !== 'event') { await page.locator('#modal-close').click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(120); }
};
const tileXY = (gx, gy) => page.evaluate(([x, y]) => {
  const r = Sandbox.tileRect(x, y);
  const cv = document.getElementById('sandbox').getBoundingClientRect();
  const k = cv.width / document.getElementById('sandbox').offsetWidth;
  return { x: cv.left + (r.x + r.w / 2) * k, y: cv.top + (r.y + r.h / 2) * k };
}, [gx, gy]);
/** 在视口内的随机格点（模拟人乱点/平移） */
const randomTile = () => page.evaluate(() => {
  const S = Game.state;
  return { gx: Math.floor(Math.random() * CFG.map.cols), gy: Math.floor(Math.random() * CFG.map.rows) };
});

/* ---------------- 单个"人"的决策 ---------------- */

/** 阻塞式弹窗必须先处理（真人也是先关弹窗） */
async function handleBlocking() {
  const s = await st();
  if (s.res) return 'result';
  if (s.quest) {
    const c = await page.locator('#reward-cards .card[data-reward]').count().catch(() => 0);
    if (c) { await page.locator('#reward-cards .card[data-reward]').first().click({ timeout: 2000 }).catch(() => {}); return 'claim-reward'; }
  }
  if (s.evOffer) {
    const b = await page.locator('[data-action="event-claim"]').count().catch(() => 0);
    if (b) { await page.locator('[data-action="event-claim"]').first().click({ timeout: 2000 }).catch(() => {}); return 'claim-event'; }
  }
  if (s.polOffer) {
    const c = await page.locator('#policy-cards .card[data-policy]').count().catch(() => 0);
    if (c) { await page.locator('#policy-cards .card[data-policy]').nth(RI(0, c - 1)).click({ timeout: 2000 }).catch(() => {}); return 'pick-policy'; }
  }
  return null;
}

/** 挑一个"看起来合理"的动作；返回动作名，null = 没什么可做（发呆/看地图） */
async function act() {
  const s = await st();

  /* ---- 手牌里的建筑卡：点它进放置模式，再点一个合法格（模拟真人点选建造） ---- */
  const buildCards = await page.evaluate(() => {
    const out = [];
    Game.state.hand.forEach((c, i) => {
      if (!c) return;
      const info = Game.cardInfo(c.key);
      if (info && info.kind === 'building') out.push({ i: i, key: c.key });
    });
    return out;
  });
  if (buildCards.length && Math.random() < 0.45) {
    const c = pick(buildCards);
    await page.locator('#hand-slots [data-hand="' + c.i + '"]').click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(200);
    const spot = await page.evaluate((key) => {
      const cands = [];
      for (let gy = 0; gy < CFG.map.rows; gy++) for (let gx = 0; gx < CFG.map.cols; gx++) {
        if (Game.canBuildAt(key, gx, gy)) cands.push({ gx: gx, gy: gy });
      }
      return cands.length ? cands[Math.floor(Math.random() * Math.min(cands.length, 8))] : null;
    }, c.key);
    if (spot) {
      const p = await tileXY(spot.gx, spot.gy);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(260);
      return 'build:' + c.key;
    }
    await page.keyboard.press('Escape');
    return 'build-abort:' + c.key;   // 手里有卡却找不到可建格 → 值得记录
  }

  /* ---- 出兵：把一支部队拖到资源点/敌建（真人最常见的进攻操作） ---- */
  if (s.troops > 0 && Math.random() < 0.30) {
    const t = await page.evaluate(() => {
      const S = Game.state;
      const from = Object.keys(S.troops).filter(k => (S.troops[k] || {}).p1 > 0);
      if (!from.length) return null;
      const f = from[Math.floor(Math.random() * from.length)].split(',').map(Number);
      const cands = [];
      CFG.map.resources.forEach(r => cands.push({ gx: r.gx, gy: r.gy }));
      cands.push({ gx: S.enemyCastle.gx, gy: S.enemyCastle.gy });
      Object.keys(S.buildings).forEach(k => { const b = S.buildings[k]; if ((b.owner || 'p1') === 'p2') cands.push({ gx: b.gx, gy: b.gy }); });
      let best = null;
      cands.forEach(c => { if (!best && Game.findPath(f[0], f[1], c.gx, c.gy, 'p1')) best = c; });
      if (!best) best = cands[0];
      return { fx: f[0], fy: f[1], tx: best.gx, ty: best.gy };
    });
    if (t) {
      const a = await tileXY(t.fx, t.fy), b = await tileXY(t.tx, t.ty);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 12 }); await page.waitForTimeout(120);
      await page.mouse.up(); await page.waitForTimeout(280);
      return 'march';
    }
  }

  /* ---- 抽卡 + 买卡 ---- */
  if (s.e < 12 && Math.random() < 0.5) {
    await page.locator('#corner-ui [data-modal="shop"]').click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(260);
    const open = await page.locator('#btn-open').isEnabled().catch(() => false);
    if (open && s.hand < 5) { await page.locator('#btn-open').click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(320); }
    const cards = await page.locator('#shop-cards .card').count().catch(() => 0);
    if (cards && s.hand < 5) {
      await page.locator('#shop-cards .card').nth(RI(0, cards - 1)).click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    await closeModal();
    return 'shop';
  }

  /* ---- 升主城（凑够能量时） ---- */
  if (s.e >= 40 && s.lv < 5 && Math.random() < 0.35) {
    const c = await page.evaluate(() => ({ gx: Game.state.castle.gx, gy: Game.state.castle.gy }));
    const p = await tileXY(c.gx, c.gy);
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
    const vis = await page.locator('#ta-upgrade').isVisible().catch(() => false);
    if (vis) { await page.locator('#ta-upgrade').click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(320); return 'upgrade-castle'; }
    return null;   // 点了主城却没出操作条 → 值得记录
  }

  /* ---- 铺路 ---- */
  const roadCards = await page.evaluate(() => {
    const out = [];
    Game.state.hand.forEach((c, i) => { if (c && String(c.key).indexOf('road') >= 0) out.push(i); });
    return out;
  });
  if (roadCards.length && Math.random() < 0.25) {
    await page.locator('#hand-slots [data-hand="' + pick(roadCards) + '"]').click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(200);
    const spot = await page.evaluate(() => {
      const fr = Game.roadFrontier('p1');
      return fr.length ? fr[Math.floor(Math.random() * Math.min(fr.length, 6))] : null;
    });
    if (spot) { const p = await tileXY(spot.gx, spot.gy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(240); return 'road'; }
    await page.keyboard.press('Escape');
    return null;
  }

  /* ---- 逛一逛：看任务 / 牌库（真人会点开看看） ---- */
  if (Math.random() < 0.18) {
    const which = Math.random() < 0.5 ? 'quest' : 'pool';
    await page.locator('#corner-ui [data-modal="' + which + '"]').click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(R(300, 700));
    await closeModal();
    return 'browse:' + which;
  }

  /* ---- 乱动：平移 / 缩放 / 点空地（真人手不会停） ---- */
  const sb = await page.locator('#sandbox').boundingBox();
  const r = Math.random();
  if (r < 0.35) {
    await page.mouse.move(sb.x + sb.width * R(0.3, 0.7), sb.y + sb.height * R(0.3, 0.7));
    await page.mouse.wheel(0, pick([-180, 180]));
    await page.waitForTimeout(140); return 'zoom';
  } else if (r < 0.65) {
    await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width * R(0.3, 0.8), sb.y + sb.height * R(0.3, 0.8), { steps: 8 });
    await page.mouse.up(); await page.waitForTimeout(140); return 'pan';
  }
  const t2 = await randomTile();
  const p2 = await tileXY(t2.gx, t2.gy);
  if (p2.y > sb.y + 40 && p2.y < sb.y + sb.height - 10) { await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(160); return 'click-empty'; }
  return null;
}

/* ---------------- 一局 ---------------- */

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  for (let n = 1; n <= SESSIONS; n++) {
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = [];
    page.on('pageerror', e => errs.push('[pageerror] ' + e.message + '\n      ' + String(e.stack || '').split('\n').slice(1, 4).join('\n      ')));
    page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
    await page.goto(URL + '?v=' + Date.now(), { waitUntil: 'load' });
    await page.waitForTimeout(2600);

    console.log('\n===== 第 ' + n + ' 局（真人模拟 · ' + SPEED + ' 倍速）=====');
    /* 真人开局：点主界面「开始游戏」 */
    const menuBtn = page.locator('#menu-btns button[data-act="start"]');
    if (await menuBtn.isVisible().catch(() => false)) { await menuBtn.click({ timeout: 3000 }); await page.waitForTimeout(1200); }
    /* 倍速（真人可在主界面「设置」里选 1/2/4，这里直接设状态值） */
    await page.evaluate((sp) => { Game.state.speed = sp; }, SPEED);

    const beats = [];
    let lastDigest = '', sameCount = 0, beats_total = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 1000 * 60 * 12) {
      const s = await st();
      if (s.res) break;
      const d0 = await digest();
      let action = await handleBlocking();
      if (!action) action = await act();
      const d1 = await digest();
      const s1 = await st();
      beats_total++;
      /* 死点击：状态没变、提示也没变 */
      if (d0 === d1 && action && action !== 'zoom' && action !== 'pan') {
        note('死点击', '动作=' + action + ' 状态与提示都没变 | ' + d1);
      }
      /* 连续无变化 → 可能卡死 */
      if (d0 === d1) { sameCount++; if (sameCount === 40) note('疑似卡死', '连续 40 拍状态无变化 | ' + d1); }
      else sameCount = 0;
      if (action) beats.push(action);
      lastDigest = d1;
      await page.waitForTimeout(R(160, 420));
      if (s1.t >= TARGET_T) break;
    }

    const end = await st();
    /* 结算卡是否自动出现（回归第四十三次修订的 bug） */
    let resultShown = false;
    if (end.over) {
      resultShown = await page.locator('#result-overlay:not(.hidden)')
        .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
      if (!resultShown) note('结算卡', '对局已结束但结算卡没出现');
      else await page.screenshot({ path: OUT + '真人模拟-结算-' + n + '.png' });
    }
    if (errs.length) errs.forEach(e => note('控制台', e));

    const tally = beats.reduce((o, a) => { const k = a.split(':')[0]; o[k] = (o[k] || 0) + 1; return o; }, {});
    console.log('   拍到 ' + beats_total + ' 拍 · 终局 t=' + end.t + 's 建筑=' + end.b + ' 兵=' + end.troops +
                ' 主城Lv' + end.lv + ' 道路=' + end.road + ' 星=' + end.star + ' 遗物=' + end.relics +
                ' 政策=' + end.polSlots + ' over=' + end.over + ' 结算卡=' + resultShown);
    console.log('   动作分布: ' + JSON.stringify(tally));
    await page.close();
  }
  console.log('\n===== 问题汇总：' + problems.length + ' 条 =====');
  problems.slice(0, 40).forEach(p => console.log('  ' + p));
  await browser.close();
  process.exit(0);
})();
