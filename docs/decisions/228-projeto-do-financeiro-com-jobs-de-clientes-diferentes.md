# 228 — O projeto do financeiro junta jobs de clientes diferentes

**Data:** 2026-10-29
**Status:** aceita e implementada (29/10/2026); revista em 30/10/2026 (§§7–11).
**Quem decidiu:** Tiago, em 29/10/2026, ao ver que jobs de um mesmo evento
não puderam ser unificados na abertura.
**Revê:** a [021](021-projeto-do-financeiro-e-edicao-da-abertura.md) (o combo
filtrado pelo cliente do job) e a
[119](119-projeto-do-financeiro-nasce-com-o-job-e-tem-nome-unico.md) §3 (a
mensagem do nome repetido).
**Migration:** nenhuma. A trava era só do código: o banco nunca exigiu que o
cliente do job fosse o do projeto.

## O que aconteceu

O campo Projeto da abertura (e do "Editar registro") listava só os projetos
do financeiro do cliente do job. O nome do projeto é único no sistema
inteiro (119). Juntas, as duas regras deixavam o financeiro sem saída
quando o job era de um parceiro de um evento:

- a busca não achava o projeto do evento, que tinha sido criado no cliente
  de outro parceiro ("Nenhum projeto do financeiro para este cliente");
- o "+" recusava o nome do evento, porque ele já existia ("Use outro
  nome");
- o servidor recusava, de qualquer forma, "projeto de outro cliente".

Resultado em 29/10/2026: os stands da Fair Culture & Business ficaram em
nove projetos, um por parceiro (o primeiro com o nome do evento e os outros
com o nome do parceiro na frente), e não aparecem numa visão agregada só.

## A regra

1. **O campo Projeto busca em todos os projetos abertos do financeiro**, de
   qualquer cliente. A lista vem em dois grupos: "Projetos abertos deste
   cliente" em cima e "Projetos abertos de outros clientes" embaixo, cada um
   na ordem de criação.
2. **Cada linha mostra os clientes que já estão no projeto**, tirados dos
   jobs dele (sem os cancelados e os reprovados): "Endemol", "Endemol e
   Sony", "Endemol, Sony e mais 7". O nome completo de todos fica no
   tooltip. A busca acha pelo nome do projeto e pelo nome desses clientes.
3. **O servidor aceita projeto de outro cliente.** Continua recusando
   projeto inativado.
4. **O "+" com um nome que já existe** diz em qual cliente ele foi criado e
   manda escolher o projeto na lista: "Já existe um projeto com este nome
   (criado no cliente X). Para incluir o job nele, escolha-o na lista do
   campo Projeto." O nome continua único (119).
5. **A visão do projeto no financeiro** (`/financeiro/projetos/[id]`) troca
   o card "Cliente" pelos clientes dos jobs do projeto ("Clientes" quando
   há mais de um), com a lista inteira no tooltip.
6. `projetos_financeiro.cliente_id` continua obrigatório e passa a ser
   lido como **o cliente de quem criou o projeto** (o do primeiro job). Ele
   não diz mais quem está dentro.

## O que fica de fora

- **A reclassificação dos jobs já abertos** é do financeiro, pelo "Editar
  registro" de cada job. Projeto que fica sem job some sozinho (gatilho
  `projeto_financeiro_sem_job_some`).
- **Ver os jobs de cada projeto na hora de escolher** está em protótipo
  ([Projetos e Jobs](https://claude.ai/artifact/6eefxVmN5sCYVDDquuZfed)):
  expandir dentro do campo, um painel com todos os projetos, ou os dois. O
  Tiago decide depois.

## Revisão de 30/10/2026: só os projetos da empresa do job, e o nome "Projeto unificado"

Pedido do Tiago no protótipo, versão 2.

7. **O campo se chama "Projeto unificado"** (rótulo, texto de fundo, aviso
   do rodapé e as linhas "Projeto unificado" do resumo e da confirmação).
8. **A lista mostra só os projetos unificados da empresa escolhida no
   job.** No topo da lista: "Só os projetos unificados de [empresa]. Para
   ver os de outra empresa, troque a empresa do job." O cliente continua
   livre (§1); a empresa, não.
9. **A empresa do projeto unificado é a dos jobs que já estão nele**, fora
   o job que está sendo aberto ou editado. A tabela `projetos_financeiro`
   não tem empresa. Projeto que só tem este job não prende a empresa.
   Em 30/10/2026 nenhum projeto tinha jobs de duas empresas.
10. **Trocar a empresa do job tira o projeto escolhido**, se ele for de
    outra empresa. O projeto novo do "+" fica: ele nasce com o job, na
    empresa do job.
11. **O servidor recusa** projeto com job de outra empresa: "Este projeto
    unificado é de outra empresa. Troque a empresa do job ou escolha outro
    projeto."
