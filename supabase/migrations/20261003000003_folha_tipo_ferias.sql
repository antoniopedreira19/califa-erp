-- =============================================================
-- Folha de pagamento: tipo (salario|ferias) + vínculo com
-- lançamento de férias + anexo do recibo contábil (2026-10-03)
--
-- Alinhado com o PO em 2026-10-03 depois da conversa com o RH.
--
-- Decisões:
--  - Mesma tabela `folhas_pagamento` passa a suportar 2 tipos:
--    `salario` (folha mensal, fluxo atual) e `ferias` (nova).
--    Default = `salario` pra manter 100% dos registros existentes
--    sem mudança de comportamento.
--  - Reusa a coluna `origem` existente (enum `folha_origem`):
--      * `california`     = calculada pelo sistema (PJ)
--      * `contabilidade`  = aguarda PDF da contabilidade (CLT, estágio)
--  - `lancamento_ferias_id` liga a folha ao lançamento de origem,
--    pra reversão (cancelamento) e pra marcar o lançamento como
--    concluído quando TODAS as folhas forem pagas (híbrido tem 2).
--  - `anexo_url` guarda o PDF do recibo da contabilidade (CLT).
--    Pra PJ fica NULL — o recibo gerado pelo sistema fica em
--    `colaboradores_ferias_lancamentos.recibo_url`.
--  - `fn_calcular_vencimento_ferias(data_inicio)`: vencimento é 2
--    dias antes. Se cair em sábado/domingo, antecipa pra quinta
--    anterior (regra California, não CLT art. 145).
-- =============================================================

-- 1) Novo enum
create type public.folha_tipo as enum ('salario', 'ferias');

-- 2) Novas colunas em folhas_pagamento
alter table public.folhas_pagamento
  add column tipo public.folha_tipo not null default 'salario',
  add column lancamento_ferias_id uuid
    references public.colaboradores_ferias_lancamentos(id) on delete set null,
  add column anexo_url text;

comment on column public.folhas_pagamento.tipo is
  'salario = folha mensal; ferias = pagamento adiantado antes do gozo (regra 2 dias antes).';
comment on column public.folhas_pagamento.lancamento_ferias_id is
  'Lançamento de férias que originou essa folha (NULL para folhas de salário).';
comment on column public.folhas_pagamento.anexo_url is
  'Caminho no bucket do PDF do recibo da contabilidade (CLT). NULL para PJ.';

-- Índice pros queries por lançamento
create index idx_folhas_pagamento_lancamento_ferias
  on public.folhas_pagamento(lancamento_ferias_id)
  where lancamento_ferias_id is not null;

-- Índice pros queries por tipo+status (vão alimentar a tab Pagamentos)
create index idx_folhas_pagamento_tipo_status
  on public.folhas_pagamento(tenant_id, tipo, status);

-- 3) Função de vencimento das férias
--
-- Regra:
--   Base: data_inicio - 2 dias.
--   Se cair em sábado (dow=6) → recua pra quinta (= data_inicio - 4).
--   Se cair em domingo (dow=0) → recua pra quinta (= data_inicio - 5).
--   Caso contrário, mantém.
--
-- extract(dow from date) retorna 0=domingo, 1=segunda, ..., 6=sábado.
create or replace function public.fn_calcular_vencimento_ferias(
  p_data_inicio date
) returns date
language sql
immutable
as $$
  select case
    when p_data_inicio is null then null
    else case extract(dow from p_data_inicio - interval '2 days')
      when 0 then (p_data_inicio - interval '5 days')::date  -- domingo
      when 6 then (p_data_inicio - interval '4 days')::date  -- sábado
      else (p_data_inicio - interval '2 days')::date
    end
  end;
$$;

comment on function public.fn_calcular_vencimento_ferias(date) is
  'Calcula a data em que o pagamento das férias deve ser lançado. '
  'Regra California: 2 dias antes do início; se cair em sábado ou '
  'domingo, antecipa pra quinta-feira anterior.';
