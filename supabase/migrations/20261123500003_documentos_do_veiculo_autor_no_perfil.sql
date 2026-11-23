-- Decisão 274 (23/11/2026): quem anexou o documento do veículo aponta para
-- `profiles`, como `jobs_custos_do_socio` e `jobs_envio_faturamento_anexos`
-- — é por essa FK que a tela lê o nome (`autor:profiles!created_by(nome)`).
-- A 20261123500002 tinha apontado para `auth.users`. A tabela nasceu hoje e
-- estava vazia: troca de FK sem dado a mexer.

alter table public.jobs_midia_documentos
  drop constraint if exists jobs_midia_documentos_created_by_fkey;

alter table public.jobs_midia_documentos
  add constraint jobs_midia_documentos_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

create index if not exists idx_jobs_midia_documentos_created_by
  on public.jobs_midia_documentos(created_by);
