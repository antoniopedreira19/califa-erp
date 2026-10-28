# 211 — Importação do histórico da planilha financeira: como ler a planilha e o corte em 01/10/2026

**Data:** 2026-10-25
**Status:** aceita. E1 (extração), E2 (padronização, com o de-para aprovado)
e E3 (validação, com as DREs e as abas Gerencial) implementadas em
25/10/2026. A Copa sem lançamento e o rateio do TD foram decididos no mesmo
dia. A1 (as tabelas de histórico, com a do rateio, e a tela de carga) e A2
(a primeira carga, de 01/01/2023 a 30/06/2026, com as contas Fundo Fixo
California e BB Americas criadas antes) feitas e conferidas em 26/10/2026,
A3 (o histórico de cada conta no Extrato da Conciliação) e a A4 (a DRE do
histórico, o resultado por regional, a rentabilidade e o faturamento dos jobs
do histórico, em Relatórios) no mesmo dia. A5: o 3T carregado em 27/10/2026,
da versão de 25/10. Próximo: o saldo inicial das contas em 01/10, pelo
extrato de 30/09, e a trilha do 4T no sistema.
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
   partir dos lançamentos. Dois dados de cada job se importam, porque não são
   totais (A4, 26/10/2026): a divisão do job entre as regionais (o grupo
   "RATEIO %") e a alíquota teórica ("Imp Real %").
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
um deles.

**Decidido (Tiago, 26/10/2026):** o relatório por regional rateia todo o TD
pelo percentual do ano, o da planilha (tabela acima), numa regra só. As
exceções abaixo ficam documentadas e não se reproduzem. Os percentuais de
cada ano ficam à vista, e os dos anos fechados continuam como a planilha os
registra; revisá-los fica para o futuro, sem perder o registro da planilha.

Medidas célula a célula (as 873 células com TD das abas Gerencial de 2023 a
2026, cada multiplicador comparado com a tabela), de 2023 a 2025 as exceções
só trocam custo entre regionais:

| Ano | O que a planilha faz | Na planilha, contra o percentual do ano |
|---|---|---|
| 2023 | 4T: custo fixo, pessoal e PL do TD ÷4 | NO paga R$ 59.281,02 a mais; SP, o mesmo a menos |
| 2024 | nada fora da tabela | — |
| 2025 | 3T e 4T: imobilizado do TD ÷4; 4T: PL ÷4 | NO paga R$ 22.593,76 a mais; SP, o mesmo a menos |
| 2025, CMH | 4T: o PL do TD inteiro na Doca | a Doca paga R$ 26.250,00 a mais, e as regionais somam R$ 26.250,00 além do total |

A soma só do débito não muda nada de 2023 a 2025: não há crédito do TD nas
linhas de custo. As exceções, como a planilha as escreveu:

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
| `historico_jobs` | Os jobs das abas de resultado, com projeto, cliente, marca, serviço, regional, o marcador da Copa, o motivo de ficar fora do resultado, o job do sistema quando há e, desde a A4, a divisão do job entre as regionais e a alíquota teórica. Cada carga traz todos; vale o da carga ativa mais recente. |
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
- **Mês a mês:** as setas ‹ › do filtro de período andam um mês inteiro a
  partir do mês do "De", e "Mês atual" volta ao padrão. As datas do filtro
  seguem a URL: acompanham os atalhos e o voltar do navegador. O mês é a
  unidade de navegação e o limite de 3.000 linhas fica como proteção, sem
  paginação (Tiago, 26/10/2026, combinado com o Antonio, dono do filtro).
- **Limite:** até 3.000 linhas por vez (um mês da conta principal tem perto
  de 1.700); os cartões valem para o período inteiro.
- A leitura é a função `historico_extrato_da_conta` (migration
  `20261026100002_historico_no_extrato.sql`), que confere admin e financeiro
  uma vez; pela RLS, a soma do saldo conferiria linha a linha.

### A DRE do histórico em Relatórios (A4, 26/10/2026)

- **Onde:** Relatórios › "DRE do histórico" (`/relatorios/dre-historico`), um
  cartão como os de Rentabilidade e Faturamento de Jobs, só para admin e
  financeiro (Tiago, 26/10/2026: os relatórios do histórico ficam no módulo de
  Relatórios). Escolhe-se a empresa (Agência California, CCH, Hitlab ou
  Ventura) e o ano, entre os que as cargas ativas cobrem (2023 a 2026); a
  tabela traz as linhas da DRE da planilha, os quatro trimestres e o ano.
- **De onde sai:** a função `historico_dre` (migrations
  `20261026100003_historico_dre.sql` e `20261026100004`, que a reaplicou sem
  expressão regular por linha) soma, num ano de competência, o crédito e o
  débito da planilha por sigla do Tipo, grupo, trimestre e conta, e pela chave
  de empréstimo da coluna Jobs ("CMH 1T 2025"). A regra de cada linha fica em
  `lib/historico-financeiro/dre.ts`. A função confere admin e financeiro uma
  vez e leva 0,2 s.
