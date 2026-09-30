# 131 — Serviço Mídia, com Mídia On e Mídia Off, e a categoria "em breve"

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migrations:** `20260929996001_servico_midia_e_categoria_em_breve.sql`
(coluna `em_breve`, as três linhas inativas e as travas) e
`20260929996002_ativa_servico_midia.sql` (ativa as três, junto com o
código).

---

## 1. A regra

Pedido do Tiago em 29/09/2026:

> Quero que um novo tipo de serviço seja adicionado, chamado "Mídia". Esse
> serviço deverá ter duas categorias disponiveis: "Mídia On" e "Mídia Off".
> A categoria mídia on, abrirá uma planilha nacional de ativação normal. Já
> no caso de midia off, um novo modelo de planilha será criado para isso em
> breve. Por hora essa opção deve aparecer, mas deverá ser bloqueada, e não
> podera ser selecionada.

O design foi aprovado no mesmo dia (protótipo com os componentes reais,
artifact "Serviço Mídia"), com estas respostas:

| Pergunta | Resposta |
|---|---|
| Mídia On e Mídia Off só no serviço Mídia? | Sim. Não aparecem em Always On, Fee nem em nenhum outro. |
| Ao escolher Mídia, a Categoria começa... | Em branco (A): quem cria escolhe Mídia On. |
| O Interno aceita Mídia On? | Não. |
| A abertura do financeiro troca a categoria só pelo modelo de planilha, sem olhar o serviço. Travar? | Não: manter como está. |

## 2. Como ficou

**Formulário do orçamento** (criar, editar, e o "Novo orçamento de job" da
agregada — o mesmo `OrcamentoForm`):

- o Serviço ganha **Mídia**;
- com Mídia escolhido, a Categoria mostra só **Mídia On** e **Mídia Off** e
  começa em branco;
- **Mídia Off** fica no fim da lista, acinzentada, com cadeado e o selo
  "Em breve". É `disabled` no Select: o mouse, o teclado e a busca por
  letra não a alcançam;
- abaixo do campo: "Mídia Off ainda não pode ser escolhida: a planilha
  própria está em construção.";
- Mídia On abre a planilha **nacional**, igual à da Ativação.

**Cadastro de Categorias:** Mídia aparece na aba de serviços; Mídia On é uma
linha comum (renomeável); Mídia Off tem o status âmbar **"Em breve"**, a
linha travada e o subtítulo "Planilha própria em construção · liberada
quando ela ficar pronta". Ativar e desativar seguem livres.

**Abertura e revisão no financeiro:** o combo "Categoria do job" continua
oferecendo as categorias do mesmo modelo de planilha do orçamento (resposta
4). Mídia On entra entre as nacionais; Mídia Off aparece no fim, travada,
com o mesmo selo.

**Agregada:** antes, saía da lista todo serviço que tivesse categoria
exclusiva, porque o editor dela não conhece meses (078). Agora sai só o que
é de planilha **mensal** (Fee e Always On, como antes). Mídia, que é
nacional, pode ser criado por lá, com as mesmas duas categorias.

## 3. "Em breve" é um campo, não o nome

`categorias_dominio.em_breve` (boolean, padrão `false`). A exclusividade é o
mecanismo da 078: as duas categorias têm `servico_exclusivo_id` = serviço
Mídia, e nenhuma é `aceita_servico_interno`.

Mídia Off nasce com `modelo_planilha = 'nacional'` só porque o enum precisa
de um valor. **Quando o modelo dela ficar pronto**, uma migration: (1) cria
o valor novo no enum (sozinho, numa migration própria), (2) troca o
`modelo_planilha` da Mídia Off e desliga o `em_breve`, no mesmo passo.

## 4. Travas

A mesma regra em três pontas:

1. **Tela:** o item é `disabled` (formulário do orçamento e abertura).
2. **Servidor:** `erroDoParServicoCategoria` (`lib/categorias-do-servico.ts`)
   recusa categoria em breve com qualquer serviço — é a função que
   `criarOrcamento` e `atualizarOrcamento` usam. `conferirCategoriaDoJob`
   (abertura e revisão) recusa também. No cadastro,
   `bloqueioDeModeloProprio` recusa editar a categoria em breve.
3. **Banco:**
   - `orcamento_servico_e_categoria_coerentes` recusa a categoria em breve
     quando o orçamento nasce com ela ou passa a usá-la (vale para a
     agregada, que grava em lote sem conferir o par);
   - `categoria_vinculo_e_em_breve_travados` (novo): o vínculo com um
     serviço e a marca em breve só mudam por migration, e a categoria em
     breve não se renomeia nem muda de escopo pela tela. A trava da 072
     (`categoria_modelo_proprio_travado`) só cobria o vínculo das
     categorias de planilha própria; Mídia On e Mídia Off são nacionais.

Conferido em 29/09/2026 numa simulação desfeita no fim (14 casos): Mídia +
Mídia On passa; Mídia + Mídia Off, Mídia + Evento, Ativação + Mídia On,
Interno + Mídia On e Interno + Mídia Off são recusados; como
`authenticated`, renomear a Mídia Off, desvincular a Mídia On, marcar
Evento como em breve e inserir categoria em breve são recusados, e ativar a
Mídia Off e renomear a Mídia On passam.

## 5. O que o protótipo pegou

No editar, Mídia → Ativação → Mídia deixava a Categoria vazia em vez de
voltar para Mídia On. As duas listas não se cruzam, e o Radix recebia os
itens novos e o valor no mesmo render (a armadilha de
`radix-select-valor-antes-da-option`). O Select da Categoria agora remonta
por serviço (`key={servicoId}`). Antes do Mídia, nenhum par de serviços
tinha listas disjuntas nesse Select, por isso nunca apareceu.

## 6. Teste

`lib/categorias-do-servico.test.ts` (6 casos):
`node --import tsx --test lib/categorias-do-servico.test.ts`.

No navegador, em 29/09/2026, no projeto de teste TES-P001/26: novo
orçamento (listas de todos os serviços), criação do **"Teste Mídia On
131"** (fica como dado de teste: v1 em rascunho, planilha nacional),
editar com a volta Mídia → Ativação → Mídia, cadastro de Categorias,
"Novo orçamento de job" da agregada (sem salvar) e o combo da abertura do
TES-1012/26 (sem enviar).
