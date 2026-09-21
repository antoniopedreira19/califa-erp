# 30 — Próximos passos e backlog vivo (módulo RH)

Documento de **backlog vivo** — atualizado a cada fechamento de rodada. Ordenado por valor prático × esforço, não pela lista original da descoberta.

Ver também:
- [`00-descoberta.md`](00-descoberta.md) — a descoberta original, com o roadmap conceitual dividido em fases futuras.
- [`20-folha-mensal.md`](20-folha-mensal.md) — spec e estado das rodadas da Folha Mensal.
- [`../../decisions/097-folha-mensal-em-duas-camadas.md`](../../decisions/097-folha-mensal-em-duas-camadas.md) — ADR das decisões arquiteturais.

## Estado atual (o que já funciona ponta a ponta)

- ✅ **Colaboradores**: cadastro, edição, inativação, alocação múltipla (com percentual), histórico salarial, timeline unificada.
- ✅ **Níveis de cargo**: CRUD como rota separada `/rh/colaboradores/niveis`.
- ✅ **Folha Mensal** (Rodadas 1, 2 e 3):
  - Geração idempotente por competência (snapshot da Camada 1).
  - Edição pelo RH (valor + alocação) enquanto está em `rascunho` ou `pendente_correcao`.
  - Envio pro financeiro.
  - Revisão pelo financeiro em aba **"Folhas de Pagamento"** dentro de `/financeiro/contas-a-pagar`.
  - Aprovação com edição opcional; ao aprovar, gera `contas_avulsas` rateadas por alocação **e** propaga edição pra Camada 1.
  - Reprovação com motivo obrigatório; volta linha pra RH em `pendente_correcao`.

## P0 — Próxima entrega: **Design & UX**

Decisões já travadas pelo usuário no fechamento de 2026-09-21. **Não replanejar — implementar direto.**

### D1. Listagem de folhas (`/rh/folhas`) — enxugar

Hoje a tabela mostra 5 colunas de status (rascunho/enviada/pendente/aprovada/paga). Isso é ruído — nesse nível o usuário só quer saber "em que ponto está a folha do mês".

**Novo layout da linha:**

| Competência | Colaboradores | Total (R$) | Status |
|---|---|---|---|
| Setembro/2026 | 22 | R$ 145.320,00 | Rascunho / Enviada / Concluída |

**Regra do status agregado** (derivado das linhas, sem coluna nova no banco):

```
concluída  = TODAS as linhas em `paga`
rascunho   = NENHUMA linha foi ainda enviada (todas em `rascunho`)
enviada    = qualquer outro estado (é o "em andamento")
```

`pendente_correcao` e `aprovada` continuam existindo no banco mas ficam agrupados como "enviada" nesta visão — a granularidade fina só aparece dentro da folha (D2).

### D2. Detalhe da folha (`/rh/folhas/[competencia]`) — cards de resumo + tabela mantendo status por linha

**Cards agregados no topo da página** (acima da tabela):

- **Total da folha** — `sum(salario_base)` das linhas
- **Colaboradores** — contagem total
- **Enviadas** — linhas em `enviada`
- **Pendências** — linhas em `pendente_correcao` (destaca em vermelho se > 0)
- **Aprovadas** — linhas em `aprovada`
- **Pagas** — linhas em `paga`

Sugestão de layout: grid de 4-6 cards pequenos + card principal grande do total.

**Tabela** continua por linha com badge de status por linha — a granularidade fina é aqui, não na listagem.

### D3. Cards de estado atual na lista de colaboradores (`/rh/colaboradores`)

**Row de cards no topo da página** (antes dos filtros):

- **Colaboradores ativos** — `count where status='ativo'`
- **Valor da folha atual** — `sum(salario_base)` das linhas de `folhas_pagamento` na competência do mês corrente. Se não gerou ainda, "—" com hint "Folha não gerada".
- **Admissões no mês** — `count where data_admissao between primeiro_dia e último_dia do mês corrente`
- **Demissões no mês** — `count where data_encerramento between primeiro_dia e último_dia do mês corrente`

Sugestão: 4 cards horizontais com número grande + label + comparativo opcional (ex: "3 admissões · +1 vs mês anterior").

### Notas de implementação

