-- Motivo: integrar o 13o salario ao fluxo existente de Folha de Pagamento.
-- Adiciona dois valores ao enum folha_tipo: 'decimo_terceiro_1a_parcela' e
-- 'decimo_terceiro_2a_parcela'. Quando o RH fecha cada parcela na folha de
-- 13o, uma linha em folhas_pagamento por colaborador e criada com esse tipo
-- e status='enviada', aparecendo na tab 'Folhas de Pagamento' em
-- /financeiro/contas-a-pagar pro financeiro aprovar.
--
-- Referencias:
--   - docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md
--   - Decisao do usuario em 21/10/2026: enviar parcelas via mesmo fluxo
--     da folha mensal (RH envia -> financeiro aprova -> contas_avulsas).
--
-- Regra do FLUXO-BANCO: alter type ... add value fica SOZINHO na migration
-- (um valor novo nao pode ser usado na mesma transacao em que e criado).
-- Como sao dois valores, divide em duas statements aqui mesmo com if not
-- exists.

alter type public.folha_tipo add value if not exists 'decimo_terceiro_1a_parcela';
alter type public.folha_tipo add value if not exists 'decimo_terceiro_2a_parcela';
