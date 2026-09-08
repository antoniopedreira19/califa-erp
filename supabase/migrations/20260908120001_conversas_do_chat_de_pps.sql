-- =====================================================================
-- Conversas do chat de PPs, para a caixa de entrada do financeiro.
--
-- A tela de Contas a Pagar passa a ter UM chat por job (decisão 058), e
-- não mais um job só como acontece dentro do Job. Para desenhar essa
-- lista o financeiro precisa, por job: a última mensagem do fio e quantas
-- mensagens ele ainda não leu.
--
-- Isso NÃO pode virar "puxa todas as mensagens do tenant e agrega no
-- Node": a lista carrega junto de Contas a Pagar, que já é a página mais
-- pesada do sistema (`docs/PERFORMANCE.md`). A agregação fica no Postgres
-- e o payload é uma linha por job COM mensagem — hoje 2 de 31 jobs.
--
-- `security invoker`: as policies de `jobs_mensagens`, `jobs_chat_leituras`
-- e `profiles` continuam valendo dentro da função. Ninguém enxerga fio de
-- outro tenant nem leitura de outra pessoa por aqui.
--
-- Cards automáticos de PP ("PP emitida", "PP paga"…) ficam de fora da
-- conta de não lidas de propósito: eles são derivados de `pedidos_compra`
-- na leitura, não existem como linha, e a decisão 058 diz que PP
-- registrada no fio não notifica — só mensagem de gente notifica.
-- =====================================================================

create or replace function public.chat_pps_conversas(p_tenant_id uuid)
returns table (
  job_id uuid,
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
  with ultima as (
    select distinct on (m.job_id)
      m.job_id, m.created_at, m.texto, m.area, m.autor_id
    from jobs_mensagens m
    where m.tenant_id = p_tenant_id
      and m.escopo = 'pps'
    order by m.job_id, m.created_at desc
  )
  select
    u.job_id,
    u.created_at as ultima_em,
    u.texto      as ultimo_texto,
    p.nome       as ultimo_autor,
    u.area       as ultima_area,
    (
      select count(*)::int
      from jobs_mensagens m2
      where m2.job_id = u.job_id
        and m2.tenant_id = p_tenant_id
        and m2.escopo = 'pps'
        and m2.autor_id <> (select auth.uid())
        and (l.lida_ate is null or m2.created_at > l.lida_ate)
    ) as nao_lidas
  from ultima u
  left join profiles p
    on p.id = u.autor_id
  left join jobs_chat_leituras l
    on l.job_id = u.job_id
   and l.profile_id = (select auth.uid())
   and l.escopo = 'pps';
$$;

comment on function public.chat_pps_conversas(uuid) is
  'Uma linha por job COM mensagem no fio de PPs: última mensagem + não lidas do usuário da sessão. Alimenta a caixa de entrada do chat em Contas a Pagar.';

revoke all on function public.chat_pps_conversas(uuid) from public;
revoke all on function public.chat_pps_conversas(uuid) from anon;
grant execute on function public.chat_pps_conversas(uuid) to authenticated;

-- O `distinct on (job_id) ... order by job_id, created_at desc` varre
-- o fio inteiro do tenant. `idx_jobs_msg_job_escopo` é (job_id, escopo,
-- created_at) e serve; este aqui é o recorte por tenant, que é como a
-- função entra.
create index if not exists idx_jobs_msg_tenant_escopo
  on public.jobs_mensagens (tenant_id, escopo, job_id, created_at desc);