- **Uma regra só por linha.** A planilha muda a fórmula de uma célula para
  outra; aqui:
  - **Sinal:** receita e receita financeira, crédito − débito; custo e
    despesa, débito − crédito; juros, imobilizado, bonificação, distribuição,
    Doca, Makkna e provisão, débito − crédito com sinal negativo; empréstimos
    e mútuo separados como na planilha (o crédito no "(+)", o débito no
    "(−)"); os empréstimos entre empresas e a perda da FitDance, crédito −
    débito da chave na coluna Jobs.
  - **Contas:** cada DRE soma todas as contas do histórico (a sigla do Tipo
    diz de qual empresa é a linha), menos as contas próprias de outra empresa:
    a Santander Hitlab só entra na DRE da Hitlab, como na planilha.
  - **Ordem:** a da DRE da California desde 2024, com a bonificação depois do
    imobilizado em todas. Na DRE da CMH, da Hitlab e da Ventura (e na da
    California de 2023) ela vinha antes do resultado líquido operacional: só
    esse subtotal muda; o lucro líquido e o reinvestimento, não.
  - **Fora:** a linha "Empréstimo ao FitDance" da DRE CMH, que não tem fórmula
    (N/A e #REF!; a chave "FIT" da coluna Jobs é a perda da California), e os
    −40.000 digitados na fórmula da perda do 3T 2024.
- **O que a DRE do histórico não tem:** as previsões (as linhas com data
  depois da exportação), que a DRE da planilha soma; o que foi recebido ou
  pago antes de 01/01/2023 com competência de 2023; e, enquanto o 3T não
  entrar, o que foi recebido ou pago depois de 30/06/2026. A tela diz isso
  embaixo da tabela e marca com * os trimestres que terminam depois do fim do
  histórico.
- **Só o realizado (Tiago, 26/10/2026):** a DRE do histórico fica sem as
  previsões. Elas entram no sistema na virada do 4T (Trilha B), como títulos;
  no histórico, apareceriam duas vezes quando histórico e sistema se
  juntarem. Em 2025, por isso, a receita da California fica R$ 2,12 milhões
  abaixo da planilha e o lucro líquido, R$ 1,81 milhão.

### O resultado por regional em Relatórios (A4, 26/10/2026)

- **Onde:** Relatórios › "Resultado por regional do histórico"
  (`/relatorios/regional-historico`), cartão só para admin e financeiro.
  Escolhe-se a empresa (Agência California ou CCH, as que têm rateio), o ano e
  o período (o ano inteiro ou um trimestre).
- **As linhas são as da DRE regional da planilha** (as abas "DRE Califa
  Regional" e "DRE CMH Regional" do Fechamento, que somam as Res. Jobs e as
  Gerencial): faturamento, imposto sem o benefício e custo operacional
  (resultado operacional); gastos fixos da regional (custo fixo e pessoal);
  gastos fixos gerais (o custo fixo e o pessoal do TD rateados, e o marketing,
  a administrativa, a comercial e a trabalhista); juros e empréstimos; a perda
  da FitDance (lucro líquido); o benefício tributário do ISS e do PERSE e a
  receita financeira (resultado após o benefício); imobilizado, participação
  nos lucros e o bloco dos projetos proprietários (lucro após investimento).
  Na CCH, também o investimento da Doca e a Makkna.
- **Uma regra só (Tiago, 26/10/2026):**
  - o faturamento e o custo operacional do job se dividem pelas partes dele
    (abaixo); o imposto é o teórico, com a mesma divisão;
  - os projetos proprietários (a Copa e os projetos da CCH) saem dessas linhas
    e entram num bloco abaixo do resultado, como no Fechamento (abaixo);
  - o benefício do ISS e do PERSE se rateia, trimestre a trimestre, pelo
    faturamento de cada regional e dos projetos;
  - os demais lançamentos entram na regional deles; o TD se rateia pelo
    percentual do ano da planilha (no 4T 2024, o imobilizado e o PL pela linha
    147, que a tabela registra); o que não tem regional fica em "Sem regional".

  A coluna Total fecha com a DRE do histórico na última linha: o lucro após
  investimento é o lucro líquido dela (mais a perda da FitDance, na
  California), e o resultado após o benefício é o resultado líquido
  operacional. O resultado operacional e o lucro líquido das regionais usam o
  imposto teórico, como a planilha. A regional que o cadastro do sistema não
  tem entra pelo código da planilha ("URB", a Urbia da CMH; "AGE" e "DOC" na
  divisão dos jobs). **Nas linhas da CMH, a coluna Reg usa "NE" para a Doca e
  "SP" para a Agency** (Tiago, 26/10/2026); o relatório lê assim, e o de-para
  já liga as duas para as próximas cargas. Outro código de outra empresa (o
  "RJ" numa linha da CMH, ou o "NE" da divisão de um job da California) fica
  sem regional.
- **Onde as abas Gerencial fogem da regra, o relatório não as segue:** a
  despesa administrativa e a comercial vêm ora pela regional, ora pelo total
  da DRE vezes o percentual; a perda e os juros, pelo total da DRE vezes o
  percentual. Aqui, todos pela regional de cada lançamento e o TD pelo
  percentual: a perda de 2024 não tem regional e fica em "Sem regional".
- **O rateio de cada ano fica à vista:** o do ano em cima da tabela, com a
  célula da planilha de onde veio, e o de todos os anos ao abrir. Revisar fica
  para o futuro, sem perder o registro da planilha.
- A leitura é a função `historico_regional` (migrations
  `20261026100005_historico_regional.sql`, reaplicada pela 100006 e pela
  100007; `20261026100008_historico_regional_pelos_jobs.sql`, reaplicada
  pela 100009; e `20261026100010_historico_regional_projetos_proprietarios.sql`).
  Ela confere admin e financeiro uma vez e leva cerca de 0,2 s num ano.

#### A divisão pelos jobs e o benefício (A4, revisão de 26/10/2026)

**Decidido (Tiago, 26/10/2026):** "divida pelos jobs como a planilha: traga
para o histórico a divisão de cada job entre as regionais (receita, imposto
teórico e custo) e ratei o benefício ISS + PERSE pelo percentual do
faturamento."

**Como a planilha faz** (as fórmulas do Fechamento, conferidas célula a
célula):

- Cada linha das abas Res. Jobs de 2021 em diante traz a parte de cada
  regional no job: o grupo "RATEIO %", com o código da regional embaixo (NE,
  NO, SP, RJ na California; SS, NO, SP, RJ na Go Crazy; AGE, DOC, URB, SN na
  CMH, na Hitlab, na Ventura e na Infloo), e a alíquota teórica, "Imp Real %"
  (19,53% na maior parte; 0%, 1,9%, 2,3%, 5% e outras em alguns jobs). A CMH
  de 2021 e 2022 não tem o grupo.
- O faturamento e o custo operacional de cada regional são os lançamentos do
  job vezes a parte dela; o "Imposto SEM PERSE", o faturamento vezes a parte e
  a alíquota.
- O benefício do trimestre é o imposto teórico menos o imposto real dos jobs
  (a coluna IMPOSTO das Res. Jobs, as notas do job, mais um ajuste digitado).
  Somado ao teórico, ele dá o custo tributário da DRE em todos os trimestres
  de 2023 a 2026, menos o 2T 2026 (abaixo). A planilha o divide pelo "% Por
  Regional", o faturamento de cada regional no trimestre, na maior parte dos
  trimestres; em alguns, job a job (a parte de cada regional no imposto real
  e no teórico de cada job).
- O job que a planilha não divide fica fora da DRE regional, e a soma das
  regionais não fecha com a DRE consolidada: no 2T 2026, as regionais da
  California somam R$ 24,1 milhões de faturamento e R$ 33,5 milhões de custo a
  menos que a DRE (a Copa, com as previsões); na CCH, no 1T 2026, R$ 0,51
  milhão e R$ 1,26 milhão. De 2023 a 2025 todo job com lançamento tem divisão,
  e as somas fecham. No histórico, nada fica de fora: o que não tem regional
  vai para "Sem regional", e a soma das colunas fecha sempre com a DRE.

**O que o histórico faz:**

- A padronização (E2) lê o grupo e a alíquota de cada job; o pacote os leva
  como texto ("NE:0.25;SP:0.75", só as partes que não são zero) e a carga os
  guarda em `historico_jobs.rateio_regional` (objeto) e
  `historico_jobs.imposto_teorico_percentual` (fração). Das 3.586 linhas de
  job, 3.274 têm divisão e 3.153 têm alíquota; nenhuma divisão foge de 100%.
- A função divide pela soma das partes. O benefício do trimestre é o imposto
  teórico menos o custo tributário pago (Tipo CT), rateado pelo faturamento de
  cada regional no trimestre, inclusive "Sem regional". Sem faturamento no
  trimestre, o benefício fica em "Sem regional". O ano é a soma dos
  trimestres, como a planilha.
- **O job que a planilha não divide e não é projeto proprietário fica na
  regional do lançamento,** como a regra da Copa desta decisão. A tela diz
  quanto do faturamento ficou assim. Na 1ª carga não há nenhum: os jobs sem
  divisão são os projetos proprietários (abaixo).

#### Os projetos proprietários (A4, 26/10/2026)

**Decidido (Tiago, 26/10/2026):** "Siga o Fechamento: tire os projetos
proprietários (a Copa e os da CCH) das linhas de cima e mostre-os num bloco
abaixo do resultado, com a Copa metade NE e metade SP e os da CCH na Doca,
somados só no lucro após investimento." O motivo, como o Tiago ouviu da
equipe: com eles nas linhas de cima, a rentabilidade dos outros jobs fica
mascarada.

**Onde está no Fechamento:**

| Aba | Linhas | O que faz |
|---|---|---|
| DRE Califa + CCH + Hit + Vet (bloco de 2026, da linha 127) | 182 a 186; 187; 194 a 197 | "Projeto Proprietários" (receita, impostos, custo operacional e benefício dos projetos), puxado das abas regionais; o lucro líquido após investimentos (linha 179 + 181 + 182); o resultado de cada projeto da CCH no 1T 2026. As notas de N194 a P201 tratam a Copa Arena N1 como projeto proprietário. O faturamento da linha 133 já vem sem os projetos. |
| DRE Califa Regional (bloco de 2026, da linha 252) | 299 a 303; 304 | "Resultado Proprietários": as fórmulas de K300 a K302 e M300 a M302 somam os jobs com "COPA" na coluna AC (REGIONAL) da Res. Jobs 2026, no 2T, e dividem por 2 (NE e SP); o benefício (I303, R$ 1.520.000,00) está digitado. |
| DRE CMH Regional (bloco de 2026, da linha 206) | 249 a 253; 254 | "Projetos": as fórmulas de E250 a E252 somam os jobs com "CMH" na coluna AC da Res. Jobs CMH 2026, no 1T, tudo na coluna E (a Doca); o benefício fica em zero. |

**O que o histórico faz:**

- O projeto proprietário é o job sem divisão com "COPA" (na California) ou
  "CMH" (na CCH) na coluna REGIONAL das abas Res. Jobs. Na 1ª carga são os 25
  jobs da Copa (projeto Arena N1) e os seis da aba Res. Jobs CMH 2026 (Palco
  Arara, Academy, Festival de Gastronomia, Programa Youtube Capitão e os dois
  do M&M - Depois do Like). A função devolve esse texto
  (`regional_do_job`); a regra e a divisão ficam em
  `lib/historico-financeiro/regional.ts` (`EMPRESAS_DO_REGIONAL`, `projetos`).
- O faturamento, o imposto teórico e o custo operacional dos projetos saem das
  linhas de cima e entram no bloco "Projetos proprietários", abaixo da
  participação nos lucros: a Copa metade no NE e metade no SP, os da CCH na
  Doca. O bloco entra só no lucro após investimento, que continua fechando com
  a DRE do histórico. Sem projeto no período, o bloco não aparece.
- O benefício do trimestre se rateia pelo faturamento das regionais e dos
  projetos; a parte dos projetos vai para "Benefício tributário dos projetos".
  O imposto e o benefício, com os dos projetos, fecham o imposto pago no
  centavo (a linha do benefício da operação leva o centavo que sobra).
- Projeto novo (outra marca na coluna REGIONAL, ou outra divisão) precisa
  entrar em `projetos`, com a divisão que o Fechamento usar.

**Onde a planilha não segue a regra (documentado, não se reproduz):**

| Onde | O que a planilha faz |
|---|---|
| California, 2T 2024, 2T a 4T 2025 e 4T 2026 | O benefício job a job, e não pelo faturamento (o total é o mesmo) |
| California, 2T 2026 | O benefício soma o de todos os jobs do trimestre, inclusive os da Copa, que ficam fora das regionais: R$ 1,68 milhão a mais que o imposto teórico das regionais menos o custo tributário da DRE |
| CCH, 1T e 2T 2023 | Faturamento, imposto, custo e benefício todos na Agency, sem olhar a divisão dos jobs |
| CCH, 3T 2023 | O benefício job a job |
| CCH, 4T 2023 | O custo tributário que a DRE da planilha lança no crédito (R$ 58.426,48, uma das quatro células da E3) e dois jobs da Doca sem o imposto teórico (R$ 484,35) |
| California, 2T 2026, projetos | O imposto teórico da Copa digitado: na linha 85 da Res. Jobs 2026, R$ 777.334,87 ("777312.87+22") em vez de 19,53% de R$ 15.715.411,29, e o mesmo valor na linha 91, sem receita (R$ 1.514.550,08 a menos); o benefício da Copa digitado (R$ 1.520.000,00), e por isso o benefício das regionais também difere |
| CCH, 1T 2026, projetos | O imposto real dos projetos (a coluna IMPOSTO, R$ 61.906,05), e não o teórico, e o benefício deles em zero; o benefício das regionais é o teórico delas menos todo o imposto pago, e a aba conta o imposto dos projetos duas vezes (a DRE consolidada, não: a linha 184 fica em zero no 1T) |

### A rentabilidade dos jobs em Relatórios (A4, 26/10/2026)

**Decidido (Tiago, 26/10/2026, na sessão bifurcada):** "Vamos fazer os dois
[...] faremos assim com esses dados historicos que estamos importando, com os
novos jobs continuaremos utilizando os dados de suas respectivas planilhas
internas." O relatório mostra as duas contas das abas Res. Jobs:

| Coluna | Na aba Res. Jobs | No histórico |
|---|---|---|
| Receita | TOTAL RECEITA: o que o job recebeu nas contas | Tipo REC do job, crédito − débito |
| Imposto | IMPOSTO: os impostos das notas do job | as notas emitidas do job |
| Custo | TOTAL CO | Tipo CO do job, débito − crédito |
| Resultado | RESULTADO = receita − imposto − custo | igual; é o Result. Op da Rentabilidade de Jobs |
| Fee (planilha) | FEE LÍQUIDO = (receita − imposto) × fee ÷ (1 + fee) | igual, com o percentual de cada job |
| Rentabilidade | RENTABILIDADE = resultado − fee líquido | igual |
| Período | a aba do ano e a coluna T | o ano e o trimestre do job |

- **Onde:** Relatórios › "Rentabilidade dos jobs do histórico"
  (`/relatorios/rentabilidade-historico`), cartão só para admin e
  financeiro. Escolhe-se a empresa (Agência California, CCH, Hitlab ou
  Ventura), o ano, o período (o ano ou um trimestre, pela coluna T) e a
  visão (cliente, marca ou job). O cliente e a marca são os do cadastro
  quando o de-para achou; senão, o texto da planilha. O job sem cliente ou sem
  marca entra num grupo próprio, para o total ser o mesmo nas três visões.
- **O fee é o da planilha, por dentro:** ela supõe que a receita menos o
  imposto já traz o fee e o separa com o percentual de cada job, que a carga
  traz da coluna logo depois de "FEE LÍQUIDO" (`historico_jobs.fee_percentual`):
  12% na California e na Go Crazy, 15% na CCH, na Hitlab e na Ventura, e 13% em
  alguns jobs de 2021 a 2023. Não é o honorário orçado: as planilhas internas
  somam o honorário por fora (custo de 100 com 12% dá 112), e a planilha
  financeira aplica o fee sobre toda a receita líquida, que pode incluir margem.
  Na tela, a coluna se chama "Fee (planilha)", com essa dica. Vale só para o
  histórico.
- **Cada job soma tudo o que é dele no histórico, em qualquer data,** como as
  colunas das abas Res. Jobs. O job que aparece em mais de uma aba fica na mais
  nova (a do ano em que a planilha o lista por último). Só o realizado: as
  previsões e as notas a emitir, que a planilha soma, não entram.
- **O custo do job é o Tipo CO,** como na DRE. A aba Res. Jobs CMH lista também
  investimentos como se fossem jobs e soma os débitos deles como custo: sete
  linhas de 2023 e 2024 com Tipo CMH DOC (R$ 2.201.119,99, o Investimento
  Doca) e CMH MK (R$ 344.768,28, a Makkna). No histórico eles ficam com custo
  zero no relatório dos jobs, e o valor aparece na DRE como "Investimento Doca"
  e "Makkna". **Decidido (Tiago, 26/10/2026):** "São investimentos internos
  mesmo, vamos fazer Fora (como está hoje), com esta na DRE."
- **Onde as abas fogem da regra (documentado, não se reproduz):** a CCH de 2025
  calcula o resultado sem o imposto e o fee sobre a receita contada duas vezes
  (a soma das contas mais o TOTAL RECEITA); a CCH de 2026 também conta a
  receita duas vezes no fee; as abas da Hitlab fazem o resultado só com
  algumas contas, e não com o TOTAL RECEITA e o TOTAL CO; e duas linhas da
  California estão em branco (a rentabilidade da linha 30 de 2024; o fee e a
  rentabilidade da linha 457 de 2025).
- A leitura é a função `historico_rentabilidade_jobs` (migration
  `20261026100011_historico_rentabilidade_dos_jobs.sql`), que confere admin e
  financeiro uma vez. A conta fica em
  `lib/historico-financeiro/rentabilidade.ts`.

### O faturamento dos jobs em Relatórios (A4, 26/10/2026)

**Decidido (Tiago, 26/10/2026):** a planilha usa "faturamento" em dois
sentidos — o valor das notas e o que entrou no banco (a aba "Fat por cliente"
soma o TOTAL RECEITA das abas Res. Jobs, a receita da rentabilidade). Entre
três leituras (as notas do job; a aba "Fat por cliente"; as notas pela data de
emissão), o Tiago escolheu a das notas do job, o par do Faturamento de Jobs do
sistema. O histórico não tem o valor contratado do job, então a comparação é o
faturado com o recebido:

| Coluna | De onde vem |
|---|---|
| Notas | as notas emitidas do job nas abas de Faturamento (as canceladas e as previsões não entram no histórico) |
| Faturado | o valor dessas notas, em qualquer data |
| Recebido | as notas com data de recebimento na planilha |
| A receber | as notas sem essa data |
| Situação (só na visão por job) | Recebido, Parcial, A receber ou Sem nota |
| Período | o ano e o trimestre do job (a aba Res. Jobs e a coluna T) |

- **Onde:** Relatórios › "Faturamento dos jobs do histórico"
  (`/relatorios/faturamento-historico`), cartão só para admin e financeiro,
  com os filtros da rentabilidade (empresa, ano, período e visão por cliente,
  marca ou job), que agora moram em `app/(app)/relatorios/_historico/jobs.ts`.
- **O job sem nota entra com zero e a situação "Sem nota",** para o total de
  jobs ser o mesmo da rentabilidade: 51 dos 634 jobs da California em 2025,
  36 deles sem receita nem custo no histórico.
- **O recebimento é o que a planilha registra,** na versão da carga
  (25/10/2026): a nota emitida até 30/06/2026 e recebida depois aparece como
  recebida (R$ 282.715,12 nos jobs da California de 2025). Não é o banco: nos
  jobs da California de 2025, as notas recebidas até 30/06/2026 somam
  R$ 89.989.740,52 e a receita do Tipo REC, R$ 86.063.648,05. Os dois batem em
  544 dos 634 jobs; em 82, a nota está recebida e o banco do job tem
  R$ 4.024.261,90 a menos, e em 8 o banco tem R$ 98.169,97 a mais (o Tiago
  viu a diferença antes de escolher).
- A leitura é a função `historico_faturamento_jobs` (migration
  `20261026100012_historico_faturamento_dos_jobs.sql`), que confere admin e
  financeiro uma vez e leva cerca de 30 ms. A situação e as somas ficam em
  `lib/historico-financeiro/faturamento.ts`.

#### A visão por CNPJ, padrão do relatório (26/10/2026)

**Decidido (Tiago, 26/10/2026):** "Quero os dois. E quero que a visão padrão
seja a de relatório por CNPJ de forma equivalente à planilha." As visões por
job agrupam pela empresa do job, não pelo CNPJ que emitiu a nota. A CCH e a
Hitlab emitem também pelo CNPJ da California, e a CCH pela Go Crazy. Por isso
o relatório ganhou:
- **A visão "CNPJ", padrão:** uma linha por emissor, que é uma aba de
  Faturamento da planilha: California Salvador, Fortaleza e SP; Go Crazy,
  Santo André e SP; Hitlab Salvador. Cada linha traz o valor emitido em cada
  mês, o faturado, o recebido e o a receber do ano. As respostas do Tiago:
  - a nota cai no mês da **data de emissão**;
  - as notas **sem job e de distribuição de lucro entram no total**, com o
    valor marcado à parte; as canceladas ficam fora;
  - o CNPJ abre a **lista das notas** dele no ano, como a aba (NF, job,
    cliente, emissão, vencimento, recebimento, valor e impostos).
- **O filtro "Emissor"** nas visões por cliente, marca e job: só os jobs com
  nota daquele CNPJ, e só as notas dele.
- A leitura é a função `historico_faturamento_notas`, e
  `historico_faturamento_jobs` passou a trazer as somas de cada job por
  emissor (migration `20261026100013_historico_faturamento_por_cnpj.sql`). A
  conta fica em `montarPorCnpj` e `jobsDoEmissor`, em
  `lib/historico-financeiro/faturamento.ts`.

## O pipeline (E1, E2 e E3)

Código em `lib/historico-financeiro/` (regras puras, com teste) e
`scripts/historico-financeiro/` (como rodar está no `README.md` da pasta).

- **E1 — extração** (`extrair.ts`): o .xlsx vira um CSV por aba, com o valor
  que a planilha mostrava e a linha de origem, mais um manifesto com o SHA-256
  do arquivo e as contagens. Leitura em fluxo, sem dependência nova: as 82 abas
  saem em cerca de 10 segundos.
- **E2 — padronização** (`padronizar.ts`): movimentos, previsões, notas e jobs
  num formato único, a carga de cada linha, a lista de pendências das cargas
  que vão ao banco (a primeira e o 3T), com a carga de cada pendência, e as
  propostas de de-para (plano de contas, cliente, marca, serviço e regional).
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
- **Filtro de período:** as setas levaram de outubro a junho de 2026 mês a
  mês, até o histórico. O voltar do navegador e os atalhos do histórico deixam
  as datas certas. A data escolhida no calendário aparece na hora. O seletor de
  data sem `value` (o do cadastro de conta) segue como antes.
- As abas Títulos e Conciliação automática não leem o histórico e seguem como
  estavam.

## Conferido em 26/10/2026 (A4, DRE do histórico)

`scripts/historico-financeiro/conferir-dre.ts` monta a DRE como a tela monta
e compara, linha a linha e trimestre a trimestre, com o total das abas DRE da
planilha (saída em `validacao/dre*.csv`).

- **Com tudo o que a planilha tem** (o padronizado inteiro, com as
  previsões), 2023 a 2025 batem nas quatro empresas, menos quatro células,
  todas explicadas pela planilha:
  - California 2024, perda, 3T: −40.000 digitados na fórmula, sem
    lançamento;
  - California 2024, despesa administrativa, 4T: R$ 147,10 de uma linha do
    Fundo Fixo que a padronização deixou de fora (E3);
  - CMH 2023, custo tributário, 4T: a célula da Santander soma a coluna de
    crédito em vez da de débito; o histórico conta os R$ 58.426,48;
  - Hitlab 2024, receita financeira, 3T: a planilha só soma o crédito; o
    histórico desconta R$ 389,63 de débito.
  Nos subtotais, além disso, só a posição da bonificação (o resultado líquido
  operacional da California em 2023, da CMH em 2023 e 2025 e da Hitlab em
  2025) e o reinvestimento do ano da Hitlab, que a planilha deixa em zero.
- **2026**, além do que falta carregar, difere pela regra em: crédito
  negativo no custo tributário (R$ 10.250,24, que a planilha ignora);
  créditos na distribuição de lucro (R$ 630.000 na Santander GoCrazy, que a
  planilha ignora); a Santander GoCrazy, que a planilha deixa "n/a" no
  empréstimo à Hitlab (na 1ª carga, R$ 1.140.710 de custo da Hitlab pago por
  ela); o mútuo na BB GoCrazy, que a planilha não soma (±350.000, sem efeito
  no reinvestimento); e o total do ano da CMH, que na planilha não soma os
  trimestres. Ficam também os espaços sobrando e a linha excluída que a E3
  já apontava.
- **A tela hoje (1ª carga)** fica abaixo da planilha porque a carga vai de
  01/01/2023 a 30/06/2026 e não tem as previsões. Receita e lucro líquido da
  California, em milhões:

  | Ano | Planilha | Tela (1ª carga) | Com o que está fora da janela | E com as previsões |
  |---|---|---|---|---|
  | 2023 | 40,81 · 6,21 | 40,16 · 5,62 | 40,73 · 6,18 | 40,81 · 6,21 |
  | 2024 | 68,81 · 13,57 | 68,54 · 13,43 | 68,54 · 13,43 | 68,81 · 13,57 |
  | 2025 | 89,31 · 12,20 | 86,06 · 9,55 | 87,18 · 10,39 | 89,31 · 12,20 |

  Fora da janela, em 2023, é sobretudo receita recebida antes de 2023 (R$
  0,57 milhão); em 2025, recebida no 3T de 2026 (R$ 1,06 milhão).
- **A tela confere com o script:** todos os valores da California 2025, da
  CCH 2023, da Hitlab 2024 e da Ventura 2026 iguais até o centavo (o script
  arredonda cada linha em centavos, como o banco). A função devolve nulo para
  quem não é admin nem financeiro (testada com um produtor). No celular, a
  tabela rola dentro da própria caixa. Typecheck, lint, build e os 10 testes
  de `dre.test.ts` limpos.

## Conferido em 26/10/2026 (A4, resultado por regional)

`scripts/historico-financeiro/conferir-regional.ts` compara, trimestre a
trimestre e regional a regional, as linhas em que a planilha e o histórico
seguem a mesma fonte (o custo fixo e o pessoal da regional e do TD, o
imobilizado e o PL) com as células das abas Gerencial.

- **California, 2023 a 2025:** com tudo o que a planilha tem, todas as
  células batem ou diferem em centavos (as frações de centavo), menos as das
  exceções já medidas (o TD ÷4).
- **CMH:** 2025 bate, menos duas células com R$ 73,75 cada: a planilha usa a
  coluna "Doc." da aba BB Go Crazy como regional da CMH, e três tarifas TD do
  1T (R$ 147,50) ficaram no histórico como documento, sem regional. Em 2023,
  no 1T e no 2T, a planilha não separa a regional e rateia todo o custo fixo e
  o pessoal; em 2024, o bloco do 1T lê o 2T, e o do 2T lê 2023.
- **2026:** a coluna BH da CMH soma por uma coluna que só existe em 2026 e que
  o histórico não guarda como regional (R$ 96.140,46 de pessoal por
  trimestre, em "Sem regional"); o imobilizado da CMH no 2T sai zerado na
  planilha; o resto é o que falta carregar e os espaços sobrando que a E3 já
  apontava.
- **A tela confere com o cálculo:** a California de 2025 (o ano) igual ao
  script até o centavo, com cada linha somando o total da DRE; a CCH de 2023
  com a Urbia; o 4T 2024 com as linhas próprias da linha 147. A função
  devolve nulo para um produtor. No celular, a tabela rola dentro da caixa.
  Typecheck, lint, build e os 63 testes da pasta limpos.

## Conferido em 26/10/2026 (A4, resultado por regional pelos jobs)

`scripts/historico-financeiro/conferir-regional.ts --fechamento` compara, com
o padronizado e as previsões (a mesma base da planilha), o faturamento, o
imposto teórico, o custo operacional e o benefício de cada regional e
trimestre com as abas "DRE Califa Regional" e "DRE CMH Regional" do
Fechamento. A soma dos movimentos repete a da função do banco.

- **California, 2023 a 2025:** 153 células batem e 54 diferem em centavos;
  as 17 restantes são as do benefício job a job (2T 2024, 2T a 4T 2025).
- **CCH, 2024 e 2025:** 68 batem e 12 em centavos. Em 2023, 18 batem e uma
  em centavos; as 21 restantes são as da tabela acima.
- **2026:** a Copa e os três jobs da CCH na regional do lançamento, o custo
  tributário do 1T que a DRE da planilha conta R$ 10.250,24 a menos, e o que
  o Fechamento traz depois da exportação de 25/10.
- **A carga:** refeita pela tela com o pacote novo (56.713 movimentos, 3.222
  notas, 3.586 jobs, conferidos com o pacote; a carga anterior ficou
  substituída). A tela da California de 2025 e a da CCH de 2024 batem até o
  centavo com o cálculo do script, linha a linha; o lucro após investimento é
  o lucro líquido da DRE do histórico (R$ 9.547.388,95 e −R$ 1.920.945,91), e
  o imposto teórico mais o benefício é o custo tributário. O resultado do 2T
  2026 tem só o que entrou no caixa até 30/06: R$ 35,5 milhões do faturamento
  desse trimestre vêm na carga do 3T (A5).
- A função leva 0,18 s no ano (0,13 s antes da divisão). A primeira versão,
  que abria a divisão uma vez por movimento, levava 0,36 s: a 100009 soma os
  movimentos por job antes, com a mesma resposta nas 1.774 linhas de 2023 a
  2026.
- Typecheck, lint e os 68 testes da pasta limpos.
- **Projetos proprietários** (mesmo dia): de 2023 a 2025 nada muda (não há
  projeto). Em 2026, com as previsões, o faturamento, o imposto e o custo das
  regionais e o faturamento e o custo dos projetos batem com o Fechamento no
  1T e no 2T, nas duas empresas; diferem só o imposto e o benefício digitados
  da tabela acima, e o benefício do 1T, pelo custo tributário que a DRE da
  planilha conta R$ 10.250,24 a menos. Na tela, a California do 2T 2026, a CCH
  do 1T 2026, a California de 2025 e a CCH de 2024 batem linha a linha com o
  cálculo do script, e a última linha fecha com a DRE do histórico em todos os
  trimestres de 2023 a 2026 (a diferença do 1T 2024 é a perda da FitDance, que
  o relatório soma e a DRE põe depois do lucro). 72 testes.
- **"NE" e "SP" da CMH na Doca e na Agency** (mesmo dia): de 2023 a 2025 a
  conferência com a DRE regional do Fechamento não muda. Saem de "Sem
  regional" R$ 122.952,46 de pessoal da CMH marcados SP no 1T 2023 (vão para a
  Agency; nesse trimestre a Gerencial 23 CMH não separa a regional), R$ 65,40
  de despesa administrativa de 2024 (Doca) e, em 2026, o faturamento do
  Festival de Gastronomia (R$ 484.481,70, Doca). A Gerencial 26 deixa fora da
  Agency R$ 7.000,00 de pessoal da CMH marcados SP no 4T 2026; o histórico os
  põe na Agency. 69 testes.

