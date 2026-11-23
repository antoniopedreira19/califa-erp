-- Decisão 271 (23/11/2026, pedido do Tiago): a leitura da NF pelo TEXTO do
-- PDF, como complemento da leitura por imagem (esquema "nota-tomada-v4").
--
-- POR QUE: a leitura por imagem (IA) errou o ano em 3 notas (2016/2020 no
-- lugar de 2026) e trocou dígitos de CNPJ em 8. Quando o PDF tem texto
-- selecionável, número, emissão, valor e CNPJ do emitente saem dos rótulos
-- do layout, sem IA (`lib/ia/texto-da-nf.ts`).
--
-- O QUE GRAVA, na nota:
--   - `leitura_imagem`: o que a IA leu da imagem (número, CNPJ, emissão, valor);
--   - `leitura_texto`: o que o texto do PDF trouxe (nulo sem texto);
--   - `leitura_texto_bruto`: o texto do PDF (até 20 mil caracteres), para
--     conferir e refazer os rótulos sem baixar o arquivo de novo;
--   - `leitura_discordancias`: os campos em que imagem e texto discordaram
--     (valeu o texto);
--   - `leitura_so_imagem`: o PDF não tem texto (foto, escaneado, cupom): a
--     divergência é só pela imagem e pode ser erro de leitura.
-- `leitura_pdf` continua sendo o que vale (o texto onde existe; a imagem
-- completa o resto), e a divergência com o registro é calculada sobre ele.
-- A regra do "O registro está certo" (800009) continua.
--
-- Mudança ADITIVA: colunas novas e a RPC trocada pela mesma assinatura.

alter table public.notas_fiscais_fornecedor
  add column if not exists leitura_imagem jsonb,
  add column if not exists leitura_texto jsonb,
  add column if not exists leitura_texto_bruto text,
  add column if not exists leitura_discordancias text[] not null default '{}',
  add column if not exists leitura_so_imagem boolean;

alter table public.notas_fiscais_fornecedor
  drop constraint if exists chk_nf_fornecedor_discordancias;
alter table public.notas_fiscais_fornecedor
  add constraint chk_nf_fornecedor_discordancias
  check (leitura_discordancias <@ array['numero', 'emitente', 'emissao', 'valor']::text[]);

comment on column public.notas_fiscais_fornecedor.leitura_texto is
  'Decisão 271 (v4): número, CNPJ, emissão e valor pelo texto do PDF (sem IA). Nulo quando o PDF não tem texto.';
comment on column public.notas_fiscais_fornecedor.leitura_discordancias is
  'Decisão 271 (v4): os campos em que a leitura por imagem e a pelo texto discordaram; valeu o texto.';
comment on column public.notas_fiscais_fornecedor.leitura_so_imagem is
  'Decisão 271 (v4): o PDF não tem texto; a comparação com o registro foi só pela leitura da imagem.';

create or replace function public.gravar_leitura_da_nota(p_nota_id uuid, p_dados jsonb, p_modelo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant     uuid;
  v_confirmado jsonb;
  v_retencoes  jsonb := coalesce(p_dados -> 'retencoes', '[]'::jsonb);
  v_div        text[];
  v_disc       text[];
begin
  select tenant_id, divergencia_confirmada_pdf into v_tenant, v_confirmado
    from public.notas_fiscais_fornecedor where id = p_nota_id;
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
  select coalesce(array_agg(x), '{}') into v_disc
    from jsonb_array_elements_text(coalesce(p_dados -> 'discordancias', '[]'::jsonb)) x;
  if not v_div <@ array['numero', 'emitente', 'emissao', 'valor']::text[]
     or not v_disc <@ array['numero', 'emitente', 'emissao', 'valor']::text[] then
    raise exception 'Divergências inválidas na leitura da nota.';
  end if;
  if v_confirmado is not null and v_confirmado = (p_dados -> 'pdf') then
    v_div := '{}';
  end if;

  update public.notas_fiscais_fornecedor
     set descricao_servico     = nullif(btrim(p_dados ->> 'descricao_servico'), ''),
         cnae                  = nullif(btrim(p_dados ->> 'cnae'), ''),
         codigo_servico        = nullif(btrim(p_dados ->> 'codigo_servico'), ''),
         municipio_prestacao   = nullif(btrim(p_dados ->> 'municipio_prestacao'), ''),
         competencia           = case when (p_dados ->> 'competencia') ~ '^\d{4}-(0[1-9]|1[0-2])$'
                                      then ((p_dados ->> 'competencia') || '-01')::date end,
         codigo_verificacao    = nullif(btrim(p_dados ->> 'codigo_verificacao'), ''),
         retencoes             = v_retencoes,
         leitura_pdf           = case when jsonb_typeof(p_dados -> 'pdf') = 'object' then p_dados -> 'pdf' end,
         leitura_divergencias  = v_div,
         leitura_imagem        = case when jsonb_typeof(p_dados -> 'imagem') = 'object' then p_dados -> 'imagem' end,
         leitura_texto         = case when jsonb_typeof(p_dados -> 'texto') = 'object' then p_dados -> 'texto' end,
         leitura_texto_bruto   = left(nullif(p_dados ->> 'texto_bruto', ''), 20000),
         leitura_discordancias = v_disc,
         leitura_so_imagem     = coalesce((p_dados ->> 'so_imagem')::boolean, true),
         leitura_em            = now(),
         leitura_modelo        = nullif(btrim(p_modelo), '')
   where id = p_nota_id;
end;
$function$;

revoke all on function public.gravar_leitura_da_nota(uuid, jsonb, text) from public, anon;
grant execute on function public.gravar_leitura_da_nota(uuid, jsonb, text) to authenticated;
