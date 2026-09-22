-- =============================================================================
-- Aprovação de save (decisão 099)
-- =============================================================================
--
-- Até aqui o saldo de save de um job só era oferecido depois do envio desse
-- job ao faturamento (20260901100001, e por mês desde 20260914200008). Esse
-- portão sai. No lugar dele entra a APROVAÇÃO DO FINANCEIRO, linha a linha:
-- cada linha que GERA save e cada linha que CONSOME save vira um pedido, que o
-- administrador ou o financeiro aprova ou recusa na Abertura de Job.
--
-- O que esta migration faz (aditiva: nenhuma coluna ou linha existente é
-- apagada nem sobrescrita):
--
--  1. `saves_aprovacoes`: um registro por pedido, que nunca se apaga — é o
--     histórico que o pop-up de save mostra. Guarda o consumo de ANTES
--     (`origens_antes`) para a recusa desfazer só o efeito daquele pedido.
--     O estado NÃO mora em `jobs_itens_orcado` nem em `saves_consumos`: as
--     policies de UPDATE das duas deixam qualquer membro do tenant alterar
--     qualquer coluna, e um GP se autoaprovaria pela API.
--     O cliente só LÊ esta tabela. Todo pedido nasce, se decide, se cancela ou
--     se retira por uma RPC SECURITY DEFINER, que faz a linha, o pedido, a
--     errata e os números do job numa transação só — o fluxo antigo gravava a
--     errata antes e deixava registro fantasma quando a linha falhava.
--  2. Em job aberto (aberto, em_producao, encerrado, finalizado), a marca de
--     save e o consumo da linha só mudam por essas RPCs: o banco recusa o
--     UPDATE/INSERT/DELETE direto. Em pré-abertura e em job devolvido a cópia
--     segue editável como hoje (sem pedido). Essas travas de escrita direta
--     nascem desligadas (save_aprovacao_em_vigor) e ligam em 20260922140003,
--     aplicada junto do deploy do código.
--  3. `save_marcado_por`, `save_marcado_em` e `planejado_antes_save` nas
--     linhas da versão e do job: quem marcou o save (histórico do pop-up) e o
--     planejado que o save zerou, para devolvê-lo quando o save sai (recusa,
--     cancelamento ou retirada). A cópia do job herda os três da versão.
--  4. Saldo = só save APROVADO. O uso de cada origem por linha consumidora é o
--     maior entre o consumo aprovado, o pedido que aguarda (a reserva) e o
--     consumo gravado que segura saldo (linha de job, ou versão aprovada). Na
--     edição de um consumo aprovado a origem fica reservada pelo maior dos
--     dois valores até a decisão. A tela (`vw_saves_por_job`) e o trigger
--     (`save_consumo_valida`) leem a mesma função, `save_uso_linhas`, fora da
--     RLS do pedido — senão um GP de outra regional via mais saldo do que o
--     banco aceita. Consumo de rascunho continua só avisando (decisão 028).
--  5. Travas no banco, além da tela:
--     - um job não consome o próprio saldo, também pelo lado da versão;
--     - gerar save exige a linha sem PP não cancelada, sem BV não cancelado e
--       sem consumo de save;
--     - save aprovado cujo saldo do job já começou a ser consumido não sai da
--       linha; retirar save com pedido aguardando exige cancelar o pedido;
--     - linha com save (gerado, consumido, aguardando ou recusado ainda não
--       retirado) não entra em errata de valores (orçado e planejado) nem é
--       removida;
--     - linha com save não recebe PP (nem PP reativada) e não aceita BV (nem
--       BV reativado); BV confere o save na CÓPIA do job, e cópia de job
--       cancelado não conta;
--     - aprovar uma versão revalida o saldo dos consumos dela, que a partir
--       dali seguram saldo.
--  6. Legado: save e consumo de job encerrado/finalizado ou já enviado ao
--     faturamento entram aprovados (momento 'legado_migracao'). No banco de
--     22/09/2026 é uma linha só: JOB-0032 · Item 6, R$ 10.000,00.
--
-- As mensagens de erro voltam a ter acento: chegam cruas à tela.
--
-- A previsão do financeiro (vw_fluxo_caixa, vw_job_rentabilidade) passa a ler
-- a linha "como o financeiro vê" na migration seguinte (20260922140002).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Pedidos de aprovação
-- -----------------------------------------------------------------------------

create type public.save_aprovacao_tipo as enum ('gera', 'consome');

create type public.save_aprovacao_situacao as enum (
  'aguardando',   -- na faixa Saves da Abertura de Job
  'aprovado',     -- vale: gera saldo, ou consome em definitivo
  'recusado',     -- o financeiro recusou; a linha já voltou ao antes
  'retirado',     -- cancelado ou retirado pela produção, ou recusado arquivado
  'substituido'   -- consumo aprovado trocado por uma edição aprovada
);

create table public.saves_aprovacoes (
  id                           uuid primary key default gen_random_uuid(),
  tenant_id                    uuid not null references public.tenants(id) on delete cascade,
  job_id                       uuid not null references public.jobs(id) on delete cascade,
  -- SET NULL, e não CASCADE: o pedido é histórico e sobrevive à linha.
  job_item_orcado_id           uuid references public.jobs_itens_orcado(id) on delete set null,
  item_descricao               text not null,
  grupo_nome                   text,
  tipo                         public.save_aprovacao_tipo not null,
  situacao                     public.save_aprovacao_situacao not null default 'aguardando',
  momento                      text not null,
  valor                        numeric(14,2) not null,
  origens                      jsonb not null default '[]'::jsonb,
  origens_antes                jsonb not null default '[]'::jsonb,
  valor_job_antes              numeric(14,2),
  valor_job_depois             numeric(14,2),
  faturamento_previsto_antes   numeric(14,2),
  faturamento_previsto_depois  numeric(14,2),
  substitui_id                 uuid references public.saves_aprovacoes(id) on delete set null,
  errata_id                    uuid references public.jobs_erratas(id) on delete set null,
  enviado_por                  uuid references public.profiles(id) on delete set null,
  enviado_em                   timestamptz not null default now(),
  decidido_por                 uuid references public.profiles(id) on delete set null,
  decidido_em                  timestamptz,
  justificativa                text,
  retirado_por                 uuid references public.profiles(id) on delete set null,
  retirado_em                  timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint chk_save_aprov_momento check (
    momento in ('abertura', 'job_aberto', 'legado_botao', 'legado_migracao', 'reenvio')
  ),
  constraint chk_save_aprov_valor check (valor >= 0),
  constraint chk_save_aprov_origens check (
    jsonb_typeof(origens) = 'array' and jsonb_typeof(origens_antes) = 'array'
  ),
  -- Gerar não tem origem nem substitui ninguém; consumir tem ao menos uma.
  constraint chk_save_aprov_forma check (
    (tipo = 'gera' and origens = '[]'::jsonb and origens_antes = '[]'::jsonb and substitui_id is null)
    or (tipo = 'consome' and jsonb_array_length(origens) > 0)
  ),
  constraint chk_save_aprov_justificativa check (
    situacao <> 'recusado' or char_length(btrim(coalesce(justificativa, ''))) >= 10
  )
);

comment on table public.saves_aprovacoes is
  'Pedidos de aprovação de save (decisão 099): um por linha que gera ou consome save. Nunca se apaga: é o histórico do pop-up de save. O cliente só lê; tudo nasce e muda pelas RPCs save_pedir, save_enviar_pendentes, decidir_pedido_save, cancelar_pedido_save e save_retirar. Várias FKs para profiles: não embutir profiles a partir daqui sem a dica !fk.';
comment on column public.saves_aprovacoes.momento is
  'De onde o pedido veio: abertura (save do orçamento, enfileirado quando o financeiro abre o job), job_aberto (errata de save, que o financeiro só vê na aprovação), legado_botao (job aberto antes do fluxo), legado_migracao (entrou aprovado nesta migration), reenvio (job devolvido e reenviado).';
comment on column public.saves_aprovacoes.valor is
  'Gera: o orçado da linha no pedido (o crédito). Consome: a soma das origens.';
comment on column public.saves_aprovacoes.origens is
  'Consumo: [{job_origem_id, valor}] pedido, uma entrada por job de origem. Gera: [].';
comment on column public.saves_aprovacoes.origens_antes is
  'Consumo da linha logo antes do pedido ([{job_origem_id, valor}]). A recusa e o cancelamento devolvem a linha a ele. Na edição de um consumo aprovado é o consumo aprovado. Gera: [] (antes do pedido a linha não era save).';
comment on column public.saves_aprovacoes.valor_job_antes is
  'Números do job antes → depois do pedido, calculados pelo TypeScript (a matriz de tipos de custo só existe lá). Só exibição: o pop-up de aprovação mostra estes.';
comment on column public.saves_aprovacoes.substitui_id is
  'Edição de um consumo aprovado: o pedido aprovado desta mesma linha que a edição substitui se for aprovada.';
comment on column public.saves_aprovacoes.errata_id is
  'Errata de save que o pedido gerou (momento job_aberto). É por ela que a fila separa a revisão causada só por save.';