## Conferido em 26/10/2026 (A4, rentabilidade dos jobs)

`scripts/historico-financeiro/conferir-rentabilidade.ts` compara, job a job,
as seis colunas de cada linha das abas Res. Jobs (a da aba mais nova do job)
com a conta do histórico. Com o padronizado, as previsões e as notas a emitir
(a mesma base da planilha), de 2023 a 2025:

| Aba | Receita | Imposto | Custo | Resultado | Rentabilidade |
|---|---|---|---|---|---|
| California 2023 | 364/364 | 362/364 | 364/364 | 362/364 | 362/364 |
| California 2024 | 450/450 | 450/450 | 450/450 | 450/450 | 449/450 |
| California 2025 | 588/588 | 585/588 | 587/588 | 585/588 | 584/588 |
| Go Crazy 2024 e 2025 | 63/63 | 61/63 | 63/63 | 61/63 | 61/63 |
| CCH 2023 e 2024 | 261/261 | 256/261 | 254/261 | 249/261 | 249/261 |

Os jobs que diferem são os da lista acima: as notas que o histórico liga ao job
e a planilha não soma (nome diferente), os investimentos da CCH e as linhas em
branco. A CCH de 2025 bate na receita (108/108), no imposto (98) e no custo
(108), e não no resultado, pela fórmula dela. "Batem" inclui os centavos das
frações da planilha.

