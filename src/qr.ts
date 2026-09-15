/**
 * Character capacity of a QR code in alphanumeric mode, versions 1 to 40, per ISO/IEC 18004.
 *
 * base45 output is alphanumeric-safe by construction, which is the reason to use it. Worth being
 * precise about what that buys, because the folklore overstates it: base45 in alphanumeric mode
 * costs about 8.25 bits per original byte, against 10.67 for base64 in byte mode, and 8 flat for
 * raw binary in byte mode. So it beats base64 clearly and loses slightly to raw bytes. Raw bytes
 * are given up on purpose: byte mode carries charset ambiguity, and plenty of scanners hand back a
 * mangled string. A credential that survives being copied, pasted and logged is worth a 3% size
 * penalty.
 */
const CAPACITY = {
  L: [25, 47, 77, 114, 154, 195, 224, 279, 335, 395, 468, 535, 619, 667, 758, 854, 938, 1046, 1153, 1249, 1352, 1460, 1588, 1704, 1853, 1990, 2132, 2223, 2369, 2520, 2677, 2840, 3009, 3183, 3351, 3537, 3729, 3927, 4087, 4296],
  M: [20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656, 734, 816, 909, 970, 1035, 1134, 1248, 1326, 1451, 1542, 1637, 1732, 1839, 1994, 2113, 2238, 2369, 2506, 2632, 2780, 2894, 3054, 3220, 3391],
  Q: [16, 29, 47, 67, 87, 108, 125, 157, 189, 221, 259, 296, 352, 376, 426, 470, 531, 574, 644, 702, 742, 823, 890, 963, 1041, 1094, 1172, 1263, 1322, 1429, 1499, 1618, 1700, 1787, 1867, 1966, 2071, 2181, 2298, 2420],
  H: [10, 20, 35, 50, 64, 84, 93, 122, 143, 174, 200, 227, 259, 283, 321, 365, 408, 452, 493, 557, 587, 640, 672, 744, 779, 864, 910, 958, 1016, 1080, 1150, 1226, 1307, 1394, 1431, 1530, 1591, 1658, 1774, 1852],
} as const

export type ErrorCorrection = keyof typeof CAPACITY

/** Above this version the modules get small enough that cheap cameras and cracked screens struggle. */
const COMFORTABLE_VERSION = 20

export interface FitResult {
  chars: number
  /** Smallest QR version that holds the payload, or null when nothing does. */
  version: number | null
  capacity: number | null
  /** True when it fits at a version that scans reliably on a phone in bad light. */
  comfortable: boolean
  errorCorrection: ErrorCorrection
  advice: string
}

/**
 * Check a payload against real QR limits before you design a credential you cannot print.
 *
 * Error correction level M is the default because that is what almost every real deployment uses:
 * L looks generous on paper and then fails on a scuffed printed card.
 */
export function fits(payload: string, errorCorrection: ErrorCorrection = 'M'): FitResult {
  const table = CAPACITY[errorCorrection]
  const chars = payload.length

  let version: number | null = null
  let capacity: number | null = null
  for (let i = 0; i < table.length; i++) {
    if (chars <= table[i]!) {
      version = i + 1
      capacity = table[i]!
      break
    }
  }

  if (version === null) {
    return {
      chars,
      version: null,
      capacity: null,
      comfortable: false,
      errorCorrection,
      advice: `${chars} characters does not fit in any QR code at level ${errorCorrection}. Move claims out of the credential or make them selectively disclosable.`,
    }
  }

  const comfortable = version <= COMFORTABLE_VERSION
  return {
    chars,
    version,
    capacity,
    comfortable,
    errorCorrection,
    advice: comfortable
      ? `Fits QR version ${version} at level ${errorCorrection}, with ${capacity! - chars} characters to spare.`
      : `Fits QR version ${version}, which is dense enough that scanning gets unreliable on worn cards and cheap cameras. Aim for version ${COMFORTABLE_VERSION} or below.`,
  }
}
