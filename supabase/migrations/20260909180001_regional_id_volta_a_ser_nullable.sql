-- =====================================================================
-- `regional_id` volta a ser nullable nas três tabelas
--
-- Reverte `20260908170000_regional_id_not_null.sql`. Aquela migration
-- deixou SEIS fluxos de escrita quebrados por 24h: baixa de título,
-- estorno de baixa, fechamento de fatura de cartão, criação de conta
-- avulsa, compra parcelada no cartão e emissão de faturamento.
--
-- ---------------------------------------------------------------------
-- Por que a premissa não se sustentava
--
-- O cabeçalho da migration revertida dizia: "agora que a UI cascata
-- empresa->regional exige regional em toda tela de criacao, regional_id
-- nas 3 tabelas passa a ser NOT NULL".
--
-- A UI exige regional, sim. Mas ela grava essa regional em OUTRO lugar:
-- no rateio (`contas_avulsas_regionais`, N regionais com percentual) e
-- no job. A coluna singular `regional_id` é o ÚLTIMO FALLBACK, não a
-- fonte — e é a própria `vw_fluxo_caixa` que estabelece a ordem:
--
--     -- o rateio tem prioridade...
--     FROM contas_avulsas_regionais r
--     UNION ALL
--     -- ...e só na ausência dele cai no coalesce:
--     COALESCE(j.regional_id, a.regional_id)   -- avulsa
--     COALESCE(j.regional_id, l.regional_id)   -- lançamento
--
-- Precedência real: rateio → regional do job → coluna singular. Tornar
-- o terceiro item obrigatório inverteu a hierarquia.
--
-- ---------------------------------------------------------------------
-- Por que o sanity check não pegou
--
-- A migration revertida registrou: "count(*) filter (where regional_id
-- is null) retornou 0 nas 3 tabelas". Retornou mesmo — mas as três
-- tabelas estão VAZIAS (0 linhas em 09/09/2026). Contar nulos em tabela
-- vazia sempre dá zero. O check passou sem exercitar nada.
--
-- Para a próxima: quando a tabela está vazia, o sanity check tem que ser
-- sobre o CÓDIGO DE ESCRITA, não sobre o dado. A consulta que teria
-- pegado isso:
--
--     select p.proname, (select count(*) from regexp_matches(
--       pg_get_functiondef(p.oid),
--       'insert\s+into\s+(public\.)?lancamentos_financeiros','gi'))
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.prokind='f';
--
-- (Use `regexp_matches` com `(public\.)?`: metade das funções escreve
-- sem o prefixo de schema, e um `like '%insert into public.tabela%'` dá
-- falso negativo — erro que eu mesmo cometi ao mapear isto.)
--
-- ---------------------------------------------------------------------
-- O que NÃO foi feito, de propósito
--
-- O objetivo da Fase 2A — garantir que todo lançamento tenha regional
-- para o DRE — continua legítimo e continua em aberto. Esta migration só
-- desfaz a tentativa que não funcionou; ela NÃO entrega a garantia.
--
-- A forma certa de alcançá-la é validar que existe **rateio OU job**, não
-- que a coluna singular está preenchida. Isso é um check/trigger de outro
-- desenho, e vale escrever junto com quem fez a Fase 2A (decisão do Tiago
-- em 09/09/2026: reverter agora, desenhar a trava certa depois).
--
-- Nada de dado é perdido: as colunas continuam existindo e o que já
-- estivesse preenchido continua preenchido. As três tabelas estão vazias
-- hoje, então não há nem o que preservar.
-- =====================================================================

alter table public.contas_avulsas          alter column regional_id drop not null;
alter table public.lancamentos_financeiros alter column regional_id drop not null;
alter table public.titulos_receber         alter column regional_id drop not null;

comment on column public.contas_avulsas.regional_id is
  'FALLBACK, não fonte. A regional da avulsa vem do rateio (contas_avulsas_regionais) ou do job; esta coluna só é lida por vw_fluxo_caixa quando não há nenhum dos dois. Foi NOT NULL entre 08 e 09/09/2026 e quebrou a criação de avulsa — ver 20260909180001.';

comment on column public.lancamentos_financeiros.regional_id is
  'FALLBACK, não fonte. vw_fluxo_caixa lê COALESCE(job.regional_id, esta coluna), e o rateio da avulsa tem prioridade sobre as duas. Foi NOT NULL entre 08 e 09/09/2026 e quebrou toda baixa e estorno — ver 20260909180001.';

comment on column public.titulos_receber.regional_id is
  'FALLBACK, não fonte. Nenhuma das funções de faturamento a preenche. Foi NOT NULL entre 08 e 09/09/2026 e quebrou emitir_faturamento — ver 20260909180001.';
