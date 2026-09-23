-- =====================================================================
-- Chave PIX e conta bancária no formato do arquivo de remessa (23/09/2026)
-- =====================================================================
--
-- Por quê: o que está em `fornecedores` e `colaboradores` sai, sem
-- retoque, no arquivo CNAB 240 que vai para o Santander. A homologação
-- do PIX caiu três vezes por dado fora do formato (e-mails da Karen,
-- Santander, de 07/08 a 10/09). A regra do Tiago: registro fora do
-- modelo NÃO se grava — nem pela tela, nem por outro caminho.
--
-- A tela e a server action já recusam com mensagem (Zod +
-- `problemaDaChavePix` em lib/pix.ts). Estas CHECK são a última trava:
-- as expressões são as mesmas de `PIX_FORMATO` (lib/pix.ts). Mudou lá,
-- muda aqui.
--
--   cpf        11 dígitos
--   cnpj       14 dígitos
--   telefone   +55 + DDD sem zero + celular de 9 dígitos começando em 9
--   email      padrão do DICT, minúsculas, até 77 caracteres
--   aleatoria  EVP com hífens, minúsculas
--
-- O dígito verificador de CPF/CNPJ fica na aplicação (server action);
-- aqui só o desenho.
--
-- Bloco bancário: ou vazio, ou completo (banco, agência, conta, dígito
-- da conta e tipo). O gerador precisa dos cinco.
--
-- Aditiva: conferido pelo MCP antes de aplicar que os 24 fornecedores e
-- o colaborador já cumprem as regras — as constraints nascem validadas.
-- =====================================================================

-- ---------- fornecedores ----------

alter table public.fornecedores
  add constraint fornecedores_pix_formato check (
    (pix_tipo is null and pix_chave is null)
    or (pix_tipo = 'cpf' and pix_chave ~ '^[0-9]{11}$')
    or (pix_tipo = 'cnpj' and pix_chave ~ '^[0-9]{14}$')
    or (pix_tipo = 'telefone' and pix_chave ~ '^\+55[1-9]{2}9[0-9]{8}$')
    or (pix_tipo = 'email'
        and length(pix_chave) <= 77
        and pix_chave ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$')
    or (pix_tipo = 'aleatoria'
        and pix_chave ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

-- O formato de cada campo bancário já tem CHECK própria
-- (fornecedores_*_formato); falta a completude.
alter table public.fornecedores
  add constraint fornecedores_banco_completo check (
    (banco_codigo is null and agencia is null and agencia_dv is null
      and conta is null and conta_dv is null and tipo_conta is null)
    or (banco_codigo is not null and agencia is not null
      and conta is not null and conta_dv is not null and tipo_conta is not null)
  );

-- ---------- colaboradores ----------

alter table public.colaboradores
  add constraint colaboradores_pix_formato check (
    (pix_tipo is null and pix_chave is null)
    or (pix_tipo = 'cpf' and pix_chave ~ '^[0-9]{11}$')
    or (pix_tipo = 'cnpj' and pix_chave ~ '^[0-9]{14}$')
    or (pix_tipo = 'telefone' and pix_chave ~ '^\+55[1-9]{2}9[0-9]{8}$')
    or (pix_tipo = 'email'
        and length(pix_chave) <= 77
        and pix_chave ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$')
    or (pix_tipo = 'aleatoria'
        and pix_chave ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

-- Colaborador não tinha CHECK nenhuma nos campos bancários: formato e
-- completude numa só. Os tamanhos são os do schema do RH (agência até
-- 5, conta até 12) — os que cabem no arquivo.
alter table public.colaboradores
  add constraint colaboradores_banco_formato check (
    (banco_codigo is null and agencia is null and agencia_dv is null
      and conta is null and conta_dv is null and tipo_conta is null)
    or (banco_codigo ~ '^[0-9]{3}$'
      and agencia ~ '^[0-9]{1,5}$'
      and (agencia_dv is null or agencia_dv ~ '^[0-9X]$')
      and conta ~ '^[0-9]{1,12}$'
      and conta_dv ~ '^[0-9X]$'
      and tipo_conta is not null)
  );

comment on constraint fornecedores_pix_formato on public.fornecedores is
  'Chave PIX no formato do arquivo de remessa CNAB (lib/pix.ts PIX_FORMATO). 23/09/2026.';
comment on constraint colaboradores_pix_formato on public.colaboradores is
  'Chave PIX no formato do arquivo de remessa CNAB (lib/pix.ts PIX_FORMATO). 23/09/2026.';
