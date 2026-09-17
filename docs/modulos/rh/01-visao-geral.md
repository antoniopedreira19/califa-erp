# 01 — Visão Geral do Módulo RH (MVP)

## Objetivo

Substituir a planilha Excel de RH da California por um cadastro estruturado dentro do ERP, começando pelo **retrato do colaborador** — quem é, quanto ganha, onde está alocado — com histórico auditável de mudanças. Isso destrava, em fases seguintes, benefícios, férias, folha mensal e integração com o motor de contas a pagar já existente.

O MVP não roda folha. Não controla férias. Não gerencia benefícios. Ele **fecha a fundação** para que essas peças possam ser construídas em cima, uma por vez, sem retrabalho de modelagem.

## Escopo deste MVP

Este primeiro corte cobre:

- **Cadastro de colaborador** — dados fixos: nome, tipo de contratação, CPF/CNPJ, função, e-mail, admissão e encerramento
- **Vínculo opcional a fornecedor** — link para reuso de dados bancários/PIX na baixa da folha, com auto-match por CPF/CNPJ e criação de fornecedor a partir do cadastro
- **Nível de cargo** — catálogo tenant-wide (`N3`, `N4`, `N5`, extensível), com CRUD em `/cadastros/niveis`
- **Alocação vigente (Camada 1)** — timeline de alocações do colaborador em pares (empresa, regional) com **percentual de rateio explícito**, permitindo **N alocações vigentes simultâneas** para o mesmo colaborador
- **Regional "GERAL"** — criada nas empresas (Agência California, CCH, Hitlab) para abrigar colaboradores transversais
- **Histórico salarial** — cada mudança gera uma linha em `colaboradores_salarios`; esta tabela **já é** a movimentação salarial (não existe entidade separada)
- **Snapshot da folha (Camada 2) — só a estrutura de dados** — tabelas `folhas_pagamento` e `folhas_pagamento_alocacoes` nascem previstas para que a fase seguinte da folha as encaixe sem migration pesada; **nenhuma UI de folha entra no MVP**
- **UI mínima** — sidebar ganha entrada "RH"; `/rh` hub; `/rh/colaboradores` lista + drawer editor; `/cadastros/niveis` CRUD
- **Auditoria** — criar/editar colaborador, mudar alocação, mudar salário, inativar/reativar

## Fora de escopo do MVP

Cada item abaixo é um subsistema autônomo em fase futura:

- Dependentes de plano de saúde
- Catálogo de benefícios e vínculo colaborador↔benefício
- Férias (período aquisitivo/concessivo, gozo, abono)
- Turnover / rescisão detalhada
- Folha mensal (geração, aprovação, pagamento — só a estrutura do snapshot está prevista)
- NFs/Recibos por competência para PJs
- Encargos CLT (INSS/FGTS/IRRF)
- Autoserviço do colaborador (holerite, pedido de férias)
- Import automático da planilha Excel atual (cadastro é manual no MVP; import vira script de seed em fase própria se necessário)
- Tela dedicada de "movimentação salarial" (o dado já é histórico; UI temporal é decisão de fase 2)
- Dimensão "Empresa Detalhe" (AMBEV/GERAL/CREATORS da planilha) — fora do modelo

## Princípio de evolução

O módulo cresce **um subsistema por vez**. A ordem de dependência prevista é:

```text
Cadastro + Alocação + Salário  (este MVP)
   ↓
Benefícios (catálogo + vínculo)
   ↓
Férias
   ↓
Turnover / rescisão
   ↓
NFs/Recibos por competência
   ↓
Folha mensal (motor)
   ↓
Integração com contas a pagar (folha aprovada → contas_avulsas em lote)
```

Cada fase abre uma nova rodada de descoberta, escreve seu próprio spec e sua própria migration. **Não antecipar tabelas de fase futura** — as duas exceções são `folhas_pagamento` + `folhas_pagamento_alocacoes`, cuja estrutura mínima entra no MVP para que a Camada 2 exista e a folha futura não force refactor destrutivo.

## Atores

