# Férias — fluxo da solicitação

> **Status**: implementado em 2026-11-13/14. Doc escrita em 2026-11-14 pra consolidar o modelo mental do subsistema depois de uma rodada de limpeza grande (ADR do import histórico + fluxo NF Anexada / Enviado Financeiro + redesign da tela do colaborador).
>
> Fonte-verdade da regra de negócio. Mexeu no fluxo? Atualiza aqui.

## 1. O princípio

**Todo acompanhamento é por solicitação.** Dashboard, Solicitações e notificações só contam o que nasceu como solicitação do colaborador. Lançamentos diretos pelo RH (retroativos, imports) **são registro**, não fluxo — vivem na página do colaborador e no histórico, mas nunca disparam acompanhamento ativo.

Esse princípio existe pra forçar o abandono da planilha. Se "Lançar direto" aparecer no Dashboard como se fosse solicitação, o RH nunca para de usar o atalho e o fluxo de aprovação vira teatro. Com a regra atual, a disciplina fica embutida na UI.

## 2. O fluxo em 5 etapas

```
┌──────────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐    ┌───────────┐
│ pendente_    │───▶│ aprovado │───▶│ nf_      │───▶│ enviado_         │───▶│ concluido │
│ aprovacao    │    │          │    │ anexada  │    │ financeiro       │    │           │
└──────────────┘    └──────────┘    └──────────┘    └──────────────────┘    └───────────┘
       ↑                  ↑               ↑                  ↑                     ↑
   colab pede        RH aprova       colab anexa       RH clica              financeiro
   via /perfil       (/rh/ferias)    NF via /perfil    "Enviar pro           paga na aba
                                                       Financeiro"           People
```

Alternativas (saída definitiva): `reprovado`, `cancelado`.

### 2.1 Quem dispara cada transição

| Transição | Quem dispara | Onde | Como |
|---|---|---|---|
| criação → `pendente_aprovacao` | colaborador | `/perfil` | INSERT em `colaboradores_ferias_lancamentos` com `lancado_direto_por_rh=false` |
| `pendente_aprovacao` → `aprovado` | RH | `/rh/ferias` tab Solicitações, modal detalhe | action `aprovarLancamento` — UPDATE status + calcula valores + cria `folhas_pagamento` em `rascunho` |
| `aprovado` → `nf_anexada` | colaborador (ou RH no lugar dele) | upload de NF em `/perfil` | **trigger automático** `fn_sincroniza_status_lanc_por_nf` em `colaboradores_nf_anexos` |
| `nf_anexada` → `enviado_financeiro` | RH | modal detalhe da solicitação | action `enviarProFinanceiro` — UPDATE status + empurra `folhas_pagamento` de `rascunho` pra `enviada` |
| `enviado_financeiro` → `concluido` | **gap conhecido — ver §7** | — | — |

### 2.2 Reversibilidade da NF

A trigger da etapa 3 é reversível: se o colaborador apagar a NF enquanto o lançamento está em `nf_anexada` (e não tem outra NF), volta pra `aprovado`. Já apagou depois de `enviado_financeiro`? Não retroage — o financeiro já pegou, RH resolve manualmente.

### 2.3 Por que `rascunho` → `enviada` na folha?

A view do Contas a Pagar (`vw_people_aprovar_financeiro`) filtra `folhas_pagamento.status = 'enviada'`. Enquanto a folha de férias está em `rascunho` (estado em que nasce quando o RH aprova), o financeiro **não vê** o pedido na aba People. Só o "Enviar pro Financeiro" muda isso. Antes de 2026-11-13 esse push não existia; as folhas de férias ficavam em rascunho pra sempre e nenhuma férias chegava ao financeiro — fluxo quebrado silenciosamente.

## 3. Modelo de dados

### 3.1 Tabelas principais

- **`colaboradores_ferias_periodos`** — Aquisitivos. Gerados automaticamente pela trigger `fn_gerar_ferias_periodos` desde a admissão até hoje + 2 anos. Status: `incompleto`, `apto`, `em_alerta`, `vencido`, `regularizado`, `nao_habilitado`, `pago_rescisao`.
- **`colaboradores_ferias_lancamentos`** — Cada vez que o colaborador tira dias ou vende como abono. FK pro período via `periodo_id`. Vive o fluxo da §2.
- **`folhas_pagamento`** (tipo = `ferias`) — Linha de pagamento. Criada em `rascunho` na aprovação, vai pra `enviada` no envio pro financeiro, depois `paga`. FK `lancamento_ferias_id` liga de volta ao lançamento.
- **`colaboradores_nf_anexos`** — Anexo de NF. Chave: `(colaborador_id, escopo_tipo, escopo_id)`. Pros lançamentos de férias, `escopo_tipo in ('ferias_usufruto', 'ferias_abono')` e `escopo_id = lancamento_id`.

