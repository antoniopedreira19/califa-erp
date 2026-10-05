# Subsistema Benefícios — Spec viva

> **Status**: **Fase 1 em modelagem** (2026-10-05). Descoberta fechada entre Antonio e o stakeholder interno (Daniel) a partir de 3 planilhas reais do RH (SulAmérica, Bradesco Dental, matriz mestra de colaboradores × benefícios) e a tabela de preços oficial da SulAmérica.
>
> **2 perguntas restam pendentes com o RH (Kika)** antes da Fase 2: política de 100% custeado e política do upgrade. Elas não bloqueiam a Fase 1, porque o modelo trata ambas como **acordo individual marcado no vínculo** (campo manual, não regra automática).
>
> Este documento é a fonte-verdade do subsistema — toda decisão nova entra aqui, não em commit ou chat.

## 1. Contexto

Hoje a California controla benefícios em **3 planilhas Excel paralelas**:

- **Fatura SulAmérica (mensal)** — snapshot da competência: para cada colaborador aderente, qual plano (Direto ou Especial), qual regime (CLT, PJ, Estagiário, Sócio), valor cheio, parte da California (60%), parte do colaborador (40%), valor de cada dependente (100% colaborador), total e desconto em folha. Rodapé agrega os totais da fatura mensal e lista separadamente os sócios + beneficiários externos.
- **Fatura Bradesco Dental (mensal)** — mesma estrutura, mais simples: R$ 13,00 flat por pessoa (titular + dependente), 100% colaborador.
- **Matriz mestra** — uma linha por colaborador ativo, dizendo em qual plano está (ou "Não Aderiu"), com data de início do benefício e observações pontuais.

A Kika (adm. financeira/RH) é a fonte-verdade do cálculo. Toda competência ela:
1. Recebe a fatura da SulAmérica e do Bradesco.
2. Reconfere colaborador por colaborador (idade mudou? dependente novo? saiu alguém?).
3. Monta a planilha mestra com os descontos finais.
4. Passa o total mensal pra folha, linha por colaborador.

O subsistema no ERP vai **substituir** essas 3 planilhas, não espelhá-las. Em Fase 1, substitui o cadastro + visualização do custo mensal calculado. Fase 2 fecha a competência (snapshot auditável). Fase 3 integra com a folha.

## 2. Objetivo da Fase 1

Modelar e cadastrar:
- **Catálogo** dos benefícios oferecidos (3 planos no MVP: SulAmérica Direto, SulAmérica Especial, Bradesco Dental), com tabela de preços por faixa etária quando aplicável.
- **Dependentes** do colaborador (nome, CPF, data de nascimento, parentesco).
- **Vínculo** colaborador ↔ benefício, incluindo em quais benefícios cada dependente está incluído.
- **Visualização** do custo mensal calculado por colaborador, aplicando corretamente idade na competência, modos de custeio e rateio empresa/colaborador.

Fase 1 **não** gera folha de benefícios, **não** emite relatório comparativo com a fatura real da operadora e **não** desconta nada na folha de pagamento. Esses são escopo das Fases 2 e 3.

## 3. Fora de escopo (Fase 1)

- **Fechamento mensal / snapshot** da competência → Fase 2.
- **Relatório comparativo** com a fatura real da SulAmérica/Bradesco → Fase 2.
- **Integração com folha de pagamento** (gerar linhas de desconto na folha CLT/PJ) → Fase 3.
- **Beneficiários externos** (pessoas na apólice da California que não são colaboradores, como Simone Reesink Gomes). **Decidido 2026-10-05**: fora do modelo. Continuam tratados por fora, como hoje.
- **Sócios** (pela mesma razão da Fase 1 de Férias — sócio não entra em folha). O catálogo de sócios da SulAmérica continua extra-sistema.
- **Vale-transporte, Vale-refeição, GymPass/TotalPass, seguro de vida**: fora do catálogo inicial. O modelo é extensível (ver §5.1), mas o MVP só carrega os 3 planos atuais.
- **Página do colaborador** ("Meus benefícios" dentro de `/perfil`): fica para Fase 1.5 ou junto da próxima evolução de perfil. Fase 1 é visão interna RH.

