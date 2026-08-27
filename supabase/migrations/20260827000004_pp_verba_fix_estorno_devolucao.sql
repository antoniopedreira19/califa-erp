-- =====================================================================
-- Fix do estorno de devolucao verba: RPC usa nova origem no reverso
-- e CHECKs conhecem a assimetria original vs reverso.
--
-- Ver comentario da migration 20260827000003 pro racional. Aqui:
--
-- 1. estornar_baixa_devolucao_verba passa a inserir REVERSO com
--    origem = pp_devolucao_verba_estorno (nova) e a atualizar o
--    ORIGINAL pra origem = pp_devolucao_verba_estornada (que ja existia).
--    Dessa forma o CHECK chk_estorno_consistente aceita naturalmente:
--    reverso na branch NOT NULL, original na branch NULL.
--
-- 2. chk_origem_contraparte_tem_id: pp_devolucao_verba_estorno entra
--    na mesma branch de pp_devolucao_verba* — exige pp_verba_devolucao_id
--    NOT NULL e pedido_compra_id NOT NULL (o reverso mantem ambos).
--
-- 3. chk_estorno_consistente: pp_devolucao_verba_estornada SAI da lista
--    de "estornos ativos" (era um erro da 000009 — o original marcado
--    nao tem estorno_de_lancamento_id NOT NULL). No lugar entra
--    pp_devolucao_verba_estorno.
-- =====================================================================


-- ---------- 1. chk_origem_contraparte_tem_id: inclui a nova origem ----------

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (
      origem in ('pp_baixa', 'pp_baixa_estornada', 'pp_estorno')
      and pedido_compra_id is not null
    )
    or
    (
      origem in ('avulsa_baixa', 'avulsa_baixa_estornada', 'avulsa_estorno')
      and conta_avulsa_id is not null
    )
    or
    (
      origem in ('titulo_baixa', 'titulo_baixa_estornada', 'titulo_estorno')
      and titulo_receber_id is not null
    )
    or
    (
      origem in ('desembolso_baixa', 'desembolso_baixa_estornada', 'desembolso_estorno')
      and desembolso_id is not null
    )
    or
    (
      origem in ('pp_devolucao_verba', 'pp_devolucao_verba_estornada', 'pp_devolucao_verba_estorno')
      and pp_verba_devolucao_id is not null
      and pedido_compra_id is not null
    )
    or
    (
      origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    )
  );


-- ---------- 2. chk_estorno_consistente: troca _estornada por _estorno ----------

alter table public.lancamentos_financeiros
  drop constraint if exists chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (
      origem in (
        'pp_estorno',
        'avulsa_estorno',
        'pp_devolucao_verba_estorno',
        'titulo_estorno',
        'desembolso_estorno'
      )
      and estorno_de_lancamento_id is not null
    )
    or
    (
      origem not in (
        'pp_estorno',
        'avulsa_estorno',
        'pp_devolucao_verba_estorno',
        'titulo_estorno',
        'desembolso_estorno'
      )
      and estorno_de_lancamento_id is null
    )
  );


-- ---------- 3. estornar_baixa_devolucao_verba usa pp_devolucao_verba_estorno ----------

create or replace function public.estornar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_motivo       text,
  p_criado_por   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev        pp_verba_devolucoes%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_reverso_id uuid;
  v_descricao  text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Devolução não encontrada.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a esta devolução.';
  end if;

  if v_dev.pago_em is null then
    raise exception 'Esta devolução não está baixada.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP da devolução não encontrada.'; end if;

  select * into v_original
    from public.lancamentos_financeiros
   where id = v_dev.lancamento_id;
  if not found then
    raise exception 'Lançamento da baixa da devolução não encontrado.';
  end if;

  v_descricao := 'Estorno devolução verba ' || v_pp.codigo
                 || ' — ' || substring(p_motivo, 1, 180);

  -- REVERSO: origem pp_devolucao_verba_estorno, natureza saida (inverte
  -- a entrada original), estorno_de_lancamento_id apontando pro original.
  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    'saida', v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    null, v_original.job_id, v_original.pedido_compra_id, v_original.pp_verba_devolucao_id,
    v_original.id, 'pp_devolucao_verba_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  -- ORIGINAL passa a origem pp_devolucao_verba_estornada — apenas marca
  -- que foi estornado; estorno_de_lancamento_id continua null.
  update public.lancamentos_financeiros
     set origem = 'pp_devolucao_verba_estornada'
   where id = v_original.id;

  -- Devolucao volta a aguardando baixa.
  update public.pp_verba_devolucoes
     set pago_em       = null,
         pago_por      = null,
         lancamento_id = null
   where id = p_devolucao_id;

  return v_reverso_id;
end;
$$;

comment on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) is
  'Estorna a baixa da devolução de verba. Reverso ganha origem pp_devolucao_verba_estorno (com estorno_de_lancamento_id NOT NULL); original recebe origem pp_devolucao_verba_estornada (marca). Devolução volta a aguardando baixa. Correção do bug do E2E de 27/08/2026.';

revoke execute on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) from public;
grant  execute on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) to authenticated;
