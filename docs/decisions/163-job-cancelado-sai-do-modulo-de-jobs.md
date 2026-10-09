# 163 — Job cancelado sai do módulo de Jobs e só aparece em Orçamentos

**Data:** 2026-10-09
**Status:** aceita e implementada (09/10/2026).
**Quem decidiu:** Tiago, em 09/10/2026.
**Completa:** a [113](113-job-nao-aberto-nao-existe-no-financeiro.md), que tirava da produção só o job cancelado **antes** da abertura.
**Migrations:** nenhuma.

## O que aconteceu

Em 09/10/2026 o ANI-1004/26 "ANI SP | AON Outubro" foi cancelado depois de
aberto, numa correção pontual pelo MCP (nota de 09/10 na
[020](020-cancelar-job-so-antes-da-abertura.md)). O GP refez o trabalho no
ANI-1012/26. O filtro da 113 só escondia o cancelado **sem**
`data_abertura_financeiro`, então o 1004 continuou na lista de Jobs com o
selo "Cancelado". O cabeçalho do projeto ANI-P005/26 somava os dois:
"2 JOBS · R$ 720.000,00".

Nas palavras do Tiago:

> Quero que seja retirado do módulo de jobs. Ele não deve mostrar jobs
> cancelados, ele só deve aparecer como cancelado no módulo de orçamentos.

## A regra

1. **No módulo de Jobs não existe job cancelado**, nem antes nem depois da
   abertura. O filtro é `status <> 'cancelado'`.
2. **Em Orçamentos, o orçamento desse job aparece como "Cancelado".** O
   status gravado continua `job_criado`. A tela é que lê o job cancelado.

## O que muda, por tela

| Tela | Antes | Agora |
|---|---|---|
| Lista de Jobs (`/jobs`) | Escondia só o cancelado antes da abertura | Esconde todo cancelado: some da lista, da busca, das contagens e do total do projeto |
| Página do job (`/jobs/[jobId]`) | Redirecionava só o cancelado antes da abertura | Todo cancelado redireciona para o orçamento dele |
| "Jobs do projeto" na ficha e faixa do projeto | A ficha mostrava o cancelado depois da abertura | Nenhum cancelado. A faixa já filtrava, e a agregada (`/jobs/projeto/…`) também |
| Home do GP, do produtor e do freelancer | "Mensagens no chat" e "PPs emitidas por mim" contavam o cancelado depois da abertura | Não contam job cancelado |
| Página do orçamento (`/orcamentos/…/[orcId]`) | O selo dizia "Job criado" | O selo, o "Bloqueado em…", o aviso de estado protegido e o motivo de não aceitar versão nova dizem **"Cancelado"** |
| Lista de orçamentos do projeto e agregada de Orçamentos | Já mostravam "Cancelado" pelo funil (`estagioFunil`) | Sem mudança |
| Barra da versão na página do orçamento | Ofereciam "Cancelar aprovação" e "Enviar Job para Abertura", e o servidor recusava os dois ("Orçamento está em status job_criado…" / "O orçamento não está aprovado nesta versão.") | Os dois somem, como no orçamento arquivado (118) |

O "Cancelado" da página do orçamento vale com três condições: o orçamento
está em `job_criado`, não tem job vivo e tem um job cancelado **depois** da
abertura. O cancelado antes da abertura devolve o orçamento a `aprovado`
(057), então não entra. Em 09/10/2026 só o ANI-P005/26-01 estava nessa
situação.

## O que fica como está

- **O financeiro.** As listas dele (`STATUS_NA_LISTA`) já deixavam o
  cancelado de fora. A página `/financeiro/jobs/[jobId]` do cancelado
  depois da abertura continua abrindo por link direto. O Tiago pediu só o
  módulo de Jobs.
- **`FILTRO_SEM_CANCELADO_ANTES_DA_ABERTURA` e
  `jobCanceladoAntesDaAbertura`** continuam onde é preciso distinguir os dois
  casos: o save (`lib/data/saves.ts`) e as travas do projeto (116 e 122),
  em que um job que chegou a ser aberto ainda conta.
- **Nada no banco.** O status do orçamento não muda e as previsões do job
  cancelado ficam gravadas. O fluxo de caixa e a rentabilidade já ignoram
  job cancelado.
- **O "Cancelar job" do financeiro** continua sem tela (020).
