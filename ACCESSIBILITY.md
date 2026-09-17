# WCAG 2.2 Level AA evaluation

The evidence behind the claim made at
[qredential.js.org/accessibility](https://qredential.js.org/accessibility/). Every Level A and Level
AA success criterion of [WCAG 2.2](https://www.w3.org/TR/WCAG22/), with a verdict and what it rests
on. WCAG 2.2 has 31 Level A and 24 Level AA criteria; 4.1.1 Parsing was removed in 2.2 and is not
listed.

- **Scope**: all 36 pages of the site, in 9 languages, in both themes.
- **Evaluated**: 17 September 2026.
- **By**: George Veras Valentim, with Claude Opus 5.
- **How**: `axe-core` 4.13 (`npm run check:a11y`), browser driven tests for the criteria a rule
  engine cannot see, keyboard operation, and inspection of the accessibility tree.
- **Not done**: no screen reader, no testing by disabled people, no third party audit. See the
  statement page, which says so in all nine languages.

Verdicts are `pass`, `n/a` when the site has nothing the criterion applies to, and would be `fail`
if anything were outstanding. Nothing is outstanding on the evaluated date. `n/a` is used honestly:
a criterion about video is not passed by a site with no video, it is simply not engaged.

## 1. Perceivable

| Criterion | Level | Verdict | Evidence |
|---|---|---|---|
| 1.1.1 Non-text Content | A | pass | The flow diagram is a `role="img"` with a translated `aria-label` describing the whole diagram, verified in all 9 languages. The guilloche canvas is decorative and `aria-hidden`. The QR is an image of data: its `svg` is `aria-hidden` and the caption beside it carries the version and character count, while every value it encodes is printed as text on the same page. No `img` elements. |
| 1.2.1 Audio-only and Video-only | A | n/a | No audio or video. |
| 1.2.2 Captions (Prerecorded) | A | n/a | No audio or video. |
| 1.2.3 Audio Description or Media Alternative | A | n/a | No audio or video. |
| 1.2.4 Captions (Live) | AA | n/a | No live media. |
| 1.2.5 Audio Description (Prerecorded) | AA | n/a | No audio or video. |
| 1.3.1 Info and Relationships | A | pass | Headings, lists and tables are marked up as such; the guide's tables use `th`. Checked by `axe-core` across 30 page loads. Every control has an accessible name, checked separately in `check:a11y`. |
| 1.3.2 Meaningful Sequence | A | pass | DOM order follows reading order on all four page shapes; there is no CSS reordering of content. Verified by reading the generated markup and by tabbing through. |
| 1.3.3 Sensory Characteristics | A | pass | No instruction depends on shape, position, size or sound. The one use of "below" in the guide refers to a code sample that immediately follows it and is also named. |
| 1.3.4 Orientation | AA | pass | No orientation lock. |
| 1.3.5 Identify Input Purpose | AA | n/a | No input collects information about the user. The playground's only text input takes a credential to verify. |
| 1.4.1 Use of Color | A | pass | The verdict shows a word as well as a colour, in every language. Links surrounded by text are underlined, checked in the browser: the two that exist are "What that means" in the footer and "SECURITY.md" in the guide. Nav, language and button rows are not links inside a sentence, so the criterion is not engaged by them. |
| 1.4.2 Audio Control | A | n/a | Nothing plays audio. |
| 1.4.3 Contrast (Minimum) | AA | pass | Every pair checked by `axe-core` in both themes. The muted text token is #596968, whose tightest ratio on any background it is used on is 4.51:1. The QR caption and plate note use a fixed --plate-ink because the plate is white in both themes. |
| 1.4.4 Resize Text | AA | pass | Text set to 200% on three page shapes in English, German and Japanese, checked for clipped or lost text. |
| 1.4.5 Images of Text | AA | pass | No images of text. The share cards are metadata, not page content. |
| 1.4.10 Reflow | AA | pass | Every page shape reflowed to 320 CSS pixels in three languages, asserting the document does not scroll sideways. Tables, code samples and the wire strip scroll inside their own box, which the criterion allows, and each is reachable by keyboard. |
| 1.4.11 Non-text Contrast | AA | pass | The focus indicator is a 2px solid outline in #2C6675, which is 5.39:1 on the lightest background and 6.32:1 on the plate; in the dark theme it is #63AABC at 6.53:1 and better. Control borders use --line against --ground and --panel. |
| 1.4.12 Text Spacing | AA | pass | The four overrides the criterion specifies applied to three page shapes in three languages, checked for clipping. |
| 1.4.13 Content on Hover or Focus | AA | n/a | Nothing appears on hover or focus. The only `title` attribute in the site is on the RSS `link` element, which renders nothing. |

## 2. Operable

| Criterion | Level | Verdict | Evidence |
|---|---|---|---|
| 2.1.1 Keyboard | A | pass | Every control is a native link, button or input. The three scrollable regions, the guide's function signatures, its table wrappers and the playground's wire strip, carry `tabindex="0"` so they can be scrolled from the keyboard. |
| 2.1.2 No Keyboard Trap | A | pass | No focus trap: nothing captures keys, there is no modal, and tabbing leaves every scrollable region. |
| 2.1.4 Character Key Shortcuts | A | n/a | No single character shortcuts. |
| 2.2.1 Timing Adjustable | A | n/a | No time limits. |
| 2.2.2 Pause, Stop, Hide | A | pass | Nothing moves, blinks or auto-updates. The guilloche is drawn once and redrawn only on resize; the demo writes its result once. |
| 2.3.1 Three Flashes or Below Threshold | A | pass | Nothing flashes. |
| 2.4.1 Bypass Blocks | A | pass | A translated skip link is the first focusable element on every page. `check:a11y` asserts both that it is first and that activating it moves focus to `#content` rather than only scrolling. |
| 2.4.2 Page Titled | A | pass | Every page has a title describing it in its own language. `check:seo` fails the build if two pages of the same shape share a title, which is how the first version of this site shipped nine identical English ones. |
| 2.4.3 Focus Order | A | pass | Focus order is DOM order, which matches the visual order. Skip link first, masthead, content, footer. |
| 2.4.4 Link Purpose (In Context) | A | pass | Every link's text says where it goes. Language links are the language's own name in its own script. |
| 2.4.5 Multiple Ways | AA | pass | Four ways to any page: the masthead on every page, the footer, the table of contents on prose pages, and the sitemap. |
| 2.4.6 Headings and Labels | AA | pass | Headings describe their sections in each language; the playground has a level one heading naming the page. |
| 2.4.7 Focus Visible | AA | pass | Every focusable element was focused in the browser and its computed style compared before and after, on three page shapes in three languages. |
| 2.4.11 Focus Not Obscured (Minimum) | AA | pass | After focusing each control, the topmost element at its position is checked to be the control itself. The guide and this statement have a sticky masthead, which covered whatever focus scrolled to the top of the window until `scroll-padding-top` was set to clear it. The check found that on a second run, after an unrelated change moved the layout; the first run had reported the masthead as not sticky, which was wrong. |
| 2.5.1 Pointer Gestures | A | n/a | No path based or multipoint gestures. |
| 2.5.2 Pointer Cancellation | A | pass | Every control acts on click, not on pointerdown. |
| 2.5.3 Label in Name | A | pass | Accessible names are the visible text, with no `aria-label` overriding a visible label. |
| 2.5.4 Motion Actuation | A | n/a | Nothing responds to device motion. |
| 2.5.7 Dragging Movements | AA | n/a | Nothing is operated by dragging. |
| 2.5.8 Target Size (Minimum) | AA | pass | Every pointer target measured in the browser. Nav links, the language rows, footer links, the table of contents, the skip link and the language bar were all brought to at least 24 by 24; the playground's checkboxes went from 16 to 24. |

## 3. Understandable

| Criterion | Level | Verdict | Evidence |
|---|---|---|---|
| 3.1.1 Language of Page | A | pass | Every page declares its language on `html`. Chinese uses a regional tag, zh-CN and zh-TW, which is also what Baidu reads. |
| 3.1.2 Language of Parts | AA | pass | Prose is wholly in the page's language. The identifiers, error codes and code samples that appear in English are programming text and technical terms, which the criterion does not treat as a change of human language. |
| 3.2.1 On Focus | A | pass | Focus changes nothing but the focus indicator. |
| 3.2.2 On Input | A | pass | Changing a playground checkbox re-issues the demo credential on the same page. No new window, no focus move, no submission. |
| 3.2.3 Consistent Navigation | AA | pass | The same masthead in the same order on every page, generated from one template per shape. |
| 3.2.4 Consistent Identification | AA | pass | The same thing is called the same name everywhere, including across the nine translations, because every string comes from one catalogue per language. |
| 3.2.6 Consistent Help | A | pass | The way to report a problem is in the same place on every page: the footer, linking to the statement, which links to the issue tracker. |
| 3.3.1 Error Identification | A | pass | The playground names every rejection in text, with the error code, not by colour alone. |
| 3.3.2 Labels or Instructions | A | pass | Every input has a programmatically associated label, checked in the browser on every page shape. |
| 3.3.3 Error Suggestion | AA | n/a | No form the reader can fill in wrongly. The playground's paste box accepts any text and explains what it found. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | n/a | No transaction, no legal commitment, no data the reader can delete. |
| 3.3.7 Redundant Entry | A | n/a | Nothing is entered twice. |
| 3.3.8 Accessible Authentication (Minimum) | AA | n/a | No authentication. |

## 4. Robust

| Criterion | Level | Verdict | Evidence |
|---|---|---|---|
| 4.1.2 Name, Role, Value | A | pass | Native elements throughout. `axe-core` checks roles and names on 30 page loads; `check:a11y` separately asserts every control has an accessible name. |
| 4.1.3 Status Messages | AA | pass | The landing's verdict and the playground's verdict are `role="status"`. Both appear without moving focus, which is the case this criterion exists for, and no automated tool can see one missing. |

## What would change this

Any of these should be reported as a defect, at
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues):

- A screen reader announcing something wrong, which nothing here has tested.
- A criterion marked `n/a` that the site has since started engaging.
- A verdict whose evidence no longer holds.

`npm run check:a11y` re-runs the mechanical half of this on every change, in continuous
integration. It covers roughly the criteria marked as checked by a tool above, which is not the
whole table, which is why this file exists.
