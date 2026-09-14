# 079 — A nota fiscal só cobre jobs de um mesmo cliente, e quem confere é o banco

**Data:** 2026-09-14
**Status:** aceita
**Número:** nasceu 076 e foi renumerada para 079 em 15/09/2026, antes de
subir — outra frente já tinha a 076 no `main`. Os comentários internos de
`emitir_faturamento` no banco ainda dizem "076"; leia-se 079.
**Contexto:** emissão de nota na aba Faturamento de
`/financeiro/contas-a-receber`. Fecha a pendência registrada na
[075](075-a-esteira-reconhece-a-nota-pelos-itens.md) e na nota de 14/09 da
[017](017-faturamento-agrupado-parcial-e-avulso.md). **Reforça a 017 §7**,
que já dizia a regra e só a garantia na tela.

## A regra

> **Uma nota fiscal só cobre jobs — e saldo em save — de um mesmo cliente:
> o cliente da nota.** O cliente de um job é o do projeto dele
> (`jobs.projeto_id → projetos.cliente_id`). **Quem garante é
> `emitir_faturamento`**, no banco. A tela avisa antes, comparando
> `cliente_id`, e nunca o nome.

---

## O defeito

"Regras críticas não devem depender apenas do frontend" (`CLAUDE.md`). Esta
dependia, e a trava da tela era mais frágil do que parecia:

| Camada | Conferia? |
|---|---|
| Lista (`faturarSelecionados`) | Sim, mas **pelo nome** do cliente |
| Drawer | Não. Grava a nota inteira no cliente da **primeira** linha |
| Action `emitirFaturamento` | Não. Aceita o `cliente_id` que o navegador manda |
| RPC `emitir_faturamento` | Não. E ela só confere se quem chama é do tenant, sem olhar a role |
| Constraint ou trigger | Nenhum em `faturamentos` nem em `faturamento_itens` |

**Por que o risco era concreto:** o cadastro tem **dois clientes chamados
"teste"**. Em 14/09/2026 só um deles tinha job na fila. No dia em que os
dois tiverem, a própria tela abre a nota agrupada, e a nota sai no CNPJ do
primeiro com o recebível do segundo dentro. Não há cancelamento de NF na
tela (017 §9): a nota errada só sai com intervenção no banco.

## Confirmado (14/09/2026)

Simulações como `authenticated`, com o perfil do Tiago, cada uma numa
transação com rollback. Nenhuma nota ficou: o banco segue com **1** nota
(`TESTE-ESTEIRA`, coerente, só Pevetech).

| Simulação | Antes | Depois |
|---|---|---|
| Nota no cliente Pevetech com R$ 1,00 do JOB-0029 (Pevetech) + R$ 1,00 do JOB-0010 ("teste") | **aceita**: nota, 2 itens, 1 título | **recusada**: "Uma nota fiscal cobre apenas jobs de um mesmo cliente: JOB-0010 é do cliente teste, e a nota é do cliente Pevetech." |
| Mesmo cliente: JOB-0029 + JOB-0033 (os dois Pevetech) | — | **aceita**: nota, 2 itens, 1 título |
| Item com `origem_id` do JOB-0029, mas a parcela do JOB-0010 | — | **recusada**, mesma frase |

**No navegador** (dev server do worktree, aba Faturamento, sem emitir nota):

| Seleção no Faturamento Agrupado | Resultado |
|---|---|
| JOB-0010 ("teste") + JOB-0029 (Pevetech) | chip "2 clientes diferentes"; "Não é possível agrupar jobs de clientes diferentes — A seleção tem 2 clientes (teste; Pevetech Inteligencia Artificial & Tecnologia LTDA)…"; formulário não abre |
| JOB-0029 + JOB-0033 (Pevetech) | chip com o nome do cliente; abre "Faturamento agrupado · Uma NF · 2 jobs"; fechado com Esc, nada emitido |

O caso dos homônimos (dois "teste" na fila) não pôde ser exercitado na tela:
só um deles tinha job pendente.

## A escolha do Tiago

Antes de corrigir, o Tiago pediu para conferir se a trava não seria
redundante. Não era — nenhuma camada de servidor conferia. Mas pôr a regra
**em duas** camadas de servidor seria: a RPC já devolve mensagens em pt-BR,
e a action já as repassa ("Falha ao emitir: …").

Escolhido: **trava na RPC + tela comparando por id.** A action não ganhou
consulta própria.

*(Descartadas: trava só na action, com uma consulta a mais e a RPC ainda
aberta a chamada direta; as três camadas, com a mesma conferência feita
duas vezes no servidor; e só a tela por id, que não atende o `CLAUDE.md`.)*

## A correção

- **Banco** —
  `supabase/migrations/20260914000002_nf_agrupada_so_de_um_cliente.sql`.
  `create or replace` de `emitir_faturamento` com a definição viva de
  14/09 e um bloco a mais no laço de validação dos itens: para cada item de
  `job` ou `save`, o cliente do job tem de ser o `cliente_id` da nota. É
  conferido **por dois caminhos** — o job do `origem_id` do item e o job da
  parcela (`envio_parcela_id`) —, porque a RPC não exige que sejam o mesmo
  job, e conferir só um deixaria a mistura passar pelo outro. O job também
  precisa ser do tenant da nota. Grants iguais (`authenticated` sim, `anon`
  não).
- **Tela** — `faturamento-list.tsx`: `clientesSelecionados` agrupa por
  `cliente_id`. Quando dois clientes diferentes têm o mesmo nome, a mensagem
  mostra os jobs de cada um ("teste — JOB-0010; teste — JOB-0040"), porque
  "teste, teste" não diz qual desmarcar.
- **Action** — sem mudança. A recusa chega à tela como "Falha ao emitir:
  Uma nota fiscal cobre apenas jobs de um mesmo cliente: …".

## O que ficou de fora, de propósito

- **BV misturado com job:** a action recusa, a RPC não.
- **Empresa emissora diferente da empresa do job:** a simulação usou uma
  empresa diferente da do JOB-0010, e nada reclamou. Não se sabe se é
  regra.
- **Exigir que a parcela do item seja do mesmo job do item** (a igualdade,
  e não só o cliente). O drawer sempre manda os dois do mesmo job.
- **A RPC não confere a role de quem chama.** Qualquer membro do tenant
  pode chamá-la direto pelo PostgREST; a trava de admin/financeiro está só
  na action. Hoje todos os perfis do tenant são `administrador`.
- **Os dois clientes "teste" duplicados** continuam no cadastro.
