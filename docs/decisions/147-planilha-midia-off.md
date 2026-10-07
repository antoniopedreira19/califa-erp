# 147 — Planilha de Mídia Off no orçamento (entrega 1: até aprovar)

**Data:** 2026-10-06
**Quem decidiu:** Tiago — protótipo "Planilha de Mídia Off" aprovado em 06/10/2026 (v21), com as respostas de 04 e 05/10/2026 (página de perguntas, p01 a p21) e o escopo da entrega 1: "Até aprovar", exportar e importar "desligados até o desenho", visão agregada "só consulta, com atalho".
**Continua:** a decisão 131 (a categoria Mídia Off nasceu travada como "em breve", com o modelo da planilha por fazer).

## Por quê

A Mídia Off não cabe na planilha nacional. O plano de mídia dos PMs é por meio e por mês, com o calendário de inserções da TV e do rádio, e a conta é outra: o cliente paga o negociado, o veículo fica com 80% dele, e os honorários (20% do negociado, ou 13% do líquido no contrato da AMBEV) saem do resto. Na conta nacional, honorários e imposto somam POR CIMA dos custos.

## A planilha

| Ponto | Como fica |
|---|---|
| Estrutura | Por mês, como o Always On, com a campanha inteira — sem a trava do trimestre. Régua com a Campanha e um bloco por mês (faturamento e resultado de cada um). A Campanha abre por padrão; campanha de um mês só abre direto no mês. |
| Meses | Nascem do período do orçamento (obrigatório, até 24 meses). "Editar meses" acrescenta e tira meses; o período acompanha. Mudar o período no "Editar" do orçamento cria os meses que entram e apaga os vazios que saem — mês com linhas recusa. |
| Meio | Um card por meio em cada mês (TV Aberta, TV Fechada, Rádio, OOH, DOOH, Digital · Portais — `lib/midia/meios.ts`). Meio + formato identificam o meio na versão. O "+" na barra de abas cria; na Campanha ele pergunta o mês e leva a tela até ele. |
| Formato | Texto livre, com sugestões: o que a versão já usa no meio e os formatos comuns dele. |
| Lápis do meio | Vale para todos os meses. Só o formato: as linhas com o formato antigo acompanham. Outro meio: as linhas dele são apagadas, depois do "Trocar o meio?", e cada mês fica com uma linha em branco. |
| Grade (TV, rádio) | Os dias do mês são os títulos das colunas da PROGRAMAÇÃO (só os dias que o mês tem). Inserções por dia, soma no pé. Arrastar sobre os dias marca vários, em várias linhas, e o número digitado preenche todos. |
| Largura | Um botão só, "Caber na tela ⇄ Alargar colunas", na linha do "Recolher todos" (Campanha) ou abaixo das abas (mês). Larga por padrão: Praça e Veículo fixas, "+ Nova linha" e os rótulos do pé fixos, e todos os meios e meses rolam juntos. |
| Período (OOH, DOOH, portais) | Início (no mês da linha) e fim, quantidade × períodos. |
| Linha | Praça, veículo, tipo (A · Direto ou A · Repasse), programa ou ponto, formato, unitário de tabela, desconto e negociado (digitar um recalcula o outro). Duplicar e lixeira na calha. Teclado das outras planilhas (decisão 046). |
| Copiar linhas de outro mês | Só para mês vazio. TV e rádio vêm sem inserções; as datas do período passam para o mês novo. |
| Resumo | Aba da Campanha: o plano por meio e mês, como a aba CRONO do Excel. |

## A conta (`lib/calculos/midia-off.ts`)

| Ponto | Como fica |
|---|---|
| Linha | negociado = unitário negociado × quantidade; veículo = % do veículo (80) do negociado; honorários = % sobre o negociado ou sobre o líquido do veículo; total = veículo + honorários. |
| Valor do job | O total orçado: o cliente paga o negociado, nada por cima. |
| Faturamento previsto | Honorários + veículos em A · Repasse (a nota do A · Direto é do veículo ao cliente). |
| Impostos | Alíquota da versão × honorários — de dentro dos honorários. |
| Custo planejado | As notas dos veículos: na mídia, o planejado é o orçado. |
| Resultado | Valor do job − impostos − custo planejado. |
| Parâmetros | Honorários do cadastro do cliente (sem campo novo); a base (negociado ou líquido) e a parte do veículo (80%) se escolhem no "Editar" da versão, com a trava dos honorários (`orcamentos.editar_impostos`). |

