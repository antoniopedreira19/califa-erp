# 20 — Folha Mensal (subsistema do módulo RH)

## Objetivo

Materializar a Camada 2 do modelo do RH (snapshot por competência) num fluxo operacional real: o RH gera a folha do mês, revisa, envia para o financeiro; o financeiro aprova linha a linha ou tudo de uma vez, com opção de reprovar com motivo. Aprovar propaga mudanças de alocação/salário para a Camada 1, tornando-as a nova verdade viva do colaborador.

Substitui a rotina atual de digitar a folha em planilha e passar por e-mail para o financeiro. Zero variáveis, zero cálculo automático — o valor a pagar é sempre informado pelo RH.

## Referências

- `03-modelo-de-dados.md` — desenho original das tabelas esqueleto
- `00-descoberta.md` §6.2 — Camada 1 vs Camada 2
- `supabase/migrations/20260916000008_rh_folhas_esqueleto.sql` — esqueleto criado no MVP
- `supabase/migrations/20260916000006_rh_alocacoes.sql` — precedente do constraint trigger de soma=100 (deferrable initially deferred)

## Decisões (rodada única de discovery — 2026-09-18)

### D1. Escopo dos colaboradores incluídos

Ao gerar a folha da competência `Y-M`, entram **todos os colaboradores que estiveram ativos em qualquer dia** do intervalo `[Y-M-01, Y-M-31]`. Isso cobre:

- Colaborador admitido no meio do mês (a folha registra ele).
- Colaborador demitido no meio do mês (a folha final registra ele).
- Colaborador ativo o mês inteiro (padrão).

Colaborador com `status='inativo'` cuja `data_encerramento < Y-M-01` fica de fora.

### D2. Valor da folha é manual, sistema só sugere

`folhas_pagamento.salario_base` **não é derivado**. É o valor que o RH quer efetivamente pagar naquele mês, digitado manualmente. O sistema apenas sugere um default ao gerar: o salário vigente na Camada 1 na data de geração.

Isso resolve automaticamente os cenários difíceis:

- Admissão no meio do mês → RH decide se paga cheio ou pro-rata.
- Demissão no meio do mês → RH digita salário + rescisão como um único valor.
- Aumento no meio do mês → RH decide se paga o novo ou o antigo (ou proporcional).
- Bônus/adicional pontual → RH soma direto no valor.

Nenhum cálculo pro-rata acontece no banco. Toda decisão está registrada no valor final da linha.

### D3. Alocação da folha é snapshot da Camada 1 + edição

Ao gerar uma linha da folha, o sistema copia as alocações vigentes atuais do colaborador (`colaboradores_alocacoes` com `data_fim IS NULL`) para `folhas_pagamento_alocacoes`. Cada linha da folha tem N linhas de alocação somando 100%.

O RH pode editar antes de enviar. O financeiro pode editar até aprovar (D8).

### D4. Uma folha por competência por tenant

Unique constraint `(tenant_id, competencia_ano, competencia_mes, colaborador_id)` no `folhas_pagamento`. Não existe "folha extra", "folha do 13º", "folha de férias" — se precisar pagar 13º ou rescisão, entra como valor manual dentro da folha do mês. Se um dia precisarmos separar por tipo, é migration aditiva (`tipo_folha` enum).

### D5. Estados por linha, não pela folha inteira

Cada linha de `folhas_pagamento` tem seu próprio `status`. A "folha do mês" é a agregação `WHERE competencia_ano=X AND competencia_mes=Y`. Menos tabela, menos código, e reflete a realidade: linhas caminham em ritmos diferentes (uma pode ser reprovada e voltar pro RH enquanto as outras já foram aprovadas).

Enum `folha_linha_status`:

```
rascunho ─(RH envia)─▶ enviada
                        │
                        ├─(fin aprova)──▶ aprovada ─(fin marca paga)─▶ paga
                        │
                        └─(fin reprova + motivo)──▶ pendente_correcao
                                                       │
                                                       └(RH corrige + reenvia)──▶ enviada
```

Estado inicial ao gerar: `rascunho`. Estados terminais só o `paga`.

### D6. Motivo obrigatório na reprovação

Ao mudar para `pendente_correcao`, o financeiro **deve** informar `motivo_pendencia` (min 3 caracteres). Fica visível pro RH corrigir. RH corrige a linha e reenvia; ao reenviar, `motivo_pendencia` é limpo (mas fica no audit).

### D7. RH edita até enviar; depois só o financeiro

