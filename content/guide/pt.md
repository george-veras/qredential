<!-- translated-from: d8c988938e4cbe4d -->
<!-- section: top -->

<!-- eyebrow -->
_Documentação_

# Credenciais que se verificam com a rede desligada

<!-- lede -->
Um QR code carrega a própria prova. O `qredential` confere a assinatura, a validade, a revogação e os claims sem que uma única requisição saia do dispositivo.

<!-- cta --> [Abrir o playground](../../playground/)

<!-- cta --> [Ler o código](https://github.com/george-veras/qredential)

<!-- section: start -->

## Primeiros passos

```ts
npm i qredential
```

Node 20 ou mais novo, todos os navegadores atuais e React Native. Usa WebCrypto e nada específico do Node, porque quem verifica costuma ser um celular. Não há nenhuma dependência de runtime.

A suíte completa roda no Node 20, 22 e 24, em Linux, macOS e Windows, e em Chromium, Firefox e WebKit a cada commit. Ed25519 é exercitado nos quatro.

> **Uma ressalva sobre React Native.** Ele não tem `CompressionStream`, e emitir, apresentar e verificar funcionam sem ele: o envelope apenas fica sem compressão, o que custa tamanho e nada mais. *Revogação offline não funciona*, porque ler uma lista de status exige descomprimir um bitstring. Um verificador que não consegue descomprimir a lista em cache recusa com `status_unavailable` em vez de tratar lista ilegível como lista limpa. Se você precisa de revogação no React Native, faça polyfill de `DecompressionStream`. Existe um teste que roda o fluxo inteiro com os dois globais apagados, então esta descrição é verificada e não suposta.

### Verificar alguma coisa

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### O ciclo completo

Três partes, três chamadas. O emissor assina uma vez, o portador estreita o que viaja, o verificador decide.

```ts
import { issue, present, verify } from 'qredential'

// 1. O emissor, uma vez, quando a habilitação é concedida. holderKey prende à carteira.
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

// 2. A carteira do portador, na hora do scan. Revela a maioridade, guarda a data, e assina o
//    desafio novo da porta, então uma foto deste código não vale nada.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: holderPrivateJwk, audience: 'https://bar.example/door', nonce: challenge },
})

// 3. O verificador, offline.
const result = await verify(presentation, {
  trust,
  nonce: challenge,
  audience: 'https://bar.example/door',
})
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined, e nunca saiu da carteira
```

<!-- section: disclosure -->

## Divulgação seletiva

Duas partes diferentes tomam duas decisões diferentes, e confundir as duas é o erro de desenho mais comum. O **emissor** decide quais claims *podem* ser omitidos, na hora de assinar, com `disclose`. O **portador** então decide quais daqueles vai de fato mostrar, na hora do scan, também com `disclose`. Um claim que o emissor nunca marcou não pode ser omitido por ninguém.

O mecanismo é hash comum. Cada claim divulgável é serializado com um salt aleatório de 128 bits, e só o digest dessa string é assinado na credencial. Revelar um claim significa enviar a string original para o verificador fazer o hash e achar o digest. Omitir significa deixar o verificador com um digest que ele nunca vai conseguir abrir.

### Divulgação aninhada, em array e recursiva

O RFC 9901 permite as três, e o ecossistema da carteira europeia usa as três. A verificação aqui resolve todas em qualquer profundidade, seguindo o modelo de processamento da seção 7.1:

- Um array `_sd` dentro de objeto aninhado esconde propriedades daquele objeto.
- Um elemento de array na forma `{"...": digest}` esconde o próprio elemento. Um elemento omitido é *removido* do array em vez de virar marcador, então o que você recebe é valor limpo, pronto para exibir.
- Um valor revelado pode conter qualquer uma das duas formas, então resolver um descobre mais.

Nada disso vaza para `claims`: nenhuma chave `_sd` e nenhum elemento `"..."` chega em quem chamou. Os nomes revelados voltam como caminho, por exemplo `address.locality`, e o conjunto todo é conferido nos dois sentidos contra uma implementação independente do mesmo RFC.

> **Por que isso importa em verificação de idade.** A implementação de sempre faz o cliente enviar foto do documento para um terceiro, o que cria um vazamento à espera de acontecer. Aqui o bar aprende um booleano e não consegue aprender a data de nascimento nem se quiser. Essa propriedade é criptográfica, não é promessa em política de privacidade.

Pedir um claim que o emissor não tornou divulgável lança exceção, em vez de devolver em silêncio menos do que você pediu.

<!-- section: holder -->

## Provar o portador

Divulgação seletiva prova que o emissor assinou aqueles claims. Sozinha, ela não prova que quem está apresentando é o titular, e a brecha não é teórica: a foto do código de outra pessoa carrega a mesma assinatura e verifica exatamente igual.

Key binding fecha isso. O emissor grava a chave pública do portador na credencial, e na hora do scan a carteira do portador assina um desafio novo com a chave privada correspondente. Uma foto não consegue fazer isso.

### Os três passos

```ts
// 1. O emissor amarra a chave pública do portador.
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. A carteira assina o desafio deste verificador, na hora do scan.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. O verificador confere que a prova responde ao desafio dele.
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

A prova se compromete com quatro coisas, e cada uma fecha um ataque específico: o **nonce** impede que uma apresentação gravada seja repetida, a **audience** impede que uma prova feita para um verificador seja usada em outro, a **assinatura** amarra à chave que o emissor registrou, e o `sd_hash` cobre o conjunto exato de disclosures, de modo que um intermediário não consegue acrescentar nem remover nenhuma depois que o portador assinou. Ela também expira, cinco minutos por padrão, ajustável com `maxKeyBindingAge`.

### Credenciais estáticas, e por que a escolha é sua e em voz alta

Um código impresso num cartão não consegue nada disso. Não existe dispositivo para assinar na hora do scan, então credencial estática é copiável por natureza. Isso é situação real e comum, não erro, mas é decisão que o verificador deve tomar sabendo:

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false, e ele diz isso de qualquer jeito que você escolha
```

Sem essa opção, uma apresentação sem prova é recusada com `holder_proof_missing`. O padrão é o estrito de propósito: o caso perigoso é alguém montando um leitor de porta, nunca tendo ouvido falar de key binding, e entregando algo que um print derruba. Uma falha barulhenta que nomeia o problema vale mais que um padrão silencioso que o esconde.

> **Optar por aceitar nunca deixa passar uma prova quebrada.** O `acceptWithoutHolderProof` cobre o caso em que nenhuma prova foi oferecida. Se uma estiver presente e falhar, a credencial é recusada independentemente da opção.

### O que custa

Amarrar não é de graça em termos de QR. A chave pública do portador vive na credencial, e a prova viaja junto com a apresentação:

| Apresentação | Caracteres | Versão do QR |
|---|---|---|
| estática, tudo visível | ~740 | 18, escaneia bem |
| só maioridade, amarrada mas sem prova | ~1320 | 24, denso |
| só maioridade, com prova do portador | ~1605 | 27, denso demais |

A prova em si tem cerca de 285 caracteres. Isso importa menos do que parece, porque credencial capaz de key binding está, por definição, sendo exibida numa tela, onde o código pode ser grande e claro. O limite de densidade é problema de cartão impresso e gasto, e cartão impresso nunca ia fazer key binding mesmo.

<!-- section: size -->

## O orçamento de tamanho

Um QR code guarda cerca de 4300 caracteres alfanuméricos no maior tamanho, mas um código desse tamanho é ilegível num cartão arranhado ou numa tela trincada. O teto prático fica por volta da versão 20.

Eis o que uma habilitação realista custa. Oito claims, validade de cinco anos, ponteiro de lista de status, medido pelo `examples/sizes.mjs` no repositório:

| Credencial | Caracteres | Versão do QR |
|---|---|---|
| tudo visível | ~740 | 18, escaneia bem |
| os oito claims divulgáveis | ~1590 | 27, denso demais |
| apresentando só `over_18` | ~1115 | 22, ainda denso |

A linha do meio é a incômoda, e é melhor descobrir aqui do que depois de imprimir cartões. Divulgação seletiva praticamente dobra a credencial, porque cada claim divulgável custa um salt mais um digest assinado, e **os digests ficam no payload quer o portador revele o claim ou não**. Isso é proposital: uma contagem de digest que encolhesse conforme o que você revela vazaria o que você escondeu. A consequência prática é que a economia na hora da apresentação é menor do que a intuição promete. Trinta por cento aqui, não oitenta.

Então torne divulgáveis apenas os claims que um verificador pode genuinamente precisar ver sozinhos. Dois ou três, não todos. O `fits()` te diz onde você está antes de se comprometer.

> **Sobre o base45.** O folclore diz que ele é escolhido por compactação. Não é. O base45 no modo alfanumérico do QR custa cerca de 8,25 bits por byte original, contra 10,67 do base64 em modo byte e 8 do binário puro. Ele ganha claramente do base64 e perde de pouco para os bytes crus. Os bytes crus são abandonados de propósito, porque o modo byte carrega ambiguidade de charset e muitos leitores devolvem string corrompida. Uma credencial que sobrevive a ser copiada, colada e registrada em log vale uma penalidade de três por cento.

<!-- section: revocation -->

## Revogação offline

Revogação é a parte que as implementações pulam, e aí uma credencial roubada funciona para sempre.

Uma lista de status é um bitstring comprimido com um bit por credencial. Uma lista cobrindo um milhão de credenciais tem 125 KB quase todos de zeros, que comprimem para poucos kilobytes. Busque quando tiver sinal, confira quando não tiver.

```ts
// O emissor publica isto, na periodicidade que preferir.
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// O verificador confere contra a cópia em cache.
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

As recusas valem a leitura, porque cada uma é um lugar onde uma biblioteca mais quieta devolveria um sim falso:

- Você não passou lista nenhuma, então a revogação nunca foi conferida: `status_unavailable`
- Sua lista em cache é mais velha que `maxStatusAge`, então não dá para descartar revogação: `status_list_stale`
- A lista está assinada por uma chave que não está na sua lista de confiança, que é como um atacante limparia uma credencial revogada: `bad_signature`
- A lista foi publicada por um emissor diferente do da credencial, ou para uma `uri` diferente. Um mesmo índice significa coisa diferente em cada lista, então lista não amarrada não é resposta: `status_unavailable`
- O índice da credencial cai fora da lista que você guardou, então nada foi de fato lido: `status_unavailable`

> **Um resultado limpo nunca fica calado sobre isso.** Quando a revogação foi conferida, o resultado diz `revocationChecked: true`. Se a biblioteca não consegue chegar a uma resposta real, ela recusa em vez de aprovar a credencial com essa marca ligada, porque garantia falsa é pior que nenhuma resposta.

O que fazer quando não dá para ter certeza é questão de política da sua implantação, não da biblioteca, então o `qredential` se recusa a decidir isso em silêncio por você. Quando a revogação foi conferida, o resultado bem-sucedido diz isso com `revocationChecked: true`.

<!-- section: trust -->

## Listas de confiança

A única coisa que precisa chegar ao dispositivo por fora é o conjunto de chaves públicas de emissores em que você está disposto a acreditar. Muda raramente, então distribuir junto com o aplicativo e atualizar uma vez por semana é estratégia perfeitamente razoável.

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

A chave confiável decide qual algoritmo é usado, nunca o algoritmo nomeado no cabeçalho da própria credencial. Essa é a defesa inteira contra substituição de algoritmo, e é por isso que o `alg` vive na chave da sua lista de confiança em vez de ser inferido.

Como a lista chega ao dispositivo, como as chaves rotacionam e onde a chave privada mora estão fora de escopo. A biblioteca recebe tudo isso como entrada.

<!-- section: api -->

## Referência da API

Quatro funções cobrem o ciclo de vida da credencial, mais uma para emissores que publicam revogação.

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| Opção | Tipo | Significado |
|---|---|---|
| `issuer` | `string` | Identificador que precisa casar com uma chave na lista de confiança do verificador. |
| `key` | `Jwk` | Chave privada. Nunca sai da chamada. |
| `kid` | `string` | Id da chave, escrito no cabeçalho para o verificador escolher a chave certa durante rotação. |
| `alg` | `'ES256' \| 'EdDSA'` | Padrão `ES256`, que toda plataforma suporta. |
| `claims` | `object` | O que a credencial afirma. |
| `disclose` | `string[]` | Nomes de claims que o portador pode omitir. Todo o resto fica sempre visível. Nomear um claim que não existe lança exceção. |
| `vct` | `string` | Tipo de credencial, o `vct` do SD-JWT VC. |
| `subject` | `string` | Identificador opcional do titular. |
| `expiresIn` | `number \| string` | Segundos, ou uma duração como `'1825d'`. |
| `notBefore` | `number \| string` | As mesmas formas, para credenciais que começam a valer depois. |
| `status` | `{ idx, uri }` | A vaga desta credencial numa lista de status. |
| `holderKey` | `Jwk` | A chave **pública** do portador, gravada em `cnf`. Omita apenas para credenciais estáticas. Uma chave que carregue componente privado é recusada. |

Devolve `credential` (a forma combinada do SD-JWT, guarde esta na carteira), `qr` (o envelope escaneável), `bytes` (caracteres em `qr`) e `disclosable` (os nomes de claims que o portador pode omitir).

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

Estreita uma credencial para os claims listados e devolve um envelope escaneável. O JWT assinado nunca é tocado, então a assinatura do emissor continua válida sobre o que restou. Aceita tanto a forma combinada quanto um envelope. Pedir um claim que o emissor não tornou divulgável lança exceção.

`disclose` recebe caminhos, os mesmos que o `verify()` devolve em `disclosed`:

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

Um nome solto é caminho de um segmento, então `'over_18'` significa o que sempre significou. **Índices de array são posições na credencial como emitida**, não na apresentação, de modo que um seletor continua significando o que dizia, independentemente do que mais o portador omita. E uma disclosure aninhada não pode viajar legalmente sem a que a contém, então pedir `address.locality` envia `address` junto, resolvido para você em vez de sobrar para quem chama.

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| Opção | Tipo | Significado |
|---|---|---|
| `trust` | `TrustList` | Obrigatório. Emissores e chaves em que você acredita. |
| `status` | `string` | Token de lista de status em cache. Sem ele, uma credencial que aponta para uma não pode ser liberada. |
| `maxStatusAge` | `number \| string` | Recusar responder a partir de lista mais velha que isto. |
| `clockSkew` | `number` | Tolerância em segundos para diferença de relógio entre emissor e verificador. Padrão 60. |
| `nonce` | `string` | O desafio que este verificador emitiu para este scan. Obrigatório para aceitar prova do portador. |
| `audience` | `string` | O identificador deste verificador, conferido contra o `aud` da prova. |
| `acceptWithoutHolderProof` | `boolean` | Aceitar apresentação sem prova nenhuma. Necessário para credenciais estáticas, e nunca deixa passar prova presente e quebrada. |
| `maxKeyBindingAge` | `number \| string` | Idade máxima de uma prova do portador. Padrão 5 minutos. |
| `now` | `number` | Sobrescrever o horário atual. Para testes e análise de replay. |

Nunca lança exceção com entrada hostil. Devolve uma união discriminada: em sucesso `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`, e em falha `{ ok: false, reason, message }` com `reason` vindo da tabela abaixo.

O `withheld` conta os claims divulgáveis que não viajaram. É útil para política, e por construção ele não consegue dizer quais eram.

**Tudo que está em `claims` descreve o titular.** Claims registrados que descrevem o token, como `iss`, `iat`, `exp` e `status`, aparecem como campos tipados no lugar, e uma disclosure que tente definir um deles, ou sobrescrever um claim que o payload já resolveu, faz a credencial inteira falhar. Ou seja, percorrer `claims` é seguro.

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

Síncrona. Devolve `{ chars, version, capacity, comfortable, errorCorrection, advice }`. A correção de erro tem padrão `M`, porque o `L` parece generoso no papel e depois falha num cartão impresso e gasto. O `version` é `null` quando nada comporta o payload, e o `advice` é uma frase que você pode imprimir direto num log de build.

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

Para emissores. Recebe `issuer`, `key`, `kid`, `alg`, `uri`, `size`, `revoked`, `suspended`, `expiresIn` e `issuedAt`, e devolve um token de lista de status assinado. Um índice fora da lista lança exceção em vez de corromper o bit de uma credencial vizinha.

### Também exportados

`pack`, `unpack` e `isEnvelope` para o envelope do QR, e `encodeBase45` e `decodeBase45` para o codec sozinho. Úteis para ferramentas; desnecessários no uso comum.

<!-- section: errors -->

## Tratamento de erros

São exatamente dois contratos, e a separação é proposital, não acidental. Aprenda estas duas frases e você consegue escrever um único bloco catch sabendo o que pode cair nele.

```sig
1. verify() nunca lança. Para qualquer entrada.
2. Todo o resto lança apenas QredentialError.
```

O motivo de serem diferentes: o `verify()` existe para receber entrada hostil, e um verificador que lança é um que alguém embrulha num `try/catch` e passa o sujeito adiante. Então ele devolve um resultado que você é obrigado a olhar. O resto falha em condições que quem chama corrige no código, onde lançar é a forma certa.

As duas regras são sustentadas por testes de propriedade que geram strings aleatórias, chaves malformadas, envelopes corrompidos e opções hostis, e afirmam que nada além disso escapa. Nenhum `SyntaxError` de um parse de JSON, nenhum `DOMException` do WebCrypto, nenhum `RangeError` de uma alocação.

### Lidar com um resultado de verificação

O resultado é uma união discriminada, então o TypeScript estreita o tipo para você:

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // estreitado: os atributos do titular
  result.withheld        // quantos claims divulgáveis não viajaram
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

Se o seu código é construído em torno de `try/catch`, passe o mesmo resultado pelo `assertVerified()`. Nada se perde: o erro lançado carrega a razão original.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // o mesmo FailReason de cima
  } else {
    throw error
  }
}
```

### Razões de recusa

Devolvidas pelo `verify()` em `result.reason`. O playground dispara cada uma delas contra o verificador para você ver acontecer.

| Razão | O que aconteceu |
|---|---|
| `malformed` | Não é credencial, ou o envelope está corrompido, ou a forma combinada está sem o separador final. |
| `unknown_issuer` | O claim `iss` não está na sua lista de confiança. |
| `unknown_key` | O emissor é confiável mas não tem chave com aquele `kid`. |
| `unsupported_alg` | O cabeçalho pede um algoritmo que a chave confiável não usa. |
| `bad_signature` | A assinatura não confere. Cobre também lista de status forjada. |
| `expired` | Passou do `exp`, além da tolerância de relógio. |
| `not_yet_valid` | Antes do `nbf`. |
| `digest_mismatch` | Uma disclosure que o emissor nunca assinou, uma enviada duas vezes, uma nomeando claim registrado, ou uma colidindo com claim já presente no payload. |
| `revoked` | O emissor ligou o bit desta credencial. Cobre suspensa também. |
| `status_unavailable` | A revogação não pôde ser determinada: lista não fornecida, ilegível, amarrada a outro emissor ou outra uri, ou índice fora dela. |
| `status_list_stale` | Sua lista em cache é mais velha que `maxStatusAge`. |
| `holder_proof_missing` | Nenhuma prova do portador foi oferecida e quem chamou não passou `acceptWithoutHolderProof`. |
| `holder_proof_invalid` | Uma prova foi oferecida e falhou: chave errada, nonce errado, audience errada, conjunto de disclosures diferente, velha, ou anexada a credencial sem chave amarrada. |

### Erros lançados

Tudo exceto o `verify()` lança `QredentialError`, que carrega um `code`. Use `isQredentialError()` em vez de `instanceof`: ele confere o formato, então continua funcionando quando duas cópias do pacote caem na mesma árvore de dependências, que é o motivo habitual de o `instanceof` parar de casar em silêncio.

| Código | Lançado por | O que aconteceu |
|---|---|---|
| `invalid_option` | `issue`, `createStatusList` | Um argumento que a API não consegue usar: nome de claim desconhecido, duração inválida, índice de status fora da lista. |
| `not_disclosable` | `present` | Você pediu para revelar um claim que o emissor nunca tornou divulgável. |
| `malformed_credential` | `present` | A forma combinada do SD-JWT está malformada. |
| `malformed_envelope` | `unpack`, `present` | O envelope do QR está malformado. Veja o `cause` para o erro de codec por baixo. |
| `malformed_status_list` | leitura de lista de status | O token não é uma lista de status legível. |
| `invalid_encoding` | `decodeBase45` | Texto que deveria ser base45 ou base64url não é, ou um segmento não é JSON. |
| `unsupported_alg` | `issue` | Um algoritmo que esta versão não implementa. |
| `unsupported_runtime` | `unpack` | A plataforma não tem algo necessário, como `DecompressionStream` em React Native antigo. |
| `crypto_failure` | `issue`, `createStatusList` | O WebCrypto recusou uma chave ou uma operação. O `DOMException` original está no `cause`. |
| `verification_failed` | `assertVerified` | Só desse helper. Carrega a `reason` original. |

### Ler o que está por baixo

Onde esta biblioteca embrulha a falha de outro, ela guarda a original na propriedade padrão `cause`, de modo que um código específico nunca te custa o detalhe:

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // o erro invalid_encoding vindo do decodificador base45
  }
}
```

> **Códigos são API, mensagens não são.** Todo valor de `code` e de `reason` é coberto por semver: um valor nunca é reaproveitado para outra coisa, e valores novos só chegam em versões minor. O texto da mensagem pode mudar num patch, então ramifique pelo código e imprima a mensagem. Um teste no repositório fixa o conjunto completo de códigos, de modo que adicionar ou remover um tem que ser ato deliberado e não efeito colateral.

<!-- section: limits -->

## O que isto não é

- **Não é carteira.** Sem interface, sem armazenamento.
- **Não é gerência de chaves.** Você traz suas chaves e sua própria distribuição de lista de confiança.
- **Ainda não é mDL ISO 18013-5.** Aquilo é CBOR e COSE, não JWT. Está no roteiro, e afirmar metade de um padrão de conformidade é pior que não afirmar nada.
- **Não foi auditado.** Implementa padrões publicados e é testado contra os ataques do playground, mas teste prova a presença de defesas, nunca que elas são completas.

O código tem cerca de 1.300 linhas sem dependência de runtime nenhuma, exatamente para que ler antes de confiar seja realista. Vulnerabilidades passam pela aba Security no GitHub, e o [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) define escopo e prazos de resposta.
