-- Decisão 266 — o projeto do job de pagamentos não ganha orçamento novo
-- (18/11/2026).
--
-- O projeto escondido do job de pagamentos tem um orçamento aprovado e
-- vazio, criado por `criar_job_de_pagamentos` (security definer), só para
-- ancorar a planilha do job. Na conferência da versão publicada, o link
-- "Voltar para o orçamento" do job abria esse orçamento com "Editar" e
-- "Duplicar". A tela agora redireciona e as server actions recusam; aqui o
-- banco recusa também: orçamento novo (ou movido) para dentro de projeto de
-- pagamentos só pela função, nunca direto pelo usuário (`authenticated`).
--
-- Aditiva: função e gatilho novos; nenhuma linha muda.

create or replace function public.guarda_orcamento_de_pagamentos()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated'
     and (tg_op = 'INSERT' or new.projeto_id is distinct from old.projeto_id)
     and exists (select 1 from projetos p where p.id = new.projeto_id and p.de_pagamentos) then
    raise exception 'O projeto do job de pagamentos não tem orçamentos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orcamentos_guarda_de_pagamentos on public.orcamentos;
create trigger trg_orcamentos_guarda_de_pagamentos
  before insert or update of projeto_id on public.orcamentos
  for each row execute function public.guarda_orcamento_de_pagamentos();
