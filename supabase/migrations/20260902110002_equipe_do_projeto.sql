-- O projeto ganha EQUIPE, ao lado dos GPs Responsaveis.
--
-- Os dois moram na MESMA tabela (`projeto_responsaveis`), que ate aqui so
-- guardava os GPs e nao tinha como distinguir um do outro. A coluna
-- `papel` faz essa separacao.
--
-- Regra do Tiago (02/09/2026): a Equipe e OBRIGATORIA e nunca fica vazia,
-- porque tres grupos entram nela sozinhos e nao podem ser removidos:
--   - quem criou o projeto        (projetos.created_by)
--   - os GPs Responsaveis         (papel 'gp', aqui)
--   - os produtores dos jobs      (orcamentos.produtor_id)
-- Esses tres sao DERIVADOS na leitura, nao copiados para ca: copiar
-- exigiria re-sincronizar a cada troca de GP ou cada orcamento novo, e a
-- primeira divergencia deixaria a equipe mentindo. Aqui ficam so os
-- ACRESCIMOS manuais, com papel 'equipe'.
--
-- Backfill: toda linha existente e GP — era o unico papel que a tabela
-- tinha ate hoje.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'papel_projeto') then
    create type public.papel_projeto as enum ('gp', 'equipe');
  end if;
end $$;

alter table public.projeto_responsaveis
  add column if not exists papel public.papel_projeto not null default 'gp';

create index if not exists idx_projeto_responsaveis_papel
  on public.projeto_responsaveis (projeto_id, papel);

comment on column public.projeto_responsaveis.papel is
  'gp = GP Responsavel do projeto; equipe = acrescimo manual a Equipe. Criador, GPs e produtores dos orcamentos entram na Equipe por derivacao, sem linha aqui.';
