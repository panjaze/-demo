/* 波次诊断 —— 追踪每一支行军部队的完整生命周期
 *
 * 用途：回答「攻城波次到底死在哪一步」。平衡报告只能看到「敌主城 HP 没掉」，
 * 看不出是没走到、半路被歼、粮尽、还是走到了但兵力不够啃。
 *
 * 每波记录：出发兵数 / 路径长度 / 实际走了几格 / 终止格 / 终止时剩余兵 / 终止格上有什么
 *
 * 运行：node test/diag-wave.js [局数=3] [窗口秒=1800]
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

const ROUNDS = parseInt(process.argv[2] || '3', 10);
const WINDOW = parseInt(process.argv[3] || '1800', 10);
const VERBOSE = process.argv[4] === 'v';

/** 终止格上「有什么」的分类 */
function whatAt(gx, gy) {
  if (Game.isCastleAt(gx, gy)) return '我方主城';
  const ec = Game.state.enemyCastle;
  if (ec.gx === gx && ec.gy === gy) return '敌方主城';
  if (Game.resourceAt(gx, gy)) return '资源点';
  const b = Game.buildingAt(gx, gy);
  if (b) return '建筑·' + (b.owner === 'p2' ? '敌' : '我');
  if (Game.isRoadAt(gx, gy)) return '道路';
  return '空地';
}

const all = [];

/** 己方「可下令」的兵堆：跳过行军中部队的临时落点（那些兵已在路上，再下令会复制） */
function ownTiles(side) {
  const out = [];
  for (const k in Game.state.troops) {
    const n = Game.state.troops[k][side];
    if (!n) continue;
    const p = k.split(',');
    if (Game.isMarchOccupied(+p[0], +p[1], side)) continue;
    out.push({ gx: +p[0], gy: +p[1], n: n });
  }
  return out;
}

