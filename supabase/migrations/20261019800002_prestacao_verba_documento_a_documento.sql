-- ===========================================================================
-- Prestação de contas da verba, documento a documento (decisão 189)
-- ===========================================================================
-- Redesenho aprovado pelo Tiago em 19/10/2026 sobre o protótipo interativo
-- (versão A, "Junta e envia no fim", com o drawer "1 · Enxuto" no
-- financeiro). Revê a decisão 081 (prestação enviada de uma vez, só NF e
-- recibo) e mantém o resto dela: envio único, o financeiro aprova ou reprova
-- a prestação inteira, o saldo vira estorno de verba na aprovação.
--
-- 1. Os documentos ficam salvos no banco antes do envio. A prestação nasce
--    no primeiro documento como "rascunho" (migration anterior) e só vai ao
--    financeiro em `enviar_prestacao_verba_salva`, que exige a verba paga.
--    Anexar e salvar vale desde que a PP foi enviada ao financeiro (em
--    avaliação, aprovada ou paga).
--
-- 2. Os 7 tipos do sistema (`documento_tipo`), com os campos de cada um.
--    Os campos novos são todos opcionais na coluna — o rascunho entra
--    incompleto, e as 3 linhas que já existem não têm nenhum. A regra de
--    completude mora em `_faltas_do_documento_da_prestacao`, cobrada no
--    envio e na aprovação:
--      NF e fatura .. número, emissão, valor, CNPJ tomador, CNPJ e razão
--                     social do emitente;
--      cupom fiscal . número, emissão, valor e CNPJ do emitente (razão
--                     social opcional);
--      recibo ....... data, valor e quem recebeu (número e CPF/CNPJ
--                     opcionais);
--      boleto e
--      contrato ..... número e data, SEM valor: são anexos de apoio e não
--                     somam no comprovado (a NF e o boleto da mesma compra
--                     não contam duas vezes);
--      outro ........ descrição, data e valor.
--    Por isso `documento_tipo` e `valor` perdem o NOT NULL, e a CHECK que
--    aceitava só NF e recibo dá lugar à que proíbe valor em boleto e
--    contrato. Afrouxar CHECK e NOT NULL não toca em linha nenhuma
--    (precedente da decisão 187: "as CHECKs só ganharam um ramo").
--
-- 3. O financeiro corrige os dados de cada documento na conferência
--    (`corrigir_documento_prestacao_verba`), com a prestação em avaliação.
--
-- 4. Na aprovação, cada NF entra no cadastro de notas do fiscal
--    (`notas_fiscais_fornecedor`, decisão 152), para a Apuração contá-la
--    como qualquer outra. O emitente é procurado pelo CNPJ em `fornecedores`
--    (único por tenant, `uniq_fornecedores_documento_por_tenant`); sem
--    cadastro, nasce com nome = razão social, o CNPJ, pessoa jurídica e
--    `sem_dados_pagamento`. A nota guarda `registrada_na_pp_id` = a PP da
--    verba; o crédito de PIS/COFINS segue o "Não gera crédito" da aprovação
--    da PP normal (motivo obrigatório); sem ISS retido e sem retenção.
--    Fatura e cupom fiscal NÃO entram no cadastro de notas. A estrutura das
--    tabelas do fiscal não muda: só ganham linhas.
--
-- Compatibilidade com o app que está no ar até o deploy: a assinatura
-- antiga de `enviar_prestacao_verba(uuid, jsonb, boolean)` fica como está
-- (ela aceita o rascunho e o substitui, como já fazia com a reprovada), e
-- `aprovar_prestacao_verba` ganha o 3º argumento com padrão — a chamada de
-- dois argumentos continua valendo. Tirar a assinatura antiga do envio é
-- mudança destrutiva, a pedir depois do deploy.
--
-- Fora daqui: a leitura do documento por IA (vem com a da decisão 178), o
-- reembolso (187, continua sem NF no fiscal) e prazo para fechar.

