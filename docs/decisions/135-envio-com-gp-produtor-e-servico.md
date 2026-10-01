# 135 — Envio para abertura: GP e produtor editáveis, Serviço no formulário e só o código do job

**Data:** 2026-09-30
**Decidido por:** Tiago
**Status:** aceita — entregue em 30/09/2026
**Migration:** nenhuma (as colunas já existiam; nenhuma policy ou trigger
de `orcamentos` ou `jobs` olha GP ou produtor)

---

## 1. O pedido

Três pedidos do Tiago no mesmo dia, sobre o formulário "Enviar job para
abertura" (módulo Orçamento) e as telas que conferem o que ele mandou:

1. **Só o código do job na conferência.** A linha "Projeto" dos pop-ups de
   conferência mostrava "nome · código do projeto". Ficou só o nome, nos
   dois módulos. Os pop-ups saíram antes, no `cc10bd3a`; esta decisão leva
   a mesma regra ao formulário de envio e ao painel "Dados da produção"
   da tela de abertura do financeiro.
2. **Campos reorganizados, com o Serviço.** O desenho foi aprovado por
   protótipo, com uma troca pedida na revisão: Regional e Categoria
   trocaram de lugar.
3. **GP e produtor destravados.** *"Pode desbloquear os campos GP
   Responsável e Produtor Responsável."*

## 2. O formulário

As quatro primeiras linhas ficam sempre cheias:

| Linha | Coluna 1 | Coluna 2 | Coluna 3 |
|---|---|---|---|
| 1 | Projeto | Código do job | Cliente |
| 2 | Nome do Job (duas colunas) | ← | Marca |
| 3 | Serviço | Categoria | GP Responsável |
| 4 | Regional | Cidade | Produtor Responsável |

- **"Código do projeto" saiu.** O único código do formulário é o do job.
- **Serviço é novo e travado.** Vem de `orcamentos.servico_id`, com
  "Cadastrado no orçamento." embaixo, como a Categoria.
- **GP e produtor viraram listas obrigatórias**, com as mesmas opções do
  formulário do orçamento: o GP sai dos responsáveis do projeto
  (`projeto_responsaveis`), o produtor sai dos usuários ativos
  (`membros_ativos_do_tenant`). Os dois chegam preenchidos com o que está
  no orçamento.
- Datas, recebimento, contato de cobrança, fechamento e descritivo não
  mudaram.

## 3. Onde a troca grava

GP e produtor seguem a regra que já valia para nome, cidade, regional e
datas: **o valor escolhido vai para o job e também para o orçamento**
(`orcamentos.gp_responsavel_id` e `produtor_id`). Orçamento e job nunca
divergem nesses campos. O texto do topo do formulário diz isso.

O servidor (`enviarJobParaAbertura`) confere a troca:

- **GP trocado** precisa ser um dos responsáveis do projeto — a mesma
  regra do formulário do orçamento (`assertRegionalEGpDoProjeto`).
- **Produtor trocado** precisa estar entre os usuários ativos.
- **O que já está no orçamento passa sem conferência.** Até aqui o envio
  copiava GP e produtor sem olhar; um GP que saiu da equipe do projeto
  depois não pode travar um envio que ninguém mexeu. Pelo mesmo motivo a
  página põe essa pessoa na lista, mesmo fora dela
  (`comQuemEstaNoOrcamento`), para o campo não abrir em branco.

A trava "Complete o cadastro antes de abrir o job: GP responsável (no
orçamento)" deixou de existir: GP e produtor vazios agora são campo
obrigatório do formulário. A marca continua herdada do projeto e
continua travando o envio quando falta.

A auditoria (`job.enviado_para_abertura` e `job.reenviado_para_aprovacao`)
passou a registrar `gp_responsavel_id` e `produtor_id`.

## 4. Conferência

- O pop-up de confirmação e o "Ver dados do job" mostram, antes do envio,
  o GP e o produtor escolhidos no formulário; depois dele, os que o job
  gravou (`jobs.responsavel_id` e `produtor_id`).
- O painel "Dados da produção" (financeiro) mostra o projeto só pelo nome.

## 5. Consequências

- ~~**GP que troca o GP perde a edição do job.**~~ Não vale mais desde a
  decisão 136 (01/10/2026): qualquer GP mexe em qualquer job, e quem fez
  cada envio fica registrado. Até ali, para quem não era administrador,
  mexer no job exigia ser o `responsavel_id` dele (`quemPodeMexer`).
- **Cancelar o envio não desfaz a troca no orçamento**, como já acontecia
  com nome, cidade, regional e datas.

## 6. Como foi testado (30/09/2026)

- Formulário aberto no "Orçamento de Teste" (TES-P001/26), em 1838×1040:
  ordem das linhas, GP com os três responsáveis do projeto, produtor com
  os 87 usuários ativos, os dois preenchidos com os do orçamento.
- Travas chamadas pelo console, sem gravar nada: GP de fora do projeto,
  produtor inexistente e GP vazio recusados com mensagem no campo.
- Envio real trocando o produtor para "Produtor Teste": job TES-1018/26
  gravado com ele, orçamento atualizado, auditoria com os dois ids, "Ver
  dados do job" e painel do financeiro mostrando o produtor novo e o
  projeto só pelo nome. Envio cancelado em seguida pela tela.
- **Ficou de dado de teste:** o "Orçamento de Teste" segue com "Produtor
  Teste" como produtor, e o código TES-1018/26 ficou queimado.
- Como GP, só pelo código: as duas consultas novas são as que o GP já faz
  no editor do orçamento.

## 7. Arquivos

- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/enviar-job-modal.tsx`
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/fluxo-abertura.tsx`
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts`
- `app/(app)/orcamentos/[projetoId]/[orcId]/page.tsx`
- `app/(app)/financeiro/abertura-de-job/[jobId]/abertura-form.tsx`
- `lib/validations/abertura-job.ts`
