# 215 — Cliente e marca no orçamento, não no projeto

**Data:** 2026-10-26
**Status:** aceita e implementada em 26/10/2026; item 4 revisto no mesmo
dia (o código segue sempre o cliente).
**Quem decidiu:** Tiago — pedido em 23/10 ("jobs de clientes diferentes
dentro de um mesmo projeto"), protótipo aprovado em 26/10
(https://claude.ai/artifact/UxASwkRtQgA4GzFEinYTtQ), e três respostas em
26/10: a coluna antiga do projeto fica opcional (opção 1); a sigla do job
sai do cliente do envio; a lista e o cabeçalho do projeto mostram os
clientes dos orçamentos. Sobre o reenvio, a primeira resposta ("mantém o
código") foi revista por ele no mesmo dia: "Se o cliente mudar o codigo
sempre deve mudar para ficar de acordo com o novo cliente".
**Revê:** a [122](122-cliente-do-projeto-so-muda-antes-da-aprovacao.md) (o
cliente do projeto travava na aprovação) e a
[133](133-projeto-com-mais-de-uma-marca.md) (várias marcas no projeto).
**Migrations:** `20261026800004_cliente_e_marca_no_orcamento.sql`,
`20261026800005_codigo_guardado_volta_com_cliente_trocado.sql` (desfeita
pela seguinte) e `20261026800006_codigo_do_job_segue_o_cliente.sql`.

## O problema

O cliente e a marca eram do projeto: um projeto de evento com jobs de
clientes diferentes não cabia no sistema.

## A regra

1. **O formulário do projeto perde Cliente e Marcas.** Empresa e Regionais
   continuam nele.
2. **O formulário do orçamento ganha Cliente e Marca** (obrigatórios), logo
   depois do Projeto. O "+" da Marca cadastra uma marca do cliente, como no
   projeto fazia. O orçamento novo nasce com o cliente e a marca do último
   orçamento do projeto ("Como no último orçamento do projeto (X)"); sem
   ele, a dica diz a sigla que o código do job vai levar. Vale no "Novo
   orçamento", no "Editar orçamento" e no "Criar orçamento de job" da
   visão agregada.
3. **O envio para abertura deixa trocar Cliente e Marca.** Serviço sobe
   para o lugar do Cliente e Categoria para o da Marca; Cliente e Marca
   descem e ficam editáveis. A troca volta para o orçamento na confirmação,
   como nome, GP, cidade e regional. A confirmação mostra os escolhidos.
4. **O código do job segue sempre a sigla do cliente escolhido no envio.**
   No reenvio do job devolvido, com a mesma sigla o código fica; com outra,
   o job ganha um código novo e o antigo fica queimado (nunca volta a ser
   usado). O código guardado do job devolvido e cancelado (decisão 128) só
   volta com a mesma sigla. A prévia do formulário mostra o código que vai
   valer. Risco aceito pelo Tiago: PP ou e-mail já emitido com o código
   antigo deixa de bater — só acontece em job devolvido, antes da abertura.
5. **O job leva o cliente do orçamento** (`jobs.cliente_id`, mantido pelo
   banco) e a marca escolhida no envio (`jobs.produto_id`, que o financeiro
   pode trocar — decisão 214). **O cliente do orçamento não muda depois que
   o job abriu no financeiro.**
6. **Onde o projeto mostrava um cliente, mostra os dos orçamentos**,
   separados por vírgula: lista de projetos (e o filtro acha o projeto se
   algum orçamento for do cliente), cabeçalho do projeto (Cliente e
   Marcas), visão agregada, Jobs › projeto e a planilha exportada do
   projeto. Sem orçamento, "—".
7. **A ficha do job mostra "Cliente · Marca" no card JOB**; o cliente saiu
   do card PROJETO.
8. **Tudo que dependia do cliente do job passa a ler o do job**: saves (só
   o mesmo cliente consome), faturamento (portal, CNPJ, envio em lote),
   fluxo de caixa, relatórios de Rentabilidade e Faturamento, PDF da PP,
   honorários padrão da versão, conferência do financeiro. Na agregada, os
   saldos de save e o nome no pop-up de save são os do cliente de cada
   orçamento.

## Banco

- `orcamentos.cliente_id` (NOT NULL) e `orcamentos.produto_id`,
  preenchidos com o cliente e a marca do projeto nos 185 orçamentos.
  Orçamento gravado sem cliente (a versão anterior do app, até a
  publicação) recebe o do projeto.
- `jobs.cliente_id` (NOT NULL), preenchido pelo orçamento; gatilhos
  `job_cliente_do_orcamento` (nasce e só muda com o do orçamento) e
  `orcamento_cliente_segue_para_o_job` (leva a troca ao job e recusa
  depois da abertura).
- `projetos.cliente_id` deixa de ser obrigatória e fica como legado: os
  projetos atuais guardam o cliente que tinham, os novos ficam sem, e nada
  novo escreve nela. `projeto_marcas` também não é mais regravada. As duas
  saem quando ninguém mais as ler — passo a combinar com a frente do
  Antonio.
- Views e funções trocadas de `p.cliente_id` (projeto do job) para
  `j.cliente_id`: `vw_job_rentabilidade`, `vw_saves_por_job`,
  `vw_faturamento_pendente`, `vw_fluxo_caixa`, `emitir_faturamento`,
  `enviar_job_para_faturamento`, `enviar_lote_para_faturamento` e
  `versao_save_consumir_tudo` (o cliente da versão vem do orçamento). As
  quatro views devolveram o mesmo resultado antes e depois (hash).
- `codigos_de_job_usados`: o registro de todo código que um job já teve
  (gatilho `registrar_codigo_de_job`, com os 159 de hoje). O próximo
  número de job sai daqui, e não só dos jobs existentes. A troca de código
  no reenvio grava o audit `job.codigo_trocado` (de/para).
- `reaproveitar_codigo_do_job_devolvido` mantém a trava da sigla (a
  migration 800005 a tirou; a 800006 a recolocou).
- O cadastro do cliente conta orçamentos, e não projetos, para congelar o
  código curto.
