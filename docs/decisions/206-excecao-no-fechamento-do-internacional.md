# 206 — A exceção no fechamento do internacional, só do administrador

**Data:** 2026-10-22
**Status:** aceita e implementada em 22/10/2026.
**Quem decidiu:** Tiago, no protótipo "Exceção no fechamento do internacional"
(forma A, botão "Exceção"; aviso A, selo e faixa), com os ajustes pedidos
nos comentários do protótipo.
**Migrations:** `20261022860001_excecao_no_fechamento_do_internacional.sql`
(colunas) e `20261022860002_trava_do_fechamento_do_internacional.sql`
(gatilho).
**Revê:** a 072 (int. taxes e custo de transação deixam de ser campos do
"Editar"; a versão nova não herda mais Impostos BR e int. taxes da vigente)
e a 096 (a alíquota de 17,03% existe, mas só como exceção).

## O caso

A produção montou a planilha internacional do SOF-P002/26-01 fora do padrão:
o contas a receber confirmou com a contabilidade que não havia IR retido no
exterior e que o ISS era abatido, e a planilha somava uma taxa cambial fixa.
A planilha fechava em **R$ 309.011,95**; o sistema, em **R$ 314.064,17**.

| Linha | Planilha | Versão no sistema |
|---|---|---|
| Fee | 13% | 12% (cadastro do cliente) |
| Int. taxes | 0,37% (só o IOF) | 0% (o GP zerou no "Editar", tirando o IOF junto) |
| Impostos BR | 17,03% (19,53 − ISS 2,5) | 19,53% (a única da lista da 096) |
| Taxa cambial | R$ 550 fixos | — |

Os itens batiam (R$ 225.649,50). A diferença era só o fechamento, e o sistema
não tinha como chegar ao número da planilha: Impostos BR é lista fechada, e
a aprovação recusa alíquota fora dela.

O Tiago soube que o caso é específico e **não pode virar regra**.

## A regra

1. **O fechamento padrão do internacional é fixo:** int. taxes 18,02%
   (IR 17,64% + IOF 0,37%), Impostos BR 19,53% e nenhum custo de transação.
   No "Editar" da versão os três campos ficam travados para todo mundo.
2. **Fugir dele é uma exceção daquela versão**, registrada só pelo
   **administrador** (`orcamentos.excecao_fechamento`), no botão
   **"Exceção"**, ao lado do "Editar". O pop-up mostra as três linhas com o
   padrão do sistema ao lado, pede o **motivo** (obrigatório) e simula o
   faturamento previsto com as taxas novas; um campo opcional recebe o
   invoicing da planilha e diz "Bate com a planilha" ou a diferença.
   **"Voltar ao padrão"** remove a exceção.
3. **A exceção não passa adiante.** Versão nova (criar, duplicar, importar,
   planilha do projeto) nasce no padrão e sem exceção.
4. **O fee não é exceção:** continua no "Editar", com quem já podia mexer
   nele (administrador e GP).
5. **A taxa cambial é o Int. transaction costs.** O campo já existia, mas
   aparecia na linha só quando tinha valor, com o nome "Transação". Agora
   aparece sempre, depois de Impostos BR, com padrão R$ 0,00.
