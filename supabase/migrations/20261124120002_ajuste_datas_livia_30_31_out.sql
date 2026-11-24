-- Ajuste manual das datas da solicitação da Lívia (prod) pra refletir
-- o que realmente aconteceu: 2 diárias em 30 e 31/10/2026, não 1 diária
-- em 26/10 como o backfill de ontem assumiu.
--
-- Contexto: na migration 20261124110001 preenchi data_termino = data_inicio
-- em todas as linhas com data_termino NULL (que eram só duas, ambas desse
-- caso), colocando o valor conservador de 1 diária. O condutor da sessão
-- depois confirmou que o período certo é 30→31/10. Esta migration corrige
-- só a linha de prod (Agência California); a cópia de sandbox fica como
-- está.
--
-- Ajusta também o contrato associado (89ae9076…), que estava com
-- data_termino NULL desde sempre, pra bater com a solicitação.

update public.freelancer_solicitacoes
   set data_inicio = '2026-10-30'::date,
       data_termino = '2026-10-31'::date,
       updated_at = now()
 where id = 'd1d32911-3650-4d96-b3e5-e8fc0bde47b7';

update public.freelancer_contratos
   set data_inicio = '2026-10-30'::date,
       data_termino = '2026-10-31'::date,
       updated_at = now()
 where id = '89ae9076-2f71-4fe6-b86a-55e8cbc85876';
