-- Motivo: consolidar os 16 adiantamentos legados de 2026 na nova semântica
-- de "integral vs parcial" + 2 correções pontuais de valor.
--
-- Decisões (sessão 2026-11-17):
-- - 4 adiantamentos são "integrais": o colaborador recebeu o 13º inteiro
--   de uma vez e NÃO participa da folha de 13º/2026 (identificados por
--   data + valor + obs). Marcar integral=true e deletar as respectivas
--   linhas em decimo_terceiro_linhas.
-- - Um adiantamento de 24/07 tinha valor registrado como R$ 14,00 (erro
--   de digitação) — corrige pra R$ 14.000,00 (salário integral, PJ, 12
--   avos).
-- - Outro adiantamento (08/09, R$ 2.520,83) deixava a 1ª parcela do 13º
--   com R$ 0,01 por arredondamento. Soma +R$ 0,01 no adiantamento
--   (2520.83 → 2520.84) pra zerar a 1ª parcela.
-- - Os outros 12 adiantamentos ficam como estão (parciais, integral=false
--   default).
--
-- WHERE combina data + valor atual + ano + obs pra ser idempotente:
-- se rodar duas vezes, os UPDATEs encontram 0 linhas no 2º run (o valor
-- antigo já não existe mais).
--
-- Tenant Agência California: d2a02c10-9c7e-4157-8dd5-84bbf5a7044c.

-- 1) Correção do valor da Ana Cristina (14 → 14000).
update public.decimo_terceiro_adiantamentos
set valor = 14000.00
where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and ano = 2026
  and valor = 14.00
  and obs ilike '%Não recebe 13 salario%'
  and data = '2026-07-24';

-- 2) Correção do valor da Ana Rizia (2520.83 → 2520.84).
update public.decimo_terceiro_adiantamentos
set valor = 2520.84
where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and ano = 2026
  and valor = 2520.83
  and data = '2026-09-08'
  and obs ilike '%1 parcela do Decimo%';

-- 3) Marca os 4 integrais (por data + valor + obs, não por nome/CPF).
update public.decimo_terceiro_adiantamentos
set integral = true
where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and ano = 2026
  and integral = false
  and (
    (data = '2026-09-30' and valor = 7000.00 and obs ilike '%Valor integral%')
    or (data = '2026-08-10' and valor = 7000.00 and obs ilike '%Valor integral%')
    or (data = '2026-07-24' and valor = 14000.00 and obs ilike '%Não recebe 13 salario%')
    or (data = '2026-02-05' and valor = 15000.00 and obs ilike '%Valor integral%')
  );

-- 4) Deleta linhas de 13º/2026 dos 4 integrais (se existirem).
delete from public.decimo_terceiro_linhas l
using public.decimo_terceiro_folhas f,
      public.decimo_terceiro_adiantamentos a
where l.folha_id = f.id
  and f.ano = 2026
  and f.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and a.tenant_id = f.tenant_id
  and a.ano = f.ano
  and a.colaborador_id = l.colaborador_id
  and a.integral = true;

-- 5) Recalcula a linha de 13º da Ana Rizia (adiantamento +0.01 → 1ª
--    parcela deveria virar 0). Faz via UPDATE direto porque o recalc
--    completo mora na action TS; o impacto aqui é só na 1ª parcela e
--    total_adiantado.
update public.decimo_terceiro_linhas l
set total_adiantado = 2520.84,
    primeira_parcela = 0.00
where l.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and exists (
    select 1 from public.decimo_terceiro_folhas f
    where f.id = l.folha_id and f.ano = 2026
  )
  and l.colaborador_id = (
    select colaborador_id from public.decimo_terceiro_adiantamentos
    where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
      and ano = 2026
      and valor = 2520.84
      and data = '2026-09-08'
    limit 1
  );
