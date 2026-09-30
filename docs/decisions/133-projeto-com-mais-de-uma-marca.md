# 133 — O projeto aceita mais de uma marca, e o job leva a marca geral do cliente

**Data:** 2026-09-30
**Decidido por:** Tiago
**Migration:** `20260930200001_projeto_marcas.sql` (tabela `projeto_marcas`
e o backfill dos 22 projetos).

---

## 1. A regra

Pedido do Tiago em 30/09/2026:

> Quero que seja possível selecionar mais de uma marca para o projeto. Além
> disso, quero que, quando esse for o caso, quando o envio dos orçamentos à
> abertura pelo financeiro for feito, a marca presente no envio sempre será
> a primeira (PRD-1) (geral) da empresa, e esse também deverá ser o que
> ficará pré-selecionado no formulário de abertura no financeiro.
>
> Só para deixar claro, quando apenas uma marca for selecionada, a marca
> selecionada continua sendo a utilizada no envio ao financeiro para a
> abertura.

Em uma tabela:

| Marcas escolhidas no projeto | Marca que o job leva ao financeiro |
|---|---|
| Uma | Ela mesma, como sempre foi. |
| Mais de uma | A marca geral do cliente (`cliente_produtos.padrao`, código `PRD-01`), **esteja ela entre as escolhidas ou não**. |

"Sempre", no pedido, é literal: num projeto da AMBEV com BEATS e CORONA, o
job vai com AMBEV · PRD-01, que não foi escolhida.

A marca geral é a que nasce com o cliente (`trg_clientes_marca_padrao`),
acompanha o nome fantasia e não pode ser inativada
(`trg_cliente_produtos_padrao`). Conferido em 30/09/2026: os 157 clientes
têm exatamente uma, ativa, e em todos o código é `PRD-01`.

## 2. Como ficou no banco

- **`projeto_marcas`** (nova) — as marcas ESCOLHIDAS no projeto. É a
  fonte-verdade da seleção, no molde de `projeto_regionais` e
  `projeto_responsaveis`: `tenant_id`, RLS por `is_tenant_member`, `GRANT`
  de select/insert/delete para `authenticated`, nada para `anon`, e a
  guarda de projeto arquivado (`projeto_vinculo_guarda_arquivado`, 118).
- **`projetos.produto_id`** (já existia) — passa a guardar **a marca que o
  job leva**: a única escolhida ou, com mais de uma, a geral. Quem escreve é
  a server action do projeto, pela função `marcaDoJob`
  (`lib/marcas-do-projeto.ts`), que o formulário também usa para o aviso.

A segunda linha é o que deixou o resto do sistema como estava:

- o **envio para abertura** (`enviarJobParaAbertura`) continua copiando o
  nome de `projetos.produto_id` para `jobs.produto`, no envio e no reenvio
  do job devolvido;
- a **abertura no financeiro** mostra a Marca como texto travado
  (`jobs.produto`) — não há campo de escolha ali. O "pré-selecionado" do
  pedido é o valor que chega: com mais de uma marca no projeto, chega a
  geral;
- a **`vw_job_rentabilidade`** lê `projetos.produto_id` como `marca_id`.
  Nos relatórios de Rentabilidade e de Faturamento, o job de um projeto com
  várias marcas aparece na marca **geral** do cliente, a mesma com que ele
  foi aberto.

### A chave primária é `id`, de propósito

`projeto_regionais` e `projeto_responsaveis` têm chave composta
(`projeto_id` + a outra). Em `projeto_marcas` ela **não pode** ser: o
PostgREST trata como muitos-para-muitos a tabela de vínculo cujas duas FKs
fazem parte da chave primária, e `projetos` já tem a FK direta `produto_id`
para `cliente_produtos`. Com dois caminhos entre as duas tabelas, todo embed
`produto:cliente_produtos(...)` a partir de `projetos` ficaria ambíguo
(HTTP 300, tela vazia em silêncio) — inclusive na versão do app que estava
no ar, antes de qualquer deploy. É o caso de `orcamentos.servico_id`
(02/09/2026, `docs/FLUXO-BANCO.md`).

Conferido antes de criar, pela API, com a chave anônima (o erro de
ambiguidade vem do planejamento, antes da permissão):

| Consulta | Resposta |
|---|---|
| `projetos?select=id,regionais(id)` (vínculo de chave composta + FK direta) | **300** `PGRST201`, dois caminhos |
| `projetos?select=id,produto:cliente_produtos(id)` depois da migration | 401 — planejou; só a permissão do `anon` barra |
| `projetos?select=id,marcas:projeto_marcas(produto_id)` | 401 — idem |

A unicidade do par fica no índice `uniq_projeto_marcas_par`. Por garantia,
os três embeds que partem de `projetos` ganharam o hint `!produto_id`.

### O que o banco não garante

Que a marca é do cliente do projeto — mesma situação de
`projetos.produto_id` desde 06/08/2026. A conferência é da server action
(`validarMarcasERegionais`): toda marca escolhida tem que ser ativa e do
cliente do projeto.

## 3. Como ficou na tela

**Formulário do projeto** (criar e editar — o mesmo `ProjetoForm`):

