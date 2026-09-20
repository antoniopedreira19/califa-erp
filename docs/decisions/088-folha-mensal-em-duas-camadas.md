# 088 — Folha mensal em duas camadas, valor manual e propagação pela aprovação

**Data:** 2026-09-18
**Status:** aceita
**Escopo:** módulo RH · subsistema Folha Mensal

## Contexto

O módulo RH nasceu (2026-09-16) com colaboradores + alocação múltipla + histórico salarial e um esqueleto de tabelas para a folha (`folhas_pagamento`, `folhas_pagamento_alocacoes`) sem UI. A ideia era destravar o cadastro primeiro e voltar depois para o motor da folha.

Entrando no motor, quatro questões ficaram em jogo:

1. **Onde a folha vive** — tabela própria com N linhas? Uma linha por colaborador? Uma folha pai?
2. **Como o valor é decidido** — proporcional? cheio? pro-rata? tabela de rubricas?
3. **Quem edita e quando** — RH edita rascunho? Financeiro edita ao revisar? Os dois?
4. **Como conversa com a Camada 1** — a folha altera o vigente do colaborador ou não?

Sem essas respostas, a folha vira uma cópia de planilha eletrônica dentro do ERP — o pior dos dois mundos. Este ADR trava as respostas.

## Decisão

### D1. Modelo em duas camadas — permanece

**Camada 1** (`colaboradores_alocacoes` + `colaboradores_salarios`) — o "hoje" mantido pelo RH.
**Camada 2** (`folhas_pagamento` + `folhas_pagamento_alocacoes`) — snapshot por competência, imutável depois de aprovado.

Não existe tabela "folhas" pai. **A folha do mês é a agregação** `WHERE competencia_ano=X AND competencia_mes=Y`. Menos entidade, menos código, e reflete a realidade: linhas caminham em ritmos diferentes (uma reprovada e voltando pro RH enquanto as outras já foram aprovadas).

### D2. Valor manual, sistema só sugere

`folhas_pagamento.salario_base` **não é calculado**. É o valor que o RH quer efetivamente pagar naquele mês, digitado manualmente. O sistema apenas sugere um default ao gerar: o salário vigente da Camada 1 na data de geração.

Isso dissolve automaticamente as decisões difíceis:

- Admissão no meio do mês → RH decide se paga cheio, pro-rata ou combinado.
- Demissão no meio do mês → RH digita salário + rescisão como valor único.
- Aumento no meio do mês → RH decide.
- Bônus / adiantamento / hora extra → RH soma direto (motivo textual — D9).

O banco não conhece pro-rata, dias úteis, encargos ou rubricas. É burro por design.

### D3. Estados por linha, não pela folha inteira

Enum `folha_linha_status`: `rascunho → enviada → aprovada → paga` + desvio `enviada → pendente_correcao → enviada`. Cada linha carrega seu status; a "folha do mês" nunca tem um status próprio.

Motivos:

- Reflete o fluxo real: financeiro reprova o João porque o PIX tá errado, aprova a Maria, e a folha inteira anda em ritmo misto.
- Permite ação em massa quando faz sentido ("enviar tudo", "aprovar tudo") sem forçar quando não faz.
- Elimina um estado tri-modal (folha em rascunho / em revisão / finalizada) que seria derivado das linhas de qualquer jeito.

### D4. RH edita rascunho / pendente_correcao; financeiro edita enviada; aprovada+ são imutáveis

Quem escreve em qual momento:

| Status | Quem edita | O que edita |
|---|---|---|
| `rascunho` | RH | `salario_base`, alocações |
| `pendente_correcao` | RH | mesmo; reenviar limpa `motivo_pendencia` (fica no audit) |
| `enviada` | Financeiro | mesmo; ajusta antes de aprovar |
| `aprovada`, `paga` | ninguém pela UI | imutável (correções extraordinárias exigem SQL) |

**A regra vive nas server actions**, não na RLS. A RLS libera admin + rh + financeiro para SELECT/INSERT/UPDATE em ambas as tabelas — o gate de "quem escreve em qual status" é dinâmico e não caberia em `WITH CHECK`.

### D5. Aprovar propaga para a Camada 1

Este é o pulo do gato. Quando o financeiro aprova uma linha, se `salario_base` ou as alocações foram editadas em relação ao que o RH mandou, o sistema **propaga a mudança para a Camada 1**:

