/* dsp.js — EMD / Hilbert-Huang 核心演算法（純 JavaScript 實作，無外部相依）
 * 參考：Huang et al. (1998) Proc. R. Soc. Lond. A 454:903–995
 *       Rilling, Flandrin & Gonçalves (2003) IEEE-EURASIP NSIP-03
 */
'use strict';

const DSP = (function () {

  /* ---------------- FFT（迭代式 radix-2） ---------------- */

  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 : -2) * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  /* 單邊振幅頻譜（Hann window），回傳 {freq, mag} */
  function spectrum(x, fs, maxFreq) {
    const n = x.length, N = nextPow2(n);
    const re = new Float64Array(N), im = new Float64Array(N);
    let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      re[i] = (x[i] - mean) * w; wsum += w;
    }
    fft(re, im, false);
    const half = N >> 1;
    const freq = [], mag = [];
    const lim = maxFreq || fs / 2;
    for (let k = 0; k <= half; k++) {
      const f = k * fs / N;
      if (f > lim) break;
      freq.push(f);
      mag.push(2 * Math.hypot(re[k], im[k]) / (wsum || n));
    }
    return { freq, mag };
  }

  /* 指定頻帶的功率（以頻譜積分近似） */
  function bandPower(x, fs, f1, f2) {
    const s = spectrum(x, fs);
    let p = 0;
    for (let i = 0; i < s.freq.length; i++) {
      if (s.freq[i] >= f1 && s.freq[i] < f2) p += s.mag[i] * s.mag[i];
    }
    return p;
  }

  /* ---------------- Hilbert 轉換 / 瞬時屬性 ---------------- */

  /* 解析訊號 → {amp, phase, instFreq}；以鏡射延拓降低端點效應 */
  function hilbert(x, fs) {
    const n = x.length;
    const pad = Math.min(n, 64);
    const m = n + 2 * pad;
    const N = nextPow2(m);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < pad; i++) re[i] = x[Math.min(n - 1, pad - i)];
    for (let i = 0; i < n; i++) re[pad + i] = x[i];
    for (let i = 0; i < pad; i++) re[pad + n + i] = x[Math.max(0, n - 2 - i)];
    for (let i = m; i < N; i++) re[i] = 0;

    fft(re, im, false);
    const half = N >> 1;
    for (let k = 0; k < N; k++) {
      if (k === 0 || k === half) continue;
      if (k < half) { re[k] *= 2; im[k] *= 2; }
      else { re[k] = 0; im[k] = 0; }
    }
    fft(re, im, true);

    const amp = new Float64Array(n), ph = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = re[pad + i], b = im[pad + i];
      amp[i] = Math.hypot(a, b);
      ph[i] = Math.atan2(b, a);
    }
    /* 相位解纏繞 */
    const up = new Float64Array(n);
    up[0] = ph[0];
    let off = 0;
    for (let i = 1; i < n; i++) {
      let d = ph[i] - ph[i - 1];
      while (d > Math.PI) { d -= 2 * Math.PI; }
      while (d < -Math.PI) { d += 2 * Math.PI; }
      off += d;
      up[i] = ph[0] + off;
    }
    const instFreq = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = up[Math.min(n - 1, i + 1)], b = up[Math.max(0, i - 1)];
      const dt = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) / fs;
      let f = (a - b) / dt / (2 * Math.PI);
      if (!isFinite(f) || f < 0) f = 0;
      if (f > fs / 2) f = fs / 2;
      instFreq[i] = f;
    }
    return { amp, phase: up, instFreq };
  }

  /* 以振幅平方加權的平均瞬時頻率——IMF 的「代表頻率」 */
  function meanInstFreq(imf, fs) {
    const h = hilbert(imf, fs);
    const n = imf.length, skip = Math.floor(n * 0.05);
    let num = 0, den = 0;
    for (let i = skip; i < n - skip; i++) {
      const w = h.amp[i] * h.amp[i];
      num += w * h.instFreq[i]; den += w;
    }
    return den > 0 ? num / den : 0;
  }

  /* ---------------- 自然三次樣條 ---------------- */

  /* xs 必須嚴格遞增；回傳在 0..n-1 整數點上取值的 Float64Array */
  function splineEval(xs, ys, n) {
    const k = xs.length;
    const out = new Float64Array(n);
    if (k === 0) return out;
    if (k === 1) { out.fill(ys[0]); return out; }
    if (k === 2) {
      const slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
      for (let i = 0; i < n; i++) out[i] = ys[0] + slope * (i - xs[0]);
      return out;
    }
    const h = new Float64Array(k - 1);
    for (let i = 0; i < k - 1; i++) h[i] = xs[i + 1] - xs[i];
    /* 解三對角方程求二階導 c[] */
    const al = new Float64Array(k), l = new Float64Array(k),
          mu = new Float64Array(k), z = new Float64Array(k);
    for (let i = 1; i < k - 1; i++) {
      al[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
    }
    l[0] = 1;
    for (let i = 1; i < k - 1; i++) {
      l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (al[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    l[k - 1] = 1;
    const c = new Float64Array(k), b = new Float64Array(k), d = new Float64Array(k);
    for (let j = k - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
      b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
      d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }
    let seg = 0;
    for (let i = 0; i < n; i++) {
      while (seg < k - 2 && i > xs[seg + 1]) seg++;
      const dx = i - xs[seg];
      out[i] = ys[seg] + b[seg] * dx + c[seg] * dx * dx + d[seg] * dx * dx * dx;
    }
    return out;
  }

  /* ---------------- 極值偵測與包絡 ---------------- */

  function findExtrema(x) {
    const n = x.length, maxIdx = [], minIdx = [];
    for (let i = 1; i < n - 1; i++) {
      if (x[i] > x[i - 1] && x[i] >= x[i + 1]) maxIdx.push(i);
      else if (x[i] < x[i - 1] && x[i] <= x[i + 1]) minIdx.push(i);
    }
    return { maxIdx, minIdx };
  }

  function countZeroCrossings(x) {
    let c = 0;
    for (let i = 1; i < x.length; i++) if ((x[i - 1] <= 0) !== (x[i] <= 0)) c++;
    return c;
  }

  /* 端點鏡射延拓：把頭尾各兩個極值對邊界做鏡射，抑制樣條的端點飛散 */
  function extendExtrema(idx, val, n) {
    const I = [], V = [];
    const m = Math.min(2, idx.length);
    for (let k = m - 1; k >= 0; k--) { I.push(-idx[k]); V.push(val[k]); }
    for (let k = 0; k < idx.length; k++) { I.push(idx[k]); V.push(val[k]); }
    for (let k = idx.length - 1; k >= idx.length - m; k--) {
      I.push(2 * (n - 1) - idx[k]); V.push(val[k]);
    }
    /* 去除非嚴格遞增的點 */
    const xs = [], ys = [];
    for (let i = 0; i < I.length; i++) {
      if (xs.length === 0 || I[i] > xs[xs.length - 1]) { xs.push(I[i]); ys.push(V[i]); }
    }
    /* 平移到以 0 為起點，讓 splineEval 直接吃整數索引 */
    return { xs, ys };
  }

  /* 包絡計算。
   * 端點處理：先把訊號對兩端做鏡射延拓，再求極值與樣條。
   * 鏡射之後，原本的第 0 與第 n−1 點必定成為延拓訊號的局部極值，
   * 樣條因此會自然貼合端點，不會像直接外插那樣往外飛散。 */
  function envelopes(x) {
    const n = x.length;
    if (n < 5) return null;
    const L = Math.min(n - 1, Math.max(24, Math.round(n * 0.2)));
    const m = n + 2 * L;
    const ext = new Float64Array(m);
    for (let i = 0; i < n; i++) ext[L + i] = x[i];
    for (let j = 0; j < L; j++) {
      ext[L - 1 - j] = x[Math.min(n - 1, j + 1)];        /* 對 index 0 鏡射 */
      ext[L + n + j] = x[Math.max(0, n - 2 - j)];        /* 對 index n−1 鏡射 */
    }

    const { maxIdx, minIdx } = findExtrema(ext);
    if (maxIdx.length < 2 || minIdx.length < 2) return null;
    const up = extendExtrema(maxIdx, maxIdx.map(i => ext[i]), m);
    const lo = extendExtrema(minIdx, minIdx.map(i => ext[i]), m);
    const upperE = splineEval(up.xs, up.ys, m);
    const lowerE = splineEval(lo.xs, lo.ys, m);

    const upper = new Float64Array(n), lower = new Float64Array(n), mean = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      upper[i] = upperE[L + i];
      lower[i] = lowerE[L + i];
      mean[i] = (upper[i] + lower[i]) / 2;
    }
    /* 回報的極值索引換算回原始座標，供教學動畫標點用 */
    const inRange = a => a.filter(i => i >= L && i < L + n).map(i => i - L);
    return { upper, lower, mean, maxIdx: inRange(maxIdx), minIdx: inRange(minIdx) };
  }

  /* ---------------- 篩選（sifting）與 EMD ---------------- */

  /* 回傳每一次篩選的完整中間結果，供逐步教學動畫使用 */
  function siftTrace(x, maxSift, sdTol) {
    maxSift = maxSift || 8; sdTol = sdTol == null ? 0.2 : sdTol;
    const n = x.length;
    let h = Float64Array.from(x);
    const steps = [];
    for (let k = 0; k < maxSift; k++) {
      const e = envelopes(h);
      if (!e) break;
      const hn = new Float64Array(n);
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        hn[i] = h[i] - e.mean[i];
        num += (h[i] - hn[i]) * (h[i] - hn[i]);
        den += h[i] * h[i];
      }
      const sd = den > 0 ? num / den : 0;
      const ex = findExtrema(hn);
      steps.push({
        input: h, upper: e.upper, lower: e.lower, mean: e.mean,
        output: hn, maxIdx: e.maxIdx, minIdx: e.minIdx, sd: sd,
        nExtrema: ex.maxIdx.length + ex.minIdx.length,
        nZero: countZeroCrossings(hn)
      });
      h = hn;
      if (sd < sdTol) break;
    }
    return steps;
  }

  /* 完整 EMD：x(t) = Σ IMF_i(t) + r(t) */
  function emd(x, opts) {
    opts = opts || {};
    const maxImf = opts.maxImf || 9;
    const maxSift = opts.maxSift || 30;
    const sdTol = opts.sdTol == null ? 0.2 : opts.sdTol;
    const n = x.length;
    let r = Float64Array.from(x);
    const imfs = [];
    while (imfs.length < maxImf) {
      const ex = findExtrema(r);
      if (ex.maxIdx.length + ex.minIdx.length < 3) break;
      let h = Float64Array.from(r);
      for (let k = 0; k < maxSift; k++) {
        const e = envelopes(h);
        if (!e) break;
        const hn = new Float64Array(n);
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
          hn[i] = h[i] - e.mean[i];
          num += (h[i] - hn[i]) * (h[i] - hn[i]);
          den += h[i] * h[i];
        }
        h = hn;
        if ((den > 0 ? num / den : 0) < sdTol) break;
      }
      imfs.push(h);
      const nr = new Float64Array(n);
      for (let i = 0; i < n; i++) nr[i] = r[i] - h[i];
      r = nr;
    }
    return { imfs, residue: r };
  }

  /* EEMD：加白雜訊集成平均，緩解 mode mixing（Wu & Huang 2009） */
  function eemd(x, ensemble, noiseAmp, opts) {
    ensemble = ensemble || 20;
    const n = x.length;
    let sd = 0, mean = 0;
    for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
    for (let i = 0; i < n; i++) sd += (x[i] - mean) ** 2;
    sd = Math.sqrt(sd / n);
    const amp = (noiseAmp == null ? 0.2 : noiseAmp) * sd;
    const maxImf = (opts && opts.maxImf) || 9;
    const acc = [];
    for (let e = 0; e < ensemble; e++) {
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) y[i] = x[i] + amp * gauss();
      const res = emd(y, opts);
      for (let k = 0; k < maxImf; k++) {
        if (!acc[k]) acc[k] = new Float64Array(n);
        const src = k < res.imfs.length ? res.imfs[k] : res.residue;
        if (k < res.imfs.length || k === res.imfs.length) {
          for (let i = 0; i < n; i++) acc[k][i] += src[i];
        }
      }
    }
    const imfs = acc.map(a => { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = a[i] / ensemble; return o; });
    const residue = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < imfs.length; k++) s += imfs[k][i]; residue[i] = x[i] - s; }
    return { imfs, residue };
  }

  /* ---------------- 統計量 ---------------- */

  function stats(x) {
    const n = x.length;
    let m = 0; for (let i = 0; i < n; i++) m += x[i]; m /= n;
    let v = 0, s3 = 0, s4 = 0;
    for (let i = 0; i < n; i++) { const d = x[i] - m; v += d * d; s3 += d ** 3; s4 += d ** 4; }
    v /= n; s3 /= n; s4 /= n;
    const sd = Math.sqrt(v);
    return {
      mean: m, variance: v, std: sd, energy: v * n,
      skewness: sd > 0 ? s3 / sd ** 3 : 0,
      kurtosis: sd > 0 ? s4 / sd ** 4 : 0
    };
  }

  /* Box–Muller 高斯亂數（rng 可替換，方便以亂數種子重現實驗） */
  let spare = null;
  let rng = Math.random;
  function setRandom(fn) { rng = fn || Math.random; spare = null; }
  function gauss() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; }
    while (s === 0 || s >= 1);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * mul;
    return u * mul;
  }

  return {
    fft, nextPow2, spectrum, bandPower, hilbert, meanInstFreq,
    splineEval, findExtrema, countZeroCrossings, envelopes,
    siftTrace, emd, eemd, stats, gauss, setRandom,
    rand: () => rng()
  };
})();
