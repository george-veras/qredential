<!-- section: statement -->

<!-- eyebrow -->
*Accessibility*

# This site, measured against WCAG 2.2 AA

<!-- lede -->
Every page of this site is intended to conform to [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at
Level AA. This page says what that claim rests on, and what it does not.

<!-- section: scope -->

## What the claim covers

All thirty six pages of this site, in all nine languages: the landing page, the documentation, the
playground and this statement. Both the light and the dark theme. Last evaluated on 17 September 2026, against the
version of the site published that day.

[![Level AA conformance, W3C WAI Web Content Accessibility Guidelines 2.2](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

The logo above is a self-declaration. W3C publishes it for anyone to use and neither reviews
nor verifies any claim made with it, which is the reason the rest of this page exists.

<!-- section: method -->

## How it was evaluated

Four ways, all of them repeatable, and all of them run again on every change by continuous
integration:

- **Rule engine.** `axe-core` against thirty nine page loads, covering all thirty six pages in nine
  languages, plus one page of each shape in the dark theme, checking the tags that map to WCAG 2.2
  Level A and AA.
- **Criteria a rule engine cannot see.** A browser driven deliberately: the page reflowed to 320
  CSS pixels, text resized to 200 percent, the text spacing overrides the standard specifies,
  focus indicators compared before and after focus, focused controls checked against anything that
  might sit over them, every pointer target measured against the 24 by 24 minimum, and every
  control checked for an accessible name.
- **Keyboard.** That the skip link is the first thing a keyboard reaches on every page, and that
  using it moves focus into the content rather than only scrolling the page.
- **By hand, criterion by criterion.** All fifty five Level A and AA success criteria of WCAG 2.2,
  each one recorded with its verdict and the evidence behind it, in
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md).

<!-- section: limits -->

## What it does not cover

Stated plainly, because a conformance claim is worth exactly what its limits are worth:

- **No testing with assistive technology.** No screen reader was used, and no disabled person has
  tested this site. Structure was verified by inspecting the accessibility tree, which is not the
  same thing as listening to it.
- **No third party audit.** Nobody independent has checked any of this, the same way nobody
  independent has audited the library's cryptography.
- Automated testing covers roughly a third of what WCAG asks for. The other three methods above
  exist because of that, and they are still not a substitute for a person who depends on this.

<!-- section: known -->

## Known limitations

- **The QR code is an image of data.** No assistive technology can read one, and none should have
  to: the caption beside it gives its version and character count, and every value it encodes is
  printed as text on the same page.
- **The playground needs JavaScript**, because it runs the library in the reader's own browser,
  which is the entire point of it. The documentation and the landing page do not: their content is
  in the HTML.

<!-- section: report -->

## If you find something wrong

Being told is the only way this improves. Open an issue at
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues),
or say so in whatever way is easiest for you. A description of what happened is enough; naming the
success criterion is welcome but never required.

<!-- cta --> [Report an accessibility problem](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [Read the full evaluation](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
