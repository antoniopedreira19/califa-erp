# Import histórico de férias — nota operacional

> **Status**: Executado em 2026-10-02. Esta nota documenta o que foi importado, como, e o que ficou pendente de revisão humana. Serve pra RH e dev entenderem o estado inicial do subsistema de férias.

## 1. Contexto

O subsistema de férias nasceu em 2026-10-02 com 1031 períodos aquisitivos gerados automaticamente pela trigger `fn_gerar_ferias_periodos` (desde a admissão de cada colaborador até hoje + 2 anos). Problema: a trigger não sabia o que **já tinha sido gozado** pelos colaboradores antigos — todos apareciam como "tudo em aberto, vencido há N anos".

A planilha `tmp/historico_real_ferias.xlsx` (fonte-verdade do RH até então) tinha o histórico real: quantos dias cada colaborador já tirou em cada período. Precisava trazer isso pro banco pra o Quadro refletir a realidade.

## 2. O que foi importado

- **279 lançamentos** inseridos em `colaboradores_ferias_lancamentos`, cada um:
  - `status = 'aprovado'`
  - `tipo = 'usufruto'`
  - `lancado_direto_por_rh = true`
  - `observacao = 'Importação histórica consolidada (xlsx) — data fictícia no meio do concessivo'`
- **203 colaboradores afetados** (194 match exato de nome + 9 aproximados: typos "Oliverira", espaços duplos, apelidos "Deco"/"Kika", "De" vs "de" em capitalização).

Cobertura: 203 de 210 ativos (os 7 restantes são sócios ou colaboradores novos sem histórico — ver §4).

## 3. Como as datas foram construídas (Opção A)

Como a planilha só traz "N dias gozados no período X" (não traz data), o import precisou **fabricar** data_inicio e data_fim pros lançamentos. Alternativas consideradas em 2026-10-02:

| Opção | Fórmula | Rejeitada porque |
|---|---|---|
| Data atual | `today` | Lançamentos passados "no futuro" na timeline — confuso |
| 1º dia do concessivo | `concessivo_inicio` | Todos colidem em `aquisitivo_fim + 1 day` — gera histogramas falsos |
| 1º dia do aquisitivo | `aquisitivo_inicio` | Fora da janela válida de gozo |
| **Meio do concessivo (Opção A)** | **`concessivo_inicio + 183 dias`** | **Escolhida** |

Fórmula final:
```sql
data_inicio = (concessivo_inicio + interval '183 days')::date
data_fim    = (data_inicio + (dias - 1) * interval '1 day')::date
```

Isso coloca a maioria dos lançamentos antigos **dentro do concessivo** (sem violar `fn_valida_saldo_periodo`) e sem concentrar todos num mesmo dia. É data fictícia, mas internamente consistente.

## 4. Casos de borda tratados

### 4.1. Dupla contagem no mesmo período (regra CLT 30 + 15)

A planilha tinha 2 colaboradores (Italo Teles, Janaína Silva) com **2 linhas** no mesmo período aquisitivo somando 45d (30d bloco principal + 15d fracionado). A trigger `fn_valida_saldo_periodo` bloqueava: "Saldo insuficiente: 45 > 30 de direito".

**Solução**: o script `tmp/hist-passo3-gerar-sql.mjs` consolidou essas duplicatas em **1 lançamento único por período com `min(soma, 30)` dias** (cap em 30 pela regra do saldo máximo).

**Perda controlada**: 15 dias "ficaram de fora" nesses casos. Se o RH identificar que o colaborador de fato tirou os 45 dias, lançar manualmente os 15d faltantes depois (período deverá ter saldo zerado após o import, impedindo novo lançamento sem reavaliar).

### 4.2. Nomes aproximados

9 colaboradores precisaram de match aproximado (nome não bateu literalmente):

- Álezis Mateus Gomes Miranda (banco) vs "Alezis Mateus" (planilha, sem acento)
- Marcos Correia dos Santos Júnior vs "Marcos Correira dos Santos Jr" (typo + abreviação)
- 7 outros com espaço duplo, acento diferente ou apelido entre parênteses

Confirmados manualmente antes do import. Nenhum match ambíguo (todos tinham 1 candidato óbvio).

### 4.3. Sócios excluídos

Antes do import, migration `20261002000012_ferias_exclui_socios.sql` dropou os 63 períodos dos 3 sócios ativos (Bruno Duarte Leite, Fabio Duarte Leite, Rafael Ferreira de Almeida). Eles não aparecem na planilha e não têm direito a férias — ficar com períodos "vencidos há 20 anos" era ruído puro no Quadro.

### 4.4. 11 nomes "ativos" sem match no banco

