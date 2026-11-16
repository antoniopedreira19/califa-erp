# Vínculos de Colaborador — Spec viva

> **Status**: **Fase 1 em modelagem** (2026-11-16). Aprovado pelo Antonio após ata da reunião interna com o RH (16/11/2026). Resolve 5 casos imediatos de colaboradores que trocaram de modalidade (CLT → PJ) e cujo vínculo CLT foi formalmente encerrado + abre caminho pra futuro refactor de modelo. Nomes e datas específicas dos casos vivem na migration S4 e no handoff da sessão — fora do repo por PII.
>
> **Depende** de nada. **Bloqueia** nada crítico — módulo de férias já opera, a mudança só corrige contagem pros 5 casos citados.
>
> Este documento é a fonte-verdade do subsistema — toda decisão nova entra aqui, não em commit ou chat.

## 1. Contexto

O modelo atual assume que **1 colaborador = 1 vínculo pro resto da vida na empresa**. A coluna `colaboradores.tipo_contratacao` + `data_admissao` dizem o tipo atual e quando a pessoa entrou. A trigger `fn_gerar_ferias_periodos` usa a `data_admissao` como base pra gerar os aquisitivos de férias.

Isso quebra em **5 casos reais** no tenant Califa (nomes e datas específicas no handoff da sessão + migration S4, não aqui por PII):

- 4 colaboradores com virada CLT → PJ confirmados pela reunião do RH em 16/11/2026.
- 1 colaborador adicional a identificar (originalmente nomeado na ata foi descartado; o 5º real ainda será mapeado).

Nos 5 casos, o colaborador recebeu **verbas rescisórias da CLT** (incluindo férias proporcionais) e começou um novo vínculo. O sistema continua contando aquisitivos de férias desde a admissão CLT original — o que gera:
- Aquisitivos pré-virada que **já foram pagos na rescisão**, aparecendo como pendentes.
- Data de vencimento de concessivo calculada errado (parte da admissão antiga, não da virada).
- Base de salário errada pro cálculo de férias (usa a última salário cadastrada, mas sem vincular ao tipo de contratação correto no momento).

A planilha "Data de Admissão" da Controle e Planejamento de Férias já lida com isso manualmente: o RH mantém a data "real" de contagem de férias nessa aba.

## 2. Objetivo da Fase 1

Modelar a estrutura `colaborador_vinculos` e **destravar os 5 casos de virada** com o mínimo de impacto no resto do sistema.

Entregáveis:

1. Tabela nova `colaborador_vinculos` com o histórico de vínculos trabalhistas de cada colaborador.
2. Migration de backfill: todo colaborador ativo ganha **1 vínculo ativo** correspondente ao estado atual (`tipo_contratacao` + `data_admissao` vigentes).
3. Pros 5 casos de virada: migration manual cria **2 vínculos** (1 antigo encerrado + 1 novo ativo com a data da virada).
4. Trigger `fn_gerar_ferias_periodos` ajustada pra usar `vinculo_ativo.data_inicio` em vez de `colaborador.data_admissao`.
5. Aquisitivos de vínculos **encerrados** ficam marcados como `pago_rescisao` (status que já existe no enum de períodos). Lançamentos antigos preservados.
6. `colaboradores.tipo_contratacao` e `colaboradores.data_admissao` **continuam existindo e sincronizados** com o vínculo ativo via trigger. Zero query da aplicação precisa ser migrada na Fase 1.

## 3. Fora de escopo (Fase 1)

- **UI de gestão de vínculos**. Pros 5 casos iniciais, intervenção é via migration SQL. RH ainda não consegue encerrar/criar vínculo pela interface. **Entra na Fase 2.**
- **Migração das queries da aplicação** pra ler `vinculo_ativo.tipo_contratacao` em vez de `colaboradores.tipo_contratacao`. **Entra na Fase 3**, se e quando quiser. Hoje nada depende disso porque mantemos a coluna sincronizada.
- **Histórico salarial por vínculo**. Hoje `colaboradores_salarios` tem N salários por colaborador independentes de vínculo. Continua assim. Relatórios "quanto Marisa ganhava como CLT vs PJ" vão ter que inferir pelas datas. **Fora do refactor atual.**
- **Unificação com `freelancer_contratos`**. Modelo paralelo em `/freelancers` continua separado. Dívida arquitetural reconhecida. Próximo refactor quando/se quiser unificar.
- **Reingresso formal** (saiu e voltou). O modelo **suporta** (vínculo 1 encerrado + vínculo 2 ativo no mesmo colaborador), mas UI não tem botão. Até Fase 2, trata via SQL.
- **Promoção interna sem rescisão** (ex: CLT júnior → CLT pleno com upgrade de salário). Não é "mudança de vínculo" — modelo atual de salário cobre.
- **Mudança retroativa de data_admissao**. A trigger continua regenerando aquisitivos se `data_admissao` mudar — comportamento inalterado. O refactor **adiciona** a opção de ter vínculo com data diferente, não substitui.

