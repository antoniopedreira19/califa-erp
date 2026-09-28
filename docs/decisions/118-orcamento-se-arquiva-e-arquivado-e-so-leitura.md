# 118 — O orçamento se arquiva, e o arquivado (orçamento ou projeto) é só leitura

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migration:** `20260928400002_arquivar_orcamento_e_arquivado_so_leitura.sql`.

---

## 1. A regra

Nas palavras do Tiago, em 28/09/2026:

> Deverá ser possível arquivar o orçamento. Desse modo, caso se torne
> irrelevante, ao ser arquivado ele não irá aparecer na visão agregada.
> Poderá aparecer apenas com um filtro (do mesmo modo que ocorre com
> projetos).

E, sobre o projeto arquivado, que até aqui não travava nada: **só leitura**.

As três respostas que fecharam o desenho:

| Pergunta | Resposta |
|---|---|
| Qual orçamento se arquiva? | **Só antes da aprovação**: rascunho ou em revisão. O aprovado precisa ter a aprovação desfeita antes; com job, nunca — a mesma régua do projeto (116). |
| Onde o arquivado aparece com o filtro? | **Só na lista "Orçamentos do projeto"**, com o filtro Ativos / Arquivados / Todos, como a lista de projetos. Na visão agregada e nas abas do projeto ele não aparece. |
| O status manual sai? | Sim, pela decisão 117: o campo Status do "Editar orçamento" saiu, e o arquivar ocupa o lugar do antigo "Cancelado". O único orçamento cancelado que existia (HIT-P001/26-02) virou arquivado. |

## 2. Arquivar não é status

O arquivamento é uma marca à parte: `orcamentos.arquivado_em` e
`arquivado_por`. O status continua o do sistema (117), e o Reativar devolve o
orçamento como estava. A exceção é o status manual antigo (enviado ao
cliente, recusado, cancelado): ninguém mais o escolhe e o orçamento ficaria
preso nele, então no Reativar ele volta como rascunho.

## 3. Onde o arquivado some

- Visão agregada.
- Abas do projeto (a faixa). Só aparece a aba do próprio orçamento, quando
  ele é o que está aberto na tela.
- Seletor do Exportar do projeto.
- Contagens: a lista de projetos e os números da home.
- Lista "Orçamentos do projeto": sai da vista padrão e aparece com o filtro
  "Arquivados", com o selo "Arquivado".

## 4. Só leitura

**Orçamento arquivado:**

- A página abre com o aviso e o botão **Reativar orçamento**.
- Ficam travados o "Editar", o "Duplicar", a nova versão, a importação, os
  parâmetros da versão e a planilha.
- Somem o "Excluir versão" e a barra de aprovação e abertura.
- O Exportar continua.

**Projeto arquivado:**

- Somem "Editar projeto", "Importar" e "Novo orçamento".
- O aviso traz o **Reativar projeto**.
- Na visão agregada, todos os orçamentos ficam em consulta e sai o "Criar
  orçamento de job".
- Na página de um orçamento dele, o aviso manda reativar o projeto primeiro.

**No banco** a mesma trava vale para a escrita de usuário, inclusive a que
passa por função `security definer`:

- **Projeto:** o arquivado só muda pelo Reativar. Arquivar confere a
  regra da 116. Os vínculos de regionais e responsáveis não mudam.
- **Orçamento:** não nasce em projeto arquivado e não se edita arquivado,
  a não ser pelo Reativar. Só se arquiva fora de `aprovado` e
  `job_criado`, sem job vivo.
- **Debaixo do orçamento:** versão, grupo, meses, item, importação, e BV e
  save da versão não mudam.

A conferência antes de aplicar rodou numa transação desfeita, contra o banco
de produção: as 10 escritas que tinham de passar passaram, e os 14 ataques
foram recusados.

## 5. Testado pela tela em 28/09/2026

- **TES-P001/26-03:**
  - arquivado pelo "Editar orçamento";
  - sumiu da vista padrão, da agregada e das abas, e apareceu no filtro
    "Arquivados (1)";
  - reativado pelo aviso;
  - depois disso, o "Salvar alterações" sem o campo Status gravou.
- **TES-P003/26:**
  - arquivado, com o aviso na página do projeto, na de um orçamento dele e
    na agregada;
  - reativado em seguida.
