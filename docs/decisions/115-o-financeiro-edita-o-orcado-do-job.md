# 115 — O financeiro edita o orçado do job na Planilha Interna, sem aprovação, até a primeira nota

**Data:** 2026-09-28
**Decidido por:** Tiago, sobre protótipo navegável (artifact `Re8sXDJpj8gzEk1tnCrt48`, v2)
**Migrations:** `20260928300001_alteracoes_do_financeiro.sql` e
`20260928300002_alteracao_financeiro_curva_do_interno.sql`.

---

## 1. O pedido

Nas palavras do Tiago, em 28/09/2026, com prints do AMB-1001/26 (antigo
JOB-0024):

> Quero que inclua um botão de "Editar Orçado", na visão do financeiro da
> planilha interna, o qual ficara no mesmo local do atual botão de
> "Realizar Errata" na visao da produção da planilha interna. Quero que
> essas modificações fiquem registradas do mesmo modo que as erratas sao
> registradas atualmente, em um card, como o atual de erratas, porem
> chamado de "Alterações do Financeiro", registrando o que foi feito, o
> qual devera registrar o usuario que as fez do mesmo jeito. (não precisara
> de aprovações, e poderao ser feitas, desde o momento da abertura de jobs).

Até aqui só a produção mexia no orçado de um job aberto, pela errata, e
toda errata devolve o job ao financeiro para a revisão da abertura
(decisão 059). O financeiro não tinha como corrigir um valor sem pedir à
produção.

## 2. As respostas que fecharam a regra

Sobre o protótipo, o Tiago respondeu em 28/09/2026:

| | Pergunta | Resposta |
|---|---|---|
| P1 | O que o financeiro edita | **Só os valores** do orçado: R$ Unit., QT e D/M |
| P2 | Linha com PP já no financeiro (a errata trava, decisão 040) | **Editável** |
| P3 | A previsão de recebimento | **Acompanha** a alteração |
| P4 | Até quando | "Até o faturamento do job (mesmo que parcial)" — confirmado como: até a **primeira nota emitida**; no mensal, **só o mês faturado** trava |
| P5 | A produção vê | **Sim**: o card e o aviso na Comunicação |
| — | O card "Alterações do Financeiro" | **Oculto até a primeira alteração** |

Quatro pontos foram ditos a ele antes do "pode implementar" e seguiram sem
objeção: editam o **administrador e o financeiro**; o **motivo é
obrigatório**; o item A · Repasse já **concluído continua concluído**, e a
diferença vira rentabilidade; o selo do cabeçalho troca de "Somente
leitura" para **"Editando orçado"** durante a edição.

## 3. A regra

1. **Quem:** administrador e financeiro (`jobs.editar_orcado_financeiro`
   em `lib/permissoes.ts`). A produção continua corrigindo pela errata.
2. **Onde:** botão "Editar orçado" na Planilha Interna do job **no
   financeiro** (`/financeiro/jobs/[jobId]?aba=planilha`), no lugar em que
   a produção tem o "Realizar errata". A planilha da produção e a da fila
   de abertura não têm o botão.
3. **Quando:** job aberto no financeiro (`data_abertura_financeiro`
   preenchido), com status aberto, em produção, encerrado ou finalizado —
   faturamento e encerramento correm separados (decisão 087). Vale até a
   primeira nota emitida, parcial ou total. No modelo mensal (decisão 078)
   a trava é por mês: as linhas do mês com nota não abrem; as dos outros
   meses, sim.
4. **O quê:** R$ Unit., QT e D/M do orçado. Tipo de custo, linha nova,
   linha vermelha e planejado continuam sendo da errata. Linha com PP é
   editável (P2). **Linha com save não:** o save tem porta própria (o
   pop-up da coluna Save), e o banco já recusa (`save_trava_linha_job`).
5. **Motivo obrigatório**, de 5 a 500 caracteres.
6. **Sem aprovação e sem revisão da abertura:** vale na hora.
   `abertura_em_revisao` não muda, e o envio para faturamento não trava.
7. **O que acompanha, na mesma transação:**
   - os números do job — valor do job, faturamento previsto e parte de
     save —, pela conta do financeiro (`totaisDoFinanceiro`, decisão 099),
     a mesma que a errata grava;
   - a **previsão de recebimento** (P3): cada parcela na proporção dela,
     sem mudar a data, e a última fecha o centavo. No mensal, só as
     parcelas do mês mexido;
   - os **recolhimentos de imposto previstos** (decisão 100), do mesmo
     jeito, porque precisam fechar com o imposto previsto, que muda junto;
   - o **envio para faturamento ainda sem nota** (P4): o valor enviado e as
     parcelas, do mesmo jeito, com as mesmas datas.
     `faturamento_enviado_em` não muda;
   - no **serviço Interno** (decisão 105) o banco faz o planejado espelhar o
     orçado (`planejado_espelha_orcado`). O custo previsto muda junto, e a
     **curva de desembolso** acompanha do mesmo jeito, com
     `custo_previsto_total`.
8. **O que não muda:** o orçado aprovado da versão
   (`versoes_orcamento_itens`), o planejado (fora do Interno), o
   realizado, as PPs, o status de conclusão do A · Repasse e a foto da
   abertura (`valor_job_abertura`, `faturamento_previsto_abertura`).
