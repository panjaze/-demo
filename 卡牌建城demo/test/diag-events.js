/* 新系统数值诊断（第二十次修订）—— 政策 / 事件牌 / 星级任务 / 兜底计分 E 项
 *
 * 用法：node test/diag-events.js [局数=20] [窗口秒=2400] [模式]
 *   模式 all      = 现状（默认）
 *         noevent = 关闭事件牌（startAt 置无穷，看事件对 AI/玩家的影响）
 *         noquest = E 项计分清零（看星级任务对结算的影响）
 *         nopolicy= 脚本玩家不领政策（看政策对玩家节奏的贡献；AI 照常）
 *
 * 输出：政策节奏与品质 / 事件代价分布 / 任务瓶颈 / E 项与胜负关联
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..', 'js') + path.sep;
const ctx = { console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error, Set };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
['config.js', 'game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx);
});
const { CFG, Game } = ctx;

const ROUNDS = parseInt(process.argv[2] || '20', 10);
const WINDOW = parseInt(process.argv[3] || '2400', 10);
const MODE = process.argv[4] || 'all';

/* 模式开关 */
if (MODE === 'noevent') CFG.events.startAt = 1e9;
if (MODE === 'noquest') CFG.quests.scorePerStar = 0;

const acc = {
  // 政策
  polCount: [], polTiers: { 0: 0, 1: 0, 2: 0 }, pol5Time: [],
  // 事件
  evCount: [], evMixMe: 0, evBadMe: 0, evMixAI: 0, evBadAI: 0,
  // 任务
  q1: [], q2: [], q3: [], qDone: [],
  bottleneck: {},                       // 三星各项达标时刻（找卡脖子的任务）
  /** 终局时每个任务项的最终值（第四十四次修订新增）——
   *  上面的 bottleneck 只在三星真正达成时才记录，所以门槛定得太高时它永远打不出东西。
   *  这里无条件下记录终局值，用来判断"门槛该定在分布的第几分位"。 */
  qEnd: {},
  // 结算
  win: 0, lose: 0, draw: 0,
  E_win: [], E_lose: [], scoreWin: [], scoreLose: [],
  endHpMe: [],
};

