# 158 — Planilha de um mês só no Fee e no Always On

**Data:** 2026-10-08
**Status:** aceita e implementada (08/10/2026; revista no mesmo dia: o % de honorários lido da fórmula).
**Quem decidiu:** Tiago, em 08/10/2026, depois do protótipo navegável ("Planilha de um mês") e da planilha que uma GP não conseguiu importar.
**Revê:** a [078](078-orcamento-mensal-fee-e-always-on.md) (os meses não mudam pela planilha) e a [076](076-a-importacao-da-versao-pergunta-de-onde-vem-o-planejado.md) (de onde vem o planejado, revista em 05/10: nada vinha marcado).
**Migration:** nenhuma. A regra é de código.

## O caso

O orçamento de Always On UNM-P001/26-01 tem outubro, novembro e dezembro. A
GP mandou a planilha de custo do cliente com duas abas ("piloto 3 meses" e
"12 meses"), cada uma com o custo de **um mês** e nenhum título de mês. O
"Importar planilha" recusou as duas ("Nenhuma das 2 abas do arquivo está no
formato do orçamento"), e ela digitou outubro à mão e copiou para os outros
meses.

Escrever o título do mês nem sempre resolvia: o título só é lido na coluna A
ou B, numa linha sem valor na coluna do R$ e sem tipo, nos formatos
"OUTUBRO", "OUTUBRO DE 2026" ou "OUTUBRO - …"; e um título só, num orçamento
de três meses, era recusado com "falta novembro e dezembro".

## A regra

Vale para o **"Importar planilha" da versão** (versão nova e sobrescrever,
o que inclui a importação da visão agregada).

1. **Aba sem nenhum título de mês é lida como UM mês.** É a aba no layout
   nacional sem título de mês e sem a marca `mes:` da exportação. A
   internacional continua recusada pelo modelo (072).
2. **Orçamento de vários meses: a pergunta "Meses"**, no resumo da aba,
   antes de tudo. Nada vem marcado:
   - **"Repetir em outubro, novembro e dezembro"** — os mesmos itens em
     cada mês do orçamento;
   - **"Só em outubro"** — os itens entram no primeiro mês; os outros
     ficam vazios, para preencher na tela (o "Copiar itens de outro mês"
     traz os do primeiro). Mês sem item segura a aprovação, como já era.
   Até a escolha, a tabela mostra a aba como está ("Grupos da aba · um
   mês") e o botão de gravar fica travado. O servidor recusa a gravação
   sem a escolha.
3. **Orçamento de um mês só: entra direto**, com o aviso "A aba não tem
   título de mês. Os itens entram em outubro, o único mês deste
   orçamento." Não há pergunta.
4. **Mês a mais na planilha fica de fora, com aviso.** Bloco de um mês que
   o orçamento não tem — mesmo dentro do trimestre — não recusa mais a
   planilha: entram só os meses do orçamento, e cada bloco ignorado vira o
   aviso "O bloco "NOVEMBRO DE 2026" ficou de fora: o orçamento não tem
   novembro." Era assim só para mês de outro trimestre. A planilha de três
   meses agora entra no orçamento de um mês (o Always On feito mês a mês).
5. **Mês do orçamento sem bloco na planilha continua recusando** ("falta
   novembro de 2026 e dezembro de 2026"). Planilha com um título só num
   orçamento de três meses segue recusada — escolha do Tiago ("como o
   protótipo").
6. **"Usar o planejado da planilha" vem marcado** em toda importação, no
   lugar do "nada vem marcado" de 05/10 (revisão da 076). Quem quer o da
   versão troca a opção. Na aba sem título de mês, a pergunta do planejado
   só aparece depois da dos meses, porque o número de linhas casadas com a
   versão depende dos meses escolhidos.

O que **não muda**: planilha com bloco de mês que já entrava entra igual;
a importação do projeto (041) continua exigindo os meses exatos da vigente,
porque lê a exportação do ERP; o editor de orçamentos do projeto não cria
mensal.

## Onde mora

- `lib/importacao/meses-da-planilha.ts` — `casarBlocosComMeses` deixa o mês
  a mais de fora com aviso; `abaSemBlocoDeMes`, `comBlocosSinteticos` (a
  aba repetida mês a mês, como se tivesse um bloco por mês),
  `mesesDaOpcao` e `mesesDaAbaParaGravar` (a leitura pronta para gravar,
  usada pelo preview e pelas duas escritas).
- `lib/importacao/preview-da-aba.ts` — `montarPreviewDaAba` devolve
  `semBloco` com a leitura de cada opção, antes da recusa pelo modelo.
- `lib/importacao/tipos-da-importacao.ts` — `OpcaoDosMeses`,
  `SemBlocoDeMes` e `PreviewResult.semBloco` (obrigatório; o editor do
  projeto manda vazio).
- `versoes/importar-actions.ts` — `previewImportacao` junta `semBloco`;
  `confirmarImportacao` e `sobrescreverVersaoComPlanilha` recebem `meses`
  e não recusam a aba sem título de mês pelo modelo.
- `_importacao/importar-planilha-dialog.tsx` e `resumo-da-aba.tsx` — a
  pergunta "Meses", o aviso do mês único, a frase do pop-up de
  substituição e o planejado da planilha marcado.
- `_importacao/formato-da-planilha.tsx` e `importar-planilha-versao.tsx` —
  os textos do formato mensal.

## Conferido

- `lib/importacao/mensal.test.ts`: aba sem título de mês (repetir, só o
  primeiro, sem escolha, um mês), as leituras que a tela recebe, planilha
  com blocos igual com ou sem opção, e mês a mais de fora com aviso.
- Script com os arquivos reais (cópias com o cliente trocado): a planilha
  da GP, a de três blocos e a de só outubro, contra orçamentos de 3 meses e
  de 1 mês — o que já entrava sai idêntico; o que muda é só o desta
  decisão.
- No navegador, logado, no **TES-P001/26-33 · ZZ Teste 158 planilha de um
  mês** (Always On, criado pela tela): a planilha da GP com "Repetir"
  (6 grupos, 12 itens por mês, conferido no banco); de novo com "Só em
  outubro" sobre a v1 com itens (planejado da planilha marcado, pop-up
  "novembro e dezembro ficam vazios", trava de aprovação dos meses
  vazios); "Editar meses" deixou só outubro; a planilha de três blocos
  entrou só com outubro e dois avisos; a planilha da GP entrou direto, com
  o aviso do mês único. A pasta de envios ficou vazia depois de cada
  gravação.
- Com o **arquivo original da GP**, sem nenhuma alteração ("AON
  Unimed.xlsx", 114.469 bytes), no mesmo orçamento de volta com outubro a
  dezembro: as duas abas no formato, "Repetir" e 12 itens com R$ 21.363,72
  de orçado em cada mês (conferido no banco), e a versão liberada para
  aprovar. A cópia que o Tiago editou ("OUTUBRO DE  2026" na A2 da aba "12
  MESES") lê a aba "PILOTO" com a pergunta e mostra a "12 MESES" fora do
  formato, com "falta novembro de 2026 e dezembro de 2026".

## ⚠️ Revisão de 2026-10-08 — o % de honorários é lido de dentro da fórmula

Pedido do Tiago depois de a GP estranhar os valores da aba SUL importada no
"Teste 2" (TES-P003/26-02): a versão nasceu com 12% (o cadastro do cliente
Teste — a ANIMA HOLDING também está com 12% no cadastro), e a planilha
fecha com 13%. Os itens batiam centavo a centavo; a diferença era só essa.
O modal tem o aviso "A planilha traz X%…", mas ele não aparecia: na
planilha interna o 13 está dentro da fórmula da linha HONORÁRIOS
(`=(I350+I352)*13%`), não numa célula.

- **O leitor lê o "× N%" das fórmulas da linha HONORÁRIOS** quando a
  coluna E e o texto da linha não trazem o percentual — no mensal (a
  linha de fechamento de cada bloco) e no nacional. Lê até numa fórmula
  quebrada como `*13%G448`, em que o percentual pretendido continua
  legível.
- **Cada bloco de mês guarda o seu %** (`ParseMes.percentual_honorarios`),
  e o aviso usa o dos meses que entram na versão: o bloco de janeiro da
  planilha interna não decide o aviso de um orçamento de outubro a
  dezembro. Meses que entram com percentuais diferentes avisam ("Os meses
  da planilha têm honorários diferentes…") e vale o primeiro.
- **O aviso compara com os honorários que a versão vai ter de fato.** No
  sobrescrever, a importação mantém os da própria versão — e o modal dizia
  "Honorários da versão: 12% — do cadastro" mesmo numa v1 já ajustada para
  13%. Agora: "Honorários da versão: 13% — os da v1, que a importação
  mantém", ou "A planilha traz 13% de honorários, mas a v1 continua com
  12% — a importação não muda os honorários da versão". Na versão nova
  continua "vai nascer com 12% — o percentual do cadastro".
- Nada disso muda valor gravado: o percentual da planilha só alimenta o
  aviso, como desde 11/08/2026.

Conferido: testes do mensal (fórmula por mês, fórmula quebrada, meses com
percentuais diferentes, aba sem título de mês); o leitor nas três
planilhas reais lê 13%; no navegador, logado, as duas portas (sobrescrever
com a v1 a 13% e a 12%, e a versão nova pelo "+"), sem gravar.

A segunda planilha da GP ("… Ânima 2026 (1).xlsx") tinha outra diferença,
que é da planilha: "Social Media Unicuritiba" com QT 0 e o TT digitado à mão
(R$ 7.000,00) em outubro, novembro e dezembro. O ERP calcula R$ × QT × D/M
e chega a R$ 0, então o orçado do mês ficou R$ 7.000,00 abaixo
(R$ 114.555,25 contra R$ 121.555,25). Na mesma planilha, a fórmula de
honorários de outubro está quebrada (`*13%G448`), e o fechamento do mês dá
erro.
