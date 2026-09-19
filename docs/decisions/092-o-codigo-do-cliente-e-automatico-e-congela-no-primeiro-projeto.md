# 092 — O código do cliente é automático, e congela no primeiro projeto

**Data:** 2026-09-18
**Decidido por:** Tiago
**Migrations:** `20260918180001_remove_clientes_de_teste.sql` e
`20260918180002_codigos_de_cliente_no_padrao_de_tres_letras.sql`,
`...80003_beats_vai_para_a_ambev_e_nov_vai_para_o_sebrae.sql` e
`...80004_marca_dos_jobs_do_beats_vira_beats.sql` e
`...80005_projetos_com_sigla_zero.sql` e
`...80006_operacao_hitlab_fica_com_a_sigla_hit.sql` e
`...80007_remove_o_cliente_de_rascunho_novo.sql`.

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

## 3. E é gerado UMA vez, na criação

> **Numa edição, o código nunca muda.** Nem com projeto, nem sem.

A primeira versão regenerava pelo nome enquanto não houvesse projeto. O
Tiago fechou mais que isso ao decidir os casos da §5, e com razão:

- **Com projeto**, a sigla está dentro dos códigos já emitidos
  (`PEV-0001/26`), e o gerador do próximo número **conta a partir dela**.
  Trocá-la deixaria os antigos com uma sigla e os novos com outra, e a
  numeração recomeçaria — dois projetos com o mesmo código.
- **Sem projeto**, o código ainda é uma escolha que alguém fez. Metade da
  base é apelido — `FP` para INSTITUTO FEIRA PRETA, `MEL` para
  EBAZAR.COM.BR —, e regenerar pelo nome apagaria isso na primeira
  correção de acento no cadastro.

O campo mostra o motivo: *"Este cliente já tem projeto: a sigla está nos
códigos já emitidos e não muda mais"*, ou *"A sigla foi definida no
cadastro e não muda sozinha"*.

**A trava de verdade é no servidor** (`atualizarCliente`), que relê o
código gravado e ignora o que veio do formulário. Regra crítica não mora
no frontend (CLAUDE.md). **Corrigir um código é trabalho de migration**,
com o de/para à vista — foi assim que os desta decisão foram feitos.

O orçamento também carrega a sigla (`PEV-0003/26-01`), então o efeito de
uma troca não para no projeto. E `projetos_financeiro`, a tabela paralela
do financeiro, usa a MESMA sigla: ela entra em qualquer correção, senão o
cadastro se parte em dois.

## 4. O que saiu junto

- A conferência "este código já é de outro cliente" **deixou de existir**:
  o gerador nunca devolve um ocupado. `buscarClientePorCodigo` continua no
  arquivo, sem chamador — fica registrada para remoção.
- O campo perdeu `required` no rótulo: ele nunca fica vazio por culpa de
  quem preenche.

## 5. ✅ O backfill, decidido caso a caso

O Tiago olhou a lista dos que fugiam das 3 letras e decidiu um a um — e é
por isso que a §3 fechou o campo de vez: **o código é escolha, não
consequência do nome.**

| cliente | hoje | decisão |
|---|---|---|
| INSTITUTO FEIRA PRETA | `FP` | **fica FP** |
| SMARTFIT | `SF` | **fica SF** |
| Pevetech | `PEVETE` | vira **PEV** |
| Teste | `TESTE` | vira **TES** |
| Teste 22 | `teste22` | vira **TET** |
| SEBRAE | `SEBRAE` | ⏸ ver §5c |

Duas migrations, ambas aplicadas e conferidas em 18/09/2026:

**`20260918180001`** apagou os 3 cadastros de teste (`ZZGP`, `ZZGP2`,
`ZZTEST`), sem projeto nem lançamento. ⚠️ Apagar cliente não é trivial: a
FK `cliente_produtos_cliente_id_fkey` é **RESTRICT** e a marca padrão tem
`trg_cliente_produtos_padrao`, que recusa qualquer DELETE dela — o
cadastro é indelével pelo caminho normal, e é assim que deve ser para
cliente de verdade. A trigger foi desligada e religada **dentro da mesma
transação**, e conferida ativa depois (`tgenabled = 'O'`).

**`20260918180002`** renomeou os três códigos e tudo que os carregava:

