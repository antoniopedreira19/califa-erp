-- =====================================================================
-- Novo vocabulário de Serviço (projeto) e Categoria (orçamento)
--
-- Origem: revisão da tela "Projetos & Orçamentos" (06/08/2026). O time
-- pediu listas fechadas e a EXCLUSÃO das opções que saíram — não
-- inativação. As FKs são `on delete restrict`, então tudo que estiver em
-- uso é remapeado antes de apagar. De-para definido pelo time:
--
--   projeto   · Evento     -> Ativação   (1 projeto)
--   orçamento · Always On  -> Ativação   (2 orçamentos)
--   orçamento · Evento     -> Ativação   (2 orçamentos)
--
--   projeto   final: Ativação, Always On, Fee, Interno
--   orçamento final: Ativação, Extra, Influencer, Conteúdo
--
-- Escopo: todo tenant que já tenha vocabulário cadastrado naquele
-- escopo. Não inventa linhas para tenant que nunca usou a tabela.
--
-- `Always On` sai do escopo orçamento e entra no escopo projeto — são
-- linhas diferentes (a unicidade é por tenant + escopo + nome), não há
-- movimentação de registro entre escopos.
-- =====================================================================

-- 1) Insere as opções novas ---------------------------------------------
insert into public.categorias_dominio (tenant_id, escopo, nome)
select t.tenant_id, 'projeto'::public.categoria_dominio_escopo, v.nome
  from (
    select distinct tenant_id from public.categorias_dominio where escopo = 'projeto'
  ) t
 cross join (values ('Ativação'), ('Always On'), ('Fee'), ('Interno')) as v(nome)
 where not exists (
   select 1 from public.categorias_dominio cd
    where cd.tenant_id = t.tenant_id
      and cd.escopo = 'projeto'
      and lower(cd.nome) = lower(v.nome)
 );

insert into public.categorias_dominio (tenant_id, escopo, nome)
select t.tenant_id, 'orcamento'::public.categoria_dominio_escopo, v.nome
  from (
    select distinct tenant_id from public.categorias_dominio where escopo = 'orcamento'
  ) t
 cross join (values ('Ativação'), ('Extra'), ('Influencer'), ('Conteúdo')) as v(nome)
 where not exists (
   select 1 from public.categorias_dominio cd
    where cd.tenant_id = t.tenant_id
      and cd.escopo = 'orcamento'
      and lower(cd.nome) = lower(v.nome)
 );

-- 2) Remapeia o que está em uso ----------------------------------------
update public.projetos p
   set categoria_id = destino.id
  from public.categorias_dominio origem
  join public.categorias_dominio destino
    on destino.tenant_id = origem.tenant_id
   and destino.escopo = 'projeto'
   and destino.nome = 'Ativação'
 where p.categoria_id = origem.id
   and origem.escopo = 'projeto'
   and origem.nome = 'Evento';

update public.orcamentos o
   set categoria_id = destino.id
  from public.categorias_dominio origem
  join public.categorias_dominio destino
    on destino.tenant_id = origem.tenant_id
   and destino.escopo = 'orcamento'
   and destino.nome = 'Ativação'
 where o.categoria_id = origem.id
   and origem.escopo = 'orcamento'
   and origem.nome in ('Always On', 'Evento');

-- 3) Apaga as opções que saíram ----------------------------------------
-- Se sobrar alguma referência não prevista, o `on delete restrict` faz o
-- DELETE falhar e a migration para — melhor do que apagar dado às cegas.
delete from public.categorias_dominio
 where escopo = 'projeto'
   and nome in ('Campanha', 'Evento', 'Projeto proprietário');

delete from public.categorias_dominio
 where escopo = 'orcamento'
   and nome in ('Always On', 'Evento', 'Mídia');