## 4. Vocabulário

- **Colaborador** (`colaboradores`): a pessoa física cadastrada. CPF, dados pessoais, foto, user_id de login. **Uma pessoa = um colaborador**, independente de quantas vezes passou por rescisão/novo contrato.
- **Vínculo** (`colaborador_vinculos`): o contrato de trabalho específico. Tem tipo (CLT, PJ, CLT+Recibo, Estágio, ART, Sócio), data de início, data de fim opcional, motivo de encerramento opcional. Um colaborador pode ter **N vínculos ao longo do tempo**.
- **Vínculo ativo**: o vínculo com `data_fim IS NULL`. Só 1 por colaborador por vez (unique parcial).
- **Vínculo encerrado**: `data_fim` preenchida. Representa um contrato passado.
- **Virada de modalidade**: encerramento do vínculo atual + criação de vínculo novo. Ex: colaborador CLT (18/04/24 → 18/12/24) + mesmo colaborador PJ (19/12/24 → vigente).
- **Data base de contagem de férias**: `vinculo_ativo.data_inicio`. É o que a trigger `fn_gerar_ferias_periodos` usa pra gerar aquisitivos. Antes era `colaborador.data_admissao`.
- **Admissão original**: `colaborador.data_admissao`. Continua sendo a primeira data em que a pessoa entrou na empresa. Preservada por histórico. Usada em KPI tipo "tempo total de casa" no futuro.

## 5. Regras de negócio

### 5.1 Vínculo

- `data_inicio` obrigatória. `data_fim` opcional (null = vigente).
- `tipo_contratacao` obrigatório, mesmo enum de `colaboradores.tipo_contratacao`.
- `motivo_encerramento` opcional. Enum sugerido (não bloqueia Fase 1):
  - `rescisao_clt_para_novo_vinculo` — típico das 5 viradas: CLT encerrado pra começar PJ.
  - `demissao` — colaborador foi demitido.
  - `pedido_demissao` — colaborador pediu demissão.
  - `fim_de_contrato` — ex: estágio terminou.
  - `outro`.
- `vinculo_anterior_id` opcional (FK auto-referencial pro vínculo que originou este). Usado pra rastrear a sequência de uma virada (ex: PJ atual aponta pro CLT anterior encerrado).
- **Unique parcial**: no máximo 1 vínculo ativo por `(colaborador_id)` onde `data_fim IS NULL`.
- **Overlap check**: trigger impede 2 vínculos com datas sobrepostas pro mesmo colaborador.

### 5.2 Trigger de férias

Até agora a trigger `fn_gerar_ferias_periodos` dispara em `INSERT` e `UPDATE` de `colaboradores` e gera os aquisitivos a partir de `data_admissao`.

Nova regra:
- Dispara em `INSERT` e `UPDATE` de `colaborador_vinculos` **também**.
- Ao gerar aquisitivos, usa `vinculo_ativo.data_inicio` como base.
- Se `data_admissao` muda em `colaboradores`, só dispara regeneração **se não há vínculo ativo diferente** (compat com comportamento antigo).
- Aquisitivos pertencentes a **vínculos encerrados** (identificados pelo `aquisitivo_inicio` anterior ao `vinculo_atual.data_inicio`) ficam marcados como `pago_rescisao`. Não são apagados — preservam histórico de lançamentos.

### 5.3 Sincronização com `colaboradores`

