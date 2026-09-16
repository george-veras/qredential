<!-- translated-from: d202bc3a6200f01e -->
<!-- section: top -->

<!-- eyebrow -->
_Dokumentation_

# Nachweise, die sich ohne Netz prüfen lassen

<!-- lede -->
Ein QR-Code trägt seinen eigenen Beweis. `qredential` prüft Signatur, Ablauf, Sperrstatus und Claims, ohne dass eine einzige Anfrage das Gerät verlässt.

<!-- cta --> [Playground öffnen](../../playground/)

<!-- cta --> [Quellcode lesen](https://github.com/george-veras/qredential)

<!-- section: start -->

## Erste Schritte

```ts
npm i qredential
```

Node 20 oder neuer, jeder aktuelle Browser und React Native. Die Bibliothek nutzt WebCrypto und nichts Node-Spezifisches, denn das prüfende Gerät ist meistens ein Telefon. Es gibt keine Laufzeitabhängigkeiten.

Die vollständige Testsuite läuft bei jedem Commit auf Node 20, 22 und 24 unter Linux, macOS und Windows sowie in Chromium, Firefox und WebKit. Ed25519 wird in allen vieren ausgeübt.

> **Ein Vorbehalt zu React Native.** Dort gibt es kein `CompressionStream`, und Ausstellen, Vorzeigen und Prüfen funktionieren auch ohne: der Umschlag bleibt schlicht unkomprimiert, was Größe kostet und sonst nichts. *Sperrprüfung offline funktioniert nicht*, denn eine Statusliste zu lesen heißt, eine Bitfolge zu entpacken. Ein Prüfer, der die zwischengespeicherte Liste nicht entpacken kann, lehnt mit `status_unavailable` ab, statt eine unlesbare Liste als saubere zu behandeln. Wer Sperrprüfung auf React Native braucht, ergänzt ein Polyfill für `DecompressionStream`. Ein Test führt den gesamten Ablauf mit beiden gelöschten Globals aus, diese Beschreibung ist also geprüft und nicht vermutet.

### Etwas prüfen

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### Der ganze Umlauf

Drei Beteiligte, drei Aufrufe. Der Aussteller signiert einmal, der Inhaber verengt, was mitreist, der Prüfer entscheidet.

```ts
import { issue, present, verify } from 'qredential'

// 1. Der Aussteller, einmalig, bei Erteilung der Fahrerlaubnis.
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

// 2. Die Wallet des Inhabers, beim Scannen. Zeigt die Volljährigkeit, behält das Datum.
const presentation = await present(credential, { disclose: ['over_18'] })

// 3. Der Prüfer, offline.
const result = await verify(presentation, { trust })
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined, und es hat die Wallet nie verlassen
```

<!-- section: disclosure -->

## Selektive Offenlegung

Zwei verschiedene Beteiligte treffen zwei verschiedene Entscheidungen, und sie zu vermischen ist der übliche Entwurfsfehler. Der **Aussteller** legt beim Signieren mit `disclose` fest, welche Claims zurückgehalten werden *dürfen*. Der **Inhaber** entscheidet danach beim Scannen, ebenfalls mit `disclose`, welche davon er tatsächlich zeigt. Einen Claim, den der Aussteller nie markiert hat, kann niemand zurückhalten.

Der Mechanismus ist gewöhnliches Hashen. Jeder offenlegbare Claim wird mit einem zufälligen 128-Bit-Salt serialisiert, und nur der Digest dieser Zeichenkette wird in den Nachweis signiert. Einen Claim zu zeigen heißt, die ursprüngliche Zeichenkette mitzuschicken, damit der Prüfer sie hashen und den Digest finden kann. Ihn zurückzuhalten heißt, den Prüfer mit einem Digest sitzen zu lassen, den er nie öffnen kann.

### Verschachtelte, Array- und rekursive Offenlegung

RFC 9901 erlaubt alle drei, und das europäische Wallet-Ökosystem nutzt alle drei. Die Prüfung löst sie hier in beliebiger Tiefe auf, gemäß dem Verarbeitungsmodell aus Abschnitt 7.1:

- Ein `_sd`-Array in einem verschachtelten Objekt verbirgt Eigenschaften dieses Objekts.
- Ein Array-Element der Form `{"...": digest}` verbirgt das Element selbst. Ein zurückgehaltenes Element wird aus dem Array *entfernt* statt als Platzhalter stehen zu bleiben, sodass Sie einen sauberen, darstellbaren Wert erhalten.
- Ein offengelegter Wert kann selbst wieder eine der beiden Formen enthalten, das Auflösen des einen bringt also weitere zum Vorschein.

Nichts davon sickert nach `claims` durch: kein `_sd`-Schlüssel und kein `"..."`-Element erreicht den Aufrufer. Offengelegte Namen kommen als Pfade zurück, etwa `address.locality`, und das Ganze wird in beide Richtungen gegen eine unabhängige Implementierung derselben RFC geprüft.

> **Warum das bei Altersprüfungen zählt.** Die übliche Umsetzung lässt Kundschaft ein Foto des Ausweises bei Dritten hochladen, was ein Datenleck erzeugt, das nur noch auf seinen Tag wartet. Hier erfährt die Bar einen Wahrheitswert und kann das Geburtsdatum nicht erfahren, selbst wenn sie wollte. Diese Eigenschaft ist kryptografisch, kein Versprechen in einer Datenschutzerklärung.

Nach einem Claim zu fragen, den der Aussteller nicht offenlegbar gemacht hat, wirft eine Ausnahme, statt stillschweigend weniger zurückzugeben als verlangt.

<!-- section: holder -->

## Den Inhaber beweisen

Selektive Offenlegung beweist, dass der Aussteller diese Claims signiert hat. Für sich genommen beweist sie nicht, dass die vorzeigende Person auch die betroffene ist, und die Lücke ist nicht theoretisch: das Foto vom Code einer anderen Person trägt dieselbe Signatur und prüft sich genauso erfolgreich.

Key Binding schließt sie. Der Aussteller schreibt den öffentlichen Schlüssel des Inhabers in den Nachweis, und beim Scannen signiert dessen Wallet eine frische Aufforderung mit dem passenden privaten Schlüssel. Ein Foto kann das nicht.

### Die drei Schritte

```ts
// 1. Der Aussteller bindet den öffentlichen Schlüssel des Inhabers ein.
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. Die Wallet signiert die Aufforderung dieses Prüfers, beim Scannen.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. Der Prüfer kontrolliert, dass der Beweis seine eigene Aufforderung beantwortet.
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

Der Beweis legt sich auf vier Dinge fest, und jedes schließt einen bestimmten Angriff: die **Nonce** verhindert, dass eine aufgezeichnete Vorlage erneut abgespielt wird, die **Audience** verhindert, dass ein für einen Prüfer erstellter Beweis bei einem anderen benutzt wird, die **Signatur** bindet ihn an den vom Aussteller hinterlegten Schlüssel, und `sd_hash` deckt genau die vorgelegte Menge an Offenlegungen ab, sodass eine Zwischenstation nach der Unterschrift des Inhabers keine hinzufügen oder entfernen kann. Er verfällt außerdem, standardmäßig nach fünf Minuten, einstellbar über `maxKeyBindingAge`.

### Statische Nachweise, und warum die Entscheidung laut ausgesprochen Ihre ist

Ein auf eine Karte gedruckter Code kann nichts davon. Es gibt kein Gerät, das beim Scannen signiert, also ist ein statischer Nachweis von Natur aus kopierbar. Das ist eine reale und häufige Lage, kein Fehler, aber es ist eine Entscheidung, die ein Prüfer wissentlich treffen sollte:

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false, und das steht da, wie Sie sich auch entscheiden
```

Ohne diese Option wird eine Vorlage ohne Beweis mit `holder_proof_missing` abgelehnt. Der Standard ist absichtlich der strenge: gefährlich ist der Fall, in dem jemand einen Türscanner baut, nie von Key Binding gehört hat und etwas ausliefert, das ein Bildschirmfoto aushebelt. Ein lautes Scheitern, das das Problem benennt, ist mehr wert als ein stiller Standard, der es verbirgt.

> **Bewusst zu akzeptieren winkt niemals einen kaputten Beweis durch.** `acceptWithoutHolderProof` deckt den Fall ab, dass gar kein Beweis vorgelegt wurde. Liegt einer vor und scheitert, wird der Nachweis unabhängig von der Option abgelehnt.

### Was es kostet

Binden ist in QR-Maßstäben nicht umsonst. Der öffentliche Schlüssel des Inhabers lebt im Nachweis, und der Beweis reist mit der Vorlage mit:

| Vorlage | Zeichen | QR-Version |
|---|---|---|
| statisch, alles sichtbar | ~740 | 18, scannt gut |
| nur Volljährigkeit, gebunden aber unbewiesen | ~1320 | 24, dicht |
| nur Volljährigkeit, mit Inhaberbeweis | ~1605 | 27, zu dicht |

Der Beweis selbst umfasst etwa 285 Zeichen. Das zählt weniger, als es aussieht, denn ein Nachweis, der Key Binding beherrscht, wird per Definition auf einem Bildschirm gezeigt, wo der Code groß und hell sein kann. Die Dichtegrenze ist ein Problem für abgenutzte gedruckte Karten, und eine gedruckte Karte hätte Key Binding ohnehin nie geschafft.

<!-- section: size -->

## Das Größenbudget

Ein QR-Code fasst in seiner größten Fassung rund 4300 alphanumerische Zeichen, aber ein so großer Code ist auf einer zerkratzten Karte oder einem gesprungenen Display unlesbar. Die praktische Obergrenze liegt bei etwa Version 20.

So viel kostet ein realistischer Führerschein. Acht Claims, fünf Jahre Gültigkeit, ein Zeiger auf eine Statusliste, gemessen mit `examples/sizes.mjs` im Repository:

| Nachweis | Zeichen | QR-Version |
|---|---|---|
| alles sichtbar | ~740 | 18, scannt gut |
| alle acht Claims offenlegbar | ~1590 | 27, zu dicht |
| nur `over_18` vorgelegt | ~1115 | 22, immer noch dicht |

Die mittlere Zeile ist die unangenehme, und man lernt sie besser hier als nach dem Druck der Karten. Selektive Offenlegung verdoppelt den Nachweis beinahe, denn jeder offenlegbare Claim kostet ein Salt plus einen signierten Digest, und **die Digests bleiben in der Nutzlast, ob der Inhaber den Claim zeigt oder nicht**. Das ist Absicht: eine Digest-Anzahl, die mit dem Gezeigten schrumpft, würde verraten, was Sie zurückgehalten haben. Praktisch heißt das, die Ersparnis beim Vorzeigen ist kleiner, als die Intuition verspricht. Dreißig Prozent hier, nicht achtzig.

Machen Sie also nur die Claims offenlegbar, die ein Prüfer wirklich einzeln sehen könnte. Zwei oder drei, nicht alle. `fits()` sagt Ihnen vorher, wo Sie stehen.

> **Zu base45.** Das Küchenwissen sagt, es werde wegen der Kompaktheit gewählt. Wird es nicht. base45 im alphanumerischen QR-Modus kostet etwa 8,25 Bit je Ursprungsbyte, gegenüber 10,67 für base64 im Byte-Modus und glatt 8 für rohes Binär. Es schlägt base64 deutlich und verliert knapp gegen rohe Bytes. Rohe Bytes werden absichtlich aufgegeben, weil der Byte-Modus Zeichensatz-Mehrdeutigkeit mitschleppt und viele Lesegeräte eine verstümmelte Zeichenkette zurückgeben. Ein Nachweis, der Kopieren, Einfügen und Protokollieren übersteht, ist drei Prozent Aufschlag wert.

<!-- section: revocation -->

## Sperrprüfung offline

Die Sperrprüfung ist der Teil, den Implementierungen auslassen, und dann funktioniert ein gestohlener Nachweis für immer.

Eine Statusliste ist eine komprimierte Bitfolge mit einem Bit je Nachweis. Eine Liste für eine Million Nachweise sind 125 KB fast nur aus Nullen, die auf wenige Kilobyte schrumpfen. Holen Sie sie, wenn Sie Empfang haben, prüfen Sie sie, wenn nicht.

```ts
// Der Aussteller veröffentlicht dies in dem Takt, der ihm passt.
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// Der Prüfer kontrolliert gegen seine zwischengespeicherte Kopie.
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

Die Ablehnungen lohnen das Lesen, denn jede ist eine Stelle, an der eine stillere Bibliothek ein falsches Ja zurückgäbe:

- Sie haben keine Liste übergeben, die Sperrung wurde also nie geprüft: `status_unavailable`
- Ihre zwischengespeicherte Liste ist älter als `maxStatusAge`, eine Sperrung lässt sich also nicht ausschließen: `status_list_stale`
- Die Liste ist mit einem Schlüssel signiert, der nicht auf Ihrer Vertrauensliste steht, und genau so würde ein Angreifer einen gesperrten Nachweis reinwaschen: `bad_signature`
- Die Liste stammt von einem anderen Aussteller als der Nachweis, oder gilt für eine andere `uri`. Ein und derselbe Index bedeutet in jeder Liste etwas anderes, eine ungebundene Liste ist also keine Antwort: `status_unavailable`
- Der Index des Nachweises liegt außerhalb der Liste, die Sie zwischengespeichert haben, es wurde also tatsächlich nichts gelesen: `status_unavailable`

> **Ein sauberes Ergebnis schweigt darüber nie.** Wurde die Sperrung tatsächlich geprüft, sagt das Ergebnis `revocationChecked: true`. Kann die Bibliothek keine echte Antwort erreichen, lehnt sie ab, statt den Nachweis mit gesetzter Marke durchzulassen, denn eine falsche Zusicherung ist schlimmer als keine Antwort.

Was zu tun ist, wenn Sie sich nicht sicher sein können, ist eine Richtlinienfrage Ihres Einsatzes, nicht der Bibliothek, also weigert sich `qredential`, sie stillschweigend für Sie zu entscheiden. Wurde die Sperrung geprüft, sagt das erfolgreiche Ergebnis das mit `revocationChecked: true`.

<!-- section: trust -->

## Vertrauenslisten

Das Einzige, was auf anderem Weg auf das Gerät gelangen muss, ist die Menge der öffentlichen Ausstellerschlüssel, denen Sie zu glauben bereit sind. Sie ändert sich selten, sie mit der App auszuliefern und wöchentlich aufzufrischen ist also eine völlig vernünftige Verteilstrategie.

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

Der vertrauenswürdige Schlüssel entscheidet, welcher Algorithmus verwendet wird, niemals der im Header des Nachweises genannte. Das ist die gesamte Abwehr gegen Algorithmus-Unterschiebung, und deshalb steht `alg` am Schlüssel in Ihrer Vertrauensliste, statt hergeleitet zu werden.

Wie die Liste auf das Gerät kommt, wie Schlüssel rotieren und wo der private Schlüssel liegt, ist außerhalb des Rahmens. Die Bibliothek nimmt das als Eingabe entgegen.

<!-- section: api -->

## API-Referenz

Vier Funktionen decken den Lebenszyklus des Nachweises ab, dazu eine für Aussteller, die Sperrlisten veröffentlichen.

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| Option | Typ | Bedeutung |
|---|---|---|
| `issuer` | `string` | Kennung, die zu einem Schlüssel in der Vertrauensliste des Prüfers passen muss. |
| `key` | `Jwk` | Privater Schlüssel. Verlässt den Aufruf nie. |
| `kid` | `string` | Schlüsselkennung, in den Header geschrieben, damit Prüfer bei einer Rotation den richtigen Schlüssel wählen. |
| `alg` | `'ES256' \| 'EdDSA'` | Standard `ES256`, das jede Plattform unterstützt. |
| `claims` | `object` | Was der Nachweis behauptet. |
| `disclose` | `string[]` | Namen der Claims, die der Inhaber zurückhalten darf. Alles andere ist immer sichtbar. Ein nicht vorhandener Name wirft. |
| `vct` | `string` | Nachweistyp, das `vct` von SD-JWT VC. |
| `subject` | `string` | Optionale Kennung der betroffenen Person. |
| `expiresIn` | `number \| string` | Sekunden, oder eine Dauer wie `'1825d'`. |
| `notBefore` | `number \| string` | Dieselben Formen, für Nachweise, die später beginnen. |
| `status` | `{ idx, uri }` | Der Platz dieses Nachweises in einer Statusliste. |
| `holderKey` | `Jwk` | Der **öffentliche** Schlüssel des Inhabers, in `cnf` geschrieben. Nur bei statischen Nachweisen weglassen. Ein Schlüssel mit privatem Anteil wird abgelehnt. |

Liefert `credential` (die kombinierte SD-JWT-Form, diese gehört in die Wallet), `qr` (den scanbaren Umschlag), `bytes` (Zeichen in `qr`) und `disclosable` (die Claim-Namen, die der Inhaber zurückhalten kann).

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

Verengt einen Nachweis auf die aufgeführten Claims und liefert einen scanbaren Umschlag. Das signierte JWT wird nie angefasst, die Signatur des Ausstellers gilt also weiterhin für das, was übrig bleibt. Nimmt sowohl die kombinierte Form als auch einen Umschlag entgegen. Nach einem Claim zu fragen, den der Aussteller nicht offenlegbar gemacht hat, wirft.

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| Option | Typ | Bedeutung |
|---|---|---|
| `trust` | `TrustList` | Pflicht. Aussteller und Schlüssel, denen Sie zu glauben bereit sind. |
| `status` | `string` | Ein zwischengespeichertes Statuslisten-Token. Ohne es lässt sich ein Nachweis, der auf eine verweist, nicht freigeben. |
| `maxStatusAge` | `number \| string` | Die Antwort verweigern, wenn die Liste älter ist als dies. |
| `clockSkew` | `number` | Toleranz in Sekunden für Uhrendrift zwischen Aussteller und Prüfer. Standard 60. |
| `nonce` | `string` | Die Aufforderung, die dieser Prüfer für diesen Scan ausgegeben hat. Pflicht, um einen Inhaberbeweis anzunehmen. |
| `audience` | `string` | Die Kennung dieses Prüfers, gegen das `aud` des Beweises geprüft. |
| `acceptWithoutHolderProof` | `boolean` | Eine Vorlage ohne Beweis annehmen. Nötig für statische Nachweise, und winkt nie einen vorhandenen, kaputten Beweis durch. |
| `maxKeyBindingAge` | `number \| string` | Wie alt ein Inhaberbeweis sein darf. Standard 5 Minuten. |
| `now` | `number` | Die aktuelle Zeit überschreiben. Für Tests und Replay-Analyse. |

Wirft bei feindseliger Eingabe nie. Liefert eine unterschiedene Union: bei Erfolg `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`, bei Misserfolg `{ ok: false, reason, message }` mit `reason` aus der Tabelle weiter unten.

`withheld` zählt die offenlegbaren Claims, die nicht mitgereist sind. Das hilft bei Richtlinien, und konstruktionsbedingt kann es Ihnen nicht sagen, welche es waren.

**Alles in `claims` beschreibt die betroffene Person.** Registrierte Claims, die das Token beschreiben, etwa `iss`, `iat`, `exp` und `status`, erscheinen stattdessen als typisierte Felder, und eine Offenlegung, die eines davon setzen oder einen von der Nutzlast bereits festgelegten Claim überschreiben will, lässt den ganzen Nachweis scheitern. Über `claims` zu iterieren ist daher sicher.

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

Synchron. Liefert `{ chars, version, capacity, comfortable, errorCorrection, advice }`. Die Fehlerkorrektur ist standardmäßig `M`, weil `L` auf dem Papier großzügig wirkt und dann auf einer abgenutzten gedruckten Karte versagt. `version` ist `null`, wenn nichts die Nutzlast fasst, und `advice` ist ein Satz, den Sie direkt in ein Build-Log schreiben können.

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

Für Aussteller. Nimmt `issuer`, `key`, `kid`, `alg`, `uri`, `size`, `revoked`, `suspended`, `expiresIn` und `issuedAt` entgegen und liefert ein signiertes Statuslisten-Token. Ein Index außerhalb der Liste wirft, statt das Bit eines benachbarten Nachweises zu beschädigen.

### Ebenfalls exportiert

`pack`, `unpack` und `isEnvelope` für den QR-Umschlag sowie `encodeBase45` und `decodeBase45` für den Codec allein. Nützlich für Werkzeuge, im gewöhnlichen Gebrauch nicht nötig.

<!-- section: errors -->

## Fehlerbehandlung

Es gibt genau zwei Zusagen, und die Trennung ist absichtlich, nicht zufällig. Merken Sie sich diese zwei Sätze, und Sie können einen einzigen catch-Block schreiben und wissen, was darin landen kann.

```sig
1. verify() wirft nie. Bei jeder Eingabe.
2. Alles andere wirft ausschließlich QredentialError.
```

Der Grund für den Unterschied: `verify()` ist dafür da, auf feindselige Eingabe gerichtet zu werden, und ein Prüfer, der wirft, ist einer, den jemand in ein `try/catch` wickelt, das die Leute durchwinkt. Also liefert er ein Ergebnis, das Sie ansehen müssen. Alles andere scheitert an Bedingungen, die der Aufrufer im Code behebt, und dort ist Werfen die richtige Form.

Beide Regeln werden von eigenschaftsbasierten Tests gehalten, die zufällige Zeichenketten, fehlerhafte Schlüssel, beschädigte Umschläge und feindselige Optionen erzeugen und behaupten, dass nichts sonst entkommt. Kein `SyntaxError` aus einem JSON-Parse, kein `DOMException` von WebCrypto, kein `RangeError` aus einer Speicheranforderung.

### Ein Prüfergebnis behandeln

Das Ergebnis ist eine unterschiedene Union, TypeScript engt es also für Sie ein:

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // eingeengt: die Attribute der betroffenen Person
  result.withheld        // wie viele offenlegbare Claims nicht mitgereist sind
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

Ist Ihr Code um `try/catch` herum gebaut, schicken Sie dasselbe Ergebnis stattdessen durch `assertVerified()`. Es geht nichts verloren: der geworfene Fehler trägt den ursprünglichen Grund.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // derselbe FailReason wie oben
  } else {
    throw error
  }
}
```

### Ablehnungsgründe

Von `verify()` in `result.reason` geliefert. Der Playground feuert jeden davon auf den Prüfer ab, damit Sie ihn ankommen sehen.

| Grund | Was passiert ist |
|---|---|
| `malformed` | Überhaupt kein Nachweis, ein beschädigter Umschlag, oder eine kombinierte Form ohne abschließendes Trennzeichen. |
| `unknown_issuer` | Der `iss`-Claim steht nicht auf Ihrer Vertrauensliste. |
| `unknown_key` | Der Aussteller ist vertrauenswürdig, hat aber keinen Schlüssel mit diesem `kid`. |
| `unsupported_alg` | Der Header verlangt einen Algorithmus, den der vertrauenswürdige Schlüssel nicht verwendet. |
| `bad_signature` | Die Signatur geht nicht auf. Deckt auch eine gefälschte Statusliste ab. |
| `expired` | Nach `exp`, jenseits der Uhrentoleranz. |
| `not_yet_valid` | Vor `nbf`. |
| `digest_mismatch` | Eine Offenlegung, die der Aussteller nie signiert hat, eine doppelt gesendete, eine mit dem Namen eines registrierten Claims, oder eine, die mit einem bereits in der Nutzlast vorhandenen Claim kollidiert. |
| `revoked` | Der Aussteller hat das Bit dieses Nachweises gesetzt. Deckt auch Aussetzung ab. |
| `status_unavailable` | Die Sperrung ließ sich nicht bestimmen: keine Liste übergeben, unlesbar, an einen anderen Aussteller oder eine andere uri gebunden, oder der Index liegt außerhalb. |
| `status_list_stale` | Ihre zwischengespeicherte Liste ist älter als `maxStatusAge`. |
| `holder_proof_missing` | Es wurde kein Inhaberbeweis vorgelegt und der Aufrufer hat `acceptWithoutHolderProof` nicht übergeben. |
| `holder_proof_invalid` | Ein Beweis lag vor und scheiterte: falscher Schlüssel, falsche Nonce, falsche Audience, andere Menge an Offenlegungen, veraltet, oder an einen Nachweis ohne gebundenen Schlüssel geheftet. |

### Geworfene Fehler

Alles außer `verify()` wirft `QredentialError`, der einen `code` trägt. Nutzen Sie `isQredentialError()` statt `instanceof`: es prüft die Gestalt und funktioniert daher weiter, wenn zwei Kopien des Pakets im selben Abhängigkeitsbaum landen, was der übliche Grund dafür ist, dass `instanceof` still aufhört zu greifen.

| Code | Geworfen von | Was passiert ist |
|---|---|---|
| `invalid_option` | `issue`, `createStatusList` | Ein Argument, mit dem die API nichts anfangen kann: ein unbekannter Claim-Name, eine ungültige Dauer, ein Statusindex außerhalb der Liste. |
| `not_disclosable` | `present` | Sie wollten einen Claim zeigen, den der Aussteller nie offenlegbar gemacht hat. |
| `malformed_credential` | `present` | Die kombinierte SD-JWT-Form ist fehlerhaft. |
| `malformed_envelope` | `unpack`, `present` | Der QR-Umschlag ist fehlerhaft. Sehen Sie in `cause` nach dem darunterliegenden Codec-Fehler. |
| `malformed_status_list` | Lesen der Statusliste | Das Token ist keine lesbare Statusliste. |
| `invalid_encoding` | `decodeBase45` | Text, der base45 oder base64url sein sollte, ist es nicht, oder ein Segment ist kein JSON. |
| `unsupported_alg` | `issue` | Ein Algorithmus, den diese Fassung nicht umsetzt. |
| `unsupported_runtime` | `unpack` | Der Plattform fehlt etwas Nötiges, etwa `DecompressionStream` auf älterem React Native. |
| `crypto_failure` | `issue`, `createStatusList` | WebCrypto hat einen Schlüssel oder eine Operation abgelehnt. Die ursprüngliche `DOMException` steht in `cause`. |
| `verification_failed` | `assertVerified` | Nur aus diesem Helfer. Trägt den ursprünglichen `reason`. |

### Lesen, was darunter liegt

Wo diese Bibliothek fremdes Scheitern einwickelt, behält sie das Original in der Standardeigenschaft `cause`, sodass ein genauer Code Sie nie das Detail kostet:

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // der invalid_encoding-Fehler aus dem base45-Decoder
  }
}
```

> **Codes sind API, Meldungen nicht.** Jeder Wert von `code` und `reason` fällt unter semantische Versionierung: ein Wert wird nie umgewidmet, und neue kommen nur in einer Minor-Version dazu. Der Meldungstext darf sich in einem Patch ändern, verzweigen Sie also über den Code und geben Sie die Meldung aus. Ein Test im Repository fixiert die vollständige Menge der Codes, sodass einen hinzuzufügen oder zu entfernen ein bewusster Akt sein muss und kein Nebeneffekt.

<!-- section: limits -->

## Was dies nicht ist

- **Keine Wallet.** Keine Oberfläche, kein Speicher.
- **Keine Schlüsselverwaltung.** Sie bringen Ihre Schlüssel und Ihre eigene Verteilung der Vertrauensliste mit.
- **Einzelne Array-Elemente vorzeigen.** Die Prüfung löst sie auf; `present()` wählt über den Claim-Namen aus, und ein Array-Element hat keinen, also hält diese Fassung sie zurück. Der Nachweis prüft sich weiterhin, ohne diese Elemente. Ein Auswähler über Pfade ist die Lösung und existiert noch nicht.
- **Noch kein ISO 18013-5 mDL.** Das ist CBOR und COSE statt JWT. Es steht auf der Liste, und die Hälfte eines Konformitätsstandards zu behaupten ist schlimmer, als ihn gar nicht zu behaupten.
- **Nicht auditiert.** Die Bibliothek setzt veröffentlichte Standards um und wird gegen die Angriffe im Playground getestet, aber Tests belegen das Vorhandensein von Abwehr, nie deren Vollständigkeit.

Der Quellcode umfasst etwa 700 Zeilen ohne jede Laufzeitabhängigkeit, genau damit es realistisch ist, ihn zu lesen, bevor Sie ihm vertrauen. Schwachstellen laufen über den Security-Reiter auf GitHub, und [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) legt Umfang und Antwortzeiten fest.