## 4. Vocabulário

### Dos planos
- **SulAmérica Direto Nacional (código 496505231)**: plano "entrada" oferecido pela California. 10 faixas etárias (0–18 a 59+). Rateio 60/40.
- **SulAmérica Especial 100 — Apartamento (código 495535238)**: plano "superior" com rede ampliada. 9 faixas etárias (19–23 a 59+). Rateio 60/40.
- **Bradesco Dental**: valor flat R$ 13,00 por pessoa (titular ou dependente). 100% desconto do colaborador.

### Da California (termos internos)
- **"Rateio"**: rateio padrão 60% California / 40% colaborador no titular. Dependente sempre 100% colaborador.
- **"Integral empresa"**: California cobre 100% do titular. Dependente continua 100% colaborador (quando houver). Modelo de acordo individual com certos CLTs juniores, estagiários e alguns PJs.
- **"Integral empresa com upgrade"**: California cobre o valor equivalente ao plano **Direto** na faixa do titular. Colaborador paga a **diferença** entre Especial e Direto na mesma faixa, mais 100% dos dependentes. Modelo de acordo individual.
- **"Beneficiário externo"**: pessoa que usa a apólice da California mas não é colaboradora. Paga 100% e reembolsa dia 5. **Fora do escopo deste subsistema.**

### Dos vínculos
- **Titular**: o colaborador que está no plano.
- **Dependente**: pessoa física (cônjuge, filho, mãe, pai, irmão, outro) incluída no plano pelo titular. Sempre descontada 100% do titular na folha.
- **Vínculo ativo**: linha de `colaborador_beneficio` com `data_fim IS NULL` ou futura.
- **Faixa etária**: intervalo de idade usado como chave na tabela de preços SulAmérica. Calculada no primeiro dia da competência a partir da data de nascimento (ver §5.5).

## 5. Regras de negócio

### 5.1 Catálogo

- Um benefício é definido no catálogo por: `nome`, `operadora`, `tipo` (`saude` ou `dental`), `modelo_preco` (`faixa_etaria` ou `flat`), `percentual_empresa_titular`, `percentual_colaborador_dependentes`, e opcionalmente `valor_flat` (quando `modelo_preco = 'flat'`) e `beneficio_base_id` (quando o benefício é um "upgrade" de outro — ver §5.4.3).
- A tabela de preços por faixa etária fica em tabela separada (`beneficio_faixas_preco`), uma linha por intervalo de idade. Última faixa aberta à direita (`idade_max IS NULL` significa "59 ou mais").
- Reajuste do Bradesco Dental = `UPDATE` em 1 coluna de 1 linha. Reajuste da SulAmérica = `UPDATE` em até 10 linhas da tabela de faixas. Nenhum reajuste exige migration.
- **Catálogo nasce com 3 linhas via seed na migration** (SulAmérica Direto, SulAmérica Especial, Bradesco Dental) + 19 linhas de faixas de preço (10 Direto + 9 Especial).

### 5.2 Vínculo colaborador × benefício

- Um colaborador pode ter N benefícios ativos simultaneamente (tipicamente SulAmérica + Dental, mas o modelo não limita).
- Cada vínculo tem `data_inicio` obrigatória e `data_fim` opcional (null = vigente).
- **Unique parcial**: no máximo 1 vínculo ativo por `(colaborador_id, beneficio_id)`. Mudança de modo de custeio = fechar o anterior (preencher `data_fim`) e abrir um novo.
- **Precondição**: o colaborador precisa ter `data_nascimento` e `cpf` preenchidos antes de criar vínculo. Verificação na UI (não trigger — menos ruído).

