-- Decisão 271 (23/11/2026): o código do serviço da NF tomada em campo próprio.
--
-- Na primeira leitura em lote da produção, a IA gravou como "CNAE" o código
-- de tributação do serviço (item da LC 116, ex. "17.06.01 / -") em 17 das 30
-- notas lidas; nenhuma tinha um CNAE de verdade. A maior parte das NFS-e não
-- traz CNAE, traz o código do serviço. A leitura passa a separar os dois
-- (esquema "nota-tomada-v2"): o CNAE só no formato de CNAE, o código do
-- serviço nesta coluna. As notas lidas com a v1 voltam a ser oferecidas para
-- leitura pela tela (`leitura_modelo`), e a releitura grava por cima.
--
-- Mudança ADITIVA: uma coluna nova e a RPC trocada pela mesma assinatura,
-- passando a gravar também esta coluna.

alter table public.notas_fiscais_fornecedor
  add column if not exists codigo_servico text;

comment on column public.notas_fiscais_fornecedor.codigo_servico is
  'Decisão 271: o código de tributação do serviço / item da LC 116 que a NF traz ("17.06" ou "17.06.01"), da leitura da NF pela IA. Diferente do CNAE.';

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
         codigo_servico      = nullif(btrim(p_dados ->> 'codigo_servico'), ''),
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
