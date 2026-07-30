-- Remove a restrição de formato rígido (^[A-Z]{2,6}$) do codigo_curto.
-- Campo aceita qualquer string de 1-50 chars conforme decisão de produto.
alter table public.clientes drop constraint if exists chk_clientes_codigo_curto_formato;
