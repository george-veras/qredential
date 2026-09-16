<!-- translated-from: d6f6153e6fb350ac -->
<!-- section: top -->

<!-- eyebrow -->
_문서_

# 네트워크를 끈 채로 검증되는 자격증명

<!-- lede -->
QR 코드가 자기 증명을 직접 지니고 다닙니다. `qredential`은 서명, 만료, 폐기 상태, 클레임을 단 한 번의 요청도 기기 밖으로 내보내지 않고 확인합니다.

<!-- cta --> [플레이그라운드 열기](../../playground/)

<!-- cta --> [소스 읽기](https://github.com/george-veras/qredential)

<!-- section: start -->

## 시작하기

```ts
npm i qredential
```

Node 20 이상, 최신 브라우저 전부, 그리고 React Native. WebCrypto만 쓰고 Node 전용 기능은 쓰지 않습니다. 검증하는 기기는 대개 휴대폰이기 때문입니다. 런타임 의존성은 하나도 없습니다.

전체 테스트 스위트가 커밋마다 Linux, macOS, Windows의 Node 20, 22, 24에서, 그리고 Chromium, Firefox, WebKit에서 돌아갑니다. Ed25519는 네 곳 모두에서 실제로 시험합니다.

> **React Native에 대한 단서 하나.** 거기엔 `CompressionStream`이 없고, 발급과 제시와 검증은 그것 없이도 동작합니다. 봉투가 압축되지 않은 채로 남을 뿐이고, 대가는 크기뿐입니다. *오프라인 폐기 확인은 동작하지 않습니다.* 상태 목록을 읽으려면 비트열을 풀어야 하기 때문입니다. 캐시된 목록을 풀지 못하는 검증자는 읽을 수 없는 목록을 깨끗한 목록으로 취급하지 않고 `status_unavailable`로 거절합니다. React Native에서 폐기 확인이 필요하면 `DecompressionStream` 폴리필을 넣으세요. 두 전역을 모두 삭제한 상태로 전체 흐름을 실행하는 테스트가 있으므로, 이 설명은 추측이 아니라 확인된 사실입니다.

### 무언가를 검증하기

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### 한 바퀴 전체

세 당사자, 세 번의 호출. 발급자가 한 번 서명하고, 소지자가 오갈 내용을 좁히고, 검증자가 판단합니다.

```ts
import { issue, present, verify } from 'qredential'

// 1. 발급자가, 면허를 내줄 때 한 번.
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

// 2. 소지자의 지갑이, 스캔하는 자리에서. 성년 여부만 보이고 생년월일은 남겨 둡니다.
const presentation = await present(credential, { disclose: ['over_18'] })

// 3. 검증자가, 오프라인으로.
const result = await verify(presentation, { trust })
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined, 지갑을 떠난 적이 없습니다
```

<!-- section: disclosure -->

## 선택적 공개

서로 다른 두 당사자가 서로 다른 두 가지를 결정하며, 이 둘을 뒤섞는 것이 흔한 설계 실수입니다. **발급자**는 서명 시점에 `disclose`로 어떤 클레임을 숨길 *수 있는지*를 정합니다. **소지자**는 그중 실제로 무엇을 보일지를 스캔 시점에, 역시 `disclose`로 정합니다. 발급자가 표시하지 않은 클레임은 누구도 숨길 수 없습니다.

원리는 평범한 해시입니다. 공개 가능한 각 클레임은 128비트 무작위 솔트와 함께 직렬화되고, 그 문자열의 다이제스트만 자격증명에 서명됩니다. 클레임을 드러낸다는 것은 원래 문자열을 보내 검증자가 해시해 다이제스트를 찾게 한다는 뜻입니다. 숨긴다는 것은 검증자에게 결코 열 수 없는 다이제스트만 남긴다는 뜻입니다.

### 중첩, 배열, 재귀 공개

RFC 9901은 셋 다 허용하고, 유럽 지갑 생태계는 셋 다 씁니다. 여기의 검증은 7.1절의 처리 모델을 따라 어떤 깊이에서든 이를 해석합니다.

- 중첩된 객체 안의 `_sd` 배열은 그 객체의 속성을 숨깁니다.
- `{"...": digest}` 모양의 배열 원소는 그 원소 자체를 숨깁니다. 숨겨진 원소는 자리표시자로 남지 않고 배열에서 *제거되므로*, 받는 쪽은 그대로 표시할 수 있는 깨끗한 값을 얻습니다.
- 공개된 값이 다시 둘 중 어느 형태든 품을 수 있으므로, 하나를 풀면 더 드러납니다.

그 어느 것도 `claims`로 새지 않습니다. `_sd` 키도 `"..."` 원소도 호출자에게 닿지 않습니다. 공개된 이름은 `address.locality`처럼 경로로 돌아오며, 전체가 같은 RFC의 독립 구현과 양방향으로 대조되어 있습니다.

> **연령 확인에서 이것이 중요한 이유.** 흔한 구현은 손님이 신분증 사진을 제3자에게 올리게 합니다. 이는 터질 날만 기다리는 유출입니다. 여기서 술집은 불리언 하나를 알 뿐이고, 원해도 생년월일은 알 수 없습니다. 이 성질은 암호학적인 것이지 개인정보 처리방침 속 약속이 아닙니다.

발급자가 공개 가능으로 지정하지 않은 클레임을 요구하면, 요청보다 적게 조용히 돌려주는 대신 예외를 던집니다.

<!-- section: holder -->

## 소지자를 증명하기

선택적 공개가 증명하는 것은 발급자가 그 클레임들에 서명했다는 사실입니다. 그것만으로는 제시하는 사람이 본인이라는 증명이 되지 않으며, 이 틈은 이론상의 이야기가 아닙니다. 남의 코드를 찍은 사진도 같은 서명을 지니고 똑같이 검증을 통과합니다.

키 바인딩이 그 틈을 메웁니다. 발급자가 소지자의 공개키를 자격증명에 적어 넣고, 스캔하는 자리에서 소지자의 지갑이 대응하는 개인키로 새 챌린지에 서명합니다. 사진은 그렇게 할 수 없습니다.

### 세 단계

```ts
// 1. 발급자가 소지자의 공개키를 묶습니다.
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. 지갑이, 스캔하는 자리에서, 이 검증자의 챌린지에 서명합니다.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. 검증자가 그 증명이 자기 챌린지에 답하는지 확인합니다.
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

증명은 네 가지에 스스로를 묶으며, 각각이 특정 공격을 막습니다. **nonce**는 녹화된 제시의 재생을 막고, **audience**는 한 검증자를 위해 만든 증명을 다른 검증자에게 쓰는 것을 막고, **서명**은 발급자가 묶은 키에 묶어 주며, `sd_hash`는 제시된 공개 집합을 정확히 덮어서 중계자가 소지자의 서명 이후에 공개를 더하거나 뺄 수 없게 합니다. 증명은 만료되기도 하며, 기본 5분이고 `maxKeyBindingAge`로 조정합니다.

### 정적 자격증명, 그리고 그 선택을 소리 내어 해야 하는 이유

카드에 인쇄된 코드는 이 중 아무것도 할 수 없습니다. 스캔하는 자리에서 서명할 기기가 없으므로 정적 자격증명은 본질적으로 복제 가능합니다. 이는 실수가 아니라 현실에서 흔한 상황입니다. 다만 검증자가 알고서 내려야 할 결정입니다.

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false, 어느 쪽을 고르든 그렇게 표시됩니다
```

이 옵션이 없으면 증명 없는 제시는 `holder_proof_missing`으로 거절됩니다. 기본값을 엄격한 쪽으로 둔 것은 의도입니다. 위험한 경우는 출입문 스캐너를 만드는 사람이 키 바인딩이라는 것을 들어 본 적도 없이, 스크린숏 한 장에 무너지는 물건을 내보내는 상황입니다. 문제를 이름 붙여 요란하게 실패하는 편이, 그것을 감추는 조용한 기본값보다 낫습니다.

> **받아들이기로 선택해도 망가진 증명을 통과시키지는 않습니다.** `acceptWithoutHolderProof`가 덮는 경우는 증명이 아예 제시되지 않은 상황입니다. 증명이 있는데 실패했다면, 이 옵션과 무관하게 자격증명은 거절됩니다.

### 비용

묶는 일은 QR 관점에서 공짜가 아닙니다. 소지자의 공개키가 자격증명 안에 자리를 차지하고, 증명은 제시에 따라붙습니다.

| 제시 | 문자 수 | QR 버전 |
|---|---|---|
| 정적, 전부 공개 | ~740 | 18, 잘 읽힙니다 |
| 연령만, 묶였으나 증명 없음 | ~1320 | 24, 빽빽함 |
| 연령만, 소지자 증명 포함 | ~1605 | 27, 너무 빽빽함 |

증명 자체는 약 285자입니다. 보이는 것만큼 문제는 아닙니다. 키 바인딩이 가능한 자격증명은 정의상 화면에 표시되고 있고, 거기서는 코드를 크고 밝게 띄울 수 있기 때문입니다. 밀도의 한계가 문제인 쪽은 닳은 인쇄 카드이고, 인쇄 카드는 어차피 키 바인딩을 할 수 없었습니다.

<!-- section: size -->

## 크기 예산

QR 코드는 가장 큰 버전에서도 영숫자 약 4300자를 담습니다. 그러나 그 정도 크기의 코드는 긁힌 카드나 깨진 화면에서는 읽히지 않습니다. 실용적인 상한은 버전 20 언저리입니다.

현실적인 운전면허증이 드는 비용은 이렇습니다. 클레임 여덟 개, 5년 만료, 상태 목록 포인터. 저장소의 `examples/sizes.mjs`로 측정했습니다.

| 자격증명 | 문자 수 | QR 버전 |
|---|---|---|
| 전부 공개 | ~740 | 18, 잘 읽힘 |
| 여덟 클레임 모두 공개 가능 | ~1590 | 27, 너무 빽빽함 |
| `over_18`만 제시 | ~1115 | 22, 여전히 빽빽함 |

불편한 쪽은 가운데 줄이고, 카드를 찍어 낸 뒤보다 여기서 아는 편이 낫습니다. 선택적 공개는 자격증명을 거의 두 배로 만듭니다. 공개 가능한 클레임마다 솔트와 서명된 다이제스트가 들고, **다이제스트는 소지자가 그 클레임을 드러내든 말든 페이로드에 남기** 때문입니다. 이는 의도된 것입니다. 드러낸 만큼 다이제스트 개수가 줄어든다면 무엇을 숨겼는지가 새어 나갑니다. 실질적인 결과로, 제시 시점의 절약은 직관이 약속하는 것보다 작습니다. 여기서는 30퍼센트이지 80퍼센트가 아닙니다.

그러니 검증자가 단독으로 볼 필요가 정말 있을 법한 클레임만 공개 가능으로 두세요. 전부가 아니라 두세 개. `fits()`가 결정하기 전에 현재 위치를 알려 줍니다.

> **base45에 대하여.** 통념은 작기 때문에 골랐다고 말합니다. 아닙니다. QR 영숫자 모드의 base45는 원본 1바이트당 약 8.25비트가 들고, 바이트 모드의 base64는 10.67비트, 날바이너리는 정확히 8비트입니다. base64는 확실히 이기고 날바이트에는 근소하게 집니다. 날바이트를 일부러 포기한 이유는, 바이트 모드가 문자 집합의 모호함을 끌고 다니며 많은 리더가 깨진 문자열을 돌려주기 때문입니다. 복사되고 붙여넣어지고 로그에 남아도 살아남는 자격증명이라면 3퍼센트의 대가는 값합니다.

<!-- section: revocation -->

## 오프라인 폐기 확인

폐기 확인은 구현들이 건너뛰는 부분이고, 건너뛰면 훔친 자격증명이 영원히 통합니다.

상태 목록은 자격증명 하나당 1비트인 압축된 비트열입니다. 백만 건을 덮는 목록은 거의 전부 0인 125KB이고, 압축하면 몇 킬로바이트가 됩니다. 신호가 있을 때 받아 두고, 없을 때 대조하세요.

```ts
// 발급자는 자기 사정에 맞는 주기로 이것을 공개합니다.
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// 검증자는 캐시해 둔 사본과 대조합니다.
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

거절 사유는 읽어 둘 값어치가 있습니다. 하나하나가, 더 말수 적은 라이브러리라면 거짓 예를 돌려줬을 지점이기 때문입니다.

- 목록을 넘기지 않았으므로 폐기 여부를 확인한 적이 없음: `status_unavailable`
- 캐시한 목록이 `maxStatusAge`보다 오래되어 폐기를 배제할 수 없음: `status_list_stale`
- 목록이 신뢰 목록에 없는 키로 서명되어 있음. 공격자가 폐기된 자격증명을 세탁한다면 바로 이 수법: `bad_signature`
- 목록의 발급자가 자격증명의 발급자와 다르거나 `uri`가 다름. 같은 인덱스라도 목록마다 뜻이 다르므로, 묶이지 않은 목록은 답이 아님: `status_unavailable`
- 자격증명의 인덱스가 캐시한 목록 바깥에 있음. 즉 실제로는 아무것도 읽지 못함: `status_unavailable`

> **깨끗한 결과가 이 점에서 침묵하는 일은 없습니다.** 폐기 여부를 실제로 확인했다면 결과에 `revocationChecked: true`가 들어갑니다. 라이브러리가 진짜 답에 이르지 못하면, 그 표시를 세운 채 자격증명을 통과시키지 않고 거절합니다. 거짓 보증은 답이 없는 것보다 나쁘기 때문입니다.

확신할 수 없을 때 무엇을 할지는 라이브러리가 아니라 당신 배포의 정책 문제이므로, `qredential`은 그것을 조용히 대신 정하기를 거부합니다. 폐기 여부를 확인했다면, 성공한 결과가 `revocationChecked: true`로 그렇게 말해 줍니다.

<!-- section: trust -->

## 신뢰 목록

경로 밖으로 기기에 닿아야 하는 유일한 것은, 당신이 믿기로 한 발급자 공개키의 집합입니다. 이것은 좀처럼 바뀌지 않으므로, 앱에 함께 실어 보내고 주 1회 갱신하는 방식은 아주 합리적인 배포 전략입니다.

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

어떤 알고리즘을 쓸지 정하는 것은 신뢰된 키이지, 자격증명 자신의 헤더에 적힌 알고리즘이 결코 아닙니다. 이것이 알고리즘 바꿔치기에 대한 방어의 전부이며, `alg`가 추론되지 않고 신뢰 목록의 키 쪽에 놓여 있는 이유입니다.

목록이 기기에 어떻게 닿는지, 키를 어떻게 교체하는지, 개인키가 어디에 있는지는 범위 밖입니다. 라이브러리는 그것들을 입력으로 받을 뿐입니다.

<!-- section: api -->

## API 참조

네 개의 함수가 자격증명의 생애를 덮고, 폐기를 공개하는 발급자를 위해 하나가 더 있습니다.

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| 옵션 | 타입 | 의미 |
|---|---|---|
| `issuer` | `string` | 검증자의 신뢰 목록에 있는 키와 반드시 일치해야 하는 식별자. |
| `key` | `Jwk` | 개인키. 이 호출 밖으로 나가지 않습니다. |
| `kid` | `string` | 키 식별자. 헤더에 적혀, 키 교체 중에도 검증자가 맞는 키를 고를 수 있게 합니다. |
| `alg` | `'ES256' \| 'EdDSA'` | 기본값 `ES256`. 모든 플랫폼이 지원합니다. |
| `claims` | `object` | 자격증명이 주장하는 내용. |
| `disclose` | `string[]` | 소지자가 숨길 수 있는 클레임 이름. 나머지는 항상 보입니다. 없는 이름을 적으면 예외를 던집니다. |
| `vct` | `string` | 자격증명 타입, SD-JWT VC의 `vct`. |
| `subject` | `string` | 선택적 주체 식별자. |
| `expiresIn` | `number \| string` | 초, 또는 `'1825d'` 같은 기간. |
| `notBefore` | `number \| string` | 같은 형식. 나중에 효력이 생기는 자격증명용. |
| `status` | `{ idx, uri }` | 상태 목록에서 이 자격증명의 자리. |
| `holderKey` | `Jwk` | 소지자의 **공개**키. `cnf`에 기록됩니다. 정적 자격증명일 때만 생략하세요. 개인 성분이 들어 있는 키는 거절됩니다. |

반환값은 `credential`(SD-JWT 결합 형식, 지갑에 보관할 것), `qr`(스캔 가능한 봉투), `bytes`(`qr`의 문자 수), `disclosable`(소지자가 숨길 수 있는 클레임 이름)입니다.

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

자격증명을 나열된 클레임으로 좁히고 스캔 가능한 봉투를 돌려줍니다. 서명된 JWT는 결코 손대지 않으므로, 남은 내용에 대해 발급자의 서명은 여전히 유효합니다. 결합 형식과 봉투 둘 다 받습니다. 발급자가 공개 가능으로 만들지 않은 클레임을 요구하면 예외를 던집니다.

`disclose`는 경로를 받습니다. `verify()`가 `disclosed`로 돌려주는 것과 같은 형태입니다.

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

이름만 쓰면 한 구간짜리 경로이므로 `'over_18'`은 늘 그랬던 의미 그대로입니다. **배열 인덱스는 발급 당시 자격증명에서의 위치**이지 제시본에서의 위치가 아니므로, 소지자가 다른 무엇을 숨기든 선택자는 적힌 의미를 유지합니다. 그리고 중첩된 공개는 그것을 담고 있는 공개 없이는 정당하게 오갈 수 없으므로, `address.locality`를 요청하면 `address`도 함께 보냅니다. 호출자에게 떠넘기지 않고 여기서 처리합니다.

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| 옵션 | 타입 | 의미 |
|---|---|---|
| `trust` | `TrustList` | 필수. 믿기로 한 발급자와 키. |
| `status` | `string` | 캐시된 상태 목록 토큰. 없으면 목록을 가리키는 자격증명은 통과시킬 수 없습니다. |
| `maxStatusAge` | `number \| string` | 이보다 오래된 목록으로는 답하기를 거부합니다. |
| `clockSkew` | `number` | 발급자와 검증자 사이 시계 오차 허용 초. 기본 60. |
| `nonce` | `string` | 이 검증자가 이 스캔을 위해 발행한 챌린지. 소지자 증명을 받으려면 필수. |
| `audience` | `string` | 이 검증자의 식별자. 증명의 `aud`와 대조합니다. |
| `acceptWithoutHolderProof` | `boolean` | 증명 없는 제시를 받아들입니다. 정적 자격증명에 필요하며, 존재하면서 망가진 증명을 통과시키는 일은 결코 없습니다. |
| `maxKeyBindingAge` | `number \| string` | 소지자 증명이 얼마나 오래되어도 되는지. 기본 5분. |
| `now` | `number` | 현재 시각을 덮어씁니다. 테스트와 재생 분석용. |

적대적 입력에 대해 예외를 던지지 않습니다. 판별 가능한 합 타입을 돌려줍니다. 성공은 `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`, 실패는 `{ ok: false, reason, message }`이며 `reason`은 아래 표에서 옵니다.

`withheld`는 오가지 않은 공개 가능 클레임의 개수입니다. 정책 판단에는 쓸모가 있지만, 구조상 그것이 무엇이었는지는 알려 줄 수 없습니다.

**`claims` 안의 모든 것은 주체를 서술합니다.** `iss`, `iat`, `exp`, `status`처럼 토큰 자체를 서술하는 등록된 클레임은 대신 타입이 붙은 필드로 드러나며, 그중 하나를 설정하려 들거나 페이로드가 이미 정한 클레임을 덮어쓰려는 공개는 자격증명 전체를 실패시킵니다. 따라서 `claims`를 그대로 순회해도 안전합니다.

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

동기 함수. `{ chars, version, capacity, comfortable, errorCorrection, advice }`를 돌려줍니다. 오류 정정 기본값이 `M`인 이유는, `L`이 종이 위에서는 넉넉해 보이다가 닳은 인쇄 카드에서 실패하기 때문입니다. 어떤 버전에도 담기지 않으면 `version`은 `null`이고, `advice`는 빌드 로그에 그대로 찍어도 되는 한 문장입니다.

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

발급자용. `issuer`, `key`, `kid`, `alg`, `uri`, `size`, `revoked`, `suspended`, `expiresIn`, `issuedAt`을 받아 서명된 상태 목록 토큰을 돌려줍니다. 목록 바깥의 인덱스는 이웃 자격증명의 비트를 망가뜨리는 대신 예외를 던집니다.

### 함께 내보내는 것들

QR 봉투용 `pack`, `unpack`, `isEnvelope`, 그리고 코덱 단독의 `encodeBase45`와 `decodeBase45`. 도구를 만들 때 쓸모 있고, 보통의 사용에는 필요 없습니다.

<!-- section: errors -->

## 오류 처리

약속은 정확히 두 개이고, 그 구분은 우연이 아니라 의도입니다. 이 두 문장만 익히면 catch 블록 하나를 쓰면서 거기에 무엇이 떨어질 수 있는지 알 수 있습니다.

```sig
1. verify()는 결코 예외를 던지지 않는다. 어떤 입력에도.
2. 그 밖의 모든 것은 QredentialError만 던진다.
```

둘이 다른 이유는 이렇습니다. `verify()`는 적대적 입력을 향하라고 있는 함수이고, 예외를 던지는 검증기는 누군가 `try/catch`로 감싸 사람을 그냥 들여보내게 되는 검증기입니다. 그래서 반드시 들여다봐야 하는 결과를 돌려줍니다. 나머지는 호출자가 코드에서 고칠 수 있는 조건에서 실패하며, 거기서는 던지는 것이 올바른 모양입니다.

두 규칙 모두, 무작위 문자열과 망가진 키와 손상된 봉투와 적대적 옵션을 만들어 내어 그 밖에는 아무것도 새어 나가지 않음을 주장하는 속성 기반 테스트가 떠받칩니다. JSON 파싱에서 나온 `SyntaxError`도, WebCrypto의 `DOMException`도, 할당에서 나온 `RangeError`도 없습니다.

### 검증 결과 다루기

결과는 판별 가능한 합 타입이므로 TypeScript가 알아서 좁혀 줍니다.

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // 좁혀짐: 주체의 속성들
  result.withheld        // 오가지 않은 공개 가능 클레임의 수
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

코드베이스가 `try/catch` 중심으로 짜여 있다면 같은 결과를 `assertVerified()`에 통과시키세요. 잃는 것은 없습니다. 던져지는 오류가 원래 사유를 그대로 지니고 갑니다.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // 위와 같은 FailReason
  } else {
    throw error
  }
}
```

### 거절 사유

`verify()`가 `result.reason`으로 돌려줍니다. 플레이그라운드가 이들을 하나씩 검증기에 던져 보여 줍니다.

| 사유 | 무슨 일이 있었나 |
|---|---|
| `malformed` | 애초에 자격증명이 아니거나, 봉투가 손상되었거나, 결합 형식에 끝 구분자가 없음. |
| `unknown_issuer` | `iss` 클레임이 신뢰 목록에 없음. |
| `unknown_key` | 발급자는 신뢰되지만 그 `kid`를 가진 키가 없음. |
| `unsupported_alg` | 헤더가 신뢰된 키가 쓰지 않는 알고리즘을 요구함. |
| `bad_signature` | 서명이 맞지 않음. 위조된 상태 목록도 포함. |
| `expired` | 시계 오차 허용을 넘겨 `exp`를 지남. |
| `not_yet_valid` | `nbf` 이전. |
| `digest_mismatch` | 발급자가 서명한 적 없는 공개, 두 번 보낸 공개, 등록된 클레임 이름을 쓰는 공개, 또는 이미 페이로드에 있는 클레임과 충돌하는 공개. |
| `revoked` | 발급자가 이 자격증명의 비트를 세움. 정지도 포함. |
| `status_unavailable` | 폐기 여부를 판정할 수 없었음. 목록 미제공, 읽을 수 없음, 다른 발급자나 다른 uri에 묶임, 또는 인덱스가 범위 밖. |
| `status_list_stale` | 캐시한 목록이 `maxStatusAge`보다 오래됨. |
| `holder_proof_missing` | 소지자 증명이 제시되지 않았고 호출자가 `acceptWithoutHolderProof`를 넘기지 않음. |
| `holder_proof_invalid` | 증명이 제시되었으나 실패함. 키가 다름, nonce가 다름, audience가 다름, 공개 집합이 다름, 오래됨, 또는 묶인 키가 없는 자격증명에 붙어 있음. |

### 던져지는 오류

`verify()`를 뺀 모든 것은 `code`를 지닌 `QredentialError`를 던집니다. `instanceof` 대신 `isQredentialError()`를 쓰세요. 모양을 보기 때문에, 한 의존성 트리에 패키지 사본이 두 개 들어가도 계속 동작합니다. 그것이 `instanceof`가 조용히 안 맞게 되는 흔한 이유입니다.

| 코드 | 던지는 곳 | 무슨 일이 있었나 |
|---|---|---|
| `invalid_option` | `issue`, `createStatusList` | API가 쓸 수 없는 인자. 알 수 없는 클레임 이름, 잘못된 기간, 목록 밖의 상태 인덱스. |
| `not_disclosable` | `present` | 발급자가 공개 가능으로 만들지 않은 클레임을 드러내려 함. |
| `malformed_credential` | `present` | SD-JWT 결합 형식이 망가짐. |
| `malformed_envelope` | `unpack`, `present` | QR 봉투가 망가짐. 아래층 코덱 오류는 `cause`를 보세요. |
| `malformed_status_list` | 상태 목록 읽기 | 토큰이 읽을 수 있는 상태 목록이 아님. |
| `invalid_encoding` | `decodeBase45` | base45나 base64url이어야 할 문자열이 그렇지 않거나, 한 조각이 JSON이 아님. |
| `unsupported_alg` | `issue` | 이 버전이 구현하지 않은 알고리즘. |
| `unsupported_runtime` | `unpack` | 옛 React Native의 `DecompressionStream`처럼, 플랫폼에 필요한 것이 없음. |
| `crypto_failure` | `issue`, `createStatusList` | WebCrypto가 키나 연산을 거부함. 원래 `DOMException`은 `cause`에 있습니다. |
| `verification_failed` | `assertVerified` | 그 도우미에서만. 원래 `reason`을 지니고 갑니다. |

### 아래에 있는 것 읽기

이 라이브러리가 남의 실패를 감싸는 곳에서는 원본을 표준 `cause` 속성에 남깁니다. 구체적인 코드를 얻는 대가로 세부를 잃는 일은 없습니다.

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // base45 디코더에서 온 invalid_encoding 오류
  }
}
```

> **코드는 API이고 메시지는 아닙니다.** 모든 `code`와 `reason` 값은 시맨틱 버저닝의 대상입니다. 값이 다른 뜻으로 재사용되는 일은 없고, 새 값은 마이너 버전에서만 늘어납니다. 메시지 문구는 패치에서 바뀔 수 있으니, 코드로 분기하고 메시지는 보여 주기만 하세요. 저장소의 테스트가 코드 전체 집합을 고정하므로, 하나를 더하거나 빼는 일은 부작용이 아니라 의도된 행위여야 합니다.

<!-- section: limits -->

## 이것이 아닌 것

- **지갑이 아닙니다.** 화면도 저장소도 없습니다.
- **키 관리가 아닙니다.** 키도, 신뢰 목록의 배포도 직접 가져오셔야 합니다.
- **아직 ISO 18013-5 mDL이 아닙니다.** 그쪽은 JWT가 아니라 CBOR과 COSE입니다. 예정에는 있으며, 적합성 표준의 절반을 했다고 주장하는 것은 아무것도 주장하지 않는 것보다 나쁩니다.
- **감사받지 않았습니다.** 공개된 표준을 구현하고 플레이그라운드의 공격들에 대해 시험하지만, 테스트가 보일 수 있는 것은 방어의 존재이지 그 완전성이 아닙니다.

소스는 런타임 의존성 없이 약 700줄입니다. 믿기 전에 읽는 일이 현실적이도록 일부러 그렇게 두었습니다. 취약점은 GitHub의 Security 탭을 통해 알려 주시고, 범위와 응답 기한은 [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md)에 있습니다.
