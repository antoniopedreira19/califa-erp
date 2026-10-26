# 211 — Importação do histórico da planilha financeira: como ler a planilha e o corte em 01/10/2026

**Data:** 2026-10-25
**Status:** aceita. E1 (extração) e E2 (padronização) implementadas em
25/10/2026, sem nada gravado no banco. A revisão da E2 (pendências e
de-para) está com o Tiago.
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

### Onde o histórico vai morar

Em tabelas próprias de histórico, só para leitura, com a carga identificada
por período (entrega A1, a fazer). Cada registro aponta para o que já existe
no sistema (conta, empresa, regional, plano de contas, cliente, marca e, quando
houver, o job) e guarda o texto original da planilha. Cliente e marca sem
cadastro ficam como texto: o histórico não cria cadastro.

## O pipeline (E1 e E2)

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
  3,6 mil jobs nas abas de 2021 a 2027 e 76 pendências na primeira carga.

## O que fica para depois

- A revisão da E2 pelo Tiago: pendências, de-para e duas perguntas que só ele
  responde (a regional "COPA" dos jobs da Copa Arena e as notas sem job com a
  Obs. "DL").
- E3: a validação completa contra a DRE, o faturamento e os saldos.
- A1 e A2: as tabelas de histórico, a tela de importação e a primeira carga.
- A trilha do 4T no sistema: os jobs do 4T que só estão na planilha, as notas de
  outubro, a virada de 30/09 e a conciliação de outubro pelo OFX.
