# CLAUDE.md

Este projeto é o ERP gerencial da Agência California. Ele será construído de forma incremental com Claude Code, GitHub, Next.js, React, TypeScript e Supabase.

## Prioridade do projeto

O sistema deve resolver primeiro o fluxo de gestão de projetos discutido com a California:

1. Login seguro.
2. Cadastro de clientes e fornecedores.
3. Criação de orçamentos comerciais.
4. Criação ou importação de versões do orçamento.
5. Exportação da versão do orçamento em planilha para envio externo ao cliente.
6. Aprovação de uma versão do orçamento.
7. Criação obrigatória do job vinculado ao orçamento e à versão aprovada.

Neste primeiro momento, orçamento usa apenas a visão **Orçado**. As visões **Planejado** e **Realizado** entram depois, quando o job operacional já existir.

## Decisão central de modelagem

O trabalho não nasce como pré-job.

O fluxo correto é:

```text
Orçamento
-> versões do orçamento
-> versão aprovada
-> job criado
```

As tabelas centrais são:

- `orcamentos`
- `versoes_orcamento`
- `jobs`

Não criar tabela `pre_jobs`. Não criar job antes da aprovação do orçamento.

No MVP, o gerente de projetos conversa com o cliente fora do sistema. O sistema deve permitir exportar a versão do orçamento em planilha. Envio automático por e-mail ou WhatsApp fica para fase futura.

## Banco: o fluxo do MCP (regra transversal, leia primeiro)

**Antes de qualquer trabalho neste projeto, leia `docs/FLUXO-BANCO.md`.** O Supabase **não é do time**: pertence a outro desenvolvedor, que cedeu a chave do MCP. Nada é criado pelo painel; toda estrutura nasce de migration versionada e aplicada pelo MCP.

**O ciclo, sem pular etapa:**
1. **Ler o banco pelo MCP antes de codar** — colunas, enums, constraints e o dado real, para não inventar estrutura que já existe.
2. **Escrever a migration** em `supabase/migrations/`, com o racional comentado no topo e prefixo numérico único.
3. **Aplicar pelo MCP** (`apply_migration`).
4. **Conferir pelo MCP que aplicou** — colunas, RLS, policies, GRANT para `authenticated` (e nada para `anon`), índices, e o dado quando houve backfill.
5. **Commitar a migration junto do código que depende dela**, no mesmo commit.

**Autorização (combinada em 12/08/2026):** mudança **aditiva** — coluna, tabela, índice, policy, backfill que preenche vazio, valor novo em enum — aplica direto. Mudança **destrutiva** — remover coluna/tabela/linha, alterar tipo de campo populado, renomear coluna em uso, backfill que sobrescreve — **para e pergunta antes**. Na dúvida, pergunta.

**O TypeScript não lê o banco.** Não há tipos gerados: `lib/types.ts` é escrito à mão. Migration que mexe em coluna usada pelo frontend termina atualizando o tipo correspondente, no mesmo commit — senão o campo fica invisível para o verificador e para o autocompletar.

## Performance é feature (regra transversal)

**Toda mudança de UI ou backend deve ser avaliada contra o guia de performance ANTES de codar.** Leia `docs/PERFORMANCE.md` — é a fonte-verdade sobre o que degrada o sistema, como detectar e como corrigir. Use o checklist do documento como filtro final antes de qualquer commit que toca em `app/(app)/**` ou `lib/supabase/**`.

**Regras não negociáveis:**
- `<Link>` em lista de 5+ itens navegáveis → `prefetch={false}` por default.
- Query só para contar/somar → use agregação separada, nunca embed pesado (`select("...embed:tabela(*)")`).
- Todas as queries independentes num server component → `Promise.all`, nunca em série.
- Toda migration nova → GRANT explícito para `authenticated` + índice em FK importante + policies RLS usam `(select auth.uid())`.
- `force-dynamic` não é redundante: funciona como freio de prefetch descontrolado. Só remover com plano de compensação (`prefetch={false}` nos Links relevantes).

Regressões de performance já custaram 2 iterações completas ao projeto — a última travou navegação a 33s. `docs/PERFORMANCE.md` documenta os case studies e os anti-padrões proibidos.

## Planilhas: cor e grade (regra transversal)

**Antes de tocar em qualquer planilha de orçamento ou job, leia as seções "Cores das planilhas", "Grades compartilhadas" e "Faixa do agrupamento" de `docs/09-identidade-visual-ui.md`.**

**Regras não negociáveis:**
- Cor de bloco vem de `app/(app)/_planilha/blocos.ts` — ORÇADO azul, PLANEJADO verde, REALIZADO laranja, RENTABILIDADE grafite. **Nunca escrever hex de bloco direto no JSX.**
- Planilha e card de Totais da mesma tela usam o MESMO `colgroup`, com `table-fixed`. Layout automático em planilha ou Totais é proibido: as duas tabelas nunca alinham.
- Valor de rentabilidade é sempre grafite, positivo ou negativo. Verde agora é do PLANEJADO.

As mesmas cores estavam repetidas em 8 arquivos e já haviam divergido entre si; a visão agregada de jobs ficou 1 semana com as colunas dos Totais desalinhadas das da planilha por usar largura automática. `docs/09-identidade-visual-ui.md` tem os case studies.

## Ortografia em português (regra transversal)

**Toda string que aparece pro usuário DEVE ter ortografia em pt-BR correta — com acentos, cedilha e til.** Sem exceção.