for (let g = 0; g < ROUNDS; g++) {
  Game.reset();
  const S = () => Game.state;
  const recs = new Map();          // march 对象 → 记录
  const finished = [];

  const track = function (t) {
    const live = new Set(S().march);
    S().march.forEach(function (m) {
      if (!recs.has(m)) {
        const last = m.path[m.path.length - 1];
        recs.set(m, {
          side: m.side, n0: m.n, len: m.path.length, from: m.path[0],
          dst: last, startT: t, idx: m.idx, pos: m.path[m.idx],
        });
      }
      const r = recs.get(m);
      r.idx = m.idx;
      r.pos = m.path[m.idx];
    });
    recs.forEach(function (r, m) {
      if (live.has(m)) return;
      const p = r.pos || r.from;
      r.endIdx = r.idx;
      r.endPos = p;
      r.remain = Game.troopsAt(p.gx, p.gy)[r.side] || 0;
      r.reached = r.idx >= r.len - 1;
      r.where = whatAt(p.gx, p.gy);
      r.endT = t;
      r.sec = t - r.startT;
      finished.push(r);
      recs.delete(m);
    });
  };

  for (let t = 0; t < WINDOW; t++) {
    // —— 玩家策略（与 balance-report.js 同一套：铺路 / 建造 / 占领 / 集结 / 总攻）——
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

    if (t % 5 === 0 && S().res.energy >= 8 && S().hand.indexOf(null) >= 0) {
      const pool = Game.availableCards();
      const wantFirst = Game.typeCount('barracks') === 0 ? 'barracks'
                      : (Game.typeCount('farm') < 2 ? 'farm'
                      : (Game.typeCount('power') < 2 ? 'power' : null));
      const pick = (wantFirst && pool.indexOf(wantFirst) >= 0) ? wantFirst
                 : pool[Math.floor(Math.random() * pool.length)];
      if (pick && Game.cardInfo(pick).price <= S().res.energy - 4) {
        S().res.energy -= Game.cardInfo(pick).price;
        S().hand[S().hand.indexOf(null)] = { key: pick };
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

    if (t % 10 === 0) {
      const cu = Game.castleUpgradeCost();
      if (cu && S().res.energy >= cu.energy + 20) Game.upgradeCastle();
    }

    // §20 事件自动领取 + §21 任务奖励自动领取（脚本不领会卡住 questStar）
    if (S().events.p1.offer) Game.claimEvent('p1');
    if (S().questClaiming) {
      const rk = Object.keys(CFG.relics);
      Game.pickQuestReward(rk[Math.floor(Math.random() * rk.length)]);
    }

    // §19 政策：有得选就选（与本方流派一致优先）
    if (S().policy.p1.offer) {
      const off = S().policy.p1.offer;
      let pick = 0;
      for (let i = 0; i < off.length; i++) {
        if (CFG.policy.list[off[i].key].school === S().policy.p1.school) { pick = i; break; }
      }
      Game.chooseOffer(pick);
    }

    if (t % 5 === 0) {
      const free = CFG.map.resources.filter(function (r) {
        return S().resourceOwner[r.gx + ',' + r.gy] !== 'p1';
      });
      if (free.length) {
        // 跳过「行军中部队的临时落点」（那些兵已在路上，再下令会复制）
        const src = ownTiles('p1').sort(function (a, b) {
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

    if (t % 5 === 0 && t > 120) {
      const stacks = ownTiles('p1');
      let muster = null, mn = 0;
      stacks.forEach(function (x) { if (x.n > mn) { mn = x.n; muster = x; } });
      const inFlight = function (gx, gy) {
        return S().march.some(function (m) {
          const c = m.path[m.idx] || m.path[0];
          return c.gx === gx && c.gy === gy;
        });
      };
      if (stacks.length > 1) {
        stacks.forEach(function (x) {
          if (x === muster || inFlight(x.gx, x.gy)) return;
          const p = Game.findPath(x.gx, x.gy, muster.gx, muster.gy, 'p1');
          if (p) {
            Game.setTroops(x.gx, x.gy, 'p1', 0);
            S().march.push({ side: 'p1', n: x.n, path: p, idx: 0, t: 0, spent: 0 });
          }
        });
      }
      if (mn >= 25 && !inFlight(muster.gx, muster.gy)) {
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
          Game.setTroops(muster.gx, muster.gy, 'p1', 0);
          S().march.push({ side: 'p1', n: mn, path: p, idx: 0, t: 0, spent: 0 });
        }
      }
    }

    track(t);
    if (S().over) break;
  }

  finished.forEach(function (r) { r.game = g; all.push(r); });
  console.log('第 ' + (g + 1) + ' 局：' + finished.length + ' 波，' +
              '敌主城 HP ' + S().enemyCastle.hp + '，我方主城 HP ' + Math.max(0, S().castleHp) +
              '，结果 ' + (S().result || '未分胜负'));
}

/* ---------- 统计 ---------- */
function avg(a) { return a.length ? (a.reduce(function (x, y) { return x + y; }, 0) / a.length) : 0; }
function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }

const bySide = { p1: all.filter(function (r) { return r.side === 'p1'; }),
                 p2: all.filter(function (r) { return r.side === 'p2'; }) };

console.log('\n===== 波次诊断（' + all.length + ' 波） =====');
['p1', 'p2'].forEach(function (side) {
  const rs = bySide[side];
  if (!rs.length) return;
  const reached = rs.filter(function (r) { return r.reached; });
  const where = {};
  rs.forEach(function (r) { where[r.where] = (where[r.where] || 0) + 1; });
  console.log('\n-- ' + (side === 'p1' ? '我方（模拟玩家）' : '敌方 AI') + ' --');
  console.log('波次总数 ' + rs.length + '　平均出发兵 ' + avg(rs.map(function (r) { return r.n0; })).toFixed(1) +
              '　平均路径 ' + avg(rs.map(function (r) { return r.len; })).toFixed(1) + ' 格' +
              '　平均走到第 ' + avg(rs.map(function (r) { return r.endIdx; })).toFixed(1) + ' 格');
  console.log('走完全程 ' + reached.length + ' 波（' + pct(reached.length, rs.length) + '%）' +
              '　中途终止 ' + (rs.length - reached.length) + ' 波');
  console.log('平均完成度 ' + pct(avg(rs.map(function (r) { return r.len > 1 ? r.endIdx / (r.len - 1) : 1; })) * 100, 100) + '%' +
              '　平均剩余兵 ' + avg(rs.map(function (r) { return r.remain; })).toFixed(1));
  console.log('终止位置分布：' + Object.keys(where).sort(function (a, b) { return where[b] - where[a]; })
    .map(function (k) { return k + ' ' + where[k]; }).join('　'));
  const toCastle = rs.filter(function (r) {
    const d = r.dst;
    const ec = Game.state.enemyCastle;
    return (side === 'p1' && d.gx === 25 && d.gy === 3) || (side === 'p2' && d.gx === 3 && d.gy === 11);
  });
  console.log('以「敌方主城」为目标的波次 ' + toCastle.length + ' 波，其中抵达 ' +
              toCastle.filter(function (r) { return r.reached; }).length + ' 波');
});

if (VERBOSE) {
  console.log('\n-- 明细（我方，前 40 波） --');
  bySide.p1.slice(0, 40).forEach(function (r) {
    console.log('t=' + r.startT + ' 兵' + r.n0 + ' 路长' + r.len + ' → 走到' + r.endIdx +
                ' 格(' + (r.endPos.gx) + ',' + (r.endPos.gy) + ') ' + r.where +
                ' 余' + r.remain + (r.reached ? ' [抵达]' : ' [中途]'));
  });
}
