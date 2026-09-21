-- =====================================================================
-- colaboradores ganha shape bancário próprio
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Fase 4 do módulo pgto-remessa (ver docs/modulos/pgto-remessa/01-visao-geral.md).
-- Colaborador precisa de dados bancários próprios pra ser destinatário
-- CNAB (folha aprovada -> contas_avulsas.colaborador_id preenchido ->
-- gerador CNAB precisa saber pra qual conta depositar). Mesmo shape
-- que fornecedores.banco_* / .pix_* já tem — reaproveitamos os enums
-- tipo_conta_bancaria e pix_tipo_chave.
--
-- Todos os campos são NULLABLE:
--   • cadastro rápido pré-folha pode ficar sem banco preenchido
--   • estagiário / CLT com bolsa não emite folha mesmo
--   • gate de completude é o gerador CNAB, na hora de exportar remessa,
--     não o cadastro
--
-- Sem CHECK exigindo "banco preenchido OR pix preenchido" — o mesmo
-- padrão de fornecedores, que também deixa os dois vazios até o
-- momento em que precisa pagar. Validação vai na Server Action de
-- geração de remessa, com erro específico por colaborador.
--
-- Aditiva pura: 9 colunas nullable, nenhum dado tocado.
-- =====================================================================

alter table public.colaboradores
  add column if not exists banco_codigo text,
  add column if not exists banco_nome text,
  add column if not exists agencia text,
  add column if not exists agencia_dv text,
  add column if not exists conta text,
  add column if not exists conta_dv text,
  add column if not exists tipo_conta public.tipo_conta_bancaria,
  add column if not exists pix_tipo public.pix_tipo_chave,
  add column if not exists pix_chave text;

comment on column public.colaboradores.banco_codigo is
  'Código FEBRABAN do banco (3 dígitos). Ex.: 033 = Santander, 341 = Itaú, 237 = Bradesco.';
comment on column public.colaboradores.banco_nome is
  'Nome do banco preenchido pelo cadastro (denormalizado pra evitar lookup toda vez).';
comment on column public.colaboradores.agencia is
  'Agência (só dígitos, sem DV). Zero à esquerda preservado como texto.';
comment on column public.colaboradores.agencia_dv is
  'Dígito verificador da agência (1 caractere, pode ser letra em alguns bancos).';
comment on column public.colaboradores.conta is
  'Número da conta (só dígitos, sem DV). Zero à esquerda preservado como texto.';
comment on column public.colaboradores.conta_dv is
  'Dígito verificador da conta (1 caractere, pode ser letra em alguns bancos).';
comment on column public.colaboradores.tipo_conta is
  'corrente | poupanca | pagamento. Bate 1:1 com o G013 B do manual CNAB Santander.';
comment on column public.colaboradores.pix_tipo is
  'cpf | cnpj | email | telefone | aleatoria. Bate 1:1 com o G032 do manual CNAB Santander.';
comment on column public.colaboradores.pix_chave is
  'Chave PIX no formato que o DICT guarda. CPF/CNPJ só dígitos; e-mail lowercase; '
  'telefone com +55; aleatória com hífens. Sanitização é do formulário, não do banco.';