No banco, o ORÇADO da linha é o NEGOCIADO: `valor_unitario_orcado` é o unitário negociado, `quantidade_orcada` as inserções (soma feita por gatilho) ou a quantidade, `dias_meses_orcado` 1 ou os períodos. Quem lê uma versão de Mídia Off pede o fechamento a `fechamentoDosItens`, nunca a `calcularTotaisVersao`.

## O veículo

O veículo é um fornecedor — ele recebe o PI, emite a nota e, no A · Repasse, recebe a PP. O cadastro é o formulário do fornecedor com o pagamento **opcional** (vai ser exigido para gerar a PP do repasse) e, em cima, os **meios** que ele vende (o primeiro é o principal) e a praça, em `veiculos_midia`. A lista da linha mostra primeiro os veículos que vendem o meio dela ("Vendem TV Fechada") e depois os outros. A linha pode ficar sem veículo no rascunho; a versão só aprova com todas preenchidas.

> ⚠️ **07/10/2026 — mudou na [150](150-cadastro-de-veiculos.md):** o cadastro do veículo não pede mais meio nem praça. Os meios vêm do uso nas planilhas (a lista agrupa "Já usados em {meio}" e "Outros veículos"), e a praça fica só na linha. O cadastro ganhou a tela Cadastros › Veículos.

## Entrega 1: até aprovar

- O orçamento vai até a aprovação. "Enviar Job para Abertura" fica desligado na Mídia Off ("disponível na próxima entrega"), na tela e no servidor.
- Exportar e importar planilha ficam desligados, na tela e no servidor.
- Visão agregada: o orçamento de Mídia Off aparece só para consulta, com o atalho "Editar na tela do orçamento". Ele entra nos três indicadores do topo (pela conta da mídia) e fica fora do quadro de Totais, que é o da planilha nacional. Orçamento de Mídia Off não nasce pela agregada nem pelo lote.
- A planilha de Mídia Off não se converte na de outra categoria, nem o contrário: quem precisa trocar cria um orçamento novo.

## Banco

Migrations `20261006500001` (valor `midia_off` no enum), `20261006500002` (colunas da versão, do grupo e da linha; `veiculos_midia`; gatilho da quantidade da grade; trava do trimestre sem a Mídia Off; funções da planilha) e `20261006500003` (linha nova repete a praça). A categoria Mídia Off passou ao modelo `midia_off` e saiu do "em breve" na `20261006500004`, aplicada em 06/10/2026 depois do deploy do código (`78f7e04d`) — antes dele, a tela antiga mostraria a categoria sem saber montar a planilha.

Conferido no navegador em 06/10/2026, gravando no banco, no orçamento `TES-P001/26-21 · ZZ Teste Mídia Off 147`: criação com período que cruza o trimestre (meses nascem com a v1), meio em grade e meio por período, praça, veículo pelo "Cadastrar «…» como novo veículo" com documento já cadastrado ("Usar este cadastro"), inserções (o gatilho soma a quantidade), tabela/desconto/negociado, tipo A · Repasse, nova linha com a praça de cima, duplicar e remover linha, copiar mês, editar meio (vale nos dois meses e nas linhas), remover meio do mês, encurtar o período (o mês vazio sai), base "do líquido" e honorários no "Editar" da versão, duplicar versão (v2 cópia fiel), travas de aprovação (mês vazio, linha sem veículo), aprovação, "Enviar Job para Abertura" travado e o card da visão agregada.

## Próxima entrega (o job)

Abertura com a conta da mídia, PPs do repasse, AP e PI por veículo e mês, errata, cancelamento da veiculação, faturamento por mês e encerramento.

## Para conferir depois

- ⚠️ O unitário negociado é gravado com 2 casas (`numeric(14,2)`). Nos exemplos de referência, só uma linha tinha mais casas, e o valor do job mudou R$ 0,10 (Zé Delivery). Se os PMs digitarem negociado com mais casas, ampliar a coluna é mudança de tipo — pedir antes.
- O teto de 24 meses da campanha é uma trava contra data digitada com o ano errado, não regra de negócio: mudar se aparecer campanha mais longa.
