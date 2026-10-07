-- Seed do subtipo 05.015 "Serviços de Terceiros (PJ)" em plano_contas_subtipos.
-- Pré-requisito para o fluxo de folha em dois caminhos: linhas de origem='california'
-- (PJ/MEI + parte Recibo dos híbridos) são mapeadas para esse subtipo em contas_avulsas.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D6)
--
-- Ruling: originalmente Task 0 do plano previa criação manual pela UI em
-- /financeiro/cadastros/plano-de-contas. Executor automático (sem operador no loop)
-- converte em migration de seed. Idempotente via ON CONFLICT; cobre todos os tenants
-- que já têm o tipo '05 Despesa com Pessoal' cadastrado.

INSERT INTO public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome, ativo)
SELECT t.tenant_id, t.id, '015', 'Serviços de Terceiros (PJ)', true
FROM public.plano_contas_tipos t
WHERE t.codigo = '05'
ON CONFLICT ON CONSTRAINT uniq_subtipo_codigo_por_tipo DO NOTHING;
