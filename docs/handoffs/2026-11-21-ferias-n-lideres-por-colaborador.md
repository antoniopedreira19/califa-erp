# Colaborador pode ter N líderes; qualquer um aprova (2026-11-21)

> O handoff do fluxo líder→RH (manhã do mesmo dia) assumiu 1 líder
> por colaborador. À noite, confirmamos com o Daniel que na prática
> há casos de 2 líderes (um operacional, um funcional), e qualquer
> um pode aprovar as férias. Esta sessão evolui o modelo pra N:N
> sem quebrar nada do que já subiu.

## O que muda pro negócio

- RH agora adiciona/remove líderes como chips no drawer de edição do
  colaborador (`/rh/colaboradores/[id]`). Não tem mais o campo único
  "líder direto"; vira lista.
- Qualquer um dos N líderes vê o pedido em `/equipe` e aprova. O
  primeiro a agir destrava — o outro, ao tentar, vê "Esta solicitação
  não está mais aguardando sua aprovação".
- As 6 solicitações antigas que já estavam em `pendente_aprovacao`
  foram migradas pra `aguardando_gestor` de manhã, pra entrarem no
  fluxo novo (todas tinham líder cadastrado).

## Estado atual

- **Vínculos colaborador ↔ líder**: 207 linhas na tabela nova
  `colaboradores_lideres`, 207 colaboradores com pelo menos 1 líder,
  207 com cache preenchido em `colaboradores.lider_id`. Tudo
  consistente, bate 1:1:1 porque o backfill partiu do campo único.
- **Modelo**: tabela N:N `(colaborador_id, lider_id, created_at)` com
  PK composta. `colaboradores.lider_id` fica como cache do primeiro
  (MIN `created_at`), sincronizado por trigger `AFTER INSERT/DELETE` —
  pra código legado não quebrar.
- **Policies RLS reescritas** pra olhar a tabela nova (não mais
  `colaboradores.lider_id` direto):
  - `ferias_lancamentos_lider_select`
  - `ferias_periodos_lider_select`
  - `ferias_lancamentos_lider_update`
- **View `vw_equipe_do_lider`** idem.
- **Guards das actions** `aprovarLancamentoComoLider` e
  `reprovarLancamentoComoLider` aceitam "sou um dos líderes" via
  EXISTS na tabela.
- **UI do drawer de edição** virou chips removíveis + Combobox pra
  adicionar. Empty state: "Sem líder — as férias deste colaborador
  vão direto pro RH."

## Decisões que vão importar amanhã

- **Qualquer um dos N aprova**, sem hierarquia. Se amanhã precisar
  distinguir "principal vs funcional", adiciona coluna `tipo` na
  tabela — zero migration estrutural.
- **Sem cap no número de líderes**. Hoje são 2 na prática; nada barra
  3 ou 4.
- **CHECK inicial era semanticamente inválido** — comparava
  `colaborador_id <> lider_id` que são chaves de tabelas distintas e
  nunca batem. Substituído por trigger `BEFORE INSERT` (migration
  `100002`) que faz lookup correto de `colaboradores.user_id = lider_id`
  (bloqueia colaborador ser líder de si mesmo).
- **`colaboradores.lider_id` NÃO é mais escrito direto** por nenhuma
  action — todos passam pela tabela N:N e deixam a trigger sincronizar.
  Removido no Passo 2 (futuro, quando confirmarmos que nenhum
  dashboard legado quebra).
- **Audit do override do RH** (`lider_esperado_id`) ainda registra só
  o primeiro líder (lê do cache). Com N líderes, perde a info dos
  outros. Impacto baixo; vira `array_agg` quando virar necessário.

## O que fica pra próxima sessão

- **Objetivo (opcional)**: Passo 2 — remover `colaboradores.lider_id`
  depois de confirmar que nenhum consumidor legado lê o campo direto.
  Grep atual mostra consumo só nos lugares que sabemos (actions
  refatoradas). Pode ser feito com confiança a qualquer momento.
- **Objetivo (original ainda pendente)**: hub central de notificações.
  Nenhum dos N líderes é notificado por email/push quando chega
  pedido novo — só vê quando abre `/equipe`. ADR 267 já flaga.

## Rastros técnicos

Migrations aplicadas:

```
20261121400001_backfill_pendentes_para_aguardando_gestor
20261122100001_colaboradores_lideres_tabela_e_sync
20261122100002_colaboradores_lideres_fix_auto_lideranca
```

Specs e planos:
- `docs/superpowers/specs/2026-11-21-ferias-multiplos-lideres-design.md`
- `docs/superpowers/plans/2026-11-21-ferias-multiplos-lideres-passo-1.md`

ADR: `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md` §Addendum
noite.

Doc operacional: `docs/modulos/rh/25-ferias.md` §F16 (modelo N:N
documentado).

Commits principais (8):
- Migração manual das 6 pendentes: `40c5d78f`
- Tabela + sync + policies reescritas: `36fe18ef`
- Fix do CHECK inválido: embutido na migration `100002`
- Helpers e actions: `0893d179`, `efda1df6`, `5821eee2`
- UI drawer: `03a60baa`
- Docs: `c8f22d1e`, `58e72cf3`