### 5.3 Dependentes

- Cadastro: `nome`, `cpf`, `data_nascimento`, `parentesco` — **todos obrigatórios**.
- `parentesco` é `text` livre no MVP (sem enum), com sugestões no UI dropdown: `conjuge, filho, filha, pai, mae, irmao, irma, outro`. Vira enum na Fase 2 se o uso real indicar necessidade.
- CPF é **unique por tenant** (um CPF só pode estar cadastrado uma vez; evita duplicata de dependente que trabalha também na California).
- `ativo` boolean + `data_inicio` / `data_fim` para histórico.
- **Dependente ≠ vínculo com benefício**: o dependente existe como pessoa (uma linha em `dependentes`). Em quais benefícios ele está incluído é controlado por `colaborador_beneficio_dependente` (ver §5.4). Isso permite: filho na SulAmérica mas não no Dental.

### 5.4 Modos de custeio

A regra do **titular** é definida pelo `modo_custeio` do vínculo. A regra dos **dependentes** é sempre `percentual_colaborador_dependentes` do catálogo (atualmente 100% em todos os planos do MVP). Dependente nunca é custeado pela empresa no modelo atual.

#### 5.4.1 `rateado` (default)
- Titular: empresa paga `percentual_empresa_titular`% (60 para SulAmérica, 0 para Dental). Colaborador paga o restante.
- Dependentes: colaborador paga 100% do valor da faixa de cada dependente.

#### 5.4.2 `integral_empresa`
- Titular: empresa paga 100%. Colaborador desconta R$ 0 na folha.
- Dependentes: colaborador paga 100% do valor da faixa de cada dependente (igual ao modo rateado).
- Marcado individualmente no vínculo (acordo manual). Não há regra automática por `tipo_contratacao` ou `nivel`.

#### 5.4.3 `integral_empresa_com_upgrade`
- **Requer** que o benefício do vínculo tenha `beneficio_base_id` preenchido (ex.: Especial aponta pra Direto).
- Titular: empresa paga o valor equivalente ao `beneficio_base_id` na mesma faixa etária. Colaborador paga a diferença (`valor_especial − valor_direto` na faixa).
- Dependentes: 100% colaborador.
- Marcado individualmente no vínculo.

> **Pergunta pendente pro RH** (não bloqueia Fase 1): existe regra formal pra 100% empresa (ex.: "todo estagiário") ou é 100% caso a caso? E a diferença Direto→Especial é política oferecida ativamente ou acordo pontual? **Resposta até agora**: assumimos acordo individual. Caso a Kika confirme regra, pode entrar como default sugerido na UI de cadastro (ex.: ao criar vínculo com colaborador de regime `estagio`, pré-selecionar `integral_empresa`). Isso é refinamento, não mudança de modelo.

### 5.5 Cálculo mensal (idade na competência)

- Toda consulta de custo mensal passa por `fn_beneficios_custo_mensal(p_ano, p_mes, p_colaborador_id)`.
- A idade do titular e de cada dependente é calculada no **primeiro dia da competência**: `AGE(DATE p_ano || '-' || p_mes || '-01', data_nascimento)`.
- A faixa etária é resolvida por `WHERE idade >= idade_min AND (idade_max IS NULL OR idade <= idade_max)`.
- A função retorna, por vínculo ativo na competência:
  - `beneficio_id`, nome do benefício
  - `idade_titular`, `valor_integral_titular`
  - `valor_empresa_titular`, `valor_colaborador_titular`
  - `valor_dependentes_total` (soma de todos os dependentes incluídos nesse benefício)
  - `valor_desconto_folha_total` (titular colaborador + dependentes)
- Vínculo é "ativo na competência" se `data_inicio <= último dia do mês` e (`data_fim IS NULL` ou `data_fim >= primeiro dia do mês`).

### 5.6 Casos especiais do snapshot atual

