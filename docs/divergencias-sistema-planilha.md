# Divergências entre o sistema e a planilha financeira

Uma entrada por diferença entre o que o sistema mostra e o que a planilha mostra no histórico (decisão 211). Cada entrada diz de quanto é a diferença, por que ela existe, qual número vale e como explicar para a gestão.

**Base desta versão:** planilha `Fin. Conta Califórnia (6).xlsx`, exportada em 01/11/2026; sistema com as cargas ativas de 02/11/2026, 66.112 linhas. Os valores são sempre planilha menos sistema, salvo indicação.

**Como manter:**

- Toda diferença encontrada numa conferência entra aqui antes de a conferência ser dada por encerrada.
- Cada versão nova da planilha pede refazer a conferência e atualizar os valores. Quando o valor for de outra versão, a entrada diz qual.
- A decisão 211 não é reescrita: o código da entrada vai ao lado da frase.
- O repositório é público. Aqui ficam só totais. A tabela mensal do repasse aos sócios e as linhas da planilha ficam fora do repositório.

**Tipos:** regra do sistema, omissão da planilha com prova, falta carregar, pendência de conciliação e erro do sistema. "Omissão da planilha" só é usada com a fórmula ou o texto da célula como prova.

## Onde a conferência está

Cada célula de cada relatório se decompõe em:

```text
planilha − previsões − falta carregar − diferença de regra = sistema
```

| Conferido em 02/11/2026 | Resultado |
|---|---|
| Células comparadas: DRE, regional, rentabilidade e faturamento | 25.927; a soma fecha em todas |
| Diferença de regra sem explicação | Nenhuma |
| Coluna Sistema contra o banco | Igual: 66.112 linhas, a mesma soma de `valor` e os mesmos 1.013 agregados da DRE |
| Linhas até 30/09/2026 | 64.038 na planilha e no sistema, com o mesmo valor, data, Tipo e job; 24 têm texto diferente (DIV-029) |

**O 3T está carregado.** O que ainda separa a planilha do sistema em 2026 são as previsões (DIV-005) e o que falta carregar: linhas depois do extrato de cada conta, PPs e jobs ainda sem lançamento. Em 2026, faltam carregar R$ 2.794.419,25 de receita na Agência California, R$ 28.043,02 na CCH e R$ 751,58 na Hitlab.

Rentabilidade: 2.738 jobs de 2023 a 2026. As abas de 2021 e 2022 ficam de fora, porque o histórico começa em 2023 (DIV-025). Faturamento: 2.240 jobs com nota.

## Lista

