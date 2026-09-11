-- =====================================================================
-- Trigger `sincronizar_conta_do_cartao` passa a preencher também o
-- `empresa_contabil_id` da conta-espelho. Como `cartoes_credito` não tem
-- essa coluna, cai na PJ contábil "primeira ativa por razão social" do
-- tenant — mesma lógica do fallback atual pra `empresa_id` gerencial.
-- Se no futuro o cartão precisar carregar a PJ contábil, adiciona lá.
-- =====================================================================

create or replace function public.sincronizar_conta_do_cartao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa_id uuid;
  v_empresa_contabil_id uuid;
begin
  -- Gerencial: mantém o comportamento anterior (vestígio).
  v_empresa_id := coalesce(
    new.empresa_id,
    (select id from empresas
      where tenant_id = new.tenant_id and ativo
      order by principal desc, razao_social
      limit 1)
  );

  -- Contábil: primeira PJ ativa do tenant, alfabética por razão social.
  select id into v_empresa_contabil_id
    from public.empresas_contabeis
   where tenant_id = new.tenant_id and ativo
   order by razao_social
   limit 1;

  if v_empresa_id is null then
    raise exception 'Nenhuma empresa (gerencial) ativa no tenant para ancorar a conta do cartão.';
  end if;

  if v_empresa_contabil_id is null then
    raise exception 'Nenhuma empresa contábil ativa no tenant para ancorar a conta do cartão.';
  end if;

  if tg_op = 'INSERT' then
    insert into public.contas_bancarias (
      tenant_id, empresa_id, empresa_contabil_id, nome, banco, tipo,
      saldo_inicial, saldo_inicial_data, ativo, cartao_credito_id, created_by
    ) values (
      new.tenant_id, v_empresa_id, v_empresa_contabil_id,
      new.nome, new.banco, 'cartao_credito',
      0, current_date, new.ativo, new.id, new.created_by
    );
    return new;
  end if;

  update public.contas_bancarias
     set nome                = new.nome,
         banco               = new.banco,
         empresa_id          = v_empresa_id,
         empresa_contabil_id = coalesce(empresa_contabil_id, v_empresa_contabil_id),
         ativo               = new.ativo,
         updated_at          = now()
   where cartao_credito_id = new.id;

  return new;
end;
$function$;
