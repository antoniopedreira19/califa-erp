-- Decisão 132 (30/09/2026) — o financeiro lê e grava o pagamento do colaborador.
--
-- A folha é aprovada pelo financeiro e paga pela remessa Santander, mas a RLS
-- de `colaboradores` só deixa administrador e RH lerem e gravarem. Para quem
-- tem o papel financeiro, isso significava:
--   • aba Folhas de Pagamento com "—" no lugar do nome (o embed voltava nulo);
--   • aprovação da folha falhando com "Colaborador não encontrado";
--   • títulos de folha sumindo do diálogo da remessa e recusados no arquivo.
-- Só funcionava porque todo teste até aqui foi feito como administrador.
--
-- Em vez de abrir a tabela inteira ao financeiro (RG, endereço, nascimento,
-- líder…), duas funções expõem só o que o pagamento usa:
--
--   1. colaboradores_pagamento(tenant, ids): nome, função, contratação,
--      situação, documentos e dados de pagamento. Quem não é administrador,
--      RH ou financeiro do tenant recebe lista vazia, como a RLS faria.
--   2. atualizar_pagamento_colaborador(id, dados): grava só as colunas de
--      pagamento (conta e chave PIX). As CHECKs da tabela
--      (`colaboradores_pix_formato`, `colaboradores_banco_formato`) continuam
--      barrando qualquer dado fora do formato da remessa (decisão 101).
--
-- Fica de fora de propósito: nenhuma policy nova em `colaboradores`. O resto
-- do cadastro continua só de administrador e RH.

create or replace function public.colaboradores_pagamento(
  p_tenant_id uuid,
  p_ids uuid[] default null
)
returns table (
  id uuid,
  nome text,
  funcao text,
  tipo_contratacao public.tipo_contratacao,
  status public.cadastro_status,
  cpf text,
  cnpj text,
  razao_social text,
  pix_tipo public.pix_tipo_chave,
  pix_chave text,
  banco_codigo text,
  banco_nome text,
  agencia text,
  agencia_dv text,
  conta text,
  conta_dv text,
  tipo_conta public.tipo_conta_bancaria
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nome, c.funcao, c.tipo_contratacao, c.status,
         c.cpf, c.cnpj, c.razao_social,
         c.pix_tipo, c.pix_chave,
         c.banco_codigo, c.banco_nome, c.agencia, c.agencia_dv,
         c.conta, c.conta_dv, c.tipo_conta
    from public.colaboradores c
   where c.tenant_id = p_tenant_id
     and (p_ids is null or c.id = any(p_ids))
     and (
       public.is_tenant_admin(p_tenant_id)
       or public.is_tenant_rh(p_tenant_id)
       or public.is_tenant_financeiro(p_tenant_id)
     );
$$;

comment on function public.colaboradores_pagamento(uuid, uuid[]) is
  'Decisão 132: nome, contratação, documentos e dados de pagamento dos colaboradores, para administrador, RH e financeiro. O resto do cadastro segue restrito pela RLS.';

create or replace function public.atualizar_pagamento_colaborador(
  p_colaborador_id uuid,
  p_dados jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select c.tenant_id into v_tenant
    from public.colaboradores c
   where c.id = p_colaborador_id;

  if v_tenant is null then
    raise exception 'Colaborador não encontrado.' using errcode = 'P0002';
  end if;

  if not (
    public.is_tenant_admin(v_tenant)
    or public.is_tenant_rh(v_tenant)
    or public.is_tenant_financeiro(v_tenant)
  ) then
    raise exception 'Sem permissão para alterar os dados de pagamento.'
      using errcode = '42501';
  end if;

  update public.colaboradores
     set banco_codigo = nullif(p_dados->>'banco_codigo', ''),
         banco_nome   = nullif(p_dados->>'banco_nome', ''),
         agencia      = nullif(p_dados->>'agencia', ''),
         agencia_dv   = nullif(p_dados->>'agencia_dv', ''),
         conta        = nullif(p_dados->>'conta', ''),
         conta_dv     = nullif(p_dados->>'conta_dv', ''),
         tipo_conta   = nullif(p_dados->>'tipo_conta', '')::public.tipo_conta_bancaria,
         pix_tipo     = nullif(p_dados->>'pix_tipo', '')::public.pix_tipo_chave,
         pix_chave    = nullif(p_dados->>'pix_chave', '')
   where id = p_colaborador_id;
end;
$$;

comment on function public.atualizar_pagamento_colaborador(uuid, jsonb) is
  'Decisão 132: grava só conta e chave PIX do colaborador, para administrador, RH e financeiro. As CHECKs de formato da tabela continuam valendo.';

revoke all on function public.colaboradores_pagamento(uuid, uuid[]) from public, anon;
revoke all on function public.atualizar_pagamento_colaborador(uuid, jsonb) from public, anon;
grant execute on function public.colaboradores_pagamento(uuid, uuid[]) to authenticated;
grant execute on function public.atualizar_pagamento_colaborador(uuid, jsonb) to authenticated;
