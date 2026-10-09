-- ============================================================================
-- Decisão 165 (09/10/2026): regime tributário com Lucro Real e Lucro
-- Presumido separados, e o CNAE no cadastro de fornecedor (e de veículo).
--
-- O que muda no banco, e só isto:
--
--   1. `fornecedores.regime_tributario` passa a aceitar `lucro_real` e
--      `lucro_presumido`. O legado `normal` ("Lucro Real ou Presumido",
--      gravado até hoje) continua aceito: o cadastro que o tem segue
--      valendo para a aprovação das PPs já enviadas até alguém revisar, e a
--      tela não deixa mais escolhê-lo. `regime_consulta` não muda: a
--      consulta do CNPJ só sabe dizer Simples, MEI ou nenhum dos dois
--      (`normal`) — a Receita não diz se é Real ou Presumido.
--
--   2. `fornecedores.cnae`: a subclasse do CNAE 2.3, em 7 dígitos sem
--      pontuação. Nulável no banco: todo cadastro anterior a esta data nasce
--      sem CNAE, e a pessoa física não tem. A obrigatoriedade na pessoa
--      jurídica é do schema do servidor (`lib/validations/fornecedores.ts`),
--      e a existência do código também (`lib/fiscal/cnaes.ts`, a lista do
--      IBGE) — o banco confere só o formato.
--
-- A regra que nasce junto, no código: PP de fornecedor PJ sem regime (ou
-- com o legado) ou sem CNAE não é gerada (`gerarPPDaPPAEmitir`). Por isso
-- não há backfill de CNAE aqui: o Tiago decidiu que todo cadastro passa por
-- uma pessoa, com a consulta do CNPJ só sugerindo na tela.
--
-- Aditiva: amplia a CHECK do regime e cria uma coluna nulável. Nenhum dado
-- muda. A coluna herda o GRANT e a RLS da tabela.
-- ============================================================================

alter table public.fornecedores
  drop constraint if exists chk_fornecedor_regime;

alter table public.fornecedores
  add constraint chk_fornecedor_regime check (
    regime_tributario is null
    or regime_tributario in ('lucro_real', 'lucro_presumido', 'simples', 'mei', 'normal')
  );

alter table public.fornecedores
  add column if not exists cnae text;

alter table public.fornecedores
  drop constraint if exists chk_fornecedor_cnae;

alter table public.fornecedores
  add constraint chk_fornecedor_cnae check (cnae is null or cnae ~ '^[0-9]{7}$');

comment on column public.fornecedores.regime_tributario is
  'Regime tributario da pessoa juridica: lucro_real, lucro_presumido, simples ou mei (decisao 165, 09/10/2026). normal = legado "Lucro Real ou Presumido", gravado ate 09/10/2026; nao se escolhe mais e trava a geracao de PP ate a revisao do cadastro.';

comment on column public.fornecedores.cnae is
  'Subclasse do CNAE 2.3 (7 digitos, sem pontuacao), obrigatoria na pessoa juridica pelo schema do servidor (decisao 165, 09/10/2026). Nula = cadastro anterior a 09/10/2026 ou pessoa fisica; PP de PJ sem CNAE nao e gerada.';
