-- Motivo: adiciona índices em 17 FKs sem índice no módulo RH e core (profiles,
-- tenant_members, contratacoes, colaboradores*). Advisor Supabase apontou
-- unindexed_foreign_keys afetando joins do Quadro, modal e drawer.
--
-- Impacto esperado: joins com profiles (nome do solicitante/aprovador/líder)
-- param de fazer seq scan, caem de O(N) pra O(log N).
--
-- Referências:
--   - tasks/active/009-performance-modulo-rh.md Onda 1.
--   - advisor Supabase: unindexed_foreign_keys (24 findings em RH, 17 cobertos aqui).

-- colaboradores
create index if not exists idx_colaboradores_created_by
  on public.colaboradores (created_by);
create index if not exists idx_colaboradores_lider_id
  on public.colaboradores (lider_id)
  where lider_id is not null;

-- colaboradores_alocacoes
create index if not exists idx_colaboradores_alocacoes_created_by
  on public.colaboradores_alocacoes (created_by);
create index if not exists idx_colaboradores_alocacoes_regional_empresa
  on public.colaboradores_alocacoes (regional_id, empresa_id);

-- colaboradores_ferias_lancamentos
create index if not exists idx_colaboradores_ferias_lancamentos_aprovado_por
  on public.colaboradores_ferias_lancamentos (aprovado_por)
  where aprovado_por is not null;
create index if not exists idx_colaboradores_ferias_lancamentos_solicitado_por
  on public.colaboradores_ferias_lancamentos (solicitado_por);
create index if not exists idx_colaboradores_ferias_lancamentos_conta_avulsa
  on public.colaboradores_ferias_lancamentos (conta_avulsa_id)
  where conta_avulsa_id is not null;

-- colaboradores_ferias_notificacoes
create index if not exists idx_colaboradores_ferias_notificacoes_lancamento
  on public.colaboradores_ferias_notificacoes (lancamento_id)
  where lancamento_id is not null;
create index if not exists idx_colaboradores_ferias_notificacoes_periodo
  on public.colaboradores_ferias_notificacoes (periodo_id)
  where periodo_id is not null;

-- colaboradores_salarios
create index if not exists idx_colaboradores_salarios_aprovado_por
  on public.colaboradores_salarios (aprovado_por)
  where aprovado_por is not null;
create index if not exists idx_colaboradores_salarios_created_by
  on public.colaboradores_salarios (created_by);

-- contratacoes
create index if not exists idx_contratacoes_created_by
  on public.contratacoes (created_by);
create index if not exists idx_contratacoes_empresa_id
  on public.contratacoes (empresa_id);
create index if not exists idx_contratacoes_lider_id
  on public.contratacoes (lider_id)
  where lider_id is not null;
create index if not exists idx_contratacoes_nivel_id
  on public.contratacoes (nivel_id)
  where nivel_id is not null;
create index if not exists idx_contratacoes_regional_id
  on public.contratacoes (regional_id);
create index if not exists idx_contratacoes_virou_colaborador_id
  on public.contratacoes (virou_colaborador_id)
  where virou_colaborador_id is not null;
create index if not exists idx_contratacoes_regional_empresa
  on public.contratacoes (regional_id, empresa_id);
