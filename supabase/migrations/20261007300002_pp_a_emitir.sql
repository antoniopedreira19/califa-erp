-- Decisão 151 (07/10/2026) — a PP a emitir: a etapa antes de gerar a PP.
--
-- POR QUE
-- Design aprovado pelo Tiago em 07/10/2026 (protótipo "Etapa antes da PP",
-- v17). O caminho passa a ser: PP a emitir → PP gerada → enviada ao
-- financeiro.
--   • A PP a emitir é o formulário inteiro, salvo e editável — não é
--     rascunho nem fica incompleta. Não tem código, não entra no realizado
--     ("Em PPs a emitir" é um número à parte no painel) e o financeiro não a
--     vê.
--   • "Gerar PP" sempre passa pela revisão e transforma a PP a emitir na PP,
--     que daí em diante NÃO se edita mais.
--   • Job aguardando abertura ou devolvido pelo financeiro só aceita PP a
--     emitir (a trava de gerar fica na Server Action).
--   • PP rejeitada não se edita: "Cancelar e refazer" cancela a PP e devolve
--     uma PP a emitir com os mesmos dados (`refaz_pp_id`), que gera outra PP,
--     com outro código.
--
-- O QUE FICA DE FORA
--   A geração em si (código, PDF, parcelas, anexos da PP) continua na Server
--   Action de sempre (`finalizarPedidoCompra`), que passa a ler daqui.
--
-- O id da PP a emitir é o id que a PP vai ter: os anexos sobem uma vez para
-- `<tenant>/<job>/<id>/anexos/` e a PP gerada os usa no mesmo lugar.
--
-- Também aqui (decisão 150, lado da produção):
--   • `notas_fiscais_do_fornecedor`: a busca da NF pelo fornecedor + número,
--     para a produção saber que a nota já está em outra PP (vem preenchida e
--     travada). Security definer: o freelancer não lê o cadastro de notas.
--   • `ligar_notas_fiscais_da_pp`: no envio ao financeiro, cada anexo do tipo
--     NF aponta para a sua nota — cria a nota nova ou liga à que já existe,
--     sem mudar os dados dela (só o financeiro corrige).
--   • `pp_anexos_update`: o envio passa a gravar o tipo, o número e os dados
--     da NF de anexos que já existem.

