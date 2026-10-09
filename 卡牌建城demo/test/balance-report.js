/* 平衡报告生成器 —— 跑 N 局「半真实玩家」（建造 + 防守 + 主动进攻），
 * 输出节奏 / 胜负 / AI 行为 / 经济四类数据，供数值调优参考。
 * 运行：node test/balance-report.js [局数=30]
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

const ROUNDS = parseInt(process.argv[2] || '30', 10);
const timelines = [];
const WINDOW = parseInt(process.argv[3] || '3600', 10);   // 观察窗口（默认 3600s；游戏本身无时长上限）

/* 统计容器 */
const acc = {
  win: 0, lose: 0, draw: 0, timeout: 0,
  endT: [], myB: [], enemyB: [], roads: [], resP1: [], resP2: [],
  castle2: [], castle3: [], castle5: [], firstTroop: [],
  enemyRoadT: [], p1RoadT: [], endHpMe: [], endHpEnemy: [],
  lv5Me: [], lv5Enemy: [], lead5: [],
  discards: [], quest1: [], quest2: [], quest3: [],
  capP1: [], capP2: [], trained: [],
  endEnergy: [], endFood: [], estGain: [],
};
const P90 = function (arr) {
  if (!arr.length) return -1;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  return a[Math.floor(a.length * 0.9)];
};
const P50 = function (arr) {
  if (!arr.length) return -1;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  return a[Math.floor(a.length / 2)];
};

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

  /* 玩家策略（半真实）：照常开牌买卡建造；兵营出兵后留 1/3 守家，其余编队进攻 */
  let roadT = 0, attackT = 0, attacked = false;
  let keep = null;                            // 驻守点（守家的那支部队，不被再次动员）
  const RESERVE = 12;                         // 每次总攻留在家里的兵数
  let lv5Me = 0, lv5Enemy = 0, lead5 = 0;   // 双方主城升到 Lv5 的时刻（用于评估「发展胜利」节奏）
  let q1 = 0, q2 = 0, q3 = 0;               // 星级任务 1/2/3 星完成时刻（§21 校准用）
  const timeline = (g === 0) ? (timelines[0] = []) : null;
  for (let t = 0; t < WINDOW; t++) {
    // 铺路：每 10 秒一格，朝敌方主城方向（进攻性路线）
    if (t % 10 === 0 && S().res.energy >= CFG.cards.roads.dirt.price) {
      // 后期（t>700）或资源占完 → 转入进攻铺路（朝敌方主城修战争走廊）
      const freeR = CFG.map.resources.filter(function (r) {
        return S().resourceOwner[r.gx + ',' + r.gy] !== 'p1';
      });
      const goal = (t > 700 || freeR.length === 0) ? S().enemyCastle
        : freeR.reduce(function (a, b) {
        return (Math.abs(a.gx - S().castle.gx) + Math.abs(a.gy - S().castle.gy)) <
               (Math.abs(b.gx - S().castle.gx) + Math.abs(b.gy - S().castle.gy)) ? a : b;
      });
      // 只沿「连通前沿」铺（与 AI 同一套规则，roadFrontier 由 game.js 提供）
      let best = null, bestD = 1e9;
      Game.roadFrontier('p1').forEach(function (p) {
        const d = Math.abs(p.gx - goal.gx) + Math.abs(p.gy - goal.gy);
        if (d < bestD) { bestD = d; best = { gx: p.gx, gy: p.gy }; }
      });
      if (best) { S().res.energy -= CFG.cards.roads.dirt.price; Game.placeRoad(best.gx, best.gy); }
    }

    Game.update(1);

    // 买卡（第二十五次修订：真人式卡牌流程——开牌、按需买建筑卡、没好卡就刷新）
    if (t % 5 === 0 && S().res.energy >= 8 && S().hand.indexOf(null) >= 0) {
      if (!S().shop) Game.openShop();
      if (S().shop) {
        const cards = S().shop.cards;
        const wantFirst = Game.typeCount('barracks') === 0 ? 'barracks'
                        : (Game.typeCount('farm') < 2 ? 'farm'
                        : (Game.typeCount('power') < 2 ? 'power' : null));
        // 候选里挑建筑卡：先要 wantFirst，否则买最便宜的
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
          Game.openShop();          // 候选没好卡且能量富裕 → 重开（递增费，真人也会刷）
        }
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
      // repair 需要指定目标，脚本不自动用
    });
    S().hand.forEach(function (h, i) {
      if (!h) return;
      const info = Game.cardInfo(h.key);
      if (!info || info.kind !== 'building') return;
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          if (Game.build(i, gx, gy)) { S().res.energy -= 0; return; }
        }
      }
    });

    // §20 事件牌：自动领取（否则玩家永远吃不到事件效果，对 AI 不公平）
    if (S().events.p1.offer) Game.claimEvent('p1');

    // §21 任务奖励：完成一星后随机领一件遗物（脚本不领的话 questStar 会永远卡住）
    if (S().questClaiming) {
      const rk = Object.keys(CFG.relics);
      Game.pickQuestReward(rk[Math.floor(Math.random() * rk.length)]);
    }

    // 手牌管理（第二十五次修订：真人式——先弃用不了的非建筑卡，再弃最贵建筑卡）
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

    // 主城升级（能量富余才升，留 20⚡ 建造余量）
    if (t % 10 === 0) {
      const cu = Game.castleUpgradeCost();
      if (cu && S().res.energy >= cu.energy + 20) Game.upgradeCastle();
    }

    // §19 政策：有得选就选（偏好本流派 = 种田，否则随机）—— 不选的话等于白送 AI 一层加成
    if (S().policy.p1.offer) {
      const off = S().policy.p1.offer;
      let pick = 0;
      for (let i = 0; i < off.length; i++) {
        if (CFG.policy.list[off[i].key].school === S().policy.p1.school) { pick = i; break; }
      }
      Game.chooseOffer(pick);
    }

    // 占领资源点：兵 ≥ 12 且有未占资源点 → 派最近的部队去
    if (t % 5 === 0 && !attacked) {
      const free = CFG.map.resources.filter(function (r) {
        return S().resourceOwner[r.gx + ',' + r.gy] !== 'p1';
      });
      if (free.length) {
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

    // 集结 + 进攻（反复）：①分散兵堆向最大兵堆集结 ②聚齐 ≥25 → 打主城（可达）或撕缺口
    // （此前版本按「离主城最近的兵堆」发射，兵力分散后永远凑不齐 40 → 进攻永不发射）
    if (t % 5 === 0 && t > 120) {
      const stacks = ownTiles('p1');
      const total = stacks.reduce(function (s2, x) { return s2 + x.n; }, 0);
      // 集结点：优先沿用上次的「驻守点」（守家的那支部队），否则取最大堆
      let muster = null, mn = 0;
      if (keep) {
        stacks.forEach(function (x) {
          if (x.gx === keep.gx && x.gy === keep.gy) { muster = x; mn = x.n; }
        });
      }
      if (!muster) stacks.forEach(function (x) { if (x.n > mn) { mn = x.n; muster = x; } });
      if (timeline && t % 150 === 0) console.log('[集结] t=' + t + ' 总兵=' + total +
        ' 堆数=' + stacks.length + ' 最大堆=' + mn);

      // 飞行中守卫：该格已有在途行军 → 不重复下令（否则同一批兵会被复制多份）
      const inFlight = function (gx, gy) {
        return S().march.some(function (m) {
          const c = m.path[m.idx] || m.path[0];
          return c.gx === gx && c.gy === gy;
        });
      };

      // ① 集结：其余兵堆向最大堆行军（跳过在途的）
      if (stacks.length > 1) {
        stacks.forEach(function (x) {
          if (x === muster || inFlight(x.gx, x.gy)) return;
          if (x.n <= RESERVE && keep && x.gx === keep.gx && x.gy === keep.gy) return;  // 守军不动
          if (x.n < CFG.enemy.musterMin) return;      // 小股不单独长途行军（会半路送掉）
          const p = Game.findPath(x.gx, x.gy, muster.gx, muster.gy, 'p1');
          if (p) {
            Game.setTroops(x.gx, x.gy, 'p1', 0);
            S().march.push({ side: 'p1', n: x.n, path: p, idx: 0, t: 0, spent: 0 });
          }
        });
      }

      // ② 发射：最大堆 ≥ 25 且不在途中 → 选目标（主城可达 → 主城；否则撕缺口）
      //    留 RESERVE 个兵守家 —— 旧版把兵全派出去「总攻」，家里空着，AI 一波就推平（实测 19/20 战败）
      if (mn - RESERVE >= 25 && !inFlight(muster.gx, muster.gy)) {
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
          const send = mn - RESERVE;                 // 留守 RESERVE 个兵在家
          keep = { gx: muster.gx, gy: muster.gy };   // 该格成为新的驻守点
          Game.setTroops(muster.gx, muster.gy, 'p1', RESERVE);
          S().march.push({ side: 'p1', n: send, path: p, idx: 0, t: 0, spent: 0 });
          acc.attacks = (acc.attacks || 0) + 1;
        }
      }
    }

    if (timeline && t % 60 === 0) timeline.push({
      t: t, troops: Game.totalTroops('p1'), enemyB: Game.enemyBuildings().length,
      roads: Object.keys(S().roads).length,
      attacks: acc.attacks || 0, castleLv: S().castleLevel,
      ecHp: S().enemyCastle.hp, resP1: Object.keys(S().resourceOwner).filter(function (k) { return S().resourceOwner[k] === 'p1'; }).length,
    });
    if (t === 420) S().roadsAt420 = Object.keys(S().roads).length;
    if (acc.firstTroop.length === 0 && Game.totalTroops('p1') > 0) acc.firstTroop.push(t);
    // 主城 Lv5 达成时刻（评估「发展胜利」路线会把对局压到多长）
    if (!lv5Me && S().castleLevel >= 5) lv5Me = t;
    if (!lv5Enemy && (S().enemyLevel || 1) >= 5) lv5Enemy = t;
    if (!lead5 && (S().castleLevel >= 5 || (S().enemyLevel || 1) >= 5)) lead5 = t;
    // §21 星级任务完成时刻
    if (!q1 && S().questStar >= 1) q1 = t;
    if (!q2 && S().questStar >= 2) q2 = t;
    if (!q3 && S().questStar >= 3) q3 = t;
    if (S().result) break;                       // win / lose / draw 三种结局都收工
  }
  acc.lv5Me.push(lv5Me || WINDOW);
  acc.lv5Enemy.push(lv5Enemy || WINDOW);
  acc.lead5.push(lead5 || WINDOW);
  acc.discards.push(S().discardCount || 0);
  acc.quest1.push(q1 || 0);
  acc.quest2.push(q2 || 0);
  acc.quest3.push(q3 || 0);
  acc.capP1.push(S().stats.capturedP1 || 0);
  acc.capP2.push(S().stats.capturedP2 || 0);
  acc.trained.push(S().stats.trained || 0);
  // 第二十八次：能量收支（回应 GPT 意见——用正常局数据判断是否富余，而非失控长局）
  acc.endEnergy.push(Math.floor(S().res.energy));
  acc.endFood.push(Math.floor(S().res.food));
  acc.estGain.push(Math.round((S().lastGain.energy || 0) * S().tickCount));

  /* 统计 */
  if (S().result === 'win') acc.win++;
  else if (S().result === 'lose') acc.lose++;
  else if (S().result === 'draw') acc.draw++;
  else acc.timeout++;
  acc.endT.push(Math.round(S().t));
  acc.roads7 = acc.roads7 || [];
  acc.myB.push(Game.myBuildings().length);
  acc.enemyB.push(Game.enemyBuildings().length);
  acc.roads.push(Object.keys(S().roads).length);
  acc.resP1.push(Object.keys(S().resourceOwner).filter(function (k) { return S().resourceOwner[k] === 'p1'; }).length);
  acc.resP2.push(Object.keys(S().resourceOwner).filter(function (k) { return S().resourceOwner[k] === 'p2'; }).length);
  acc.roads7.push(S().roadsAt420 || 0);
  acc.endHpMe.push(Math.max(0, S().castleHp));
  acc.endHpEnemy.push(Math.max(0, S().enemyCastle.hp));
  acc.castle2.push(S().castleLevel);
}

