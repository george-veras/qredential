import { QredentialError } from './errors.js'

const UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600,
}

/** Accepts seconds as a number, or a short form like '30d', '12h', '90s'. */
export function seconds(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new QredentialError('invalid_option', `invalid duration: ${value}`)
    return Math.floor(value)
  }
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w|y)$/.exec(value.trim())
  if (!match) throw new QredentialError('invalid_option', `invalid duration: ${JSON.stringify(value)}`)
  return Math.floor(Number(match[1]) * UNITS[match[2]!]!)
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
