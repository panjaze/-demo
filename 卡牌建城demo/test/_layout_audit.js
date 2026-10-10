/* 遮挡审计：把「可交互元素被别的层盖住、点了没反应」这一类 bug 一次性挖出来。
 * 原理：对每个可见的可交互元素取中心点做 elementFromPoint，
 *       命中结果必须是元素自身或其后代，否则判「被遮挡」。
 * 覆盖状态：主界面 / 弃牌模式 / 7 类弹窗 / 主菜单（桌面 + 手机横屏）。
 * 用法：node test/_layout_audit.js */
const fs = require('fs');
const { chromium } = require('playwright-core');
const CHROME = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR = 'D:/工程/自研/卡牌建城demo/test/';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  async function auditPage(viewport, tag) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:8124/index.html?play=1', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      if (window.Tutorial && Tutorial.hide) Tutorial.hide();
      document.getElementById('menu').classList.add('hidden');
      Game.state.res.energy = 128; Game.state.res.food = 76;
      Game.state.relics = ['blueprint'];
      Game.state.policy.p1.slots = [{ key: 'till', tier: 2 }];
      Game.state.policy.p1.offer = null; Game.state.events.p1.offer = null;
      UI.render();
    });
    await page.waitForTimeout(300);
    const states = [
      ['主界面', () => { UI.setModal(null); UI.setDiscardMode(false); }],
      ['弃牌模式', () => UI.setDiscardMode(true)],
      ['弹窗:抽卡', () => UI.setModal('shop')],
      ['弹窗:牌库', () => UI.setModal('pool')],
      ['弹窗:任务', () => UI.setModal('quest')],
      ['弹窗:政策', () => { Game.state.policy.p1.offer = [{ key: 'till', tier: 2 }, { key: 'siege', tier: 1 }, { key: 'pioneer', tier: 0 }]; UI.setModal('policy'); }],
      ['弹窗:政策查看', () => { Game.state.policy.p1.offer = null; UI.setModal('policyview'); }],
      ['弹窗:遗物', () => UI.setModal('reward')],
      ['弹窗:事件', () => { Game.state.events.p1.offer = 'locust'; UI.setModal('event'); }],
      ['弹窗:事件查看', () => { Game.state.events.p1.offer = null; Game.state.events.p1.current = 'tradeRoute'; UI.setModal('eventview'); }],
      ['主菜单', () => { UI.setModal(null); UI.setDiscardMode(false); document.getElementById('menu').classList.remove('hidden'); }],
    ];
    const report = [];
    for (const [name, setup] of states) {
      await page.evaluate(setup);
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const sel = 'button, .corner-btn, .menu-btn, [data-modal], [data-action], [data-hand], [data-policy], [data-reward], .policy-chip, .tb-btn, .ta-btn, .bh-btn, #modal-close';
        const out = [];
        document.querySelectorAll(sel).forEach(function (el) {
          const r = el.getBoundingClientRect();
          if (r.width < 6 || r.height < 6) return;                    // 不可见/零尺寸
          if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) { out.push({ id: el.id || el.className, issue: '在视口外', at: [Math.round(cx), Math.round(cy)] }); return; }
          const top = document.elementFromPoint(cx, cy);
          if (!top) { out.push({ id: el.id || el.className, issue: '命中为空' }); return; }
          if (!el.contains(top) && !top.contains(el)) {
            // 模态弹窗 / 主菜单盖住后面的 UI 是设计如此，不算 bug
            if (top.id === 'modal' || top.classList.contains('modal-box') || top.closest('.modal-box')) return;
            if (top.closest('#menu')) return;
            out.push({ id: (el.id || el.className || el.tagName).slice(0, 34), issue: '被遮挡',
                       by: (top.id || top.className || top.tagName).slice(0, 34),
                       text: (el.textContent || '').trim().slice(0, 12), at: [Math.round(cx), Math.round(cy)] });
          }
        });
        // 横向溢出
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth + 1) out.push({ issue: '页面横向溢出', at: [doc.scrollWidth, doc.clientWidth] });
        return out;
      });
      if (r.length) report.push({ state: name, problems: r });
    }
    await page.close();
    return { tag, report };
  }
  const results = [];
  results.push(await auditPage({ width: 1280, height: 720 }, 'desktop'));
  results.push(await auditPage({ width: 844, height: 390 }, 'mobile-landscape'));
  let total = 0;
  results.forEach(function (r) {
    r.report.forEach(function (s) {
      total += s.problems.length;
      console.log('[' + r.tag + ' · ' + s.state + ']');
      s.problems.forEach(function (p) {
        console.log('   ✗ ' + p.issue + (p.by ? '（被 ' + p.by + ' 挡住）' : '') + (p.text ? ' 「' + p.text + '」' : '') + (p.at ? ' @' + JSON.stringify(p.at) : ''));
      });
    });
  });
  console.log(total === 0 ? '\n✅ 无遮挡/无溢出' : '\n⚠️ 共 ' + total + ' 处');
  await browser.close();
  if (total) process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