## Conferido em 26/10/2026 (A4, faturamento dos jobs)

As abas Res. Jobs não têm coluna de faturado. A coluna IMPOSTO de cada job
soma, por SUMIFS, o Total Impostos das abas de Faturamento cujo JOB é o nome
do job. `scripts/historico-financeiro/conferir-faturamento.ts` refaz esse
SUMIFS em cada linha de job de 2023 a 2026, com as mesmas abas e o mesmo
critério. No lugar do Total Impostos, soma o Valor das notas emitidas no
período da carga (o faturado) e o das que têm data de recebimento (o
recebido), e compara com as notas do pacote:

| Aba | Notas | Faturado | Recebido |
|---|---|---|---|
| California 2023 | 362/364 | 362/364 | 362/364 |
| California 2024 | 450/450 | 450/450 | 450/450 |
| California 2025 | 586/588 | 586/588 | 586/588 |
| California 2026 | 634/635 | 634/635 | 634/635 |
| Go Crazy 2024 a 2026 | 93/94 | 93/94 | 93/94 |
| CCH 2023 a 2026 | 507/524 | 507/524 | 513/524 |
| Hitlab 2024 a 2026 | 54/55 | 54/55 | 54/55 |
| Ventura 2026 | 2/2 | 2/2 | 2/2 |

