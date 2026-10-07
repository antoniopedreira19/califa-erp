-- =====================================================================
-- Cadastro de Veículos (decisão 150): os meios saem do cadastro
--
-- Na decisão 147 o veículo guardava os meios que vende e a praça
-- (`veiculos_midia.meios` e `praca`), e a lista da célula Veículo mostrava
-- primeiro quem vende o meio da linha. O Tiago decidiu em 07/10/2026 que o
-- cadastro não pede mais meio nem praça: os meios do veículo passam a vir
-- do USO — as linhas de mídia em que ele já foi escolhido, em qualquer
-- orçamento —, e a praça fica só na linha da planilha, onde já existe.
--
-- O que muda aqui (nada é apagado, nenhum dado é reescrito):
--
-- 1) Sai a trava `veiculos_midia_com_meio` (pelo menos um meio): o veículo
--    novo nasce sem meio, e `meios` ganha o padrão '{}'. As colunas `meios`
--    e `praca` ficam como estão, com o que já foi gravado, e o sistema deixa
--    de lê-las. Apagá-las seria mudança destrutiva — fica para quando o
--    Tiago autorizar.
--
-- 2) A view `vw_veiculos_meios_usados`: para cada veículo, os meios das
--    linhas de mídia em que ele aparece. `security_invoker`: vale a RLS de
--    quem consulta (itens e grupos do próprio tenant). Alimenta a coluna
--    "Usado em" da lista de Veículos e o grupo "Já usados em {meio}" da
--    célula Veículo da planilha.
--
-- 3) Índice parcial nos grupos de mídia (`meio` preenchido), para a view
--    partir só deles e chegar aos itens pelo `idx_itens_grupo`.
-- =====================================================================

alter table public.veiculos_midia drop constraint if exists veiculos_midia_com_meio;
alter table public.veiculos_midia alter column meios set default '{}';

comment on column public.veiculos_midia.meios is
  'Sem uso desde a decisão 150 (07/10/2026): os meios do veículo vêm das linhas de mídia (vw_veiculos_meios_usados). Guarda o que foi gravado antes.';
comment on column public.veiculos_midia.praca is
  'Sem uso desde a decisão 150 (07/10/2026): a praça fica só na linha da planilha. Guarda o que foi gravado antes.';

create index if not exists idx_grupos_midia
  on public.versoes_orcamento_grupos (id)
  where meio is not null;

create or replace view public.vw_veiculos_meios_usados
with (security_invoker = true) as
select distinct i.tenant_id, i.fornecedor_id, g.meio
  from public.versoes_orcamento_grupos g
  join public.versoes_orcamento_itens i on i.grupo_id = g.id
 where g.meio is not null
   and i.fornecedor_id is not null;

comment on view public.vw_veiculos_meios_usados is
  'Decisão 150: os meios em que cada veículo já foi usado nas planilhas de Mídia Off.';

revoke all on public.vw_veiculos_meios_usados from public, anon;
grant select on public.vw_veiculos_meios_usados to authenticated;
