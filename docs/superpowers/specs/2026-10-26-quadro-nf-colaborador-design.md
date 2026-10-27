# Quadro de NFs do colaborador + travamento da aprovação no financeiro

**Data:** 2026-10-26
**Status:** Design (aguardando aprovação do dono)

## Intenção

Garantir que todo pagamento feito a colaborador PJ/MEI/CLT-recibo só saia depois que a Nota Fiscal daquele pagamento esteja anexada no sistema. O colaborador anexa pelo próprio perfil, o financeiro aprova no mesmo lugar onde já aprova a folha mensal, e a aprovação fica travada enquanto a NF não chegar.

## Por quê

Hoje a NF da folha mensal é anexada pelo próprio colaborador no card "NF do Mês" no perfil — mas a aprovação da folha pelo financeiro não exige que a NF esteja lá. O financeiro consegue criar o título e pagar sem NF, e isso gera retrabalho de cobrança posterior.

Pior: férias, abono de férias e 13° — que também são pagos a PJ e também exigem NF — não têm **nenhum** fluxo de NF hoje. O colaborador manda por fora (WhatsApp, email) e o financeiro guarda em pasta de rede. Rescisão fica fora de escopo por causa de restrição de acesso (ver anti-metas).

A regra é: **se o colaborador recebe algo da California e é obrigado a emitir NF, essa NF entra no sistema; e o financeiro não libera o pagamento sem ela.**

## Metas

- Quadro único no perfil mostrando **todas** as NFs que o colaborador precisa emitir no momento: folha mensal, férias/usufruto, abono avulso, abono combinado (férias + abono), 13° 1ª parcela, 13° 2ª parcela.
- Cada linha do quadro tem seu próprio upload e seu próprio status (pendente / anexada / em atraso).
- Nova aba **"People"** na página `/financeiro/contas-a-pagar` reúne todos os pagamentos de colaborador aguardando aprovação do financeiro (folha mensal + férias + abono + 13°), diferenciados por tipo.
- Botão "Aprovar" fica desabilitado enquanto a linha exigir NF e a NF não estiver anexada. A validação é feita **tanto na UI quanto na server action** (defesa em profundidade).
- Fluxo das férias/abono/13° muda: deixam de criar `conta_avulsa` direto na aprovação do RH. Passam a aguardar aprovação do financeiro, que valida NF antes de criar o título.
- Lançamentos de férias que **já estão aprovados** no fluxo atual voltam pro financeiro reaprovar com NF (one-shot de regularização na migration).

## Não-metas

- Rescisão. O colaborador perde acesso ao sistema no momento da rescisão, então não dá pra ele anexar NF pelo perfil. O RH anexa pela página de rescisão (quando ela existir — ainda não existe).
- CLT puro, estágio e sócio. Não emitem NF à California (CLT é folha da contabilidade; estágio é bolsa; sócio é pró-labore).
- Automatizar o envio da NF para a contabilidade/escritório. O quadro mantém a NF no bucket; integração com SPED/contabilidade fica fora.
- Validação do PDF (se é NF válida, se o CNPJ bate, se o valor confere). Hoje aceita qualquer PDF; o controle é humano, feito na conferência do financeiro.
- Vincular NF a lançamento financeiro já pago retroativamente (histórico pré-migração).

## Anti-metas

- Permitir que o colaborador anexe NF antes do valor existir no sistema. Isso leva a NFs rejeitadas, retrabalho de cálculo e desalinhamento entre valor da NF e valor pago. Férias e 13° só abrem pra anexar depois que o valor fica calculado (ver §Gatilhos abaixo).
- Fluxo paralelo entre "colaborador anexa NF" e "RH gera folha PJ". A NF é indexada por evento (lançamento específico), não só por competência — pra evitar duplicidade quando RH regerar folha ou quando o colaborador tiver mais de uma origem de pagamento no mesmo mês.
- Deixar a trava de aprovação só na UI. UI pode ser contornada por quem tem acesso direto ao banco ou ao endpoint; a server action é a fonte de verdade.

## Restrições