Os 24 jobs que diferem, de 2.712, são os mesmos motivos do imposto na
rentabilidade:
- **19 jobs:** o histórico liga ao job uma nota de uma aba de Faturamento que
  a fórmula dele não soma. Quase todos são da CCH faturados pelo CNPJ da Go
  Crazy, que a coluna IMPOSTO da CMH não olha.
- **4 jobs:** o JOB da nota tem espaço sobrando ou acento diferente. O SUMIFS
  conta essa diferença; o histórico apara o texto.
- **1 job:** o mesmo nome está na aba da CCH e na da California. A planilha
  soma as mesmas duas notas nas duas linhas; o histórico as liga a um job só.

Uma linha da Hitlab de 2024 não tem a fórmula.

- **Na tela**, os totais são os das notas do pacote. Na California de 2025:
  634 jobs, 865 notas, R$ 92.542.399,09 faturados, R$ 90.272.455,64
  recebidos e R$ 2.269.943,45 a receber, com 570 jobs recebidos, 10 parciais,
  3 a receber e 51 sem nota. Na CCH de 2024: 166 jobs, 184 notas e
  R$ 6.250.984,77 faturados.
- **Somas e acesso:** a soma das linhas fecha com o total nas três visões e
  num trimestre (2T de 2025). Para um usuário produtor, a função devolve nulo.
