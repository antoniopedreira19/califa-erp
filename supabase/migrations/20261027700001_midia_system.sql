-- =====================================================================
-- Mídia System: o job auditado pelo cliente (decisão 216, Tiago,
-- 26/10/2026)
-- ---------------------------------------------------------------------
-- Alguns clientes mandam o job para uma auditoria meticulosa (a Mídia
-- System). Enquanto ela corre, as PPs normais podem ir ao financeiro, e ser
-- pagas, sem NF. Quando a auditoria termina, o financeiro clica em
-- "Liberar NFs": as PPs que foram sem nota entram na prestação de contas
-- (a mesma gaveta da verba, decisão 189), e as próximas voltam a exigir a
-- NF no envio. Quem marca e quem libera é sempre o financeiro.
--
-- 1) `jobs.midia_system`, `midia_system_liberado_em` e `_por`. A marcação
--    nasce na abertura do job (ou no "Editar registro"); a liberação é o
--    clique do financeiro e não volta atrás.
--
-- 2) `pedidos_compra.sem_nf_na_auditoria`: a PP foi ao financeiro sem
--    nenhum anexo, com o job em auditoria. É a marca que leva a PP à
--    prestação de contas depois da liberação. O envio é que grava; o
--    gatilho confere que o job estava em auditoria.
--
-- 3) A prestação de contas (decisão 189) aceita a PP da auditoria já
--    liberada, com três diferenças da verba:
--      * o envio não espera o pagamento, exige ao menos uma NF e não tem
--        "Não houve gasto";
--      * NUNCA há saldo a devolver: a PP foi paga cheia ao fornecedor, e o
--        realizado do item (que desconta o `valor_devolvido` da prestação
--        aprovada) não pode cair;
--      * a NF entra no cadastro de notas na aprovação, como a NF da verba
--        (crédito de PIS/COFINS no mês da emissão, sem retenção — resposta
--        do Tiago, 26/10).
--    As funções mantêm os nomes de verba: as telas e as Server Actions já
--    as chamam, e a prestação é a mesma.
--
-- O encerramento (a PP da auditoria trava até a prestação aprovada) é
-- conferido em `lib/data/impedimentos-encerramento.ts`, como a verba.
-- =====================================================================

-- 1) O job ------------------------------------------------------------
alter table public.jobs
  add column if not exists midia_system boolean not null default false,
  add column if not exists midia_system_liberado_em timestamptz,
  add column if not exists midia_system_liberado_por uuid references public.profiles(id) on delete restrict;

alter table public.jobs
  drop constraint if exists chk_jobs_midia_system_liberado;
alter table public.jobs
  add constraint chk_jobs_midia_system_liberado check (
    (midia_system_liberado_em is null and midia_system_liberado_por is null)
    or (midia_system and midia_system_liberado_em is not null and midia_system_liberado_por is not null)
  );

comment on column public.jobs.midia_system is
  'Job auditado pelo cliente pela Mídia System (decisão 216): enquanto `midia_system_liberado_em` é nulo, as PPs podem ir ao financeiro sem NF. Só o financeiro marca.';
comment on column public.jobs.midia_system_liberado_em is
  'Quando o financeiro liberou as NFs (fim da auditoria, decisão 216). Daí em diante as PPs voltam a exigir NF e as que foram sem nota entram na prestação de contas. Não volta atrás.';
comment on column public.jobs.midia_system_liberado_por is
  'Quem liberou as NFs do job Mídia System (decisão 216).';

-- 2) A PP -------------------------------------------------------------
alter table public.pedidos_compra
  add column if not exists sem_nf_na_auditoria boolean not null default false;

comment on column public.pedidos_compra.sem_nf_na_auditoria is
  'A PP foi ao financeiro sem anexo com o job Mídia System em auditoria (decisão 216). Depois da liberação das NFs, ela presta contas da nota na mesma prestação da verba.';

create index if not exists idx_pp_sem_nf_na_auditoria
  on public.pedidos_compra(job_id) where sem_nf_na_auditoria;