- o campo **Marca** virou **Marcas**, seleção múltipla com chips, igual ao
  de Regionais; a lista mostra o código ao lado do nome (`BEATS PRD-02`) e
  a busca casa pelos dois;
- o "+" ao lado continua cadastrando uma marca no cliente; a marca nova
  **soma** às já escolhidas;
- com mais de uma marca, aparece embaixo do campo: "Com mais de uma marca,
  os jobs deste projeto seguem para o financeiro com a marca geral do
  cliente: **AMBEV** `PRD-01`.";
- trocar o cliente limpa as marcas, como antes;
- pelo menos uma marca continua obrigatória.

**Lista de projetos:** a coluna Marca mostra a primeira (na ordem do
código) e um contador "+N" com as demais no `title`, como a de Regional. O
filtro de marca acha o projeto por **qualquer** uma das marcas dele.

**Cabeçalho do projeto:** "Marcas: BEATS, CORONA".

**Modal de envio do job:** o campo Marca (travado) mostra a marca que o job
leva; com várias no projeto, o apoio troca de "Cadastrada no projeto." para
"O projeto tem mais de uma marca: o job segue com a marca geral do
cliente.".

## 4. O que não mudou

- `jobs.produto` continua sendo texto copiado no envio. Mudar as marcas de
  um projeto **não** alcança os jobs já enviados (só o reenvio do job
  devolvido copia de novo), como já era com a marca única.
- O "Editar" do job segue deixando a Marca em texto livre.
- A troca de cliente (122) segue pela `trocar_cliente_do_projeto`, que
  recebe a marca do job; as marcas escolhidas são regravadas em seguida.

## 5. Marca inativada depois de gravada

O formulário só lista marcas ativas. Num campo de uma marca só, a inativa
simplesmente não aparecia e a escolha nova a substituía; num campo de
várias ela ficaria escondida no estado e reprovaria o envio sem o usuário
ter como tirá-la. Por isso o formulário deriva a seleção: só conta marca
ativa do cliente atual, e a inativa sai do projeto no próximo salvar.

## 6. Entre a migration e o deploy

A migration vale assim que é aplicada; o código, só depois da publicação —
e uma aba aberta antes fica presa à versão antiga. Projeto criado pela
versão antiga nesse intervalo nasce com `produto_id` e sem linha em
`projeto_marcas`. As leituras cobrem isso (sem vínculo, vale a marca do
projeto) e o backfill da migration pode ser rodado de novo: só preenche
quem não tem linha.

## 7. Teste

`lib/marcas-do-projeto.test.ts` (6 casos):
`node --import tsx --test lib/marcas-do-projeto.test.ts`.

No banco, em 30/09/2026: 22 linhas para 22 projetos, nenhuma divergente de
`projetos.produto_id`; RLS, policies, grants, índices e a guarda de
arquivado conferidos.

No navegador, em 30/09/2026, no projeto de teste TES-P001/26 (cliente
"Teste", cuja marca geral é "Teste · PRD-01"), sempre pelo "Editar
projeto":

| Marcas no projeto | `projetos.produto_id` | O que a tela mostrou |
|---|---|---|
| Teste + ZZ Marca 133 A (criada pelo "+") | Teste · PRD-01 | aviso com a geral; cabeçalho "Marcas: Teste, ZZ Marca 133 A" |
| ZZ Marca 133 A + ZZ Marca 133 B (a geral de fora) | Teste · PRD-01 | lista: "ZZ Marca 133 A +1"; filtro por "ZZ Marca 133 B" acha o projeto; modal de envio: Marca "Teste" e o apoio da regra |
| ZZ Marca 133 A | ZZ Marca 133 A · PRD-04 | cabeçalho "Marca: ZZ Marca 133 A"; modal de envio: "ZZ Marca 133 A", "Cadastrada no projeto." |

Com A + B no projeto, o "Orçamento de Teste" foi **enviado para abertura de
verdade**: nasceu o job TES-1017/26 com `jobs.produto = "Teste"`, e a tela
de abertura do financeiro mostrou "Marca: Teste" nos Dados da produção. O
envio foi cancelado em seguida pelo "Cancelar envio à abertura" (job
cancelado, orçamento de volta a Aprovado).

A marca inativada (§5): com Teste + ZZ Marca 133 A gravadas, as duas marcas
de teste foram inativadas no cadastro do cliente; o "Editar projeto" abriu
só com "Teste", e salvar tirou a inativa do projeto.

O projeto terminou como começou (marca Teste, uma linha em
`projeto_marcas`). Ficaram de dado de teste as marcas "ZZ Marca 133 A"
(PRD-04) e "ZZ Marca 133 B" (PRD-05) no cliente Teste, **inativas**, e o job
TES-1017/26, cancelado. A conferência final do banco: 22 projetos, 22
vínculos, nenhum sem vínculo e nenhum com a marca do job fora da regra.

Criar projeto novo não foi enviado — a regra é não abrir projeto de teste
novo. O formulário é o mesmo da edição e a gravação passa pelas mesmas
`validarMarcasERegionais` e `sincronizarVinculos`; a tela `/orcamentos/novo`
foi aberta e o campo Marcas conferido sem enviar. Antes do login, o campo
tinha sido exercitado numa rota temporária com dados fictícios (removida):
lista com os códigos, duas marcas com o aviso, remover uma, trocar de
cliente.
