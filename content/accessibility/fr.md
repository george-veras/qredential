<!-- translated-from: 48cad2b0114eb74e -->
<!-- section: statement -->

<!-- eyebrow -->
*Accessibilité*

# Ce site, mesuré face au WCAG 2.2 AA

<!-- lede -->
Toutes les pages de ce site visent la conformité au [WCAG 2.2](https://www.w3.org/TR/WCAG22/) au
niveau AA. Cette page dit sur quoi cette affirmation repose, et sur quoi elle ne repose pas.

<!-- section: scope -->

## Ce que l'affirmation couvre

Les trente-six pages de ce site, dans les neuf langues : la page d'accueil, la documentation, le
playground et cette déclaration. Les deux thèmes, clair et sombre. Dernière évaluation le 17 septembre 2026, face à la
version publiée ce jour-là.

[![Conformité niveau AA, Règles pour l'accessibilité des contenus Web 2.2 du W3C WAI](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

Le logo ci-dessus est une auto-déclaration. Le W3C le publie pour que chacun puisse l'utiliser et
ne vérifie aucune affirmation faite avec lui, ce qui est précisément la raison d'être du reste de
cette page.

<!-- section: method -->

## Comment cela a été évalué

De quatre façons, toutes reproductibles, et toutes relancées à chaque changement par l'intégration
continue :

- **Moteur de règles.** `axe-core` sur trente-neuf chargements de page, couvrant les trente-six pages
  dans neuf langues, plus une page de chaque forme en thème sombre, en vérifiant les marqueurs qui
  correspondent au WCAG 2.2 niveaux A et AA.
- **Les critères qu'aucun moteur de règles ne voit.** Un navigateur piloté délibérément : la page
  redistribuée à 320 pixels CSS, le texte agrandi à 200 pour cent, les réglages d'espacement du
  texte que la norme précise, les indicateurs de focus comparés avant et après, les contrôles
  focalisés confrontés à ce qui pourrait les recouvrir, chaque cible de pointeur mesurée face au
  minimum de 24 sur 24, et chaque contrôle vérifié pour son nom accessible.
- **Clavier.** Que le lien d'évitement soit la première chose qu'un clavier atteint sur chaque page,
  et que l'activer déplace le focus dans le contenu au lieu de seulement faire défiler la page.
- **À la main, critère par critère.** Les cinquante-cinq critères de succès de niveau A et AA du WCAG
  2.2, chacun consigné avec son verdict et la preuve derrière, dans
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md).

<!-- section: limits -->

## Ce qu'elle ne couvre pas

Dit sans détour, parce qu'une déclaration de conformité vaut exactement ce que valent ses limites :

- **Aucun test avec une technologie d'assistance.** Aucun lecteur d'écran n'a été utilisé, et
  aucune personne handicapée n'a testé ce site. La structure a été vérifiée en inspectant l'arbre
  d'accessibilité, ce qui n'est pas la même chose que de l'écouter.
- **Aucun audit externe.** Personne d'indépendant n'a vérifié tout cela, de la même façon que
  personne d'indépendant n'a audité la cryptographie de la bibliothèque.
- Les tests automatisés couvrent environ un tiers de ce que demande le WCAG. Les trois autres
  méthodes existent pour cette raison, et ne remplacent toujours pas une personne qui en dépend.

<!-- section: known -->

## Limites connues

- **Le code QR est une image de données.** Aucune technologie d'assistance ne peut en lire un, et
  aucune ne devrait avoir à le faire : la légende à côté donne sa version et son nombre de
  caractères, et chaque valeur qu'il encode est imprimée en texte sur la même page.
- **Le playground a besoin de JavaScript**, puisqu'il exécute la bibliothèque dans le navigateur du
  lecteur, ce qui est tout son intérêt. La documentation et la page d'accueil n'en ont pas besoin :
  leur contenu est dans le HTML.

<!-- section: report -->

## Si vous trouvez quelque chose qui ne va pas

Nous le dire est le seul moyen que cela s'améliore. Ouvrez un ticket sur
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues), ou dites-le de la façon qui vous
convient. Une description de ce qui s'est passé suffit ; nommer le critère de succès est bienvenu,
mais jamais exigé.

<!-- cta --> [Signaler un problème d'accessibilité](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [Lire l'évaluation complète](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
