# 211 — Importação do histórico da planilha financeira: como ler a planilha e o corte em 01/10/2026

**Data:** 2026-10-25
**Status:** aceita. E1 (extração), E2 (padronização, com o de-para aprovado)
e E3 (validação, com as DREs e as abas Gerencial) implementadas em
25/10/2026. A Copa sem lançamento e o rateio do TD foram decididos no mesmo
dia. A1 (as tabelas de histórico, com a do rateio, e a tela de carga) e A2
(a primeira carga, de 01/01/2023 a 30/06/2026, com as contas Fundo Fixo
California e BB Americas criadas antes) feitas e conferidas em 26/10/2026, e
A3 (o histórico de cada conta no Extrato da Conciliação) no mesmo dia.
Próxima entrega: A4 (os relatórios com o histórico).
**Quem decidiu:** Tiago, no plano "Importação do histórico financeiro"
(página privada de 25/10/2026), com as respostas D1, D2 e D3 dadas no mesmo
dia: "Aprovo D1, D2 e D3 como você recomendou".

## O problema

A planilha do Google Sheets "Fin. Conta Califórnia" guarda o histórico
financeiro desde 2014: o extrato de cada conta, com as previsões em datas
futuras, as notas fiscais, com as previsões de faturamento, e o resultado de
cada job. O sistema precisa desse histórico na conciliação de cada conta e
nos relatórios. Ele não pode se misturar com o que o time lança hoje, e o
sistema não pode ganhar job ou nota que ele mesmo não sabe produzir: job
antigo não tem orçamento nem versão aprovada (decisão 002), nota antiga não
tem PDF nem CNAE.

A planilha também é inconsistente de um jeito sistemático, e as regras
abaixo vieram das fórmulas dela, conferidas contra a aba DRE.

## A regra

### Como a planilha se lê

1. **Coluna Tipo** = empresa + grupo da DRE + competência: "CMH CO 3T 2026" é
   CMH, Custo Operacional, 3º trimestre de 2026. Sem prefixo, a empresa é a
   California. A DRE da planilha soma por esse texto exato.
2. **Coluna Cod** = a subconta (Sal, Ben, Job, Equ…), da aba Centro de Custo
   Código. Corresponde aos subtipos do plano de contas do sistema, que nasceu
   desses mesmos grupos.
3. **O job muda de coluna conforme a empresa.** California e Go Crazy usam a
   coluna Jobs; CMH, Hitlab e Ventura usam a coluna Evento. Nessas três, a
   coluna Jobs guarda "CMH 3T 2026", que a DRE da California usa para as
   linhas de empréstimo entre empresas (e "FIT nT aaaa" para a perda da
   FitDance).
4. **Data depois da exportação é previsão.** O financeiro rola a previsão para
   frente quando ela não acontece, então linha com data passada é realizada.
5. **Tipo com o nome de uma conta** ("SANTANDER", "XP CALIFÓRNIA") é
   transferência entre contas; "ESTORNO" é estorno, com as duas pernas.
6. **Débito negativo é entrada; crédito negativo é saída.** O crédito negativo
   é o abatimento de uma previsão de recebimento, e a DRE da planilha soma a
   coluna de crédito com sinal: o padronizado guarda o crédito e o débito
   originais para refazer a mesma conta.
7. **Notas:** "PREVISÃO" na coluna NF é nota a emitir; número de nota sem
   emissão e sem valor é nota cancelada ou número pulado.
8. **Abas de resultado:** a lista de jobs acaba onde começam os blocos de
   resumo (ponto de equilíbrio, resultado por cliente, a DRE do semestre, a
   conferência com a DRE). Nas abas da CMH e da Hitlab, o código do sistema
   antigo fica na coluna STATUS.
9. **Os totais das abas de resultado não se importam.** Algumas fórmulas estão
   quebradas (o custo da Santander Go Crazy procura o trimestre em vez do job
   na aba de 2026; há `#REF!` nas despesas das contas Go Crazy na aba da CMH; a
   aba da Ventura copia as fórmulas da Hitlab). A rentabilidade se recalcula a
   partir dos lançamentos.
10. **A DRE da Doca soma pela coluna "DRE EXTRA"** ("DOC CO 1T 2023"), e não
    pelo Tipo. O padronizado guarda essa coluna e a "Ano Comp.".
11. **Regional "TD"** é o job ou o lançamento de todas as regionais, em rateio.
12. **Nas contas XP, a regional fica na coluna "Int."**, e não na "Reg". As
    abas Gerencial somam o TD da XP California por ela.

