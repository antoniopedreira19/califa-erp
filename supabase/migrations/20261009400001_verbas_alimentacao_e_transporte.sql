-- Decisão 164 (09/10/2026): Verba de Alimentação e Verba de Transporte.
--
-- Por quê: além da verba de produção (adiantamento a um GP ou produtor, com
-- prestação de contas depois), a produção precisa adiantar verba de
-- alimentação e de transporte para quem está no job — um colaborador do RH,
-- um freela ou, fora do padrão, um terceiro com cadastro de fornecedor. A
-- prestação de contas e o estorno do saldo são os mesmos da verba de
-- produção (decisão 081).
--
-- O que muda no banco:
--   1. `freelas`: a lista provisória de freelas, até o RH ter os seus. A
--      carga (os que estão trabalhando na planilha de 09/10/2026, sem quem
--      já está no RH) NÃO está aqui: tem CPF, e o repositório é público. Foi
--      aplicada pelo MCP; a decisão registra só as contagens. O CPF fica só
--      para não repetir quem já está no RH, e só administrador, financeiro e
--      RH leem a tabela. A produção vê nome, função e cidade pela função
--      `pessoas_para_verba`.
--   2. `pedidos_compra` e `pedidos_compra_a_emitir` ganham o tipo da verba e
--      o titular: `tipo_verba` (producao | alimentacao | transporte),
--      `verba_titular_tipo` (colaborador | freela | fornecedor), o id de cada
--      origem e `verba_titular_nome` — o nome no momento da PP, porque a
--      ficha do RH só abre para administrador e RH, e a PP é lida por todo o
--      job e pelo financeiro. As PPs de verba de hoje recebem
--      `tipo_verba = 'producao'` (preenche o vazio).
--   3. As CHECKs de coerência da verba aceitam os tipos novos. A verba de
--      produção continua exatamente como era (responsável do sistema, sem
--      fornecedor); a regra antiga vale com `tipo_verba` nulo, para a versão
--      do app que ainda está no ar até o deploy.
--   4. O pagamento fora do cadastro (chave aleatória, boleto) passa a valer
--      para toda PP com fornecedor — o terceiro da verba usa o pagamento do
--      fornecedor, como pediu o Tiago.
--   5. `pessoas_para_verba`: a lista do formulário (colaboradores ativos do
--      RH e freelas ativos, sem repetir), só para quem gera PP.
--   6. `enviar_prestacao_verba`: na alimentação e no transporte, presta
--      contas o administrador, o GP, o produtor ou o freela do job (o titular
--      pode nem ter acesso ao sistema). A verba de produção segue como era.
--
-- O FK para `colaboradores` (tabela do RH, da outra frente) é ON DELETE SET
-- NULL: a verba não pode impedir o RH de apagar uma ficha, e o nome guardado
-- na PP continua contando quem recebeu.

-- 1. Freelas ----------------------------------------------------------------
create table if not exists public.freelas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  nome        text not null check (length(btrim(nome)) > 0),
  funcao      text,
  cidade      text,
  cpf         text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  ativo       boolean not null default true,
  origem      text not null default 'planilha',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.freelas is
  'Decisão 164: freelas que podem receber verba de alimentação ou de transporte, até o RH ter os seus. Provisória: quando o RH tiver freelas, a lista passa a vir de lá.';
comment on column public.freelas.cpf is
  'Só para não repetir quem já está no RH. Nunca vai para a tela da produção.';

create unique index if not exists freelas_tenant_cpf_uk
  on public.freelas (tenant_id, cpf) where cpf is not null;
create index if not exists freelas_tenant_ativo_idx
  on public.freelas (tenant_id) where ativo;

alter table public.freelas enable row level security;

drop policy if exists freelas_select on public.freelas;
create policy freelas_select on public.freelas
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

drop policy if exists freelas_write on public.freelas;
create policy freelas_write on public.freelas
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

grant select, insert, update, delete on public.freelas to authenticated;
revoke all on public.freelas from anon;

-- 2. Tipo e titular da verba -------------------------------------------------
alter table public.pedidos_compra
  add column if not exists tipo_verba text,
  add column if not exists verba_titular_tipo text,
  add column if not exists verba_colaborador_id uuid references public.colaboradores(id) on delete set null,
  add column if not exists verba_freela_id uuid references public.freelas(id) on delete restrict,
  add column if not exists verba_titular_nome text;

alter table public.pedidos_compra_a_emitir
  add column if not exists tipo_verba text,
  add column if not exists verba_titular_tipo text,
  add column if not exists verba_colaborador_id uuid references public.colaboradores(id) on delete set null,
  add column if not exists verba_freela_id uuid references public.freelas(id) on delete restrict,
  add column if not exists verba_titular_nome text;

comment on column public.pedidos_compra.tipo_verba is
  'Decisão 164: producao, alimentacao ou transporte. Nulo fora da verba.';
comment on column public.pedidos_compra.verba_titular_tipo is
  'Decisão 164: na alimentação e no transporte, de onde vem o titular — colaborador (RH), freela ou fornecedor (terceiro, em fornecedor_id).';