| Código | Relatório e linha | Tipo | Diferença | Situação |
|---|---|---|---|---|
| DIV-001 | DRE 2026 · Distribuição de lucro | Omissão da planilha com prova | R$ 630.000 | Decidido: o sistema fica líquido |
| DIV-002 | Mútuo GoCrazy → California · trimestre do Tipo | Regra do sistema | R$ 1.400.000 em outro Tipo; saldo igual | Decidido: um trimestre só |
| DIV-003 | Mútuo de R$ 600.000 · data na GoCrazy | Regra do sistema | 1 dia; valor igual | O sistema usa a data do banco |
| DIV-004 | IOF de R$ 2.549,69 · fornecedor | Falta carregar | Sem valor; só o campo | Aberta: falta a Receita Federal no cadastro |
| DIV-005 | Todos os relatórios · previsões | Regra do sistema | Varia | Some quando a previsão se realiza |
| DIV-006 | DRE 2026 · Custo tributário, 1T | Regra do sistema | R$ 10.250,20 | O sistema conta o crédito |
| DIV-007 | DRE 2026 · Empréstimo à Hitlab | Regra do sistema | R$ 1.064.357,82 no 2T e R$ 528.850,34 no 3T | O sistema soma todas as contas |
| DIV-008 | DRE 2026 · Mútuo interno | Regra do sistema | ±R$ 350.000; efeito líquido zero | O sistema soma as duas pontas |
| DIV-009 | DRE 2026 · CCH, total do ano | Omissão da planilha com prova | R$ 96.801,75 de receita e R$ 85.324,72 de custo | O sistema soma os trimestres |
| DIV-010 | DRE 2024 · Perda, 3T | Regra do sistema | R$ 40.000 | Digitado na fórmula, sem lançamento |
| DIV-011 | DRE 2024 · Despesa administrativa, 4T | Erro do sistema | R$ 147,10 | Linha fora da padronização, a corrigir |
| DIV-012 | DRE 2023 · CCH, custo tributário, 4T | Omissão da planilha com prova | R$ 58.426,45 | O sistema conta o débito |
| DIV-013 | DRE 2024 · Hitlab, receita financeira, 3T | Regra do sistema | R$ 389,63 | O sistema desconta o débito |
| DIV-014 | DRE · Posição da bonificação | Regra do sistema | Só no subtotal | O lucro líquido não muda |
| DIV-015 | DRE 2026 · Texto com espaço sobrando | Omissão da planilha com prova | Seis casos, abaixo | O sistema apara o texto |
| DIV-016 | DRE · Hitlab, reinvestimento do ano | Omissão da planilha com prova | Coluna do ano em zero | O sistema soma os trimestres |
| DIV-017 | Regional · Rateio fora do percentual | Regra do sistema | 22 células | O sistema usa o percentual do ano |
| DIV-018 | Regional · Benefício e projetos no Fechamento | Regra do sistema | 51 células | O sistema rateia pelo faturamento |
| DIV-019 | Regional · Gerencial da CMH em 2023 e 2024 | Regra do sistema | 35 células | O sistema usa a regional do lançamento |
| DIV-020 | Regional · Gerencial 26: coluna BH e CMH | Regra do sistema | R$ 96.140,46 por trimestre e ajustes | O sistema não reproduz a coluna |
| DIV-021 | Regional · Coluna Doc. da BB Go Crazy | Regra do sistema | R$ 147,50 e R$ 97,00 | Ficam sem regional |
| DIV-022 | Rentabilidade · Investimentos da CCH | Regra do sistema | R$ 2.545.888,27 | Decidido: ficam na DRE |
| DIV-023 | Rentabilidade e faturamento · Nota fora da fórmula do job | Regra do sistema | 106 células | O sistema liga a nota ao job |
| DIV-024 | Rentabilidade · Fórmulas das abas | Regra do sistema | 589 células | O sistema usa uma conta só |
| DIV-025 | Todos os relatórios · Lançamento antes de 2023 | Regra do sistema | Linhas com data até 2022 | Fora do histórico por decisão |
| DIV-026 | Rentabilidade · Crédito no Tipo de custo | Regra do sistema | R$ 40.327,00 | O resultado é o mesmo |
| DIV-027 | Rentabilidade · TOTAL CO da Hitlab sem o PayPal | Omissão da planilha com prova | R$ 111.226,89 e R$ 117.718,80 | O sistema soma todas as contas |
| DIV-028 | Rentabilidade · Job em duas linhas | Regra do sistema | R$ 4.760,00 e R$ 4.132,50 | O sistema junta as linhas |
| DIV-029 | Extrato · Texto de 24 linhas até 30/09 | Falta carregar | Sem valor | Aberta: entra se a carga do 3T for refeita |
| DIV-030 | Conciliação · PP-00163 | Regra do sistema | R$ 750,20 | Vale a baixa da PP |
| DIV-031 | Conciliação · PP-00276 | Regra do sistema | R$ 3.000,00 | O job existe como QPC-1001/26 |
| DIV-032 | Jobs · Três códigos diferentes | Regra do sistema | Sem valor | Mesmo job nos dois lados |
| DIV-033 | Extrato · Datas entre banco e planilha | Regra do sistema | Seis lançamentos | O sistema usa a data do banco |
| DIV-034 | Extrato · Tarifas agrupadas | Regra do sistema | Mesmo total | O sistema segue o banco |
| DIV-035 | XP · Resgates fora da planilha | Omissão da planilha com prova | R$ 3.000.963,93 e R$ 2.000.895,65 | Só o extrato confirma |
| DIV-036 | Paypal · R$ 12.873,47 | Falta carregar | R$ 12.873,47 | Aberta: até o lançamento |
| DIV-037 | Contas a pagar · Retenção em quatro PPs | Pendência de conciliação | R$ 267.236,00 | Aberta: falta decidir |
| DIV-038 | Extrato · Estorno de 02/10 | Pendência de conciliação | R$ 4.200,00 no saldo | Aberta: o saldo do sistema fica abaixo |
| DIV-039 | Extrato · Centavos | Regra do sistema | 1 ou 2 centavos em 11 linhas | Sem efeito acima de centavos |
| DIV-040 | Extrato · Linhas que só fecham em conjunto | Pendência de conciliação | R$ 95.780,30 e R$ 39.901,46 | Fecham no conjunto, não linha a linha |
| DIV-041 | Extrato · Um pagamento, vários favorecidos | Pendência de conciliação | Quatro pagamentos | Aberta: quando os jobs entrarem |
| DIV-042 | Extrato · Saída sem linha na planilha | Pendência de conciliação | R$ 4.200,00 | Aberta: extrato de 26/10 parcial |

