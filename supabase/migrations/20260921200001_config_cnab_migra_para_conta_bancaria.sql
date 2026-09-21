-- =====================================================================
-- Config CNAB migra de empresas_contabeis pra contas_bancarias
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- ADR 004 do módulo pgto-remessa. A fase 4.2 colocou convênio, agência,
-- conta, DVs e sequencial em empresas_contabeis por engano — esses
-- campos são propriedades de UMA CONTA BANCÁRIA específica dentro de
-- uma PJ contábil, não da PJ inteira. Se a California algum dia
-- contratar convênio numa segunda conta (poupança pra sinistros, por
-- exemplo), o modelo original obrigaria duplicar empresas_contabeis —
-- óbvio que tá errado.
--
-- Correção limpa: convênio e sequencial migram pra contas_bancarias.
-- Endereço fiscal fica em empresas_contabeis (é do CNPJ, não da conta).
--
-- Consequência automática: cnab_remessas.empresa_contabil_id vira
-- cnab_remessas.conta_bancaria_id (migration seguinte). Cada arquivo é
-- gerado a partir de UMA conta específica.
--
-- SEGURO PORQUE:
--   • Nenhum registro em cnab_remessas ainda (nada rastreado).
--   • O único backfill de config CNAB feito hoje (California Santander)
--     está em empresas_contabeis; será reaplicado na conta bancária
--     correta na migration seguinte + backfill separado.
--
-- Aditiva (contas_bancarias) + Destrutiva-parcial (empresas_contabeis).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Adiciona os campos em contas_bancarias
-- ---------------------------------------------------------------------

alter table public.contas_bancarias
  add column if not exists agencia_dv text,
  add column if not exists numero_conta_dv text,
  add column if not exists convenio_cnab_santander text,
  add column if not exists sequencial_arquivo integer;

comment on column public.contas_bancarias.agencia_dv is
  'DV da agência (1 caractere, pode ser letra em alguns bancos).';
comment on column public.contas_bancarias.numero_conta_dv is
  'DV da conta corrente (1 caractere).';
comment on column public.contas_bancarias.convenio_cnab_santander is
  'Código do convênio "Pagamento a Fornecedores" contratado com o '
  'Santander pra ESTA conta (20 pos alfanumérico). Preenchido depois '
  'de contratado + homologado. Nulo bloqueia geração de remessa nesta '
  'conta. Movido de empresas_contabeis em 21/09/2026 (ADR 004).';
comment on column public.contas_bancarias.sequencial_arquivo is
  'Próximo sequencial a usar no próximo arquivo .REM gerado a partir '
  'DESTA conta (Nota G010 do manual Santander). Começa em 11 pra '
  'evitar a faixa 1-10 que o banco trata como teste. Cada conta tem '
  'sua própria série independente.';

-- CHECK: se preenchido, sequencial precisa ser >= 11
alter table public.contas_bancarias
  drop constraint if exists chk_contas_bancarias_sequencial_arquivo;

alter table public.contas_bancarias
  add constraint chk_contas_bancarias_sequencial_arquivo
    check (sequencial_arquivo is null or sequencial_arquivo >= 11);

-- ---------------------------------------------------------------------
-- 2. Remove os campos errados de empresas_contabeis (endereço fica)
-- ---------------------------------------------------------------------

alter table public.empresas_contabeis
  drop column if exists convenio_cnab_santander,
  drop column if exists agencia_debito,
  drop column if exists agencia_debito_dv,
  drop column if exists conta_debito,
  drop column if exists conta_debito_dv,
  drop column if exists sequencial_arquivo;

-- endereço fica onde está — é característica do CNPJ, aparece no
-- header do arquivo como identificação do titular do débito.