6. **A aprovação:**
   - fora do padrão **sem** exceção, é barrada, com as linhas que fogem
     ("O fechamento desta versão está fora do padrão sem exceção
     registrada…"). É o caso do 0% gravado no SOF;
   - **com** exceção, a alíquota fora da lista (17,03%) aprova.
7. **O financeiro é avisado:** selo "Exceção no fechamento" na fila de
   abertura (a dica traz as taxas), faixa na conferência que a fila abre e na
   página "Abrir job no financeiro" (cada taxa com o padrão ao lado, o
   motivo, quem e quando), e a linha da exceção no pop-up "Abrir … no
   financeiro?". A confirmação obrigatória (aviso B) não foi escolhida.

## O câmbio, no mesmo pacote (comentários do protótipo)

- Moeda e câmbio saem da linha dos parâmetros e ganham **linha própria**,
  logo abaixo, com o botão **"Editar câmbio"**.
- **Compra = cotação − 0,20 e venda = cotação + 0,20**, sempre, como a
  planilha calcula (`B104 = B103 − 0,2`, `B105 = B103 + 0,2`). Só se digitam
  moeda, data e cotação; compra e venda aparecem calculadas, e o servidor as
  recalcula ao gravar (o que vier delas no formulário é ignorado).
- A **moeda** é escolhida numa lista com busca (código, nome ou país), com
  24 moedas ISO 4217 em `meta-versao.tsx`. Moeda gravada fora da lista
  continua aparecendo.
- A data da cotação aparece entre parênteses, em tom apagado:
  "Cotação: 5,0022 (02/06/2026)".

## Também neste pacote

- **Resultado operacional vermelho abaixo de 20%** (pedido no protótipo),
  no cabeçalho da versão e na linha "Resultado operacional" dos Totais, como
  a rentabilidade ao lado. Interno (decisão 105) fica fora, como na 204.
- **Auditoria com o antes e o depois.** `versao_orcamento.editada` passa a
  gravar `alteracoes: { campo: { de, para } }` de cada parâmetro que mudou.
  Antes só dizia que a versão foi editada, e o 0% do SOF não teve como ser
  rastreado. A exceção tem ações próprias:
  `versao_orcamento.excecao_fechamento` (de, para, motivo, motivo anterior)
  e `versao_orcamento.excecao_fechamento_removida`.

## Onde mora

| Peça | Arquivo |
|---|---|
| Padrão, desvios e câmbio derivado | `lib/calculos/excecao-fechamento.ts` (+ testes) |
| Pop-up, selo, faixa e linha da confirmação | `app/(app)/_planilha/excecao-no-fechamento.tsx` |
| Linha de parâmetros e linha do câmbio | `orcamentos/[projetoId]/[orcId]/meta-versao.tsx` |
| Ações `definirExcecaoDoFechamento` e `removerExcecaoDoFechamento`; travas do `atualizarVersao` | `orcamentos/[projetoId]/[orcId]/versoes/actions.ts` |
| Trava da aprovação | `bloqueioAprovacaoVersao` (`lib/validations/versoes.ts`), campo `fechamentoInternacional` |
| Marca "exceção" na cadeia dos Totais | `_planilha/cadeia-internacional.tsx`, prop `linhasEmExcecao` (vazia na planilha do job) |
| Fila e abertura | `financeiro/abertura-de-job/dados.ts` (`JobNaFila.excecao_fechamento`), `fila-list.tsx`, `conferencia-dialog.tsx`, `[jobId]/page.tsx`, `[jobId]/abertura-form.tsx` |

## O banco

- `versoes_orcamento.excecao_fechamento_motivo`, `excecao_fechamento_por`
  (FK para `profiles`, como `jobs.enviado_abertura_por`, para o nome chegar
  por embed) e `excecao_fechamento_em`. CHECK: motivo e data juntos, motivo
  não vazio. Índice parcial em `excecao_fechamento_por`.
- Gatilho `versao_fechamento_internacional_no_padrao` (só para a sessão
  `authenticated`; não é `security definer`, pela lição da 072):
  - INSERT de internacional sem exceção **nasce no padrão** (int. taxes
    18,02, transação 0, alíquota fora da lista vira 19,53). A coluna
    `percentual_int_taxes` tem default 0, e são cinco os caminhos que criam
    versão;
  - UPDATE que tira as três taxas do padrão sem exceção, ou que **remove a
    exceção deixando as taxas fora**, é recusado;
  - só o administrador grava, troca ou remove a exceção;
  - exceção em orçamento que não é internacional é recusada.
- As colunas entraram no banco antes do deploy (aditivas, para a fila poder
  ler a exceção na conferência); o gatilho entrou junto do push, pela lição
  da 204 (recusa nova antes do código abre janela de erro genérico).

## O SOF-P002/26-01

Nenhum dado foi corrigido direto no banco: a versão aprovada já virou o job
SOF-1001/26, e sobrescrever valor em uso é mudança destrutiva. O caminho é o
fluxo: o financeiro **devolve** o job, o GP usa **"Cancelar aprovação"**
(decisão 128, mantém o código), alguém com permissão põe o **fee em 13%** no
"Editar", o administrador registra a **exceção** (0,37% · 17,03% · R$ 550),
o **câmbio** é salvo com a cotação 5,0022 (compra 4,8022), e a versão é
aprovada e reenviada. O fechamento fica em **R$ 309.011,95** (US$ 64.348,00),
igual ao INVOICING da planilha — o teste `excecao-fechamento.test.ts` confere
a conta. Até a exceção, a aprovação barra o 0% gravado.

## Conferência

- `npm run test:excecao-fechamento` (7 testes), e os testes de
  categorias × serviço e de limites (21 no total), passando; tsc, lint e
  build limpos.
- No dev do worktree, como administrador, no TES-P001/26-03 · teste
  (internacional): "Editar câmbio" com a cotação 5,0022 gravou compra
  4,8022, venda 5,2022 e a data, com o antes e o depois na auditoria; o pop-up
  "Exceção" simulou R$ 59.421,57 → R$ 47.971,45 (a conta à mão bate) e
  gravou as três taxas, o motivo, quem e quando; a linha, o selo e as três
  marcas da cadeia apareceram; a aprovação passou com 17,03%. O job de teste
  TES-1031/26 foi enviado e apareceu com o selo na fila, a faixa na
  conferência e na página de abertura, e a linha no pop-up "Abrir … no
  financeiro?" (impostos previstos R$ 8.221,45 = 8.075,87 + 145,58). O job não
  foi aberto: o envio foi cancelado pela tela, a aprovação cancelada e a
  versão voltou ao padrão pelo "Voltar ao padrão".
- O gatilho foi testado numa transação desfeita, como GP Teste e como
  administrador: GP mudando int. taxes e gravando exceção, recusados; fee
  numa linha antiga a 0%, passa; volta ao padrão, passa; insert com
  0 / 17,03 / 550 nasce 18,02 / 19,53 / 0; administrador fora do padrão sem
  exceção, recusado; com exceção, passa; tirar a exceção deixando as taxas,
  recusado (furo achado e fechado no teste); exceção num nacional, recusada.
- Uma versão nacional (TES-P001/26-05) continua com "Honorários · Impostos ·
  Editar", sem botão "Exceção".

## ⚠️ Revisão de 2026-10-28 (decisão 224)

Na **fila da abertura** o financeiro também edita int. taxes, Impostos BR e
custo de transação, pela linha de parâmetros da Planilha Interna, com
motivo, sem a Exceção do administrador (resposta do Tiago de 27/10/2026). A
alteração grava no **job** (`jobs_parametros`): a versão aprovada, a trava
desta decisão no orçamento e a Exceção do administrador continuam como
estão. Ver a [224](224-parametros-do-job-na-abertura.md).
