# 03 — Modelo de dados

Estado do modelo de dados do módulo depois da fase 4 (modelagem) fechada em 2026-09-21.

## Migrations aplicadas nesta fase

Ordem cronológica. Todas aditivas (a única destrutiva do módulo é a do ADR 001, na descoberta).

| # | Arquivo | O que faz |
|---|---|---|
| 1 | [`20260921100001_colaborador_sem_vinculo_fornecedor.sql`](../../../supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql) | Remove `colaboradores.fornecedor_id` (ADR 001). |
| 2 | [`20260921120001_contas_avulsas_colaborador_id.sql`](../../../supabase/migrations/20260921120001_contas_avulsas_colaborador_id.sql) | `contas_avulsas.colaborador_id` + `vw_a_pagar` recriada (ADR 002). |
| 3 | [`20260921140001_colaboradores_dados_bancarios.sql`](../../../supabase/migrations/20260921140001_colaboradores_dados_bancarios.sql) | Colaborador ganha `banco_*` + `pix_*` (9 colunas nullable). |
| 4 | [`20260921160001_empresas_contabeis_config_cnab.sql`](../../../supabase/migrations/20260921160001_empresas_contabeis_config_cnab.sql) | Empresa contábil ganha config CNAB — **revertida em 20260921200001**. |
| 5 | [`20260921180001_cnab_estruturas_do_arquivo.sql`](../../../supabase/migrations/20260921180001_cnab_estruturas_do_arquivo.sql) | `codigo_barras` em PP+avulsa + tabelas `cnab_remessas` e `cnab_remessas_itens` com RLS. |
| 6 | [`20260921200001_config_cnab_migra_para_conta_bancaria.sql`](../../../supabase/migrations/20260921200001_config_cnab_migra_para_conta_bancaria.sql) | **Corrige o erro de design da #4**: config CNAB migra pra `contas_bancarias`. Endereço fica em `empresas_contabeis` (ADR 004). |
| 7 | [`20260921200002_cnab_remessas_conta_bancaria_id.sql`](../../../supabase/migrations/20260921200002_cnab_remessas_conta_bancaria_id.sql) | `cnab_remessas.empresa_contabil_id` → `conta_bancaria_id` (ADR 004). |
| 8 | [`20260921220001_rpc_alocar_sequencial_cnab.sql`](../../../supabase/migrations/20260921220001_rpc_alocar_sequencial_cnab.sql) | RPC `alocar_sequencial_cnab` (SECURITY DEFINER) — aloca sequencial atomicamente pra evitar race em geração concorrente. Fase 5.2. |
| 9 | [`20260921230001_origem_folha_em_vw_a_pagar.sql`](../../../supabase/migrations/20260921230001_origem_folha_em_vw_a_pagar.sql) | `vw_a_pagar` recriada com CASE de 3 braços (folha > recorrente > avulsa) + CHECK de `cnab_remessas_itens.origem_tipo` relaxado pra aceitar `'folha'` (ADR 005). |

## Tabelas tocadas

### `colaboradores` — ganhou shape bancário

Novas colunas, todas nullable:

```sql
banco_codigo   text                          -- código FEBRABAN (3 dígitos)
banco_nome     text                          -- denormalizado, sem lookup
agencia        text                          -- só dígitos, DV separado
agencia_dv     text                          -- 1 caractere, pode ser letra
conta          text                          -- só dígitos
conta_dv       text                          -- 1 caractere
tipo_conta     tipo_conta_bancaria           -- corrente | poupanca | pagamento
pix_tipo       pix_tipo_chave                -- cpf | cnpj | email | telefone | aleatoria
pix_chave      text
```

Enums reaproveitados de `fornecedores` — bate 1:1 com o CNAB (G013 B / G032).

Sem CHECK exigindo "banco OR pix". Validação vive no schema Zod do formulário (`dadosBancariosColaboradorSchema`), pra manter cadastro rápido pré-folha e centralizar erro em UI.

