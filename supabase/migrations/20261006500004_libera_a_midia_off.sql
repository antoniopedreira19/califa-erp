-- =====================================================================
-- Libera a categoria Mídia Off (decisões 131 e 147)
--
-- A decisão 131 deixou a categoria "Mídia Off" pronta e travada como
-- "em breve", com modelo_planilha = 'nacional' só porque o enum precisava
-- de um valor, e combinou o caminho: o valor 'midia_off' no enum numa
-- migration sozinha (20261006500001) e, depois, esta troca, junto do
-- código da planilha (decisão 147).
--
-- A categoria não tem orçamento nenhum (conferido em 06/10/2026), então
-- nada muda de planilha. É uma mudança de configuração, combinada com o
-- Tiago: aplicar só com o código da decisão 147 publicado — com o código
-- antigo, a categoria liberada apareceria para escolha numa tela que não
-- sabe montar a planilha dela.
--
-- O alvo é pela marca, e não por id: a categoria exclusiva do serviço
-- Mídia que está "em breve" (decisão 131). Os gatilhos de trava da
-- categoria deixam a migration passar (só travam `authenticated`).
-- =====================================================================

update public.categorias_dominio c
   set modelo_planilha = 'midia_off',
       em_breve = false
  from public.categorias_dominio s
 where s.id = c.servico_exclusivo_id
   and c.escopo = 'orcamento'
   and c.em_breve
   and c.nome = 'Mídia Off'
   and s.nome = 'Mídia'
   and not exists (select 1 from public.orcamentos o where o.categoria_id = c.id);
