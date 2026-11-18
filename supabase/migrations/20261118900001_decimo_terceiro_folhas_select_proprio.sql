-- Policy RLS esquecida em decimo_terceiro_folhas que travava o anexo de NF da
-- 1ª e 2ª parcela do 13° em /perfil.
--
-- O resolverDecimoTerceiroLinha (lib/nf/anexos-validators.ts) faz
--   from("decimo_terceiro_linhas")
--     .select("colaborador_id, folha_id, decimo_terceiro_folhas!inner(ano)")
-- Com o modificador !inner, o PostgREST exige SELECT nos dois lados do join.
-- O colaborador tem policy _select_proprio em decimo_terceiro_linhas mas não
-- tinha equivalente em decimo_terceiro_folhas — que só tinha policy rh/admin.
-- Resultado: !inner filtrava a linha pai, maybeSingle() devolvia null e a
-- action respondia "Escopo não encontrado." para qualquer PJ/MEI/clt_recibo
-- tentando anexar a NF do próprio 13°.
--
-- Mesmo padrão das demais tabelas que o perfil consome:
--   folhas_pagamento.folhas_select_proprio
--   decimo_terceiro_linhas.decimo_terceiro_linhas_select_proprio
--   decimo_terceiro_adiantamentos.decimo_terceiro_adiantamentos_select_proprio
--   colaboradores_ferias_lancamentos.ferias_lancamentos_select (branch do dono)
--
-- Aqui o colaborador não tem FK direta pra folha; o vínculo é via linha. A
-- policy libera SELECT se existe ao menos uma linha dessa folha pertencente
-- ao colaborador logado.

CREATE POLICY decimo_terceiro_folhas_select_proprio
  ON public.decimo_terceiro_folhas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.decimo_terceiro_linhas dtl
       WHERE dtl.folha_id = decimo_terceiro_folhas.id
         AND public.is_colaborador_proprio(dtl.colaborador_id)
    )
  );
