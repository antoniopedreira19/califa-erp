-- Decisão 184 — conserto da regra do CNPJ da nota do envio (20261016700001).
--
-- A regra "sem CNPJ só com a marca do exterior" foi escrita como
--   (tomador_exterior and cnpj is null) or (not tomador_exterior and cnpj ~ '...')
-- e um CHECK que dá NULO passa: com o CNPJ nulo e a marca desligada, o
-- segundo termo é NULO, e a nota sem CNPJ e sem a marca entrava. Achado na
-- conferência, num insert dentro de transação desfeita; nenhuma linha ficou
-- assim (conferido antes de aplicar).

alter table public.jobs_envio_faturamento_notas
  drop constraint if exists chk_envio_nota_cnpj;
alter table public.jobs_envio_faturamento_notas
  add constraint chk_envio_nota_cnpj
  check (
    (tomador_exterior and cnpj is null)
    or (not tomador_exterior and cnpj is not null and cnpj ~ '^[0-9]{14}$')
  );
