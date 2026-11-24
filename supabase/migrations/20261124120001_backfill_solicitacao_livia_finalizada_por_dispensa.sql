-- Backfill de uma única solicitação (prod Agência California) pra deixar
-- o status coerente com a regra de dispensa de minuta: diária < 15 dias
-- vai direto pra 'finalizada' na aprovação.
--
-- Contexto:
--   - Solicitação d1d32911-3650-4d96-b3e5-e8fc0bde47b7 (Agência California,
--     tipo diárias, data_inicio = data_termino = 26/10/2026 — 1 diária
--     após backfill 20261124110001).
--   - Criada 28/10/2026 com data_termino NULL e aprovada 30/10/2026.
--     Nesse instante a regra de dispensa (que exige data_termino não-NULL)
--     não disparou, então o status virou 'aprovada'. Em 03/11 o RH gerou
--     minuta e subiu pra 'cadastrada' (fluxo antigo).
--   - Regra da dispensa atual só entrou no RPC em 12/11 (migration
--     20261112200001). Pra solicitação nova com os mesmos dados o fluxo
--     já bota direto em 'finalizada'.
--
-- Decisão (24/11/2026): migrar essa linha pra 'finalizada' pra ficar
-- consistente com o que o fluxo atual geraria. A versão sandbox do mesmo
-- caso (5c586818…) NÃO entra neste backfill — fica como está.
--
-- Guard: só altera se ainda estiver em 'cadastrada' (idempotente).

update public.freelancer_solicitacoes
   set status = 'finalizada'::freelancer_solicitacao_status,
       updated_at = now()
 where id = 'd1d32911-3650-4d96-b3e5-e8fc0bde47b7'
   and status = 'cadastrada';

insert into public.audit_events (tenant_id, acao, entidade_tipo, entidade_id, metadata)
select
  s.tenant_id,
  'freelancer_solicitacao.finalizada_por_dispensa',
  'freelancer_solicitacao',
  s.id::text,
  jsonb_build_object(
    'contrato_id', s.contrato_id,
    'conserto_manual', true,
    'motivo', 'Backfill 24/11/2026: solicitação aprovada em 30/10 com data_termino NULL (form não exigia duração) + regra da dispensa só entrou no RPC em 12/11. Status migrado de cadastrada para finalizada pra bater com o fluxo atual (diária < 15 dias).'
  )
  from public.freelancer_solicitacoes s
 where s.id = 'd1d32911-3650-4d96-b3e5-e8fc0bde47b7'
   and s.status = 'finalizada'
   and not exists (
     select 1 from public.audit_events a
      where a.entidade_id = s.id::text
        and a.acao = 'freelancer_solicitacao.finalizada_por_dispensa'
   );
