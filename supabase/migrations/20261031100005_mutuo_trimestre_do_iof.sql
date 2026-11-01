-- =====================================================================
-- Mútuo (decisão 230): o trimestre do IOF
-- =====================================================================
--
-- Na planilha, o IOF da California fica no Tipo do mútuo a que se refere
-- (MÚTUO INT 2T 2026), e não no trimestre da data. `mutuos_iof` passa a guardar
-- esse trimestre, tirado da abertura do par; sem mútuo informado, fica vazio.
-- =====================================================================

alter table public.mutuos_iof
  add column if not exists trimestre smallint,
  add column if not exists ano smallint;

comment on column public.mutuos_iof.trimestre is
  'O trimestre do Tipo do mútuo a que o IOF se refere (MÚTUO INT 2T 2026), como a planilha. Vazio quando o IOF não aponta mútuo.';

do $$
declare
  v_def  text;
  v_novo text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'lancar_iof_do_mutuo';
  v_novo := replace(
    v_def,
    $x$  v_id      uuid;
begin$x$,
    $x$  v_id      uuid;
  v_tri     smallint;
  v_ano     smallint;
begin$x$
  );
  v_novo := replace(
    v_novo,
    $x$  insert into public.mutuos_iof (
    lancamento_id, tenant_id, pagador_empresa_contabil_id, com_empresa_contabil_id, com_fornecedor_id
  ) values (
    v_id, v_linha.tenant_id, v_ec.id, p_com_empresa_contabil_id, p_com_fornecedor_id
  );$x$,
    $x$  -- O IOF fica no trimestre do mútuo a que se refere, como a planilha.
  select a.trimestre, a.ano into v_tri, v_ano
    from public.mutuos_saldo_abertura a
   where a.tenant_id = v_linha.tenant_id
     and ((a.credor_empresa_contabil_id = v_ec.id
           and (a.devedor_empresa_contabil_id = p_com_empresa_contabil_id or a.devedor_fornecedor_id = p_com_fornecedor_id))
       or (a.credor_empresa_contabil_id = p_com_empresa_contabil_id and a.devedor_empresa_contabil_id = v_ec.id))
   limit 1;

  insert into public.mutuos_iof (
    lancamento_id, tenant_id, pagador_empresa_contabil_id, com_empresa_contabil_id, com_fornecedor_id, trimestre, ano
  ) values (
    v_id, v_linha.tenant_id, v_ec.id, p_com_empresa_contabil_id, p_com_fornecedor_id, v_tri, v_ano
  );$x$
  );
  if v_novo = v_def or position('v_tri' in v_novo) = 0 or position('trimestre, ano' in v_novo) = 0 then
    raise exception 'lancar_iof_do_mutuo mudou: revise esta migration.';
  end if;
  execute v_novo;
end;
$$;
