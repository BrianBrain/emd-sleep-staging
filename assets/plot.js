/* plot.js — 輕量 Canvas 繪圖工具（無外部相依，支援 DPR 與自動重繪） */
'use strict';

const Plot = (function () {

  const registry = new WeakMap();

  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  const C = () => ({
    grid: css('--grid', '#1b2237'),
    axis: css('--line', '#2a3450'),
    text: css('--muted', '#93a0bd'),
    strong: css('--text', '#e6ebf5'),
    accent: css('--accent', '#6f8cff'),
    accent2: css('--accent-2', '#2bb3a3'),
    warn: css('--warn', '#e0725f'),
    panel: css('--panel', '#121829')
  });

  function prepare(canvas, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
    const height = h || canvas.clientHeight || 160;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    return { ctx, w, h: height };
  }

  /* 註冊繪圖函式，視窗改變大小時自動重畫 */
  function render(canvas, drawFn, height) {
    registry.set(canvas, { drawFn, height });
    const { ctx, w, h } = prepare(canvas, height);
    drawFn(ctx, w, h, C());
  }

  let ro = null;
  function watch(root) {
    if (!('ResizeObserver' in window)) return;
    ro = ro || new ResizeObserver(entries => {
      for (const e of entries) {
        const rec = registry.get(e.target);
        if (rec) { const p = prepare(e.target, rec.height); rec.drawFn(p.ctx, p.w, p.h, C()); }
      }
    });
    (root || document).querySelectorAll('canvas').forEach(c => { if (registry.has(c)) ro.observe(c); });
  }

  function niceRange(min, max) {
    if (!isFinite(min) || !isFinite(max) || min === max) { return [min - 1, max + 1]; }
    const pad = (max - min) * 0.12;
    return [min - pad, max + pad];
  }

  /* ---- 波形圖 ----
   * series: [{y:Float64Array, color, width, dash, label}]
   * opts: {fs, yRange, xLabel, yLabel, title, marks:[{t0,t1,label,color}],
   *        vlines:[{t,color}], showAxis, padL, symmetric}
   */
  function wave(canvas, series, opts, height) {
    opts = opts || {};
    render(canvas, (ctx, w, h, col) => {
      const padL = opts.padL == null ? 46 : opts.padL;
      const padR = 10, padT = opts.title ? 20 : 8, padB = opts.xLabel ? 26 : 14;
      const pw = w - padL - padR, ph = h - padT - padB;
      const fs = opts.fs || 100;
      const n = series.length ? series[0].y.length : 0;
      if (!n) return;

      let lo = Infinity, hi = -Infinity;
      series.forEach(s => { for (let i = 0; i < s.y.length; i++) { if (s.y[i] < lo) lo = s.y[i]; if (s.y[i] > hi) hi = s.y[i]; } });
      if (opts.yRange) { lo = opts.yRange[0]; hi = opts.yRange[1]; }
      else if (opts.symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; [lo, hi] = niceRange(lo, hi); }
      else { [lo, hi] = niceRange(lo, hi); }

      const X = i => padL + (i / (n - 1)) * pw;
      const Y = v => padT + ph - ((v - lo) / (hi - lo)) * ph;

      /* 事件標註區塊 */
      (opts.marks || []).forEach(m => {
        const x0 = padL + (m.t0 * fs / (n - 1)) * pw;
        const x1 = padL + (m.t1 * fs / (n - 1)) * pw;
        ctx.fillStyle = (m.color || col.accent) + '22';
        ctx.fillRect(x0, padT, Math.max(2, x1 - x0), ph);
        ctx.strokeStyle = (m.color || col.accent) + '66';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, padT + 0.5, Math.max(2, x1 - x0), ph);
      });

      /* 格線 */
      ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) { const y = padT + (k / 4) * ph; ctx.moveTo(padL, y + 0.5); ctx.lineTo(w - padR, y + 0.5); }
      ctx.stroke();

      /* 零線 */
      if (lo < 0 && hi > 0) {
        ctx.strokeStyle = col.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, Y(0) + 0.5); ctx.lineTo(w - padR, Y(0) + 0.5); ctx.stroke();
      }

      /* 曲線 */
      series.forEach(s => {
        ctx.save();
        ctx.strokeStyle = s.color || col.accent;
        ctx.lineWidth = s.width || 1.4;
        if (s.dash) ctx.setLineDash(s.dash);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const step = Math.max(1, Math.floor(s.y.length / (pw * 3)));
        for (let i = 0; i < s.y.length; i += step) {
          const x = X(i), y = Y(s.y[i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (s.fill) {
          ctx.lineTo(X(s.y.length - 1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
          ctx.fillStyle = (s.color || col.accent) + '22'; ctx.fill();
        }
        ctx.restore();
      });

      /* 散點（極值點） */
      (opts.points || []).forEach(p => {
        ctx.fillStyle = p.color || col.warn;
        p.idx.forEach(i => { ctx.beginPath(); ctx.arc(X(i), Y(p.y ? p.y[i] : 0), p.r || 2.4, 0, 6.2832); ctx.fill(); });
      });

      /* 垂直線 */
      (opts.vlines || []).forEach(v => {
        ctx.strokeStyle = v.color || col.warn; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        const x = padL + (v.t * fs / (n - 1)) * pw;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
        ctx.setLineDash([]);
      });

      /* 座標軸文字 */
      ctx.fillStyle = col.text;
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      if (opts.showAxis !== false) {
        ctx.fillText(fmt(hi), padL - 6, padT + 4);
        ctx.fillText(fmt(lo), padL - 6, padT + ph - 4);
        if (lo < 0 && hi > 0) ctx.fillText('0', padL - 6, Y(0));
      }
      if (opts.title) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = opts.titleColor || col.strong;
        ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(opts.title, padL, 2);
      }
      if (opts.rightLabel) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillStyle = col.text;
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(opts.rightLabel, w - padR, 2);
      }
      if (opts.xLabel) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = col.text; ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(opts.xLabel, padL + pw / 2, h - 2);
        ctx.textAlign = 'left'; ctx.fillText('0', padL, h - 2);
        ctx.textAlign = 'right'; ctx.fillText(((n - 1) / fs).toFixed(1) + ' s', w - padR, h - 2);
      }
      if (opts.yLabel && !opts.rightLabel) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillStyle = col.text; ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(opts.yLabel, w - padR, opts.title ? 4 : 2);
      }
    }, height);
  }

  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  /* ---- 頻譜圖（線性 x 軸，可加頻帶底色） ---- */
  function spectrum(canvas, spec, opts, height) {
    opts = opts || {};
    render(canvas, (ctx, w, h, col) => {
      const padL = 46, padR = 10, padT = opts.title ? 20 : 8, padB = 28;
      const pw = w - padL - padR, ph = h - padT - padB;
      const fmax = opts.fmax || 35;
      let hi = 0;
      for (let i = 0; i < spec.freq.length; i++) if (spec.freq[i] <= fmax && spec.mag[i] > hi) hi = spec.mag[i];
      hi = hi || 1;
      const X = f => padL + (f / fmax) * pw;
      const Y = v => padT + ph - (v / hi) * ph;

      (opts.bands || []).forEach(b => {
        if (b.lo >= fmax) return;
        ctx.fillStyle = b.color + '1a';
        ctx.fillRect(X(b.lo), padT, X(Math.min(b.hi, fmax)) - X(b.lo), ph);
        ctx.fillStyle = b.color + 'cc';
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const cx = (X(b.lo) + X(Math.min(b.hi, fmax))) / 2;
        if (X(Math.min(b.hi, fmax)) - X(b.lo) > 22) ctx.fillText(b.short || b.name, cx, padT + 2);
      });

      ctx.strokeStyle = col.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k <= 4; k++) { const y = padT + (k / 4) * ph; ctx.moveTo(padL, y + .5); ctx.lineTo(w - padR, y + .5); }
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      for (let i = 0; i < spec.freq.length; i++) {
        if (spec.freq[i] > fmax) break;
        ctx.lineTo(X(spec.freq[i]), Y(spec.mag[i]));
      }
      ctx.lineTo(X(fmax), Y(0));
      ctx.closePath();
      ctx.fillStyle = (opts.color || col.accent) + '33'; ctx.fill();
      ctx.strokeStyle = opts.color || col.accent; ctx.lineWidth = 1.6; ctx.stroke();

      ctx.fillStyle = col.text; ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (let f = 0; f <= fmax; f += (fmax > 20 ? 5 : 2)) ctx.fillText(String(f), X(f), h - 12);
      ctx.fillText('頻率 (Hz)', padL + pw / 2, h - 1);
      if (opts.title) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = col.strong; ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(opts.title, padL, 2);
      }
    }, height);
  }

  /* ---- 長條圖 ---- */
  function bars(canvas, items, opts, height) {
    opts = opts || {};
    render(canvas, (ctx, w, h, col) => {
      const padL = 10, padR = 10, padT = opts.title ? 22 : 8, padB = 34;
      const pw = w - padL - padR, ph = h - padT - padB;
      const hi = opts.max || Math.max(...items.map(i => i.value), 1e-9);
      const bw = pw / items.length;
      items.forEach((it, k) => {
        const bh = Math.max(1, (it.value / hi) * ph);
        const x = padL + k * bw + bw * 0.18, bwidth = bw * 0.64;
        const g = ctx.createLinearGradient(0, padT + ph - bh, 0, padT + ph);
        g.addColorStop(0, it.color); g.addColorStop(1, it.color + '55');
        ctx.fillStyle = g;
        rrect(ctx, x, padT + ph - bh, bwidth, bh, Math.min(4, bwidth / 2));
        ctx.fill();
        ctx.fillStyle = col.text;
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(it.label, x + bwidth / 2, padT + ph + 5);
        if (it.sub) { ctx.fillStyle = col.text + 'aa'; ctx.font = '10px ui-monospace, monospace'; ctx.fillText(it.sub, x + bwidth / 2, padT + ph + 19); }
      });
      ctx.strokeStyle = col.axis; ctx.beginPath();
      ctx.moveTo(padL, padT + ph + .5); ctx.lineTo(w - padR, padT + ph + .5); ctx.stroke();
      if (opts.title) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = col.strong; ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(opts.title, padL, 2);
      }
    }, height);
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ---- 希爾伯特頻譜：時間-瞬時頻率-振幅散點 ---- */
  function hilbertSpectrum(canvas, tracks, opts, height) {
    opts = opts || {};
    render(canvas, (ctx, w, h, col) => {
      const padL = 46, padR = 10, padT = opts.title ? 20 : 8, padB = 28;
      const pw = w - padL - padR, ph = h - padT - padB;
      const fs = opts.fs || 100, fmax = opts.fmax || 32;
      const n = tracks.length ? tracks[0].instFreq.length : 0;
      if (!n) return;

      ctx.fillStyle = col.panel; ctx.fillRect(padL, padT, pw, ph);
      (opts.marks || []).forEach(mk => {
        const x0 = padL + (mk.t0 * fs / (n - 1)) * pw;
        const x1 = padL + (mk.t1 * fs / (n - 1)) * pw;
        ctx.fillStyle = (mk.color || col.accent) + '22';
        ctx.fillRect(x0, padT, Math.max(2, x1 - x0), ph);
      });
      ctx.strokeStyle = col.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (let f = 0; f <= fmax; f += 5) { const y = padT + ph - (f / fmax) * ph; ctx.moveTo(padL, y + .5); ctx.lineTo(w - padR, y + .5); }
      ctx.stroke();

      let amax = 0;
      tracks.forEach(t => t.amp.forEach(a => { if (a > amax) amax = a; }));
      amax = amax || 1;

      const step = Math.max(1, Math.floor(n / (pw * 2)));
      tracks.forEach(t => {
        for (let i = 0; i < n; i += step) {
          const f = t.instFreq[i];
          if (f > fmax || f <= 0) continue;
          const a = t.amp[i] / amax;
          if (a < 0.03) continue;
          const x = padL + (i / (n - 1)) * pw;
          const y = padT + ph - (f / fmax) * ph;
          ctx.globalAlpha = Math.min(1, 0.12 + a * 1.1);
          ctx.fillStyle = t.color;
          const r = 0.9 + a * 2.6;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        }
      });
      ctx.globalAlpha = 1;

      ctx.fillStyle = col.text; ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let f = 0; f <= fmax; f += 5) ctx.fillText(String(f), padL - 6, padT + ph - (f / fmax) * ph);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('時間 (s)', padL + pw / 2, h - 1);
      ctx.textAlign = 'left'; ctx.fillText('0', padL, h - 1);
      ctx.textAlign = 'right'; ctx.fillText(((n - 1) / fs).toFixed(0) + ' s', w - padR, h - 1);
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('瞬時頻率 (Hz)', w - padR, opts.title ? 4 : 2);
      if (opts.title) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = col.strong; ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(opts.title, padL, 2);
      }
    }, height);
  }

  /* ---- 睡眠週期圖（hypnogram） ---- */
  function hypnogram(canvas, seq, opts, height) {
    opts = opts || {};
    const order = ['W', 'R', 'N1', 'N2', 'N3'];
    render(canvas, (ctx, w, h, col) => {
      const padL = 42, padR = 10, padT = 10, padB = 24;
      const pw = w - padL - padR, ph = h - padT - padB;
      const rows = order.length;
      const rh = ph / rows;
      ctx.strokeStyle = col.grid; ctx.beginPath();
      for (let k = 0; k <= rows; k++) { const y = padT + k * rh; ctx.moveTo(padL, y + .5); ctx.lineTo(w - padR, y + .5); }
      ctx.stroke();
      ctx.fillStyle = col.text; ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      order.forEach((s, k) => ctx.fillText(s, padL - 6, padT + rh * (k + 0.5)));

      const stageColor = {}; EEG.STAGES.forEach(s => stageColor[s.key] = s.color);
      ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      seq.forEach((s, i) => {
        const y = padT + rh * (order.indexOf(s) + 0.5);
        const x0 = padL + (i / seq.length) * pw, x1 = padL + ((i + 1) / seq.length) * pw;
        if (i === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
      });
      ctx.strokeStyle = col.accent; ctx.stroke();
      seq.forEach((s, i) => {
        const y = padT + rh * (order.indexOf(s) + 0.5);
        const x0 = padL + (i / seq.length) * pw, x1 = padL + ((i + 1) / seq.length) * pw;
        ctx.fillStyle = stageColor[s] + '55';
        ctx.fillRect(x0, y - 3, x1 - x0, 6);
      });
      ctx.fillStyle = col.text; ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('整夜時間（約 8 小時）', padL + pw / 2, h - 1);
    }, height);
  }

  return { wave, spectrum, bars, hilbertSpectrum, hypnogram, render, watch, colors: C };
})();