create unique index uq_save_aprov_aguardando
  on public.saves_aprovacoes (job_item_orcado_id)
  where situacao = 'aguardando' and job_item_orcado_id is not null;
create unique index uq_save_aprov_aprovado
  on public.saves_aprovacoes (job_item_orcado_id)
  where situacao = 'aprovado' and job_item_orcado_id is not null;
create unique index uq_save_aprov_recusado
  on public.saves_aprovacoes (job_item_orcado_id)
  where situacao = 'recusado' and job_item_orcado_id is not null;
-- A faixa Saves da fila.
create index idx_save_aprov_fila
  on public.saves_aprovacoes (tenant_id, enviado_em)
  where situacao = 'aguardando';
create index idx_save_aprov_job on public.saves_aprovacoes (job_id);
create index idx_save_aprov_item on public.saves_aprovacoes (job_item_orcado_id);
create index idx_save_aprov_errata on public.saves_aprovacoes (errata_id) where errata_id is not null;
create index idx_save_aprov_substitui on public.saves_aprovacoes (substitui_id) where substitui_id is not null;

create trigger trg_saves_aprovacoes_updated_at
  before update on public.saves_aprovacoes
  for each row execute function public.set_updated_at();

alter table public.saves_aprovacoes enable row level security;

-- Mesmo recorte de saves_consumos, mais a visibilidade do job: quem não
-- enxerga o job (escopo de empresa/regional) não vê o pedido na fila. Dentro
-- da policy o EXISTS em jobs roda com a RLS de quem consulta.
create policy saves_aprovacoes_select on public.saves_aprovacoes
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and exists (select 1 from public.jobs j where j.id = saves_aprovacoes.job_id)
  );

-- Só leitura para o cliente. Sem policy de INSERT/UPDATE/DELETE: as RPCs
-- são SECURITY DEFINER.
revoke all on public.saves_aprovacoes from anon, authenticated;
grant select on public.saves_aprovacoes to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Peças internas
-- -----------------------------------------------------------------------------

-- As RPCs abaixo ligam esta chave, local à transação, antes de mexer na linha.
-- É por ela que os triggers distinguem a RPC da escrita direta pela API. O
-- cliente não tem como ligá-la: set_config não é exposto pelo PostgREST.
create or replace function public.save_fluxo_ativo()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(current_setting('app.save_fluxo', true), '') = 'on';
$$;

revoke all on function public.save_fluxo_ativo() from public, anon;
grant execute on function public.save_fluxo_ativo() to authenticated;

-- As travas que recusam a escrita DIRETA na linha de job aberto (marca de
-- save, consumo, errata e remoção de linha com save) quebrariam o código que
-- está no ar até o deploy desta feature: o fluxo antigo grava a errata antes
-- da linha, e a recusa deixaria errata fantasma. Por isso elas nascem
-- desligadas e ligam na migration 20260922140003, aplicada junto do deploy.
-- As demais (saldo, PP, BV, retirada com saldo usado) valem desde já.
create or replace function public.save_aprovacao_em_vigor()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select false;
$$;

revoke all on function public.save_aprovacao_em_vigor() from public, anon;
grant execute on function public.save_aprovacao_em_vigor() to authenticated;

-- A regra da policy jobs_select, para funções SECURITY DEFINER (onde a RLS
-- não vale, porque o dono tem BYPASSRLS).
create or replace function public.save_job_visivel(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.jobs j
     where j.id = p_job_id
       and j.tenant_id in (select public.current_tenant_ids())
       and public.can_access_empresa_regional((select auth.uid()), j.empresa_id, j.regional_id)
       and case public.session_role()
             when 'freelancer'::public.app_role then public.is_freelancer_do_projeto(j.projeto_id)
             else true
           end
  );
$$;

revoke all on function public.save_job_visivel(uuid) from public, anon, authenticated;

-- Guarda das transições. O cliente não tem UPDATE; isto protege contra erro
-- das próprias RPCs e carimba quem decidiu ou retirou.
create or replace function public.saves_aprovacoes_guarda()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- O conteúdo do pedido não muda. A troca para nulo de uma FK é o ON DELETE
  -- SET NULL (linha, errata ou perfil removidos) e passa.
  if new.tenant_id <> old.tenant_id
     or new.job_id <> old.job_id
     or new.tipo <> old.tipo
     or new.momento <> old.momento
     or new.valor <> old.valor
     or new.origens <> old.origens
     or new.origens_antes <> old.origens_antes
     or new.item_descricao <> old.item_descricao
     or new.grupo_nome is distinct from old.grupo_nome
     or new.valor_job_antes is distinct from old.valor_job_antes
     or new.valor_job_depois is distinct from old.valor_job_depois
     or new.faturamento_previsto_antes is distinct from old.faturamento_previsto_antes
     or new.faturamento_previsto_depois is distinct from old.faturamento_previsto_depois
     or new.enviado_em <> old.enviado_em
     or (new.job_item_orcado_id is distinct from old.job_item_orcado_id and new.job_item_orcado_id is not null)
     or (new.substitui_id is distinct from old.substitui_id and new.substitui_id is not null)
     or (new.errata_id is distinct from old.errata_id and new.errata_id is not null)
     or (new.enviado_por is distinct from old.enviado_por and new.enviado_por is not null) then
    raise exception 'O pedido de save não se edita: retire e faça outro.';
  end if;

  if new.situacao is distinct from old.situacao then
    if old.situacao in ('retirado', 'substituido') then
      raise exception 'Este pedido de save já foi encerrado e não muda mais de situação.';
    end if;
    if new.situacao = 'aguardando' then
      raise exception 'Um pedido de save não volta a aguardar: faça um pedido novo.';
    end if;
    if old.situacao = 'aprovado' and new.situacao not in ('retirado', 'substituido') then
      raise exception 'Save aprovado só pode ser retirado ou substituído por uma edição aprovada.';
    end if;
    if old.situacao = 'recusado' and new.situacao <> 'retirado' then
      raise exception 'Save recusado só pode ser retirado.';
    end if;
    if new.situacao in ('aprovado', 'recusado', 'substituido')
       and not (public.is_tenant_admin(new.tenant_id) or public.is_tenant_financeiro(new.tenant_id)) then
      raise exception 'Só o administrador ou o financeiro aprova ou recusa save.';
    end if;

    if new.situacao in ('aprovado', 'recusado') then
      new.decidido_por := (select auth.uid());
      new.decidido_em := now();
      new.retirado_por := old.retirado_por;
      new.retirado_em := old.retirado_em;
      if new.situacao = 'aprovado' then
        new.justificativa := null;
      end if;
    else
      new.retirado_por := (select auth.uid());
      new.retirado_em := now();
      new.decidido_por := old.decidido_por;
      new.decidido_em := old.decidido_em;
      new.justificativa := old.justificativa;
    end if;
  elsif new.decidido_em is distinct from old.decidido_em
     or new.retirado_em is distinct from old.retirado_em
     or new.justificativa is distinct from old.justificativa
     or (new.decidido_por is distinct from old.decidido_por and new.decidido_por is not null)
     or (new.retirado_por is distinct from old.retirado_por and new.retirado_por is not null) then
    raise exception 'O histórico do pedido de save não se edita.';
  end if;

  return new;
end;
$$;

create trigger trg_saves_aprovacoes_guarda
  before update on public.saves_aprovacoes
  for each row execute function public.saves_aprovacoes_guarda();

-- -----------------------------------------------------------------------------
-- 3. Quem marcou e o planejado que o save zerou
-- -----------------------------------------------------------------------------

alter table public.versoes_orcamento_itens
  add column save_marcado_por uuid,
  add column save_marcado_em timestamptz,
  add column planejado_antes_save jsonb;

alter table public.jobs_itens_orcado
  add column save_marcado_por uuid,
  add column save_marcado_em timestamptz,
  add column planejado_antes_save jsonb;

comment on column public.versoes_orcamento_itens.save_marcado_por is
  'Quem marcou a linha como save (sem FK de propósito: evita embed ambíguo com profiles). Preenchido por trigger.';
comment on column public.versoes_orcamento_itens.planejado_antes_save is
  'Planejado da linha antes de ser marcada como save: {valor_unitario, quantidade, dias_meses}. Volta quando o save sai; a cópia do job herda. Rotas que copiam linha em save (nova versão, importação) devem levar esta coluna.';
comment on column public.jobs_itens_orcado.save_marcado_por is
  'Quem marcou a linha como save (sem FK de propósito: evita embed ambíguo com profiles). Preenchido por trigger; a cópia herda da versão.';
comment on column public.jobs_itens_orcado.planejado_antes_save is
  'Planejado da linha antes de ser marcada como save: {valor_unitario, quantidade, dias_meses}. Volta quando o save sai da linha (recusa, cancelamento ou retirada).';

-- Roda DEPOIS de trg_item_nasce_em_save (que liga o save por padrão) e ANTES
-- de trg_planejado_espelha_orcado* (que zera o planejado): a ordem dos
-- triggers é a alfabética. Por isso o nome começa com "trg_marca_".
create or replace function public.save_marca_autor_e_planejado()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_antes jsonb;
  v_por   uuid;
  v_em    timestamptz;
