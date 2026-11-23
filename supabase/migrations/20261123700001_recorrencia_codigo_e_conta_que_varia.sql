-- Aba Recorrências reformulada (decisão 272, 23/11/2026). Aditiva.
--
-- 1. Código da recorrência (REC-00001), por tenant, na ordem de criação.
--    Igual ao AV- da conta avulsa: `gerar_codigo_recorrente` com trava por
--    tenant, e um gatilho preenche o código na criação (a action e a RPC
--    `criar_conta_recorrente` não precisam mandar). As que já existem
--    recebem o código pela ordem de `created_at`.
-- 2. Conta que varia (luz, água, celular): `valor_variavel` na recorrência.
--    O título dela nasce com o valor do cadastro como ESTIMATIVA
--    (`contas_avulsas.valor_estimado`) e fica "Aguardando conta" até alguém
--    lançar a conta do mês (valor real + fatura), que grava
--    `conta_lancada_em`.
-- 3. Débito automático: `texto_no_extrato` guarda o começo do histórico com
--    que o banco mostra o débito. A Conciliação usa para sugerir o título.
-- 4. O gerador (`materializar_ocorrencias_da_recorrente`) passa a gravar
--    `valor_estimado` a partir de `valor_variavel`. O resto da função é o de
--    antes (nasce aprovada, 30 dias antes, rateio copiado, auditoria).
--
-- Nada muda para quem já usa: as colunas novas nascem falsas/nulas.

alter table public.contas_avulsas_recorrentes
  add column if not exists codigo text,
  add column if not exists valor_variavel boolean not null default false,
  add column if not exists texto_no_extrato text;

comment on column public.contas_avulsas_recorrentes.codigo is
  'REC-00001: código da recorrência por tenant (decisão 272). Preenchido pelo gatilho na criação.';
comment on column public.contas_avulsas_recorrentes.valor_variavel is
  'A conta varia todo mês (luz, água, celular): o título nasce com valor estimado e "Aguardando conta" (decisão 272).';
comment on column public.contas_avulsas_recorrentes.texto_no_extrato is
  'Débito automático: o começo do histórico com que o banco mostra o débito. A Conciliação sugere o título por ele (decisão 272).';

alter table public.contas_avulsas
  add column if not exists valor_estimado boolean not null default false,
  add column if not exists conta_lancada_em timestamptz;

comment on column public.contas_avulsas.valor_estimado is
  'Título de recorrência que varia: o valor ainda é a estimativa do cadastro, até a conta do mês ser lançada (decisão 272).';
comment on column public.contas_avulsas.conta_lancada_em is
  'Quando a conta do mês (valor real e fatura) foi lançada no título de recorrência que varia (decisão 272).';

-- 1. O código -----------------------------------------------------------------

