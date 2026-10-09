/* 调参面板路径校验（第 5 层）
 * 运行：node test/debugpath-check.js
 *
 * 为什么需要这一层：
 *   main.js 里 Engine.debug.slider('a.b.c', ...) 用的是**字符串路径**。
 *   而 engine.js 的 slider() 在 util.getPath() 取不到值时是 **静默 return** 的
 *   （`if (init == null) return;`）——配置键一改名，滑块就悄悄失效，
 *   界面上看不出任何异常，逻辑自检也完全看不见。
 *   idcheck.js 只检查 `CFG.a.b` 这种**字面引用**，抓不到字符串路径。
 *   真实漏网案例：time.gameDuration 改成 time.limit 后，"单局时长"滑块一直是死的。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

let pass = 0, fail = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail.push(name + (detail ? '  → ' + detail : '')); console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
function head(t) { console.log('\n== ' + t + ' =='); }

/* ---- 载入 CFG（只需 config.js，不需要 DOM） ---- */
const ctx = { console: console, Math: Math, Object: Object, Array: Array, Date: Date,
              JSON: JSON, Number: Number, String: String, Boolean: Boolean, Error: Error, Set: Set };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8'), ctx);
const CFG = ctx.CFG;

const src = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');

/* 按 'a.b.c' 逐级取值；路径不存在或值为 null/undefined 都算"取不到" */
function resolve(p) {
  let o = CFG;
  for (const seg of p.split('.')) {
    if (o == null || typeof o !== 'object' || !(seg in o)) return { ok: false };
    o = o[seg];
  }
  return { ok: true, val: o };
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

/* ---- 1. 提取所有 slider（路径 + 区间） ---- */
const sliders = [];
for (const m of src.matchAll(/D\.slider\(\s*'([^']+)'\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*,/g)) {
  sliders.push({ path: m[1], min: num(m[2]), max: num(m[3]) });
}

head('1 调参滑块路径');
ok('扫到滑块 ' + sliders.length + ' 条（应 > 30）', sliders.length > 30, '实际 ' + sliders.length);

const dead = sliders.filter(function (s) {
  const r = resolve(s.path);
  return !r.ok || r.val == null;
});
ok('全部路径都能取到值（配置改键名后不会静默失效）', dead.length === 0,
   dead.map(function (s) { return s.path; }).join(', '));

/* ---- 2. 当前值必须落在滑块区间内（否则滑块位置是错的） ---- */
head('2 取值区间');
const out = sliders.filter(function (s) {
  if (s.min == null || s.max == null) return false;   // 区间用了 CFG.xxx（非字面量）→ 跳过
  const r = resolve(s.path);
  if (!r.ok || r.val == null) return false;
  return r.val < s.min || r.val > s.max;
});
ok('每个滑块的当前配置值都落在 [min, max] 内', out.length === 0,
   out.map(function (s) {
     const r = resolve(s.path);
     return s.path + '=' + r.val + ' 不在 [' + s.min + ',' + s.max + ']';
   }).join('; '));

/* ---- 3. 分组不能是空的（渲染出来只有标题、下面什么都没有） ---- */
head('3 分组完整性');
const calls = [];
for (const m of src.matchAll(/D\.(slider|button|group)\(/g)) calls.push({ kind: m[1], idx: m.index });
const groups = [];
for (const m of src.matchAll(/D\.group\('([^']+)'\)/g)) groups.push({ name: m[1], idx: m.index });
const empty = groups.filter(function (g) {
  const after = calls.filter(function (c) { return c.idx > g.idx; });
  return after.length === 0 || after[0].kind === 'group';
});
ok('没有空分组', empty.length === 0, empty.map(function (g) { return g.name; }).join(', '));
ok('分组数 ' + groups.length + ' ≥ 8', groups.length >= 8, '实际 ' + groups.length);

/* ---- 4. 顶栏/面板里被 UI 引用的关键数值仍然存在（防止改名后 UI 显示空白） ---- */
head('4 关键数值存在性');
ok('CFG.time.limit 存在（兜底时限）', resolve('time.limit').ok, '缺失');
ok('CFG.time.tick 存在（经济 Tick）', resolve('time.tick').ok, '缺失');
ok('CFG.soldier.marchSecPerTile 存在（行军速度唯一来源）', resolve('soldier.marchSecPerTile').ok, '缺失');
ok('CFG.discard.relicCap 存在（遗物上限）', resolve('discard.relicCap').ok, '缺失');

console.log('\n---- 调参路径检查：' + pass + ' 通过 / ' + fail.length + ' 失败 ----');
process.exit(fail.length ? 1 : 0);
