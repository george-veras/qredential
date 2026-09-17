<!-- translated-from: 48cad2b0114eb74e -->
<!-- section: statement -->

<!-- eyebrow -->
*Barrierefreiheit*

# Diese Website, gemessen an WCAG 2.2 AA

<!-- lede -->
Jede Seite dieser Website soll [WCAG 2.2](https://www.w3.org/TR/WCAG22/) auf Stufe AA entsprechen.
Diese Seite sagt, worauf diese Behauptung beruht, und worauf nicht.

<!-- section: scope -->

## Was die Behauptung abdeckt

Alle sechsunddreißig Seiten dieser Website, in allen neun Sprachen: die Startseite, die
Dokumentation, das Playground und diese Erklärung. Beide Themes, hell und dunkel. Zuletzt geprüft am 17. September
2026, gegen die an jenem Tag veröffentlichte Fassung.

[![Konformität Stufe AA, W3C WAI Richtlinien für barrierefreie Webinhalte 2.2](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

Das Logo oben ist eine Selbsterklärung. Das W3C veröffentlicht es zur freien Verwendung und prüft
keine damit erhobene Behauptung, was genau der Grund ist, warum es den Rest dieser Seite gibt.

<!-- section: method -->

## Wie geprüft wurde

Auf vier Wegen, alle wiederholbar, und alle laufen bei jeder Änderung erneut in der Continuous
Integration:

- **Regel-Engine.** `axe-core` über neununddreißig Seitenaufrufe, über alle sechsunddreißig Seiten in neun
  Sprachen, dazu je eine Seite jeder Form im dunklen Theme, geprüft auf die Kennzeichnungen, die
  WCAG 2.2 Stufe A und AA entsprechen.
- **Kriterien, die keine Regel-Engine sieht.** Ein bewusst gesteuerter Browser: die Seite auf 320
  CSS-Pixel umgebrochen, Text auf 200 Prozent vergrößert, die Textabstände, die der Standard
  vorgibt, Fokusanzeigen vor und nach dem Fokus verglichen, fokussierte Bedienelemente gegen alles
  geprüft, was darüber liegen könnte, jedes Zeigerziel gegen das Minimum von 24 mal 24 gemessen, und
  jedes Bedienelement auf einen zugänglichen Namen geprüft.
- **Tastatur.** Dass der Sprunglink auf jeder Seite das Erste ist, was eine Tastatur erreicht, und
  dass er den Fokus in den Inhalt bewegt und nicht nur die Seite scrollt.
- **Von Hand, Kriterium für Kriterium.** Alle fünfundfünfzig Erfolgskriterien der Stufen A und AA
  von WCAG 2.2, jedes mit seinem Urteil und dem Beleg dahinter festgehalten, in
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md).

<!-- section: limits -->

## Was sie nicht abdeckt

Klar gesagt, denn eine Konformitätserklärung ist genau so viel wert wie ihre Grenzen:

- **Keine Tests mit assistiver Technik.** Es wurde kein Screenreader verwendet, und keine Person mit
  Behinderung hat diese Website getestet. Die Struktur wurde durch Einsicht in den
  Accessibility-Baum geprüft, was nicht dasselbe ist, wie ihn zu hören.
- **Kein externes Audit.** Niemand Unabhängiges hat irgendetwas davon geprüft, genauso wenig wie
  jemand Unabhängiges die Kryptografie der Bibliothek geprüft hat.
- Automatisierte Tests decken etwa ein Drittel dessen ab, was WCAG verlangt. Die anderen drei
  Methoden gibt es deshalb, und sie ersetzen trotzdem keine Person, die darauf angewiesen ist.

<!-- section: known -->

## Bekannte Einschränkungen

- **Der QR-Code ist ein Bild von Daten.** Keine assistive Technik kann einen lesen, und keine sollte
  es müssen: die Beschriftung daneben nennt Version und Zeichenzahl, und jeder Wert, den er
  kodiert, steht als Text auf derselben Seite.
- **Das Playground braucht JavaScript**, weil es die Bibliothek im Browser der lesenden Person
  ausführt, was genau sein Zweck ist. Dokumentation und Startseite brauchen es nicht: ihr Inhalt
  steht im HTML.

<!-- section: report -->

## Wenn Sie etwas Falsches finden

Bescheid zu bekommen ist der einzige Weg, wie das besser wird. Öffnen Sie ein Issue unter
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues), oder sagen Sie es so, wie es Ihnen am
leichtesten fällt. Eine Beschreibung dessen, was passiert ist, genügt; das Erfolgskriterium zu
benennen ist willkommen, aber nie verlangt.

<!-- cta --> [Ein Barrierefreiheitsproblem melden](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [Die vollständige Prüfung lesen](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
