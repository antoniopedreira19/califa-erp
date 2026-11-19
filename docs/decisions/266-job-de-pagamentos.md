# 266 — Job de Pagamentos: o financeiro cria um job aberto, só para lançar custos

**Data:** 2026-11-18
**Status:** aceita e implementada em 18/11/2026 (protótipo v6 aprovado pelo Tiago no mesmo dia).
**Quem decidiu:** Tiago, em 18/11/2026 ("pode implementar, o protótipo está aprovado").

## O problema

Há pagamentos que não pertencem a um job de cliente: acertos de coisas que já aconteceram, custos da própria empresa que precisam de PP. Hoje, para a produção gerar a PP, alguém tem que inventar um orçamento, aprovar uma versão e mandar o job para a fila de abertura, e o job sai com GP, produtor, marca e faturamento que não existem.

## Decisão

1. **Botão "Criar Job de Pagamentos"** em Financeiro › Abertura de Job › **Visualizar Jobs**, ao lado dos filtros. O "Exportar" desce para a linha da busca.
2. **O formulário** (pop-up), na ordem do protótipo:
   - **Nome do job** · **Projeto unificado** (escolher um existente ou criar um novo, como na abertura: o "+" ao lado do campo reserva o projeto novo depois de conferir o nome, o lápis troca o nome e o ✕ limpa; o novo nasce com o job e fica quando a empresa muda — Tiago, 19/11/2026) · **Abertura** (hoje, fixa);
   - **Código** (o próximo da sigla do cliente, previsto) · **Serviço** "Pagamentos" (fixo, "Sem faturamento.") · **Categoria** "Pagamentos" (fixa);
   - **Empresa** ("É também o cliente do job.") · **Regional** (as da empresa) · **Competência** (trimestre e ano);
   - **Descritivo do Job**, obrigatório: o motivo da abertura.
3. **Sem cliente e sem marca no formulário:** o cliente do job é a própria empresa. Cada empresa passa a apontar para o seu cliente (`empresas.cliente_id`). CCH e Ventura ganharam cliente (CCH e VEN); o cliente CAL passou a se chamar "Agência California", com o mesmo código e os mesmos jobs.
4. **Sem GP e sem produtor responsáveis.** O banco aceita o vazio **só** no job e no projeto de pagamentos. Na Equipe do job não há troca de GP nem de produtor.
5. **O job nasce aberto**, sem orçamento visível e sem passar pela fila: aparece na hora em Jobs para a produção, e em Visualizar Jobs para o financeiro.
6. **Do Interno, só o "não fatura":** serviço Pagamentos, tipo F · Interno, sem save, sem honorário, sem imposto e sem faturamento. **O planejado não acompanha o orçado** (o orçado é sempre zero).
7. **Sem errata:** na planilha do job, item novo, linha vermelha, agrupamento novo e planejado entram direto, pelo "Salvar". A PP já pode ser gerada em seguida.
8. **Rentabilidade como está:** o job aparece com faturamento zero e o custo planejado negativo, como qualquer custo.
9. **No "Editar registro" do financeiro:** sem o campo Marca; serviço, categoria e empresa travados (a empresa é também o cliente); regional, competência, projeto unificado e contas seguem editáveis.
10. **Sem curva de desembolso** (Tiago, 18/11/2026: "Sem curva"): o job de pagamentos não tem previsão de custos, com qualquer planejado. O custo só entra no fluxo de caixa quando a PP vira título (aprovada), "pulando" a etapa de previsão. A conta de pagamento fica opcional, como em todo job sem desembolso.
11. **A PP segue a regra do Comitê, como no Interno** (Tiago, 18/11/2026): só o faturamento previsto fica zerado; o resto continua. Como o orçado do job de pagamentos é sempre zero, a PP de item com planejado passa do orçado e o produtor e o GP a mandam ao Comitê ("Solicitar aprovação"); aprovada, ela é gerada e enviada como as outras. A PP da linha vermelha não vai ao Comitê (a regra padrão deixa a linha vermelha de fora), e o administrador aprova direto. O envio ao financeiro é do GP, ou do administrador, como em todo job.
12. **O projeto e o orçamento escondidos não abrem em Orçamentos** (Tiago, 18/11/2026: "podem ficar 100% escondidos e sem acesso", o job não tem orçamento de verdade): o "Voltar" do job de pagamentos leva à lista de Jobs, e o job cancelado também; as páginas de Orçamentos daquele projeto redirecionam para a visão agregada da produção (que reúne os jobs de pagamentos do mesmo projeto unificado); as ações de orçamento recusam o projeto; e o banco recusa orçamento novo nele fora da função de criação.

## Implementação