- O banco é compartilhado com outras frentes. Toda migration passa pelo ciclo do MCP descrito em `docs/FLUXO-BANCO.md`: ler o banco antes, aplicar via `apply_migration`, conferir que aplicou, commitar com o código que depende dela.
- `lib/types.ts` é escrito à mão. Qualquer mudança de schema que afeta UI exige atualizar o tipo correspondente no mesmo commit.
- Nenhum arquivo versionado pode conter CPF/nome/email de pessoa real (ver §CLAUDE.md "Dados pessoais"). Fixtures/testes usam os placeholders padrão.
- Performance: migration nova precisa de GRANT para `authenticated` + índice nas FKs novas + policies RLS usando `(select auth.uid())`. Ver `docs/PERFORMANCE.md`.
- Strings visíveis ao usuário são pt-BR correto com acentuação.
- Toda a fundação de folha mensal já em produção (desde 2026-09-18) **não pode** quebrar — mudança é aditiva. Backfill do campo `escopo_tipo='folha_mensal'` nas linhas existentes.

## Modelo de dados

### 1. Generalização de `colaboradores_nf_anexos`

Hoje a tabela tem chave `(tenant_id, colaborador_id, competencia_ano, competencia_mes)` que **só serve pra folha mensal**. Vai ser generalizada com dois campos novos:

- `escopo_tipo` — enum novo `nf_anexo_escopo`:
  - `folha_mensal`
  - `ferias_usufruto`
  - `ferias_abono`
  - `decimo_terceiro_p1`
  - `decimo_terceiro_p2`
- `escopo_id` — uuid, FK polimórfica. Aponta para:
  - `folhas_pagamento.id` quando escopo é `folha_mensal`
  - `colaboradores_ferias_lancamentos.id` quando escopo é `ferias_usufruto` ou `ferias_abono`
  - `decimo_terceiro_linhas.id` quando escopo é `decimo_terceiro_p1` ou `decimo_terceiro_p2`

Como o Postgres não suporta FK polimórfica diretamente, a integridade é mantida por **trigger de validação** `fn_valida_nf_anexo_escopo()` que checa se `escopo_id` existe na tabela correta pro `escopo_tipo` informado.

**Nova unique:** `(tenant_id, colaborador_id, escopo_tipo, escopo_id)`.

**Mantém o índice antigo** `(tenant_id, colaborador_id, competencia_ano, competencia_mes)` só pro caso `escopo_tipo='folha_mensal'` (performance de leitura do quadro mensal e do histórico).

**Backfill:** linhas existentes recebem `escopo_tipo='folha_mensal'` e `escopo_id = (lookup em folhas_pagamento pelo colab+ano+mês)`. Linhas sem folha correspondente no banco (NF órfã, não deveria existir) ficam com `escopo_id = null` temporariamente e viram log de alerta pra equipe revisar.

### 2. Novo status nos lançamentos de férias

A tabela `colaboradores_ferias_lancamentos` hoje tem enum `ferias_lancamento_status`:
`pendente_aprovacao → em_analise → aprovado → concluido` (+ `reprovado`, `cancelado`).

Adicionar valor novo: `aguardando_financeiro`.

O trigger de aprovação do RH (hoje em S7) passa a mover a linha pra `aguardando_financeiro` **sem** criar `conta_avulsa`. Quem move pra `aprovado` + cria `conta_avulsa` passa a ser a nova server action `aprovarFeriasFinanceiro()`, que valida NF anexada.

### 3. Novo status nas linhas de 13°

A tabela `decimo_terceiro_folhas` hoje tem enum `decimo_terceiro_folha_status` com valor `rascunho`. Partes futuras do plano de 13° (não implementadas ainda) incluiriam `fechada_parcial_1`, `fechada_parcial_2`, `concluida`.

Este design **adianta** a semântica das parcelas: quando a parte 3+ do plano de 13° chegar, cada parcela fechada abre a linha de NF correspondente no quadro do colaborador. Enquanto 13° não tiver pagamento implementado, o quadro só mostra a linha quando a parcela for fechada (status novo); como ninguém fecha ainda, as linhas simplesmente não aparecem — e isso é correto.

Pra evitar bloquear este design pelo progresso do 13°, o enum `nf_anexo_escopo` **já nasce** com os valores `decimo_terceiro_p1` e `decimo_terceiro_p2`, mas a server action que trava a aprovação do 13° fica como **TODO** no código, com teste pulado marcado `.skip`. Quando o 13° chegar na parte do pagamento, basta ativar.

### 4. View `vw_nf_pendentes_colaborador`

View consultada pelo quadro no perfil. Une:

