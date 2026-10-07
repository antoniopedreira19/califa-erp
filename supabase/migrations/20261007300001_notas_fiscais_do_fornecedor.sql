-- Decisão 150 (07/10/2026) — a NF do fornecedor vira cadastro próprio.
--
-- POR QUE
-- Até aqui a PP guardava UMA nota, nas colunas `nf_*` da própria linha
-- (módulo fiscal, entrega 1, 02/10/2026). Duas coisas quebram isso:
--   1. uma PP pode ter várias NFs do mesmo fornecedor (design aprovado em
--      07/10/2026: os dados de cada NF ficam embaixo do próprio arquivo);
--   2. uma mesma NF pode cobrir mais de uma PP — palavras do Tiago: "precisamos
--      ter o controle de todas as NFs colocadas no sistema individualmente".
--
-- O QUE MUDA
--   • `notas_fiscais_fornecedor`: uma linha por NF de fornecedor. É a mesma NF
--     quando tem o mesmo fornecedor e o mesmo número (`numero_chave`, sem
--     zeros à esquerda nem pontuação: "00000602" = "602").
--   • O anexo do tipo NF aponta para a nota (`nota_fiscal_id`) e guarda a
--     PARTE dela nesta PP (`nf_valor_na_pp`). Antes do envio, o anexo guarda o
--     que a produção digitou (`documento_numero` + `nf_*`); a nota nasce no
--     envio ou, para as PPs enviadas antes desta decisão, na aprovação.
--   • A NF conta UMA vez no fiscal, pelo valor TOTAL, a partir do registro
--     (`registrada_em`, na aprovação da 1ª PP que a traz): crédito de
--     PIS/COFINS e ISS retido no mês da emissão. As PPs chegam uma de cada
--     vez; a 2ª encontra a nota já registrada. PIS/COFINS/CSLL e IRRF retidos
--     continuam saindo do pagamento de cada PP (`baixas_retencoes`).
--   • O financeiro corrige os dados na aprovação, e a correção vale para todas
--     as PPs ligadas à nota (`registrar_notas_fiscais_da_pp`).
--
-- O QUE FICA
--   As colunas `pedidos_compra.nf_*` e `credito_pis_cofins_*` não são
--   apagadas (mudança destrutiva) nem mais escritas: viram histórico. O
--   `nf_registrada_em` da PP continua marcando "as notas desta PP foram
--   conferidas pelo financeiro" — é a trava do `aprovar_pp_com_data`.
--   A `registrar_nf_da_pp` antiga fica no banco, sem chamador.
--
-- BACKFILL (só preenche o que está vazio): as 3 PPs registradas até hoje
-- (PP-00110, PP-00111 e PP-00128), cada uma com uma NF só, cujo número bate
-- com o do anexo, viram 3 notas, com a parte = o valor da nota.

