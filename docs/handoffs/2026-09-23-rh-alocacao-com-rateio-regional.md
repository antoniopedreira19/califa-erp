# RH · Alocação por empresa com toggle de rateio (2026-09-23)

> Task 006 fechada. Modelo de alocação da Camada 1 refeito: 1 vigente por colaborador, com toggle "Todas as regionais" quando a empresa tem rateio anual configurado. Snapshot da folha expande automaticamente. CRUD do rateio anual pronto em `/rh/rateios`. Migration destrutiva aplicada (percentual da alocação removido; regionais GERAL aposentadas antes).

## O que entrou

### Banco (migration `20260923100001_rh_alocacao_com_rateio_regional`)

- **Tabela nova `empresas_rateios_regionais`** (RLS admin+rh, trigger deferred de soma=100 por empresa/ano, composite FK garante que `regional_id` pertence a `empresa_id`, unique `(tenant, empresa, ano, regional)`, comment em cada coluna).
- **`regionais` ganha unique composto `(id, empresa_id)`** — viabiliza o composite FK acima e o mesmo na Camada 1.
- **`colaboradores_alocacoes` refeita**:
  - Drop trigger e função de `soma_100` (não faz mais sentido — 1 vigente por vez).
  - Drop `chk_alocacoes_percentual_valido`.
  - Drop coluna `percentual` (destrutiva — dado antigo do rateio 50/50 do Antonio já apagado antes na sessão anterior).
  - `regional_id` vira nullable.
  - Nova coluna `usa_rateio_empresa boolean not null default false`.
  - Check XOR: `(toggle=true AND regional=null) OR (toggle=false AND regional!=null)`.
  - Composite FK `(regional_id, empresa_id) → regionais(id, empresa_id)`.
  - Índice `idx_alocacoes_vigentes` reformulado como UNIQUE parcial: `(colaborador_id) where data_fim is null` — garante 1 vigente por colaborador.
- **Backfill do rateio** (California + CCH, 2023..2026, conforme planilha da Kika).
- **Backfill do Antonio** (colaborador de teste): apaga as 2 vigentes 50/50 antigas e insere 1 nova em `Empresa Teste + regional Teste` (toggle=false).
- **Revoke execute na trigger function** pra atender advisor 0028/0029 do Supabase.

### Types + validações

- `lib/types.ts`: `ColaboradorAlocacao.regional_id` vira nullable, ganha `usa_rateio_empresa`, sem `percentual`. Novo tipo `EmpresaRateioRegional`.
- `lib/validations/rh-colaboradores.ts` — `alocacaoSchema` refeito com `superRefine` (XOR runtime).
- `lib/auth/audit.ts` — duas ações novas: `rateio.regional.salvo`, `rateio.regional.copiado`.

### Server actions

- **`app/(app)/rh/colaboradores/[id]/actions-alocacao.ts`** — `substituirAlocacoes` (N linhas) virou `alterarAlocacao` (1 vigente). Fecha vigente em `data_mudanca - 1 dia` e abre nova em `data_mudanca`. Se toggle=ON, valida antes que a empresa tem rateio configurado no ano da mudança (evita a linha "sem_rateio" na hora da folha).
- **`app/(app)/rh/rateios/actions.ts`** (novo) — `salvarRateioAno` (swap atômico) e `copiarRateioParaAno` (abre ano novo a partir de outro existente). Bloqueia edição de anos anteriores ao vigente.
- **`app/(app)/rh/folhas/actions.ts` — `gerarFolha`** reescrita:
  - Puxa alocação vigente (1 linha) + rateios da empresa+ano em paralelo.
  - Se toggle=false: 1 linha no snapshot com 100%.
  - Se toggle=true: N linhas conforme rateio da empresa+ano.
  - Se toggle=true e a empresa não tem rateio configurado no ano da competência: pula colaborador na terceira categoria (`pulados_sem_rateio`) — mensagem específica no modal explica.
- **`app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` — `aprovarLinhaFolha`**:
  - Removida propagação de alocação pra Camada 1 (não faz mais sentido — Camada 1 não tem % por colaborador).
  - Mantida propagação de salário (D5 da 097): só re-abre histórico se o valor mudou de verdade.

### UI

- **`app/(app)/rh/colaboradores/[id]/card-alocacoes.tsx`** refeito:
  - 1 vigente em destaque + histórico simples.
  - Drawer "Alterar" com Select empresa → toggle condicional (só aparece se a empresa tem rateio no ano corrente) → Select regional (só quando toggle=OFF) → preview do rateio (só quando toggle=ON, mostra o % por regional).
  - Toggle inline CSS-only (sem depender de `@radix-ui/react-switch` que não está no projeto).
