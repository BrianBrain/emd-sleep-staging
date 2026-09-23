# EMD × 睡眠腦波判期

> 經驗模態分解（Empirical Mode Decomposition）如何用來讀懂睡眠腦波——一份可以動手玩的一頁式互動導覽。

從 Huang et al. (1998) 的自適應分解演算法出發，一路走到單通道 EEG 的自動睡眠分期。
所有訊號處理都在瀏覽器裡即時計算，**沒有使用任何外部函式庫**。

## 章節

| # | 章節 | 內容 |
|---|------|------|
| 0 | 開場 | 即時滾動的合成 N2 腦波 |
| 1 | 為什麼是 EMD | 非平穩／非線性訊號的難題；**互動**：同一段變頻訊號的傅立葉頻譜 vs 希爾伯特頻譜 |
| 2 | EMD 演算法 | 篩選（sifting）迴圈與 SD 停止準則；**互動**：逐步篩選動畫（上下包絡、均值、極值點） |
| 3 | IMF 本質模態 | IMF 的兩條定義、完備性、類二進位濾波器組；**互動**：EMD 分解器（含重建誤差） |
| 4 | 希爾伯特頻譜 | 解析訊號、瞬時頻率與振幅；**互動**：時間×頻率×能量散點圖 |
| 5 | 睡眠判期 | AASM 五期規格表；**互動**：睡眠腦波圖鑑 + 整夜 hypnogram |
| 6 | EMD 如何判期 | 五步管線與文獻結果比較表 |
| 7 | 互動實驗室 | **在瀏覽器裡現場訓練分類器**：產生 epoch → EMD → 37 維特徵 → 最近質心 → 混淆矩陣 + 判讀小測驗 |
| 8 | 限制與改良 | 模態混疊、端點效應；**互動**：EMD vs EEMD 的並排分解對照 |
| 9 | 參考文獻 | 12 篇文獻，書目資料經 Crossref / PubMed 核對 |

## 實作了什麼

全部以原生 JavaScript 從零寫成：

| 檔案 | 內容 |
|------|------|
| `assets/dsp.js` | 迭代式 radix-2 FFT、希爾伯特轉換（鏡射延拓）、瞬時頻率、自然三次樣條、極值偵測、包絡、篩選迴圈、**EMD**、**EEMD**、統計動差 |
| `assets/eeg.js` | 依 AASM 規格合成的睡眠 EEG（1/f 背景、帶限節律、睡眠紡錘、K 複合波、頂尖波、鋸齒波）、IMF 特徵抽取、最近質心分類器 |
| `assets/plot.js` | Canvas 繪圖（波形、頻譜、長條圖、希爾伯特頻譜、hypnogram），支援 DPR 與 ResizeObserver |
| `assets/app.js` | 章節導覽、捲動進度、7 個互動元件的邏輯 |

### 幾個實作細節

* **端點效應處理**：求包絡前先把訊號對兩端做鏡射延拓，使第 0 與第 n−1 點必定成為延拓訊號的局部極值，樣條因此自然貼合端點而不往外飛散。這個處理讓分解結果與分類準確率有明顯改善。
* **完備性驗證**：分解器會即時顯示 `max |x(t) − ΣIMFᵢ(t) − r(t)|`，實測落在 10⁻¹⁵ 量級（雙精度浮點數的極限）。
* **停止準則**：Huang et al. (1998) 的 SD 判準，預設門檻 0.2。

## 重要聲明

網站中的腦波是**依文獻規格合成的教學用訊號**，不是真實的 PSG 紀錄。
因此第 7 章實驗室回報的準確率**不能**與第 6 章的文獻數字相提並論——真實腦波遠比合成訊號雜亂。
分解、希爾伯特轉換、特徵抽取與分類器本身則都是貨真價實的實作。

**本網站不可用於任何臨床判讀。**

## 本機執行

沒有建置步驟，任何靜態伺服器都可以：

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

