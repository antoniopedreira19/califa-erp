# 092 — O código do cliente é automático, e congela no primeiro projeto

**Data:** 2026-09-18
**Decidido por:** Tiago
**Migrations:** nenhuma ainda — o backfill dos 9 cadastros fora do padrão
está descrito em §5 e **aguarda aprovação**.

---

## 1. O que a base mostrou

O campo **Código** do cadastro de cliente era digitado, com uma sugestão
automática: as **6 primeiras letras** do nome fantasia, que parava de
acompanhar assim que alguém digitasse por cima.

A varredura de 18/09/2026, antes de mexer em qualquer coisa:

| | |
|---|---|
| clientes cadastrados | **160** |
| com código de **3 letras** | **151** |
| com código de 6 letras | 3 |
| que batem com a sugestão automática de hoje | **5** |
| que não são nem as 3 primeiras letras do nome | **51** |

Ou seja: **a regra que o sistema sugeria não era a regra que a agência
usava.** O padrão real é de 3 letras, e o campo vinha sendo corrigido à
mão em praticamente todo cadastro.

Os 51 que fogem das 3 primeiras letras têm lógica humana, e é ela que o
gerador não alcança:

| cliente | código | por quê |
|---|---|---|
| BRADESCO EST UNIF | BDE | três clientes começam com "BRA" |
| BRADESCO AG SALVADOR | BAD | idem |
| BRAINVEST ASSESSORIA | BAI | idem |
| EBAZAR.COM.BR | MEL | é o Mercado Livre |
| BEACH PARK | CBP | apelido interno |
| 37.699.074 BEATRIZ ALMEIDA | BIA | o nome é a razão social |

## 2. A regra

> **O código sai do nome fantasia e ninguém digita.** Três letras, sem
> acento, maiúsculas. Se já existir, o desempate é **a próxima letra do
> alfabeto na última posição**.

```
BRADESCO EST UNIF     → BRA
BRADESCO AG SALVADOR  → BRB   (BRA ocupado)
BRAINVEST ASSESSORIA  → BRC   (BRA e BRB ocupados)
C&A                   → CA    (o nome não tem 3 letras)
```

- **A conta mora em `lib/codigos/cliente-curto.ts` (2a)**, sem banco:
  `candidatosDeCodigo` devolve a fila de tentativas e `proximoCodigoLivre`
  escolhe. Quem consulta o que está ocupado é a action
  `sugerirCodigoCliente`, que lê os códigos do tenant de uma vez — 160
  linhas de uma coluna — e devolve o primeiro livre.
- **O desempate é letra, não número (2b)**, escolha do Tiago: o código
  aparece dentro do código do projeto, e três letras se leem melhor que
  duas e um dígito. Esgotadas as 26, aí sim entra dígito.
- **Nome com menos de 3 letras vira o que tem (2c)**: "C&A" é CA, não
  CAX. Inventar letra que o nome não tem atrapalha quem procura.
- **O campo continua à vista, em leitura (2d).** Ele é o prefixo do
  código de projeto, e quem cadastra precisa saber qual saiu — esconder
  seria pior que travar.

## 3. E congela no primeiro projeto

> **Depois que o cliente tem projeto, o código não muda mais.**

O código é a sigla dentro do código do projeto (`AMB-0001/26`), e o
gerador do próximo número **conta a partir dela**. Trocar a sigla deixaria
os projetos antigos com uma e os novos com outra, e a numeração
recomeçaria do zero — dois projetos diferentes com o mesmo número.

- Sem projeto, o código acompanha o nome fantasia enquanto ele é digitado.
- Com projeto, o campo diz *"Este cliente já tem projeto: a sigla está
  nos códigos já emitidos e não muda mais."*
- **A trava de verdade é no servidor** (`atualizarCliente`), que relê o
  código gravado e ignora o que veio do formulário quando há projeto.
  Regra crítica não mora no frontend (CLAUDE.md).

O orçamento também carrega a sigla (`PEVETE-0003/26-01`), então o efeito
de uma troca não para no projeto.

## 4. O que saiu junto

- A conferência "este código já é de outro cliente" **deixou de existir**:
  o gerador nunca devolve um ocupado. `buscarClientePorCodigo` continua no
  arquivo, sem chamador — fica registrada para remoção.
- O campo perdeu `required` no rótulo: ele nunca fica vazio por culpa de
  quem preenche.

## 5. ⏸ O backfill dos 9 fora do padrão — aguardando aprovação

Nove cadastros não têm 3 letras. O Tiago pediu que fossem normalizados,
**com os projetos acompanhando**. O plano, calculado com a regra da §2
contra os 160 códigos reais:

| cliente | hoje | vira | projetos que mudam de código |
|---|---|---|---|
| Pevetech | PEVETE | **PEV** | `PEVETE-0001/26`, `-0003/26`, `-0004/26`, `-0006/26` |
| SEBRAE | SEBRAE | **SEB** | ⚠️ ver abaixo |
| INSTITUTO FEIRA PRETA | FP | **INA** | — (sem projeto) |
| SMARTFIT | SF | **SMA** | — |
| Teste | TESTE | **TES** | — |
| Teste 22 | teste22 | **TEA** | `teste22-0001/26` |

Mais os 3 cadastros de teste inativos (`ZZGP`, `ZZGP2`, `ZZTEST`), que
valeria **apagar** em vez de renomear.

**Os jobs não mudam:** o código do job é global (`JOB-0033`), não carrega
a sigla do cliente. **Os orçamentos mudam**, porque o código deles começa
com o do projeto.

⚠️ **Dois casos que a regra não resolve sozinha, e que ficaram de fora:**

1. **`NOV-0004/26`, do SEBRAE.** A sigla já é outra hoje — nem "SEBRAE"
   nem "SEB". O cadastro foi renomeado em algum momento e o projeto ficou
   para trás. Renomear para `SEB-0004/26` conserta uma divergência que
   ninguém pediu para consertar.
2. **`0-0001/26`, do Pevetech** — o projeto de teste, com sigla "0" de
   propósito, e 14 orçamentos pendurados nele. Não deve virar `PEV-0001`.

## 6. O que foi conferido

No navegador, em 18/09/2026, logado:

- **Cadastro novo:** "Bradesco Seguros Teste" → **BRB**, campo em leitura,
  com cadeado (BRA já é do BRADESCO EST UNIF).
- **Dentro do projeto**, no dialog de cadastro rápido: "Ambev Nordeste
  Teste" → **AMA** (AMB ocupado).
- **Edição sem projeto** (ALVO): o código acompanha o nome — trocar para
  "Instituto Feira Preta Dois" deu **INA**, porque INS é do INSTITUTO
  CIDADES INVISIVEIS.
- **Edição com projeto** (Pevetech): campo travado, e **gravação real** —
  renomeei o cliente para "Pevetech Renomeado Teste", salvei, e o código
  continuou `PEVETE`. O nome foi restaurado em seguida.
