-- =====================================================================
-- Perfil do colaborador — unifica RG/CNH/CPF num único documento
-- =====================================================================
--
-- Decisão de 16/11/2026: no mundo real, a CNH já estampa o CPF no
-- verso, então pedir "RG ou CNH" E "CPF" como dois uploads separados
-- é redundante — a pessoa manda a CNH e sobe a mesma foto duas vezes.
--
-- A régua passa a ser: UM único documento de identificação por
-- colaborador (RG, CNH ou CPF — qualquer um basta). O tipo no enum
-- continua sendo `rg_cnh`, só muda o significado: "identificação".
--
-- O valor `cpf` do enum colaborador_documento_tipo fica no banco pra
-- não quebrar linhas existentes e pra quem quiser anexar um CPF
-- separado explicitamente no futuro — só deixa de ser obrigatório.
--
-- Esta migration só reescreve o RPC com a régua nova. O enum e a
-- tabela não mudam.
-- =====================================================================

create or replace function public.completar_meu_perfil_colaborador()
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_c public.colaboradores%rowtype;
  v_docs_obrigatorios public.colaborador_documento_tipo[];
  v_tipo public.colaborador_documento_tipo;
  v_pendentes text[] := '{}';
  v_doc_pendentes text[] := '{}';
begin
  select * into v_c
  from public.colaboradores
  where user_id = (select auth.uid())
    and status = 'ativo';

  if v_c.id is null then
    raise exception 'usuario_sem_colaborador' using errcode = '42501';
  end if;

  if v_c.perfil_completado_em is not null then
    return;
  end if;

  if nullif(trim(v_c.nome_preferido), '') is null then v_pendentes := v_pendentes || 'nome_preferido'; end if;
  if v_c.data_nascimento is null                     then v_pendentes := v_pendentes || 'data_nascimento'; end if;
  if nullif(trim(v_c.cidade_origem), '') is null     then v_pendentes := v_pendentes || 'cidade_origem'; end if;
  if v_c.estado_civil is null                        then v_pendentes := v_pendentes || 'estado_civil'; end if;
  if v_c.possui_filhos is null                       then v_pendentes := v_pendentes || 'possui_filhos'; end if;
  if v_c.tamanho_camiseta is null                    then v_pendentes := v_pendentes || 'tamanho_camiseta'; end if;
  if nullif(trim(v_c.telefone), '') is null          then v_pendentes := v_pendentes || 'telefone'; end if;
  if nullif(trim(v_c.rg), '') is null                then v_pendentes := v_pendentes || 'rg'; end if;
  if nullif(trim(v_c.cpf), '') is null               then v_pendentes := v_pendentes || 'cpf'; end if;
  if nullif(trim(v_c.cep), '') is null               then v_pendentes := v_pendentes || 'cep'; end if;
  if nullif(trim(v_c.logradouro), '') is null        then v_pendentes := v_pendentes || 'logradouro'; end if;
  if nullif(trim(v_c.numero), '') is null            then v_pendentes := v_pendentes || 'numero'; end if;
  if nullif(trim(v_c.bairro), '') is null            then v_pendentes := v_pendentes || 'bairro'; end if;
  if nullif(trim(v_c.cidade), '') is null            then v_pendentes := v_pendentes || 'cidade'; end if;
  if nullif(trim(v_c.uf), '') is null                then v_pendentes := v_pendentes || 'uf'; end if;
  if nullif(trim(v_c.banco_codigo), '') is null      then v_pendentes := v_pendentes || 'banco_codigo'; end if;
  if nullif(trim(v_c.agencia), '') is null           then v_pendentes := v_pendentes || 'agencia'; end if;
  if nullif(trim(v_c.conta), '') is null             then v_pendentes := v_pendentes || 'conta'; end if;
  if v_c.tipo_conta is null                          then v_pendentes := v_pendentes || 'tipo_conta'; end if;
  if v_c.pix_tipo is null                            then v_pendentes := v_pendentes || 'pix_tipo'; end if;
  if nullif(trim(v_c.pix_chave), '') is null         then v_pendentes := v_pendentes || 'pix_chave'; end if;
  if v_c.vegetariano is null                         then v_pendentes := v_pendentes || 'vegetariano'; end if;
  if v_c.etnia is null                               then v_pendentes := v_pendentes || 'etnia'; end if;
  if v_c.genero_identidade is null                   then v_pendentes := v_pendentes || 'genero_identidade'; end if;
  if v_c.orientacao_sexual is null                   then v_pendentes := v_pendentes || 'orientacao_sexual'; end if;
  if v_c.pcd is null                                 then v_pendentes := v_pendentes || 'pcd'; end if;
  if nullif(trim(v_c.emergencia_nome), '') is null         then v_pendentes := v_pendentes || 'emergencia_nome'; end if;
  if nullif(trim(v_c.emergencia_parentesco), '') is null   then v_pendentes := v_pendentes || 'emergencia_parentesco'; end if;
  if nullif(trim(v_c.emergencia_telefone), '') is null     then v_pendentes := v_pendentes || 'emergencia_telefone'; end if;
  if nullif(trim(v_c.hobbies), '') is null           then v_pendentes := v_pendentes || 'hobbies'; end if;
  if nullif(trim(v_c.curiosidade), '') is null       then v_pendentes := v_pendentes || 'curiosidade'; end if;

  if v_c.tipo_contratacao in ('pj', 'mei', 'clt_recibo') then
    if nullif(trim(v_c.cnpj), '') is null          then v_pendentes := v_pendentes || 'cnpj'; end if;
    if nullif(trim(v_c.razao_social), '') is null  then v_pendentes := v_pendentes || 'razao_social'; end if;
    if v_c.pj_natureza is null                     then v_pendentes := v_pendentes || 'pj_natureza'; end if;
  end if;

  -- Régua nova: `rg_cnh` cobre identificação pessoal (RG, CNH ou CPF).
  -- `cpf` saiu dos obrigatórios em todas as listas.
  v_docs_obrigatorios := case v_c.tipo_contratacao
    when 'pj'         then array['cnpj','rg_cnh']::public.colaborador_documento_tipo[]
    when 'mei'        then array['cnpj','ccmei','rg_cnh']::public.colaborador_documento_tipo[]
    when 'clt'        then array['rg_cnh','comprovante_residencia','pis','ctps','titulo_eleitor']::public.colaborador_documento_tipo[]
    when 'clt_recibo' then array['rg_cnh','comprovante_residencia','pis','ctps','titulo_eleitor']::public.colaborador_documento_tipo[]
    when 'estagio'    then array['rg_cnh','comprovante_residencia','ctps']::public.colaborador_documento_tipo[]
    when 'socio'      then array[]::public.colaborador_documento_tipo[]
    else array[]::public.colaborador_documento_tipo[]
  end;

  foreach v_tipo in array v_docs_obrigatorios loop
    if not exists (
      select 1 from public.colaboradores_documentos
      where colaborador_id = v_c.id and tipo = v_tipo
    ) then
      v_doc_pendentes := v_doc_pendentes || v_tipo::text;
    end if;
  end loop;

  if array_length(v_pendentes, 1) > 0 or array_length(v_doc_pendentes, 1) > 0 then
    raise exception 'perfil_incompleto: campos=% documentos=%',
      coalesce(array_to_string(v_pendentes, ','), ''),
      coalesce(array_to_string(v_doc_pendentes, ','), '')
      using errcode = '23514';
  end if;

  update public.colaboradores
    set perfil_completado_em = now(),
        updated_at = now()
  where id = v_c.id;
end;
$$;