### 3.2 A flag crítica: `lancado_direto_por_rh`

| Valor | Origem | Comportamento |
|---|---|---|
| `false` | Solicitação do colaborador via `/perfil` | Passa pelo fluxo completo. Aparece em todos os painéis. |
| `true` | **(a)** Import histórico FériasAtt (396 linhas em 2026-11-13) **ou (b)** RH lançou direto (retroativo) | Serve como registro. **Não aparece em painel nenhum de acompanhamento.** Só na página do colaborador e no histórico. |

**Por que ambos usam a mesma flag?** Porque os dois casos são passado — import é passado e retroativo é passado. O que define o acompanhamento é "está hoje ou vai estar nos próximos dias", não a origem.

Se um dia o RH quiser lançar direto pra uma data **futura** (ex: "combinei com o Fulano pra dezembro, lanço aqui"), a resposta correta é: **peça pro colaborador abrir a solicitação**. Férias futura nasce como solicitação. Lançamento direto é só pra fechar o passado.

## 4. Filtros dos painéis (resumo rápido)

| Painel | Filtro aplicado | Por quê |
|---|---|---|
| **Dashboard** → Em férias agora | `lancado_direto_por_rh=false` + status in (aprovado, nf_anexada, enviado_financeiro, concluido) + `data_inicio <= hoje <= data_fim` | Só quem tem solicitação real em curso aparece. |
| **Dashboard** → Saindo/Voltando próximos 7d | Mesmo filtro + janela de datas | Idem. |
| **Dashboard** → Próximos vencimentos | `status in (vencido, em_alerta)`, reduzido pra 1 por colaborador (maior `aquisitivo_fim`) | Pessoa antiga pode ter 4-5 aquisitivos vencidos acumulados; só o mais atual conta. |
| **Solicitações** (tabela) | `lancado_direto_por_rh=false` | Mesma regra: painel vê só solicitação. |
| **Página do colaborador** → Em andamento | status in fluxo **OU** concluído com `data_fim >= hoje` | Colaborador em férias hoje continua "em andamento" mesmo depois do financeiro pagar — só sai quando ele volta. |
| **Página do colaborador** → Períodos disponíveis | `status in (apto, em_alerta, vencido, incompleto)` | Regularizados e não habilitados ficam de fora — não têm saldo útil. |
| **Página do colaborador** → Histórico | tudo que NÃO está em andamento | Concluído+volta passada, cancelado, reprovado. Tem busca interna. |

## 5. Casos especiais

### 5.1 Import histórico FériasAtt (2026-11-13)

396 lançamentos importados de planilha. Todos `status='concluido'` + `lancado_direto_por_rh=true`. Datas fictícias: `data_inicio = concessivo_inicio + 183d`, `data_fim = data_inicio + dias - 1`. A fictícia era necessária porque a planilha só tinha "N dias no período X", sem data real. Ver [40-historico-ferias-importado.md](40-historico-ferias-importado.md) pra detalhes do import. Pro fluxo: **são invisíveis em qualquer painel**, só aparecem na página do colaborador e no histórico.

### 5.2 Folha mensal desconta dias de férias

Quando o RH aprova férias de `usufruto` (ou parte de usufruto num `abono_combinado`), a trigger `trg_ferias_recalc_folhas_mensais` recalcula a folha mensal do mês do `data_inicio` se ela ainda estiver em `rascunho`. Fórmula: `salario × (30 - dias_ferias) / 30`. Se a folha já foi enviada ao financeiro, não mexe — RH edita manual. Isso evita pagar salário cheio + férias cheio no mesmo mês.

### 5.3 CLT+recibo (híbrido)

Colaborador tem parte CLT (folha pela contabilidade) e parte PJ (NF direto pra California). Férias da parte PJ passa pelo fluxo normal; a parte CLT é feita off-sistema pela contabilidade e não aparece em `folhas_pagamento`.

### 5.4 Sócio

`tipo_contratacao='socio'` não tem período de férias. Migration `20261002000012` dropou os 63 períodos dos 3 sócios ativos em 2026-10-02. A trigger de geração também é no-op pra sócio.

## 6. Papéis e telas

### 6.1 Colaborador — `/perfil`

