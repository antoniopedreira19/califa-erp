-- Envio em lote (decisão 188): os três índices de FK que o `get_advisors`
-- de performance apontou logo depois da 500001 — cliente e autor do lote, e
-- o tenant das notas do lote. Aditivo.

create index if not exists idx_envios_lote_cliente_id
  on public.envios_faturamento_lote (cliente_id);
create index if not exists idx_envios_lote_enviado_por
  on public.envios_faturamento_lote (enviado_por);
create index if not exists idx_envios_lote_notas_tenant
  on public.envios_faturamento_lote_notas (tenant_id);
