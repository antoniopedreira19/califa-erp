# 158 — Planilha de um mês só no Fee e no Always On

**Data:** 2026-10-08
**Status:** aceita e implementada (08/10/2026).
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