- Folhas mensais do colaborador em status `rascunho`, `enviada`, `aguardando_financeiro`, `aprovada`, `pendente_correcao` (todas as que ainda não foram pagas) — competência atual + todas as anteriores sem NF (backlog).
- Lançamentos de férias/abono em `aguardando_financeiro` ou `aprovado` (ainda não `concluido`). Abono combinado gera **duas** linhas (férias + abono) a partir do mesmo lançamento.
- Parcelas de 13° que correspondem a folha de 13° em `fechada_parcial_1` ou `fechada_parcial_2` (não `concluida`).

Colunas da view:
- `tenant_id`, `colaborador_id`
- `escopo_tipo`, `escopo_id`
- `label` (ex: "Folha mensal · outubro/2026", "Férias · 15/11 a 29/11", "Abono · 10 dias", "13° 1ª parcela · 2026")
- `competencia_ano`, `competencia_mes` (quando aplicável)
- `valor` (quando já calculado)
- `prazo_anexo` (data limite — ver §Prazos)
- `nf_anexada` (bool — joined com `colaboradores_nf_anexos`)
- `nf_anexo_id`, `nf_arquivo_nome`, `nf_uploaded_at` (quando anexada)

RLS: colaborador lê só o próprio (`is_colaborador_proprio(colaborador_id)`); RH e admin leem tudo do tenant.

### 5. View `vw_people_aprovar_financeiro`

View consultada pela aba People na página `/financeiro/contas-a-pagar`. Mesma lógica da view do perfil, mas invertida — só retorna linhas em estado "aguardando financeiro aprovar":

- Folha mensal com `status = 'enviada'` (hoje já é o filtro da aba Folhas de Pagamento).
- Férias/abono com `status = 'aguardando_financeiro'`.
- 13° parcelas quando atingirem `fechada_parcial_1`/`fechada_parcial_2` (quando o fluxo existir).

Mesmas colunas da view do perfil, mais `nf_anexada` em destaque (pra UI usar diretamente na trava).

RLS: só role `financeiro` e `admin` do tenant.

## UI

### Perfil — Quadro de NFs

Substitui o componente `card-nf-mes.tsx` por um novo `quadro-nf.tsx`.

**Layout por linha** (uma linha por item retornado pela view):
- Ícone + tipo (Folha mensal / Férias / Abono / 13° 1ª parcela / 13° 2ª parcela)
- Descrição curta (competência ou período)
- Valor (quando calculado — oculto na folha mensal porque o valor pode mudar até o fechamento)
- Prazo + badge de status: "No prazo", "Em atraso", "NF anexada"
- Botão "Anexar NF" (abre picker) ou, se já anexada, nome do arquivo + botão "Substituir"
- Link "Histórico" (abre modal com todas as NFs anexadas daquela natureza, qualquer competência)

**Empty state:** "Nenhuma NF pendente no momento."

**Comportamento:**
- Linha nova aparece sozinha quando o gatilho dispara (ver §Gatilhos).
- Linha some depois do pagamento concluído (title.pago) — mas continua acessível pelo histórico.
- Para `clt`, `estagio`, `socio`: quadro **não aparece** (igual regra atual do card de NF do mês).

### Financeiro — Aba People

Substitui a aba "Folhas de Pagamento" na página `/financeiro/contas-a-pagar`.

**Colunas:**
- Tipo (badge colorido: Folha / Férias / Abono / 13°-P1 / 13°-P2)
- Competência (mês/ano ou período)
- Colaborador
- Função / Tipo de contratação
- Origem (quando folha — california/contabilidade)
- Alocação
- NF (badge: "Anexada" verde / "Pendente" vermelho) — **mesma coluna que já existe**
- Valor
- Dias (quando férias)
- Regionais

**Comportamento da aprovação:**
- Botão "Aprovar" **desabilitado** quando `nf_anexada = false` e o tipo exige NF (todos os tipos atuais exigem — regra pode mudar futuramente).
- Tooltip no botão desabilitado: "Aguardando o colaborador anexar a NF."
- Quando NF anexada e botão habilitado, abre o drawer de revisão (reaproveitar `revisar-folha-drawer.tsx` adaptado pra receber contexto do tipo).
- Drawer mostra `valor_original` (calculado pelo sistema) e permite editar pra `valor_aprovado` (equiparar à NF). Audit registra os dois.
- Server action valida NF **de novo** no backend antes de aprovar; retorna erro se faltar.
- Em `abono_combinado`, o drawer e a aprovação são **por linha** — cada NF (férias e abono) libera só sua linha. Cada aprovação cria uma `conta_avulsa` separada.