-- 1. A PP a emitir ----------------------------------------------------------
create table if not exists public.pedidos_compra_a_emitir (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  job_id                uuid not null references public.jobs(id) on delete restrict,
  item_realizado_id     uuid not null references public.jobs_itens_realizado(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,
  verba_producao        boolean not null,
  fornecedor_id         uuid references public.fornecedores(id) on delete restrict,
  responsavel_verba_id  uuid references public.profiles(id) on delete restrict,
  servico               text not null,
  valor                 numeric(14,2) not null,
  -- O formulário inteiro, no formato que a geração valida (`dadosSchema`).
  dados                 jsonb not null,
  -- A resposta de "Esta é a última PP deste item?"; vale quando gerar.
  ultima_pp_do_item     boolean,
  refaz_pp_id           uuid references public.pedidos_compra(id) on delete restrict,
  pp_id                 uuid references public.pedidos_compra(id) on delete restrict,
  gerada_em             timestamptz,
  excluida_em           timestamptz,
  excluida_por          uuid references public.profiles(id),
  criada_por            uuid references public.profiles(id),
  atualizada_por        uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_ppae_valor check (valor > 0),
  constraint chk_ppae_servico check (length(btrim(servico)) > 0),
  constraint chk_ppae_verba check (
    (verba_producao and fornecedor_id is null and responsavel_verba_id is not null)
    or (not verba_producao and fornecedor_id is not null and responsavel_verba_id is null)
  ),
  constraint chk_ppae_gerada check ((pp_id is null) = (gerada_em is null)),
  constraint chk_ppae_gerada_ou_excluida check (pp_id is null or excluida_em is null),
  constraint chk_ppae_dados check (jsonb_typeof(dados) = 'object')
);
create index if not exists idx_ppae_item_ativas on public.pedidos_compra_a_emitir (item_realizado_id)
  where pp_id is null and excluida_em is null;
create index if not exists idx_ppae_job on public.pedidos_compra_a_emitir (job_id);
create index if not exists idx_ppae_item on public.pedidos_compra_a_emitir (item_realizado_id);
create index if not exists idx_ppae_empresa on public.pedidos_compra_a_emitir (empresa_id);
create index if not exists idx_ppae_fornecedor on public.pedidos_compra_a_emitir (fornecedor_id);
create index if not exists idx_ppae_responsavel on public.pedidos_compra_a_emitir (responsavel_verba_id);
create index if not exists idx_ppae_refaz on public.pedidos_compra_a_emitir (refaz_pp_id);
create index if not exists idx_ppae_pp on public.pedidos_compra_a_emitir (pp_id);
create index if not exists idx_ppae_tenant on public.pedidos_compra_a_emitir (tenant_id);
create index if not exists idx_ppae_excluida_por on public.pedidos_compra_a_emitir (excluida_por);
create index if not exists idx_ppae_criada_por on public.pedidos_compra_a_emitir (criada_por);
create index if not exists idx_ppae_atualizada_por on public.pedidos_compra_a_emitir (atualizada_por);

comment on table public.pedidos_compra_a_emitir is
  'PP a emitir (decisão 151, 07/10/2026): o formulário da PP salvo antes de gerar. Sem código, fora do realizado, invisível ao financeiro. O id é o que a PP terá ao ser gerada (pp_id = id).';
comment on column public.pedidos_compra_a_emitir.refaz_pp_id is
  'A PP rejeitada que esta refaz ("Cancelar e refazer"): a PP foi cancelada e voltou como PP a emitir, com os mesmos dados.';

alter table public.pedidos_compra_a_emitir enable row level security;
drop policy if exists ppae_select on public.pedidos_compra_a_emitir;
drop policy if exists ppae_modify on public.pedidos_compra_a_emitir;
-- O mesmo acesso de `pedidos_compra` (empresa/regional e freelancer do projeto).
create policy ppae_select on public.pedidos_compra_a_emitir
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and public.can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (public.session_role() <> 'freelancer'::app_role
         or exists (select 1 from public.jobs j
                     where j.id = pedidos_compra_a_emitir.job_id and public.is_freelancer_do_projeto(j.projeto_id)))
  );
create policy ppae_modify on public.pedidos_compra_a_emitir
  for all to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and public.can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (public.session_role() <> 'freelancer'::app_role
         or exists (select 1 from public.jobs j
                     where j.id = pedidos_compra_a_emitir.job_id and public.is_freelancer_do_projeto(j.projeto_id)))
  )
  with check (
    tenant_id in (select public.current_tenant_ids())
    and public.can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (public.session_role() <> 'freelancer'::app_role
         or exists (select 1 from public.jobs j
                     where j.id = pedidos_compra_a_emitir.job_id and public.is_freelancer_do_projeto(j.projeto_id)))
  );
revoke all on table public.pedidos_compra_a_emitir from public, anon;
grant select, insert, update, delete on table public.pedidos_compra_a_emitir to authenticated;

drop trigger if exists trg_pedidos_compra_a_emitir_updated_at on public.pedidos_compra_a_emitir;
create trigger trg_pedidos_compra_a_emitir_updated_at
  before update on public.pedidos_compra_a_emitir
  for each row execute function public.set_updated_at();

-- 2. Os anexos da PP a emitir -------------------------------------------------
create table if not exists public.pedidos_compra_a_emitir_anexos (
  id                             uuid primary key default gen_random_uuid(),
  tenant_id                      uuid not null references public.tenants(id) on delete restrict,
  a_emitir_id                    uuid not null references public.pedidos_compra_a_emitir(id) on delete cascade,
  arquivo_path                   text not null,
  arquivo_nome_original          text not null,
  arquivo_tamanho_bytes          bigint not null,
  arquivo_mimetype               text not null,
  documento_tipo                 public.documento_tipo,
  documento_numero               text,
  nf_data_emissao                date,
  nf_valor                       numeric(14,2),
  nf_tomador_estabelecimento_id  uuid references public.fiscal_estabelecimentos(id) on delete restrict,
  nf_valor_na_pp                 numeric(14,2),
  criado_por                     uuid references public.profiles(id),
  created_at                     timestamptz not null default now(),
  constraint chk_ppae_anexo_tamanho check (arquivo_tamanho_bytes > 0),
  constraint chk_ppae_anexo_nf_valor check (nf_valor is null or nf_valor > 0),
  constraint chk_ppae_anexo_nf_parte check (nf_valor_na_pp is null or nf_valor_na_pp > 0)
);
create index if not exists idx_ppae_anexos_pai on public.pedidos_compra_a_emitir_anexos (a_emitir_id);
create index if not exists idx_ppae_anexos_tenant on public.pedidos_compra_a_emitir_anexos (tenant_id);
create index if not exists idx_ppae_anexos_tomador on public.pedidos_compra_a_emitir_anexos (nf_tomador_estabelecimento_id);
create index if not exists idx_ppae_anexos_criado_por on public.pedidos_compra_a_emitir_anexos (criado_por);