---

## Mútuo e distribuição de lucro

### DIV-001 · Distribuição de lucro: a entrada que paga o repasse aos sócios

- **Relatório:** DRE do histórico, Agência California, 2026. Afeta Distribuição de lucro e Reinvestimento no caixa. O lucro líquido não muda.
- **Diferença:** R$ 630.000 de entradas que a planilha não desconta: R$ 270.000 no 2T, R$ 270.000 no 3T e R$ 90.000 no 4T. Os R$ 90.000 do 4T estão na planilha e ainda fora das cargas.
- **Qual vale:** o sistema. Decidido pelo Tiago em 31/10/2026: a linha fica líquida, descontando a entrada. Quem mantém a planilha ainda precisa confirmar.

**Para a gestão:** a GoCrazy recebe da Community R$ 90.000 por mês, com nota, e repassa esse dinheiro aos sócios. A planilha conta a saída na Distribuição de lucro, mas desde maio deixa de contar a entrada, porque a fórmula da coluna da Santander GoCrazy na DRE só soma débitos. O fluxo de caixa da própria planilha conta essa entrada. O lucro líquido é o mesmo nos dois.

**O que é esse dinheiro:** a GoCrazy emite duas notas por mês, de R$ 25.000 e R$ 65.000, na aba Faturamento Go Crazy St André, sem cliente e com Obs. "DL". A Community paga por PIX. A GoCrazy repassa o líquido aos sócios e paga os impostos, tudo no Tipo DL. Não é mútuo: a planilha continua prevendo a volta integral dos R$ 1.500.000 em 31/12.

De abril a outubro entraram R$ 630.000,00 e saíram R$ 559.128,00 aos sócios e R$ 90.696,00 em impostos no Tipo DL. O efeito no caixa é −R$ 19.824,00, igual à soma das duas colunas da GoCrazy na linha 33 do fluxo da planilha.

Os dois R$ 630.000 são somas diferentes. A diferença da DRE são as seis entradas de maio a outubro na Santander GoCrazy e a de 01/11. Os R$ 630.000 de abril a outubro incluem a entrada de abril na BB GoCrazy, que a planilha soma.

**A prova na fórmula:**

| Onde | Coluna | Fórmula | Conta a entrada? |
|---|---|---|---|
| Aba DRE, linha 630 | BB GO CRAZY (J, X, AL, AZ) | débito e crédito | Sim, desde 2025 |
| Aba DRE, linha 630 | SS SANTANDER (F, T, AH, AV) | só débito | **Não** |
| FluxodeCaixa-2026, linha 33 | Go Crazy BB | débito e crédito | Sim |
| FluxodeCaixa-2026, linha 33 | Go Crazy Santander, janeiro a abril | só débito | Não, mas não havia entrada |
| FluxodeCaixa-2026, linha 33 | Go Crazy Santander, de maio em diante | débito e crédito | Sim |

O pagamento foi para a Santander GoCrazy em maio, o mês em que a fórmula do fluxo muda e a da DRE fica como estava. O fluxo fecha com o saldo inicial do mês seguinte em todos os meses de 2026, nas duas contas da GoCrazy.

**Como a célula fecha, trimestre a trimestre:**

| Trimestre | Planilha | − Previsões | − Falta carregar | − Regra | = Sistema |
|---|---:|---:|---:|---:|---:|
| 1T | −2.436,86 | 0,00 | 0,00 | 0,00 | −2.436,86 |
| 2T | −411.987,20 | −3.216,33 | 0,00 | −270.000,00 | −138.770,87 |
| 3T | −187.433,00 | −6.528,00 | −3.264,00 | −270.000,00 | +92.359,00 |
| 4T | −6.239.628,00 | −6.239.628,00 | +90.000,00 | −90.000,00 | 0,00 |

