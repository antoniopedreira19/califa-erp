-- =====================================================================
-- Produto padrão para os clientes já cadastrados
--
-- Origem: decisão de 06/08/2026. Todo cliente passa a nascer com um
-- produto homônimo, criado em `criarCliente`. Esta migration aplica a
-- mesma regra aos clientes que já existiam.
--
-- Motivo: Produto virou obrigatório no formulário de projeto, e cliente
-- sem produto trava a criação de projeto.
--
-- Vale para todos os clientes, ativos ou não (decisão do time). Só entra
-- em quem hoje não tem NENHUM produto — quem já cadastrou o seu fica
-- como está, e o `not exists` também deixa a migration idempotente.
--
-- `created_by` fica nulo de propósito: ninguém criou estes registros.
-- =====================================================================

insert into public.cliente_produtos (tenant_id, cliente_id, nome, codigo)
select c.tenant_id, c.id, c.nome_fantasia, 'PRD-01'
  from public.clientes c
 where not exists (
   select 1 from public.cliente_produtos cp where cp.cliente_id = c.id
 );