begin
  if tg_op = 'INSERT' then
    if not new.em_save then
      new.save_marcado_por := null;
      new.save_marcado_em := null;
      new.planejado_antes_save := null;
      return new;
    end if;

    -- A cópia do job herda da linha da versão.
    if tg_table_name = 'jobs_itens_orcado' and new.item_versao_id is not null then
      select i.planejado_antes_save, i.save_marcado_por, i.save_marcado_em
        into v_antes, v_por, v_em
        from public.versoes_orcamento_itens i
       where i.id = new.item_versao_id;
      new.planejado_antes_save := coalesce(new.planejado_antes_save, v_antes);
      new.save_marcado_por := coalesce(new.save_marcado_por, v_por);
      new.save_marcado_em := coalesce(new.save_marcado_em, v_em);
    end if;

    -- Linha que já nasce em save com planejado digitado (importação, save
    -- por padrão): guarda antes de o espelho zerar.
    if new.planejado_antes_save is null
       and (coalesce(new.valor_unitario_planejado, 0) <> 0
            or coalesce(new.quantidade_planejada, 0) <> 0
            or coalesce(new.dias_meses_planejado, 0) <> 0) then
      new.planejado_antes_save := jsonb_build_object(
        'valor_unitario', new.valor_unitario_planejado,
        'quantidade', new.quantidade_planejada,
        'dias_meses', new.dias_meses_planejado
      );
    end if;

    new.save_marcado_por := coalesce(new.save_marcado_por, (select auth.uid()));
    new.save_marcado_em := coalesce(new.save_marcado_em, now());
    return new;
  end if;

  if new.em_save and not old.em_save then
    new.save_marcado_por := coalesce((select auth.uid()), new.save_marcado_por);
    new.save_marcado_em := now();
    new.planejado_antes_save := jsonb_build_object(
      'valor_unitario', old.valor_unitario_planejado,
      'quantidade', old.quantidade_planejada,
      'dias_meses', old.dias_meses_planejado
    );
  elsif old.em_save and not new.em_save then
    -- Devolve o planejado guardado, se quem desmarcou não trouxe outro.
    if old.planejado_antes_save is not null
       and coalesce(new.valor_unitario_planejado, 0) = 0
       and coalesce(new.quantidade_planejada, 0) = 0
       and coalesce(new.dias_meses_planejado, 0) = 0 then
      new.valor_unitario_planejado := coalesce((old.planejado_antes_save->>'valor_unitario')::numeric, 0);
      new.quantidade_planejada := coalesce((old.planejado_antes_save->>'quantidade')::numeric, 0);
      new.dias_meses_planejado := coalesce((old.planejado_antes_save->>'dias_meses')::numeric, 0);
    end if;
    new.save_marcado_por := null;
    new.save_marcado_em := null;
    new.planejado_antes_save := null;
  else
    -- A marca não mudou: o registro de quem marcou não se edita por fora.
    new.save_marcado_por := old.save_marcado_por;
    new.save_marcado_em := old.save_marcado_em;
    new.planejado_antes_save := old.planejado_antes_save;
  end if;
  return new;
end;
$$;

create trigger trg_marca_save_autor_e_planejado
  before insert or update of em_save, save_marcado_por, save_marcado_em, planejado_antes_save
  on public.versoes_orcamento_itens
  for each row execute function public.save_marca_autor_e_planejado();

create trigger trg_marca_save_autor_e_planejado
  before insert or update of em_save, save_marcado_por, save_marcado_em, planejado_antes_save
  on public.jobs_itens_orcado
  for each row execute function public.save_marca_autor_e_planejado();

-- -----------------------------------------------------------------------------
-- 4. Saldo: só save aprovado
-- -----------------------------------------------------------------------------

-- Crédito gerado e APROVADO de um job: o menor entre o orçado atual da linha e
-- o valor que o financeiro aprovou (a errata da linha com save é travada, mas
-- o saldo fica preso ao que foi aprovado de qualquer jeito).
create or replace function public.save_gerado_aprovado(p_job_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(least(o.total_orcado, a.valor)), 0)::numeric(14,2)
    from public.saves_aprovacoes a
    join public.jobs_itens_orcado o
      on o.id = a.job_item_orcado_id
     and o.job_id = a.job_id
   where a.job_id = p_job_id
     and a.tipo = 'gera'
     and a.situacao = 'aprovado'
     and o.em_save;
$$;

revoke all on function public.save_gerado_aprovado(uuid) from public, anon;
grant execute on function public.save_gerado_aprovado(uuid) to authenticated;

