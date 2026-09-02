-- Servico deixa de ser designacao do PROJETO e passa a ser do ORCAMENTO.
--
-- Ate aqui o Servico era um campo do formulario de projeto e gravava
-- `projetos.categoria_id`. Decisao do Tiago (02/09/2026, design "Projeto e
-- Orcamento - Equipe e Servico"): o servico descreve o trabalho de um job,
-- nao a iniciativa inteira do cliente, entao desce um nivel.
--
-- NAO e a mesma lista da "Categoria" do orcamento, apesar de as duas
-- lerem `categorias_dominio`: a coluna `escopo` ja separa as duas —
--   escopo 'projeto'  -> Always On, Ativacao, Fee, Interno   (Servico)
--   escopo 'orcamento'-> Ativacao, Conteudo, Extra, Influencer (Categoria)
-- Por isso Servico e Categoria podem ficar lado a lado sem repetir opcao,
-- e nenhuma lista nova precisou ser criada.
--
-- Backfill pedido pelo Tiago: todo orcamento existente assume o servico do
-- projeto a que pertence. Sao 17 dos 18 projetos com servico preenchido,
-- entao a lista de projetos continua exibindo exatamente os mesmos valores
-- de antes — a troca de origem nao aparece para quem usa.
--
-- `projetos.categoria_id` NAO e removida: ela guarda o dado historico e
-- remover coluna populada e destrutivo. Fica marcada como legada no
-- comentario. O formulario de projeto para de escrever nela.

alter table public.orcamentos
  add column if not exists servico_id uuid references public.categorias_dominio(id);

update public.orcamentos o
   set servico_id = p.categoria_id
  from public.projetos p
 where p.id = o.projeto_id
   and o.servico_id is null
   and p.categoria_id is not null;

create index if not exists idx_orcamentos_servico
  on public.orcamentos (servico_id);

comment on column public.orcamentos.servico_id is
  'Servico do job deste orcamento. Le categorias_dominio com escopo=projeto (Always On, Ativacao, Fee, Interno) - lista diferente da Categoria, que usa escopo=orcamento. Desceu do projeto em 02/09/2026.';

comment on column public.projetos.categoria_id is
  'LEGADO desde 02/09/2026: era o Servico do projeto. O campo saiu do formulario e virou orcamentos.servico_id. Mantida pelo dado historico; nao escrever mais aqui.';
