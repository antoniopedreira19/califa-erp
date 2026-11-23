-- O PDF anexado depois à NF que entrou pela planilha sem ele (decisão 276,
-- 23/11/2026).
--
-- A carga das NFs da planilha lança as notas sem PDF (caminho vazio): o Tiago
-- decidiu que entram com número, emissão e valor da planilha e o PDF se anexa
-- depois. `faturamentos` não tem UPDATE para `authenticated` (a nota só muda
-- pelas funções), então o anexo também é uma função: só administrador ou
-- financeiro do tenant, só na nota emitida sem PDF, só arquivo da pasta do
-- tenant no bucket `faturamentos-nf`.
--
-- Mudança aditiva: uma função.

create or replace function public.anexar_pdf_da_nota(p_faturamento_id uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_nota record;
begin
  select f.id, f.tenant_id, f.numero_nf, f.status::text as status, f.anexo_nf_path
    into v_nota
    from public.faturamentos f
   where f.id = p_faturamento_id
     for update;
  if not found or v_nota.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'NF não encontrada.';
  end if;
  if not (public.is_tenant_admin(v_nota.tenant_id) or public.is_tenant_financeiro(v_nota.tenant_id)) then
    raise exception 'Apenas administrador ou financeiro anexa o PDF da NF.' using errcode = '42501';
  end if;
  if v_nota.status <> 'emitido' then
    raise exception 'A NF % está cancelada.', v_nota.numero_nf;
  end if;
  if coalesce(v_nota.anexo_nf_path, '') <> '' then
    raise exception 'A NF % já tem PDF.', v_nota.numero_nf;
  end if;
  if coalesce(p_path, '') = '' or split_part(p_path, '/', 1) <> v_nota.tenant_id::text then
    raise exception 'Anexo inválido: envie o PDF de novo.';
  end if;
  update public.faturamentos set anexo_nf_path = p_path where id = v_nota.id;
  return v_nota.numero_nf;
end;
$function$;

revoke all on function public.anexar_pdf_da_nota(uuid, text) from public, anon;
grant execute on function public.anexar_pdf_da_nota(uuid, text) to authenticated;
