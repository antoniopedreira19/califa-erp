-- Decisão 271 (23/11/2026): a leitura da NF guarda o que o PDF traz e o que
-- diverge do registro (esquema "nota-tomada-v3").
--
-- Na leitura das 508 notas da produção, 32 foram recusadas e a tela não dizia
-- por quê: o financeiro não tinha como saber se o erro era do cadastro ou do
-- arquivo. Agora toda leitura grava, na nota:
--   - `leitura_pdf`: número, CNPJ do emitente, emissão e valor que o PDF traz;
--   - `leitura_divergencias`: o que não bate com o registro — "numero",
--     "emitente" (só com o CNPJ lido válido: a v2 recusou 8 notas por um
--     dígito lido errado), "emissao", "valor".
-- Com número ou emitente diferentes, o PDF não é desta nota: os dados da
-- leitura (descrição, CNAE, retenções…) ficam vazios. A tela mostra a
-- divergência e o "Editar registro" oferece usar os dados do PDF.
--
-- Mudança ADITIVA: duas colunas novas e a RPC trocada pela mesma assinatura.

alter table public.notas_fiscais_fornecedor
  add column if not exists leitura_pdf jsonb,
  add column if not exists leitura_divergencias text[] not null default '{}';

alter table public.notas_fiscais_fornecedor
  drop constraint if exists chk_nf_fornecedor_divergencias;
alter table public.notas_fiscais_fornecedor
  add constraint chk_nf_fornecedor_divergencias
  check (leitura_divergencias <@ array['numero', 'emitente', 'emissao', 'valor']::text[]);

comment on column public.notas_fiscais_fornecedor.leitura_pdf is
  'Decisão 271: o que o PDF da nota traz pela leitura da IA — {numero, cnpj, emissao, valor}.';
comment on column public.notas_fiscais_fornecedor.leitura_divergencias is
  'Decisão 271: o que o PDF não confirma do registro — numero, emitente (CNPJ lido válido), emissao, valor.';

create or replace function public.gravar_leitura_da_nota(p_nota_id uuid, p_dados jsonb, p_modelo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant    uuid;
  v_retencoes jsonb := coalesce(p_dados -> 'retencoes', '[]'::jsonb);
  v_div       text[];
begin
  select tenant_id into v_tenant from public.notas_fiscais_fornecedor where id = p_nota_id;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'Nota não encontrada.';
  end if;
  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Só o financeiro e o administrador leem as notas.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_retencoes) <> 'array' or exists (
       select 1 from jsonb_array_elements(v_retencoes) r
        where (r ->> 'imposto') not in ('ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS')
           or coalesce((r ->> 'valor')::numeric, 0) <= 0) then
    raise exception 'Retenções inválidas na leitura da nota.';
  end if;
  select coalesce(array_agg(x), '{}') into v_div
    from jsonb_array_elements_text(coalesce(p_dados -> 'divergencias', '[]'::jsonb)) x;
  if not v_div <@ array['numero', 'emitente', 'emissao', 'valor']::text[] then
    raise exception 'Divergências inválidas na leitura da nota.';
  end if;

  update public.notas_fiscais_fornecedor
     set descricao_servico    = nullif(btrim(p_dados ->> 'descricao_servico'), ''),
         cnae                 = nullif(btrim(p_dados ->> 'cnae'), ''),
         codigo_servico       = nullif(btrim(p_dados ->> 'codigo_servico'), ''),
         municipio_prestacao  = nullif(btrim(p_dados ->> 'municipio_prestacao'), ''),
         competencia          = case when (p_dados ->> 'competencia') ~ '^\d{4}-(0[1-9]|1[0-2])$'
                                     then ((p_dados ->> 'competencia') || '-01')::date end,
         codigo_verificacao   = nullif(btrim(p_dados ->> 'codigo_verificacao'), ''),
         retencoes            = v_retencoes,
         leitura_pdf          = case when jsonb_typeof(p_dados -> 'pdf') = 'object' then p_dados -> 'pdf' end,
         leitura_divergencias = v_div,
         leitura_em           = now(),
         leitura_modelo       = nullif(btrim(p_modelo), '')
   where id = p_nota_id;
end;
$function$;

revoke all on function public.gravar_leitura_da_nota(uuid, jsonb, text) from public, anon;
grant execute on function public.gravar_leitura_da_nota(uuid, jsonb, text) to authenticated;
