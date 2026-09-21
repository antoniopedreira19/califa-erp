# Módulo pgto-remessa aberto — impactos no RH (2026-09-23)

> Handoff **retrospectivo** e **cross-módulo**. A sessão anterior (2026-09-21, tarde/noite) inaugurou o módulo **pgto-remessa** (geração de arquivo CNAB 240 Santander) — trabalho enorme, com 7 migrations aplicadas, dois ADRs decididos (001/002) mais dois de correção (003/004), UI de exportação implementada, e uma refatoração relevante do RH que **NÃO** havia sido documentada do lado do RH. Este handoff documenta o cenário atual **do ponto de vista do RH**, pra próxima sessão do módulo não bater a cara em surpresa. A documentação completa do pgto-remessa está em [`docs/modulos/pgto-remessa/`](../modulos/pgto-remessa/).

## O que mudou no RH (o que precisa saber)

### 1. Colaborador não é mais fornecedor

Migration [`20260921100001_colaborador_sem_vinculo_fornecedor.sql`](../../supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql) removeu `colaboradores.fornecedor_id`. Consequências no código:

- `lib/types.ts` — campo `fornecedor_id` removido de `Colaborador`.
- `app/(app)/rh/colaboradores/colaborador-form-novo.tsx` — auto-match por documento e cards "Fornecedor já cadastrado" / "Criar fornecedor a partir deste cadastro" removidos. Formulário ficou **~100 linhas menor**.
- `app/(app)/rh/colaboradores/actions.ts` — server actions `buscarFornecedorPorDocumento` e o bloco de `criarFornecedor` (dentro do fluxo de cadastro do colaborador) removidos.
- `app/(app)/rh/colaboradores/[id]/card-dados.tsx` — linha "Fornecedor vinculado" tirada da UI.
- `app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx` — state e submit de `fornecedor_id` tirados.

Racional em [`pgto-remessa/02-decisoes.md` ADR 001](../modulos/pgto-remessa/02-decisoes.md).

### 2. Colaborador ganhou dados bancários próprios

Migration [`20260921140001_colaboradores_dados_bancarios.sql`](../../supabase/migrations/20260921140001_colaboradores_dados_bancarios.sql) adicionou 9 colunas nullable em `colaboradores`:

```
banco_codigo, banco_nome, agencia, agencia_dv,
conta, conta_dv, tipo_conta,
pix_tipo, pix_chave
```

Mesmo shape que `fornecedores.banco_*` / `.pix_*` já tem — reaproveita os enums `tipo_conta_bancaria` e `pix_tipo_chave`.

**Novo card na UI de detalhe do colaborador:** [`app/(app)/rh/colaboradores/[id]/card-dados-bancarios.tsx`](../../app/(app)/rh/colaboradores/[id]/card-dados-bancarios.tsx) (359 linhas — banco + agência com DV + conta com DV + tipo de conta + chave PIX). Server actions em `actions.ts`. Também está sendo renderizado em `app/(app)/rh/colaboradores/[id]/page.tsx` entre `CardDados` e a grade de Alocações/Salários.

### 3. `contas_avulsas` ganhou `colaborador_id`

Migration [`20260921120001_contas_avulsas_colaborador_id.sql`](../../supabase/migrations/20260921120001_contas_avulsas_colaborador_id.sql) adicionou `contas_avulsas.colaborador_id uuid nullable` referenciando `colaboradores(id)` com `ON DELETE RESTRICT`. `vw_a_pagar` foi recriada expondo a coluna.

Impacto direto no fluxo de folha: a server action `aprovarLinhaFolha` em `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` passou a gravar `colaborador_id = colab.id` **em vez de** `fornecedor_id = colab.fornecedor_id` (o atalho antigo, que quebraria com a remoção do ADR 001).

Racional em [`pgto-remessa/02-decisoes.md` ADR 002](../modulos/pgto-remessa/02-decisoes.md).

### 4. Títulos a Pagar agora distingue origem "folha" de "avulso"

Migration [`20260921230001_origem_folha_em_vw_a_pagar.sql`](../../supabase/migrations/20260921230001_origem_folha_em_vw_a_pagar.sql) alterou `vw_a_pagar` pra classificar linhas com `folha_id` preenchido como `origem = 'folha'` (antes eram `origem = 'avulso'`, indistinguíveis das outras contas avulsas). Impacto no RH: quando uma folha aprovada aparece em `/financeiro/contas-a-pagar` → aba **Títulos a Pagar**, ela agora vem com badge/filtro próprio. Sem mudança de código no RH — a tela do financeiro é quem consome.

## O que **NÃO** mudou no RH

Continua tudo o que fechamos na sessão anterior:

