# Pendência — Hub central de notificações

> **Status**: Backlog. Registrado em 2026-10-03 após a limpeza do subsistema de notificações de férias (commits do dia).
>
> **Prioridade**: Média — não bloqueia nenhum módulo em produção, mas qualquer notificação nova (financeiro, jobs, orçamentos) depende dessa fundação pra evitar criar silos de novo.

## Por que removemos o que havia

O subsistema anterior (`colaboradores_ferias_notificacoes` + enum `ferias_notificacao_tipo` + funções `fn_criar_notificacao_ferias`/`fn_destinatarios_ferias`/`fn_rotina_diaria_ferias` + job pg_cron `ferias_rotina_diaria`) foi apagado inteiro em 2026-10-03 (migration `20261003000001_drop_ferias_notificacoes.sql`).

Motivos:

1. **Escopo misturado**. Mesma tabela servia pra notificações **operacionais do RH** (ex.: "Férias de Luciana precisam ser agendadas", disparada por fanout a todos admins/RHs) e **pessoais do colaborador** (ex.: "Sua férias foi aprovada"). O /perfil pessoal exibia o lixo operacional porque usava o mesmo card.
2. **Sem discriminador de módulo**. Nome amarrado a férias, FKs amarradas a férias. Pra adicionar notificações de financeiro, jobs, etc., ia virar um silo por módulo e um card de UI por silo.
3. **Fanout gerava ruído**. Cada evento criava 7-9 linhas (1 por admin/RH). Em semanas rolou dezenas de linhas duplicadas por evento de concessivo.
4. **Policy RLS permissiva demais**. `is_tenant_admin OR is_tenant_rh OR destinatario = uid()` permitia que admin visse tudo, sem separar pessoal/operacional.

A UI (`CardNotificacoesFerias`, `LinhaNotificacao`) foi removida das 6 homes, do /perfil e do /rh/ferias. A action `marcarNotificacaoLida` foi removida de `app/(app)/rh/ferias/actions.ts`. Tipo `FeriasNotificacaoTipo` e interface `ColaboradorFeriasNotificacao` foram removidos de `lib/types.ts`.

**Preservado** (continua existindo e sendo usado por rescisões): função `fn_calcular_meses_rescisao`.

## O que vamos construir no lugar

Hub central multi-módulo, com separação explícita de **escopo** (pessoal vs operacional) e **módulo** (ferias, financeiro, jobs, orcamentos, rh, sistema).

### Modelo proposto

```sql
create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  destinatario_user_id uuid not null references auth.users(id),

  -- Discriminadores
  modulo text not null check (modulo in ('ferias','financeiro','rh','jobs','orcamentos','sistema')),
  escopo text not null check (escopo in ('pessoal','operacional')),
  tipo text not null,                        -- 'ferias.aprovada', 'financeiro.titulo_vencendo'...

  -- Conteúdo
  titulo text not null,
  mensagem text not null,
  href text,                                 -- deeplink opcional
  tom text check (tom in ('info','sucesso','alerta','critico','neutro')),

  -- Contexto do módulo, polimórfico via jsonb (sem FK dura).
  -- Ex ferias: { colaborador_id, lancamento_id, periodo_id }
  -- Ex financeiro: { titulo_id, valor }
  payload jsonb not null default '{}',

  -- Agrupamento futuro ("5 novos títulos vencendo" em vez de 5 linhas)
  grupo_chave text,

  -- Estado
  lida_em timestamptz,
  criada_em timestamptz not null default now(),
  expira_em timestamptz                      -- notificações que viram irrelevantes
);

create index idx_notif_destinatario on notificacoes(destinatario_user_id, lida_em nulls first, criada_em desc);
create index idx_notif_tenant_modulo on notificacoes(tenant_id, modulo, criada_em desc);
create index idx_notif_tenant_escopo on notificacoes(tenant_id, escopo);
create index idx_notif_expira on notificacoes(expira_em) where expira_em is not null;
```

### Policies RLS

```sql
-- SELECT: destinatário vê a dele. Admin/RH vêem OPERACIONAIS do tenant.
-- Ninguém vê pessoais de outro colaborador.
create policy notif_select on notificacoes for select using (
  destinatario_user_id = (select auth.uid())
  or (
    escopo = 'operacional'
    and (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id))
  )
);

-- UPDATE: só o destinatário pode marcar como lida (não precisa delegar a admin).
create policy notif_update on notificacoes for update
  using (destinatario_user_id = (select auth.uid()))
  with check (destinatario_user_id = (select auth.uid()));

-- INSERT: só servidor (service role) via função security definer.
-- DELETE: só admin/rh do tenant.
```