comment on table public.pedidos_compra_a_emitir_anexos is
  'Anexos da PP a emitir (decisão 151): o tipo, o número e, na NF, os dados que a produção informou (decisão 150). Viram os anexos da PP quando ela é gerada.';

alter table public.pedidos_compra_a_emitir_anexos enable row level security;
drop policy if exists ppae_anexos_all on public.pedidos_compra_a_emitir_anexos;
-- O acesso é o da PP a emitir (a policy dela vale dentro do exists).
create policy ppae_anexos_all on public.pedidos_compra_a_emitir_anexos
  for all to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and exists (select 1 from public.pedidos_compra_a_emitir p where p.id = pedidos_compra_a_emitir_anexos.a_emitir_id)
  )
  with check (
    tenant_id in (select public.current_tenant_ids())
    and exists (select 1 from public.pedidos_compra_a_emitir p where p.id = pedidos_compra_a_emitir_anexos.a_emitir_id)
  );
revoke all on table public.pedidos_compra_a_emitir_anexos from public, anon;
grant select, insert, update, delete on table public.pedidos_compra_a_emitir_anexos to authenticated;

-- 3. O envio grava o tipo, o número e a NF de anexos que já existem ---------
drop policy if exists pp_anexos_update on public.pedidos_compra_anexos;
create policy pp_anexos_update on public.pedidos_compra_anexos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- 4. A busca da NF pelo fornecedor + número (produção) ----------------------
create or replace function public.notas_fiscais_do_fornecedor(
  p_fornecedor_id uuid,
  p_numeros       text[],
  p_excluir_pp_id uuid default null
)
returns table (
  numero_chave               text,
  nota_id                    uuid,
  numero                     text,
  data_emissao               date,
  valor                      numeric,
  tomador_estabelecimento_id uuid,
  registrada                 boolean,
  pps                        jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.numero_chave, n.id, n.numero, n.data_emissao, n.valor, n.tomador_estabelecimento_id,
         n.registrada_em is not null,
         coalesce((
           select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'valor_na_pp', a.nf_valor_na_pp, 'status', p.status)
                            order by p.codigo)
             from public.pedidos_compra_anexos a
             join public.pedidos_compra p on p.id = a.pedido_compra_id
            where a.nota_fiscal_id = n.id
              and p.status <> 'cancelada'
              and (p_excluir_pp_id is null or p.id <> p_excluir_pp_id)
         ), '[]'::jsonb)
    from public.notas_fiscais_fornecedor n
   where n.fornecedor_id = p_fornecedor_id
     and n.tenant_id in (select public.current_tenant_ids())
     and n.numero_chave = any (select public.chave_do_numero_da_nf(x) from unnest(p_numeros) x)
$$;
revoke all on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) from public, anon;
grant execute on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) to authenticated;
comment on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) is
  'Decisão 150: as notas do fornecedor com esses números (mesma chave), com as PPs que cada uma já cobre. A produção usa para travar a nota que já existe.';

