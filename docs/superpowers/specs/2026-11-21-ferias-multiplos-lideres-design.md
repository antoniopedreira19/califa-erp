# Férias — múltiplos líderes por colaborador

Data: 2026-11-21 (noite da mesma sessão do PR de aprovação em duas etapas).
Status: Rascunho, aguardando aprovação do Daniel.

## Intenção

Hoje o cadastro suporta 1 líder por colaborador (`colaboradores.lider_id`). Na prática, a Agência California tem casos de colaborador com 2 líderes — um operacional (dia-a-dia) + um funcional (diretor do time). O recorte de "1 líder" foi uma simplificação consciente na entrega de 21/11; esta entrega remove essa simplificação.

A regra decidida com o Daniel em 21/11:

- **N líderes por colaborador** (hoje 2 na prática; banco não trava o número).
- **Qualquer um dos N aprova ou reprova férias.** Primeiro a agir destrava / encerra.
- **Sem hierarquia** entre eles: ambos têm o mesmo poder.

## Goals

- Cadastro em `/rh/colaboradores/[id]` aceita adicionar/remover N líderes (hoje é um Combobox único).
- Fluxo de solicitação de férias: colaborador com **pelo menos 1** líder → status `aguardando_gestor` (igual hoje; a lógica do helper vale sem mudança).
- Página `/equipe` do líder lista todos os liderados em que ele é **um dos** líderes (não só os onde ele é o único).
- Policies RLS SELECT/UPDATE pro líder passam a checar a tabela nova.
- `vw_equipe_do_lider` usa a tabela nova no gating.
- Audit: já cobre — `aprovado_pelo_lider_por` guarda o profile que aprovou (qualquer um dos N).
- Zero mudança destrutiva pros 207 colaboradores que já têm `lider_id` definido.
- Doc operacional (`docs/modulos/rh/25-ferias.md`) e ADR 267 atualizados.

## Non-goals

- **Cap em 2 líderes.** Deixa aberto. Se amanhã virar 3, não precisa de migration.
- **Papéis diferenciados (principal / funcional).** Ambos iguais. Se precisar diferenciar depois, adiciona coluna `tipo` na tabela — nada a fazer agora.
- **Delegação temporária** (líder A ausente → líder B). Já tratado por "qualquer um aprova" + override do RH.
- **Notificação pros N líderes.** Depende do hub central de notificações (dívida existente).

## Anti-goals (coisas que, se acontecerem, significam que falhamos)

- Colaborador sem líder nenhum ficar travado em `aguardando_gestor` esperando alguém que não existe.
- Líder antigo (removido do cadastro) continuar vendo lançamentos na `/equipe`.
- Duas aprovações duplicadas pro mesmo lançamento (líder A e B aprovam ao mesmo tempo, status vai pra `pendente_aprovacao` 2 vezes).
- Dashboards/queries consumindo `lider_id` direto quebrarem por conta da mudança.

## Restrições

- **PII (regra transversal CLAUDE.md):** migration só com UUID, nunca com nome/email.
- **RLS:** policies novas usam `(select auth.uid())` (memória `feedback_rls_dados_pessoais`).
- **Performance:** a tabela nova precisa de índice `(lider_id)` pra policies ficarem rápidas; `(colaborador_id)` pra listar os líderes de um colab.
- **Compatibilidade:** `colaboradores.lider_id` continua existindo, sincronizado via trigger pra o "primeiro líder" (o mais antigo em `created_at`). Simplifica dashboards legados que só querem um valor. Removido só no Passo 2, depois de confirmar que ninguém mais consome.
- **FK ON DELETE SET NULL / CASCADE:** se um profile é deletado, as linhas da tabela nova vão por `ON DELETE CASCADE` (a relação não faz sentido sem o profile).

## Approaches considerados

### A — Tabela `colaboradores_lideres` + `colaboradores.lider_id` como cache sincronizado

