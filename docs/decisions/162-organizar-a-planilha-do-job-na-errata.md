# 162 — A errata organiza a planilha do job: ordem, agrupamento novo, renomeado e o vazio que sai

**Data:** 2026-10-09
**Status:** implementada em 09/10/2026 (migration `20261009300001`).
**Quem decidiu:** Tiago, em 09/10/2026, a partir do protótipo interativo
"Organizar na errata" (https://claude.ai/artifact/Exc6EikwGzVbx9i1ZNry1z).
**Revê:** a decisão 104 deixou a planilha do job de fora ("errata e travas
próprias"). Agora ela entra, e só pela errata.

## A ideia em uma frase

Na Planilha Interna do job, **dentro da errata**, o item muda de lugar
pela alça (como no orçamento, decisão 104) e pode trocar de agrupamento; o
agrupamento se **renomeia** e **nasce**; e o agrupamento que **ficar vazio
sai** quando a errata é confirmada. Nada disso mexe em valor.

## As respostas do Tiago

| Pergunta | Resposta |
|---|---|
| Onde fica o nome novo? | **Só no job.** A versão aprovada continua como o cliente aprovou. |
| O item pode trocar de agrupamento? | **Sim**, como no orçamento. No modelo mensal, dentro do mesmo mês. |
| Quem? | Os papéis da errata (decisão 159): o produtor prepara, o GP e o administrador registram. |
| Quando? | **Só durante uma errata.** Fora dela a planilha não muda de organização. |
| Criar e apagar agrupamento? | Criar, sim. Apagar: o que ficar vazio (todos os itens foram para outro) **sai sozinho na confirmação** — não há botão de apagar. |
| A errata que só reorganiza volta ao mural do financeiro? | **Volta**, como toda errata, com uma mensagem dizendo que **nenhum valor foi alterado** e que os itens só foram reorganizados. |

## Como fica na tela

- **Alça (⋮⋮)** no recuo do item, ao passar o mouse, só com a errata
  ligada. Arrastar mostra a linha vermelha de inserção e o fantasma com o
  nome; sobre um agrupamento recolhido ou vazio, o item vai para o fim
  dele. **Alt + ↑ ↓** com a célula do item selecionada faz o mesmo e passa
  para o agrupamento vizinho na ponta. Esc desiste. Toda linha se move — a
  cancelada, a vermelha e a que já tem PP no financeiro —, porque mudar de
  lugar não mexe em valor.
- **Lápis** ao lado do nome do agrupamento: o campo abre no lugar, ✓
  confirma, ✕ ou Esc cancelam. Nome repetido (no job, ou no mês no
  mensal) é recusado na própria linha. O agrupamento renomeado ganha a
  pastilha "renomeado" (com o nome antigo na dica); o criado, "novo".
- **"Novo grupo"** no pé do corpo da planilha, a mesma linha tracejada do
  orçamento. No mensal, nasce no mês que está na tela.
- **Agrupamento vazio**: a linha "Sem itens neste grupo." ganha "Ele sai
  quando a errata for confirmada." quando ele ficou vazio nesta errata. O
  que já era vazio antes fica como estava. O criado e deixado vazio não
  chega a nascer.
- Tudo entra no **rascunho** da errata: o **Desfazer** (botão e Cmd+Z)
  volta cada passo; **Descartar** joga tudo fora.
- A **barra** e o **resumo** contam a organização depois dos valores
  ("2 itens movidos · ordem alterada · 1 grupo renomeado · 1 grupo novo ·
  1 grupo removido").
- O **pop-up de confirmação** ganha a seção "O que muda na organização".
  Quando a errata só reorganiza, o bloco de valores sai e a caixa diz que
  ela devolve o job ao mural, sem mudança de valor.
- A **errata pronta** do produtor guarda a organização; o GP que a abre
  continua dela.
- O **histórico de erratas** (Informações do Job) e o card da errata na
  **Comunicação** listam o que mudou na organização.

## Como o financeiro vê

- Na **fila do mural de abertura**, o job da errata que só reorganizou
  ganha a pastilha "Nenhum valor alterado · itens reorganizados".
- No **Resumo da errata** do mural: a caixa "Nenhum valor foi alterado"
  (a errata só reorganizou a planilha; faturamento, valor do job e custos
  seguem os mesmos), "Linhas afetadas: nenhuma", a linha "Organização" e a
  lista do que mudou.
- Na **revisão da abertura** (página do job no financeiro), a errata diz
  "nenhum valor alterado: os itens só foram reorganizados", e o texto de
  cima pede só o registro da revisão para liberar o faturamento.
- A planilha do job no financeiro, a conferência da abertura, a exportação
  interna e a visão agregada de jobs mostram os nomes e a ordem do job.

## Como é gravado

- **`jobs_grupos`** — os agrupamentos do job. Nascem como cópia dos da
  versão aprovada (os que já existiam ganharam a cópia por backfill; a
  abertura do job copia os do job novo, inclusive os vazios). A errata
  renomeia, cria (`criado_na_errata_id`) e tira (`removido_em`,
  `removido_na_errata_id`) — o removido fica no banco.
- **`grupo_versao_id`** é a ÂNCORA na versão: o agrupamento copiado, ou,
  no criado por errata, um agrupamento da versão do mesmo mês.
- **`jobs_itens_orcado.job_grupo_id`** — o agrupamento do job da linha, que
  as telas usam. `grupo_id` (FK para a versão) continua, e o gatilho
  `jio_grupo_do_job` o mantém igual à âncora. É dele que sai o MÊS da
  linha para quem já o lia (faturamento mensal, espelhos, `mes_do_pedido`,
  travas de mês enviado) — nada disso mudou. Por isso a linha não troca de
  mês: o gatilho recusa.
- **`jobs_erratas.estrutura`** — a lista do que a errata mudou na
  organização, com os nomes daquele momento. A errata sem linha de valor e
  com essa lista é a "só organização".
- **`registrar_errata_do_job`** aplica tudo na mesma transação: renomeia
  (em dois passos, para dois agrupamentos poderem trocar de nome), cria,
  grava a linha nova no agrupamento certo, grava a sequência inteira das
  linhas e tira os que ficaram vazios — recusando se algum ainda tiver
  linha. No fim confere que não há dois agrupamentos de pé com o mesmo
  nome no mesmo mês. Ela ainda aceita o agrupamento da versão nas linhas
  novas, para a aba aberta antes desta entrega.
- A **server action** confere o pedido contra o banco
  (`montarOrganizacao`): agrupamento do job, mês, nome, a sequência com
  todas as linhas uma vez só. **Quem sai é o servidor que decide** (o que
  ficou vazio nesta errata). Os meses já enviados para faturamento travam
  a organização deles, como travam o valor.
- A regra do que muda e de quem sai mora num lugar só:
  `lib/calculos/organizacao-errata.ts` (testes em
  `organizacao-errata.test.ts`), usada pelo rascunho da tela e pela action.
- Os pedidos de **save** (`save_pedir`, `save_enviar_pendentes`,
  `save_registrar_errata`) e a **alteração do financeiro** (decisão 115)
  passam a guardar o nome do agrupamento do job.

## O que ficou de fora

- Mudar a ordem dos **agrupamentos** (como na decisão 104, só os itens).
- A **Mídia Off** (agrupamento "meio · formato", decisão 147) ainda não
  tem job; quando tiver, a organização da planilha dela se decide lá.
- A **versão aprovada** e a exportação dela para o cliente não mudam.
