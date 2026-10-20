-- Decisão 191 (19/10/2026): a conta ou o PIX do titular da verba que não paga
-- pela ficha do RH.
--
-- Até aqui (decisão 171) só o colaborador do RH levava conta para a PP de
-- verba: o gatilho `pp_foto_do_colaborador` copiava a ficha dele. O freela não
-- levava nada, e a PP saía sem dados bancários (a PP-00127 foi recusada pelo
-- financeiro por isso). Desde 19/10 o freela vem do cadastro de freelas do RH
-- (`freelancers`), que tem PIX e conta, mas em texto livre: tipo da chave não
-- guardado, banco escrito à mão, conta às vezes sem dígito, sem tipo de conta.
--
-- A regra aprovada pelo Tiago (protótipo v3):
--   1. Freela com PIX completo no cadastro (o tipo se deduz com segurança:
--      e-mail, chave aleatória, CNPJ, ou o CPF da própria pessoa) paga por
--      ele, AUTOMÁTICO: o gatilho copia o PIX para a PP, como faz com a ficha
--      do colaborador. O dado nunca passa pela tela (uma função que a tela
--      chamasse entregaria o PIX de qualquer freela a quem gera PP).
--   2. Freela sem PIX completo e colaborador sem conta nem PIX na ficha: quem
--      gera a PP digita o PIX ou a conta (obrigatório, conferido no servidor).
--      O app grava nas colunas da foto; o gatilho guarda o que veio enquanto a
--      PP está "gerada" e não deixa mudar depois do envio ao financeiro.
--   3. A conta do cadastro de freelas não vai automática (falta o tipo de
--      conta e às vezes o dígito).
--
-- O que muda no banco:
--   - `pix_do_cadastro_do_freelancer(uuid)`: o PIX usável do freela, ou nada.
--     Fechada para `authenticated` e `anon`; só o gatilho e a lista a chamam
--     (as duas são SECURITY DEFINER).
--   - `pp_foto_do_colaborador()`: cobre o freela (PIX automático + CPF) e
--     preserva o pagamento digitado de quem não tem ficha usável.
--   - `pessoas_para_verba(uuid)`: ganha `paga_pelo_cadastro` (só sim ou não,
--     nunca o dado), que decide se o formulário pede o campo. A mudança no
--     retorno exige recriar a função; o corpo é o da migration
--     20261019900004, mais a coluna.
-- Nenhuma linha é alterada pela migration. As 10 PPs de freela já enviadas
-- (sem foto) continuam sem foto: o gatilho só tira a foto do freela na PP
-- "gerada".

-- 1. O PIX do cadastro de freelas que dá para usar sozinho ---------------------
create or replace function public.pix_do_cadastro_do_freelancer(p_freelancer_id uuid)
returns table (pix_tipo public.pix_tipo_chave, pix_chave text, cpf text)
language sql
stable
set search_path = ''
as $$
  with f as (
    select btrim(coalesce(fr.pix_chave, '')) as chave,
           regexp_replace(coalesce(fr.pix_chave, ''), '\D', '', 'g') as digitos,
           regexp_replace(coalesce(fr.cpf, ''), '\D', '', 'g') as cpf
      from public.freelancers fr
     where fr.id = p_freelancer_id
  ),
  t as (
    select
      f.cpf,
      case
        when f.chave like '%@%' then 'email'
        when lower(f.chave) ~ '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$' then 'aleatoria'
        when f.chave !~ '[A-Za-z]' and f.digitos ~ '^[0-9]{14}$' then 'cnpj'
        -- 11 números só são CPF quando são o da própria pessoa; senão podem
        -- ser telefone ou o CPF de outra, e o PIX não vai automático.
        when f.chave !~ '[A-Za-z]' and f.digitos ~ '^[0-9]{11}$' and f.digitos = f.cpf then 'cpf'
      end as tipo,
      case
        when f.chave like '%@%' then lower(f.chave)
        when lower(f.chave) ~ '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$' then (
          select substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-' ||
                 substr(h, 17, 4) || '-' || substr(h, 21, 12)
            from (select regexp_replace(lower(f.chave), '[^0-9a-f]', '', 'g') as h) x
        )
        else f.digitos
      end as chave_normal
    from f
  )
  select t.tipo::public.pix_tipo_chave,
         t.chave_normal,
         case when t.cpf ~ '^[0-9]{11}$' then t.cpf end
    from t
   where t.tipo is not null
     -- A mesma régua das CHECKs de fornecedores e colaboradores.
     and case t.tipo
           when 'email' then length(t.chave_normal) <= 77
             and t.chave_normal ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
           when 'aleatoria' then t.chave_normal ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           when 'cnpj' then t.chave_normal ~ '^[0-9]{14}$'
           when 'cpf' then t.chave_normal ~ '^[0-9]{11}$'
           else false
         end;
