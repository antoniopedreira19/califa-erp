# Módulo RH — Índice

Documentação do módulo de Recursos Humanos do ERP California.

Este é o **mapa vivo** do módulo. Todo documento novo entra aqui, na ordem em que faz sentido para leitura sequencial (descoberta → visão → modelo → fluxos → decisões).

## Como este módulo se organiza

O RH da California é hoje uma planilha Excel com múltiplas abas (Colaboradores, Férias, Movimentação Salarial, Turnover, Benefícios, Folha). O módulo do ERP vai substituir essa planilha em ciclos pequenos, **um subsistema por vez**, e ao final se conectar ao motor de contas a pagar já existente (via `contas_avulsas`).

## Documentos

### Fase 1 — Descoberta (Rodada 1 fechada)
- [`00-descoberta.md`](00-descoberta.md) — retrato do RH atual + achados do banco via MCP + decisões travadas da Rodada 1 (§6) + questões de processo abertas para rodadas futuras (§8 Q6–Q16)

### Fase 2 — Visão e escopo (fechada para o MVP)
- [`01-visao-geral.md`](01-visao-geral.md) — objetivo do módulo, escopo do MVP, fora de escopo, permissões, critérios de aceite

### Fase 3 — Modelagem (fechada para o MVP)
- [`03-modelo-de-dados.md`](03-modelo-de-dados.md) — tabelas, enums, constraints, RLS, GRANTs, ordem sugerida de migration

### Subsistema Folha Mensal (Rodadas 1, 2 e 3 entregues em 2026-09-18)
- [`20-folha-mensal.md`](20-folha-mensal.md) — geração da folha mensal, revisão pelo RH, envio, aprovação/reprovação pelo financeiro, propagação para Camada 1. Rodadas 3 e 4 fundidas: aprovar já gera títulos em Contas a Pagar (via `contas_avulsas`).

### Subsistema Férias (descoberta fechada 2026-10-01, modelagem fechada 2026-10-01, implementação pendente)
- [`25-ferias.md`](25-ferias.md) — spec viva do ciclo completo de férias (CLT + PJ), inclui role `colaborador` nova, autoserviço em `/perfil`, aprovação pelo RH, recibo PJ, rescisão, notificações granulares. Decisões travadas em §14; pendências não-bloqueantes em §12.
- [`26-ferias-modelo-de-dados.md`](26-ferias-modelo-de-dados.md) — modelagem detalhada: 3 tabelas (`_periodos`, `_lancamentos`, `_notificacoes`), 4 enums novos, role `colaborador`, RLS por `is_colaborador_proprio`, triggers de geração automática de períodos e validação de saldo, função `fn_calcular_meses_rescisao` (regra dos avós), ordem de migration em 6 passos.
- [`27-ferias-plano-de-execucao.md`](27-ferias-plano-de-execucao.md) — plano de execução em 8 sessões (banco → autoserviço → painel RH → recibo PJ → rescisão + cron + import), com entregáveis, verificações, checkpoints de validação humana (CP1–CP5), riscos e métricas de sucesso.
- [`40-historico-ferias-importado.md`](40-historico-ferias-importado.md) — nota operacional do import de 2026-10-02 (279 lançamentos consolidados em 203 colaboradores, datas fictícias no meio do concessivo, dedupe de 2 casos CLT 30+15, vencidos legítimos pós-import).
- [`41-ferias-fluxo-solicitacao.md`](41-ferias-fluxo-solicitacao.md) — **fluxo end-to-end da solicitação** (5 etapas: pendente → aprovado → NF anexada → enviado financeiro → concluído), modelo de dados, filtros dos painéis (por que só solicitação aparece), casos especiais (import, folha mensal, híbrido, sócio), gaps conhecidos. **Leia antes de mexer no subsistema.**

### Subsistema Vínculos de Colaborador (Fase 1 em modelagem — 2026-11-16)
- [`70-vinculos-colaborador.md`](70-vinculos-colaborador.md) — spec viva. Resolve a classe de problemas "colaborador trocou de modalidade e a contagem de férias continuou da admissão original". 5 casos reais identificados pela reunião do RH de 16/11/2026 (nomes no handoff). Decisões travadas em §6; pendências em §7. Define Fases 1 (fundação + 5 casos), 2 (UI de gestão) e 3 (migração das queries).
- [`71-vinculos-colaborador-modelo-de-dados.md`](71-vinculos-colaborador-modelo-de-dados.md) — modelagem detalhada: tabela `colaborador_vinculos`, enum `vinculo_motivo_encerramento`, função helper `fn_data_base_ferias`, triggers de sincronização e regeneração, ordem de migration (5 arquivos), tipos TS, audit, impacto em views (nenhum na Fase 1).
- [`72-vinculos-colaborador-plano-de-execucao.md`](72-vinculos-colaborador-plano-de-execucao.md) — plano Fase 1 em 4 sessões (S1 fundação → S4 5 casos), checkpoints CP1–CP4, timeline estimada ~6h. Fases 2 e 3 listadas como roadmap.

