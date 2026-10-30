-- =====================================================================
-- Uma carga ativa por período e por tipo (decisão 211; 30/10/2026)
-- =====================================================================
--
-- A carga só DRE cobre o mesmo período da cauda (01/10 a 25/10), e o índice
-- que garante uma carga ativa por período não olhava o tipo: a conclusão
-- falhava depois de gravar as linhas. O índice passa a incluir o tipo; a
-- regra continua valendo dentro de cada tipo. Nenhuma linha muda.
-- =====================================================================

drop index public.uq_historico_cargas_ativa_periodo;
create unique index uq_historico_cargas_ativa_periodo
  on public.historico_cargas (tenant_id, tipo, periodo_de, periodo_ate)
  where situacao = 'ativa';
