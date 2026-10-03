-- =============================================================================
-- Módulo fiscal — pontos remanescentes do protótipo (decisão 142), 02/10/2026
-- O regime do fornecedor guarda o que a consulta do CNPJ indicou, e a
-- declaração de optante do Simples ganha o arquivo.
-- =============================================================================
--
-- Por quê
-- -------
-- O protótipo aprovado mostra, embaixo do regime do fornecedor, "Preenchido
-- pela consulta do CNPJ em dd/mm/aaaa · optante do Simples desde mm/aaaa"
-- (ou "· MEI desde mm/aaaa", ou "· não optante do Simples") e, quando alguém
-- troca o regime à mão, "Alterado manualmente — a consulta do CNPJ em
-- dd/mm/aaaa indicou X" — inclusive ao reabrir o cadastro. Até aqui o banco
-- só guardava o dia da consulta, e só quando o regime gravado era o que ela
-- indicou: o "desde" não existia e o aviso âmbar sumia depois de salvar.
--
-- - `regime_consulta`: o regime que a consulta do CNPJ indicou (normal,
--   simples ou mei). `regime_consultado_em` passa a ser o dia dessa consulta,
--   valha ou não o regime gravado.
-- - `regime_desde`: a data de opção pelo Simples ou pelo MEI que a consulta
--   trouxe (`data_opcao_pelo_simples` / `data_opcao_pelo_mei` da BrasilAPI).
-- - O arquivo da declaração de optante (IN SRF 459, anexo I) usa a coluna
--   `declaracao_simples_path`, que existe desde a entrega 1 sem tela; ele
--   vai para o bucket privado `fornecedores`, em `<tenant>/declaracoes/`.
--
-- Aditiva: duas colunas anuláveis; o preenchimento só escreve onde estava
-- vazio (o cadastro com `regime_consultado_em` gravou o regime que a
-- consulta indicou — a regra de até hoje); bucket e policies novos. O acesso
-- ao arquivo espelha o de `fornecedores` (qualquer membro do tenant edita o
-- cadastro). Sem GRANT novo: as colunas herdam os da tabela.
-- =============================================================================

alter table public.fornecedores
  add column if not exists regime_consulta text,
  add column if not exists regime_desde    date;

alter table public.fornecedores
  drop constraint if exists chk_fornecedor_regime_consulta,
  add constraint chk_fornecedor_regime_consulta
    check (regime_consulta is null or regime_consulta in ('normal', 'simples', 'mei'));

comment on column public.fornecedores.regime_consulta is
  'O regime que a consulta do CNPJ (BrasilAPI) indicou: normal, simples ou mei. Diferente de regime_tributario = alterado manualmente (módulo fiscal, decisão 142).';
comment on column public.fornecedores.regime_desde is
  'A data de opção pelo Simples ou pelo MEI que a consulta do CNPJ trouxe ("optante do Simples desde mm/aaaa"). Nula no regime normal ou sem a data (decisão 142).';
comment on column public.fornecedores.regime_consultado_em is
  'O dia da consulta do CNPJ que deu regime_consulta (decisão 142; até ela, só era gravado quando o regime gravado era o indicado).';

-- O que a consulta indicou, onde já se sabe: pela regra de até hoje, quem tem
-- `regime_consultado_em` gravou o regime que a consulta indicou.
update public.fornecedores
   set regime_consulta = regime_tributario
 where regime_consulta is null
   and regime_consultado_em is not null
   and regime_tributario is not null;

-- O arquivo da declaração: bucket privado `fornecedores`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fornecedores', 'fornecedores', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists fornecedores_storage_select on storage.objects;
create policy fornecedores_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'fornecedores'
         and public.is_tenant_member((split_part(name, '/', 1))::uuid));

drop policy if exists fornecedores_storage_insert on storage.objects;
create policy fornecedores_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fornecedores'
              and public.is_tenant_member((split_part(name, '/', 1))::uuid));

drop policy if exists fornecedores_storage_delete on storage.objects;
create policy fornecedores_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'fornecedores'
         and public.is_tenant_member((split_part(name, '/', 1))::uuid));
