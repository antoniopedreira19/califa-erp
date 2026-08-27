-- =====================================================================
-- SAVE — `faturamento_itens` aceita a origem `save`
--
-- ⚠️ ÚNICO ITEM DESTRUTIVO DE TODO O DESENHO DO SAVE.
--
-- Substituição de CHECK. Autorizado pelo Tiago em 26/08/2026, com o
-- estado real conferido antes: `faturamento_itens` tem 2 linhas, e
-- nenhuma delas é tocada. O CHECK novo é estritamente MAIS permissivo —
-- aceita tudo que o antigo aceitava, mais a origem `save` —, então
-- nenhuma linha existente pode passar a violar.
--
-- As três cláusulas antigas foram copiadas da definição VIVA no banco
-- (`pg_get_constraintdef`), não do arquivo da 20260817000005: quando as
-- duas divergem, quem manda é o banco.
--
-- A cláusula nova exige `envio_parcela_id`: o saldo em save sai na MESMA
-- parcela do envio que a parte própria do job — é a mesma nota, do mesmo
-- job, e é isso que faz o saldo da parcela fechar sozinho na
-- `vw_faturamento_pendente`, sem tocar naquele CTE.
-- =====================================================================

alter table public.faturamento_itens drop constraint chk_fat_item_origem;

alter table public.faturamento_itens add constraint chk_fat_item_origem check (
     (origem_tipo = 'avulso' and origem_id is null and envio_parcela_id is null)
  or (origem_tipo = 'bv'     and origem_id is not null and envio_parcela_id is null)
  or (origem_tipo = 'job'    and origem_id is not null)
  or (origem_tipo = 'save'   and origem_id is not null and envio_parcela_id is not null)
);

comment on constraint chk_fat_item_origem on public.faturamento_itens is
  'Avulso não tem origem; BV tem origem e não tem parcela; job tem origem; save tem origem (o job que gerou o crédito) e sai na mesma parcela do envio (decisões 017 e 023).';
