# 174 — O job não se edita depois da abertura, o botão "Equipe" e o Produtor Responsável que envia PP com a chave do GP

**Data:** 2026-10-14
**Status:** aceita e implementada (14/10/2026).
**Quem decidiu:** Tiago, em 13 e 14/10/2026, sobre o protótipo "Equipe do
job" (versão 2; a versão 1, com o "Editar" centralizado e a escolha de quem
GERA PP, foi recusada).
**Revisa:** a [136](136-qualquer-gp-age-e-o-autor-fica-registrado.md) (enviar PP é do GP) e
o "Editar" do job (decisão 020 e o editor da página do job).
**Completa:** a [170](170-gp-so-quem-pode-ser-gp.md) — o editor do job que
ela deixava para depois saiu.
**Migrations:** `20261014300001_produtor_envia_pp_com_a_chave.sql` e
`20261014300002_membros_ativos_com_papel.sql`.

## O pedido

Editar a equipe de um job aberto e a de um projeto, e deixar o GP escolher
produtores para enviar PPs. Na revisão do protótipo, o Tiago fechou assim:

> As informações do job não poderão ser modificadas depois da abertura,
> acho que não faz sentido a opção "editar" existir. O Produtor e GP
> responsáveis sempre farão parte da equipe automaticamente. […] um botão
> chamado equipe […] (tanto GPs quanto Produtores poderão editar), nesse
> card/pop up deve ser possível apenas para o GP (ou administrador) marcar
> apenas o produtor responsável com um seletor que o permitirá enviar PPs
> ao financeiro, e fará com que a sua tela seja igual a do GP para fazer
> isso.

E confirmou as três perguntas do fim: a chave vale **por job**; ela libera
**tudo o que o GP faz com PP** (enviar, reenviar a rejeitada, cancelar a que
está no financeiro e corrigir a NF em avaliação); e o "Editar" sai **para
todos**, inclusive o administrador.

## A regra

1. **Sem "Editar" no job.** O botão e a action `atualizarJob` saíram. Antes
   da abertura, nome, GP, produtor, cidade, regional e datas se revisam no
   envio para abertura, na tela do orçamento (057); depois, o job não muda —
   o que muda é pela errata e pelo financeiro.
2. **Botão "Equipe"** no cabeçalho do job (no lugar do "Editar") e ao lado
   do nome do projeto na visão agregada, com os rostos dos membros.
3. **Quem está na Equipe** — a mesma Equipe do projeto
   (`projeto_responsaveis`), com os automáticos derivados na leitura:
   - quem criou o projeto, os GPs Responsáveis do projeto e os produtores
     dos orçamentos (como desde a 037);
   - **o GP e o Produtor Responsáveis de cada job vivo** (novo).

   GPs e produtores (e o administrador) põem e tiram os acréscimos
   (`projetos.editar_equipe`). Quem entrou sozinho tem cadeado. O freelancer
   e o financeiro só veem.
4. **A chave "Envia PPs ao financeiro"** fica no Produtor Responsável de cada
   job, e só o GP ou o administrador a muda (`jobs.liberar_envio_pp_produtor`
   e a função `definir_envio_de_pp_do_produtor`). Ligada, o produtor tem a
   tela do GP para a PP daquele job: enviar, reenviar a rejeitada, cancelar
   a que está no financeiro e corrigir a NF em avaliação. Faturamento,
   errata e encerramento continuam só do GP. Gerar PP continua como hoje.
5. **A chave é da pessoa, não do lugar:** trocar o Produtor Responsável
   desliga a chave (gatilho). Fora da função, ela não muda (o mesmo
   gatilho barra a escrita direta).
6. **Job encerrado ou finalizado:** a chave fica como está (não sai mais
   PP dele). A tela a mostra travada e o servidor recusa a mudança.

## O pop-up