### `empresas_contabeis` — ganhou endereço fiscal

Novas colunas, todas nullable — **endereço fiscal do CNPJ**, usado no header do arquivo como identificação do titular do débito:

```sql
endereco_logradouro     text
endereco_cidade         text
endereco_cep            text
endereco_uf             character(2)
```

> **Nota histórica:** a migration `20260921160001` original também colocou convênio, agência+conta débito, DVs e sequencial aqui. **Corrigida no ADR 004** — esses campos migraram pra `contas_bancarias`. Endereço permanece porque é característica do CNPJ, não da conta.

### `contas_bancarias` — ganhou DVs + config CNAB (ADR 004)

Novas colunas, todas nullable:

```sql
agencia_dv                  text      -- DV da agência (1 char, pode ser letra)
numero_conta_dv             text      -- DV da conta
convenio_cnab_santander     text      -- 20 pos alfanumérico, fornecido pelo Santander
sequencial_arquivo          integer   -- CHECK >= 11 quando preenchido
```

Cada conta bancária tem sua própria série de sequencial e seu próprio convênio. Uma PJ pode ter N contas Santander cada uma com convênio distinto (raro mas possível). O gerador CNAB rejeita conta sem `convenio_cnab_santander` ou sem `sequencial_arquivo` preenchidos.

### `contas_avulsas` — ganhou `colaborador_id`, `codigo_barras` (+ `folha_id` no tipo)

- `colaborador_id uuid` — destinatário quando origem é folha. Complementa `fornecedor_id`/`cliente_id`. FK com `on delete restrict`.
- `codigo_barras text` — 44 dígitos com CHECK de formato. Preenchido quando `forma_pagamento = 'boleto'`.
- `folha_id` já existia no banco, foi adicionada ao tipo TypeScript nesta fase (inconsistência pré-existente).

### `pedidos_compra_parcelas` — ganhou `codigo_barras`

Mesma coisa que em `contas_avulsas`: 44 dígitos, CHECK, preenchido só se boleto.

### `vw_a_pagar` — recriada expondo `colaborador_id` + origem `folha`

**Colaborador_id (ADR 002)**: coluna nova no fim da projeção (Postgres não deixa reordenar em `CREATE OR REPLACE VIEW`). NULL nas origens que não são conta avulsa; valor real quando origem é `avulsa`/`folha`/`recorrente`.

**Origem folha (ADR 005)**: o CASE que decide `origem_tipo` do bloco de `contas_avulsas` ganhou 3 braços em vez de 2 — folha ganha origem própria, distinta de avulsa e recorrência:

```sql
CASE
  WHEN a.folha_id IS NOT NULL THEN 'folha'
  WHEN a.recorrente_id IS NOT NULL THEN 'recorrente'
  ELSE 'avulsa'
END AS origem_tipo
```

Consumo no código: `OrigemTitulo` type em `lib/types.ts`, `origemTituloLabel`, chip novo "Folhas" em `titulos-pagar-list.tsx`, badge rosa (`rose-50`/`rose-700`) na coluna Origem, contagem própria no filtro.

### `cnab_remessas` — nova tabela

Cabeçalho de cada arquivo `.REM` gerado. Uma linha por arquivo.

```sql
id                     uuid PK
tenant_id              uuid FK tenants
conta_bancaria_id      uuid FK contas_bancarias   -- ADR 004, era empresa_contabil_id
sequencial_arquivo     integer NOT NULL           -- unique (conta_bancaria_id, sequencial)
data_geracao           timestamptz NOT NULL default now()
hash_arquivo           text NOT NULL              -- sha256 hex, dedup + auditoria
path_storage           text                       -- Supabase Storage; null durante geração
qtd_itens              integer NOT NULL
valor_total            numeric(16,2) NOT NULL
status                 text NOT NULL              -- gerado | enviado_banco | processado | cancelado
gerado_por             uuid FK auth.users
observacoes            text
```

