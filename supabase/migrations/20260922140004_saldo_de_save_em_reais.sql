-- =============================================================================
-- Valores em reais nas mensagens de saldo de save (decisão 099)
-- =============================================================================
--
-- As mensagens de save_consumo_valida formatavam o valor com to_char e as
-- máscaras G/D, que seguem o locale do servidor (en): a tela recebia
-- "R$ 10,000.00". Já era assim antes da 099; a simulação da aprovação de save
-- (22/09/2026) mostrou. Aqui entra save_reais(), com o separador fixo do
-- pt-BR, e a função é recriada igual à de 20260922140001 fora isso.
-- =============================================================================

create or replace function public.save_reais(p_valor numeric)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select translate(to_char(p_valor, 'FM999,999,999,990.00'), ',.', '.,');
$$;

revoke all on function public.save_reais(numeric) from public, anon;
grant execute on function public.save_reais(numeric) to authenticated;

create or replace function public.save_consumo_valida()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_total_linha        numeric(14,2);
  v_em_save            boolean;
  v_tenant_linha       uuid;
  v_job_da_linha       uuid;
  v_orcamento_versao   uuid;
  v_versao_aprovada    boolean := false;
  v_ja_consumido       numeric(14,2);
  v_codigo             text;
  v_gerado             numeric(14,2);
  v_usado_outros       numeric(14,2);
  v_da_linha           numeric(14,2);
  v_old_job            uuid;
  v_old_versao         uuid;
begin
  if tg_op = 'UPDATE' then
    v_old_job := old.job_item_orcado_id;
    v_old_versao := old.item_versao_id;
  end if;

  if new.item_versao_id is not null then
    select i.total_orcado, i.em_save, i.tenant_id, v.orcamento_id, (v.status = 'aprovada')
      into v_total_linha, v_em_save, v_tenant_linha, v_orcamento_versao, v_versao_aprovada
      from public.versoes_orcamento_itens i
      join public.versoes_orcamento v on v.id = i.versao_orcamento_id
     where i.id = new.item_versao_id;
  else
    select o.total_orcado, o.em_save, o.tenant_id, o.job_id
      into v_total_linha, v_em_save, v_tenant_linha, v_job_da_linha
      from public.jobs_itens_orcado o
     where o.id = new.job_item_orcado_id;
  end if;

  if v_total_linha is null then
    raise exception 'Linha consumidora não encontrada.';
  end if;
  if v_em_save then
    raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
  end if;
  if new.tenant_id <> v_tenant_linha then
    raise exception 'Tenant do consumo difere do tenant da linha.';
  end if;

  -- O próprio saldo, pelos dois lados: o job da linha, ou o job do orçamento
  -- da versão.
  if v_job_da_linha is not null and v_job_da_linha = new.job_origem_id then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;
  if v_orcamento_versao is not null and exists (
       select 1 from public.jobs j
        where j.id = new.job_origem_id and j.orcamento_id = v_orcamento_versao) then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;

  select coalesce(sum(c.valor), 0) into v_ja_consumido
    from public.saves_consumos c
   where c.id <> new.id
     and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
           and c.substituido_em is null)
       or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

  if v_ja_consumido + new.valor > v_total_linha + 0.005 then
    raise exception 'O consumo de save (R$ %) passa do orçado da linha (R$ %).',
      public.save_reais(v_ja_consumido + new.valor),
      public.save_reais(v_total_linha);
  end if;

  select j.codigo into v_codigo from public.jobs j where j.id = new.job_origem_id;
  if v_codigo is null then
    raise exception 'Job de origem do save não encontrado.';
  end if;

  -- Saldo: só o que segura saldo (linha do job, ou versão aprovada). O
  -- rascunho reserva e avisa, não impede (decisão 028, nota de 26/08).
  if new.job_item_orcado_id is not null or v_versao_aprovada then
    -- Dois consumos do mesmo saldo ao mesmo tempo passariam os dois: a linha
    -- do job de origem serializa quem consome e quem retira o save.
    perform 1 from public.jobs where id = new.job_origem_id for no key update;

    v_gerado := public.save_gerado_aprovado(new.job_origem_id);

    -- Outras linhas. Na abertura o consumo MUDA de ponta (versão → cópia do
    -- job) por UPDATE: a ponta antiga ainda está na tabela e não é "outra".
    select coalesce(sum(u.usado), 0) into v_usado_outros
      from public.save_uso_linhas(new.job_origem_id) u
     where (u.job_item_orcado_id is null
            or (u.job_item_orcado_id is distinct from new.job_item_orcado_id
                and u.job_item_orcado_id is distinct from v_old_job))
       and (u.item_versao_id is null
            or (u.item_versao_id is distinct from new.item_versao_id
                and u.item_versao_id is distinct from v_old_versao));

    select coalesce(sum(c.valor), 0) + new.valor into v_da_linha
      from public.saves_consumos c
     where c.id <> new.id
       and c.job_origem_id = new.job_origem_id
       and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
             and c.substituido_em is null)
         or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

    if v_usado_outros + v_da_linha > v_gerado + 0.005 then
      raise exception 'O saldo de save aprovado do % é de R$ %, e outras linhas já usam R$ %: não cabe mais R$ %.',
        v_codigo,
        public.save_reais(v_gerado),
        public.save_reais(v_usado_outros),
        public.save_reais(v_da_linha);
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
