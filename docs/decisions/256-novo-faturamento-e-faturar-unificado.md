# 256 — "+ Faturamento": o Novo faturamento, o Faturar unificado e os impostos da nota

**Data:** 2026-11-15
**Status:** aceita e implementada em 15/11/2026.
**Quem decidiu:** Tiago, de 12 a 15/11/2026, pelo protótipo interativo "Avulsa com job" (versões 1 a 13) e pelas respostas às perguntas de 15/11.
**Revê:** a [184](184-faturar-drawer-que-abre-a-nota-e-cnpj-do-tomador.md) (o botão "Faturamento avulso" vira "+ Faturamento"), a [130](130-recebimento-antes-da-nf.md) (o registro do recebimento antes da NF sai da fila e vai para a conciliação) e a [094](094-em-faturamento-e-o-finalizado-vale-pelo-envio.md) (o envio da produção também fecha pela nota do financeiro).

## O problema

A nota avulsa "referente a um job" (184) não marcava o job como faturado: guardava só `job_referencia_id`. Quando o valor final é negociado pelo financeiro com o cliente, o faturamento não passa pela produção, e não havia como faturar o job sem o envio do GP. Além disso, o Faturar não mostrava o que a nota gera de imposto com o repasse, não registrava CBS e IBS e não guardava a retenção que o cliente faz quando ela já é sabida.

## Decisão

1. **"+ Faturamento"** no lugar de "Faturamento avulso", com duas saídas: **Novo faturamento** (maleta) e **Faturamento avulso** (recibo, como hoje).
2. **Novo faturamento.** O financeiro fatura o job com o valor que negociou, no lugar do envio da produção. É uma nota de job (itens `job` e `save` sem parcela de envio, de um job só), marcada `faturado_pelo_financeiro`.
   - **Fecha o envio da produção, mesmo abaixo do previsto** (12/11): o resto fica como **saldo** na fila do financeiro; o Faturar dessa linha abre o Novo faturamento com o saldo. O job fica "Em faturamento" para a produção, e o encerrado fica finalizado, como no envio do GP.
   - **Job com envio do GP esperando nota trava** (15/11): o botão leva ao Faturar do envio. No mensal, vale por mês.
   - **Mensal e Mídia Off:** a nota leva o mês; fecha só o envio daquele mês, com o previsto que o mês tinha no dia da nota (`previsto_do_mes`). O job fica todo enviado quando todos os meses fecharem, pelo GP ou pelo financeiro. Na Mídia Off, sem a trava da veiculação.
   - **Job que gera save:** a nota sai dividida — primeiro o faturamento do job, depois o saldo em save — e o save nunca passa do previsto em save; o que passar do previsto vai para o job.
   - **NF cancelada:** sem outra nota do financeiro (ou envio) cobrindo o job, o envio da produção reabre e o job finalizado volta a encerrado. A regra está na `cancelar_faturamento`; o sistema continua sem botão de cancelar NF (decisão 016 §9), então ela vale quando essa porta existir. Conferida em 15/11 numa transação desfeita.
3. **Um Faturar só, no molde do envio** (15/11). Envio, Novo faturamento e avulso abrem o mesmo pop-up centralizado: "O que esta nota cobre" (a caixa de linhas com "Faturar agora" e o total, a faixa Cliente · Empresa · Regional, CNPJ do tomador | PO), "Nota fiscal", "Retenções do cliente" e "Parcelas do recebimento", com os impostos numa coluna fixa à direita. Muda só a origem da linha e o que ela exige: no avulso, o centro de custo, o rateio (sem job) ou o cálculo do save; no mensal, o mês. Uma origem por nota (não se junta envio com Novo faturamento). Novo e avulso continuam separados no menu.
4. **Deduções (o repasse, custo AR):** saem **só da base do ISS**, em todos os regimes. PIS, COFINS, IRPJ e CSLL ficam sobre o total até a contabilidade confirmar (o portal da NFS-e só destrincha o ISS; o custo AR da Hitlab ainda não está confirmado como repasse por conta e ordem). A sugestão é o custo AR de cada job **na proporção desta nota** (o valor dela sobre o previsto), com a conta à vista; o avulso não tem sugestão.
5. **Impostos desta nota** desde a abertura, zerados, acertando enquanto se preenche (diz o que falta): competência, valor total − deduções = base do ISS, cada imposto com base, alíquota e vencimento, o líquido, e **CBS e IBS** — reforma tributária, fase de teste — sobre o líquido (total − ISS − PIS − COFINS, como a planilha do financeiro), com as alíquotas do cadastro de impostos (parâmetros `cbs` e `ibs`, com vigência; 0,9% e 0,1% desde 01/01/2026). CBS e IBS ficam gravados na nota, sem guia.
6. **Retenções do cliente** no Faturar, quando já se sabe: ISS, PIS, COFINS, CSLL e IRRF, com atalhos. Os federais sobre o total da nota; o ISS sobre a base. A baixa do título (e a conciliação, pela mesma entrada) abre com essas alíquotas, editáveis.
7. **Recebimento antes da NF:** o Faturar **não registra** recebimento (15/11). O registro foi para a conciliação ("Novo lançamento" › "Recebimento antes da NF"), escolhendo o job: com envio esperando nota, vai para a nota do envio (como na 130, com o câmbio da 229) e entra sozinho no Faturar do envio; sem envio, fica **preso ao job**, e o Faturar mostra "Recebimentos do job ainda sem nota" para **associar** (vira a parcela 1, quitada); o BV pelo próprio BV. A fila de Faturamento só mostra o selo do recebido (e o cancelamento).
8. **Faturamento Agrupado de um cliente só** (15/11): marcada a primeira linha, só as do mesmo cliente seguem disponíveis; "marcar todos" só com um cliente à vista; a barra "Faturar selecionados" fica fixa no rodapé da tela.

