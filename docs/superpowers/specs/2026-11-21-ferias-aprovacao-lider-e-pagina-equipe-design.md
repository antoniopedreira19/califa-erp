# Férias com aprovação em duas etapas (Líder → RH) e nova página Equipe

Data: 2026-11-21
Status: Rascunho, aguardando aprovação do Daniel.

## Intenção

Hoje, no módulo de Férias, a aprovação é só do RH: o colaborador solicita
pelo `/perfil`, cai como `pendente_aprovacao`, e qualquer admin ou RH
aprova direto, sem passagem pelo líder direto. O líder fica sabendo do
plano de férias do time pelo WhatsApp ou pela boca do colaborador, não
pelo sistema.

A mudança: aprovação de férias passa a ter **duas etapas em série** —
líder direto aprova primeiro, depois o RH aprova e dispara o cálculo /
folhas (fluxo atual). O líder ganha uma página própria (sidebar
"Equipe") onde vê o time dele e aprova os pedidos.

## Por que agora

- A infra no banco já está pronta: `colaboradores.lider_id uuid`, FK pra
  `profiles`, com índice, criado na migration `20260929120922`. Tava
  esperando dado e UI.
- A cobertura do campo acabou de saltar de 33.7% pra 93.2% (backfill da
  planilha oficial de lideranças, aplicado na migration
  `20261121000001`). 207 de 222 colabs do tenant principal têm líder
  definido.
- O RH hoje aprova férias sem saber se o líder tá ciente — risco de
  férias aprovadas que batem com evento de cliente. A etapa do líder é a
  trava preventiva.

## Goals

- O colaborador solicita férias no `/perfil`, como hoje.
- Se ele tem líder, a solicitação vai primeiro pro líder (status
  `aguardando_gestor`). Só depois que o líder aprova é que vira
  `pendente_aprovacao` e aparece pro RH.
- Se não tem líder, cai direto em `pendente_aprovacao` (fluxo atual
  preservado).
- Líder tem página `/equipe` com duas tabs:
  - **Equipe:** lista dos colaboradores que tem ele como `lider_id`.
    Colunas: Nome · Tipo de contratação · Alocação · Email corporativo.
    Sem salário. Sem CPF.
  - **Férias:** espelho da aba Quadro do `/rh/ferias` filtrada pros
    liderados; no topo, card de solicitações aguardando aprovação do
    líder, com Aprovar / Reprovar.
- Visibilidade da página `/equipe`: só pra profile que tem pelo menos
  1 liderado. Gated no server, não renderiza entrada na sidebar pros
  outros.
- RH continua enxergando tudo em `/rh/ferias`, mas as solicitações em
  `aguardando_gestor` aparecem **separadas**, rotuladas "aguardando
  líder: [nome]". RH não aprova essas direto; destrava só com botão
  explícito.
- Auditoria: cada etapa (líder aprovou, RH aprovou, RH destravou no
  lugar do líder) gera `audit_events`.

## Non-goals (pra este design)

- Notificação por email ou push pro líder quando chega pedido novo. Isso
  entra em fase 2 — por ora, o líder vê badge na sidebar e no card da
  aba Férias.
- Aprovação em lote pelo líder. Um por vez já resolve o volume atual (6
  solicitações aguardando no tenant hoje).
<!-- nomes reais removidos deste doc por regra de PII do CLAUDE.md -->

- Delegação (líder A ausente → líder B aprova no lugar). Por ora, só o
  RH pode destravar via override. Delegação fica pra depois.
- Visão do histórico salarial, CPF, benefícios ou data de admissão pelo
  líder. A página Equipe é operacional, não é HR-lite.

## Anti-goals (coisas que, se acontecerem, significam que falhamos)

- Qualquer usuário não-líder enxergar `/equipe` ou dados de liderados.
- Líder enxergar salário, CPF, data de nascimento ou outro PII dos
  liderados.
- RH conseguir aprovar uma solicitação em `aguardando_gestor` sem passar
  pelo override explícito.
- Colaborador sem líder ficar travado — ele tem que cair direto no RH.
- Duas aprovações sem trilha: cada etapa precisa gravar quem aprovou e
  quando, visível na timeline do colaborador em `/rh/ferias/[id]`.

## Restrições

- **PII (regra transversal CLAUDE.md + memória):** salário, CPF, data
  de nascimento, email pessoal são PII — acessíveis só a admin, rh e
  financeiro. Líder não é um desses roles por default. Isso cravou a
  decisão de não mostrar salário na tab Equipe.
- **RLS:** a nova política de acesso a lançamentos pelo líder precisa
  checar `EXISTS (SELECT 1 FROM colaboradores WHERE
  lider_id = auth.uid() AND id = colaborador_id)`. Se escrever errado,
  qualquer usuário vê tudo.
