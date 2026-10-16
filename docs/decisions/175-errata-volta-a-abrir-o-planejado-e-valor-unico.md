# 175 — A errata volta a abrir o planejado, a linha cancelada zera os dois lados e o job mostra só o valor de hoje (revê a 151)

**Data:** 2026-10-15
**Status:** aceita e implementada em 15/10/2026.
**Quem decidiu:** Tiago, em 14/10/2026; todas as respostas seguiram a
recomendação que acompanhava a pergunta.
**Revê:** [151](151-errata-nao-mexe-no-planejado-e-cancela-linha.md) (a
errata não mexia no planejado, a cancelada guardava o planejado e o valor
do job se dividia em inicial × atual). Volta a valer a
[054](054-errata-abre-o-planejado-junto-com-o-orcado.md) no que ela dizia
do planejado.
**Migration:** `20261015100001_errata_volta_a_abrir_o_planejado.sql`.

## O pedido

> "Estou pensando em voltar atrás do que fizemos com o resumo anterior,
> permitindo que uma errata possa incluir um planejado a um novo item,
> apagar linhas (ou zerá-las, o que você acha melhor?), e fazendo com que
> apenas o valor do job atual apareça no resumo, visto que erratas que
> adicionam ou retiram itens geralmente são feitas antes do job ocorrer ou
> estar sendo executados."

O que a 151 deixava errado, com o dado de 14/10/2026: as 2 linhas criadas
por errata em jobs reais (AMB-1014/26, "Frete" R$ 1.800,00 e "Leque"
R$ 6.420,00) entraram com planejado zero — receita sem custo planejado. E
o valor dividido aparecia em 3 jobs reais (AMB-1019/26, AMB-1002/26,
AMB-1014/26).

## As respostas (14/10/2026)

| Pergunta | Opções | Resposta |
|---|---|---|
| A linha que sai: apagar ou zerar? | Zerar (fica, com orçado e planejado em zero) · Apagar | **Zerar** |
| O planejado abre na linha nova ou também na existente? | Nova e existente · Só na nova | **Nova e existente** |
| Ordem das entregas | Errata primeiro · Histórico primeiro | **Errata primeiro** |

Por que zerar e não apagar: apagar perde a ligação da linha com o
realizado, com as PPs a emitir e com o histórico das alterações do
financeiro (`job_item_orcado_id`), e o histórico de versões teria de
remontá-la de fora. Zerada, ela continua na planilha com o selo
"cancelada" e sai da conta dos dois lados.

## A regra

1. **A errata abre o planejado** (R$ Unit., QT e D/M) na linha nova e na
   existente que ela corrige. Continuam fechados: linha vermelha (zerada
   por definição), linha em save, linha cancelada, linha com PP já no
   financeiro (decisão 040) e o serviço Interno, em que o planejado segue
   o orçado (decisão 105). Mudar só o planejado já é errata.
2. **A linha cancelada zera o orçado e o planejado** (o R$ Unit.; QT e D/M
   ficam, para a linha seguir legível). Ela fica na planilha com o selo,
   não recebe PP, BV nem save, como na 151. O **"Exibir"** ganhou a seção
   "Linhas", com "Linhas canceladas", para escondê-las da tabela quando o
   job tem alguma; na errata elas ficam sempre à vista.
3. **O job mostra só o valor de hoje.** O cabeçalho (`ResumoResultado`),
   o card de Totais e a RENTAB. planejada voltam a fechar sobre a planilha
   atual: valor do job, impostos, honorários e orçado de hoje. O valor da
   abertura continua à vista no card de Erratas ("Na abertura → Atual") e
   no histórico de versões da planilha (próxima entrega).
4. **A linha que vira save depois da abertura** sai do planejado como sai
   do orçado — o resultado planejado é o de hoje (a regra da 151 de manter
   o planejado de antes do save deixa de valer).
5. **O "Editar orçado" do financeiro não muda:** o planejado abre só com o
   job na fila da abertura (decisão 115, §11). Depois da abertura, o
   planejado muda pela errata.

## Onde mora