### Respostas de 25/10/2026, à noite

- **De-para:** as propostas valem como estão. O que veio igual, parecido, pela
  sigla, pela marca ou geral fica; o ambíguo e o sem par ficam como texto no
  histórico. O de-para aprovado mora em `tmp/historico-planilha/depara/` e
  vale para as próximas versões da planilha: a aprovação só acrescenta textos
  novos, e uma decisão se muda editando o CSV.
- **"COPA"** na regional das abas de resultado é um marcador dos projetos da
  Copa para os relatórios. Os lançamentos desses jobs trazem a regional de
  verdade, e a DRE usa a do lançamento. O job ganha o marcador "Copa" e a
  regional que mais aparece nos seus lançamentos.
- **Notas de distribuição de lucro:** a Obs. "DL" e, nas abas de faturamento da
  Go Crazy e da Hitlab, a nota sem cliente com o nome do sócio no lugar do job.
  Ficam na empresa do CNPJ emissor, fora da receita de job. "CANCELADA" no
  lugar do job é nota cancelada.
- **BB Americas:** criar a conta no sistema, na carga (A2). Ela é em dólar e a
  planilha a lança em reais convertidos ("Saldo em dólar: U$ …" na
  descrição): o histórico fica em reais, como a planilha, e o extrato OFX dessa
  conta, que vem em dólar, não vai bater com ele.

### Copa sem lançamento e rateio do TD (25/10/2026)

- **Os 4 jobs da Copa sem nenhum lançamento** (linhas 338, 343, 460 e 464 da
  aba Res. Jobs 2026, todos com status CANCELADO) são cancelados e saem dos
  relatórios de resultado. O padronizado os marca em `fora_do_resultado`.
- **O lançamento TD fica sem regional, com a marca "todas".** A DRE não rateia.
  O rateio entra só no relatório por regional e replica as abas Gerencial da
  planilha. Os percentuais ficam numa tabela de histórico própria
  (`historico_rateio_regional`, criada na A1), por ano e por empresa, com a
  origem de cada linha.
- **Percentuais, conferidos nas células da planilha:**

  | Ano | California (NE / NO / SP / RJ / SS) | Fonte | CCH (AGE / DOC / URB) | Fonte |
  |---|---|---|---|---|
  | 2022 | 26,5 / 26,5 / 27 / 20 / — | Gerencial 22, linha 127 | — | — |
  | 2023 | 25 / 20 / 30 / 25 / — | Gerencial 23, linha 131 | 25 / 50 / 25 | Gerencial 23 CMH, linha 143 |
  | 2024 | 30 / 15 / 40 / 15 / —; na linha 147, 25 / 20 / 30 / 25 | Gerencial 24, linhas 135 e 147 | 25 / 50 / 25 | Gerencial 24 CMH, linha 185 |
  | 2025 | 25 / 20 / 30 / 25 / — | Gerencial 25, linha 224 | 50 / 50 / 0 | Gerencial 25 CMH, linha 245 |
  | 2026 | 15 / 15 / 40 / 25 / 5 | Gerencial 26, linha 133 | 50 / 50 / — | Gerencial 26, Q133:R133 |

  A regional BH nunca recebe rateio. Hitlab e Ventura não têm rateio. A
  terceira regional da CMH é URB (Urbia). A tabela "HISTÓRICO" da Gerencial 26
  não vale: os anos dela estão deslocados.
- **Conferência:** o CUSTO FIXO GERAL do 1T 2026 (−389.199,82, dos quais NE
  −58.379,97) sai igual da planilha, do bruto e do padronizado (E3).

#### Onde a planilha não usa o percentual do ano

As fórmulas das abas Gerencial mostram critérios que a tabela acima não
descreve. A A1 cria a tabela com trimestre e grupo opcionais, para caber cada
um deles. Como cada um entra no relatório se decide na A4:

- **Imobilizado:** o TD se divide em partes iguais entre as regionais (÷4 na
  California; ÷4 ou ÷2 na CMH) na maior parte dos trimestres de 2023 a 2026.
  O percentual do ano só aparece em alguns trimestres.
- **4T 2022 e 4T 2023:** custo fixo e pessoal TD divididos por 4, e não pelo
  percentual do ano.