- **Performance (docs/PERFORMANCE.md):** a página `/equipe` pode listar
  até ~40 liderados (o maior líder hoje tem 37). Query precisa vir com
  `select` enxuto; `<Link>` de linha clicável vai precisar de
  `prefetch={false}` (teto de 5+ itens).
- **Dado pessoal no repo:** migration que mexe em `lider_id` só com
  UUID, nunca com nome / email, como já foi feito no backfill.

## Approaches considerados

### Modelo de estado

**A — Novo valor no enum `ferias_lancamento_status`: `aguardando_gestor`.**
Entra com `enumsortorder = 0.5` (antes de `pendente_aprovacao`). O
fluxo:

```
solicitado → aguardando_gestor → pendente_aprovacao → aprovado → ...
         (se sem líder)       ↓
                              pendente_aprovacao direto
```

Reaproveita a máquina de estado existente, a trigger
`fn_sincroniza_status_lanc_por_nf` continua funcionando (ela só olha
estados ≥ `aprovado`), e o front filtra por status como já faz.

**B — Dois campos booleanos separados: `aprovado_pelo_lider_em` +
`aprovado_pelo_rh_em`.** Mantém o enum atual; o estado "visível" vira
uma combinação derivada. Mais flexível mas dobra o lugar da verdade — a
UI que filtra por status (hoje tem 4 lugares) teria que ganhar lógica
nova em cada um.

**C — Tabela nova `ferias_aprovacoes` (uma linha por etapa).** Audit
rica embutida, mas é overkill pra duas etapas fixas. E a timeline já
pode sair de `audit_events`.

**Pick: A.** Reaproveita o enum, não quebra as queries existentes, e o
`audit_events` dá a trilha sem precisar de tabela nova. B tem custo
espalhado; C é pesado pro ganho.

### Fallback sem líder

**A — Trava e exige backfill de 100% antes de ligar.** Garante
uniformidade mas atrasa a release pra fazer trabalho de cadastro.

**B — Fallback silencioso: sem líder, pula direto pro RH.** Libera a
feature e preenche gradualmente. Risco: ninguém revisa a lista dos sem
líder.

**C — RH define o líder no momento da solicitação, se não tiver.** Caro
em UX — o colaborador abre o modal de pedir férias e cai num travamento
que precisa de RH destravar.

**Pick: B.** 93.2% já está coberto. Dos 15 sem líder, 3 são os líderes
do topo da pirâmide (que não têm líder por decisão da planilha) e os
outros 12 são casos de borda — na UI do `/rh/ferias`, a pilha
"Aguardando Gestor" vai mostrar quantos colaboradores do tenant estão
sem líder, como lembrete passivo pro RH ir completando.

### Permissão do líder

**A — Role nova `lider` em `tenant_members`.** Nova dimensão de
permissão; mais um eixo pra manter.

**B — Derivar de `EXISTS (SELECT 1 FROM colaboradores WHERE
lider_id = auth.uid())`.** Sem migration de role; o líder é quem tá na
tabela sendo apontado. A sidebar, as RLS policies e o gate do `/equipe`
consultam isso.

**Pick: B.** Não precisa de role nova; o dado já carrega a semântica.

### Salário na tab Equipe

Discutido: **A — Não mostra.** Decidido com o Daniel em 21/11/2026.

### Override do RH quando líder trava

**A — Botão discreto "Aprovar no lugar do líder" com modal de
confirmação + motivo obrigatório + audit `ferias.override_lider`.** RH
assume a aprovação do líder; a solicitação pula pra
`pendente_aprovacao` como se o líder tivesse aprovado, e o RH aprova no
movimento seguinte (ou junto, se quiser).

**B — Sem override; líder tem que aprovar, ponto.** Risco de travar a
fila por férias/doença do líder.

**Pick: A.** É a saída de emergência que o RH precisa. Motivo opcional
(decidido 21/11); o audit trail já grava quem e quando — é o suficiente.
A UI mostra na timeline "RH aprovou em nome de [líder]" (com o motivo
quando preenchido).

## Decisões fechadas

1. Novo valor no enum: `aguardando_gestor`, sortorder 0.5.
2. Fluxo:
   - Colaborador solicita, tem líder → `aguardando_gestor`.
   - Colaborador solicita, sem líder → `pendente_aprovacao` (direto).
   - Líder aprova → `pendente_aprovacao`.
   - Líder reprova → `reprovado` + `motivo_reprovacao` preenchido.
   - RH aprova `pendente_aprovacao` → `aprovado` (fluxo atual).
   - RH override em `aguardando_gestor` → `pendente_aprovacao` com
     `aprovacao_lider_override` = true, motivo em
     `motivo_override_lider` (opcional, nullable).
