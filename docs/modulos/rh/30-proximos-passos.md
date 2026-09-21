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
- ✅ **Design & UX P0 (entregue em 2026-09-22)** — D1/D2/D3 + Rodada 2 (visual polish):
  - Listagem `/rh/folhas` enxuta com status agregado (rascunho/enviada/concluída) + 4 KPIs no topo (folha do mês, acumulado anual, em andamento, pendências).
  - Detalhe `/rh/folhas/[competencia]` com 4 cards balanceados (Total com delta vs mês anterior, Colaboradores com delta, Pendências, Progresso do fluxo com barra empilhada) + tabs de status + filtro de regional.
  - `/rh/colaboradores` com 4 cards (Ativos, Folha do mês, Admissões, Demissões) — todos com delta vs mês anterior.
  - Handoff: [`2026-09-22-rh-design-ux-folha-e-colaboradores.md`](../../handoffs/2026-09-22-rh-design-ux-folha-e-colaboradores.md).
- ✅ **Colaborador ganhou dados bancários próprios (2026-09-21, via pgto-remessa)**:
  - 9 colunas em `colaboradores` (banco_codigo, banco_nome, agencia, agencia_dv, conta, conta_dv, tipo_conta, pix_tipo, pix_chave), todas nullable.
  - Card `card-dados-bancarios.tsx` na tela de detalhe do colaborador — edição pela UI.
  - `colaboradores.fornecedor_id` **removido** (colaborador não é mais fornecedor); auto-match por documento e cards "Fornecedor já cadastrado" saíram do formulário de novo colaborador.
  - `contas_avulsas.colaborador_id` adicionado; `aprovarLinhaFolha` grava o destinatário nele; `vw_a_pagar` expõe.
  - `vw_a_pagar` distingue `origem = 'folha'` de `origem = 'avulso'`.
  - ADRs 001/002 em [`pgto-remessa/02-decisoes.md`](../pgto-remessa/02-decisoes.md); handoff em [`2026-09-23-pgto-remessa-e-impactos-no-rh.md`](../../handoffs/2026-09-23-pgto-remessa-e-impactos-no-rh.md).

## P1 — Próxima entrega: escolher entre

### 1. Import da planilha Excel atual

Destrava a Kika usar de verdade — hoje o quadro dela tem 50+ pessoas na planilha. Fluxo:
- Rota `/rh/colaboradores/importar` com upload
- Parser lê aba **Colaboradores** e cria N cadastros
- Warnings pra linhas com dados incompletos
- Idempotente por CPF/CNPJ (não duplica)
- **Decisão prévia:** o parser preenche também as 9 colunas de dados bancários (novo shape do colaborador desde 2026-09-21) OU deixa nullable e a Kika edita depois via UI? Depende de a planilha atual ter banco/agência/conta/PIX por linha. Alinhar antes de codar.

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
- **[`03-modelo-de-dados.md`](03-modelo-de-dados.md) está parcialmente stale** — descreve o shape MVP original do colaborador com `fornecedor_id` (removido em 2026-09-21, ADR 001 do pgto-remessa) e sem as 9 colunas de dados bancários (adicionadas na mesma data, ADR 003). As fontes-verdade atualizadas são [`pgto-remessa/02-decisoes.md`](../pgto-remessa/02-decisoes.md) e [`pgto-remessa/03-modelo-de-dados.md`](../pgto-remessa/03-modelo-de-dados.md). Decidido não reescrever (é doc histórico do MVP); só anotado no topo do arquivo.
- **Colaboradores existentes sem dados bancários** — a migration 20260921140001 foi aditiva pura, sem backfill. Se o pagamento CNAB entrar em produção antes do import da planilha (P1.1), precisa preencher manualmente pela UI de detalhe do colaborador ou por SQL.
- **Formulário de novo colaborador não pede banco/PIX ainda** — as 9 colunas são preenchidas só pela tela de detalhe. Se P1.3 (Benefícios) ou P1.1 (Import) exigir banco preenchido no cadastro rápido, incrementar o form.

## Regras invioláveis pra manter no módulo

Herdadas de `CLAUDE.md` e reforçadas ao longo das rodadas:

- **`docs/PERFORMANCE.md`** é obrigatório antes de qualquer mudança em `app/(app)/rh/**` ou `lib/supabase/**`.
- Cada tabela nova → RLS gate `is_tenant_admin(x) OR is_tenant_rh(x)` (ou `+ is_tenant_financeiro` no caso da folha).
- Cada migration nova → GRANT explícito para `authenticated` + índice em FK importante.
- Ortografia pt-BR completa em qualquer string visível ao usuário.
- Cada rodada nova encerra com: commit descritivo + linha no `HANDOFF.md` seção 2 (índice cronológico) + atualização deste `30-proximos-passos.md`.