- `colaboradores.tipo_contratacao` e `colaboradores.data_admissao` **continuam existindo** (não removemos colunas).
- `colaboradores.tipo_contratacao` sincroniza com `vinculo_ativo.tipo_contratacao` via trigger. Toda query atual que lê `c.tipo_contratacao` continua funcionando.
- `colaboradores.data_admissao` **não sincroniza** — permanece sendo a admissão original. Isso é intencional — evita perder a info histórica.
- Fase 3 (futura) migra queries pra ler direto do vínculo e aposentar a coluna de `colaboradores`.

### 5.4 Edição manual na Fase 1

- Pros 5 casos iniciais: migration SQL cria os vínculos encerrado + ativo.
- Pra qualquer nova virada que aconteça **antes da Fase 2**, continua sendo via SQL direto (o modelo já suporta, só não tem botão).
- **Documentar no handoff** quando acontecer, pra manter rastro.

## 6. Decisões travadas (Fase 1)

**D1 — Admissão original fica em `colaboradores.data_admissao`.** Não migra pra vínculo. Preservar valor histórico é mais útil do que forçar single-source-of-truth agora.

**D2 — `colaboradores.tipo_contratacao` continua existindo, sincronizado via trigger.** Evita refactor massivo das queries na Fase 1. Aposentar a coluna é escopo da Fase 3.

**D3 — Aquisitivos de vínculo encerrado viram `pago_rescisao`, não são apagados.** Preserva lançamentos antigos (histórico de férias gozadas). Enum `ferias_periodo_status` já tem esse valor.

**D4 — Backfill cria 1 vínculo ativo por colaborador** usando os valores atuais. Pros 5 casos de virada, migration manual adiciona o vínculo encerrado antes do ativo.

**D5 — Sem UI na Fase 1.** Intervenção via SQL. UI entra na Fase 2.

**D6 — Modelo não inclui histórico salarial por vínculo.** `colaboradores_salarios` continua como está. Reavaliar se virar problema real de relatório.

## 7. Pendências

- **P1 — Confirmar os 5 casos** (nomes + datas no handoff da sessão, não aqui). Necessário antes de rodar a migration manual.
- **P2 — Datas exatas dos confirmados**: cross-check com a planilha "Data de Admissão" da Controle e Planejamento 2026.
- **P3 — O que acontece com `data_encerramento` de colaboradores ativos.** Hoje `data_encerramento IS NULL` + `status='ativo'`. Após a Fase 1, se um dia a pessoa for desligada, o vínculo ativo deve ser encerrado mas `data_encerramento` em `colaboradores` também? Alinhamento com RH.

## 8. Próximas fases

### Fase 2 — UI de gestão de vínculos

- Card "Vínculos" na página `/rh/colaboradores/[id]` e `/rh/ferias/[id]` com histórico cronológico (vínculo atual + encerrados).
- Action "Encerrar vínculo atual e criar novo" com motivo + data da mudança. Interface tradutora pra o SQL.
- Action "Reingresso" (colaborador antigo voltando) — opcional, pode ficar pra Fase 2.5.
- Validação de overlap de datas na UI (feedback imediato) além da constraint no banco.

### Fase 3 — Migração completa das queries

- Todas as queries que hoje leem `c.tipo_contratacao` migram pra `vinculo_ativo.tipo_contratacao` via JOIN ou view.
- Impacto: `folhas_pagamento` (gerar folha), `colaboradores_alocacoes`, `colaboradores_beneficio`, `decimo_terceiro`, DRE views.
- Aposenta a coluna `colaboradores.tipo_contratacao`.
- Risco maior — testar tudo que depende de "o colaborador X é CLT/PJ hoje".

### Fase 4 (opcional) — Unificação com `freelancer_contratos`

- Freelancer e colaborador viram variações do mesmo modelo "pessoa + N vínculos de trabalho".
- Não planejada. Decisão se vier escalada de volume (>5 freelancers viram colaborador por ano, ou vice-versa).

## 9. Referências

- Modelo detalhado: [71-vinculos-colaborador-modelo-de-dados.md](71-vinculos-colaborador-modelo-de-dados.md)
- Plano de execução: [72-vinculos-colaborador-plano-de-execucao.md](72-vinculos-colaborador-plano-de-execucao.md)
- Fluxo de férias relacionado: [41-ferias-fluxo-solicitacao.md](41-ferias-fluxo-solicitacao.md)
- Import histórico que gerou os aquisitivos atuais: [40-historico-ferias-importado.md](40-historico-ferias-importado.md)
