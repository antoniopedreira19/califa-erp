# 150 — Cadastro de Veículos em Cadastros; os meios do veículo vêm do uso nas planilhas

**Data:** 2026-10-07
**Quem decidiu:** Tiago — pedido de 06/10/2026 ("a inclusão do formulário de cadastro de veículos em 'Cadastros'"), com o protótipo interativo aprovado em quatro rodadas entre 06 e 07/10/2026 (https://claude.ai/artifact/P9Rf1wvkgNNR4HgovesiVx, v1 a v4).
**Continua:** [147](147-planilha-midia-off.md) (a planilha de Mídia Off e o veículo como fornecedor marcado).

## O que entrou

| Onde | O quê |
|---|---|
| Cadastros | Card **Veículos**, logo depois de Fornecedores e antes de Cidades, com a contagem dos ativos. |
| Cadastros › Veículos (`/cadastros/veiculos`) | Lista no padrão da de Fornecedores: busca por nome ou documento, filtro por meio, "Mostrar inativos", linha clicável e o Inativar na ponta. Colunas: Nome (com razão social e o selo **Sem pagamento** quando não há conta nem PIX), **Usado em**, Documento, Contato e Status. |
| Novo veículo / cadastro do veículo (`/cadastros/veiculos/novo` e `/[id]`) | O formulário do fornecedor na variante "veiculo": pagamento opcional (vai ser exigido para a PP do repasse), Cancelar e Criar voltando para a lista. Se o CNPJ já é de um fornecedor, **Usar este cadastro** só o marca como veículo e abre o cadastro dele. |
| Fornecedores | Selo **Veículo** ao lado do nome de quem também é veículo; o selo leva ao cadastro em Cadastros › Veículos. |
| Pop-up rápido da planilha de Mídia Off | Sem meio nem praça e sem a nota do regime tributário ("As retenções dependem do serviço contratado…"). O pagamento continua aberto, como no "Novo fornecedor" da PP. |
| Célula Veículo da planilha | A lista agrupa **Já usados em {meio da linha}** e depois **Outros veículos**; a descrição de cada um é "Já usado em …" ou "Ainda não usado". |

## Os meios saem do cadastro (o que muda da 147)

Na 147 o veículo guardava os meios que vende (obrigatório, o primeiro era o principal) e a praça, e a lista da célula mostrava primeiro quem vende o meio da linha. Esses campos não travavam nada — qualquer veículo pode ser escolhido em qualquer linha —, só ordenavam a lista, e precisavam ser mantidos à mão.

Pergunta do Tiago (06/10/2026): "Não seria melhor deixar qualquer veículo com todos os meios disponíveis?" Resposta (07/10/2026): **concordo com a recomendação** —

- O cadastro do veículo **não pede meio nem praça**.
- Os meios do veículo vêm do **uso**: as linhas de mídia em que ele já foi escolhido, em qualquer orçamento (`vw_veiculos_meios_usados`). Nada é gravado nem editável; um veículo recém-cadastrado aparece como "Ainda não usado" até a primeira linha.
- A **praça** fica só na linha da planilha, onde já existia.

## Inativar

O veículo sai da lista inativando o fornecedor (o mesmo "Inativar" de Fornecedores): some da escolha nas planilhas de mídia e na de fornecedor dos orçamentos e PPs, o histórico fica e dá para reativar. Nada é apagado.

## Banco

Migration `20261007500001`: sai a trava `veiculos_midia_com_meio` (meios > 0) e `meios` ganha o padrão `'{}'`; nasce a view `vw_veiculos_meios_usados` (`security_invoker`, só `authenticated`) e o índice parcial `idx_grupos_midia`. As colunas `veiculos_midia.meios` e `praca` ficam com o que já foi gravado e deixam de ser lidas — apagá-las é mudança destrutiva, a pedir antes.

## Ações

`criarVeiculoFornecedor(formData, origem)` (origem `midia` = pop-up, `cadastro` = página, que redireciona para a lista), `atualizarVeiculoFornecedor` e `marcarFornecedorComoVeiculo(fornecedorId)` só marcam o fornecedor como veículo (insere em `veiculos_midia` quem ainda não é). A auditoria `veiculo_midia.criado` leva a origem.
