# 265 — "+ Faturamento" com um formulário só: o Job é o Novo faturamento, e ele trava a planilha

**Data:** 2026-11-17
**Status:** aceita e implementada em 18/11/2026. Ampliada no mesmo dia: o Novo faturamento substitui o envio em todos os contextos (seção 7).
**Quem decidiu:** Tiago, em 17/11/2026 ("Pode implementar"), depois de ver que "Novo faturamento" e "Faturamento avulso" confundiam o financeiro.
**Revê:** a [256](256-novo-faturamento-e-faturar-unificado.md) (o menu com as duas saídas sai; o Novo faturamento passa a travar a errata) e a [184](184-faturar-drawer-que-abre-a-nota-e-cnpj-do-tomador.md) (a avulsa "referente a um job" sai).

## O problema

A 256 deixou o "+ Faturamento" com duas saídas: **Novo faturamento** (a nota do job, que conta no faturamento dele e fecha o envio da produção) e **Faturamento avulso**, que tinha a opção "Referente a um job" (184): a nota só guardava o job como referência e **não contava** no faturamento dele. Na tela, os dois formulários eram quase iguais.

O financeiro usou o avulso "referente a um job" para faturar o próprio job. Três notas da produção, R$ 907 mil:

| NF | Job | Nota | Previsto do job |
|---|---|---|---|
| 6468 | AMB-1061/26 | R$ 80.000,00 | R$ 80.000,00 |
| 6376 | AMB-1042/26 | R$ 292.000,00 | R$ 292.000,00 |
| 6475 | AMB-1058/26 | R$ 535.000,00 | R$ 555.741,02 |

Nenhuma contava no job: os três seguiam sem faturamento para a produção, com o envio do GP aberto (a nota podia sair duas vezes).

Além disso, a 256 fez o Novo faturamento fechar o envio da produção e carimbar o job, mas a **errata continuou olhando só o envio do GP**: depois da nota do financeiro, a produção ainda podia mudar o orçado e os parâmetros.

## Decisão

1. **Um formulário só.** O "+ Faturamento" abre direto o formulário, sem o menu. Em cima, o vínculo da nota: **Job** · **Save avulso** · **Sem job**, com Job marcado. Título "Faturamento".
2. **Job = o Novo faturamento da 256**, sem mudança de regra: a nota é do job, fecha o envio da produção (abaixo do previsto, o resto vira saldo na fila), trava com envio do GP esperando nota, leva o mês no mensal e na Mídia Off e divide job e save.
3. **Extras de job não existem** (Tiago): o que é extra ganha orçamento próprio. A avulsa "referente a um job" sai; o servidor recusa `job_referencia_id`. As notas antigas com job de referência (só testes no Sandbox) ficam como estão. "Sem job" fica para casos avulsos excepcionais.
4. **A linha de saldo** do Novo faturamento continua abrindo direto no job, sem o seletor (título "Novo faturamento").
5. **O Novo faturamento trava a planilha como o envio do GP**: depois da nota do financeiro (no mensal e na Mídia Off, a do mês), não há errata, linha vermelha (fora a dos pagamentos atrasados, decisão 259) nem mudança de consumo de save; honorários, impostos e taxas só mudam pelo financeiro.
6. **As três notas acima viraram Novo faturamento** (autorizado pelo Tiago: "Converta"). Os jobs ficaram carimbados como faturados na hora em que a nota foi lançada; o AMB-1058/26 ficou com o saldo de R$ 20.741,02 na fila do financeiro (regra da 256).