O 3T do sistema fica positivo porque a saída de 04/08 aos sócios está no Tipo DL 2T 2026, e a entrada do mesmo dia está no Tipo DL 3T 2026. O 2T fica com quatro saídas para três entradas, e o 3T com duas para três. No ano, isso se compensa.

**Para zerar:** na aba DRE, somar o crédito na coluna SS SANTANDER da linha 630 (F, T, AH, AV) e na mesma coluna da linha 664, de 2027, como já faz a coluna BB GO CRAZY.

**Onde está no sistema:** `lib/historico-financeiro/dre.ts`, `saida("DL", ...)`, com `-(debito-credito)` em todas as contas. A DRE só lê o histórico. Quando passar a ler os lançamentos do sistema, deve manter a mesma regra.

Desde a decisão 231 (02/11/2026), a entrada pode ser lançada no sistema, no Tipo 15 · 001 Notas de sócio, com o repasse aos sócios e os impostos da nota no mesmo subtipo. Até esta versão, nada foi lançado nele. A DRE segue lendo só o histórico, e a divergência continua: ela cresce R$ 90.000 por mês enquanto a fórmula da planilha não mudar. Quando a DRE ler o sistema, o trimestre vem da nota, e não da data do PIX, e o número da nota fica em `contas_avulsas.numero_nf`.

### DIV-002 · Mútuo GoCrazy → California: um trimestre só

- **Onde:** Extrato e Mútuos. A DRE lê só o histórico, então estes lançamentos não chegam nela.
- **Versão:** planilha de 30/10/2026; lançamentos MU-00002 e MU-00003, de 31/10.
- **Diferença:** R$ 800.000 e R$ 600.000. Na perna da GoCrazy a planilha usa `MÚTUO INT 4T 2026` (linhas 4056 e 4081); na da California, `1T 2026` (linhas 57350 e 57811). No sistema, as duas pernas ficam em 1T 2026. O saldo é o mesmo: R$ 5.507.800.
- **Qual vale:** o sistema, pela decisão 230, D4: o trimestre é o do mútuo original, um só para as duas pernas.
- **Para a gestão:** a planilha marcava o mesmo dinheiro em dois trimestres. O sistema marca um só, o do empréstimo original. Quanto a California deve à GoCrazy não muda.

### DIV-003 · Mútuo de R$ 600.000: data na GoCrazy

- **Versão:** planilha de 30/10/2026; MU-00003.
- **Diferença:** a linha 4081 da GoCrazy está em 20/10. O extrato das duas contas e a linha 57811 da California estão em 21/10.
- **Qual vale:** o sistema, 21/10, a data do banco.
- **Para a gestão:** o dinheiro saiu em 21/10, como mostra o banco. O valor não muda.

### DIV-004 · IOF de R$ 2.549,69: sem fornecedor

- **Versão:** planilha de 30/10/2026; lançamento de 15/10 pela linha do banco.
- **Diferença:** a linha 57296 tem Fornecedor Receita Federal. No sistema o campo fica vazio, porque não há esse cadastro e o lançamento do IOF não leva fornecedor. Valor, data, Tipo (`12 · Empréstimos`, T2) e empresa batem.
- **Situação:** aberta. O Tiago deixou o cadastro da Receita Federal para depois, em 02/11/2026.
- **Para a gestão:** falta só o nome do favorecido. O valor é o mesmo.

---

## DRE

### DIV-005 · Previsões

- **Diferença:** a planilha soma lançamentos com data futura, e o sistema traz só o realizado. Em receita, por ano:

| Empresa | 2023 | 2024 | 2025 | 2026 |
|---|---:|---:|---:|---:|
| Agência California | 79.725,98 | 270.612,34 | 2.122.551,01 | 36.125.559,41 |
| CCH | 24.925,44 | 23.000,00 | 578.153,31 | 14.876.817,09 |
| Hitlab | | 49.000,00 | 10.000,00 | 2.457.177,97 |

