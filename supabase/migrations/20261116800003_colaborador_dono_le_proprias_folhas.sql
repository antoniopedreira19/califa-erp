-- Migration: 20261116800003_colaborador_dono_le_proprias_folhas.sql
--
-- Sequência da migration 20261116800002 (colaborador_dono_pode_anexar_nf).
--
-- Depois de reabrir as policies de `colaboradores_nf_anexos` e do bucket
-- `colaboradores-nf` pro colaborador dono, descobrimos que o fluxo de
-- anexar NF ainda quebra em `"Escopo não encontrado."` — mensagem retornada
-- por `lib/nf/anexos-actions.ts` quando o resolver de escopo não acha a
-- folha/linha/adiantamento. Isso vem do passo ANTES do upload: o action
-- `anexarNfPorEscopo` chama `resolverEscopo`, que consulta as tabelas:
--
--   - folha mensal       -> `folhas_pagamento`
--   - férias usufruto/abono -> `colaboradores_ferias_lancamentos` (JÁ tem
--                             `is_colaborador_proprio()`, por isso férias
--                             funciona)
--   - 13º 1ª/2ª parcela  -> `decimo_terceiro_linhas`
--   - 13º adiantamento   -> `decimo_terceiro_adiantamentos`
--
-- A SELECT policy das 3 tabelas abaixo só permite admin/rh/financeiro.
-- Um colaborador (role colaborador, dono da própria folha) recebe
-- `data = null` do resolver e cai no "Escopo não encontrado." sem nem
-- chegar no upload.
--
-- Esta migration ADICIONA (não substitui) uma policy POR tabela que deixa
-- o dono ler a própria linha. Sem risco de vazamento: o colaborador só
-- consegue ler linhas cujo `colaborador_id` está vinculado ao `user_id`
-- dele mesmo.
--
-- Mudança aditiva.

-- ============================================================
-- folhas_pagamento: dono lê a própria folha (mensal, férias, 13º)
-- ============================================================
drop policy if exists folhas_select_proprio on public.folhas_pagamento;
create policy folhas_select_proprio on public.folhas_pagamento
  for select to authenticated
  using (
    is_colaborador_proprio(colaborador_id)
  );

-- ============================================================
-- decimo_terceiro_linhas: dono lê a própria linha de 13º
-- ============================================================
drop policy if exists decimo_terceiro_linhas_select_proprio on public.decimo_terceiro_linhas;
create policy decimo_terceiro_linhas_select_proprio on public.decimo_terceiro_linhas
  for select to authenticated
  using (
    is_colaborador_proprio(colaborador_id)
  );

-- ============================================================
-- decimo_terceiro_adiantamentos: dono lê o próprio adiantamento
-- ============================================================
drop policy if exists decimo_terceiro_adiantamentos_select_proprio on public.decimo_terceiro_adiantamentos;
create policy decimo_terceiro_adiantamentos_select_proprio on public.decimo_terceiro_adiantamentos
  for select to authenticated
  using (
    is_colaborador_proprio(colaborador_id)
  );
