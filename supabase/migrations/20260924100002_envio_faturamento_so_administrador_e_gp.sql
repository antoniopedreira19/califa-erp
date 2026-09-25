-- =============================================================================
-- Envio para faturamento: só administrador ou GP, e o autor é quem enviou
-- (Tiago, 24/09/2026)
-- =============================================================================
--
-- A tela já fazia isso: `enviarJobParaFaturamento` exige a permissão
-- `jobs.enviar_faturamento` (administrador e GP) e grava
-- `enviado_por = session.profile.id`. O banco não:
--
--   * `enviar_job_para_faturamento` roda como quem chama (security
--     invoker), e a policy de INSERT de `jobs_envio_faturamento` aceita
--     qualquer membro do tenant — chamando a RPC direto pela API, um
--     produtor ou o financeiro enviava;
--   * `enviado_por` vinha do payload, então quem chamasse pela API podia
--     gravar o nome de outra pessoa como autor do envio.
--
-- A trava entra num gatilho, sem mexer na policy nem na RPC:
--
--   * INSERT por usuário logado: recusa quem não é administrador nem GP
--     ativo no tenant, e grava `enviado_por` = quem está logado, ignorando
--     o que veio no payload;
--   * UPDATE: `enviado_por` não muda nunca (a 099 regrava `valor_save` dos
--     meses enviados, e isso continua passando);
--   * sem usuário logado (migration, service role): passa como está.
--
-- Nenhum dado muda nesta migration.
-- =============================================================================

create or replace function public.envio_faturamento_autor()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    new.enviado_por := old.enviado_por;
    return new;
  end if;

  if v_uid is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id and p.ativo = true
     where tm.tenant_id = new.tenant_id
       and tm.user_id = v_uid
       and tm.status = 'ativo'
       and tm.role in ('administrador', 'gerente_producao')
  ) then
    raise exception 'Apenas o administrador ou um GP envia o job para faturamento.';
  end if;

  new.enviado_por := v_uid;
  return new;
end;
$$;

revoke all on function public.envio_faturamento_autor() from public, anon, authenticated;

comment on function public.envio_faturamento_autor() is
  'Envio para faturamento (24/09/2026): só administrador ou GP enviam, e o autor gravado é sempre quem está logado. No UPDATE o autor não muda.';

drop trigger if exists trg_envio_faturamento_autor on public.jobs_envio_faturamento;
create trigger trg_envio_faturamento_autor
  before insert or update on public.jobs_envio_faturamento
  for each row execute function public.envio_faturamento_autor();
