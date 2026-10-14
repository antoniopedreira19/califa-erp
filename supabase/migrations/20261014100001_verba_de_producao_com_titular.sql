-- Decisão 171 (14/10/2026): a verba de produção igual às de alimentação e
-- de transporte, e a conta e o PIX do RH na PP do colaborador.
--
-- Por quê: em 13/10/2026 uma produtora gerou a PP-00160 (verba de
-- alimentação para uma colaboradora do RH) e ela saiu sem dados de
-- pagamento — a regra 4 da decisão 164. A colaboradora tem conta e PIX no
-- RH, mas a ficha do RH só abre para administrador e RH: nem a produção nem
-- os 4 usuários do financeiro enxergam. O Tiago decidiu (opção C) que a PP
-- do colaborador traz a conta e o PIX do RH, como a PP de fornecedor traz
-- os do cadastro. E pediu que a verba de produção funcione do mesmo modo
-- que as outras duas: "Titular da verba" em vez de "Responsável", a mesma
-- lista (RH + freelas) e a opção do terceiro (fornecedor), com a mesma
-- prestação de contas.
--
-- O que muda no banco:
--   1. `pedidos_compra` e `pedidos_compra_a_emitir`: a CHECK de coerência
--      aceita a verba de produção com titular. A forma antiga (responsável
--      do sistema, sem titular) continua válida: as 10 PPs e as 4 PPs a
--      emitir de produção gravadas antes ficam como estão, e a versão do
--      app no ar até o deploy ainda grava assim. Só alarga a regra.
--   2. `pedidos_compra.verba_titular_cpf`: o CPF do colaborador titular no
--      momento da PP, para o bloco de pagamento do PDF (o mesmo bloco da PP
--      de fornecedor, com "CPF"). Coluna nova, nula.
--   3. A FOTO DO PAGAMENTO DO COLABORADOR é tirada pelo banco, num gatilho:
--      banco, agência, conta, tipo, PIX e CPF saem da ficha do RH e entram
--      nas mesmas colunas da foto do fornecedor (decisão 067), com
--      `dados_pagamento_congelados_em`. Gatilho, e não uma função que a
--      tela chame, porque uma função assim entregaria a conta e o CPF de
--      qualquer colaborador a quem gera PP (GP, produtor e freelancer),
--      pelo console. Pelo gatilho, o dado só chega a quem lê uma PP que de
--      fato foi gerada para aquela pessoa — com autor e data na PP.
--      A foto é tirada na geração; na PP ainda gerada, de novo quando o
--      titular muda. Depois disso, fica: o app que regrava as colunas de
--      pagamento (a edição da PP manda as do fornecedor, nulas aqui) não
--      apaga o que veio do RH. Colaborador sem conta nem PIX no RH (18 de
--      211 em 14/10/2026): a foto fica vazia e a PP sai sem o bloco, como
--      antes. Freela e terceiro não passam por aqui.
--   4. `enviar_prestacao_verba`: presta contas de qualquer verba o
--      administrador, o GP, o produtor ou o freela do job (a regra da 164,
--      que agora vale também para a produção). O responsável da verba de
--      produção antiga continua podendo prestar contas da dele.
--   5. Backfill da foto nas PPs de colaborador que já existem (PP-00160 e
--      PP-00165 em 14/10/2026), que estão sem foto: preenche o vazio. O
--      PDF delas é refeito pelo app, à parte.
--
-- A remessa continua exigindo fornecedor (decisão do Tiago: "não agora"):
-- a verba do colaborador é paga manualmente, pelos dados do PDF.
--
-- `colaboradores` é tabela do RH (a outra frente): aqui ela só é LIDA, pela
-- função do gatilho, com SECURITY DEFINER. Nada nela muda.

-- 1. Coerência ---------------------------------------------------------------
alter table public.pedidos_compra
  drop constraint if exists chk_pp_verba_coerencia;
