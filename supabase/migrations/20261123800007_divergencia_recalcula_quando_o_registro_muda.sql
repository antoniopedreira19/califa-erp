-- Decisão 271 (23/11/2026): a divergência com o PDF se refaz quando o
-- registro da nota muda.
--
-- `leitura_divergencias` era calculada só na leitura: depois de corrigir o
-- registro pelo "Editar registro" (ou pelo "Corrigir a NF" da PP), a nota
-- continuava acusando "PDF diferente do registro". Agora um gatilho refaz a
-- divergência sempre que número, emissão ou valor mudam, comparando com o
-- que o PDF traz (`leitura_pdf`). O "emitente" continua como a leitura viu
-- (o emitente não se corrige no controle de notas).
--
-- Quando o PDF passa a ser desta nota (deixa de divergir em número e
-- emitente), os dados da leitura (descrição, CNAE, retenções…) estavam
-- vazios: a nota volta para a fila de leitura (`leitura_modelo` nulo), e a
-- releitura usa o cache, sem custo.
--
-- O número também deixa de divergir quando só muda o sufixo (o PDF traz
-- "459/NFE" e o registro "459"): compara-se também só os dígitos.
--
-- O recálculo vale para as notas já lidas (dado derivado da própria nota,
-- nada digitado muda): as 10 corrigidas em 23/11 e a "459/NFE".

create or replace function public._divergencias_com_o_pdf(
  p_pdf jsonb, p_numero text, p_emissao date, p_valor numeric, p_antes text[]
)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(array_remove(array[
    case when nullif(p_pdf ->> 'numero', '') is not null
          and public.chave_do_numero_da_nf(p_pdf ->> 'numero') is distinct from public.chave_do_numero_da_nf(p_numero)
          and nullif(ltrim(regexp_replace(p_pdf ->> 'numero', '\D', '', 'g'), '0'), '')
              is distinct from nullif(ltrim(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '0'), '')
         then 'numero' end,
    case when 'emitente' = any(coalesce(p_antes, '{}')) then 'emitente' end,
    case when (p_pdf ->> 'emissao') ~ '^\d{4}-\d{2}-\d{2}$' and (p_pdf ->> 'emissao')::date <> p_emissao then 'emissao' end,
    case when (p_pdf ->> 'valor') ~ '^-?\d+(\.\d+)?$' and abs((p_pdf ->> 'valor')::numeric - p_valor) > 0.009 then 'valor' end
  ], null), '{}');
$$;

revoke all on function public._divergencias_com_o_pdf(jsonb, text, date, numeric, text[]) from public, anon, authenticated;

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
  -- O PDF passou a ser desta nota: relê para preencher os dados da leitura.
  if old.leitura_divergencias && array['numero', 'emitente']::text[]
     and not (v_novas && array['numero', 'emitente']::text[]) then
    new.leitura_modelo := null;
  end if;
  new.leitura_divergencias := v_novas;
  return new;
end;
$$;

drop trigger if exists trg_nota_recalcula_divergencias on public.notas_fiscais_fornecedor;
create trigger trg_nota_recalcula_divergencias
  before update of numero, data_emissao, valor on public.notas_fiscais_fornecedor
  for each row execute function public.nota_recalcula_divergencias();

-- O recálculo das notas já lidas (só o dado derivado).
update public.notas_fiscais_fornecedor n
   set leitura_modelo = case
         when n.leitura_divergencias && array['numero', 'emitente']::text[]
              and not (public._divergencias_com_o_pdf(n.leitura_pdf, n.numero, n.data_emissao, n.valor, n.leitura_divergencias)
                       && array['numero', 'emitente']::text[])
         then null else n.leitura_modelo end,
       leitura_divergencias = public._divergencias_com_o_pdf(n.leitura_pdf, n.numero, n.data_emissao, n.valor, n.leitura_divergencias)
 where n.leitura_pdf is not null
   and n.leitura_divergencias is distinct from public._divergencias_com_o_pdf(n.leitura_pdf, n.numero, n.data_emissao, n.valor, n.leitura_divergencias);
