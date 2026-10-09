/* =============================================================
 * Engine —— 零依赖 H5 游戏引擎层
 *
 * 提供：固定步长循环、场景栈、指针/键盘输入、程序化音效、
 *       存档、资源加载、数值调参面板、色键抠像、常用数学工具。
 *
 * 约定：
 *   1. 不使用 ES module —— 保证 file:// 双击直接可运行
 *   2. 逻辑坐标恒为 CFG/初始化的 width×height，绘制无需关心屏幕尺寸
 *   3. 玩法逻辑写在 game.js，本文件尽量不改
 * ============================================================= */
(function (global) {
  'use strict';

  const STEP = 1 / 60;          // 逻辑步长，固定 60Hz
  const MAX_DT = 0.25;          // 单帧最大补偿时间，防切后台后补帧爆炸

  let canvas, ctx, uiEl, stageEl, menuEl;
  let W = 720, H = 1280;        // 逻辑分辨率
  let dpr = 1, scale = 1, baseA = 1, baseD = 1;
  let acc = 0, last = 0, rafId = 0;
  let hitStopTimer = 0;
  let shakeAmp = 0, shakeTimer = 0, shakeDur = 0;
  let fpsAcc = 0, fpsCount = 0, fpsValue = 60;

  const scenes = [];            // 场景栈，尾部为当前场景

  /* ---------------- 初始化与自适应 ---------------- */

  function init(opts) {
    opts = opts || {};
    W = opts.width || 720;
    H = opts.height || 1280;
    canvas = opts.canvas || document.getElementById('game');
    ctx = canvas.getContext('2d');
    uiEl = document.getElementById('ui');
    stageEl = document.getElementById('stage');

    if (opts.background) canvas.style.background = opts.background;

    bindInput();
    bindDebug();
    global.addEventListener('resize', resize);
    global.addEventListener('orientationchange', resize);
    resize();
    return Engine;
  }

  function resize() {
    const host = (stageEl && stageEl.parentElement) || document.body;
    const cw = host.clientWidth || global.innerWidth;
    const ch = host.clientHeight || global.innerHeight;
    scale = Math.min(cw / W, ch / H);
    dpr = Math.min(global.devicePixelRatio || 1, 2);   // 上限 2，避免超高 dpr 拖垮性能

    const cssW = Math.round(W * scale);
    const cssH = Math.round(H * scale);

    stageEl.style.width = cssW + 'px';
    stageEl.style.height = cssH + 'px';
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    // UI 层用逻辑坐标布局后整体缩放，保证与 canvas 像素级对齐
    uiEl.style.width = W + 'px';
    uiEl.style.height = H + 'px';
    uiEl.style.transformOrigin = '0 0';
    uiEl.style.transform = 'scale(' + scale + ')';

    // 主界面覆盖层（#menu，第四十二次修订）：同样用逻辑坐标 + 整体缩放，
    // 且它住在 #stage 下、z-index 高于 #modal，所以弹窗不会盖在主界面上。
    menuEl = menuEl || document.getElementById('menu');
    if (menuEl) {
      menuEl.style.width = W + 'px';
      menuEl.style.height = H + 'px';
      menuEl.style.transformOrigin = '0 0';
      menuEl.style.transform = 'scale(' + scale + ')';
    }

    baseA = (cssW * dpr) / W;
    baseD = (cssH * dpr) / H;
  }

  /* ---------------- 主循环 ---------------- */

  function run(initialScene) {
    if (initialScene) push(initialScene);
    if (rafId) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_DT) dt = MAX_DT;

    // FPS 统计
    fpsAcc += dt; fpsCount++;
    if (fpsAcc >= 0.5) {
      fpsValue = Math.round(fpsCount / fpsAcc);
      const el = document.getElementById('fps');
      if (el) el.textContent = fpsValue;
      fpsAcc = 0; fpsCount = 0;
    }

    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 8) {   // guard 防止极端情况死循环
      if (hitStopTimer > 0) {
        hitStopTimer -= STEP;              // 顿帧：逻辑暂停，渲染继续
        input.endFrame();                  // 仍要清输入边沿，避免顿帧结束后重复触发
      } else {
        update(STEP);
      }
      acc -= STEP;
    }

    render();
    rafId = requestAnimationFrame(frame);
  }

  function update(dt) {
    // 从栈顶向上找到第一个"冻结下层"的场景，其下方一律不 update
    let start = 0;
    for (let i = scenes.length - 1; i > 0; i--) {
      if (scenes[i].pauseBelow) { start = i; break; }
    }
    for (let i = start; i < scenes.length; i++) {
      const s = scenes[i];
      if (s.update) s.update(dt, Engine);
    }

    if (shakeTimer > 0) shakeTimer -= dt;
    input.endFrame();
  }

  function render() {
    ctx.setTransform(baseA, 0, 0, baseD, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 找到最底部的可见场景（其上方若有不透明场景则被遮挡）
    let start = scenes.length - 1;
    while (start > 0 && scenes[start].transparent) start--;

    ctx.save();
    if (shakeTimer > 0 && shakeDur > 0) {
      const k = shakeAmp * (shakeTimer / shakeDur);   // 随时间线性衰减
      ctx.translate((Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k);
    }
    for (let i = start; i < scenes.length; i++) {
      const s = scenes[i];
      if (s.render) s.render(ctx, Engine);
    }
    ctx.restore();
  }

  /* ---------------- 场景栈 ---------------- */

  function push(s) { scenes.push(s); if (s.enter) s.enter(Engine); return s; }
  function pop() { const s = scenes.pop(); if (s && s.exit) s.exit(Engine); return s; }
  function replace(s) { while (scenes.length) pop(); return push(s); }
  function current() { return scenes[scenes.length - 1]; }

  /* ---------------- 输入 ---------------- */

  const input = {
    keys: new Set(),
    justKeys: new Set(),
    x: 0, y: 0,                 // 指针逻辑坐标
    down: false, justDown: false, justUp: false,

    isDown(code) { return this.keys.has(code); },
    pressed(code) { return this.justKeys.has(code); },
    /** 0~1 的轴向输入，支持 WASD 与方向键 */
    axis(negCode, posCode) {
      return (this.isDown(posCode) ? 1 : 0) - (this.isDown(negCode) ? 1 : 0);
    },
    endFrame() { this.justKeys.clear(); this.justDown = false; this.justUp = false; }
  };

  function bindInput() {
    global.addEventListener('keydown', e => {
      if (!input.keys.has(e.code)) input.justKeys.add(e.code);
      input.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
      audio.unlock();
    });
    global.addEventListener('keyup', e => input.keys.delete(e.code));
    global.addEventListener('blur', () => { input.keys.clear(); input.down = false; });

    const toLocal = e => {
      const r = canvas.getBoundingClientRect();
      input.x = (e.clientX - r.left) / r.width * W;
      input.y = (e.clientY - r.top) / r.height * H;
    };

    canvas.addEventListener('pointerdown', e => {
      toLocal(e); input.down = true; input.justDown = true; audio.unlock();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
    });
    canvas.addEventListener('pointermove', e => { toLocal(e); });
    // up 绑在 window 上，指针拖出 canvas 也能正确释放
    global.addEventListener('pointerup', e => { toLocal(e); input.down = false; input.justUp = true; });
    global.addEventListener('pointercancel', () => { input.down = false; input.justUp = true; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ---------------- 音频（程序化合成，无需音频文件） ---------------- */

  const audio = {
    ac: null, master: null, muted: false, volume: 0.6,

    unlock() {
      if (!this.ac) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ac.destination);
      }
      if (this.ac.state === 'suspended') this.ac.resume();
    },

    /** 基础音；slideTo 指定则频率滑向目标值（用于跳跃/得分） */
    tone(o) {
      if (this.muted) return;
      this.unlock();
      if (!this.ac) return;
      const freq = o.freq || 440;
      const dur = o.dur || 0.1;
      const vol = (o.vol == null ? 0.25 : o.vol);
      const t = this.ac.currentTime;
      const osc = this.ac.createOscillator();
      const gain = this.ac.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slideTo) osc.frequency.linearRampToValueAtTime(o.slideTo, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    /** 主界面设置用：改音量（立即作用于已创建的 master gain） */
    setVolume(v) {
      const n = Number(v);
      this.volume = Math.max(0, Math.min(1, isFinite(n) ? n : this.volume));
      if (this.master) this.master.gain.value = this.volume;
      return this.volume;
    },

    // 常用音效预设
    click()  { this.tone({ freq: 520, dur: 0.05, type: 'square', vol: 0.15 }); },
    hit()    { this.tone({ freq: 880, slideTo: 300, dur: 0.09, type: 'square', vol: 0.22 }); },
    jump()   { this.tone({ freq: 300, slideTo: 620, dur: 0.12, type: 'square', vol: 0.18 }); },
    hurt()   { this.tone({ freq: 200, slideTo: 80,  dur: 0.22, type: 'sawtooth', vol: 0.25 }); },
    pickup() { this.tone({ freq: 660, dur: 0.07, type: 'triangle', vol: 0.2 });
               setTimeout(() => this.tone({ freq: 990, dur: 0.09, type: 'triangle', vol: 0.2 }), 70); },
    win()    { [523, 659, 784, 1047].forEach((f, i) =>
                 setTimeout(() => this.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.22 }), i * 110)); },
    lose()   { [440, 349, 262].forEach((f, i) =>
                 setTimeout(() => this.tone({ freq: f, dur: 0.18, type: 'sawtooth', vol: 0.2 }), i * 140)); }
  };

  /* ---------------- 存档 ---------------- */

  const save = {
    prefix: 'gamedemo_',
    load(key, defaults) {
      try {
        const raw = localStorage.getItem(this.prefix + key);
        if (!raw) return defaults;
        const data = JSON.parse(raw);
        // 版本不符则丢弃旧档，避免结构变更后崩溃
        if (data && data.__v !== (defaults.__v || 1)) return defaults;
        return data;
      } catch (e) { return defaults; }   // 无痕模式下 localStorage 可能抛异常
    },
    write(key, obj) {
      try { localStorage.setItem(this.prefix + key, JSON.stringify(obj)); return true; }
      catch (e) { return false; }
    },
    clear(key) { try { localStorage.removeItem(this.prefix + key); } catch (e) {} }
  };

  /* ---------------- 资源 ---------------- */

  const assets = {
    map: {},
    /** 传入 {name: url}，返回 Promise；chromaKey 为 true 时自动去除品红背景 */
    loadAll(list, doChromaKey) {
      const names = Object.keys(list);
      return Promise.all(names.map(n => new Promise(res => {
        const img = new Image();
        img.onload = () => {
          if (doChromaKey) res([n, util.chromaKey(img, [255, 0, 255], 60)]);
          else res([n, img]);
        };
        img.onerror = () => res([n, null]);   // 单张失败不阻塞整体
        img.src = list[n];
      }))).then(pairs => { pairs.forEach(p => { this.map[p[0]] = p[1]; }); return this.map; });
    },
    get(name) { return this.map[name]; }
  };

  /* ---------------- 工具 ---------------- */

  const util = {
    clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    choice: arr => arr[Math.floor(Math.random() * arr.length)],
    chance: p => Math.random() < p,
    dist2: (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },

    aabb(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },
    circleHit(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r;
      return dx * dx + dy * dy < r * r;
    },

    ease: {
      outCubic: t => 1 - Math.pow(1 - t, 3),
      inQuad:   t => t * t,
      outQuad:  t => 1 - (1 - t) * (1 - t),
      outBack:  t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
      outElastic: t => t === 0 || t === 1 ? t :
        Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1
    },

    /** 去背：AI 生成的图通常无透明通道，用纯色背景 + 色键解决 */
    chromaKey(src, key, threshold) {
      key = key || [255, 0, 255];
      threshold = threshold || 60;
      const w = src.width || src.naturalWidth;
      const h = src.height || src.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d');
      c.drawImage(src, 0, 0);
      const img = c.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const dist = Math.abs(d[i] - key[0]) + Math.abs(d[i + 1] - key[1]) + Math.abs(d[i + 2] - key[2]);
        if (dist < threshold) d[i + 3] = 0;
      }
      c.putImageData(img, 0, 0);
      return cv;
    },

    /** 大数格式化：1234567 -> 1.23M */
    formatBig(n) {
      const units = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];
      if (n < 1000) return Math.floor(n).toString();
      let u = 0;
      while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
      return n.toFixed(n < 10 ? 2 : (n < 100 ? 1 : 0)) + units[u];
    },

    /** 简单对象池：避免高频创建销毁导致 GC 抖动 */
    pool(factory, reset) {
      const free = [];
      return {
        active: [],
        get() { const o = free.pop() || factory(); this.active.push(o); return o; },
        release(i) { const o = this.active[i]; reset(o); free.push(o); this.active.splice(i, 1); },
        clear() { while (this.active.length) this.release(0); }
      };
    },

    /** 按点路径读写对象，供调参面板使用：get(CFG, 'player.speed') */
    getPath: (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj),
    setPath: (obj, path, v) => {
      const ks = path.split('.');
      const last = ks.pop();
      const t = ks.reduce((o, k) => o[k], obj);
      t[last] = v;
    }
  };

  /* ---------------- 调试面板 ---------------- */

  const debug = {
    enabled: false,
    el: null, body: null,

    toggle(force) {
      this.enabled = force == null ? !this.enabled : force;
      if (!this.el) { this.el = document.getElementById('debug'); this.body = document.getElementById('dbg-body'); }
      if (this.el) this.el.classList.toggle('hidden', !this.enabled);
    },

    _row(label, node, valueEl) {
      if (!this.body) return;
      const row = document.createElement('div');
      row.className = 'dbg-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      row.appendChild(lab);
      row.appendChild(node);
      if (valueEl) row.appendChild(valueEl);
      this.body.appendChild(row);
    },

    /** 绑定 CFG 数值到滑块，拖动即时生效；label 可选，省略时显示 CFG 路径 */
    slider(path, min, max, step, label) {
      const target = global.CFG || {};
      const init = util.getPath(target, path);
      if (init == null) return;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = min; range.max = max; range.step = step || 1;
      range.value = init;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = init;
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        util.setPath(target, path, v);
        val.textContent = Math.round(v * 100) / 100;
      });
      this._row(label || path, range, val);
    },

    /** 分组小标题（纯展示） */
    group(title) {
      if (!this.body) return;
      const el = document.createElement('div');
      el.className = 'dbg-group';
      el.textContent = title;
      this.body.appendChild(el);
    },

    button(label, fn) {
      const b = document.createElement('button');
      b.className = 'dbg-btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      if (this.body) this.body.appendChild(b);
    }
  };

  function bindDebug() {
    // 提前取到面板节点：场景 enter() 时注册的滑块才能正确插入 DOM
    debug.el = document.getElementById('debug');
    debug.body = document.getElementById('dbg-body');
    global.addEventListener('keydown', e => {
      if (e.code === 'Backquote' || e.code === 'KeyD') debug.toggle();
    });
    const close = document.getElementById('dbg-close');
    if (close) close.addEventListener('click', () => debug.toggle(false));
  }

  /* ---------------- 导出 ---------------- */

  const Engine = {
    init, run,
    scene: { push, pop, replace, current, list: scenes },
    input, audio, save, assets, util, debug,
    /** 顿帧：命中反馈的核心手段，逻辑暂停但渲染继续 */
    hitStop(t) { hitStopTimer = Math.max(hitStopTimer, t); },
    /** 屏幕震动：新震动更强或更久时覆盖旧的 */
    shake(amp, dur) {
      dur = dur || 0.2;
      if (dur >= shakeTimer) { shakeAmp = amp; shakeDur = dur; }
      shakeTimer = Math.max(shakeTimer, dur);
    },
    get ctx() { return ctx; },
    get canvas() { return canvas; },
    get W() { return W; },
    get H() { return H; },
    get scale() { return scale; },
    get fps() { return fpsValue; }
  };

  global.Engine = Engine;
})(window);