/* 输出 */
const S_endLv = acc.castle2;
const L = [];
L.push('# 卡牌建城 · V0.4 平衡报告');
L.push('');
L.push('> 生成时间：' + new Date().toLocaleString('zh-CN') + '　局数：' + ROUNDS +
        '　观察窗口：' + WINDOW + 's　玩家策略：建造 + 防守 + 一次性总攻（半真实）');
L.push('');
L.push('## 1. 胜负分布');
L.push('');
L.push('| 结果 | 局数 | 占比 |');
L.push('|---|---|---|');
L.push('| 🏆 胜利（摧毁敌方主城） | ' + acc.win + ' | ' + Math.round(acc.win / ROUNDS * 100) + '% |');
L.push('| 💀 战败（主城被摧毁） | ' + acc.lose + ' | ' + Math.round(acc.lose / ROUNDS * 100) + '% |');
L.push('| ⏱ 平局（综合分持平） | ' + acc.draw + ' | ' + Math.round(acc.draw / ROUNDS * 100) + '% |');
L.push('| ⌛ 窗口内未结束 | ' + acc.timeout + ' | ' + Math.round(acc.timeout / ROUNDS * 100) + '% |');
L.push('');
L.push('> 第 19 次修订后：兜底时长 ' + CFG.time.limit + 's，到时按 A/B/C/D 综合分判；上面四行应基本无「未结束」。');
L.push('');
L.push('## 2. 节奏');
L.push('');
L.push('| 指标 | P50 |');
L.push('|---|---|');
L.push('| 对局时长 | ' + P50(acc.endT) + 's |');
L.push('| 终局主城等级（P50） | ' + P50(S_endLv) + ' |');
L.push('| 7 分钟时道路总数 | ' + P50(acc.roads7) + '（此前版本约 250，用户报障点） |');
L.push('| 首支部队 | ' + P50(acc.firstTroop) + 's |');
L.push('| 主城 Lv5 达成（我方 / 敌方 / 任一方） | ' + P50(acc.lv5Me) + 's / ' +
       P50(acc.lv5Enemy) + 's / ' + P50(acc.lead5) + 's |');
