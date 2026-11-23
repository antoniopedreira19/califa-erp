-- Decisão 271 (23/11/2026, Tiago: "Sim, criar"): "O registro está certo".
--
-- POR QUE: a leitura da IA às vezes erra o PDF (leu o ano 2016 ou 2020 onde
-- o documento diz 2026). Nesses casos o registro está certo e a divergência
-- é falsa, mas ficava para sempre no filtro "PDF diferente do registro".
--
-- O QUE FAZ:
--   1. `confirmar_registro_da_nota(p_nota_id, p_motivo)`: só o administrador
--      e o financeiro; com motivo (10+ caracteres). Zera a divergência e
--      guarda o PDF confirmado (`divergencia_confirmada_pdf`). Fica no
--      histórico da nota (`notas_fiscais_fornecedor_alteracoes`, tipo
--      "confirmacao": o que o PDF trazia × o registro mantido).
--   2. `gravar_leitura_da_nota`: a releitura que traz o mesmo PDF já
--      confirmado não volta a acusar.
--   3. O gatilho da divergência: se o registro muda depois (número, emissão
--      ou valor), a confirmação deixa de valer e a divergência se refaz.
--
-- Mudança ADITIVA: duas colunas na nota, uma no histórico, uma RPC nova; a
-- RPC de leitura e o gatilho trocados pela mesma assinatura.

alter table public.notas_fiscais_fornecedor
  add column if not exists divergencia_confirmada_em timestamptz,
  add column if not exists divergencia_confirmada_pdf jsonb;

comment on column public.notas_fiscais_fornecedor.divergencia_confirmada_pdf is
  'Decisão 271: o PDF (leitura_pdf) que o financeiro confirmou estar lido errado — "O registro está certo". A releitura igual não volta a acusar.';

alter table public.notas_fiscais_fornecedor_alteracoes
  add column if not exists tipo text not null default 'alteracao';
alter table public.notas_fiscais_fornecedor_alteracoes
  drop constraint if exists chk_nff_alteracoes_tipo;
alter table public.notas_fiscais_fornecedor_alteracoes
  add constraint chk_nff_alteracoes_tipo check (tipo in ('alteracao', 'confirmacao'));

create or replace function public.confirmar_registro_da_nota(p_nota_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_nota public.notas_fiscais_fornecedor%rowtype;
  v_docs jsonb;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Escreva o motivo (pelo menos 10 caracteres).';
  end if;
  select * into v_nota from public.notas_fiscais_fornecedor where id = p_nota_id for update;
  if v_nota.id is null or v_nota.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'Nota não encontrada. Recarregue a tela.';
  end if;
  if not (public.is_tenant_admin(v_nota.tenant_id) or public.is_tenant_financeiro(v_nota.tenant_id)) then
    raise exception 'Só o financeiro e o administrador confirmam o registro das notas.' using errcode = '42501';
  end if;
  if cardinality(v_nota.leitura_divergencias) = 0 or v_nota.leitura_pdf is null then
    raise exception 'A NF % não tem divergência com o PDF.', v_nota.numero;
  end if;

  select coalesce(jsonb_agg(x.d order by x.d->>'codigo'), '[]'::jsonb) into v_docs
    from (
      select jsonb_build_object('tipo', 'pp', 'id', p.id, 'codigo', p.codigo) as d
        from public.pedidos_compra_anexos a
        join public.pedidos_compra p on p.id = a.pedido_compra_id
       where a.nota_fiscal_id = v_nota.id and p.status <> 'cancelada'
       group by p.id, p.codigo
      union all
      select jsonb_build_object('tipo', 'desembolso', 'id', d.id, 'codigo', d.codigo)
        from public.desembolsos_anexos a
        join public.desembolsos d on d.id = a.desembolso_id
       where a.nota_fiscal_id = v_nota.id and d.status <> 'cancelada'
       group by d.id, d.codigo
    ) x;

  -- O histórico: "antes" é o que o PDF trazia, "depois" é o registro mantido.
  insert into public.notas_fiscais_fornecedor_alteracoes
    (tenant_id, nota_fiscal_id, fornecedor_id, tipo, antes, depois, documentos, motivo, alterada_por)
  values
    (v_nota.tenant_id, v_nota.id, v_nota.fornecedor_id, 'confirmacao',
     jsonb_build_object('numero', v_nota.leitura_pdf ->> 'numero', 'data_emissao', v_nota.leitura_pdf ->> 'emissao',
                        'valor', (v_nota.leitura_pdf ->> 'valor')::numeric, 'cnpj', v_nota.leitura_pdf ->> 'cnpj',
                        'divergencias', to_jsonb(v_nota.leitura_divergencias)),
     jsonb_build_object('numero', v_nota.numero, 'data_emissao', v_nota.data_emissao, 'valor', v_nota.valor,
                        'tomador_estabelecimento_id', v_nota.tomador_estabelecimento_id),
     v_docs, btrim(p_motivo), v_uid);

  update public.notas_fiscais_fornecedor
     set leitura_divergencias       = '{}',
         divergencia_confirmada_em  = now(),
         divergencia_confirmada_pdf = v_nota.leitura_pdf
   where id = v_nota.id;
end;
$function$;

comment on function public.confirmar_registro_da_nota(uuid, text) is
  'Decisão 271: "O registro está certo" — o financeiro confirma, com motivo, que a divergência com o PDF é erro da leitura.';

revoke all on function public.confirmar_registro_da_nota(uuid, text) from public, anon;
grant execute on function public.confirmar_registro_da_nota(uuid, text) to authenticated;

-- A leitura: o mesmo PDF já confirmado não volta a acusar.
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
  if not v_div <@ array['numero', 'emitente', 'emissao', 'valor']::text[] then
    raise exception 'Divergências inválidas na leitura da nota.';
  end if;
  if v_confirmado is not null and v_confirmado = (p_dados -> 'pdf') then
    v_div := '{}';
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

-- O gatilho: o registro mudou → a confirmação deixa de valer.
create or replace function public.nota_recalcula_divergencias()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_novas text[];
begin
  if new.leitura_pdf is null then
    return new;
  end if;
  v_novas := public._divergencias_com_o_pdf(new.leitura_pdf, new.numero, new.data_emissao, new.valor, old.leitura_divergencias);
  if old.leitura_divergencias && array['numero', 'emitente']::text[]
     and not (v_novas && array['numero', 'emitente']::text[]) then
    new.leitura_modelo := null;
  end if;
  new.leitura_divergencias := v_novas;
  new.divergencia_confirmada_em := null;
  new.divergencia_confirmada_pdf := null;
  return new;
end;
$$;
