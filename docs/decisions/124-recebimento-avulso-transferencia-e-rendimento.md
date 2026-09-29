# 124 — Recebimento avulso, transferência entre contas e rendimento de aplicação viram títulos a receber

**Data:** 2026-09-28 (decisões) · 2026-09-29 (implementação)
**Decidido por:** Tiago
**Migrations:** `20260929600001_recebimento_avulso_e_rendimento.sql`,
`20260929600002_origem_transferencia.sql`,
`20260929600003_transferencia_entre_contas.sql` e
`20260929600004_excluir_titulo_receber_avulso.sql`
**Protótipo aprovado:** seção 1 de https://claude.ai/artifact/AXDeLzhBNzNWyvao8S9gZ7 (versão 4)

---

## 1. O que o Tiago pediu

> Incluir transferências bancárias entre nossas contas; registrar
> rendimento mensal líquido nas contas de aplicação. Acredito que tudo
> isso poderá ser resolvido com uma opção de registrar um recebimento
> avulso.

O botão **"Recebimento avulso"** de Contas a Receber › Títulos a Receber
abre um diálogo com três tipos: recebimento avulso, transferência entre
contas e rendimento de aplicação. A Conciliação Bancária não ganhou nada
na tela (pedido dele): ela só mostra as linhas.

## 2. As regras

| Pergunta | Resposta do Tiago |
|---|---|
| Os três viram título? (D16) | **Sim**, em Títulos a Receber, com **"Criar"** e **"Criar e dar baixa"**, como o lançamento avulso de Títulos a Pagar (confirmado em 28/09 com o print da "Nova conta avulsa"; o protótipo v4 não mostra isso e tem um botão só). Cancelam pelo olho. |
| Estorno? | **Recebimento avulso tem**; transferência e rendimento **não** (D16). |
| Recebimento avulso | Sem job; empresa; rateio em uma ou mais regionais com percentual; centro de custo pela lista com busca; "Recebido de" opcional. |
| Rendimento (D3 b) | Pede **empresa e regional** (rateio se mais de uma): a DRE gerencial precisa. Só o **valor líquido**. |
| Transferência (D17.2) | **Sem empresa, sem regional e sem plano de contas**: a conta já diz de qual CNPJ é o dinheiro. |
| Transferência entre CNPJs (D4) | **Pendente.** Por ora só entre contas do mesmo CNPJ; entre CNPJs diferentes é recusada. |
| Como gravar a transferência sem empresa e sem plano? (29/09) | **Opção A**: empresa e plano vazios só nas linhas de transferência, visíveis a administrador e financeiro, fora do DRE e do fluxo consolidado. "No futuro iremos revisar esse fluxo." |

**Aprovado junto (29/09):** recebimento avulso e rendimento moram na conta
avulsa (a do "Lançamento avulso" do pagar), com código na sequência AV;
o rendimento só entra em conta do tipo Investimento, um por conta e por
mês, no subtipo novo "10 · Receita Financeira · Rendimento de aplicação".

## 3. Como ficou

### Recebimento avulso e rendimento — conta avulsa de natureza entrada

- Coluna nova `contas_avulsas.tipo_entrada` (`recebimento_avulso` ou
  `rendimento`). Sem ela a linha continua sendo do contas a pagar — o
  estorno de compra no cartão, que também é entrada, inclusive.
- Rendimento: `conta_bancaria_prevista_id` (a conta de aplicação) e
  `competencia` (o mês, dia 1), índice único por conta e mês, e um
  gatilho que só deixa a baixa entrar nessa conta.
- Criação por `criar_titulo_receber_avulso(p_dados, p_rateio)`, com as
  regras dos dois tipos no banco. A baixa é a de sempre da avulsa
  (`dar_baixa_avulsa_com_plano`); cancelar e estornar são os da decisão 120.
  Um gatilho recusa estorno de rendimento em qualquer caminho.
- **"Criar e dar baixa"** cria e abre a baixa em seguida (data, conta e
  centro de custo), no molde do pagar. No rendimento a baixa vem com a
  conta de aplicação e o centro de custo travados.
- Títulos a Pagar e `vw_a_pagar` (os números de "a pagar" da Home) deixam
  de trazer essas linhas.

### Transferência — tabela própria, duas pernas no extrato

- O título mora em `transferencias_contas` (TR-00001…): conta de origem,
  conta de destino, valor, data prevista, descrição, status `a_transferir`
  ou `transferida`. Leitura pela RLS (admin e financeiro); escrita só pelas
  funções `criar_transferencia`, `dar_baixa_transferencia` e
  `cancelar_baixa_transferencia`.
- Feita, ela vira **duas linhas** em `lancamentos_financeiros`: a saída na
  conta de origem (`transferencia_saida`) e a entrada na de destino
  (`transferencia_entrada`), as duas com `transferencia_id` e **sem
  empresa e sem plano**.
- Para isso `empresa_id`, `plano_conta_tipo_id` e `plano_conta_subtipo_id`
  deixaram de ser NOT NULL — mas o CHECK
  `chk_lancamento_sem_empresa_so_transferencia` amarra: vazios **só** nas
  duas origens de transferência; toda outra origem continua exigindo os
  três. As políticas de `lancamentos_financeiros` ganharam um ramo para a
  linha de transferência (admin e financeiro); o ramo antigo é o mesmo.
- "Criar e dar baixa" aqui é uma chamada só: a transferência já nasce feita
  na data informada. A que nasceu a transferir se efetiva pelo "Dar baixa",
  que só pede a data.
- **Fora do fluxo consolidado:** a tela do fluxo de caixa filtra as duas
  origens. **No extrato:** a conciliação mostra as duas linhas, uma em cada
  conta, com "Transferência entre contas · fora do DRE" no centro de custo.

### Excluir título criado por engano (aprovado em 29/09)

O protótipo não previa exclusão; o Tiago aprovou. A linha em aberto de
recebimento avulso, rendimento ou transferência ganha uma **lixeira na
calha** (o lugar do ⓘ das notas, que esses títulos não têm), com
confirmação. Só em aberto: o título baixado cancela a baixa antes, para a
exclusão nunca apagar movimento do extrato. Funções
`excluir_titulo_receber_avulso` e `excluir_transferencia`, com a régua de
admin ou financeiro e o log na mesma transação.

## 4. Achados que viraram correção

- **O extrato escondia linha sem plano.** A consulta da conciliação juntava
  o plano de contas com `!inner`: a transferência entraria no saldo e
  sumiria da lista. Virou junção opcional.
- **"A pagar" contava entrada.** `vw_a_pagar` trazia toda conta avulsa em
  aberto, sem olhar a natureza; um recebimento avulso apareceria como conta
  a pagar vencida na Home.
- **Segunda ligação entre conta avulsa e conta bancária.** A coluna
  `conta_bancaria_prevista_id` torna ambíguo qualquer embed entre as duas
  tabelas sem indicar a ligação; nenhum no código atual (conferido em
  29/09).

## 5. Pendências

- **D4:** transferência entre CNPJs diferentes (empréstimo entre empresas).
- **Home:** os números de "a receber" do mês continuam lendo só os títulos
  das notas.
- **Conciliação, visão consolidada:** "Entradas" e "Saídas" do período somam
  as duas pernas da transferência (por conta, é o certo; no total das
  contas, ela aparece dos dois lados).
