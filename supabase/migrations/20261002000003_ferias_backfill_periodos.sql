-- Motivo: dispara trigger trg_colaboradores_gerar_ferias_periodos nos 209
-- colaboradores ativos atuais, gerando todos os períodos aquisitivos de
-- data_admissao até current_date + 2 anos.
--
-- Como funciona: UPDATE no-op (data_admissao = data_admissao) força o trigger
-- a rodar, mas sem alterar valor real.
--
-- Aplicado em 2026-10-01, resultado real:
--   - 209 colaboradores processados.
--   - 1028 períodos criados.
--   - Deco (admissão 2016-12-15): 12 períodos.
--   - Amanda Kapazi (admissão 2026-09-23): 3 períodos.
--   - Distribuição: 627 incompleto, 265 vencido, 119 apto, 17 em_alerta.

update public.colaboradores
   set data_admissao = data_admissao
 where status = 'ativo'
   and data_admissao is not null;