alter table public.pedidos_compra
  add constraint chk_pp_verba_coerencia check (
    (
      not verba_producao
      and tipo_verba is null and verba_titular_tipo is null
      and fornecedor_id is not null and responsavel_verba_id is null
      and verba_colaborador_id is null and verba_freela_id is null
    )
    or (
      -- A verba de produção de antes da decisão 171: responsável do sistema.
      verba_producao and coalesce(tipo_verba, 'producao') = 'producao'
      and verba_titular_tipo is null
      and fornecedor_id is null and responsavel_verba_id is not null
      and verba_colaborador_id is null and verba_freela_id is null
    )
    or (
      verba_producao and tipo_verba in ('producao', 'alimentacao', 'transporte')
      and responsavel_verba_id is null
      and length(btrim(coalesce(verba_titular_nome, ''))) > 0
      and (
        (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
        or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
        or (verba_titular_tipo = 'fornecedor' and fornecedor_id is not null and verba_colaborador_id is null and verba_freela_id is null)
      )
    )
  );

alter table public.pedidos_compra_a_emitir
  drop constraint if exists chk_ppae_verba;
alter table public.pedidos_compra_a_emitir
  add constraint chk_ppae_verba check (
    (
      not verba_producao
      and tipo_verba is null and verba_titular_tipo is null
      and fornecedor_id is not null and responsavel_verba_id is null
      and verba_colaborador_id is null and verba_freela_id is null
    )
    or (
      verba_producao and coalesce(tipo_verba, 'producao') = 'producao'
      and verba_titular_tipo is null
      and fornecedor_id is null and responsavel_verba_id is not null
      and verba_colaborador_id is null and verba_freela_id is null
    )
    or (
      verba_producao and tipo_verba in ('producao', 'alimentacao', 'transporte')
      and responsavel_verba_id is null
      and length(btrim(coalesce(verba_titular_nome, ''))) > 0
      and (
        (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
        or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
        or (verba_titular_tipo = 'fornecedor' and fornecedor_id is not null and verba_colaborador_id is null and verba_freela_id is null)
      )
    )
  );

comment on column public.pedidos_compra.tipo_verba is
  'Decisões 164 e 171: producao, alimentacao ou transporte. Nulo fora da verba. Desde a 171 os três têm titular; só a verba de produção anterior a ela tem responsável (responsavel_verba_id).';
comment on column public.pedidos_compra.verba_titular_tipo is
  'Decisões 164 e 171: de onde vem o titular da verba — colaborador (RH), freela ou fornecedor (terceiro, em fornecedor_id). Nulo só fora da verba e na verba de produção anterior à 171.';

-- 2. O CPF do titular --------------------------------------------------------
alter table public.pedidos_compra
  add column if not exists verba_titular_cpf text
    check (verba_titular_cpf is null or verba_titular_cpf ~ '^[0-9]{11}$');

comment on column public.pedidos_compra.verba_titular_cpf is
  'Decisão 171: o CPF do colaborador titular no momento da PP, para o bloco de pagamento do PDF. Gravado só pelo gatilho trg_pp_foto_do_colaborador, a partir da ficha do RH.';

-- 3. A foto do pagamento do colaborador -------------------------------------
create or replace function public.pp_foto_do_colaborador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tirar boolean;
  c       public.colaboradores%rowtype;
begin
  if not (
    new.verba_producao is true
    and new.verba_titular_tipo = 'colaborador'
    and new.verba_colaborador_id is not null
  ) then
    -- O CPF é só do colaborador: a PP que troca de titular não o leva.
    new.verba_titular_cpf := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_tirar := true;
  else
    v_tirar := old.dados_pagamento_congelados_em is null
      or old.verba_titular_tipo is distinct from 'colaborador'
      or (old.status = 'gerada' and new.verba_colaborador_id is distinct from old.verba_colaborador_id);
  end if;

  if not v_tirar then
    -- A foto do colaborador é do banco, não da tela.
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

  select * into c
    from public.colaboradores
   where id = new.verba_colaborador_id
     and tenant_id = new.tenant_id;

  new.fornecedor_banco_codigo       := nullif(btrim(c.banco_codigo), '');
  new.fornecedor_banco_nome         := nullif(btrim(c.banco_nome), '');
  new.fornecedor_agencia            := nullif(btrim(c.agencia), '');
  new.fornecedor_agencia_dv         := nullif(btrim(c.agencia_dv), '');
  new.fornecedor_conta              := nullif(btrim(c.conta), '');
  new.fornecedor_conta_dv           := nullif(btrim(c.conta_dv), '');
  new.fornecedor_tipo_conta         := c.tipo_conta;
  new.fornecedor_pix_tipo           := case when nullif(btrim(c.pix_chave), '') is null then null else c.pix_tipo end;
  new.fornecedor_pix_chave          := nullif(btrim(c.pix_chave), '');
  new.verba_titular_cpf             := nullif(regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g'), '');
  if new.verba_titular_cpf is not null and new.verba_titular_cpf !~ '^[0-9]{11}$' then
    new.verba_titular_cpf := null;
  end if;
  new.dados_pagamento_congelados_em := now();
  return new;
end;
$$;

comment on function public.pp_foto_do_colaborador() is
  'Decisão 171: tira a foto do pagamento (conta, PIX e CPF) da ficha do RH na PP de verba cujo titular é colaborador — na geração e, na PP ainda gerada, quando o titular muda. Depois disso, mantém a foto: a tela não a apaga.';

revoke all on function public.pp_foto_do_colaborador() from public, anon, authenticated;

drop trigger if exists trg_pp_foto_do_colaborador on public.pedidos_compra;
create trigger trg_pp_foto_do_colaborador
  before insert or update on public.pedidos_compra
  for each row execute function public.pp_foto_do_colaborador();

-- 4. Prestação de contas: a mesma regra para as três verbas -------------------
create or replace function public.enviar_prestacao_verba(p_pp_id uuid, p_documentos jsonb, p_sem_gasto boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_pp           pedidos_compra%rowtype;
  v_papel        text;
  v_prest        pp_verba_prestacoes%rowtype;
  v_prest_id     uuid;
  v_doc          jsonb;
  v_valor        numeric;
  v_soma         numeric(14,2) := 0;
  v_prefixo      text;
  v_ids_mantidos uuid[];
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;

  if v_pp.verba_producao is not true then
    raise exception 'Esta PP não é de verba.';
  end if;
  if v_pp.status <> 'pago' then
    raise exception 'A prestação de contas abre depois que a verba estiver paga.';
  end if;

  -- Decisões 164 e 171: o titular pode nem ter acesso ao sistema — presta
  -- contas quem gera PP no job, em qualquer das três verbas. O responsável
  -- da verba de produção anterior à 171 segue podendo prestar a dele.
  if not (
    v_papel in ('administrador', 'gerente_producao', 'produtor')
    or v_pp.responsavel_verba_id = v_uid
    or (
      v_papel = 'freelancer'
      and exists (
        select 1 from public.jobs j
         where j.id = v_pp.job_id
           and public.is_freelancer_do_projeto(j.projeto_id)
      )
    )
  ) then
    raise exception 'Só um administrador, um GP, um produtor ou o freela do job presta contas desta verba.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if found and v_prest.status = 'em_avaliacao' then
    raise exception 'A prestação desta verba já está com o financeiro.';
  end if;
  if found and v_prest.status = 'aprovada' then
    raise exception 'A prestação desta verba já foi aprovada.';
  end if;

  if coalesce(p_sem_gasto, false) then
    if p_documentos is not null
       and jsonb_typeof(p_documentos) = 'array'
       and jsonb_array_length(p_documentos) > 0 then
      raise exception 'Sem gasto, a prestação vai sem documento. Retire os documentos ou desmarque "não houve gasto".';
    end if;
    p_documentos := '[]'::jsonb;
  elsif p_documentos is null
     or jsonb_typeof(p_documentos) <> 'array'
     or jsonb_array_length(p_documentos) = 0 then
    raise exception 'Anexe ao menos um documento — NF ou recibo.';
  end if;

  v_prefixo := v_pp.tenant_id::text || '/verba-prestacoes/' || v_pp.id::text || '/';

  -- Valida o conjunto inteiro antes de gravar qualquer coisa.
  for v_doc in select value from jsonb_array_elements(p_documentos) loop
    v_valor := nullif(v_doc->>'valor', '')::numeric;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor de cada documento.';
    end if;
    if coalesce(v_doc->>'documento_tipo', '') not in ('nota_fiscal', 'recibo') then
      raise exception 'Só NF e recibo comprovam gasto da verba.';
    end if;
    if nullif(v_doc->>'id', '') is not null then
      if v_prest.id is null or not exists (
        select 1 from public.pp_verba_prestacoes_anexos a
         where a.id = (v_doc->>'id')::uuid and a.prestacao_id = v_prest.id
      ) then
        raise exception 'Documento não pertence a esta prestação.';
      end if;
    else
      if left(coalesce(v_doc->>'path', ''), length(v_prefixo)) <> v_prefixo then
        raise exception 'Documento em caminho inválido.';
      end if;
      if coalesce(btrim(v_doc->>'nome_original'), '') = ''
         or coalesce(nullif(v_doc->>'tamanho_bytes', '')::bigint, 0) <= 0
         or coalesce(v_doc->>'mimetype', '') = '' then
        raise exception 'Documento sem arquivo válido.';
      end if;
    end if;
    v_soma := v_soma + round(v_valor, 2);
  end loop;

  if v_soma > v_pp.valor then
    raise exception 'Os documentos somam R$ %, acima da verba de R$ %. O excedente precisa de uma PP nova.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;

  if v_prest.id is null then
    insert into public.pp_verba_prestacoes (
      tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por, status
    ) values (
      v_pp.tenant_id, v_pp.id, v_soma, v_pp.valor - v_soma, v_uid, 'em_avaliacao'
    )
    returning id into v_prest_id;
  else
    v_prest_id := v_prest.id;
    update public.pp_verba_prestacoes
       set valor_gasto     = v_soma,
           valor_devolvido = v_pp.valor - v_soma,
           status          = 'em_avaliacao',
           fechada_em      = now(),
           fechada_por     = v_uid
     where id = v_prest_id;
  end if;

  select coalesce(array_agg((d.value->>'id')::uuid), '{}')
    into v_ids_mantidos
    from jsonb_array_elements(p_documentos) d
   where nullif(d.value->>'id', '') is not null;

  delete from public.pp_verba_prestacoes_anexos
   where prestacao_id = v_prest_id
     and not (id = any (v_ids_mantidos));

  for v_doc in select value from jsonb_array_elements(p_documentos) loop
    if nullif(v_doc->>'id', '') is not null then
      update public.pp_verba_prestacoes_anexos
         set documento_tipo   = (v_doc->>'documento_tipo')::documento_tipo,
             documento_numero = nullif(btrim(coalesce(v_doc->>'documento_numero', '')), ''),
             valor            = round((v_doc->>'valor')::numeric, 2)
       where id = (v_doc->>'id')::uuid;
    else
      insert into public.pp_verba_prestacoes_anexos (
        tenant_id, prestacao_id, arquivo_path, arquivo_nome_original,
        arquivo_tamanho_bytes, arquivo_mimetype, documento_tipo,
        documento_numero, valor, created_by
      ) values (
        v_pp.tenant_id, v_prest_id, v_doc->>'path', btrim(v_doc->>'nome_original'),
        (v_doc->>'tamanho_bytes')::bigint, v_doc->>'mimetype',
        (v_doc->>'documento_tipo')::documento_tipo,
        nullif(btrim(coalesce(v_doc->>'documento_numero', '')), ''),
        round((v_doc->>'valor')::numeric, 2), v_uid
      );
    end if;
  end loop;

  return v_prest_id;
end;
$function$;

-- 5. Backfill: as PPs de colaborador que já existem, sem foto ----------------
-- Preenche o vazio. O gatilho acima faz a cópia (a foto está nula, então
-- ele tira); o `set` só dispara o UPDATE.
update public.pedidos_compra
   set dados_pagamento_congelados_em = null
 where verba_producao
   and verba_titular_tipo = 'colaborador'
   and verba_colaborador_id is not null
   and dados_pagamento_congelados_em is null;
