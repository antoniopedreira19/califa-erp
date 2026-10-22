# 204 — Administrador nas exceções da aprovação do orçamento e da geração da PP

**Data:** 21/10/2026. Pedido direto do usuário, com referências das telas de
versão e Planilha Interna do job.

## Regra

- Aprovar uma versão com **qualquer item cujo planejado ultrapasse seu
  orçado**, ou com **Resultado geral abaixo de 20%**, exige administrador.
  O GP continua aprovando as demais versões. Vale para a versão inteira,
  mesmo quando a tela está num mês. Usa o fechamento próprio do modelo
  (nacional/mensal, internacional e Mídia Off), incluindo honorários,
  impostos, save e deduções internacionais como já aparecem na tela.
- Exatamente 20% não é exceção. A regra usa o percentual antes da
  formatação; uma dízima binária de até 1e-9 não transforma 20% em exceção.
  Sem planejado, Resultado geral continua nulo (travessão), e só essa
  ausência não cria uma restrição nova. As demais travas de aprovação
  continuam valendo, inclusive para administrador.
- No orçamento, o **total planejado do item** fica vermelho quando excede o orçado
  (revisão de 22/10/2026); o orçado mantém o azul. O
  percentual do Resultado geral fica vermelho tanto no cabeçalho quanto
  em Totais, inclusive quando ainda positivo, mas inferior a 20%. O card
  de Resultado geral conserva fundo, borda e rótulos verdes; só o número
  fica vermelho. O estado sem resultado continua neutro.
- Gerar ou editar uma PP cujo **realizado acumulado do item ultrapasse o
  orçado** exige administrador. Orçado de 100, outras PPs de 60 e nova PP
  de 41 resultam em 101, mesmo sem exceder isoladamente. Igualdade libera.
- Acumulado: todas as PPs não canceladas, inclusive geradas e rejeitadas,
  menos devoluções de verba aprovadas, antes do BV (074/081). Na geração
  soma a candidata; na edição substitui seu valor anterior, sem duplicar.
  Rascunhos em `pedidos_compra_a_emitir` ficam fora. “Salvar” continua disponível para
  revisão posterior pelo administrador. O total realizado do item fica
  vermelho vibrante (`text-red-600`) nas vistas Bruto e Líquido quando excede o orçado.
- A chave do Produtor Responsável (174) não libera essa exceção. O envio
  posterior segue os papéis atuais, preservando a confirmação acima do
  planejado (039). Refazer uma rejeitada passa novamente pela geração.
- **Formulário aprovado:** conserva os campos, ordem e rodapé atuais. O
  cartão inicial acrescenta Orçado do item, mantendo Planejado (com a
  decomposição) e Em PPs emitidas com a prévia acumulada. Triângulo âmbar
  acima do planejado; escudo vermelho acima do orçado, com precedência.
  Sob o valor da PP, somente ícone e título: “O acumulado está acima do
  planejado” ou “O acumulado deste item ultrapassa o orçado”. Sem texto
  explicativo ou cálculo extra. Para não administrador, Gerar PP/Salvar
  alterações ficam desabilitados acima do orçado, com motivo no tooltip.

## Implementação e segurança

`lib/calculos/limites-orcamento.ts` concentra as comparações e mensagens.
A página calcula a restrição da versão e a barra mantém o botão visível,
desabilitado com o motivo. `aprovarVersao` relê os itens e parâmetros do
banco e usa as mesmas funções de fechamento da página. Reutiliza a leitura
dos itens para as contagens de aprovação (menos uma consulta no total).

A geração e a edição relêem o realizado mantido pelo banco, recalculam o
valor a partir de unitário × quantidade × D/M e registram `acao_negada`
quando a exceção é recusada. As duas entradas do formulário (planilha e aba
PPs) recebem orçamento, realizado e permissão administrativa do servidor.

Migrations `20261021850001` e `20261021850002`, aplicadas pelo MCP: a
primeira protege a aprovação e criou a proteção inicial no envio; a segunda
move a proteção da PP para geração/edição conforme a revisão aprovada.
O banco recalcula a soma, desconta devoluções aprovadas e serializa as
escritas na âncora do item, inclusive quando o autor é administrador.
Reativar cancelada também confere o limite. O envio normal não pede uma
segunda autorização do orçamento. As funções têm `search_path` fixo e
execução direta revogada de `public`, `anon` e `authenticated`. Sem backfill
ou alteração de PPs/aprovações existentes.

## Verificação

- 7 testes de limites/permissões: sete papéis, igualdade, centavos,
  múltiplas PPs, edição sem duplicar, cancelamento, rejeição e devolução.
- 22 cenários SQL com os corpos dos gatilhos em tabelas temporárias e
  `rollback`: nacional, internacional, Mídia Off, save, 20% exatos, exceções
  do administrador, geração/edição acumulada e envio posterior.
- 40 testes automatizados aprovados nas suítes de limites, Mídia Off,
  composição do resultado e prestação de verba; 22 cenários SQL aprovados.
- Typecheck, lint e build de produção aprovados. O lint mantém apenas o
  aviso anterior de ARIA no `multi-select`.
- Integrada a correção de feedback do formulário publicada em `a40e1e4d`.
  Build e conferência do formulário repetidos após integrar: acumulado de
  R$ 2.000 + PP de R$ 8.000,01 bloqueia em orçado de R$ 10.000; exatamente
  R$ 10.000 permite, mantendo apenas o alerta de planejado. “Salvar” segue
  disponível para guardar a PP a emitir.

- **Conferência no navegador (21/10/2026):** build de produção local,
  sessão de GP de teste. Avisos âmbar/vermelho, rascunho acima do orçado,
  recusa do servidor pela revisão, geração de PP dentro do limite, edição
  até o valor exato do orçado, bloqueio de um centavo excedente e segunda PP
  de R$ 0,01 sobre acumulado no limite. Mesma trava pela aba PPs. Realizado
  excedente vermelho em Bruto/Líquido; versão com Resultado geral 18,6% e
  item excedente com valores vermelhos e aprovação desabilitada. PP criada
  somente para conferir foi cancelada, sem envio ao financeiro; realizado
  do item retornou a zero. Exceções de administrador conferidas nos testes
  automatizados e SQL isolado, sem sessão administrativa de produção.
