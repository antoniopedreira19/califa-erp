-- Migration: 20261123900001_ferias_retroativo_sem_folha_vira_concluido.sql
--
-- Backfill: lançamentos 'aprovado' que não geraram folha_pagamento tipo='ferias'
-- são retroativos — pagamento foi feito fora do sistema. Nunca houve fluxo
-- pendente (NF, financeiro). Devem estar 'concluido', não 'aprovado'
-- indefinidamente, pra ficarem consistentes com os retroativos antigos que
-- já estão como 'concluido' no banco.
--
-- Escopo: 3 lançamentos hoje (2 Karena, 1 Eduardo). Ambos foram lançados
-- pelo RH via `lancarDiretoPeloRh` após a data de início; o short-circuit
-- em criar-folhas-pagamento.ts:178 pulou a criação da folha; o status
-- ficou 'aprovado' por inércia.
--
-- O fix forward (criar-folhas-pagamento.ts) marca como 'concluido' no
-- momento da criação. Esta migration só cobre o backlog.

update public.colaboradores_ferias_lancamentos l
   set status = 'concluido'::ferias_lancamento_status
 where l.status = 'aprovado'
   and not exists (
     select 1 from public.folhas_pagamento f
      where f.lancamento_ferias_id = l.id
        and f.tipo = 'ferias'
   );