$$;

comment on function public.pix_do_cadastro_do_freelancer(uuid) is
  'Decisão 191: o PIX do cadastro de freelas que vai automático para a PP de verba (tipo deduzido com segurança: e-mail, aleatória, CNPJ ou o CPF da própria pessoa), já no formato do banco, e o CPF do freela. Nenhuma linha = o freela digita o pagamento na PP. Só para o gatilho e para pessoas_para_verba.';

revoke all on function public.pix_do_cadastro_do_freelancer(uuid) from public, anon, authenticated;

-- 2. O gatilho da foto do titular --------------------------------------------
create or replace function public.pp_foto_do_colaborador()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tirar   boolean;
  v_ficha   boolean;
  v_cpf     text;
  c         public.colaboradores%rowtype;
  v_pix     record;
begin
  -- Fora da verba de uma pessoa (colaborador ou freela) não há CPF do
  -- titular: a PP que troca de titular não o leva.
  if not (
    new.verba_producao is true
    and (
      (new.verba_titular_tipo = 'colaborador' and new.verba_colaborador_id is not null)
      or (new.verba_titular_tipo = 'freela' and new.verba_freela_id is not null)
    )
  ) then
    new.verba_titular_cpf := null;
    return new;
  end if;

  -- O que o cadastro tem: a ficha do RH do colaborador (decisão 171) ou o
  -- PIX completo do cadastro de freelas (decisão 191).
  if new.verba_titular_tipo = 'colaborador' then
    select * into c
      from public.colaboradores
     where id = new.verba_colaborador_id
       and tenant_id = new.tenant_id;
    v_ficha := nullif(btrim(c.conta), '') is not null or nullif(btrim(c.pix_chave), '') is not null;
    v_cpf := nullif(regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g'), '');
  else
    select p.pix_tipo, p.pix_chave, p.cpf into v_pix
      from public.pix_do_cadastro_do_freelancer(new.verba_freela_id) p;
    v_ficha := v_pix.pix_chave is not null;
    v_cpf := (
      select nullif(regexp_replace(coalesce(f.cpf, ''), '\D', '', 'g'), '')
        from public.freelancers f
       where f.id = new.verba_freela_id
    );
  end if;
  if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then
    v_cpf := null;
  end if;

  -- Sem cadastro usável, o pagamento é o que quem gerou digitou na PP
  -- (decisão 191): o app grava, o banco guarda. Enviada ao financeiro, a
  -- foto não muda mais.
  if not v_ficha then
    if tg_op = 'UPDATE' and old.status <> 'gerada' then
      new.fornecedor_banco_codigo       := old.fornecedor_banco_codigo;
      new.fornecedor_banco_nome         := old.fornecedor_banco_nome;
      new.fornecedor_agencia            := old.fornecedor_agencia;
      new.fornecedor_agencia_dv         := old.fornecedor_agencia_dv;
      new.fornecedor_conta              := old.fornecedor_conta;
      new.fornecedor_conta_dv           := old.fornecedor_conta_dv;
      new.fornecedor_tipo_conta         := old.fornecedor_tipo_conta;
      new.fornecedor_pix_tipo           := old.fornecedor_pix_tipo;
      new.fornecedor_pix_chave          := old.fornecedor_pix_chave;
      new.verba_titular_cpf             := old.verba_titular_cpf;
      new.dados_pagamento_congelados_em := old.dados_pagamento_congelados_em;
      return new;
    end if;
    new.verba_titular_cpf := v_cpf;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_tirar := true;
  elsif new.verba_titular_tipo = 'freela' and old.status <> 'gerada' then
    -- A PP de freela enviada antes desta regra (sem foto) não ganha o PIX
    -- depois: enviada, a foto não muda.
    v_tirar := false;
  else
    v_tirar := old.dados_pagamento_congelados_em is null
      or old.verba_titular_tipo is distinct from new.verba_titular_tipo
      or (
        old.status = 'gerada'
        and (
          new.verba_colaborador_id is distinct from old.verba_colaborador_id
          or new.verba_freela_id is distinct from old.verba_freela_id
        )
      );
  end if;

  if not v_tirar then
    -- A foto do cadastro é do banco, não da tela.
    new.fornecedor_banco_codigo       := old.fornecedor_banco_codigo;
    new.fornecedor_banco_nome         := old.fornecedor_banco_nome;
    new.fornecedor_agencia            := old.fornecedor_agencia;
    new.fornecedor_agencia_dv         := old.fornecedor_agencia_dv;
    new.fornecedor_conta              := old.fornecedor_conta;
    new.fornecedor_conta_dv           := old.fornecedor_conta_dv;
    new.fornecedor_tipo_conta         := old.fornecedor_tipo_conta;
    new.fornecedor_pix_tipo           := old.fornecedor_pix_tipo;
    new.fornecedor_pix_chave          := old.fornecedor_pix_chave;
    new.verba_titular_cpf             := old.verba_titular_cpf;
    new.dados_pagamento_congelados_em := old.dados_pagamento_congelados_em;
    return new;
  end if;

  if new.verba_titular_tipo = 'colaborador' then
    new.fornecedor_banco_codigo := nullif(btrim(c.banco_codigo), '');
    new.fornecedor_banco_nome   := nullif(btrim(c.banco_nome), '');
    new.fornecedor_agencia      := nullif(btrim(c.agencia), '');
    new.fornecedor_agencia_dv   := nullif(btrim(c.agencia_dv), '');
    new.fornecedor_conta        := nullif(btrim(c.conta), '');
    new.fornecedor_conta_dv     := nullif(btrim(c.conta_dv), '');
    new.fornecedor_tipo_conta   := c.tipo_conta;
    new.fornecedor_pix_tipo     := case when nullif(btrim(c.pix_chave), '') is null then null else c.pix_tipo end;
    new.fornecedor_pix_chave    := nullif(btrim(c.pix_chave), '');
  else
    -- Freela: só o PIX. A conta do cadastro não vai automática.
    new.fornecedor_banco_codigo := null;
    new.fornecedor_banco_nome   := null;
    new.fornecedor_agencia      := null;
    new.fornecedor_agencia_dv   := null;
    new.fornecedor_conta        := null;
    new.fornecedor_conta_dv     := null;
    new.fornecedor_tipo_conta   := null;
    new.fornecedor_pix_tipo     := v_pix.pix_tipo;
    new.fornecedor_pix_chave    := v_pix.pix_chave;
  end if;
  new.verba_titular_cpf := v_cpf;
  new.dados_pagamento_congelados_em := now();
  return new;
end;
$function$;

-- 3. A lista diz quem paga pelo cadastro -------------------------------------
drop function if exists public.pessoas_para_verba(uuid);

create function public.pessoas_para_verba(p_tenant_id uuid)
returns table(id uuid, origem text, nome text, funcao text, detalhe text, busca text, paga_pelo_cadastro boolean)
language sql stable security definer set search_path to 'public'
as $function$
  WITH quem AS (
    SELECT tm.role::text AS papel
      FROM public.tenant_members tm
      JOIN public.profiles p ON p.id = tm.user_id
     WHERE tm.user_id = (SELECT auth.uid())
       AND tm.tenant_id = p_tenant_id
       AND tm.status = 'ativo'
       AND p.ativo
  ),
  nome_pecas AS (
    SELECT
      f.id, f.cpf, f.cidade,
      coalesce(nullif(trim(f.nome_completo), ''), f.nome_social) AS nome_cheio,
      (
        SELECT array_agg(parte ORDER BY ord)
          FROM unnest(regexp_split_to_array(
            trim(coalesce(nullif(f.nome_completo, ''), f.nome_social, '')), '\s+'
          )) WITH ORDINALITY AS t(parte, ord)
         WHERE parte <> ''
           AND upper(parte) NOT IN (
             'DE','DA','DO','DOS','DAS','E',
             'FILHO','FILHA','JUNIOR','JR','NETO','NETA','SOBRINHO','SOBRINHA'
           )
      ) AS pecas
    FROM public.freelancers f
    WHERE f.tenant_id = p_tenant_id
      -- Só quem não está "Encerrado" no módulo de Freelancers.
      AND NOT EXISTS (
        SELECT 1 FROM public.freelancers_com_status s
         WHERE s.id = f.id
           AND s.status_calculado = 'encerrado'
      )
  )
  SELECT c.id, 'colaborador'::text, c.nome, c.funcao, c.tipo_contratacao::text, NULL::text,
         -- A ficha do RH tem conta ou PIX (o que o gatilho copia).
         (nullif(btrim(c.conta), '') IS NOT NULL OR nullif(btrim(c.pix_chave), '') IS NOT NULL)
    FROM public.colaboradores c
   WHERE c.tenant_id = p_tenant_id
     AND c.status = 'ativo'
     AND EXISTS (SELECT 1 FROM quem WHERE papel IN ('administrador','gerente_producao','produtor','freelancer'))
  UNION ALL
  SELECT
    np.id,
    'freela'::text,
    CASE
      WHEN np.pecas IS NULL OR array_length(np.pecas, 1) IS NULL THEN np.nome_cheio
      WHEN array_length(np.pecas, 1) = 1 THEN np.pecas[1]
      ELSE np.pecas[1] || ' ' || np.pecas[array_length(np.pecas, 1)]
    END AS nome,
    (
      SELECT c.cargo
        FROM public.freelancer_contratos c
       WHERE c.freelancer_id = np.id AND c.tenant_id = p_tenant_id
       ORDER BY
         CASE
           WHEN c.status_real AND c.data_inicio <= CURRENT_DATE AND c.data_termino >= CURRENT_DATE THEN 1
           WHEN c.status_real AND c.data_inicio > CURRENT_DATE THEN 2
           ELSE 3
         END,
         c.data_inicio DESC NULLS LAST,
         c.created_at DESC
       LIMIT 1
    ) AS funcao,
    np.cidade AS detalhe,
    np.nome_cheio AS busca,
    -- O PIX completo do cadastro de freelas (decisão 191).
    EXISTS (SELECT 1 FROM public.pix_do_cadastro_do_freelancer(np.id))
    FROM nome_pecas np
   WHERE EXISTS (SELECT 1 FROM quem WHERE papel IN ('administrador','gerente_producao','produtor','freelancer'))
     AND NOT EXISTS (
       SELECT 1 FROM public.colaboradores c
        WHERE c.tenant_id = p_tenant_id
          AND c.status = 'ativo'
          AND np.cpf IS NOT NULL
          AND regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = np.cpf
     );
$function$;

comment on function public.pessoas_para_verba(uuid) is
  'Decisões 164, 171 e 191: quem pode ser titular da verba (colaboradores ativos do RH e freelas não encerrados), só nome, função, o segundo dado da linha e se paga pelo cadastro (sim ou não, nunca o dado). Só para quem gera PP.';

revoke all on function public.pessoas_para_verba(uuid) from public, anon;
grant execute on function public.pessoas_para_verba(uuid) to authenticated;
