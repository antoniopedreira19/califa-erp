-- Remove old overloads (5/6-param) que coexistiam com os novos após
-- create or replace function com nova assinatura (Postgres cria overload,
-- não substitui quando a aridade muda).
-- Os OIDs antigos não tinham dependentes (verificado via pg_depend).
-- Os novos overloads (7/8-param com forma_pagamento) já estão no lugar.

drop function if exists dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid);
drop function if exists dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid);
drop function if exists dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid);
drop function if exists dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid);
