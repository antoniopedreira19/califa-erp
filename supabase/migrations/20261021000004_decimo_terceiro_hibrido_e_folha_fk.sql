-- Motivo: duas mudancas estruturais pra integrar o 13o ao fluxo de folha de
-- pagamento, mantendo o snapshot imutavel do caso hibrido (CLT_recibo).
--
-- 1) decimo_terceiro_linhas ganha breakdown da parte CLT e parte PJ:
--    - snapshot_valor_recibo (parte PJ do salario no momento da criacao)
--    - parte_clt_* e parte_pj_* com os valores calculados de cada lado
--    Nullable; preenchido so quando tipo_contratacao='clt_recibo'.
--    Pros nao-hibridos (clt puro, pj puro, mei), as colunas totais
--    (primeira_parcela, segunda_parcela, etc) ja representam o calculo.
--
-- 2) folhas_pagamento ganha decimo_terceiro_linha_id (FK nullable). Quando
--    o RH fecha a 1a ou 2a parcela do 13o, cria 1 linha em folhas_pagamento
--    por colaborador com tipo='decimo_terceiro_1a_parcela' (ou 2a),
--    status='enviada' e esta FK apontando pra decimo_terceiro_linhas.
--
-- 3) O unique index de folhas_pagamento troca pra incluir 'tipo'. Hoje e
--    (tenant, ano, mes, colaborador, origem); com 13o, o mesmo colaborador
--    pode ter linha de salario + 13o_1a + 13o_2a na mesma competencia.
--    A troca e segura: todas as linhas hoje tem tipo='salario', ampliar o
--    unique com tipo nao gera conflito.
--
-- Referencia: docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md
--
-- NAO-DESTRUTIVA: so adiciona colunas e troca unique por outro mais amplo.

-- ===========================================================================
-- 1. Breakdown hibrido em decimo_terceiro_linhas
-- ===========================================================================

alter table public.decimo_terceiro_linhas
  add column if not exists snapshot_valor_recibo numeric(14,2)
    check (snapshot_valor_recibo is null or snapshot_valor_recibo >= 0);

alter table public.decimo_terceiro_linhas
  add column if not exists parte_clt_primeira_parcela numeric(14,2);
alter table public.decimo_terceiro_linhas
  add column if not exists parte_clt_segunda_parcela numeric(14,2);
alter table public.decimo_terceiro_linhas
  add column if not exists parte_clt_desconto_inss numeric(14,2);
alter table public.decimo_terceiro_linhas
  add column if not exists parte_clt_desconto_irrf numeric(14,2);
alter table public.decimo_terceiro_linhas
  add column if not exists parte_clt_total_liquido numeric(14,2);

alter table public.decimo_terceiro_linhas
  add column if not exists parte_pj_primeira_parcela numeric(14,2);
alter table public.decimo_terceiro_linhas
  add column if not exists parte_pj_segunda_parcela numeric(14,2);
alter table public.decimo_terceiro_linhas
  add column if not exists parte_pj_total_liquido numeric(14,2);

comment on column public.decimo_terceiro_linhas.snapshot_valor_recibo is
  'Snapshot da parte PJ do salario no momento da criacao da folha. NULL quando o colaborador nao e hibrido (clt_recibo). Pro hibrido, parte CLT = snapshot_salario - snapshot_valor_recibo.';

comment on column public.decimo_terceiro_linhas.parte_clt_total_liquido is
  'Breakdown do hibrido: valor liquido da parte CLT (so para tipo_contratacao=clt_recibo). NULL em CLT puro, PJ puro e MEI.';

comment on column public.decimo_terceiro_linhas.parte_pj_total_liquido is
  'Breakdown do hibrido: valor da parte PJ (so para tipo_contratacao=clt_recibo). NULL em CLT puro, PJ puro e MEI.';

-- ===========================================================================
-- 2. FK em folhas_pagamento apontando pra decimo_terceiro_linhas
-- ===========================================================================

alter table public.folhas_pagamento
  add column if not exists decimo_terceiro_linha_id uuid
    references public.decimo_terceiro_linhas(id) on delete set null;

comment on column public.folhas_pagamento.decimo_terceiro_linha_id is
  'Apontador pra linha de 13o quando a folha_pagamento foi gerada pelo fechamento de uma parcela do 13o. NULL em folha mensal e ferias. Com esta FK + tipo in (decimo_terceiro_1a_parcela, decimo_terceiro_2a_parcela), da pra navegar da folha_pagamento pro contexto do 13o.';

create index if not exists idx_folhas_pagamento_decimo_terceiro_linha
  on public.folhas_pagamento (decimo_terceiro_linha_id)
  where decimo_terceiro_linha_id is not null;

-- ===========================================================================
-- 3. Unique com tipo (permite salario + ferias + 13o_1a + 13o_2a por mes)
-- ===========================================================================

drop index if exists public.folhas_pagamento_tenant_ano_mes_colab_origem_idx;

create unique index if not exists folhas_pagamento_tenant_ano_mes_colab_origem_tipo_idx
  on public.folhas_pagamento
     (tenant_id, competencia_ano, competencia_mes, colaborador_id, origem, tipo);