- **`app/(app)/rh/colaboradores/[id]/page.tsx`** — passa `rateiosDoAno` + `anoRateio` (já agregado por empresa) pro card.
- **`app/(app)/rh/rateios/{page.tsx,rateios-view.tsx}`** — nova rota. Tela por empresa mostrando os anos configurados, com botão "Adicionar ano" (copia de existente) e "Editar" (swap dos %).
- **`app/(app)/rh/page.tsx`** — hub ganha o card "Rateios anuais por regional" contando empresas com rateio no ano corrente.
- **`app/(app)/rh/folhas/nova-folha-modal.tsx`** — inclui a nova categoria `pulados_sem_rateio` na tela de resultado com mensagem explicando "Configure o rateio de X pra Y antes de gerar".

## Migrations aplicadas

```
20260923100001  rh_alocacao_com_rateio_regional
```

Apagada do repo em commit anterior (mesma sessão): `20260916000004_rh_regional_geral.sql` (GERAL foi aposentada).

## Docs / ADRs relacionados

- [`tasks/done/006-alocacao-com-rateio-regional-na-folha.md`](../../tasks/done/006-alocacao-com-rateio-regional-na-folha.md) — task original, com decisões travadas.
- [`docs/handoffs/2026-09-23-pgto-remessa-e-impactos-no-rh.md`](2026-09-23-pgto-remessa-e-impactos-no-rh.md) — contexto anterior (colaborador ganhou banco/PIX; contas_avulsas.colaborador_id).
- Sem ADR próprio nesta rodada — a mudança tá bem coberta no header da migration e na task. Se depois surgir dúvida sobre "por que não múltiplas empresas somando 100%", vira ADR retroativo.

## Commits relevantes

- `8459108` — chore(rh): remove migration da regional GERAL
- `b49dafc` — feat(rh): nova alocação (empresa + toggle + tabela de rateio) — migration principal + Camada 1 + UI do card
- `1c22dd3` — feat(rh): motor de folha expande rateio da empresa no snapshot
- `dce8227` — feat(rh): CRUD de rateio anual por empresa em /rh/rateios

## Pontos de atenção pra próxima sessão

- **Antonio hoje tem alocação em Empresa Teste + regional Teste (toggle=false).** Se quiser testar o fluxo completo do rateio, mude ele pra "Agência California + Todas as regionais" pelo drawer de alocação. O preview vai mostrar NE 25% / NO 20% / SP 30% / RJ 25%. Gerar a folha vai criar snapshot com 4 linhas.
- **Empresa Teste e Hitlab não têm rateio configurado.** O toggle "Todas as regionais" NÃO aparece no drawer se o colaborador estiver nelas. Se algum dia essas empresas precisarem de transversais, use `/rh/rateios` → Adicionar ano.
- **Débito técnico: `substituirAlocacoes` foi renomeada pra `alterarAlocacao`.** Nenhum outro caller além do card foi encontrado, mas se em fase futura o import da planilha (P1.1) tentar chamar, precisa usar o nome novo.
- **`editarLinhaFolhaRh` continua editando o snapshot com N linhas de %.** Isso é da Camada 2 (imutável depois de aprovada) e continua valendo — o schema `linhaFolhaSchema` opera sobre `folhas_pagamento_alocacoes` que preserva `percentual`. Nenhuma mudança precisou.
- **`aprovarLinhaFolha` do financeiro deixou de propagar alocação pra Camada 1.** Se em algum caso ela precisar voltar (ex: "financeiro corrigiu porque a Kika esqueceu de trocar de regional na Camada 1"), o fluxo agora é: financeiro reprova com motivo → RH corrige na alocação vigente → RH reenvia. Considerar registrar isso como ADR se virar caso comum.
- **Migration `20260916000004_rh_regional_geral.sql` foi deletada.** Se alguém fizer `supabase db reset` numa máquina local, as GERAL não voltam. Como não temos ambiente de dev sincronizado, é aceitável — mas se surgir outro dev, precisa alinhar.
- **`docs/modulos/rh/03-modelo-de-dados.md` continua stale** (aviso no topo já anotava). A nota agora precisaria mencionar também que `colaboradores_alocacoes.percentual` sumiu — considerar atualizar quando revisitar.
- **Próximas tarefas do backlog do RH (`docs/modulos/rh/30-proximos-passos.md`)**: import da planilha da Kika (P1.1) segue sendo o próximo destravador; agora com decisão adicional — se importar colaborador com "TD" no Excel, mapeia pra `usa_rateio_empresa=true`; senão pra `regional_id` específica.