3. Novas colunas em `colaboradores_ferias_lancamentos`:
   - `aprovado_pelo_lider_por uuid references profiles(id)`
   - `aprovado_pelo_lider_em timestamptz`
   - `aprovacao_lider_override boolean default false`
   - `motivo_override_lider text`
   - `aprovado_por` e `aprovado_em` existentes continuam significando
     "aprovação do RH" (semântica preservada).
4. `aprovarLancamento` server action vira duas actions:
   - `aprovarLancamentoComoLider(lancamentoId)`: guard "sou líder desse
     colaborador"; muda status pra `pendente_aprovacao`, grava os
     dois campos de líder.
   - `aprovarLancamento(lancamentoId)`: fica como hoje (guard
     `assertRh`), só que agora exige `status = 'pendente_aprovacao'`
     (não aceita mais `aguardando_gestor` direto).
   - `aprovarLancamentoOverride(lancamentoId, motivo)`: guard
     `assertRh`; só funciona em `aguardando_gestor`; marca
     `aprovacao_lider_override`, pula pra `pendente_aprovacao`.
5. Reprovação pelo líder: `reprovarLancamentoComoLider(lancamentoId,
   motivo)`. Reusa enum `reprovado` e campo `motivo_reprovacao`.
   Colaborador abre nova solicitação; não tem "reenviar".
6. Sidebar "Equipe": item só aparece pra quem tem liderado. Checagem no
   layout server-side com um `select count` leve.
7. Página `/equipe` tem duas tabs:
   - **Equipe:** tabela com `table-fixed` + `colgroup`, colunas Nome ·
     Tipo de contratação · Alocação (empresa · regional) · Email
     corporativo (`@agenciacalifornia.com.br`; outros ficam ocultos).
     Linha clicável abre `/perfil/[id]` só se o liderado tem profile
     (senão a linha fica estática). `prefetch={false}` nos links.
   - **Férias:** topo = card "N solicitação(ões) aguardando sua
     aprovação", expansível, mostrando período + dias + motivo + botões
     Aprovar / Reprovar. Embaixo = lista no padrão do
     `/rh/ferias/aba-quadro.tsx`, mas filtrada por `lider_id =
     auth.uid()`.
8. Faixa de KPIs no topo do `/equipe` (padrão rico `/financeiro`):
   `N liderados · X aguardando sua aprovação · Y de férias hoje · Z
   férias vencendo em 60d`. Ícone + delta + shadow-soft, como memória
   `feedback_kpi_cards_ricos`.
9. RH em `/rh/ferias`: a aba Solicitações ganha uma seção extra
   "Aguardando Gestor" no topo, com badge de contagem. Cada linha
   mostra o líder esperado; botão "Aprovar no lugar do líder" dentro do
   modal de detalhe, com modal de confirmação e motivo obrigatório.

## RLS

Policy nova em `colaboradores_ferias_lancamentos` pra leitura:

```sql
CREATE POLICY ferias_lanc_select_lider ON colaboradores_ferias_lancamentos
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.colaboradores c
    WHERE c.id = colaboradores_ferias_lancamentos.colaborador_id
      AND c.lider_id = (SELECT auth.uid())
  )
);
```

Policy nova em `colaboradores` pra leitura dos campos não-PII pelo
líder — hoje colaboradores tem gate "administrador OR rh". Vai precisar
de uma view `vw_equipe_do_lider` que só expõe os campos não-sensíveis
(nome, tipo_contratacao, alocação denormalizada, email corporativo) e
tem a policy gating por `lider_id = auth.uid()`.

Policy nova em `colaboradores_ferias_periodos` pra leitura pelo líder
(análogo, via colaborador_id).

## Migrations previstas (nesta ordem)

1. `ALTER TYPE ferias_lancamento_status ADD VALUE 'aguardando_gestor'
   BEFORE 'pendente_aprovacao';`
2. `ALTER TABLE colaboradores_ferias_lancamentos` adicionando as 4
   colunas novas (nullable, sem default; só RH override preenche
   override).
3. Policy `ferias_lanc_select_lider`.
4. View `vw_equipe_do_lider` + policy.
5. Policy `ferias_periodos_select_lider`.
6. Policy `ferias_folhas_select_lider` (pros blocos da aba Férias do
   líder, se precisar — avaliar na implementação).

## Mudança de código prevista (resumo, não exaustivo)

- `app/(app)/rh/ferias/actions.ts`:
  - Adiciona `aprovarLancamentoComoLider`,
    `reprovarLancamentoComoLider`, `aprovarLancamentoOverride`.
  - `aprovarLancamento` ganha guard `status === 'pendente_aprovacao'`
    (hoje aceita `em_analise` também — validar).
- `app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx`: badge nova pra
  `aguardando_gestor`; botão "Aprovar no lugar do líder" quando RH
  olha solicitação travada.