- **Qual vale:** o sistema, para o realizado. O comparador mostra as duas visões.
- **Para a gestão:** a planilha mistura o que aconteceu com o que se espera que aconteça. A diferença some quando a previsão vira pagamento ou recebimento.

### DIV-006 · Custo tributário, 1T 2026

- **Diferença:** R$ 10.250,20, com o crédito negativo no custo tributário que a planilha ignora. O benefício do 1T no Fechamento carrega a mesma diferença.
- **Qual vale:** o sistema.
- **Para a gestão:** a planilha deixou de abater um crédito. O sistema abate.

### DIV-007 · Empréstimo à Hitlab

- **Diferença:** R$ 1.064.357,82 no 2T e R$ 528.850,34 no 3T. A planilha deixa a Santander GoCrazy como "n/a" nessa linha.
- **Qual vale:** o sistema, que soma todas as contas (decisão 211, "Uma regra só por linha").
- **Para a gestão:** a linha da planilha não olha uma das contas. No sistema o empréstimo aparece inteiro.

### DIV-008 · Mútuo interno

- **Diferença:** ±R$ 350.000 no 1T 2026, da BB GoCrazy, que a planilha não soma. O sistema soma nas duas linhas do mútuo. O efeito no reinvestimento é zero.
- **Para a gestão:** a entrada e a saída aparecem no sistema e se anulam.

### DIV-009 · Total do ano da CCH

- **Diferença:** R$ 96.801,75 de receita e R$ 85.324,72 de custo em 2026. Na aba da CCH, a coluna do ano não é a soma dos trimestres da própria planilha.
- **Qual vale:** o sistema, que soma os trimestres.
- **Para a gestão:** os trimestres batem; só o total do ano da planilha não fecha com eles.

### DIV-010 · Perda, 3T 2024

- **Diferença:** R$ 40.000. A fórmula da planilha tem −40.000 digitados, sem lançamento.
- **Qual vale:** o sistema, que só conta lançamento.
- **Para a gestão:** o valor foi digitado na fórmula. Não há lançamento que o sustente.

### DIV-011 · Despesa administrativa, 4T 2024

- **Diferença:** R$ 147,10. Uma linha do Fundo Fixo ficou fora da padronização.
- **Qual vale:** a planilha. É um erro do sistema, a corrigir quando a carga de 2024 for refeita.
- **Para a gestão:** falta uma linha de R$ 147,10 no sistema.

### DIV-012 · Custo tributário da CCH, 4T 2023

- **Diferença:** R$ 58.426,45. A célula da Santander soma a coluna de crédito em vez da de débito.
- **Qual vale:** o sistema, que conta o débito.
- **Para a gestão:** a fórmula da planilha pega a coluna errada nessa célula.

### DIV-013 · Receita financeira da Hitlab, 3T 2024

- **Diferença:** R$ 389,63. A planilha só soma o crédito, e o sistema desconta o débito.
- **Para a gestão:** o sistema mostra a receita financeira líquida.

### DIV-014 · Posição da bonificação

- **Diferença:** só no subtotal Resultado líquido operacional: R$ 372.469,94 na California e R$ 11.573,48 na CCH no 4T 2023; R$ 183.749,98 na CCH e R$ 5.000,00 na Hitlab no 4T 2025.
- **Por quê:** o sistema põe a bonificação depois do imobilizado em todas as empresas.
- **Para a gestão:** o lucro líquido não muda. Só a ordem das linhas.

### DIV-015 · Texto com espaço sobrando

- **Prova:** na aba Conta Santander Califórnia, estes textos têm espaço a mais. O SUMIFS da aba DRE compara o texto exato e os deixa de fora. O sistema apara o texto e conta.

| Coluna | Texto na célula | Linhas | Valor | Efeito na DRE |
|---|---|---:|---:|---|
| Job | `CMH 1T 2026 ` | 1 | R$ 5.000,00 | Empréstimo à CCH, 1T |
| Job | `CMH 2T 2026 ` | 2 | R$ 748,41 | Empréstimo à CCH, 2T |
| Job | `CMH 3T 2026 ` | 4 | R$ 9.759,00 | Empréstimo à CCH, 3T |
| Job | `CMH 4T 2026 ` e `CMH  4T 2026` | 5 | R$ 14.851,64 | Empréstimo à CCH, 4T |
| Tipo | `DP 4T 2026 ` | 2 | R$ 6.669,70 | Pessoal da California, 4T, e pessoal da regional NE |
| Tipo | `CMH CO 4T 2026 ` | 8 | R$ 5.000,00 | Custo operacional da CCH, 4T |