create or replace function public.gerar_codigo_recorrente(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prox integer;
begin
  perform pg_advisory_xact_lock(hashtext('recorrente_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^REC-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.contas_avulsas_recorrentes
   where tenant_id = p_tenant_id
     and codigo ~ '^REC-\d+$';

  return 'REC-' || lpad(v_prox::text, 5, '0');
end;
$function$;

create or replace function public.recorrente_codigo_na_criacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.codigo is null then
    new.codigo := public.gerar_codigo_recorrente(new.tenant_id);
  end if;
  return new;
end;
$function$;

revoke all on function public.gerar_codigo_recorrente(uuid) from public, anon, authenticated;
revoke all on function public.recorrente_codigo_na_criacao() from public, anon, authenticated;

drop trigger if exists trg_recorrente_codigo_na_criacao on public.contas_avulsas_recorrentes;
create trigger trg_recorrente_codigo_na_criacao
  before insert on public.contas_avulsas_recorrentes
  for each row execute function public.recorrente_codigo_na_criacao();

-- As que já existem: pela ordem de criação, por tenant. Só preenche vazio.
with numeradas as (
  select r.id,
         'REC-' || lpad((
           coalesce((select max(cast(substring(x.codigo from '^REC-(\d+)$') as integer))
                       from public.contas_avulsas_recorrentes x
                      where x.tenant_id = r.tenant_id and x.codigo ~ '^REC-\d+$'), 0)
           + row_number() over (partition by r.tenant_id order by r.created_at, r.id)
         )::text, 5, '0') as codigo
    from public.contas_avulsas_recorrentes r
   where r.codigo is null
)
update public.contas_avulsas_recorrentes r
   set codigo = n.codigo
  from numeradas n
 where n.id = r.id;

alter table public.contas_avulsas_recorrentes alter column codigo set not null;

create unique index if not exists contas_avulsas_recorrentes_tenant_codigo_key
  on public.contas_avulsas_recorrentes (tenant_id, codigo);

-- 4. O gerador grava o valor estimado -------------------------------------------

create or replace function public.materializar_ocorrencias_da_recorrente(p_recorrente_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t       public.contas_avulsas_recorrentes%rowtype;
  v_limite  date := current_date + public.recorrencia_antecedencia_dias();
  v_geradas integer := 0;
  v_nova_id uuid;
  v_prox    date;
  v_cartao  boolean;
begin
  loop
    select * into v_t
      from public.contas_avulsas_recorrentes
     where id = p_recorrente_id
     for update;

    exit when not found;
    exit when not v_t.ativo;
    exit when v_t.proxima_data > v_limite;

    if v_t.data_fim is not null and v_t.proxima_data > v_t.data_fim then
      update public.contas_avulsas_recorrentes set ativo = false where id = v_t.id;
      exit;
    end if;

    if not exists (
      select 1 from public.contas_avulsas_recorrentes_regionais r where r.recorrente_id = v_t.id
    ) then
      raise exception 'A recorrência % não tem rateio de regional; nenhuma ocorrência foi gerada.', v_t.id;
    end if;

    v_cartao := v_t.forma_pagamento::text = 'cartao_credito' and v_t.cartao_credito_id is not null;

    if not exists (
      select 1
        from public.contas_avulsas a
       where a.recorrente_id = v_t.id
         and coalesce(a.data_compra, a.data_pagamento_primeira) = v_t.proxima_data
    ) then
      insert into public.contas_avulsas (
        tenant_id, empresa_id, descricao, valor, natureza,
        data_prevista_pagamento, data_pagamento, data_pagamento_primeira,
        data_compra, status, aprovada_em, aprovada_por,
        fornecedor_id, cliente_id,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        recorrente_id, criado_por,
        forma_pagamento, cartao_credito_id,
        codigo, valor_estimado
      ) values (
        v_t.tenant_id, v_t.empresa_id, v_t.descricao, v_t.valor, 'saida',
        v_t.proxima_data, v_t.proxima_data, v_t.proxima_data,
        case when v_cartao then v_t.proxima_data else null end,
        'aprovada', now(), v_t.criado_por,
        v_t.fornecedor_id, v_t.cliente_id,
        v_t.plano_conta_tipo_id, v_t.plano_conta_subtipo_id,
        v_t.id, v_t.criado_por,
        v_t.forma_pagamento, v_t.cartao_credito_id,
        public.gerar_codigo_avulsa(v_t.tenant_id), v_t.valor_variavel
      )
      returning id into v_nova_id;

      insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
      select v_t.tenant_id, v_nova_id, r.regional_id, r.percentual
        from public.contas_avulsas_recorrentes_regionais r
       where r.recorrente_id = v_t.id;

      insert into public.audit_events (
        tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
      ) values (
        v_t.tenant_id, 'conta_recorrente', v_t.id::text,
        'conta_recorrente.ocorrencia_gerada', null,
        jsonb_build_object(
          'avulsa_id', v_nova_id,
          'data_ocorrencia', v_t.proxima_data,
          'valor', v_t.valor,
          'valor_estimado', v_t.valor_variavel,
          'nasceu_aprovada', true,
          'antecedencia_dias', public.recorrencia_antecedencia_dias(),
          'forma_pagamento', v_t.forma_pagamento,
          'cartao_credito_id', v_t.cartao_credito_id
        )
      );

      v_geradas := v_geradas + 1;
    end if;

    v_prox := public.calcular_proxima_data_recorrencia(v_t);

    if v_t.data_fim is not null and v_prox > v_t.data_fim then
      update public.contas_avulsas_recorrentes set ativo = false where id = v_t.id;
      exit;
    end if;

    update public.contas_avulsas_recorrentes set proxima_data = v_prox where id = v_t.id;
  end loop;

  return v_geradas;
end;
$function$;
