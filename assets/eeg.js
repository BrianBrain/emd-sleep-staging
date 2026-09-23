/* eeg.js — 合成睡眠腦波產生器 + 以 EMD 為基礎的特徵抽取與分類器
 * 波形規格依 AASM 判讀手冊（Berry et al., 2017）對各期的描述設計，
 * 目的是教學演示，不是真實 PSG 訊號。
 */
'use strict';

const EEG = (function () {

  /* ---------------- 可重現的亂數 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rnd = Math.random;
  function seed(s) { rnd = mulberry32(s >>> 0); DSP.setRandom(rnd); }
  seed(20260923);

  /* ---------------- 頻帶定義（AASM / 臨床慣例） ---------------- */
  const BANDS = [
    { key: 'delta', name: 'δ 慢波', lo: 0.5, hi: 4,  color: '#7c6cf0' },
    { key: 'theta', name: 'θ 波',  lo: 4,   hi: 8,  color: '#3f9ee8' },
    { key: 'alpha', name: 'α 波',  lo: 8,   hi: 12, color: '#2bb3a3' },
    { key: 'sigma', name: 'σ 紡錘', lo: 12,  hi: 16, color: '#d8a12f' },
    { key: 'beta',  name: 'β 波',  lo: 16,  hi: 32, color: '#e0725f' },
    { key: 'emg',   name: '肌電/高頻', lo: 32, hi: 50, color: '#8b93a7' }
  ];
  function bandOf(f) {
    for (const b of BANDS) if (f >= b.lo && f < b.hi) return b.key;
    return f < 0.5 ? 'delta' : 'emg';
  }

  const STAGES = [
    { key: 'W',  name: '清醒 Wake', color: '#e0725f',
      desc: '枕區 α 節律（8–12 Hz）為主、混雜 β 與肌電高頻；振幅中等。' },
    { key: 'N1', name: 'N1 淺睡期', color: '#d8a12f',
      desc: 'α 消退、低振幅混合頻率以 θ（4–7 Hz）為主，可見頂尖波。' },
    { key: 'N2', name: 'N2 穩定睡眠', color: '#2bb3a3',
      desc: 'θ 背景上出現睡眠紡錘（12–14 Hz, ≥0.5 s）與 K 複合波。' },
    { key: 'N3', name: 'N3 深睡（慢波）', color: '#7c6cf0',
      desc: '0.5–2 Hz、峰對峰 >75 µV 的慢波佔該 epoch 20% 以上。' },
    { key: 'R',  name: 'REM 快速動眼', color: '#3f9ee8',
      desc: '低振幅混合頻率、鋸齒波（2–6 Hz）、肌張力最低。' }
  ];

  /* ---------------- 訊號元件 ---------------- */

  /* 以 FFT 整形產生帶限雜訊，回傳單位標準差的序列 */
  function bandNoise(n, fs, f1, f2) {
    const N = DSP.nextPow2(n * 2);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = DSP.gauss();
    DSP.fft(re, im, false);
    for (let k = 0; k <= N / 2; k++) {
      const f = k * fs / N;
      let g = 1;
      if (f < f1 || f > f2) g = 0;
      else {
        /* 兩端以餘弦錐狀漸變，避免過陡的濾波振鈴 */
        const edge = Math.min(f - f1, f2 - f) / Math.max(1e-9, (f2 - f1) * 0.25);
        g = edge < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, edge)) : 1;
      }
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
    }
    DSP.fft(re, im, true);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = re[i + ((N - n) >> 1)];
    let m = 0; for (let i = 0; i < n; i++) m += out[i]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (out[i] - m) ** 2;
    const sd = Math.sqrt(v / n) || 1;
    for (let i = 0; i < n; i++) out[i] = (out[i] - m) / sd;
    return out;
  }

  /* 1/f 背景雜訊（腦電的非週期性成分） */
  function pinkNoise(n, fs) {
    const N = DSP.nextPow2(n * 2);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = DSP.gauss();
    DSP.fft(re, im, false);
    for (let k = 0; k <= N / 2; k++) {
      const f = Math.max(0.3, k * fs / N);
      const g = 1 / Math.pow(f, 0.9);
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
    }
    DSP.fft(re, im, true);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = re[i];
    let m = 0; for (let i = 0; i < n; i++) m += out[i]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (out[i] - m) ** 2;
    const sd = Math.sqrt(v / n) || 1;
    for (let i = 0; i < n; i++) out[i] = (out[i] - m) / sd;
    return out;
  }

  /* 高斯包絡的節律叢發（睡眠紡錘、α 叢發、鋸齒波都用它） */
  function burst(x, fs, tStart, dur, freq, amp, shape) {
    const i0 = Math.round(tStart * fs), len = Math.round(dur * fs);
    const ph = rnd() * 2 * Math.PI;
    for (let i = 0; i < len; i++) {
      const idx = i0 + i;
      if (idx < 0 || idx >= x.length) continue;
      const u = i / len;
      const env = Math.sin(Math.PI * u) ** 1.2;
      const t = i / fs;
      let w;
      if (shape === 'saw') { const p = (freq * t + ph / (2 * Math.PI)) % 1; w = 2 * p - 1; }
      else w = Math.sin(2 * Math.PI * freq * t + ph);
      x[idx] += amp * env * w;
    }
  }

  /* K 複合波：先一個大的負向尖波，接一個較慢的正向緩波 */
  function kComplex(x, fs, tStart, amp) {
    const i0 = Math.round(tStart * fs), len = Math.round(0.7 * fs);
    for (let i = 0; i < len; i++) {
      const idx = i0 + i; if (idx < 0 || idx >= x.length) continue;
      const t = i / fs;
      const neg = -Math.exp(-((t - 0.15) ** 2) / (2 * 0.055 ** 2));
      const pos = 0.62 * Math.exp(-((t - 0.42) ** 2) / (2 * 0.115 ** 2));
      x[idx] += amp * (neg + pos);
    }
  }

  /* 頂尖波（N1 特徵）：短促的負向尖波 */
  function vertexWave(x, fs, tStart, amp) {
    const i0 = Math.round(tStart * fs), len = Math.round(0.2 * fs);
    for (let i = 0; i < len; i++) {
      const idx = i0 + i; if (idx < 0 || idx >= x.length) continue;
      const t = i / fs;
      x[idx] += -amp * Math.exp(-((t - 0.1) ** 2) / (2 * 0.032 ** 2));
    }
  }

  /* ---------------- 各睡眠期的 epoch 產生器 ---------------- */

  function generateEpoch(stage, opts) {
    opts = opts || {};
    const fs = opts.fs || 100;
    const secs = opts.seconds || 30;
    const noise = opts.noise == null ? 1 : opts.noise;   /* 雜訊倍率 */
    const n = Math.round(fs * secs);
    const x = new Float64Array(n);
    const events = [];
    const add = (src, a) => { for (let i = 0; i < n; i++) x[i] += a * src[i]; };
    const jitter = (c, p) => c * (1 + p * (rnd() * 2 - 1));

    /* 所有期別共通的 1/f 背景 */
    add(pinkNoise(n, fs), jitter(7, 0.25) * noise);

    switch (stage) {
      case 'W':
        add(bandNoise(n, fs, 8, 12), jitter(20, 0.3));
        add(bandNoise(n, fs, 16, 30), jitter(9, 0.3));
        add(bandNoise(n, fs, 30, 45), jitter(7, 0.3) * noise);   /* 肌電 */
        add(bandNoise(n, fs, 4, 8), jitter(5, 0.3));
        add(bandNoise(n, fs, 0.5, 4), jitter(6, 0.3));
        for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) {
          const t = rnd() * (secs - 2);
          burst(x, fs, t, jitter(1.6, 0.4), jitter(10, 0.15), jitter(22, 0.3));
          events.push({ type: 'α 叢發', t0: t, t1: t + 1.6 });
        }
        break;

      case 'N1':
        add(bandNoise(n, fs, 4, 8), jitter(21, 0.25));
        add(bandNoise(n, fs, 8, 12), jitter(7, 0.4));
        add(bandNoise(n, fs, 0.5, 4), jitter(12, 0.3));
        add(bandNoise(n, fs, 16, 30), jitter(4, 0.3));
        add(bandNoise(n, fs, 30, 45), jitter(3.2, 0.3) * noise);   /* 肌張力仍在 */
        for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
          const t = rnd() * (secs - 1);
          vertexWave(x, fs, t, jitter(55, 0.3));
          events.push({ type: '頂尖波', t0: t, t1: t + 0.2 });
        }
        break;

      case 'N2':
        add(bandNoise(n, fs, 4, 8), jitter(14, 0.25));
        add(bandNoise(n, fs, 0.5, 4), jitter(20, 0.3));
        add(bandNoise(n, fs, 8, 12), jitter(4, 0.4));
        add(bandNoise(n, fs, 16, 30), jitter(3, 0.3));
        add(bandNoise(n, fs, 30, 45), jitter(1.8, 0.3) * noise);
        for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) {   /* 睡眠紡錘 */
          const t = rnd() * (secs - 1.5), d = jitter(0.9, 0.35);
          burst(x, fs, t, d, jitter(13, 0.1), jitter(26, 0.3));
          events.push({ type: '睡眠紡錘', t0: t, t1: t + d });
        }
        for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {   /* K 複合波 */
          const t = rnd() * (secs - 1);
          kComplex(x, fs, t, jitter(105, 0.3));
          events.push({ type: 'K 複合波', t0: t, t1: t + 0.7 });
        }
        break;

      case 'N3':
        add(bandNoise(n, fs, 0.5, 2), jitter(62, 0.2));
        add(bandNoise(n, fs, 2, 4), jitter(24, 0.25));
        add(bandNoise(n, fs, 4, 8), jitter(11, 0.3));
        add(bandNoise(n, fs, 8, 12), jitter(3, 0.4));
        add(bandNoise(n, fs, 16, 30), jitter(2, 0.3));
        add(bandNoise(n, fs, 30, 45), jitter(1.2, 0.3) * noise);
        if (rnd() < 0.5) {
          const t = rnd() * (secs - 1.5);
          burst(x, fs, t, 0.8, 12.5, 16);
          events.push({ type: '睡眠紡錘', t0: t, t1: t + 0.8 });
        }
        break;

      case 'R':
        add(bandNoise(n, fs, 4, 8), jitter(11, 0.25));
        add(bandNoise(n, fs, 8, 10), jitter(7, 0.35));
        add(bandNoise(n, fs, 0.5, 4), jitter(9, 0.3));
        add(bandNoise(n, fs, 16, 30), jitter(4.5, 0.3));
        add(bandNoise(n, fs, 30, 45), jitter(0.5, 0.3) * noise);  /* 肌張力最低（REM 肌肉張力缺失） */
        for (let k = 0; k < 4 + Math.floor(rnd() * 3); k++) {     /* 鋸齒波 */
          const t = rnd() * (secs - 2), d = jitter(1.4, 0.3);
          burst(x, fs, t, d, jitter(3.2, 0.2), jitter(21, 0.3), 'saw');
          events.push({ type: '鋸齒波', t0: t, t1: t + d });
        }
        break;
    }
    /* 量測雜訊 */
    for (let i = 0; i < n; i++) x[i] += 2.2 * noise * DSP.gauss();
    return { x, fs, seconds: secs, stage, events };
  }

  /* ---------------- 以 EMD 為基礎的特徵 ---------------- */

  /* 每個 IMF 依其加權平均瞬時頻率歸入一個頻帶，能量即該頻帶的「EMD 頻帶能量」。
   * 特徵向量則沿用文獻做法（Hassan & Bhuiyan, 2016）：對前 K 個 IMF 逐一取
   * 相對能量、平均瞬時頻率與高階統計動差，再加上整體振幅與瞬態指標。 */
  const K_IMF = 7;

  function emdFeatures(x, fs, opts) {
    const res = DSP.emd(x, { maxImf: (opts && opts.maxImf) || 9 });
    const imfInfo = res.imfs.map((imf, i) => {
      const f = DSP.meanInstFreq(imf, fs);
      const st = DSP.stats(imf);
      const env = DSP.hilbert(imf, fs).amp;
      return {
        index: i + 1, imf, freq: f, band: bandOf(f),
        energy: st.variance, std: st.std,
        kurtosis: st.kurtosis, skewness: st.skewness,
        envKurtosis: DSP.stats(env).kurtosis
      };
    });

    const bandE = {}; BANDS.forEach(b => bandE[b.key] = 0);
    let total = 0;
    imfInfo.forEach(d => { bandE[d.band] += d.energy; total += d.energy; });
    const resSt = DSP.stats(res.residue);
    total += resSt.variance;
    bandE.delta += resSt.variance;                    /* 殘量視為超慢波動 */
    const rel = {}; BANDS.forEach(b => rel[b.key] = total > 0 ? bandE[b.key] / total : 0);

    /* 瞬態指標：低頻 IMF 的峰態 → K 複合波 / 頂尖波 */
    let transient = 0;
    imfInfo.forEach(d => { if (d.freq < 8) transient = Math.max(transient, d.kurtosis); });
    /* 紡錘指標：σ 頻帶 IMF 的包絡峰態（叢發 → 高峰態） */
    let spindle = 0;
    imfInfo.forEach(d => { if (d.freq >= 11 && d.freq < 16) spindle = Math.max(spindle, d.envKurtosis); });

    /* 逐 IMF 特徵（不足 K 個時補零） */
    const vec = [];
    for (let k = 0; k < K_IMF; k++) {
      const d = imfInfo[k];
      if (!d) { vec.push(0, 0, 0, 0); continue; }
      vec.push(total > 0 ? d.energy / total : 0);            /* 相對能量 */
      vec.push(Math.log2(d.freq + 0.5) / 6);                 /* 平均瞬時頻率（log） */
      vec.push(Math.min(d.kurtosis, 25) / 25);               /* 峰態 */
      vec.push(Math.min(d.envKurtosis, 25) / 25);            /* 包絡峰態 */
    }
    vec.push(Math.log10(total + 1e-9) / 4);                  /* 總功率 */
    vec.push(Math.min(transient, 25) / 25);
    vec.push(Math.min(spindle, 25) / 25);
    vec.push(rel.delta, rel.theta, rel.alpha, rel.sigma, rel.beta, rel.emg);

    return { vec, rel, total, transient, spindle, imfInfo, residue: res.residue, imfs: res.imfs };
  }

  const FEATURE_NAMES = (function () {
    const a = [];
    for (let k = 1; k <= K_IMF; k++) {
      a.push('IMF' + k + ' 相對能量', 'IMF' + k + ' 平均頻率', 'IMF' + k + ' 峰態', 'IMF' + k + ' 包絡峰態');
    }
    a.push('log 總功率', '低頻瞬態指標', '紡錘指標',
           'δ 相對能量', 'θ 相對能量', 'α 相對能量', 'σ 相對能量', 'β 相對能量', '高頻相對能量');
    return a;
  })();

  /* ---------------- 最近質心分類器（在瀏覽器裡現場訓練） ---------------- */

  function trainNearestCentroid(samples) {
    const d = samples[0].vec.length;
    const mu = new Float64Array(d), sg = new Float64Array(d);
    samples.forEach(s => s.vec.forEach((v, i) => mu[i] += v));
    for (let i = 0; i < d; i++) mu[i] /= samples.length;
    samples.forEach(s => s.vec.forEach((v, i) => sg[i] += (v - mu[i]) ** 2));
    for (let i = 0; i < d; i++) sg[i] = Math.sqrt(sg[i] / samples.length) || 1;

    const cents = {};
    STAGES.forEach(st => {
      const sub = samples.filter(s => s.label === st.key);
      if (!sub.length) return;
      const c = new Float64Array(d);
      sub.forEach(s => s.vec.forEach((v, i) => c[i] += (v - mu[i]) / sg[i]));
      for (let i = 0; i < d; i++) c[i] /= sub.length;
      cents[st.key] = c;
    });
    return { mu, sg, cents, d, n: samples.length };
  }

  function classify(model, vec) {
    const z = vec.map((v, i) => (v - model.mu[i]) / model.sg[i]);
    const scores = [];
    for (const k in model.cents) {
      const c = model.cents[k];
      let dist = 0;
      for (let i = 0; i < model.d; i++) dist += (z[i] - c[i]) ** 2;
      scores.push({ stage: k, dist: Math.sqrt(dist) });
    }
    scores.sort((a, b) => a.dist - b.dist);
    /* softmax(-dist) 當作信心度 */
    const t = 1.2;
    const ex = scores.map(s => Math.exp(-s.dist / t));
    const sum = ex.reduce((a, b) => a + b, 0);
    scores.forEach((s, i) => s.prob = ex[i] / sum);
    return { best: scores[0].stage, scores };
  }

  return {
    BANDS, STAGES, bandOf, seed, rand: () => rnd,
    bandNoise, pinkNoise, generateEpoch,
    emdFeatures, FEATURE_NAMES, K_IMF, trainNearestCentroid, classify
  };
})();
