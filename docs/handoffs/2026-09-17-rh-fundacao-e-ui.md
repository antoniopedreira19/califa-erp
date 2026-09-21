# Módulo RH — Fundação + UI (Rodadas A e B) (2026-09-17)

Módulo RH em pé de ponta a ponta em nível de cadastros (colaboradores, níveis, alocações, salário). Camada 1 mantida pelo RH; Camada 2 (folha) segue como esqueleto (folha mensal real entra em 2026-09-18).

## O que entrou

- Novo role `rh` no `app_role`, helper `is_tenant_rh(uuid)`.
- 6 tabelas: `niveis`, `colaboradores`, `colaboradores_alocacoes`, `colaboradores_salarios`, `folhas_pagamento`, `folhas_pagamento_alocacoes`.
- Regionais `GERAL <empresa>` seedadas nas 3 empresas reais.
- **Camada 1** (`colaboradores_alocacoes`): mantida pelo RH com N linhas simultâneas somando 100%. Constraint trigger `DEFERRABLE INITIALLY DEFERRED` valida no commit (testado).
- **Camada 2** (`folhas_pagamento_alocacoes`): esqueleto pra fase da folha.
- UI completa:
  - `/rh` — hub.
  - `/rh/colaboradores` — lista + filtros.
  - `/rh/colaboradores/niveis` — CRUD catálogo padrão de Categorias.
  - `/rh/colaboradores/novo` — form com auto-match CPF/CNPJ em fornecedores + criar-fornecedor-num-click.
  - `/rh/colaboradores/[id]` — detalhe com 3 cards: dados+editar drawer, alocações+modal swap, salário+registrar mudança.
- Movimentação salarial = histórico próprio, não tabela separada.
- Gate `administrador OR rh` em RLS, permissões e guard de rota.

## Migrations aplicadas

```
20260916000001..000008
```

## Docs / ADRs relacionados

- `docs/modulos/rh/*`

## Pontos de atenção pra próxima sessão

- Fora do MVP: benefícios, férias, folha real, integração com contas a pagar (folha real entrou em 2026-09-18).
