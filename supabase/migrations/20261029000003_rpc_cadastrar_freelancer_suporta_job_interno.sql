-- 29/10/2026: estende `cadastrar_freelancer_via_solicitacao` pra aceitar
-- solicitações que apontam pra job interno (`job_interno_id`), inauguradas
-- na migration 20261029000002.
--
-- Lógica:
--   1. Solicitação tem `job_id` → snapshot nome de `jobs`, grava `job_id`
--      no contrato (produção).
--   2. Solicitação tem `job_interno_id` → snapshot nome de
--      `freelancer_jobs_internos`, grava `job_interno_id` no contrato.
--   3. Ambos nulos (legada do RH antigo) → snapshot do `nome_job` em texto,
--      `origem_sistema = ag_california_rh` pra satisfazer a check.
--
-- CHECK `freelancer_contratos_job_exclusivo` garante que só uma das duas
-- colunas é preenchida; a lógica aqui respeita isso naturalmente — a
-- origem é determinada pelo que a solicitação carrega.

create or replace function public.cadastrar_freelancer_via_solicitacao(p_token text, p_freelancer jsonb)
returns table(freelancer_id uuid, contrato_id uuid, freelancer_ja_existia boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_solicitacao public.freelancer_solicitacoes%rowtype;
  v_nome_job text;
  v_origem_sistema text;
  v_freelancer_id uuid;
  v_ja_existia boolean := false;
  v_contrato_id uuid;
  v_cpf text;
begin
  select * into v_solicitacao
  from public.freelancer_solicitacoes
  where token = p_token
  for update;

  if not found then
    raise exception 'Solicitação não encontrada' using errcode = 'P0001';
  end if;

  if v_solicitacao.status <> 'aprovada' then
    raise exception 'Solicitação não está aprovada (status atual: %)',
      v_solicitacao.status using errcode = 'P0002';
  end if;

  if v_solicitacao.expira_em is not null
     and v_solicitacao.expira_em < now() then
    raise exception 'Link expirado' using errcode = 'P0003';
  end if;

  if v_solicitacao.job_id is not null then
    select nome into v_nome_job
    from public.jobs
    where id = v_solicitacao.job_id
      and tenant_id = v_solicitacao.tenant_id;

    if v_nome_job is null then
      raise exception 'Job vinculado à solicitação não existe mais'
        using errcode = 'P0004';
    end if;

    v_origem_sistema := 'califa_erp';
  elsif v_solicitacao.job_interno_id is not null then
    select nome into v_nome_job
    from public.freelancer_jobs_internos
    where id = v_solicitacao.job_interno_id
      and tenant_id = v_solicitacao.tenant_id;

    if v_nome_job is null then
      raise exception 'Job interno vinculado à solicitação não existe mais'
        using errcode = 'P0004';
    end if;

    v_origem_sistema := 'califa_erp';
  else
    -- Solicitação legada: job_id e job_interno_id nulos, snapshot em
    -- `nome_job`, origem igual à dos contratos importados do RH antigo
    -- (satisfaz a check `freelancer_contratos_job_obrigatorio_em_novos`).
    v_nome_job := coalesce(v_solicitacao.nome_job, 'Importado (sem job vinculado)');
    v_origem_sistema := 'ag_california_rh';
  end if;

  v_cpf := p_freelancer->>'cpf';
  if v_cpf is not null and length(v_cpf) = 11 then
    select id into v_freelancer_id
    from public.freelancers
    where tenant_id = v_solicitacao.tenant_id
      and cpf = v_cpf;

    if v_freelancer_id is not null then
      v_ja_existia := true;
      update public.freelancers set
        email = coalesce(p_freelancer->>'email', email),
        celular = coalesce(p_freelancer->>'celular', celular),
        rg = coalesce(p_freelancer->>'rg', rg),
        data_nascimento = coalesce((p_freelancer->>'data_nascimento')::date, data_nascimento),
        cep = coalesce(p_freelancer->>'cep', cep),
        rua = coalesce(p_freelancer->>'rua', rua),
        numero = coalesce(p_freelancer->>'numero', numero),
        complemento = coalesce(p_freelancer->>'complemento', complemento),
        bairro = coalesce(p_freelancer->>'bairro', bairro),
        cidade = coalesce(p_freelancer->>'cidade', cidade),
        cnpj = coalesce(p_freelancer->>'cnpj', cnpj),
        razao_social = coalesce(p_freelancer->>'razao_social', razao_social),
        tipo_pagamento = coalesce(p_freelancer->>'tipo_pagamento', tipo_pagamento),
        banco = coalesce(p_freelancer->>'banco', banco),
        agencia = coalesce(p_freelancer->>'agencia', agencia),
        conta = coalesce(p_freelancer->>'conta', conta),
        tipo_conta = coalesce((p_freelancer->>'tipo_conta')::public.tipo_conta_bancaria, tipo_conta),
        pix_chave = coalesce(p_freelancer->>'pix_chave', pix_chave),
        pix_tipo = case
          when p_freelancer->>'pix_chave' is not null then (p_freelancer->>'pix_tipo')::public.pix_tipo_chave
          else pix_tipo
        end,
        updated_at = now()
      where id = v_freelancer_id;
    end if;
  end if;

  if v_freelancer_id is null then
    insert into public.freelancers (
      tenant_id, nome_social, nome_completo, cpf, rg, data_nascimento,
      email, celular, cep, rua, numero, complemento, bairro, cidade,
      cnpj, razao_social, tipo_pagamento, banco, agencia, conta, tipo_conta,
      pix_chave, pix_tipo, origem
    ) values (
      v_solicitacao.tenant_id,
      coalesce(p_freelancer->>'nome_social', v_solicitacao.nome_freela),
      p_freelancer->>'nome_completo',
      v_cpf, p_freelancer->>'rg',
      (p_freelancer->>'data_nascimento')::date,
      p_freelancer->>'email', p_freelancer->>'celular',
      p_freelancer->>'cep', p_freelancer->>'rua',
      p_freelancer->>'numero', p_freelancer->>'complemento',
      p_freelancer->>'bairro', p_freelancer->>'cidade',
      p_freelancer->>'cnpj', p_freelancer->>'razao_social',
      p_freelancer->>'tipo_pagamento', p_freelancer->>'banco',
      p_freelancer->>'agencia', p_freelancer->>'conta',
      (p_freelancer->>'tipo_conta')::public.tipo_conta_bancaria,
      p_freelancer->>'pix_chave',
      (p_freelancer->>'pix_tipo')::public.pix_tipo_chave,
      'form_publico'
    )
    returning id into v_freelancer_id;
  end if;

  insert into public.freelancer_contratos (
    tenant_id, freelancer_id, job_id, job_interno_id, responsavel_id,
    nome_job, cargo, tipo, valor,
    data_inicio, data_termino, cidade, observacoes,
    origem_sistema
  ) values (
    v_solicitacao.tenant_id, v_freelancer_id,
    v_solicitacao.job_id, v_solicitacao.job_interno_id,
    v_solicitacao.solicitante_id,
    v_nome_job, v_solicitacao.cargo,
    v_solicitacao.tipo, v_solicitacao.valor,
    v_solicitacao.data_inicio, v_solicitacao.data_termino,
    v_solicitacao.cidade, v_solicitacao.observacoes,
    v_origem_sistema
  )
  returning id into v_contrato_id;

  update public.freelancer_solicitacoes set
    status = 'cadastrada',
    freelancer_id = v_freelancer_id,
    contrato_id = v_contrato_id
  where id = v_solicitacao.id;

  return query select v_freelancer_id, v_contrato_id, v_ja_existia;
end;
$function$;
