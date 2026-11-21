# 267 — Férias: aprovação em duas etapas (líder, depois RH)

**Data:** 2026-11-21
**Status:** aceita e implementada em 21/11/2026.
**Quem decidiu:** Daniel, em 21/11/2026, no brainstorm da entrega.

## O problema

Até aqui, a aprovação de férias era só do RH: o colaborador solicitava em `/perfil`, a solicitação caía em `pendente_aprovacao`, e qualquer admin ou RH aprovava direto. O líder direto ficava sabendo das férias do time pelo WhatsApp ou pelo próprio colaborador. Risco concreto: aprovações batendo com evento de cliente, sem a chance do líder segurar.

A tabela `colaboradores.lider_id` já existia (FK pra `profiles`, migration `20260929120922`), mas a cobertura era baixa — ~34% dos colaboradores com líder definido. Em 21/11 chegou a planilha oficial de lideranças da California, que o backfill levou a 93% de cobertura.

## Decisão

Férias ganha **duas etapas de aprovação em série**:

1. Colaborador solicita em `/perfil` → status `aguardando_gestor` (se tem líder) ou `pendente_aprovacao` (sem líder).
2. Líder direto aprova via nova página `/equipe` → status vai pra `pendente_aprovacao`.
3. RH aprova via `/rh/ferias` → status `aprovado`, folhas criadas.

**Fallback sem líder:** quem não tem `lider_id` cai direto em `pendente_aprovacao` (fluxo antigo preservado). A base dos "sem líder" é preenchida pelo uso — o RH define o líder quando precisar. Decidido pular backfill 100% porque atrasaria a entrega, e com 93% de cobertura os casos restantes eram tratáveis pelo fallback.

**Override do RH:** quando o líder trava, o RH tem o botão "Aprovar no lugar do líder" no modal de detalhe de uma solicitação em `aguardando_gestor`. Grava `aprovacao_lider_override = true` + `motivo_override_lider` (opcional) + audit `ferias.lancamento.override_lider_rh`. Motivo opcional porque a trilha de quem e quando já basta pro accountability.

**Nova UI:** página `/equipe` na sidebar (gated por EXISTS de liderados no server), com tab "Equipe" (lista do time via `vw_equipe_do_lider` — sem PII) e tab "Férias" (pendentes de aprovação + histórico do time).

**Lançar direto do RH:** continua pulando as duas etapas, como sempre. Entra como `aprovado` direto com `lancado_direto_por_rh = true`.

## Alternativas consideradas

- **Fallback silencioso — todos sem líder caem direto no RH e nada mais acontece.** Descartada: cria dívida de cadastro invisível; durante meses, metade do time nunca passaria pelo líder, e o sentido da mudança se perderia.
- **Backfill obrigatório antes de ligar o fluxo.** Descartada: travaria a entrega por trabalho de cadastro. A planilha oficial de 21/11 trouxe o backfill a 93% sem precisar pausar.
- **Role nova `lider` em `tenant_members`.** Descartada: o dado (`colaboradores.lider_id`) já carrega a semântica; role nova é um eixo a mais pra manter.
- **Column-level RLS pra esconder salário do líder.** Descartada: Postgres não suporta nativo; criaríamos SECURITY DEFINER. Decidido que o líder não vê salário na página `/equipe` (nem CPF, nem benefício) — esses continuam admin/rh/financeiro.
- **Motivo do override obrigatório.** Descartada: o audit (quem + quando) já basta. UI de motivo obrigatório atrita sem agregar accountability real.

## Consequências

**Infra no banco:**
- Enum `aguardando_gestor` com sortorder 0.
- 4 colunas novas em `colaboradores_ferias_lancamentos`: `aprovado_pelo_lider_por`, `aprovado_pelo_lider_em`, `aprovacao_lider_override`, `motivo_override_lider`.
- Policies RLS SELECT pro líder em `colaboradores_ferias_lancamentos` e `colaboradores_ferias_periodos`.
- Policy RLS UPDATE pro líder (só transição `aguardando_gestor` → outro status).
- View `vw_equipe_do_lider` com gating por `auth.uid()` embutido no WHERE.
- Migrations: `20261121200001`-`20261121200005` e `20261121300001`.

**Audit:**
- `ferias.lancamento.aprovado_lider` — líder aprovou.
- `ferias.lancamento.reprovado_lider` — líder reprovou (com motivo).
- `ferias.lancamento.override_lider_rh` — RH aprovou no lugar do líder (com motivo opcional).

**Produção:**
- O líder assume a leitura das férias do time. Se não aprovar em tempo útil, o RH destrava — sem ficar refém do delay do líder.
- Colaborador sem líder cadastrado não fica preso: cai direto no RH. A base vai se preenchendo pelo uso.
- Timeline em `/rh/ferias/[id]` mostra até 2 linhas de rastro (etapa 1 do líder ou do override + etapa 2 do RH).

**Documentação:**
- `docs/modulos/rh/25-ferias.md` §F16 atualizado.
- `docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md` — design doc completo.
- 3 planos de execução em `docs/superpowers/plans/` (PR 1 fundação, PR 2 fluxo do líder, PR 3 override + UI do RH + docs).

---

## Addendum 2026-11-21 (noite) — Evolução pra N líderes

A decisão simplificadora original era 1 líder por colaborador. Na mesma sessão descobrimos que a Agência tem casos reais de 2 líderes (operacional + funcional). Decisão: **qualquer um dos N aprova/reprova** — primeiro a agir destrava / encerra.

### Mudanças técnicas

- Nova tabela `colaboradores_lideres (colaborador_id, lider_id, created_at)` com PK composta. Backfill de 207 linhas a partir dos `lider_id` atuais.
- `colaboradores.lider_id` vira **cache do primeiro líder** (MIN `created_at`), sincronizado por trigger `AFTER INSERT/DELETE`. Removido no Passo 2 (futuro), quando confirmarmos que nenhum consumidor legado quebra.
- Policies RLS `ferias_lancamentos_lider_select`, `ferias_periodos_lider_select` e `ferias_lancamentos_lider_update` reescritas pra `EXISTS` na tabela nova.
- View `vw_equipe_do_lider` reescrita.
- Guards das actions do líder (`aprovarLancamentoComoLider`, `reprovarLancamentoComoLider`) aceitam "sou um dos líderes".
- UI de cadastro (`/rh/colaboradores/[id]`) ganha lista de chips removíveis + Combobox pra adicionar.
- Trigger `BEFORE INSERT` rejeita auto-liderança (`colaboradores.user_id = lider_id`).

### Alternativas consideradas (noite)

- **Array `colaboradores.lideres uuid[]`.** Descartada: não há FK em elemento de array; `ANY()` em RLS fica feio e perde índice.
- **Remover `lider_id` no mesmo PR.** Descartada por risco: 10 arquivos no código consomem o campo direto; migrar tudo num só passo aumenta risco de slip. Preferimos cache sincronizado e limpeza gradual.
- **Papéis diferenciados (principal / funcional / substituto).** Descartada: os 2 casos reais da Agência são "paralelos iguais" — qualquer um aprova. Se amanhã precisar, adiciona coluna `tipo` sem migration estrutural.

### Arquivos novos

- Spec: `docs/superpowers/specs/2026-11-21-ferias-multiplos-lideres-design.md`.
- Plano: `docs/superpowers/plans/2026-11-21-ferias-multiplos-lideres-passo-1.md`.
- Migrations: `20261122100001_colaboradores_lideres_tabela_e_sync` + `20261122100002_colaboradores_lideres_fix_auto_lideranca`.