**Contador na tab:** mantém o número de linhas aguardando ação. Agora cobre folha + férias + abono + 13°.

### Rescisão (não implementada ainda — contexto futuro)

Quando a página de rescisão existir, ela terá uma seção própria pra o RH anexar a NF da rescisão. **Não** usa a tabela generalizada `colaboradores_nf_anexos` com `escopo_tipo='rescisao'` — é uma tabela própria (`rescisoes_nf_anexos` ou campo na tabela de rescisão), porque a dinâmica é diferente: colaborador não vê, RH anexa, aprovação dentro do fluxo de rescisão. Documentado aqui pra deixar explícito que o enum `nf_anexo_escopo` **não** inclui rescisão.

## Gatilhos — quando cada linha aparece no quadro

| Tipo | Momento em que a linha aparece | Momento em que some |
|---|---|---|
| Folha mensal | Dia 1 do mês vigente (comportamento atual mantido) | Pagamento da folha concluído |
| Férias (usufruto) | RH aprova lançamento → status `aguardando_financeiro` | Pagamento concluído |
| Abono avulso | RH aprova lançamento → status `aguardando_financeiro` | Pagamento concluído |
| Abono combinado | RH aprova lançamento → 2 linhas (férias + abono) aparecem | Pagamento concluído (uma linha por vez conforme pago) |
| 13° 1ª parcela | Folha 13° atinge `fechada_parcial_1` | Pagamento da 1ª parcela concluído |
| 13° 2ª parcela | Folha 13° atinge `fechada_parcial_2` | Pagamento da 2ª parcela concluído |

**Backlog:** se a linha ficar sem NF depois do prazo, continua no quadro com badge "Em atraso". Nunca some automaticamente sem pagamento.

## Prazos

Prazo é informativo (não bloqueia). Serve pra o colaborador saber se ainda está dentro da janela de pagamento rápido.

- **Folha mensal:** mantém o atual — se anexada até 03/MM, pagamento vai na remessa de salários (03/MM+1). Se depois, cai na remessa de fornecedores (08/MM+1).
- **Férias, abono, 13°:** prazo = **data_pagamento prevista menos 2 dias úteis**. Antes disso, "no prazo"; depois, "em atraso". O financeiro ainda consegue aprovar depois do prazo, só sinaliza visualmente.

A data de pagamento prevista:
- Férias: `data_inicio - 2 dias` (regra da CLT).
- 13° P1: fixo 30/11 do ano da folha.
- 13° P2: fixo 20/12 do ano da folha.

Esses defaults ficam no backend (função SQL ou view calculada); UI só exibe.

**Cutoff do backlog:** o quadro só mostra competências a partir de **outubro/2026** (`competencia_ano * 100 + competencia_mes >= 202610`). Antes disso o fluxo de NF obrigatória não existia — mostrar backlog pré-outubro seria ruído operacional. Aplica em todas as linhas do quadro (folha mensal, férias, abono, 13°) via filtro na view.

## Mudanças de fluxo (resumo das implicações)

### Férias/abono — hoje × amanhã

**Hoje:**
1. Colaborador solicita → `pendente_aprovacao`
2. RH analisa → `em_analise`
3. RH aprova → `aprovado` + trigger cria `conta_avulsa` direto
4. Financeiro paga (via aba Títulos a Pagar)

**Amanhã:**
1. Colaborador solicita → `pendente_aprovacao`
2. RH analisa → `em_analise`
3. RH aprova → `aguardando_financeiro` (linha aparece no quadro NF do colaborador)
4. Colaborador anexa NF
5. Financeiro aprova (aba People) → `aprovado` + cria `conta_avulsa`
6. Financeiro paga (via aba Títulos a Pagar) → `concluido`

### 13° — hoje × amanhã

Hoje 13° não tem fluxo de pagamento implementado. O design já inclui a trava pra quando ela chegar.

### Folha mensal — hoje × amanhã

**Hoje:**
1. RH gera `rascunho`
2. RH envia → `enviada`
3. Financeiro aprova → `aprovada` + cria `conta_avulsa` (sem exigir NF)
4. Pago → `paga`

**Amanhã:**
1. RH gera `rascunho`
2. RH envia → `enviada`
3. Financeiro **tenta** aprovar — bloqueado se NF faltar
4. Colaborador anexa NF → botão habilita
5. Financeiro aprova → `aprovada` + cria `conta_avulsa`
6. Pago → `paga`