- **Lucro (PL):** no 4T 2023 e no 4T 2025, dividido por 4. Algumas fórmulas de
  PL da CMH multiplicam por uma célula vazia e dão zero (Gerencial 26 no 2T
  2026 e Gerencial 25 CMH).
- **Percentual de outra coluna:** 8 células multiplicam pelo percentual de
  outra regional. Seis valem zero. As outras duas, H147 e I147 da Gerencial 25
  CMH, somam −1.231,28.
- **Crédito em linha de custo:** as Gerencial somam só o débito, e a DRE
  desconta o crédito. No custo fixo TD do 1T 2026, a diferença é de 8.009,45.
  Com o critério da planilha, a soma das regionais não fecha com a DRE.

### D1 — Empresas

| Na planilha | Empresa no sistema | CNPJ (pela conta) |
|---|---|---|
| sem prefixo | Agência California | California |
| CMH (regionais AGE e DOC) | CCH (regionais Agency e Doca) | California |
| HIT | Hitlab | Hitlab |
| VT, Ventura | Ventura | a confirmar |
| Go Crazy (abas de resultado e faturamento) | Agência California, regional SS | GoCrazy |
| FIT, CMT, IFL | FitDance, Community e Infloo como "empresa do histórico", só o nome | — |

A Go Crazy é o CNPJ da operação de São Sebastião: a DRE da California soma a
conta Santander Go Crazy na coluna "SS SANTANDER".

### D2 — Contas

Entram as nove abas de conta que já existem no sistema (BB, Santander,
Bradesco, XP e PayPal da California; BB, Santander e XP da GoCrazy; Santander
Hitlab). Fundo Fixo Califórnia e BB Americas entram em contas a criar (BB
Americas só se a conta ainda estiver aberta). Santander Community, BB
FitDance e Bradesco FitDance ficam fora.

### D3 — Período e corte

- **Primeira carga:** de 01/01/2023 a 30/06/2026.
- **3T de 2026:** entra quando o trimestre fechar, com a planilha nova pelo
  mesmo caminho. Critério proposto para "fechado": o saldo de cada conta em
  30/09 bate com o extrato do banco.
- **A partir de 01/10/2026 vale o sistema**: extrato OFX e conciliação. O saldo
  inicial de cada conta passa a ser o do extrato em 30/09, e as baixas de
  agosto e setembro que já estão no sistema ficam antes dele.

### Onde o histórico mora (A1, 26/10/2026)

Em seis tabelas próprias, que só admin e financeiro leem (RLS) e que só as
funções da carga escrevem (migration `20261026100001_historico_financeiro.sql`):

| Tabela | O que guarda |
|---|---|
| `historico_cargas` | Um registro por pacote: período, versão da planilha (dia e SHA-256), pacote (nome e SHA-256), o que ele declara (linhas e somas), o que entrou, quem carregou e a situação (carregando, ativa, substituída, desfeita, descartada). |
| `historico_movimentos` | O extrato de cada conta, com sinal (o que entra é positivo), o crédito e o débito como a planilha mostra, a classe, o grupo da DRE, o plano de contas, a regional (TD = todas), o job do histórico e o texto da planilha, com a aba e a linha de origem. |
| `historico_notas` | As notas emitidas e canceladas, com impostos, recebimento, o job do histórico e a classe (job, distribuição de lucro, sem job). |
| `historico_jobs` | Os jobs das abas de resultado, com projeto, cliente, marca, serviço, regional, o marcador da Copa, o motivo de ficar fora do resultado e o job do sistema quando há. Cada carga traz todos; vale o da carga ativa mais recente. |
| `historico_rateio_regional` | Os percentuais da tabela do rateio, por ano e empresa, com trimestre e grupo quando a planilha usa a linha só ali: a linha 147 da Gerencial 24 vale para o imobilizado e o PL do 4T 2024. |
| `historico_saldos` | O saldo da planilha no fim de cada mês com movimento, por conta, e o de abertura (o mês antes do período). |

Regras da carga, no banco:

- **A conta tem de existir:** o histórico não cria conta. Empresa, regional,
  plano de contas, cliente, marca, serviço e job se ligam quando o cadastro
  existe e ficam só como texto quando não existe. A ligação com cadastro de
  outro módulo usa `on delete set null`: o histórico não trava a exclusão de
  ninguém, e o texto continua lá.
- **O período vai até 30/09/2026 (D3).** Movimento, nota ou saldo fora do
  período da carga é recusado.