-- 1. A chave do número -------------------------------------------------------
create or replace function public.chave_do_numero_da_nf(p text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(ltrim(regexp_replace(upper(coalesce(p, '')), '[^0-9A-Z]', '', 'g'), '0'), '')
$$;
comment on function public.chave_do_numero_da_nf(text) is
  'Número da NF sem pontuação, espaços e zeros à esquerda: identifica a mesma nota do mesmo fornecedor (decisão 150).';

-- 2. O cadastro das notas ------------------------------------------------------
create table if not exists public.notas_fiscais_fornecedor (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  fornecedor_id               uuid not null references public.fornecedores(id) on delete restrict,
  numero                      text not null,
  numero_chave                text generated always as (public.chave_do_numero_da_nf(numero)) stored,
  data_emissao                date not null,
  valor                       numeric(14,2) not null,
  tomador_estabelecimento_id  uuid not null references public.fiscal_estabelecimentos(id) on delete restrict,
  registrada_em               timestamptz,
  registrada_por              uuid references public.profiles(id),
  registrada_na_pp_id         uuid references public.pedidos_compra(id) on delete restrict,
  iss_retido_aliquota         numeric(7,4),
  credito_pis_cofins_retirado boolean not null default false,
  credito_pis_cofins_motivo   text,
  criada_por                  uuid references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint chk_nff_numero check (public.chave_do_numero_da_nf(numero) is not null),
  constraint chk_nff_valor check (valor > 0),
  constraint chk_nff_iss check (iss_retido_aliquota is null or (iss_retido_aliquota > 0 and iss_retido_aliquota < 100)),
  constraint chk_nff_credito_motivo check (not credito_pis_cofins_retirado or nullif(btrim(credito_pis_cofins_motivo), '') is not null),
  constraint uq_nff_fornecedor_numero unique (tenant_id, fornecedor_id, numero_chave)
);
create index if not exists idx_nff_fornecedor on public.notas_fiscais_fornecedor (fornecedor_id);
create index if not exists idx_nff_tomador on public.notas_fiscais_fornecedor (tomador_estabelecimento_id);
create index if not exists idx_nff_registrada_na_pp on public.notas_fiscais_fornecedor (registrada_na_pp_id);
create index if not exists idx_nff_registrada_por on public.notas_fiscais_fornecedor (registrada_por);
create index if not exists idx_nff_criada_por on public.notas_fiscais_fornecedor (criada_por);
create index if not exists idx_nff_registrada_em on public.notas_fiscais_fornecedor (tenant_id, registrada_em) where registrada_em is not null;

comment on table public.notas_fiscais_fornecedor is
  'NF de fornecedor, uma linha por nota (decisão 150, 07/10/2026). Mesma nota = mesmo fornecedor + numero_chave. Pode cobrir mais de uma PP: cada anexo do tipo NF aponta para cá e guarda a parte da nota na sua PP. Conta UMA vez no fiscal, pelo total, a partir de registrada_em.';
comment on column public.notas_fiscais_fornecedor.registrada_em is
  'Quando o financeiro registrou a nota, na aprovação da 1ª PP que a traz. A partir daí entra na Apuração (crédito de PIS/COFINS e ISS retido no mês da emissão).';
comment on column public.notas_fiscais_fornecedor.iss_retido_aliquota is
  'Alíquota do ISS retido decidida na aprovação que registrou a nota: o ISS retido da Apuração é valor × alíquota, uma vez por nota.';

alter table public.notas_fiscais_fornecedor enable row level security;
drop policy if exists notas_fiscais_fornecedor_select on public.notas_fiscais_fornecedor;
-- Freelancer não lê o cadastro: a busca da produção passa pela RPC.
create policy notas_fiscais_fornecedor_select on public.notas_fiscais_fornecedor
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) and public.session_role() <> 'freelancer'::app_role);
-- Escrita só pelas RPCs (security definer), como em pedidos_compra_retencoes.
revoke all on table public.notas_fiscais_fornecedor from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.notas_fiscais_fornecedor from authenticated;
grant select on table public.notas_fiscais_fornecedor to authenticated;

drop trigger if exists trg_notas_fiscais_fornecedor_updated_at on public.notas_fiscais_fornecedor;
create trigger trg_notas_fiscais_fornecedor_updated_at
  before update on public.notas_fiscais_fornecedor
  for each row execute function public.set_updated_at();

-- 3. O anexo do tipo NF: o que a produção digitou e a ligação com a nota ------
alter table public.pedidos_compra_anexos
  add column if not exists nota_fiscal_id                uuid references public.notas_fiscais_fornecedor(id) on delete restrict,
  add column if not exists nf_data_emissao               date,
  add column if not exists nf_valor                      numeric(14,2),
  add column if not exists nf_tomador_estabelecimento_id uuid references public.fiscal_estabelecimentos(id) on delete restrict,
  add column if not exists nf_valor_na_pp                numeric(14,2);
alter table public.pedidos_compra_anexos
  drop constraint if exists chk_pp_anexo_nf_valor,
  add constraint chk_pp_anexo_nf_valor check (nf_valor is null or nf_valor > 0),
  drop constraint if exists chk_pp_anexo_nf_valor_na_pp,
  add constraint chk_pp_anexo_nf_valor_na_pp check (nf_valor_na_pp is null or nf_valor_na_pp > 0),
  drop constraint if exists chk_pp_anexo_nota_so_em_nf,
  add constraint chk_pp_anexo_nota_so_em_nf check (nota_fiscal_id is null or documento_tipo = 'nota_fiscal');