for (let g = 0; g < ROUNDS; g++) {
  Game.reset();
  const S = () => Game.state;
  let keep = null;
  const RESERVE = 12;
  let q1 = 0, q2 = 0, q3 = 0;
  let polPicks = 0, pol5 = 0;

  for (let t = 0; t < WINDOW; t++) {
    /* ---- 玩家策略（与 balance-report 同一套） ---- */
    if (t % 10 === 0 && S().res.energy >= CFG.cards.roads.dirt.price) {
      const freeR = CFG.map.resources.filter(function (r) {
        return S().resourceOwner[r.gx + ',' + r.gy] !== 'p1';
      });
      const goal = (t > 700 || freeR.length === 0) ? S().enemyCastle
        : freeR.reduce(function (a, b) {
          return (Math.abs(a.gx - S().castle.gx) + Math.abs(a.gy - S().castle.gy)) <
                 (Math.abs(b.gx - S().castle.gx) + Math.abs(b.gy - S().castle.gy)) ? a : b;
        });
      let best = null, bestD = 1e9;
      Game.roadFrontier('p1').forEach(function (p) {
        const d = Math.abs(p.gx - goal.gx) + Math.abs(p.gy - goal.gy);
        if (d < bestD) { bestD = d; best = { gx: p.gx, gy: p.gy }; }
      });
      if (best) { S().res.energy -= CFG.cards.roads.dirt.price; Game.placeRoad(best.gx, best.gy); }
    }

    Game.update(1);

    /* ★ 第四十四次修订：脚本玩家也要会升主城。
     * 旧脚本从不升本 → 终局主城等级 P50 恒为 1 → 所有「主城升到 LvN」的任务项必然失败，
     * 星级诊断结果被严重低估（真实玩家会升本，真人模拟里主城能到 Lv5）。
     * 现实策略：留一点余量（够开牌+买卡）就升本。 */
    if (S().res.energy >= 6 && !S().over) {
      const cu = Game.castleUpgradeCost();
      if (cu && cu.energy && S().res.energy >= cu.energy + 6) {
        Game.upgradeCastle();
        if (S().policy.p1.offer && MODE !== 'nopolicy') {   // 升本会触发政策三选一，顺手领掉
          const off2 = S().policy.p1.offer;
          let pk = 0;
          for (let i = 0; i < off2.length; i++) {
            if (CFG.policy.list[off2[i].key].school === S().policy.p1.school) { pk = i; break; }
          }
          Game.chooseOffer(pk); polPicks++;
        }
      }
    }

    // 买卡（真人式：开牌、挑建筑卡、没好卡刷新）
    if (!S().shop && S().res.energy >= 8 && S().hand.indexOf(null) >= 0) Game.openShop();
    if (S().shop) {
      const cards = S().shop.cards;
      const wantFirst = Game.typeCount('barracks') === 0 ? 'barracks'
                      : (Game.typeCount('farm') < 2 ? 'farm'
                      : (Game.typeCount('power') < 2 ? 'power' : null));
      const bIdxs = cards.map(function (k, i) {
        return (k && Game.cardInfo(k).kind === 'building') ? i : -1;
      }).filter(function (i) { return i >= 0; })
        .sort(function (a, b) {
          return Game.cardInfo(cards[a]).price - Game.cardInfo(cards[b]).price;
        });
      let picked = -1;
      for (const i of bIdxs) {
        if (wantFirst && cards[i] === wantFirst) { picked = i; break; }
      }
      if (picked < 0 && bIdxs.length) picked = bIdxs[0];
      if (picked >= 0 && Game.cardInfo(cards[picked]).price <= S().res.energy - 4) {
        Game.buyCard(picked);
      } else if (S().res.energy >= 24) {
        Game.openShop();
      }
    }
    S().hand.forEach(function (h, i) {
      if (!h) return;
      const info = Game.cardInfo(h.key);
      if (!info || info.kind !== 'building') return;
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          if (Game.build(i, gx, gy)) return;
        }
      }
    });

    // §19 政策：脚本按流派偏好领取（nopolicy 模式则故意不领）
    if (S().policy.p1.offer && MODE !== 'nopolicy') {
      const off = S().policy.p1.offer;
      let pick = 0;
      for (let i = 0; i < off.length; i++) {
        if (CFG.policy.list[off[i].key].school === S().policy.p1.school) { pick = i; break; }
      }
      Game.chooseOffer(pick);
      polPicks++;
      if (S().policy.p1.slots.length >= 1 && !pol5 && polPicks >= 5) pol5 = t;
    }

    // §20 事件牌：脚本无脑领取（模拟不刷的普通玩家）
    if (S().events.p1.offer) Game.claimEvent('p1');
    // §21 任务奖励
    if (S().questClaiming) {
      const rk = Object.keys(CFG.relics);
      Game.pickQuestReward(rk[Math.floor(Math.random() * rk.length)]);
    }

    if (t % 10 === 0) {
      const cu = Game.castleUpgradeCost();
      if (cu && S().res.energy >= cu.energy + 20) Game.upgradeCastle();
    }

    // 手牌管理（真人式：先弃非建筑卡，再弃最贵建筑卡）
    if (t % 10 === 5 && S().hand.indexOf(null) < 0) {
      const junk = S().hand.findIndex(function (h) {
        return h && Game.cardInfo(h.key).kind !== 'building';
      });
      if (junk >= 0) { Game.discard(junk); }
      else {
        let worst = -1, worstPrice = -1;
        S().hand.forEach(function (h, i) {
          if (!h) return;
          const info = Game.cardInfo(h.key);
          if (info && info.kind === 'building' && info.price > worstPrice) {
            worstPrice = info.price; worst = i;
          }
        });
        if (worst < 0 && S().hand[0]) worst = 0;
        if (worst >= 0) Game.discard(worst);
      }
    }

    // 效果牌即时使用（真人不会让丰收/征召烂在手里）
    S().hand.forEach(function (h, i) {
      if (!h) return;
      const info = Game.cardInfo(h.key);
      if (!info || info.kind !== 'effect') return;
      if (S().res.energy < info.price + 4) return;
      if (info.eff === 'gain' || info.eff === 'burst' || info.eff === 'boost' ||
          info.eff === 'draw' || info.eff === 'slot') {
        if (Game.canPlayEffect(i)) Game.playEffect(i);
      }
    });

    // 抢点
    if (t % 5 === 0) {
      const free = CFG.map.resources.filter(function (r) {
        return S().resourceOwner[r.gx + ',' + r.gy] !== 'p1';
      });
      if (free.length) {
        const own = [];
        for (const k in S().troops) {
          const n = S().troops[k].p1;
          if (!n) continue;
          const p = k.split(',');
          if (Game.isMarchOccupied(+p[0], +p[1], 'p1')) continue;
          own.push({ gx: +p[0], gy: +p[1], n: n });
        }
        const src = own.sort(function (a, b) {
          return (Math.abs(a.gx - S().castle.gx) + Math.abs(a.gy - S().castle.gy)) -
                 (Math.abs(b.gx - S().castle.gx) + Math.abs(b.gy - S().castle.gy));
        })[0];
        if (src && Game.troopsAt(src.gx, src.gy).p1 >= 12) {
          const goal = free.reduce(function (a, b) {
            return (Math.abs(a.gx - src.gx) + Math.abs(a.gy - src.gy)) <
                   (Math.abs(b.gx - src.gx) + Math.abs(b.gy - src.gy)) ? a : b;
          });
          const p = Game.findPath(src.gx, src.gy, goal.gx, goal.gy, 'p1');
          if (p) {
            const nn = Game.troopsAt(src.gx, src.gy).p1;
            Game.setTroops(src.gx, src.gy, 'p1', 0);
            S().march.push({ side: 'p1', n: nn, path: p, idx: 0, t: 0, spent: 0 });
          }
        }
      }
    }

    // 集结 + 总攻（留守 RESERVE）
    if (t % 5 === 0 && t > 120) {
      const stacks = [];
      for (const k in S().troops) {
        const n = S().troops[k].p1;
        if (!n) continue;
        const p = k.split(',');
        if (Game.isMarchOccupied(+p[0], +p[1], 'p1')) continue;
        stacks.push({ gx: +p[0], gy: +p[1], n: n });
      }
      let muster = null, mn = 0;
      if (keep) stacks.forEach(function (x) {
        if (x.gx === keep.gx && x.gy === keep.gy) { muster = x; mn = x.n; }
      });
      if (!muster) stacks.forEach(function (x) { if (x.n > mn) { mn = x.n; muster = x; } });
      const inFlight = function (gx, gy) {
        return S().march.some(function (m) {
          const c = m.path[m.idx] || m.path[0];
          return c.gx === gx && c.gy === gy;
        });
      };
      if (stacks.length > 1) {
        stacks.forEach(function (x) {
          if (x === muster || inFlight(x.gx, x.gy)) return;
          if (x.n <= RESERVE && keep && x.gx === keep.gx && x.gy === keep.gy) return;
          if (x.n < CFG.enemy.musterMin) return;
          const p = Game.findPath(x.gx, x.gy, muster.gx, muster.gy, 'p1');
          if (p) {
            Game.setTroops(x.gx, x.gy, 'p1', 0);
            S().march.push({ side: 'p1', n: x.n, path: p, idx: 0, t: 0, spent: 0 });
          }
        });
      }
      if (muster && mn - RESERVE >= 25 && !inFlight(muster.gx, muster.gy)) {
        let target = null, p = null;
        p = Game.findPath(muster.gx, muster.gy, S().enemyCastle.gx, S().enemyCastle.gy, 'p1');
        if (p) target = S().enemyCastle;
        if (!target) {
          let best = null, bestD = 1e9;
          Game.enemyBuildings().forEach(function (b) {
            const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (o) {
              return Game.walkable(b.gx + o[0], b.gy + o[1], 'p1');
            });
            if (!adj) return;
            const d = Math.abs(b.gx - muster.gx) + Math.abs(b.gy - muster.gy);
            if (d < bestD) { bestD = d; best = b; }
          });
          if (best) { target = best; p = Game.findPath(muster.gx, muster.gy, best.gx, best.gy, 'p1'); }
        }
        if (target && p) {
          const send = mn - RESERVE;
          keep = { gx: muster.gx, gy: muster.gy };
          Game.setTroops(muster.gx, muster.gy, 'p1', RESERVE);
          S().march.push({ side: 'p1', n: send, path: p, idx: 0, t: 0, spent: 0 });
        }
      }
    }

    if (!q1 && S().questStar >= 1) q1 = t;
    if (!q2 && S().questStar >= 2) q2 = t;
    if (!q3 && S().questStar >= 3) q3 = t;
    // 三星瓶颈：记录每项首次达标时刻（在三星解锁后、且本局尚未完成三星时）
    if (S().questStar >= 2 && !q3 && !S().questClaiming) {
      CFG.quests.stars[2].forEach(function (q) {
        const k = q.stat;
        if (acc.bottleneck[k] === undefined) acc.bottleneck[k] = [];
        if (Game.questValue(q.stat) >= q.need) {
          if (acc.bottleneck[k][g] === undefined) acc.bottleneck[k][g] = t;
        }
      });
    }
    if (S().result) break;
  }

  /* ---- 每局统计 ---- */
  acc.polCount.push(polPicks);
  S().policy.p1.slots.forEach(function (s) { acc.polTiers[s.tier]++; });
  if (pol5) acc.pol5Time.push(pol5);

  acc.evCount.push(S().events.p1.current || S().events.p1.offer ? 1 : 0);
  // 事件类型分布（从 log 抓取不可靠，改为统计本局 AI/玩家生效过的事件——用简捷法：重放不计，直接算理论值）
  // 改为逐局累计：这里用当前 current 采末端
  if (S().events.p1.current) {
    if (CFG.events.list[S().events.p1.current].kind === 'mix') acc.evMixMe++; else acc.evBadMe++;
  }
  if (S().events.p2.current) {
    if (CFG.events.list[S().events.p2.current].kind === 'mix') acc.evMixAI++; else acc.evBadAI++;
  }

  acc.q1.push(q1 || 0); acc.q2.push(q2 || 0); acc.q3.push(q3 || 0);
  acc.qDone.push(S().questStar);
  /* 终局每项的最终值（带星级前缀，便于对照门槛） */
  CFG.quests.stars.forEach(function (star, si) {
    star.forEach(function (qs) {
      const key = '★' + (si + 1) + ' ' + qs.name + '（需 ' + qs.need + '）';
      if (!acc.qEnd[key]) acc.qEnd[key] = [];
      acc.qEnd[key].push(Game.questValue(qs.stat));
    });
  });

  if (S().result === 'win') {
    acc.win++;
    if (S().score) { acc.E_win.push(S().score.E); acc.scoreWin.push(S().score.total); }
  } else if (S().result === 'lose') {
    acc.lose++;
    if (S().score) { acc.E_lose.push(S().score.E); acc.scoreLose.push(S().score.total); }
  } else if (S().result === 'draw') acc.draw++;
  acc.endHpMe.push(Math.max(0, S().castleHp));
}

