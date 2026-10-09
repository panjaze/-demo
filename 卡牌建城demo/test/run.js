/* 一键跑全部测试 —— 每次改动后都应该跑这个
 * 运行：node test/run.js
 *
 * 五层分别覆盖：纯逻辑规则 / 渲染层 / 交互层 / DOM 引用 / 调参面板配置路径
 * 只有五层全绿才算"验证过"。渲染层与交互层最关键——逻辑自检看不见它们崩溃。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  { file: 'selftest.js',        label: '逻辑自检',   desc: '规则 / 数值 / 状态机' },
  { file: 'smoke.js',           label: '渲染冒烟',   desc: '沙盘真的画出来了 + 相机正确' },
  { file: 'uitest.js',          label: '交互测试',   desc: '假 DOM 模拟点击/拖拽：放置 · 弃牌领遗物 · 操作条取消' },
  { file: 'idcheck.js',         label: 'DOM 引用',   desc: 'JS 取的 id 都存在于 index.html + 方法调用完整' },
  { file: 'debugpath-check.js', label: '调参路径',   desc: 'Engine.debug 的字符串配置路径都能解析（滑块不静默失效）' },
];

const results = [];
console.log('================ 全量验证 ================\n');

SUITES.forEach(function (s) {
  console.log('───── ' + s.label + '：' + s.desc + ' ─────');
  const r = spawnSync(process.execPath, [path.join(__dirname, s.file)], { stdio: 'inherit' });
  const okRun = r.status === 0;
  results.push({ label: s.label, ok: okRun });
  console.log(okRun ? '→ ✓ ' + s.label + ' 通过\n' : '→ ✗ ' + s.label + ' 失败\n');
});

const bad = results.filter(function (r) { return !r.ok; });
console.log('================ 汇总 ================');
results.forEach(function (r) { console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.label); });
console.log(bad.length ? '\n❌ ' + bad.length + ' 个套件失败 —— 不要交付' : '\n✅ 五层全绿');
process.exit(bad.length ? 1 : 0);
