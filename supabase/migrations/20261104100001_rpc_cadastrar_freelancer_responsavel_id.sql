-- Form público de cadastro de freela não preenchia freelancers.responsavel_id.
--
-- Sintoma: 6 freelas cadastrados hoje via link público (Juliana, Roberta,
-- Fagner, Denise, Caio, Filipe) aparecem com "Sem responsável atribuído" no
-- perfil, apesar de terem contrato com responsável correto (herda do
-- solicitante da solicitação).
--
-- Causa: `cadastrar_freelancer_via_solicitacao` (migration
-- 20261029000003) grava `responsavel_id = v_solicitacao.solicitante_id`
-- no INSERT de `freelancer_contratos` (certo), mas o INSERT de
-- `freelancers` não inclui a coluna. Resultado: dono do contrato OK,
-- dono do cadastro null.
--
-- Esta migration:
--   1. Reescreve a RPC pra passar `responsavel_id = v_solicitacao.solicitante_id`
--      no INSERT de `freelancers` (só quando é cadastro novo). No UPDATE
--      (freela já existia) não toca no responsável — se já tinha dono, foi
--      tratado na aprovação da solicitação (migrarResponsavelSeNecessario).
--   2. Backfill: pros cadastros órfãos, usa o responsável do contrato mais
--      recente como fonte da verdade.

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
      pix_chave, pix_tipo, origem, responsavel_id
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
      'form_publico',
      v_solicitacao.solicitante_id
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

-- Backfill: cadastros órfãos (responsavel_id null) que têm contrato com
-- responsável definido. Usa o responsável do contrato mais recente como
-- fonte da verdade.
update public.freelancers f
set responsavel_id = sub.contrato_responsavel
from (
  select distinct on (c.freelancer_id)
    c.freelancer_id,
    c.responsavel_id as contrato_responsavel
  from public.freelancer_contratos c
  where c.responsavel_id is not null
  order by c.freelancer_id, c.created_at desc
) sub
where f.id = sub.freelancer_id
  and f.responsavel_id is null;