create index if not exists idx_pp_anexos_nota on public.pedidos_compra_anexos (nota_fiscal_id) where nota_fiscal_id is not null;
create index if not exists idx_pp_anexos_nf_tomador on public.pedidos_compra_anexos (nf_tomador_estabelecimento_id) where nf_tomador_estabelecimento_id is not null;
-- A mesma nota não entra duas vezes na mesma PP.
create unique index if not exists uq_pp_anexo_nota on public.pedidos_compra_anexos (pedido_compra_id, nota_fiscal_id) where nota_fiscal_id is not null;

comment on column public.pedidos_compra_anexos.nota_fiscal_id is
  'A NF (notas_fiscais_fornecedor) que este anexo é. Preenchido no envio ao financeiro ou na aprovação (decisão 150).';
comment on column public.pedidos_compra_anexos.nf_valor_na_pp is
  'A parte da NF que é desta PP. Igual ao valor da nota, salvo quando a nota cobre outras PPs. A soma das partes não passa do valor da nota.';
comment on column public.pedidos_compra_anexos.nf_data_emissao is
  'Data de emissão que a produção informou (decisão 150). Depois da ligação, vale a da nota.';

-- 4. A nota do anexo: acha pelo fornecedor + número ou cria -----------------
-- Interna (sem grant): chamada pelas RPCs de envio e de registro.
create or replace function public._nota_fiscal_do_anexo(
  p_tenant        uuid,
  p_fornecedor_id uuid,
  p_anexo_id      uuid,
  p_numero        text,
  p_data_emissao  date,
  p_valor         numeric,
  p_tomador       uuid,
  p_uid           uuid,
  p_corrige       boolean
)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_chave    text := public.chave_do_numero_da_nf(p_numero);
  v_nota     uuid;
  v_do_anexo uuid;
begin
  if v_chave is null then
    raise exception 'Informe o número da NF.';
  end if;

  select id into v_nota
    from public.notas_fiscais_fornecedor
   where tenant_id = p_tenant and fornecedor_id = p_fornecedor_id and numero_chave = v_chave
   for update;

  if v_nota is null then
    select nota_fiscal_id into v_do_anexo from public.pedidos_compra_anexos where id = p_anexo_id;
    if v_do_anexo is not null and p_corrige then
      -- O financeiro corrigiu o número de uma nota já cadastrada: a correção
      -- vale para todas as PPs ligadas a ela.
      update public.notas_fiscais_fornecedor
         set numero = btrim(p_numero), data_emissao = p_data_emissao,
             valor = round(p_valor, 2), tomador_estabelecimento_id = p_tomador
       where id = v_do_anexo;
      return v_do_anexo;
    end if;
    insert into public.notas_fiscais_fornecedor
      (tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id, criada_por)
    values
      (p_tenant, p_fornecedor_id, btrim(p_numero), p_data_emissao, round(p_valor, 2), p_tomador, p_uid)
    returning id into v_nota;
    return v_nota;
  end if;

  -- A nota já existe: a produção só liga; o financeiro corrige para todos.
  if p_corrige then
    update public.notas_fiscais_fornecedor
       set numero = btrim(p_numero), data_emissao = p_data_emissao,
           valor = round(p_valor, 2), tomador_estabelecimento_id = p_tomador
     where id = v_nota;
  end if;
  return v_nota;
end;
$$;
revoke all on function public._nota_fiscal_do_anexo(uuid, uuid, uuid, text, date, numeric, uuid, uuid, boolean) from public, anon, authenticated;

-- A soma das partes de uma nota, nas PPs que não foram canceladas.
create or replace function public._conferir_partes_da_nota(p_nota uuid)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_valor  numeric;
  v_numero text;
  v_soma   numeric;