- **Uma carga em andamento por vez.** Carregar o mesmo período de uma carga
  ativa a substitui, e as linhas da antiga saem. Período que cruza outra carga
  ativa sem ser igual é recusado.
- **Concluir confere no banco** as linhas de cada tabela e as somas dos
  movimentos e das notas contra o que o pacote declarou. Reenviar uma parte
  não repete linha: a chave é a aba e a linha da planilha.
- **Auditoria:** `historico.carga_concluida`, `historico.carga_desfeita` e
  `historico.carga_descartada`.

O pacote sai de `scripts/historico-financeiro/empacotar.ts`, que junta num
.json o que a carga leva. O contrato das colunas está em
`lib/historico-financeiro/pacote.ts` e é o mesmo para o script, a tela e o
servidor. A tela, em Financeiro › Cadastros › Histórico da planilha (admin e
financeiro), lê o arquivo no navegador e mostra o período, as linhas e as
somas. Ela avisa as contas que faltam cadastrar e a carga que vai ser
substituída, e envia em partes de até 2.000 linhas (600 KB). A carga que fica
incompleta (conexão que caiu, parte recusada) fica na lista para descartar.

O pacote da primeira carga (versão de 25/10/2026) tem 56.713 movimentos (soma
−3.445.279,56), 3.222 notas, 3.586 jobs, 40 linhas de rateio e 331 saldos,
em 25 MB. Ele traz as contas Fundo Fixo California e BB Americas, que ainda
não existem: a tela não deixa carregar enquanto elas não forem criadas (A2).

### O histórico no Extrato da Conciliação (A3, 26/10/2026)

- **O corte é o início da conta no sistema**, a data do saldo inicial dela.
  Antes dele, o Extrato mostra o histórico da planilha (cargas ativas); a
  partir dele, os lançamentos do sistema, como sempre. Hoje as contas começam
  entre 01/08 e 01/10/2026. Quando a virada (B3) puser o saldo inicial em
  01/10, o histórico vai até 30/09, como manda a D3.
- **Uma seção própria, acima do Extrato do sistema**, na mesma grade (Data ·
  Crédito · Débito · Saldo · Descrição · Fornecedor · Job · Centro de Custo ·
  TRI · Empresa · REG) e com os mesmos quatro cartões, só para leitura. O
  saldo parte da abertura da carga mais antiga e soma os movimentos.
  - **TRI:** o trimestre de competência que a planilha anotou, com o ano
    quando ele é outro: "T4/23" numa linha paga em 2024.
  - **ⓘ:** a aba e a linha da planilha, o Tipo e o Cod.
- **Período todo antes do corte:** só a seção do histórico; os cartões do
  sistema diriam o saldo inicial e "nenhum lançamento".
- **Período que atravessa o corte:** o histórico até a véspera, uma nota com o
  saldo em que ele termina e o saldo inicial do sistema, e os lançamentos do
  sistema embaixo.
- **Período sem histórico** numa conta que tem: uma faixa diz o que a planilha
  cobre, com atalhos para o primeiro e o último mês.
- **Limite:** até 3.000 linhas por vez (um mês da conta principal tem perto
  de 1.700); os cartões valem para o período inteiro.
- A leitura é a função `historico_extrato_da_conta` (migration
  `20261026100002_historico_no_extrato.sql`), que confere admin e financeiro
  uma vez; pela RLS, a soma do saldo conferiria linha a linha.

## O pipeline (E1, E2 e E3)

Código em `lib/historico-financeiro/` (regras puras, com teste) e
`scripts/historico-financeiro/` (como rodar está no `README.md` da pasta).

- **E1 — extração** (`extrair.ts`): o .xlsx vira um CSV por aba, com o valor
  que a planilha mostrava e a linha de origem, mais um manifesto com o SHA-256
  do arquivo e as contagens. Leitura em fluxo, sem dependência nova: as 82 abas
  saem em cerca de 10 segundos.
- **E2 — padronização** (`padronizar.ts`): movimentos, previsões, notas e jobs
  num formato único, a carga de cada linha, a lista de pendências da primeira
  carga e as propostas de de-para (plano de contas, cliente, marca, serviço e
  regional).
- **Revisão** (`revisao.ts`): um .xlsx com uma aba por assunto e a coluna "Sua
  decisão"; vazia, vale a proposta.
- **Aprovação do de-para** (`aprovar-depara.ts`): leva as propostas para a
  pasta do de-para aprovado; a padronização usa essa pasta quando ela é
  passada como terceiro argumento.
