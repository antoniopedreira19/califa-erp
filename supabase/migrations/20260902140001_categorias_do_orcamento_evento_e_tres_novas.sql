-- Categorias do ORCAMENTO: "Ativacao" vira "Evento", e entram tres novas.
--
-- Pedido do Tiago em 02/09/2026. Vale so para o escopo `orcamento` — a
-- lista da CATEGORIA do formulario de orcamento.
--
-- ⚠️ Existe uma segunda "Ativacao" no escopo `projeto`, que e a lista do
-- SERVICO (decisao 037). Ela NAO e tocada aqui: e outro campo, com outro
-- significado, e hoje esta em 35 orcamentos como servico. Por isso todo
-- comando abaixo filtra `escopo = 'orcamento'` explicitamente.
--
-- ⚠️ O rename e em cima da linha existente, e nao uma linha nova: os 23
-- orcamentos e 19 jobs que ja apontam para essa categoria passam a exibir
-- "Evento". E o comportamento pretendido — a categoria e a mesma, mudou o
-- nome dela. Criar "Evento" do zero e inativar "Ativacao" deixaria esses
-- 42 registros rotulados com uma opcao que o formulario nao oferece mais.
--
-- As tres novas nascem no MESMO tenant das que ja existem: a tabela e por
-- tenant, e uma linha sem dono nao apareceria em formulario nenhum.

update public.categorias_dominio
   set nome = 'Evento',
       updated_at = now()
 where escopo = 'orcamento'
   and nome = 'Ativação';

insert into public.categorias_dominio (tenant_id, escopo, nome, ativo)
select distinct c.tenant_id, 'orcamento'::categoria_dominio_escopo, novas.nome, true
  from public.categorias_dominio c
 cross join (values ('Clearance'), ('Prod. Musical'), ('Cachê Artístico')) as novas(nome)
 where c.escopo = 'orcamento'
   and not exists (
     select 1 from public.categorias_dominio existente
      where existente.tenant_id = c.tenant_id
        and existente.escopo = 'orcamento'
        and existente.nome = novas.nome
   );