- **Status agregado é lógica de servidor** — computa via query única com `count(*) filter (where status = 'paga')` etc, ou lê todas as linhas e agrega em `Map`. Recomendação: aggregate query no SQL pra manter payload enxuto.
- **Não persistir status agregado** — é sempre derivado das linhas. Se persistir, precisa trigger de sincronização, complexidade desnecessária.
- **Divergência de vocabulário** — "concluída" na UI passa a significar o que o banco chama "todas em paga". Vale ADR curto explicando a divergência controlada.
- **Cards da `/rh/colaboradores`** — 4 queries agregadas em `Promise.all`, todas com `head:true, count:'exact'`. Zero embed pesado.

## P1 — Após D1/D2/D3, escolher

### 1. Import da planilha Excel atual

Destrava a Kika usar de verdade — hoje o quadro dela tem 50+ pessoas na planilha. Fluxo:
- Rota `/rh/colaboradores/importar` com upload
- Parser lê aba **Colaboradores** e cria N cadastros
- Warnings pra linhas com dados incompletos
- Idempotente por CPF/CNPJ (não duplica)

**Esforço:** 1 sessão. **Ganho:** povoar o sistema com dados reais.

### 2. Estorno de folha aprovada

Se financeiro aprovar por engano, hoje precisa SQL manual pra desfazer. Botão "Estornar aprovação":
- Deleta `contas_avulsas` geradas (pela FK `folha_id`)
- Reverte status da linha pra `enviada`
- Reverte propagação da Camada 1 (fecha as novas, reabre as antigas)

**Esforço:** 1 sessão. **Ganho:** confiança pra o financeiro aprovar sem medo.

### 3. Benefícios

Catálogo (Total Pass, SulAmérica Titular/Dep, Bradesco Ondo, Amil coparticipação) + vínculo colaborador↔benefício com valor. Ao gerar folha, cada benefício vira **linha de desconto** na linha do colaborador. Financeiro paga a operadora do plano numa avulsa separada.

**Esforço:** 2-3 sessões. **Ganho:** benefícios saem do cálculo mental da Kika.

### 4. Notificação de pendência

Hoje Kika só descobre reprovação abrindo a tela. Duas variantes:
- **Simples:** badge no card `Folhas de pagamento` do hub `/rh` mostrando quantas pendências existem no mês.
- **Completo:** e-mail via Resend (SMTP já configurado) toda vez que uma linha vira `pendente_correcao`.

## P2 — Fase futura

- **Férias** — período aquisitivo/concessivo, gozo, abono. Ao chegar competência, folha vem com "1/3 férias" sugerido.
- **Turnover / Rescisão** detalhada — fluxo dedicado com motivo, aviso, saldo, multa; linha de folha "Rescisão" com valores calculados.
- **Holerite PDF** — pós-pagamento, gera comprovante e opcionalmente envia por e-mail (o campo `email` já existe no colaborador).
- **Autoserviço do colaborador** — novo role `colaborador`; loga pra ver holerite + saldo de férias; pede férias com aprovação do RH.
- **Encargos CLT (INSS/FGTS/IRRF)** — só se decidir internalizar; alto risco de manutenção porque regras trabalhistas mudam anualmente.
- **NFs/Recibos por competência** para PJs — upload de anexos.
- **Dependentes** — modelo já pensado no MVP; entra junto com Benefícios (pra dependente de plano de saúde).

## Débitos técnicos conhecidos

- Warning pré-existente em `components/ui/multi-select.tsx` (`aria-controls,aria-expanded`) — não é da folha, mas aparece em toda checagem de lint.
- Backfill de "GERAL" das regionais — se novas empresas forem criadas no futuro, a regional "GERAL" precisa ser criada manualmente (não há trigger que faça sozinho). Documentado no ADR 097.
- Índice de decisões (`docs/decisions/README.md`) segue tendo linhas ausentes (091, 092) — não é responsabilidade do módulo RH, mas afetou o RH com colisão dupla de ADR (088 → 093 → 097).

## Regras invioláveis pra manter no módulo

Herdadas de `CLAUDE.md` e reforçadas ao longo das rodadas:

- **`docs/PERFORMANCE.md`** é obrigatório antes de qualquer mudança em `app/(app)/rh/**` ou `lib/supabase/**`.
- Cada tabela nova → RLS gate `is_tenant_admin(x) OR is_tenant_rh(x)` (ou `+ is_tenant_financeiro` no caso da folha).
- Cada migration nova → GRANT explícito para `authenticated` + índice em FK importante.
- Ortografia pt-BR completa em qualquer string visível ao usuário.
- Cada rodada nova encerra com: commit descritivo + linha no `HANDOFF.md` seção 2 (índice cronológico) + atualização deste `30-proximos-passos.md`.
