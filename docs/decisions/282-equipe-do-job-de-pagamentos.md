# 282 — A equipe do job de pagamentos e quem dela envia PP

**Data:** 2026-11-27
**Status:** aceita e implementada em 27/11/2026 (protótipo v10 aprovado pelo Tiago no mesmo dia).
**Quem decidiu:** Tiago, em 27/11/2026 ("B de cada job", com o botão "+" e a chave "Envia PP" por produtor; "pode implementar").
**Revê:** a decisão 266 (job de pagamentos), itens 4 e 11.

## O problema

Feedback da produção sobre os jobs de pagamentos (decisão 266): não havia como administrar a equipe nem liberar alguém para enviar PP. O job de pagamentos não tem GP nem Produtor Responsável, então só quem tinha o papel de GP (ou o administrador) enviava a PP; o produtor posto na equipe gerava a PP e ela ficava parada. E a equipe era a do projeto escondido, um por projeto unificado: os quatro jobs reais "Pagamentos Atrasados" (CAL-1004 a 1007) dividiam uma equipe só.

## Decisão

1. **A equipe é de cada job de pagamentos** (versão B do protótipo), não mais do projeto unificado. Mudar a equipe de um job não muda a dos irmãos.
2. **Sem responsável**: o job continua sem GP e sem Produtor Responsável (Tiago, 26/11).
3. **A chave "Envia PP" em cada produtor da equipe.** Ligada, o produtor envia a PP ao financeiro **como o GP**: a mesma aba de PPs, o mesmo "Enviar ao financeiro", reenvia a rejeitada, cancela a que está em avaliação, presta contas da verba e corrige a NF em avaliação — tudo o que o Produtor Responsável com a chave (decisão 174) já fazia. Pode ser mais de um produtor. O GP e o administrador da equipe enviam sempre (o papel); o freelancer gera a PP e não envia. O produtor que entra na equipe nasce com a chave ligada.
4. **Quem muda a equipe e a chave:** o financeiro, os GPs, os produtores e o administrador (e quem criou o job). Pelo botão **Equipe** da página do job, no módulo Jobs **e** no Financeiro (`/financeiro/jobs/...`), em jobs já abertos. Job encerrado, finalizado ou cancelado não muda.
5. **A equipe já no formulário "Criar Job de Pagamentos"**, logo abaixo do Descritivo do Job, opcional.
6. **Como se adiciona gente:** o botão "+ Adicionar pessoas" abre uma lista com busca, agrupada em GPs, Produtores e Freelancers, onde se marcam várias pessoas e se confirma com "Adicionar N" (Tiago, 26/11: adicionar um por vez no mesmo seletor "não funciona"). A equipe aparece agrupada, com o ✕ de cada um e, nos produtores, a chave. O financeiro não entra na lista; quem criou o job não aparece nela (comentários do Tiago no protótipo, 27/11).

## Implementação

- **Banco** (migration `20261127500001_equipe_do_job_de_pagamentos.sql`):
  - tabela `jobs_equipe_de_pagamentos` (job, pessoa, `envia_pp`), RLS de leitura para o tenant, sem escrita direta;
  - `salvar_equipe_do_job_de_pagamentos(job, membros)`: confere o papel (ou quem criou) e o job vivo, grava a equipe e a chave (que só fica ligada para quem tem o papel de produtor) e refaz a equipe do projeto escondido;
  - a equipe do projeto escondido (`projeto_responsaveis`, papel `equipe`) passa a ser **a soma das equipes dos jobs vivos dele**, gravada pela mesma função. É o que a RLS do freelancer (`is_freelancer_do_projeto`) e o "Meus" da Home leem, e por isso nada disso mudou;
  - `produtor_envia_pp_do_job` ganhou o segundo caminho (o produtor da equipe com a chave). Todas as policies e funções que já a chamavam — PP, anexos, prestação da verba, correção da NF — tratam esse produtor como o Produtor Responsável com a chave;
  - `criar_job_de_pagamentos` ganhou `p_equipe` (opcional): a equipe grava na mesma transação do job;
  - o que existia: a equipe do projeto escondido foi copiada para cada job dele **com a chave desligada** (no dia, uma produtora nos quatro jobs reais). Liga-se pelo Equipe.
- **Permissão:** `jobs.editar_equipe_de_pagamentos` (administrador, financeiro, GP, produtor). `JobParaEnvioDePP.enviam_pela_equipe` leva os produtores com a chave para `enviaPPNoJob` e `corrigeNfNoJob` — na página do job, no gate das ações de PP, no cancelamento e na correção da NF.
- **Telas:** `BotaoEquipeDoJobDePagamentos` (cabeçalho do job no módulo Jobs e no Financeiro) e `EditorDaEquipeDePagamentos` (o pop-up e o formulário). A visão agregada do projeto escondido não mostra mais o Equipe do projeto, e `salvarEquipeDoProjeto` recusa o projeto escondido.
- **"Meus" da lista de Jobs:** no job de pagamentos, é meu o job em cuja equipe estou (ou que criei), e não todos os do projeto escondido.
- **Auditoria:** `job.equipe_de_pagamentos_alterada` com quem entrou, saiu e teve a chave ligada ou desligada; a criação registra a equipe inicial em `job.pagamentos_criado`.

## Conferido no Sandbox (27/11/2026)

TES-1041/26 criado pelo formulário com a GP e a produtora do Sandbox (chave ligada), no mesmo projeto unificado do TES-1040/26, que continuou "Sem equipe". A produtora lançou o item, mandou a PP ao Comitê (orçado zero), o administrador aprovou, ela gerou a PP-00960 e a enviou ao financeiro (em avaliação, enviada pelo papel produtor). Com a chave desligada pela própria produtora no Equipe, o "Cancelar" e o "Prestar contas" da PP em avaliação sumiram para ela, e voltaram com a chave religada. O Equipe abre igual no Financeiro; o job comum TES-1002/26 segue com o Equipe do projeto.

## Fica de fora

- **Freelancer e "Meus" da Home** continuam por projeto: o freelancer posto na equipe de um job de pagamentos vê também os irmãos do mesmo projeto unificado (como já acontecia), e o cartão "meus jobs" da Home conta os irmãos. A lista de Jobs já recorta por job.
- **PDF da PP:** a assinatura do GP continua em branco no job de pagamentos (decisão 266).
