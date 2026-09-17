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
