# 262 — Conciliação automática: acertar a linha e conciliar no fim, centro de custo na linha e fechamento por mês

**Data:** 2026-11-16
**Status:** aceita (protótipo aprovado pelo Tiago em 16/11/2026: "Gostei, agora está funcionando. Aprovado, pode implementar"). Em implementação, em três partes.
**Quem decidiu:** Tiago.
**Protótipo:** `.claude/prototipos/conciliacao-dia-a-dia/` (versão 56), com o histórico das versões no `LEIAME.md` de lá.
**Migration (parte 1):** `20261116950001_conciliacao_acerto_e_centro_na_linha.sql`.
**Relacionadas:** [254](254-conciliacao-dia-a-dia.md) (a conciliação dia a dia), [205](205-fechamento-da-conciliacao.md) (o fechamento), [235](235-custos-fixos-como-recorrencias.md) (a chave da recorrência), [251](251-subtipo-unico-completa-o-centro-de-custo.md) (o subtipo único), [256](256-novo-faturamento-e-faturar-unificado.md) e [260](260-faturar-em-pe-e-lista-do-faturamento.md) (o recebimento antes da NF; pendência D16).

## O problema

Na conta real (o acerto da California Santander de 01 a 11/11/2026), a sugestão do sistema vinha pronta na linha e o "Conciliar as N prontas" gravava tudo o que o sistema sugeriu, sem ninguém olhar linha a linha. A linha da planilha de uma PP ou de um custo fixo fechava a conta na hora e deixava o título em aberto: o pagamento contava duas vezes no fluxo de caixa (PP-00808, PP-00426, os custos fixos de novembro).

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | A linha vem vazia | A sugestão do sistema é a **primeira opção do "Adicionar lançamento"**; nada entra sozinho. |
| D2 | A planilha de um título | A linha da planilha que é de uma PP (pelo código) ou de um custo fixo (pela chave da recorrência) **não é oferecida**: no lugar dela vem o título. |
| D3 | O ajuste da diferença | Escolhido pela pessoa, embaixo da linha, em botões amarelos com o i: juros e multa, retenção na fonte, baixa parcial, corrigir a baixa e **"Corrigir o valor do título"** (o custo fixo com valor estimado passa ao valor que o banco pagou). |
| D4 | O acerto guardado | O acerto de cada linha fica **no banco** até a conciliação (escolha do Tiago): sobrevive a recarregar a página e a trocar de computador; outra pessoa do financeiro continua. |
| D5 | Conciliar | "Conciliar" grava só aquela linha; "Conciliar tudo o que foi acertado" grava o resto de uma vez, depois de um resumo. A linha que pede a baixa completa mostra **"Completar"**, com o motivo na dica (o centro de custo que falta, a retenção a conferir, o mútuo…). |
| D6 | Sem a coluna Status | A Ação diz o que falta. Filtros: **Pendentes** (sem lançamento, ou com diferença sem ajuste) · **A completar** · **A conciliar** · Conciliadas. Só no sistema em dois grupos: baixados sem linha (travam o mês) e previstos (não travam). |
| D7 | Débitos e créditos | No quadro do dia: os créditos e os débitos do banco e do sistema, separados, com a diferença de cada um. A tabela ganha a coluna **Subtipo** depois de Tipo. |
| D8 | Centro de custo na linha | Tipo e Subtipo são **dois campos de busca, um de cada vez**, em **qualquer lançamento** (título, baixa já feita, linha da planilha), sem restrição de tipo (pedido do Tiago). A lista começa pelos tipos da direção da linha. O escolhido é do lançamento (vale onde ele aparecer) e é gravado na conciliação. Trocar o tipo deixa o subtipo por escolher, salvo tipo com um só subtipo. |
| D9 | Um pop-up por vez | A lista de lançamentos, o Tipo e o Subtipo nunca ficam abertos juntos. |
| D10 | Fechamento por mês (parte 2) | O dia não fecha mais; o mês fecha ("Fechar outubro") com as condições de hoje no último dia dele, e reabre mês a mês. Na Conciliação automática, a **linha dos meses** (os fechados com cadeado e o "Reabrir" do último, os abertos com o que falta e o "Fechar"); no Extrato e nos Títulos, a faixa "Os meses". |
| D11 | Recebimento antes da NF pela linha (parte 3) | No ⋯ da linha de entrada, "Recebimento antes da NF": a data, o valor e a conta vêm da linha; escolhe o job (ou BV) e o centro de custo; grava e concilia (pendência D16 da 260). O internacional fica no Recebimento avulso. |

## Como funciona (parte 1)

- `conciliacao_acertos` (por linha do banco) e `conciliacao_centros` (por lançamento): rascunho, só leitura direta para admin e financeiro; gravam por `salvar_acerto_da_linha` e `salvar_centro_da_conciliacao`. A tela guarda só o que mudou, 400 ms depois da última mudança, e mostra "Acertos salvos às HH:MM".
- Na conciliação, o centro escolhido vai para a baixa do título (o centro do item da baixa em lote); na baixa já feita, `trocar_centro_dos_lancamentos` (os juros da baixa ficam com o deles); na linha da planilha, `trocar_centro_das_previsoes` (o plano e a sigla do grupo). Auditados.
- "Corrigir o valor do título": `corrigir_valor_do_titulo_pela_linha` (título avulso ou de recorrência, em aberto, linha de pagamento ainda sem conciliação, período aberto; auditado `conta_avulsa.valor_corrigido`) e a baixa pela linha de sempre.
- Limite que vem de antes: na folha, a baixa em lote mantém o centro dela (Despesa com Pessoal), então o centro trocado na linha não vale para a folha.

## Entregas

1. Parte 1 — a tela do dia a dia (D1 a D9).
2. Parte 2 — o fechamento por mês (D10).
3. Parte 3 — o recebimento antes da NF pela linha (D11).
