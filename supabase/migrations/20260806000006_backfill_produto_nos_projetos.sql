-- =====================================================================
-- Projetos anteriores a 06/08/2026 recebem o produto padrão do cliente
--
-- Produto virou obrigatório no formulário de projeto nesta mesma data, e
-- os projetos já gravados ficaram com `produto_id` nulo — aparecendo com
-- "—" na lista.
--
-- O preenchimento é determinístico, não um palpite: cada cliente tem
-- exatamente um produto padrão (ver 20260806000005), que representa a
-- marca dele. Para um projeto sem produto informado, é a única escolha
-- possível.
--
-- REGIONAL NÃO ENTRA AQUI. Escolher uma regional qualquer seria inventar
-- dado de negócio, e um valor errado não se denuncia: ele desce para o
-- orçamento, o job e o financeiro. Vazio bloqueia a criação de orçamento
-- e obriga alguém a decidir — que é o comportamento correto.
--
-- Idempotente: só toca em quem está com `produto_id` nulo.
-- =====================================================================

update public.projetos p
   set produto_id = cp.id
  from public.cliente_produtos cp
 where cp.cliente_id = p.cliente_id
   and cp.padrao
   and p.produto_id is null;
