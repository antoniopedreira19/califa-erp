# 080 — Quem emite a nota e quem confirma o BV, conferido no servidor e no banco

**Data:** 2026-09-15
**Status:** aceita
**Contexto:** fecha três pendências da
[079](079-a-nota-fiscal-so-cobre-jobs-de-um-cliente.md): BV misturado com
job na RPC, a RPC não conferir o perfil de quem emite, e os dois clientes
"teste". Complementa a
[017 §7](017-faturamento-agrupado-parcial-e-avulso.md) ("BV nunca entra em
NF agrupada").

## As regras (Tiago, 15/09/2026)

> 1. **Emitir nota é do financeiro** (e do administrador). A produção não
>    emite. Por enquanto a NF é emitida por fora, e o financeiro a registra
>    na fila de faturamento, anexando o PDF.
> 2. **Enviar o job para faturamento é do GP** (e do administrador),
>    quando o faturamento é acertado com o cliente, com as informações do
>    formulário de envio para o financeiro emitir a nota. Produtor e
>    freelancer não enviam. Já era assim (`jobs.enviar_faturamento`).
> 3. **Confirmar o BV é do GP** (e do administrador). Quem edita o job
>    continua lançando e negociando o BV; confirmar, não.
> 4. **O BV só sai em nota própria, contra o fornecedor dele.** Nunca na
>    nota do cliente, nunca junto de outro item, nunca em nota de outro
>    fornecedor.

A trava do BV **não** tem a ver com associar o BV ao job — isso já existe
(071, 073) e não mudou. Ela impede que o BV, que é dinheiro que o
fornecedor devolve, seja cobrado na nota do cliente.

---

## O que estava errado

"Role" aqui é o perfil do usuário no tenant (`tenant_members.role`):
administrador, financeiro, gerente_producao, produtor, freelancer.

| Regra | Tela / action | RPC `emitir_faturamento` |
|---|---|---|
| Quem emite nota | admin e financeiro | **qualquer membro do tenant** |
| BV junto de outro item | recusado | **aceito** |
| BV sozinho na nota do cliente | tela não oferece | **aceito** |
| BV em nota de outro fornecedor | tela não oferece | **aceito** |
| Quem confirma o BV (`confirmarBv`) | `orcamentos.editar`: admin, GP **e produtor** | — |

A RPC é SECURITY DEFINER e pode ser chamada direto pela API do Supabase por
qualquer usuário logado, pulando tela e action. Quando a pendência foi
anotada todo mundo era administrador; em 15/09/2026 o tenant tinha 1
financeiro, 1 gerente_producao, 1 produtor e 2 freelancers — um deles uma
pessoa real.

## Confirmado (15/09/2026)

Simulações como `authenticated`, cada uma numa transação com rollback.
Nenhuma nota ficou.

| Simulação | Antes | Depois |
|---|---|---|
| "GP Teste" (gerente_producao) emite nota do JOB-0029 | **aceita** | **recusada**: "Apenas administrador ou financeiro pode emitir nota fiscal." |
| "Financeiro Teste" emite a mesma nota | — | **aceita** |
| Nota da Pevetech com JOB-0029 + BV da AIRBNB | **aceita**, e o BV saiu da fila | **recusada**: "BV tem o fornecedor como contraparte e precisa ser faturado individualmente." |
| Nota da Pevetech só com o BV da AIRBNB | **aceita** | **recusada**: "BV não entra na nota do cliente: ele é faturado numa nota própria, contra o fornecedor." |
| BV da AIRBNB numa nota de outro fornecedor | **aceita** | **recusada**: "Este BV é do fornecedor AIRBNB BRASIL, e a nota é de outro fornecedor." |
| BV da AIRBNB na nota da própria AIRBNB | — | **aceita** (o uso legítimo segue) |
| JOB-0029 + JOB-0010, clientes diferentes (079) | — | segue **recusada** |

Antes de pôr a trava de perfil, conferido que o `activeRole` da sessão sai
de `tenant_members.role` (`get_session_context`) e que `profiles.role` e
`tenant_members.role` batiam para todos os usuários — a RPC e a action
olham a mesma coisa, e ninguém que emite hoje pela tela é barrado.

## A correção

- **Banco** —
  `supabase/migrations/20260915000002_emitir_faturamento_perfil_e_bv.sql`:
  logo depois da checagem de tenant, o usuário precisa estar ativo com role
  `administrador` ou `financeiro`; havendo BV, ele é o único item e a nota é
  de BV (e nota de BV só cobre BV); no laço dos itens, o BV é do tenant e do
  fornecedor da nota. **Sem número de decisão dentro da função**, de
  propósito (ver 079, "Número").
- **Permissão** — `jobs.confirmar_bv: ["administrador", "gerente_producao"]`
  em `lib/permissoes.ts`; `confirmarBv` passa a exigi-la. Teste novo em
  `lib/permissoes.test.ts`.
- **Tela** — `podeConfirmarBv` nasce em `carregar-detalhe.ts` (quem pode
  mexer no job **e** tem a permissão) e desce, como prop obrigatória, por
  `jobs/[jobId]/page.tsx` → `job-realizado-section.tsx` →
  `job-item-realizado-table.tsx` → `bv-dialog.tsx` (`podeConfirmar`). Sem a
  permissão, o botão Confirmar some e o rodapé diz "A confirmação do BV é
  do administrador ou do gerente de produção." As telas só de leitura
  (`financeiro/jobs/[jobId]`, conferência da abertura) e o orçamento mandam
  `false`. Conferido no navegador como administrador (JOB-0029 › Item 3 ›
  "Adicionar BV": o Confirmar aparece, sem o aviso). A visão do produtor não
  foi aberta — não dá para entrar com outra conta nesta sessão —, e fica
  coberta pelo teste da matriz e pela trava da action.
- **A action `emitirFaturamento` não mudou.**

## Os dois clientes "teste"

Os dois foram criados pelo Antonio em 30/07/2026. A pedido do Tiago, o que
**não tem CNPJ** (`93afec64`, código `teste22`, o do projeto
`teste22-0001/26` e do JOB-0010) virou **"Teste 22"**; o outro ("Teste", com
CNPJ) ficou como estava. Nada foi apagado.

Feito por SQL pelo MCP, e não pela tela, porque a edição de cliente exige
CNPJ (desde 09/09) e este cliente não tem — salvar pela tela obrigaria a
inventar um. A marca principal (`PRD-01`) acompanhou o nome, como a tela
faz, e a auditoria `cliente.editado` foi gravada com de/para e motivo.

## O que ficou de fora, de propósito

- **As outras RPCs SECURITY DEFINER do financeiro** (baixas, estornos,
  aprovar e desaprovar PP, cancelar nota, fatura do cartão) seguem
  conferindo só o tenant; o perfil está só nas actions. Decisão do Tiago:
  só `emitir_faturamento` agora.
- **A policy de UPDATE de `itens_bv`** deixa qualquer membro do tenant
  alterar o BV direto pela API — inclusive a situação, o que contorna a
  trava de `confirmarBv`.
- **A RPC não exige BV com situação `confirmado`.**
- **`emitido_por` continua vindo do payload.**
- **Empresa emissora da nota × empresa do job** (079) segue sem regra.