- **Ambiente:** sem erro no console nem no servidor, e build OK.

## Conferido em 26/10/2026 (A4, faturamento por CNPJ)

- **Por CNPJ e mês:** em 2025, os 41 valores da tela são iguais à soma das
  notas emitidas no banco. O faturamento de cada aba em cada mês já batia
  entre a planilha e o padronizado (E3) e entre o pacote e o banco (A2).
- **Lista e filtro:** a lista da aba Go Crazy de 2025 traz as 85 notas (58 de
  job, 25 de distribuição de lucro e 2 sem job), com os mesmos totais da
  linha. O filtro do emissor Go Crazy na CCH de 2025 dá os 7 jobs, com
  R$ 1.723.000,00 faturados e R$ 1.276.400,00 recebidos, como o banco.
- **Visões por job:** os totais sem filtro não mudaram.
- **Ambiente:** sem erro no console nem no servidor, e build OK.

## Conferido em 26/10/2026 (A5, o 3T na versão de 25/10, sem carga)

- **O limite do Ano Comp.:** em toda a planilha a coluna tem até 6
  caracteres. Só duas linhas do 3T da Conta California BB trazem uma anotação
  de 26 caracteres digitada nela. O contrato do pacote
  (`lib/historico-financeiro/pacote.ts`) aceitava 20 e passa a aceitar 120,
  como a coluna "DRE extra". O banco guarda `text` sem limite, então não houve
  migration. A tela de carga só aceita o pacote do 3T depois do deploy desse
  contrato.
- **E1:** as 82 abas saíram idênticas, byte a byte. Só o manifesto muda, pela
  hora da extração.
- **E2:** movimentos, notas, jobs, previsões e propostas de de-para saíram
  idênticos aos de antes, e os textos sem de-para aprovado são os mesmos 191.
  A lista de pendências ganhou a coluna da carga e passou a cobrir o 3T: 16 da
  1ª carga, 9 do 3T e 4 sem carga (as dos jobs e as de data). As 20 de antes
  são as mesmas (16 + 4).
- **E3:** idêntica à de 25/10, que já cobria 2026 inteiro. Só no 3T:
  - Das 610 células das abas DRE e Gerencial com critério do 3T 2026, 608
    batem. A linha "Empréstimo a CMH" do 3T na DRE da California soma
    R$ 9.759,00 a mais no histórico: é um lançamento com espaço sobrando no
    texto, que o SUMIFS da planilha deixa de fora. A linha FIT do 3T na DRE CMH
    é um `#REF!` da própria planilha.
  - Os saldos de julho a setembro (30 contas × mês) batem e encadeiam.
  - O faturamento (14 abas × mês) bate, com 2 centavos de fração na Go Crazy
    St André em julho.
- **O pacote do 3T** (`cargas/3t-2026.json`, 4,3 MB): 7.325 movimentos (soma
  R$ 9.203.359,58), 385 notas (R$ 44.639.771,23), 3.586 jobs, 40 linhas de
  rateio e 41 saldos. Foi conferido pelo contrato, como a tela e o servidor
  conferem, e não foi carregado.
- **O período já carregado não muda:** o pacote da 1ª carga refeito agora é
  idêntico, tabela por tabela, ao que está no banco.
- **As 9 pendências do 3T são de um job só:** um nome de job do 3T de 2026 que
  não está em nenhuma aba Res. Jobs da versão de 25/10. Ele aparece em 8
  lançamentos da Conta Santander Califórnia (R$ 43.216,48) e em 1 nota da aba
  Faturamento California (R$ 31.876,48). Corrige-se na planilha. Se o 3T for
  carregado assim, os lançamentos e a nota entram sem job.

## Conferido em 27/10/2026 (A5, a carga do 3T)

- **A carga:** o pacote do 3T entrou pela tela, pela sessão do Tiago, a
  pedido dele ("Sim, carregue o 3T pela tela agora"), em 6 segundos:
  7.325 movimentos (R$ 9.203.359,58), 385 notas (R$ 44.639.771,23), 3.586
  jobs, 41 saldos e 40 linhas de rateio. O banco conferiu com o pacote ao
  concluir. A carga "3T 2026" ficou ativa ao lado da 1ª carga, que não mudou.
- **Mês a mês:** os 26 grupos de conta por mês (julho a setembro) saem do
  banco iguais aos do pacote.
- **Telas:** os quatro relatórios do histórico abrem em 2026 sem erro, e a
  cobertura vai até 30/09/2026. Na DRE da California de 2026, o 3º trimestre
  tem R$ 8.647.743,05 de receita. A coluna do 4º trimestre mostra o que já
  tinha competência do 4T e foi lançado até 30/09: R$ 5.364.811,56 de receita
  e R$ 1.542.869,99 de custo operacional. No Extrato da BB California, agosto
  mostra as 136 linhas do histórico.
- **O que ainda não aparece:** o Extrato mostra o histórico só antes da data
  do saldo inicial da conta (01/08 na California Santander, 11/09 em oito
  contas). O fim do 3T aparece quando o saldo inicial passar para 01/10.

## Saldo inicial das contas correntes em 01/10 (A5, 27/10/2026)

- **A aplicação automática é conta à parte.** Os extratos de outubro mostram
  a conta corrente em R$ 0,00 todo dia nas duas contas mais movimentadas: o
  banco aplica o que sobra (Rende Fácil no BB, ContaMax na Santander), e a
  planilha soma a aplicação no saldo da conta. **Decidido (Tiago, 27/10/2026,
  na sessão bifurcada):** "Ok, concordo com a recomendação vamos fazer as duas
  contas para ter as contas de aplicação."
  - Cada aplicação e cada resgate do extrato vira transferência entre a
    corrente e a aplicação, por regra, e o rendimento entra na aplicação como
    receita financeira (RF).
  - A conta corrente começa em 01/10 com R$ 0,00, como o banco.
  - A aplicação começa com o saldo de 30/09, conferido com o extrato dela.
