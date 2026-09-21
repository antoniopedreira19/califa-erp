# Dimensão contábil (empresas PJ) separada da gerencial (2026-09-11)

Dimensão contábil (PJ com CNPJ) passou a existir separada da dimensão gerencial. Toda `conta_bancaria` agora aponta pra `empresa_contabil_id` (NOT NULL). Empresa contábil de todo lançamento = a PJ dona da conta que o processou (derivada, não escolhida).

## O que entrou

- Nova tabela `empresas_contabeis` com 3 PJs:
  - California LTDA — CNPJ `19437976000154`
  - Hitlab LTDA — CNPJ `04409741000181`
  - GoCrazy LTDA — CNPJ `29943648000183`
- `contas_bancarias.empresa_contabil_id` NOT NULL.
- View `vw_lancamentos_com_contabil` (`security_invoker=on`) resolve o join pra relatórios.
- Tela `/admin/empresas` ganhou aba "Contábeis" (CRUD admin-only).
- Cadastro de conta bancária ganhou dropdown obrigatório "Empresa contábil" e a listagem mostra coluna "Contábil".

## Docs / ADRs relacionados

- `docs/superpowers/plans/2026-09-11-empresas-contabeis.md` (plano completo)

## Pontos de atenção pra próxima sessão

- A coluna `contas_bancarias.empresa_id` (gerencial) continua como vestígio — 19 RPCs de baixa dependem dela; drop ficou fora do escopo. Se for tocar em baixa, atenção pra usar `empresa_contabil_id` daqui em diante.
