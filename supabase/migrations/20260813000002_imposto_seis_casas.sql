-- Impostos deixam de ser digitados à mão: a tela passa a oferecer um seletor
-- com as alíquotas praticadas pela California, e uma delas — 24,269914% — tem
-- seis casas decimais.
--
-- A coluna era numeric(6,3) e arredondava 24.269914 para 24.270 na gravação,
-- fazendo a tela exibir "24,27" logo depois de o usuário escolher 24,269914.
-- Ampliar a escala resolve na origem.
--
-- Por que a ampliação é segura:
--   - Aumentar escala não perde dado: 19.530 vira 19.530000, mesmo número.
--   - Nenhuma view ou matview depende desta coluna (verificado em pg_depend).
--   - O CHECK versoes_orcamento_percentuais_validos compara contra numeric
--     genérico (>= 0 e <= 100), então segue valendo sem recriação.
--
-- percentual_honorarios continua numeric(6,3) de propósito: vem do cadastro do
-- cliente e não tem caso de seis casas hoje.

alter table public.versoes_orcamento
  alter column percentual_imposto type numeric(10, 6);

comment on column public.versoes_orcamento.percentual_imposto is
  'Percentual de imposto da versão. Seis casas decimais para comportar as alíquotas fixas do seletor (ex.: 24,269914). Fonte das opções: lib/impostos.ts.';
