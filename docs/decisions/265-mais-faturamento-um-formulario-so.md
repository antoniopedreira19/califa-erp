# 265 — "+ Faturamento" com um formulário só: o Job é o Novo faturamento, e ele trava a planilha

**Data:** 2026-11-17
**Status:** aceita e implementada em 18/11/2026.
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

## Implementação

- **Banco:**
  - `20261118400001_tres_avulsas_com_job_viram_novo_faturamento.sql`: as três notas passam a nota de job (`origem_tipo = 'job'`, `faturado_pelo_financeiro`), sem `job_referencia_id`, sem centro de custo e sem rateio (a nota de job fica na regional do job); o item vira `job`; a PO passa a ser do job; o job é carimbado. Valor, número, emissão, títulos, CBS/IBS e anexo não mudaram. O "antes" de cada nota ficou na auditoria (`faturamento.convertido_em_novo_faturamento`).
  - `20261118400002_novo_faturamento_trava_a_errata.sql`: `novo_faturamento_do_job(job)` (os meses já faturados pelo financeiro; mês nulo = o job inteiro; `security definer`, só `authenticated`) e `gravar_parametros_da_errata` contando o Novo faturamento.
- **Contas a Receber:** `faturamento-list.tsx` (o botão abre o formulário, sem o menu), `faturar-drawer.tsx` (o seletor do vínculo; Job usa o bloco do Novo faturamento; o bloco do avulso fica só para Save avulso e Sem job), `actions.ts` (recusa `job_referencia_id`).
- **Jobs:** `lib/data/envio-faturamento.ts` (`jobJaEnviadoParaFaturamento` diz quem fechou a porta, `"envio"` ou `"financeiro"`; `mesesEnviadosDoJob` soma os meses do Novo faturamento; as mensagens do financeiro), `actions-errata.ts` e `save-errata-actions.ts` (as mensagens), `page.tsx` e `job-realizado-section.tsx` (o "Editar planilha" desabilitado e o mês travado), `save-dialog.tsx` (o texto da porta do consumo), `lib/calculos/parametros-do-job.ts`.

## Fica de fora

- **Rentabilidade:** a `vw_job_rentabilidade` (da outra frente) conta o faturamento realizado pelo envio do GP (`jobs_envio_faturamento`), não pela nota. Nenhum Novo faturamento entra no realizado dela — nem estes três jobs. Mexer na view é com o Tiago e o Antonio.
- A NF 6468 foi lançada antes da 256 e não tem CBS e IBS gravados; as três não têm deduções (repasse) informadas.
- O aviso do mês travado no mensal continua dizendo "já foi enviado para faturamento" também no mês faturado pelo financeiro.