- **Conta bancária e conciliação passaram para o Tiago** ("Eu tomei frente da
  conta bancaria e conciliação, então isso passa por mim mesmo"). Antes eram
  da frente do Antonio.
- **BB California:** a data do saldo inicial foi de 11/09 para 01/10 pela tela
  de contas bancárias, com R$ 0,00.
- **California Santander:** a tela não deixa mudar o saldo inicial de conta
  com lançamento, e esta tem 25 baixas de PP. Por isso a mudança foi pela
  migration `20261027100001`: de R$ 100.000,00 em 01/08 para R$ 0,00 em 01/10.
  Ela é destrutiva e foi confirmada pelo Tiago ("a California Santander
  direto no banco por causa da trava"). As 8 baixas de agosto e setembro
  ficaram antes do início, e estão no histórico. A troca está na auditoria,
  como a edição pela tela.
- **Conferido no Extrato:** em setembro, as duas contas mostram o histórico
  com "A conta começa no sistema em 01/10/2026". O saldo final de setembro dá
  R$ 132.975,94 no BB, igual à planilha, e R$ 14.645,67 na Santander, contra
  R$ 14.648,11 na planilha. Os R$ 2,44 são as frações de centavo que a
  planilha guarda e o histórico arredonda. Outubro começa em R$ 0,00.

### As contas de aplicação e as contas da Hitlab e da Go Crazy (27/10/2026)

Com os extratos das aplicações que o Tiago mandou (PDF da Santander, do BB
e da Hitlab; xlsx da Go Crazy), autorizado por ele: "Pode criar as 4 contas
de aplicação com o saldo do extrato em 01/10, ajustar a Santander GoCrazy e
a BB California pela tela e a Santander Hitlab por migration".

| Conta de investimento (nova, pela tela) | Saldo em 01/10 (extrato de 30/09) | Planilha em 30/09 |
|---|---|---|
| Santander ContaMax California | R$ 14.648,13 | R$ 14.648,11 |
| BB Rende Fácil California | R$ 132.975,94 | R$ 132.975,94 |
| Santander ContaMax Hitlab | R$ 32.827,98 | R$ 32.827,98 |
| Santander ContaMax GoCrazy | R$ 68.516,98 | R$ 68.516,98 |

- A planilha soma a aplicação no saldo da conta, e a conta corrente fecha
  30/09 em R$ 0,00 nas quatro: o saldo da planilha é o da aplicação. Na
  California Santander, o sistema começa R$ 0,02 acima da planilha (vale o
  extrato).
- As contas de investimento ficam sem agência e conta: o extrato OFX é o da
  conta corrente (as linhas "APLICACAO CONTAMAX" e "RESGATE CONTAMAX
  AUTOMATICO" vêm nele), e com o número repetido o arquivo casaria com duas
  contas.
- **Santander GoCrazy:** começa em 01/10 com R$ 0,00 (era 11/09), pela tela,
  com a agência e a conta do extrato.
- **Santander Hitlab:** agência e conta do extrato, pela tela; a data foi
  de 11/09 para 01/10 pela migration `20261027100006` (destrutiva,
  confirmada), porque a conta tem 5 baixas de PP, todas de 14/10, que
  continuam somando.
- **BB California:** agência e conta do extrato, pela tela.
- Conferido: cada extrato OFX que temos casa com uma conta só pela regra da
  importação (`arquivoEhDaConta`), e a Conciliação mostra as quatro contas de
  investimento com o saldo da tabela.
- **Falta o outubro da Hitlab:** vieram só setembro da conta e da aplicação.
  A Go Crazy está completa (extrato de 30/09 a 27/10 e aplicação de setembro
  e outubro, que bate linha a linha com o extrato).

### A regra que vira transferência e os extratos de outubro (28/10/2026)

- **Extratos importados** (pedido do Tiago, 27/10): California Santander
  1.478 linhas, BB California 52, Santander GoCrazy 107. O automático
  conciliou 667 linhas pelo histórico (a cauda), 18 baixas feitas à mão e
  44 tarifas pela regra; nenhum título foi baixado sozinho. As 2 linhas da
  GoCrazy de 30/09 (antes do início da conta) foram ignoradas.
- **Regra de transferência** (migration `20261028100001`; pedido do Tiago
  em 28/10: "Pode fazer a regra que transforma cada aplicação e cada resgate
  do extrato em transferência entre a conta corrente e a conta de
  aplicação"): a regra do extrato ganha a conta de destino
  (`extrato_regras.conta_destino_id`). Com ela, `lancar_pela_regra` cria e
  efetiva uma transferência entre contas (decisão 124), no sentido do sinal
  da linha (saída vai para a aplicação; entrada vem dela), na data e no
  valor do banco; a perna da conta corrente se liga à linha, e o Desfazer
  apaga as duas pernas e a transferência. Na aba Banco, o "Lembrar como
  regra" ganha "Transfere para outra conta", e a linha sem correspondência
  tem o atalho "Criar uma regra para este histórico".
- **As cinco regras, criadas pela tela:** APLICACAO CONTAMAX e RESGATE
  CONTAMAX AUTOMATICO na California Santander (para a Santander ContaMax
  California) e na Santander GoCrazy (para a Santander ContaMax GoCrazy), e
  BB RENDE FACIL no BB California (para a BB Rende Fácil California). 42
  transferências feitas: 16 na Santander, 14 no BB, 12 na GoCrazy.
- **Conferido:** a Santander ContaMax GoCrazy fecha em R$ 71.654,65, o saldo
  da aplicação no extrato do banco em 26/10. As outras duas aplicações ainda
  não têm o extrato de outubro para conferir, e o rendimento delas (receita
  financeira) entra à parte.
- **Correção no motor:** a aplicação de R$ 11.000 da GoCrazy em 06/10 tinha
  se conciliado sozinha "do histórico" com dois pagamentos de um job do 3T
  do mesmo dia que somavam o mesmo valor (a regra ainda não existia). A
  linha foi desfeita e lançada pela regra, e o motor agora não procura a
  cauda para a linha que uma regra do extrato descreve.

### Tarifas, IOF e a regional da regra (28/10/2026)

- **A regra antes do título** (revisão da decisão 199): duas tarifas de
  R$ 250,00 da California Santander recebiam a sugestão de PPs de verba do
  mesmo valor; agora a linha que casa com uma regra vai pela regra.
- **Regras novas, pela tela, com o Tiago:** BB California "TAR" (04.012
  Tarifa bancária) e "COBRANCA DE I.O.F." (07.009 Outros, onde a planilha
  lançou o IOF de outubro, R$ 5.599,01); Santander GoCrazy "TAR" (04.012).
  Todas na gerencial Agência California: GoCrazy é só CNPJ (contábil), não
  empresa gerencial. 18 linhas lançadas.
- **A regional da regra** (migration `20261028300001`): `extrato_regras.regional_id`,
  opcional — vazio é o "TD" da planilha (rateado entre as regionais). O
  "Lembrar como regra" ganhou o campo Regional, e `lancar_pela_regra` grava
  a regional no lançamento. O Tiago primeiro decidiu TD para tudo e depois
  mudou: "Na verdade vamos fazer como a planilha. Colocando as tarifas da
  conta GO CRAZY como SS." A regra "TAR" da GoCrazy recebeu SS, e as 12
  tarifas que ela já tinha lançado também (só o campo vazio foi preenchido,
  com auditoria). As da California Santander e do BB continuam TD, como na
  planilha.

### As devoluções de PIX viram "saiu e voltou" (28/10/2026)

- **A regra** (Tiago): o PIX que sai e volta é um pagamento errado que
  retorna, mesmo quando é custo de job; o custo do job vai na nova
  transação. No sistema, a saída e a volta viram par "saiu e voltou": as
  duas linhas se anulam, fora do resultado, como o estorno da planilha.
- **27 pares na California Santander** (R$ 181.620,40) pelo motor, todos com
  a saída no mesmo dia: 26 "DEVOLUCAO DE PIX" e o "PIX DEVOLVIDO" de R$ 4.200 de 02/10
  (o estorno da planilha; o pagamento refeito em 05/10 está na cauda). Para
  esse último, o motor e `registrar_saiu_e_voltou` passaram a aceitar
  "PIX DEVOLVIDO" (migration `20261028300002`).
- **As duas "DEVOLUCAO DE PIX NAO EFETUADA" de 08/10** (R$ 350 e
  R$ 1.200) também viraram par, a pedido do Tiago, depois de conferir que o
  banco devolveu o dinheiro no mesmo dia. As saídas de mesmo valor daquele
  dia estavam todas ligadas à cauda; uma de cada valor foi desligada
  (Desfazer) e entrou no par. O extrato não diz qual favorecido ficou sem o
  PIX, então a linha da planilha que ficou sem banco é uma das do dia, não
  necessariamente a do favorecido certo. A planilha registra esses
  pagamentos como feitos, sem estorno, e não há saída refeita na Santander:
  em R$ 350, a planilha tem 11 pagamentos em 08/10 e o banco, 9 tentativas.
  Fecham 29 pares, R$ 183.170,40 (todas as devoluções de outubro da conta).
- As três devoluções que a planilha lançou como entrada no custo do job
  (R$ 15.500) já estão conciliadas pela cauda, como a planilha.

## A cauda: outubro dos jobs até o 3T (A6, 27/10/2026)

Depois do inventário do 4T (planilha de 01 a 25/10 contra os extratos e o
sistema, só leitura, em `tmp/historico-planilha/inventario-4t/`), o grosso
do que faltava no sistema eram pagamentos e recebimentos de jobs do 1T ao
3T que não existem nele. **Decidido (Tiago, 27/10/2026):** "Os movimentos de
outubro dos jobs até o 3T entram no histórico, como uma carga própria, e a
conciliação marca essas linhas do extrato como do histórico. No sistema
ficam só os jobs do 4T." Os jobs do 3T que já existem no sistema (cerca de
15, com PPs) **ficam no sistema** (resposta dele à pergunta).

- **A carga `cauda`** (migration `20261027100007`): o histórico passa a ter
  dois tipos de carga. A de período vai até 30/09, como antes; a cauda
  começa em 01/10 e leva só as linhas dos jobs até o 3T de 2026 (ou de ano
  anterior) que não existem no sistema, escolhidas pelo
  `empacotar.ts --cauda` (`jobDaCauda`). A cauda nova substitui a ativa ao
  concluir, qualquer que seja o período, porque cresce a cada planilha.
- **Carregada pela tela em 27/10/2026:** "Outubro 2026 · jobs até o 3T", de
  01/10 a 25/10, com 1.058 movimentos (995 na California Santander, 32 no
  BB California, 30 na Santander GoCrazy, 1 no Paypal), soma
  R$ 4.418.507,94, 54 notas emitidas em outubro desses jobs e 200 jobs
  citados. Nenhuma linha da cauda é baixa já feita no sistema (as 47
  coincidências de valor eram valores redondos de jobs diferentes).
- **A conciliação marca a linha do extrato como do histórico** (migration
  `20261027100008`): a linha da cauda liga à linha do extrato
  (`historico_movimentos.extrato_linha_id`), sem lançamento, pela
  `conciliar_linha_pelo_historico`; a linha fica conciliada "como
  histórico" e o Desfazer solta. Na aba Banco, o motor procura a cauda em
  dois momentos (`lib/conciliacao/historico.ts`): antes dos títulos, só a
  linha do mesmo dia e do mesmo valor, para um pagamento de job do 3T não
  virar baixa de um título do 4T de mesmo valor (a baixa feita à mão
  continua na frente); depois dos títulos, o que ficou sem par procura até
  5 dias e as somas do dia (as do mesmo job, todas, ou duas a três). O que
  casa se concilia sozinho na importação; o resto fica na seção "Do
  histórico da planilha", com Conciliar.
- **A conta conta a cauda:** o saldo do sistema no fechamento, no resumo
  das contas e no saldo anterior (`calcularSaldoAnterior`) soma os
  movimentos da cauda desde o início da conta, e o fechamento pede a linha
  do banco também para eles. A cauda nova substitui a ativa e solta as
  linhas do extrato ligadas a ela, que voltam a pendentes para a tela ligar
  à cauda nova.
- **Simulação com os extratos de outubro (27/10/2026, sem gravar):** na
  California Santander, 644 das 1.478 linhas se resolvem pelo histórico e
  sobram 318 linhas da cauda sem linha do banco (R$ 1,66 mi: sobretudo
  recebimentos que a planilha divide por nota e o banco recebe numa TED);
  no BB California, 12 linhas e sobram 7; na Santander GoCrazy, 16 e
  sobram 11.
- **O Extrato e o fluxo de caixa contam a cauda** (migrations
  `20261027100009` e `20261027100010`): no Extrato da conta, depois do
  início dela, as linhas da cauda entram na ordem do dia, só de leitura
  ("Histórico da planilha · job", coluna Job "Histórico"), e o saldo de cada
  linha bate com o do resumo; o histórico antes do início lê só as cargas
  de período. No fluxo de caixa, a `vw_fluxo_caixa` ganha o ramo
  `historico` (movimento realizado na conta, sem job do sistema) e a
  `fc_saldos_por_conta` soma a cauda. Conferido em 27/10/2026: a California
  Santander em outubro tem 1.014 linhas no Extrato (19 lançamentos e 995 da
  cauda) e fecha em R$ 2.493.840,94, o mesmo do resumo das contas; o fluxo
  mostra outubro com R$ 8.465.007 de entradas e R$ 4.626.469 de saídas
  realizadas.
- **O fluxo de caixa lê a view página a página:** com a cauda, a consulta
  passou de mil linhas, o teto do PostgREST, e as previsões dos meses
  seguintes sumiam da tela sem aviso.
- **Falta:** escolher à mão as linhas da cauda de uma linha do banco que o
  motor não casou (as 318 da California Santander, sobretudo recebimentos
  que a planilha divide por nota).

## O que fica para depois
- A4: o imposto teórico e o benefício da Copa que a planilha digita (linhas
  85 e 91 da Res. Jobs 2026; R$ 1.520.000,00 de benefício): o histórico segue a
  alíquota e o faturamento. A carga do 3T trouxe a receita da Copa: falta
  confirmar com o Tiago se o imposto da Copa deve seguir o digitado.
- Revisar o rateio de um ano, mantendo o registro da planilha dos anos
  fechados. O RH tem a própria tabela de rateio
  (`empresas_rateios_regionais`, do Antonio), com percentuais diferentes dos
  da planilha em 2023, 2024 e 2026: um lugar só se decide com ele.
- A5, o que sobrou da carga do 3T:
  - As contas de aplicação (Santander ContaMax e BB Rende Fácil), com o saldo
    de 30/09 do extrato da aplicação, que o Tiago vai mandar.
  - As outras 9 contas: o saldo inicial em 01/10 com o saldo do extrato de
    30/09, comparado com a planilha. É o critério de "3T fechado".
  - Corrigir na planilha o job do 3T que falta nas abas Res. Jobs (as 9
    pendências) e recarregar o 3T. Numa versão nova, E1, E2, E3 e o pacote
    rodam de novo, e o pacote da 1ª carga se compara com o do banco.
- As 20 pendências: as de data e de nome de job se corrigem na planilha e
  entram numa versão nova.
- A trilha do 4T no sistema. **Decidido (Tiago, 26/10/2026):** o corte fica em
  30/09, em duas etapas — "Vamos primeiro até 30/09, e depois vamos tentar
  subir as movimentações no sistema [...] O ideal seria termos 4T inteiro no
  sistema, e acho que vale a tentativa", para o sistema bater com a planilha e
  ela poder ser largada.
  - **Primeiro, um inventário** de tudo do 4T que não está no sistema, sem
    lançar nada, separado pelo jeito de entrar: job a subir, nota a faturar,
    título a receber, PP, avulsa, folha, imposto ou transferência. Inclui o
    que tem competência do 4T e foi lançado até 30/09.
  - **Os extratos até 25/10**, que o Tiago já tem, entram para casar cada
    linha do banco com a da planilha.
  - **A relação de recorrências** que o Tiago vai mandar serve para cadastrar
    os custos fixos no sistema e ajudar a achar o título de cada baixa do OFX
    depois de 30/09.
