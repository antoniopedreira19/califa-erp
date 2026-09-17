-- A marca padrão passa a nascer no BANCO, junto do cliente.
--
-- 17/09/2026, par do `20260917160001_marca_padrao_para_clientes_antigos.sql`.
--
-- Até aqui quem criava a marca padrão era só a server action
-- `criarCliente`: dois INSERTs seguidos, sem transação (PostgREST não
-- dá uma). Se o segundo falhasse, o cliente ficava sem marca e sem como
-- abrir projeto — o próprio código já avisava isso em texto. E qualquer
-- caminho que não fosse aquele formulário (importação, correção manual)
-- nascia torto do mesmo jeito.
--
-- Regra crítica não pode morar só no frontend (CLAUDE.md): o trigger
-- abaixo cria a PRD-01 na mesma transação do INSERT do cliente. A action
-- continua existindo, mas agora ela ENCONTRA a marca em vez de criá-la
-- (ver `app/(app)/clientes/actions.ts`) — e continua criando as marcas
-- extras do formulário, que são PRD-02 em diante.
--
-- A porta da duplicata já estava fechada: `uniq_cliente_produto_padrao`
-- (único parcial em cliente_id where padrao) e `uniq_cliente_produto_codigo`
-- (cliente_id, codigo) existem desde a criação da tabela. Por isso o
-- `on conflict do nothing` abaixo, e por isso a action pode continuar
-- tentando o insert de reserva sem risco de gerar uma segunda padrão.

create or replace function cria_marca_padrao_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `security definer` porque o trigger precisa escrever em
  -- cliente_produtos mesmo quando quem insere o cliente é um caminho
  -- administrativo sem a policy de INSERT da tabela. O tenant vem do
  -- próprio cliente, então não há como escrever no tenant de outro.
  insert into cliente_produtos (tenant_id, cliente_id, nome, codigo, padrao, ativo, created_by)
  values (new.tenant_id, new.id, new.nome_fantasia, 'PRD-01', true, true, new.created_by)
  on conflict do nothing;

  return new;
end;
$$;

comment on function cria_marca_padrao_do_cliente() is
  'Cria a marca padrão (PRD-01, com o nome fantasia) de todo cliente novo. Decisão do Tiago em 17/09/2026: cliente sem marca não abre projeto.';

drop trigger if exists trg_clientes_marca_padrao on clientes;

create trigger trg_clientes_marca_padrao
  after insert on clientes
  for each row
  execute function cria_marca_padrao_do_cliente();