- **Banco** (`20261118700001_job_de_pagamentos.sql`, aditiva):
  - `empresas.cliente_id` (com índice), os clientes CCH e VEN criados a partir dos dados das empresas, o nome do cliente CAL, e o vínculo das empresas com os clientes (inclusive a Empresa Teste do Sandbox com o cliente TES).
  - `categorias_dominio.job_de_pagamentos`, o serviço e a categoria Pagamentos em cada tenant, e o gatilho `guarda_categoria_de_pagamentos`.
  - `jobs.de_pagamentos`, `projetos.de_pagamentos` e `projetos.projeto_financeiro_de_pagamentos_id` (um projeto da produção, escondido, por projeto unificado).
  - `responsavel_id` aceita nulo em `jobs` e `projetos`, com os CHECKs `chk_jobs_gp_vazio_so_no_de_pagamentos` e `chk_projetos_gp_vazio_so_no_de_pagamentos`; gatilhos `guarda_job_de_pagamentos` (o job só nasce pela função, sem GP nem produtor, e serviço e categoria não mudam) e `guarda_projeto_de_pagamentos`.
  - `planejado_espelha_orcado` com um ramo a mais no começo: no job de pagamentos a linha é F · Interno, orçado zero, sem save, e o planejado fica como a produção digitou.
  - `criar_job_de_pagamentos(...)`: numa transação, o projeto unificado (se for novo), o projeto escondido, o orçamento aprovado e vazio (V1, 0% de honorário e de imposto, com o agrupamento "Pagamentos"), o job aberto, a competência e a foto da abertura. Só administrador e financeiro.
  - `salvar_planilha_do_job_de_pagamentos(job, conteudo)`: linhas novas, agrupamentos novos e planejado, sem errata. Administrador, GP e produtor, com o job aberto ou em produção.
  - Permissão só para `authenticated`.
- **Banco** (`20261118700002_orcamento_so_pela_funcao_no_projeto_de_pagamentos.sql`, aditiva): gatilho `guarda_orcamento_de_pagamentos` em `orcamentos` (inserir ou mover orçamento para projeto de pagamentos só pela função).
- **Fluxo de caixa:** sem mudança. A `vw_fluxo_caixa` só prevê custo a partir da curva (`jobs_previsao_custo`); sem curva, o job aparece no fluxo pelos títulos das PPs.
- **Financeiro:** `criar-job-de-pagamentos.tsx` (o botão e o pop-up), `actions-job-de-pagamentos.ts` (as opções e a criação, com os códigos de job, projeto e orçamento e a auditoria `job.pagamentos_criado`), `jobs-abertos-list.tsx` (o botão, o Exportar na linha da busca e o aviso "Job … criado e aberto"), `lib/validations/job-de-pagamentos.ts`. No registro: `abertura-form.tsx`, `dados.ts`, `actions.ts` e `lib/validations/abertura-financeiro.ts` (marca nula só no job de pagamentos; o servidor recusa a troca da empresa e recusa curva no job de pagamentos).
- **Jobs:** `actions-job-de-pagamentos.ts` (o "Salvar" da planilha, auditoria `job.planilha_de_pagamentos_salva`), `errata-rascunho.ts`, `errata-barra.tsx`, `job-realizado-section.tsx` e `job-item-realizado-table.tsx` (sem errata, planejado livre, sem "Editar orçado" nem "Ver versão aprovada"), `ficha-job.tsx` (envio para abertura "Não se aplica · criado pelo financeiro", sem a linha do orçamento aprovado e sem link para o projeto), `carregar-detalhe.ts`, `lib/data/equipe-do-projeto.ts`.
- **Orçamentos:** `orcamentos/[projetoId]/layout.tsx` redireciona o projeto de pagamentos para `/jobs/projeto/[projetoId]`; `assertProjetoDoTenant` (em `orcamentos/[projetoId]/actions.ts`) recusa criar, editar, arquivar e reativar orçamento nele; o projeto de pagamentos não aparece na lista, e o serviço e a categoria Pagamentos não aparecem para escolha em orçamento nem em Cadastros › Categorias (`lib/data/servicos.ts` e os filtros `job_de_pagamentos = false`). A abertura recusa trocar um job comum para Pagamentos e vice-versa.
- **Conferido no Sandbox** (TES-1039/26): criação, o job em Jobs para o GP, planilha salva direto (item e linha vermelha, orçado zero, nenhuma errata), o formulário da PP com o planejado, e o "Editar registro" salvo sem marca e sem curva.
- **Conferido na versão publicada, no Sandbox:** a PP-00956 (R$ 1.800,00, do administrador) gerada, enviada, aprovada pelo financeiro e no fluxo de caixa do job só como título a pagar em 12/2026, sem previsão; o produtor lançou "Taxa de cartório" (planejado R$ 300,00) sem errata, mandou a PP-00957 ao Comitê, o administrador aprovou, o produtor gerou e o GP enviou ao financeiro.

## Fica de fora

- **PDF da PP:** a assinatura do GP sai em branco, porque o job não tem GP.
- O projeto escondido aparece só na visão agregada da produção (com o nome do projeto unificado) e no quadro do job dentro do Comitê; na planilha do job, o rastro do orçamento é o nome do agrupamento "Pagamentos".
- O cabeçalho do job mostra "sem planejado" e "sem realizado" sob o resultado: com valor do job zero não há percentual, como no Interno (rentabilidade "como está").
