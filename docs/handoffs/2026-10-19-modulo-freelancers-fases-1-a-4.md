# Módulo Freelancers — fases 1 a 4 (2026-10-19)

> Portado do sistema `AgCaliforniaRH` pra dentro do califa-erp. Em um único ciclo saíram do zero até ter cadastro de freelancer, contrato amarrado a job real do ERP, geração de DOCX, upload de PDF assinado, fluxo de solicitação com link público e chat realtime, dashboard rico, distrato, histórico via trigger e export XLSX. A migração dos ~700 arquivos e das 221 pessoas + 374 contratos do sistema antigo fica aguardando a data de corte combinada.

## O que muda pro negócio

O freelancer deixa de ser pessoa em planilha paralela: cadastrar freelancer e amarrar a um job é operação dentro do califa-erp, com permissão por perfil e trilha de auditoria. GP pede, RH aprova, freelancer preenche sem precisar de login — o sistema cria pessoa e contrato na mesma transação.

## Estado atual (o que existe agora)

- **Cadastro de freelancer**: `/freelancers/lista` com busca por nome ou CPF, chips de status, 4 cards de análise rápida, toggle de ação prevista inline, botão de exportar XLSX e de criar novo. Dedup por CPF via endpoint `/api/freelancers/buscar-por-cpf`. ViaCEP preenche endereço no form.
- **Contratos**: `/freelancers/contratos/novo` amarrado a um job real do califa-erp (FK obrigatória pra `jobs(id)` em contratos novos; nullable pros legados). `nome_job` é snapshot no momento do cadastro. Gerar minuta DOCX (template portado do AgCaliforniaRH), upload de PDF assinado, download via URL assinada.
- **Distrato (antecipação de término)**: fluxo completo — solicitar com data proposta + motivo, gerar minuta de distrato, upload do assinado aplica a antecipação via RPC `aplicar_distrato_de_contrato` (preserva `data_termino_original`, seta `status_real=false`).
- **Solicitação de contratação**: GP cria → RH aprova (gera token com expiração 30 dias) → freelancer acessa `/form/freelancer-solicitacao/[token]` sem login → endpoint `submit` chama RPC `cadastrar_freelancer_via_solicitacao` que cria freelancer + contrato numa transação (dedup por CPF). Chat realtime GP↔RH no popover de cada solicitação, com badge de não lidas via RPC.
- **Dashboard rico** (`/freelancers`): hero escuro, 4 cards de análise, 5 cards de ações previstas com progress bar, grid "novos contratos por janela" (7/15/30/60 dias), "Solicitações pendentes" (RH/Fin) ou "Minhas solicitações" (GP/Produtor), tabela "Performance por responsável" com score colorido.
- **Histórico**: trigger `fn_freelancer_contrato_historico` grava uma linha em `freelancer_contrato_historico` por campo mudado em cada UPDATE. Aba Histórico no perfil renderiza linha do tempo com rótulos amigáveis.
- **Permissões**: admin/rh/financeiro escrevem; GP/produtor leem (via RLS + guardas na UI). Freelancer e colaborador não veem o módulo.
- **Migração dos legados**: fundação pronta — coluna `legado_id uuid unique` nas duas tabelas, spec documentada, MCP `supabase-rh-antigo` configurado no `.mcp.json`. Falta rodar o import dos 221 freelancers + 374 contratos quando chegar a data de corte, e o script Node pros ~700 arquivos (bucket antigo → `freelancer-arquivos` do califa-erp).

## Decisões que vão importar amanhã

