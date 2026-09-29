# 122 — O cliente do projeto só muda antes da aprovação, e os códigos acompanham

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migration:** `20260929300001_cliente_do_projeto_so_muda_antes_da_aprovacao.sql`.

---

## 1. A regra

Nas palavras do Tiago, em 29/09/2026:

> Quando um orçamento já tiver aprovado, o cliente não poderá mais ser
> modificado em editar projeto. Antes disso, isso poderá acontecer, e, nesses
> casos, os códigos do orçamento e o futuro código do projeto irão se
> adaptar ao novo cliente.

- **Depois da aprovação, o cliente trava.** Vale a partir do primeiro
  orçamento aprovado ou com job do projeto. É a mesma régua do arquivar
  (decisões 116 e 118): o job cancelado antes da abertura não conta, mas o
  orçamento dele voltou a `aprovado` e trava pela primeira contagem.
- **Antes da aprovação, trocar o cliente troca os códigos.** O projeto ganha
  o próximo código da sigla do cliente novo, e cada orçamento acompanha o
  prefixo. Se o cliente novo tem a mesma sigla do código atual, o código
  fica.

## 2. Até aqui

O "Editar projeto" gravava `cliente_id` a qualquer momento, e o código
ficava. Por isso o HITLAB tinha um projeto "NOV-0001/26" e o SEBRAE um
"NOV-0004/26". Depois da aprovação, a troca descasava o projeto do job, que
já carrega a sigla do cliente no código e a marca copiada como texto.

## 3. Onde a regra mora

| Camada | O quê |
|---|---|
| Tela | No "Editar projeto", o campo Cliente trava, com o aviso "O cliente não muda depois que um orçamento do projeto é aprovado." Antes disso, ao escolher outro cliente, aparece "Ao salvar, o projeto ganha um código novo com a sigla X, e os orçamentos acompanham." |
| Servidor | `atualizarProjeto` recusa a troca com a mesma mensagem (`projetoTemAprovacao`, a mesma função do arquivar). Sem aprovação, gera o código novo com `gerarCodigoProjeto` e chama `trocar_cliente_do_projeto` **antes** do resto da gravação: se a troca falhar, nada muda. |
| Banco | O gatilho `trg_projetos_b_guarda_cliente` recusa a mudança de `cliente_id` depois da aprovação. A função `trocar_cliente_do_projeto` troca cliente, marca e código do projeto e o prefixo de cada orçamento **numa transação só**. |
| Auditoria | `projeto.codigo_trocado` e um `orcamento.codigo_trocado` por orçamento, com o código anterior, o novo e `decisao: "122"`. |

**O orçamento arquivado acompanha também.** A guarda do arquivado aceitava
só o "Reativar". Agora aceita também a troca **só do código**
(`orcamentos_guarda_arquivado`). Sem isso, o arquivado ficaria com a sigla
velha, e um projeto novo que herdasse o número colidiria com ele no índice
único.

## 4. O código do job e o do projeto do financeiro

Os dois nascem depois da aprovação, que é quando o cliente trava. Por isso
já saem com a sigla certa:

- o código do job é gerado no envio para abertura (`gerarCodigoJob`), com a
  sigla do cliente do projeto;
- o projeto do financeiro nasce com o job (decisão 119).

Nenhum dos dois precisa se adaptar.

## 5. Testado

Todos os testes foram feitos pela tela, logado como administrador, no
servidor local do worktree, com o mesmo banco.

- **TES-P002/26, com job:** o campo Cliente aparece travado. A gravação
  chamada direto pelo console (`atualizarProjeto`) recusa. O `update` direto
  no banco, como `authenticated`, também recusa (42501, numa transação
  desfeita). O projeto não mudou.
- **TES-P003/26, dois orçamentos em rascunho, um deles arquivado para o
  teste:**
  - trocar para "Teste 22" (TET) deu **TET-P001/26**, com os orçamentos
    **TET-P001/26-01** e **-02**, o arquivado junto;
  - trocar de volta para Teste deu **TES-P003/26** de novo, com os
    orçamentos TES-P003/26-01 e -02;
  - a auditoria registrou as seis trocas;
  - o -02 foi reativado no fim, e o projeto ficou como estava.

## 6. Revisão de 29/09/2026: número de projeto nunca volta a ser usado

As duas pontas que ficaram em aberto, respondidas pelo Tiago no mesmo dia:

> Melhor garantir que não ocorrerão conflitos.

> [Sobre o "Código anterior"] Acredito que podemos apagar isso, não me
> parece ter utilidade.

**Número usado não volta.** Migration `20260929300003`:

- A tabela `codigos_de_projeto_usados` guarda todo código que um projeto
  da produção já teve. Ela só cresce.
- É alimentada por um gatilho em `projetos` (criação e troca de código).
- A carga inicial trouxe os códigos atuais, o `codigo_anterior` da decisão
  114 e os códigos da auditoria (`projeto.criado` e
  `projeto.codigo_trocado`). São 56 códigos, 15 de projetos já apagados na
  limpeza de 21/09, como o AMB-0002/26.
- O gerador (`lerBaseDoSequencial`) conta esse registro no "maior número
  da sigla". Por isso o número de um projeto que saiu da sigla, ou de um
  projeto apagado, não volta para outro projeto.

**O próprio projeto recupera o seu número.** Na troca de cliente, se o
projeto já teve um código daquela sigla e ano, ele volta a usá-lo
(`codigoQueOProjetoJaTeve`). O número é dele, não de outro, então ida e
volta não gasta número.

Testado como GP, pela tela, no TES-P003/26:

- a ida para o Teste 22 recuperou o **TET-P001/26** do teste anterior;
- com o projeto fora da sigla, o gerador real deu **TES-P004/26** para o
  próximo projeto do Teste. Antes desta revisão, daria o TES-P003/26 que
  tinha ficado livre;
- a volta recuperou o **TES-P003/26**.

**O "Código anterior" saiu dos cabeçalhos de projeto**, na produção e no
financeiro (revisão da decisão 114, item 6). O dado continua em
`codigo_anterior` e na busca. O "Código anterior" da ficha do job
(`JOB-NNNN`) ficou.