-- Uso do saldo de UMA origem, por linha consumidora. `consumido` = consumo
-- aprovado; `usado` = maior entre o aprovado, o pedido aguardando e o consumo
-- gravado que segura saldo (linha de job não cancelado, ou versão aprovada).
-- Fora da RLS de propósito: é a conta do trigger. Interna.
create or replace function public.save_uso_linhas(p_job_origem_id uuid)
returns table (job_item_orcado_id uuid, item_versao_id uuid, consumido numeric, usado numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  with gravado as (
    select c.job_item_orcado_id, c.item_versao_id, sum(c.valor) as valor
      from public.saves_consumos c
      left join public.jobs_itens_orcado o on o.id = c.job_item_orcado_id
      left join public.jobs j on j.id = o.job_id
     where c.job_origem_id = p_job_origem_id
       and (
         (c.job_item_orcado_id is not null and j.status <> 'cancelado')
         or (c.job_item_orcado_id is null
             and c.substituido_em is null
             and exists (
               select 1
                 from public.versoes_orcamento_itens i
                 join public.versoes_orcamento v on v.id = i.versao_orcamento_id
                where i.id = c.item_versao_id
                  and v.status = 'aprovada'))
       )
     group by c.job_item_orcado_id, c.item_versao_id
  ), pedido as (
    select a.job_item_orcado_id,
           sum((e->>'valor')::numeric) filter (where a.situacao = 'aprovado') as aprovado,
           sum((e->>'valor')::numeric) filter (where a.situacao = 'aguardando') as aguardando
      from public.saves_aprovacoes a
      join public.jobs j on j.id = a.job_id
      cross join lateral jsonb_array_elements(a.origens) e
     where a.tipo = 'consome'
       and a.situacao in ('aprovado', 'aguardando')
       and a.job_item_orcado_id is not null
       and j.status <> 'cancelado'
       and (e->>'job_origem_id')::uuid = p_job_origem_id
     group by a.job_item_orcado_id
  )
  select coalesce(g.job_item_orcado_id, p.job_item_orcado_id),
         g.item_versao_id,
         (coalesce(p.aprovado, 0))::numeric(14,2),
         (greatest(coalesce(p.aprovado, 0), coalesce(p.aguardando, 0), coalesce(g.valor, 0)))::numeric(14,2)
    from gravado g
    full join pedido p on p.job_item_orcado_id = g.job_item_orcado_id;
$$;

revoke all on function public.save_uso_linhas(uuid) from public, anon, authenticated;

-- A mesma conta, somada, para a tela: só de job do tenant de quem consulta.
create or replace function public.save_uso_do_job(p_job_id uuid)
returns table (consumido numeric, usado numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(u.consumido), 0)::numeric(14,2),
         coalesce(sum(u.usado), 0)::numeric(14,2)
    from public.save_uso_linhas(p_job_id) u
   where exists (
     select 1 from public.jobs j
      where j.id = p_job_id
        and j.tenant_id in (select public.current_tenant_ids()));
$$;

revoke all on function public.save_uso_do_job(uuid) from public, anon;
grant execute on function public.save_uso_do_job(uuid) to authenticated;

-- Mesmas colunas, na mesma ordem (create or replace não reordena), mais
-- `reservado_aprovacao` no fim. `reservado` continua sendo o rascunho, que só
-- avisa.
create or replace view public.vw_saves_por_job
with (security_invoker = on) as
 SELECT j.id AS job_id,
    j.tenant_id,
    j.codigo AS job_codigo,
    j.nome AS job_nome,
    j.status AS job_status,
    p.cliente_id,
    (COALESCE(g.gerado, (0)::numeric))::numeric(14,2) AS saldo_gerado,
    (COALESCE(u.consumido, (0)::numeric))::numeric(14,2) AS consumido,
    (COALESCE(r.reservado, (0)::numeric))::numeric(14,2) AS reservado,
    ((COALESCE(g.gerado, (0)::numeric) - COALESCE(u.usado, (0)::numeric)))::numeric(14,2) AS disponivel,
    COALESCE(g.linhas, (0)::bigint) AS linhas_em_save,
    v.percentual_honorarios,
    v.percentual_imposto,
    ((COALESCE(u.usado, (0)::numeric) - COALESCE(u.consumido, (0)::numeric)))::numeric(14,2) AS reservado_aprovacao
   FROM jobs j
     JOIN projetos p ON p.id = j.projeto_id
     LEFT JOIN versoes_orcamento v ON v.id = j.versao_orcamento_aprovada_id
     LEFT JOIN LATERAL ( SELECT sum(LEAST(o.total_orcado, a.valor)) AS gerado,
            count(*) AS linhas
           FROM saves_aprovacoes a
             JOIN jobs_itens_orcado o ON o.id = a.job_item_orcado_id AND o.job_id = a.job_id
          WHERE a.job_id = j.id
            AND a.tipo = 'gera'::save_aprovacao_tipo
            AND a.situacao = 'aprovado'::save_aprovacao_situacao
            AND o.em_save) g ON true
     LEFT JOIN LATERAL public.save_uso_do_job(j.id) u(consumido, usado) ON true
     LEFT JOIN LATERAL ( SELECT sum(c.valor) AS reservado
           FROM vw_saves_consumos_firmes c
          WHERE c.job_origem_id = j.id AND NOT c.firme) r ON true
  WHERE COALESCE(g.gerado, (0)::numeric) > (0)::numeric
    AND (j.status <> ALL (ARRAY['rejeitado_financeiro'::job_status, 'cancelado'::job_status]));

comment on view public.vw_saves_por_job is
  'Saldo de save por job, para o seletor de consumo (decisão 099). Só conta save APROVADO pelo financeiro. disponivel = aprovado − usado (consumo aprovado, pedido aguardando e consumo gravado que segura saldo). reservado = rascunho (só avisa); reservado_aprovacao = a parte do usado que ainda aguarda decisão.';

-- O detalhe "saldo formado por" acompanha o saldo: só linhas aprovadas.
create or replace view public.vw_saves_linhas
with (security_invoker = on) as
 SELECT o.job_id,
    o.tenant_id,
    o.id AS job_item_orcado_id,
    o.item_versao_id,
    o.item AS descricao,
    o.tipo_custo,
    (LEAST(o.total_orcado, a.valor))::numeric(14,2) AS valor
   FROM jobs_itens_orcado o
     JOIN saves_aprovacoes a
       ON a.job_item_orcado_id = o.id
      AND a.job_id = o.job_id
      AND a.tipo = 'gera'::save_aprovacao_tipo
      AND a.situacao = 'aprovado'::save_aprovacao_situacao
  WHERE o.em_save;

-- -----------------------------------------------------------------------------
-- 5. Travas
-- -----------------------------------------------------------------------------

-- 5a. Consumo: a partir da definição viva, com o saldo aprovado, a trava do
-- próprio saldo nos dois lados, o lock da origem e as mensagens com acento.
create or replace function public.save_consumo_valida()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_total_linha        numeric(14,2);
  v_em_save            boolean;
  v_tenant_linha       uuid;
  v_job_da_linha       uuid;
  v_orcamento_versao   uuid;
  v_versao_aprovada    boolean := false;
  v_ja_consumido       numeric(14,2);
  v_codigo             text;
  v_gerado             numeric(14,2);
  v_usado_outros       numeric(14,2);
  v_da_linha           numeric(14,2);
  v_old_job            uuid;
  v_old_versao         uuid;
begin
  if tg_op = 'UPDATE' then
    v_old_job := old.job_item_orcado_id;
    v_old_versao := old.item_versao_id;
  end if;

  if new.item_versao_id is not null then
    select i.total_orcado, i.em_save, i.tenant_id, v.orcamento_id, (v.status = 'aprovada')
      into v_total_linha, v_em_save, v_tenant_linha, v_orcamento_versao, v_versao_aprovada
      from public.versoes_orcamento_itens i
      join public.versoes_orcamento v on v.id = i.versao_orcamento_id
     where i.id = new.item_versao_id;
  else
    select o.total_orcado, o.em_save, o.tenant_id, o.job_id
      into v_total_linha, v_em_save, v_tenant_linha, v_job_da_linha
      from public.jobs_itens_orcado o
     where o.id = new.job_item_orcado_id;
  end if;

  if v_total_linha is null then
    raise exception 'Linha consumidora não encontrada.';
  end if;
  if v_em_save then
    raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
  end if;
  if new.tenant_id <> v_tenant_linha then
    raise exception 'Tenant do consumo difere do tenant da linha.';
  end if;

  -- O próprio saldo, pelos dois lados: o job da linha, ou o job do orçamento
  -- da versão.
  if v_job_da_linha is not null and v_job_da_linha = new.job_origem_id then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;
  if v_orcamento_versao is not null and exists (
       select 1 from public.jobs j
        where j.id = new.job_origem_id and j.orcamento_id = v_orcamento_versao) then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;

  select coalesce(sum(c.valor), 0) into v_ja_consumido
    from public.saves_consumos c
   where c.id <> new.id
     and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
           and c.substituido_em is null)
       or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

  if v_ja_consumido + new.valor > v_total_linha + 0.005 then
    raise exception 'O consumo de save (R$ %) passa do orçado da linha (R$ %).',
      to_char(v_ja_consumido + new.valor, 'FM999G999G990D00'),
      to_char(v_total_linha, 'FM999G999G990D00');
  end if;

  select j.codigo into v_codigo from public.jobs j where j.id = new.job_origem_id;
  if v_codigo is null then
    raise exception 'Job de origem do save não encontrado.';
  end if;

  -- Saldo: só o que segura saldo (linha do job, ou versão aprovada). O
  -- rascunho reserva e avisa, não impede (decisão 028, nota de 26/08).
  if new.job_item_orcado_id is not null or v_versao_aprovada then
    -- Dois consumos do mesmo saldo ao mesmo tempo passariam os dois: a linha
    -- do job de origem serializa quem consome e quem retira o save.
    perform 1 from public.jobs where id = new.job_origem_id for no key update;

    v_gerado := public.save_gerado_aprovado(new.job_origem_id);

    -- Outras linhas. Na abertura o consumo MUDA de ponta (versão → cópia do
    -- job) por UPDATE: a ponta antiga ainda está na tabela e não é "outra".
    select coalesce(sum(u.usado), 0) into v_usado_outros
      from public.save_uso_linhas(new.job_origem_id) u
     where (u.job_item_orcado_id is null
            or (u.job_item_orcado_id is distinct from new.job_item_orcado_id
                and u.job_item_orcado_id is distinct from v_old_job))
       and (u.item_versao_id is null
            or (u.item_versao_id is distinct from new.item_versao_id
                and u.item_versao_id is distinct from v_old_versao));

    select coalesce(sum(c.valor), 0) + new.valor into v_da_linha
      from public.saves_consumos c
     where c.id <> new.id
       and c.job_origem_id = new.job_origem_id
       and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
             and c.substituido_em is null)
         or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

    if v_usado_outros + v_da_linha > v_gerado + 0.005 then
      raise exception 'O saldo de save aprovado do % é de R$ %, e outras linhas já usam R$ %: não cabe mais R$ %.',
        v_codigo,
        to_char(v_gerado, 'FM999G999G990D00'),
        to_char(v_usado_outros, 'FM999G999G990D00'),
        to_char(v_da_linha, 'FM999G999G990D00');
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- 5b. Em job aberto o consumo da linha só muda pelas RPCs de save (que criam
-- ou desfazem o pedido junto). Pré-abertura, job devolvido e o lado da versão
-- seguem como hoje.
create or replace function public.save_consumo_trava_job()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_linha  uuid;
  v_nova   uuid;
  v_velha  uuid;
  v_status public.job_status;
begin
  if public.save_aprovacao_em_vigor() and not public.save_fluxo_ativo() then
    if tg_op in ('INSERT', 'UPDATE') then
      v_nova := new.job_item_orcado_id;
    end if;
    if tg_op in ('UPDATE', 'DELETE') then
      v_velha := old.job_item_orcado_id;
    end if;
    foreach v_linha in array array_remove(array[v_nova, v_velha], null)
    loop
      select j.status into v_status
        from public.jobs_itens_orcado o
        join public.jobs j on j.id = o.job_id
       where o.id = v_linha;
      if v_status in ('aberto', 'em_producao', 'encerrado', 'finalizado') then
        raise exception 'O consumo de save de um job aberto muda pelo pop-up de save da linha, que envia o pedido para aprovação do financeiro.';
      end if;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- "trava" < "valida": roda antes da conta de saldo.
create trigger trg_save_consumo_trava_job
  before insert or update or delete on public.saves_consumos
  for each row execute function public.save_consumo_trava_job();

-- 5c. Linha do job.
create or replace function public.save_trava_linha_job()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job     uuid;
  v_status  public.job_status;
  v_travado boolean;
  v_usado   numeric(14,2);
