<!-- translated-from: d6f6153e6fb350ac -->
<!-- section: top -->

<!-- eyebrow -->
_Documentación_

# Credenciales que se verifican con la red apagada

<!-- lede -->
Un código QR lleva su propia prueba. `qredential` comprueba la firma, la caducidad, la revocación y los claims sin que una sola petición salga del dispositivo.

<!-- cta --> [Abrir el playground](../../playground/)

<!-- cta --> [Leer el código](https://github.com/george-veras/qredential)

<!-- section: start -->

## Primeros pasos

```ts
npm i qredential
```

Node 20 o posterior, cualquier navegador actual y React Native. Usa WebCrypto y nada específico de Node, porque quien verifica suele ser un móvil. No hay ninguna dependencia en tiempo de ejecución.

La suite completa se ejecuta en Node 20, 22 y 24, en Linux, macOS y Windows, y en Chromium, Firefox y WebKit en cada commit. Ed25519 se prueba en los cuatro.

> **Una advertencia sobre React Native.** No tiene `CompressionStream`, y emitir, presentar y verificar funcionan sin él: el sobre simplemente queda sin comprimir, lo que cuesta tamaño y nada más. *La revocación offline no funciona*, porque leer una lista de estado implica descomprimir una cadena de bits. Un verificador que no puede descomprimir la lista en caché rechaza con `status_unavailable` en lugar de tratar una lista ilegible como una lista limpia. Si necesitas revocación en React Native, añade un polyfill de `DecompressionStream`. Hay una prueba que ejecuta el flujo completo con ambos globales borrados, así que esta descripción está comprobada y no supuesta.

### Verificar algo

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### El ciclo completo

Tres partes, tres llamadas. El emisor firma una vez, el titular reduce lo que viaja, el verificador decide.

```ts
import { issue, present, verify } from 'qredential'

// 1. El emisor, una vez, cuando se concede el permiso.
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

// 2. La cartera del titular, al escanear. Revela la mayoría de edad, guarda la fecha.
const presentation = await present(credential, { disclose: ['over_18'] })

// 3. El verificador, sin conexión.
const result = await verify(presentation, { trust })
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined, y nunca salió de la cartera
```

<!-- section: disclosure -->

## Divulgación selectiva

Dos partes distintas toman dos decisiones distintas, y confundirlas es el error de diseño habitual. El **emisor** decide qué claims *pueden* ocultarse, al firmar, con `disclose`. El **titular** decide después cuáles de esos muestra realmente, al escanear, también con `disclose`. Un claim que el emisor nunca marcó no puede ocultarlo nadie.

El mecanismo es un hash corriente. Cada claim divulgable se serializa con una sal aleatoria de 128 bits, y solo el digest de esa cadena se firma dentro de la credencial. Revelar un claim significa enviar la cadena original para que el verificador la haga hash y encuentre el digest. Ocultarlo significa dejar al verificador con un digest que nunca podrá abrir.

### Divulgación anidada, en arrays y recursiva

El RFC 9901 permite las tres, y el ecosistema de la cartera europea usa las tres. La verificación aquí las resuelve a cualquier profundidad, siguiendo el modelo de procesamiento de la sección 7.1:

- Un array `_sd` dentro de un objeto anidado oculta propiedades de ese objeto.
- Un elemento de array con la forma `{"...": digest}` oculta el elemento mismo. Un elemento oculto se *elimina* del array en lugar de quedar como marcador, así que lo que recibes es un valor limpio que puedes mostrar.
- Un valor revelado puede contener a su vez cualquiera de las dos formas, así que resolver uno descubre más.

Nada de eso se filtra a `claims`: ninguna clave `_sd` ni ningún elemento `"..."` llega a quien llama. Los nombres revelados vuelven como rutas, por ejemplo `address.locality`, y todo el conjunto se comprueba en ambos sentidos contra una implementación independiente del mismo RFC.

> **Por qué esto importa en la verificación de edad.** La implementación habitual hace que el cliente suba una foto de su documento a un tercero, lo que crea una filtración esperando a ocurrir. Aquí el bar aprende un booleano y no puede aprender la fecha de nacimiento ni queriendo. Esa propiedad es criptográfica, no una promesa en una política de privacidad.

Pedir un claim que el emisor no hizo divulgable lanza una excepción, en lugar de devolver en silencio menos de lo que pediste.

<!-- section: holder -->

## Probar al titular

La divulgación selectiva prueba que el emisor firmó esos claims. Por sí sola no prueba que quien los presenta sea el titular, y la brecha no es teórica: la foto del código de otra persona lleva la misma firma y se verifica igual de bien.

El key binding la cierra. El emisor escribe la clave pública del titular dentro de la credencial, y al escanear la cartera del titular firma un desafío nuevo con la clave privada correspondiente. Una foto no puede hacer eso.

### Los tres pasos

```ts
// 1. El emisor vincula la clave pública del titular.
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. La cartera firma el desafío de este verificador, al escanear.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. El verificador comprueba que la prueba responde a su propio desafío.
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

La prueba se compromete con cuatro cosas, y cada una cierra un ataque concreto: el **nonce** impide que se reproduzca una presentación grabada, la **audience** impide que una prueba hecha para un verificador se use en otro, la **firma** la ata a la clave que el emisor vinculó, y el `sd_hash` cubre el conjunto exacto de disclosures, de modo que un intermediario no puede añadir ni quitar ninguna después de que el titular firmara. También caduca, cinco minutos por defecto, ajustable con `maxKeyBindingAge`.

### Credenciales estáticas, y por qué la decisión es tuya y en voz alta

Un código impreso en una tarjeta no puede hacer nada de esto. No hay dispositivo que firme al escanear, así que una credencial estática es copiable por naturaleza. Es una situación real y común, no un error, pero es una decisión que el verificador debería tomar sabiéndolo:

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false, y lo dice elijas lo que elijas
```

Sin esa opción, una presentación sin prueba se rechaza con `holder_proof_missing`. El valor por defecto es el estricto a propósito: el caso peligroso es alguien montando un lector de puerta, que nunca ha oído hablar del key binding, y que entrega algo que una captura de pantalla derrota. Un fallo ruidoso que nombra el problema vale más que un valor por defecto silencioso que lo esconde.

> **Optar por aceptar nunca deja pasar una prueba rota.** `acceptWithoutHolderProof` cubre el caso en que no se ofreció ninguna prueba. Si hay una presente y falla, la credencial se rechaza sin importar la opción.

### Lo que cuesta

Vincular no es gratis en términos de QR. La clave pública del titular vive en la credencial, y la prueba viaja junto a la presentación:

| Presentación | Caracteres | Versión del QR |
|---|---|---|
| estática, todo visible | ~740 | 18, se escanea bien |
| solo mayoría de edad, vinculada sin probar | ~1320 | 24, densa |
| solo mayoría de edad, con prueba del titular | ~1605 | 27, demasiado densa |

La prueba en sí ocupa unos 285 caracteres. Importa menos de lo que parece, porque una credencial capaz de key binding se está mostrando, por definición, en una pantalla, donde el código puede ser grande y brillante. El límite de densidad es un problema para tarjetas impresas y gastadas, y una tarjeta impresa nunca iba a hacer key binding de todos modos.

<!-- section: size -->

## El presupuesto de tamaño

Un código QR guarda unos 4300 caracteres alfanuméricos en su tamaño máximo, pero un código así de grande es ilegible en una tarjeta rayada o una pantalla agrietada. El techo práctico ronda la versión 20.

Esto es lo que cuesta un permiso de conducir realista. Ocho claims, caducidad a cinco años, un puntero a lista de estado, medido por `examples/sizes.mjs` en el repositorio:

| Credencial | Caracteres | Versión del QR |
|---|---|---|
| todo visible | ~740 | 18, se escanea bien |
| los ocho claims divulgables | ~1590 | 27, demasiado densa |
| presentando solo `over_18` | ~1115 | 22, todavía densa |

La fila del medio es la incómoda, y es mejor descubrirla aquí que después de imprimir tarjetas. La divulgación selectiva casi duplica la credencial, porque cada claim divulgable cuesta una sal más un digest firmado, y **los digests se quedan en el payload revele el titular el claim o no**. Es deliberado: un recuento de digests que encogiera con lo que revelas filtraría lo que ocultaste. La consecuencia práctica es que el ahorro al presentar es menor de lo que promete la intuición. Treinta por ciento aquí, no ochenta.

Así que haz divulgables solo los claims que un verificador podría necesitar ver por separado de verdad. Dos o tres, no todos. `fits()` te dice dónde estás antes de comprometerte.

> **Sobre base45.** El folclore dice que se elige por compacidad. No es así. base45 en modo alfanumérico de QR cuesta unos 8,25 bits por byte original, frente a 10,67 de base64 en modo byte y 8 exactos del binario crudo. Le gana claramente a base64 y pierde por poco frente a los bytes crudos. Los bytes crudos se descartan a propósito, porque el modo byte arrastra ambigüedad de juego de caracteres y muchos lectores devuelven una cadena corrompida. Una credencial que sobrevive a ser copiada, pegada y registrada en un log vale una penalización del tres por ciento.

<!-- section: revocation -->

## Revocación sin conexión

La revocación es la parte que las implementaciones se saltan, y entonces una credencial robada funciona para siempre.

Una lista de estado es una cadena de bits comprimida con un bit por credencial. Una lista que cubre un millón de credenciales ocupa 125 KB casi todos de ceros, que se comprimen a unos pocos kilobytes. Descárgala cuando tengas cobertura, compruébala cuando no.

```ts
// El emisor publica esto, con la periodicidad que le convenga.
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// El verificador comprueba contra su copia en caché.
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

Los rechazos merecen leerse, porque cada uno es un lugar donde una biblioteca más callada devolvería un sí falso:

- No pasaste ninguna lista, así que la revocación nunca se comprobó: `status_unavailable`
- Tu lista en caché es más vieja que `maxStatusAge`, así que no se puede descartar la revocación: `status_list_stale`
- La lista está firmada por una clave que no está en tu lista de confianza, que es como un atacante limpiaría una credencial revocada: `bad_signature`
- La lista la publicó un emisor distinto al de la credencial, o para una `uri` distinta. Un mismo índice significa algo distinto en cada lista, así que una lista sin vincular no es una respuesta: `status_unavailable`
- El índice de la credencial cae fuera de la lista que guardaste, así que no se leyó nada en realidad: `status_unavailable`

> **Un resultado limpio nunca calla sobre esto.** Cuando la revocación sí se comprobó, el resultado dice `revocationChecked: true`. Si la biblioteca no puede llegar a una respuesta real, rechaza en lugar de aprobar la credencial con esa marca puesta, porque una garantía falsa es peor que ninguna respuesta.

Qué hacer cuando no puedes estar seguro es una cuestión de política de tu despliegue, no de la biblioteca, así que `qredential` se niega a decidirla en silencio por ti. Cuando la revocación sí se comprobó, el resultado correcto lo dice con `revocationChecked: true`.

<!-- section: trust -->

## Listas de confianza

Lo único que tiene que llegar al dispositivo por otra vía es el conjunto de claves públicas de emisores en las que estás dispuesto a creer. Cambia rara vez, así que distribuirla con la aplicación y refrescarla una vez por semana es una estrategia perfectamente razonable.

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

La clave de confianza decide qué algoritmo se usa, nunca el algoritmo que nombra la cabecera de la propia credencial. Esa es toda la defensa contra la sustitución de algoritmo, y por eso `alg` vive en la clave de tu lista de confianza en lugar de inferirse.

Cómo llega la lista al dispositivo, cómo rotan las claves y dónde vive la clave privada quedan fuera del alcance. La biblioteca los recibe como entrada.

<!-- section: api -->

## Referencia de la API

Cuatro funciones cubren el ciclo de vida de la credencial, más una para emisores que publican revocación.

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| Opción | Tipo | Significado |
|---|---|---|
| `issuer` | `string` | Identificador que debe coincidir con una clave de la lista de confianza del verificador. |
| `key` | `Jwk` | Clave privada. Nunca sale de la llamada. |
| `kid` | `string` | Id de clave, escrito en la cabecera para que el verificador elija la correcta durante una rotación. |
| `alg` | `'ES256' \| 'EdDSA'` | Por defecto `ES256`, que soporta cualquier plataforma. |
| `claims` | `object` | Lo que la credencial afirma. |
| `disclose` | `string[]` | Nombres de claims que el titular puede ocultar. Todo lo demás queda siempre visible. Nombrar un claim que no existe lanza una excepción. |
| `vct` | `string` | Tipo de credencial, el `vct` de SD-JWT VC. |
| `subject` | `string` | Identificador opcional del sujeto. |
| `expiresIn` | `number \| string` | Segundos, o una duración como `'1825d'`. |
| `notBefore` | `number \| string` | Las mismas formas, para credenciales que empiezan más tarde. |
| `status` | `{ idx, uri }` | La posición de esta credencial en una lista de estado. |
| `holderKey` | `Jwk` | La clave **pública** del titular, escrita en `cnf`. Omítela solo para credenciales estáticas. Una clave que lleve componente privado se rechaza. |

Devuelve `credential` (la forma combinada del SD-JWT, guarda esta en la cartera), `qr` (el sobre escaneable), `bytes` (caracteres en `qr`) y `disclosable` (los nombres de claims que el titular puede ocultar).

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

Reduce una credencial a los claims listados y devuelve un sobre escaneable. El JWT firmado no se toca nunca, así que la firma del emisor sigue siendo válida sobre lo que queda. Acepta tanto la forma combinada como un sobre. Pedir un claim que el emisor no hizo divulgable lanza una excepción.

`disclose` recibe rutas, las mismas que `verify()` devuelve en `disclosed`:

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

Un nombre suelto es una ruta de un segmento, así que `'over_18'` significa lo que siempre significó. **Los índices de array son posiciones en la credencial tal como se emitió**, no en la presentación, de modo que un selector sigue significando lo que decía, oculte el titular lo que oculte. Y una disclosure anidada no puede viajar legalmente sin la que la contiene, así que pedir `address.locality` envía también `address`, resuelto por ti y no dejado a quien llama.

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| Opción | Tipo | Significado |
|---|---|---|
| `trust` | `TrustList` | Obligatorio. Emisores y claves en los que estás dispuesto a creer. |
| `status` | `string` | Un token de lista de estado en caché. Sin él, una credencial que apunte a una no puede liberarse. |
| `maxStatusAge` | `number \| string` | Negarse a responder a partir de una lista más vieja que esto. |
| `clockSkew` | `number` | Tolerancia en segundos para la deriva de reloj entre emisor y verificador. Por defecto 60. |
| `nonce` | `string` | El desafío que este verificador emitió para este escaneo. Obligatorio para aceptar una prueba del titular. |
| `audience` | `string` | El identificador de este verificador, comprobado contra el `aud` de la prueba. |
| `acceptWithoutHolderProof` | `boolean` | Aceptar una presentación sin prueba alguna. Necesario para credenciales estáticas, y nunca deja pasar una prueba presente y rota. |
| `maxKeyBindingAge` | `number \| string` | Antigüedad máxima de una prueba del titular. Por defecto 5 minutos. |
| `now` | `number` | Sobrescribir la hora actual. Para pruebas y análisis de repetición. |

Nunca lanza con entrada hostil. Devuelve una unión discriminada: en éxito `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`, y en fallo `{ ok: false, reason, message }` con `reason` sacado de la tabla de abajo.

`withheld` cuenta los claims divulgables que no viajaron. Es útil para políticas, y por construcción no puede decirte cuáles eran.

**Todo lo que hay en `claims` describe al sujeto.** Los claims registrados que describen el token, como `iss`, `iat`, `exp` y `status`, aparecen como campos tipados en su lugar, y una disclosure que intente fijar uno de ellos, o sobrescribir un claim que el payload ya resolvió, hace fallar la credencial entera. Así que recorrer `claims` es seguro.

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

Síncrona. Devuelve `{ chars, version, capacity, comfortable, errorCorrection, advice }`. La corrección de errores por defecto es `M`, porque `L` parece generosa sobre el papel y luego falla en una tarjeta impresa y gastada. `version` es `null` cuando nada admite el payload, y `advice` es una frase que puedes imprimir directamente en un log de compilación.

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

Para emisores. Recibe `issuer`, `key`, `kid`, `alg`, `uri`, `size`, `revoked`, `suspended`, `expiresIn` e `issuedAt`, y devuelve un token de lista de estado firmado. Un índice fuera de la lista lanza una excepción en lugar de corromper el bit de una credencial vecina.

### También exportados

`pack`, `unpack` e `isEnvelope` para el sobre del QR, y `encodeBase45` y `decodeBase45` para el códec por separado. Útiles para herramientas; innecesarios en el uso corriente.

<!-- section: errors -->

## Manejo de errores

Hay exactamente dos contratos, y la separación es deliberada, no accidental. Aprende estas dos frases y podrás escribir un solo bloque catch sabiendo qué puede caer en él.

```sig
1. verify() nunca lanza. Con cualquier entrada.
2. Todo lo demás lanza solo QredentialError.
```

La razón de que difieran: `verify()` existe para apuntarlo a entrada hostil, y un verificador que lanza es uno que alguien envuelve en un `try/catch` que deja pasar a la gente. Por eso devuelve un resultado que estás obligado a mirar. Todo lo demás falla en condiciones que quien llama arregla en el código, donde lanzar es la forma correcta.

Ambas reglas están sostenidas por pruebas de propiedad que generan cadenas aleatorias, claves malformadas, sobres corruptos y opciones hostiles, y afirman que nada más se escapa. Ningún `SyntaxError` de un parseo de JSON, ningún `DOMException` de WebCrypto, ningún `RangeError` de una reserva de memoria.

### Manejar un resultado de verificación

El resultado es una unión discriminada, así que TypeScript lo estrecha por ti:

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // estrechado: los atributos del sujeto
  result.withheld        // cuántos claims divulgables no viajaron
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

Si tu código está construido en torno a `try/catch`, pasa el mismo resultado por `assertVerified()`. No se pierde nada: el error lanzado lleva la razón original.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // el mismo FailReason de arriba
  } else {
    throw error
  }
}
```

### Razones de rechazo

Devueltas por `verify()` en `result.reason`. El playground dispara cada una de ellas contra el verificador para que las veas caer.

| Razón | Qué pasó |
|---|---|
| `malformed` | No es una credencial, o el sobre está corrupto, o la forma combinada no tiene su separador final. |
| `unknown_issuer` | El claim `iss` no está en tu lista de confianza. |
| `unknown_key` | El emisor es de confianza pero no tiene ninguna clave con ese `kid`. |
| `unsupported_alg` | La cabecera pide un algoritmo que la clave de confianza no usa. |
| `bad_signature` | La firma no cuadra. Cubre también una lista de estado falsificada. |
| `expired` | Pasado el `exp`, más allá de la tolerancia de reloj. |
| `not_yet_valid` | Antes del `nbf`. |
| `digest_mismatch` | Una disclosure que el emisor nunca firmó, una enviada dos veces, una que nombra un claim registrado, o una que choca con un claim ya presente en el payload. |
| `revoked` | El emisor activó el bit de esta credencial. Cubre también suspendida. |
| `status_unavailable` | La revocación no se pudo determinar: lista no aportada, ilegible, vinculada a otro emisor u otra uri, o índice fuera de ella. |
| `status_list_stale` | Tu lista en caché es más vieja que `maxStatusAge`. |
| `holder_proof_missing` | No se ofreció ninguna prueba del titular y quien llamó no pasó `acceptWithoutHolderProof`. |
| `holder_proof_invalid` | Se ofreció una prueba y falló: clave equivocada, nonce equivocado, audience equivocada, un conjunto de disclosures distinto, caducada, o adjunta a una credencial sin clave vinculada. |

### Errores lanzados

Todo salvo `verify()` lanza `QredentialError`, que lleva un `code`. Usa `isQredentialError()` en vez de `instanceof`: comprueba la forma, así que sigue funcionando cuando dos copias del paquete acaban en el mismo árbol de dependencias, que es la razón habitual de que `instanceof` deje de coincidir en silencio.

| Código | Lanzado por | Qué pasó |
|---|---|---|
| `invalid_option` | `issue`, `createStatusList` | Un argumento que la API no puede usar: un nombre de claim desconocido, una duración inválida, un índice de estado fuera de la lista. |
| `not_disclosable` | `present` | Pediste revelar un claim que el emisor nunca hizo divulgable. |
| `malformed_credential` | `present` | La forma combinada del SD-JWT está malformada. |
| `malformed_envelope` | `unpack`, `present` | El sobre del QR está malformado. Mira `cause` para el error de códec de debajo. |
| `malformed_status_list` | lectura de lista de estado | El token no es una lista de estado legible. |
| `invalid_encoding` | `decodeBase45` | Texto que debería ser base45 o base64url no lo es, o un segmento no es JSON. |
| `unsupported_alg` | `issue` | Un algoritmo que esta versión no implementa. |
| `unsupported_runtime` | `unpack` | A la plataforma le falta algo necesario, como `DecompressionStream` en React Native antiguo. |
| `crypto_failure` | `issue`, `createStatusList` | WebCrypto rechazó una clave o una operación. El `DOMException` original está en `cause`. |
| `verification_failed` | `assertVerified` | Solo de ese helper. Lleva la `reason` original. |

### Leer lo que hay debajo

Donde esta biblioteca envuelve el fallo de otro, guarda el original en la propiedad estándar `cause`, de modo que un código concreto nunca te cuesta el detalle:

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // el error invalid_encoding del decodificador base45
  }
}
```

> **Los códigos son API, los mensajes no.** Cada valor de `code` y de `reason` está cubierto por semver: un valor nunca se reutiliza para otra cosa, y los nuevos llegan solo en versiones menores. El texto del mensaje puede cambiar en un parche, así que ramifica por el código e imprime el mensaje. Una prueba del repositorio fija el conjunto completo de códigos, de modo que añadir o quitar uno tiene que ser un acto deliberado y no un efecto secundario.

<!-- section: limits -->

## Lo que esto no es

- **No es una cartera.** Sin interfaz, sin almacenamiento.
- **No es gestión de claves.** Tú traes tus claves y tu propia distribución de lista de confianza.
- **Todavía no es mDL ISO 18013-5.** Eso es CBOR y COSE, no JWT. Está en la hoja de ruta, y afirmar la mitad de un estándar de conformidad es peor que no afirmar nada.
- **No está auditado.** Implementa estándares publicados y se prueba contra los ataques del playground, pero las pruebas demuestran la presencia de defensas, nunca que sean completas.

El código son unas 700 líneas sin ninguna dependencia en tiempo de ejecución, precisamente para que leerlo antes de confiar en él sea realista. Las vulnerabilidades pasan por la pestaña Security de GitHub, y [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) fija el alcance y los plazos de respuesta.
