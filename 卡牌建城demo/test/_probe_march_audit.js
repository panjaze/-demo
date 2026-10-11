/* _probe_march_audit.js —— 排查用临时探针（不入门禁，不改工程）
 * ① orderMoveFrom 派出瞬间：起点格是否仍留着兵（inAirTroops 注释声称"派出时已清空原格"）
 * ② 一局内 AI march 的消失原因分布：粮尽停军 / 抵达 / 全灭，各时点 AI 粮食
 * 运行：node test/_probe_march_audit.js [局数=2]
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

/* ---------- 实验 ①：orderMoveFrom 派出瞬间的账本 ---------- */
console.log('===== 实验① orderMoveFrom 派出瞬间 =====');
Game.reset();
(function () {
  const S = Game.state;
  // 主城旁放一格路，再放 20 兵
  const c = S.castle;
  Game.placeRoad(c.gx + 1, c.gy, 'p1');
  Game.addTroops(c.gx + 1, c.gy, 'p1', 20);
  S.res.food = Math.max(S.res.food, 600);
  const before = { tile: Game.troopsAt(c.gx + 1, c.gy).p1, total: Game.totalTroops('p1'),
                   air: Game.inAirTroops('p1'), active: Game.activeTroops('p1') };
  const r = Game.orderMoveFrom(c.gx + 1, c.gy, S.castle.gx, S.castle.gy); // 目标=主城（合法目标）
  const after = { tile: Game.troopsAt(c.gx + 1, c.gy).p1, total: Game.totalTroops('p1'),
                  air: Game.inAirTroops('p1'), active: Game.activeTroops('p1') };
  console.log('下令结果:', JSON.stringify({ ok: r.ok, reason: r.reason, n: r.n, legs: r.legs }));
  console.log('派出前: 起点格兵=' + before.tile + ' 场上=' + before.total + ' 空中=' + before.air + ' active=' + before.active);
  console.log('派出后: 起点格兵=' + after.tile + ' 场上=' + after.total + ' 空中=' + after.air + ' active=' + after.active);
  console.log(after.tile > 0 && after.air > 0
    ? '>> 实锤：起点格未清空 + march 同时记账 → activeTroops 双计（' + before.active + ' → ' + after.active + '）'
    : '>> 起点格已清空（与 inAirTroops 注释一致）');
  // 走 2 秒再看
  Game.update(2);
  console.log('2s 后: 起点格兵=' + Game.troopsAt(c.gx + 1, c.gy).p1
    + ' 场上=' + Game.totalTroops('p1') + ' 空中=' + Game.inAirTroops('p1')
    + ' active=' + Game.activeTroops('p1') + ' march=' + S.march.length);
})();

/* ---------- 实验②：一局内 AI march 的消失原因 ---------- */
const ROUNDS = parseInt(process.argv[2] || '2', 10);
for (let g = 0; g < ROUNDS; g++) {
  console.log('\n===== 实验② 第' + (g + 1) + ' 局 =====');
  Game.reset();
  const S = () => Game.state;
  let seen = new Map();          // march 对象 → 出发信息
  let stats = { newM: 0, goneArrive: 0, goneStarve: 0, goneWipe: 0, goneOther: 0 };
  let starveAtHome = 0, starvePos = { home: 0, road: 0, other: 0 };
  let foodTrack = [];
  for (let t = 0; t < 1800; t++) {
    const before = new Set(S().march);
    // 记新出现的 march
    S().march.forEach(function (m) {
      if (!seen.has(m)) {
        seen.set(m, { t: t, side: m.side, n0: m.n, len: m.path.length, from: m.path[0] });
        stats.newM++;
      }
    });
    // 玩家策略喂资源：让 AI 的粮尽不至于全由"极端穷"造成 —— 不干预，保持原生态
    Game.update(1);
    const after = new Set(S().march);
    // 记消失的 march
    seen.forEach(function (info, m) {
      if (after.has(m)) return;
      seen.delete(m);
      const endPos = m.path[Math.min(m.idx, m.path.length - 1)];
      const er = S().enemyRes, pr = S().res;
      if (m.side === 'p2') {
        const remain = Game.troopsAt(endPos.gx, endPos.gy).p2 || 0;
        let cause;
        if (m.idx >= m.path.length - 1) cause = 'goneArrive';
        else if (er.food < 0.6 * m.n) cause = 'goneStarve';
        else if (m.n <= 0) cause = 'goneWipe';
        else cause = 'goneOther';
        stats[cause]++;
        if (cause === 'goneStarve') {
          const b = Game.buildingAt(endPos.gx, endPos.gy);
          const where = (b && b.owner === 'p2') ? 'home' : (Game.isRoadAt(endPos.gx, endPos.gy) ? 'road' : 'other');
          starvePos[where]++;
          if (t % 200 === 0 || stats.goneStarve <= 5)
            console.log('  [t=' + t + '] AI march 粮尽: n0=' + info.n0 + ' 走到' + m.idx + '/' + (info.len - 1)
              + ' AI粮=' + Math.round(er.food) + ' 终止格(' + endPos.gx + ',' + endPos.gy + ') ' + where
              + ' 留兵=' + remain);
        } else if (stats[cause] <= 3) {
          console.log('  [t=' + t + '] AI march ' + cause + ': n0=' + info.n0 + ' 走到' + m.idx + '/' + (info.len - 1)
            + ' AI粮=' + Math.round(er.food) + ' 终止格(' + endPos.gx + ',' + endPos.gy + ') 留兵=' + remain);
        }
      }
    });
    if (t % 300 === 0) foodTrack.push('t' + t + ': 玩粮' + Math.round(S().res.food) + '/AI粮' + Math.round(S().enemyRes.food));
  }
  console.log('  AI 粮食轨迹: ' + foodTrack.join(' | '));
  console.log('  AI march 统计: 新增' + stats.newM
    + ' 抵达=' + stats.goneArrive + ' 粮尽停军=' + stats.goneStarve
    + ' 全灭=' + stats.goneWipe + ' 其他=' + stats.goneOther);
  console.log('  粮尽终止位置: AI建筑上=' + starvePos.home + ' 道路=' + starvePos.road + ' 其他=' + starvePos.other);
  console.log('  终局: ' + (S().result || '未分') + ' 敌主城HP=' + S().enemyCastle.hp + ' 我方主城HP=' + Math.max(0, S().castleHp)
    + ' AI终兵=' + Game.totalTroops('p2') + ' AI曾训=' + (S().enemyTrained || 0));
}
