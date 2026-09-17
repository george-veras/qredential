<!-- translated-from: 48cad2b0114eb74e -->
<!-- section: statement -->

<!-- eyebrow -->
*Acessibilidade*

# Este site, medido contra o WCAG 2.2 AA

<!-- lede -->
Todas as páginas deste site pretendem estar em conformidade com o
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) no nível AA. Esta página diz sobre o que essa afirmação se
apoia, e sobre o que ela não se apoia.

<!-- section: scope -->

## O que a afirmação cobre

As trinta e seis páginas deste site, nos nove idiomas: a página inicial, a documentação, o
playground e esta declaração. Nos dois temas, claro e escuro. Última avaliação em 17 de setembro de 2026, contra a
versão publicada naquele dia.

[![Conformidade nível AA, Diretrizes de Acessibilidade para Conteúdo Web 2.2 do W3C WAI](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

O selo acima é uma autodeclaração. O W3C o publica para qualquer um usar e não revisa nem
verifica nenhuma afirmação feita com ele, que é exatamente a razão de o resto desta página existir.

<!-- section: method -->

## Como foi avaliado

De quatro formas, todas repetíveis, e todas executadas de novo a cada mudança pela integração
contínua:

- **Motor de regras.** O `axe-core` contra trinta e nove carregamentos de página, cobrindo as trinta e seis
  páginas nos nove idiomas, mais uma página de cada formato no tema escuro, verificando as marcações
  que correspondem ao WCAG 2.2 níveis A e AA.
- **Critérios que motor de regras nenhum enxerga.** Um navegador dirigido de propósito: a página
  refluída para 320 pixels CSS, texto ampliado para 200 por cento, os ajustes de espaçamento de
  texto que a norma especifica, indicadores de foco comparados antes e depois do foco, controles
  focados conferidos contra qualquer coisa que possa ficar por cima deles, cada alvo de ponteiro
  medido contra o mínimo de 24 por 24, e cada controle conferido quanto a ter nome acessível.
- **Teclado.** Que o link de atalho seja a primeira coisa que o teclado alcança em toda página, e
  que usá-lo mova o foco para o conteúdo, e não apenas role a página.
- **À mão, critério por critério.** Todos os cinquenta e cinco critérios de sucesso de nível A e AA
  do WCAG 2.2, cada um registrado com seu veredito e a evidência por trás dele, em
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md).

<!-- section: limits -->

## O que ela não cobre

Dito sem rodeios, porque uma declaração de conformidade vale exatamente o que valem os seus limites:

- **Nenhum teste com tecnologia assistiva.** Nenhum leitor de tela foi usado, e nenhuma pessoa com
  deficiência testou este site. A estrutura foi verificada inspecionando a árvore de acessibilidade,
  que não é a mesma coisa que ouvi-la.
- **Nenhuma auditoria de terceiros.** Ninguém independente conferiu nada disso, do mesmo jeito que
  ninguém independente auditou a criptografia da biblioteca.
- Teste automatizado cobre cerca de um terço do que o WCAG pede. Os outros três métodos acima
  existem por causa disso, e ainda assim não substituem uma pessoa que depende disto.

<!-- section: known -->

## Limitações conhecidas

- **O QR code é uma imagem de dados.** Nenhuma tecnologia assistiva consegue ler um, e nenhuma
  deveria precisar: a legenda ao lado dele dá a versão e a contagem de caracteres, e todo valor que
  ele codifica está impresso como texto na mesma página.
- **O playground precisa de JavaScript**, porque ele roda a biblioteca no navegador de quem lê, que
  é justamente o objetivo dele. A documentação e a página inicial não precisam: o conteúdo delas
  está no HTML.

<!-- section: report -->

## Se você encontrar algo errado

Ser avisado é o único jeito de isto melhorar. Abra uma issue em
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues), ou diga do jeito que for mais fácil para
você. Uma descrição do que aconteceu já basta; nomear o critério de sucesso é bem-vindo, mas nunca
obrigatório.

<!-- cta --> [Relatar um problema de acessibilidade](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [Ler a avaliação completa](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
