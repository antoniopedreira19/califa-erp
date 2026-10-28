# Alocação multi-empresa com rateio regional — Design

## Intenção

Hoje um colaborador tem **1 alocação vigente** apontando pra **1 empresa**, com granularidade de "regional específica" ou "todas as regionais via rateio anual da empresa". A regra de negócio evoluiu: um colaborador pode trabalhar pra **N empresas simultaneamente** (ex: Antonio 60% California + 40% Hitlab), e dentro de cada empresa pode ter divisão regional própria.

Decisão de modelagem já tomada (brainstorm 2026-10-28): **Opção B — pacote hierárquico**.

- Pacote = foto vigente do colaborador (quem, desde quando).
- Dentro do pacote, 1+ itens por empresa (com % que cada empresa pega).
- Dentro de cada item, 0+ regionais (com % dentro da empresa) OU flag "usa rateio padrão da empresa".

A unidade atômica é o pacote. Trocar aloca = criar pacote novo + fechar antigo em transação. Nunca estado intermediário.

## Modelo de dados

**`colaboradores_alocacoes` (existente, redesenhada)** — PACOTE
- Campos mantidos: `id`, `tenant_id`, `colaborador_id`, `data_inicio`, `data_fim`, `motivo`, `created_by`, `created_at`.
- Campos removidos (migrados pra filhas): `empresa_id`, `regional_id`, `usa_rateio_empresa`.
- Invariante mantido: UNIQUE partial index `(colaborador_id) WHERE data_fim IS NULL` → 1 pacote vigente por colaborador.
- Removida: constraint `chk_alocacao_regional_xor_rateio` (vira responsabilidade do item).

**`colaboradores_alocacoes_itens` (nova)** — FATIA por empresa
- `id`, `tenant_id`, `alocacao_id` (FK), `empresa_id` (NOT NULL)
- `percentual_empresa numeric(5,2) NOT NULL CHECK (percentual_empresa > 0 AND percentual_empresa <= 100)`
- `usa_rateio_empresa boolean NOT NULL`
- UNIQUE `(alocacao_id, empresa_id)` — mesma empresa não aparece 2x no mesmo pacote.
- Invariante: `SUM(percentual_empresa) por alocacao_id = 100` (trigger).

**`colaboradores_alocacoes_itens_regionais` (nova)** — divisão regional da fatia
- `id`, `tenant_id`, `alocacao_item_id` (FK), `regional_id` (NOT NULL)
- `percentual_regional numeric(5,2) NOT NULL CHECK (percentual_regional > 0 AND percentual_regional <= 100)`
- UNIQUE `(alocacao_item_id, regional_id)`.
- Invariante: quando o item tem `usa_rateio_empresa = false`, `SUM(percentual_regional) por alocacao_item_id = 100` (trigger). Quando `usa_rateio_empresa = true`, a lista fica vazia e a geração da folha usa `empresas_rateios_regionais`.

## Regras de negócio

1. Pacote vazio (sem itens) é inválido — a geração da folha pula o colaborador com motivo "sem alocação", como já faz hoje.
2. Soma dos % das empresas no pacote precisa fechar 100 — trigger `enforce_alocacao_itens_soma_100` bloqueia commit se não bater.
3. Dentro de cada item com `usa_rateio_empresa = false`, soma dos % das regionais precisa fechar 100 — trigger `enforce_alocacao_item_regionais_soma_100`.
4. Quando o item tem `usa_rateio_empresa = true`, a tabela de regionais do item fica vazia (constraint).
5. Alterar pacote = criar novo pacote + fechar vigente numa única transação (RPC SQL). A operação é atômica: ou os 3 inserts (pacote, N itens, M regionais) e o update de `data_fim` passam, ou nada passa.
6. Validar que todas as regionais escolhidas pertencem às empresas correspondentes (reaproveita `fk_alocacao_regional_pertence_empresa` adaptada).

## Explosão em folha de pagamento

A RPC `gerar_folha_da_competencia` passa a:
1. Buscar pacote vigente do colaborador.
2. Pra cada item do pacote (empresa com `percentual_empresa`):
   - Se `usa_rateio_empresa = true`: expande via `empresas_rateios_regionais` do ano; `percentual_final = percentual_empresa × percentual_rateio_empresa / 100`.
   - Se `false`: usa cada regional do item; `percentual_final = percentual_empresa × percentual_regional / 100`.
3. Insere N linhas em `folhas_pagamento_alocacoes` com `percentual_final`.
4. Trigger existente `enforce_folha_alocacao_soma_100` garante que a soma final bate 100.

Resultado: 1 folha por colaborador (igual hoje), com N linhas no snapshot — onde N = Σ (regionais de cada item). O `salario_base` da folha é o salário total do colaborador; a divisão é só no snapshot pra fins contábeis.

## UI

**Card do perfil / detalhe do colaborador:**
- 1 item com `usa_rateio_empresa = true` e sendo o único: visual idêntico ao atual (`Empresa · rateio padrão`, sem mostrar %).
- 1 item com regional específica: `Empresa · Regional X` (sem %).
- 2+ itens: lista com indentação, cada linha com %.

**Modal "Alterar":**
- Lista de empresas atuais, cada uma com: dropdown empresa + input `%` + toggle "usar rateio da empresa" / "escolher regionais".
- Quando "escolher regionais": sub-lista com dropdown regional + input `%`, botão `+ regional`.
- Botão `+ empresa` abaixo da lista.
- Rodapé: campo `data da mudança` + campo `motivo` + indicador "Soma: 100% / 85%" em vermelho/verde.
- Botão "Salvar" desabilitado enquanto soma != 100 em qualquer nível.
- Backward compat: pra quem tem só 1 empresa + rateio padrão, a UI abre com esse estado (toggle ligado, sem regionais) e salvar funciona igual.

## Fora de escopo

- Vigência por item/empresa (ex: California entra em 01/11 e Hitlab em 15/11). Opção B.1 descartada.
- Rateio proporcional de salário diferente por empresa. O salário é único por colaborador; as empresas rateiam o custo total.
- Migração destrutiva das colunas antigas de `colaboradores_alocacoes`. Fica numa tarefa opcional de cleanup pós-estabilização.