begin
  if tg_op = 'DELETE' then
    v_job := old.job_id;
  else
    v_job := new.job_id;
  end if;
  select j.status into v_status from public.jobs j where j.id = v_job;
  -- Job sumido (exclusão em cascata) ou em pré-abertura/devolvido: livre.
  -- Até a feature entrar no ar, a escrita direta segue como era (ver
  -- save_aprovacao_em_vigor).
  v_travado := public.save_aprovacao_em_vigor()
               and coalesce(v_status in ('aberto', 'em_producao', 'encerrado', 'finalizado'), false);

  if tg_op = 'DELETE' then
    if v_travado and (
         old.em_save
         or coalesce(old.save_consumido, 0) > 0
         or exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = old.id)
         or exists (
              select 1 from public.saves_aprovacoes a
               where a.job_item_orcado_id = old.id
                 and a.situacao in ('aguardando', 'recusado'))) then
      raise exception 'Esta linha tem save, consumo de save ou pedido de save em aberto: retire o save pelo pop-up antes de remover a linha.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.em_save and v_travado and not public.save_fluxo_ativo() then
      raise exception 'Linha nova de job aberto não nasce como save: marque o save pelo pop-up, que envia o pedido para aprovação do financeiro.';
    end if;
    return new;
  end if;

  if new.em_save is distinct from old.em_save then
    if v_travado and not public.save_fluxo_ativo() then
      raise exception 'O save de um job aberto muda pelo pop-up de save da linha, que envia o pedido para aprovação do financeiro.';
    end if;

    if new.em_save then
      if coalesce(old.save_consumido, 0) > 0
         or exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = new.id)
         or exists (
              select 1 from public.saves_aprovacoes a
               where a.job_item_orcado_id = new.id
                 and a.tipo = 'consome'
                 and a.situacao in ('aguardando', 'aprovado')) then
        raise exception 'Esta linha é paga com saldo de save de outro job: retire o consumo antes de gerar save.';
      end if;
      if exists (
           select 1
             from public.jobs_itens_realizado r
             join public.pedidos_compra pc on pc.item_realizado_id = r.id
            where r.job_item_orcado_id = new.id
              and pc.status <> 'cancelada') then
        raise exception 'Esta linha tem Pedido de Produção: o save só pode ser gerado depois que a PP for cancelada.';
      end if;
      if exists (
           select 1 from public.itens_bv b
            where b.situacao <> 'cancelado'
              and (b.job_item_orcado_id = new.id
                   or (b.job_item_orcado_id is null
                       and new.item_versao_id is not null
                       and b.item_versao_id = new.item_versao_id))) then
        raise exception 'Esta linha tem BV: o save só pode ser gerado depois que o BV for cancelado.';
      end if;
    else
      if exists (
           select 1 from public.saves_aprovacoes a
            where a.job_item_orcado_id = old.id
              and a.tipo = 'gera'
              and a.situacao = 'aguardando') then
        raise exception 'Esta linha tem pedido de save aguardando aprovação: cancele o pedido antes de retirar o save.';
      end if;
      if exists (
           select 1 from public.saves_aprovacoes a
            where a.job_item_orcado_id = old.id
              and a.tipo = 'gera'
              and a.situacao = 'aprovado') then
        -- Serializa com quem está consumindo este saldo agora.
        perform 1 from public.jobs where id = old.job_id for no key update;
        select coalesce(sum(u.usado), 0) into v_usado
          from public.save_uso_linhas(old.job_id) u;
        if v_usado > 0.004 then
          raise exception 'O saldo de save deste job já começou a ser consumido: o save aprovado não pode mais ser retirado.';
        end if;
        update public.saves_aprovacoes
           set situacao = 'retirado'
         where job_item_orcado_id = old.id
           and tipo = 'gera'
           and situacao = 'aprovado';
      end if;
    end if;
  elsif v_travado
     and (new.valor_unitario_orcado is distinct from old.valor_unitario_orcado
          or new.quantidade_orcada is distinct from old.quantidade_orcada
          or new.dias_meses_orcado is distinct from old.dias_meses_orcado
          or new.tipo_custo is distinct from old.tipo_custo
          or new.valor_unitario_planejado is distinct from old.valor_unitario_planejado
          or new.quantidade_planejada is distinct from old.quantidade_planejada
          or new.dias_meses_planejado is distinct from old.dias_meses_planejado)
     and (old.em_save
          or coalesce(old.save_consumido, 0) > 0
          or exists (
               select 1 from public.saves_aprovacoes a
                where a.job_item_orcado_id = old.id
                  and a.situacao in ('aguardando', 'recusado'))) then
    -- Só quando a marca não muda: a devolução do planejado na retirada passa.
    raise exception 'Linha com save não entra em errata. Para mudar esta linha, retire o save antes, pelo pop-up da coluna Save.';
  end if;

  return new;
end;
$$;

-- "save_trava" > "planejado_espelha": roda depois do espelho e da marca.
create trigger trg_save_trava_linha_job
  before insert
  or update of em_save, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, tipo_custo,
               valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
  or delete
  on public.jobs_itens_orcado
  for each row execute function public.save_trava_linha_job();

-- 5d. PP não nasce (nem volta) em linha com save. A tela já escondia; agora o
-- banco recusa.
create or replace function public.pp_recusa_linha_com_save()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'cancelada' or new.item_realizado_id is null then
    return new;
  end if;
  -- Mudança de situação que não é reativação: não é com esta trava.
  if tg_op = 'UPDATE' then
    if new.item_realizado_id is not distinct from old.item_realizado_id
       and old.status <> 'cancelada' then
      return new;
    end if;
  end if;

  if exists (
       select 1
         from public.jobs_itens_realizado r
         join public.jobs_itens_orcado o on o.id = r.job_item_orcado_id
        where r.id = new.item_realizado_id
          and (o.em_save or exists (
                 select 1 from public.saves_aprovacoes a
                  where a.job_item_orcado_id = o.id
                    and a.tipo = 'gera'
                    and a.situacao in ('aguardando', 'recusado')))) then
    raise exception 'Linha com save não gera Pedido de Produção: o serviço não acontece neste job.';
  end if;
  return new;
end;
$$;

create trigger trg_pp_recusa_linha_com_save
  before insert or update of item_realizado_id, status on public.pedidos_compra
  for each row execute function public.pp_recusa_linha_com_save();

-- 5e. BV confere o save na cópia do job quando ela existe (a versão aprovada
-- fica congelada com em_save=true depois de um save do orçamento recusado), e
-- cópia de job cancelado não conta. A partir da definição viva, com acentos.
create or replace function public.bv_exige_item_com_bv()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tipo    public.tipo_custo;
  v_tenant  uuid;
  v_aceita  boolean;
  v_em_save boolean;
  v_copia   boolean;
begin
  if tg_op = 'UPDATE' then
    -- Cancelar nunca é barrado.
    if new.situacao = 'cancelado' then
      return new;
    end if;
    -- Só a situação mudou, e não é reativação: nada a conferir.
    if new.item_versao_id is not distinct from old.item_versao_id
       and new.job_item_orcado_id is not distinct from old.job_item_orcado_id
       and new.tenant_id = old.tenant_id
       and old.situacao <> 'cancelado' then
      return new;
    end if;
  end if;

  if new.item_versao_id is null and new.job_item_orcado_id is null then
    raise exception 'BV precisa apontar para um item: o da versão ou o da planilha do job.';
  end if;

  if new.item_versao_id is not null then
    select tipo_custo, tenant_id, em_save
      into v_tipo, v_tenant, v_em_save
      from public.versoes_orcamento_itens
     where id = new.item_versao_id;

    if v_tipo is null then
      raise exception 'Item da versão não encontrado.';
    end if;

    -- Com cópia viva no job, vale a cópia: é ela que a recusa e a retirada
    -- mudam.
    select exists (
      select 1 from public.jobs_itens_orcado o
        join public.jobs j on j.id = o.job_id and j.status <> 'cancelado'
       where o.item_versao_id = new.item_versao_id)
      into v_copia;
    if new.job_item_orcado_id is not null then
      select o.em_save into v_em_save from public.jobs_itens_orcado o where o.id = new.job_item_orcado_id;
    elsif v_copia then
      select bool_or(o.em_save) into v_em_save
        from public.jobs_itens_orcado o
        join public.jobs j on j.id = o.job_id and j.status <> 'cancelado'
       where o.item_versao_id = new.item_versao_id;
    end if;

    v_aceita := v_tipo in ('A', 'AR', 'D');

    if not v_aceita then
      select exists (
        select 1 from public.jobs_itens_orcado o
         where o.item_versao_id = new.item_versao_id
           and o.tipo_custo in ('A', 'AR', 'D')
      ) into v_aceita;
    end if;
  else
    select tipo_custo, tenant_id, em_save
      into v_tipo, v_tenant, v_em_save
      from public.jobs_itens_orcado
     where id = new.job_item_orcado_id;

    if v_tipo is null then
      raise exception 'Item da planilha do job não encontrado.';
    end if;

    v_aceita := v_tipo in ('A', 'AR', 'D');
  end if;

  -- Save aguardando ou recusado ainda não retirado continua travando a linha
  -- (decisão 099): o GP retira antes de voltar a usá-la.
  if not coalesce(v_em_save, false) then
    select exists (
      select 1
        from public.saves_aprovacoes a
        join public.jobs_itens_orcado o on o.id = a.job_item_orcado_id
        join public.jobs j on j.id = o.job_id and j.status <> 'cancelado'
       where a.tipo = 'gera'
         and a.situacao in ('aguardando', 'recusado')
         and (o.id = new.job_item_orcado_id
              or (new.item_versao_id is not null and o.item_versao_id = new.item_versao_id))
    ) into v_em_save;
  end if;

  if coalesce(v_em_save, false) then
    raise exception 'Linha em save não aceita BV: o serviço não acontece neste projeto, então não há fornecedor com quem negociar comissão.';
  end if;

  if not v_aceita then
    raise exception 'BV só pode ser lançado em item de custo tipo A, A - Repasse ou D.';
  end if;

  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end;
