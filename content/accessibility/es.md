<!-- translated-from: 48cad2b0114eb74e -->
<!-- section: statement -->

<!-- eyebrow -->
*Accesibilidad*

# Este sitio, medido frente a WCAG 2.2 AA

<!-- lede -->
Todas las páginas de este sitio pretenden cumplir [WCAG 2.2](https://www.w3.org/TR/WCAG22/) en el
nivel AA. Esta página dice en qué se apoya esa afirmación, y en qué no.

<!-- section: scope -->

## Qué cubre la afirmación

Las treinta y seis páginas de este sitio, en los nueve idiomas: la página de inicio, la documentación,
el playground y esta declaración. Los dos temas, claro y oscuro. Última evaluación el 17 de septiembre de 2026, contra
la versión publicada ese día.

[![Conformidad de nivel AA, Pautas de Accesibilidad para el Contenido Web 2.2 del W3C WAI](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

El logotipo de arriba es una autodeclaración. El W3C lo publica para que cualquiera lo use y no
revisa ni verifica ninguna afirmación hecha con él, que es justamente por lo que existe el resto de
esta página.

<!-- section: method -->

## Cómo se evaluó

De cuatro maneras, todas repetibles, y todas ejecutadas de nuevo con cada cambio por la integración
continua:

- **Motor de reglas.** `axe-core` contra treinta y nueve cargas de página, cubriendo las treinta y seis páginas
  en nueve idiomas, más una página de cada forma en el tema oscuro, comprobando las etiquetas que
  corresponden a WCAG 2.2 niveles A y AA.
- **Criterios que ningún motor de reglas ve.** Un navegador dirigido a propósito: la página
  redistribuida a 320 píxeles CSS, texto ampliado al 200 por ciento, los ajustes de espaciado de
  texto que especifica la norma, indicadores de foco comparados antes y después del foco, controles
  enfocados contrastados con cualquier cosa que pueda quedar encima, cada objetivo de puntero medido
  contra el mínimo de 24 por 24, y cada control comprobado para que tenga nombre accesible.
- **Teclado.** Que el enlace para saltar al contenido sea lo primero que alcanza un teclado en cada
  página, y que usarlo mueva el foco al contenido en lugar de solo desplazar la página.
- **A mano, criterio por criterio.** Los cincuenta y cinco criterios de éxito de nivel A y AA de WCAG
  2.2, cada uno registrado con su veredicto y la evidencia detrás, en
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md).

<!-- section: limits -->

## Qué no cubre

Dicho sin rodeos, porque una declaración de conformidad vale exactamente lo que valen sus límites:

- **Ninguna prueba con tecnología de apoyo.** No se usó ningún lector de pantalla, y ninguna persona
  con discapacidad ha probado este sitio. La estructura se verificó inspeccionando el árbol de
  accesibilidad, que no es lo mismo que escucharlo.
- **Ninguna auditoría externa.** Nadie independiente ha revisado nada de esto, igual que nadie
  independiente ha auditado la criptografía de la biblioteca.
- Las pruebas automáticas cubren alrededor de un tercio de lo que pide WCAG. Los otros tres métodos
  existen por eso, y aun así no sustituyen a una persona que depende de esto.

<!-- section: known -->

## Limitaciones conocidas

- **El código QR es una imagen de datos.** Ninguna tecnología de apoyo puede leer uno, y ninguna
  debería tener que hacerlo: el pie que lo acompaña da su versión y su número de caracteres, y todo
  valor que codifica está impreso como texto en la misma página.
- **El playground necesita JavaScript**, porque ejecuta la biblioteca en el navegador de quien lee,
  que es justamente su propósito. La documentación y la página de inicio no lo necesitan: su
  contenido está en el HTML.

<!-- section: report -->

## Si encuentras algo mal

Que nos lo digan es la única forma de que esto mejore. Abre una incidencia en
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues), o dilo de la manera que te resulte más
fácil. Con describir qué pasó basta; nombrar el criterio de éxito se agradece, pero nunca hace
falta.

<!-- cta --> [Informar de un problema de accesibilidad](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [Leer la evaluación completa](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
