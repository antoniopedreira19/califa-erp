-- =====================================================================
-- Estruturas do arquivo de remessa: código de barras + cnab_remessas
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Fase 4.3 do módulo pgto-remessa. Duas coisas independentes que
-- entram juntas porque uma sem a outra não gera nem uma linha do
-- arquivo:
--
-- 1) CÓDIGO DE BARRAS em pedidos_compra e contas_avulsas.
--    Boleto no CNAB (Segmento J, forma 30/31) EXIGE o código de
--    barras de 44 dígitos (não a linha digitável de 47). Sem esse
--    campo, títulos pagos por boleto não entram no arquivo. Nullable
--    porque só faz sentido quando forma_pagamento = 'boleto'.
--
-- 2) cnab_remessas + cnab_remessas_itens — rastreio dos arquivos.
--    Sem essas tabelas, não há como amarrar "esse título foi pago
--    via esse arquivo", nem controlar sequencial (Nota G010 do
--    manual: número duplicado é erro do banco), nem re-processar
--    retorno na fase 2 do módulo.
--
-- RLS das duas tabelas novas segue o padrão do resto de contas a
-- pagar: is_tenant_member gate + permissão finegrained via check por
-- permissao específica no server action.
--
-- Aditiva pura:
--   • 2 colunas novas (uma em pedidos_compra_parcelas, uma em
--     contas_avulsas) com CHECK opcional de 44 dígitos
--   • 2 tabelas novas com RLS
--   • índices e comments
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Código de barras para boleto
-- ---------------------------------------------------------------------

alter table public.pedidos_compra_parcelas
  add column if not exists codigo_barras text;

comment on column public.pedidos_compra_parcelas.codigo_barras is
  '44 dígitos do código de barras do boleto que paga essa parcela. '
  'Preenchido quando forma_pagamento da PP é boleto. Diferente da linha '
  'digitável (47 dígitos, com DVs de campo) — o CNAB exige o código '
  'compactado. Nota G008 do manual Santander.';

alter table public.pedidos_compra_parcelas
  drop constraint if exists chk_pp_parcelas_codigo_barras_formato;

alter table public.pedidos_compra_parcelas
  add constraint chk_pp_parcelas_codigo_barras_formato
    check (codigo_barras is null or codigo_barras ~ '^[0-9]{44}$');

alter table public.contas_avulsas
  add column if not exists codigo_barras text;

comment on column public.contas_avulsas.codigo_barras is
  '44 dígitos do código de barras do boleto que paga essa conta avulsa. '
  'Preenchido quando forma_pagamento é boleto. Formato idêntico ao de PP.';

alter table public.contas_avulsas
  drop constraint if exists chk_contas_avulsas_codigo_barras_formato;

alter table public.contas_avulsas
  add constraint chk_contas_avulsas_codigo_barras_formato
    check (codigo_barras is null or codigo_barras ~ '^[0-9]{44}$');

-- ---------------------------------------------------------------------
-- 2. cnab_remessas — cabeçalho de cada arquivo gerado
-- ---------------------------------------------------------------------

create table if not exists public.cnab_remessas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  empresa_contabil_id uuid not null references public.empresas_contabeis(id) on delete restrict,
  sequencial_arquivo integer not null,
  data_geracao timestamptz not null default now(),
  hash_arquivo text not null,
  path_storage text,
  qtd_itens integer not null,
  valor_total numeric(16,2) not null,
  status text not null default 'gerado',
  gerado_por uuid not null references auth.users(id) on delete restrict,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_cnab_remessas_status
    check (status in ('gerado', 'enviado_banco', 'processado', 'cancelado')),
  constraint chk_cnab_remessas_sequencial_positivo
    check (sequencial_arquivo >= 11),
  constraint uniq_cnab_remessas_sequencial
    unique (empresa_contabil_id, sequencial_arquivo)
);

comment on table public.cnab_remessas is
  'Cabecalho de cada arquivo .REM gerado. Uma linha por arquivo. '
  'Sequencial único por empresa contábil — o banco rejeita repetido. '
  'hash_arquivo é sha256 do conteúdo pra detectar duplicidade e '
  'auditoria. status: gerado (default) → enviado_banco → processado '
  '(quando o .RET voltar, fase 2 do módulo).';

