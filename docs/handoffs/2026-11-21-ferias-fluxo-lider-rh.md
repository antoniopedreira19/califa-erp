# Férias ganham aprovação em duas etapas: líder, depois RH (2026-11-21)

> Antes, qualquer admin/RH aprovava férias direto no `/rh/ferias` e o líder
> ficava sabendo pelo WhatsApp. Agora o fluxo passa primeiro pelo líder
> direto em `/equipe`, depois pelo RH, e o RH tem um botão de override
> quando o líder trava. A base de liderados pulou de 34% pra 93% no mesmo
> dia (backfill da planilha oficial).

## O que muda pro negócio

Líder assume o acompanhamento das férias do time. Se tem líder definido,
o colaborador pede e o pedido aparece pra ele em `/equipe`. Se o líder
viajou ou não responde, o RH destrava com um clique — sem ficar refém.
Colaborador sem líder cai direto no RH (fluxo antigo preservado).

## Estado atual

- **Cadastro de líderes** (tenant principal): 207/222 colaboradores com
  `lider_id` definido (93,2%). Os 15 restantes são os 3 do topo da
  pirâmide (sem líder por desenho) + casos de borda — caem no fallback.
- **Página `/equipe`** na sidebar, visível só pra quem tem pelo menos 1
  liderado. Duas tabs: Equipe (lista do time, sem salário/CPF) e Férias
  (pendentes de aprovação + histórico do time).
- **Fluxo de solicitação em `/perfil`**: decide o status inicial pelo
  `lider_id` do colaborador — `aguardando_gestor` com líder,
  `pendente_aprovacao` sem.
- **`/rh/ferias/solicitacoes`**: chip novo "Aguardando líder" no topo
  dos filtros; modal de detalhe tem botão "Aprovar no lugar do líder"
  com motivo opcional.
- **`/rh/ferias/[id]`**: timeline mostra até 2 linhas — "Aprovado pelo
  líder [nome]" (ou "RH aprovou no lugar do líder" quando é override)
  + "Aprovado pelo RH".
- **Audit**: eventos novos `ferias.lancamento.aprovado_lider`,
  `.reprovado_lider`, `.override_lider_rh`.

## Decisões que vão importar amanhã

- **Motivo do override do RH é opcional.** O audit trail (quem + quando
  + líder esperado) já basta. Se o Daniel mudar de ideia, só mudar o
  schema `overrideLiderRhSchema` pra exigir min(3).
- **Líder NÃO vê salário, CPF, data de nascimento, telefone, endereço
  do liderado.** A `vw_equipe_do_lider` tem gating por `auth.uid()`
  embutido no WHERE e só expõe nome, tipo de contratação, alocação
  denormalizada e email corporativo `@agenciacalifornia.com.br`. Qualquer
  mudança nessa view precisa passar pela regra de PII do CLAUDE.md.
- **"Lançar direto" do RH continua pulando as duas etapas** — entra
  como `aprovado` com `lancado_direto_por_rh = true`. Mantido de propósito.
- **Reprovação pelo líder encerra o fluxo** com status `reprovado` +
  motivo obrigatório. Colaborador abre nova solicitação; não há
  "reenviar".
- **Fix de self-review no PR 1**: a view original rodava com
  `security_invoker=off` (default) e bypassava RLS de `colaboradores` —
  qualquer `authenticated` via toda a lista sem filtro. Fix: WHERE
  embutido na view (`c.lider_id = (select auth.uid())`). Case study
  em futuros SECURITY INVOKER.
- **Fix de self-review no PR 2**: a policy `ferias_lancamentos_update`
  existente não cobria o líder. UPDATE das actions falhava em silêncio
  (Supabase retorna ok com 0 rows). Fix: policy
  `ferias_lancamentos_lider_update` + `.select().single()` no update
  como guard-rail.

## O que fica pra próxima sessão

- **Objetivo**: Hub central de notificações. O líder não recebe nada
  quando chega pedido novo em `/equipe` — só vê quando abre a página.
  O ADR 267 explicitamente deixa isso pro hub central (já havia essa
  dívida desde 2026-10-03).
- **Possível polimento**: RH não tem UI pra reprovar/cancelar lançamento
  em `aguardando_gestor` — por design atual (líder reprova, RH só
  destrava com override). Se surgir necessidade de "RH cancela porque
  colaborador pediu a coisa errada", vira item do próximo PR.
- **Backfill incremental dos 15 sem líder**: nada automático — o RH vai
  preencher no `/rh/colaboradores/[id]` conforme aparecerem pedidos.

## Rastros técnicos

Migrations aplicadas:

```
20261121000001_backfill_colaboradores_lider_id_planilha_califa
20261121200001_ferias_enum_aguardando_gestor
20261121200002_ferias_lancamentos_campos_aprovacao_lider
20261121200003_ferias_lancamentos_e_periodos_policy_lider
20261121200004_vw_equipe_do_lider
20261121200005_vw_equipe_do_lider_gating_embutido
20261121300001_ferias_lancamentos_update_policy_lider
```

Specs e planos:
- `docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md`
- `docs/superpowers/plans/2026-11-21-ferias-aprovacao-lider-pr1-fundacao.md`
- `docs/superpowers/plans/2026-11-21-ferias-aprovacao-lider-pr2-fluxo-lider.md`
- `docs/superpowers/plans/2026-11-21-ferias-aprovacao-lider-pr3-override-e-ui-rh.md`

ADR: `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md`

Doc operacional: `docs/modulos/rh/25-ferias.md` §F16.

Commits principais (21 no total):
- Backfill + design: `919f0ff0`
- PR 1 fundação (7 commits): `77a2c42d` → `b9d3331a`
- PR 2 fluxo do líder (8 commits): `b13bca24` → `f6a2fc4c`
- PR 3 override + UI RH + docs (6 commits): `9c2f3703` → `efad17a7`
