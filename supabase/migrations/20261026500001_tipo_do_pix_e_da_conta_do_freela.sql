-- Decisão 212 (26/10/2026): o cadastro do freela guarda o tipo da chave PIX e
-- o tipo de conta.
--
-- Desde a decisão 193 a PP de verba ou reembolso de um freela leva o PIX do
-- cadastro de freelas automaticamente, quando o tipo da chave se deduz com
-- segurança (e-mail, chave aleatória, CNPJ ou o CPF da própria pessoa). O
-- cadastro não guardava o tipo: em 26/10, 13 dos 64 freelas ativos têm uma
-- chave de 11 números que não é o CPF deles (telefone? CPF de outra pessoa?),
-- e quem gera a PP digita o PIX de novo. O Tiago aprovou a versão do protótipo
-- "Com o tipo do PIX e o tipo de conta" (o módulo é do Antonio; o acerto com
-- ele é do Tiago).
--
-- O que muda:
--   1. `freelancers.pix_tipo` (pix_tipo_chave) e `freelancers.tipo_conta`
--      (tipo_conta_bancaria), opcionais. Tipo sem chave é recusado.
--   2. Os 136 freelas com o tipo dedutível ganham o tipo pela mesma regra da
--      193 (preenche coluna vazia; a chave não é reescrita). O "atualizado
--      em" deles não muda: o gatilho fica desligado durante o preenchimento.
--      Os outros (os 13 ativos entre eles) o RH completa no editar.
--   3. `pix_do_cadastro_do_freelancer` usa o tipo gravado quando há, e
--      normaliza a chave por ele (telefone passa a ir automático); sem tipo
--      gravado, deduz como antes.
--   4. `cadastrar_freelancer_via_solicitacao` (o formulário do link) grava os
--      dois tipos.
-- Nenhum valor existente é sobrescrito.

-- 1. As colunas -------------------------------------------------------------
alter table public.freelancers
  add column if not exists pix_tipo public.pix_tipo_chave,
  add column if not exists tipo_conta public.tipo_conta_bancaria;

alter table public.freelancers
  drop constraint if exists freelancers_pix_tipo_com_chave;
alter table public.freelancers
  add constraint freelancers_pix_tipo_com_chave
  check (pix_tipo is null or nullif(btrim(pix_chave), '') is not null);

comment on column public.freelancers.pix_tipo is
  'Decisão 212: o tipo da chave PIX (CPF, CNPJ, e-mail, telefone, aleatória). Com ele, a PP de verba ou reembolso do freela leva o PIX do cadastro automaticamente (decisão 193). Nulo = tipo não informado (a 193 tenta deduzir).';
comment on column public.freelancers.tipo_conta is
  'Decisão 212: o tipo da conta bancária (corrente, poupança, pagamento). Informativo: a conta do cadastro de freelas não vai automática para a PP (banco em texto livre).';

-- 2. O tipo dos que já se deduzem (antes de a função mudar) -------------------
alter table public.freelancers disable trigger trg_freelancers_updated_at;

update public.freelancers f
   set pix_tipo = d.pix_tipo
  from (
    select fr.id, (select p.pix_tipo from public.pix_do_cadastro_do_freelancer(fr.id) p) as pix_tipo
      from public.freelancers fr
  ) d
 where d.id = f.id
   and d.pix_tipo is not null
   and f.pix_tipo is null;

alter table public.freelancers enable trigger trg_freelancers_updated_at;