Encontrados na SulAmerica.csv da competência atual. Como são tratados na Fase 1:

| Caso | Como aparece na planilha | Como fica modelado |
|---|---|---|
| **Custeado pela California (CLT júnior, estagiário)** | "Valor California" = valor cheio, "Desconto folha" = R$ 0 | `modo_custeio = integral_empresa` |
| **Diferença Direto→Especial** (Mariana Lamarão, Thais Palhares) | Desconto = Especial − Direto na faixa | `modo_custeio = integral_empresa_com_upgrade`, benefício Especial com `beneficio_base_id` apontando pra Direto |
| **"Descontado em rescisão"** | Desconto R$ 0 no mês, cobra no acerto | Fora do escopo da Fase 1 (precisa de fluxo de rescisão). No MVP, o RH fecha o vínculo (`data_fim`) na data do desligamento. O cálculo de rescisão vem na Fase 2+ |
| **"1º boleto"** | Marca que é a primeira competência do colaborador | Deriva do `data_inicio` do vínculo. UI pode mostrar badge "Novo" na primeira competência |
| **"Mudou CNPJ"** | Observação no vínculo | Campo `observacao` text no vínculo |
| **"Desc. em dobro retroativo"** | Ajuste manual de competência passada | Fora do escopo da Fase 1. Fase 2 (fechamento mensal) suporta linha de ajuste |
| **Beneficiários externos** (Simone Reesink) | Regime "-", 100% reembolso | **Fora do modelo** (ver §3) |
| **Sócios** | Rodapé separado da fatura | **Fora do modelo** (ver §3) |

### 5.7 Precondições de dado nos colaboradores

Para um colaborador ser elegível a vínculo de benefício, precisa ter:
- `data_nascimento` preenchido (hoje, 210/210 ativos já têm — confirmado via MCP em 2026-10-05).
- `cpf` preenchido.

A UI de "Vincular benefício" verifica e bloqueia com mensagem clara. Não há trigger — o colaborador existir sem CPF é cenário válido fora de benefícios.

## 6. UI

### 6.1 Hub `/rh` — card novo

Card "Benefícios" aparece imediatamente após o card "Férias" no hub de RH. Visual idêntico aos demais cards (ícone + título + descrição curta + badge). Badge mostra número de vínculos ativos no tenant.

Ícone sugerido: `HeartHandshake` ou `ShieldPlus` (lucide-react). A definir no PR.

### 6.2 Página `/rh/beneficios`

Layout análogo a `/rh/ferias`:

**PageHeader com 4 KPIs:**
- Nº colaboradores com plano de saúde ativo
- Nº colaboradores com plano dental ativo
- Custo mensal **empresa** (soma de `valor_empresa_titular` da competência atual)
- Custo mensal **colaboradores** (soma de `valor_desconto_folha_total` da competência atual)

Todos os KPIs usam a competência corrente por default (seletor no header permite trocar).

**Tabs:**

**Tab "Colaboradores" (default):**
- Tabela: colaborador, planos ativos (chips), custo empresa, custo colaborador, status
- Filtros: busca por nome, filtro por benefício, filtro por modo de custeio
- Linha inteira clicável → abre drawer com:
  - Dados do colaborador (resumo)
  - Lista de vínculos ativos (plano, modo de custeio, data_início, obs)
  - Lista de dependentes cadastrados (cada um com flag "incluído em: SulAmérica, Dental")
  - Breakdown do cálculo da competência corrente
  - Botão "Adicionar dependente"
  - Botão "Vincular a benefício"
  - Botão "Encerrar vínculo" em cada linha ativa

**Tab "Catálogo":**
- Lista dos 3 benefícios cadastrados
- Click em cada um → drawer com os campos editáveis (percentuais, valor flat) + tabela de faixas de preço
- Botão "Novo benefício" (admin+rh) — permite adicionar vale-transporte, GymPass etc. no futuro, sem código novo
- Botão "Adicionar faixa" dentro da edição

