<!-- translated-from: 48cad2b0114eb74e -->
<!-- section: statement -->

<!-- eyebrow -->
*無障礙*

# 用 WCAG 2.2 AA 量這個網站

<!-- lede -->
本站每一頁都以符合 [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA 級為目標。這一頁說明這個說法依據
什麼，以及不依據什麼。

<!-- section: scope -->

## 這個說法涵蓋什麼

本站三十六個頁面的全部，九種語言的全部：首頁、文件、試用場與這份聲明。淺色與深色兩套佈景。最近一次評估在
2026 年 9 月 17 日，針對當天發佈的版本。

[![AA 級符合性，W3C WAI 網頁內容無障礙指引 2.2](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

上面的標章是自我宣告。W3C 只是公開它供任何人使用，並不審核或驗證任何據此做出的說法，這正是本頁其餘
部分存在的原因。

<!-- section: method -->

## 是怎麼評估的

四種方式，都可以重複，而且每次變更都會由持續整合再跑一次：

- **規則引擎。** 用 `axe-core` 跑了三十九次頁面載入，涵蓋九種語言的三十六個頁面，外加每種形態各一頁的
  深色佈景，檢查對應 WCAG 2.2 A 級與 AA 級的標記。
- **規則引擎看不見的準則。** 用刻意操控的瀏覽器驗證：把頁面重排到 320 CSS 像素、把文字放大到
  200%、套用標準規定的文字間距覆寫、比較取得焦點前後的焦點指示、確認取得焦點的控制項沒有被其他東西
  蓋住、把每個指標目標與 24 乘 24 的最小值對照、確認每個控制項都有可存取的名稱。
- **鍵盤。** 確認跳至內容的連結是每一頁上鍵盤最先到達的元素，而且使用它會把焦點真正移入內文，而不只是
  捲動頁面。
- **人工逐條。** WCAG 2.2 A 級與 AA 級的五十五條成功準則全部，每一條都記下判定與依據，寫在
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md) 裡。

<!-- section: limits -->

## 這個說法不涵蓋什麼

直說，因為一份合規聲明的價值，正好等於它的邊界的價值：

- **沒有用輔助科技測試過。** 沒有使用螢幕閱讀器，也沒有身心障礙者試用過本站。結構是透過檢視無障礙樹
  確認的，那和真正聽一遍不是同一回事。
- **沒有第三方稽核。** 沒有任何獨立的人核對過這些，就像沒有任何獨立的人稽核過這個函式庫的密碼學實作
  一樣。
- 自動化測試大約涵蓋 WCAG 要求的三分之一。上面另外三種方式正是因此存在，但它們仍然取代不了一個真正
  依賴它的人。

<!-- section: known -->

## 已知的限制

- **QR Code 是資料的影像。** 沒有輔助科技能讀懂它，也不該需要讀懂：旁邊的說明給出了版本與字元數，它
  編碼的每一個值都在同一頁上以文字印出。
- **試用場需要 JavaScript**，因為它要在讀者自己的瀏覽器裡跑這個函式庫，這正是它存在的意義。文件與
  首頁不需要：它們的內容就在 HTML 裡。

<!-- section: report -->

## 如果你發現了問題

有人告訴我們，是這件事變好的唯一途徑。到
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues) 開一個 issue，或者用任何你覺得方便的
方式說一聲。描述發生了什麼就夠了；能指出是哪一條成功準則當然很好，但從來不是必須的。

<!-- cta --> [回報無障礙問題](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [閱讀完整評估](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
