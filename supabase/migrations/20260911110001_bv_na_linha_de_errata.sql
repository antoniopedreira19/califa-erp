-- =====================================================================
-- O BV deixa de depender da versão aprovada
--
-- A decisão 071, de ontem, consertou a gravação do BV pela planilha do
-- job e, de passagem, FECHOU a linha nascida de errata: sem
-- `item_versao_id` não havia onde endereçar, então a calha deixou de
-- oferecer o botão. Ficou registrado lá como pergunta de negócio.
--
-- Respondida em 11/09/2026: o BV não depende de a linha ter vindo da
-- versão aprovada. Qualquer linha da planilha do job aceita BV, desde
-- que o TIPO DE CUSTO permita — A, A - Repasse (AR) e D, que são
-- justamente aqueles em que o cliente paga o fornecedor direto e existe
-- comissão a negociar. B, C, F e FI passam pela California e usam Pedido
-- de Produção no lugar do BV; para eles nada muda.
--
-- `itens_bv` já tinha as duas chaves desde 27/08 (`item_versao_id` e
-- `job_item_orcado_id`), ambas opcionais e indexadas — a tabela não
-- muda. Quem barrava era este trigger, que resolvia o item SEMPRE por
-- `versoes_orcamento_itens` e levantava "Item da versao nao encontrado."
-- quando a chave vinha nula.
--
-- O QUE MUDA
--
-- 1. A função passa a resolver o item pelas DUAS chaves. Com
--    `item_versao_id`, o caminho é o de sempre (inclusive a regra de
--    27/08 em que a errata de TIPO na cópia do job destrava um item que
--    a versão tinha como B ou C). Sem ela, a cópia do job é a única
--    fonte: tipo, tenant e `em_save` saem de `jobs_itens_orcado`.
--
-- 2. O trigger passa a disparar também em UPDATE de
--    `job_item_orcado_id`. Antes ele vigiava só `item_versao_id` e
--    `tenant_id`; com a chave do job virando endereço de gravação, mover
--    um BV de uma cópia para outra precisa reavaliar o tipo.
--
-- 3. Nasce `chk_bv_tem_item`: pelo menos uma das duas chaves precisa
--    estar preenchida. Hoje as duas são opcionais e nada impedia um BV
--    órfão — sem item em lugar nenhum, invisível nas duas telas e
--    somando no lugar errado. Os 10 BVs existentes têm `item_versao_id`,
--    então a constraint entra sem tocar em dado.
--
-- Tudo aditivo: nenhuma coluna sai, nenhum valor existente é
-- sobrescrito, e nenhum BV de hoje muda de endereço.
--
-- Decisão 073.
-- =====================================================================

-- 1) o item se resolve pelas duas chaves --------------------------------
create or replace function public.bv_exige_item_com_bv()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tipo   public.tipo_custo;
  v_tenant uuid;
  v_aceita boolean;
  v_em_save boolean;
begin
  -- Sem nenhuma das duas chaves o BV não tem item: não apareceria em
  -- tela nenhuma e ninguém saberia a que serviço a comissão se refere.
  if new.item_versao_id is null and new.job_item_orcado_id is null then
    raise exception 'BV precisa apontar para um item: o da versao ou o da planilha do job.';
  end if;

  if new.item_versao_id is not null then
    -- Caminho histórico: o item vive na versão aprovada.
    select tipo_custo, tenant_id, em_save
      into v_tipo, v_tenant, v_em_save
      from public.versoes_orcamento_itens
     where id = new.item_versao_id;

    if v_tipo is null then
      raise exception 'Item da versao nao encontrado.';
    end if;

    if not coalesce(v_em_save, false) then
      select exists (
        select 1 from public.jobs_itens_orcado o
         where o.item_versao_id = new.item_versao_id and o.em_save
      ) into v_em_save;
    end if;

    v_aceita := v_tipo in ('A', 'AR', 'D');

    -- Depois da abertura quem manda é a cópia: a errata pode ter mudado
    -- o tipo lá, e a versão aprovada não acompanha de propósito.
    if not v_aceita then
      select exists (
        select 1 from public.jobs_itens_orcado o
         where o.item_versao_id = new.item_versao_id
           and o.tipo_custo in ('A', 'AR', 'D')
      ) into v_aceita;
    end if;
  else
    -- Linha nascida de errata: a cópia do job é a única fonte que existe.
    select tipo_custo, tenant_id, em_save
      into v_tipo, v_tenant, v_em_save
      from public.jobs_itens_orcado
     where id = new.job_item_orcado_id;

    if v_tipo is null then
      raise exception 'Item da planilha do job nao encontrado.';
    end if;

    v_aceita := v_tipo in ('A', 'AR', 'D');
  end if;

  if coalesce(v_em_save, false) then
    raise exception 'Linha em save nao aceita BV: o servico nao acontece neste projeto, entao nao ha fornecedor com quem negociar comissao.';
  end if;

  if not v_aceita then
    raise exception 'BV so pode ser lancado em item de custo tipo A, A - Repasse ou D.';
  end if;

  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end;
$function$;

comment on function public.bv_exige_item_com_bv() is
  'Valida o item do BV pelas duas chaves (versao ou copia do job), o tipo de custo (A, AR, D), a linha em save e o tenant. Decisao 073.';

-- Trigger function: o `anon` nao tem o que fazer com ela, e o PostgREST
-- nem publica funcao que retorna trigger. Explicito mesmo assim, para a
-- varredura de 31/08 nao precisar voltar aqui.
revoke execute on function public.bv_exige_item_com_bv() from public;

-- 2) a chave do job tambem e' vigiada -----------------------------------
drop trigger if exists trg_itens_bv_tipo_com_bv on public.itens_bv;
create trigger trg_itens_bv_tipo_com_bv
  before insert or update of item_versao_id, job_item_orcado_id, tenant_id
  on public.itens_bv
  for each row execute function public.bv_exige_item_com_bv();

-- 3) BV sem item nenhum deixa de ser possivel ---------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.itens_bv'::regclass
       and conname = 'chk_bv_tem_item'
  ) then
    alter table public.itens_bv
      add constraint chk_bv_tem_item
      check (item_versao_id is not null or job_item_orcado_id is not null);
  end if;
end $$;