- **E3 — validação** (`validar.ts`): refaz cada SUMIFS das abas DRE, DRE CMH,
  DRE HIT, DRE Ventura, DRE Doca e das Gerencial sobre o bruto e sobre o
  padronizado (`lib/historico-financeiro/formulas.ts`, com o critério como o
  Google Sheets aplica: sem diferença de maiúscula, com curinga, espaço
  contando, célula vazia valendo zero) e compara com o valor da planilha. No
  rateio, a soma do TD vezes o percentual da célula da aba também se refaz. As
  linhas de receita das Gerencial somam as abas de resultado e ficam fora (regra
  9). A E3 também confere o movimento e o saldo de cada conta mês a mês e o
  faturamento por aba e mês. Diferença entre o bruto e o padronizado só passa
  se for explicada: conta fora (D2), linha separada pela padronização ou espaço
  sobrando no texto.

A planilha tem dado pessoal. Planilha, CSVs e revisão ficam em
`tmp/historico-planilha/`, fora do git; o código e esta decisão não têm dado
da planilha, só contagens.

## Conferido em 25/10/2026

- **E1:** as 82 abas saíram com as mesmas linhas, colunas e fórmulas do
  conversor usado na análise, e 4,6 milhões de células iguais (só as caixas de
  seleção passaram de 1/0 para TRUE/FALSE).
- **E2:** em todas as abas de conta, as linhas lidas fecham com as
  classificadas; nove células da aba DRE de 2026 (receita, custo operacional e
  pessoal, em três contas) saem iguais até o centavo do padronizado; das linhas
  de job da primeira carga, só 3 ficaram sem job.
- **Contagens:** cerca de 110 mil movimentos realizados (56,7 mil na primeira
  carga), 3 mil previsões, 6,8 mil notas (3,2 mil emitidas na primeira carga),
  3,6 mil jobs nas abas de 2021 a 2027. Com o de-para aprovado e as respostas
  da noite, sobram 20 pendências na primeira carga: 12 notas cujo job não está
  em nenhuma aba de resultado, 3 lançamentos de job antigo, 2 datas inválidas,
  2 jobs repetidos com dados diferentes e 1 Tipo sem grupo.
- **E3, DRE de 2023 a 2026:** 8.808 células com SUMIFS. 8.783 batem nas três
  fontes (planilha, bruto e padronizado). 3 diferem no padronizado por linhas
  que a padronização separou (a data "0204" do Fundo Fixo e um lançamento de
  valor que não fecha), 6 por espaço sobrando no Tipo ou no Jobs — a DRE da
  planilha deixa esses lançamentos de fora e o histórico os soma —, e 16 são
  fórmulas quebradas (`#REF!`) na própria DRE da CMH.
- **E3, Gerencial de 2023 a 2026:** 1.954 células com SUMIFS. 1.783 batem nas
  três fontes, rateio incluído. 166 somam as abas de resultado (receita por
  job) e ficam fora. 4 somam outra célula da aba (o imobilizado do 1T 2025) e
  não se refazem. 1 difere por espaço sobrando no Tipo. Foi a Gerencial que
  mostrou a regional das contas XP na coluna "Int." (regra 12), que a
  padronização não lia.
- **E3, saldos e faturamento:** de janeiro de 2023 a setembro de 2026, nenhum
  mês de nenhuma conta tem movimento diferente entre planilha e padronizado, o
  saldo da planilha encadeia mês a mês com o movimento padronizado, e nenhum
  mês de faturamento difere.

## Conferido em 26/10/2026 (A1)

- **Carga pequena:** a BB California de janeiro de 2023 (510 movimentos, 14
  notas, 90 jobs, 40 linhas de rateio e 2 saldos) entrou pela tela com as
  somas do pacote. Toda ligação que o pacote propõe virou id: nos movimentos,
  450 com empresa e plano de contas e 279 com regional; nos jobs, 74
  clientes, 60 marcas, 89 serviços e 67 regionais. A Urbia ficou como texto.
- **Refeita e desfeita:** carregada de novo, substituiu a anterior, que ficou
  sem linhas. Desfeita, as linhas saíram e o registro ficou.
- **Recusa e descarte:** uma parte com movimento fora do período foi recusada
  pelo banco, e a carga incompleta foi descartada pela tela.
- **Acesso:** um usuário GP não vê as cargas e não consegue começar uma.
- As três cargas de teste ficaram registradas (substituída, desfeita e
  descartada), e as tabelas do histórico estão vazias.