- `app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx`: adiciona
  coluna "Aguardando Gestor" no agrupamento por status.
- `app/(app)/perfil/actions.ts` ou wherever cria o lançamento: ao
  solicitar, decidir status inicial com base em `colaborador.lider_id`.
- `app/(app)/equipe/page.tsx`: nova; server component com os queries
  de liderados + stats.
- `app/(app)/equipe/aba-equipe.tsx`: tab Equipe.
- `app/(app)/equipe/aba-ferias.tsx`: tab Férias (reusa componentes do
  `/rh/ferias/aba-quadro.tsx`, parametrizando por `lider_id`).
- `app/(app)/equipe/actions.ts`: wrappers que chamam as actions de
  `/rh/ferias` com o guard de líder.
- Sidebar: condicional `tem_liderado` server-side.
- `lib/types.ts`: adicionar `'aguardando_gestor'` ao tipo
  `FeriasLancamentoStatus` + novos campos no tipo do lançamento.

## Auditoria

Eventos novos em `audit_events`:

- `ferias.aprovado_lider`: `{lancamento_id, lider_id, colaborador_id}`
- `ferias.reprovado_lider`: `{lancamento_id, lider_id, motivo}`
- `ferias.override_lider_rh`: `{lancamento_id, rh_id,
  lider_esperado_id, motivo}`

A trilha visível no `/rh/ferias/[id]` (timeline) ganha linhas pra cada
um desses eventos.

## Decisões fechadas em 21/11/2026 (sessão de brainstorm)

- **"Lançar direto" do RH**: segue pulando as duas aprovações. Entra como
  `aprovado` direto, como hoje — RH confia em si mesmo. Vale pros casos
  em que a solicitação nasceu fora do sistema.
- **Badge na sidebar "Equipe"**: mostra o número de pendentes
  (`aguardando_gestor` pro meu profile). Mesmo padrão dos badges de
  contas a pagar.
- **Motivo do override do RH**: **opcional**. O audit trail já grava
  quem/quando. Textarea sem `required`, sem mínimo de chars.

## O que fica aberto pro builder

- Nome exato dos componentes e paths (seguir convenção já existente).
- Decidir se o "Email corporativo" sai de `colaboradores.email`,
  `profiles.email` ou é derivado (prioridade proposta: profile, senão
  colaborador, só mostra se termina em `@agenciacalifornia.com.br`).
- Ajustar os KPIs do hero pra fonte-verdade real (hoje tem `vw_` pra
  "em férias agora"? Checar; senão fica derivado da query de
  liderados).
- Precisão do card de solicitação pendente no topo da aba Férias do
  líder: qual info mostra em primeira linha? Proposta: nome ·
  período (data_inicio–data_fim) · dias · tipo (férias/abono).
  Expansão mostra motivo e histórico de períodos do colaborador.

## Riscos conhecidos

1. **Trigger existente:** `fn_sincroniza_status_lanc_por_nf` olha
   `status = 'aprovado'`. O novo `aguardando_gestor` não interfere, mas
   tem que confirmar lendo a função antes de aplicar as migrations.
2. **Timeline do `/rh/ferias/[id]`:** o rendering atual do histórico
   não conhece `aguardando_gestor` — vai aparecer como estado
   desconhecido. Adicionar explicitamente.
3. **"Lançar direto" do RH:** continua pulando ambas as aprovações
   (RH confia em si mesmo); entra como `aprovado` como hoje. Confirmar
   com o Daniel se isso ainda vale após a mudança (proposta: sim,
   vale).
4. **Líderes que viram ex-líderes:** se um líder sai da empresa, a FK
   `ON DELETE SET NULL` zera o `lider_id` dos subordinados. OK — eles
   caem no fluxo "sem líder" (direto pro RH) até o RH reatribuir.
5. **Admin vs líder:** profiles que são admin ou RH também podem ser
   líderes. Pra eles, a sidebar mostra "Equipe" e "RH". Dupla porta de
   entrada; não vejo problema.

## Plano de release

Entrega em três PRs encadeados, cada um compilando e deploy-ável:

1. **PR 1 — Banco e tipo.** Migrations (enum + colunas + policies +
   view) + atualização de `lib/types.ts`. Não muda UI nem actions
   ainda. Build limpa.
2. **PR 2 — Fluxo líder.** Página `/equipe`, actions do líder, item
   na sidebar. RH continua enxergando `aguardando_gestor` como
   "pendente" mas sem aprovar.
3. **PR 3 — Override + UI RH.** Botão override no modal RH, seção
   "Aguardando Gestor" separada em `/rh/ferias`, timeline atualizada.

Cada PR tem seu próprio design doc de implementação (plano) via
`superpowers:writing-plans`.