### Subsistema Benefícios (Fase 1 implementada — 2026-10-05; Fases 2 e 3 planejadas — ADR 174)
- [`50-beneficios.md`](50-beneficios.md) — spec viva do subsistema de benefícios (SulAmérica Direto, SulAmérica Especial, Bradesco Dental). Fase 1 cobre catálogo + dependentes + vínculos + visualização do custo mensal (sem fechamento mensal nem integração com folha). Decisões travadas em §8 (B1–B16); pendências não-bloqueantes em §9. **§7 atualizado em 2026-10-14 com arquitetura das Fases 2, 3 e 4** (consolidada em ADR 174).
- [`51-beneficios-modelo-de-dados.md`](51-beneficios-modelo-de-dados.md) — modelagem detalhada: 5 tabelas (`beneficios`, `beneficio_faixas_preco`, `dependentes`, `colaborador_beneficio`, `colaborador_beneficio_dependente`), 3 enums novos, policies RLS idênticas a Férias, função `fn_beneficios_custo_mensal` com idade na competência e modos de custeio, seed inicial do catálogo (3 planos + 19 faixas), ordem de migration em 12 passos.
- [`52-beneficios-plano-de-execucao.md`](52-beneficios-plano-de-execucao.md) — plano em 5 sessões (S1 banco → S5 catálogo), checkpoints de validação, Review Focus com 5 pontos pinados, métricas de sucesso. **Implementado 2026-10-05 na branch `feat/beneficios-fase-1`**: 3 migrations aplicadas, rota `/rh/beneficios` com KPIs, tab Colaboradores com busca/filtros/drawer completo (vínculos + dependentes + breakdown), tab Catálogo com CRUD de benefícios e faixas de preço.
- [`../../decisions/174-beneficios-integracao-folha-e-dre.md`](../../decisions/174-beneficios-integracao-folha-e-dre.md) — **ADR 174** (2026-10-14): decisão arquitetural das Fases 2 (fechamento mensal), 3 (botão "Aplicar descontos" na folha) e 4 (integração com DRE via view `vw_dre_despesa_pessoal_ajustada_mensal`). Fonte-verdade; `50-beneficios.md §7` resume.
- [`53-beneficios-fechamento-mensal.md`](53-beneficios-fechamento-mensal.md) — **spec da Fase 2** (fechado 2026-10-14, aguarda implementação). 2 tabelas (`beneficio_fechamento_mensal`, `beneficio_fechamento_linha`), 2 colunas em `beneficios` (dia/mês de vencimento), view `vw_dre_despesa_pessoal_ajustada_mensal`, função `fn_beneficios_calcular_fechamento`. **Zero UI** nesta fase — tab "Fechamentos" entra junto com a Fase 3.
- `54-beneficios-integracao-folha.md` — a criar no início da Fase 3. Spec detalhado do botão "Aplicar descontos" na página da competência da folha.

### Backlog vivo (atualizado a cada fechamento de rodada)
- [`30-proximos-passos.md`](30-proximos-passos.md) — estado atual + P0 (**Design & UX**, decisões já travadas) + P1 (import, estorno, benefícios, notificação) + P2 (férias, turnover, holerite PDF, autoserviço, encargos CLT).

### Fase 4 — Fluxos e regras (a fazer, fase 2+)
- `04-fluxos-operacionais.md` — cadastro, benefícios, folha mensal, rescisão
- `05-regras-de-negocio.md` — regras invioláveis (CLT vs PJ, encargos, coparticipação, etc.)

### Fase 5 — Integrações (a fazer, fase 2+)
- `06-integracao-financeiro.md` — como a folha aprovada vira lote de `contas_avulsas` e entra na Tela 3.2

### Fase 6 — Decisões e critérios (a fazer)
- `07-decisoes.md` — decision log (ADRs específicos do módulo)
- `08-criterios-de-aceite.md` — Done When por subsistema

## Estado atual

- **Fase 1 (descoberta)**: Rodada 1 fechada. Q1, Q2, Q3, Q4, Q5 respondidas. Q6–Q16 (processos) ficam para quando cada subsistema (benefícios, férias, folha) entrar em fase própria.
- **Fase 2 (visão)**: fechada para o MVP. Escopo definido: cadastro + alocação múltipla histórica + salário histórico + níveis + esqueleto de folha.
- **Fase 3 (modelagem)**: fechada para o MVP. Tabelas, enums, constraints e ordem de migration especificados em `03-modelo-de-dados.md`.
- **Nada implementado no código ainda.** Nenhuma migration aplicada. Próximo passo é escrever a primeira migration seguindo `03-modelo-de-dados.md` e o ciclo do `docs/FLUXO-BANCO.md`.

## Regras deste módulo

- **Não implementar nada sem descoberta fechada.** Antes de qualquer migration de RH, este índice precisa listar `01-visao-geral.md` e `03-modelo-de-dados.md` aprovados.
- **Nada de tabela grande única.** Um subsistema = uma migration. Colaboradores primeiro; movimentação salarial depois; benefícios depois; folha por último.
- **Toda mudança de estado sensível (contratação, demissão, mudança de salário) gera auditoria.** Salário é dado que a LGPD protege.
- **Integração com contas a pagar reusa `contas_avulsas`.** Não criar tabela nova de "folha a pagar" — folha aprovada gera avulsas em lote.
