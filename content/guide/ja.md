<!-- translated-from: d6f6153e6fb350ac -->
<!-- section: top -->

<!-- eyebrow -->
_ドキュメント_

# ネットワークを切ったまま検証できる資格情報

<!-- lede -->
QR コードが証明そのものを持ち歩きます。`qredential` は署名、有効期限、失効状態、クレームを、端末から一度もリクエストを出さずに確認します。

<!-- cta --> [プレイグラウンドを開く](../../playground/)

<!-- cta --> [ソースを読む](https://github.com/george-veras/qredential)

<!-- section: start -->

## はじめる

```ts
npm i qredential
```

Node 20 以降、現行のあらゆるブラウザ、そして React Native。WebCrypto だけを使い、Node 固有のものは使いません。検証する側の端末はたいてい携帯電話だからです。実行時の依存関係はありません。

テストスイート全体が、コミットのたびに Linux、macOS、Windows 上の Node 20、22、24 で、そして Chromium、Firefox、WebKit で実行されます。Ed25519 は四つすべてで動かしています。

> **React Native に関する一点の但し書き。** `CompressionStream` がありません。発行、提示、検証はそれなしでも動きます。エンベロープが圧縮されないままになるだけで、代償はサイズだけです。*オフラインでの失効確認は動きません*。ステータスリストを読むにはビット列を展開する必要があるからです。キャッシュ済みリストを展開できない検証側は、読めないリストを「問題なし」と扱わずに `status_unavailable` で拒否します。React Native で失効確認が必要なら `DecompressionStream` のポリフィルを入れてください。両方のグローバルを削除した状態で全体の流れを実行するテストがあるので、この説明は推測ではなく検証済みです。

### 何かを検証する

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### 一巡の流れ

三者、三つの呼び出し。発行者が一度署名し、保持者が渡るものを絞り、検証者が判断します。

```ts
import { issue, present, verify } from 'qredential'

// 1. 発行者が、免許交付時に一度だけ。
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

// 2. 保持者のウォレットが、読み取りの場で。年齢だけ見せ、生年月日は手元に残す。
const presentation = await present(credential, { disclose: ['over_18'] })

// 3. 検証者が、オフラインで。
const result = await verify(presentation, { trust })
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined。ウォレットから出ていない
```

<!-- section: disclosure -->

## 選択的開示

別々の二者が別々の二つの判断を下します。これを混同するのが典型的な設計ミスです。**発行者**は署名時に `disclose` で、どのクレームを伏せて*よい*かを決めます。**保持者**はその中からどれを実際に見せるかを、読み取り時に、同じく `disclose` で決めます。発行者が指定しなかったクレームは、誰にも伏せられません。

仕組みはごく普通のハッシュです。開示可能な各クレームは 128 ビットのランダムなソルトとともに直列化され、その文字列のダイジェストだけが資格情報に署名されます。クレームを見せるとは、元の文字列を送って検証者にハッシュさせ、ダイジェストを突き合わせてもらうことです。伏せるとは、検証者の手元に決して開けないダイジェストが残るということです。

### 入れ子、配列、再帰的な開示

RFC 9901 は三つすべてを許し、欧州のウォレット圏は三つすべてを使います。ここでの検証は、7.1 節の処理モデルに従って、どの深さでもそれらを解決します。

- 入れ子オブジェクト内の `_sd` 配列は、そのオブジェクトのプロパティを隠します。
- `{"...": digest}` の形をした配列要素は、その要素自体を隠します。伏せられた要素はプレースホルダとして残らず配列から*取り除かれる*ので、受け取るのはそのまま表示できるきれいな値です。
- 開示された値がさらにどちらの形も含みうるため、一つ解くとさらに現れます。

そのどれも `claims` には漏れません。`_sd` キーも `"..."` 要素も呼び出し側には届きません。開示された名前は `address.locality` のようなパスで返り、全体が同じ RFC の独立実装と双方向で突き合わせられています。

> **年齢確認でこれが効く理由。** ありがちな実装は、客に身分証の写真を第三者へアップロードさせます。これは起きるのを待っているだけの情報漏えいです。ここでは店は真偽値を一つ知るだけで、望んでも生年月日は知りえません。この性質は暗号的なものであって、プライバシーポリシー上の約束ではありません。

発行者が開示可能にしなかったクレームを要求すると、黙って要求より少なく返すのではなく、例外を投げます。

<!-- section: holder -->

## 保持者を証明する

選択的開示が証明するのは、発行者がそれらのクレームに署名したことです。それだけでは、提示している人物が本人であることは証明されません。しかもこの隙間は理屈の上の話ではありません。他人のコードを撮った写真は同じ署名を持ち、まったく同じように検証を通ります。

鍵バインディングがこれを塞ぎます。発行者が保持者の公開鍵を資格情報に書き込み、読み取りの場で保持者のウォレットが対応する秘密鍵で新しいチャレンジに署名します。写真にはそれができません。

### 三つの手順

```ts
// 1. 発行者が保持者の公開鍵を結び付ける。
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. ウォレットが、読み取りの場で、この検証者のチャレンジに署名する。
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. 検証者が、その証明が自分のチャレンジに答えているか確認する。
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

証明は四つのものに結び付き、それぞれが特定の攻撃を塞ぎます。**nonce** は記録された提示の再生を防ぎ、**audience** はある検証者向けの証明を別の検証者で使うことを防ぎ、**署名**は発行者が結び付けた鍵に紐づけ、`sd_hash` は提示された開示の集合そのものを覆うので、保持者の署名後に中継者が開示を足したり削ったりできません。証明には有効期限もあり、既定で五分、`maxKeyBindingAge` で調整できます。

### 静的な資格情報と、その選択を声に出して行うべき理由

カードに印刷されたコードには、以上のどれもできません。読み取りの場で署名する装置が存在しないので、静的な資格情報は本質的に複製可能です。これは誤りではなく、現実によくある状況です。ただし検証者が、それと知った上で下すべき判断です。

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false。どちらを選んでもそう表示される
```

この指定がなければ、証明のない提示は `holder_proof_missing` で拒否されます。既定を厳しい側にしてあるのは意図的です。危ないのは、入口の読み取り機を作る人が鍵バインディングの存在を知らないまま、スクリーンショットで破られるものを出荷する場合です。問題を名指しして大きな音を立てて失敗するほうが、それを覆い隠す静かな既定値よりも価値があります。

> **受け入れを選んでも、壊れた証明を素通しさせることはありません。** `acceptWithoutHolderProof` が覆うのは、証明がそもそも提示されなかった場合です。証明が存在して失敗したなら、この指定にかかわらず資格情報は拒否されます。

### 何を代償にするか

バインディングは QR の観点では無料ではありません。保持者の公開鍵は資格情報の中に居座り、証明は提示に付いて回ります。

| 提示 | 文字数 | QR バージョン |
|---|---|---|
| 静的、すべて可視 | ~740 | 18、問題なく読める |
| 年齢のみ、結び付けあり証明なし | ~1320 | 24、密 |
| 年齢のみ、保持者の証明あり | ~1605 | 27、密すぎる |

証明そのものは約 285 文字です。見た目ほど問題にはなりません。鍵バインディングができる資格情報は、定義からして画面に表示されているのであり、そこではコードを大きく明るくできるからです。密度の限界が問題になるのは擦り切れた印刷カードであり、印刷カードはそもそも鍵バインディングをするはずがありません。

<!-- section: size -->

## サイズの予算

QR コードは最大でも英数字およそ 4300 文字しか収まりませんが、その大きさのコードは傷んだカードやひび割れた画面では読めません。実用上の上限はバージョン 20 前後です。

現実的な運転免許証が費やす量は次のとおりです。クレーム八つ、有効期間五年、ステータスリストへのポインタ付き。リポジトリの `examples/sizes.mjs` で測定しています。

| 資格情報 | 文字数 | QR バージョン |
|---|---|---|
| すべて可視 | ~740 | 18、問題なく読める |
| 八つすべて開示可能 | ~1590 | 27、密すぎる |
| `over_18` だけを提示 | ~1115 | 22、まだ密 |

居心地が悪いのは真ん中の行で、カードを刷った後より、ここで知るほうがましです。選択的開示は資格情報をほぼ倍にします。開示可能なクレームごとにソルトと署名済みダイジェストがかかり、しかも**ダイジェストは、保持者がそのクレームを見せるかどうかに関わらずペイロードに残る**からです。これは意図的です。見せた内容に応じてダイジェストの個数が減れば、何を伏せたかが漏れてしまいます。実際の帰結として、提示時の節約は直感が約束するより小さくなります。ここでは三割であって、八割ではありません。

ですから、検証者が単独で見る必要が本当にありうるクレームだけを開示可能にしてください。全部ではなく、二つか三つ。`fits()` が、決める前に現在地を教えてくれます。

> **base45 について。** 通説では小ささのために選ばれたと言われます。違います。QR の英数字モードでの base45 は元の 1 バイトあたり約 8.25 ビット、バイトモードの base64 が 10.67、生のバイナリがちょうど 8 です。base64 には明確に勝ち、生バイトにはわずかに負けます。生バイトを意図的に手放しているのは、バイトモードが文字集合の曖昧さを抱えており、多くの読み取り機が壊れた文字列を返すからです。コピーされ、貼り付けられ、ログに残っても生き延びる資格情報は、三パーセントの代償に見合います。

<!-- section: revocation -->

## オフラインでの失効確認

失効確認は実装が飛ばしがちな部分で、飛ばすと盗まれた資格情報が永遠に通ってしまいます。

ステータスリストは、資格情報一件につき一ビットの圧縮ビット列です。百万件を覆うリストはほとんどがゼロの 125 KB で、圧縮すれば数キロバイトになります。電波があるときに取得し、ないときに照合してください。

```ts
// 発行者は都合のよい頻度でこれを公開する。
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// 検証者はキャッシュした写しと照合する。
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

拒否の理由は読む価値があります。どれもが、もっと無口なライブラリなら偽の「はい」を返していたはずの場所だからです。

- リストを渡していないので、失効は一度も確認されていない: `status_unavailable`
- キャッシュしたリストが `maxStatusAge` より古いので、失効を否定できない: `status_list_stale`
- リストが信頼リストにない鍵で署名されている。攻撃者が失効済み資格情報を洗浄するならまさにこの手口: `bad_signature`
- リストの発行者が資格情報の発行者と異なる、あるいは `uri` が異なる。同じ添字でもリストごとに指すものが違うので、結び付いていないリストは答えにならない: `status_unavailable`
- 資格情報の添字が、キャッシュしたリストの外側にある。つまり実際には何も読めていない: `status_unavailable`

> **きれいな結果がこの点で黙ることはありません。** 失効が実際に確認できたときは、結果に `revocationChecked: true` が入ります。本当の答えに到達できない場合、ライブラリはそのフラグを立てたまま資格情報を通すのではなく拒否します。偽りの保証は、答えがないことより悪いからです。

確信が持てないときにどうするかは、あなたの運用の方針の問題であってライブラリの問題ではないので、`qredential` はそれを黙って代わりに決めることを拒みます。失効が確認できたときは、成功した結果が `revocationChecked: true` でそう告げます。

<!-- section: trust -->

## 信頼リスト

経路外で端末に届ける必要がある唯一のものが、あなたが信じてよいと考える発行者公開鍵の集合です。これはめったに変わらないので、アプリに同梱して週に一度更新する、というのはまったく妥当な配布方法です。

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

どのアルゴリズムを使うかを決めるのは信頼された鍵であって、資格情報自身のヘッダに書かれたアルゴリズムでは決してありません。これがアルゴリズム置換に対する防御のすべてであり、`alg` が推測されるのではなく信頼リストの鍵側に置かれている理由です。

リストが端末にどう届くか、鍵をどう更新するか、秘密鍵をどこに置くかは対象外です。ライブラリはそれらを入力として受け取ります。

<!-- section: api -->

## API リファレンス

四つの関数が資格情報の一生を覆い、加えて失効を公開する発行者向けに一つあります。

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| オプション | 型 | 意味 |
|---|---|---|
| `issuer` | `string` | 検証者の信頼リスト内の鍵と一致しなければならない識別子。 |
| `key` | `Jwk` | 秘密鍵。この呼び出しから外へ出ません。 |
| `kid` | `string` | 鍵の識別子。ヘッダに書かれ、鍵更新の際に検証者が正しい鍵を選べるようにします。 |
| `alg` | `'ES256' \| 'EdDSA'` | 既定は `ES256`。あらゆるプラットフォームが対応します。 |
| `claims` | `object` | 資格情報が主張する内容。 |
| `disclose` | `string[]` | 保持者が伏せてよいクレーム名。それ以外は常に可視です。存在しない名前を書くと例外を投げます。 |
| `vct` | `string` | 資格情報の型、SD-JWT VC の `vct`。 |
| `subject` | `string` | 任意の主体識別子。 |
| `expiresIn` | `number \| string` | 秒数、または `'1825d'` のような期間。 |
| `notBefore` | `number \| string` | 同じ書き方。後から有効になる資格情報向け。 |
| `status` | `{ idx, uri }` | ステータスリスト内のこの資格情報の位置。 |
| `holderKey` | `Jwk` | 保持者の**公開**鍵。`cnf` に書き込まれます。静的な資格情報のときだけ省いてください。秘密成分を含む鍵は拒否されます。 |

返り値は `credential`（SD-JWT の結合形式。ウォレットに保存するのはこれです）、`qr`（読み取り可能なエンベロープ）、`bytes`（`qr` の文字数）、`disclosable`（保持者が伏せられるクレーム名）です。

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

資格情報を列挙されたクレームに絞り、読み取り可能なエンベロープを返します。署名済み JWT には一切手を触れないので、残った内容に対して発行者の署名は依然として有効です。結合形式でもエンベロープでも受け付けます。発行者が開示可能にしなかったクレームを求めると例外を投げます。

`disclose` はパスを受け取ります。`verify()` が `disclosed` で返すものと同じです。

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

名前だけを書けば一区間のパスなので、`'over_18'` はこれまでどおりの意味です。**配列の添字は発行時の資格情報における位置**であって提示側の位置ではないため、保持者がほかに何を伏せても、選択子は書いたとおりの意味を保ちます。また入れ子の開示は、それを含む開示なしには正当に渡れないので、`address.locality` を求めると `address` も一緒に送られます。呼び出し側に押しつけず、こちらで解決します。

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| オプション | 型 | 意味 |
|---|---|---|
| `trust` | `TrustList` | 必須。信じてよいと考える発行者と鍵。 |
| `status` | `string` | キャッシュ済みのステータスリストトークン。これがないと、リストを指す資格情報は通せません。 |
| `maxStatusAge` | `number \| string` | これより古いリストからは答えることを拒む。 |
| `clockSkew` | `number` | 発行者と検証者の時計のずれに対する許容秒数。既定は 60。 |
| `nonce` | `string` | この読み取りのためにこの検証者が発行したチャレンジ。保持者の証明を受け入れるには必須。 |
| `audience` | `string` | この検証者の識別子。証明の `aud` と照合されます。 |
| `acceptWithoutHolderProof` | `boolean` | 証明のない提示を受け入れる。静的な資格情報には必要で、存在して壊れている証明を素通しさせることは決してありません。 |
| `maxKeyBindingAge` | `number \| string` | 保持者の証明が許される古さ。既定は 5 分。 |
| `now` | `number` | 現在時刻を上書きする。テストと再生解析のため。 |

敵対的な入力に対して例外を投げることはありません。判別可能な合併型を返します。成功時は `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`、失敗時は `{ ok: false, reason, message }` で、`reason` は下の表から取られます。

`withheld` は、渡らなかった開示可能クレームの個数です。方針判断には役立ちますが、構造上それがどれだったかを教えることはできません。

**`claims` にあるものはすべて主体を記述します。** `iss`、`iat`、`exp`、`status` のようにトークン自体を記述する登録済みクレームは、代わりに型付きのフィールドとして現れます。そしてそれらを設定しようとする開示や、ペイロードが既に決めたクレームを上書きしようとする開示は、資格情報全体を失敗させます。したがって `claims` を素直に走査しても安全です。

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

同期関数。`{ chars, version, capacity, comfortable, errorCorrection, advice }` を返します。誤り訂正の既定が `M` なのは、`L` が紙の上では気前よく見えて、擦り切れた印刷カードでは失敗するからです。`version` はどのバージョンにも収まらないとき `null` になり、`advice` はビルドログにそのまま出せる一文です。

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

発行者向け。`issuer`、`key`、`kid`、`alg`、`uri`、`size`、`revoked`、`suspended`、`expiresIn`、`issuedAt` を受け取り、署名済みのステータスリストトークンを返します。リストの外側の添字は、隣の資格情報のビットを壊すのではなく例外を投げます。

### そのほかのエクスポート

QR エンベロープ用の `pack`、`unpack`、`isEnvelope`、およびコーデック単体の `encodeBase45` と `decodeBase45`。ツール作りには便利ですが、通常の利用には不要です。

<!-- section: errors -->

## エラーの扱い

約束はちょうど二つあり、その分け方は偶然ではなく意図的です。この二文を覚えれば、catch ブロックを一つ書いて、そこに何が来うるかを把握できます。

```sig
1. verify() は決して例外を投げない。どんな入力でも。
2. それ以外はすべて QredentialError だけを投げる。
```

分かれている理由は、`verify()` が敵対的な入力に向けられるために存在するからです。例外を投げる検証器は、誰かが `try/catch` で包んで人を素通しさせる検証器です。だから、あなたが必ず見る結果を返します。それ以外は、呼び出し側がコードで直せる条件で失敗するので、そこでは投げるのが正しい形です。

どちらの規則も、ランダムな文字列、壊れた鍵、破損したエンベロープ、敵対的なオプションを生成して、それ以外は何も外へ出ないことを主張する性質ベースのテストで支えられています。JSON パースからの `SyntaxError` も、WebCrypto からの `DOMException` も、確保時の `RangeError` も出ません。

### 検証結果を扱う

結果は判別可能な合併型なので、TypeScript が型を絞ってくれます。

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // 絞り込み済み: 主体の属性
  result.withheld        // 渡らなかった開示可能クレームの個数
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

コードベースが `try/catch` を中心に組まれているなら、同じ結果を `assertVerified()` に通してください。失われるものはありません。投げられるエラーが元の理由を持ち回ります。

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // 上と同じ FailReason
  } else {
    throw error
  }
}
```

### 拒否理由

`verify()` が `result.reason` として返します。プレイグラウンドはこれらを一つずつ検証器に投げつけるので、届くところを見られます。

| 理由 | 何が起きたか |
|---|---|
| `malformed` | そもそも資格情報でない、エンベロープが壊れている、あるいは結合形式に末尾の区切りがない。 |
| `unknown_issuer` | `iss` クレームが信頼リストにない。 |
| `unknown_key` | 発行者は信頼されているが、その `kid` を持つ鍵がない。 |
| `unsupported_alg` | ヘッダが、信頼された鍵の使わないアルゴリズムを要求している。 |
| `bad_signature` | 署名が合わない。偽造されたステータスリストも含む。 |
| `expired` | 時計の許容を超えて `exp` を過ぎている。 |
| `not_yet_valid` | `nbf` より前。 |
| `digest_mismatch` | 発行者が署名していない開示、二度送られた開示、登録済みクレーム名を名乗る開示、あるいは既にペイロードにあるクレームと衝突する開示。 |
| `revoked` | 発行者がこの資格情報のビットを立てた。停止も含む。 |
| `status_unavailable` | 失効を判定できなかった。リスト未提供、読めない、別の発行者や別の uri に紐づく、または添字が範囲外。 |
| `status_list_stale` | キャッシュしたリストが `maxStatusAge` より古い。 |
| `holder_proof_missing` | 保持者の証明が提示されず、呼び出し側が `acceptWithoutHolderProof` を渡していない。 |
| `holder_proof_invalid` | 証明が提示されて失敗した。鍵違い、nonce 違い、audience 違い、開示集合の不一致、期限切れ、または鍵の結び付いていない資格情報に付いている。 |

### 投げられるエラー

`verify()` 以外はすべて `QredentialError` を投げ、そこには `code` が入っています。`instanceof` ではなく `isQredentialError()` を使ってください。形を見るので、同じ依存ツリーにパッケージの写しが二つ入り込んでも動き続けます。それが `instanceof` が静かに一致しなくなる典型的な原因です。

| コード | 投げる場所 | 何が起きたか |
|---|---|---|
| `invalid_option` | `issue`、`createStatusList` | API が使えない引数。未知のクレーム名、不正な期間、リスト外のステータス添字。 |
| `not_disclosable` | `present` | 発行者が開示可能にしなかったクレームを見せようとした。 |
| `malformed_credential` | `present` | SD-JWT の結合形式が壊れている。 |
| `malformed_envelope` | `unpack`、`present` | QR エンベロープが壊れている。下層のコーデックのエラーは `cause` にあります。 |
| `malformed_status_list` | ステータスリストの読み取り | トークンが読めるステータスリストでない。 |
| `invalid_encoding` | `decodeBase45` | base45 か base64url であるはずの文字列がそうでない、または断片が JSON でない。 |
| `unsupported_alg` | `issue` | この版が実装していないアルゴリズム。 |
| `unsupported_runtime` | `unpack` | 古い React Native の `DecompressionStream` のように、必要なものがプラットフォームに欠けている。 |
| `crypto_failure` | `issue`、`createStatusList` | WebCrypto が鍵または操作を拒否した。元の `DOMException` は `cause` にあります。 |
| `verification_failed` | `assertVerified` | この補助関数からのみ。元の `reason` を持ち回ります。 |

### 下にあるものを読む

このライブラリが他所の失敗を包むところでは、元のものを標準の `cause` プロパティに保ちます。具体的なコードを得るために詳細を失うことはありません。

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // base45 デコーダから来た invalid_encoding エラー
  }
}
```

> **コードは API、メッセージはそうではありません。** `code` と `reason` のすべての値はセマンティックバージョニングの対象です。値が別の意味に転用されることはなく、新しい値はマイナーバージョンでのみ増えます。メッセージ文はパッチで変わりうるので、コードで分岐し、メッセージは表示するにとどめてください。リポジトリのテストがコードの全集合を固定しているので、追加や削除は副作用ではなく意図的な行為でなければなりません。

<!-- section: limits -->

## これでないもの

- **ウォレットではありません。** 画面も保存機能もありません。
- **鍵管理ではありません。** 鍵も、信頼リストの配布も、あなたが用意します。
- **まだ ISO 18013-5 mDL ではありません。** あちらは JWT ではなく CBOR と COSE です。予定には入っていますが、適合規格を半分だけ満たしたと称するのは、何も称さないより悪いことです。
- **監査は受けていません。** 公開された規格を実装し、プレイグラウンドの攻撃に対して試験していますが、テストが示せるのは防御の存在であって、その網羅性ではありません。

ソースは実行時依存ゼロでおよそ 700 行です。信頼する前に読むことが現実的であるように、あえてそうしてあります。脆弱性は GitHub の Security タブを通してください。範囲と応答期限は [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) にあります。