begin
  select valor, numero into v_valor, v_numero from public.notas_fiscais_fornecedor where id = p_nota;
  select coalesce(sum(a.nf_valor_na_pp), 0) into v_soma
    from public.pedidos_compra_anexos a
    join public.pedidos_compra p on p.id = a.pedido_compra_id
   where a.nota_fiscal_id = p_nota and p.status <> 'cancelada';
  if v_soma > v_valor + 0.005 then
    raise exception 'A NF % vale % e as PPs ligadas a ela somam %. Ajuste o valor nesta PP.',
      v_numero, to_char(v_valor, 'FM999G999G990D00'), to_char(v_soma, 'FM999G999G990D00');
  end if;
end;
$$;
revoke all on function public._conferir_partes_da_nota(uuid) from public, anon, authenticated;

-- 5. O registro do financeiro na aprovação ------------------------------------
-- p_notas: [{anexo_id, numero, data_emissao, valor, tomador_estabelecimento_id,
--            valor_na_pp, credito_retirado, credito_motivo}], uma por anexo NF.
create or replace function public.registrar_notas_fiscais_da_pp(
  p_pp_id     uuid,
  p_notas     jsonb,
  p_retencoes jsonb
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
  v_imp        text;
  v_aliq       numeric;
  v_iss        numeric;
  v_anexo      uuid;
  v_numero     text;
  v_emissao    date;
  v_valor      numeric;
  v_parte      numeric;
  v_tomador    uuid;
  v_sem_cred   boolean;
  v_motivo     text;
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
  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Apenas admin ou financeiro registra as notas fiscais da PP.' using errcode = '42501';
  end if;
  if v_status <> 'em_avaliacao' then
    raise exception 'As notas fiscais só se registram com a PP em avaliação.';
  end if;
  if v_verba or v_fornecedor is null then
    raise exception 'Verba de produção não tem nota fiscal na aprovação.';
  end if;

  -- As retenções da PP (como antes) e o ISS, que vai para as notas novas.
  delete from public.pedidos_compra_retencoes where pedido_compra_id = p_pp_id;
  if p_retencoes is not null and jsonb_typeof(p_retencoes) = 'array' then
    for v_item in select value from jsonb_array_elements(p_retencoes) loop
      v_imp := upper(btrim(v_item->>'imposto'));
      v_aliq := (v_item->>'aliquota')::numeric;
      if v_imp not in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF') then
        raise exception 'Imposto retido inválido: %', v_imp;
      end if;
      if v_aliq is null or v_aliq <= 0 or v_aliq >= 100 then
        raise exception 'Alíquota inválida para %.', v_imp;
      end if;
      insert into public.pedidos_compra_retencoes (tenant_id, pedido_compra_id, imposto, aliquota, criado_por)
      values (v_tenant, p_pp_id, v_imp, v_aliq, v_uid);
      if v_imp = 'ISS' then
        v_iss := v_aliq;
      end if;
    end loop;
  end if;

  -- Uma entrada por anexo do tipo NF da PP, nem mais nem menos.
  if p_notas is null or jsonb_typeof(p_notas) <> 'array' or jsonb_array_length(p_notas) = 0 then
    raise exception 'Informe as notas fiscais da PP.';
  end if;
  select count(*) into v_anexos_nf
    from public.pedidos_compra_anexos
   where pedido_compra_id = p_pp_id and documento_tipo = 'nota_fiscal';
  if v_anexos_nf <> jsonb_array_length(p_notas)
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
    v_sem_cred := coalesce((v_item->>'credito_retirado')::boolean, false);
    v_motivo  := nullif(btrim(v_item->>'credito_motivo'), '');

    if v_numero is null then
      raise exception 'Informe o número de cada NF.';
    end if;
    if v_emissao is null then
      raise exception 'Informe a data de emissão da NF %.', v_numero;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor da NF %.', v_numero;
    end if;
    if v_parte is null or v_parte <= 0 or v_parte > v_valor + 0.005 then
      raise exception 'O valor da NF % nesta PP precisa ser maior que zero e até o valor da nota.', v_numero;
    end if;
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = v_tomador and e.tenant_id = v_tenant and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF % entre os CNPJs ativos do cadastro de impostos.', v_numero;
    end if;
    if v_sem_cred and v_motivo is null then
      raise exception 'Escolha por que a NF % não gera crédito de PIS/COFINS.', v_numero;
    end if;

    v_nota := public._nota_fiscal_do_anexo(
      v_tenant, v_fornecedor, v_anexo, v_numero, v_emissao, v_valor, v_tomador, v_uid, true);
    if v_nota = any(v_notas) then
      raise exception 'A NF % foi anexada duas vezes nesta PP.', v_numero;
    end if;
    v_notas := v_notas || v_nota;

    update public.notas_fiscais_fornecedor
       set iss_retido_aliquota = case when registrada_em is null then v_iss else iss_retido_aliquota end,
           registrada_na_pp_id = coalesce(registrada_na_pp_id, p_pp_id),
           registrada_por = coalesce(registrada_por, v_uid),
           registrada_em = coalesce(registrada_em, now()),
           credito_pis_cofins_retirado = v_sem_cred,
           credito_pis_cofins_motivo = case when v_sem_cred then v_motivo else null end
     where id = v_nota;

    update public.pedidos_compra_anexos
       set nota_fiscal_id = v_nota,
           documento_numero = v_numero,
           nf_data_emissao = v_emissao,
           nf_valor = round(v_valor, 2),
           nf_tomador_estabelecimento_id = v_tomador,
           nf_valor_na_pp = round(v_parte, 2)
     where id = v_anexo;
  end loop;

  foreach v_nota in array v_notas loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;

  update public.pedidos_compra
     set nf_registrada_por = v_uid,
         nf_registrada_em = now()
   where id = p_pp_id;
end;
$$;
revoke all on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) to authenticated;
comment on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) is
  'Aprovação da PP pelo financeiro (decisão 150): grava as retenções da PP, liga cada anexo NF à sua nota (cria, liga ou corrige para todas as PPs) e registra a nota na 1ª aprovação.';

