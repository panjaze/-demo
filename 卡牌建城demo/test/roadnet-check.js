/* 计算让初始官道全图连通的最小补路格集（BFS 分量间桥接）
 * 可放路格 = 平原/农田（非资源点） + 与既有桥格相邻的水格（桥延段，如南桥南半跨）
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const base = path.join(process.cwd(), 'js') + path.sep;
const ctx = { console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error, Set };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(base + 'config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(base + 'game.js', 'utf8'), ctx);
const { CFG, Game } = ctx;
Game.reset();
const S = Game.state;
const T = (x, y) => CFG.map.terrain[y][x];
const isRes = (x, y) => !!Game.resourceAt(x, y);
const isBridge = (x, y) => CFG.map.bridges.some(b => b.gx === x && b.gy === y);
const nearBridge = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(o => isBridge(x + o[0], y + o[1]));
const canAdd = (x, y) => {
  if (S.roads[x + ',' + y]) return false;                               // 已是路
  const t = T(x, y);
  if (t === '.' || t === 'f') return !isRes(x, y);
  if (t === 'W') return nearBridge(x, y);                               // 桥延段
  return false;
};

/* 分量 */
const seen = {}, comps = [];
for (const k in S.roads) {
  if (seen[k]) continue;
  const comp = []; const q = [k]; seen[k] = 1;
  while (q.length) {
    const cur = q.shift(); const p = cur.split(',').map(Number);
    comp.push(p);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(o => {
      const kk = (p[0] + o[0]) + ',' + (p[1] + o[1]);
      if (S.roads[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); }
    });
  }
  comps.push(comp);
}
comps.sort((a, b) => b.length - a.length);
console.log('初始分量:', comps.map(c => c.length).join(','));

/* 贪心：每次找「两个不同分量之间经可放路格的最短路」，补上并合并；直到只剩一个分量 */
const key = p => p[0] + ',' + p[1];
const compOf = {};
comps.forEach((c, i) => c.forEach(p => { compOf[key(p)] = i; }));
const added = [];
let compsLive = comps.map((c, i) => c.map(key));
while (compsLive.length > 1) {
  /* BFS：从分量0出发，穿过 canAdd 格，到达任一其他分量；记录路径 */
  let best = null;
  for (let target = 1; target < compsLive.length; target++) {
    const startSet = new Set(compsLive[0]);
    const goalSet = new Set(compsLive[target]);
    const prev = {}; const q = [];
    compsLive[0].forEach(k => { prev[k] = null; q.push(k); });
    let found = null;
    while (q.length && !found) {
      const cur = q.shift(); const p = cur.split(',').map(Number);
      for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p[0] + o[0], ny = p[1] + o[1];
        if (nx < 0 || ny < 0 || nx >= CFG.map.cols || ny >= CFG.map.rows) continue;
        const nk = nx + ',' + ny;
        if (prev[nk] !== undefined) continue;
        if (goalSet.has(nk)) { prev[nk] = cur; found = nk; break; }
        if (canAdd(nx, ny)) { prev[nk] = cur; q.push(nk); }
      }
    }
    if (found) {
      const pathCells = [];
      let cur = found;
      while (!startSet.has(cur)) { pathCells.push(cur); cur = prev[cur]; }
      if (!best || pathCells.length < best.cells.length) best = { target, cells: pathCells };
    }
  }
  if (!best) { console.log('!! 无可达补路方案，剩余分量:', compsLive.map(c => c.length).join(',')); break; }
  console.log('补路 ' + best.cells.length + ' 格 →', best.cells.join(' '));
  added.push(...best.cells);
  /* 合并分量 */
  const merged = [...compsLive[0], ...compsLive[best.target], ...best.cells];
  compsLive = [merged, ...compsLive.filter((c, i) => i !== 0 && i !== best.target)];
}
console.log('\n合计补路 ' + added.length + ' 格:');
console.log(added.join(' '));