Vê saldo, aquisitivos, lista as próprias solicitações com status, botão "Solicitar férias" que cria um lançamento em `pendente_aprovacao`, botão de upload de NF quando a solicitação está `aprovado`. Realtime via Supabase channel pra atualizar quando o RH aprova.

### 6.2 RH — `/rh/ferias`

4 tabs:

1. **Dashboard** — hero com Pill Novidades (3 fontes: solicitações recentes, NFs anexadas, folhas pagas) + 4 cards de KPI + 2 widgets (Esta semana / Próximos vencimentos).
2. **Solicitações** — tabela com chips do fluxo (Todas | Pendentes | Aprovados | NF Anexada | Enviado Financeiro | Concluídos). Clica na linha → modal detalhe com valores, NFs a emitir, alerta de desconto em folha mensal, e botões Aprovar/Reprovar/Enviar pro Financeiro/Ver Colaborador conforme status. Ordenação do chip "Todas" segue o pipeline.
3. **Colaboradores** — lista com filtros. Clica → `/rh/ferias/[id]`: hero dark + "Em andamento" (sempre aberto) + "Períodos disponíveis" (colapsado) + "Histórico" (colapsado com busca).
4. **Pendências** — correções manuais de lançamentos irregulares (saldo > direito, aquisitivo errado, etc.) que nasceram do import histórico.

### 6.3 Financeiro — `/financeiro/contas-a-pagar` aba People

Vê a linha de pagamento quando `folhas_pagamento.status = 'enviada'` via view `vw_people_aprovar_financeiro`. O financeiro não vê nem distingue `colaboradores_ferias_lancamentos` — ele opera sobre a folha. Baixar a folha marca como `paga`.

## 7. Gaps conhecidos

### 7.1 Transição `enviado_financeiro` → `concluido` não existe

Depois que o RH clica "Enviar pro Financeiro", o lançamento fica em `enviado_financeiro` **para sempre**. Nenhuma trigger ou action marca como `concluido` quando o financeiro paga a folha correspondente. Hoje, pra ver "concluído" no banco:
- Os 398 já em `concluido` vieram do import histórico ou foram marcados manualmente no SQL.
- Lançamentos novos que passem pelo fluxo completo vão travar em `enviado_financeiro`.

**Resolver**: criar trigger em `folhas_pagamento` — ON UPDATE com `OLD.status != 'paga' AND NEW.status = 'paga' AND NEW.tipo = 'ferias' AND NEW.lancamento_ferias_id IS NOT NULL`, UPDATE `colaboradores_ferias_lancamentos SET status='concluido' WHERE id=NEW.lancamento_ferias_id AND status='enviado_financeiro'`.

Se o lançamento tiver 2 folhas (usufruto + abono) e só uma for paga, a trigger ainda sobe a primeira — precisa pensar se queremos exigir que **as duas** estejam pagas antes de concluir. Decisão pra tomar quando for implementar.

### 7.2 `aguardando_financeiro` morto no enum

Valor morto desde a migration `20261026700007`. Nada escreve nele. Remover exigiria DROP+recreate do enum (destrutivo, trocaria tipo da coluna). Fica como vestígio no enum; nenhum BadgeStatus ativo o usa.

## 8. Migrations relevantes

- `20261002000004_ferias_lancamentos.sql` — tabela + enum + policies
- `20261002000010_rh_perf_consolida_policies.sql` — performance das queries de leitura
- `20261002000012` — exclui sócios
- `20261003000002` — correção da trigger `fn_gerar_ferias_periodos`
- `20261026700001_nf_anexos_generalizacao_escopo.sql` — `colaboradores_nf_anexos` fica genérica
- `20261026700003_vw_nf_quadro_e_people.sql` — view do financeiro
- `20261026700007_ferias_policy_so_aprovado.sql` — policy do financeiro simplifica pra `status='aprovado'` (pós mudança de modelo)
- `20261113200001_folha_mensal_desconta_dias_ferias.sql` — trigger de desconto proporcional
- `20261113300001_ferias_nf_anexada_e_enviado_financeiro.sql` — fundação do fluxo novo (`nf_anexada` + `enviado_financeiro` + trigger `fn_sincroniza_status_lanc_por_nf`)

## 9. Para onde isso vai

- **Fechar a transição pra `concluido`** (§7.1).
- **Notificações centralizadas** — hoje o Dashboard tem Pill Novidades próprio; a direção é o hub central (ver [pendencias/hub-central-notificacoes.md](../../pendencias/hub-central-notificacoes.md)).
- **Analytics do fluxo** — tempo médio de cada etapa (pendente → aprovado, aprovado → NF, etc.) seria útil pra RH saber onde estão os gargalos.