-- 6. Backfill: as 3 PPs já registradas ---------------------------------------
insert into public.notas_fiscais_fornecedor
  (tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id,
   registrada_em, registrada_por, registrada_na_pp_id, iss_retido_aliquota,
   credito_pis_cofins_retirado, credito_pis_cofins_motivo, criada_por, created_at)
select p.tenant_id, p.fornecedor_id, btrim(p.nf_numero), p.nf_data_emissao, p.nf_valor, p.nf_tomador_estabelecimento_id,
       p.nf_registrada_em, p.nf_registrada_por, p.id,
       (select r.aliquota from public.pedidos_compra_retencoes r where r.pedido_compra_id = p.id and r.imposto = 'ISS'),
       p.credito_pis_cofins_retirado, p.credito_pis_cofins_motivo, p.nf_registrada_por, p.nf_registrada_em
  from public.pedidos_compra p
 where p.nf_registrada_em is not null
   and public.chave_do_numero_da_nf(p.nf_numero) is not null
   and p.nf_data_emissao is not null and p.nf_valor is not null and p.nf_tomador_estabelecimento_id is not null
   and p.fornecedor_id is not null
   and exists (select 1 from public.pedidos_compra_anexos a where a.pedido_compra_id = p.id and a.documento_tipo = 'nota_fiscal')
on conflict on constraint uq_nff_fornecedor_numero do nothing;

update public.pedidos_compra_anexos a
   set nota_fiscal_id = n.id,
       nf_data_emissao = coalesce(a.nf_data_emissao, n.data_emissao),
       nf_valor = coalesce(a.nf_valor, n.valor),
       nf_tomador_estabelecimento_id = coalesce(a.nf_tomador_estabelecimento_id, n.tomador_estabelecimento_id),
       nf_valor_na_pp = coalesce(a.nf_valor_na_pp, least(n.valor, p.valor))
  from public.pedidos_compra p
  join public.notas_fiscais_fornecedor n on n.registrada_na_pp_id = p.id
 where a.id = (
         select x.id from public.pedidos_compra_anexos x
          where x.pedido_compra_id = p.id and x.documento_tipo = 'nota_fiscal'
          order by x.created_at limit 1)
   and a.nota_fiscal_id is null;
