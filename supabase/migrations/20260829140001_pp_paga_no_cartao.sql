-- =====================================================================
-- PP paga no cartão
--
-- Última peça do cartão. Até aqui a fatura só continha conta avulsa;
-- agora ela contém também parcela de PP, que é o que o Tiago descreveu
-- desde o começo: "poderão haver PPs dentro da fatura de um cartão,
-- pagamentos avulsos, e até coisas recorrentes como assinaturas".
--
-- ── Quem escolhe, e quando ──────────────────────────────────────────
--
-- A forma de pagamento da PP é escolhida **na aprovação, pelo
-- financeiro** — decidido em 28/08/2026. Quem abre a PP é a produção, e
-- ela não sabe (nem precisa saber) por onde o dinheiro vai sair.
--
-- ── Uma parcela, uma fatura ─────────────────────────────────────────
--
-- Decidido em 29/08/2026: cada parcela entra na fatura da DATA DELA. A
-- PP de 9.000 em 30/60/90 dias vira três itens em três faturas, pelo
-- prazo que a produção negociou com o fornecedor. A alternativa — jogar
-- os 9.000 numa fatura só — ignoraria esse prazo.
--
-- ── Por que a PP no cartão precisa de plano de contas ───────────────
--
-- Na PP normal, o plano de contas é escolhido na BAIXA. Na PP no cartão
-- não existe baixa individual — ela sai na baixa da fatura inteira —,
-- então o plano tem que ser escolhido antes, e o único momento natural é
-- a aprovação, onde o financeiro já está escolhendo o cartão. Sem isso o
-- fechamento não teria como classificar o lançamento.
--
-- ── O que NÃO entra aqui ────────────────────────────────────────────
--
-- Estorno de parcela de PP. Decidido em 29/08/2026 que fica de fora por
-- enquanto: devolução de fornecedor numa PP paga no cartão entra como
-- ajuste do fechamento. A PP já tem devolução de verba, que é outra
-- coisa, e misturar as duas confundiria.
-- =====================================================================

alter table public.pedidos_compra
  add column if not exists forma_pagamento forma_pagamento,
  add column if not exists cartao_credito_id uuid
    references public.cartoes_credito(id) on delete restrict,
  add column if not exists plano_conta_tipo_id uuid
    references public.plano_contas_tipos(id) on delete restrict,
  add column if not exists plano_conta_subtipo_id uuid
    references public.plano_contas_subtipos(id) on delete restrict;

comment on column public.pedidos_compra.forma_pagamento is
  'Escolhida na aprovação, pelo financeiro. Quem abre a PP é a produção, que não decide por onde o dinheiro sai.';
comment on column public.pedidos_compra.plano_conta_tipo_id is
  'Só obrigatório quando a PP é paga no cartão: aí não há baixa individual onde escolher o plano, e o fechamento da fatura precisa dele.';

alter table public.pedidos_compra
  drop constraint if exists chk_pp_cartao_coerente;
alter table public.pedidos_compra
  add constraint chk_pp_cartao_coerente check (
    (forma_pagamento = 'cartao_credito'
       and cartao_credito_id is not null
       and plano_conta_tipo_id is not null
       and plano_conta_subtipo_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito'
       and cartao_credito_id is null)
  );

alter table public.pedidos_compra_parcelas
  add column if not exists fatura_cartao_id uuid
    references public.faturas_cartao(id) on delete set null;

comment on column public.pedidos_compra_parcelas.fatura_cartao_id is
  'A fatura em que esta parcela caiu, quando a PP é paga no cartão. Uma parcela, uma fatura — pela data da parcela.';

create index if not exists idx_pp_parcelas_fatura
  on public.pedidos_compra_parcelas (fatura_cartao_id)
  where fatura_cartao_id is not null;

-- ---------------------------------------------------------------------
-- Rotear a PP aprovada para o cartão
-- ---------------------------------------------------------------------
--
-- Função separada, chamada logo depois de `aprovar_pp_com_data`, em vez
-- de parâmetros novos naquela: ela é da outra frente e mexer na
-- assinatura dela obrigaria todo mundo que a chama a mudar junto.
create or replace function public.rotear_pp_para_cartao(
  p_pp_id uuid,
  p_cartao_id uuid,
  p_tipo_id uuid,
  p_subtipo_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pp        pedidos_compra%rowtype;
  v_cartao    cartoes_credito%rowtype;
  v_parcela   record;
  v_subtipo   uuid;
  v_roteadas  integer := 0;
begin
  select * into v_pp from pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem permissão nesta PP.';
  end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'Só PP aprovada vai para o cartão (status atual: %).', v_pp.status;
  end if;

  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado.'; end if;
  if v_cartao.tenant_id <> v_pp.tenant_id then
    raise exception 'Cartão de outro tenant.';
  end if;
  if not v_cartao.ativo then raise exception 'Cartão está inativo.'; end if;

  select tipo_id into v_subtipo from plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update pedidos_compra
     set forma_pagamento = 'cartao_credito',
         cartao_credito_id = p_cartao_id,
         plano_conta_tipo_id = p_tipo_id,
         plano_conta_subtipo_id = p_subtipo_id
   where id = p_pp_id;

  -- Uma parcela, uma fatura — pela data DELA. Parcela já paga não se
  -- mexe: se a PP foi para o cartão depois de alguma baixa avulsa, o que
  -- já saiu do banco fica como está.
  for v_parcela in
    select * from pedidos_compra_parcelas
     where pedido_compra_id = p_pp_id
       and pago_em is null
     order by numero
  loop
    update pedidos_compra_parcelas
       set fatura_cartao_id = public.fatura_aberta_do_cartao(
             p_cartao_id,
             coalesce(v_parcela.data_pagamento, v_parcela.data_vencimento)
           )
     where id = v_parcela.id;

    v_roteadas := v_roteadas + 1;
  end loop;

  return v_roteadas;
end;
$function$;

revoke execute on function public.rotear_pp_para_cartao(uuid, uuid, uuid, uuid) from public;
grant  execute on function public.rotear_pp_para_cartao(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Parcela no cartão não se baixa sozinha
-- ---------------------------------------------------------------------
--
-- Mesma regra da conta avulsa: item de cartão espera a fatura e sai na
-- baixa dela, uma só. Patch cirúrgico em `dar_baixa_pp_parcela`, que é da
-- outra frente — insere a guarda logo depois de a parcela ser carregada,
-- sem tocar em mais nada, e ABORTA se a âncora não estiver lá.
do $migration$
declare
  v_def   text;
  v_ancora text := 'select * into v_parcela from pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception ''Parcela não encontrada.''; end if;';
  v_guarda text := '

  if v_parcela.fatura_cartao_id is not null then
    raise exception ''Parcela paga no cartão não se baixa sozinha: ela espera na aba Cartão e sai na baixa da fatura inteira.'';
  end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dar_baixa_pp_parcela';

  if v_def is null then
    raise exception 'dar_baixa_pp_parcela não existe.';
  end if;
  if position(v_ancora in v_def) = 0 then
    raise exception
      'A âncora esperada não está em dar_baixa_pp_parcela. Confira o corpo dela à mão antes de repetir esta migration.';
  end if;
  if position('Parcela paga no cartão não se baixa sozinha' in v_def) > 0 then
    raise notice 'dar_baixa_pp_parcela já tem a guarda; nada a fazer.';
    return;
  end if;

  execute replace(v_def, v_ancora, v_ancora || v_guarda);
  raise notice 'Guarda de cartão inserida em dar_baixa_pp_parcela.';
end
$migration$;

revoke execute on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant  execute on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;