comment on column public.cnab_remessas.hash_arquivo is
  'SHA256 hex do conteúdo do arquivo (240 bytes × N linhas). Serve pra '
  'detectar geração duplicada e pra auditoria.';
comment on column public.cnab_remessas.path_storage is
  'Path no Supabase Storage bucket. Null enquanto arquivo não foi '
  'gravado (na fase de geração o registro do banco entra antes do upload).';

create index if not exists idx_cnab_remessas_tenant
  on public.cnab_remessas (tenant_id, data_geracao desc);
create index if not exists idx_cnab_remessas_empresa
  on public.cnab_remessas (empresa_contabil_id, sequencial_arquivo desc);

alter table public.cnab_remessas enable row level security;

drop policy if exists cnab_remessas_select on public.cnab_remessas;
create policy cnab_remessas_select on public.cnab_remessas
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists cnab_remessas_insert on public.cnab_remessas;
create policy cnab_remessas_insert on public.cnab_remessas
  for insert
  to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists cnab_remessas_update on public.cnab_remessas;
create policy cnab_remessas_update on public.cnab_remessas
  for update
  to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.cnab_remessas to authenticated;

-- ---------------------------------------------------------------------
-- 3. cnab_remessas_itens — linhas de cada arquivo
-- ---------------------------------------------------------------------

create table if not exists public.cnab_remessas_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  remessa_id uuid not null references public.cnab_remessas(id) on delete cascade,
  origem_tipo text not null,
  origem_id uuid not null,
  forma_pagamento public.forma_pagamento not null,
  destinatario_tipo text not null,
  destinatario_id uuid not null,
  valor numeric(14,2) not null,
  data_pagamento date not null,
  numero_documento_banco text,
  ocorrencia_retorno text,
  ocorrencia_data timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_cnab_itens_origem_tipo
    check (origem_tipo in ('pp', 'avulsa', 'recorrente', 'desembolso')),
  constraint chk_cnab_itens_destinatario_tipo
    check (destinatario_tipo in ('fornecedor', 'colaborador', 'cliente')),
  constraint chk_cnab_itens_forma_pagamento
    check (forma_pagamento in ('boleto', 'pix', 'transferencia'))
);

comment on table public.cnab_remessas_itens is
  'Uma linha por título incluído no arquivo. Amarra o título de '
  'origem (pp/avulsa/desembolso) ao arquivo em que foi pago, com o '
  '"nosso número" atribuído pelo gerador. ocorrencia_retorno é '
  'preenchida na fase 2 do módulo (parse do .RET).';

comment on column public.cnab_remessas_itens.origem_tipo is
  'pp | avulsa | recorrente | desembolso — bate com o vw_a_pagar.origem_tipo.';
comment on column public.cnab_remessas_itens.numero_documento_banco is
  'Nosso número atribuido pelo gerador — vira o Segmento A / J posições '
  '"Nro. do Documento Banco". Único dentro do convênio.';
comment on column public.cnab_remessas_itens.ocorrencia_retorno is
  'Código de 2 dígitos do retorno CNAB (ex.: 00 = pago, 01 = insuf. de '
  'fundos, AT = beneficiário divergente). Null enquanto não processado.';

create index if not exists idx_cnab_itens_remessa
  on public.cnab_remessas_itens (remessa_id);
create index if not exists idx_cnab_itens_origem
  on public.cnab_remessas_itens (origem_tipo, origem_id);
create index if not exists idx_cnab_itens_destinatario
  on public.cnab_remessas_itens (destinatario_tipo, destinatario_id);

alter table public.cnab_remessas_itens enable row level security;

drop policy if exists cnab_itens_select on public.cnab_remessas_itens;
create policy cnab_itens_select on public.cnab_remessas_itens
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists cnab_itens_insert on public.cnab_remessas_itens;
create policy cnab_itens_insert on public.cnab_remessas_itens
  for insert
  to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists cnab_itens_update on public.cnab_remessas_itens;
create policy cnab_itens_update on public.cnab_remessas_itens
  for update
  to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.cnab_remessas_itens to authenticated;
