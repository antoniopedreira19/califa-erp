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
| Projetos | o usuário está **associado ao projeto ou a um orçamento dentro dele** | 12 de 18 ativos |

### A regra dos projetos

⚠️ **Ampliada pelo Tiago em 02/09/2026.** Nasceu em 01/09 como "sou
responsável ou produtor de algum job do projeto" (7 de 18) e passou a ser
**qualquer associação, como designado ou como criador**. São sete
vínculos, e basta um:

| Nível | Vínculos |
|---|---|
| Projeto | `responsavel_id`, `created_by`, `projeto_responsaveis` |
| Orçamento | `gp_responsavel_id`, `produtor_id`, `created_by` |
| Versão | `created_by` |

Só as designações dariam 10 de 18; incluir quem criou leva a 12. O Tiago
escolheu incluir: quem abriu o trabalho continua enxergando o projeto
mesmo depois de passar o GP para outra pessoa.

O vínculo por **job** (responsável/produtor) continua valendo por cima
disso. Hoje ele é redundante — medido na base, todo projeto que ele
alcança já chega por outro vínculo (a diferença deu **zero**) —, mas foi
mantido porque tirá-lo estreitaria o recorte de quem só está no job, e a
mudança era para ampliar.

**O que caiu junto:** a ressalva de que "projeto sem job nunca é meu".
Com os vínculos de projeto e orçamento valendo, um projeto recém-criado
já aparece para quem o criou, sem precisar de "Todos".

A nota do design dizia que "meu" projeto seria *"GP ou Produtor
responsável em qualquer versão de orçamento"*. Isso **não existe no
banco**: `versoes_orcamento` só tem `created_by`, sem GP nem Produtor —
esses dois moram em `orcamentos`, e é de lá que a regra os lê.

### Custo

`meusProjetoIds` sai das queries que a página **já fazia** (projetos,
orçamentos e jobs), mais duas consultas leves — `projeto_responsaveis` e
`versoes_orcamento` —, ambas **filtradas pelo próprio usuário**, então
voltam poucas linhas em vez de varrer para descartar no cliente.
`projeto_responsaveis(profile_id)` já tinha índice;
`versoes_orcamento(tenant_id, created_by)` ganhou o seu na migration
`20260902100001`.

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
- O recorte "Meus" de **Jobs** não mudou na ampliação de 02/09: continua
  sendo `jobs.responsavel_id`. A ampliação foi pedida para a lista de
  projetos, onde a associação tem mais de uma porta de entrada.
- Nenhuma mudança de layout, cor ou tipografia das duas tabelas.
