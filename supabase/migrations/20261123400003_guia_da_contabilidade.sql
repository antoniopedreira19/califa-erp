-- Decisão 277 (entrega 2b, 23/11/2026, pedido do Tiago): a Guia da
-- contabilidade.
--
-- Por quê: até tudo ser lançado pelo sistema, há guias que a Apuração não
-- calcula — competência de antes de outubro/2026 paga no 4º trimestre (o
-- PIS/COFINS de setembro, as cotas do IRPJ/CSLL do 3º trimestre), filial sem
-- nota no sistema, imposto fora da apuração. O financeiro lança a guia com o
-- valor que a contabilidade mandou, aprovada, com o motivo e o rateio por
-- empresa gerencial; ela aparece no bloco do CNPJ na Apuração e vai para
-- Impostos a Pagar.
--
-- O que faz (só acrescenta):
-- 1. `impostos_a_pagar.da_contabilidade`: marca o imposto lançado como guia
--    da contabilidade. A origem continua 'avulso' (sem aprovação da
--    Apuração): fluxo, conciliação, DRE e baixa tratam como já tratam.
-- 2. `lancar_guia_da_contabilidade(...)`: cria pelo `criar_imposto_avulso`
--    (as mesmas travas: CNPJ do tenant, valor, vencimento, rateio fechando),
--    marca a guia e registra a auditoria `fiscal.guia_da_contabilidade`.

alter table public.impostos_a_pagar
  add column if not exists da_contabilidade boolean not null default false;

comment on column public.impostos_a_pagar.da_contabilidade is
  'Decisão 277: guia da contabilidade — lançada aprovada com o valor da contabilidade, para o que a Apuração não calcula. Origem avulso.';

create index if not exists idx_impostos_a_pagar_da_contabilidade
  on public.impostos_a_pagar (tenant_id)
  where da_contabilidade;

create or replace function public.lancar_guia_da_contabilidade(
  p_tenant_id            uuid,
  p_tributo              text,
  p_titulo               text,
  p_codigo_receita       text,
  p_empresa_contabil_id  uuid,
  p_estabelecimento_id   uuid,
  p_competencia          text,
  p_rotulo_competencia   text,
  p_descricao            text,
  p_vencimento           date,
  p_valor                numeric,
  p_rateio               jsonb,
  p_guia_path            text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id  uuid;
begin
  v_uid := public._exige_financeiro_fiscal(p_tenant_id);
  if length(btrim(coalesce(p_descricao, ''))) < 10 then
    raise exception 'Explique por que o sistema não calculou esta guia (mínimo 10 caracteres).';
  end if;

  v_id := public.criar_imposto_avulso(
    p_tenant_id, p_tributo, p_titulo, p_codigo_receita, p_empresa_contabil_id, p_estabelecimento_id,
    p_competencia, p_rotulo_competencia, p_descricao, p_vencimento, p_valor, p_rateio, p_guia_path
  );
  update public.impostos_a_pagar set da_contabilidade = true where id = v_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (
    p_tenant_id, 'imposto_a_pagar', v_id::text, 'fiscal.guia_da_contabilidade', v_uid,
    jsonb_build_object('tributo', p_tributo, 'codigo_receita', p_codigo_receita, 'competencia', p_competencia,
                       'valor', p_valor, 'descricao', p_descricao, 'rateio', p_rateio)
  );
  return v_id;
end;
$$;

revoke all on function public.lancar_guia_da_contabilidade(uuid, text, text, text, uuid, uuid, text, text, text, date, numeric, jsonb, text) from public, anon;
grant execute on function public.lancar_guia_da_contabilidade(uuid, text, text, text, uuid, uuid, text, text, text, date, numeric, jsonb, text) to authenticated;
