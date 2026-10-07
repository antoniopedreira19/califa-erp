-- =====================================================================
-- 20261007900001 — O save do orçamento inteiro (decisão 154)
-- =====================================================================
--
-- POR QUÊ
--   A chave "Orçamento de save" só marcava a linha NOVA (gatilho
--   `item_nasce_em_save`, decisão 028 §10): as linhas que já existiam não
--   mudavam, e desligar não desmarcava nada. O Tiago pediu, em 07/10/2026,
--   que o orçamento inteiro seja dedicado a uma de duas coisas:
--
--     • GERAR save: todas as linhas viram save, e a linha nova já nasce em
--       save (a chave de sempre, `save_por_padrao`, agora com as linhas que
--       já existem);
--     • CONSUMIR o saldo de UM job: todas as linhas são pagas pelo saldo do
--       job escolhido (`save_consumo_job_id`, coluna nova).
--
--   E "retirar todos os saves" num clique.
--
-- AS REGRAS (decididas pelo Tiago em 07/10/2026)
--   1. Os dois modos se excluem (CHECK), e ligar um modo é recusado, com o
--      motivo, quando alguma linha já tem save de outro tipo: linha que
--      consome não vira save; linha que gera save, ou que consome de OUTRO
--      job, trava o consumo. A linha que já consome do MESMO job é
--      absorvida (passa a consumir o valor inteiro dela).
--   2. Ligar o consumo com o orçamento maior que o saldo disponível do job:
--      ERRO, nada grava.
--   3. Com o consumo ligado, o valor que passaria do saldo não grava: a
--      linha nova e a mudança de valor são recusadas.
--   4. Com um modo ligado, o save não se mexe linha a linha: para mudar
--      uma linha só, retira-se antes o save do orçamento.
--
--   Rascunho continua não segurando saldo para OS OUTROS (decisão 028,
--   nota de 26/08): o disponível desconta o que outros jobs e versões
--   aprovadas usam, não outros rascunhos. A trava das regras 2 e 3 é deste
--   orçamento contra o saldo; a aprovação da versão revalida
--   (`save_consumo_valida`), como sempre.
--
-- QUEM PODE
--   As três funções são SECURITY INVOKER: a RLS de quem chama vale, igual
--   à escrita direta nas mesmas tabelas (inclusive a de `jobs`, por empresa
--   e regional: só se escolhe job que se enxerga). Só a conta do saldo roda
--   fora da RLS (`save_disponivel_do_job`). A permissão de tela é
--   `orcamentos.editar` (administrador, GP e produtor), conferida na Server
--   Action — escolha do Tiago: o produtor preenche a planilha com save; o
--   saldo só se materializa quando o GP ou o administrador envia ao
--   financeiro e o financeiro aprova (decisão 099).
--
-- O QUE FICA DE FORA
--   • Linha com BV não vira save (decisão 028 §9: linha em save não aceita
--     BV). O gerar recusa e diz quais linhas.
--   • A duplicação de versão continua sem copiar save, e a versão nova da
--     importação do projeto herda a chave de gerar (como antes) mas não o
--     consumo — o consumo linha a linha também nunca foi herdado.
--   • O caminho do pedido ao financeiro (`save_enviar_pendentes`) não muda
--     aqui: cada linha continua sendo um pedido.
-- =====================================================================

-- ---------------------------------------------------------------- coluna

alter table public.versoes_orcamento
  add column if not exists save_consumo_job_id uuid
    references public.jobs(id) on delete restrict;

comment on column public.versoes_orcamento.save_consumo_job_id is
  'Decisão 154: o job cujo saldo de save a versão INTEIRA consome. Com ele preenchido, toda linha consome o próprio orçado desse job, e o valor que passaria do saldo não grava. Exclui save_por_padrao (chk_versao_save_um_modo). Nulo = sem consumo do orçamento inteiro (a linha ainda pode consumir avulso pelo pop-up).';

