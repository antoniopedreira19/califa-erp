# Decisões

Uma decisão por arquivo, numerada em sequência. O que está aqui é **regra de
negócio combinada com o time** — não é documentação de código: se a regra
mudar, a decisão ganha uma nota datada, e o código a segue.

## Antes de criar uma decisão nova

**Confira aqui qual é o próximo número livre e acrescente a linha na tabela
no MESMO commit em que cria o arquivo.**

O projeto é tocado por duas frentes em paralelo, no mesmo `main`. Em
24/08/2026 as duas criaram uma decisão 023 sem saber uma da outra — a das
versões em abas e a do save —, e a colisão só apareceu no merge, com uma
delas já citada em 50 lugares. Esta tabela existe para que isso não se
repita: é o único lugar onde dá para ver, em um relance, o que já está
tomado.

Se duas decisões colidirem mesmo assim, **quem move é a mais nova** — a
mais antiga costuma ser raiz de uma linhagem (a 023 do Antonio é seguida
pela 024, 025, 026 e 027), e mover a raiz arrasta todas.

## Índice

| # | Decisão | Data |
|---|---|---|
| 001 | [Stack Next.js + Supabase](001-stack-next-supabase.md) | — |
| 002 | [Orçamento antes do job](002-orcamento-antes-do-job.md) | — |
| 003 | [Tipos de custo](003-tipos-de-custo.md) | — |
| 004 | [Previsão de desembolso e abatimento por PP](004-previsao-de-desembolso.md) | — |
| 005 | [Cidade e Regional são editáveis na abertura do job](005-cidade-e-regional-na-abertura.md) | — |
| 006 | [Alíquota de imposto sai de campo livre, e aprovar exige alíquota e valor](006-aliquota-fixa-e-gate-de-aprovacao.md) | — |
| 007 | [Nome da versão e V1 automática](007-nome-da-versao-e-v1-automatica.md) | — |
| 008 | [Encerramento do job](008-encerramento-do-job.md) | 2026-08-13 |
| 009 | [A esteira do faturamento do job](009-esteira-do-faturamento.md) | 2026-08-14 |
| 010 | [O funil comercial do orçamento](010-funil-comercial-do-orcamento.md) | 2026-08-17 |
| 011 | [Orçado zerado não salva lote nem aprova versão](011-orcado-obrigatorio-para-salvar-e-aprovar.md) | 2026-08-17 |
| 012 | [Contato de cobrança é obrigatório para enviar o job à abertura](012-contato-de-cobranca-do-job.md) | 2026-08-17 |
| 013 | [Planilha do job visível e realizado editável antes da abertura](013-realizado-antes-da-abertura.md) | 2026-08-17 |
| 014 | [PPs parciais por item e parcelas de pagamento](014-pps-parciais-e-parcelas.md) | 2026-08-17 |
| 015 | [Previsão de recebimento nasce na abertura do job](015-previsao-de-recebimento-na-abertura.md) | 2026-08-17 |
| 016 | [Títulos a Pagar: baixa por parcela, data de pagamento e repactuação](016-titulos-a-pagar-e-baixa-por-parcela.md) | 2026-08-17 |
| 017 | [Faturamento agrupado, parcial e avulso; e a previsão do título](017-faturamento-agrupado-parcial-e-avulso.md) | 2026-08-17 |
| 018 | [As previsões da abertura no fluxo de caixa](018-previsoes-no-fluxo-de-caixa.md) | 2026-08-17 |
| 019 | [A categoria do job é a do orçamento](019-categoria-do-job.md) | 2026-08-19 |
| 020 | [Cancelar job só existe antes da abertura](020-cancelar-job-so-antes-da-abertura.md) | 2026-08-19 |
| 021 | [Projeto do financeiro, contas do job e edição do registro da abertura](021-projeto-do-financeiro-e-edicao-da-abertura.md) | 2026-08-20 |
| 022 | [BV líquido na planilha, e o realizado montado pelas PPs](022-bv-liquido-e-realizado-por-pp.md) | 2026-08-21 |
| 023 | [As versões viraram abas dentro da tela do orçamento](023-versoes-em-abas-na-tela-do-orcamento.md) | 2026-08-21 |
| 024 | [A planilha virou uma tabela só, e o agrupamento virou uma linha](024-planilha-em-tabela-unica.md) | 2026-08-24 |
| 025 | [Recebimentos e custos do job: os três pontos do fluxo de caixa](025-recebimentos-e-custos-na-lista-de-jobs.md) | 2026-08-24 |
| 026 | [O Totais perdeu a tabela de agrupamentos, e a linha nova nasce pelo teclado](026-agrupamentos-saem-do-totais-e-linha-nova-por-teclado.md) | 2026-08-25 |
| 027 | [PP aprovada é título, e a composição do valor no fluxo do job](027-pp-aprovada-e-a-composicao-do-fluxo-do-job.md) | 2026-08-26 |
| 028 | [O save fatura num job e vale em outro](028-save-entre-jobs.md) | 2026-08-24 |
| 029 | [Data do evento, "recebimento" no lugar de "faturamento" nas datas, e a planilha abrindo em Líquido](029-data-do-evento-recebimento-e-visao-liquida.md) | 2026-08-27 |
| 030 | [A errata acontece na planilha, e existe linha vermelha](030-errata-na-planilha-e-a-linha-vermelha.md) | 2026-08-27 |
| 031 | [A fatura do cartão, e a conta bancária que paga várias empresas](031-a-fatura-do-cartao-e-a-conta-que-paga-varias-empresas.md) | 2026-08-28 |
| 032 | [A data da compra, o estorno, e a fatura credora](032-data-da-compra-e-estorno-no-cartao.md) | 2026-08-29 |
| 033 | [A descrição da NF vem do GP, e o CNAE vem do financeiro](033-a-descricao-da-nf-vem-do-gp-e-o-cnae-do-financeiro.md) | 2026-08-31 |
| 034 | [O job não encerra com saldo a faturar](034-encerramento-exige-a-nota-emitida.md) | 2026-08-31 |
| 035 | [A PP vale R$ Unit. × QT × D/M](035-a-pp-vale-unitario-vezes-qt-vezes-dm.md) | 2026-09-01 |
| 036 | [Filtro "Meus" nas listas, e Produto/Regional em Jobs](036-filtro-meus-e-produto-regional-nas-listas.md) | 2026-09-01 |
| 037 | [Serviço no orçamento, Equipe no projeto, e "Produto" vira "Marca"](037-servico-no-orcamento-equipe-no-projeto-e-marca.md) | 2026-09-02 |
| 038 | [As duas previsões do job viraram um card só, "Previsões"](038-previsoes-em-tabela-unica.md) | 2026-09-02 |
| 039 | [A PP nasce gerada, e enviar ao financeiro é outra ação](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md) | 2026-09-02 |
| 040 | [A errata não toca linha com PP no financeiro, e trava o envio de PP até a revisão da abertura](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md) | 2026-09-02 |
| 041 | [A planilha única do projeto: exportar vários orçamentos e trazê-la de volta como versão nova](041-planilha-unica-do-projeto-exportar-e-importar.md) | 2026-09-03 |
| 042 | [O menu "Exibir" esconde blocos de verdade, e orçamento não tem Realizado](042-blocos-ocultaveis-na-planilha-do-orcamento.md) | 2026-09-03 |
| 043 | [Descrição do projeto e descritivo do job viram obrigatórios](043-descricao-do-projeto-e-descritivo-do-job-obrigatorios.md) | 2026-09-03 |
| 044 | [A alíquota de 19,53% já vem escolhida na versão que nasce do zero](044-aliquota-padrao-no-orcamento-novo.md) | 2026-09-03 |
| 045 | [Rentabilidade por item na planilha do job, e o "Exibir" que liga de verdade](045-rentabilidade-por-item-na-planilha-do-job.md) | 2026-09-03 |
| 046 | [A célula selecionada: as planilhas se navegam pelo teclado, e a linha nova não trava](046-navegacao-por-teclado-nas-planilhas.md) | 2026-09-03 |
| 047 | [O resumo do cabeçalho mostra o resultado operacional, não o custo](047-resumo-do-cabecalho-mostra-resultado-operacional.md) | 2026-09-04 |
| 048 | [O fornecedor nasce de dentro da PP, e o formulário de PP volta ao painel](048-fornecedor-nasce-de-dentro-da-pp.md) | 2026-09-04 |
| 049 | [Remover o grupo leva os itens dele junto](049-remover-grupo-leva-os-itens-junto.md) | 2026-09-04 |
| 050 | [O portal do cliente nasce de dentro do envio para faturamento](050-portal-do-cliente-nasce-de-dentro-do-envio-para-faturamento.md) | 2026-09-04 |

> A 028 é de 24/08 e vem depois da 027, de 26/08: ela nasceu como 023, em
> paralelo à das versões em abas, e foi renumerada em 27/08/2026 — a
> data é a da decisão, não a da posição na fila.

**Próximo número livre: 051.**