- Cadastro/edição/inativação de colaborador com múltiplas alocações e histórico salarial.
- CRUD de níveis de cargo (`/rh/colaboradores/niveis`).
- Folha mensal (Rodadas 1/2/3): geração idempotente, envio, aprovação com edição, propagação pra Camada 1, geração de contas avulsas rateadas por alocação.
- Design & UX P0 (D1/D2/D3) + Rodada 2 (visual polish com cards balanceados, delta vs mês anterior, tabs de status, filtro de regional, barra de progresso do fluxo).

## Migrations aplicadas na janela desta sessão

Todas em 2026-09-21 (mesma sessão de pgto-remessa):

```
20260921100001  colaborador_sem_vinculo_fornecedor        (RH)
20260921120001  contas_avulsas_colaborador_id             (Financeiro/Folha)
20260921140001  colaboradores_dados_bancarios             (RH)
20260921160001  empresas_contabeis_config_cnab            (pgto-remessa; revertida pelo ADR 004)
20260921180001  cnab_estruturas_do_arquivo                (pgto-remessa)
20260921200001  config_cnab_migra_para_conta_bancaria     (pgto-remessa; corrige 000160001)
20260921200002  cnab_remessas_conta_bancaria_id           (pgto-remessa)
20260921220001  rpc_alocar_sequencial_cnab                (pgto-remessa)
20260921230001  origem_folha_em_vw_a_pagar                (Financeiro/Folha)
```

## Docs / ADRs relacionados

- [`docs/modulos/pgto-remessa/README.md`](../modulos/pgto-remessa/README.md) — índice do módulo novo.
- [`docs/modulos/pgto-remessa/02-decisoes.md`](../modulos/pgto-remessa/02-decisoes.md) — ADRs 001/002/003/004. **Fonte-verdade** das decisões que impactam o RH.
- [`docs/modulos/pgto-remessa/03-modelo-de-dados.md`](../modulos/pgto-remessa/03-modelo-de-dados.md) — o que virou banco, em que ordem.
- [`docs/modulos/rh/03-modelo-de-dados.md`](../modulos/rh/03-modelo-de-dados.md) — spec do MVP original do RH, **parcialmente stale** (ainda cita `fornecedor_id` no shape do colaborador). Anotado no topo do arquivo.

## Commits relevantes (por ordem cronológica)

- `781f848` — refactor(rh): colaborador nao reaproveita banco via fornecedor
- `caab72a` — fix(financeiro): contas_avulsas ganha colaborador_id (folha aprovada)
- `37e51c2` — feat(rh): colaborador ganha dados bancarios (banco e PIX)
- `1bc43af` — feat(admin): empresas contabeis ganham config CNAB Santander
- `7cd9ccd` — feat(pgto-remessa): estruturas do arquivo CNAB — codigo de barras + tabelas
- `fb80310` — refactor(pgto-remessa): config CNAB migra pra conta bancaria (ADR 004)
- `71c1836..cb3d5a6` — biblioteca de geração + server action + UI de exportação CNAB
- `b3a6082..a670387` — refactor da toolbar de Títulos a Pagar + origem "folha" separada

## Pontos de atenção pra próxima sessão de RH

- **Formulário de novo colaborador não pede banco/PIX ainda.** As 9 colunas foram criadas nullable — o cadastro rápido funciona sem. O card de banco só aparece na tela de **detalhe** do colaborador, pra edição manual depois. Se o import da planilha (P1.1 do backlog) for entrar em breve, decida antes se o import preenche banco ou fica pra depois. Kika hoje tem uma coluna de banco no Excel; provavelmente vale mapear.
- **Backfill dos colaboradores existentes está pendente.** Todos os colaboradores em produção têm `banco_codigo = null` (aditiva pura, sem backfill). Se algum já for pago via CNAB antes do formulário do RH ser incrementado, precisa preencher via SQL ou pela UI de detalhe.
- **`docs/modulos/rh/03-modelo-de-dados.md` está parcialmente stale.** Ele descreve o shape MVP original com `fornecedor_id`. Foi decidido não reescrevê-lo (é doc histórico do MVP) — só anotar no topo do arquivo. As mudanças reais estão nos ADRs de pgto-remessa. Se causar confusão, considerar reescrever numa sessão futura.
- **Fluxo de folha aprovada → CNAB ainda não roda ponta a ponta.** O motor de folha materializa `contas_avulsas` com `colaborador_id`, e a `vw_a_pagar` já expõe a coluna. Mas a UI de exportar remessa CNAB (fase 5 do pgto-remessa) só está implementada em código — falta homologar o arquivo `.REM` com o Santander (nota G010: sequenciais 1–10 são teste). Regra: **nada de gerar arquivo real de produção sem homologação**.