Parkeados em `tmp/hist-sem-match.txt`. Hipóteses:
- Desligados antigos que a planilha nunca atualizou.
- Admissões não cadastradas no sistema.
- Variação muito grande de nome (não casou nem no match aproximado).

**Pendência do RH**: revisar caso a caso e decidir se cada um é um colaborador faltante no cadastro, um desligado a arquivar, ou uma falha de nome a corrigir.

## 5. Vencidos legítimos pós-import

Depois do import, o Quadro mostrou **20 períodos vencidos legítimos** (fora os 63 de sócios, que foram eliminados). Esses são pessoas que **de fato** não gozaram certos períodos até o `data_limite_gozo`.

Os críticos (>1,5 ano vencido):

- **Philipe de Sousa Silverio do Amaral Carneiro** (PJ, admissão 2020-04-01): **4 períodos vencidos** (2020/21, 2021/22, 2022/23, 2023/24). Planilha só mostra 2024/25:30d gozado. Vencido há até **~4,5 anos**.
- **João Victor Caetano Sousa** (PJ, admissão 2022-03-01): 2023/24 vencido há 611 dias.

Antigos (6-18 meses):
- Bernardo Von Flach Guerreiro, Felipe Berber, João Victor Caetano (2024/25), Mina Santana — vencidos entre 195d e 268d.

Recentes (<6 meses, provável negociação em andamento):
- Cristiana (Kika), Erica, Natalia, Matthias (todos CLT/recibo com 2024/25 vencido 63-136d), além de Luana, Sofia Frutuoso, Munira, Thiago Montiani, Wallace, George Lopes, Julia Simas.

### Implicação de negócio

- **CLT** (Cristiana, Erica, Natalia, Matthias): legalmente a California deve férias em dobro + 1/3 desses períodos (passivo trabalhista).
- **PJ**: não há dobra legal, mas é passivo contratual se o contrato previa férias remuneradas.

RH precisa decidir caso a caso: negociar gozo retroativo, pagar em dobro, ou marcar como exceção. O sistema **não automatiza nada disso** — apenas sinaliza o estado real.

## 6. Scripts e artefatos do processo

Fora do repo (em `tmp/`), preservados pra referência:

- `tmp/hist-passo1-casamento.mjs` — casa nomes planilha↔banco, gera 3 arquivos de revisão humana.
- `tmp/hist-passo3-gerar-sql.mjs` — a partir do JSON de matches, gera o SQL `INSERT` dos lançamentos.
- `tmp/hist-matches-confirmados.json` — 203 pares planilha↔banco persistidos.
- `tmp/hist-sem-match.txt` — 11 "ativos" da planilha sem match no banco (pendência RH).
- `tmp/hist-passo3-import.sql` — SQL completo aplicado, idempotente (`WHERE NOT EXISTS` evita duplicar).

## 7. Como refazer (se precisar)

Se o import precisar ser reaplicado (ex: nova planilha corrigida):

1. **Backup**: `select * from colaboradores_ferias_lancamentos where lancado_direto_por_rh = true and observacao like 'Importação histórica%'` → anotar quantas linhas são.
2. **Reverter**: `delete` dessas mesmas linhas. CUIDADO: só apagar as com a observação exata — lançamentos reais do RH têm `lancado_direto_por_rh = true` também.
3. **Reajustar `tmp/_banco-ativos.mjs`** se o quadro mudou (`SELECT id, nome, data_admissao, tipo_contratacao FROM colaboradores WHERE status = 'ativo'`).
4. **Rodar passo 1**: `node tmp/hist-passo1-casamento.mjs`. Revisar os 3 .txt gerados.
5. **Ajustar `MATCHES_MANUAIS`** no script se tiver novos typos óbvios.
6. **Rodar passo 3**: `node tmp/hist-passo3-gerar-sql.mjs`.
7. **Aplicar o SQL** via MCP `execute_sql`.
8. **Recalcular status**: `SELECT fn_recalcular_status_periodo(id) FROM colaboradores_ferias_periodos WHERE colaborador_id IN (...)`.
9. **Validar no Quadro** que os vencidos caem.

## 8. Métricas finais

| Métrica | Valor |
|---|---|
| Colaboradores ativos no banco (não-sócios) | 207 |
| Nomes "Ativo" na planilha | 214 |
| Match exato (nome idêntico) | 194 |
| Match aproximado (typos/apelido/acento) | 9 |
| Sem match na planilha → banco (desligados/novos) | 7 |
| Sem match no banco → planilha (pendência RH) | 11 |
| **Lançamentos importados** | **279** |
| Períodos com lançamento consolidado | 262 (17 colaboradores com 2 períodos cada) |
| Vencidos legítimos pós-import | 20 |
| Vencidos de sócios eliminados pela migration | 63 |
| **Redução total de "falsos vencidos" no Quadro** | **~90%** (de 265 pra 20) |
