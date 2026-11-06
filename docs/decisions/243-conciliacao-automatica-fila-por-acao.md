# 243 — Conciliação automática: a fila pelo que se faz, as colunas do sistema e as linhas iguais escolhidas pelo financeiro

**Data:** 2026-11-06
**Status:** aceita e implementada em 06/11/2026.
**Quem decidiu:** Tiago, em 06/11/2026, revendo no protótipo do módulo financeiro ("Aprovado. Segue no print os seletores aprovados. Pode implementar"), com as opções 5 divisões, "Fornecedor, Job e Reg", "Escolher na linha" e o corte "Entre Situação e No sistema".
**Revê:** a [234](234-revisao-do-financeiro-pelo-prototipo.md) (as 14 divisões por tipo do motor, o detalhe ao clicar na linha, as caixas de seleção) e a [239](239-conciliacao-automatica-divisoes-e-periodo-do-extrato.md), ponto 6 (o cabeçalho).

## O problema

A fila tinha 14 divisões, uma por raciocínio do motor ("Conferir antes", "Uma linha, vários títulos", "Pelas regras do histórico"…), e quem usa precisava aprender os 14 nomes. "Vários títulos" juntava a remessa, que se concilia num clique, com a soma incerta, que pede conferência. "Histórico" tinha três sentidos na mesma tela. "Baixa à mão" descrevia como a baixa foi feita, e não o estado dela. A linha expandia para mostrar o porquê, e o fornecedor, o job e a regional não apareciam. Nas linhas iguais (mesmo dia e valor, com mais títulos que linhas), o sistema escolhia sozinho quais títulos conciliar.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| 1 | Divisões | Cinco, pelo que se faz: **Corrigir** (valor diferente do banco, baixa sem linha no banco), **Prontos para conciliar** (título exato, soma do fornecedor, remessa, tarifa pela regra, saiu e voltou, planilha com confiança alta, baixa já lançada ainda não ligada), **Conferir** (o resto que pede decisão), **Lançar avulso · Não há no sistema** e **Conciliados**. O motivo de cada linha fica na Situação |
| 2 | Nomes | "Baixa à mão" vira **Já baixado** (no sistema); "Divergência" vira **Valor diferente**; "Regra", **Tarifa do banco**; "Histórico", **Planilha**; "Só no sistema", **Sem linha no banco**. As colunas: **Descrição no banco** e **No sistema · Descrição** |
| 3 | Situação | Na conferência, o motivo do motor: Juros e multa, Retenção na fonte, Diferença de valor, Guia de imposto, Sem centro de custo, Confirmar o título, Vários títulos, Remessa. A dica traz o porquê e o centro de custo |
| 4 | Colunas | Depois de No sistema · Descrição: **Fornecedor**, **Job** (o código; o nome que o financeiro deu ao passar o mouse), **Tipo** (a sigla da planilha: REC, CO, CT, CF, DP, DM, DA, DC, DT, RF, DJ, EMP, IMOB, PL, DL; mútuo é MÚTUO INT, transferência é o nome da outra conta, estorno é ESTORNO; o 16, câmbio, aparece pelo código até ter sigla), **TRI** (como no Extrato: o trimestre da data, e o do tipo no mútuo) e **Reg**. As baixas já lançadas usam a mesma leitura do Extrato (`montarLinhasDeLancamentos`), então as duas abas nunca divergem |
| 5 | Corte | Uma linha vertical entre Situação e No sistema · Descrição: à esquerda o banco e a situação, à direita o sistema e a ação |
| 6 | Linhas | Nenhuma linha expande. O texto inteiro, o porquê, o centro de custo e as partes do agrupamento ficam nas dicas. O Agrupar e as linhas iguais seguem as mesmas colunas, sem linha de cabeçalho própria |
| 7 | CNPJ | Ao passar o mouse na descrição do banco, se o texto tiver CNPJ ou CPF, aparece de quem é pelo cadastro (fornecedor, cliente ou empresa do grupo) ou "não está no cadastro". A busca é só nos documentos que aparecem no extrato. O extrato real quase nunca traz o nome: os pagamentos da remessa do Santander usam 5 textos fixos, e os recebimentos, só o documento |
| 8 | Linhas iguais | O sistema não escolhe mais. Cada linha chega vazia, com o seletor do título na coluna do sistema; escolhido, as colunas se preenchem e a linha ganha o Conciliar. Escolher um título que está na outra linha troca os dois. No ⋯, "Conciliar as N com os títulos escolhidos". Com uma linha só, a Situação diz "Mesmo valor" |
| 9 | Seleção | As caixas de cada linha e o "Conciliar selecionados" saíram. "Conciliar os N" de Prontos concilia a divisão inteira, uma linha de cada vez pela ação dela (título, baixa já lançada, remessa, regra, planilha, saiu e voltou) |
| 10 | Filtros | Os filtros por coluna da [165](165-filtro-por-coluna-nas-listas.md) em todas as colunas, guardados na aba do navegador por conta. Filtrando, as divisões com resultado abrem |
| 11 | Job | O nome do job ao passar o mouse no código também na planilha de títulos (Conciliação › Títulos, Contas a Pagar, Contas a Receber, Impostos) e no Extrato. É sempre o nome do financeiro (`nome_financeiro`; sem ele, o da produção): a planilha mostrava o da produção nas PPs e nas notas |

## Como fica no código

- `fila-dividida.tsx`: as 5 divisões (`divisaoDe`), as colunas com os filtros (`useFiltrosDeColuna`, `guardarEm: "conciliacao-automatica"`) e o corte.
- `fila-linhas.tsx`: as linhas nas 11 colunas, o motivo da Situação, Fornecedor/Job/Tipo/TRI/Reg (`quemDaLinha`), a dica do CNPJ, o seletor das linhas iguais e `celulasDoItem` para os filtros.
- `banco-dados.ts`: `quemPorDocumento` (fornecedores, clientes e empresas pelos documentos do texto) e `extratoPorLancamento` (as baixas sem linha e as ligadas pela leitura do Extrato), em paralelo com o mútuo; a regional e o grupo da planilha nas linhas dela. As consultas `.in()` por id vão em lotes de 150: com ~1.400 conciliadas na California Santander, a consulta das baixas ligadas já falhava com "Bad Request" e as conciliadas ficavam sem o lado do sistema.
- `aba-banco.tsx`: `conciliarVarios` passa a conciliar também remessa, regra, planilha e saiu e voltou.
- `lib/data/lancamento-linha.ts`: o nome do financeiro do job, a outra conta da transferência e as marcas de mútuo e estorno. `contas-a-pagar/` e `contas-a-receber/dados-dos-titulos.ts`: `nome_financeiro`. `planilha.tsx` e `conciliacao-list.tsx`: a dica do job.
- Sem migration.

## Em aberto

- A sigla do tipo 16 (Despesas de câmbio, decisão 229): a planilha não tem.