comment on column public.pedidos_compra.verba_titular_nome is
  'Decisão 164: o nome do titular no momento da PP (a ficha do RH não abre para a produção nem para o financeiro).';

create index if not exists pedidos_compra_verba_colaborador_idx
  on public.pedidos_compra (verba_colaborador_id) where verba_colaborador_id is not null;
create index if not exists pedidos_compra_verba_freela_idx
  on public.pedidos_compra (verba_freela_id) where verba_freela_id is not null;
create index if not exists ppae_verba_colaborador_idx
  on public.pedidos_compra_a_emitir (verba_colaborador_id) where verba_colaborador_id is not null;
create index if not exists ppae_verba_freela_idx
  on public.pedidos_compra_a_emitir (verba_freela_id) where verba_freela_id is not null;

-- As verbas de hoje são de produção (preenche o vazio).
update public.pedidos_compra
   set tipo_verba = 'producao'
 where verba_producao and tipo_verba is null;
update public.pedidos_compra_a_emitir
   set tipo_verba = 'producao'
 where verba_producao and tipo_verba is null;

-- 3. Coerência ----------------------------------------------------------------
-- Três formas: PP de fornecedor; verba de produção (como sempre foi, com
-- tipo_verba nulo aceito para o app ainda no ar); alimentação e transporte,
-- com o titular de uma origem só. O id do colaborador pode ficar nulo se o
-- RH apagar a ficha (ON DELETE SET NULL) — o nome guardado segue.
alter table public.pedidos_compra
  drop constraint if exists chk_pp_verba_producao_coerencia;
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
      verba_producao and coalesce(tipo_verba, 'producao') = 'producao'
      and verba_titular_tipo is null
      and fornecedor_id is null and responsavel_verba_id is not null
      and verba_colaborador_id is null and verba_freela_id is null
    )
    or (
      verba_producao and tipo_verba in ('alimentacao', 'transporte')
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
      verba_producao and tipo_verba in ('alimentacao', 'transporte')
      and responsavel_verba_id is null
      and length(btrim(coalesce(verba_titular_nome, ''))) > 0
      and (
        (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
        or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
        or (verba_titular_tipo = 'fornecedor' and fornecedor_id is not null and verba_colaborador_id is null and verba_freela_id is null)
      )
    )
  );

-- 4. Pagamento fora do cadastro: toda PP com fornecedor ----------------------
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_meio_valido;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_meio_valido
  check (
    pagamento_fora_do_cadastro_meio is null
    or (
      pagamento_fora_do_cadastro_meio = any (array['pix'::text, 'conta'::text, 'boleto'::text])
      and fornecedor_id is not null
    )
  );

-- 5. A lista do formulário ---------------------------------------------------
-- Colaboradores ativos do RH e freelas ativos, sem repetir quem está nos
-- dois (pelo CPF: fica o do RH). Só nome, função e o segundo dado da linha
-- (contratação ou cidade) — nada de documento ou conta. Vazia para quem não
-- gera PP.
create or replace function public.pessoas_para_verba(p_tenant_id uuid)
returns table (id uuid, origem text, nome text, funcao text, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
  with quem as (
    select tm.role::text as papel
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.user_id = (select auth.uid())
       and tm.tenant_id = p_tenant_id
       and tm.status = 'ativo'
       and p.ativo
  )
  select c.id, 'colaborador'::text, c.nome, c.funcao, c.tipo_contratacao::text
    from public.colaboradores c
   where c.tenant_id = p_tenant_id
     and c.status = 'ativo'
     and exists (select 1 from quem where papel in ('administrador', 'gerente_producao', 'produtor', 'freelancer'))
  union all
  select f.id, 'freela'::text, f.nome, f.funcao, f.cidade
    from public.freelas f
   where f.tenant_id = p_tenant_id
     and f.ativo
     and exists (select 1 from quem where papel in ('administrador', 'gerente_producao', 'produtor', 'freelancer'))
     and not exists (
       select 1 from public.colaboradores c
        where c.tenant_id = p_tenant_id
          and c.status = 'ativo'
          and f.cpf is not null
          and regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = f.cpf
     )
$$;

comment on function public.pessoas_para_verba(uuid) is
  'Decisão 164: quem pode ser titular da verba de alimentação ou de transporte — colaboradores ativos do RH e freelas ativos, sem repetir. Só para quem gera PP.';

revoke all on function public.pessoas_para_verba(uuid) from public, anon;
grant execute on function public.pessoas_para_verba(uuid) to authenticated;

-- 6. Prestação de contas -----------------------------------------------------
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

  if coalesce(v_pp.tipo_verba, 'producao') = 'producao' then
    -- Decisão 136: qualquer GP, e não só o responsável do job.
    if not (
      v_papel in ('administrador', 'gerente_producao')
      or v_pp.responsavel_verba_id = v_uid
    ) then
      raise exception 'Só o responsável pela verba, um GP ou um administrador presta contas desta verba.';
    end if;
  else
    -- Decisão 164: alimentação e transporte. O titular pode nem ter acesso
    -- ao sistema: presta contas quem gera PP no job.
    if not (
      v_papel in ('administrador', 'gerente_producao', 'produtor')
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