## Implementação

- **Banco** (migration `20261115900001_novo_faturamento.sql`):
  - `faturamentos`: `faturado_pelo_financeiro`, `mes_novo_faturamento`, `previsto_do_mes`, `valor_deducoes`, `retencoes_previstas` (`[{imposto, aliquota}]`), `aliquota_cbs`, `valor_cbs`, `aliquota_ibs`, `valor_ibs`, com as travas de coerência.
  - Duas regras mais largas, autorizadas pelo Tiago (nenhuma linha mudou): `chk_fat_item_origem` aceita o item `save` sem parcela de envio; `chk_recebimento_antes_nf_alvo` aceita o recebimento só com o job.
  - `job_faturamento_todo_enviado` conta o Novo faturamento (o job inteiro, ou o mês pelo `previsto_do_mes`); `emitir_faturamento` grava os campos novos, confere o Novo faturamento (um job, sem parcela, sem envio pendente), aceita o save sem parcela só nele, aplica os recebimentos associados e carimba o job; `cancelar_faturamento` reabre o envio; a trava de escrita do envio recusa o job (ou o mês) já faturado pelo financeiro; `registrar_recebimento_antes_nf_do_job` (nova, só `authenticated`).
  - Parâmetros `cbs` e `ibs` no cadastro de impostos do tenant que já tinha o cadastro.
- **Fiscal:** `impostosDaNotaComDeducoes` e `reformaDaNota` (`lib/fiscal/calculos.ts`), `aliquotasDaReforma` (`lib/fiscal/cadastro.ts`); a Apuração tira as deduções só da guia de ISS (`baseDoIss`), e a linha da nota diz "deduções R$ X". A linha "CBS e IBS" na aba Parâmetros do cadastro de impostos.
- **Contas a Receber:** `faturar-drawer.tsx` (pop-up único, `blocoJobDoNovo`, `blocoAvulso`, deduções, retenções, recebidos associados), `impostos-desta-nota.tsx`, `faturamento-list.tsx` (menu, linha do saldo, agrupado), `meses-do-novo-faturamento.ts` (os meses do mensal, lidos quando o job é escolhido, pela action `carregarMesesDoNovoFaturamento`), `dados-do-recebido-antes.ts`, `actions.ts` (CBS e IBS e o previsto do mês calculados no servidor), baixa e títulos com `retencao_da_nota`.
- **Conciliação:** `recebimento-antes-nf-na-conciliacao.tsx` e as actions `carregarAlvosDoRecebimentoAntesNf` e `registrarRecebimentoAntesNfDoJob`.
- **Produção:** `lib/calculos/faturamento-por-mes.ts` (`NotaDoFinanceiro`, `peloFinanceiro` no envio único e no mês), `carregar-detalhe.ts`, `barra-acoes-job.tsx` ("Faturado pelo financeiro, sem envio da produção", ou "Faturado parcial … o saldo fica com o financeiro") e `barra-faturamento-mensal.tsx`.
- **Testes:** dedução só no ISS e CBS/IBS (`fiscal.test.ts`), a guia de ISS com dedução (`apuracao.test.ts`), o fechamento do envio e do mês pelo Novo faturamento (`faturamento-por-mes.test.ts`).
