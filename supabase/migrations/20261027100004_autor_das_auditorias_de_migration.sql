-- =============================================================================
-- O autor de três auditorias de migration passa a ser o usuário do Tiago no ERP
-- =============================================================================
-- Três migrations gravaram em `audit_events` o autor
-- fa61a319-6409-4d02-93c5-8d8be2746673: a conta do email pessoal do Tiago,
-- criada em 18/09/2026, que não é membro do tenant. O usuário dele no ERP é
-- 3a933b18-156d-48b3-b100-a8099292b1c2 (administrador). As sessões buscaram
-- o id pelo email pessoal, e a auditoria aceita qualquer usuário como autor.
-- Na tela, o autor aparecia com o nome da conta pessoal.
--
--   - 20261003300001 (job.abertura_desfeita, 03/10/2026)
--   - 20261006600002 (orcamento.copias_apagadas, 06/10/2026)
--   - 20261027100001 (conta_bancaria.atualizada, 27/10/2026)
--
-- Mudança DESTRUTIVA (sobrescreve valor preenchido), confirmada pelo Tiago
-- em 27/10/2026: "Pode corrigir o autor das 3 auditorias de migration para
-- o meu usuário do ERP (3a933b18)." Só mudam essas três linhas, pelo id, e
-- só se ainda estiverem com o autor errado. O autor de antes fica no
-- `metadata` de cada uma (`autor_corrigido`), para a troca não sumir. As
-- migrations antigas não se reescrevem: o id errado continua no texto delas.
-- =============================================================================

do $$
declare
  c_errado constant uuid := 'fa61a319-6409-4d02-93c5-8d8be2746673';
  c_certo  constant uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  c_ids    constant uuid[] := array[
    'adbbefec-6e35-41a3-bbad-975870432d4c',
    'a89eb811-cf47-4290-b157-8b17b3d24a41',
    'b62c8e4b-0c3f-443b-97f8-caddb47de0ca'
  ]::uuid[];
  v_n integer;
begin
  if not exists (
    select 1
      from public.tenant_members tm
     where tm.user_id = c_certo
       and tm.role = 'administrador'
       and tm.status = 'ativo'
  ) then
    raise exception 'O usuário % não é administrador ativo: nada a fazer.', c_certo;
  end if;

  update public.audit_events e
     set actor_user_id = c_certo,
         metadata = e.metadata || jsonb_build_object(
           'autor_corrigido', jsonb_build_object(
             'de', c_errado,
             'em', '2026-10-27',
             'origem', 'migration 20261027100004'
           )
         )
   where e.id = any (c_ids)
     and e.actor_user_id = c_errado;
  get diagnostics v_n = row_count;

  if v_n not in (0, 3) then
    raise exception 'Esperava corrigir 3 auditorias (ou nenhuma, se já corrigidas) e achei %.', v_n;
  end if;
end
$$;