-- 3) Quem mexe na Mídia System do job ---------------------------------
-- Só o financeiro (e o administrador) marca e libera; a liberação não
-- volta; e o job que já tem PP sem NF não deixa de ser Mídia System — a
-- saída é liberar as NFs. Dentro de função `security definer`
-- (`liberar_nfs_midia_system`) o papel é conferido pela própria função.
create or replace function public.jobs_guarda_midia_system()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_papel text;
begin
  if tg_op = 'INSERT' then
    if new.midia_system or new.midia_system_liberado_em is not null then
      raise exception 'Job novo nasce sem Mídia System: quem marca é o financeiro, na abertura.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.midia_system is not distinct from old.midia_system
     and new.midia_system_liberado_em is not distinct from old.midia_system_liberado_em
     and new.midia_system_liberado_por is not distinct from old.midia_system_liberado_por then
    return new;
  end if;

  if current_user = 'authenticated' then
    v_papel := coalesce(public.session_role()::text, '');
    if v_papel not in ('administrador', 'financeiro') then
      raise exception 'Só o financeiro marca o job como Mídia System e libera as NFs.'
        using errcode = '42501';
    end if;
  end if;

  if old.midia_system_liberado_em is not null then
    raise exception 'As NFs deste job já foram liberadas: a Mídia System não volta atrás.'
      using errcode = '42501';
  end if;

  if old.midia_system and not new.midia_system and exists (
    select 1 from public.pedidos_compra pp
     where pp.job_id = new.id
       and pp.sem_nf_na_auditoria
       and pp.status <> 'cancelada'
  ) then
    raise exception 'Este job já tem PP enviada sem NF. Para encerrar a auditoria, use “Liberar NFs”.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_jobs_guarda_midia_system on public.jobs;
create trigger trg_jobs_guarda_midia_system
  before insert or update of midia_system, midia_system_liberado_em, midia_system_liberado_por
  on public.jobs
  for each row execute function public.jobs_guarda_midia_system();

-- 4) Quem marca a PP como "sem NF na auditoria" -----------------------
-- Ligar a marca só no envio ao financeiro, com o job em auditoria. Ela sai
-- só no reenvio da PP rejeitada (que pode ir com a nota).
create or replace function public.pp_guarda_sem_nf_na_auditoria()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.sem_nf_na_auditoria then
      raise exception 'A PP nasce com a NF exigida: a marca da auditoria entra no envio.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.sem_nf_na_auditoria is not distinct from old.sem_nf_na_auditoria then
    return new;
  end if;

  if new.sem_nf_na_auditoria then
    if new.status <> 'em_avaliacao' or old.status not in ('gerada', 'rejeitada') then
      raise exception 'A PP vai sem NF só no envio ao financeiro.'
        using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.jobs j
       where j.id = new.job_id
         and j.midia_system
         and j.midia_system_liberado_em is null
    ) then
      raise exception 'A NF só é dispensada no envio com o job Mídia System em auditoria.'
        using errcode = '42501';
    end if;
  elsif not (old.status = 'rejeitada' and new.status = 'em_avaliacao') then
    raise exception 'A PP que foi sem NF presta contas da nota na prestação de contas.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_pp_guarda_sem_nf_na_auditoria on public.pedidos_compra;
create trigger trg_pp_guarda_sem_nf_na_auditoria
  before insert or update of sem_nf_na_auditoria
  on public.pedidos_compra
  for each row execute function public.pp_guarda_sem_nf_na_auditoria();

-- 5) "Liberar NFs" ----------------------------------------------------
-- Devolve quantas PPs entram na prestação de contas.
create or replace function public.liberar_nfs_midia_system(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_job   public.jobs%rowtype;
  v_papel text;
  v_n     integer;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job não encontrado.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_job.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a este job.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro libera as NFs do job Mídia System.';
  end if;

  if not v_job.midia_system then
    raise exception 'Este job não é Mídia System.';
  end if;
  if v_job.midia_system_liberado_em is not null then
    raise exception 'As NFs deste job já foram liberadas.';
  end if;

  update public.jobs
     set midia_system_liberado_em = now(),
         midia_system_liberado_por = v_uid
   where id = p_job_id;

  select count(*) into v_n
    from public.pedidos_compra
   where job_id = p_job_id
     and sem_nf_na_auditoria
     and status not in ('cancelada', 'rejeitada');
  return v_n;
end;
$function$;

revoke all on function public.liberar_nfs_midia_system(uuid) from public, anon;
grant execute on function public.liberar_nfs_midia_system(uuid) to authenticated;

-- 6) A prestação aceita a PP da auditoria liberada --------------------
-- A PP da auditoria (não verba) presta contas depois da liberação.
create or replace function public._pp_da_auditoria_liberada(p_pp public.pedidos_compra)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(p_pp.verba_producao, false) = false
     and p_pp.sem_nf_na_auditoria
     and exists (
       select 1 from public.jobs j
        where j.id = p_pp.job_id
          and j.midia_system_liberado_em is not null
     );
$function$;