```
Pevetech   PEVETE → PEV
  PEVETE-0001/26 → PEV-0001/26     PEVETE-0003/26-01 → PEV-0003/26-01
  PEVETE-0003/26 → PEV-0003/26     PEVETE-0004/26-01 → PEV-0004/26-01
  PEVETE-0004/26 → PEV-0004/26     PEVETE-0006/26-01 → PEV-0006/26-01
  PEVETE-0006/26 → PEV-0006/26
  0-0001/26      → PEV-0007/26     0-0001/26-01..14  → PEV-0007/26-01..14

Teste 22   teste22 → TET
  teste22-0001/26 → TET-0001/26    teste22-0001/26-01 → TET-0001/26-01

Teste      TESTE → TES             (sem projeto)
```

- **O `0-0001/26` virou `PEV-0007/26`**, e não `PEV-0001/26`: a sigla "0"
  e o número 0001 dele foram escritos à mão e não conversavam com a
  numeração do cliente. Sendo o mais recente dos cinco (01/09), entrou
  como o **próximo da sequência**, depois do 0006 — escolha do Tiago.
- **Os jobs não mudaram.** O código do job é global (`JOB-0033`) e não
  carrega a sigla.
- **`ORC-0002` e `ORC-0003`** ficaram como estão: são do formato antigo,
  sem sigla.

⚠️ **`projetos_financeiro` foi junto, e isso merece registro.** É a tabela
da outra frente, mas tem projetos próprios com a MESMA sigla, gerada pelo
mesmo `codigo_curto` (`gerarCodigoProjetoFinanceiro`). Deixá-la de fora
partiria o cadastro em dois: os projetos financeiros do Pevetech ficariam
`PEVETE-` com o cliente já em `PEV`, e o próximo código gerado lá sairia
`PEV-`, recriando a divergência. Quatro linhas mudaram lá, e nenhum job
mudou de código (a FK é por id).

⚠️ **O projeto de teste mudou de nome.** O `0-0001/26`, que o
`CLAUDE.local.md` manda usar para todo teste, agora é **`PEV-0007/26`** —
mesmo projeto, mesmo cliente, mesmos 14 orçamentos e 8 jobs.

### 5c. ✅ O SEBRAE virou NOV — e o Beats virou da AMBEV

O Tiago pediu `SEBRAE → NOV`, alinhando o cliente ao projeto
`NOV-0004/26` que ele já tinha. Mas `NOV` era do cliente **"Novo"**, dono
do projeto `NOV-0003/26` ("Beats Esquenta Festivals").

As datas contam a história: o projeto do SEBRAE foi criado em **27/08**, e
o cliente SEBRAE só existe desde **28/08**. E o "Beats" nasceu em 26/08
sob o "Novo" — um cadastro de rascunho, sem CNPJ — como teste, e virou
trabalho de verdade: 3 orçamentos e 2 jobs. Nas palavras do Tiago, *"ainda
precisa alterar o seu cadastro para que fique correto"*.

**Migration `20260918180003`, em três movimentos que dependem um do
outro:**

```
1. Beats Esquenta Festivals  →  cliente AMBEV, marca BEATS (PRD-02)
     NOV-0003/26     → AMB-0004/26      (produção e financeiro)
     NOV-0003/26-01..03 → AMB-0004/26-01..03

2. cliente "Novo"            →  libera a sigla, vira NOO (a regra da §2)
     NOV-0001/26 "Operação HitLab 2026" → NOO-0001/26   (financeiro)

3. cliente SEBRAE            →  recebe NOV
     NOV-0004/26 fica CERTO sem mudar
```

A marca BEATS já existia na AMBEV (`PRD-02`) — não foi preciso criar. E
nada mais pendia do "Novo": zero faturamento, lançamento, conta avulsa ou
desembolso. Jobs e orçamentos não guardam `cliente_id` próprio, então
mover o projeto moveu tudo que pende dele.

⚠️ **Menos uma coisa, que só a TELA mostrou** e virou a migration
`20260918180004`: **`jobs.produto` é texto**, uma cópia do nome da marca
tirada na abertura do job, e não uma FK. A varredura do banco por
`produto_id`/`marca_id` em `jobs` não achou nada, e o UPDATE do projeto
não a alcançou. Aberto o JOB-0024 no navegador, lá estava: *"Marca
**Novo**"* — e o JOB-0025 dizia *"AMBEV"*. Os dois passaram a dizer
BEATS.

> **Campo de texto copiado na abertura não aparece numa varredura de
> FK.** Depois de mover um projeto de cliente, abra um job na tela.

### 5d. ✅ Os projetos com sigla "0"

Três projetos carregavam `0-` no lugar da sigla do cliente — resquício de
códigos escritos à mão. **Olhando os jobs de cada um, não eram o mesmo
caso:**