| Ator | Papel no RH | Papel no ERP hoje |
|---|---|---|
| Administrador financeiro/RH (Kika) | Mantém colaboradores, alocação vigente e histórico salarial | Novo usuário do ERP a partir do MVP |
| Administrador do sistema (Antonio) | Configura níveis, aprova aumentos, audita | Já é admin |
| Gerente de Produção / Produtor / Freelancer | **Não acessam RH** | Já usam ERP em suas próprias telas |
| Financeiro | Não acessa RH no MVP. Passa a consumir snapshot da folha em fase futura | Já usam ERP |
| Colaborador | Passivo (sem login) | Sem acesso |

## Permissões

O módulo RH é fechado por role. **Só `administrador` e `rh` acessam.**

- **Novo role `rh`** entra no enum `app_role` neste MVP (aditivo, sem risco). Enum passa a ter: `administrador`, `gerente_producao`, `financeiro`, `produtor`, `freelancer`, `rh`.
- **`administrador` e `rh`** — leitura e escrita completa em todas as tabelas do módulo (`niveis`, `colaboradores`, `colaboradores_alocacoes`, `colaboradores_salarios`, `folhas_pagamento`, `folhas_pagamento_alocacoes`).
- **`financeiro`** — **não** acessa RH no MVP. Quando o motor da folha existir (fase futura), uma migration aditiva alarga o SELECT para incluir `financeiro` (leitura do snapshot da folha). Nada quebra.
- **`gerente_producao`, `produtor`, `freelancer`** — não veem RH.
- **Helper de banco:** função `is_tenant_rh(uuid)` criada seguindo o padrão do `is_tenant_admin(uuid)`.
- **RLS por tabela:** `SELECT / INSERT / UPDATE / DELETE` → `is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)`. Nada de `is_tenant_member` no módulo — o gate é role-específico.
- **Guard de rota:** todas as pages `/rh/**` e `/cadastros/niveis` chamam `requireSession()` e derrubam com `redirect('/home?reason=sem_permissao_rh')` se `activeRole ∉ {administrador, rh}`. Mesmo padrão da Central Financeira.
- **Sidebar:** a entrada "RH" só aparece pra `administrador` e `rh` — reusa o padrão `roles?: AppRole[]` que a Task 005 introduziu.

## Critérios de aceite (Done When)

O MVP é considerado pronto quando:

- Administrador consegue cadastrar um colaborador com CPF/CNPJ, tipo de contratação, função, nível, admissão.
- Admin consegue adicionar 1 ou N alocações vigentes ao colaborador, cada uma em uma combinação (empresa × regional × percentual), somando 100%.
- Admin consegue registrar uma mudança salarial — sistema fecha a linha antiga e abre a nova automaticamente.
- Admin consegue inativar (soft-delete) e reativar colaborador.
- Admin consegue criar/editar/inativar níveis em `/cadastros/niveis`.
- Ao digitar CPF/CNPJ que já existe em `fornecedores`, o form oferece vincular.
- Ao cadastrar colaborador PJ novo, o form oferece criar fornecedor num click.
- Regionais "GERAL" existem nas 3 empresas (California, CCH, Hitlab).
- Colaborador transversal (sem regional específica) pode ser alocado em "empresa + regional GERAL".
- RLS e GRANTs conferidos: `authenticated` lê e escreve; `anon` não vê nada.
- Auditoria em criar/editar/alocar/mudar-salário/inativar registra em `audit_events`.
- Typecheck, lint e build limpos.
- `docs/HANDOFF.md` atualizado com o resumo da entrega.

## Referências

- [`00-descoberta.md`](00-descoberta.md) — descoberta que fundamenta este escopo
- [`03-modelo-de-dados.md`](03-modelo-de-dados.md) — spec das tabelas do MVP
- [`docs/FLUXO-BANCO.md`](../../FLUXO-BANCO.md) — ciclo obrigatório de migração
- [`docs/PERFORMANCE.md`](../../PERFORMANCE.md) — checklist antes de qualquer código de UI/backend
- [`docs/09-identidade-visual-ui.md`](../../09-identidade-visual-ui.md) — larguras de layout e header padrão
- [`supabase/migrations/20260817000004_titulos_a_pagar.sql`](../../../supabase/migrations/20260817000004_titulos_a_pagar.sql) — motor de contas a pagar que a folha futura vai reusar
