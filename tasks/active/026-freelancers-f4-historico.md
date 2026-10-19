# Task 026 — Freelancers (Fase 4, Task 4): Histórico via trigger + aba Histórico

## Objetivo

Audit trail completo de alterações em `freelancer_contratos`. Toda mudança
em campos relevantes vira linha em `freelancer_contrato_historico`, exibida
na aba Histórico do perfil do freelancer.

## Decisões travadas

- Trigger AFTER UPDATE em `freelancer_contratos` grava uma linha por campo
  alterado. Imutável: sem UPDATE/DELETE.
- Campos auditados: nome_job, cargo, tipo, valor, data_inicio, data_termino,
  cidade, status_real, responsavel_id, job_id, arquivo_url, minuta_url,
  distrato_*.
- Nunca gravar duas linhas se o valor é igual (`is distinct from`).
- RLS SELECT: quem pode ler o contrato pode ler o histórico.

## Arquivos

- Migration: `20261016000007_freelancers_f4_historico_contrato.sql`
- `app/(app)/freelancers/_components/historico-contrato-timeline.tsx`
- `lib/types.ts`: `FreelancerContratoHistorico`
- Atualizar `app/(app)/freelancers/[id]/page.tsx` pra passar histórico pra aba

## Critérios

- [ ] Trigger grava uma linha por campo alterado em UPDATE.
- [ ] Aba Histórico mostra linha do tempo com nome do campo, valor
      anterior/novo, quem/quando.
- [ ] `npm run typecheck` e `lint` passam.
