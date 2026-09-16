<!-- translated-from: d202bc3a6200f01e -->
<!-- section: top -->

<!-- eyebrow -->
_文件_

# 斷網也驗得過的憑證

<!-- lede -->
QR Code 自己帶著證明。`qredential` 檢查簽章、效期、撤銷狀態與 claim，全程不往外送出任何一個請求。

<!-- cta --> [開啟試用場](../../playground/)

<!-- cta --> [閱讀原始碼](https://github.com/george-veras/qredential)

<!-- section: start -->

## 開始使用

```ts
npm i qredential
```

Node 20 以上、所有現行瀏覽器，以及 React Native。只用 WebCrypto，不用任何 Node 專屬的東西，因為做驗證的裝置通常是手機。沒有任何執行期相依套件。

完整測試套件在每次提交時，都會於 Linux、macOS 與 Windows 上的 Node 20、22、24 執行，也在 Chromium、Firefox 與 WebKit 中執行。Ed25519 在這四者都實際跑過。

> **關於 React Native 的一點但書。** 它沒有 `CompressionStream`，而簽發、出示與驗證在沒有它的情況下都能正常運作：信封只是維持未壓縮，代價僅止於大小。*離線撤銷檢查無法運作*，因為讀取狀態清單必須解開一段位元串。無法解開快取清單的驗證端會以 `status_unavailable` 拒絕，而不是把讀不懂的清單當成乾淨的清單。若你在 React Native 上需要撤銷檢查，請為 `DecompressionStream` 加上 polyfill。有一個測試會在刪掉這兩個全域物件的情況下跑完整個流程，所以這段描述是驗證過的，不是猜的。

### 驗證點東西

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### 完整的一輪

三方，三次呼叫。簽發方簽一次，持有方收窄要傳出去的內容，驗證方做判斷。

```ts
import { issue, present, verify } from 'qredential'

// 1. 簽發方，在核發駕照時只做一次。
const { credential, qr } = await issue({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  claims: {
    given_name: 'Ana',
    family_name: 'Goncalves',
    birth_date: '1991-04-02',
    over_18: true,
  },
  disclose: ['birth_date', 'over_18'],
  expiresIn: '1825d',
})

// 2. 持有方的錢包，在掃碼現場。露出是否成年，留下出生日期。
const presentation = await present(credential, { disclose: ['over_18'] })

// 3. 驗證方，離線。
const result = await verify(presentation, { trust })
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined，它從未離開錢包
```

<!-- section: disclosure -->

## 選擇性揭露

兩個不同的角色做兩個不同的決定，把它們混為一談就是常見的設計錯誤。**簽發方**在簽章時用 `disclose` 決定哪些 claim *可以*被保留不揭。**持有方**接著在掃碼時，同樣用 `disclose`，決定其中哪些真的要秀出來。簽發方沒有標記過的 claim，誰都藏不起來。

機制就是一般的雜湊。每個可揭露的 claim 都會連同一個 128 位元的隨機鹽一起序列化，只有那串字串的摘要被簽進憑證裡。揭露一個 claim，就是把原始字串送過去，讓驗證方雜湊後對上摘要。不揭露，就是讓驗證方手上留下一個永遠打不開的摘要。

### 巢狀、陣列與遞迴揭露

RFC 9901 這三種都允許，歐洲錢包生態這三種都在用。這裡的驗證依照 7.1 節的處理模型，在任意深度把它們解開：

- 巢狀物件裡的 `_sd` 陣列會藏起該物件的屬性。
- 形如 `{"...": digest}` 的陣列元素會藏起元素本身。未揭露的元素會從陣列中*移除*，而不是留下佔位符，所以你拿到的是可以直接呈現的乾淨值。
- 被揭露的值本身還可以再含有這兩種形式之一，所以解開一個會露出更多。

這些都不會漏進 `claims`：沒有任何 `_sd` 鍵、沒有任何 `"..."` 元素會抵達呼叫端。揭露的名稱以路徑形式回傳，例如 `address.locality`，而整套機制還與同一份 RFC 的獨立實作做過雙向對照。

> **為什麼這對年齡查核很重要。** 常見做法是讓客人把證件照片上傳給第三方，那等於製造一起只等著發生的外洩。在這裡酒吧只知道一個布林值，就算想知道出生日期也做不到。這個性質是密碼學上的，不是隱私權政策裡的一句承諾。

要求一個簽發方沒有設為可揭露的 claim，會擲出例外，而不是默默回傳比你要的還少的東西。

<!-- section: holder -->

## 證明持有人

選擇性揭露證明的是簽發方簽過這些 claim。單憑它並不能證明出示的人就是本人，而且這個縫隙不是紙上談兵：別人憑證的照片帶著同一個簽章，驗起來一樣順。

金鑰綁定把它補起來。簽發方把持有人的公鑰寫進憑證，掃碼現場持有人的錢包用對應的私鑰為一個全新的挑戰值簽章。照片做不到這件事。

### 三個步驟

```ts
// 1. 簽發方綁定持有人的公鑰。
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. 錢包在掃碼現場為這個驗證方的挑戰值簽章。
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. 驗證方檢查這份證明回應的是自己的挑戰值。
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

這份證明把自己綁在四樣東西上，每一樣堵住一種具體的攻擊：**nonce** 讓錄下來的出示無法重放，**audience** 讓為某個驗證方做的證明不能拿到別處用，**簽章**把它繫在簽發方綁定的那把金鑰上，而 `sd_hash` 涵蓋了這次出示的那一組揭露，使得中間環節無法在持有人簽章之後增刪任何一筆。它也會過期，預設五分鐘，可用 `maxKeyBindingAge` 調整。

### 靜態憑證，以及為什麼這個選擇要由你大聲說出口

印在卡片上的碼，以上這些一件都做不到。掃碼現場沒有能簽章的裝置，所以靜態憑證天生可複製。這是真實而常見的狀況，不是錯誤，但這是驗證方應當在知情之下做的決定：

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false，不管你怎麼選，它都會這樣說
```

不加這個選項，沒有證明的出示會以 `holder_proof_missing` 被拒。預設選嚴格的那一邊是刻意的：危險的情境是有人在做門禁掃碼，從沒聽過金鑰綁定，然後交付了一個截圖就能破的東西。一次點名問題的大聲失敗，比一個把問題藏起來的安靜預設值更有價值。

> **選擇接受，永遠不會放過一份壞掉的證明。** `acceptWithoutHolderProof` 涵蓋的是根本沒有提供證明的情形。如果證明存在卻驗不過，無論這個選項為何，憑證都會被拒。

### 代價

綁定在 QR Code 的尺度上並非免費。持有人的公鑰住在憑證裡，證明則跟著出示一起走：

| 出示 | 字元數 | QR Code 版本 |
|---|---|---|
| 靜態，全部可見 | ~740 | 18，掃得很順 |
| 僅年齡，已綁定但無證明 | ~1320 | 24，偏密 |
| 僅年齡，帶持有人證明 | ~1605 | 27，太密 |

證明本身約 285 個字元。這比看起來要不要緊，因為做得了金鑰綁定的憑證，按定義就是顯示在螢幕上的，那裡的碼可以又大又亮。密度上限困擾的是磨損的印刷卡片，而印刷卡片本來就做不了金鑰綁定。

<!-- section: size -->

## 大小預算

QR Code 在最大版本下大約裝得下 4300 個英數字元，但那麼大的碼在刮花的卡片或裂掉的螢幕上根本讀不出來。實務上限落在版本 20 附近。

一份符合現實的駕照要花多少，看以下。八個 claim、五年效期、一個狀態清單指標，用儲存庫裡的 `examples/sizes.mjs` 量出來：

| 憑證 | 字元數 | QR Code 版本 |
|---|---|---|
| 全部可見 | ~740 | 18，掃得很順 |
| 八個 claim 全部可揭露 | ~1590 | 27，太密 |
| 只出示 `over_18` | ~1115 | 22，仍然偏密 |

中間那一列才是難受的，而在這裡知道總比印完卡片才知道好。選擇性揭露幾乎讓憑證翻倍，因為每個可揭露的 claim 都要花一個鹽加一個被簽章的摘要，而且**不論持有人是否揭露該 claim，摘要都留在酬載裡**。這是刻意的：如果摘要數量隨著你揭露的內容縮水，就會洩漏你藏了什麼。實際後果是，出示時省下的比直覺答應的要少。這裡是三成，不是八成。

所以只把驗證方真的有可能單獨需要看到的 claim 設為可揭露。兩三個，不是全部。`fits()` 會在你拍板之前告訴你處境。

> **關於 base45。** 坊間說法是它因為精簡才被選上。並不是。QR Code 英數模式下的 base45，每個原始位元組約花 8.25 位元，位元組模式下的 base64 是 10.67，裸二進位剛好 8。它明顯贏過 base64，小輸給裸位元組。放掉裸位元組是刻意的，因為位元組模式帶著字元集的歧義，不少讀碼機會回傳一串壞掉的文字。一份禁得起複製、貼上與寫進記錄檔的憑證，值得這三個百分點。

<!-- section: revocation -->

## 離線撤銷檢查

撤銷檢查是各家實作最愛跳過的部分，一跳過，被偷走的憑證就永遠有效。

狀態清單是一段壓縮過的位元串，每份憑證佔一個位元。涵蓋一百萬份憑證的清單是 125 KB 幾乎全是零，壓完只剩幾 KB。有訊號時抓回來，沒訊號時拿它對照。

```ts
// 簽發方依自己方便的節奏發布這個。
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// 驗證方拿自己快取的副本對照。
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

這些拒絕理由值得讀一遍，因為每一條都是一個更沉默的函式庫會給出假「通過」的地方：

- 你沒有傳清單，所以撤銷從來沒被檢查過：`status_unavailable`
- 你快取的清單比 `maxStatusAge` 還舊，所以排除不了撤銷：`status_list_stale`
- 清單由一把不在你信任清單裡的金鑰簽章，攻擊者要替被撤銷的憑證漂白，走的正是這條路：`bad_signature`
- 清單的簽發方與憑證的簽發方不同，或者對應的 `uri` 不同。同一個索引在每份清單裡指的東西都不一樣，所以沒有綁定關係的清單不構成答案：`status_unavailable`
- 憑證的索引落在你快取的清單之外，也就是說其實什麼都沒讀到：`status_unavailable`

> **乾淨的結果在這件事上從不沉默。** 當撤銷確實檢查過時，結果裡會有 `revocationChecked: true`。如果這個函式庫搆不到一個真正的答案，它會拒絕，而不是帶著那個標記把憑證放過去，因為虛假的保證比沒有答案更糟。

在無法確定時該怎麼辦，是你部署環境的政策問題，不是函式庫的問題，所以 `qredential` 拒絕默默替你決定。當撤銷確實檢查過時，成功的結果會用 `revocationChecked: true` 這樣告訴你。

<!-- section: trust -->

## 信任清單

唯一必須走帶外管道送到裝置上的，是你願意相信的那組簽發方公鑰。它極少變動，所以隨應用程式一起發布、每週更新一次，是完全合理的散布策略。

```ts
const trust = {
  issuers: {
    'https://id.example.gov': {
      name: 'Example Motor Vehicle Authority',
      keys: [{ kid: '2026-a', alg: 'ES256', jwk: publicJwk }],
    },
  },
}
```

決定用哪個演算法的是受信任的那把金鑰，絕不是憑證自己標頭裡寫的演算法。這就是對抗演算法替換的全部防線，也是為什麼 `alg` 長在你信任清單的金鑰上，而不是被推斷出來。

清單怎麼送到裝置上、金鑰怎麼輪替、私鑰放在哪裡，都不在範圍內。這個函式庫把它們當作輸入。

<!-- section: api -->

## API 參考

四個函式涵蓋憑證的一生，另外一個給要發布撤銷資訊的簽發方用。

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| 選項 | 型別 | 意義 |
|---|---|---|
| `issuer` | `string` | 必須對得上驗證方信任清單中某把金鑰的識別碼。 |
| `key` | `Jwk` | 私鑰。不會離開這次呼叫。 |
| `kid` | `string` | 金鑰識別碼，寫進標頭，好讓驗證方在輪替期間挑對金鑰。 |
| `alg` | `'ES256' \| 'EdDSA'` | 預設 `ES256`，所有平台都支援。 |
| `claims` | `object` | 憑證所主張的內容。 |
| `disclose` | `string[]` | 持有人可以不揭露的 claim 名稱。其餘的一律可見。寫一個不存在的名稱會擲出例外。 |
| `vct` | `string` | 憑證型別，也就是 SD-JWT VC 的 `vct`。 |
| `subject` | `string` | 選用的主體識別碼。 |
| `expiresIn` | `number \| string` | 秒數，或像 `'1825d'` 這樣的時間長度。 |
| `notBefore` | `number \| string` | 同樣的寫法，用於稍後才生效的憑證。 |
| `status` | `{ idx, uri }` | 這份憑證在狀態清單中的位置。 |
| `holderKey` | `Jwk` | 持有人的**公鑰**，寫進 `cnf`。只有靜態憑證才省略它。帶有私鑰成分的金鑰會被拒絕。 |

回傳 `credential`（SD-JWT 的組合形式，存進錢包的就是它）、`qr`（可掃描的信封）、`bytes`（`qr` 的字元數），以及 `disclosable`（持有人可以不揭露的 claim 名稱）。

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

把憑證收窄到列出的那些 claim，並回傳一個可掃描的信封。簽好章的 JWT 一個字都不會動，所以簽發方的簽章對剩下的內容依然成立。組合形式與信封都接受。要一個簽發方沒有設為可揭露的 claim 會擲出例外。

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| 選項 | 型別 | 意義 |
|---|---|---|
| `trust` | `TrustList` | 必填。你願意相信的簽發方與金鑰。 |
| `status` | `string` | 快取的狀態清單權杖。沒有它，指向清單的憑證無法放行。 |
| `maxStatusAge` | `number \| string` | 比這更舊的清單，拒絕據以作答。 |
| `clockSkew` | `number` | 簽發方與驗證方之間時鐘偏移的容許秒數。預設 60。 |
| `nonce` | `string` | 這次掃碼中，這個驗證方發出的挑戰值。要接受持有人證明就必須有。 |
| `audience` | `string` | 這個驗證方自己的識別碼，用來比對證明裡的 `aud`。 |
| `acceptWithoutHolderProof` | `boolean` | 接受不帶任何證明的出示。靜態憑證需要它，而且它絕不會放過一份存在卻壞掉的證明。 |
| `maxKeyBindingAge` | `number \| string` | 持有人證明最多可以多舊。預設 5 分鐘。 |
| `now` | `number` | 覆寫目前時間。供測試與重放分析使用。 |

面對惡意輸入從不擲出例外。它回傳一個可辨識聯集：成功時是 `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`，失敗時是 `{ ok: false, reason, message }`，其中 `reason` 取自下面那張表。

`withheld` 計的是沒有隨行的可揭露 claim 數量。它對訂定政策有用，而且就結構而言，它無法告訴你那些是哪幾個。

**`claims` 裡的一切都在描述主體。** 那些描述權杖本身的註冊 claim，例如 `iss`、`iat`、`exp` 與 `status`，改以具型別的欄位出現；而試圖設定其中之一、或覆寫酬載已經定下的 claim 的揭露，會讓整份憑證失敗。所以走訪 `claims` 是安全的。

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

同步函式。回傳 `{ chars, version, capacity, comfortable, errorCorrection, advice }`。錯誤更正等級預設為 `M`，因為 `L` 在紙面上看起來大方，到了磨損的印刷卡片上就不行了。當沒有任何版本裝得下酬載時 `version` 是 `null`，而 `advice` 是一句可以直接印進建置記錄的話。

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

給簽發方用。接受 `issuer`、`key`、`kid`、`alg`、`uri`、`size`、`revoked`、`suspended`、`expiresIn` 與 `issuedAt`，回傳一個簽好章的狀態清單權杖。超出清單範圍的索引會擲出例外，而不是去弄壞鄰近憑證的那一個位元。

### 另外匯出的

給 QR Code 信封用的 `pack`、`unpack` 與 `isEnvelope`，以及單獨的編解碼 `encodeBase45` 與 `decodeBase45`。做工具時好用，日常使用不需要。

<!-- section: errors -->

## 錯誤處理

恰好兩條約定，而這個切分是刻意的，不是碰巧。記住這兩句話，你就能只寫一個 catch 區塊，並且知道裡面會掉下什麼。

```sig
1. verify() 從不擲出例外。對任何輸入都是。
2. 其餘一切只擲 QredentialError。
```

兩者不同的理由：`verify()` 的存在就是為了朝惡意輸入去用，而一個會擲例外的驗證器，會被人用 `try/catch` 一包，然後把人放過去。所以它回傳一個你非看不可的結果。其餘部分失敗在呼叫端能在程式碼裡修好的條件上，那裡擲例外才是對的形狀。

這兩條規則都由基於性質的測試撐著：它們產生隨機字串、壞掉的金鑰、毀損的信封與惡意選項，並斷言沒有別的東西逃得出去。沒有來自 JSON 剖析的 `SyntaxError`，沒有來自 WebCrypto 的 `DOMException`，也沒有來自配置的 `RangeError`。

### 處理驗證結果

結果是一個可辨識聯集，所以 TypeScript 會替你收窄型別：

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // 已收窄：主體的屬性
  result.withheld        // 有多少可揭露的 claim 沒有隨行
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

如果你的程式碼是繞著 `try/catch` 蓋的，就把同一個結果交給 `assertVerified()`。什麼都不會少：擲出的錯誤帶著原本的理由。

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // 和上面同一個 FailReason
  } else {
    throw error
  }
}
```

### 拒絕理由

由 `verify()` 透過 `result.reason` 回傳。試用場會把每一條都朝驗證器丟過去，好讓你看著它們落地。

| 理由 | 發生了什麼 |
|---|---|
| `malformed` | 根本不是憑證，或者信封毀損，或者組合形式少了結尾的分隔符號。 |
| `unknown_issuer` | `iss` claim 不在你的信任清單裡。 |
| `unknown_key` | 簽發方受信任，但沒有帶那個 `kid` 的金鑰。 |
| `unsupported_alg` | 標頭要求的演算法不是受信任金鑰所用的那個。 |
| `bad_signature` | 簽章對不上。也包含偽造的狀態清單。 |
| `expired` | 超過 `exp`，且超出時鐘容許範圍。 |
| `not_yet_valid` | 在 `nbf` 之前。 |
| `digest_mismatch` | 一筆簽發方從未簽過的揭露、一筆送了兩次的揭露、一筆用了註冊 claim 名稱的揭露，或者一筆和酬載中已有 claim 撞名的揭露。 |
| `revoked` | 簽發方立起了這份憑證的那個位元。也包含停用。 |
| `status_unavailable` | 無法判定撤銷狀態：沒提供清單、讀不了、綁在別的簽發方或別的 uri 上，或者索引落在範圍之外。 |
| `status_list_stale` | 你快取的清單比 `maxStatusAge` 更舊。 |
| `holder_proof_missing` | 沒有提供持有人證明，呼叫端也沒有傳 `acceptWithoutHolderProof`。 |
| `holder_proof_invalid` | 提供了證明但沒過：金鑰不對、nonce 不對、audience 不對、揭露集合不同、已過期，或者掛在一份沒有綁定金鑰的憑證上。 |

### 擲出的錯誤

除 `verify()` 之外的一切都擲 `QredentialError`，它帶著一個 `code`。請用 `isQredentialError()` 而不是 `instanceof`：它看的是形狀，所以當同一棵相依樹裡混進這個套件的兩份副本時依然管用，而那正是 `instanceof` 悄悄不再吻合的常見原因。

| 代碼 | 由誰擲出 | 發生了什麼 |
|---|---|---|
| `invalid_option` | `issue`、`createStatusList` | API 用不了的引數：未知的 claim 名稱、不合法的時間長度、超出清單範圍的狀態索引。 |
| `not_disclosable` | `present` | 你要揭露一個簽發方從未設為可揭露的 claim。 |
| `malformed_credential` | `present` | SD-JWT 的組合形式格式不對。 |
| `malformed_envelope` | `unpack`、`present` | QR Code 信封格式不對。底下那層編解碼的錯誤請看 `cause`。 |
| `malformed_status_list` | 讀取狀態清單時 | 該權杖不是一份讀得懂的狀態清單。 |
| `invalid_encoding` | `decodeBase45` | 本該是 base45 或 base64url 的文字不是，或者某個片段不是 JSON。 |
| `unsupported_alg` | `issue` | 這個版本沒有實作的演算法。 |
| `unsupported_runtime` | `unpack` | 平台缺少必要的東西，例如舊版 React Native 上的 `DecompressionStream`。 |
| `crypto_failure` | `issue`、`createStatusList` | WebCrypto 拒絕了一把金鑰或一次操作。原始的 `DOMException` 在 `cause` 裡。 |
| `verification_failed` | `assertVerified` | 只來自那個輔助函式。帶著原本的 `reason`。 |

### 讀取底下的東西

在這個函式庫包住別人的失敗之處，它把原始錯誤留在標準的 `cause` 屬性上，所以拿到一個具體的代碼，不會讓你失去細節：

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // 來自 base45 解碼器的 invalid_encoding 錯誤
  }
}
```

> **代碼是 API，訊息不是。** 每一個 `code` 與 `reason` 的值都受語意化版本約束：一個值絕不會被挪作他用，新的值只在次版本裡出現。訊息文字可以在修補版本裡改，所以請依代碼分支，把訊息印出來就好。儲存庫裡有一個測試釘住了代碼的完整集合，所以增減一個必須是刻意為之，而不是某個副作用。

<!-- section: limits -->

## 這個函式庫不是什麼

- **不是錢包。** 沒有介面，沒有儲存。
- **不是金鑰管理。** 金鑰與信任清單的散布都得你自己帶來。
- **逐一出示陣列元素。** 驗證端解得開它們；但 `present()` 是依 claim 名稱挑選的，而陣列元素沒有名稱，所以這個版本把它們保留不揭。少了那些元素，憑證依然驗得過。依路徑的選擇器才是解法，目前還沒有。
- **還不是 ISO 18013-5 mDL。** 那邊是 CBOR 與 COSE，不是 JWT。它在規劃中，而宣稱做了半套合規標準，比什麼都不宣稱更糟。
- **沒有做過稽核。** 這個函式庫實作的是已發布的標準，並針對試用場裡的那些攻擊做過測試，但測試能證明的是防禦存在，永遠不是防禦完備。

原始碼大約 700 行，沒有任何執行期相依套件，正是為了讓「在信任它之前先讀過一遍」這件事切實可行。漏洞請走 GitHub 的 Security 頁籤，範圍與回應時限寫在 [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) 裡。
