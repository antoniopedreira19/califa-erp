## Task 028 — Freelancers (Fase 5): Migração dos legados do AgCaliforniaRH

> **Status (16/10/2026)**: fundação pronta, import adiado pra data de
> corte. Alinhado com o Antonio: antes de puxar dados reais, validar o
> fluxo end-to-end no dev local e absorver ajustes de UI. Quando a
> data de corte for definida, retomar daqui.
>
> **O que já ficou pronto nesta data**:
> - Coluna `legado_id uuid unique` adicionada em `freelancers` e
>   `freelancer_contratos` (migration `20261016000008_...`).
> - Audit type `freelancers.migracao_executada` registrado.
> - Decisões abaixo travadas (dedup, mapeamento, tratamento de arquivos).
>
> **O que falta executar na data de corte**:
> 1. Autorização pontual pra leitura cross-project de PII do AgCaliforniaRH.
> 2. Rodar o import dos 221 freelancers em batch (idempotente via `legado_id`).
> 3. Rodar o import dos 374 contratos.
> 4. **Task 028b** (nova): script Node pra migrar ~700 arquivos
>    (minuta DOCX, PDF assinado, cartão CNPJ, distrato) do bucket antigo
>    pro `freelancer-arquivos` do califa-erp e popular os paths.

## Objetivo

Trazer 221 freelancers + 374 contratos do AgCaliforniaRH pro califa-erp,
sem perder dedup e sem bagunçar o módulo novo.

Divisão:
- **028a (ESTA task)**: dados — migrar linhas das 2 tabelas via MCP cross-project.
- **028b (futura)**: arquivos — ~700 PDFs/DOCX do bucket antigo pro novo.
  Vira script Node que roda uma vez com env vars dos 2 projetos.

## Decisões travadas

- **Coluna `legado_id uuid unique` em `freelancers` e `freelancer_contratos`**.
  É aditiva, nullable. Serve pra idempotência (rodar 2× não duplica) e
  rastreabilidade. Preenchida pela migração; registros nascidos no
  califa-erp ficam null.
- **IDs novos**: cada linha ganha novo UUID. Não reuso IDs antigos pra
  evitar colisão hipotética com registros já existentes.
- **Dedup por CPF**: se já existe freelancer no califa-erp com o mesmo
  CPF, atualiza `legado_id` dele em vez de criar duplicata. Para
  contrato, dedup é pelo `legado_id` do próprio contrato.
- **`responsavel_id` dos contratos**: `null`. O `gp_id` antigo aponta
  pra profiles do AgCaliforniaRH que não existem aqui. RH reatribui
  responsáveis depois pela UI.
- **`job_id` dos contratos**: `null` (legados). Já previsto pelo
  check constraint `freelancer_contratos_job_obrigatorio_em_novos`,
  que permite null quando `origem_sistema='ag_california_rh'`.
- **`nome_job` snapshot**: copia direto do antigo.
- **Paths de arquivo (`arquivo_url`, `minuta_url`, `distrato_*_url`,
  `cartao_cnpj_url`)**: migram como **null** nesta task. 028b vai popular
  depois de migrar os binários entre buckets.
- **`origem`** do freelancer migrado: `'migracao'` (já tem como valor
  válido no check constraint da Task 011).
- **`origem_sistema`** do contrato migrado: `'ag_california_rh'`.
- **`dados_bancarios`** texto legado (só 1 linha no antigo tem): ignoro.
  Perda documentada; RH pode preencher a mão.
- **Audit log** de cada freelancer e cada contrato migrados: um
  evento `freelancer.cadastrado_via_migracao` e
  `freelancer_contrato.criado_via_migracao`. Vou adicionar.

## Escopo

### 1. Migration

`20261016000008_freelancers_f5_coluna_legado_id.sql` — adiciona
`legado_id uuid unique` nas duas tabelas + índice.

### 2. Migrations de dados

Rodar via MCP (apply_migration), em batches:
- `20261016000009_freelancers_f5_import_freelancers_legados.sql`
- `20261016000010_freelancers_f5_import_contratos_legados.sql`

Idempotência via `on conflict (legado_id) do nothing`.

### 3. Audit types

- `freelancer.cadastrado_via_migracao`
- `freelancer_contrato.criado_via_migracao`

(Não vou gravar audit do bulk — seria 595 eventos. Em vez disso,
registro UM evento `freelancers.migracao_executada` com metadata).

### 4. 028b (futura, fora desta task)

Script `scripts/migrar-arquivos-freelancer-legado.ts` com env vars
`AG_RH_SUPABASE_URL` e `AG_RH_SUPABASE_SERVICE_ROLE_KEY` que:
- Lista arquivos do bucket antigo
- Baixa cada um
- Faz upload no bucket novo com path `{tenant}/contratos/{contrato_id}/...`
- Atualiza colunas `arquivo_url`/`minuta_url`/`distrato_*_url` no novo

## Critérios

- [ ] Coluna `legado_id` existe em `freelancers` e `freelancer_contratos`.
- [ ] 221 freelancers migrados (ou dedupados por CPF).
- [ ] 374 contratos migrados.
- [ ] View `freelancers_com_status` continua funcionando.
- [ ] Rodar migração 2× não duplica.
- [ ] `npm run typecheck` e `lint` passam.
