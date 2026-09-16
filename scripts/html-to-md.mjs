// One time conversion of the hand written English guide into Markdown, so that content and design
// stop being the same file. Written against the exact markup in this repository rather than as a
// general converter: it is thrown away once the content lives in content/.
import { readFile, writeFile } from 'node:fs/promises'

const src = await readFile(process.argv[2], 'utf8')
const body = src.slice(src.indexOf('<article>'), src.indexOf('</article>'))

const unescape = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')

const inline = (s) =>
  unescape(
    s
      .replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
      .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
      .replace(/<em>([\s\S]*?)<\/em>/g, '*$1*')
      .replace(/<span class="reason">([\s\S]*?)<\/span>/g, '`$1`')
      .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
      .replace(/<br\s*\/?>/g, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()

const out = []
const push = (s) => out.push(s)

// Sections in order, each one a heading plus its blocks.
for (const [, id, inner] of body.matchAll(/<section id="([^"]+)">([\s\S]*?)<\/section>/g)) {
  push(`<!-- section: ${id} -->`)

  // Tables live inside a scrolling wrapper, so unwrap those before walking the blocks.
  const flat = inner.replace(/<div class="tablewrap"[^>]*>([\s\S]*?)<\/div>/g, '$1')

  for (const m of flat.matchAll(
    /<(h1|h2|h3|p|pre|ul|ol|div|table)\b([^>]*)>([\s\S]*?)<\/\1>/g
  )) {
    const [, tag, attrs, content] = m
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? ''

    if (tag === 'h1') push(`# ${inline(content)}`)
    else if (tag === 'h2') push(`## ${inline(content)}`)
    else if (tag === 'h3') push(`### ${inline(content)}`)
    else if (tag === 'p' && cls.includes('eyebrow')) push(`<!-- eyebrow -->\n_${inline(content)}_`)
    else if (tag === 'p' && cls.includes('lede')) push(`<!-- lede -->\n${inline(content)}`)
    else if (tag === 'p') push(inline(content))
    else if (tag === 'pre') {
      const code = /<code>([\s\S]*?)<\/code>/.exec(content)?.[1] ?? content
      push('```ts\n' + unescape(code.replace(/<[^>]+>/g, '')).trim() + '\n```')
    } else if (tag === 'div' && cls.includes('signature')) {
      push('```sig\n' + unescape(content.replace(/<[^>]+>/g, '')).trim() + '\n```')
    } else if (tag === 'div' && cls.includes('aside')) {
      push(
        inline(content)
          .split('. ')
          .reduce((acc, s, i, a) => acc + s + (i < a.length - 1 ? '. ' : ''), '> ')
      )
    } else if (tag === 'ul' || tag === 'ol') {
      const marker = tag === 'ul' ? '-' : '1.'
      const items = [...content.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => `${marker} ${inline(li[1])}`)
      if (items.length) push(items.join('\n'))
    } else if (tag === 'div' && cls.includes('cta-row')) {
      for (const a of content.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        push(`<!-- cta --> [${inline(a[2])}](${a[1]})`)
      }
    } else if (tag === 'table') {
      const rows = []
      for (const tr of content.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        // A pipe inside a cell ends the cell, even inside a code span, so union types like
        // `number | string` silently eat the column after them. GFM wants it escaped.
        const cells = [...tr[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((c) =>
          inline(c[2]).replace(/\|/g, '\\|')
        )
        if (cells.length) rows.push(cells)
      }
      if (rows.length) {
        // One block, not one per row: the blocks are joined with a blank line later, and a blank
        // line inside a table is what stops Markdown seeing it as a table at all.
        const lines = [
          `| ${rows[0].join(' | ')} |`,
          `|${rows[0].map(() => '---').join('|')}|`,
          ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
        ]
        push(lines.join('\n'))
      }
    }
  }
}

await writeFile(process.argv[3], out.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n')
console.log(`${process.argv[3]}: ${out.length} blocos`)