-- 5. O envio liga cada anexo NF à sua nota (produção) -----------------------
-- p_notas: [{anexo_id, numero, data_emissao, valor, tomador_estabelecimento_id, valor_na_pp}],
-- uma por anexo do tipo NF da PP.
create or replace function public.ligar_notas_fiscais_da_pp(
  p_pp_id uuid,
  p_notas jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid;
  v_status     text;
  v_verba      boolean;
  v_fornecedor uuid;
  v_item       jsonb;
  v_anexo      uuid;
  v_numero     text;
  v_emissao    date;
  v_valor      numeric;
  v_parte      numeric;
  v_tomador    uuid;
  v_nota       uuid;
  v_notas      uuid[] := '{}';
  v_anexos_nf  int;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select tenant_id, status::text, verba_producao, fornecedor_id
    into v_tenant, v_status, v_verba, v_fornecedor
    from public.pedidos_compra where id = p_pp_id for update;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'PP não encontrada.';
  end if;
  if v_status <> 'gerada' then
    raise exception 'As notas fiscais se ligam no envio da PP gerada.';
  end if;
  if v_verba or v_fornecedor is null then
    return;
  end if;

  select count(*) into v_anexos_nf
    from public.pedidos_compra_anexos
   where pedido_compra_id = p_pp_id and documento_tipo = 'nota_fiscal';
  if v_anexos_nf = 0 then
    return;
  end if;
  if p_notas is null or jsonb_typeof(p_notas) <> 'array'
     or jsonb_array_length(p_notas) <> v_anexos_nf
     or exists (
       select 1 from jsonb_array_elements(p_notas) e
        where not exists (
          select 1 from public.pedidos_compra_anexos a
           where a.id = (e.value->>'anexo_id')::uuid
             and a.pedido_compra_id = p_pp_id
             and a.documento_tipo = 'nota_fiscal'))
     or (select count(distinct e.value->>'anexo_id') from jsonb_array_elements(p_notas) e) <> v_anexos_nf then
    raise exception 'As notas não batem com os anexos de NF da PP. Recarregue a tela.';
  end if;

  for v_item in select value from jsonb_array_elements(p_notas) loop
    v_anexo   := (v_item->>'anexo_id')::uuid;
    v_numero  := nullif(btrim(v_item->>'numero'), '');
    v_emissao := nullif(v_item->>'data_emissao', '')::date;
    v_valor   := nullif(v_item->>'valor', '')::numeric;
    v_parte   := coalesce(nullif(v_item->>'valor_na_pp', '')::numeric, v_valor);
    v_tomador := nullif(v_item->>'tomador_estabelecimento_id', '')::uuid;

    if v_numero is null then
      raise exception 'Informe o número de cada NF.';
    end if;
    if v_emissao is null then
      raise exception 'Informe a data de emissão da NF %.', v_numero;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor da NF %.', v_numero;
    end if;
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = v_tomador and e.tenant_id = v_tenant and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF %.', v_numero;
    end if;

    -- A nota que já existe só se liga: os dados são os dela.
    v_nota := public._nota_fiscal_do_anexo(
      v_tenant, v_fornecedor, v_anexo, v_numero, v_emissao, v_valor, v_tomador, v_uid, false);
    if v_nota = any(v_notas) then
      raise exception 'A NF % foi anexada duas vezes nesta PP.', v_numero;
    end if;
    v_notas := v_notas || v_nota;

    select n.numero, n.data_emissao, n.valor, n.tomador_estabelecimento_id
      into v_numero, v_emissao, v_valor, v_tomador
      from public.notas_fiscais_fornecedor n where n.id = v_nota;
    if v_parte <= 0 or v_parte > v_valor + 0.005 then
      raise exception 'O valor da NF % nesta PP precisa ser maior que zero e até o valor da nota.', v_numero;
    end if;

    update public.pedidos_compra_anexos
       set nota_fiscal_id = v_nota,
           documento_numero = v_numero,
           nf_data_emissao = v_emissao,
           nf_valor = v_valor,
           nf_tomador_estabelecimento_id = v_tomador,
           nf_valor_na_pp = round(v_parte, 2)
     where id = v_anexo;
  end loop;

  foreach v_nota in array v_notas loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;
end;
$$;
revoke all on function public.ligar_notas_fiscais_da_pp(uuid, jsonb) from public, anon;
grant execute on function public.ligar_notas_fiscais_da_pp(uuid, jsonb) to authenticated;
comment on function public.ligar_notas_fiscais_da_pp(uuid, jsonb) is
  'Decisão 150: no envio da PP ao financeiro, liga cada anexo NF à sua nota (cria a nova ou liga à existente, sem mudar os dados dela) e confere que as partes não passam do valor da nota.';
