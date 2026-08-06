-- =====================================================================
-- Produto padrão: existe para todo cliente e é imutável
--
-- Origem: decisão de 06/08/2026. O produto homônimo representa a MARCA
-- do cliente — a matriz, quando não há outras marcas no guarda-chuva.
-- Por isso ele existe em todo cliente (inclusive nos que já têm outros
-- produtos) e ninguém pode apagar, inativar ou renomear.
--
-- A migration anterior (20260806000004) só cobria cliente sem NENHUM
-- produto e identificava o padrão por convenção (nome igual ao do
-- cliente). Convenção não é garantia: agora existe a coluna `padrao`.
--
-- A proteção mora num trigger, não só na server action: `CLAUDE.md` pede
-- que regra crítica não dependa do frontend, e aqui nem da API — vale
-- também para acesso direto ao banco.
--
-- A única mudança permitida no nome é a que acompanha o nome fantasia do
-- cliente: `atualizarCliente` renomeia o padrão logo depois de gravar o
-- cliente, e nesse momento os dois nomes batem.
-- =====================================================================

-- 1) coluna ------------------------------------------------------------
alter table public.cliente_produtos
  add column if not exists padrao boolean not null default false;

comment on column public.cliente_produtos.padrao is
  'Produto que representa a marca do cliente. Um por cliente, imutável, criado junto com o cliente.';

-- Um padrão por cliente. Índice parcial: os produtos comuns não entram.
create unique index if not exists uniq_cliente_produto_padrao
  on public.cliente_produtos(cliente_id) where padrao;

-- 2) Backfill: promove o homônimo que já existe ------------------------
-- Roda antes do trigger existir, senão a própria promoção seria barrada.
update public.cliente_produtos cp
   set padrao = true, ativo = true
  from public.clientes c
 where c.id = cp.cliente_id
   and lower(cp.nome) = lower(c.nome_fantasia)
   and not exists (
     select 1 from public.cliente_produtos x
      where x.cliente_id = cp.cliente_id and x.padrao
   );

-- 3) Backfill: cria para quem ficou sem -------------------------------
-- Inclui cliente que já tem outros produtos — daí o código ser o próximo
-- PRD-NN livre, e não PRD-01 fixo.
insert into public.cliente_produtos (tenant_id, cliente_id, nome, codigo, padrao)
select c.tenant_id,
       c.id,
       c.nome_fantasia,
       'PRD-' || lpad(
         ((select count(*) from public.cliente_produtos cp2 where cp2.cliente_id = c.id) + 1)::text,
         2, '0'
       ),
       true
  from public.clientes c
 where not exists (
   select 1 from public.cliente_produtos cp
    where cp.cliente_id = c.id and cp.padrao
 );

-- 4) Trigger de proteção ----------------------------------------------
create or replace function public.protege_produto_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nome_cliente text;
begin
  if tg_op = 'DELETE' then
    if old.padrao then
      raise exception 'produto_padrao_protegido: o produto padrão do cliente não pode ser removido';
    end if;
    return old;
  end if;

  if old.padrao then
    if new.padrao is distinct from true then
      raise exception 'produto_padrao_protegido: este produto não pode deixar de ser o padrão do cliente';
    end if;
    if new.ativo is distinct from true then
      raise exception 'produto_padrao_protegido: o produto padrão não pode ser inativado';
    end if;
    if new.cliente_id is distinct from old.cliente_id then
      raise exception 'produto_padrao_protegido: o produto padrão não pode mudar de cliente';
    end if;
    if new.codigo is distinct from old.codigo then
      raise exception 'produto_padrao_protegido: o código do produto padrão não pode mudar';
    end if;

    -- Renome só passa quando é o que acompanha o cliente. Atualizações
    -- que não mexem no nome seguem em frente sem consultar `clientes`.
    if new.nome is distinct from old.nome then
      select c.nome_fantasia into nome_cliente
        from public.clientes c where c.id = new.cliente_id;
      if new.nome is distinct from nome_cliente then
        raise exception 'produto_padrao_protegido: o nome do produto padrão acompanha o nome fantasia do cliente';
      end if;
    end if;
  elsif new.padrao then
    raise exception 'produto_padrao_protegido: o padrão é definido na criação do cliente';
  end if;

  return new;
end$$;

-- Função de trigger não é RPC. Sem o revoke ela fica chamável em
-- `/rest/v1/rpc/protege_produto_padrao` — o advisor de segurança do
-- Supabase aponta isso (`anon_security_definer_function_executable`).
-- O trigger continua disparando: quem executa é o dono da tabela, não
-- quem faz o UPDATE.
revoke execute on function public.protege_produto_padrao() from public, anon, authenticated;

-- SECURITY DEFINER é proposital: a função lê `clientes` para conferir o
-- nome fantasia, e com INVOKER uma RLS restritiva devolveria NULL e
-- barraria um rename legítimo.

drop trigger if exists trg_cliente_produtos_padrao on public.cliente_produtos;
create trigger trg_cliente_produtos_padrao
  before update or delete on public.cliente_produtos
  for each row execute function public.protege_produto_padrao();
