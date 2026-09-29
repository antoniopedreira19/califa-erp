-- =====================================================================
-- Restaura o AMB-F012/26, apagado pela limpeza da 20260928500001 no meio
-- de uma abertura (decisão 119, 28/09/2026)
-- =====================================================================
--
-- A limpeza apagou todo projeto do financeiro sem job — 13, e não os 11
-- do levantamento: entre o levantamento e a aplicação, a Priscila criou
-- quatro projetos pelo "+" do código antigo, que ainda estava no ar. Dois
-- já tinham job e ficaram (AMB-F010 "NFL", AMB-F011 "Stella Artois IMC").
-- Dos dois apagados:
--
--   * AMB-F009/26 "NFL" (15:18) era repetição do AMB-F010/26 "NFL"
--     (15:21), que ficou com o job AMB-1006/26 — exatamente o defeito que
--     a decisão 119 corrige. Fica apagado.
--   * AMB-F012/26 "Michelob - IMC NE" (16:13) foi criado para o
--     AMB-1008/26, que ainda aguardava abertura às 16:22: a abertura
--     estava em curso. Com o código antigo, o projeto precisa existir
--     antes do clique em "Abrir job", e ela receberia "Projeto do
--     financeiro inválido.". Volta igual — mesmo id, código, nome,
--     cliente, autora e data —, e ganha o job quando a abertura terminar.
--
-- A linha é refeita a partir da própria auditoria (a da criação e a da
-- limpeza), sem id escrito aqui. Idempotente: não faz nada se o projeto
-- já voltou, ou se outro já tomou o código ou o nome.
-- =====================================================================

with apagado as (
  select (a.entidade_id)::uuid as id,
         a.tenant_id,
         a.metadata->>'codigo' as codigo,
         a.metadata->>'nome' as nome,
         (a.metadata->>'cliente_id')::uuid as cliente_id,
         (a.metadata->>'criado_em')::timestamptz as criado_em
    from public.audit_events a
   where a.acao = 'projeto_financeiro.apagado_sem_job'
     and a.metadata->>'decisao' = '119'
     and a.metadata->>'motivo' = 'limpeza'
     and a.metadata->>'codigo' = 'AMB-F012/26'
   order by a.created_at desc
   limit 1
),
criacao as (
  select c.actor_user_id
    from public.audit_events c, apagado ap
   where c.acao = 'projeto_financeiro.criado'
     and c.entidade_id = ap.id::text
   order by c.created_at
   limit 1
),
restaurado as (
  insert into public.projetos_financeiro
    (id, tenant_id, codigo, nome, cliente_id, ativo, created_by, created_at, updated_at)
  select ap.id, ap.tenant_id, ap.codigo, ap.nome, ap.cliente_id, true,
         (select actor_user_id from criacao), ap.criado_em, ap.criado_em
    from apagado ap
   where not exists (select 1 from public.projetos_financeiro pf where pf.id = ap.id)
     and not exists (
       select 1 from public.projetos_financeiro pf
        where pf.tenant_id = ap.tenant_id
          and (pf.codigo = ap.codigo
               or public.nome_de_projeto_normalizado(pf.nome) = public.nome_de_projeto_normalizado(ap.nome))
     )
  returning id, tenant_id, codigo, nome
)
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select r.tenant_id, null::uuid, 'projeto_financeiro.restaurado', 'projeto_financeiro', r.id::text,
       jsonb_build_object(
         'codigo', r.codigo,
         'nome', r.nome,
         'motivo', 'abertura em curso do AMB-1008/26 com o código antigo no ar',
         'decisao', '119'
       )
  from restaurado r;
