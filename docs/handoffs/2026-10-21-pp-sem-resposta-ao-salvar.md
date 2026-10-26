# PP sem resposta aparente ao salvar ou gerar

## Investigação

Relato de 21/10/2026: o produtor chega ao rodapé do formulário de PP,
clica em Salvar ou Gerar PP e não percebe resposta.

- A compra relatada não foi localizada em `pedidos_compra` nem em
  `pedidos_compra_a_emitir` na consulta realizada.
- O comprovante correspondente existe no Storage; o upload retornou 200
  às 14h43 (America/Bahia). O arquivo não foi apagado na investigação.
- Na janela consultada, as requisições que continham o ID reservado desta
  PP eram do upload. Não apareceu gravação correspondente. Isso não prova
  qual validação local bloqueou a tentativa.
- O formulário mostrava `erro` dentro do conteúdo rolável, no topo. Com
  a tela no rodapé, uma validação podia interromper a ação sem que a
  mensagem ficasse visível.
- `salvar` usava uma função assíncrona em `useTransition` do React 18.
  O estado da transição não cobria a espera inteira pela Server Action.
  Uma exceção também não tinha mensagem tratada nesse caminho.
- O tipo do comprovante vazio, visível na imagem, é aceito ao salvar e
  gerar; a classificação completa é exigida no envio ao financeiro.

## Aprofundamento após o relato de nenhuma mensagem

O cruzamento dos logs pelo usuário do upload encontrou duas leituras do
mesmo fornecedor imediatamente antes do comprovante: resumo de pagamento
e pendências fiscais. O cadastro desse fornecedor está marcado
`sem_dados_pagamento = true`, sem conta nem PIX, e sua última atualização
é anterior à tentativa. Regime e CNAE estão preenchidos.

Nesse estado, `PagamentoDaPPField` retira a escolha padrão "Cadastro do
fornecedor". Sem a escolha de chave aleatória ou boleto,
`problemaDoPagamento` interrompe os dois caminhos antes da Server Action.
Não há chamadas desse usuário ao Supabase depois do upload na janela
consultada (até 15h25).

Reproduzido com o componente anterior à correção, dados fictícios,
comprovante sem tipo e esse estado de pagamento: no rodapé, ambos os
cliques parecem não fazer nada; a mensagem é criada no topo fora da
área visível. Isso identifica um cenário concreto compatível com o dado
e o sintoma, sem acesso à sessão original para confirmar a seleção que
estava na tela do produtor. Nenhum dado operacional foi alterado.

## Correção local

Em `gerar-pp-drawer.tsx`:

- O erro aparece fora da rolagem, imediatamente acima das ações, com
  `role="alert"`, tanto na criação quanto nas edições.
- Falta de fornecedor/titular e escolha pendente do pagamento sem conta
  nem PIX aparecem no rodapé antes do clique. Preparação da PP e upload
  em andamento também explicam por que os botões estão indisponíveis.
- O salvamento tem estado próprio durante toda a espera; os botões
  indicam Salvando e impedem novo envio. O bloqueio síncrono por ref fica.
- Exceções no salvamento mostram um aviso e liberam nova tentativa,
  preservando os valores preenchidos.
- A ausência da reserva/identificação na validação ganha mensagem.

Nenhuma regra de negócio, permissão, schema ou registro financeiro mudou.

## Validação

Teste visual com o componente real empacotado em uma página isolada,
Server Actions simuladas e nenhum acesso ao banco:

- erro local ao deixar o serviço vazio;
- estado pendente durante a espera e fechamento no sucesso;
- exceção de conexão com aviso, dados preservados e botões liberados;
- retorno de erro da action visível no rodapé.
- comprovante sem tipo passa pela validação local e segue para a action.
- reprodução da versão anterior com fornecedor sem conta nem PIX e
  seleção do pagamento vazia: erro fora da área visível no rodapé;
- mesmo cenário corrigido: aviso visível no rodapé antes e após clicar;
- selecionar um meio de pagamento permite chamar a action de salvar.

Typecheck, lint e build concluíram. Typecheck e build precisaram de
`NODE_OPTIONS=--max-old-space-size=6144`, pois a primeira verificação de
tipos esgotou o heap padrão do Node. O lint mantém um aviso preexistente
de atributos ARIA em `components/ui/multi-select.tsx:121`.

Preparada na branch isolada `codex/fix-pp-sem-resposta`, a partir da
`main` atual do GitHub. O diff contém apenas o formulário e este registro.
Publicação em produção e validação com o produtor continuam pendentes.