- O saldo da planilha no fim de janeiro de 2023 (2.837.431,76) fica 1
  centavo abaixo do de abertura somado ao movimento (2.837.431,77): é
  arredondamento da planilha. A A3 parte do saldo de abertura e soma os
  movimentos.

## Conferido em 26/10/2026 (A2)

- **As contas novas**, criadas pela tela de cadastro, como as outras: saldo
  inicial 0 em 01/10/2026, porque o saldo de 30/09 entra na virada (B3), e
  empresa contábil California.
  - **Fundo Fixo California:** tipo caixa, com "Fundo fixo" no lugar do banco.
  - **BB Americas:** conta corrente do Banco do Brasil Americas. A planilha a
    soma na DRE da California e na da CMH, e as duas são do CNPJ da
    California.
- **A carga:** a 1ª carga entrou pela tela em 44 segundos, pela sessão do
  Tiago: 56.713 movimentos (soma −3.445.279,56) em 11 contas, 3.222 notas
  (soma 306.317.111,97), 3.586 jobs, 40 linhas de rateio e 331 saldos. As
  somas e as contagens são as do pacote, conferidas pelo banco ao concluir.
- **Mês a mês, igual ao pacote:** o movimento de cada conta em cada mês (312
  grupos) e o faturamento de cada aba em cada mês (122 grupos) saem do banco
  iguais aos do pacote, conferidos por soma de verificação.
- **Ligações com o cadastro:** toda ligação que o pacote propõe virou id —
  nos movimentos, 55.610 com empresa e plano de contas e 45.494 com
  regional; nos jobs, 2.961 clientes, 2.102 marcas, 3.567 serviços, 3.257
  regionais e os 80 jobs que existem no sistema.
- **Frações de centavo:** 1.358 linhas da planilha guardam frações de
  centavo (como 9.333,333333, um terço de 28 mil). O histórico guarda
  centavos, como o banco. O saldo de 30/06/2026 sai igual ao da planilha em 8
  das 11 contas. Na California Santander fica R$ 2,33 abaixo, e esse é
  exatamente o efeito das frações. Na Santander GoCrazy e na Paypal a
  diferença é de alguns centavos. É também por isso que o movimento mensal
  difere da E3 em centavos (no máximo R$ 0,11) em 59 dos 325 meses.
- **Rateio:** o custo fixo geral TD do 1T 2026 refeito do banco, com a tabela
  de rateio, dá −389.081,82; a planilha mostra −389.199,82. A diferença é
  R$ 118,02 pagos em julho com competência 1T 2026, que entram com a carga do
  3T, e 2 centavos de arredondamento. O relatório por competência de 2026 só
  fica completo com o 3T carregado.

## Conferido em 26/10/2026 (A3)

- **California Santander, março de 2024:** os cartões (saldo anterior
  154.514,54, créditos 6.587.639,25, débitos 4.283.324,54, saldo final
  2.458.829,25) são os da função, e o saldo da última das 1.273 linhas é o
  saldo final. A planilha mostra 154.515,25 e 2.458.830,07: a diferença são as
  frações de centavo (A2).
- **Fundo Fixo California, maio de 2025:** saldo anterior 6.350,33 e final
  7.385,50, iguais aos da planilha no fim de abril e de maio.
- **Junho de 2026:** 1.708 linhas e saldo final 123.667,81. A consulta leva
  0,19 s no servidor.
- **De junho a agosto de 2026:** o histórico vai até 31/07, com a nota de que a
  carga termina em 30/06 e a do saldo inicial de 01/08; os lançamentos de
  agosto vêm embaixo.
- **Antes do histórico** (BB GoCrazy em 2023): a faixa com os atalhos.
- **Filtro de período:** as datas dele não acompanhavam a mudança de período
  por link (eram `defaultValue`); a página agora o remonta quando o período
  muda.
- As abas Títulos e Conciliação automática não leem o histórico e seguem como
  estavam.

## O que fica para depois
- A4: como o relatório por regional trata o que a planilha não rateia pelo
  percentual do ano (imobilizado, 4T 2022 e 2023, PL, crédito em linha de
  custo).
- As 20 pendências: as de data e de nome de job se corrigem na planilha e
  entram na versão do 3T.
- A trilha do 4T no sistema: os jobs do 4T que só estão na planilha, as notas de
  outubro, a virada de 30/09 e a conciliação de outubro pelo OFX.