Quando `status = rascunho` ou `pendente_correcao` → só o RH edita (`salario_base`, `folhas_pagamento_alocacoes`).

Quando `status = enviada` → só o financeiro edita.

Quando `status = aprovada` ou `paga` → ninguém edita. Estados terminais são imutáveis pela UI (correções extraordinárias exigem admin via SQL, auditadas manualmente).

### D8. Aprovar propaga para a Camada 1

Ao aprovar uma linha (`status: enviada → aprovada`), se o financeiro alterou `salario_base` ou alguma linha de `folhas_pagamento_alocacoes` em relação ao que o RH mandou, o sistema **propaga a mudança para a Camada 1**:

- Fecha `colaboradores_salarios` vigente com `data_fim = data_aprovacao` e abre linha nova com o valor aprovado e `data_inicio = data_aprovacao + 1 dia` (`motivo = "Ajuste em folha " || competencia`).
- Faz swap atômico em `colaboradores_alocacoes` (fecha vigentes, abre novas com a alocação aprovada, `data_inicio = data_aprovacao + 1 dia`).
- `log_audit_event('colaborador.salario_mudou' / 'colaborador.alocacao_aberta')` com origem `folha_aprovada`.

Consequência prática: a próxima folha gerada nasce automaticamente com a alocação/salário que o financeiro aprovou. RH não precisa "confirmar" a mudança na Camada 1.

Cuidado com o `+1 dia`: se aprovar em 30/set com `data_inicio = 30/set` na nova alocação, e a folha de setembro (em rascunho aguardando envio) já tem a alocação antiga, gerar folha de outubro copiaria tudo certo. Se aprovar em 01/out e usar `data_inicio = 01/out`, a folha de outubro (se já foi gerada) precisaria ser regerada. `data_inicio = data_aprovacao + 1 dia` evita esse edge case: a mudança vale a partir do dia seguinte.

### D9. Sem variáveis no MVP

Nada de rubricas separadas (adiantamento, hora extra, bônus, comissão). Se precisar pagar qualquer coisa a mais, o RH soma no `salario_base` e explica no motivo. Se o dia virar problema, entra tabela filha `folhas_pagamento_rubricas` em fase futura — aditivo, sem quebrar nada.

### D10. Nada de integração com contas a pagar no MVP

Aprovar linha muda status e propaga pra Camada 1. **Não gera `contas_avulsas` automaticamente**. A integração com `vw_a_pagar` é a etapa seguinte — separada de propósito para validar o motor da folha antes de mexer no financeiro.

Fase futura: `aprovarLinha` também vai criar uma `conta_avulsa` para cada par (folha_linha, alocação), com valor rateado pelo `percentual`. Isso já foi previsto no `00-descoberta.md` §4.3.

## Estados da linha e transições permitidas

| De → Para | Quem executa | Server action |
|---|---|---|
| `rascunho → enviada` | RH | `enviarLinhaParaFinanceiro(id)` |
| `pendente_correcao → enviada` | RH | mesma action; limpa `motivo_pendencia` |
| `enviada → aprovada` | Financeiro | `aprovarLinha(id)` — dispara propagação (D8) |
| `enviada → pendente_correcao` | Financeiro | `reprovarLinha(id, motivo)` |
| `aprovada → paga` | Financeiro | `marcarLinhaPaga(id, data_pagamento)` |

Envio em lote:
- `enviarFolhaInteira(ano, mes)` — muda todas as linhas `rascunho` da competência para `enviada`.
- `aprovarFolhaInteira(ano, mes)` — aplica `aprovarLinha` em cascata para todas em `enviada`. Se alguma falhar (ex.: alocação com percentual != 100), retorna erro e reverte.

## Estrutura de UI

### `/rh/folhas` — lista de competências
- Tabela: Competência (`Out/2026`), Total de linhas, Rascunho, Enviada, Aprovada, Paga, Pendente
- Botão "Nova folha" — abre modal com dropdown de competência (default = mês atual, oferece últimos 3 meses e próximos 2)
- Clicar em competência → `/rh/folhas/[ano-mes]`
- Ordenação padrão: mais recente primeiro

### `/rh/folhas/[ano-mes]` — folha da competência
- Header com competência + total geral + botão "Enviar tudo" (só se houver rascunho)
- Filtros: status (Rascunho / Enviada / Aprovada / Pendente / Paga), empresa
- Tabela: Colaborador · Função · Alocação (resumo empresa/regional/%) · Salário base · Status · Ações
- Linha clicável → **drawer** com edição inline (só se o status permitir edição do lado atual — D7)
- Drawer permite editar `salario_base` (via `MoedaInput`) e a lista de alocações somando 100%
- Estados terminais (aprovada/paga) — drawer é read-only mas mostra tudo (inclusive quem aprovou/pagou)

