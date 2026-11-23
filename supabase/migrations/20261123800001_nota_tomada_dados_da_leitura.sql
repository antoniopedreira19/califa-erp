-- Decisão 271 (23/11/2026): a seção Notas Fiscais da Central Financeira.
-- A aba Tomadas mostra, de cada NF emitida contra os nossos CNPJs, o que a
-- leitura da NF traz: a descrição do serviço (a IA já lia e descartava), o
-- CNAE da própria nota, o município da prestação (onde o ISS é devido), a
-- competência, o código de verificação (para conferir a nota no portal) e
-- as retenções destacadas na nota.
--
-- Hoje o cadastro de notas guarda só número, emissão, valor e tomador. As
-- colunas abaixo são aditivas e nascem vazias: a leitura ampliada da NF as
-- preenche (`leitura_em` diz quando, `leitura_modelo` com qual leitura).
-- Sem leitura, a tela mostra o CNAE do cadastro do emitente, marcado.
--
-- `retencoes` é a lista do que a NF destaca: [{"imposto": "IRRF",
-- "aliquota": 1.5, "valor": 45.0}, ...], com o imposto entre ISS, IRRF,
-- PIS, COFINS, CSLL e INSS. O que o financeiro decide reter continua na
-- aprovação da PP (`pedidos_compra_retencoes`) e na baixa
-- (`baixas_retencoes`): isto é o que a nota diz, para conferência.

alter table public.notas_fiscais_fornecedor
  add column if not exists leitura_em timestamptz,
  add column if not exists leitura_modelo text,
  add column if not exists descricao_servico text,
  add column if not exists cnae text,
  add column if not exists municipio_prestacao text,
  add column if not exists competencia date,
  add column if not exists codigo_verificacao text,
  add column if not exists retencoes jsonb not null default '[]'::jsonb;

alter table public.notas_fiscais_fornecedor
  drop constraint if exists chk_nf_fornecedor_retencoes_lista;
alter table public.notas_fiscais_fornecedor
  add constraint chk_nf_fornecedor_retencoes_lista check (jsonb_typeof(retencoes) = 'array');

comment on column public.notas_fiscais_fornecedor.leitura_em is
  'Decisão 271: quando a leitura ampliada da NF preencheu os dados abaixo.';
comment on column public.notas_fiscais_fornecedor.cnae is
  'Decisão 271: o CNAE que a própria NF traz (o do cadastro do fornecedor fica em fornecedores.cnae).';
comment on column public.notas_fiscais_fornecedor.retencoes is
  'Decisão 271: as retenções destacadas na NF, [{imposto, aliquota, valor}]. Conferência; o retido de fato fica na aprovação e na baixa.';
