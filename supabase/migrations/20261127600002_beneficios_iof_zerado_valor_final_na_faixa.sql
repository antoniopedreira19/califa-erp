-- Zera o iof_percentual dos SulAmerica da Agencia California.
--
-- A migration 20261125950001_beneficios_iof_no_valor_integral.sql colocou
-- iof_percentual = 0,0238 porque o modelo supunha que beneficio_faixas_preco
-- guardava o *prêmio sem IOF* da operadora, e o sistema somaria o IOF em cima
-- pra chegar ao valor cobrado.
--
-- A migration 20261127600001_beneficios_reajuste_sulamerica_tabela_oficial.sql
-- (hoje) trocou essa semantica: agora a faixa guarda o valor FINAL da planilha
-- oficial que o RH compartilha com os colaboradores (ex: 29-33 Direto = 688,34,
-- que ja e o valor cobrado, nao o premio bruto).
--
-- Com ambas as camadas ativas, o sistema aplicava IOF em cima de um valor que
-- ja era final (688,34 x 1,0238 = 704,72), divergindo da planilha em 2,38%.
-- Zerar o iof_percentual aqui faz o sistema devolver exatamente o valor da
-- planilha oficial.
--
-- Escopo: apenas tenant Agencia California, para casar com o escopo da
-- migration 20261127600001. O Sandbox mantem a semantica antiga.

update public.beneficios
   set iof_percentual = 0
 where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
   and operadora = 'SulAmerica Saude';
