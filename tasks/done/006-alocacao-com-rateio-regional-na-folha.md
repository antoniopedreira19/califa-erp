# Task 006 — Alocação de colaborador com rateio regional automático na folha

## Objetivo

Redesenhar o modelo de alocação de colaborador pra suportar dois padrões que existem na planilha real da Kika, sem ficar preso ao workaround "GERAL":

1. **Colaborador com regional fixa** — cai em uma empresa + uma regional específica (100% do salário ali). Sem toggle.
2. **Colaborador com custo transversal** (diretor comercial nacional, backoffice California) — cai numa empresa e o salário é dividido entre as regionais dela conforme uma **tabela de rateio anual configurada por empresa**. Toggle "Todas as regionais" liga esse modo.

A tabela de rateio é fonte-verdade — Kika edita 1×/ano por empresa e todos os transversais daquela empresa refletem na próxima folha, sem tocar em nenhuma alocação individual. Folhas antigas ficam imutáveis por causa do snapshot.

## Contexto do ponto de partida

- **Regionais GERAL removidas do banco em 2026-09-23** (California, CCH, Hitlab). A migration `20260916000004_rh_regional_geral.sql` continua no repositório como histórico; um novo reset de banco recriaria elas. **Precisa decidir** se apagamos a migration ou escrevemos uma sucessora que anula ela. Anotado como débito técnico separado.
- **Folha de Setembro/2026 do Antonio foi apagada** (contas avulsas geradas + snapshot + linha da folha). Camada 1 do Antonio permanece intacta: 2 alocações vigentes (Empresa Teste 50% + CCH 50%) desde 2026-09-17.
- **Modelo atual** (será refeito): `colaboradores_alocacoes` tem N linhas por colaborador com `(empresa_id, regional_id NOT NULL, percentual)` somando 100% + trigger que valida a soma.
- **Modelo novo** (a implementar): 1 linha vigente por colaborador (não é mais múltipla), com `regional_id` nullable e um flag `usa_rateio_empresa`. Sem % na Camada 1.

## Decisões travadas (não replanejar)

Decisões alinhadas com o Antonio em 2026-09-23:

1. **Uma alocação vigente por colaborador.** Adeus caso híbrido (múltiplas empresas somando 100%).
2. **Toggle "Todas as regionais" só aparece se a empresa tem rateio configurado.** Empresa Teste e Hitlab hoje não têm — no formulário delas, é regional específica direta.
3. **Rateio por ano-calendário.** 2026 inteiro usa o mesmo rateio.
4. **Regionais com 0% não vão pra tabela.** Só grava as que têm % (ex: California 2026 grava 4 linhas: NE, NO, SP, RJ — SS não vira linha).
5. **Sem sub-grupos nomeados por enquanto** ("Comercial nacional" etc.). Só o toggle binário "todas ou uma".
6. **Snapshot da folha continua sendo a fonte imutável.** No momento da geração, se a linha usa rateio, expande em N linhas no `folhas_pagamento_alocacoes` conforme a tabela do ano da competência.

## Entregas

### Banco

- Tabela nova `empresas_rateios_regionais`:
  - `(id uuid pk, tenant_id, empresa_id fk, ano_vigencia int, regional_id fk, percentual numeric(5,2))`.
  - Unique `(tenant_id, empresa_id, ano_vigencia, regional_id)`.
  - CHECK `percentual > 0 and percentual <= 100`.
  - Constraint garantindo que `regional_id` pertence à `empresa_id`.
  - Trigger validando `sum(percentual) por (empresa_id, ano_vigencia) = 100`.
  - RLS `is_tenant_admin OR is_tenant_rh`.
  - GRANT `authenticated`, índice em `(empresa_id, ano_vigencia)`.
- Alteração em `colaboradores_alocacoes`:
  - `regional_id` vira **nullable**.
  - Nova coluna `usa_rateio_empresa boolean not null default false`.
  - CHECK: se `usa_rateio_empresa = true` então `regional_id IS NULL`; se `false`, `regional_id IS NOT NULL`.
  - **Remover** coluna `percentual` (não faz mais sentido — 1 linha = 100%) OU manter default 100 e ignorar. Decidir na migration: preferência por remover se der pra fazer aditivo-limpo.
  - Remover trigger de "soma = 100" — não aplica mais.
- Backfill (aplicado na mesma migration ou separado):
  - California NE/NO/SP/RJ em 2023, 2024, 2025, 2026 conforme print (25%/20%/30%/25% em 2026; ver task pros anos anteriores).
  - CCH Doca 50% + Agency 50% em 2023, 2024, 2025, 2026.
  - Empresa Teste e Hitlab: sem linhas.
- Backfill da Camada 1 existente: o Antonio hoje tem 2 alocações (Empresa Teste 50 + CCH 50). Ambas viram... o quê? **Decidir com o Antonio** — a nova modelagem não suporta esse caso. Duas opções: (a) escolher uma delas (Antonio manda), (b) fechar as duas com `data_fim=hoje` e criar uma nova vigente com CCH+toggle=ON (arbitrária, pra debug seguir).

### Backend

- Server actions em `app/(app)/rh/colaboradores/[id]/actions-alocacao.ts`:
  - `alterarAlocacao(colaborador_id, data_mudanca, empresa_id, usa_rateio_empresa, regional_id?)` — fecha vigente com `data_fim = data_mudanca - 1` e abre nova.
  - Remove `substituirAlocacao` que operava sobre N linhas somando 100.
- Server actions em `app/(app)/admin/empresas/[id]/actions-rateio.ts` (ou similar):
  - `salvarRateioAno(empresa_id, ano, [{ regional_id, percentual }])` — upsert idempotente. Valida soma = 100. Bloqueia se ano < ano atual (evita bagunçar histórico).