9. **O registro:** cada confirmação vira uma linha de
   `jobs_alteracoes_financeiro`, com as linhas em
   `jobs_alteracoes_financeiro_itens`. É histórico imutável: sem UPDATE nem
   DELETE, nem na policy nem no grant. Aparece:
   - no card **"Alterações do Financeiro"**, na aba Informações do Job, no
     financeiro e na produção, abaixo do card de Erratas, só depois da
     primeira alteração. Uma linha por alteração, com data, hora, motivo,
     "N itens · autor"; aberta, o antes → depois de cada item, os efeitos
     no faturamento previsto e no valor do job, e as parcelas que
     acompanharam;
   - no fio da **Comunicação**, como card de sistema;
   - na auditoria, `job.orcado_alterado_financeiro`.

## 4. As recusas

A action (`registrarAlteracaoDoFinanceiro`) confere tudo no servidor, e a
função do banco repete a trava da nota:

| Situação | Mensagem |
|---|---|
| Job fora da janela (não aberto, cancelado, devolvido) | "O orçado só é editado pelo financeiro com o job aberto no financeiro." |
| Job com nota emitida | "O job já tem nota emitida (faturamento parcial ou total): o orçado não muda mais pelo financeiro." |
| Linha de mês com nota (mensal) | "Novembro já tem nota emitida: as linhas desse mês não mudam mais pelo financeiro." |
| Linha com save | "\"Item\" tem save. Linha com save não entra na edição do orçado — o save muda pelo pop-up da coluna Save." |
| Parcela do envio que já virou nota (no banco) | "Uma parcela do envio já virou nota emitida: o orçado desse faturamento não muda mais." |
| Previsão vazia que precisaria andar | "O job abriu sem faturamento previsto e não tem previsão de recebimento para acompanhar a alteração. Valor novo precisa de data: peça a errata à produção, que devolve o job para a revisão da abertura." (e as variantes do mês e da curva do Interno) |
| Parcela do envio que zeraria | "Com essa alteração, uma parcela do envio para faturamento ficaria zerada ou negativa, e o envio não aceita parcela sem valor." |

Na tela, o botão fica desabilitado, com o motivo, no job com nota — no
mensal, só quando todos os meses têm nota. As linhas do mês com nota não
abrem, e as linhas com save mostram o motivo ao passar o mouse.

## 5. Por que uma tabela nova, e não `jobs_erratas`

Toda errata registrada depois da última foto da abertura é "pendente de
revisão" (decisão 059): o mural, a faixa da revisão e o histórico das
fotos contam com isso. A alteração do financeiro não é revisada por
ninguém. Misturar as duas faria cada leitor de errata precisar de um
filtro, e o primeiro que esquecesse devolveria o job ao mural.

## 6. O centavo dos efeitos

Honorário e imposto são lineares, mas cada efeito por item, arredondado à
parte, podia somar 1 centavo diferente do antes → depois do job: no teste
do TES-1013/26, R$ 278,36 nas linhas contra R$ 278,37 no job. A action
distribui o centavo que sobra, e a última linha fecha o total. O card
mostra linhas que batem com o total da alteração.

## 7. Pontos em aberto

Decididos pelo lado mais seguro e levados ao Tiago na entrega:

- **Previsão vazia:** o mês que não tinha faturamento na abertura não tem
  parcela de recebimento, e o job Interno aberto sem custo não tem curva.
  Uma alteração que criaria valor nesses casos é recusada: o valor novo
  precisaria de uma data que ninguém informou. Em 28/09/2026 nenhum job
  aberto estava nesse caso.
- **Interno finalizado:** sem faturamento, ele nunca tem nota, e a regra
  literal deixa editar mesmo depois de finalizado. O único em 28/09/2026 é
  o TES-1009/26, de teste.
- **Interno com PP:** como o planejado acompanha o orçado, reduzir o orçado
  de uma linha com PP pode deixar o planejado abaixo do que já foi pedido.
  Nenhum job Interno tinha PP em 28/09/2026.

## 8. Conferência (28/09/2026)

Tudo em jobs do projeto de teste, pelos fluxos da tela, e cada teste
desfeito por uma segunda alteração:

- **TES-1013/26** (normal, uma linha B): 1.000 → 1.200 → 1.000. Previsão de
  recebimento, impostos e espelhos acompanharam; autor gravado; card no
  financeiro e na produção; card no fio da Comunicação; a planilha da
  produção só com o "Realizar errata".
- **TES-1002/26** (mensal): Item 1 de novembro, 10.000 → 11.000 → 10.000.
  Só a parcela de novembro andou (R$ 118.304,96 → R$ 119.696,78).
- **TES-1009/26** (Interno, mensal): Cenografia de outubro, 3.000 → 3.500 →
  3.000. Planejado, curva (R$ 13.500,00 → R$ 14.000,00) e
  `custo_previsto_total` acompanharam, e voltaram.
- **TES-1004/26:** as linhas com save ficam travadas, com o motivo.
- **TES-1001/26:** botão desabilitado pela nota.
- **Chamada direta da action**, sem passar pela tela: recusou job com nota,
  linha de outro job, linha com save e motivo curto.
- **Simulações no banco, com rollback:** o envio sem nota acompanha
  (R$ 1.391,82 → R$ 1.670,19, parcelas de R$ 835,10 e R$ 835,09, carimbo
  do envio preservado), e a função recusa parcela que já virou nota.
- **AMB-1001/26** (job real): as 4 linhas com PP abrem na edição; a edição
  foi descartada, sem gravar.

Ficaram 2 entradas em Alterações do Financeiro em cada um desses três jobs
de teste — o teste e o desfazer. O histórico é imutável.