- ✅ "Descrição do serviço", "Especificações (opcional)", "Ação", "Não encontrado", "Você poderá", "É obrigatório"
- ❌ "Descricao do servico", "Especificacoes", "Acao", "Nao encontrado", "Voce podera", "E obrigatorio"

Vale pra: labels, placeholders, botões, títulos, subtítulos, mensagens de erro/toast, descrições de dialog, empty states, tooltips, mensagens de audit visíveis ao usuário. Vale pra **qualquer string que renderize numa UI ou volte pra um `setErro`/toast**.

Fica de fora (pode ficar sem acento, se preferir): identificadores de código (`nome_funcao`, `variavel`), keys de metadata técnica (`{ acao_tentada: "pedido_compra.emitida" }`), comentários internos (opcional; acento não quebra nada). **Mas SE tiver acento em identificador, TypeScript+webpack aceita — UTF-8 desde o dia 1.** A escolha de manter identificadores sem acento é convenção pra evitar problemas com ferramentas externas (ex: nomes de arquivo no S3), não limitação técnica.

Regra de ouro: **se o usuário lê aquela string, ela é português correto**. Se for interno (código, log, audit metadata), tanto faz — mas prefira consistência.

**Nunca escreva em briefs, specs ou plans "portuguese sem acento em código" pra subagents.** Isso já custou uma tela inteira ter que ser retrabalhada. A instrução correta é: "strings visíveis ao usuário com pt-BR completo; identificadores em código podem ficar sem acento por convenção".

## Regras para desenvolvimento com IA

- Leia `docs/FLUXO-BANCO.md`, `README.md`, `docs/00-visao-geral.md`, `docs/01-stack-e-arquitetura.md`, `docs/PERFORMANCE.md` e a task ativa antes de implementar.
- Não implemente módulos futuros antes da documentação e validação com o setor responsável.
- Mantenha escopo pequeno por task.
- Faça alterações com migrations versionadas no Supabase, seguindo o ciclo de `docs/FLUXO-BANCO.md`.
- Crie as tabelas, índices, constraints, policies e funções de banco dentro da task responsável por aquele domínio.
- Não antecipe tabelas de tasks futuras, exceto quando uma FK mínima for indispensável para concluir a task atual.
- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no navegador.
- Toda tabela operacional deve nascer com RLS planejado.
- Toda tabela operacional deve ter `tenant_id`, mesmo que no início exista apenas o tenant Agência California.
- Regras críticas não devem depender apenas do frontend.
- Use Server Actions ou Route Handlers para operações sensíveis.
- Registre auditoria para login, logout, aprovação de orçamento, criação de job e alterações críticas.
- Trate a base de dados como ativo estratégico da empresa.
- Antes de criar tabela nova, defina FKs, RLS, permissões, auditoria e índices.
- Não crie dados soltos sem referência quando houver relação de negócio clara.
- Antes de concluir uma task, rode lint/build quando o projeto já existir.

## Sequência de banco por task

- Task 001 cria a fundação de auth, tenant, perfis, vínculos, permissões e auditoria.
- Task 002 cria `clientes` e `fornecedores`.
- Task 003 cria `orcamentos`.
- Task 004 cria `versoes_orcamento`, `versoes_orcamento_itens` e `orcamento_importacoes`.
- Task 005 cria `jobs` e o vínculo obrigatório com orçamento aprovado.

## Stack aprovada

- Next.js App Router.
- React.
- TypeScript.
- Supabase Auth.
- Supabase Postgres.
- Supabase RLS.
- Supabase Storage.
- Tailwind CSS.
- shadcn/ui + Radix.
- lucide-react.
- React Hook Form + Zod.
- ExcelJS ou XLSX para importação de planilhas.

## Identidade visual

O ERP deve seguir a mesma identidade visual do projeto `C:\Projects\AgCaliforniaRH`.

Antes de implementar frontend na Task 001, consulte:

- `C:\Projects\AgCaliforniaRH\app\globals.css`
- `C:\Projects\AgCaliforniaRH\tailwind.config.ts`
- `C:\Projects\AgCaliforniaRH\components\sidebar.tsx`
- `C:\Projects\AgCaliforniaRH\app\(auth)\login\page.tsx`

Use a mesma base visual: vermelho California `#E74B56`, fundo claro `#FAFAFA`, texto principal `#282828`, sidebar escura, Inter, shadcn/ui customizado, botões arredondados, cards limpos, tabelas densas e interface profissional de sistema interno.

Não criar uma identidade nova para o ERP. Adaptar a identidade do RH para o contexto financeiro/gestão de projetos.

## GitHub e Vercel

- GitHub é a fonte oficial do código.
- Vercel é o deploy da aplicação web.
- Supabase é banco, auth, storage e RLS.
- Commits devem ser pequenos e descritivos.
- Features relevantes devem usar branch própria.
- Migrations devem ser versionadas.
- Nunca commitar `.env.local` ou secrets.
- Antes de sugerir deploy, rode lint/build quando disponíveis.

## Fora de escopo inicial

- DRE completo.
- Planejado e realizado do job.
- Contas a pagar e contas a receber.
- Envio automático de orçamento por e-mail ou WhatsApp.
- Pagamentos automáticos.
- Emissão automática de nota fiscal.
- Conciliação bancária.
- Mídia, RH e produção completos.

Esses pontos devem ser tratados em fases futuras.