### 6.3 Permissões

- **admin + rh**: tudo (CRUD de catálogo, vínculos, dependentes).
- **colaborador** logado: lê os próprios vínculos e os próprios dependentes (via `is_colaborador_proprio`). Escrita do colaborador fica para Fase 1.5 (quando `/perfil` ganhar aba de benefícios).
- **gerente_producao, financeiro, produtor, freelancer**: sem acesso.

Padrão idêntico ao de Férias.

## 7. Fases futuras

### Fase 2 — Fechamento mensal
- Snapshot auditável da competência (congela resultado da `fn_beneficios_custo_mensal`).
- Estados: "aberta" → "fechada".
- Linha de ajuste manual (retroativo, descontado em rescisão, 1º boleto).
- Relatório comparativo: snapshot do sistema vs. fatura real da operadora (upload de CSV).
- Esforço estimado: 2 sessões.

### Fase 3 — Integração com folha
- Snapshot fechado da Fase 2 vira input da folha mensal.
- Cada vínculo ativo gera uma linha de desconto na folha CLT/PJ do colaborador (via `folhas_pagamento` quando o motor da folha for implementado) **ou** uma conta avulsa classificada no subtipo "Benefícios 002" para a California pagar a operadora.
- Depende de o motor da folha estar implementado.
- Esforço estimado: 2 sessões após motor da folha pronto.

### Fase 1.5 — Vista do colaborador
- Aba "Meus benefícios" dentro de `/perfil`.
- Lê os próprios vínculos, dependentes e desconto mensal.
- Permite ao colaborador cadastrar/editar os próprios dependentes (com confirmação do RH antes de incluir em plano).
- Esforço estimado: 1 sessão.

## 8. Decisões travadas

Numeradas B1, B2, B3... (B de Benefícios), seguindo o padrão de F1–F15 de Férias.

- **B1** (2026-10-05) — **Fase 1 é visão interna RH, sem fechamento mensal nem integração com folha.** Visualização do custo calculado conforme regras, sem persistir snapshot. Confirmado por Daniel em sessão de brainstorm 2026-10-05.
- **B2** (2026-10-05) — **Catálogo inicial com 3 benefícios**: SulAmérica Direto Nacional (código 496505231), SulAmérica Especial 100 Apartamento (código 495535238), Bradesco Dental. Vale-transporte, GymPass e seguro de vida ficam fora do MVP.
- **B3** (2026-10-05) — **Flat vs faixa etária** são `modelo_preco` separados em `beneficios`. Valor flat em coluna da própria `beneficios` (`valor_flat`, nullable). Tabela de preço por faixa em `beneficio_faixas_preco` só para benefícios com `modelo_preco = 'faixa_etaria'`.
- **B4** (2026-10-05) — **Rateio empresa/colaborador vem do catálogo**, não hardcoded. Colunas `percentual_empresa_titular` (saúde=60, dental=0) e `percentual_colaborador_dependentes` (sempre 100). Enum `modo_custeio` só define a regra do titular.
- **B5** (2026-10-05) — **3 modos de custeio** do titular: `rateado`, `integral_empresa`, `integral_empresa_com_upgrade`. Todos marcados individualmente no vínculo (acordo manual), sem regra automática por `tipo_contratacao`.
- **B6** (2026-10-05) — **Link Especial → Direto via `beneficio_base_id`** em `beneficios`. Usado só quando `modo_custeio = 'integral_empresa_com_upgrade'`. Permite calcular a diferença.
- **B7** (2026-10-05) — **Idade calculada no primeiro dia da competência** (não data atual). Mesma lógica para titular e dependentes.
- **B8** (2026-10-05) — **Dependente é cadastro de pessoa** (`dependentes`), separado do vínculo com benefício (`colaborador_beneficio_dependente`). Permite dep na SulAmérica mas não no Dental.
- **B9** (2026-10-05) — **CPF do dependente é obrigatório e unique por tenant.**
- **B10** (2026-10-05) — **Beneficiários externos** (Simone Reesink e similares) ficam fora do modelo. Continuam tratados por fora, como hoje.
- **B11** (2026-10-05) — **Sócios ficam fora** do subsistema no MVP, pela mesma razão de Férias (sócio não entra em folha).
- **B12** (2026-10-05) — **RLS idêntica a Férias**: admin+rh escrevem tudo; colaborador lê o próprio via `is_colaborador_proprio`.
- **B13** (2026-10-05) — **Policies RLS usam `(select auth.uid())` e GRANT explícito para `authenticated`**, nada para `anon`. Padrão herdado de `docs/FLUXO-BANCO.md`.
- **B14** (2026-10-05) — **Auditoria**: criar vínculo, mudar modo de custeio, encerrar vínculo, criar dependente, incluir dependente em benefício → geram evento em `audit_events`. Mesmo padrão de Férias.
- **B15** (2026-10-05) — **Cálculo é derivado (função SQL), não snapshot**, na Fase 1. Fase 2 introduz snapshot.
- **B16** (2026-10-05) — **Vista do colaborador fica para Fase 1.5**, não entra na Fase 1. Fase 1 é interna RH.