comment on column public.versoes_orcamento.save_por_padrao is
  'Decisão 028 §10, revista pela 154 (07/10/2026): orçamento de save INTEIRO. Ligada, todas as linhas geram save e a linha nova já nasce em save (item_nasce_em_save); liga e desliga só pelas funções versao_save_gerar_tudo e versao_save_retirar_tudo.';

create index if not exists versoes_orcamento_save_consumo_job_idx
  on public.versoes_orcamento (save_consumo_job_id)
  where save_consumo_job_id is not null;

alter table public.versoes_orcamento
  drop constraint if exists chk_versao_save_um_modo;
alter table public.versoes_orcamento
  add constraint chk_versao_save_um_modo
  check (not (save_por_padrao and save_consumo_job_id is not null));

-- ------------------------------------------------- linhas, para mensagens

-- "EQUIPE INTERNA · Assistente de Produção; LOGÍSTICA · Passagem", na ordem
-- da planilha. Até 6 nomes e "e mais N": a mensagem precisa caber no aviso.
create or replace function public.save_nomes_das_linhas(p_itens uuid[])
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with l as (
    select coalesce(g.nome, '—') || ' · ' || i.item as nome,
           row_number() over (order by g.ordem nulls last, i.ordem) as n
      from public.versoes_orcamento_itens i
      left join public.versoes_orcamento_grupos g on g.id = i.grupo_id
     where i.id = any(p_itens)
  )
  select string_agg(nome, '; ' order by n) filter (where n <= 6)
         || case when count(*) > 6 then format(' e mais %s', count(*) - 6) else '' end
    from l;
$$;

