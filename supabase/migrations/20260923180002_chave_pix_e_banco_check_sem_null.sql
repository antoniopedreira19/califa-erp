-- =====================================================================
-- Correção da 20260923180001: CHECK com NULL deixava passar (23/09/2026)
-- =====================================================================
--
-- CHECK só recusa quando a expressão dá FALSE; NULL passa. Na 180001,
-- `pix_tipo = 'cpf' and pix_chave ~ '…'` com a chave nula vira NULL, e o
-- OR inteiro também — tipo sem chave era aceito. O mesmo com
-- `conta_dv ~ '…'` nulo no colaborador (conta sem dígito passava).
--
-- Pego na conferência pelo MCP logo depois de aplicar (update dentro de
-- bloco desfeito: "colab tipo sem chave: ACEITO", "colab banco sem dv:
-- ACEITO"). As constraints tinham minutos e nenhum dado dependia delas:
-- recria as três com `coalesce(…, false)`. A `fornecedores_banco_completo`
-- só usa IS NULL / IS NOT NULL e não tem o problema.
-- =====================================================================

alter table public.fornecedores drop constraint fornecedores_pix_formato;
alter table public.colaboradores drop constraint colaboradores_pix_formato;
alter table public.colaboradores drop constraint colaboradores_banco_formato;

alter table public.fornecedores
  add constraint fornecedores_pix_formato check (
    (pix_tipo is null and pix_chave is null)
    or coalesce(
      (pix_tipo = 'cpf' and pix_chave ~ '^[0-9]{11}$')
      or (pix_tipo = 'cnpj' and pix_chave ~ '^[0-9]{14}$')
      or (pix_tipo = 'telefone' and pix_chave ~ '^\+55[1-9]{2}9[0-9]{8}$')
      or (pix_tipo = 'email'
          and length(pix_chave) <= 77
          and pix_chave ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$')
      or (pix_tipo = 'aleatoria'
          and pix_chave ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
      false)
  );

alter table public.colaboradores
  add constraint colaboradores_pix_formato check (
    (pix_tipo is null and pix_chave is null)
    or coalesce(
      (pix_tipo = 'cpf' and pix_chave ~ '^[0-9]{11}$')
      or (pix_tipo = 'cnpj' and pix_chave ~ '^[0-9]{14}$')
      or (pix_tipo = 'telefone' and pix_chave ~ '^\+55[1-9]{2}9[0-9]{8}$')
      or (pix_tipo = 'email'
          and length(pix_chave) <= 77
          and pix_chave ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$')
      or (pix_tipo = 'aleatoria'
          and pix_chave ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
      false)
  );

alter table public.colaboradores
  add constraint colaboradores_banco_formato check (
    (banco_codigo is null and agencia is null and agencia_dv is null
      and conta is null and conta_dv is null and tipo_conta is null)
    or coalesce(
      banco_codigo ~ '^[0-9]{3}$'
      and agencia ~ '^[0-9]{1,5}$'
      and (agencia_dv is null or agencia_dv ~ '^[0-9X]$')
      and conta ~ '^[0-9]{1,12}$'
      and conta_dv ~ '^[0-9X]$'
      and tipo_conta is not null,
      false)
  );

comment on constraint fornecedores_pix_formato on public.fornecedores is
  'Chave PIX no formato do arquivo de remessa CNAB (lib/pix.ts PIX_FORMATO). 23/09/2026.';
comment on constraint colaboradores_pix_formato on public.colaboradores is
  'Chave PIX no formato do arquivo de remessa CNAB (lib/pix.ts PIX_FORMATO). 23/09/2026.';
