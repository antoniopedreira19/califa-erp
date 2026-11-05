-- 04/11/2026: novo status `finalizada` pras solicitações de freelancer.
--
-- Fluxo revisado:
--   pendente → aprovada → cadastrada → finalizada
--                           ↑              ↑
--              contrato criado         minuta gerada
--              (freela preenche        OU dispensa
--              form público OU         (diária < 15d)
--              renovação aprovada)
--
-- `cadastrada` passa a significar: contrato criado mas minuta ainda não
-- emitida. `finalizada` = minuta emitida OU dispensa.
--
-- Esta migration:
--   1. Adiciona valor 'finalizada' ao enum freelancer_solicitacao_status.
--   2. Reescreve a RPC `cadastrar_freelancer_via_solicitacao` pra detectar
--      diária curta e já gravar 'finalizada' em vez de 'cadastrada'.
--   3. Backfill: solicitações hoje em 'cadastrada' cujo contrato tem minuta
--      (arquivo_url OU minuta_url) ou dispensa (diária < 15d) sobem pra
--      'finalizada'.
--
-- Depois desta migration, também vão mudar fora do banco:
--   - actions.ts aprovar: se renovação com dispensa, seta 'finalizada' direto
--     depois de criar o contrato.
--   - api/freelancers/contratos/[id]/gerar-minuta/route.ts: aceita solicitação
--     em 'aprovada' ou 'cadastrada' e transiciona pra 'finalizada'.

begin;

-- 1. Adiciona 'finalizada' ao enum (ALTER TYPE ADD VALUE tem que rodar fora
--    de transação que tenha outras operações, mas aqui estamos criando o
--    valor e usando em seguida, OK em migration isolada).
alter type public.freelancer_solicitacao_status add value if not exists 'finalizada';

commit;

begin;

-- 2. Reescreve a RPC pra decidir cadastrada vs finalizada com base em
--    dispensa de minuta (diária < 15 dias).
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
  v_dispensa boolean;
  v_novo_status public.freelancer_solicitacao_status;
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

  -- Detecta dispensa de minuta (diária curta < 15 dias) pra decidir o
  -- status final da solicitação. Se dispensa, pula direto pra finalizada;
  -- senão, cai em cadastrada aguardando o RH gerar a minuta.
  v_dispensa := (
    v_solicitacao.tipo = 'diarias'
    and v_solicitacao.data_inicio is not null
    and v_solicitacao.data_termino is not null
    and (v_solicitacao.data_termino - v_solicitacao.data_inicio) < 15
  );
  v_novo_status := case when v_dispensa then 'finalizada'::public.freelancer_solicitacao_status
                        else 'cadastrada'::public.freelancer_solicitacao_status
                   end;

  update public.freelancer_solicitacoes set
    status = v_novo_status,
    freelancer_id = v_freelancer_id,
    contrato_id = v_contrato_id
  where id = v_solicitacao.id;

  return query select v_freelancer_id, v_contrato_id, v_ja_existia;
end;
$function$;

-- 3. Backfill: solicitações hoje em 'cadastrada' cujo contrato tem minuta
--    (arquivo_url OU minuta_url) OU que seriam dispensadas pela regra atual
--    (diária < 15d) sobem pra 'finalizada'.
update public.freelancer_solicitacoes s
   set status = 'finalizada', updated_at = now()
  from public.freelancer_contratos c
 where s.contrato_id = c.id
   and s.status = 'cadastrada'
   and (
     c.arquivo_url is not null
     or c.minuta_url is not null
     or (
       c.tipo = 'diarias'
       and c.data_inicio is not null
       and c.data_termino is not null
       and (c.data_termino - c.data_inicio) < 15
     )
   );

commit;
