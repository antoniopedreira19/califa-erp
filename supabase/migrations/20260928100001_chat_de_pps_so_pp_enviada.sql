-- =====================================================================
-- 20260928100001 — A caixa de entrada do chat de PPs só conta PP que foi
-- ENVIADA ao financeiro (decisão 113).
--
-- `chat_pps_conversas` (20260908120002) partia de `status <> 'gerada'`,
-- lendo "fora de gerada" como "já enviada". Não é: a produção pode
-- cancelar uma PP que nunca enviou, e a cancelada sai de `gerada` sem ter
-- passado pelo financeiro. Em 28/09/2026 eram 4 (PP-00092, PP-00047,
-- PP-00046 e PP-00042), e a Contas a Pagar mostrava as 4 em "Canceladas".
-- A PP-00042 tinha até tido o envio desfeito de propósito (20260908180001).
--
-- A mesma PP é o caminho pelo qual um job NÃO ABERTO chegaria ao
-- financeiro: a produção gera PP antes da abertura (`jobAceitaGerarPP`),
-- não pode enviá-la (`jobAceitaEnvioDePP`), e para cancelar o envio do
-- job precisa cancelar todas. Pela regra da decisão 113, o financeiro só
-- vê job que ele abriu — e PP que foi enviada a ele.
--
-- O recorte passa a ser `enviada_financeiro_em is not null`, o carimbo que
-- a action de envio grava (20260902160002, com backfill das PPs antigas).
-- O `status <> 'gerada'` fica: a PP devolvida a `gerada` por migration
-- (20260908180001) teve o carimbo apagado junto, mas a trava dupla não
-- custa nada.
--
-- Não toca em dado nenhum: só o que a função devolve. Mesma assinatura e
-- mesmo retorno, então `create or replace` preserva o GRANT para
-- `authenticated` (sem nada para `anon`). O índice
-- `idx_pp_tenant_status_job` continua servindo o agrupamento.
-- =====================================================================

create or replace function public.chat_pps_conversas(p_tenant_id uuid)
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
      and pc.enviada_financeiro_em is not null
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
  'Uma linha por job que já mandou PP ao financeiro (enviada_financeiro_em preenchido — decisão 113): última mensagem do fio de PPs (se houver) e quantas o usuário da sessão não leu. Alimenta a caixa de entrada do chat em Contas a Pagar.';