## 部署

專案根目錄含 `Dockerfile`（nginx alpine），可直接部署到 Zeabur 或任何支援 Dockerfile 的平台：

```bash
docker build -t emd-web . && docker run -p 8080:80 emd-web
```

## 參考文獻

1. Huang, N. E., et al. (1998). The empirical mode decomposition and the Hilbert spectrum for nonlinear and non-stationary time series analysis. *Proc. R. Soc. Lond. A*, 454(1971), 903–995. [doi:10.1098/rspa.1998.0193](https://doi.org/10.1098/rspa.1998.0193)
2. Wu, Z., & Huang, N. E. (2009). Ensemble empirical mode decomposition: A noise-assisted data analysis method. *Adv. Adapt. Data Anal.*, 1(1), 1–41. [doi:10.1142/S1793536909000047](https://doi.org/10.1142/S1793536909000047)
3. Torres, M. E., Colominas, M. A., Schlotthauer, G., & Flandrin, P. (2011). A complete ensemble empirical mode decomposition with adaptive noise. *Proc. IEEE ICASSP*, 4144–4147. [doi:10.1109/ICASSP.2011.5947265](https://doi.org/10.1109/ICASSP.2011.5947265)
4. Flandrin, P., Rilling, G., & Gonçalvès, P. (2004). Empirical mode decomposition as a filter bank. *IEEE Signal Process. Lett.*, 11(2), 112–114. [doi:10.1109/LSP.2003.821662](https://doi.org/10.1109/LSP.2003.821662)
5. Hassan, A. R., & Bhuiyan, M. I. H. (2016). Automatic sleep scoring using statistical features in the EMD domain and ensemble methods. *Biocybern. Biomed. Eng.*, 36(1), 248–255. [doi:10.1016/j.bbe.2015.11.001](https://doi.org/10.1016/j.bbe.2015.11.001)
6. Hassan, A. R., & Bhuiyan, M. I. H. (2016). Computer-aided sleep staging using CEEMDAN and bootstrap aggregating. *Biomed. Signal Process. Control*, 24, 1–10. [doi:10.1016/j.bspc.2015.09.002](https://doi.org/10.1016/j.bspc.2015.09.002)
7. Hassan, A. R., & Bhuiyan, M. I. H. (2017). Automated identification of sleep states from EEG signals by means of EEMD and RUSBoost. *Comput. Methods Programs Biomed.*, 140, 201–210. [doi:10.1016/j.cmpb.2016.12.015](https://doi.org/10.1016/j.cmpb.2016.12.015)
8. Liu, C., et al. (2021). Automatic sleep staging with a single-channel EEG based on ensemble empirical mode decomposition. *Physica A*, 567, 125685. [doi:10.1016/j.physa.2020.125685](https://doi.org/10.1016/j.physa.2020.125685)
9. Huang, Z., & Ling, B. W.-K. (2022). Joint EEMD and tunable Q factor wavelet transform based sleep stage classifications. *Biomed. Signal Process. Control*, 77, 103760. [doi:10.1016/j.bspc.2022.103760](https://doi.org/10.1016/j.bspc.2022.103760)
10. Rilling, G., Flandrin, P., & Gonçalvès, P. (2003). On empirical mode decomposition and its algorithms. *Proc. IEEE-EURASIP NSIP-03*. [PDF](https://perso.ens-lyon.fr/patrick.flandrin/NSIP03.pdf)
11. Berry, R. B., et al. (2017). *The AASM Manual for the Scoring of Sleep and Associated Events*, v2.4. American Academy of Sleep Medicine.
12. Kemp, B., et al. (2000). Analysis of a sleep-dependent neuronal feedback loop: the slow-wave microcontinuity of the EEG. *IEEE Trans. Biomed. Eng.*, 47(9), 1185–1194. [doi:10.1109/10.867928](https://doi.org/10.1109/10.867928)
