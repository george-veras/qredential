// Tells the search engines that take a push notification that the site changed.
//
// Run with: node scripts/indexnow.mjs   (the pages workflow runs it after every deploy)
//
// IndexNow is the one discovery protocol here that needs no account anywhere: the key is whatever
// you generate, and serving it at keyLocation is the entire proof of ownership. One POST reaches
// Bing, Naver, Yandex, Seznam and Yep, which is Korea, Russia, central Europe and everything
// downstream of Bing. Google does not participate and says the sitemap is the channel it reads, so
// nothing here is aimed at Google.
//
// The site lives in a subdirectory of a shared github.io host, so keyLocation is mandatory: it is
// what limits this key to /qredential/ and stops it from being able to speak for the rest of the
// domain.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { indexnow: key } = JSON.parse(await readFile(join(root, 'content/seo.json'), 'utf8'))

const sitemap = await readFile(join(root, 'docs/sitemap.xml'), 'utf8')
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
if (urlList.length === 0) throw new Error('sitemap.xml has no <loc>, refusing to submit nothing')

const host = new URL(urlList[0]).host
const base = new URL(urlList[0]).pathname.replace(/\/$/, '')

const body = {
  host,
  key,
  keyLocation: `https://${host}${base}/${key}.txt`,
  urlList,
}

const res = await fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
})

// 200 accepted, 202 accepted but the key is still being checked. Anything else is worth printing
// but is never worth failing a deploy over: the sitemap still says everything this said.
const text = await res.text()
console.log(`IndexNow ${res.status} for ${urlList.length} URLs on ${host}${base}`)
if (text.trim()) console.log(text.trim().slice(0, 500))
if (res.status !== 200 && res.status !== 202) process.exitCode = 1
