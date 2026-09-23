/* app.js — 章節導覽與所有互動元件 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
   * 導覽：章節標籤、捲動進度、鍵盤快捷鍵
   * ============================================================ */
  const chapters = $$('.chapter');
  const tabs = $('#tabs');
  chapters.forEach((sec, i) => {
    const a = document.createElement('a');
    a.href = '#' + sec.id;
    a.innerHTML = '<span class="n">' + String(i).padStart(2, '0') + '</span>' + sec.dataset.title;
    a.dataset.target = sec.id;
    a.addEventListener('click', () => tabs.classList.remove('open'));
    tabs.appendChild(a);
  });
  const tabLinks = Array.from(tabs.children);

  $('#tabsToggle').addEventListener('click', () => tabs.classList.toggle('open'));

  let current = 0;
  function onScroll() {
    const y = window.scrollY, h = document.body.scrollHeight - innerHeight;
    $('#progressBar').style.width = (h > 0 ? Math.min(100, y / h * 100) : 0) + '%';
    const probe = y + innerHeight * 0.32;
    let idx = 0;
    chapters.forEach((s, i) => { if (s.offsetTop <= probe) idx = i; });
    if (idx !== current) {
      current = idx;
      tabLinks.forEach((a, i) => a.classList.toggle('active', i === idx));
      const act = tabLinks[idx];
      if (act && tabs.scrollWidth > tabs.clientWidth) {
        tabs.scrollTo({ left: act.offsetLeft - tabs.clientWidth / 2 + act.clientWidth / 2, behavior: 'smooth' });
      }
    }
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* 鍵盤：↓/PageDown 到下一章，↑/PageUp 到上一章 */
  addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea, button')) return;
    let d = 0;
    if (e.key === 'PageDown' || (e.key === 'ArrowDown' && e.altKey)) d = 1;
    if (e.key === 'PageUp' || (e.key === 'ArrowUp' && e.altKey)) d = -1;
    if (!d) return;
    e.preventDefault();
    const t = chapters[Math.max(0, Math.min(chapters.length - 1, current + d))];
    if (t) t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ============================================================
   * 共用小工具
   * ============================================================ */
  const stageColor = {}; EEG.STAGES.forEach(s => stageColor[s.key] = s.color);
  const stageName = {}; EEG.STAGES.forEach(s => stageName[s.key] = s.name);
  const bandByKey = {}; EEG.BANDS.forEach(b => bandByKey[b.key] = b);

  const specBands = EEG.BANDS.map(b => ({ lo: b.lo, hi: b.hi, color: b.color, name: b.name, short: b.name.split(' ')[0] }));

  function metric(label, value, cls) {
    return '<div class="metric ' + (cls || '') + '"><span class="k">' + label + '</span><span class="v">' + value + '</span></div>';
  }

  function slice(arr, a, b) { return Float64Array.from(arr.slice(a, b)); }

  /* 捲到畫面內才初始化（省電、避免一開始就算一堆 EMD） */
  function whenVisible(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) { io.disconnect(); fn(); } });
    }, { rootMargin: '250px' });
    io.observe(el);
  }

  /* ============================================================
   * 封面：滾動中的合成腦波
   * ============================================================ */
  (function hero() {
    const cv = $('#heroCanvas');
    const fs = 100, winSec = 6;
    let buf = EEG.generateEpoch('N2', { fs, seconds: 90 }).x;
    let pos = 0;
    const tag = $('#heroTag');
    const names = ['睡眠紡錘 12–14 Hz', 'K 複合波', 'θ 背景節律', 'δ 慢波成分'];
    let ni = 0;
    setInterval(() => { tag.textContent = names[ni++ % names.length]; }, 2600);

    function frame() {
      const n = winSec * fs;
      if (pos + n >= buf.length) { buf = EEG.generateEpoch('N2', { fs, seconds: 90 }).x; pos = 0; }
      const seg = slice(buf, pos, pos + n);
      Plot.wave(cv, [{ y: seg, color: '#7b95ff', width: 1.5 }],
        { fs, symmetric: true, showAxis: false, padL: 12 }, 230);
      pos += reduceMotion ? 0 : 2;
      if (!reduceMotion) requestAnimationFrame(frame);
    }
    frame();
  })();

  /* ============================================================
   * 互動 1 · 非平穩訊號：傅立葉 vs EMD
   * ============================================================ */
  whenVisible($('#demo-nonstat'), function () {
    const fs = 100, secs = 8, n = fs * secs;

    function build() {
      const f1 = +$('#f1').value, f2 = +$('#f2').value, ns = +$('#ns').value;
      $('#f1out').textContent = f1.toFixed(1) + ' Hz';
      $('#f2out').textContent = f2.toFixed(2) + ' Hz';
      $('#nsout').textContent = ns.toFixed(2);

      const x = new Float64Array(n);
      const mid = n / 2;
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        /* 中點附近以 0.3 秒的餘弦交叉淡化，避免不連續造成的假 IMF */
        const w = 0.5 + 0.5 * Math.tanh((i - mid) / (0.15 * fs));
        const a = Math.sin(2 * Math.PI * f1 * t);
        const b = Math.sin(2 * Math.PI * f2 * t);
        x[i] = (1 - w) * a + w * b + ns * DSP.gauss();
      }

      Plot.wave($('#nsSignal'), [{ y: x, color: '#7b95ff', width: 1.2 }],
        { fs, symmetric: true, title: '非平穩訊號 x(t)', xLabel: '時間', yLabel: '振幅（任意單位）' }, 150);
      Plot.spectrum($('#nsSpec'), DSP.spectrum(x, fs, 25),
        { fmax: 25, title: '整段傅立葉頻譜 |X(f)|', color: '#e0725f' }, 150);

      const res = DSP.emd(x, { maxImf: 7 });
      const top = res.imfs.slice(0, 2);
      const cols = ['#2bb3a3', '#d8a12f'];
      /* 上下排開，避免兩條曲線疊在一起看不清 */
      const off = top.map((y, i) => {
        const sd = DSP.stats(y).std || 1;
        const o = new Float64Array(n);
        for (let q = 0; q < n; q++) o[q] = y[q] / (3.4 * sd) - i;
        return { y: o, color: cols[i], width: 1.2 };
      });
      Plot.wave($('#nsImf1'), off, {
        fs, yRange: [-1.95, 0.95], showAxis: false, padL: 16,
        title: 'EMD 前兩個 IMF（各自標準化後上下排開）',
        xLabel: '時間',
        rightLabel: top.map((y, i) => 'IMF' + (i + 1) + ' ' + DSP.meanInstFreq(y, fs).toFixed(1) + ' Hz').join('　')
      }, 150);

      const tracks = res.imfs.slice(0, 4).map((imf, i) => {
        const h = DSP.hilbert(imf, fs);
        return { instFreq: h.instFreq, amp: h.amp, color: ['#2bb3a3', '#d8a12f', '#7b95ff', '#8b7cf0'][i] };
      });
      Plot.hilbertSpectrum($('#nsIF'), tracks,
        { fs, fmax: Math.max(20, f1 + 6), title: '希爾伯特頻譜：瞬時頻率隨時間變化' }, 172);
    }
    ['#f1', '#f2', '#ns'].forEach(s => $(s).addEventListener('input', build));
    build();
  });

  /* ============================================================
   * 互動 2 · 篩選逐步
   * ============================================================ */
  whenVisible($('#demo-sift'), function () {
    const fs = 100, secs = 4, n = fs * secs;
    let steps = [], k = -1, timer = null, src = null;

    function makeSignal() {
      const kind = $('#siftSrc').value;
      if (kind === 'synth') {
        const x = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const t = i / fs;
          const env = Math.exp(-((t - 2) ** 2) / (2 * 0.6 ** 2));
          x[i] = 2.4 * Math.sin(2 * Math.PI * 1 * t) + 1.1 * env * Math.sin(2 * Math.PI * 11 * t);
        }
        return x;
      }
      const ep = EEG.generateEpoch(kind, { fs, seconds: 30 });
      const off = Math.floor(Math.random() * (ep.x.length - n));
      return slice(ep.x, off, off + n);
    }

    function reset() {
      clearInterval(timer); timer = null;
      $('#siftAuto').textContent = '自動播放';
      src = makeSignal();
      steps = DSP.siftTrace(src, 10, 0.2);
      k = -1;
      draw();
    }

    function draw() {
      const cur = k < 0 ? null : steps[k];
      const input = cur ? cur.input : src;
      const ex = DSP.findExtrema(input);

      const series = [{ y: input, color: '#7b95ff', width: 1.6 }];
      if (cur) {
        series.push({ y: cur.upper, color: '#e0725f', width: 1, dash: [4, 4] });
        series.push({ y: cur.lower, color: '#4aa3e8', width: 1, dash: [4, 4] });
        series.push({ y: cur.mean, color: '#e0725f', width: 2 });
      }
      Plot.wave($('#siftTop'), series, {
        fs, symmetric: true,
        title: k < 0 ? '原始訊號 x(t)' : '第 ' + (k + 1) + ' 次篩選：h' + (k) + '(t) 與它的上下包絡',
        points: [
          { idx: ex.maxIdx, y: input, color: '#e0725f' },
          { idx: ex.minIdx, y: input, color: '#4aa3e8' }
        ],
        xLabel: '時間'
      }, 168);

      Plot.wave($('#siftBot'), [{ y: cur ? cur.output : input, color: '#2bb3a3', width: 1.6 }], {
        fs, symmetric: true,
        title: k < 0 ? '（尚未篩選）' : 'h' + (k + 1) + '(t) = h' + k + '(t) − m(t)',
        xLabel: '時間'
      }, 150);

      const st = cur || { sd: NaN, nExtrema: ex.maxIdx.length + ex.minIdx.length, nZero: DSP.countZeroCrossings(input) };
      const diff = Math.abs(st.nExtrema - st.nZero);
      const done = cur && cur.sd < 0.2;
      $('#siftMetrics').innerHTML =
        metric('篩選次數', (k + 1) + ' / ' + steps.length) +
        metric('SD 停止準則', isNaN(st.sd) ? '—' : st.sd.toFixed(4), done ? 'ok' : 'no') +
        metric('極值點數', st.nExtrema) +
        metric('零交越數', st.nZero) +
        metric('兩者差', diff, diff <= 1 ? 'ok' : 'no') +
        metric('是否為 IMF', done && diff <= 1 ? '是 ✓' : '尚未', done && diff <= 1 ? 'ok' : 'no');

      $('#siftNext').disabled = k >= steps.length - 1;
    }

    $('#siftNext').addEventListener('click', () => { if (k < steps.length - 1) { k++; draw(); } });
    $('#siftReset').addEventListener('click', reset);
    $('#siftSrc').addEventListener('change', reset);
    $('#siftAuto').addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; this.textContent = '自動播放'; return; }
      this.textContent = '暫停';
      timer = setInterval(() => {
        if (k >= steps.length - 1) { clearInterval(timer); timer = null; $('#siftAuto').textContent = '自動播放'; return; }
        k++; draw();
      }, 1100);
    });
    reset();
  });

  /* ============================================================
   * 互動 3 · EMD 分解器
   * ============================================================ */
  whenVisible($('#demo-emd'), function () {
    const fs = 100;
    $('#bandLegend').innerHTML = EEG.BANDS.map(b =>
      '<span><i style="background:' + b.color + '"></i>' + b.name + ' ' + b.lo + '–' + b.hi + ' Hz</span>').join('');

    function run() {
      const kind = $('#emdSrc').value;
      const secs = +$('#emdLen').value;
      $('#emdLenOut').textContent = secs + ' s';
      const n = fs * secs;

      let x;
      if (kind === 'synth') {
        x = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const t = i / fs;
          x[i] = 3 * Math.sin(2 * Math.PI * 1 * t) + 1.5 * Math.sin(2 * Math.PI * 7 * t)
               + 0.8 * Math.sin(2 * Math.PI * 20 * t);
        }
      } else {
        const ep = EEG.generateEpoch(kind, { fs, seconds: Math.max(secs, 30) });
        const off = Math.floor(Math.random() * (ep.x.length - n));
        x = slice(ep.x, off, off + n);
      }

      const t0 = performance.now();
      const res = DSP.emd(x, { maxImf: 9 });
      const ms = performance.now() - t0;

      let err = 0;
      for (let i = 0; i < n; i++) {
        let s = res.residue[i];
        res.imfs.forEach(m => s += m[i]);
        err = Math.max(err, Math.abs(s - x[i]));
      }
      $('#emdStat').textContent =
        res.imfs.length + ' 個 IMF · ' + ms.toFixed(0) + ' ms · 重建誤差 ' + err.toExponential(1);

      const stack = $('#imfStack');
      stack.innerHTML = '';
      const rows = [{ y: x, label: '原訊號', sub: 'x(t)', color: '#e7ecf7' }]
        .concat(res.imfs.map((y, i) => {
          const f = DSP.meanInstFreq(y, fs);
          const b = bandByKey[EEG.bandOf(f)];
          return { y, label: 'IMF ' + (i + 1), sub: f.toFixed(2) + ' Hz · ' + b.name, color: b.color };
        }))
        .concat([{ y: res.residue, label: '殘量 r(t)', sub: '單調趨勢', color: '#8d9bba' }]);

      rows.forEach(r => {
        const div = document.createElement('div');
        div.className = 'imf-row';
        div.style.borderLeftColor = r.color;
        div.innerHTML = '<div class="imf-tag"><b>' + r.label + '</b><span>' + r.sub + '</span></div>';
        const wrapC = document.createElement('div');
        const cv = document.createElement('canvas');
        wrapC.appendChild(cv); div.appendChild(wrapC);
        stack.appendChild(div);
        Plot.wave(cv, [{ y: r.y, color: r.color, width: 1.25 }], { fs, symmetric: true, padL: 40 }, 62);
      });
      Plot.watch(stack);
    }
    $('#emdRun').addEventListener('click', run);
    $('#emdSrc').addEventListener('change', run);
    $('#emdLen').addEventListener('input', () => { $('#emdLenOut').textContent = $('#emdLen').value + ' s'; });
    $('#emdLen').addEventListener('change', run);
    run();
  });

  /* ============================================================
   * 互動 4 · 希爾伯特頻譜
   * ============================================================ */
  whenVisible($('#demo-hht'), function () {
    const fs = 100, secs = 20;
    const sel = $('#hhtStage');
    EEG.STAGES.forEach(s => {
      const o = document.createElement('option');
      o.value = s.key; o.textContent = s.name;
      if (s.key === 'N2') o.selected = true;
      sel.appendChild(o);
    });
    const palette = ['#2bb3a3', '#d8a12f', '#7b95ff', '#8b7cf0', '#4aa3e8', '#e0725f', '#8d9bba'];
    $('#hhtLegend').innerHTML = palette.slice(0, 5).map((c, i) =>
      '<span><i style="background:' + c + '"></i>IMF ' + (i + 1) + '</span>').join('') +
      '<span class="muted">點的大小與亮度 ∝ 瞬時振幅</span>';

    function run() {
      const st = sel.value;
      const ep = EEG.generateEpoch(st, { fs, seconds: secs });
      const marks = ep.events.filter(e => e.t1 - e.t0 > 0.15)
        .map(e => ({ t0: e.t0, t1: e.t1, color: stageColor[st] }));
      Plot.wave($('#hhtSignal'), [{ y: ep.x, color: stageColor[st], width: 1.1 }],
        { fs, symmetric: true, title: stageName[st] + ' · ' + secs + ' 秒', marks, yLabel: 'µV' }, 132);

      const res = DSP.emd(ep.x, { maxImf: 7 });
      const tracks = res.imfs.slice(0, 5).map((imf, i) => {
        const h = DSP.hilbert(imf, fs);
        return { instFreq: h.instFreq, amp: h.amp, color: palette[i] };
      });
      Plot.hilbertSpectrum($('#hhtSpec'), tracks, { fs, fmax: 30, marks, title: '希爾伯特頻譜（色塊＝上圖標註出的特徵事件時段）' }, 250);

      const f = EEG.emdFeatures(ep.x, fs);
      $('#hhtStat').textContent = '主導頻帶：' +
        Object.entries(f.rel).sort((a, b) => b[1] - a[1]).slice(0, 2)
          .map(([k, v]) => bandByKey[k].name + ' ' + (v * 100).toFixed(0) + '%').join(' · ');
    }
    sel.addEventListener('change', run);
    $('#hhtRun').addEventListener('click', run);
    run();
  });

  /* ============================================================
   * 互動 5 · 睡眠腦波圖鑑 + 睡眠週期圖
   * ============================================================ */
  whenVisible($('#demo-atlas'), function () {
    const fs = 100;
    const tabsEl = $('#stageTabs');
    let cur = 'N2';

    EEG.STAGES.forEach(s => {
      const b = document.createElement('button');
      b.className = 'stage-tab'; b.textContent = s.name; b.dataset.k = s.key;
      b.addEventListener('click', () => { cur = s.key; paint(); });
      tabsEl.appendChild(b);
    });

    function paint() {
      Array.from(tabsEl.children).forEach(b => {
        const on = b.dataset.k === cur;
        b.classList.toggle('on', on);
        b.style.background = on ? stageColor[b.dataset.k] : '';
      });
      const meta = EEG.STAGES.find(s => s.key === cur);
      const ep = EEG.generateEpoch(cur, { fs, seconds: 30 });
      const marks = ep.events.filter(e => e.t1 - e.t0 > 0.15)
        .map(e => ({ t0: e.t0, t1: e.t1, color: stageColor[cur] }));
      Plot.wave($('#atlasWave'), [{ y: ep.x, color: stageColor[cur], width: 1.05 }],
        { fs, symmetric: true, title: '30 秒 epoch · ' + meta.name, marks, yLabel: 'µV', xLabel: '時間' }, 165);

      const f = EEG.emdFeatures(ep.x, fs);
      Plot.bars($('#atlasBars'), EEG.BANDS.map(b => ({
        label: b.name.split(' ')[0], value: f.rel[b.key],
        sub: (f.rel[b.key] * 100).toFixed(0) + '%', color: b.color
      })), { title: '各頻帶相對能量（由 IMF 的平均瞬時頻率歸類）', max: 1 }, 140);

      const evs = {};
      ep.events.forEach(e => evs[e.type] = (evs[e.type] || 0) + 1);
      const evtxt = Object.entries(evs).map(([k, v]) => k + ' ×' + v).join('、') || '無特別標註事件';
      $('#atlasDesc').innerHTML = meta.desc + '　<span class="muted">本段標註：' + evtxt + '</span>';
    }
    paint();

    /* 典型整夜睡眠結構 */
    const seq = [];
    const push = (s, k) => { for (let i = 0; i < k; i++) seq.push(s); };
    push('W', 3); push('N1', 2); push('N2', 7); push('N3', 10); push('N2', 4); push('R', 3);
    push('N1', 1); push('N2', 8); push('N3', 7); push('N2', 5); push('R', 6);
    push('N2', 7); push('N3', 3); push('N2', 6); push('R', 9);
    push('N2', 6); push('N1', 2); push('R', 10); push('N2', 4); push('W', 2);
    Plot.hypnogram($('#hypno'), seq, {}, 168);
  });

  /* ============================================================
   * 互動 7 · 判期實驗室
   * ============================================================ */
  whenVisible($('#demo-lab'), function () {
    const fs = 100, secs = 30;
    let model = null, quizEpoch = null, quizFeat = null, score = { ok: 0, n: 0 };

    $('#featDim').textContent = EEG.FEATURE_NAMES.length;

    const sync = (inp, out, fmt) => {
      const f = () => out.textContent = fmt(inp.value);
      inp.addEventListener('input', f); f();
    };
    sync($('#ntr'), $('#ntrOut'), v => v);
    sync($('#nte'), $('#nteOut'), v => v);
    sync($('#labNoise'), $('#labNoiseOut'), v => (+v).toFixed(1) + '×');

    const idle = () => new Promise(r => setTimeout(r, 0));

    async function train() {
      const per = +$('#ntr').value, noise = +$('#labNoise').value;
      const btn = $('#trainBtn'); btn.disabled = true; btn.textContent = '訓練中…';
      const samples = [];
      const total = per * EEG.STAGES.length;
      let done = 0;
      const t0 = performance.now();
      for (const st of EEG.STAGES) {
        for (let i = 0; i < per; i++) {
          const ep = EEG.generateEpoch(st.key, { fs, seconds: secs, noise });
          samples.push({ label: st.key, vec: EEG.emdFeatures(ep.x, fs).vec });
          done++;
          if (done % 3 === 0) {
            $('#trainBar').style.width = (done / total * 100) + '%';
            await idle();
          }
        }
      }
      $('#trainBar').style.width = '100%';
      model = EEG.trainNearestCentroid(samples);
      const ms = performance.now() - t0;

      /* 訓練集自身的分離度：質心間的最小距離 */
      const keys = Object.keys(model.cents);
      let minD = Infinity, pair = '';
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        let d = 0;
        for (let q = 0; q < model.d; q++) d += (model.cents[keys[i]][q] - model.cents[keys[j]][q]) ** 2;
        d = Math.sqrt(d);
        if (d < minD) { minD = d; pair = keys[i] + '↔' + keys[j]; }
      }
      $('#trainMetrics').innerHTML =
        metric('訓練 epoch', total) +
        metric('特徵維度', model.d) +
        metric('模擬時長', (total * secs / 60).toFixed(0) + ' 分') +
        metric('耗時', (ms / 1000).toFixed(1) + ' s') +
        metric('最接近的兩期', pair, 'no') +
        metric('質心距離', minD.toFixed(2));

      btn.disabled = false; btn.textContent = '重新訓練';
      $('#testBtn').disabled = false;
      $('#quizNew').disabled = false;
    }

    async function test() {
      if (!model) return;
      const per = +$('#nte').value, noise = +$('#labNoise').value;
      const btn = $('#testBtn'); btn.disabled = true; btn.textContent = '測試中…';
      const M = {}; EEG.STAGES.forEach(a => { M[a.key] = {}; EEG.STAGES.forEach(b => M[a.key][b.key] = 0); });
      let ok = 0, tot = 0, done = 0;
      const total = per * EEG.STAGES.length;
      for (const st of EEG.STAGES) {
        for (let i = 0; i < per; i++) {
          const ep = EEG.generateEpoch(st.key, { fs, seconds: secs, noise });
          const r = EEG.classify(model, EEG.emdFeatures(ep.x, fs).vec);
          M[st.key][r.best]++; tot++; if (r.best === st.key) ok++;
          done++;
          if (done % 3 === 0) { $('#trainBar').style.width = (done / total * 100) + '%'; await idle(); }
        }
      }
      /* Cohen's kappa */
      const N = tot;
      let pe = 0;
      EEG.STAGES.forEach(a => {
        const rowSum = EEG.STAGES.reduce((s, b) => s + M[a.key][b.key], 0);
        const colSum = EEG.STAGES.reduce((s, b) => s + M[b.key][a.key], 0);
        pe += (rowSum / N) * (colSum / N);
      });
      const po = ok / N;
      const kappa = (po - pe) / (1 - pe);

      let html = '<table class="cm"><caption>混淆矩陣　列＝真實期別，行＝演算法判定（' + tot + ' 個測試 epoch）</caption><thead><tr><th></th>';
      EEG.STAGES.forEach(s => html += '<th style="color:' + s.color + '">' + s.key + '</th>');
      html += '</tr></thead><tbody>';
      EEG.STAGES.forEach(a => {
        html += '<tr><th style="color:' + a.color + '">' + a.key + '</th>';
        EEG.STAGES.forEach(b => {
          const v = M[a.key][b.key];
          const diag = a.key === b.key;
          const alpha = v / per;
          html += '<td class="' + (diag ? 'diag' : '') + '" style="background:' +
            (v ? (diag ? 'rgba(43,179,163,' + (0.12 + alpha * 0.55) + ')' : 'rgba(224,114,95,' + (0.08 + alpha * 0.45) + ')') : 'transparent') +
            '">' + (v || '·') + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '<div class="metrics">' +
        metric('整體準確率', (po * 100).toFixed(1) + '%', 'ok') +
        metric("Cohen's κ", kappa.toFixed(3), kappa > 0.8 ? 'ok' : 'no') +
        '</div>';
      $('#confusionWrap').innerHTML = html;

      let bars = '<h4 class="mini-h">各期召回率（recall）</h4>';
      EEG.STAGES.forEach(s => {
        const r = M[s.key][s.key] / per;
        bars += '<div class="bar-row"><span class="nm">' + s.key + '</span>' +
          '<span class="tr"><i style="width:' + (r * 100) + '%;background:' + s.color + '"></i></span>' +
          '<span class="vv">' + (r * 100).toFixed(0) + '%</span></div>';
      });
      const worst = EEG.STAGES.map(s => ({ k: s.key, r: M[s.key][s.key] / per })).sort((a, b) => a.r - b.r)[0];
      bars += '<p class="cap">最難判的是 <b style="color:' + stageColor[worst.k] + '">' + worst.k +
        '</b>。文獻上同樣普遍回報 <b>N1</b> 的召回率最低——它是一個過渡狀態，' +
        '在單通道 EEG 上與 REM 的頻譜特徵高度重疊；臨床判讀要靠 EOG（眼動）與下巴 EMG（肌張力）才分得開。</p>';
      $('#perStage').innerHTML = bars;

      btn.disabled = false; btn.textContent = '重新測試';
    }

    /* --- 判讀小測驗 --- */
    const guessRow = $('#guessRow');
    EEG.STAGES.forEach(s => {
      const b = document.createElement('button');
      b.className = 'guess'; b.textContent = s.name; b.dataset.k = s.key;
      b.addEventListener('click', () => reveal(s.key));
      guessRow.appendChild(b);
    });

    function newQuiz() {
      const st = EEG.STAGES[Math.floor(Math.random() * EEG.STAGES.length)].key;
      quizEpoch = EEG.generateEpoch(st, { fs, seconds: secs, noise: +$('#labNoise').value });
      quizFeat = EEG.emdFeatures(quizEpoch.x, fs);
      Plot.wave($('#quizWave'), [{ y: quizEpoch.x, color: '#7b95ff', width: 1.05 }],
        { fs, symmetric: true, title: '這是哪一期？（30 秒 epoch）', yLabel: 'µV', xLabel: '時間' }, 170);
      Array.from(guessRow.children).forEach(b => { b.disabled = false; b.className = 'guess'; });
      $('#quizResult').innerHTML = '';
      $('#quizDetail').hidden = true;
    }

    function reveal(guess) {
      if (!quizEpoch) return;
      const truth = quizEpoch.stage;
      const pred = EEG.classify(model, quizFeat.vec);
      score.n++; if (guess === truth) score.ok++;
      $('#quizScore').textContent = '你的成績 ' + score.ok + ' / ' + score.n;

      Array.from(guessRow.children).forEach(b => {
        b.disabled = true;
        if (b.dataset.k === truth) b.classList.add('correct');
        else if (b.dataset.k === guess) b.classList.add('wrong');
      });

      const youOk = guess === truth, mOk = pred.best === truth;
      $('#quizResult').innerHTML =
        '<div class="verdict ' + (youOk ? 'good' : 'bad') + '">' +
        '正確答案是 <b>' + stageName[truth] + '</b>。你猜 ' + stageName[guess] + '　' + (youOk ? '✓ 答對了' : '✗ 答錯了') +
        '　·　演算法判定 <b>' + stageName[pred.best] + '</b>（信心 ' + (pred.scores[0].prob * 100).toFixed(0) + '%）' +
        (mOk ? ' ✓' : ' ✗') + '</div>';

      /* IMF 分解與特徵 */
      $('#quizDetail').hidden = false;
      const cv = $('#quizImfCanvas');
      const show = quizFeat.imfInfo.slice(0, 5);
      const off = show.map((d, i) => i);
      /* 疊加繪製前 5 個 IMF（各自加上垂直偏移） */
      const n = quizEpoch.x.length;
      const series = show.map((d, i) => {
        const sd = d.std || 1;
        const y = new Float64Array(n);
        for (let q = 0; q < n; q++) y[q] = d.imf[q] / (3.2 * sd) - i;
        return { y, color: bandByKey[d.band].color, width: 1.05 };
      });
      Plot.wave(cv, series, {
        fs, yRange: [-show.length + 0.35, 1.05],
        title: '前 ' + show.length + ' 個 IMF（各自標準化後上下排開）',
        xLabel: '時間', padL: 20, showAxis: false
      }, 190);
      /* IMF 的頻率標示另起一行，避免和標題擠在一起 */
      let tagHost = cv.parentElement.querySelector('.imf-freqs');
      if (!tagHost) {
        tagHost = document.createElement('div');
        tagHost.className = 'legend imf-freqs';
        cv.parentElement.appendChild(tagHost);
      }
      tagHost.innerHTML = show.map(d =>
        '<span><i style="background:' + bandByKey[d.band].color + '"></i>IMF' + d.index +
        ' · ' + d.freq.toFixed(1) + ' Hz</span>').join('');

      Plot.bars($('#quizBars'), EEG.BANDS.map(b => ({
        label: b.name.split(' ')[0], value: quizFeat.rel[b.key],
        sub: (quizFeat.rel[b.key] * 100).toFixed(0) + '%', color: b.color
      })), { title: 'IMF 歸類後的頻帶能量', max: 1 }, 140);

      $('#quizProbs').innerHTML = '<h4 class="mini-h">分類器的各期信心度</h4>' +
        pred.scores.map(s =>
          '<div class="bar-row"><span class="nm">' + s.stage + '</span>' +
          '<span class="tr"><i style="width:' + (s.prob * 100) + '%;background:' + stageColor[s.stage] + '"></i></span>' +
          '<span class="vv">' + (s.prob * 100).toFixed(0) + '%</span></div>').join('');
    }

    $('#trainBtn').addEventListener('click', train);
    $('#testBtn').addEventListener('click', test);
    $('#quizNew').addEventListener('click', newQuiz);
  });

  /* ============================================================
   * 互動 6 · 模態混疊：EMD vs EEMD
   * ============================================================ */
  whenVisible($('#demo-mix'), function () {
    const fs = 100, secs = 6, n = fs * secs;

    function drawStack(hostId, res, wins) {
      const host = $('#' + hostId);
      host.innerHTML = '';
      res.imfs.slice(0, 4).forEach((y, i) => {
        const f = DSP.meanInstFreq(y, fs);
        const b = bandByKey[EEG.bandOf(f)];
        const div = document.createElement('div');
        div.className = 'imf-row'; div.style.borderLeftColor = b.color;
        div.innerHTML = '<div class="imf-tag"><b>IMF ' + (i + 1) + '</b><span>' + f.toFixed(2) + ' Hz</span></div>';
        const w = document.createElement('div'); const cv = document.createElement('canvas');
        w.appendChild(cv); div.appendChild(w); host.appendChild(div);
        Plot.wave(cv, [{ y, color: b.color, width: 1.2 }], {
          fs, symmetric: true, padL: 38,
          marks: wins.map(([a2, b2]) => ({ t0: a2 / fs, t1: b2 / fs, color: '#d8a12f' }))
        }, 62);
      });
      Plot.watch(host);
    }

    const inWin = (i, wins) => wins.some(([a, b]) => i >= a && i < b);

    /* 叢發區間內的能量佔該 IMF 總能量的比例 */
    function concentration(imf, wins) {
      let inE = 0, all = 0;
      for (let i = 0; i < imf.length; i++) { const e = imf[i] * imf[i]; all += e; if (inWin(i, wins)) inE += e; }
      return all > 0 ? inE / all : 0;
    }
    /* 哪一個 IMF 最像「那些叢發」？ */
    function bestImf(res, wins) {
      let bi = 0, bv = -1;
      res.imfs.forEach((m, i) => { const c = concentration(m, wins); if (c > bv) { bv = c; bi = i; } });
      return { idx: bi + 1, conc: bv };
    }
    /* IMF1 有多少能量其實是低頻載波？（混疊的直接證據） */
    function carrierLeak(imf) {
      const sp = DSP.spectrum(imf, fs);
      let low = 0, all = 0;
      for (let i = 0; i < sp.freq.length; i++) { const e = sp.mag[i] ** 2; all += e; if (sp.freq[i] < 2.5) low += e; }
      return all > 0 ? low / all : 0;
    }

    function run() {
      const bl = +$('#mixLen').value, nb = +$('#mixNum').value;
      const ens = +$('#mixEns').value, amp = +$('#mixAmp').value;

      const x = new Float64Array(n);
      const wins = [];
      for (let i = 0; i < n; i++) x[i] = 1.4 * Math.sin(2 * Math.PI * 1 * (i / fs));
      for (let k = 0; k < nb; k++) {
        const t0 = (secs / (nb + 1)) * (k + 1) - bl / 2;
        const i0 = Math.round(t0 * fs), i1 = Math.round((t0 + bl) * fs);
        wins.push([i0, i1]);
        for (let i = i0; i < i1; i++) {
          const u = (i - i0) / (i1 - i0);
          x[i] += 1.0 * Math.sin(Math.PI * u) * Math.sin(2 * Math.PI * 12 * (i / fs));
        }
      }

      Plot.wave($('#mixSignal'), [{ y: x, color: '#e7ecf7', width: 1.3 }], {
        fs, symmetric: true, title: '輸入訊號：1 Hz 慢波 + ' + nb + ' 段 ' + bl.toFixed(2) + ' 秒的 12 Hz 叢發（金色區塊）',
        marks: wins.map(([a, b]) => ({ t0: a / fs, t1: b / fs, color: '#d8a12f' })), xLabel: '時間'
      }, 128);

      const A = DSP.emd(x, { maxImf: 7 });
      const B = DSP.eemd(x, ens, amp, { maxImf: 7 });
      drawStack('mixEmd', A, wins);
      drawStack('mixEemd', B, wins);

      const ba = bestImf(A, wins), bb = bestImf(B, wins);
      const la = carrierLeak(A.imfs[0]), lb = carrierLeak(B.imfs[0]);
      const good = v => '<b style="color:#2bb3a3">' + v + '</b>';
      const bad = v => '<b style="color:#e0725f">' + v + '</b>';
      const mark = (v, better) => (better ? good : bad)(v);

      $('#mixNote').innerHTML =
        '<b>最像那些叢發的是哪個 IMF？</b>　' +
        '標準 EMD → IMF' + ba.idx + '，叢發區間內佔其能量 ' + mark((ba.conc * 100).toFixed(0) + '%', ba.conc >= bb.conc) + '　·　' +
        'EEMD → IMF' + bb.idx + '，' + mark((bb.conc * 100).toFixed(0) + '%', bb.conc >= ba.conc) + '<br>' +
        '<b>IMF₁ 裡有多少其實是 1 Hz 慢波？</b>（混疊的直接證據）　' +
        '標準 EMD ' + mark((la * 100).toFixed(0) + '%', la <= lb) + '　·　' +
        'EEMD ' + mark((lb * 100).toFixed(0) + '%', lb <= la) + '<br><br>' +
        '叢發夠長時，兩者都分得開。但把<strong>叢發長度拉短到 0.2 秒以下</strong>，標準 EMD 的 IMF₁ 就會在「有叢發的時段抓叢發、' +
        '沒叢發的時段改抓慢波」之間擺盪——這就是模態混疊：<strong>同一個 IMF 在不同時間代表了完全不同的尺度</strong>，' +
        '從它算出來的瞬時頻率與統計動差自然也失去意義。EEMD 加進去的白雜訊填滿了那些「沒有東西可抓」的時段，' +
        '讓 IMF₁ 從頭到尾都守在同一個尺度上。<br>' +
        '<span class="muted">代價也看得到：雜訊振幅調大時，EEMD 的 IMF₁ 會被雜訊本身佔據，真正的訊號被推到 IMF₂ 去。' +
        '集成次數與雜訊振幅這兩個參數，是拿來換穩定度的。</span>';
    }

    ['#mixLen', '#mixNum', '#mixEns', '#mixAmp'].forEach(sel => {
      $(sel).addEventListener('input', () => {
        $('#mixLenOut').textContent = (+$('#mixLen').value).toFixed(2) + ' s';
        $('#mixNumOut').textContent = $('#mixNum').value;
        $('#mixEnsOut').textContent = $('#mixEns').value;
        $('#mixAmpOut').textContent = (+$('#mixAmp').value).toFixed(2) + '×σ';
      });
      $(sel).addEventListener('change', run);
    });
    $('#mixRun').addEventListener('click', run);
    run();
  });

  /* 全域：視窗改變時重畫所有已註冊的畫布 */
  Plot.watch(document);
  addEventListener('load', () => Plot.watch(document));
});
