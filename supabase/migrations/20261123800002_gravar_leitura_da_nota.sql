-- Decisão 271 (23/11/2026): a leitura ampliada da NF tomada grava na nota o
-- que a IA leu do arquivo — descrição, CNAE, município da prestação,
-- competência, código de verificação e as retenções destacadas (colunas da
-- migration 20261123800001).
--
-- O cadastro de notas não tem política de escrita para `authenticated`:
-- quem grava é a RPC, só para o administrador e o financeiro, e só nestas
-- colunas (número, emissão, valor e tomador não mudam por aqui). A leitura
-- confere antes, no servidor, que o arquivo é desta nota (número e CNPJ do
-- emitente).

create or replace function public.gravar_leitura_da_nota(p_nota_id uuid, p_dados jsonb, p_modelo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_retencoes jsonb := coalesce(p_dados -> 'retencoes', '[]'::jsonb);
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

  update public.notas_fiscais_fornecedor
     set descricao_servico   = nullif(btrim(p_dados ->> 'descricao_servico'), ''),
         cnae                = nullif(btrim(p_dados ->> 'cnae'), ''),
         municipio_prestacao = nullif(btrim(p_dados ->> 'municipio_prestacao'), ''),
         competencia         = case when (p_dados ->> 'competencia') ~ '^\d{4}-(0[1-9]|1[0-2])$'
                                    then ((p_dados ->> 'competencia') || '-01')::date end,
         codigo_verificacao  = nullif(btrim(p_dados ->> 'codigo_verificacao'), ''),
         retencoes           = v_retencoes,
         leitura_em          = now(),
         leitura_modelo      = nullif(btrim(p_modelo), '')
   where id = p_nota_id;
end;
$function$;

revoke all on function public.gravar_leitura_da_nota(uuid, jsonb, text) from public, anon;
grant execute on function public.gravar_leitura_da_nota(uuid, jsonb, text) to authenticated;