### Função criadora genérica

```sql
create function fn_criar_notificacao(
  p_tenant_id uuid,
  p_modulo text,
  p_escopo text,
  p_tipo text,
  p_destinatarios uuid[],         -- array porque fanout operacional continua existindo
  p_titulo text,
  p_mensagem text,
  p_href text default null,
  p_tom text default 'info',
  p_payload jsonb default '{}',
  p_grupo_chave text default null,
  p_expira_em timestamptz default null
) returns setof notificacoes language plpgsql security definer as $$
...
$$;
```

## Regras de uso — quem recebe o quê

Esta é a parte que exige **mais discussão com o PO** antes de implementar, porque hoje o fanout está "automático e burro". A proposta inicial:

| Evento | Módulo | Escopo | Destinatários default |
|---|---|---|---|
| Férias aprovada | ferias | **pessoal** | só o colaborador |
| Férias reprovada | ferias | **pessoal** | só o colaborador |
| Férias em análise | ferias | **pessoal** | só o colaborador |
| Férias liberada (concessivo abriu) | ferias | **pessoal** | o colaborador (não os admins todos) |
| Férias liberada — resumo diário | ferias | **operacional** | 1 notificação resumo pros RHs/admins |
| Concessivo em alerta (60d do limite) | ferias | **operacional** | RH + líder direto do colaborador |
| Férias vencidas | ferias | **operacional** | RH + admin + líder |
| Lançamento retornando a `pendente` | ferias | **operacional** | RH |
| Emitir NF (PJ) | ferias | **pessoal** | só o colaborador |

**Princípios**:
- Pessoal = 1 linha por evento, destinatário = o colaborador afetado.
- Operacional = fanout limitado a quem precisa agir (RH, admin do tenant, líder direto quando faz sentido). **Evitar fanout cego a TODOS os admins.**
- Sem duplicação: cada evento gera no máximo 1 linha pessoal + N linhas operacionais com destinatários distintos.

## Componentes de UI

- `<SinoNotificacoes />` no header global com badge de contagem (não lidas do usuário atual).
- `<CentroNotificacoes modulo escopo />` reusável:
  - `/perfil` → `escopo="pessoal"` (só do próprio).
  - `/rh/ferias` → `modulo="ferias"` (todas de férias — pessoal + operacional).
  - `/financeiro` futuro → `modulo="financeiro"`.
- Linha de notificação polimórfica: usa `tipo` + `href` + `tom` pra renderizar o ícone e o link certo sem conhecer o módulo.
- Marcar como lida: PATCH único via server action, só o destinatário pode.
- Marcar várias como lidas: ação em lote.

## Checklist pra a task (quando for criada)

1. [ ] Migration criando `notificacoes` + índices + policies.
2. [ ] Função `fn_criar_notificacao` SECURITY DEFINER.
3. [ ] Função helper `fn_destinatarios_operacionais(tenant_id, escopo)` que retorna o conjunto apropriado.
4. [ ] Server actions genéricas: `marcarNotificacaoLida`, `marcarTodasLidas`, `deletarNotificacao`.
5. [ ] UI reusável: `<SinoNotificacoes>`, `<CentroNotificacoes>`, `<LinhaNotificacao>`.
6. [ ] Re-plumbing do módulo de férias (gatilhos nas 4 actions que antes chamavam `fn_criar_notificacao_ferias`: aprovar, reprovar, em_analise, lancamento_direto).
7. [ ] Job pg_cron diário recria lógica de concessivo em alerta + vencido, mas gerando **UMA** notificação operacional resumo + N pessoais individuais.
8. [ ] Spec de taxonomia de tipos (`ferias.*`, `financeiro.*`) para o enum/lista fechada ou documentada.
9. [ ] Documentar "catálogo de notificações" — quem recebe o quê, com justificativa.

## Dependências

Nenhuma técnica. Pode começar quando o PO priorizar. **Não começar antes de alinhar a tabela "quem recebe o quê"** com o PO (a tabela acima é proposta, não decidida).

## Riscos / coisas a cuidar

- **Fanout operacional vira ruído rápido** — manter grupo_chave + resumo diário, não notificar a cada evento.
- **Não é fonte-verdade de nada** — notificações são efêmeras. Deletar depois de X dias (cron de limpeza) é OK.
- **Expiração** — notificação de "concessivo em alerta" perde sentido quando o colaborador agenda. O fluxo de agendamento deve setar `expira_em = now()` nas notificações do mesmo colaborador/período.
- **i18n** — titulo/mensagem são portugues puro hoje. Se virmos internacional, modelo precisa de `payload` com dados brutos e UI traduz. Fora do escopo da V1.