Constraints:
- `chk_cnab_remessas_status` — status ∈ {gerado, enviado_banco, processado, cancelado}
- `chk_cnab_remessas_sequencial_positivo` — sequencial >= 11
- `uniq_cnab_remessas_sequencial` — unique (conta_bancaria_id, sequencial_arquivo)

Índices: `(tenant_id, data_geracao desc)`, `(conta_bancaria_id, sequencial desc)`.

RLS: `is_tenant_member` gate. GRANT SELECT/INSERT/UPDATE para `authenticated`.

### `cnab_remessas_itens` — nova tabela

Uma linha por título incluído em uma remessa.

```sql
id                      uuid PK
tenant_id               uuid FK tenants
remessa_id              uuid FK cnab_remessas ON DELETE CASCADE
origem_tipo             text NOT NULL       -- pp | avulsa | recorrente | desembolso
origem_id               uuid NOT NULL       -- id da parcela/avulsa/desembolso
forma_pagamento         forma_pagamento NOT NULL  -- boleto | pix | transferencia
destinatario_tipo       text NOT NULL       -- fornecedor | colaborador | cliente
destinatario_id         uuid NOT NULL
valor                   numeric(14,2) NOT NULL
data_pagamento          date NOT NULL
numero_documento_banco  text                -- "nosso número" atribuído pelo gerador
ocorrencia_retorno      text                -- código de 2 dígitos do .RET, null se não processado
ocorrencia_data         timestamptz
```

Constraints:
- `chk_cnab_itens_origem_tipo` — origem_tipo ∈ {pp, avulsa, recorrente, desembolso}
- `chk_cnab_itens_destinatario_tipo` — destinatario_tipo ∈ {fornecedor, colaborador, cliente}
- `chk_cnab_itens_forma_pagamento` — forma_pagamento ∈ {boleto, pix, transferencia}

Índices: `(remessa_id)`, `(origem_tipo, origem_id)`, `(destinatario_tipo, destinatario_id)`.

RLS igual ao de `cnab_remessas`. Cascade em delete garante que apagar remessa apaga itens.

## O que ainda falta

- ✅ **Backfill de config CNAB da California Santander** — feito em 21/09/2026 com os dados extraídos do arquivo `PE000013.TXT` (arquivo antigo aceito pelo Santander). Convênio `00334682004906997169`, agência 4682, conta 13005989-7, sequencial 13.
- **Backfill de endereço fiscal da California Filmes** — feito também em 21/09/2026 (Salvador/BA).
- **Backfill de dados bancários dos 24 fornecedores + 1 colaborador** — trabalho manual do cadastro, não do módulo.
- **Server action de geração** (fase 5) — não faz parte do modelo, mas depende dele.
- **`ativo` em `cnab_remessas` e política de exclusão** — decisão adiada. Por enquanto, cancelamento é via status='cancelado'; delete físico não existe.

## Como isso muda o `vw_a_pagar`

Antes (só olhando as origens):

```
pp/avulsa/recorrente/desembolso → fornecedor_id + cliente_id
```

Agora:

```
pp                    → fornecedor_id
avulsa/recorrente     → fornecedor_id OU cliente_id OU colaborador_id
desembolso            → fornecedor_id OU cliente_id
pp_devolucao_verba    → sem destinatário (é entrada)
```

O gerador CNAB decide o `destinatario_tipo` da remessa item olhando qual dos três está preenchido, na ordem: colaborador > fornecedor > cliente (colaborador ganha porque em avulsa gerada por folha, os três podem estar preenchidos mas colaborador é a fonte real).

## Referências

- Manual Santander CNAB 240 v11.7 — segmentos J/J52 (boleto), A/B (PIX e TED), header de arquivo (Nota G009 = convênio).
- [ADR 001](02-decisoes.md#adr-001) — colaborador desvinculado de fornecedor.
- [ADR 002](02-decisoes.md#adr-002) — colaborador_id em contas_avulsas + escopo do MVP.
- [ADR 003](02-decisoes.md#adr-003) — modelo de dados fechado.