-- 3. O PIX do cadastro: o tipo gravado vence a dedução -----------------------
create or replace function public.pix_do_cadastro_do_freelancer(p_freelancer_id uuid)
returns table (pix_tipo public.pix_tipo_chave, pix_chave text, cpf text)
language sql
stable
set search_path = ''
as $$
  with f as (
    select fr.pix_tipo::text as tipo_gravado,
           btrim(coalesce(fr.pix_chave, '')) as chave,
           regexp_replace(coalesce(fr.pix_chave, ''), '\D', '', 'g') as digitos,
           regexp_replace(coalesce(fr.cpf, ''), '\D', '', 'g') as cpf
      from public.freelancers fr
     where fr.id = p_freelancer_id
  ),
  t as (
    select
      f.chave,
      f.digitos,
      f.cpf,
      coalesce(
        f.tipo_gravado,
        case
          when f.chave like '%@%' then 'email'
          when lower(f.chave) ~ '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$' then 'aleatoria'
          when f.chave !~ '[A-Za-z]' and f.digitos ~ '^[0-9]{14}$' then 'cnpj'
          -- 11 números só são CPF, sem o tipo gravado, quando são o da
          -- própria pessoa; senão podem ser telefone ou o CPF de outra.
          when f.chave !~ '[A-Za-z]' and f.digitos ~ '^[0-9]{11}$' and f.digitos = f.cpf then 'cpf'
        end
      ) as tipo
    from f
  ),
  n as (
    select
      t.tipo,
      t.cpf,
      case t.tipo
        when 'email' then lower(t.chave)
        when 'aleatoria' then (
          select case when length(h) = 32
                      then substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-' ||
                           substr(h, 17, 4) || '-' || substr(h, 21, 12)
                      else lower(t.chave) end
            from (select regexp_replace(lower(t.chave), '[^0-9a-f]', '', 'g') as h) x
        )
        when 'telefone' then '+55' || case when t.digitos like '55%' and length(t.digitos) > 11
                                           then substr(t.digitos, 3) else t.digitos end
        else t.digitos
      end as chave_normal
    from t
    where t.tipo is not null and t.chave <> ''
  )
  select n.tipo::public.pix_tipo_chave,
         n.chave_normal,
         case when n.cpf ~ '^[0-9]{11}$' then n.cpf end
    from n
   where case n.tipo
           -- A mesma régua das CHECKs de fornecedores e colaboradores.
           when 'email' then length(n.chave_normal) <= 77
             and n.chave_normal ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
           when 'aleatoria' then n.chave_normal ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           when 'telefone' then n.chave_normal ~ '^\+55[1-9]{2}9[0-9]{8}$'
           when 'cnpj' then n.chave_normal ~ '^[0-9]{14}$'
           when 'cpf' then n.chave_normal ~ '^[0-9]{11}$'
           else false
         end;
$$;

comment on function public.pix_do_cadastro_do_freelancer(uuid) is
  'Decisões 193 e 212: o PIX do cadastro de freelas que vai automático para a PP de verba — pelo tipo gravado (freelancers.pix_tipo) ou, sem ele, deduzido com segurança (e-mail, aleatória, CNPJ ou o CPF da própria pessoa) —, já no formato do banco, e o CPF do freela. Nenhuma linha = o freela digita o pagamento na PP. Só para o gatilho e para pessoas_para_verba.';

revoke all on function public.pix_do_cadastro_do_freelancer(uuid) from public, anon, authenticated;

-- 4. O formulário do link grava os dois tipos --------------------------------
create or replace function public.cadastrar_freelancer_via_solicitacao(p_token text, p_freelancer jsonb)
returns table(freelancer_id uuid, contrato_id uuid, freelancer_ja_existia boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_solicitacao public.freelancer_solicitacoes%rowtype;
  v_nome_job text;
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

  select nome into v_nome_job
  from public.jobs
  where id = v_solicitacao.job_id
    and tenant_id = v_solicitacao.tenant_id;

  if v_nome_job is null then
    raise exception 'Job vinculado à solicitação não existe mais'
      using errcode = 'P0004';
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
        -- Decisão 212: a chave nova vem com o tipo dela.
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
    tenant_id, freelancer_id, job_id, responsavel_id,
    nome_job, cargo, tipo, valor,
    data_inicio, data_termino, cidade, observacoes,
    origem_sistema
  ) values (
    v_solicitacao.tenant_id, v_freelancer_id,
    v_solicitacao.job_id, v_solicitacao.solicitante_id,
    v_nome_job, v_solicitacao.cargo,
    v_solicitacao.tipo, v_solicitacao.valor,
    v_solicitacao.data_inicio, v_solicitacao.data_termino,
    v_solicitacao.cidade, v_solicitacao.observacoes,
    'califa_erp'
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