Nenhum estado novo na folha mensal — só uma validação adicional no caminho da aprovação.

## Migração dos lançamentos de férias já aprovados

Confirmado com o dono: **nenhuma férias atualmente aprovada é dado real** — tudo são testes. A migration pode limpar o estado existente sem contemplar reaproveitamento:

- Para cada lançamento em `colaboradores_ferias_lancamentos` com `conta_avulsa_id` preenchido:
  - Delete do `contas_avulsas` correspondente.
  - Set `conta_avulsa_id = null`, `aprovado_em = null`, `aprovado_por = null`.
  - Status volta pra `pendente_aprovacao` (não `aguardando_financeiro`, porque sem passar pelo RH não deveria estar nesse estado).
- Lançamentos em `concluido` são, por garantia, mantidos como estão (não devem existir hoje — se existirem, flag em log de alerta pra revisar manualmente).

Isso elimina o problema de "suspender contas_avulsas" (ponto aberto 1 original). A tabela `contas_avulsas` não ganha coluna nem status novo.

## Permissões e RLS

### Tabela `colaboradores_nf_anexos`

Policies atuais já cobrem leitura/escrita por `is_tenant_member()` (política ampla, discriminação dono×RH é feita na server action via `lib/permissoes.ts`). Manter o padrão: nenhuma policy nova.

### View `vw_nf_pendentes_colaborador`

RLS herda das tabelas-base. Garantir que a view usa `security_invoker=on` pra respeitar as policies do caller.

### View `vw_people_aprovar_financeiro`

Mesmo esquema. Expor só pra `is_tenant_financeiro(tenant_id)` ou admin — função helper já existente.

### Server actions novas

- `anexarNfQuadro(escopo_tipo, escopo_id, arquivo)` — valida que colaborador logado é dono do `escopo_id` daquele tipo. Reaproveita lógica atual de upload do `card-nf-mes.tsx`.
- `aprovarFeriasFinanceiro(lancamento_id)` — valida role financeiro, valida NF anexada, muda status pra `aprovado`, cria `conta_avulsa` reaproveitando RPC `criar_conta_avulsa`.
- `aprovarDecimoTerceiroFinanceiro(linha_id, parcela)` — stub por enquanto; implementação completa quando o 13° chegar na parte de pagamento.
- `aprovarLinhaFolha` (existente) — adicionar validação de NF anexada antes do RPC `criar_conta_avulsa`.

Todas as actions registram em `audit_log` como já é padrão.

## Ordem de execução

1. **Migration do modelo generalizado** — adiciona `escopo_tipo`, `escopo_id`, nova unique, trigger de validação, backfill da folha mensal. Enum `aguardando_financeiro` em `ferias_lancamento_status`. Atualiza `lib/types.ts`. Confirmar backfill no banco antes de prosseguir.
2. **Views** `vw_nf_pendentes_colaborador` e `vw_people_aprovar_financeiro`.
3. **Server actions** novas e ajuste da `aprovarLinhaFolha`.
4. **UI do perfil** — `quadro-nf.tsx` substitui `card-nf-mes.tsx`. Mantém upload, countdown, backlog, histórico. Começa listando só folha mensal (preserva comportamento atual).
5. **UI do financeiro** — aba "People" substitui "Folhas de Pagamento". Começa listando só folha mensal + folhas CLT contabilidade (zero regressão). Trava do botão "Aprovar" entra junto.
6. **Fluxo de férias** — altera trigger de aprovação do RH pra parar em `aguardando_financeiro` **sem** criar `conta_avulsa`. Em `abono_combinado`, a aprovação do financeiro cria 2 `contas_avulsas` separadas (uma por linha aprovada). Migration de limpeza: apaga `contas_avulsas` órfãs de teste, zera estado dos lançamentos existentes. Quadro passa a listar férias/abono. Aba People passa a listar férias/abono.
7. **13°** — stub ativo, fluxo real entra junto da parte de pagamento do 13°.

Passos 1-3 são backend e podem ir num bloco. 4 e 5 podem ir em paralelo. 6 depende de confirmação do dono por ser destrutivo.

## Decisões incorporadas após revisão

### Pelo dono

