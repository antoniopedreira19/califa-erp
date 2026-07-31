-- =====================================================================
-- Cadastro completo de fornecedor
--
-- Adiciona endereço estruturado, dados bancários e chave PIX ao cadastro
-- de fornecedor. Motivação: financeiro precisa pagar; hoje esses dados
-- ficam soltos em `observacoes` ou fora do sistema.
--
-- Decisões (spec 2026-07-31-fornecedor-dados-completos-design.md):
--   - Uma conta bancária / PIX por fornecedor (colunas diretas, sem
--     tabela auxiliar).
--   - Endereço estruturado; ViaCEP no form. Cidade texto livre (não FK
--     para `cidades`, que é curada por tenant).
--   - Titular = fornecedor sempre (sem campos separados).
--   - Todas as colunas novas nascem NULL. Obrigatoriedade fica no Zod.
--     Fornecedores existentes continuam válidos; badge "Dados
--     incompletos" na lista sinaliza que precisam ser completados.
--   - Sem UNIQUE em pix_chave — warning suave no form, casos legítimos
--     de PIX compartilhado existem.
--   - Sem GRANTs novos, sem RLS nova — `fornecedores` já tem cobertura
--     completa (migration 20260722000001).
-- =====================================================================

-- 1. Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_conta_bancaria') then
    create type public.tipo_conta_bancaria as enum ('corrente', 'poupanca', 'pagamento');
  end if;

  if not exists (select 1 from pg_type where typname = 'pix_tipo_chave') then
    create type public.pix_tipo_chave as enum ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria');
  end if;
end$$;

-- 2. Colunas novas
alter table public.fornecedores add column if not exists cep text;
alter table public.fornecedores add column if not exists logradouro text;
alter table public.fornecedores add column if not exists numero text;
alter table public.fornecedores add column if not exists complemento text;
alter table public.fornecedores add column if not exists bairro text;
alter table public.fornecedores add column if not exists cidade text;
alter table public.fornecedores add column if not exists uf char(2);

alter table public.fornecedores add column if not exists banco_codigo text;
alter table public.fornecedores add column if not exists banco_nome text;
alter table public.fornecedores add column if not exists agencia text;
alter table public.fornecedores add column if not exists agencia_dv text;
alter table public.fornecedores add column if not exists conta text;
alter table public.fornecedores add column if not exists conta_dv text;
alter table public.fornecedores add column if not exists tipo_conta public.tipo_conta_bancaria;

alter table public.fornecedores add column if not exists pix_tipo public.pix_tipo_chave;
alter table public.fornecedores add column if not exists pix_chave text;

-- 3. CHECKs de formato (defesa em profundidade; Zod valida no app)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fornecedores_cep_formato') then
    alter table public.fornecedores
      add constraint fornecedores_cep_formato
      check (cep is null or cep ~ '^[0-9]{8}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_uf_formato') then
    alter table public.fornecedores
      add constraint fornecedores_uf_formato
      check (uf is null or uf in (
        'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
        'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_banco_codigo_formato') then
    alter table public.fornecedores
      add constraint fornecedores_banco_codigo_formato
      check (banco_codigo is null or banco_codigo ~ '^[0-9]{3}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_agencia_formato') then
    alter table public.fornecedores
      add constraint fornecedores_agencia_formato
      check (agencia is null or agencia ~ '^[0-9]{3,5}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_agencia_dv_formato') then
    alter table public.fornecedores
      add constraint fornecedores_agencia_dv_formato
      check (agencia_dv is null or agencia_dv ~ '^[0-9Xx]$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_conta_formato') then
    alter table public.fornecedores
      add constraint fornecedores_conta_formato
      check (conta is null or conta ~ '^[0-9]{4,12}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_conta_dv_formato') then
    alter table public.fornecedores
      add constraint fornecedores_conta_dv_formato
      check (conta_dv is null or conta_dv ~ '^[0-9Xx]$');
  end if;

  -- Coerência banco: se qualquer campo bancário preenchido, banco_codigo e
  -- banco_nome devem estar juntos (server deriva nome do código).
  if not exists (select 1 from pg_constraint where conname = 'fornecedores_banco_nome_coerente') then
    alter table public.fornecedores
      add constraint fornecedores_banco_nome_coerente
      check (
        (banco_codigo is null and banco_nome is null)
        or (banco_codigo is not null and banco_nome is not null)
      );
  end if;
end$$;