/* ---- 输出 ---- */
function avg(a) { return a.length ? +(a.reduce(function (x, y) { return x + y; }, 0) / a.length).toFixed(1) : -1; }
function P(arr, p) {
  if (!arr.length) return -1;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}
const totalEv = acc.evMixMe + acc.evBadMe + acc.evMixAI + acc.evBadAI;

console.log('\n===== 新系统数值诊断（模式 ' + MODE + ' · ' + ROUNDS + ' 局 × ' + WINDOW + 's） =====');

console.log('\n-- 政策（开局 + 每次升本，4⚡可刷新） --');
console.log('颁布次数 P50 = ' + P(acc.polCount, 0.5) + ' / 平均 ' + avg(acc.polCount) +
            '（理论满额 5：开局 + Lv2~5）');
console.log('槽内品质分布：黄铜 ' + acc.polTiers[0] + ' / 白银 ' + acc.polTiers[1] +
            ' / 黄金 ' + acc.polTiers[2] +
            '（黄金占比 ' + Math.round(acc.polTiers[2] * 100 / Math.max(1, acc.polTiers[0] + acc.polTiers[1] + acc.polTiers[2])) + '%）');

console.log('\n-- 事件牌（第 3 分钟起每 180s 一张，全带代价） --');
console.log('末端生效采样：我方 mix/bad = ' + acc.evMixMe + '/' + acc.evBadMe +
            '，AI mix/bad = ' + acc.evMixAI + '/' + acc.evBadAI +
            '（理论 mix:bad = 7:8 ≈ 47%:53%）');

