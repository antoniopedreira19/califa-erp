-- =====================================================================
-- RH — CPF e CNPJ viram colunas separadas + campo de telefone.
-- =====================================================================
--
-- Decisão travada em 2026-09-25:
--   1. CPF é sempre obrigatório no cadastro (regra app-level; no banco
--      fica nullable pra permitir os 20 legados sem CPF continuarem
--      até serem completados).
--   2. Se o colaborador é PJ (pj ou clt_recibo), CNPJ também é
--      obrigatório app-level — CPF do sócio + CNPJ da razão social.
--   3. Telefone é novo campo, sempre opcional, formato BR (10 ou 11
--      dígitos — fixo ou celular; não força +55, prefixo é implícito).
--
-- Estado do banco antes desta migration:
--   - 184 colaboradores com cpf_cnpj (todos 11 dígitos = CPF).
--   - 0 colaboradores com 14 dígitos (nenhum CNPJ registrado).
--   - Rename cpf_cnpj -> cpf é lossless.
--
-- Constraints e índices reciclados: o CHECK antigo aceitava ambos
-- formatos na mesma coluna; agora um CHECK por coluna. Unique index
-- parcial vira dois — CPF por tenant e CNPJ por tenant.
-- =====================================================================

-- Rename da coluna existente
alter table public.colaboradores
  rename column cpf_cnpj to cpf;

-- Novas colunas
alter table public.colaboradores
  add column if not exists cnpj text,
  add column if not exists telefone text;

-- Drop constraint antiga
alter table public.colaboradores
  drop constraint if exists chk_colaboradores_cpf_cnpj_formato;

-- Novas constraints de formato
alter table public.colaboradores
  add constraint chk_colaboradores_cpf_formato
  check (cpf is null or cpf ~ '^[0-9]{11}$');

alter table public.colaboradores
  add constraint chk_colaboradores_cnpj_formato
  check (cnpj is null or cnpj ~ '^[0-9]{14}$');

alter table public.colaboradores
  add constraint chk_colaboradores_telefone_formato
  check (telefone is null or telefone ~ '^[0-9]{10,11}$');

-- Substitui unique index parcial (era em cpf_cnpj) por dois — um pra CPF e
-- um pra CNPJ, cada um único por tenant quando preenchido.
drop index if exists public.uniq_colaboradores_documento_por_tenant;

create unique index if not exists uniq_colaboradores_cpf_por_tenant
  on public.colaboradores (tenant_id, cpf)
  where cpf is not null;

create unique index if not exists uniq_colaboradores_cnpj_por_tenant
  on public.colaboradores (tenant_id, cnpj)
  where cnpj is not null;

comment on column public.colaboradores.cpf is
  'CPF do colaborador (pessoa física). Obrigatório no cadastro novo desde 2026-09-25; 20 legados ainda estão null (pendência).';
comment on column public.colaboradores.cnpj is
  'CNPJ da razão social — obrigatório app-level quando tipo_contratacao é pj ou clt_recibo. Null pros demais tipos.';
comment on column public.colaboradores.telefone is
  'Telefone BR (10 dig fixo ou 11 dig celular), só dígitos, sem +55. Opcional; entra como pendência Nível 2 quando ausente.';
