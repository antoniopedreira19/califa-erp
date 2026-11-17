-- Motivo: a migration 20261117500002 deletou as linhas de 13º/2026 dos 4
-- adiantamentos marcados como integral=true. DEPOIS alguém clicou em
-- "Recalcular folha" na UI, e a função recalcularFolhaDecimoTerceiro
-- não respeitava a regra `integral`: a parte "adicionar faltantes"
-- recriou as 4 linhas (com IDs novos).
--
-- Essa migration limpa a sujeira e o commit que acompanha ensina o
-- recalc a respeitar integral (nas duas frentes: update de linhas
-- existentes vira delete, e faltantes com integral não entram).
--
-- Mesmo DELETE da 500002, idempotente: se as linhas não existirem mais,
-- o DELETE vira no-op.

delete from public.decimo_terceiro_linhas l
using public.decimo_terceiro_folhas f,
      public.decimo_terceiro_adiantamentos a
where l.folha_id = f.id
  and f.ano = 2026
  and f.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and a.tenant_id = f.tenant_id
  and a.ano = f.ano
  and a.colaborador_id = l.colaborador_id
  and a.integral = true;