- Nova tabela com `(colaborador_id uuid, lider_id uuid, created_at timestamptz)`, PK composta (colaborador_id, lider_id).
- Popular com as 207 linhas atuais no mesmo migration (backfill).
- Trigger `BEFORE INSERT/DELETE` na tabela sincroniza `colaboradores.lider_id` com o MIN(created_at) — o "primeiro líder".
- Todos os consumidores NOVOS olham a tabela. Consumidores legados (que ainda não migramos) continuam lendo `lider_id` e veem o primeiro líder.
- Passo 2 (futuro): remove `colaboradores.lider_id`.

**Trade-off:** 2 lugares da verdade durante o período de migração. Trigger garante consistência; se der bug na trigger, a confusão é real.

### B — Tabela nova e remove `lider_id` no mesmo PR

- Mesma tabela.
- `ALTER TABLE colaboradores DROP COLUMN lider_id` no mesmo migration.
- Todo consumidor olha a tabela, não há cache.

**Trade-off:** mais lugares pra mudar no mesmo PR (10 arquivos no app + lib/types + policies + view). Risco de slip maior; se um lugar escapar, o build quebra.

### C — Array `colaboradores.lideres uuid[]`

Descartada: o projeto não usa array pra FK; perde FK real; `ANY()` em RLS é feio e perde índice; migrar pra "data de início da relação" depois exige reescrever tudo.

**Decisão:** A, em 2 passos. Convenção local já tem precedente: `jobs.competencia_trimestre` espelha a primeira linha de `jobs_competencias`. Reduz risco de regressão em dashboards legados e permite testar a entrega sem pressão de "um lugar escapou".

## Decisões fechadas

1. Tabela `colaboradores_lideres (colaborador_id uuid, lider_id uuid, created_at timestamptz default now())`, PK `(colaborador_id, lider_id)`.
2. FK `colaborador_id` → `colaboradores(id)` ON DELETE CASCADE.
3. FK `lider_id` → `profiles(id)` ON DELETE CASCADE.
4. Índice btree em `(lider_id)` pra policies RLS.
5. `colaboradores.lider_id` fica como cache do "primeiro líder" (MIN(created_at)), sincronizado por trigger `AFTER INSERT/DELETE` na tabela nova. Removido só no Passo 2.
6. Backfill inicial: 207 linhas a partir dos `lider_id` atuais. Migration só com UUIDs.
7. Helper `temLiderados` passa a olhar a nova tabela (ou fica com o `lider_id` + visão da tabela — vai pro plano).
8. Policies RLS do PR anterior reescritas pra fazer EXISTS na tabela nova.
9. View `vw_equipe_do_lider` reescrita pra fazer EXISTS na tabela nova.
10. UI de cadastro: `editar-dados-drawer.tsx` ganha componente de chips removíveis + Combobox pra adicionar.
11. `aprovarLancamentoComoLider` / `reprovarLancamentoComoLider`: guard vira "é um dos líderes" (EXISTS em `colaboradores_lideres`).
12. Audit: nenhuma mudança — `aprovado_pelo_lider_por` guarda o profile que aprovou, qualquer que seja.
13. Doc operacional + ADR 267 atualizados pra refletir N líderes.

## O que fica aberto pro builder

- Nome exato do componente de chips (seguir padrão existente de multi-select no projeto).
- Ordem de apresentação dos líderes no card do colaborador (proposta: ordem de inserção).
- Se o cadastro deve exigir pelo menos 1 líder (proposta: não — colaborador sem líder cai no RH direto).
- Se deve haver cap no número de líderes (proposta: não).

## Riscos conhecidos

1. **Trigger bugada deixa `lider_id` desatualizado.** Mitigação: teste de banco no plano confirma que após INSERT na tabela o cache bate.
2. **Consumidor que escrevia em `lider_id` direto (não há no código atual, só o convite da contratação).** Verificar e, se houver, migrar pra escrever na tabela nova.
3. **Policy RLS sem índice no (lider_id) da tabela nova degrada performance da `/equipe`.** Mitigado pelo índice listado em §3.

## Plano de release

Passo 1 (este PR) entrega N líderes funcionando end-to-end. Passo 2 (futuro, opcional) remove `colaboradores.lider_id`. Um plano de execução vai em `docs/superpowers/plans/2026-11-21-ferias-multiplos-lideres-passo-1.md`.
