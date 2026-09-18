# 092 — O código do cliente é automático, e congela no primeiro projeto

**Data:** 2026-09-18
**Decidido por:** Tiago
**Migrations:** `20260918180001_remove_clientes_de_teste.sql` (os 3
cadastros ZZ). O backfill dos 6 que restam está em §5 e **aguarda uma
decisão sobre a numeração dos projetos**.

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
> acento, maiúsculas. Se já existir, o desempate é **a próxima letra DO
> NOME na última posição** — não a do alfabeto.

```
BRADESCO EST UNIF     → BRA
BRADESCO AG SALVADOR  → BRD   (BRA ocupado; a 4ª letra do nome)
BRAINVEST ASSESSORIA  → BRI   (BRA ocupado; a 4ª letra DESTE nome)
C&A                   → CA    (o nome não tem 3 letras)
```

A fila inteira de um nome, para ver a mecânica:

```
PEVETECH  →  PEV  PEE  PET  PEC  PEH  PEV2  PEV3 …
              ↑    ↑    ↑    ↑    ↑
            base   E    T    C    H   ← as letras seguintes do nome
```

- **A conta mora em `lib/codigos/cliente-curto.ts` (2a)**, sem banco:
  `candidatosDeCodigo` devolve a fila de tentativas e `proximoCodigoLivre`
  escolhe. Quem consulta o que está ocupado é a action
  `sugerirCodigoCliente`, que lê os códigos do tenant de uma vez — 160
  linhas de uma coluna — e devolve o primeiro livre.
- **O desempate vem do nome, não do alfabeto (2b)**, escolha do Tiago: a
  sigla continua sendo uma abreviação do cliente em vez de virar um
  contador — quem lê `BRD` reconhece o BRADESCO, e `BRB` não diria nada.
  Esgotadas as letras do nome, aí sim entra dígito (`PEV2`).
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

## 5. ⏸ O backfill dos 6 que restam

✅ **Os 3 cadastros de teste (`ZZGP`, `ZZGP2`, `ZZTEST`) foram apagados**
(migration `20260918180001`), autorizado pelo Tiago. Não tinham projeto,
orçamento, faturamento nem lançamento.

⚠️ Apagar cliente exige cuidado, e a migration registra o porquê: a FK
`cliente_produtos_cliente_id_fkey` é **RESTRICT** e a marca padrão é
protegida por `trg_cliente_produtos_padrao`, que recusa qualquer DELETE
dela. As duas juntas tornam o cadastro indelével pelo caminho normal — e
é assim que deve ser para cliente de verdade. A trigger foi desligada e
religada **dentro da mesma transação**.

Sobram **6 cadastros fora do padrão de 3 letras**. O plano, calculado com
a regra da §2 contra os códigos reais, na ordem alfabética em que seria
aplicado:

| cliente | hoje | vira | por quê |
|---|---|---|---|
| INSTITUTO FEIRA PRETA | FP | **INT** | INS é do Instituto Cidades Invisíveis; T é a 4ª letra |
| Pevetech | PEVETE | **PEV** | livre |
| SEBRAE | SEBRAE | **SEB** | livre |
| SMARTFIT | SF | **SMA** | livre |
| Teste | TESTE | **TES** | livre |
| Teste 22 | teste22 | **TET** | TES acabou de ir para o "Teste"; T é a letra seguinte |

**Os jobs não mudam:** o código do job é global (`JOB-0033`) e não carrega
a sigla do cliente. **Os orçamentos mudam**, porque o código deles começa
com o do projeto.

### 5b. A colisão do Pevetech

O Tiago decidiu que a regra vale também para os dois casos que eu tinha
separado — `NOV-0004/26` (SEBRAE) e `0-0001/26` (Pevetech). Aplicá-la ao
pé da letra, porém, produz **dois projetos com o mesmo código**:

| projeto | criado | orçamentos | jobs | viraria |
|---|---|---|---|---|
| `PEVETE-0001/26` | 28/07 | 2 (`ORC-0002`, `ORC-0003`) | 0 | `PEV-0001/26` |
| `PEVETE-0003/26` | 30/07 | 1 | 0 | `PEV-0003/26` |
| `PEVETE-0004/26` | 30/07 | 1 | 0 | `PEV-0004/26` |
| `PEVETE-0006/26` | 11/08 | 1 | 0 | `PEV-0006/26` |
| `0-0001/26` | 01/09 | **14** | **8** | `PEV-0001/26` ⚠️ **já existe** |

O `0-0001/26` é o projeto de teste, e a sigla dele ("0") nunca saiu do
gerador — foi escrita à mão. O número 0001 dele não conversa com a
numeração do Pevetech.

**Aguardando a decisão do Tiago** entre manter os números e dar ao
`0-0001/26` o primeiro livre do ano (`PEV-0002/26`), ou renumerar os
cinco em sequência por data (`PEV-0001` a `PEV-0005`), o que mudaria o
código de quatro projetos que já circulam.

## 6. O que foi conferido

No navegador, em 18/09/2026, logado:

- **Cadastro novo:** "Bradesco Seguros Teste" → **BRD**, campo em leitura,
  com cadeado (BRA já é do BRADESCO EST UNIF, e D é a 4ª letra do nome).
- **Dentro do projeto**, no dialog de cadastro rápido: "Ambev Nordeste
  Teste" → **AME** (AMB ocupado; E é a 4ª letra de "Ambev").
- **Edição sem projeto** (ALVO): o código acompanha o nome.
- E, no mesmo campo: "C&A Nordeste" → **CAN** — a base já tem 3 letras,
  então o nome curto não vira exceção.
- **Edição com projeto** (Pevetech): campo travado, e **gravação real** —
  renomeei o cliente para "Pevetech Renomeado Teste", salvei, e o código
  continuou `PEVETE`. O nome foi restaurado em seguida.
