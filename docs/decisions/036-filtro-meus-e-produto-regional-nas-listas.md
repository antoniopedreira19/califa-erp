# 036 — Filtro "Meus" nas listas, e Produto/Regional em Jobs

**Data:** 2026-09-01
**Decidido por:** Tiago

Design: `Listas - Filtro Meus e Colunas Produto Regional.dc.html`.

---

## 1. "Meus / Todos" abre as duas listas, com Meus como padrão

Segmentado, e não checkbox: o par explícito deixa sempre visível em qual
recorte a lista está, sem obrigar a caçar um checkbox marcado. Mesmo
componente (`components/ui/chave-meus-todos.tsx`) e mesma posição —
primeiro item da barra — em `/orcamentos` e `/jobs`.

**Meus é o estado inicial.** Quem abre a lista quer o próprio trabalho, e
"Todos" fica a um clique.

## 2. Quem é "meu"

| Tela | Regra | Hoje |
|---|---|---|
| Jobs | `jobs.responsavel_id` é o usuário | 12 de 29 |
| Projetos | o usuário é **responsável ou produtor de algum job** do projeto | 7 de 18 ativos |

A regra dos projetos foi escolhida pelo Tiago entre três candidatas, com
os números reais na mesa: vínculo em `projeto_responsaveis` (8 de 18),
criou alguma versão de orçamento (9 de 18), e a escolhida (7 de 18). Ela
amarra o recorte de Orçamentos ao **mesmo critério** da tela de Jobs — o
que o usuário vê como "meu" é a mesma ideia nas duas telas.

⚠️ **Consequência aceita:** projeto que ainda não gerou job **nunca é
"meu"**, porque ninguém foi designado nele. Quem acabou de criar um
projeto precisa de "Todos" para vê-lo.

A nota do design dizia que "meu" projeto seria *"GP ou Produtor
responsável em qualquer versão de orçamento"*. Essa regra **não existe no
banco**: `versoes_orcamento` só tem `created_by`, sem GP nem Produtor.

## 3. Produto e Regional em Jobs vêm do PRÓPRIO job

Colunas novas na lista, e dois `Select` novos na barra. A fonte é
`jobs.produto` e `jobs.regional_id` — **não** o produto/regionais do
projeto, que era o que o protótipo mostrava.

Os dois divergem na base, e não por acidente: o **JOB-0003** tem produto
"Ativação de marca" dentro de um projeto cujo produto é "Pevetech". Os 29
jobs têm os dois campos preenchidos, então o do job sempre descreve
melhor aquela linha do que o herdado do projeto.

## 4. As pílulas de status viraram um Select de seleção única

Eram cinco pílulas combináveis e ocupavam a barra inteira, sem deixar
espaço para Produto e Regional. Agora são três `Select` iguais aos que já
existiam ("Todas as empresas"), com a primeira opção limpando o filtro e
**borda vermelha no trigger** quando há filtro aplicado.

⚠️ **Perda aceita e confirmada pelo Tiago:** não dá mais para ver dois
status ao mesmo tempo (ex.: Aberto + Encerrado). A alternativa seria um
componente de múltipla seleção, descartada para manter a barra com uma
gramática só.

## 5. O que NÃO mudou

Instrução explícita do Tiago: "utilize apenas os filtros do design e as
colunas adicionais; desconsidere o resto".

- A coluna **Projeto** continua na lista de Jobs. O design a removia por
  repetir o cabeçalho do grupo; ficou.
- A barra de `/orcamentos` seguiu igual fora da chave nova — o mock do
  design mostra um filtro de "empresas" ali que **não** foi adicionado, e
  mantém o de **Ano**, que o mock não mostra.
- Nenhuma mudança de layout, cor ou tipografia das duas tabelas.
