-- =====================================================================
-- Backfill das contas bancárias existentes: preenche empresa_contabil_id
-- por regra de nome, na ordem "primeira que casa vence" (evita
-- %Santander% pegar "Santander GoCrazy" ou "Santander Hitlab").
--
-- Replay-safe: só toca linhas com empresa_contabil_id IS NULL, e resolve
-- as PJs por CNPJ (não por UUID). Roda em qualquer ambiente que já tenha
-- a migration de seed (20260911200002) aplicada.
--
-- As duas contas de teste (`Conta Teste`, `ZZ Teste Fatia 2`) não casam
-- com nenhuma regra de nome — foram atribuídas manualmente a California
-- porque são de teste e não afetam operação real (ruling do controller
-- na execução do plano, sem interação com o Daniel; se essa decisão
-- estiver errada, é reversível pela UI de conta bancária).
-- =====================================================================

-- 1) GoCrazy primeiro
update public.contas_bancarias cb
   set empresa_contabil_id = ec.id
  from public.empresas_contabeis ec
 where cb.empresa_contabil_id is null
   and ec.tenant_id = cb.tenant_id
   and ec.cnpj = '29943648000183'
   and (cb.nome ilike '%GoCrazy%' or cb.nome ilike '%Go Crazy%');

-- 2) Hitlab
update public.contas_bancarias cb
   set empresa_contabil_id = ec.id
  from public.empresas_contabeis ec
 where cb.empresa_contabil_id is null
   and ec.tenant_id = cb.tenant_id
   and ec.cnpj = '04409741000181'
   and cb.nome ilike '%Hitlab%';

-- 3) California (restante que casa por nome)
update public.contas_bancarias cb
   set empresa_contabil_id = ec.id
  from public.empresas_contabeis ec
 where cb.empresa_contabil_id is null
   and ec.tenant_id = cb.tenant_id
   and ec.cnpj = '19437976000154'
   and cb.nome ilike '%California%';

-- 4) Fallback pras contas de teste que sobraram sem PJ: California.
update public.contas_bancarias cb
   set empresa_contabil_id = ec.id
  from public.empresas_contabeis ec
 where cb.empresa_contabil_id is null
   and ec.tenant_id = cb.tenant_id
   and ec.cnpj = '19437976000154'
   and cb.nome in ('Conta Teste', 'ZZ Teste Fatia 2');