$$;

-- A situação entra na lista: reativar um BV cancelado numa linha que virou
-- save passava sem conferência.
drop trigger trg_itens_bv_tipo_com_bv on public.itens_bv;
create trigger trg_itens_bv_tipo_com_bv
  before insert or update of item_versao_id, job_item_orcado_id, tenant_id, situacao
  on public.itens_bv
  for each row execute function public.bv_exige_item_com_bv();

-- 5f. Aprovar a versão revalida o saldo dos consumos dela: a partir daqui eles
-- seguram saldo, e no rascunho só avisavam. O UPDATE sem mudança reexecuta
-- save_consumo_valida já com a versão aprovada.
create or replace function public.save_valida_versao_aprovada()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'aprovada' and old.status is distinct from 'aprovada' then
    update public.saves_consumos c
       set valor = c.valor
      from public.versoes_orcamento_itens i
     where i.id = c.item_versao_id
       and i.versao_orcamento_id = new.id
       and c.substituido_em is null;
  end if;
  return null;
end;
$$;

create trigger trg_versao_aprovada_valida_save
  after update of status on public.versoes_orcamento
  for each row execute function public.save_valida_versao_aprovada();

-- 5g. Job cancelado não deixa pedido pendurado na fila nem reserva saldo.
create or replace function public.save_job_cancelado_retira_pedidos()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    update public.saves_aprovacoes
       set situacao = 'retirado'
     where job_id = new.id
       and situacao = 'aguardando';
  end if;
  return null;
end;
$$;

create trigger trg_job_cancelado_retira_pedidos_save
  after update of status on public.jobs
  for each row execute function public.save_job_cancelado_retira_pedidos();

-- -----------------------------------------------------------------------------
-- 6. Peças das RPCs
-- -----------------------------------------------------------------------------

