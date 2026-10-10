/* =============================================================
 * Tutorial —— 分步新手引导（第四十八次修订）
 *
 * 设计（用户拍板）：
 *   - 新对局开始时弹「选择界面」：查看引导 / 跳过（市面常见做法，每局可选）
 *   - 引导期间游戏暂停（Game.state.paused = true），结束时恢复
 *   - 软引导：高亮 + 手指 + 气泡，**不锁操作**——玩家乱点也不会卡死
 *   - 步骤跟着真实开局流程走：政策 → 抽卡 → 买卡 → 建造；完成条件轮询 state
 *   - 「玩法说明」（menu.js buildHelp）保留不动，收尾步骤指向它
 * 本地调试：URL 带 ?tut=1 可跳过选择界面直接看引导。
 * ============================================================= */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* 步骤表：text 气泡文案（HTML）；target 手指指向元素（null = 居中气泡 + 按钮）；
   * wait() = 玩家完成判定（轮询 state），返回 true 自动进下一步；btn = 居中步骤的按钮文案 */
  const STEPS = [
    {
      id: 'welcome',
      text: '欢迎来到《卡牌建城》！<br>目标：<b>摧毁敌方主城</b>获胜（30 分钟兜底按综合分判胜）。<br>跟完这 6 步，你就学会开局。',
      center: true,
      btn: '开始',
    },
    {
      id: 'policy',
      text: '先选一条<b>开局政策</b> —— 三选一，点击卡片即可。',
      target: '#policy-cards > *',
      wait: () => { const S = global.Game && global.Game.state; return !!(S && S.policy && S.policy.p1.slots.length > 0); },
    },
    {
      id: 'draw',
      text: '点右下角的<b>「🎴 抽卡」</b>：花 1⚡ 翻开 5 张候选卡（不满意可重开，费用递增）。',
      target: '.corner-primary[data-modal="shop"]',
      wait: () => { const S = global.Game && global.Game.state; return !!(S && S.shop); },
    },
    {
      id: 'buy',
      text: '候选卡<b>按标价买入</b>手牌 —— 建议先买<b>农田或能源站</b>：经济是一切的根基。',
      target: '#shop-cards .card',
      wait: () => { const S = global.Game && global.Game.state; return !!(S && S.hand && S.hand.some(function (c) { return c; })); },
    },
    {
      id: 'build',
      text: '<b>按住这张卡</b>拖到地图上主城旁的高亮空格 —— 新建筑必须挨着道路或建筑（城市沿路生长）。',
      target: '#hand-slots .card',
      wait: () => { const S = global.Game && global.Game.state; return !!(S && Object.keys(S.buildings).length > 0); },
    },
    {
      /* ★ 第七十一次修订（方案D）：新玩家"不知道要去争夺资源点" —— 加一步专门讲。 */
      id: 'capture',
      text: '地图上散布着 <b>9 处资源点</b>：粮仓（+50 粮/Tick）、能量水晶（+12 ⚡/Tick）、哨塔（自动铺路）。<br><b>占领后有持续产出</b>，中期的攻防就围绕它们拉锯。<br>打法：<b>修路</b>连过去 → <b>兵营造兵</b> → <b>点击己方部队</b> → <b>点击资源点</b>，清掉守军即占领。<br>敌方也在抢 —— 谁控制资源点，谁就滚雪球。',
      center: true,
      btn: '知道了',
    },
    {
      id: 'done',
      text: '入门完成！接下来的循环：<br><b>修路</b>连接资源点 → <b>出兵</b>占领它们 → 攻破敌方主城。<br>细节随时在主菜单看「玩法说明」。',
      center: true,
      btn: '开始游戏',
    },
  ];

  const Tutorial = {
    active: false, step: -1, timer: 0, _reloc: 0, _relocStop: 0,

    /* 开局选择界面 —— menu.js start() 的新局分支调用。
     * ★ 仅首次（用户 2026-10-10 拍板）：玩家选过「查看引导」或「跳过」任一项后，
     *   localStorage 记标志，之后所有新局都不再弹 —— 即使换对局/重开也不弹。
     *   （换浏览器或清站点数据会再弹，属正常。）返回值：本次是否真的弹了。 */
    ask() {
      let asked = false;
      try { asked = global.localStorage.getItem('ccb_tutorial_asked') === '1'; } catch (e) { /* 隐私模式等忽略 */ }
      if (asked) return false;
      const S = global.Game && global.Game.state;
      if (S) S.paused = true;                    // 选择界面期间也停表
      const el = $('tut-choice');
      if (el) el.classList.remove('hidden');
      return true;
    },

    choose(accept) {
      /* 无论选哪边都算"已询问" —— 之后不再弹（用户拍板的行为） */
      try { global.localStorage.setItem('ccb_tutorial_asked', '1'); } catch (e) {}
      const el = $('tut-choice');
      if (el) el.classList.add('hidden');
      if (!accept) {
        const S = global.Game && global.Game.state;
        if (S) S.paused = false;
        return;
      }
      this.begin();
    },

    goto(i) {
      if (i >= STEPS.length) return this.finish();
      this.step = i;
      this.show(STEPS[i]);
    },

    next() { this.goto(this.step + 1); },

    /* at = 数字（1 起）时直接跳到第 at 步 —— 无头截图 / 回归测试用。
     * ⚠️ 直接 goto(at-1)：不能再走 next()（它还会 ++，实测 ?tut=1 显示成了第 2 步）。 */
    begin(at) {
      this.active = true;
      this.goto((typeof at === 'number' && at >= 1) ? at - 1 : 0);
      const root = $('tutorial');
      if (root) root.classList.remove('hidden');
      if (global.Game && global.Game.state) global.Game.state.paused = true;
    },

    show(st) {
      const bubble = $('tut-bubble'), finger = $('tut-finger');
      if (!bubble) return;
      $('tut-text').innerHTML = st.text;
      const nextBtn = $('tut-next');
      if (nextBtn) {
        nextBtn.classList.toggle('hidden', !st.center);
        if (st.btn) nextBtn.textContent = st.btn;
      }

      const centerBubble = () => {
        bubble.style.left = '50%'; bubble.style.top = '42%';
        bubble.style.transform = 'translate(-50%,-50%)';
        bubble.classList.remove('hidden');
        finger.classList.add('hidden');
      };

      this.clearHighlight();     // 换步骤清旧高亮；轮询的 place 不清（重复 add 同一类无害）
      const place = () => {
        let el = null;
        if (st.target) el = document.querySelector(st.target);
        if (!el) { centerBubble(); return; }
        const r = el.getBoundingClientRect();
        const vw = global.innerWidth, vh = global.innerHeight;
        // 手指压在目标中心；气泡放目标下方，放不下放上方，横向夹在视口内
        const bx = Math.min(Math.max(12, r.left + r.width / 2 - 140), vw - 292);
        let by = r.bottom + 14;
        if (by + 110 > vh) by = Math.max(12, r.top - 124);
        bubble.style.left = bx + 'px';
        bubble.style.top = by + 'px';
        bubble.style.transform = 'none';
        bubble.classList.remove('hidden');
        finger.style.left = (r.left + r.width / 2 - 19) + 'px';
        finger.style.top = (r.top + r.height / 2 - 34) + 'px';
        finger.classList.remove('hidden');
        el.classList.add('tut-highlight');
      };
      place();

      // 目标可能晚出现（政策弹窗 / 商店面板），轮询重定位；30s 后停止避免常驻开销
      clearInterval(this._reloc);
      this._reloc = setInterval(place, 400);
      clearTimeout(this._relocStop);
      this._relocStop = setTimeout(() => clearInterval(this._reloc), 30000);

      // 完成条件轮询
      clearInterval(this.timer);
      if (st.wait) {
        this.timer = setInterval(() => {
          if (!this.active) return clearInterval(this.timer);
          let ok = false;
          try { ok = st.wait(); } catch (e) { /* state 未就绪等忽略 */ }
          if (ok) { this.next(); }
        }, 400);
      }
    },

    clearHighlight() {
      document.querySelectorAll('.tut-highlight').forEach(function (el) {
        el.classList.remove('tut-highlight');
      });
      /* ⚠️ 不在这里清 _reloc：place() 开头会调它，会把自己的定位轮询清掉
       * （实测定位永远停在 rect=0 的首帧）。_reloc 在 show() 重设、finish() 清理。 */
    },

    skip() { this.finish(); },
    nextBtn() { this.next(); },                 // 居中步骤的「下一步」按钮

    finish() {
      this.active = false;
      this.clearHighlight();
      clearInterval(this.timer);
      clearInterval(this._reloc);
      clearTimeout(this._relocStop);
      const root = $('tutorial');
      if (root) root.classList.add('hidden');
      const bubble = $('tut-bubble'), finger = $('tut-finger');
      if (bubble) bubble.classList.add('hidden');
      if (finger) finger.classList.add('hidden');
      if (global.Game && global.Game.state) global.Game.state.paused = false;
    },

    /* 事件绑定：DOM 在 body 尾部，脚本加载时即就绪 */
    bind() {
      if ($('tut-accept')) $('tut-accept').addEventListener('click', () => this.choose(true));
      if ($('tut-skip')) $('tut-skip').addEventListener('click', () => this.choose(false));
      if ($('tut-next')) $('tut-next').addEventListener('click', () => this.nextBtn());
      if ($('tut-skip-run')) $('tut-skip-run').addEventListener('click', () => this.skip());
    },
  };

  Tutorial.bind();
  global.Tutorial = Tutorial;
})(window);