## 9. Pendências não-bloqueantes

Perguntas abertas que **não impedem** a Fase 1, mas podem refinar comportamento futuro:

- **P1** — Resposta do RH (Kika) sobre política formal de 100% custeado (regra por regime/cargo vs. acordo caso a caso). Enquanto não vem, assumimos acordo individual (B5). Se virar regra formal, UI pode pré-selecionar `integral_empresa` no vínculo quando o regime bater.
- **P2** — Resposta do RH sobre política da diferença Direto→Especial (política ativa vs. acordo pontual). Hoje temos 2 casos (Mariana Lamarão, Thais Palhares). Resposta refina UX, não modelo.
- **P3** — Reconciliar `beneficios.csv` (matriz mestra) com `BradescoDental.csv`. A matriz está desatualizada para dental — vários aderentes aparecem como "Não Aderiu". O import inicial da Fase 1 usa `SulAmerica.csv` e `BradescoDental.csv` como fonte-verdade, ignorando o status da matriz para dental.
- **P4** — Enum `parentesco` em vez de `text` livre. Aguardar uso real para listar valores finais.
- **P5** — Beneficiários externos (Simone e eventuais outros) — se o RH quiser modelar no futuro, criar entidade `beneficiario_externo` separada do colaborador. Fora da Fase 1.

## 10. Precedentes e convenções

- **Padrão de subsistema RH**: Férias (ver [`25-ferias.md`](25-ferias.md), [`26-ferias-modelo-de-dados.md`](26-ferias-modelo-de-dados.md), [`27-ferias-plano-de-execucao.md`](27-ferias-plano-de-execucao.md)). Benefícios segue a mesma estrutura: visão → modelo de dados → plano de execução.
- **Fluxo de banco**: [`docs/FLUXO-BANCO.md`](../../FLUXO-BANCO.md). Nada aplicado sem migration versionada; MCP só para `apply_migration`, nunca criar pelo painel.
- **Performance**: [`docs/PERFORMANCE.md`](../../PERFORMANCE.md). Links em lista de 5+ itens com `prefetch={false}`; queries independentes com `Promise.all`; sem embed pesado em contagem.
- **Identidade visual**: [`docs/09-identidade-visual-ui.md`](../../09-identidade-visual-ui.md). PageHeader completo, KPIs em cards ricos (ícone + delta + shadow-soft), linha inteira clicável em listas.
- **Role `colaborador`**: já existe desde Férias. Não há role nova em Benefícios.
- **Helper `is_colaborador_proprio(uuid)`**: já existe desde Férias. Reutilizado nas policies de Benefícios.
