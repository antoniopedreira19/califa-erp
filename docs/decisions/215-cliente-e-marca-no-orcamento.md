# 215 — Cliente e marca no orçamento, não no projeto

**Data:** 2026-10-26
**Status:** aceita e implementada em 26/10/2026.
**Quem decidiu:** Tiago — pedido em 23/10 ("jobs de clientes diferentes
dentro de um mesmo projeto"), protótipo aprovado em 26/10
(https://claude.ai/artifact/UxASwkRtQgA4GzFEinYTtQ), e três respostas em
26/10: a coluna antiga do projeto fica opcional (opção 1); a sigla do job
sai do cliente do envio e o reenvio mantém o código; a lista e o cabeçalho
do projeto mostram os clientes dos orçamentos.
**Revê:** a [122](122-cliente-do-projeto-so-muda-antes-da-aprovacao.md) (o
cliente do projeto travava na aprovação) e a
[133](133-projeto-com-mais-de-uma-marca.md) (várias marcas no projeto).
**Migrations:** `20261026800004_cliente_e_marca_no_orcamento.sql` e
`20261026800005_codigo_guardado_volta_com_cliente_trocado.sql`.

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
4. **O código do job sai da sigla do cliente escolhido no envio.** O
   reenvio mantém o código que o job já tem — também o código guardado do
   job devolvido e cancelado (decisão 128), que antes só voltava com a
   mesma sigla.
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
- `reaproveitar_codigo_do_job_devolvido` perde a trava da sigla.
- O cadastro do cliente conta orçamentos, e não projetos, para congelar o
  código curto.