- **Qual vale:** o sistema.
- **Para a gestão:** o lançamento existe e foi pago. Um espaço a mais no texto faz a planilha não o enxergar. Corrigindo o texto, a diferença some.

### DIV-016 · Reinvestimento do ano da Hitlab

- **Diferença:** a planilha deixa o total do ano em zero em 2024 e 2025. O sistema mostra a soma dos trimestres: R$ 1.222.965,58 e R$ 1.276.307,02.
- **Para a gestão:** a coluna do ano ficou vazia na planilha.

---

## Resultado por regional

As abas Gerencial são as da planilha de 01/11. As linhas de faturamento, imposto, custo e benefício vêm do Fechamento de 26/10. O 3T e o 4T de 2026 esperam a planilha de fechamento do trimestre.

### DIV-017 · Rateio fora do percentual

- **Por quê:** em alguns trimestres a aba Gerencial divide o TD por quatro em vez de usar o percentual do ano. São 22 células, nos trimestres listados em `scripts/historico-financeiro/conferir-regional.ts`.
- **Para a gestão:** o total é o mesmo. Muda só quanto cabe a cada regional.

### DIV-018 · Benefício e projetos no Fechamento

- **Por quê:** o Fechamento divide o benefício job a job em alguns trimestres, põe a CMH de 1T e 2T 2023 toda na Agency e traz valores digitados nos projetos proprietários. O benefício da CCH no 1T 2026 acompanha esse digitado.
- **Qual vale:** o sistema, que rateia pelo faturamento e não reproduz o digitado.
- **Para a gestão:** o sistema aplica uma regra só. A planilha muda de critério em alguns trimestres.

### DIV-019 · Gerencial da CMH em 2023 e 2024

- **Por quê:** em 2023, no 1T e no 2T, a planilha não separa a regional e rateia todo o custo fixo e o pessoal. Em 2024, o bloco do 1T lê o 2T, e o do 2T lê 2023.
- **Qual vale:** o sistema, com a regional de cada lançamento.

### DIV-020 · Gerencial 26: coluna BH e CMH

- **Por quê:** a coluna BH soma por uma coluna que só existe em 2026 e que o histórico não guarda como regional: R$ 96.140,46 de pessoal por trimestre. O imobilizado TD da CMH não entra na planilha: no 2T a linha sai zerada, e no 4T ficam de fora as duas previsões de R$ 50.000,00. R$ 7.000,00 de pessoal da CMH marcados SP no 4T ficam fora da Agency.
- **Qual vale:** o sistema. O valor da coluna BH fica em "Sem regional".

### DIV-021 · Coluna Doc. da BB Go Crazy

- **Diferença:** R$ 147,50 no 1T 2025 e R$ 97,00 no 3T 2024.
- **Por quê:** a planilha usa a coluna Doc. da BB Go Crazy como regional da CMH. Essas linhas ficaram no histórico como documento, sem regional.

---

## Rentabilidade e faturamento dos jobs

### DIV-022 · Investimentos da CCH listados como job

- **Diferença:** R$ 2.201.119,99 do Investimento Doca e R$ 344.768,28 da Makkna, em sete linhas das abas Res. Jobs CMH de 2023 e 2024.
- **Qual vale:** o sistema. Decidido pelo Tiago em 26/10/2026: ficam com custo zero no job e aparecem na DRE.
- **Para a gestão:** é investimento interno, e não custo de job.

### DIV-023 · Nota fora da fórmula do job

- **Por quê:** o sistema liga ao job uma nota que a fórmula da coluna IMPOSTO não soma. Em geral é outra aba de Faturamento, como a CCH faturada pelo CNPJ da Go Crazy, ou o JOB da nota com espaço sobrando ou acento diferente. Vale para nota emitida e para nota a emitir.
- **Prova:** a contagem de notas pela fórmula refeita difere da contagem no histórico, ou a diferença é exatamente o imposto das notas a emitir do job.
- **Para a gestão:** a nota é do job. A fórmula da planilha só não a alcança.