revoke all on function public._pp_da_auditoria_liberada(public.pedidos_compra) from public, anon;
grant execute on function public._pp_da_auditoria_liberada(public.pedidos_compra) to authenticated;

create or replace function public._verba_para_prestar(p_pp_id uuid)
returns public.pedidos_compra
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_pp    public.pedidos_compra%rowtype;
  v_papel text;
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

  -- Decisão 216: a PP que foi sem NF na auditoria da Mídia System presta
  -- contas da nota depois da liberação.
  if v_pp.verba_producao is not true and not public._pp_da_auditoria_liberada(v_pp) then
    if v_pp.sem_nf_na_auditoria then
      raise exception 'As NFs deste job ainda não foram liberadas pelo financeiro.';
    end if;
    raise exception 'Esta PP não é de verba.';
  end if;
  if v_pp.tipo_verba = 'reembolso' then
    raise exception 'Reembolso não tem prestação de contas: os comprovantes vão no envio da PP.';
  end if;

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

  return v_pp;
end;
$function$;

create or replace function public.enviar_prestacao_verba_salva(p_pp_id uuid, p_sem_gasto boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_pp    public.pedidos_compra%rowtype;
  v_prest public.pp_verba_prestacoes%rowtype;
  v_soma  numeric(14,2) := 0;
  v_id    uuid;
  v_midia boolean;
begin
  v_pp := public._verba_para_prestar(p_pp_id);
  -- Decisão 216: a NF da PP da auditoria vai quando chegar, paga ou não.
  v_midia := public._pp_da_auditoria_liberada(v_pp);
  if not v_midia and v_pp.status <> 'pago' then
    raise exception 'O envio ao financeiro libera depois que a verba estiver paga. Os documentos ficam salvos até lá.';
  end if;
  if v_midia and coalesce(p_sem_gasto, false) then
    raise exception 'A PP que foi sem NF presta contas com a NF do fornecedor.';
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
    if v_prest.id is not null then
      delete from public.pp_verba_prestacoes_anexos where prestacao_id = v_prest.id;
    end if;
  else
    if v_prest.id is null or not exists (
      select 1 from public.pp_verba_prestacoes_anexos where prestacao_id = v_prest.id
    ) then
      if v_midia then
        raise exception 'Anexe a NF do fornecedor.';
      end if;
      raise exception 'Anexe ao menos um documento — ou marque “Não houve gasto”.';
    end if;
    if v_midia and not exists (
      select 1 from public.pp_verba_prestacoes_anexos
       where prestacao_id = v_prest.id and documento_tipo = 'nota_fiscal'
    ) then
      raise exception 'Anexe a NF do fornecedor, com o tipo NF.';
    end if;
    perform public._conferir_documentos_da_prestacao(v_prest.id);
    select coalesce(sum(valor), 0) into v_soma
      from public.pp_verba_prestacoes_anexos
     where prestacao_id = v_prest.id and valor is not null;
    if v_soma <= 0 then
      raise exception 'Anexe ao menos um documento que comprove gasto — NF, recibo, fatura, cupom fiscal ou outro. Boleto e contrato acompanham a compra, mas não somam.';
    end if;
    if v_soma > v_pp.valor then
      if v_midia then
        raise exception 'As NFs somam R$ %, acima do valor da PP (R$ %). Em cada NF, informe só a parte desta PP.',
          translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
          translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
      end if;
      raise exception 'Os documentos somam R$ %, acima da verba de R$ %. O excedente precisa de uma PP nova.',
        translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
        translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
    end if;
  end if;

  if v_prest.id is null then
    insert into public.pp_verba_prestacoes (
      tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por, status
    ) values (
      v_pp.tenant_id, v_pp.id, v_soma,
      case when v_midia then 0 else v_pp.valor - v_soma end,
      v_uid, 'em_avaliacao'
    )
    returning id into v_id;
  else
    v_id := v_prest.id;
    update public.pp_verba_prestacoes
       set valor_gasto     = v_soma,
           valor_devolvido = case when v_midia then 0 else v_pp.valor - v_soma end,
           status          = 'em_avaliacao',
           fechada_em      = now(),
           fechada_por     = v_uid
     where id = v_id;
  end if;

  return v_id;
end;
$function$;

create or replace function public.corrigir_documento_prestacao_verba(p_documento_id uuid, p_documento jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_doc   public.pp_verba_prestacoes_anexos%rowtype;
  v_novo  public.pp_verba_prestacoes_anexos%rowtype;
  v_prest public.pp_verba_prestacoes%rowtype;
  v_pp    public.pedidos_compra%rowtype;
  v_papel text;
  v_soma  numeric(14,2);
  v_midia boolean;
begin
  if p_documento is null or jsonb_typeof(p_documento) <> 'object' then
    raise exception 'Documento inválido.';
  end if;
  select * into v_doc from public.pp_verba_prestacoes_anexos where id = p_documento_id for update;
  if not found then raise exception 'Documento não encontrado.'; end if;
  select * into v_prest from public.pp_verba_prestacoes where id = v_doc.prestacao_id for update;
  select * into v_pp from public.pedidos_compra where id = v_prest.pedido_compra_id;
  v_midia := public._pp_da_auditoria_liberada(v_pp);

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só administrador ou financeiro corrige os documentos da prestação.';
  end if;
  if v_prest.status <> 'em_avaliacao' then
    raise exception 'Só se corrige documento de prestação em avaliação.';
  end if;

  v_novo := public._campos_do_documento_da_prestacao(
    v_pp.tenant_id, p_documento - 'documento_tipo', v_doc);
  if v_novo.documento_tipo not in ('boleto', 'contrato') and v_novo.valor is null then
    raise exception 'Informe o valor do documento.';
  end if;

  update public.pp_verba_prestacoes_anexos
     set documento_numero           = v_novo.documento_numero,
         documento_data             = v_novo.documento_data,
         valor                      = v_novo.valor,
         tomador_estabelecimento_id = v_novo.tomador_estabelecimento_id,
         emitente_documento         = v_novo.emitente_documento,
         emitente_nome              = v_novo.emitente_nome,
         descricao                  = v_novo.descricao
   where id = p_documento_id;

  select coalesce(sum(valor), 0) into v_soma
    from public.pp_verba_prestacoes_anexos
   where prestacao_id = v_prest.id and valor is not null;
  if v_soma > v_pp.valor then
    if v_midia then
      raise exception 'Com essa correção as NFs somam R$ %, acima do valor da PP (R$ %).',
        translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
        translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
    end if;
    raise exception 'Com essa correção os documentos somam R$ %, acima da verba de R$ %.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;
  update public.pp_verba_prestacoes
     set valor_gasto = v_soma,
         valor_devolvido = case when v_midia then 0 else v_pp.valor - v_soma end
   where id = v_prest.id;
end;
$function$;

create or replace function public.aprovar_prestacao_verba(p_pp_id uuid, p_data_prevista date, p_notas jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_pp        public.pedidos_compra%rowtype;
  v_papel     text;
  v_prest     public.pp_verba_prestacoes%rowtype;
  v_dev_id    uuid;
  v_soma      numeric(14,2);
  v_saldo     numeric(14,2);
  a           public.pp_verba_prestacoes_anexos%rowtype;
  v_cfg       jsonb;
  v_sem_cred  boolean;
  v_motivo    text;
  v_forn      uuid;
  v_nota      uuid;
  v_notas     uuid[] := '{}';
  v_midia     boolean;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;
  v_midia := public._pp_da_auditoria_liberada(v_pp);

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só administrador ou financeiro aprova prestação de contas.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if not found or v_prest.status = 'rascunho' then
    raise exception 'Esta verba ainda não tem prestação de contas.';
  end if;
  if v_prest.status = 'aprovada' then
    raise exception 'Esta prestação já foi aprovada.';
  end if;
  if v_prest.status = 'reprovada' then
    raise exception 'Esta prestação foi reprovada e está com a produção.';
  end if;

  perform public._conferir_documentos_da_prestacao(v_prest.id);
  select coalesce(sum(valor), 0) into v_soma
    from public.pp_verba_prestacoes_anexos
   where prestacao_id = v_prest.id and valor is not null;
  if v_soma > v_pp.valor then
    if v_midia then
      raise exception 'As NFs somam R$ %, acima do valor da PP (R$ %).',
        translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
        translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
    end if;
    raise exception 'Os documentos somam R$ %, acima da verba de R$ %.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;
  -- Decisão 216: a PP da auditoria foi paga cheia ao fornecedor. Não há
  -- saldo a devolver, e o realizado do item não cai.
  v_saldo := case when v_midia then 0 else v_pp.valor - v_soma end;
  if v_saldo > 0 and p_data_prevista is null then
    raise exception 'Informe a data prevista da devolução.';
  end if;

  for a in
    select * from public.pp_verba_prestacoes_anexos
     where prestacao_id = v_prest.id and documento_tipo = 'nota_fiscal'
     order by created_at, id
  loop
    select e.value into v_cfg
      from jsonb_array_elements(case when jsonb_typeof(p_notas) = 'array' then p_notas else '[]'::jsonb end) e
     where e.value->>'documento_id' = a.id::text
     limit 1;
    v_sem_cred := coalesce((v_cfg->>'credito_retirado')::boolean, false);
    v_motivo := nullif(btrim(coalesce(v_cfg->>'credito_motivo', '')), '');
    if v_sem_cred and v_motivo is null then
      raise exception 'Escolha por que a NF % não gera crédito de PIS/COFINS.', a.documento_numero;
    end if;
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = a.tomador_estabelecimento_id and e.tenant_id = v_pp.tenant_id and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF % entre os CNPJs ativos do cadastro de impostos.', a.documento_numero;
    end if;

    select f.id into v_forn
      from public.fornecedores f
     where f.tenant_id = v_pp.tenant_id and f.cpf_cnpj = a.emitente_documento;
    if v_forn is null then
      insert into public.fornecedores (
        tenant_id, tipo_pessoa, nome, razao_social, cpf_cnpj, sem_dados_pagamento, created_by
      ) values (
        v_pp.tenant_id, 'juridica', btrim(a.emitente_nome), btrim(a.emitente_nome),
        a.emitente_documento, true, v_uid
      )
      returning id into v_forn;
    end if;

    select n.id into v_nota
      from public.notas_fiscais_fornecedor n
     where n.tenant_id = v_pp.tenant_id
       and n.fornecedor_id = v_forn
       and n.numero_chave = public.chave_do_numero_da_nf(a.documento_numero)
     for update;
    if v_nota is null then
      insert into public.notas_fiscais_fornecedor (
        tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id,
        criada_por, registrada_em, registrada_por, registrada_na_pp_id,
        credito_pis_cofins_retirado, credito_pis_cofins_motivo
      ) values (
        v_pp.tenant_id, v_forn, btrim(a.documento_numero), a.documento_data, a.valor,
        a.tomador_estabelecimento_id, v_uid, now(), v_uid, v_pp.id,
        v_sem_cred, case when v_sem_cred then v_motivo end
      )
      returning id into v_nota;
    else
      if v_nota = any(v_notas) then
        raise exception 'A NF % foi anexada duas vezes nesta prestação.', a.documento_numero;
      end if;
      update public.notas_fiscais_fornecedor
         set registrada_na_pp_id = coalesce(registrada_na_pp_id, v_pp.id),
             registrada_por = coalesce(registrada_por, v_uid),
             credito_pis_cofins_retirado = case when registrada_em is null then v_sem_cred
                                                else credito_pis_cofins_retirado end,
             credito_pis_cofins_motivo = case when registrada_em is null
                                              then (case when v_sem_cred then v_motivo end)
                                              else credito_pis_cofins_motivo end,
             registrada_em = coalesce(registrada_em, now())
       where id = v_nota;
    end if;
    v_notas := v_notas || v_nota;

    update public.pp_verba_prestacoes_anexos set nota_fiscal_id = v_nota where id = a.id;
  end loop;

  update public.pp_verba_prestacoes
     set status          = 'aprovada',
         aprovada_em     = now(),
         aprovada_por    = v_uid,
         valor_gasto     = v_soma,
         valor_devolvido = v_saldo,
         documentos_na_aprovacao = (
           select coalesce(
             jsonb_agg(jsonb_build_object(
               'id', x.id,
               'nome', x.arquivo_nome_original,
               'documento_tipo', x.documento_tipo,
               'documento_numero', x.documento_numero,
               'documento_data', x.documento_data,
               'valor', x.valor,
               'tomador_estabelecimento_id', x.tomador_estabelecimento_id,
               'emitente_documento', x.emitente_documento,
               'emitente_nome', x.emitente_nome,
               'descricao', x.descricao,
               'nota_fiscal_id', x.nota_fiscal_id
             ) order by x.created_at, x.id),
             '[]'::jsonb
           )
             from public.pp_verba_prestacoes_anexos x
            where x.prestacao_id = v_prest.id
         )
   where id = v_prest.id;

  if v_saldo > 0 then
    insert into public.pp_verba_devolucoes (
      tenant_id, empresa_id, prestacao_id, pedido_compra_id, valor,
      data_pagamento, data_pagamento_primeira
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_prest.id, v_pp.id, v_saldo,
      p_data_prevista, p_data_prevista
    )
    returning id into v_dev_id;
  end if;

  return v_dev_id;
end;
$function$;