console.log('\n-- 星级任务（门槛 40/80/130 弃牌） --');
console.log('完成时刻 P50：一星 ' + P(acc.q1, 0.5) + 's / 二星 ' + P(acc.q2, 0.5) + 's / 三星 ' + P(acc.q3, 0.5) + 's');
console.log('完成时刻 P90：一星 ' + P(acc.q1, 0.9) + 's / 二星 ' + P(acc.q2, 0.9) + 's / 三星 ' + P(acc.q3, 0.9) + 's');
console.log('星数分布：' + JSON.stringify(acc.qDone.reduce(function (m, s) {
  m[s] = (m[s] || 0) + 1; return m;
}, {})));
console.log('三星各项达标时刻 P50（找卡脖子项）：');
Object.keys(acc.bottleneck).forEach(function (k) {
  const arr = acc.bottleneck[k].filter(function (x) { return x !== undefined; });
  console.log('  ' + k + ' → P50 ' + P(arr, 0.5) + 's（未达标 ' + (ROUNDS - arr.length) + ' 局）');
});

console.log('\n-- ★ 终局每项任务的最终值分布（重校门槛用）--');
console.log('   项目                                     P10    P25    P50    P75    P90   ← 达标率');
Object.keys(acc.qEnd).forEach(function (k) {
  const a = acc.qEnd[k];
  const need = parseInt((k.match(/需 (\d+)/) || [0, 0])[1], 10);
  const rate = Math.round(a.filter(function (v) { return v >= need; }).length / a.length * 100);
  console.log('   ' + k.padEnd(36) +
    String(P(a, 0.1)).padStart(6) + String(P(a, 0.25)).padStart(7) +
    String(P(a, 0.5)).padStart(7) + String(P(a, 0.75)).padStart(7) +
    String(P(a, 0.9)).padStart(7) + ('   ' + rate + '%').padStart(9));
});

console.log('\n-- 结算与 E 项 --');
console.log('胜负：胜 ' + acc.win + ' / 败 ' + acc.lose + ' / 平 ' + acc.draw);
console.log('E 项均值：胜局 ' + avg(acc.E_win) + ' / 败局 ' + avg(acc.E_lose) +
            '（满分 30）；总分均值：胜局 ' + avg(acc.scoreWin) + ' / 败局 ' + avg(acc.scoreLose));
console.log('终局我方主城血 P50 = ' + P(acc.endHpMe, 0.5));
