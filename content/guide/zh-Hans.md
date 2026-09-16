<!-- translated-from: d6f6153e6fb350ac -->
<!-- section: top -->

<!-- eyebrow -->
_文档_

# 断网也能验证的凭证

<!-- lede -->
二维码自带证明。`qredential` 检查签名、有效期、吊销状态和 claim，全程不向外发出一个请求。

<!-- cta --> [打开演练场](../../playground/)

<!-- cta --> [阅读源码](https://github.com/george-veras/qredential)

<!-- section: start -->

## 快速开始

```ts
npm i qredential
```

Node 20 及以上、所有现代浏览器，以及 React Native。只用 WebCrypto，不用任何 Node 专有的东西，因为做验证的设备通常是手机。没有任何运行时依赖。

完整测试套件在每次提交时都会在 Linux、macOS 和 Windows 上的 Node 20、22、24 运行，也在 Chromium、Firefox 和 WebKit 中运行。Ed25519 在这四者中都实际跑过。

> **关于 React Native 的一点说明。** 它没有 `CompressionStream`，而签发、出示和验证在没有它的情况下都能正常工作：信封只是保持未压缩，代价仅仅是体积。*离线吊销检查无法工作*，因为读取状态列表需要解压一段位串。无法解压缓存列表的验证方会以 `status_unavailable` 拒绝，而不是把读不懂的列表当作干净的列表。如果你在 React Native 上需要吊销检查，请为 `DecompressionStream` 打补丁。有一个测试在删掉这两个全局对象的情况下跑完整个流程，所以这段描述是验证过的，不是猜的。

### 验证点什么

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### 完整的一圈

三方，三次调用。签发方签一次，持有方收窄要传出去的内容，验证方做判断。

```ts
import { issue, present, verify } from 'qredential'

// 1. 签发方，在发放驾照时只做一次。
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

// 2. 持有方的钱包，在扫码现场。露出是否成年，留下出生日期。
const presentation = await present(credential, { disclose: ['over_18'] })

// 3. 验证方，离线。
const result = await verify(presentation, { trust })
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined，它从未离开钱包
```

<!-- section: disclosure -->

## 选择性披露

两个不同的角色做两个不同的决定，把它们混在一起是常见的设计错误。**签发方**在签名时用 `disclose` 决定哪些 claim *可以*被隐藏。**持有方**随后在扫码时，同样用 `disclose`，决定其中哪些真正展示。签发方没有标记过的 claim，谁也隐藏不了。

机制就是普通的哈希。每个可披露的 claim 都会连同一个 128 位随机盐一起序列化，只有这串字符的摘要被签进凭证里。展示一个 claim，就是把原始字符串发过去，让验证方哈希后对上摘要。隐藏它，就是让验证方手里剩下一个永远打不开的摘要。

### 嵌套、数组和递归披露

RFC 9901 这三种都允许，欧洲钱包生态这三种都在用。这里的验证按照 7.1 节的处理模型，在任意深度把它们解开：

- 嵌套对象里的 `_sd` 数组隐藏该对象的属性。
- 形如 `{"...": digest}` 的数组元素隐藏元素本身。被隐藏的元素会从数组中*移除*，而不是留下一个占位符，所以你拿到的是可以直接渲染的干净值。
- 被披露的值本身还可以包含这两种形式中的任意一种，所以解开一个会露出更多。

这些都不会漏进 `claims`：没有任何 `_sd` 键、没有任何 `"..."` 元素会到达调用方。披露的名字以路径形式返回，例如 `address.locality`，整套机制还与同一 RFC 的独立实现做了双向核对。

> **为什么这对年龄核验很重要。** 常见做法是让顾客把证件照片上传给第三方，那等于制造一起只等着发生的数据泄露。在这里酒吧只知道一个布尔值，就算它想知道出生日期也做不到。这个性质是密码学上的，不是隐私政策里的一句承诺。

要求一个签发方没有设为可披露的 claim，会抛出异常，而不是悄悄返回比你要的更少的东西。

<!-- section: holder -->

## 证明持有人

选择性披露证明的是签发方签过这些 claim。它本身并不能证明出示的人就是本人，而且这个缺口不是理论上的：别人凭证的照片带着同一个签名，验证起来一样顺利。

密钥绑定把它堵上。签发方把持有人的公钥写进凭证，扫码现场持有人的钱包用对应的私钥为一个新鲜的挑战值签名。照片做不到这一点。

### 三个步骤

```ts
// 1. 签发方绑定持有人的公钥。
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. 钱包在扫码现场为这个验证方的挑战值签名。
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. 验证方检查这份证明回应的是自己的挑战值。
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

这份证明把自己绑在四样东西上，每一样堵住一个具体的攻击：**nonce** 让录下来的出示无法重放，**audience** 让为某个验证方做的证明不能拿到另一处用，**签名**把它系在签发方绑定的那把密钥上，而 `sd_hash` 覆盖了本次出示的那一组披露，使得中间环节无法在持有人签名之后增删任何一条。它还会过期，默认五分钟，可用 `maxKeyBindingAge` 调整。

### 静态凭证，以及为什么这个选择要由你大声做出

印在卡片上的码做不到上面任何一件事。扫码现场没有能签名的设备，所以静态凭证天生可复制。这是真实且常见的情况，不是错误，但这是验证方应当在知情的前提下做出的决定：

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false，无论你怎么选，它都会这么说
```

不加这个选项，没有证明的出示会以 `holder_proof_missing` 被拒。默认选严格的那一侧是有意为之：危险的情形是有人做门禁扫码，从没听说过密钥绑定，然后交付了一个截图就能攻破的东西。一次点名问题的大声失败，比一个把问题藏起来的安静默认值更有价值。

> **选择接受，永远不会放过一份坏掉的证明。** `acceptWithoutHolderProof` 覆盖的是根本没有提供证明的情形。如果证明存在却验不过，无论这个选项如何，凭证都会被拒。

### 代价

绑定在二维码这个尺度上不是免费的。持有人的公钥住在凭证里，证明则随着出示一起走：

| 出示 | 字符数 | 二维码版本 |
|---|---|---|
| 静态，全部可见 | ~740 | 18，扫得挺好 |
| 仅年龄，已绑定但无证明 | ~1320 | 24，偏密 |
| 仅年龄，带持有人证明 | ~1605 | 27，太密 |

证明本身约 285 个字符。这比看上去要不打紧，因为能做密钥绑定的凭证，按定义就是显示在屏幕上的，那里的码可以又大又亮。密度的上限困扰的是磨损的印刷卡片，而印刷卡片本来也做不了密钥绑定。

<!-- section: size -->

## 体积预算

二维码在最大版本下大约能装 4300 个字母数字字符，但那么大的码在划花的卡片或碎屏上根本读不出来。实用上限在版本 20 附近。

一份现实的驾照要花多少，看下面。八个 claim、五年有效期、一个状态列表指针，用仓库里的 `examples/sizes.mjs` 测得：

| 凭证 | 字符数 | 二维码版本 |
|---|---|---|
| 全部可见 | ~740 | 18，扫得挺好 |
| 八个 claim 全部可披露 | ~1590 | 27，太密 |
| 只出示 `over_18` | ~1115 | 22，仍然偏密 |

中间那行才是难受的，而在这里知道总比印完卡片再知道好。选择性披露几乎让凭证翻倍，因为每个可披露的 claim 都要花一个盐加一个被签名的摘要，而且**无论持有人是否展示该 claim，摘要都留在载荷里**。这是有意的：如果摘要数量随着你展示的内容缩水，就会泄露你隐藏了什么。实际后果是，出示时省下的比直觉承诺的要少。这里是三成，不是八成。

所以只把验证方真有可能单独需要看到的 claim 设为可披露。两三个，不是全部。`fits()` 会在你定下来之前告诉你处境。

> **关于 base45。** 民间说法是它因为紧凑才被选中。不是。二维码字母数字模式下的 base45，每个原始字节约花 8.25 比特，字节模式下的 base64 是 10.67，裸二进制正好 8。它明显赢过 base64，略输给裸字节。放弃裸字节是有意的，因为字节模式带着字符集的歧义，不少读码器会返回一串乱掉的文本。一份经得起复制、粘贴和写进日志的凭证，值这三个百分点。

<!-- section: revocation -->

## 离线吊销检查

吊销检查是各家实现最爱跳过的部分，一跳过，被偷的凭证就永远有效。

状态列表是一段压缩过的位串，每个凭证一位。覆盖一百万份凭证的列表是 125 KB 几乎全是零，压完只剩几 KB。有信号时取回来，没信号时拿它核对。

```ts
// 签发方按自己方便的节奏发布这个。
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// 验证方拿自己缓存的副本核对。
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

这些拒绝理由值得读一遍，因为每一条都是一个更沉默的库会给出假「通过」的地方：

- 你没传列表，所以吊销从来没被检查过：`status_unavailable`
- 你缓存的列表比 `maxStatusAge` 还旧，所以排除不了吊销：`status_list_stale`
- 列表由一把不在你信任列表里的密钥签名，攻击者要给被吊销的凭证洗白，走的正是这条路：`bad_signature`
- 列表的签发方与凭证的签发方不同，或者对应的 `uri` 不同。同一个下标在每份列表里指的东西都不一样，所以没绑定关系的列表不构成答案：`status_unavailable`
- 凭证的下标落在你缓存的列表之外，也就是说其实什么都没读到：`status_unavailable`

> **干净的结果在这件事上从不沉默。** 当吊销确实检查过时，结果里会有 `revocationChecked: true`。如果这个库够不到一个真正的答案，它会拒绝，而不是带着这个标记把凭证放过去，因为虚假的保证比没有答案更糟。

在无法确定时该怎么办，是你部署环境的策略问题，不是库的问题，所以 `qredential` 拒绝悄悄替你决定。当吊销确实检查过时，成功的结果会用 `revocationChecked: true` 这么告诉你。

<!-- section: trust -->

## 信任列表

唯一必须走带外渠道送到设备上的，是你愿意相信的那组签发方公钥。它极少变动，所以随应用一起发布、每周刷新一次，是完全合理的分发策略。

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

决定用哪个算法的是受信任的那把密钥，绝不是凭证自己头部里写的算法。这就是对抗算法替换的全部防线，也是为什么 `alg` 长在你信任列表的密钥上，而不是被推断出来。

列表怎么到设备上、密钥怎么轮换、私钥放在哪里，都不在范围内。这个库把它们当作输入。

<!-- section: api -->

## API 参考

四个函数覆盖凭证的一生，外加一个给发布吊销信息的签发方用。

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| 选项 | 类型 | 含义 |
|---|---|---|
| `issuer` | `string` | 必须与验证方信任列表中某把密钥对应的标识。 |
| `key` | `Jwk` | 私钥。不会离开这次调用。 |
| `kid` | `string` | 密钥标识，写进头部，好让验证方在轮换期间选对密钥。 |
| `alg` | `'ES256' \| 'EdDSA'` | 默认 `ES256`，所有平台都支持。 |
| `claims` | `object` | 凭证所主张的内容。 |
| `disclose` | `string[]` | 持有人可以隐藏的 claim 名。其余的一直可见。写一个不存在的名字会抛异常。 |
| `vct` | `string` | 凭证类型，即 SD-JWT VC 的 `vct`。 |
| `subject` | `string` | 可选的主体标识。 |
| `expiresIn` | `number \| string` | 秒数，或者像 `'1825d'` 这样的时长。 |
| `notBefore` | `number \| string` | 同样的写法，用于稍后才生效的凭证。 |
| `status` | `{ idx, uri }` | 这份凭证在状态列表中的位置。 |
| `holderKey` | `Jwk` | 持有人的**公钥**，写进 `cnf`。只有静态凭证才省略它。带私钥成分的密钥会被拒绝。 |

返回 `credential`（SD-JWT 的组合形式，存进钱包的就是它）、`qr`（可扫描的信封）、`bytes`（`qr` 的字符数），以及 `disclosable`（持有人可以隐藏的 claim 名）。

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

把凭证收窄到列出的那些 claim，返回一个可扫描的信封。签名过的 JWT 一个字都不动，所以签发方的签名对剩下的内容依然成立。组合形式和信封都接受。要一个签发方没有设为可披露的 claim 会抛异常。

`disclose` 接受路径，和 `verify()` 在 `disclosed` 里返回的是同一种：

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

只写一个名字就是单段路径，所以 `'over_18'` 还是原来的意思。**数组下标是签发时凭证里的位置**，不是出示时的位置，所以无论持有人还隐藏了什么，选择器都保持它原本的含义。另外，嵌套的披露离开包着它的那一条就无法合法传递，所以要 `address.locality` 时也会一并送出 `address`，由这个库替你算好，而不是丢给调用方。

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| 选项 | 类型 | 含义 |
|---|---|---|
| `trust` | `TrustList` | 必填。你愿意相信的签发方和密钥。 |
| `status` | `string` | 缓存的状态列表令牌。没有它，指向列表的凭证无法被放行。 |
| `maxStatusAge` | `number \| string` | 比这更旧的列表，拒绝据此作答。 |
| `clockSkew` | `number` | 签发方与验证方之间时钟漂移的容忍秒数。默认 60。 |
| `nonce` | `string` | 本次扫码中这个验证方发出的挑战值。要接受持有人证明就必须有。 |
| `audience` | `string` | 这个验证方自己的标识，用来核对证明里的 `aud`。 |
| `acceptWithoutHolderProof` | `boolean` | 接受不带任何证明的出示。静态凭证需要它，而且它绝不会放过一份存在却坏掉的证明。 |
| `maxKeyBindingAge` | `number \| string` | 持有人证明最多可以多旧。默认 5 分钟。 |
| `now` | `number` | 覆盖当前时间。用于测试和重放分析。 |

面对敌意输入从不抛异常。它返回一个可辨识联合：成功时是 `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`，失败时是 `{ ok: false, reason, message }`，其中 `reason` 取自下面的表。

`withheld` 统计的是没有随行的可披露 claim 数量。它对做策略有用，而且从构造上它无法告诉你那些是哪几个。

**`claims` 里的一切都在描述主体。** 那些描述令牌本身的注册 claim，比如 `iss`、`iat`、`exp` 和 `status`，改以带类型的字段出现；而试图设置其中之一、或覆盖载荷已经定下的 claim 的披露，会让整份凭证失败。所以遍历 `claims` 是安全的。

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

同步函数。返回 `{ chars, version, capacity, comfortable, errorCorrection, advice }`。纠错等级默认 `M`，因为 `L` 在纸面上看着慷慨，到了磨损的印刷卡片上就不行了。当没有任何版本装得下载荷时 `version` 是 `null`，而 `advice` 是一句可以直接打进构建日志的话。

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

给签发方用。接受 `issuer`、`key`、`kid`、`alg`、`uri`、`size`、`revoked`、`suspended`、`expiresIn` 和 `issuedAt`，返回一个签名过的状态列表令牌。超出列表范围的下标会抛异常，而不是去破坏邻近凭证的那一位。

### 另外导出的

给二维码信封用的 `pack`、`unpack` 和 `isEnvelope`，以及单独的编解码 `encodeBase45` 和 `decodeBase45`。做工具时有用，日常使用不需要。

<!-- section: errors -->

## 错误处理

恰好两条约定，这个划分是有意的，不是碰巧。记住这两句话，你就能只写一个 catch 块，并且知道里面会落下什么。

```sig
1. verify() 从不抛异常。对任何输入都是。
2. 其余一切只抛 QredentialError。
```

两者不同的原因：`verify()` 的存在就是为了面对敌意输入，而一个会抛异常的验证器，会被人用 `try/catch` 一裹，然后把人放过去。所以它返回一个你必须去看的结果。其余部分失败在调用方能在代码里修好的条件上，那里抛异常才是对的形状。

这两条规则都由基于性质的测试撑着：它们生成随机字符串、畸形密钥、损坏的信封和敌意选项，并断言没有别的东西逃出去。没有来自 JSON 解析的 `SyntaxError`，没有来自 WebCrypto 的 `DOMException`，也没有来自分配的 `RangeError`。

### 处理验证结果

结果是一个可辨识联合，所以 TypeScript 会替你收窄类型：

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // 已收窄：主体的属性
  result.withheld        // 有多少可披露的 claim 没有随行
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

如果你的代码是围绕 `try/catch` 搭的，就把同一个结果交给 `assertVerified()`。什么都不会丢：抛出的错误带着原本的理由。

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // 和上面同一个 FailReason
  } else {
    throw error
  }
}
```

### 拒绝理由

由 `verify()` 通过 `result.reason` 返回。演练场会把每一条都朝验证器打过去，好让你看着它们落地。

| 理由 | 发生了什么 |
|---|---|
| `malformed` | 根本不是凭证，或者信封损坏，或者组合形式少了结尾的分隔符。 |
| `unknown_issuer` | `iss` claim 不在你的信任列表里。 |
| `unknown_key` | 签发方受信任，但没有带那个 `kid` 的密钥。 |
| `unsupported_alg` | 头部要求的算法不是受信任密钥所用的那个。 |
| `bad_signature` | 签名对不上。也包括伪造的状态列表。 |
| `expired` | 超过 `exp`，并且超出了时钟容差。 |
| `not_yet_valid` | 在 `nbf` 之前。 |
| `digest_mismatch` | 一条签发方从未签过的披露、一条发了两次的披露、一条用了注册 claim 名的披露，或者一条与载荷中已有 claim 撞名的披露。 |
| `revoked` | 签发方置上了这份凭证的那一位。也包括暂停。 |
| `status_unavailable` | 无法判定吊销状态：没提供列表、读不了、绑在别的签发方或别的 uri 上，或者下标在范围之外。 |
| `status_list_stale` | 你缓存的列表比 `maxStatusAge` 更旧。 |
| `holder_proof_missing` | 没有提供持有人证明，调用方也没有传 `acceptWithoutHolderProof`。 |
| `holder_proof_invalid` | 提供了证明但没通过：密钥不对、nonce 不对、audience 不对、披露集合不同、已过期，或者挂在一份没有绑定密钥的凭证上。 |

### 抛出的错误

除 `verify()` 之外的一切都抛 `QredentialError`，它带着一个 `code`。请用 `isQredentialError()` 而不是 `instanceof`：它看的是形状，所以当同一棵依赖树里混进两份这个包的副本时依然管用，而那正是 `instanceof` 悄悄不再匹配的常见原因。

| 代码 | 抛出方 | 发生了什么 |
|---|---|---|
| `invalid_option` | `issue`、`createStatusList` | API 无法使用的参数：未知的 claim 名、非法的时长、超出列表范围的状态下标。 |
| `not_disclosable` | `present` | 你要展示一个签发方从未设为可披露的 claim。 |
| `malformed_credential` | `present` | SD-JWT 的组合形式格式不对。 |
| `malformed_envelope` | `unpack`、`present` | 二维码信封格式不对。底下那层编解码的错误请看 `cause`。 |
| `malformed_status_list` | 读取状态列表时 | 该令牌不是一份可读的状态列表。 |
| `invalid_encoding` | `decodeBase45` | 本该是 base45 或 base64url 的文本不是，或者某个片段不是 JSON。 |
| `unsupported_alg` | `issue` | 这个版本没有实现的算法。 |
| `unsupported_runtime` | `unpack` | 平台缺少必需的东西，比如旧版 React Native 上的 `DecompressionStream`。 |
| `crypto_failure` | `issue`、`createStatusList` | WebCrypto 拒绝了一把密钥或一次操作。原始的 `DOMException` 在 `cause` 里。 |
| `verification_failed` | `assertVerified` | 只来自这个辅助函数。带着原本的 `reason`。 |

### 读取底下的东西

在这个库包住别人的失败的地方，它把原始错误保留在标准的 `cause` 属性上，所以拿到一个具体的代码，不会让你失去细节：

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // 来自 base45 解码器的 invalid_encoding 错误
  }
}
```

> **代码是 API，消息不是。** 每一个 `code` 和 `reason` 的取值都受语义化版本约束：一个取值绝不会被挪作他用，新的取值只在小版本里出现。消息文本可以在补丁版本里改，所以请按代码分支，把消息打出来就好。仓库里有一个测试固定了代码的完整集合，所以增删一个必须是有意为之，而不是某个副作用。

<!-- section: limits -->

## 这个库不是什么

- **不是钱包。** 没有界面，没有存储。
- **不是密钥管理。** 密钥和信任列表的分发都得你自己带来。
- **还不是 ISO 18013-5 mDL。** 那边是 CBOR 和 COSE，不是 JWT。它在计划里，而声称做了半个合规标准，比什么都不声称更糟。
- **没有做过审计。** 这个库实现的是已发布的标准，并针对演练场里的那些攻击做了测试，但测试能证明的是防御存在，永远不是防御完备。

源码大约 700 行，没有任何运行时依赖，正是为了让「在信任它之前先读一遍」这件事切实可行。漏洞请走 GitHub 的 Security 标签页，范围和响应时限写在 [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) 里。