-- O disponível de um job de origem para um RASCUNHO: o gerado aprovado
-- menos o que linhas de job e versões aprovadas já usam. É o `disponivel`
-- de `vw_saves_por_job`. Fora da RLS (SECURITY DEFINER): a RLS de `jobs`
-- filtra por empresa e regional, e a conta do saldo não pode encolher com
-- ela (mesmo motivo de `save_uso_linhas`).
--
-- Duas portas: a interna, sem conferir o tenant, para o gatilho da linha —
-- que também roda na importação, pela chave de serviço, sem usuário na
-- sessão —; e a pública, que confere o tenant de quem chama.
create or replace function public.save_disponivel_do_job(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select (public.save_gerado_aprovado(p_job_id)
          - coalesce((select sum(u.usado) from public.save_uso_linhas(p_job_id) u), 0))::numeric(14,2);
$$;

create or replace function public.save_disponivel_para_rascunho(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.save_disponivel_do_job(p_job_id)
   where exists (
     select 1 from public.jobs j
      where j.id = p_job_id
        and j.tenant_id in (select public.current_tenant_ids()));
$$;

-- --------------------------------------------------------- gerar save

create or replace function public.versao_save_gerar_tudo(p_versao_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status        text;
  v_orcamento     uuid;
  v_consumo_job   uuid;
  v_codigo        text;
  v_itens         uuid[];
  v_marcadas      integer;
begin
  select v.status::text, v.orcamento_id, v.save_consumo_job_id
    into v_status, v_orcamento, v_consumo_job
    from public.versoes_orcamento v
   where v.id = p_versao_id
   for update;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;
  if public.orcamento_de_investimento_interno(v_orcamento) then
    raise exception 'O serviço Interno não usa save.';
  end if;
  if v_consumo_job is not null then
    select codigo into v_codigo from public.jobs where id = v_consumo_job;
    raise exception 'Este orçamento inteiro consome o saldo do %. Para transformá-lo em orçamento de save, retire antes todos os saves.', v_codigo;
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and exists (select 1 from public.saves_consumos c
                  where c.item_versao_id = i.id and c.substituido_em is null);
  if v_itens is not null then
    raise exception 'Não dá para transformar o orçamento em save: % já % saldo de outro job (%). Retire antes esses saves.',
      case when cardinality(v_itens) = 1 then '1 linha' else cardinality(v_itens) || ' linhas' end,
      case when cardinality(v_itens) = 1 then 'consome' else 'consomem' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and exists (select 1 from public.itens_bv b
                  where b.item_versao_id = i.id and b.situacao <> 'cancelado');
  if v_itens is not null then
    raise exception 'Não dá para transformar o orçamento em save: % BV, e linha em save não aceita BV (%). Retire antes o BV.',
      case when cardinality(v_itens) = 1 then '1 linha tem' else cardinality(v_itens) || ' linhas têm' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  -- A chave antes das linhas: o gatilho da linha confere o modo da versão.
  update public.versoes_orcamento
     set save_por_padrao = true
   where id = p_versao_id;

  update public.versoes_orcamento_itens
     set em_save = true
   where versao_orcamento_id = p_versao_id
     and not em_save;
  get diagnostics v_marcadas = row_count;

  return jsonb_build_object('linhas_marcadas', v_marcadas);
end;
$$;

-- ------------------------------------------------- consumir um job inteiro

create or replace function public.versao_save_consumir_tudo(p_versao_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status        text;
  v_orcamento     uuid;
  v_tenant        uuid;
  v_padrao        boolean;
  v_job_atual     uuid;
  v_cliente       uuid;
  v_job           record;
  v_itens         uuid[];
  v_total         numeric(14,2);
  v_disponivel    numeric(14,2);
  v_linhas        integer;
begin
  select v.status::text, v.orcamento_id, v.tenant_id, v.save_por_padrao, v.save_consumo_job_id, p.cliente_id
    into v_status, v_orcamento, v_tenant, v_padrao, v_job_atual, v_cliente
    from public.versoes_orcamento v
    join public.orcamentos o on o.id = v.orcamento_id
    join public.projetos p on p.id = o.projeto_id
   where v.id = p_versao_id
   for update of v;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;
  if public.orcamento_de_investimento_interno(v_orcamento) then
    raise exception 'O serviço Interno não usa save.';
  end if;
  if v_padrao then
    raise exception 'Este orçamento inteiro gera save. Para consumir o saldo de um job, retire antes todos os saves.';
  end if;

  select j.id, j.codigo, j.status::text as status, j.orcamento_id, j.tenant_id, p.cliente_id
    into v_job
    from public.jobs j
    join public.projetos p on p.id = j.projeto_id
   where j.id = p_job_id;
  if not found then
    raise exception 'Job de origem do save não encontrado.';
  end if;
  if v_job.tenant_id <> v_tenant then
    raise exception 'Job de origem do save não encontrado.';
  end if;
  if v_job.orcamento_id = v_orcamento then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;
  if v_job.cliente_id is distinct from v_cliente then
    raise exception 'O saldo de save é do cliente: o % é de outro cliente.', v_job.codigo;
  end if;
  if v_job.status in ('rejeitado_financeiro', 'cancelado') then
    raise exception 'O % foi cancelado ou recusado pelo financeiro e não oferece saldo.', v_job.codigo;
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.em_save;
  if v_itens is not null then
    raise exception 'Não dá para consumir o saldo de um job: % save (%). Retire antes esses saves.',
      case when cardinality(v_itens) = 1 then '1 linha gera' else cardinality(v_itens) || ' linhas geram' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  -- Consumo de OUTRO job trava. O do mesmo job é absorvido, e o do job que
  -- o orçamento já consumia é trocado (é o "Trocar o job").
  select array_agg(distinct i.id) into v_itens
    from public.versoes_orcamento_itens i
    join public.saves_consumos c on c.item_versao_id = i.id and c.substituido_em is null
   where i.versao_orcamento_id = p_versao_id
     and c.job_origem_id <> p_job_id
     and c.job_origem_id is distinct from v_job_atual;
  if v_itens is not null then
    raise exception 'Não dá para consumir o saldo do %: % o saldo de outro job (%). O orçamento inteiro consome de um job só; retire antes esses saves.',
      v_job.codigo,
      case when cardinality(v_itens) = 1 then '1 linha já consome' else cardinality(v_itens) || ' linhas já consomem' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select coalesce(sum(i.total_orcado), 0) into v_total
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id;
  v_disponivel := coalesce(public.save_disponivel_para_rascunho(p_job_id), 0);
  if v_total > v_disponivel + 0.005 then
    raise exception 'O orçamento soma R$ % e o saldo disponível do % é de R$ %: faltam R$ %. Nada foi gravado.',
      public.save_reais(v_total), v_job.codigo, public.save_reais(v_disponivel),
      public.save_reais(v_total - v_disponivel);
  end if;

  -- O modo antes dos consumos: o gatilho da linha passa a acompanhar.
  update public.versoes_orcamento
     set save_consumo_job_id = p_job_id
   where id = p_versao_id;

  delete from public.saves_consumos c
   using public.versoes_orcamento_itens i
   where c.item_versao_id = i.id
     and i.versao_orcamento_id = p_versao_id
     and c.substituido_em is null;

  insert into public.saves_consumos (tenant_id, job_origem_id, item_versao_id, valor, created_by)
  select i.tenant_id, p_job_id, i.id, i.total_orcado, (select auth.uid())
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.total_orcado > 0;
  get diagnostics v_linhas = row_count;

  return jsonb_build_object(
    'linhas', v_linhas,
    'total', v_total,
    'disponivel', v_disponivel,
    'restante', v_disponivel - v_total,
    'codigo', v_job.codigo
  );
end;
$$;

-- ------------------------------------------------------ retirar tudo

create or replace function public.versao_save_retirar_tudo(p_versao_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status      text;
  v_consumos    integer;
  v_desmarcadas integer;
begin
  select v.status::text into v_status
    from public.versoes_orcamento v
   where v.id = p_versao_id
   for update;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;

  -- O modo sai antes das linhas: com ele ligado, o gatilho da linha recusa
  -- tirar o save de uma linha só.
  update public.versoes_orcamento
     set save_por_padrao = false,
         save_consumo_job_id = null
   where id = p_versao_id;

  with apagados as (
    delete from public.saves_consumos c
     using public.versoes_orcamento_itens i
     where c.item_versao_id = i.id
       and i.versao_orcamento_id = p_versao_id
       and c.substituido_em is null
    returning c.item_versao_id
  )
  select count(distinct item_versao_id) into v_consumos from apagados;

  -- O planejado que o save zerou volta pelo gatilho da marca.
  update public.versoes_orcamento_itens
     set em_save = false
   where versao_orcamento_id = p_versao_id
     and em_save;
  get diagnostics v_desmarcadas = row_count;

  return jsonb_build_object('linhas_desmarcadas', v_desmarcadas, 'linhas_sem_consumo', v_consumos);
end;
$$;

-- ----------------------------------------------- gatilhos nas linhas

-- Regra 4: com um modo ligado, a marca da linha acompanha o modo.
create or replace function public.save_modo_da_versao_na_linha()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_padrao  boolean;
  v_job     uuid;
  v_status  text;
  v_codigo  text;
begin
  select v.save_por_padrao, v.save_consumo_job_id, v.status::text
    into v_padrao, v_job, v_status
    from public.versoes_orcamento v
   where v.id = new.versao_orcamento_id;

  if v_status = 'aprovada' then
    return new;
  end if;
  if v_padrao and not new.em_save then
    raise exception 'Este orçamento inteiro gera save: uma linha não sai do save sozinha. Para mudar uma linha só, retire antes o save do orçamento.';
  end if;
  if v_job is not null and new.em_save then
    select codigo into v_codigo from public.jobs where id = v_job;
    raise exception 'Este orçamento inteiro consome o saldo do %: uma linha dele não gera save. Para mudar uma linha só, retire antes o save do orçamento.', v_codigo;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_save_modo_da_versao_na_linha on public.versoes_orcamento_itens;
create trigger trg_save_modo_da_versao_na_linha
  before insert or update of em_save on public.versoes_orcamento_itens
  for each row execute function public.save_modo_da_versao_na_linha();

-- Regra 3: com o consumo ligado, o consumo da linha é o orçado dela, e o
-- que passaria do saldo não grava. Roda DEPOIS da linha gravada (o total
-- é coluna gerada) e só quando o total muda — a atualização do cache
-- `save_consumido`, que o próprio consumo provoca, não volta aqui.
create or replace function public.save_modo_consumo_acompanha_linha()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job        uuid;
  v_status     text;
  v_codigo     text;
  v_antes      numeric(14,2) := 0;
  v_total      numeric(14,2);
  v_disponivel numeric(14,2);
begin
  if tg_op = 'UPDATE' then
    if new.total_orcado is not distinct from old.total_orcado then
      return null;
    end if;
    v_antes := coalesce(old.total_orcado, 0);
  end if;

  select v.save_consumo_job_id, v.status::text
    into v_job, v_status
    from public.versoes_orcamento v
   where v.id = new.versao_orcamento_id;
  if v_job is null or v_status = 'aprovada' or new.em_save then
    return null;
  end if;

  select coalesce(sum(i.total_orcado), 0) into v_total
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = new.versao_orcamento_id;
  v_disponivel := coalesce(public.save_disponivel_do_job(v_job), 0);

  if v_total > v_disponivel + 0.005 then
    select codigo into v_codigo from public.jobs where id = v_job;
    if tg_op = 'INSERT' then
      raise exception 'Passa do saldo do %: restam R$ %, e a linha nova pede R$ %. A linha não foi gravada.',
        v_codigo,
        public.save_reais(greatest(v_disponivel - (v_total - new.total_orcado), 0)),
        public.save_reais(new.total_orcado);
    end if;
    raise exception 'Passa do saldo do %: restam R$ %, e esta mudança pede mais R$ %. O valor não foi gravado.',
      v_codigo,
      public.save_reais(greatest(v_disponivel - (v_total - new.total_orcado + v_antes), 0)),
      public.save_reais(new.total_orcado - v_antes);
  end if;

  delete from public.saves_consumos
   where item_versao_id = new.id
     and substituido_em is null;
  if new.total_orcado > 0 then
    insert into public.saves_consumos (tenant_id, job_origem_id, item_versao_id, valor, created_by)
    values (new.tenant_id, v_job, new.id, new.total_orcado, (select auth.uid()));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_save_modo_consumo_acompanha_linha on public.versoes_orcamento_itens;
create trigger trg_save_modo_consumo_acompanha_linha
  after insert or update on public.versoes_orcamento_itens
  for each row execute function public.save_modo_consumo_acompanha_linha();

-- ------------------------------------------------------------ grants

revoke all on function public.versao_save_gerar_tudo(uuid) from public, anon;
revoke all on function public.versao_save_consumir_tudo(uuid, uuid) from public, anon;
revoke all on function public.versao_save_retirar_tudo(uuid) from public, anon;
revoke all on function public.save_disponivel_do_job(uuid) from public, anon, authenticated;
revoke all on function public.save_disponivel_para_rascunho(uuid) from public, anon;
revoke all on function public.save_nomes_das_linhas(uuid[]) from public, anon;
revoke all on function public.save_modo_da_versao_na_linha() from public, anon;
revoke all on function public.save_modo_consumo_acompanha_linha() from public, anon;

grant execute on function public.versao_save_gerar_tudo(uuid) to authenticated;
grant execute on function public.versao_save_consumir_tudo(uuid, uuid) to authenticated;
grant execute on function public.versao_save_retirar_tudo(uuid) to authenticated;
grant execute on function public.save_disponivel_para_rascunho(uuid) to authenticated;
grant execute on function public.save_nomes_das_linhas(uuid[]) to authenticated;
