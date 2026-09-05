-- Cidades: adiciona UF, código IBGE e fonte pra suportar combobox híbrido
-- (local + sugestões do IBGE) no campo Cidade do orçamento.
--
-- Racional: o cadastro nasceu como vocabulário manual e o produtor fica
-- travado quando digita uma cidade que não existe — hoje precisa sair do
-- formulário, ir em /cadastros/cidades, criar, voltar e escolher. A partir
-- desta migration o combobox pode oferecer sugestões da API do IBGE
-- (5.570 municípios) e criar o registro em 1 clique, sem perder contexto.
--
-- Modelagem:
--   uf          → 2 chars (RJ, BA...). Null pra manuais legadas ou pontos
--                 fora do mapa ("Matriz Interna").
--   ibge_codigo → 7 dígitos. Null quando fonte=manual.
--   fonte       → 'manual' (usuário digitou) ou 'ibge' (veio da API).
--
-- Cidades homônimas em UFs diferentes ("Santo Antônio" em BA/PB/RS) passam
-- a coexistir — o unique passa a considerar UF (com NULLS NOT DISTINCT
-- pra preservar unicidade de manuais sem UF, PG15+).
--
-- O backfill das 8 cidades já cadastradas (Salvador, SP, RJ...) roda por
-- fora, via MCP, pra não amarrar hardcode do mapeamento IBGE aqui.

alter table public.cidades
  add column if not exists uf char(2),
  add column if not exists ibge_codigo text,
  add column if not exists fonte text not null default 'manual';

alter table public.cidades
  drop constraint if exists cidades_uf_2_chars,
  drop constraint if exists cidades_ibge_codigo_7_digits,
  drop constraint if exists cidades_fonte_valida,
  drop constraint if exists cidades_ibge_tem_codigo_e_uf;

alter table public.cidades
  add constraint cidades_uf_2_chars
    check (uf is null or uf ~ '^[A-Z]{2}$'),
  add constraint cidades_ibge_codigo_7_digits
    check (ibge_codigo is null or ibge_codigo ~ '^[0-9]{7}$'),
  add constraint cidades_fonte_valida
    check (fonte in ('manual', 'ibge')),
  -- Cidade importada do IBGE sempre carrega o par completo.
  add constraint cidades_ibge_tem_codigo_e_uf
    check (fonte <> 'ibge' or (ibge_codigo is not null and uf is not null));

comment on column public.cidades.uf is
  'UF de 2 chars. Cidades vindas do IBGE têm UF preenchida; manuais legadas podem ter null.';
comment on column public.cidades.ibge_codigo is
  'Código IBGE do município (7 dígitos). Null quando fonte=manual.';
comment on column public.cidades.fonte is
  'manual = criada pelo usuário; ibge = importada da API pública do IBGE.';

-- Reorganiza unique: era (tenant, lower(nome)); passa a considerar UF pra
-- deixar homônimos coexistirem em UFs diferentes. NULLS NOT DISTINCT (PG15+)
-- garante que (tenant, "Matriz", null) segue sendo único por tenant.
-- Mantemos o nome do índice pra não quebrar o mapeamento de erro em actions.ts.
drop index if exists public.uniq_cidade_por_tenant;

create unique index uniq_cidade_por_tenant
  on public.cidades (tenant_id, lower(nome), uf) nulls not distinct;

-- Nenhuma cidade IBGE se importa 2x no mesmo tenant.
create unique index if not exists uniq_cidade_ibge_por_tenant
  on public.cidades (tenant_id, ibge_codigo)
  where ibge_codigo is not null;
