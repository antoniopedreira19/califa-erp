-- =====================================================================
-- Vocabulário inicial de categoria de JOB
--
-- Migration separada da que criou o valor 'job' no enum: valor novo de
-- enum não pode ser usado na mesma transação em que é criado.
--
-- A lista abaixo veio do design da tela de abertura de job. É um ponto
-- de partida para a tela não nascer com um select vazio (sem categoria
-- nenhuma cadastrada, nenhum job poderia ser aberto). O financeiro
-- edita, inativa e acrescenta em Cadastros › Categorias de domínio —
-- nada aqui é fixo no código.
--
-- Idempotente: não duplica o que já existir (unicidade é por tenant +
-- escopo + nome em minúsculas).
-- =====================================================================

insert into public.categorias_dominio (tenant_id, escopo, nome)
select t.id, 'job'::public.categoria_dominio_escopo, v.nome
  from public.tenants t
 cross join (values
   ('Evento'),
   ('Ativação de marca'),
   ('Conteúdo · Digital'),
   ('Trade · PDV'),
   ('Fee mensal')
 ) as v(nome)
 where not exists (
   select 1 from public.categorias_dominio cd
    where cd.tenant_id = t.id
      and cd.escopo = 'job'
      and lower(cd.nome) = lower(v.nome)
 );
