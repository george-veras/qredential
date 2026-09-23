<!-- translated-from: d8c988938e4cbe4d -->
<!-- section: top -->

<!-- eyebrow -->
_Documentation_

# Des justificatifs qui se vérifient réseau coupé

<!-- lede -->
Un QR code porte sa propre preuve. `qredential` contrôle la signature, l'expiration, la révocation et les claims sans qu'une seule requête ne quitte l'appareil.

<!-- cta --> [Ouvrir le playground](../../playground/)

<!-- cta --> [Lire le code](https://github.com/george-veras/qredential)

<!-- section: start -->

## Démarrer

```ts
npm i qredential
```

Node 20 ou plus récent, tous les navigateurs actuels, et React Native. La bibliothèque utilise WebCrypto et rien de spécifique à Node, parce que l'appareil qui vérifie est le plus souvent un téléphone. Aucune dépendance à l'exécution.

La suite complète tourne sur Node 20, 22 et 24, sous Linux, macOS et Windows, ainsi que dans Chromium, Firefox et WebKit à chaque commit. Ed25519 est exercé dans les quatre.

> **Une réserve sur React Native.** Il n'a pas de `CompressionStream`, et émettre, présenter et vérifier fonctionnent sans lui : l'enveloppe reste simplement non compressée, ce qui coûte de la taille et rien d'autre. *La révocation hors ligne ne fonctionne pas*, parce que lire une liste de statut suppose de décompresser une chaîne de bits. Un vérificateur qui ne peut pas décompresser la liste en cache refuse avec `status_unavailable` plutôt que de traiter une liste illisible comme une liste propre. Si vous avez besoin de la révocation sur React Native, ajoutez un polyfill de `DecompressionStream`. Un test exécute tout le parcours avec les deux globales supprimées, donc cette description est vérifiée et non supposée.

### Vérifier quelque chose

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### Le cycle complet

Trois parties, trois appels. L'émetteur signe une fois, le porteur restreint ce qui circule, le vérificateur décide.

```ts
import { issue, present, verify } from 'qredential'

// 1. L'émetteur, une seule fois, à la délivrance du permis. holderKey le lie au portefeuille.
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
  holderKey: holderPublicJwk,
  expiresIn: '1825d',
})

// 2. Le portefeuille du porteur, au moment du scan. Révèle la majorité, garde la date, et signe le
//    défi frais de la porte, si bien qu'une photo de ce code ne vaut rien.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: holderPrivateJwk, audience: 'https://bar.example/door', nonce: challenge },
})

// 3. Le vérificateur, hors ligne.
const result = await verify(presentation, {
  trust,
  nonce: challenge,
  audience: 'https://bar.example/door',
})
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined, et elle n'a jamais quitté le portefeuille
```

<!-- section: disclosure -->

## Divulgation sélective

Deux parties distinctes prennent deux décisions distinctes, et les confondre est l'erreur de conception habituelle. L'**émetteur** décide quels claims *peuvent* être retenus, au moment de signer, avec `disclose`. Le **porteur** décide ensuite lesquels il montre réellement, au moment du scan, également avec `disclose`. Un claim que l'émetteur n'a jamais marqué ne peut être retenu par personne.

Le mécanisme est un hachage ordinaire. Chaque claim divulgable est sérialisé avec un sel aléatoire de 128 bits, et seule l'empreinte de cette chaîne est signée dans le justificatif. Révéler un claim, c'est envoyer la chaîne d'origine pour que le vérificateur la hache et retrouve l'empreinte. Le retenir, c'est laisser le vérificateur avec une empreinte qu'il ne pourra jamais ouvrir.

### Divulgation imbriquée, dans les tableaux et récursive

La RFC 9901 autorise les trois, et l'écosystème du portefeuille européen utilise les trois. La vérification les résout ici à n'importe quelle profondeur, en suivant le modèle de traitement de la section 7.1 :

- Un tableau `_sd` à l'intérieur d'un objet imbriqué cache des propriétés de cet objet.
- Un élément de tableau de la forme `{"...": digest}` cache l'élément lui-même. Un élément retenu est *supprimé* du tableau plutôt que laissé comme marqueur, si bien que ce que vous recevez est une valeur propre, affichable telle quelle.
- Une valeur révélée peut elle-même contenir l'une ou l'autre forme, donc en résoudre une en découvre d'autres.

Rien de tout cela ne fuit dans `claims` : aucune clé `_sd` ni aucun élément `"..."` n'atteint l'appelant. Les noms révélés reviennent sous forme de chemins, par exemple `address.locality`, et l'ensemble est contrôlé dans les deux sens contre une implémentation indépendante de la même RFC.

> **Pourquoi cela compte pour le contrôle d'âge.** L'implémentation habituelle fait téléverser au client une photo de sa pièce d'identité chez un tiers, ce qui crée une fuite en attente. Ici le bar apprend un booléen et ne peut pas apprendre la date de naissance, même s'il le voulait. Cette propriété est cryptographique, pas une promesse dans une politique de confidentialité.

Demander un claim que l'émetteur n'a pas rendu divulgable lève une exception, plutôt que de renvoyer silencieusement moins que ce que vous avez demandé.

<!-- section: holder -->

## Prouver le porteur

La divulgation sélective prouve que l'émetteur a signé ces claims. À elle seule, elle ne prouve pas que la personne qui les présente en est le sujet, et l'écart n'est pas théorique : la photo du code de quelqu'un d'autre porte la même signature et se vérifie tout aussi bien.

La liaison de clé referme cet écart. L'émetteur inscrit la clé publique du porteur dans le justificatif, et au moment du scan le portefeuille du porteur signe un défi neuf avec la clé privée correspondante. Une photo ne peut pas faire cela.

### Les trois étapes

```ts
// 1. L'émetteur lie la clé publique du porteur.
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. Le portefeuille signe le défi de ce vérificateur, au moment du scan.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. Le vérificateur contrôle que la preuve répond à son propre défi.
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

La preuve s'engage sur quatre choses, et chacune ferme une attaque précise : le **nonce** empêche de rejouer une présentation enregistrée, l'**audience** empêche qu'une preuve faite pour un vérificateur serve chez un autre, la **signature** la rattache à la clé que l'émetteur a liée, et `sd_hash` couvre l'ensemble exact des divulgations, de sorte qu'un relais ne peut ni en ajouter ni en retirer après la signature du porteur. Elle expire aussi, cinq minutes par défaut, réglable avec `maxKeyBindingAge`.

### Les justificatifs statiques, et pourquoi le choix vous revient, à voix haute

Un code imprimé sur une carte ne peut rien faire de tout cela. Il n'y a pas d'appareil pour signer au moment du scan, donc un justificatif statique est copiable par nature. C'est une situation réelle et fréquente, pas une erreur, mais c'est une décision qu'un vérificateur devrait prendre en connaissance de cause :

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false, et il le dit quel que soit votre choix
```

Sans cette option, une présentation sans preuve est refusée avec `holder_proof_missing`. La valeur par défaut est la stricte, volontairement : le cas dangereux, c'est quelqu'un qui construit un lecteur de porte, qui n'a jamais entendu parler de la liaison de clé, et qui livre quelque chose qu'une capture d'écran met en échec. Un échec bruyant qui nomme le problème vaut mieux qu'un défaut silencieux qui le cache.

> **Accepter volontairement ne laisse jamais passer une preuve cassée.** `acceptWithoutHolderProof` couvre le cas où aucune preuve n'a été fournie. Si une preuve est présente et échoue, le justificatif est refusé quelle que soit l'option.

### Ce que cela coûte

La liaison n'est pas gratuite en termes de QR. La clé publique du porteur vit dans le justificatif, et la preuve voyage avec la présentation :

| Présentation | Caractères | Version du QR |
|---|---|---|
| statique, tout visible | ~740 | 18, se scanne bien |
| majorité seule, liée mais non prouvée | ~1320 | 24, dense |
| majorité seule, avec preuve du porteur | ~1605 | 27, trop dense |

La preuve elle-même fait environ 285 caractères. Cela compte moins qu'il n'y paraît, car un justificatif capable de liaison de clé est par définition affiché sur un écran, où le code peut être grand et lumineux. La limite de densité est un problème pour les cartes imprimées et usées, et une carte imprimée n'allait de toute façon jamais faire de liaison de clé.

<!-- section: size -->

## Le budget de taille

Un QR code contient environ 4300 caractères alphanumériques à sa plus grande version, mais un code de cette taille est illisible sur une carte rayée ou un écran fêlé. Le plafond pratique se situe autour de la version 20.

Voici ce que coûte un permis de conduire réaliste. Huit claims, une validité de cinq ans, un pointeur vers une liste de statut, mesuré par `examples/sizes.mjs` dans le dépôt :

| Justificatif | Caractères | Version du QR |
|---|---|---|
| tout visible | ~740 | 18, se scanne bien |
| les huit claims divulgables | ~1590 | 27, trop dense |
| ne présentant que `over_18` | ~1115 | 22, encore dense |

La ligne du milieu est la gênante, et mieux vaut l'apprendre ici qu'après avoir imprimé des cartes. La divulgation sélective double presque le justificatif, parce que chaque claim divulgable coûte un sel plus une empreinte signée, et **les empreintes restent dans la charge utile que le porteur révèle le claim ou non**. C'est délibéré : un nombre d'empreintes qui diminuerait avec ce que vous révélez trahirait ce que vous avez retenu. La conséquence pratique est que l'économie au moment de la présentation est plus faible que l'intuition ne le promet. Trente pour cent ici, pas quatre-vingts.

Ne rendez donc divulgables que les claims qu'un vérificateur pourrait réellement avoir besoin de voir seuls. Deux ou trois, pas tous. `fits()` vous dit où vous en êtes avant de vous engager.

> **À propos de base45.** Le folklore dit qu'il est choisi pour sa compacité. C'est faux. base45 en mode alphanumérique QR coûte environ 8,25 bits par octet d'origine, contre 10,67 pour base64 en mode octet et 8 tout rond pour le binaire brut. Il bat nettement base64 et perd de peu face aux octets bruts. Les octets bruts sont abandonnés volontairement, parce que le mode octet traîne une ambiguïté de jeu de caractères et que beaucoup de lecteurs renvoient une chaîne abîmée. Un justificatif qui survit au copier, coller et journaliser vaut bien trois pour cent de pénalité.

<!-- section: revocation -->

## Révocation hors ligne

La révocation est la partie que les implémentations sautent, et alors un justificatif volé fonctionne pour toujours.

Une liste de statut est une chaîne de bits compressée, un bit par justificatif. Une liste couvrant un million de justificatifs fait 125 Ko presque entièrement de zéros, qui se compressent en quelques kilooctets. Récupérez-la quand vous avez du réseau, contrôlez-la quand vous n'en avez pas.

```ts
// L'émetteur publie ceci, au rythme qui lui convient.
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// Le vérificateur contrôle contre sa copie en cache.
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

Les refus méritent d'être lus, car chacun est un endroit où une bibliothèque plus discrète renverrait un faux oui :

- Vous n'avez fourni aucune liste, donc la révocation n'a jamais été contrôlée : `status_unavailable`
- Votre liste en cache est plus ancienne que `maxStatusAge`, donc la révocation ne peut pas être écartée : `status_list_stale`
- La liste est signée par une clé absente de votre liste de confiance, ce qui est exactement ainsi qu'un attaquant blanchirait un justificatif révoqué : `bad_signature`
- La liste a été publiée par un émetteur différent de celui du justificatif, ou pour une `uri` différente. Un même index signifie autre chose dans chaque liste, donc une liste non rattachée n'est pas une réponse : `status_unavailable`
- L'index du justificatif tombe hors de la liste que vous avez mise en cache, donc rien n'a réellement été lu : `status_unavailable`

> **Un résultat propre ne se tait jamais là-dessus.** Quand la révocation a bien été contrôlée, le résultat indique `revocationChecked: true`. Si la bibliothèque ne peut pas atteindre une vraie réponse, elle refuse plutôt que de laisser passer le justificatif avec ce drapeau levé, parce qu'une fausse assurance est pire que pas de réponse.

Que faire quand vous ne pouvez pas être sûr est une question de politique propre à votre déploiement, pas à la bibliothèque, donc `qredential` refuse de la trancher silencieusement à votre place. Quand la révocation a bien été contrôlée, le résultat en succès le dit avec `revocationChecked: true`.

<!-- section: trust -->

## Listes de confiance

La seule chose qui doit atteindre l'appareil par un autre canal est l'ensemble des clés publiques d'émetteurs auxquelles vous acceptez de croire. Il change rarement, donc l'embarquer avec l'application et le rafraîchir une fois par semaine est une stratégie parfaitement raisonnable.

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

C'est la clé de confiance qui décide de l'algorithme utilisé, jamais l'algorithme nommé dans l'en-tête du justificatif lui-même. C'est toute la défense contre la substitution d'algorithme, et c'est pourquoi `alg` vit sur la clé de votre liste de confiance au lieu d'être déduit.

Comment la liste atteint l'appareil, comment les clés tournent et où vit la clé privée sont hors périmètre. La bibliothèque les prend en entrée.

<!-- section: api -->

## Référence de l'API

Quatre fonctions couvrent le cycle de vie du justificatif, plus une pour les émetteurs qui publient la révocation.

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| Option | Type | Sens |
|---|---|---|
| `issuer` | `string` | Identifiant qui doit correspondre à une clé de la liste de confiance du vérificateur. |
| `key` | `Jwk` | Clé privée. Ne quitte jamais l'appel. |
| `kid` | `string` | Identifiant de clé, écrit dans l'en-tête pour que le vérificateur choisisse la bonne clé pendant une rotation. |
| `alg` | `'ES256' \| 'EdDSA'` | `ES256` par défaut, pris en charge par toutes les plateformes. |
| `claims` | `object` | Ce que le justificatif affirme. |
| `disclose` | `string[]` | Noms des claims que le porteur peut retenir. Tout le reste est toujours visible. Nommer un claim inexistant lève une exception. |
| `vct` | `string` | Type de justificatif, le `vct` de SD-JWT VC. |
| `subject` | `string` | Identifiant de sujet, facultatif. |
| `expiresIn` | `number \| string` | Secondes, ou une durée comme `'1825d'`. |
| `notBefore` | `number \| string` | Mêmes formes, pour les justificatifs qui commencent plus tard. |
| `status` | `{ idx, uri }` | La place de ce justificatif dans une liste de statut. |
| `holderKey` | `Jwk` | La clé **publique** du porteur, écrite dans `cnf`. Ne l'omettez que pour des justificatifs statiques. Une clé porteuse d'une composante privée est refusée. |

Renvoie `credential` (la forme combinée SD-JWT, à conserver dans le portefeuille), `qr` (l'enveloppe scannable), `bytes` (le nombre de caractères de `qr`) et `disclosable` (les noms de claims que le porteur peut retenir).

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

Restreint un justificatif aux claims listés et renvoie une enveloppe scannable. Le JWT signé n'est jamais touché, donc la signature de l'émetteur reste valide sur ce qui reste. Accepte aussi bien la forme combinée qu'une enveloppe. Demander un claim que l'émetteur n'a pas rendu divulgable lève une exception.

`disclose` prend des chemins, les mêmes que ceux que `verify()` renvoie dans `disclosed` :

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

Un nom seul est un chemin d'un segment, donc `'over_18'` veut dire ce qu'il a toujours voulu dire. **Les indices de tableau sont des positions dans le justificatif tel qu'émis**, pas dans la présentation, si bien qu'un sélecteur continue de dire ce qu'il disait quoi que le porteur retienne par ailleurs. Et une divulgation imbriquée ne peut légalement circuler sans celle qui la contient, donc demander `address.locality` envoie aussi `address`, résolu pour vous plutôt que laissé à l'appelant.

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| Option | Type | Sens |
|---|---|---|
| `trust` | `TrustList` | Obligatoire. Les émetteurs et les clés auxquels vous acceptez de croire. |
| `status` | `string` | Un jeton de liste de statut en cache. Sans lui, un justificatif qui en désigne une ne peut pas être blanchi. |
| `maxStatusAge` | `number \| string` | Refuser de répondre à partir d'une liste plus ancienne que cela. |
| `clockSkew` | `number` | Tolérance en secondes pour la dérive d'horloge entre émetteur et vérificateur. 60 par défaut. |
| `nonce` | `string` | Le défi que ce vérificateur a émis pour ce scan. Obligatoire pour accepter une preuve du porteur. |
| `audience` | `string` | L'identifiant de ce vérificateur, contrôlé contre le `aud` de la preuve. |
| `acceptWithoutHolderProof` | `boolean` | Accepter une présentation sans aucune preuve. Nécessaire pour les justificatifs statiques, et ne laisse jamais passer une preuve présente et cassée. |
| `maxKeyBindingAge` | `number \| string` | Âge maximal d'une preuve du porteur. 5 minutes par défaut. |
| `now` | `number` | Remplacer l'heure courante. Pour les tests et l'analyse de rejeu. |

Ne lève jamais sur une entrée hostile. Renvoie une union discriminée : en succès `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`, et en échec `{ ok: false, reason, message }` avec `reason` tiré du tableau ci-dessous.

`withheld` compte les claims divulgables qui n'ont pas circulé. C'est utile pour une politique, et par construction il ne peut pas vous dire lesquels c'étaient.

**Tout ce qui se trouve dans `claims` décrit le sujet.** Les claims enregistrés qui décrivent le jeton, comme `iss`, `iat`, `exp` et `status`, apparaissent plutôt comme des champs typés, et une divulgation qui tenterait d'en fixer un, ou d'écraser un claim que la charge utile a déjà tranché, fait échouer tout le justificatif. Parcourir `claims` est donc sûr.

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

Synchrone. Renvoie `{ chars, version, capacity, comfortable, errorCorrection, advice }`. La correction d'erreur vaut `M` par défaut, parce que `L` paraît généreuse sur le papier puis échoue sur une carte imprimée et usée. `version` vaut `null` quand rien ne contient la charge utile, et `advice` est une phrase que vous pouvez imprimer telle quelle dans un journal de build.

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

Pour les émetteurs. Prend `issuer`, `key`, `kid`, `alg`, `uri`, `size`, `revoked`, `suspended`, `expiresIn` et `issuedAt`, et renvoie un jeton de liste de statut signé. Un index hors de la liste lève une exception plutôt que de corrompre le bit d'un justificatif voisin.

### Également exportés

`pack`, `unpack` et `isEnvelope` pour l'enveloppe du QR, ainsi que `encodeBase45` et `decodeBase45` pour le codec seul. Utiles pour l'outillage ; inutiles à l'usage courant.

<!-- section: errors -->

## Gestion des erreurs

Il y a exactement deux contrats, et la séparation est délibérée, pas accidentelle. Retenez ces deux phrases et vous pourrez écrire un seul bloc catch en sachant ce qui peut y tomber.

```sig
1. verify() ne lève jamais. Quelle que soit l'entrée.
2. Tout le reste ne lève que QredentialError.
```

La raison de cette différence : `verify()` existe pour être pointé vers une entrée hostile, et un vérificateur qui lève est un vérificateur que quelqu'un enveloppe dans un `try/catch` qui laisse passer les gens. Il renvoie donc un résultat que vous êtes obligé de regarder. Tout le reste échoue sur des conditions que l'appelant corrige dans son code, où lever est la bonne forme.

Les deux règles sont tenues par des tests de propriétés qui produisent des chaînes aléatoires, des clés malformées, des enveloppes corrompues et des options hostiles, et affirment que rien d'autre ne s'échappe. Aucun `SyntaxError` d'une analyse JSON, aucun `DOMException` de WebCrypto, aucun `RangeError` d'une allocation.

### Traiter un résultat de vérification

Le résultat est une union discriminée, donc TypeScript l'affine pour vous :

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // affiné : les attributs du sujet
  result.withheld        // combien de claims divulgables n'ont pas circulé
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

Si votre code est bâti autour de `try/catch`, faites passer le même résultat par `assertVerified()`. Rien n'est perdu : l'erreur levée porte la raison d'origine.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // le même FailReason que ci-dessus
  } else {
    throw error
  }
}
```

### Raisons de refus

Renvoyées par `verify()` dans `result.reason`. Le playground envoie chacune d'elles au vérificateur pour que vous les voyiez tomber.

| Raison | Ce qui s'est passé |
|---|---|
| `malformed` | Pas un justificatif du tout, une enveloppe corrompue, ou une forme combinée à laquelle manque son séparateur final. |
| `unknown_issuer` | Le claim `iss` n'est pas dans votre liste de confiance. |
| `unknown_key` | L'émetteur est de confiance mais n'a aucune clé avec ce `kid`. |
| `unsupported_alg` | L'en-tête demande un algorithme que la clé de confiance n'utilise pas. |
| `bad_signature` | La signature ne tient pas. Couvre aussi une liste de statut falsifiée. |
| `expired` | Après `exp`, au-delà de la tolérance d'horloge. |
| `not_yet_valid` | Avant `nbf`. |
| `digest_mismatch` | Une divulgation que l'émetteur n'a jamais signée, une envoyée deux fois, une qui nomme un claim enregistré, ou une qui entre en collision avec un claim déjà présent dans la charge utile. |
| `revoked` | L'émetteur a levé le bit de ce justificatif. Couvre aussi la suspension. |
| `status_unavailable` | La révocation n'a pas pu être déterminée : liste absente, illisible, rattachée à un autre émetteur ou une autre uri, ou index en dehors d'elle. |
| `status_list_stale` | Votre liste en cache est plus ancienne que `maxStatusAge`. |
| `holder_proof_missing` | Aucune preuve du porteur n'a été fournie et l'appelant n'a pas passé `acceptWithoutHolderProof`. |
| `holder_proof_invalid` | Une preuve a été fournie et a échoué : mauvaise clé, mauvais nonce, mauvaise audience, ensemble de divulgations différent, périmée, ou attachée à un justificatif sans clé liée. |

### Erreurs levées

Tout sauf `verify()` lève `QredentialError`, qui porte un `code`. Utilisez `isQredentialError()` plutôt que `instanceof` : il contrôle la forme, donc il continue de fonctionner quand deux copies du paquet se retrouvent dans le même arbre de dépendances, ce qui est la raison habituelle pour laquelle `instanceof` cesse silencieusement de correspondre.

| Code | Levé par | Ce qui s'est passé |
|---|---|---|
| `invalid_option` | `issue`, `createStatusList` | Un argument que l'API ne peut pas utiliser : un nom de claim inconnu, une durée invalide, un index de statut hors de la liste. |
| `not_disclosable` | `present` | Vous avez demandé à révéler un claim que l'émetteur n'a jamais rendu divulgable. |
| `malformed_credential` | `present` | La forme combinée SD-JWT est malformée. |
| `malformed_envelope` | `unpack`, `present` | L'enveloppe du QR est malformée. Regardez `cause` pour l'erreur de codec en dessous. |
| `malformed_status_list` | lecture de liste de statut | Le jeton n'est pas une liste de statut lisible. |
| `invalid_encoding` | `decodeBase45` | Un texte qui devrait être du base45 ou du base64url ne l'est pas, ou un segment n'est pas du JSON. |
| `unsupported_alg` | `issue` | Un algorithme que cette version n'implémente pas. |
| `unsupported_runtime` | `unpack` | Il manque à la plateforme quelque chose de nécessaire, comme `DecompressionStream` sur un React Native ancien. |
| `crypto_failure` | `issue`, `createStatusList` | WebCrypto a refusé une clé ou une opération. Le `DOMException` d'origine est dans `cause`. |
| `verification_failed` | `assertVerified` | Uniquement depuis cet utilitaire. Porte la `reason` d'origine. |

### Lire ce qu'il y a en dessous

Là où cette bibliothèque enveloppe l'échec d'un autre, elle conserve l'original dans la propriété standard `cause`, si bien qu'un code précis ne vous coûte jamais le détail :

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // l'erreur invalid_encoding venue du décodeur base45
  }
}
```

> **Les codes sont de l'API, les messages non.** Chaque valeur de `code` et de `reason` est couverte par le versionnage sémantique : une valeur n'est jamais réaffectée, et les nouvelles n'arrivent qu'en version mineure. Le texte des messages peut changer dans un correctif, donc branchez sur le code et affichez le message. Un test du dépôt fige l'ensemble complet des codes, de sorte qu'en ajouter ou en retirer un doit être un acte délibéré et non un effet de bord.

<!-- section: limits -->

## Ce que ceci n'est pas

- **Pas un portefeuille.** Pas d'interface, pas de stockage.
- **Pas de gestion de clés.** Vous apportez vos clés et votre propre distribution de liste de confiance.
- **Pas encore mDL ISO 18013-5.** C'est du CBOR et du COSE, pas du JWT. C'est à la feuille de route, et revendiquer la moitié d'une norme de conformité est pire que ne rien revendiquer.
- **Pas audité.** La bibliothèque implémente des normes publiées et est testée contre les attaques du playground, mais les tests prouvent la présence de défenses, jamais qu'elles sont complètes.

Le code fait environ 1 300 lignes sans aucune dépendance à l'exécution, précisément pour que le lire avant de lui faire confiance soit réaliste. Les vulnérabilités passent par l'onglet Security sur GitHub, et [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) fixe le périmètre et les délais de réponse.