- **`freelancer_contratos.job_id` é FK obrigatória pra `jobs(id)` em contratos novos** via check constraint `origem_sistema='califa_erp' => job_id NOT NULL`. Legados (migrados) ficam com `origem_sistema='ag_california_rh'` e `job_id=NULL`. Mudar isso quebra o import.
- **`nome_job` é snapshot** no momento do cadastro — não acompanha rename do job real. Trocar o job no form atualiza o snapshot; a view `freelancers_com_status` traz também `job_nome` atual do join com `jobs` pra UI mostrar os dois quando precisar.
- **View `freelancers_com_status` tem SECURITY INVOKER=true**. Precisa continuar assim pra respeitar RLS das tabelas base; mudar pra DEFINER vaza dados cross-tenant.
- **Rota pública no middleware**: `/form/freelancer-solicitacao/` e `/api/public/freelancer-solicitacao/` estão liberadas em `lib/supabase/middleware.ts`. Qualquer refactor no middleware precisa preservar.
- **Endpoint público usa `createServiceClient()`**. Validação de token é a única defesa — qualquer bug no `submit` route vaza dados cross-tenant. A RPC `cadastrar_freelancer_via_solicitacao` tem SECURITY DEFINER com `SET search_path=public` + lock FOR UPDATE pra evitar race condition.
- **Chat realtime** usa `supabase.channel('chat-solicitacao-<id>').on('postgres_changes', ...)` com envio otimista e dedup por id. Puxar o nome do autor acontece no cliente após o INSERT chegar via realtime (segunda query). Se virar gargalo, movemos pra RPC single-shot que retorna mensagem + nome.
- **Paths de arquivo no bucket seguem convenção fixa**: `{tenant_id}/contratos/{contrato_id}/{minuta|assinado|distrato-minuta|distrato-assinado}.{ext}` e `{tenant_id}/freelancers/{freelancer_id}/cartao-cnpj.{ext}`. RLS do bucket usa `split_part(name, '/', 1)::uuid` como tenant_id — mudar o schema de paths quebra o RLS.
- **Trigger de histórico é imutável** (sem policy UPDATE/DELETE). Audit só por INSERT via trigger. Adicionar campo novo em `freelancer_contratos` que precisa ser auditado exige adicionar branch nova em `fn_freelancer_contrato_historico` — não é automático.
- **Dependência `docx@9.11` adicionada**. Registrada em `next.config.js` `serverComponentsExternalPackages`. Lib `extenso@3` já estava no projeto; `exceljs` idem.
- **Audit log em bulk**: pros 595 registros da migração (221 freela + 374 contratos) planejamos um único evento `freelancers.migracao_executada` com metadata sumária, não um evento por linha. Decisão pra não explodir `audit_events`.

## O que fica pra próxima sessão

- **Objetivo**: validação visual + ajustes de UI/UX no `/freelancers` antes de puxar dados reais. Antonio vai subir o dev local, rodar os fluxos end-to-end (cadastro manual, contrato+DOCX+upload, solicitação com link público, chat realtime, distrato, histórico, export XLSX), e trazer o que precisa ajustar.
- **Por onde começar**: ler o memory `project_modulo_freelancers.md` que foi salvo nesta sessão — tem o resumo técnico. Depois esperar o Antonio listar os ajustes de design/UX.
- **O que já está pronto pra suportar**: todas as peças do módulo estão em main (18 commits sequenciais 04fb3c9e → 39b83bf9), typecheck e lint limpos, migrations aplicadas no banco de produção.
- **Depois da validação**: executar Task 028 (import dos 221 freelancers + 374 contratos via MCP `supabase-rh-antigo` já configurado) e criar Task 028b (script Node pra migrar ~700 arquivos entre os dois buckets de Storage, com env vars `AG_RH_SUPABASE_URL` + `AG_RH_SUPABASE_SERVICE_ROLE_KEY`).

## Rastros técnicos

Migrations aplicadas:

```
20261016000001_freelancers_f1_tabelas_base.sql
20261016000002_freelancers_f2_contratos_tabela_e_bucket.sql
20261016000003_freelancers_f2_view_status.sql
20261016000004_freelancers_f3_solicitacoes_tabelas.sql
20261016000005_freelancers_f3_rpc_cadastrar_via_solicitacao.sql
20261016000006_freelancers_f4_rpc_aplicar_distrato.sql
20261016000007_freelancers_f4_historico_contrato.sql
20261016000008_freelancers_f5_coluna_legado_id.sql
```

Commits (ordem cronológica):

- `04fb3c9e` — tabelas base `freelancers` e `freelancer_cargos` (fase 1 task 1)
- `760c0801` — casca navegável + sub-nav (fase 1 task 2)
- `06fc6a51` — lista com busca/filtro + dialog gerenciar cargos (fase 1 task 3)
- `7ccd69bb` — CRUD manual novo/perfil/editar (fase 1 task 4)
- `5fb08f67` — tabela de contratos + bucket Storage (fase 2 task 1)
- `dbe681bb` — view `freelancers_com_status` (fase 2 task 2)
- `b8f63653` — CRUD de contrato (fase 2 task 3)
- `9b96010d` — minuta DOCX + upload PDF assinado (fase 2 task 4)
- `16852c5d` — lista com status e cards de análise rápida (fase 2 task 5)
- `5ca811c5` — tabelas de solicitação + chat realtime (fase 3 task 1)
- `09f3e80e` — UI das solicitações com CRUD completo (fase 3 task 2)
- `036240a0` — rota pública + endpoint submit atômico (fase 3 task 3)
- `7d9caedb` — chat realtime no popover (fase 3 bônus)
- `2a13bf74` — dashboard rico do módulo (fase 4 task 1)
- `6ef7283e` — fluxo de distrato (fase 4 task 2)
- `7bc1d13c` — export XLSX + toggle ação prevista inline (fase 4 task 3)
- `04377c9a` — histórico via trigger + aba Histórico (fase 4 task 4)
- `e45f4dd7` — fundação da migração legados (fase 5 em espera)
- `39b83bf9` — chore: move freelancers 011-027 de active pra done