### `/rh/folhas/[ano-mes]/pendencias` — atalho
- Filtro pré-aplicado por `status = pendente_correcao`
- Card destacado com motivo da pendência de cada linha
- Fluxo esperado: RH clica → corrige no drawer → botão "Reenviar linha"

### Card no hub `/rh`
Novo card "Folha do mês" ao lado do "Colaboradores". Mostra número de linhas em `pendente_correcao` no mês corrente (destaque quando > 0).

## Migration prevista

**Nome:** `YYYYMMDDHHMMSS_rh_folha_mensal.sql`

**Mudanças aditivas em `folhas_pagamento`:**
- Novo enum `folha_linha_status` (`rascunho, enviada, aprovada, pendente_correcao, paga`)
- ALTER column `status TYPE folha_linha_status USING status::folha_linha_status` (a coluna nasceu como text; nada foi inserido, cast trivial)
- ADD `motivo_pendencia text`
- ADD `enviada_em timestamptz`, `enviada_por uuid → profiles`
- ADD `aprovada_em timestamptz`, `aprovada_por uuid → profiles`
- ADD `paga_em date`, `paga_por uuid → profiles`
- ADD `data_pagamento date` (quando o financeiro planejou pagar)
- ALTER UNIQUE INDEX ampliado para `(tenant_id, competencia_ano, competencia_mes, colaborador_id)` (era só `(colaborador_id, ano, mes)`)

**Mudanças em `folhas_pagamento_alocacoes`:**
- Adiciona função `enforce_folha_alocacao_soma_100()`
- Adiciona constraint trigger `trg_folha_alocacao_soma_100` (deferrable initially deferred) — mesmo padrão do trigger de `colaboradores_alocacoes`.

**Grants adicionais em `folhas_pagamento` e `folhas_pagamento_alocacoes`:**
- SELECT/INSERT/UPDATE para `authenticated` já existe (do esqueleto)
- Financeiro entra na policy: `is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro` para SELECT
- Escrita continua `is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro` (ambos os lados escrevem em fases diferentes; a lógica de "quem escreve quando" é enforçada pelas server actions, não pela RLS — porque status é dinâmico)

Novo helper `is_tenant_financeiro(uuid)` no padrão de `is_tenant_rh`.

## Auditoria

Novas ações previstas em `AuditAction`:

| Ação | Metadata mínima |
|---|---|
| `folha.gerada` | `{ ano, mes, colaboradores_incluidos: N }` |
| `folha.linha.editada_rh` | `{ folha_id, campo, valor_anterior, valor_novo }` |
| `folha.linha.editada_financeiro` | `{ folha_id, campo, valor_anterior, valor_novo }` |
| `folha.linha.enviada` | `{ folha_id, competencia }` |
| `folha.linha.aprovada` | `{ folha_id, salario_aprovado, alocacoes_aprovadas, propagou_camada_1: bool }` |
| `folha.linha.reprovada` | `{ folha_id, motivo }` |
| `folha.linha.paga` | `{ folha_id, data_pagamento }` |

## Fora do escopo do MVP da folha

- Geração automática de `contas_avulsas` na aprovação (fase seguinte).
- Emissão de holerite/recibo em PDF.
- Cálculo de encargos CLT (INSS, FGTS, IRRF).
- 13º salário como folha própria.
- Férias como folha própria.
- Rescisão como folha própria.
- Autoserviço do colaborador (consulta ao holerite).
- Aprovação multi-nível (financeiro → gerência → admin).
- Cronjob/notificação lembrando de gerar a folha.

## Ordem de rodadas de implementação

1. **Rodada 1** (esta sessão): documentação (este arquivo) + migration + card no hub + listagem `/rh/folhas` vazia (com botão desabilitado enquanto a Rodada 2 não implementa a geração).
2. **Rodada 2**: geração de folha (server action `gerarFolha` + página `/rh/folhas/[ano-mes]` editável pelo RH).
3. **Rodada 3**: envio + aprovação + reprovação + propagação para Camada 1 + tela do financeiro.
4. **Rodada 4** (fase futura): integração com contas a pagar.

Cada rodada encerra com commit próprio.