7. **O Novo faturamento substitui o envio e o faturamento do envio em todos os contextos** (Tiago, 18/11/2026). Onde o sistema mede o faturamento do job pelo envio do GP, a nota do Novo faturamento conta igual:
   - **Rentabilidade, Relatório de Faturamento e Impostos da Abertura › Abertos:** o realizado soma as notas do Novo faturamento (e o save delas; na Mídia Off, os meses delas). Os três jobs AMB saíam "Não Faturado", com R$ 0 de R$ 927.741,02.
   - **Fluxo de caixa:** o que o Novo faturamento cobriu sai da previsão de recebimento do job, na ordem das parcelas (no mensal, do mês). Antes a previsão ficava ao lado dos títulos da nota e o valor entrava duas vezes (R$ 927.741,02 na produção). O resto fica como previsão: é o saldo com o financeiro (R$ 20.741,02 no AMB-1058/26).
   - **Cancelar job:** o job faturado pelo financeiro não se cancela pelo sistema, como o enviado para faturamento.
   - **Save mexido depois da nota:** o rateio job × save da nota do Novo faturamento (do job inteiro) se refaz como na emissão.
   - **Telas:** a situação do faturamento do mensal (Abertura › Abertos e o job no financeiro), o selo "Aguardando encerramento" (só com o job todo coberto; com saldo, não acende, como o envio com parcela por faturar), o envio em lote (pula o mês já faturado), a Mídia Off (o mês faturado pelo financeiro conta como enviado para o último envio encerrar o job), a mensagem do envio recusado, a trava do "Editar orçado" no servidor e a etapa "Faturado pelo financeiro" na ficha e no cabeçalho do job.
   - **O Novo faturamento nunca encerra o job**, nem no último mês da Mídia Off: o encerramento é da produção, com as pendências dela.

## Implementação

- **Banco:**
  - `20261118400001_tres_avulsas_com_job_viram_novo_faturamento.sql`: as três notas passam a nota de job (`origem_tipo = 'job'`, `faturado_pelo_financeiro`), sem `job_referencia_id`, sem centro de custo e sem rateio (a nota de job fica na regional do job); o item vira `job`; a PO passa a ser do job; o job é carimbado. Valor, número, emissão, títulos, CBS/IBS e anexo não mudaram. O "antes" de cada nota ficou na auditoria (`faturamento.convertido_em_novo_faturamento`).
  - `20261118400002_novo_faturamento_trava_a_errata.sql`: `novo_faturamento_do_job(job)` (os meses já faturados pelo financeiro; mês nulo = o job inteiro; `security definer`, só `authenticated`) e `gravar_parametros_da_errata` contando o Novo faturamento.
- **Contas a Receber:** `faturamento-list.tsx` (o botão abre o formulário, sem o menu), `faturar-drawer.tsx` (o seletor do vínculo; Job usa o bloco do Novo faturamento; o bloco do avulso fica só para Save avulso e Sem job), `actions.ts` (recusa `job_referencia_id`).
- **Em todos os contextos (migration `20261118400003_novo_faturamento_em_todos_os_contextos.sql`):** `vw_job_rentabilidade` (realizado, save enviado e imposto da Mídia Off), `vw_fluxo_caixa` (a previsão de recebimento menos o que o Novo faturamento cobriu), `trava_do_cancelamento_do_job` e `save_rateio_das_notas`. Conferida antes numa transação desfeita: mudaram só os 10 jobs com Novo faturamento (3 na produção, 7 no Sandbox).
- **Jobs:** `lib/data/envio-faturamento.ts` (`jobJaEnviadoParaFaturamento` diz quem fechou a porta, `"envio"` ou `"financeiro"`; `mesesEnviadosDoJob` soma os meses do Novo faturamento; as mensagens do financeiro), `actions-errata.ts` e `save-errata-actions.ts` (as mensagens), `page.tsx` e `job-realizado-section.tsx` (o "Editar planilha" desabilitado e o mês travado), `save-dialog.tsx` (o texto da porta do consumo), `lib/calculos/parametros-do-job.ts`.

## Fica de fora

- A NF 6468 foi lançada antes da 256 e não tem CBS e IBS gravados; as três não têm deduções (repasse) informadas.
- O aviso do mês travado no mensal continua dizendo "já foi enviado para faturamento" também no mês faturado pelo financeiro.
