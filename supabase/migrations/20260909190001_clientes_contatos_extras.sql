-- Contatos adicionais do cliente — desenho "Clientes - Novo Cadastro"
-- (projeto Claude Design 69342d83), decisão do Tiago em 09/09/2026.
--
-- O formulário passou a ter "Adicionar e-mail" e "Adicionar telefone".
-- O contato principal continua nas colunas `email`/`telefone` que já
-- existem; o que se repete entra aqui.
--
-- Por que array e não tabela `cliente_contatos`:
--   * O PostgREST não dá transação. Uma tabela filha faria o cliente e
--     os contatos gravarem em round-trips separados, com o risco de
--     salvar pela metade — o mesmo beco que o produto padrão já tem
--     documentado em `criarCliente`. Em coluna, o contato vai no mesmo
--     INSERT/UPDATE do cliente: ou grava tudo, ou não grava nada.
--   * Não há necessidade de rótulo ("financeiro", "comercial") nem de
--     ordem explícita — a ordem do array já é a que a tela mostra.
--
-- Aditiva: coluna nova, NOT NULL com default '{}', nenhum dado dos 157
-- clientes existentes é tocado.

alter table public.clientes
  add column if not exists emails_extras text[] not null default '{}',
  add column if not exists telefones_extras text[] not null default '{}';

comment on column public.clientes.emails_extras is
  'E-mails adicionais do cliente, além de `email` (o principal). Sem rótulo: a ordem do array é a ordem da tela.';
comment on column public.clientes.telefones_extras is
  'Telefones adicionais do cliente, além de `telefone` (o principal). Guardados só com dígitos, como a coluna principal.';

-- Entrada em branco não tem por que existir: a action já descarta, e o
-- banco é a última barreira.
alter table public.clientes
  drop constraint if exists clientes_emails_extras_sem_vazio;
alter table public.clientes
  add constraint clientes_emails_extras_sem_vazio
  check (array_position(emails_extras, '') is null and array_position(emails_extras, null) is null);

alter table public.clientes
  drop constraint if exists clientes_telefones_extras_sem_vazio;
alter table public.clientes
  add constraint clientes_telefones_extras_sem_vazio
  check (array_position(telefones_extras, '') is null and array_position(telefones_extras, null) is null);

-- Regra transversal do projeto: authenticated enxerga, anon não.
grant select, insert, update, delete on public.clientes to authenticated;
revoke all on public.clientes from anon;
