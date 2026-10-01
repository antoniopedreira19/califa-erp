-- Decisão 136, parte 4 (01/10/2026): os chats mostram o cargo de quem
-- escreveu, ao lado do nome ("Tiago Mendonça · Administrador").
--
-- O nome já aparecia; o rótulo ao lado da hora ("Produção" ou
-- "Financeiro") é o lado de onde a mensagem saiu, não o cargo. Com qualquer
-- GP agindo em qualquer job, o financeiro precisa saber se quem escreveu é
-- GP, produtor ou administrador.
--
-- `jobs_mensagens.autor_papel` guarda o cargo NO MOMENTO do envio: quem
-- muda de papel depois não reescreve o que já disse. Um gatilho BEFORE
-- INSERT preenche a coluna pelo vínculo do autor com o tenant — o valor que
-- vier da aplicação é ignorado, para ninguém escolher o próprio cargo.
-- As mensagens que já existem recebem o cargo atual do autor (combinado com
-- o Tiago no protótipo).
--
-- Mudança aditiva: coluna nova, preenchimento só do vazio, gatilho novo.
-- Nada muda nas policies: o insert continua exigindo autor_id = auth.uid().

alter table public.jobs_mensagens
  add column if not exists autor_papel public.app_role;

comment on column public.jobs_mensagens.autor_papel is
  'Cargo do autor no momento do envio, gravado pelo gatilho trg_jobs_mensagens_autor_papel. Mensagens anteriores a 01/10/2026 receberam o cargo atual do autor. Decisão 136.';

update public.jobs_mensagens m
   set autor_papel = tm.role
  from public.tenant_members tm
 where tm.user_id = m.autor_id
   and tm.tenant_id = m.tenant_id
   and m.autor_papel is null;

create or replace function public.jobs_mensagens_autor_papel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.autor_papel := (
    select tm.role
      from public.tenant_members tm
     where tm.user_id = new.autor_id
       and tm.tenant_id = new.tenant_id
     limit 1
  );
  return new;
end;
$$;

comment on function public.jobs_mensagens_autor_papel() is
  'Grava em jobs_mensagens.autor_papel o cargo do autor no tenant, no momento do envio. Decisão 136.';

drop trigger if exists trg_jobs_mensagens_autor_papel on public.jobs_mensagens;
create trigger trg_jobs_mensagens_autor_papel
  before insert on public.jobs_mensagens
  for each row execute function public.jobs_mensagens_autor_papel();

revoke all on function public.jobs_mensagens_autor_papel() from public, anon, authenticated;