- **Banco** (`20261015100001`): `registrar_errata_do_job` zera também o
  `valor_unitario_planejado` da linha cancelada. O corpo da função é o da
  20261009300001 com só essa troca — conferido pelo md5 contra o banco
  antes de gerar o arquivo e depois de aplicar. O planejado da linha nova
  e da alterada já era gravado como vinha da action.
- **Action** (`actions-errata.ts`): `planejadoDaErrata` passa a usar o
  planejado informado (`planejadoInformado`), com as exceções do item 1;
  payload sem planejado (aba aberta antes) mantém a regra antiga. A linha
  em que só o planejado mudou entra como "alterada".
- **Rascunho** (`errata-rascunho.ts`): `planejadoLiberado` e
  `travaDoPlanejado` abrem o planejado na nova e na existente; a projeção
  usa o digitado e zera o planejado da cancelada; a errata pronta (decisão
  159) guarda e reabre o planejado.
- **Carregador** (`carregar-detalhe.ts`): sai a leitura de
  `versoes_orcamento_itens` e a foto da abertura; `orcado_abertura` vai
  nulo e `save_depois_da_abertura` falso. As páginas do job na produção e
  no financeiro passam `abertura={null}`. Os componentes continuam
  aceitando a foto (as telas de projeto sempre mandaram nulo): voltar à
  151 seria religar o carregador.
- **Textos:** o subtítulo do card de Erratas volta a dizer "planejados"; o
  `title` da cancelada diz "o orçado e o planejado ficam zerados"; o
  aviso ao lado do "+ Novo item" perdeu "novo item entra com o planejado
  zerado"; o pop-up da errata diz "O que muda na planilha" quando o
  planejado muda.

## O que ficou como estava

- As linhas canceladas antes de 15/10/2026 guardam o planejado que tinham.
  Nos jobs reais não há nenhuma (conferido em 15/10/2026); só em jobs de
  teste.
- O Frete e o Leque do AMB-1014/26 seguem com planejado zero até o GP
  corrigi-los por errata, que agora abre o planejado da linha existente.
- `jobs.valor_job_abertura` e `faturamento_previsto_abertura` seguem
  gravados (decisão 115 §10 inclusive): é deles que o card de Erratas e o
  histórico tiram o valor da abertura.

## Conferência (15/10/2026)

- **Cabeçalho, logado:** TES-1008/26 com "Valor do job R$ 181.667,70" único
  e Resultado op. (planejado) R$ 50.000,00 (27,5%), sobre a planilha de
  hoje (antes, inicial R$ 171.229,03 × atual).
- **Errata no rascunho, sem gravar** (TES-1025/26, como Produtor Teste): o
  planejado do Item 3 do Agrupamento 1 abriu e foi de R$ 8.000,00 para
  R$ 9.000,00 — "1 linha alterada" só pelo planejado; a linha nova "Item
  novo da errata" recebeu R$ 1.000,00 de orçado e R$ 800,00 de planejado; o
  Item 6 cancelado ficou com orçado R$ 0,00 e planejado zerado. O
  Agrupamento 1 foi de R$ 60.000,00 para R$ 53.800,00 de planejado. O
  pop-up listou o planejado de → para das três linhas. Descartado, nada
  gravado.
- **Errata registrada, logado como Tiago** (TES-1025/26, mesma errata, com
  a descrição "Teste da decisão 175…"): o pop-up abriu com "O que muda na
  planilha". No banco, `jobs_erratas_itens` gravou o Item 3 como
  "alterada" com planejado R$ 8.000,00 → R$ 9.000,00 (orçado igual), a
  linha nova com planejado R$ 0,00 → R$ 800,00 e o Item 6 como "cancelada"
  com planejado R$ 8.000,00 → R$ 0,00. Em `jobs_itens_orcado`, o Item 6
  ficou com `valor_unitario_orcado` e `valor_unitario_planejado` em zero,
  `cancelada_em` preenchido e QT/D/M em 1. Valor do job de R$ 176.261,34
  para R$ 163.734,93; o cabeçalho mostra só esse valor, na produção e no
  financeiro. Desligar "Linhas canceladas" no "Exibir" tirou o Item 6 da
  tabela (o grupo passou de 8 para 7 itens) sem mudar o planejado de
  R$ 53.800,00 do Agrupamento 1.
