-- =====================================================================
-- A caixa de entrada do chat de PPs parte das PPs, não das mensagens.
--
-- A primeira versão (`20260908120001`) devolvia só job COM mensagem. Mas
-- a decisão 058 fechou diferente: a lista mostra TODO job que já mandou
-- alguma PP ao financeiro, mesmo sem ninguém ter escrito — é assim que o
-- financeiro puxa a primeira conversa. Hoje: 12 dos 31 jobs.
--
-- Então a base vira `pedidos_compra` (status <> 'gerada' = já enviada ao
-- financeiro, mesmo recorte que a tela de Contas a Pagar usa) e a
-- mensagem entra por LEFT JOIN.
--
-- `ultima_pp_em` existe para a ordenação da lista: conversa com mensagem
-- vem primeiro, pela mensagem mais recente; conversa que só tem PP vem
-- depois, pela PP mais recente. PP não reordena a lista de quem já
-- conversa — porque PP não notifica (decisão 058).
-- =====================================================================

drop function if exists public.chat_pps_conversas(uuid);

create function public.chat_pps_conversas(p_tenant_id uuid)
returns table (
  job_id uuid,
  ultima_pp_em timestamptz,
  ultima_em timestamptz,
  ultimo_texto text,
  ultimo_autor text,
  ultima_area chat_area,
  nao_lidas integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with jobs_com_pp as (
    select
      pc.job_id,
      max(coalesce(pc.enviada_financeiro_em, pc.created_at)) as ultima_pp_em
    from pedidos_compra pc
    where pc.tenant_id = p_tenant_id
      and pc.status <> 'gerada'
    group by pc.job_id
  ),
  ultima as (
    select distinct on (m.job_id)
      m.job_id, m.created_at, m.texto, m.area, m.autor_id
    from jobs_mensagens m
    where m.tenant_id = p_tenant_id
      and m.escopo = 'pps'
    order by m.job_id, m.created_at desc
  )
  select
    g.job_id,
    g.ultima_pp_em,
    u.created_at as ultima_em,
    u.texto      as ultimo_texto,
    p.nome       as ultimo_autor,
    u.area       as ultima_area,
    coalesce((
      select count(*)::int
      from jobs_mensagens m2
      where m2.job_id = g.job_id
        and m2.tenant_id = p_tenant_id
        and m2.escopo = 'pps'
        and m2.autor_id <> (select auth.uid())
        and (l.lida_ate is null or m2.created_at > l.lida_ate)
    ), 0) as nao_lidas
  from jobs_com_pp g
  left join ultima u
    on u.job_id = g.job_id
  left join profiles p
    on p.id = u.autor_id
  left join jobs_chat_leituras l
    on l.job_id = g.job_id
   and l.profile_id = (select auth.uid())
   and l.escopo = 'pps';
$$;

comment on function public.chat_pps_conversas(uuid) is
  'Uma linha por job que já mandou PP ao financeiro: última mensagem do fio de PPs (se houver) e quantas o usuário da sessão não leu. Alimenta a caixa de entrada do chat em Contas a Pagar.';

revoke all on function public.chat_pps_conversas(uuid) from public;
revoke all on function public.chat_pps_conversas(uuid) from anon;
grant execute on function public.chat_pps_conversas(uuid) to authenticated;

-- O agrupamento por job entra por (tenant_id, status). Sem isso a função
-- varre `pedidos_compra` inteira a cada carga de Contas a Pagar.
create index if not exists idx_pp_tenant_status_job
  on public.pedidos_compra (tenant_id, status, job_id);