### DIV-024 · Fórmulas das abas Res. Jobs

- **Por quê:** a CCH de 2025 calcula o resultado sem o imposto e o fee sobre a receita contada duas vezes. A CCH de 2026 também conta a receita duas vezes no fee. As abas da Hitlab fazem o resultado só com algumas contas. Duas linhas da California estão em branco (linha 30 de 2024; linha 457 de 2025).
- **Qual vale:** o sistema, com uma conta só (decisão 211, "Onde as abas fogem da regra").

### DIV-025 · Lançamento antes de 2023

- **Por quê:** o histórico começa em 01/01/2023. O que tem data anterior, mesmo com competência ou job de 2023 em diante, fica fora do sistema.
- **Tamanho:** R$ 568.476,96 de receita na California e R$ 481.127,56 na CCH, em 2023.
- **Para a gestão:** é o corte de início do histórico, decidido na D3 da decisão 211.

### DIV-026 · Crédito no Tipo de custo do job

- **Prova:** Res. Jobs 2026, linha 251. Um crédito de R$ 40.327,00 de 08/10 tem Tipo `CO 3T 2026`.
- **Por quê:** a planilha soma esse crédito na receita e deixa o custo cheio. O sistema o desconta do custo.
- **Para a gestão:** o resultado do job é o mesmo. Só muda se o valor aparece como receita ou como custo menor.

### DIV-027 · TOTAL CO da Hitlab sem o PayPal

- **Prova:** Res. Jobs HTLB 2025, linhas 3 e 7. O TOTAL CO é `SUM(O:Q)` e deixa de fora a coluna R, DESP. PAYPAL: R$ 111.226,89 e R$ 117.718,80.
- **Qual vale:** o sistema, que soma todas as contas.
- **Para a gestão:** a coluna do PayPal ficou fora da soma de custo.

### DIV-028 · Job em duas linhas por espaço no nome

- **Prova:** na Res. Jobs 2025, o mesmo job está nas linhas 93 e 139, com um espaço a mais no nome da segunda. A linha 139 tem o custo de R$ 4.760,00 e o imposto de R$ 4.132,50.
- **Qual vale:** o sistema, que junta as duas na linha 93. A soma é a mesma.

---

## Conciliação e extrato

Apuradas na conciliação de outubro, em 02/11/2026.

### DIV-029 · Texto de 24 linhas até 30/09

- **Prova:** as 64.038 linhas até 30/09 da planilha de 01/11 estão no sistema. Em 24, da aba Conta Santander Califórnia (R$ 96.322,73), favorecido, evento, descrição ou parcela mudaram depois da carga de 25/10. Em duas, a regional da planilha também mudou. Valor, data, Tipo e job são iguais.
- **Situação:** aberta. Só o Extrato e o regional dessas duas linhas mudariam. Entra se a carga do 3T for refeita.
- **Para a gestão:** a DRE do 3T não muda.

### DIV-030 · PP-00163

- **Diferença:** R$ 750,20. A planilha põe a linha no job Universal do 3T. No sistema, a PP é do UER-1002/26, do 4T.
- **Qual vale:** a baixa da PP.

### DIV-031 · PP-00276

- **Diferença:** R$ 3.000,00. O job da planilha não tem de-para. Ele existe no sistema como QPC-1001/26.

### DIV-032 · Três jobs com código diferente

- **Diferença:** AMB-1002 × AMB-1001, DEE-1002 × DEE-1001 e ANI-1013 × ANI-1012. É o mesmo job, com número diferente em cada lado.

### DIV-033 · Datas entre banco e planilha

| Conta | Valor | Banco | Planilha |
|---|---:|---|---|
| BB California | R$ 272.427,10 | 01/10 | 02/10 |
| BB California | R$ 300.000,00 | 20/10 | 21/10 |
| Santander GoCrazy | R$ 107,35 | 20/10 | 21/10 |
| BB California | R$ 400.000,00 | 26/10 | 27/10 |
| California Santander | R$ 500,00 | 09/10 | 08/10 |
| Santander Hitlab | R$ 2.742,64 | 26/10 | 23/10 |

- **Qual vale:** a data do banco.
- **Para a gestão:** o valor não muda.

