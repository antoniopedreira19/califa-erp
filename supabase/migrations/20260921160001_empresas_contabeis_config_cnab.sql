-- =====================================================================
-- empresas_contabeis ganha configuração de CNAB Santander
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Fase 4.2 do módulo pgto-remessa. Cada empresa contábil (California
-- Filmes, Go Crazy, Hitlab — 3 CNPJs distintos) tem convênio Santander
-- próprio e sequencial de arquivo independente. Sem essa config, o
-- header do arquivo (Nota G009 do manual) não sabe qual convênio usar,
-- e o débito não sabe qual conta bancária da PJ contábil deve
-- movimentar.
--
-- Todos os campos são NULLABLE — só California Filmes vai ser
-- preenchida no MVP; Go Crazy e Hitlab entram na fase 2. Gerador CNAB
-- rejeita empresa contábil sem convênio configurado.
--
-- SEQUENCIAL_ARQUIVO nasce em 11:
-- O manual (Nota G010) diz que se contratar "sequencial para teste",
-- números 1–10 são tratados como teste pelo banco. Começar em 11
-- protege contra essa armadilha independente da contratação.
--
-- Aditiva pura: 8 colunas nullable.
-- =====================================================================

alter table public.empresas_contabeis
  add column if not exists convenio_cnab_santander text,
  add column if not exists agencia_debito text,
  add column if not exists agencia_debito_dv text,
  add column if not exists conta_debito text,
  add column if not exists conta_debito_dv text,
  add column if not exists sequencial_arquivo integer,
  add column if not exists endereco_logradouro text,
  add column if not exists endereco_cidade text,
  add column if not exists endereco_cep text,
  add column if not exists endereco_uf character(2);

comment on column public.empresas_contabeis.convenio_cnab_santander is
  'Código do convênio "Pagamento a Fornecedores" contratado com o Santander (20 pos, alfanumérico). Preenchido só depois de contratado + homologado. Nulo bloqueia geração de remessa.';
comment on column public.empresas_contabeis.agencia_debito is
  'Agência da conta Santander que assina o débito no header do arquivo. Sem DV.';
comment on column public.empresas_contabeis.agencia_debito_dv is
  'DV da agência do débito.';
comment on column public.empresas_contabeis.conta_debito is
  'Número da conta corrente Santander que sofre o débito consolidado.';
comment on column public.empresas_contabeis.conta_debito_dv is
  'DV da conta do débito.';
comment on column public.empresas_contabeis.sequencial_arquivo is
  'Próximo número sequencial a usar na próxima remessa (Nota G010 do manual). Começa em 11 pra evitar faixa de teste (1-10). Incrementado atomicamente pelo gerador.';
comment on column public.empresas_contabeis.endereco_logradouro is
  'Endereço da PJ contábil — vai no header de arquivo (opcional pelo layout, mas alguns bancos exigem). Denormalizado — a fonte de verdade é o contrato social.';
comment on column public.empresas_contabeis.endereco_cidade is
  'Cidade da PJ contábil.';
comment on column public.empresas_contabeis.endereco_cep is
  'CEP da PJ contábil (só dígitos).';
comment on column public.empresas_contabeis.endereco_uf is
  'UF da PJ contábil (2 caracteres, maiúsculo).';
