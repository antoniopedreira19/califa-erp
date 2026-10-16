-- Task 022 — Freelancers (Fase 3, Task 3): RPC do fluxo público de cadastro
--
-- Função usada pelo endpoint /api/public/freelancer-solicitacao/[token]/submit
-- pra fechar o fluxo numa transação só:
--   1. Resolver a solicitação pelo token (lock FOR UPDATE).
--   2. Validar status e expiração.
--   3. Dedup do freelancer por CPF (ou cria novo com origem='form_publico').
--   4. Criar contrato amarrado ao job da solicitação, com nome_job snapshot.
--   5. Marcar solicitação como cadastrada + salvar freelancer_id/contrato_id.
--
-- SECURITY DEFINER porque o chamador (endpoint público) não tem sessão
-- Supabase. search_path = public pra evitar hijack.

create or replace function public.cadastrar_freelancer_via_solicitacao(
  p_token text,
  p_freelancer jsonb
)
returns table (
  freelancer_id uuid,
  contrato_id uuid,
  freelancer_ja_existia boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitacao public.freelancer_solicitacoes%rowtype;
  v_nome_job text;
  v_freelancer_id uuid;
  v_ja_existia boolean := false;
  v_contrato_id uuid;
  v_cpf text;
begin
  -- 1. Resolve solicitação com lock
  select * into v_solicitacao
  from public.freelancer_solicitacoes
  where token = p_token
  for update;

  if not found then
    raise exception 'Solicitação não encontrada' using errcode = 'P0001';
  end if;

  -- 2. Valida status e expiração
  if v_solicitacao.status <> 'aprovada' then
    raise exception 'Solicitação não está aprovada (status atual: %)',
      v_solicitacao.status using errcode = 'P0002';
  end if;

  if v_solicitacao.expira_em is not null
     and v_solicitacao.expira_em < now() then
    raise exception 'Link expirado' using errcode = 'P0003';
  end if;

  -- 3. Snapshot do nome do job
  select nome into v_nome_job
  from public.jobs
  where id = v_solicitacao.job_id
    and tenant_id = v_solicitacao.tenant_id;

  if v_nome_job is null then
    raise exception 'Job vinculado à solicitação não existe mais'
      using errcode = 'P0004';
  end if;

  -- 4. Dedup do freelancer por CPF (se preenchido)
  v_cpf := p_freelancer->>'cpf';
  if v_cpf is not null and length(v_cpf) = 11 then
    select id into v_freelancer_id
    from public.freelancers
    where tenant_id = v_solicitacao.tenant_id
      and cpf = v_cpf;

    if v_freelancer_id is not null then
      v_ja_existia := true;
      -- Atualização conservadora: só o que normalmente vem fresco do form
      -- (email, celular, endereço) é atualizado. Nome é preservado.
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
        pix_chave = coalesce(p_freelancer->>'pix_chave', pix_chave),
        updated_at = now()
      where id = v_freelancer_id;
    end if;
  end if;

  if v_freelancer_id is null then
    -- Cria novo
    insert into public.freelancers (
      tenant_id, nome_social, nome_completo, cpf, rg, data_nascimento,
      email, celular,
      cep, rua, numero, complemento, bairro, cidade,
      cnpj, razao_social,
      tipo_pagamento, banco, agencia, conta, pix_chave,
      origem
    ) values (
      v_solicitacao.tenant_id,
      coalesce(p_freelancer->>'nome_social', v_solicitacao.nome_freela),
      p_freelancer->>'nome_completo',
      v_cpf,
      p_freelancer->>'rg',
      (p_freelancer->>'data_nascimento')::date,
      p_freelancer->>'email',
      p_freelancer->>'celular',
      p_freelancer->>'cep',
      p_freelancer->>'rua',
      p_freelancer->>'numero',
      p_freelancer->>'complemento',
      p_freelancer->>'bairro',
      p_freelancer->>'cidade',
      p_freelancer->>'cnpj',
      p_freelancer->>'razao_social',
      p_freelancer->>'tipo_pagamento',
      p_freelancer->>'banco',
      p_freelancer->>'agencia',
      p_freelancer->>'conta',
      p_freelancer->>'pix_chave',
      'form_publico'
    )
    returning id into v_freelancer_id;
  end if;

  -- 5. Cria contrato amarrado ao job
  insert into public.freelancer_contratos (
    tenant_id, freelancer_id, job_id, responsavel_id,
    nome_job, cargo, tipo, valor,
    data_inicio, data_termino, cidade, observacoes,
    origem_sistema
  ) values (
    v_solicitacao.tenant_id,
    v_freelancer_id,
    v_solicitacao.job_id,
    v_solicitacao.solicitante_id,  -- responsável default = solicitante
    v_nome_job,
    v_solicitacao.cargo,
    v_solicitacao.tipo,
    v_solicitacao.valor,
    v_solicitacao.data_inicio,
    v_solicitacao.data_termino,
    v_solicitacao.cidade,
    v_solicitacao.observacoes,
    'califa_erp'
  )
  returning id into v_contrato_id;

  -- 6. Marca solicitação como cadastrada
  update public.freelancer_solicitacoes set
    status = 'cadastrada',
    freelancer_id = v_freelancer_id,
    contrato_id = v_contrato_id
  where id = v_solicitacao.id;

  return query select v_freelancer_id, v_contrato_id, v_ja_existia;
end;
$$;

-- Executar como service_role apenas (chamada pelo endpoint público).
revoke all on function public.cadastrar_freelancer_via_solicitacao(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.cadastrar_freelancer_via_solicitacao(text, jsonb)
  to service_role;
