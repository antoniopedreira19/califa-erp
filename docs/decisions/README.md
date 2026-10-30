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
| 011 | [Orçado zerado não salva lote nem aprova versão — revogada em 2026-10-01: salva e aprova](011-orcado-obrigatorio-para-salvar-e-aprovar.md) | 2026-08-17 |
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
| 051 | [O descritivo se lê na lista, num cartão ancorado](051-descritivo-em-cartao-nas-listas.md) | 2026-09-04 |
| 052 | ["Todas as PPs deste item já foram geradas", e a previsão de custo por item](052-todas-as-pps-do-item-foram-geradas.md) | 2026-09-04 |
| 053 | [Calendário de Jobs, e o serviço como eixo de cor](053-calendario-de-jobs.md) | 2026-09-07 |
| 054 | ["Realizar errata": a errata abre o planejado junto com o orçado](054-errata-abre-o-planejado-junto-com-o-orcado.md) | 2026-09-07 |
| 055 | [O serviço entra no job, e a competência vira rateio entre trimestres](055-servico-no-job-e-rateio-de-competencia.md) | 2026-09-07 |
| 056 | [A PP nasce na pré-abertura; o envio ao financeiro é que espera](056-pp-nasce-na-pre-abertura-e-o-envio-espera.md) | 2026-09-08 |
| 057 | [A rejeição volta ao orçamento, e o envio à abertura se cancela de lá](057-rejeicao-e-cancelamento-do-envio-a-abertura.md) | 2026-09-08 |
| 058 | [O chat de PPs ganha uma caixa de entrada no financeiro, e a área da mensagem passa a vir da tela](058-chat-de-pps-na-caixa-de-entrada-do-financeiro.md) | 2026-09-08 |
| 059 | [A revisão da abertura nasce editável, e cada registro deixa uma foto](059-revisao-da-abertura-editavel-e-o-historico-das-fotos.md) | 2026-09-08 |
| 060 | [O orçamento nasce um a um, e o editor multi-jobs sai](060-orcamento-nasce-um-a-um-e-o-editor-multi-jobs-sai.md) | 2026-09-08 |
| 061 | [As previsões se redistribuem inteiras: a trava do consumido cai](061-as-previsoes-se-redistribuem-inteiras.md) | 2026-09-08 |
| 062 | [O BV sai do planejado, vira vários por item e ganha alíquota própria; e o A · Repasse precisa fechar o orçado](062-bv-so-no-realizado-multiplo-e-com-aliquota-propria.md) | 2026-09-08 |
| 063 | [O import lê o agrupamento pela coluna A, e item sem valor entra zerado](063-import-le-o-agrupamento-pela-coluna-a.md) | 2026-09-08 |
| 064 | [A conta bancária paga qualquer empresa, mas a empresa dela é quem dá acesso](064-a-conta-bancaria-paga-qualquer-empresa.md) | 2026-09-09 |
| 065 | [O cadastro de fornecedor exige contato e solta o endereço](065-o-cadastro-de-fornecedor-exige-contato-e-solta-o-endereco.md) | 2026-09-09 |
| 066 | [O cliente nasce com marcas e portais](066-o-cliente-nasce-com-marcas-e-portais.md) | 2026-09-09 |
| 067 | [O campo de fornecedor busca, limpa e edita](067-o-campo-de-fornecedor-busca-limpa-e-edita.md) | 2026-09-09 |
| 068 | [A PP nasce carimbada em Custo Operacional](068-a-pp-nasce-em-custo-operacional.md) | 2026-09-09 |
| 069 | [A regional do job é a fonte; o rateio só existe onde não há job](069-a-regional-do-job-e-a-fonte.md) | 2026-09-10 |
| 070 | [A PP congela os documentos com que a aprovação foi feita](070-a-pp-congela-os-documentos-da-aprovacao.md) | 2026-09-10 |
| 071 | [O BV do job se grava pelo item da versão, e a linha de errata não tem BV](071-o-bv-do-job-se-grava-pelo-item-da-versao.md) | 2026-09-11 |
| 072 | [O orçamento internacional tem planilha própria, e quem a escolhe é a categoria](072-orcamento-internacional.md) | 2026-09-11 |
| 073 | [O BV não depende da versão aprovada: qualquer linha do job aceita, se o tipo permitir](073-o-bv-nao-depende-da-versao-aprovada.md) | 2026-09-11 |
| 074 | [A PP gerada conta no realizado do item; o financeiro continua vendo só o que foi enviado](074-a-pp-gerada-conta-no-realizado-do-item.md) | 2026-09-11 |
| 075 | [A esteira reconhece a nota pelos itens, e o envio para faturamento grava numa transação só](075-a-esteira-reconhece-a-nota-pelos-itens.md) | 2026-09-14 |
| 076 | [A importação da versão pergunta de onde vem o planejado](076-a-importacao-da-versao-pergunta-de-onde-vem-o-planejado.md) | 2026-09-14 |
| 077 | [O prazo da PP só cai em janela de pagamento, e a PP pode ser urgente](077-o-prazo-da-pp-cai-em-janela-e-a-pp-pode-ser-urgente.md) | 2026-09-14 |
| 078 | [Fee e Always On: um orçamento por trimestre, dividido em meses](078-orcamento-mensal-fee-e-always-on.md) | 2026-09-14 |
| 079 | [A nota fiscal só cobre jobs de um mesmo cliente, e quem confere é o banco](079-a-nota-fiscal-so-cobre-jobs-de-um-cliente.md) | 2026-09-14 |
| 080 | [Quem emite a nota e quem confirma o BV, conferido no servidor e no banco](080-quem-emite-a-nota-e-quem-confirma-o-bv.md) | 2026-09-15 |
| 081 | [A produção presta contas da verba, e o financeiro aprova](081-a-producao-presta-contas-da-verba-e-o-financeiro-aprova.md) | 2026-09-15 |
| 082 | [A despesa sem job nasce com o rateio, e a recorrência vira título 30 dias antes](082-a-despesa-sem-job-nasce-com-rateio-e-a-recorrencia-vira-titulo-30-dias-antes.md) | 2026-09-15 |
| 083 | [A PP aprovada que não segue volta para a produção](083-a-pp-aprovada-que-nao-segue-volta-para-a-producao.md) | 2026-09-15 |
| 084 | [O ajuste da fatura do cartão vira compra da fatura, com rateio](084-o-ajuste-da-fatura-do-cartao-vira-compra-com-rateio.md) | 2026-09-15 |
| 085 | [A tela principal ocupa a largura do layout](085-a-tela-principal-ocupa-a-largura-do-layout.md) | 2026-09-16 |
| 086 | [A nota avulsa nasce com rateio de regional](086-a-nota-avulsa-nasce-com-rateio-de-regional.md) | 2026-09-16 |
| 087 | [Faturamento e encerramento correm separados, e o job fica finalizado quando os dois terminam](087-faturamento-e-encerramento-correm-separados.md) | 2026-09-16 |
| 089 | [Lista longa se busca, e o código do cliente não aparece nela](089-lista-longa-se-busca-e-o-codigo-do-cliente-nao-aparece.md) | 2026-09-17 |
| 090 | [A chave PIX é gravada no formato que o banco aceita](090-a-chave-pix-e-gravada-no-formato-do-banco.md) | 2026-09-18 |
| 094 | [O selo "Em faturamento", e o Finalizado passa a valer pelo envio](094-em-faturamento-e-o-finalizado-vale-pelo-envio.md) | 2026-09-20 |
| 095 | ["Composto por" em % do valor do job, e Moeda/Câmbio fora do nacional](095-composto-por-em-percentual-do-valor-do-job.md) | 2026-09-21 |
| 096 | [Só a alíquota de 19,53% fica disponível](096-so-a-aliquota-de-19-53.md) | 2026-09-21 |
| 097 | [Folha mensal em duas camadas, valor manual e propagação pela aprovação](097-folha-mensal-em-duas-camadas.md) | 2026-09-18 |
| 098 | [O agrupamento só nasce com nome, e a planilha vazia já abre pedindo o primeiro](098-o-agrupamento-so-nasce-com-nome.md) | 2026-09-21 |
| 099 | [O save passa pela aprovação do financeiro, linha a linha](099-aprovacao-de-save.md) | 2026-09-22 |
| 100 | [A abertura do job prevê os impostos, e a margem vira Rentabilidade](100-previsao-de-impostos-na-abertura.md) | 2026-09-23 |
| 101 | [Chave PIX e conta bancária só se gravam no formato da remessa](101-dados-de-pagamento-no-formato-da-remessa.md) | 2026-09-23 |
| 102 | [O rateio job × save da nota emitida acompanha o save](102-rateio-da-nota-acompanha-o-save.md) | 2026-09-24 |
| 103 | [O relatório de rentabilidade separa o save](103-rentabilidade-separa-o-save.md) | 2026-09-24 |
| 104 | [O item da planilha muda de lugar pela alça, e pode trocar de agrupamento](104-o-item-muda-de-lugar-pela-alca.md) | 2026-09-24 |
| 105 | [O serviço Interno é investimento da agência, e o job sem faturamento só precisa ser encerrado](105-servico-interno-e-job-sem-faturamento.md) | 2026-09-25 |
| 106 | [Faixa do projeto: a agregada e cada orçamento ou job em abas, no topo da tela](106-faixa-do-projeto.md) | 2026-09-25 |
| 107 | [A coluna Save nasce recolhida, e só abre sozinha onde já há save](107-coluna-save-nasce-recolhida.md) | 2026-09-25 |
| 108 | [O botão Voltar: visível, igual em todas as telas, e leva à página anterior](108-botao-voltar.md) | 2026-09-27 |
| 109 | [Dias/meses do orçado pode ser zero, e não trava a aprovação](109-dias-meses-zero-no-orcado.md) | 2026-09-27 |
| 110 | [Importação de planilha: modal no centro, escolha da aba e arquivo de até 10 MB](110-importacao-de-planilha-em-modal.md) | 2026-09-27 |
| 111 | [A abertura de job mostra as abas do job, e trocar de aba não apaga o preenchimento](111-abertura-de-job-com-as-abas-do-job.md) | 2026-09-27 |
| 112 | [A quebra das PPs no painel do item, um documento só por PP e a data de pagamento na aba de PPs](112-quebra-das-pps-documento-unico-e-data-de-pagamento.md) | 2026-09-28 |
| 113 | [Job não aberto não existe no financeiro, e o cancelado antes da abertura volta a ser só orçamento](113-job-nao-aberto-nao-existe-no-financeiro.md) | 2026-09-28 |
| 114 | [O código do job é [SIGLA]-[SEQ]/[AA], com 1 na frente em 2026; o projeto leva P, e o do financeiro F](114-codigo-do-job-por-sigla-e-ano.md) | 2026-09-28 |
| 115 | [O financeiro edita o orçado do job na Planilha Interna, sem aprovação, da abertura até a primeira nota ou o encerramento](115-o-financeiro-edita-o-orcado-do-job.md) | 2026-09-28 |
| 116 | [Projeto com orçamento aprovado ou com job não se arquiva](116-projeto-com-orcamento-aprovado-nao-se-arquiva.md) | 2026-09-28 |
| 117 | [O status só muda pelo sistema](117-status-so-muda-pelo-sistema.md) | 2026-09-28 |
| 118 | [O orçamento se arquiva, e o arquivado (orçamento ou projeto) é só leitura](118-orcamento-se-arquiva-e-arquivado-e-so-leitura.md) | 2026-09-28 |
| 119 | [O projeto do financeiro nasce com o job, tem nome único e se renomeia pelo lápis](119-projeto-do-financeiro-nasce-com-o-job-e-tem-nome-unico.md) | 2026-09-28 |
| 120 | [Cancelar e estornar baixa são duas ações diferentes, nas duas pontas](120-cancelar-e-estornar-baixa.md) | 2026-09-28 |
| 121 | [O código do orçamento é só da base de dados; na tela, o código é o do job](121-o-codigo-do-orcamento-e-so-da-base-de-dados.md) | 2026-09-29 |
| 122 | [O cliente do projeto só muda antes da aprovação, e os códigos acompanham](122-cliente-do-projeto-so-muda-antes-da-aprovacao.md) | 2026-09-29 |
| 123 | [O envio para faturamento vira notas fiscais](123-o-envio-para-faturamento-vira-notas-fiscais.md) | 2026-09-29 |
| 124 | [Recebimento avulso, transferência entre contas e rendimento de aplicação viram títulos a receber](124-recebimento-avulso-transferencia-e-rendimento.md) | 2026-09-28 |
| 125 | [Baixa parcial e impostos retidos na baixa, nas duas pontas — revisada em 2026-10-01: folha baixa pela lista, sem cartão](125-baixa-parcial-e-impostos-retidos.md) | 2026-09-28 |
| 126 | [O código antigo sai do sistema, e a PP mostra só o código do job](126-o-codigo-antigo-sai-do-sistema.md) | 2026-09-29 |
| 127 | [A PP pode pagar por outra chave PIX ou outra conta, sem mexer no cadastro do fornecedor](127-pp-com-pagamento-fora-do-cadastro.md) | 2026-09-29 |
| 128 | [O job devolvido se corrige no orçamento e volta com o mesmo código](128-job-devolvido-se-corrige-e-volta-com-o-mesmo-codigo.md) | 2026-09-29 |
| 129 | [A planilha importada é descartada depois da importação](129-planilha-importada-e-descartada.md) | 2026-09-29 |
| 130 | [Recebimento antes da NF: vira a parcela 1 da nota, já quitada](130-recebimento-antes-da-nf.md) | 2026-09-29 |
| 131 | [Serviço Mídia, com Mídia On e Mídia Off, e a categoria "em breve"](131-servico-midia-e-categoria-em-breve.md) | 2026-09-29 |
| 132 | [A folha paga pela remessa com o líquido, sem mexer no salário do cadastro](132-folha-paga-pela-remessa-com-o-liquido.md) | 2026-09-30 |
| 133 | [O projeto aceita mais de uma marca, e o job leva a marca geral do cliente](133-projeto-com-mais-de-uma-marca.md) | 2026-09-30 |
| 134 | [Regional só de folha: a AMBEV some da produção](134-regional-so-de-folha.md) | 2026-09-30 |
| 135 | [Envio para abertura: GP e produtor editáveis, Serviço no formulário e só o código do job](135-envio-com-gp-produtor-e-servico.md) | 2026-09-30 |
| 136 | [Qualquer GP age em qualquer job, e quem fez cada envio fica registrado](136-qualquer-gp-age-e-o-autor-fica-registrado.md) | 2026-10-01 |
| 137 | [Pagamento fora do cadastro: visível ao financeiro e pago pela remessa](137-fora-do-cadastro-visivel-e-pago-pela-remessa.md) | 2026-10-01 |
| 138 | [O percentual de cada parcela da PP, com a última fechando os 100%](138-percentual-de-cada-parcela-da-pp.md) | 2026-10-01 |
| 139 | [Módulo fiscal, entrega 1: o cadastro de impostos e os dados que alimentam a apuração](139-modulo-fiscal-entrega-1.md) | 2026-10-02 |
| 140 | [Baixa em lote e a aba Títulos na conciliação](140-baixa-em-lote-e-aba-titulos.md) | 2026-10-02 |
| 141 | [Módulo fiscal, entrega 2: Apuração, Impostos a Pagar e a guia na conciliação](141-modulo-fiscal-entrega-2.md) | 2026-10-02 |
| 142 | [Módulo fiscal: os pontos remanescentes do protótipo](142-modulo-fiscal-pontos-remanescentes.md) | 2026-10-03 |
| 143 | [As PPs que travam o cancelamento se cancelam pelo próprio pop-up](143-pps-se-cancelam-pelo-pop-up-do-cancelamento.md) | 2026-10-03 |
| 144 | [Módulo fiscal: guia própria do 12.08 e o código da CSLL](144-guia-propria-do-1208-e-codigo-da-csll.md) | 2026-10-04 |
| 145 | [Módulo fiscal: correções pela lei (remessa pelo líquido, complementar, DARF mínimo)](145-fiscal-correcoes-pela-lei.md) | 2026-10-04 |
| 146 | [Crédito de PIS/COFINS pelo rateio proporcional do mês (o job sai da regra)](146-credito-pelo-rateio-proporcional.md) | 2026-10-04 |
| 147 | [Planilha de Mídia Off no orçamento (entrega 1: até aprovar)](147-planilha-midia-off.md) | 2026-10-06 |
| 148 | [A visão agregada salva cada alteração na hora, e o orçamento vazio se exclui](148-agregada-salva-cada-alteracao.md) | 2026-10-06 |
| 149 | [O envio para abertura muda pelo tipo de job: Interno sem recebimento; Fee e Always On sem evento e com recebimento por mês](149-envio-para-abertura-por-tipo-de-job.md) | 2026-10-06 |
| 150 | [Cadastro de Veículos em Cadastros; os meios do veículo vêm do uso nas planilhas](150-cadastro-de-veiculos.md) | 2026-10-07 |
| 151 | [A errata não mexe no planejado e cancela a linha em vez de apagá-la](151-errata-nao-mexe-no-planejado-e-cancela-linha.md) | 2026-10-07 |
| 152 | [A NF do fornecedor tem cadastro próprio e conta uma vez só](152-nf-do-fornecedor-com-cadastro-proprio.md) | 2026-10-07 |
| 153 | [PP a emitir: a PP é revisada antes de gerar e não se edita depois](153-pp-a-emitir.md) | 2026-10-07 |
| 154 | [O save do orçamento inteiro: gerar em todas as linhas ou consumir o saldo de um job](154-save-do-orcamento-inteiro.md) | 2026-10-07 |
| 155 | [O save que vem com o job é aprovado na abertura](155-save-aprovado-na-abertura.md) | 2026-10-07 |
| 156 | [O CNPJ da PP é separado da empresa gerencial (revista em 16/10: a empresa emissora segue o documento — nota, fatura ou recibo —, e o PDF ganha a empresa gerencial e a regional)](156-cnpj-da-pp-separado-da-gerencial.md) | 2026-10-07 |
| 157 | [A PP chega ao financeiro até 15 dias antes da janela de pagamento](157-prazo-de-envio-da-pp.md) | 2026-10-07 |
| 158 | [Planilha de um mês só no Fee e no Always On](158-planilha-de-um-mes-no-fee-e-always-on.md) | 2026-10-08 |
| 159 | [O produtor deixa a errata pronta para envio, e o GP a envia ao financeiro](159-errata-pronta-para-envio.md) | 2026-10-08 |
| 160 | [A PP fica "Pronta para envio", e o GP a envia pela aba Pedidos de Produção](160-pp-pronta-para-envio-e-envio-pela-aba.md) | 2026-10-09 |
| 161 | [A PP paga por boleto ou chave aleatória, e o fornecedor pode não ter conta nem PIX no cadastro](161-pp-por-boleto-ou-chave-aleatoria.md) | 2026-10-09 |
| 162 | [A errata organiza a planilha do job: ordem, agrupamento novo, renomeado e o vazio que sai](162-organizar-a-planilha-do-job-na-errata.md) | 2026-10-09 |
| 163 | [Job cancelado sai do módulo de Jobs e só aparece em Orçamentos](163-job-cancelado-sai-do-modulo-de-jobs.md) | 2026-10-09 |
| 164 | [Verba de Alimentação e Verba de Transporte, com titular do RH, freela ou terceiro](164-verbas-de-alimentacao-e-transporte.md) | 2026-10-09 |
| 165 | [Filtro e ordem pelo título da coluna, como no Excel, nas listas do ERP](165-filtro-por-coluna-nas-listas.md) | 2026-10-09 |
| 166 | [Regime tributário (Real e Presumido separados) e CNAE obrigatórios no fornecedor, e a PP travada para cadastro incompleto](166-regime-e-cnae-do-fornecedor.md) | 2026-10-09 |
| 167 | [Job da Mídia Off, entrega 2: abrir e faturar por mês, e o último envio encerra o job](167-job-da-midia-off-abrir-e-faturar.md) | 2026-10-13 |
| 168 | [Produtor Responsável só lista quem tem o papel Produtor, e GP e Produtor aceitam digitação](168-produtor-responsavel-so-papel-produtor.md) | 2026-10-13 |
| 169 | [Cancelamento de job aberto: a produção pede, o financeiro decide na Abertura de Job](169-cancelamento-de-job-aberto.md) | 2026-10-13 |
| 170 | [GP só quem pode ser GP: lista do projeto, lista do orçamento e trava no envio para abertura](170-gp-so-quem-pode-ser-gp.md) | 2026-10-13 |
| 171 | [A verba de produção igual às outras (titular, lista, terceiro e prestação), e a conta do RH na PP do colaborador](171-verba-de-producao-com-titular-e-conta-do-rh.md) | 2026-10-14 |
| 172 | [Quarta de exceções na PP urgente, e as datas das parcelas que se adiam (revê a 077 e a 157)](172-quarta-de-excecoes-na-pp-urgente.md) | 2026-10-14 |
| 173 | [A PP gerada volta a se editar, no lugar (revê a 153)](173-pp-gerada-volta-a-se-editar.md) | 2026-10-13 |
| 174 | [O job não se edita depois da abertura, o botão "Equipe" e o Produtor Responsável que envia PP com a chave do GP](174-equipe-do-job-e-envio-de-pp-pelo-produtor.md) | 2026-10-14 |
| 175 | [A errata volta a abrir o planejado, a linha cancelada zera os dois lados e o job mostra só o valor de hoje (revê a 151)](175-errata-volta-a-abrir-o-planejado-e-valor-unico.md) | 2026-10-15 |
| 176 | [Trocar o GP e o Produtor Responsáveis do job aberto pela Equipe, e o GP de fora do projeto entrando sozinho nos GPs do projeto](176-trocar-gp-e-produtor-do-job-aberto.md) | 2026-10-15 |
| 177 | [A produção (GP, produtor e freela) edita o cadastro do fornecedor pelo lápis, e não só o pendente](177-producao-edita-cadastro-de-fornecedor.md) | 2026-10-15 |
| 178 | ["Fatura" no tipo do anexo, a revisão da PP sem a linha "Nota fiscal" quando não há NF, e a prévia da PP na conferência lado a lado (revê a 153 e a 161)](178-fatura-revisao-sem-nf-e-previa-da-pp.md) | 2026-10-15 |
| 179 | [Regime "Lucro Presumido ou Real" numa opção só no fornecedor, preenchido pela consulta do CNPJ (revê a 166)](179-regime-presumido-ou-real.md) | 2026-10-15 |
| 180 | [O optante do Simples pode ter o ISS retido na aprovação da PP; o MEI continua travado (revê a 139)](180-iss-retido-do-simples-na-aprovacao.md) | 2026-10-15 |
| 181 | [Empresas de teste no fiscal e a Apuração na ordem de vencimento (revê a 141)](181-empresas-de-teste-e-apuracao-por-vencimento.md) | 2026-10-16 |
| 182 | [O adiantamento conta na emissão da nota; ajustes da lista da Apuração (revê a 141, a 142 e a 181)](182-adiantamento-na-emissao-e-ajustes-da-apuracao.md) | 2026-10-16 |
| 183 | [O "a apurar no recebimento" vira linhas da lista da Apuração; a conta da Empresa Teste Presumido (revê a 181)](183-a-apurar-na-lista-e-conta-da-empresa-teste-presumido.md) | 2026-10-16 |
| 184 | [O Faturar redesenhado: drawer que abre a nota, "Faturar", job de referência na avulsa e CNPJ do tomador com "exterior" (revê a 086 e a 123)](184-faturar-drawer-que-abre-a-nota-e-cnpj-do-tomador.md) | 2026-10-16 |
| 185 | [A errata em revisão trava o envio de PP só na linha que ela alterou (revê a 040)](185-errata-trava-o-envio-de-pp-so-na-linha-alterada.md) | 2026-10-16 |
| 186 | [O histórico de versões da Planilha Interna do job, na produção e no financeiro](186-historico-de-versoes-da-planilha-do-job.md) | 2026-10-17 |
| 187 | [PP de reembolso: despesas com comprovantes e deslocamento com veículo próprio](187-pp-de-reembolso.md) | 2026-10-17 |
| 188 | [Envio em lote para faturamento: vários jobs de um cliente, com as notas que o cliente pediu e o rateio entre notas e jobs](188-envio-em-lote-para-faturamento.md) | 2026-10-19 |
| 189 | [Prestação de contas da verba documento a documento, pelo "PPs" da planilha, e a NF da loja no cadastro de notas do fiscal](189-prestacao-de-contas-da-verba-documento-a-documento.md) | 2026-10-19 |
| 190 | [O PDF da PP que não vale para pagamento sai com selo: a gerada, ainda não enviada pelo sistema, e a cancelada](190-selo-no-pdf-da-pp-nao-enviada-e-cancelada.md) | 2026-10-19 |
| 191 | [O PDF da PP mostra o item da planilha a que ela pertence, embaixo do Serviço](191-item-da-planilha-no-pdf-da-pp.md) | 2026-10-19 |
| 192 | [A IA lê o PDF logo que ele é anexado à PP e pré-preenche tipo, número e os dados da NF, com o selo "IA" e editável](192-ia-le-o-anexo-da-pp-ao-anexar.md) | 2026-10-19 |
| 193 | [A conta ou o PIX do titular da verba: automático pelo cadastro quando ele tem, digitado na PP quando não tem](193-conta-ou-pix-do-titular-da-verba.md) | 2026-10-19 |
| 194 | *Reservada* — a nota depois do pagamento: PP enviada com o orçamento, "Nota pendente" e "Anexar a nota" | 2026-10-20 |
| 195 | [As planilhas de títulos e o Extrato nas mesmas colunas: Conciliação › Títulos, Contas a Pagar, Contas a Receber e Impostos a Pagar (revê a 091 e a 140)](195-planilhas-de-titulos-e-extrato-nas-mesmas-colunas.md) | 2026-10-21 |
| 196 | [O popup de baixa: PIX como padrão, caixas no lugar das chaves, e juros e multa no boleto num lançamento à parte (revê a 125)](196-popup-de-baixa-pix-caixas-e-juros-no-boleto.md) | 2026-10-21 |
| 197 | [O cartão: a fatura escolhida na baixa, o lote no cartão e o extrato da fatura na grade das planilhas; baixa e fatura só por admin e financeiro no banco (revê a 093 e a 140)](197-cartao-fatura-escolhida-lote-e-novo-layout.md) | 2026-10-21 |
| 198 | [A importação do extrato do banco em OFX: a conta pelo arquivo, a impressão digital que não repete e a aba Conciliação automática](198-importacao-do-extrato-ofx.md) | 2026-10-21 |
| 199 | [O motor de correspondência, o vínculo "conciliado" (`extrato_linha_id`) e as seções da Conciliação automática](199-motor-de-correspondencia-e-secoes-do-banco.md) | 2026-10-21 |
| 200 | [As ações da Conciliação automática: conciliar, baixar pelo lote com os dados do banco, conferir pela baixa real, corrigir a baixa, regras, saiu e voltou, ignorar e desfazer; a data do banco em tudo](200-acoes-da-conciliacao-automatica.md) | 2026-10-21 |
| 201 | [O que se resolve sozinho na importação do extrato: a baixa feita à mão que bate, o título certo, a remessa e a regra; cada linha avaliada uma vez](201-o-que-se-resolve-sozinho-na-importacao.md) | 2026-10-21 |
| 202 | [As marcas do banco no Extrato (✓, ⚠, ○, a faixa e o contador), o sinal na aba Títulos, e a folha e a remessa linha a linha (revê a 199)](202-marcas-do-banco-no-extrato-e-nos-titulos.md) | 2026-10-21 |
| 203 | *Reservada para a conciliação com o banco e não usada por ela:* o número foi tomado em paralelo, e o fechamento da conciliação virou a 205 | 2026-10-21 |
| 204 | [Administrador nas exceções da aprovação e geração/edição de PP](204-administrador-nas-excecoes-do-orcamento-e-da-pp.md) | 2026-10-21 |
| 205 | [O fechamento da conciliação com o banco: trava o caixa da conta até reabrir, com o gatilho em `lancamentos_financeiros` (M4.2, opção B) e o reabrir com motivo (revê a 120)](205-fechamento-da-conciliacao.md) | 2026-10-21 |
| 206 | [A exceção no fechamento do internacional, só do administrador: int. taxes, impostos BR e custo de transação travados no padrão; câmbio em linha própria, com compra e venda a ±0,20 da cotação (revê a 072 e a 096)](206-excecao-no-fechamento-do-internacional.md) | 2026-10-22 |
| 207 | [Resultado de Job na Central Financeira; Visualizar Jobs e Resultado de Job com Valor do Job, Faturamento sem selo e a Rentabilidade do próprio job (valor do job − impostos − custo planejado)](207-resultado-de-job.md) | 2026-10-23 |
| 208 | [A linha da Planilha Interna abre em sublinhas, uma por PP (job e financeiro)](208-pps-em-sublinhas-na-planilha-interna.md) | 2026-10-23 |
| 209 | [A PP no cartão corporativo: quarto tipo de PP, sem fornecedor, com plataforma e link da compra; parcelas da fatura e aprovação só no cartão; envio sem nota](209-pp-no-cartao-corporativo.md) | 2026-10-23 |
| 210 | [O código do projeto perde a sigla do cliente: P-NNNN/AA na produção, F-NNNN/AA no financeiro, pela ordem de criação](210-codigo-do-projeto-sem-sigla.md) | 2026-10-23 |
| 211 | [Importação do histórico da planilha financeira: como ler a planilha e o corte em 01/10/2026](211-importacao-do-historico-da-planilha-financeira.md) | 2026-10-25 |
| 212 | [O tipo da chave PIX e o tipo de conta no cadastro do freela: PIX e conta sempre à vista, e o tipo gravado vence a dedução da 193](212-tipo-do-pix-e-da-conta-no-cadastro-do-freela.md) | 2026-10-26 |
| 216 | [Mídia System: o job auditado pelo cliente; a PP vai sem NF até o financeiro liberar as notas, e a NF entra pela prestação de contas da verba, sem saldo](216-midia-system.md) | 2026-10-26 |
| 217 | [O código do projeto sai das telas: só o nome, ordem pela criação, sem coluna de código no Excel](217-codigo-do-projeto-fora-das-telas.md) | 2026-10-27 |
| 218 | [A folha entra no fluxo de caixa como previsão (data prevista da linha ou dia 03 do mês seguinte, a partir de 10/2026), a aprovação grava a mesma data e a folha do mês seguinte nasce sozinha 30 dias antes](218-folha-prevista-no-fluxo-de-caixa.md) | 2026-10-27 |
| 219 | [Fee e Always On: o fim vem no fim do trimestre, os meses aparecem no formulário, orçamento e job abrem no Total, e o mês que faltou entra no job pela errata](219-os-tres-meses-do-trimestre.md) | 2026-10-27 |
| 220 | [13º Salário: integração com Folha de Pagamento via FK, não via reuso de tabela](220-decimo-terceiro-integracao-folha-pagamento.md) | 2026-10-21 |
| 221 | [13º Salário: breakdown do híbrido CLT_recibo persistido no banco](221-decimo-terceiro-breakdown-hibrido.md) | 2026-10-21 |
| 222 | [13º Salário: INSS/IRRF 10/2026 e Lei 15.270 hard-coded, substituição anual](222-decimo-terceiro-tabelas-10-2026.md) | 2026-10-21 |
| 223 | [Comitê de Aprovações: o Comitê no lugar do "só o administrador" da 204](223-comite-de-aprovacoes.md) | 2026-10-27 |
| 224 | [O financeiro edita os parâmetros do job na abertura (honorários, impostos, taxas e câmbio)](224-parametros-do-job-na-abertura.md) | 2026-10-28 |
| 225 | [O GP registra a exceção no fechamento, e a versão vai ao Comitê](225-excecao-no-fechamento-pelo-gp-e-comite.md) | 2026-10-28 |
| 226 | [A linha vermelha sai da errata, e a versão aprovada mostra as erratas (com Histórico)](226-linha-vermelha-fora-da-errata-e-versao-aprovada-com-as-erratas.md) | 2026-10-28 |
| 227 | [A PP paga por guia: taxa, licença ou alvará de órgão público, sem NF](227-pp-paga-por-guia.md) | 2026-10-29 |
| 228 | [O projeto do financeiro junta jobs de clientes diferentes](228-projeto-do-financeiro-com-jobs-de-clientes-diferentes.md) | 2026-10-29 |

> A 028 é de 24/08 e vem depois da 027, de 26/08: ela nasceu como 023, em
> paralelo à das versões em abas, e foi renumerada em 27/08/2026 — a
> data é a da decisão, não a da posição na fila.
> A 097 nasceu como 088 em 2026-09-18 sem consulta a este índice (que
> estava desatualizado apontando "próximo: 091" quando 088, 091 e 092 já
> haviam sido tomadas); em 19/09/2026 foi renumerada localmente pra 093,
> mas o merge com a frente do Cartão revelou que 093 também estava
> tomado (ADR de Cartão vem de 2026-09 com fases §11..§13). Renumerada
> definitivamente pra 097 no pull de 21/09/2026 — a data é a da decisão
> original, não a da posição final.

**Próximo número livre: 229**. (091 e 092 existem na pasta e ainda não estão nesta tabela.)