### DIV-034 · Tarifas agrupadas

- **Diferença:** o banco traz 46 linhas de tarifa na California Santander e a planilha 17, com o mesmo total, R$ 2.143,20. Na GoCrazy, são 12 linhas no banco e R$ 406,00 nos dois.
- **Para a gestão:** a planilha agrupa o que o banco lista.

### DIV-035 · Resgates da XP fora da planilha

- **Diferença:** a aba da XP California não traz o resgate de R$ 3.000.963,93, e a da XP GoCrazy não traz os três resgates, de R$ 2.000.895,65. Só o extrato da XP confirma.
- **Situação:** o saldo da XP depende do saldo inicial, ainda não recebido.

### DIV-036 · Paypal de R$ 12.873,47

- **Diferença:** a competência mudou do 3T para um job do 4T entre as versões da planilha, e a linha saiu da cauda.
- **Situação:** aberta. O saldo do Paypal fica negativo nesse valor até o lançamento.

### DIV-037 · Retenção em quatro PPs

- **Diferença:** PP-00205, PP-00398, PP-00401 e PP-00403, de regime normal, somam R$ 267.236,00 e foram pagas cheias.
- **Situação:** aberta. Falta decidir se houve retenção a recolher.

### DIV-038 · Estorno de 02/10

- **Diferença:** R$ 4.200,00 na California Santander. A planilha tem a saída, no Tipo DP do 3T, e o estorno no mesmo dia. O banco mostra o "saiu e voltou". A cauda levou só a saída, porque o estorno não é DRE, e o saldo do sistema fica R$ 4.200,00 abaixo.
- **Na DRE:** a saída conta como na planilha.
- **Situação:** aberta. Falta o estorno entrar no saldo.

### DIV-039 · Centavos

- **Diferença:** 1 ou 2 centavos por linha, de retenções e rateios, em 11 linhas da California Santander.
- **Linhas:** pagamentos de R$ 232,75, R$ 10.646,18, R$ 201.747,15, R$ 3.859,63, R$ 3.119,99 e R$ 17.250,55; recebimentos de R$ 277.114,49, R$ 225.886,04, R$ 141.373,45 e R$ 20.441,58; uma do só DRE, de R$ 10.938,52.
- **Para a gestão:** arredondamento. Nenhum valor muda acima de centavos.

### DIV-040 · Linhas que só fecham em conjunto

- **California Santander, 14/10:** três TEDs (R$ 25.766,50, R$ 30.209,00 e R$ 39.804,80, R$ 95.780,30 no total) fecham ao centavo com três notas (R$ 29.000,00, R$ 31.600,00 e R$ 44.800,00) e 14 retenções, mas não nota a nota: o TED de R$ 30.209,00 é o líquido da nota de R$ 34.000,00.
- **BB California, 20/10:** os créditos de R$ 14.977,91 e R$ 24.923,55 do banco contra as linhas de R$ 5.110,54 e R$ 34.790,92 da planilha. São R$ 39.901,46 dos dois lados.
- **Para a gestão:** o total bate. A planilha divide os valores de outro jeito.

### DIV-041 · Um pagamento, vários favorecidos

- **Diferença:** um pagamento do banco soma linhas da planilha com favorecidos diferentes: −R$ 10.300,00 (08/10), −R$ 48.450,00 e −R$ 8.600,00 (21/10) na California Santander, e −R$ 29.121,22 (08/10) na Santander GoCrazy.
- **Situação:** aberta. Todas têm parte no só DRE e se resolvem quando os jobs entrarem no sistema.

### DIV-042 · Saída sem linha na planilha

- **Diferença:** −R$ 4.200,00 de 26/10 na California Santander, sem linha na planilha.
- **Situação:** aberta. O extrato desse dia é parcial: foi gerado antes do fim do dia.

---

## Como refazer a conferência

- **Conferências:** `scripts/historico-financeiro/conferir-*.ts`, com a planilha nova, sobre o pacote das cargas ativas e sobre o padronizado, com e sem `--com-previsoes`.
- **Comparador temporário:** página privada, com a mesma decomposição célula a célula. Serve à apuração e não entra na versão final. A versão com as linhas da planilha é um arquivo local, fora do repositório, porque as linhas têm nomes e pagamentos de pessoas.
