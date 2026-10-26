# 186 — O histórico de versões da Planilha Interna do job, na produção e no financeiro

**Data:** 2026-10-17
**Status:** aceita e implementada em 17/10/2026. Revista em 26/10/2026: no
mensal, a troca de mês mantém a versão escolhida (fim do arquivo).
**Quem decidiu:** Tiago — pedido em 14/10/2026, protótipo aprovado em
15/10/2026 ("Aprovado. Isso deverá ficar presente na visão do financeiro
também"), depois da [175](175-errata-volta-a-abrir-o-planejado-e-valor-unico.md)
("Errata primeiro").
**Completa:** a 175 (o job mostra só o valor de hoje; o da abertura e os do
meio do caminho ficam aqui) e a [162](162-organizar-a-planilha-do-job-na-errata.md)
(a organização da errata também se desfaz).
**Migration:** nenhuma — tudo sai de tabelas que já existem.

## O pedido

> "Penso que podemos fazer um histórico de versões, o qual ao ser clicado
> nos direciona a versão anterior da planilha, para mantermos um controle de
> tudo que ocorreu."

No protótipo de 14/10/2026 (opção A, botão na barra) o Tiago pediu a barra
em duas linhas: o rótulo "Planilha do job · …" em cima; embaixo, o
"Recolher todos" no canto esquerdo e o "Histórico" no lugar dele, ao lado do
Bruto/Líquido. Aprovado em 15/10/2026, com o pedido de que valesse também
para o financeiro.

## Como fica

- **Botão "Histórico"** na barra da planilha, ao lado do Bruto/Líquido. Abre
  a lista dos momentos do job, do mais novo ao mais antigo, cada um com o
  valor do job daquele momento e a diferença para o anterior (verde subiu,
  vermelho desceu, como no card de Erratas): "Planilha atual", "Errata",
  "Errata de save", "Alteração do financeiro", "Edição do financeiro na
  fila", "Pedido de save cancelado" / "Save recusado pelo financeiro", "Job
  aberto no financeiro" e "Enviado para abertura".
- **Versão antiga só leitura.** Clicar num momento mostra a planilha como
  ela ficou depois dele, com uma faixa em cima: data e hora, autor, revisão
  do financeiro (quando houve), o texto da errata ou o motivo da alteração,
  um chip por mudança ("Item 3 · planejado R$ 8.000,00 → R$ 9.000,00",
  "vira save", "Agrupamento 2 → Agrupamento Final"), o valor do job antes e
  depois, "Destacar o que mudou", ‹ › e "Voltar para a atual".
- As linhas que o momento mudou ficam em vermelho claro, com o selo
  "alterada", "nova", "save" ou "movida" (a cancelada já tem o dela). O
  realizado fica em branco, as PPs, o BV e o save não aparecem, e o card de
  Totais fecha só no planejado — "o realizado e as PPs ficam na planilha
  atual".
- Some na errata e no "Editar orçado" do financeiro: quem edita está na
  atual. Exportar, errata, PP e BV não existem na versão antiga.
- **Onde:** a página do job (`/jobs/[jobId]`), a do job no financeiro
  (`/financeiro/jobs/[jobId]`) e a da Abertura de Job
  (`/financeiro/abertura-de-job/[jobId]`, o job na fila e em revisão). Fica
  de fora a planilha da origem do save (só consulta) e a Mídia Off, que tem
  planilha própria.

## A reconstrução

Não há foto de cada versão no banco: a planilha é remontada **de trás para a
frente** a partir da de hoje, desfazendo cada momento com o "de" que o
histórico já gravou (`lib/calculos/historico-da-planilha.ts`,
`montarHistorico`):

| Momento | De onde sai | O que se desfaz |
|---|---|---|
| Alteração do financeiro | `jobs_alteracoes_financeiro_itens` | orçado, tipo e (desde 14/10/2026) planejado |
| Errata | `jobs_erratas_itens` | alterada, nova, cancelada; a "removida" de antes da 151 volta pela linha da versão aprovada |
| Organização da errata (162) | `jobs_erratas.estrutura` | agrupamento renomeado, criado, removido; item movido |
| Save da errata | `saves_aprovacoes.errata_id` ou o efeito gravado | a linha sai do save; o planejado volta ao `planejado_antes_save` |
| Pedido de save cancelado ou recusado sem errata | `saves_aprovacoes` (`job_aberto`) | a linha volta ao save |
| Envio e abertura | `jobs` | marcos: não mudam a planilha |

Duas regras vieram da conferência com o dado real:

1. **O save sem pedido ligado** (os de antes da decisão 099, e o pedido que
   entrou e saiu) é reconhecido pelo efeito que a errata gravou: orçado e
   tipo iguais e o valor do job mudando só podem ser o save — o planejado não
   entra no valor do job. Efeito negativo, a linha entrou no save; positivo,
   saiu.
2. **O pedido de save feito com o job aberto** muda a linha na hora (com
   errata), mas cancelado antes da decisão — ou recusado — ele a devolve sem
   errata (`save_reverter_pedido`). Isso vira um momento próprio. O recusado
   e depois arquivado fica "retirado", e é a justificativa da recusa que o
   distingue do aprovado e retirado (este tem errata).

A leitura (`actions-historico.ts`, `carregarHistoricoDaPlanilha`) só roda
quando alguém abre o "Histórico" — a página não paga nada por ele — e usa o
cliente do usuário: a RLS de cada tabela é a mesma que já decide a planilha
(conferido como Produtor Teste; o freelancer, só no projeto dele). O valor do
job de cada versão sai da mesma conta do cabeçalho (`calcularTotaisVersao`).

## Limites conhecidos

- A **ordem** das linhas dentro do agrupamento antes de uma errata que
  reorganizou é a da versão aprovada: a errata grava para onde a linha foi,
  não a posição de onde saiu.
- O **consumo de save** (linha paga por saldo de outro job) não se refaz: ele
  muda o faturamento, não o valor do job, e a versão antiga não mostra a
  coluna Save.
- ~~No **modelo mensal**, clicar num mês da régua recarrega a página e volta
  à planilha atual.~~ Resolvido em 26/10/2026 (fim do arquivo).
- A linha devolvida por uma "removida" sem cópia na versão aprovada entra no
  fim do agrupamento.

## Conferência (17/10/2026)

- **Todos os 26 jobs com histórico** (15 reais e 11 de teste, 155 versões),
  numa rota temporária local, apagada antes do commit: o valor do job
  recalculado em cada versão bate ao centavo com o que cada errata e
  alteração gravou, com `valor_job_abertura` na abertura e com
  `jobs.valor_total` na atual; a versão do envio é igual à versão aprovada,
  com o mesmo número de linhas. Na primeira rodada 23 bateram; os 3 que não
  bateram (TES-1001, TES-1002 e TES-1003, de teste de save) trouxeram as duas
  regras acima e a linha nova apagada antes da 151, que perdeu o id.
- **Na tela, logado:** TES-1025/26 com 6 momentos (envio R$ 172.620,85,
  edição na fila R$ 176.261,34, abertura, errata da 162 com os agrupamentos
  de antes, errata da 175 com o Item 3, a linha nova e o Item 6 cancelado),
  Totais só no planejado, "Voltar para a atual", o botão some no modo
  errata; a mesma lista na visão do financeiro; TES-1002/26 (mensal, 21
  momentos, com a régua e a errata de save); TES-1029/26 na Abertura de Job
  (envio e edição do planejado na fila).
- `npm run test:historico-da-planilha` (11 testes), tsc e eslint limpos.

## Revisão de 26/10/2026 — a troca de mês mantém a versão

Pedido do Tiago ("Faça o recomendado, concordo"). No job mensal, escolher uma
versão antiga e clicar noutro mês da régua voltava à planilha atual, e o
histórico tinha de ser aberto de novo.

**Por quê:** a régua troca de mês pelo endereço (`?mes=`); a página recarrega
e entrega à planilha uma lista de linhas nova — com o mesmo conteúdo. O
`JobRealizadoSection` descartava o histórico lido sempre que a lista mudava
de referência, que é o sinal de "a planilha mudou" (errata, alteração, save).

**Agora:** ele compara o CONTEÚDO (`assinaturaDaPlanilha`: id, agrupamento,
ordem, nome, tipo, linha vermelha, orçado, planejado, save, consumo de save e
cancelamento de cada linha; nome, ordem e mês de cada agrupamento). A troca
de mês mantém a versão e o histórico carregado; uma errata, alteração ou save
continua descartando-os. A versão não entrou no endereço: não precisou.

**Conferido, logado:** TES-1002/26 na versão de 22/09/2026 (errata de save),
clique em "Novembro" — a faixa da versão fica, o card vira "Totais de
novembro", o realizado segue em branco e o "Histórico" mantém os 21
momentos. Com o código anterior, o mesmo clique derrubava a versão (refeito
para conferir). Depois, uma errata de teste no TES-1025/26 (planejado do
Item 4 de R$ 8.000,00 para R$ 8.100,00): o histórico lido foi descartado e,
reaberto, trouxe 7 momentos com a errata nova no topo.

## Possibilidade futura (não pedida)

- **Atalho nos cards de Erratas e de Alterações do Financeiro** (aba
  Informações do Job): um ícone na linha da errata ou da alteração que abre a
  Planilha Interna já naquela versão. O histórico já mostra as mesmas
  versões; seria só o caminho mais curto. Registrado em 26/10/2026 a pedido
  do Tiago ("Talvez possa ser feito no futuro").