- Motor de folha: `gerarFolha` precisa mudar a lógica de snapshot:
  - Se a linha da alocação vigente do colaborador tem `usa_rateio_empresa = true`, expande N linhas em `folhas_pagamento_alocacoes` conforme `empresas_rateios_regionais` do ano da competência da folha.
  - Se `usa_rateio_empresa = false`, cria 1 linha com `regional_id` da alocação e `percentual = 100`.
  - **Regra de erro:** se `usa_rateio_empresa=true` e não existe rateio da empresa para aquele ano, bloqueia geração com mensagem clara ("Configure o rateio de 2026 pra Agência California antes de gerar a folha").

### UI

- Card "Alocação" do colaborador (`app/(app)/rh/colaboradores/[id]/card-alocacoes.tsx`):
  - Timeline vigente + histórico continua.
  - Vigente mostra: `Empresa · Regional` ou `Empresa · Todas as regionais (rateio X% em NE, Y% em SP...)`.
- Drawer "Alterar alocação" (refactor de `editar-alocacoes-drawer.tsx`):
  - Campo 1: Data da mudança.
  - Campo 2: Empresa (Select).
  - Campo 3 (condicional): Toggle "Todas as regionais". **Só aparece se `empresa_id` tem rateio configurado pra o ano corrente**. Caso contrário, não aparece.
  - Campo 4 (condicional): Regional (Select). Aparece só se toggle=OFF ou toggle não existe.
  - Preview do rateio quando toggle=ON: "Salário de R$ X vai virar: R$ Y em NE (25%), R$ Z em NO (20%)...".
- Nova tela CRUD de rateio anual — provável rota: `/admin/empresas/[id]/rateio-regional` ou aba dentro do card da empresa em `/cadastros/regionais`:
  - Uma tabela por ano com as regionais da empresa como linhas e %.
  - Botão "Copiar do ano anterior" pra facilitar entrada de ano novo.
  - Somatório no rodapé (verde 100% / vermelho != 100%).
  - Bloqueio de edição de anos anteriores ao vigente.

### Tipos / validações

- Novos tipos em `lib/types.ts`:
  - `EmpresaRateioRegional` (id, tenant_id, empresa_id, ano_vigencia, regional_id, percentual).
- Ajustes em `Colaborador`, `ColaboradorAlocacao`:
  - `ColaboradorAlocacao`: `regional_id` vira nullable; `usa_rateio_empresa` adicionado; `percentual` sai ou vira sempre 100.
- Zod schemas atualizados em `lib/validations/rh-colaboradores.ts`.

### Docs

- `docs/modulos/rh/03-modelo-de-dados.md` — anotar (no topo, junto com a nota atual sobre pgto-remessa) que o modelo de alocação mudou. Aponta pra esta task.
- Novo ADR em `docs/decisions/NNN-alocacao-por-empresa-com-toggle-de-rateio.md` — decisão arquitetural: por que trocamos "N linhas somando 100%" por "1 linha + toggle + tabela de rateio".
- `docs/modulos/rh/30-proximos-passos.md` — mover essa entrega pra "Estado atual" quando fechar.
- Novo handoff em `docs/handoffs/` no fechamento.

## Critérios de aceite

- [ ] Migration aplicada, MCP confirma tabela + trigger + policies + GRANT.
- [ ] Backfill do rateio California + CCH visível no MCP com soma 100 por ano.
- [ ] Antonio (colaborador de teste) tem alocação vigente coerente com o novo modelo (decisão do usuário sobre qual das duas manter).
- [ ] Criar novo colaborador com regional específica funciona.
- [ ] Criar novo colaborador em California com toggle=ON funciona e o preview mostra o rateio.
- [ ] Alterar alocação existente pra outra empresa: fecha vigente, abre nova, timeline correta.
- [ ] Gerar folha do Antonio pra Outubro/2026 (competência nova):
  - Se ele estiver em Empresa Teste (sem rateio): snapshot com 1 linha 100%.
  - Se ele estiver em California com toggle=ON: snapshot com 4 linhas (NE, NO, SP, RJ nos %s do rateio).
- [ ] CRUD de rateio funciona: editar 2026, adicionar 2027, bloqueio de 2023.
- [ ] `tsc` limpo, `next lint` limpo.
- [ ] Handoff datado escrito.
- [ ] Task movida pra `tasks/done/`.

## Fora de escopo

- Sub-grupos nomeados de rateio ("Comercial nacional" etc.) — fica pra fase futura se surgir demanda.
- Rateio mensal (competência por competência) — decisão travada em anual.
- Auto-preencher rateio de anos futuros com o do ano vigente — copiar é botão manual.
- Alterar retroativamente rateio de ano já com folha gerada — as folhas antigas ficam imutáveis pelo snapshot; regra é bloqueio de edição de anos anteriores no CRUD.
- Import da planilha atual (P1.1 do backlog RH) — segue como próxima task depois desta.

## Ordem sugerida de implementação

1. Migration nova (`empresas_rateios_regionais` + alteração em `colaboradores_alocacoes`).
2. Backfill (California + CCH via SQL na mesma migration).
3. Backfill da alocação do Antonio (definir com usuário qual manter).
4. Types + Zod.
5. CRUD de rateio (tela + server actions).
6. Refactor do drawer de alocação (toggle condicional).
7. Motor de folha atualizado (`gerarFolha` expande rateio).
8. Testes manuais dos critérios de aceite.
9. Docs (ADR + handoff + 30-proximos-passos).