L.push('| 一局累计弃牌 P50 / P90 | ' + P50(acc.discards) + ' / ' + P90(acc.discards) +
       ' 张（三星任务门槛应校在 P90 附近） |');
L.push('| 星级任务完成时刻 P50（一 / 二 / 三星） | ' + P50(acc.quest1) + 's / ' +
       P50(acc.quest2) + 's / ' + P50(acc.quest3) + 's |');
L.push('| 建筑占领（我方 / 敌方）P50 | ' + P50(acc.capP1) + ' / ' + P50(acc.capP2) + ' 次 |');
L.push('| 累计训练士兵 P50 | ' + P50(acc.trained) + ' 个 |');
L.push('| 局末能量结余 / 估算总收入 P50 | ' + P50(acc.endEnergy) + ' / ' + P50(acc.estGain) + ' ⚡ |');
L.push('| 能量富余比（结余÷收入）P50 | ' +
       (P50(acc.estGain) > 0 ? (P50(acc.endEnergy) / P50(acc.estGain)).toFixed(2) : '-') + ' |');
L.push('| 局末粮食结余 P50 | ' + P50(acc.endFood) + ' 🌾 |');
L.push('');
L.push('## 3. 终局状态（P50）');
L.push('');
L.push('| 指标 | P50 |');
L.push('|---|---|');
L.push('| 我方建筑 | ' + P50(acc.myB) + ' |');
L.push('| 敌方建筑 | ' + P50(acc.enemyB) + ' |');
L.push('| 道路总数（双方合计） | ' + P50(acc.roads) + ' |');
L.push('| 资源点归属 我方 / 敌方 | ' + P50(acc.resP1) + ' / ' + P50(acc.resP2) + '（共 9） |');
L.push('| 终局主城血量 我方 / 敌方 | ' + P50(acc.endHpMe) + ' / ' + P50(acc.endHpEnemy) + ' |');
L.push('');
L.push('## 4. 读法与调参入口');
L.push('');
L.push('- **胜负比接近 1:1** → AI 强度合适；**我方全胜** → AI 太弱（调 AI 铺路策略/进攻阈值）；**我方全败** → AI 太强');
L.push('- **道路总数**反映节奏：>150 说明铺路还是太便宜（土路 2⚡ → 3⚡）；<40 说明太贵');
L.push('- **窗口内未分胜负过多** → 进攻成本太高（路太长/太贵），可加大地图或降道路价');
L.push('- 实时调参面板（按 `）可改：能源站产出、道路牌价格、AI 铺路间隔（`enemy.roadInterval`）');
L.push('');

/* 首局时间线（诊断攻城链路） */
L.push('');
L.push('## 5. 首局时间线（每 60 秒）');
L.push('');
L.push('| 时间 | 我方兵力 | 敌建筑 | 道路 | 攻城波次累计 | 主城Lv | 敌主城HP | 我占资源点 |');
L.push('|---|---|---|---|---|---|---|---|');
(timelines[0] || []).forEach(function (r) {
  L.push('| ' + r.t + 's | ' + r.troops + ' | ' + r.enemyB + ' | ' + r.roads + ' | ' +
         r.attacks + ' | ' + r.castleLv + ' | ' + r.ecHp + ' | ' + r.resP1 + ' |');
});
L.push('');

const out = path.join(__dirname, '..', '平衡报告-V0.4.md');
fs.writeFileSync(out, L.join('\n'), 'utf8');
console.log(L.join('\n'));
console.log('\n已写入：' + out);