| tabela | código | nome | cliente | jobs |
|---|---|---|---|---|
| produção | `0-0002/26` | IMC STELLA ARTOIS | AMBEV | JOB-0031 |
| financeiro | `0-0002/26` | Stella Artois Unificado | AMBEV | JOB-0031 |
| financeiro | `0-0001/26` | Projeto Teste 1 | **AMBEV** | JOB-0029, JOB-0033 |

Os dois primeiros são o par do **mesmo trabalho**, os dois já na AMBEV:
só a sigla errava. Viraram `AMB-0005/26` nas duas tabelas — o maior AMB
era o 0004 (o Beats), e o número seguinte é o 0005, pela regra que o
Tiago fixou.

O terceiro era outra coisa. **Os jobs JOB-0029 e JOB-0033, na PRODUÇÃO,
estão em `PEV-0007/26`, do Pevetech** — o mesmo trabalho apontava para
clientes diferentes nas duas tabelas. Trocar só a sigla para `AMB`
consolidaria o erro; ele foi para o **Pevetech** e recebeu o código do
par de produção, `PEV-0007/26`.

Depois disso, uma varredura das duas tabelas: **zero projetos com sigla
"0"** e **zero jobs com cliente descasado** entre produção e financeiro.

### 5e. ✅ A "Operação HitLab 2026"

A última divergência entre sigla e cliente, e a terceira herança do
cadastro de rascunho "Novo" no mesmo dia:

| tabela | estava | o que errava |
|---|---|---|
| produção | `NOV-0001/26`, cliente **HITLAB** | a sigla, do tempo do "Novo" |
| financeiro | `NOO-0001/26`, cliente **"Novo"** | o cliente, que nunca saiu do rascunho |

*"Nesse caso o cliente É Hitlab"* — os dois viraram **`HIT-0001/26`**, do
HITLAB, com os 3 orçamentos (todos em rascunho) acompanhando. O número é
0001 porque o HITLAB não tinha projeto em nenhuma das duas tabelas.

**Depois desta, a varredura não acha mais nenhuma divergência entre a
sigla do projeto e o código do cliente, nas duas tabelas.**

### 5f. ✅ O cliente "Novo" foi apagado

Com os três projetos nos clientes certos, o `NOO` ficou sem nada — e o
Tiago mandou apagar. Ele era um cadastro sem CNPJ, com o nome literalmente
"Novo", e foi a origem das três correções acima.

Conferido uma tabela por vez antes do DELETE: **0 projetos, 0
projetos_financeiro, 0 portais, 0 contas avulsas, 0 recorrentes, 0
desembolsos, 0 faturamentos, 0 lançamentos**. Restava só a marca padrão,
que nasce junto de todo cliente — e a única FK que aponta para
`cliente_produtos` é `projetos.produto_id`, que não tinha linha dele.

Mesmo cuidado da `20260918180001`: a trigger da marca padrão desligada e
religada dentro da mesma transação. Depois: **156 clientes, zero marcas
órfãs, zero clientes sem marca padrão, trigger ativa** (`tgenabled='O'`).

> **O cadastro de rascunho é a origem do problema, não o sintoma.** As
> três divergências de sigla desta decisão vieram de projetos abertos sob
> um cliente genérico e transferidos depois. O caminho certo é cadastrar o
> cliente de verdade na hora — que é justamente o que o "+" do campo
> Cliente passou a permitir ao GP (decisão 089 §6).

## 6. O que foi conferido

No navegador, em 18/09/2026, logado:

- **Cadastro novo:** "Bradesco Seguros Teste" → **BRD**, campo em leitura,
  com cadeado (BRA já é do BRADESCO EST UNIF, e D é a 4ª letra do nome).
- **Dentro do projeto**, no dialog de cadastro rápido: "Ambev Nordeste
  Teste" → **AME** (AMB ocupado; E é a 4ª letra de "Ambev").
- E, no mesmo campo: "C&A Nordeste" → **CAN** — a base já tem 3 letras,
  então o nome curto não vira exceção.
- **Edição** (Pevetech): campo travado, e **gravação real** — renomeei o
  cliente para "Pevetech Renomeado Teste", salvei, e o código continuou
  `PEVETE`. O nome foi restaurado em seguida.
- **Depois do backfill**, na lista de Projetos & Orçamentos: o projeto de
  teste aparece como `PEV-0007/26` com os 14 orçamentos, e nenhuma tela
  mostra mais `PEVETE-`, `teste22-` ou `0-0001/26`.