- **No job:** "Responsáveis pelo job" em destaque — o GP com "Envia PPs ao
  financeiro · Sempre" e o Produtor com a chave — e a "Equipe do projeto"
  agrupada em GPs, Produtores e Freelancers (e "Outros", se houver alguém
  de outro papel), com "Adicionar pessoa".
- **Na visão agregada:** a tabela "Responsáveis pelos jobs" (job, GP,
  Produtor e a chave de cada um) e a Equipe inteira.
- Um "Salvar" grava as duas coisas; cada uma passa pelo seu portão só se
  mudou (um produtor que salva a equipe sem mexer na chave não é barrado).

## Onde mora

- Banco: `jobs.produtor_envia_pp` (+ `_por`, `_em`), `produtor_envia_pp_do_job`,
  `definir_envio_de_pp_do_produtor`, o gatilho `jobs_guarda_envio_do_produtor`
  e `corrigir_notas_fiscais_da_pp` aceitando o produtor com a chave.
  `membros_ativos_com_papel` dá o papel de cada membro para agrupar (o que a
  168 e a 170 já mostravam em listas separadas).
- `enviaPPNoJob` e `corrigeNfNoJob` em `lib/permissoes.ts`; os portões em
  `actions-pp.ts` (`barrarEnvioPeloPapel`, cancelar) e em
  `actions-notas-da-pp.ts`; a tela em `carregar-detalhe.ts`
  (`papelEnviaPP`, `podeEnviarPP`, `papelCorrigeNf`).
- `lib/data/equipe-do-projeto.ts`, `app/(app)/jobs/_equipe/` (pop-up e
  `salvarEquipeDoProjeto`).
- O "Editar projeto" de Orçamentos trava também os responsáveis dos jobs na
  Equipe, para os dois lugares mostrarem a mesma coisa.
- Auditoria: `projeto.equipe_alterada`, `job.envio_de_pp_do_produtor_ligado`
  e `job.envio_de_pp_do_produtor_desligado`.

## Conferido no navegador (14/10/2026)

No TES-1023/26 (Produtor Responsável: "Produtor Teste"), logado como
administrador: o job sem "Editar" e com o botão "Equipe"; a chave ligada e
salva (auditoria `job.envio_de_pp_do_produtor_ligado`); o "GP Teste" posto e
tirado da equipe (dois `projeto.equipe_alterada`); na visão agregada, a
tabela dos 12 jobs com a chave do TES-1023/26 ligada e as dos finalizados
(TES-1009 e TES-1027) travadas, e a chave desligada de novo — nenhuma ficou
ligada. O "Editar projeto" de Orçamentos mostra a mesma equipe. A tela do
produtor com a chave foi conferida só pelo banco (simulando o login dele, em
transação desfeita): ele não liga a própria chave, não escreve a coluna
direto, e com a chave ligada pelo administrador passa a enviar.

## Números de 14/10/2026 (fora do projeto de teste)

32 produtores ativos; 31 PPs geradas por produtor, 22 do produtor do próprio
job. Nenhuma chave ligada: todo job começa com o produtor sem enviar, como
era.

## Fica de fora

- A errata pelo produtor (o Tiago citou "mais para frente"): a chave é só da
  PP.
- O filtro "Meus" da home (`lib/home/escopo-meus.ts`) continua olhando
  orçamentos, Equipe e criador — não os responsáveis dos jobs.

## ⚠️ Nota de 2026-10-15 — os responsáveis se trocam pela Equipe (decisão 176)

- O job continua sem "Editar", mas o GP e o Produtor Responsáveis de job
  aberto agora se trocam no próprio pop-up "Equipe" ("Trocar"), pelo GP ou
  pelo administrador, sem errata e sem o financeiro — ver a
  [176](176-trocar-gp-e-produtor-do-job-aberto.md). A troca do produtor
  desliga a chave pelo mesmo gatilho desta decisão, e o "Salvar" compara a
  chave pedida com o estado depois da troca.