-- Números do financeiro (espelhos do job). Chegam calculados pelo TypeScript,
-- porque a matriz de tipos de custo só existe lá (mesmo padrão de
-- enviar_job_para_faturamento). Nulo = não mexe; parcial = erro.
create or replace function public.save_gravar_totais(p_job_id uuid, p_totais jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_totais is null then
    return;
  end if;
  if not (p_totais ? 'valor_total'
          and p_totais ? 'faturamento_previsto'
          and p_totais ? 'faturamento_save_previsto')
     or (p_totais->>'valor_total') is null
     or (p_totais->>'faturamento_previsto') is null
     or (p_totais->>'faturamento_save_previsto') is null then
    raise exception 'Totais do job incompletos na mudança de save.';
  end if;
  update public.jobs
     set valor_total = (p_totais->>'valor_total')::numeric,
         faturamento_previsto = (p_totais->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p_totais->>'faturamento_save_previsto')::numeric
   where id = p_job_id;
end;
$$;

revoke all on function public.save_gravar_totais(uuid, jsonb) from public, anon, authenticated;

-- Revisão da abertura: 'manter', 'fechar' (a mudança era a única pendência
-- desde a última abertura/revisão) ou 'abrir' (os números do financeiro
-- mudaram sem errata nova).
create or replace function public.save_revisao(p_job_id uuid, p_acao text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(p_acao, 'manter') = 'manter' then
    return;
  elsif p_acao = 'fechar' then
    update public.jobs
       set abertura_em_revisao = false,
           abertura_revisao_desde = null,
           abertura_revisao_errata_id = null
     where id = p_job_id;
  elsif p_acao = 'abrir' then
    update public.jobs
       set abertura_em_revisao = true,
           abertura_revisao_desde = case when abertura_em_revisao then abertura_revisao_desde else now() end
     where id = p_job_id
       and data_abertura_financeiro is not null;
  else
    raise exception 'Ação de revisão inválida.';
  end if;
end;
$$;

revoke all on function public.save_revisao(uuid, text) from public, anon, authenticated;

-- A errata de save: mesma forma da que registrarErrataDeSave gravava (título,
-- os dois números antes → depois e um item com a linha igual dos dois lados),
-- agora na mesma transação da mudança. Devolve o job ao mural de abertura se o
-- financeiro já abriu (decisão 030; "desde" é a primeira errata pendente).
create or replace function public.save_registrar_errata(p_linha_id uuid, p_errata jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  o       public.jobs_itens_orcado%rowtype;
  v_grupo text;
  v_id    uuid;
begin
  if p_errata is null
     or nullif(btrim(coalesce(p_errata->>'titulo', '')), '') is null
     or (p_errata->>'custo_orcado_antes') is null
     or (p_errata->>'custo_orcado_depois') is null
     or (p_errata->>'valor_job_antes') is null
     or (p_errata->>'valor_job_depois') is null then
    raise exception 'Errata de save incompleta.';
  end if;

  select * into o from public.jobs_itens_orcado where id = p_linha_id;
  select g.nome into v_grupo from public.versoes_orcamento_grupos g where g.id = o.grupo_id;

  insert into public.jobs_erratas (
    tenant_id, job_id, titulo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    created_by
  ) values (
    o.tenant_id, o.job_id, btrim(p_errata->>'titulo'),
    (p_errata->>'custo_orcado_antes')::numeric, (p_errata->>'custo_orcado_depois')::numeric,
    (p_errata->>'valor_job_antes')::numeric, (p_errata->>'valor_job_depois')::numeric,
    (p_errata->>'faturamento_previsto_antes')::numeric, (p_errata->>'faturamento_previsto_depois')::numeric,
    (select auth.uid())
  )
  returning id into v_id;

  insert into public.jobs_erratas_itens (
    tenant_id, errata_id, job_item_orcado_id, item_nome, grupo_nome, grupo_id,
    tipo_custo_de, tipo_custo_para,
    valor_unitario_de, valor_unitario_para,
    total_de, total_para,
    efeito_valor_job, efeito_faturamento_previsto
  ) values (
    o.tenant_id, v_id, o.id, o.item, coalesce(v_grupo, '—'), o.grupo_id,
    o.tipo_custo, o.tipo_custo,
    coalesce(o.valor_unitario_orcado, 0), coalesce(o.valor_unitario_orcado, 0),
    coalesce(o.total_orcado, 0), coalesce(o.total_orcado, 0),
    (p_errata->>'valor_job_depois')::numeric - (p_errata->>'valor_job_antes')::numeric,
    coalesce((p_errata->>'faturamento_previsto_depois')::numeric, 0)
      - coalesce((p_errata->>'faturamento_previsto_antes')::numeric, 0)
  );

  update public.jobs
     set abertura_em_revisao = true,
         abertura_revisao_desde = case when abertura_em_revisao then abertura_revisao_desde else now() end,
         abertura_revisao_errata_id = v_id
   where id = o.job_id
     and data_abertura_financeiro is not null;

  return v_id;
end;
$$;

revoke all on function public.save_registrar_errata(uuid, jsonb) from public, anon, authenticated;

-- Consumo atual da linha, como origens [{job_origem_id, valor}].
create or replace function public.save_origens_da_linha(p_linha_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('job_origem_id', s.job_origem_id, 'valor', s.valor)
                            order by s.job_origem_id), '[]'::jsonb)
    from (
      select c.job_origem_id, sum(c.valor)::numeric(14,2) as valor
        from public.saves_consumos c
       where c.job_item_orcado_id = p_linha_id
       group by c.job_origem_id
    ) s;
$$;

revoke all on function public.save_origens_da_linha(uuid) from public, anon, authenticated;

-- Desfaz o efeito de um pedido na linha: volta a marca de save e o consumo ao
-- que eram logo ANTES do pedido. O planejado volta pelo trigger de marca.
-- Quem chama já ligou app.save_fluxo.
create or replace function public.save_reverter_pedido(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.saves_aprovacoes%rowtype;
  e jsonb;
begin
  select * into a from public.saves_aprovacoes where id = p_id;
  if not found or a.job_item_orcado_id is null then
    return;
  end if;

  if a.tipo = 'gera' then
    update public.jobs_itens_orcado
       set em_save = false
     where id = a.job_item_orcado_id
       and em_save;
  else
    delete from public.saves_consumos where job_item_orcado_id = a.job_item_orcado_id;
    for e in select * from jsonb_array_elements(a.origens_antes) loop
      insert into public.saves_consumos (tenant_id, job_origem_id, job_item_orcado_id, valor, created_by)
      values (a.tenant_id, (e->>'job_origem_id')::uuid, a.job_item_orcado_id,
              (e->>'valor')::numeric, (select auth.uid()));
    end loop;
  end if;
end;
$$;

revoke all on function public.save_reverter_pedido(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPCs
-- -----------------------------------------------------------------------------

-- 7a. Errata de save num job aberto: muda a linha e cria o pedido
-- (momento 'job_aberto'), com a errata e a revisão da abertura. Os números do
-- financeiro NÃO mudam aqui: só na aprovação.
--   p_tipo 'gera': a linha vira save (p_origens ignorado).
--   p_tipo 'consome': a linha passa a consumir p_origens [{job_origem_id,
--     valor}]; consumo aprovado editado vira pedido que o substitui.
--   p_numeros: {valor_job_antes, valor_job_depois, faturamento_previsto_antes,
--     faturamento_previsto_depois}, para o pop-up de aprovação.
--   p_errata: {titulo, custo_orcado_antes, custo_orcado_depois,
--     valor_job_antes, valor_job_depois, faturamento_previsto_antes,
--     faturamento_previsto_depois}.
create or replace function public.save_pedir(
  p_job_item_orcado_id uuid,
  p_tipo public.save_aprovacao_tipo,
  p_origens jsonb,
  p_numeros jsonb,
  p_errata jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  o            public.jobs_itens_orcado%rowtype;
  v_status     public.job_status;
  v_grupo      text;
  v_origens    jsonb;
  v_antes      jsonb;
  v_valor      numeric(14,2);
  v_substitui  uuid;
  v_errata     uuid;
  v_id         uuid;
  e            jsonb;
begin
  select * into o from public.jobs_itens_orcado where id = p_job_item_orcado_id for update;
  if not found then
    raise exception 'Linha não encontrada.';
  end if;
  if not public.save_job_visivel(o.job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  select j.status into v_status from public.jobs j where j.id = o.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Só um job aberto recebe pedido de save.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id and a.situacao = 'aguardando') then
    raise exception 'Esta linha já tem pedido de save aguardando aprovação: cancele o pedido antes de mudar.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id and a.situacao = 'recusado') then
    raise exception 'O save desta linha foi recusado: retire-o pelo pop-up antes de fazer um pedido novo.';
  end if;

  select g.nome into v_grupo from public.versoes_orcamento_grupos g where g.id = o.grupo_id;

  perform set_config('app.save_fluxo', 'on', true);

  if p_tipo = 'gera' then
    if o.em_save then
      raise exception 'Esta linha já é save.';
    end if;
    update public.jobs_itens_orcado set em_save = true where id = o.id;
    v_origens := '[]'::jsonb;
    v_antes := '[]'::jsonb;
    v_valor := coalesce(o.total_orcado, 0);
  else
    if o.em_save then
      raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
    end if;
    if p_origens is null or jsonb_typeof(p_origens) <> 'array' then
      raise exception 'Informe de qual job sai o saldo consumido.';
    end if;
    -- Uma entrada por origem, só valores positivos.
    select coalesce(jsonb_agg(jsonb_build_object('job_origem_id', s.job_origem_id, 'valor', s.valor)
                              order by s.job_origem_id), '[]'::jsonb)
      into v_origens
      from (
        select (x->>'job_origem_id')::uuid as job_origem_id,
               sum((x->>'valor')::numeric)::numeric(14,2) as valor
          from jsonb_array_elements(p_origens) x
         where coalesce((x->>'valor')::numeric, 0) > 0
         group by (x->>'job_origem_id')::uuid
      ) s;
    if jsonb_array_length(v_origens) = 0 then
      raise exception 'Informe o valor consumido de ao menos um job. Para tirar o consumo da linha, use Retirar no pop-up.';
    end if;

    v_antes := public.save_origens_da_linha(o.id);
    if v_antes = v_origens then
      raise exception 'O consumo não mudou.';
    end if;
    select a.id into v_substitui
      from public.saves_aprovacoes a
     where a.job_item_orcado_id = o.id and a.tipo = 'consome' and a.situacao = 'aprovado';

    delete from public.saves_consumos where job_item_orcado_id = o.id;
    for e in select * from jsonb_array_elements(v_origens) loop
      insert into public.saves_consumos (tenant_id, job_origem_id, job_item_orcado_id, valor, created_by)
      values (o.tenant_id, (e->>'job_origem_id')::uuid, o.id, (e->>'valor')::numeric, (select auth.uid()));
    end loop;
    select coalesce(sum((x->>'valor')::numeric), 0) into v_valor from jsonb_array_elements(v_origens) x;
  end if;

  v_errata := public.save_registrar_errata(o.id, p_errata);

  insert into public.saves_aprovacoes (
    tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
    tipo, situacao, momento, valor, origens, origens_antes,
    valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois,
    substitui_id, errata_id, enviado_por
  ) values (
    o.tenant_id, o.job_id, o.id, o.item, v_grupo,
    p_tipo, 'aguardando', 'job_aberto', v_valor, v_origens, v_antes,
    (p_numeros->>'valor_job_antes')::numeric, (p_numeros->>'valor_job_depois')::numeric,
    (p_numeros->>'faturamento_previsto_antes')::numeric, (p_numeros->>'faturamento_previsto_depois')::numeric,
    v_substitui, v_errata, (select auth.uid())
  )
  returning id into v_id;

  perform set_config('app.save_fluxo', '', true);
  return v_id;
end;
$$;

revoke all on function public.save_pedir(uuid, public.save_aprovacao_tipo, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_pedir(uuid, public.save_aprovacao_tipo, jsonb, jsonb, jsonb) to authenticated;

-- 7b. Enfileira os saves e consumos do job que ainda não têm pedido: na
-- abertura ('abertura' ou 'reenvio', pelo financeiro, que já conferiu os
-- números ali) ou pelo botão do legado ('legado_botao', job aberto antes do
-- fluxo). A linha já está como ficou; o pedido só a registra. Devolve quantos
-- pedidos nasceram. p_numeros: {<id da linha>: {valor_job_antes, ...}}.
create or replace function public.save_enviar_pendentes(
  p_job_id uuid,
  p_momento text,
  p_numeros jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job   public.jobs%rowtype;
  r       record;
  n       jsonb;
  v_qtd   integer := 0;
begin
  if p_momento not in ('abertura', 'reenvio', 'legado_botao') then
    raise exception 'Momento de pedido de save inválido.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or not public.save_job_visivel(p_job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  if p_momento in ('abertura', 'reenvio')
     and not (public.is_tenant_admin(v_job.tenant_id) or public.is_tenant_financeiro(v_job.tenant_id)) then
    raise exception 'Só o administrador ou o financeiro abre o job.';
  end if;
  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'Só um job aberto recebe pedido de save.';
  end if;

  for r in
    select o.id, o.tenant_id, o.item, o.total_orcado, o.em_save, g.nome as grupo_nome,
           public.save_origens_da_linha(o.id) as origens
      from public.jobs_itens_orcado o
      left join public.versoes_orcamento_grupos g on g.id = o.grupo_id
     where o.job_id = p_job_id
       and not exists (
         select 1 from public.saves_aprovacoes a
          where a.job_item_orcado_id = o.id
            and a.situacao in ('aguardando', 'aprovado', 'recusado'))
       and (o.em_save or exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = o.id))
     order by o.id
  loop
    n := case when p_numeros is not null then p_numeros->(r.id::text) end;
    insert into public.saves_aprovacoes (
      tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
      tipo, situacao, momento, valor, origens, origens_antes,
      valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois,
      enviado_por
    ) values (
      r.tenant_id, p_job_id, r.id, r.item, r.grupo_nome,
      case when r.em_save then 'gera'::public.save_aprovacao_tipo else 'consome'::public.save_aprovacao_tipo end,
      'aguardando', p_momento,
      case when r.em_save then coalesce(r.total_orcado, 0)
           else (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(r.origens) x) end,
      case when r.em_save then '[]'::jsonb else r.origens end,
      '[]'::jsonb,
      (n->>'valor_job_antes')::numeric, (n->>'valor_job_depois')::numeric,
      (n->>'faturamento_previsto_antes')::numeric, (n->>'faturamento_previsto_depois')::numeric,
      (select auth.uid())
    );
    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

revoke all on function public.save_enviar_pendentes(uuid, text, jsonb) from public, anon;
grant execute on function public.save_enviar_pendentes(uuid, text, jsonb) to authenticated;

-- 7c. Aprovar ou recusar (administrador ou financeiro).
--   Aprovar confere que a linha continua como o pedido descreve. Pedido
--   'job_aberto' exige p_totais: é aqui que o financeiro passa a contar a
--   linha. Os demais já contavam desde a abertura (p_totais opcional).
--   Recusar desfaz a linha. Pedido que o financeiro já contava exige p_totais.
--   p_revisao: 'manter' | 'fechar' | 'abrir'.
create or replace function public.decidir_pedido_save(
  p_id uuid,
  p_decisao text,
  p_justificativa text,
  p_totais jsonb,
  p_revisao text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.saves_aprovacoes%rowtype;
begin
  select * into a from public.saves_aprovacoes where id = p_id for update;
  if not found then
    raise exception 'Pedido de save não encontrado.';
  end if;
  if not (public.is_tenant_admin(a.tenant_id) or public.is_tenant_financeiro(a.tenant_id)) then
    raise exception 'Só o administrador ou o financeiro aprova ou recusa save.';
  end if;
  if not public.save_job_visivel(a.job_id) then
    raise exception 'Sem acesso ao job deste pedido de save.';
  end if;
  if a.situacao <> 'aguardando' then
    raise exception 'Este pedido de save já foi decidido.';
  end if;
  if a.job_item_orcado_id is null then
    raise exception 'A linha deste pedido de save foi removida: ele não pode ser decidido.';
  end if;
  perform 1 from public.jobs_itens_orcado where id = a.job_item_orcado_id for update;

  perform set_config('app.save_fluxo', 'on', true);

  if p_decisao = 'aprovar' then
    if a.tipo = 'gera' and not exists (
         select 1 from public.jobs_itens_orcado o
          where o.id = a.job_item_orcado_id
            and o.em_save
            and abs(coalesce(o.total_orcado, 0) - a.valor) < 0.005) then
      raise exception 'A linha mudou depois do pedido de save: peça à produção para cancelar e enviar de novo.';
    end if;
    if a.tipo = 'consome' and public.save_origens_da_linha(a.job_item_orcado_id) <> (
         select coalesce(jsonb_agg(jsonb_build_object('job_origem_id', s.job_origem_id, 'valor', s.valor)
                                   order by s.job_origem_id), '[]'::jsonb)
           from (
             select (x->>'job_origem_id')::uuid as job_origem_id,
                    sum((x->>'valor')::numeric)::numeric(14,2) as valor
               from jsonb_array_elements(a.origens) x
              group by 1
           ) s) then
      raise exception 'O consumo da linha mudou depois do pedido: peça à produção para cancelar e enviar de novo.';
    end if;
    if a.momento = 'job_aberto' and p_totais is null then
      raise exception 'Totais do job ausentes na aprovação do save.';
    end if;

    if a.substitui_id is not null then
      update public.saves_aprovacoes
         set situacao = 'substituido'
       where id = a.substitui_id
         and situacao = 'aprovado'
         and tipo = 'consome'
         and job_item_orcado_id = a.job_item_orcado_id;
      if not found then
        raise exception 'O consumo aprovado que esta edição substitui não é desta linha.';
      end if;
    end if;
    update public.saves_aprovacoes set situacao = 'aprovado' where id = p_id;
  elsif p_decisao = 'recusar' then
    if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
      raise exception 'Escreva a justificativa da recusa com pelo menos 10 caracteres.';
    end if;
    if a.momento <> 'job_aberto' and p_totais is null then
      raise exception 'Totais do job ausentes na recusa do save.';
    end if;
    update public.saves_aprovacoes
       set situacao = 'recusado', justificativa = btrim(p_justificativa)
     where id = p_id;
    perform public.save_reverter_pedido(p_id);
  else
    raise exception 'Decisão inválida.';
  end if;

  perform public.save_gravar_totais(a.job_id, p_totais);
  perform public.save_revisao(a.job_id, p_revisao);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

revoke all on function public.decidir_pedido_save(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.decidir_pedido_save(uuid, text, text, jsonb, text) to authenticated;

-- 7d. Cancelar um pedido que ainda aguarda (a produção quer editar ou
-- desistir): volta a linha ao antes e tira da fila.
--   Pedido 'job_aberto' o financeiro ainda não contava: sem totais nem
--   errata; p_revisao 'fechar' se era a única pendência da revisão.
--   Os demais o financeiro já contava: cancelar é errata de save (p_errata e
--   p_totais obrigatórios).
create or replace function public.cancelar_pedido_save(
  p_id uuid,
  p_totais jsonb,
  p_errata jsonb,
  p_revisao text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.saves_aprovacoes%rowtype;
begin
  select * into a from public.saves_aprovacoes where id = p_id for update;
  if not found then
    raise exception 'Pedido de save não encontrado.';
  end if;
  if not public.save_job_visivel(a.job_id) then
    raise exception 'Sem acesso ao job deste pedido de save.';
  end if;
  if a.situacao <> 'aguardando' then
    raise exception 'Só um pedido que aguarda aprovação pode ser cancelado.';
  end if;
  if a.momento = 'job_aberto' and (p_totais is not null or p_errata is not null) then
    raise exception 'Este pedido ainda não contava para o financeiro: cancelar não muda os números do job.';
  end if;
  if a.momento <> 'job_aberto' and (p_totais is null or p_errata is null) then
    raise exception 'Este pedido já contava para o financeiro: cancelar é errata de save e precisa dos números do job.';
  end if;
  if a.job_item_orcado_id is not null then
    perform 1 from public.jobs_itens_orcado where id = a.job_item_orcado_id for update;
  end if;

  perform set_config('app.save_fluxo', 'on', true);
  update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
  perform public.save_reverter_pedido(p_id);
  if p_errata is not null and a.job_item_orcado_id is not null then
    perform public.save_registrar_errata(a.job_item_orcado_id, p_errata);
  end if;
  perform public.save_gravar_totais(a.job_id, p_totais);
  perform public.save_revisao(a.job_id, p_revisao);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

revoke all on function public.cancelar_pedido_save(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.cancelar_pedido_save(uuid, jsonb, jsonb, text) to authenticated;

-- 7e. Retirar.
--   Aprovado (gera ou consome): é errata de save — a linha volta, o pedido
--   vira 'retirado', a errata entra e os números do financeiro mudam na hora
--   (p_errata e p_totais obrigatórios). Save aprovado cujo saldo já começou a
--   ser consumido não sai (o trigger da linha recusa).
--   Recusado: só arquiva (a linha já voltou); sem errata nem totais.
--   As portas de data (envio para faturamento, mês enviado) ficam com a
--   action; aqui, só job aberto.
create or replace function public.save_retirar(
  p_id uuid,
  p_totais jsonb,
  p_errata jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a        public.saves_aprovacoes%rowtype;
  v_status public.job_status;
begin
  select * into a from public.saves_aprovacoes where id = p_id for update;
  if not found then
    raise exception 'Pedido de save não encontrado.';
  end if;
  if not public.save_job_visivel(a.job_id) then
    raise exception 'Sem acesso ao job deste pedido de save.';
  end if;
  select j.status into v_status from public.jobs j where j.id = a.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Job encerrado não muda o save: os números dele estão congelados.';
  end if;

  if a.situacao = 'recusado' then
    if p_totais is not null or p_errata is not null then
      raise exception 'Save recusado só se arquiva: os números do job já voltaram na recusa.';
    end if;
    update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
    return;
  end if;

  if a.situacao <> 'aprovado' then
    raise exception 'Pedido aguardando se cancela, não se retira.';
  end if;
  if a.job_item_orcado_id is null then
    raise exception 'A linha deste save foi removida.';
  end if;
  if p_totais is null or p_errata is null then
    raise exception 'Retirar save aprovado é errata de save e precisa dos números do job.';
  end if;
  perform 1 from public.jobs_itens_orcado where id = a.job_item_orcado_id for update;

  perform set_config('app.save_fluxo', 'on', true);
  if a.tipo = 'gera' then
    -- O trigger da linha confere o uso do saldo e passa o pedido a 'retirado'.
    update public.jobs_itens_orcado set em_save = false where id = a.job_item_orcado_id and em_save;
    if exists (select 1 from public.saves_aprovacoes where id = p_id and situacao = 'aprovado') then
      update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
    end if;
  else
    delete from public.saves_consumos where job_item_orcado_id = a.job_item_orcado_id;
    update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
  end if;
  perform public.save_registrar_errata(a.job_item_orcado_id, p_errata);
  perform public.save_gravar_totais(a.job_id, p_totais);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

revoke all on function public.save_retirar(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_retirar(uuid, jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Legado
-- -----------------------------------------------------------------------------

-- Save e consumo de job encerrado/finalizado ou já enviado ao faturamento:
-- aprovados (a regra antiga já os tratava como firmes). Job aberto sem envio
-- fica sem pedido ("não enviado") e ganha o botão "Enviar saves para
-- aprovação"; pré-abertura e devolvido entram na fila quando o job abrir.
insert into public.saves_aprovacoes (
  tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
  tipo, situacao, momento, valor, origens, origens_antes, decidido_em
)
select o.tenant_id, o.job_id, o.id, o.item, g.nome,
       'gera', 'aprovado', 'legado_migracao', coalesce(o.total_orcado, 0), '[]'::jsonb, '[]'::jsonb, now()
  from public.jobs_itens_orcado o
  join public.jobs j on j.id = o.job_id
  left join public.versoes_orcamento_grupos g on g.id = o.grupo_id
 where o.em_save
   and (j.status in ('encerrado', 'finalizado')
        or j.faturamento_enviado_em is not null
        or exists (select 1 from public.jobs_envio_faturamento e where e.job_id = j.id));

insert into public.saves_aprovacoes (
  tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
  tipo, situacao, momento, valor, origens, origens_antes, decidido_em
)
select o.tenant_id, o.job_id, o.id, o.item, g.nome,
       'consome', 'aprovado', 'legado_migracao',
       (select coalesce(sum(c.valor), 0) from public.saves_consumos c where c.job_item_orcado_id = o.id),
       public.save_origens_da_linha(o.id), '[]'::jsonb, now()
  from public.jobs_itens_orcado o
  join public.jobs j on j.id = o.job_id
  left join public.versoes_orcamento_grupos g on g.id = o.grupo_id
 where exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = o.id)
   and (j.status in ('encerrado', 'finalizado')
        or j.faturamento_enviado_em is not null
        or exists (select 1 from public.jobs_envio_faturamento e where e.job_id = j.id));