- **Suspensão de títulos existentes (eliminado):** férias atualmente aprovadas são todas de teste. A migration apaga `contas_avulsas` órfãs e zera estado dos lançamentos. `contas_avulsas` não ganha coluna nem status novo. Ver §Migração.
- **Abono combinado gera 2 `contas_avulsas` separadas** — uma para férias (`valor_ferias + valor_um_terco`) e outra para abono (`valor_abono`). O trigger de aprovação de férias (hoje em S7, cria 1 título com `valor_total`) precisa ser adaptado para criar 2 títulos quando `tipo = 'abono_combinado'`. Impacta a estrutura de `aprovarFeriasFinanceiro()`: no caso combinado, o financeiro aprova as duas linhas separadamente (cada NF trava sua linha), e cada aprovação cria um dos 2 títulos.
- **NF com valor divergente:** o drawer de aprovação permite editar o valor antes de aprovar. O valor da NF ganha prioridade sobre o calculado. Audit explícito registra `valor_original` × `valor_aprovado` × `valor_nf`.
- **Backlog com cutoff em 2026-10:** o quadro só mostra competências `>= 2026-10` (`competencia_ano * 100 + competencia_mes >= 202610`). Antes disso, o fluxo de NF não existia; mostrar backlog pré-outubro seria ruído. Cutoff fixo na view (não "últimos N meses" relativo).

### Pelo construtor (minhas calls)

- **Upload só pelo próprio colaborador.** RH/admin não anexa em nome de PJ. Server action valida `is_colaborador_proprio(colaborador_id)` do `escopo_id`. Se RH precisar anexar por exceção no futuro, vira iteração própria.
- **Unique parcial pra órfãos no backfill.** Nova unique na `colaboradores_nf_anexos` é `UNIQUE (tenant_id, colaborador_id, escopo_tipo, escopo_id) WHERE escopo_id IS NOT NULL`. NFs órfãs (sem folha correspondente no backfill) ficam com `escopo_id = null` e aparecem num log pra revisão humana. Nenhuma linha nova pode ser inserida com `escopo_id = null` — trigger separado barra isso.
- **Critério "linha some" via `contas_avulsas.status='paga'`.** Para folha mensal, férias e 13°, a view junta com `contas_avulsas` via `conta_avulsa_id` e exclui quando `status='paga'`. Quando o título ainda não foi criado (fluxo pré-aprovação do financeiro), a linha aparece normal (`contas_avulsas` não existe ainda, então o LEFT JOIN mantém a linha).

## Pontos abertos para o construtor sinalizar durante a implementação

- **Validação do PDF:** hoje só PDF é aceito. Se um dia precisar validar via SPED, o XML é essencial. Fora de escopo deste design — mas se durante a implementação ficar fácil deixar a porta aberta pra XML futuro (ex: tipo MIME flexível), vale.

## O que fica a cargo do construtor

- Esquema exato da trigger de validação polimórfica.
- Formato visual exato dos badges de tipo (cores, abreviações).
- Reaproveitamento de `revisar-folha-drawer.tsx` versus novo componente — depende da forma final do drawer com os novos tipos.
- Granularidade de testes: pelo menos cada mudança de status + cada caminho da server action tem teste; não precisa de teste E2E pro quadro visual.
- Decisão de usar `security_invoker=on` nas views ou criar policies dedicadas — ambos são aceitos no projeto.
- Esquema de telemetria/log de upload de NF (se necessário além do audit padrão).

## Referências

- `docs/FLUXO-BANCO.md` — ciclo obrigatório de migration via MCP
- `docs/PERFORMANCE.md` — regras de GRANT/índice/RLS
- `docs/decisions/132-folha-paga-pela-remessa-com-o-liquido.md` — fluxo atual de aprovação da folha
- `docs/superpowers/plans/2026-10-07-folha-anexo-nf.md` — origem do card atual de NF do mês
- `docs/modulos/rh/25-ferias.md`, `docs/modulos/rh/26-ferias-modelo-de-dados.md` — modelo de férias
- `docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md` — fundação de 13°
- `supabase/migrations/20261008000001_colaboradores_nf_anexos.sql` — tabela atual
- `supabase/migrations/20261002000004_ferias_lancamentos.sql` — tabela de lançamentos de férias
- `supabase/migrations/20261021000001_decimo_terceiro_fundacao.sql` — fundação de 13°
- `app/(app)/perfil/_components/card-nf-mes.tsx` — card atual que vira o quadro
- `app/(app)/financeiro/contas-a-pagar/folhas-pagar-list.tsx` — lista atual que vira a People
- `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` — server action a modificar