-- ---------------------------------------------------------------------------
-- 1. Os campos do documento
-- ---------------------------------------------------------------------------
alter table public.pp_verba_prestacoes_anexos
  add column if not exists documento_data date,
  add column if not exists tomador_estabelecimento_id uuid
    references public.fiscal_estabelecimentos(id) on delete restrict,
  add column if not exists emitente_documento text,
  add column if not exists emitente_nome text,
  add column if not exists descricao text,
  add column if not exists nota_fiscal_id uuid
    references public.notas_fiscais_fornecedor(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.pp_verba_prestacoes_anexos.documento_data is
  'Emissão (NF, fatura, cupom) ou data do gasto (recibo, boleto, contrato, outro). Decisão 189.';
comment on column public.pp_verba_prestacoes_anexos.tomador_estabelecimento_id is
  'NF e fatura: o CNPJ da empresa contra quem a nota saiu (cadastro de impostos). Decisão 189.';
comment on column public.pp_verba_prestacoes_anexos.emitente_documento is
  'Só dígitos. NF, fatura e cupom: CNPJ do emitente; recibo: CPF/CNPJ de quem recebeu. Decisão 189.';
comment on column public.pp_verba_prestacoes_anexos.emitente_nome is
  'NF, fatura e cupom: razão social do emitente; recibo: quem recebeu. Decisão 189.';
comment on column public.pp_verba_prestacoes_anexos.descricao is
  'Tipo "outro": o que o documento é. Decisão 189.';
comment on column public.pp_verba_prestacoes_anexos.nota_fiscal_id is
  'A NF registrada no cadastro de notas do fiscal na aprovação da prestação. Decisão 189.';
comment on column public.pp_verba_prestacoes_anexos.valor is
  'Quanto o documento comprova. Nulo no rascunho e em boleto e contrato (anexos de apoio, decisão 189).';

alter table public.pp_verba_prestacoes_anexos alter column documento_tipo drop not null;
alter table public.pp_verba_prestacoes_anexos alter column valor drop not null;

alter table public.pp_verba_prestacoes_anexos
  drop constraint if exists chk_prestacao_anexo_documento_fiscal;
alter table public.pp_verba_prestacoes_anexos
  drop constraint if exists chk_prestacao_anexo_apoio_sem_valor;
alter table public.pp_verba_prestacoes_anexos
  add constraint chk_prestacao_anexo_apoio_sem_valor check (
    documento_tipo is null
    or documento_tipo not in ('boleto'::public.documento_tipo, 'contrato'::public.documento_tipo)
    or valor is null
  );
alter table public.pp_verba_prestacoes_anexos
  drop constraint if exists chk_prestacao_anexo_emitente_documento;
alter table public.pp_verba_prestacoes_anexos
  add constraint chk_prestacao_anexo_emitente_documento check (
    emitente_documento is null or emitente_documento ~ '^([0-9]{11}|[0-9]{14})$'
  );

create index if not exists idx_pp_verba_prestacoes_anexos_tomador
  on public.pp_verba_prestacoes_anexos (tomador_estabelecimento_id)
  where tomador_estabelecimento_id is not null;
create index if not exists idx_pp_verba_prestacoes_anexos_nota
  on public.pp_verba_prestacoes_anexos (nota_fiscal_id)
  where nota_fiscal_id is not null;
create index if not exists idx_pp_verba_prestacoes_anexos_created_by
  on public.pp_verba_prestacoes_anexos (created_by);

drop trigger if exists trg_pp_verba_prestacoes_anexos_updated_at on public.pp_verba_prestacoes_anexos;
create trigger trg_pp_verba_prestacoes_anexos_updated_at
  before update on public.pp_verba_prestacoes_anexos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. O histórico: o rascunho não é envio
-- ---------------------------------------------------------------------------
-- O rascunho nasce calado. Do rascunho para "em avaliação" é o PRIMEIRO
-- envio ("Prestação enviada"); da reprovada, o reenvio, como antes.
create or replace function public.prestacao_verba_registra_evento()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_evento text;
  v_por    uuid;
  v_em     timestamptz;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'rascunho' then
      return null;
    end if;
    v_evento := 'prestacao_enviada';
    v_por    := coalesce(new.fechada_por, v_uid);
    v_em     := coalesce(new.fechada_em, now());
  elsif old.status is distinct from new.status then
    if new.status = 'em_avaliacao' then
      v_evento := case when old.status = 'rascunho' then 'prestacao_enviada' else 'prestacao_reenviada' end;
      v_por    := coalesce(new.fechada_por, v_uid);
      v_em     := coalesce(new.fechada_em, now());
    elsif new.status = 'reprovada' then
      v_evento := 'prestacao_reprovada';
      v_por    := coalesce(new.reprovada_por, v_uid);
      v_em     := coalesce(new.reprovada_em, now());
      v_motivo := new.motivo_reprovacao;
    elsif new.status = 'aprovada' then
      v_evento := 'prestacao_aprovada';
      v_por    := coalesce(new.aprovada_por, v_uid);
      v_em     := coalesce(new.aprovada_em, now());
    end if;
  end if;

  if v_evento is not null then
    insert into public.pedidos_compra_eventos
      (tenant_id, pedido_compra_id, evento, por, em, motivo)
    values (new.tenant_id, new.pedido_compra_id, v_evento, v_por, v_em, v_motivo);
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quem presta contas (a regra das decisões 164 e 171, num lugar só)
-- ---------------------------------------------------------------------------
create or replace function public._verba_para_prestar(p_pp_id uuid)
returns public.pedidos_compra
language plpgsql
security definer
set search_path to 'public'
as $$
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

  if v_pp.verba_producao is not true then
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
$$;

-- ---------------------------------------------------------------------------
-- 4. O que falta num documento (a mesma regra de `lib/prestacao-da-verba.ts`)
-- ---------------------------------------------------------------------------
create or replace function public._faltas_do_documento_da_prestacao(
  a public.pp_verba_prestacoes_anexos
) returns text[]
language plpgsql
stable
set search_path to 'public'
as $$
declare
  f text[] := '{}';
  v_doc text := coalesce(a.emitente_documento, '');
begin
  if a.documento_tipo is null then
    return array['o tipo'];
  end if;

  if a.documento_tipo in ('nota_fiscal', 'fatura', 'cupom_fiscal', 'boleto', 'contrato') then
    if coalesce(btrim(a.documento_numero), '') = '' then
      f := f || 'o número'::text;
    elsif a.documento_tipo = 'nota_fiscal' and public.chave_do_numero_da_nf(a.documento_numero) is null then
      f := f || 'um número de NF válido'::text;
    end if;
  end if;

  if a.documento_tipo = 'outro' and coalesce(btrim(a.descricao), '') = '' then
    f := f || 'a descrição'::text;
  end if;

  if a.documento_data is null then
    f := f || (case when a.documento_tipo in ('nota_fiscal', 'fatura', 'cupom_fiscal')
                    then 'a data de emissão' else 'a data' end)::text;
  end if;

  if a.documento_tipo not in ('boleto', 'contrato') and (a.valor is null or a.valor <= 0) then
    f := f || 'o valor'::text;
  end if;

  if a.documento_tipo in ('nota_fiscal', 'fatura') and a.tomador_estabelecimento_id is null then
    f := f || 'o CNPJ tomador'::text;
  end if;

  if a.documento_tipo in ('nota_fiscal', 'fatura', 'cupom_fiscal') and length(v_doc) <> 14 then
    f := f || 'o CNPJ do emitente'::text;
  end if;

  if a.documento_tipo in ('nota_fiscal', 'fatura') and coalesce(btrim(a.emitente_nome), '') = '' then
    f := f || 'a razão social do emitente'::text;
  end if;

  if a.documento_tipo = 'recibo' and coalesce(btrim(a.emitente_nome), '') = '' then
    f := f || 'quem recebeu'::text;
  end if;

  return f;
end;
$$;

-- Recusa o primeiro documento incompleto, dizendo qual e o que falta.
create or replace function public._conferir_documentos_da_prestacao(p_prestacao_id uuid)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  a      public.pp_verba_prestacoes_anexos%rowtype;
  f      text[];
  v_txt  text;
begin
  for a in
    select * from public.pp_verba_prestacoes_anexos
     where prestacao_id = p_prestacao_id
     order by created_at, id
  loop
    f := public._faltas_do_documento_da_prestacao(a);
    if array_length(f, 1) is not null then
      v_txt := case
        when array_length(f, 1) = 1 then f[1]
        else array_to_string(f[1:array_length(f, 1) - 1], ', ') || ' e ' || f[array_length(f, 1)]
      end;
      raise exception 'Complete o documento “%”: informe %.', a.arquivo_nome_original, v_txt;
    end if;
  end loop;
end;
$$;

-- Os campos editáveis de um documento, lidos e validados do JSON. Serve à
-- produção (salvar) e ao financeiro (corrigir). Devolve a linha com os
-- campos novos; quem chama grava.
create or replace function public._campos_do_documento_da_prestacao(
  p_tenant uuid,
  p_doc jsonb,
  p_atual public.pp_verba_prestacoes_anexos
) returns public.pp_verba_prestacoes_anexos
language plpgsql
stable
set search_path to 'public'
as $$
declare
  r       public.pp_verba_prestacoes_anexos := p_atual;
  v_tipo  text := nullif(btrim(coalesce(p_doc->>'documento_tipo', '')), '');
  v_valor numeric;
  v_data  date;
  v_tom   uuid;
  v_emit  text;
begin
  if v_tipo is not null and v_tipo not in
     ('nota_fiscal', 'recibo', 'fatura', 'boleto', 'contrato', 'cupom_fiscal', 'outro') then
    raise exception 'Tipo de documento inválido.';
  end if;

  begin
    v_valor := nullif(btrim(coalesce(p_doc->>'valor', '')), '')::numeric;
  exception when others then
    raise exception 'Valor inválido.';
  end;
  if v_valor is not null and (v_valor <= 0 or v_valor > 999999999) then
    raise exception 'Informe um valor maior que zero.';
  end if;

  begin
    v_data := nullif(btrim(coalesce(p_doc->>'documento_data', '')), '')::date;
  exception when others then
    raise exception 'Data inválida.';
  end;
  if v_data is not null and v_data > public.hoje_em_sao_paulo() then
    raise exception 'A data do documento não pode ser depois de hoje.';
  end if;

  begin
    v_tom := nullif(btrim(coalesce(p_doc->>'tomador_estabelecimento_id', '')), '')::uuid;
  exception when others then
    raise exception 'CNPJ tomador inválido.';
  end;
  if v_tom is not null and not exists (
    select 1 from public.fiscal_estabelecimentos e
     where e.id = v_tom and e.tenant_id = p_tenant and e.ativo
  ) then
    raise exception 'Escolha o CNPJ tomador entre os CNPJs ativos do cadastro de impostos.';
  end if;

  v_emit := nullif(regexp_replace(coalesce(p_doc->>'emitente_documento', ''), '[^0-9]', '', 'g'), '');
  if v_emit is not null and length(v_emit) not in (11, 14) then
    raise exception 'O CPF ou CNPJ precisa ter 11 ou 14 dígitos.';
  end if;

  if char_length(coalesce(p_doc->>'documento_numero', '')) > 60 then
    raise exception 'O número do documento passa de 60 caracteres.';
  end if;
  if char_length(coalesce(p_doc->>'emitente_nome', '')) > 200
     or char_length(coalesce(p_doc->>'descricao', '')) > 200 then
    raise exception 'Texto longo demais no documento (até 200 caracteres).';
  end if;

  if p_doc ? 'documento_tipo' then
    r.documento_tipo := v_tipo::public.documento_tipo;
  end if;
  r.documento_numero := nullif(btrim(coalesce(p_doc->>'documento_numero', '')), '');
  r.documento_data := v_data;
  r.valor := case when r.documento_tipo in ('boleto', 'contrato') then null else round(v_valor, 2) end;
  r.tomador_estabelecimento_id := v_tom;
  r.emitente_documento := v_emit;
  r.emitente_nome := nullif(btrim(coalesce(p_doc->>'emitente_nome', '')), '');
  r.descricao := nullif(btrim(coalesce(p_doc->>'descricao', '')), '');
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A produção: salvar e remover um documento
-- ---------------------------------------------------------------------------
create or replace function public.salvar_documento_prestacao_verba(
  p_pp_id uuid,
  p_documento jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_pp      public.pedidos_compra%rowtype;
  v_prest   public.pp_verba_prestacoes%rowtype;
  v_atual   public.pp_verba_prestacoes_anexos%rowtype;
  v_novo    public.pp_verba_prestacoes_anexos%rowtype;
  v_id      uuid := nullif(btrim(coalesce(p_documento->>'id', '')), '')::uuid;
  v_prefixo text;
begin
  if p_documento is null or jsonb_typeof(p_documento) <> 'object' then
    raise exception 'Documento inválido.';
  end if;
  v_pp := public._verba_para_prestar(p_pp_id);
  if v_pp.status not in ('em_avaliacao', 'aprovada', 'pago') then
    raise exception 'Os documentos da prestação entram depois que a PP é enviada ao financeiro.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if found and v_prest.status = 'em_avaliacao' then
    raise exception 'A prestação desta verba está com o financeiro. Ela volta para você se for reprovada.';
  end if;
  if found and v_prest.status = 'aprovada' then
    raise exception 'A prestação desta verba já foi aprovada.';
  end if;

  if v_id is null then
    -- Arquivo novo: já subiu para a pasta da verba no Storage.
    v_prefixo := v_pp.tenant_id::text || '/verba-prestacoes/' || v_pp.id::text || '/';
    if left(coalesce(p_documento->>'path', ''), length(v_prefixo)) <> v_prefixo then
      raise exception 'Documento em caminho inválido.';
    end if;
    if coalesce(btrim(p_documento->>'nome_original'), '') = ''
       or coalesce(nullif(p_documento->>'tamanho_bytes', '')::bigint, 0) <= 0
       or coalesce(p_documento->>'mimetype', '') = '' then
      raise exception 'Documento sem arquivo válido.';
    end if;

    if v_prest.id is null then
      insert into public.pp_verba_prestacoes (
        tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por, status
      ) values (
        v_pp.tenant_id, v_pp.id, 0, 0, v_uid, 'rascunho'
      )
      returning * into v_prest;
    end if;

    v_novo := public._campos_do_documento_da_prestacao(v_pp.tenant_id, p_documento, null);
    insert into public.pp_verba_prestacoes_anexos (
      tenant_id, prestacao_id, arquivo_path, arquivo_nome_original,
      arquivo_tamanho_bytes, arquivo_mimetype, documento_tipo, documento_numero,
      documento_data, valor, tomador_estabelecimento_id, emitente_documento,
      emitente_nome, descricao, created_by
    ) values (
      v_pp.tenant_id, v_prest.id, p_documento->>'path', left(btrim(p_documento->>'nome_original'), 500),
      (p_documento->>'tamanho_bytes')::bigint, p_documento->>'mimetype', v_novo.documento_tipo,
      v_novo.documento_numero, v_novo.documento_data, v_novo.valor,
      v_novo.tomador_estabelecimento_id, v_novo.emitente_documento, v_novo.emitente_nome,
      v_novo.descricao, v_uid
    )
    returning id into v_id;
    return v_id;
  end if;

  select * into v_atual
    from public.pp_verba_prestacoes_anexos
   where id = v_id and prestacao_id = v_prest.id
   for update;
  if not found then
    raise exception 'Documento não pertence a esta prestação.';
  end if;

  v_novo := public._campos_do_documento_da_prestacao(v_pp.tenant_id, p_documento, v_atual);
  update public.pp_verba_prestacoes_anexos
     set documento_tipo             = v_novo.documento_tipo,
         documento_numero           = v_novo.documento_numero,
         documento_data             = v_novo.documento_data,
         valor                      = v_novo.valor,
         tomador_estabelecimento_id = v_novo.tomador_estabelecimento_id,
         emitente_documento         = v_novo.emitente_documento,
         emitente_nome              = v_novo.emitente_nome,
         descricao                  = v_novo.descricao
   where id = v_id;
  return v_id;
end;
$$;

-- Devolve o caminho do arquivo, que a Server Action apaga do Storage. O
-- rascunho que fica sem documento some com ele: a verba volta a "sem
-- prestação".
create or replace function public.remover_documento_prestacao_verba(p_documento_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_doc   public.pp_verba_prestacoes_anexos%rowtype;
  v_prest public.pp_verba_prestacoes%rowtype;
begin
  select * into v_doc from public.pp_verba_prestacoes_anexos where id = p_documento_id;
  if not found then raise exception 'Documento não encontrado.'; end if;
  select * into v_prest from public.pp_verba_prestacoes where id = v_doc.prestacao_id;

  perform public._verba_para_prestar(v_prest.pedido_compra_id);

  select * into v_prest from public.pp_verba_prestacoes where id = v_doc.prestacao_id for update;
  if v_prest.status not in ('rascunho', 'reprovada') then
    raise exception 'A prestação desta verba está com o financeiro: os documentos não mudam até ela voltar.';
  end if;

  delete from public.pp_verba_prestacoes_anexos where id = p_documento_id;

  if v_prest.status = 'rascunho' and not exists (
    select 1 from public.pp_verba_prestacoes_anexos where prestacao_id = v_prest.id
  ) then
    delete from public.pp_verba_prestacoes where id = v_prest.id;
  end if;

  return v_doc.arquivo_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. A produção: o envio único, no fim
-- ---------------------------------------------------------------------------
create or replace function public.enviar_prestacao_verba_salva(
  p_pp_id uuid,
  p_sem_gasto boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_pp    public.pedidos_compra%rowtype;
  v_prest public.pp_verba_prestacoes%rowtype;
  v_soma  numeric(14,2) := 0;
  v_id    uuid;
begin
  v_pp := public._verba_para_prestar(p_pp_id);
  if v_pp.status <> 'pago' then
    raise exception 'O envio ao financeiro libera depois que a verba estiver paga. Os documentos ficam salvos até lá.';
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
    -- "Não houve gasto": a prestação vai sem documento. O que estava salvo
    -- sai (a Server Action apaga os arquivos).
    if v_prest.id is not null then
      delete from public.pp_verba_prestacoes_anexos where prestacao_id = v_prest.id;
    end if;
  else
    if v_prest.id is null or not exists (
      select 1 from public.pp_verba_prestacoes_anexos where prestacao_id = v_prest.id
    ) then
      raise exception 'Anexe ao menos um documento — ou marque “Não houve gasto”.';
    end if;
    perform public._conferir_documentos_da_prestacao(v_prest.id);
    select coalesce(sum(valor), 0) into v_soma
      from public.pp_verba_prestacoes_anexos
     where prestacao_id = v_prest.id and valor is not null;
    if v_soma <= 0 then
      raise exception 'Anexe ao menos um documento que comprove gasto — NF, recibo, fatura, cupom fiscal ou outro. Boleto e contrato acompanham a compra, mas não somam.';
    end if;
    if v_soma > v_pp.valor then
      raise exception 'Os documentos somam R$ %, acima da verba de R$ %. O excedente precisa de uma PP nova.',
        translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
        translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
    end if;
  end if;

  if v_prest.id is null then
    insert into public.pp_verba_prestacoes (
      tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por, status
    ) values (
      v_pp.tenant_id, v_pp.id, v_soma, v_pp.valor - v_soma, v_uid, 'em_avaliacao'
    )
    returning id into v_id;
  else
    v_id := v_prest.id;
    update public.pp_verba_prestacoes
       set valor_gasto     = v_soma,
           valor_devolvido = v_pp.valor - v_soma,
           status          = 'em_avaliacao',
           fechada_em      = now(),
           fechada_por     = v_uid
     where id = v_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. O financeiro: corrigir os dados de um documento na conferência
-- ---------------------------------------------------------------------------
create or replace function public.corrigir_documento_prestacao_verba(
  p_documento_id uuid,
  p_documento jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_doc   public.pp_verba_prestacoes_anexos%rowtype;
  v_novo  public.pp_verba_prestacoes_anexos%rowtype;
  v_prest public.pp_verba_prestacoes%rowtype;
  v_pp    public.pedidos_compra%rowtype;
  v_papel text;
  v_soma  numeric(14,2);
begin
  if p_documento is null or jsonb_typeof(p_documento) <> 'object' then
    raise exception 'Documento inválido.';
  end if;
  select * into v_doc from public.pp_verba_prestacoes_anexos where id = p_documento_id for update;
  if not found then raise exception 'Documento não encontrado.'; end if;
  select * into v_prest from public.pp_verba_prestacoes where id = v_doc.prestacao_id for update;
  select * into v_pp from public.pedidos_compra where id = v_prest.pedido_compra_id;

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

  -- O tipo é da produção: o financeiro que discordar reprova.
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
    raise exception 'Com essa correção os documentos somam R$ %, acima da verba de R$ %.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;
  update public.pp_verba_prestacoes
     set valor_gasto = v_soma,
         valor_devolvido = v_pp.valor - v_soma
   where id = v_prest.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. O financeiro: aprovar — agora com as NFs no cadastro de notas
-- ---------------------------------------------------------------------------
-- A assinatura de dois argumentos sai para dar lugar à de três com padrão
-- (as duas juntas deixariam a chamada antiga ambígua). A chamada de dois
-- argumentos do app no ar continua valendo, e o retorno é o mesmo.
drop function if exists public.aprovar_prestacao_verba(uuid, date);

create or replace function public.aprovar_prestacao_verba(
  p_pp_id uuid,
  p_data_prevista date,
  p_notas jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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

  -- O financeiro pode ter corrigido os dados: confere de novo e refaz a soma.
  perform public._conferir_documentos_da_prestacao(v_prest.id);
  select coalesce(sum(valor), 0) into v_soma
    from public.pp_verba_prestacoes_anexos
   where prestacao_id = v_prest.id and valor is not null;
  if v_soma > v_pp.valor then
    raise exception 'Os documentos somam R$ %, acima da verba de R$ %.',
      translate(to_char(v_soma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_pp.valor, 'FM999,999,999,990.00'), ',.', '.,');
  end if;
  v_saldo := v_pp.valor - v_soma;
  if v_saldo > 0 and p_data_prevista is null then
    raise exception 'Informe a data prevista da devolução.';
  end if;

  -- As NFs vão para o cadastro de notas do fiscal (decisão 152), com o
  -- emitente procurado — ou cadastrado — pelo CNPJ.
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
      -- A nota já estava no cadastro (outra PP ou outra verba): conta uma
      -- vez só, pelo que lá está. Só se registra, se ainda não estava.
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
$$;

-- ---------------------------------------------------------------------------
-- 9. Permissões
-- ---------------------------------------------------------------------------
revoke all on function public._verba_para_prestar(uuid) from public, anon, authenticated;
revoke all on function public._faltas_do_documento_da_prestacao(public.pp_verba_prestacoes_anexos) from public, anon, authenticated;
revoke all on function public._conferir_documentos_da_prestacao(uuid) from public, anon, authenticated;
revoke all on function public._campos_do_documento_da_prestacao(uuid, jsonb, public.pp_verba_prestacoes_anexos) from public, anon, authenticated;

revoke all on function public.salvar_documento_prestacao_verba(uuid, jsonb) from public, anon;
grant execute on function public.salvar_documento_prestacao_verba(uuid, jsonb) to authenticated;
revoke all on function public.remover_documento_prestacao_verba(uuid) from public, anon;
grant execute on function public.remover_documento_prestacao_verba(uuid) to authenticated;
revoke all on function public.enviar_prestacao_verba_salva(uuid, boolean) from public, anon;
grant execute on function public.enviar_prestacao_verba_salva(uuid, boolean) to authenticated;
revoke all on function public.corrigir_documento_prestacao_verba(uuid, jsonb) from public, anon;
grant execute on function public.corrigir_documento_prestacao_verba(uuid, jsonb) to authenticated;
revoke all on function public.aprovar_prestacao_verba(uuid, date, jsonb) from public, anon;
grant execute on function public.aprovar_prestacao_verba(uuid, date, jsonb) to authenticated;
