-- O freelancer vê o projeto em que está na EQUIPE — a mesma Equipe que a
-- tela do projeto mostra (decisão 037), e não só as linhas gravadas.
--
-- CONTEXTO. `is_freelancer_do_projeto` é o gate row-level do freelancer
-- (migration 20260903120001): sem ele verdadeiro, o freelancer não vê o
-- projeto, os orçamentos, as versões, os itens, os jobs, as PPs nem o
-- chat. Nasceu olhando só `projeto_responsaveis` (papel `gp` ou `equipe`).
--
-- Só que a Equipe do projeto tem dois grupos que NÃO têm linha em
-- `projeto_responsaveis` — são derivados na leitura (decisão 037, regra do
-- Tiago de 02/09/2026):
--   - quem CRIOU o projeto (`projetos.created_by`);
--   - o PRODUTOR de qualquer orçamento do projeto
--     (`orcamentos.produtor_id`, arquivados inclusive — a tela conta todos).
--
-- O seletor de produtor do orçamento e do envio para abertura lista todo
-- membro ativo, freelancer inclusive. Um freelancer escolhido como
-- produtor aparecia na Equipe do projeto como chip travado e, mesmo
-- assim, não via o projeto. O spec de permissões de 03/09/2026 já pedia
-- esses derivados no recorte do freelancer; a função saiu sem eles.
--
-- REGRA (Tiago, 03/10/2026): para o freelancer, o "Meus" é a equipe do
-- projeto — todos os orçamentos do projeto para todos da equipe. O
-- freelancer não tem a chave "Meus/Todos": a lista dele é o que esta
-- função deixa passar.
--
-- EFEITO HOJE: nenhum. Nenhum freelancer criou projeto nem é produtor de
-- orçamento (medido em 03/10/2026); a mudança fecha o caminho para quando
-- for. Os outros papéis não passam por esta função (o CASE das policies
-- só a chama para `freelancer`).
--
-- PERFORMANCE. Continua STABLE + SECURITY DEFINER e com `(select
-- auth.uid())`. Os dois EXISTS novos usam a PK de `projetos` e
-- `idx_orcamentos_projeto` / `idx_orcamentos_produtor`. O ramo de
-- `projeto_responsaveis` segue primeiro — é o caso comum.
--
-- `create or replace` mantém os GRANTs da função como estavam (conferido
-- no `proacl` antes e depois).

create or replace function public.is_freelancer_do_projeto(projeto uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select
    exists (
      select 1
      from public.projeto_responsaveis pr
      where pr.projeto_id = projeto
        and pr.profile_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.projetos p
      where p.id = projeto
        and p.created_by = (select auth.uid())
    )
    or exists (
      select 1
      from public.orcamentos o
      where o.projeto_id = projeto
        and o.produtor_id = (select auth.uid())
    );
$function$;

comment on function public.is_freelancer_do_projeto(uuid) is
  'Gate row-level do freelancer: verdadeiro se o usuário logado está na Equipe do projeto — linha em projeto_responsaveis (gp ou equipe), criador do projeto ou produtor de algum orçamento dele (decisão 037; ampliada em 03/10/2026).';