- `colaboradores_salarios` vigente é fechado com `data_fim = data_aprovacao`; nova linha aberta com o valor aprovado (`motivo = "Ajuste em folha " || competencia`).
- `colaboradores_alocacoes` vigentes fechadas; novas linhas abertas com as alocações aprovadas.
- `log_audit_event('colaborador.salario_mudou' / 'colaborador.alocacao_aberta')` com origem `folha_aprovada`.

Consequência: a próxima folha gerada nasce com o que o financeiro aprovou, não com o que o RH originalmente cadastrou. Fecha o loop naturalmente sem exigir "confirmar" a mudança em duas telas.

`data_inicio` da nova linha = `data_aprovacao + 1 dia` — evita reescrever folhas em rascunho que já haviam pegado o vigente antigo. A escolha por "+1 dia" em vez de "no dia da aprovação" foi deliberada: aprovar em 30/set não deve mexer numa folha de setembro já em fluxo.

### D6. Sem variáveis, sem 13º/férias/rescisão separados

O MVP não modela rubricas separadas (adiantamento, hora extra, bônus, comissão, encargos). Se precisar pagar mais, o RH soma em `salario_base` e explica no motivo (informal — não há campo `motivo` na folha; a documentação do valor mora no `motivo_pendencia` só quando houve reprovação, ou nos commits do audit).

13º salário, férias e rescisão também não têm folha própria no MVP — entram como ajuste manual na folha do mês em que caem.

Todos esses recortes são aditivos: viram tabela filha `folhas_pagamento_rubricas` ou coluna `tipo_folha` numa fase futura sem quebrar dado existente.

### D7. Integração com contas a pagar fica para depois

Aprovar linha altera status + propaga Camada 1. **Não gera `contas_avulsas` automaticamente.** Isso foi separado de propósito: valida o motor da folha antes de mexer no financeiro real. A geração de `contas_avulsas` (uma por par colaborador × alocação, valor rateado pelo percentual) vira Rodada 4, depois que o fluxo humano estiver rodando.

### D8. UI do lado do financeiro vira tab em `/financeiro/contas-a-pagar`, não rota nova

Decisão de 2026-09-18: a listagem para o financeiro entra como aba nova (**"Folhas de Pagamento"**) em `/financeiro/contas-a-pagar`, entre "Recorrências" e "Títulos a Pagar". Motivo: o financeiro já tem um único lugar para ver o que precisa pagar. Rota separada `/financeiro/folhas` fragmentaria a experiência sem ganho.

## Alternativas descartadas

- **Tabela `folhas` pai com status agregado.** Descartada — o status agregado seria sempre derivado das linhas; a tabela pai só teria dados de audit que já cabem em `folhas_pagamento` linha-a-linha.
- **Cálculo automático de pro-rata / encargos / rubricas no MVP.** Descartada — dobra o escopo e trava por regras trabalhistas que variam entre CLT/PJ/Estágio. Valor manual libera o MVP para ir ao ar com todos os tipos suportados no dia 1.
- **Camada 2 imutável em relação à Camada 1** (sem propagação da aprovação). Descartada — obrigaria o RH a espelhar manualmente na Camada 1 tudo que o financeiro corrigiu. Muito trabalho para uma decisão que já foi tomada.
- **Financeiro tem rota própria `/financeiro/folhas`.** Descartada em favor da tab (D8).

## Consequências

- Zero cálculo de folha no banco. Se a California quiser implementar pro-rata automatizado no futuro, é decisão nova e sobrepõe (não reescreve) o que existe.
- A propagação da aprovação (D5) é a única regra realmente "esperta" do subsistema. Se ela quebrar, o RH fica com a Camada 1 desalinhada da última folha aprovada — bug silencioso. Precisa de testes de integração antes de liberar em produção.
- Contas a pagar não sabe nada de folha até a Rodada 4. Ganhar `contas_avulsas` a partir de folha aprovada é o próximo ADR quando essa integração for feita.

## Referências

- `docs/modulos/rh/20-folha-mensal.md` — spec completa do subsistema
- `docs/modulos/rh/00-descoberta.md` §6.2 — origem do modelo em duas camadas
- `docs/modulos/rh/03-modelo-de-dados.md` — desenho das tabelas esqueleto
- `supabase/migrations/20260918000001_rh_folha_mensal.sql` — migration que ampliou o esqueleto
