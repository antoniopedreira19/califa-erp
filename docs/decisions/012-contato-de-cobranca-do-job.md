# 012 — Contato de cobrança é obrigatório para enviar o job à abertura

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** modal "Enviar job para abertura", na tela da versão
(`/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]`). Decisões do Tiago
em 17/08/2026.

## Decisão

**Enviar um job para abertura exige ao menos um contato de cobrança.** Por
linha: **nome obrigatório, e-mail obrigatório, número opcional**. O botão
"+ Adicionar contato" acrescenta linhas; a lixeira remove (desabilitada
enquanto houver só uma).

Os contatos vão para a tabela nova **`jobs_contatos`**, uma linha por
pessoa, com `tipo = 'cobranca'` e `ordem` pela posição no formulário.

**Contato de PAGAMENTO foi descartado** nesta entrega. O CHECK da coluna
`tipo` já aceita `'pagamento'` para não exigir migration nova se a ideia
voltar à mesa — a aplicação, hoje, grava só `'cobranca'`.

## Por quê

O financeiro precisa saber **a quem cobrar no cliente**, e isso não está no
cadastro do cliente: muda de job para job (praça, evento, área que aprovou
a verba). Quem sabe é a produção, no momento em que manda o job para
abertura — por isso o dado é digitado ali, e não herdado de `clientes`.

Tabela, e não coluna `jsonb` em `jobs`, porque são N contatos com campos
próprios: "e-mail obrigatório" vira constraint em vez de convenção de quem
escreve o JSON, e o financeiro pode filtrar e ordenar por contato depois.

## Onde a regra mora

- **Cliente** (evita o round-trip e destaca a linha torta):
  `faltamCampos` em
  `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/enviar-job-modal.tsx`.
- **Servidor** (o portão de fato): `contatos_cobranca` em
  `aberturaJobSchema` (`lib/validations/abertura-job.ts`), validado por
  `enviarJobParaAbertura`. O campo chega como JSON num campo do FormData e
  é parseado antes de validar; payload ilegível vira array vazio e cai na
  mensagem "Informe ao menos um contato de cobrança.".
- **Banco:** `supabase/migrations/20260817000001_jobs_contatos.sql`.
- **Tipo à mão:** `JobContato` em `lib/types.ts` (o TypeScript não lê o
  banco).

## Renomeação que veio junto

O campo de texto livre do mesmo modal deixou de se chamar "Observações" e
passou a **"Descritivo"** (no formulário e na conferência) e **"Descritivo
do Job"** nas duas telas do financeiro que leem o mesmo dado — diálogo de
conferência da fila de abertura e detalhe do job no financeiro. **A coluna
continua `jobs.observacoes`**, assim como o campo do form, o schema Zod e
`OBSERVACOES_MAX`: mudou o rótulo, não o dado.

## O que ficou de fora, de propósito

- **GRANT de `delete`** em `jobs_contatos`. Nenhum fluxo apaga contato: a
  lixeira do modal remove linha do formulário **antes** de existir job.
  Quando houver tela de edição de contatos, a migration dela adiciona o
  grant e a policy.
- **Edição dos contatos depois do envio.** O modal reaberto ("Ver dados do
  job") mostra os contatos gravados em modo leitura, como todos os outros
  campos dele. Jobs anteriores a 17/08/2026 não têm contato e exibem
  "— nenhum contato registrado".
- **Herdar contato do cadastro do cliente** como sugestão inicial. Faz
  sentido, mas exigiria decidir de onde herdar (cliente? produto?) e não
  foi pedido.
- **Leitura dos contatos pelo financeiro.** A tabela nasce nesta entrega
  com a gravação; exibir os contatos nas telas do financeiro entra quando
  a tela de abertura for refinada (Tela 3.1 do plano).

  > ⚠️ **17/08/2026 — esta linha estava errada, e foi resolvida.** A Tela
  > 3.1 cobriu só os itens 02a e 03 do protótipo e passou sem tocar nos
  > contatos, como o plano mandava — o dado ficou sendo só de escrita, e a
  > justificativa desta própria decisão ("o financeiro precisa saber a
  > quem cobrar") não se cumpria.
  >
  > A leitura entrou em **quatro** telas do financeiro, por decisão do
  > Tiago: a conferência da fila de abertura
  > (`abertura-de-job/conferencia-dialog.tsx`), o job aberto
  > (`financeiro/jobs/[jobId]`), e as duas abas de Contas a Receber —
  > **Faturamento** e **Títulos a Receber**. As duas apresentações moram
  > em `components/financeiro/contatos-cobranca.tsx`, e a query em
  > `lib/data/contatos-cobranca.ts`.
  >
  > As duas últimas **revertem** o que a
  > [017](017-faturamento-agrupado-parcial-e-avulso.md) registrou horas
  > antes ("contato de cobrança não entra nesta tela"). Decisão do mesmo
  > dia, tomada depois de ver a lacuna inteira.
