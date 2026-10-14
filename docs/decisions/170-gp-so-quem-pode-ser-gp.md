# 170 — GP só quem pode ser GP: lista do projeto, lista do orçamento e trava no envio para abertura

**Data:** 2026-10-13
**Status:** aceita em 13/10/2026 e implementada em 14/10/2026.
**Quem decidiu:** Tiago, em 13/10/2026, depois do mapa de GP e produtor fora do papel nos jobs abertos.
**Completa:** a [168](168-produtor-responsavel-so-papel-produtor.md), que fez o mesmo com o Produtor Responsável.
**Migration:** `20261013900003_gps_ativos_e_gps_do_projeto.sql` — duas funções novas, aditiva.

## O que estava acontecendo

O mapa de 13/10/2026 achou dois caminhos para alguém sem o papel GP virar
GP de orçamento e de job:

1. **O campo "GPs Responsáveis" do projeto listava todos os membros
   ativos.** Três produtores estavam cadastrados como GP Responsável de
   projeto, e um deles virou GP de um job aberto (corrigido pelo MCP,
   migrations `20261013900001` e `20261013900002`).
2. **A lista de GP do orçamento lia `projeto_responsaveis` inteira**, sem
   separar o GP (`papel = 'gp'`) dos acréscimos à Equipe (`papel =
   'equipe'`, que dividem a tabela desde 02/09/2026). Os 34 acréscimos à
   Equipe — 30 produtores e 4 freelancers, em 23 projetos — apareciam como
   opção de GP no Novo orçamento, no editor, na agregada e no envio para
   abertura, e o servidor aceitava. Ninguém tinha escolhido um deles ainda.

## A regra

1. **Pode ser GP quem é membro ativo com o papel GP ou Administrador.**
   Administrador entra por decisão do Tiago: nos dados reais nenhum
   projeto ou orçamento tem administrador como GP, e os testes no
   TES-P001/26 usam o administrador como GP. Opção que o Tiago não
   escolheu: só o papel GP.
2. **"GPs Responsáveis" do projeto só oferece quem pode ser GP** (55
   pessoas em 13/10/2026: 48 GPs e 7 administradores). A Equipe continua com
   todos os membros ativos. Quem já estava gravado como GP do projeto sem
   poder continua na lista daquele projeto, para quem edita poder tirá-lo;
   tirado e salvo, não volta. O servidor recusa quem é acrescentado sem
   poder: "Fulano não pode ser GP Responsável: no cadastro de usuários, não
   está ativo com o papel GP."
3. **"GP Responsável" do orçamento só oferece os GPs Responsáveis do
   projeto que podem ser GP** — sem a Equipe. Vale no Novo orçamento, no
   editor, na agregada e no envio para abertura. Ao criar e ao salvar o
   orçamento, o servidor confere a mesma lista.
4. **Trava no envio para abertura:** se o GP do orçamento não pode ser GP,
   o envio para, mesmo sem ninguém ter mexido no campo, com a mensagem
   "Fulano não pode ser o GP do job: no cadastro de usuários, não está ativo
   com o papel GP. Escolha outro GP Responsável do projeto para enviar." A
   lista do projeto continua só sendo conferida quando o GP muda (decisão
   135): um GP que saiu do projeto depois não trava um envio que ninguém
   mexeu.
5. **O produtor não entra na trava do envio** (escolha do Tiago). Ele segue a
   168: a lista só tem o papel Produtor, e o servidor confere quando o
   produtor muda. Fica em aberto se o GP pode ser o produtor do próprio job
   (10 orçamentos reais ainda em aberto e 12 jobs abertos estão assim).

Em 14/10/2026 nenhum orçamento real que ainda vai passar pelo envio trava:
os 30 têm GP com o papel GP.

## Onde mora

- `gps_ativos_do_tenant(p_tenant_id)` e `gps_do_projeto(p_projeto_id)` —
  id e nome, só para quem é membro ativo do tenant.
- `listarGpsAtivos` e `listarGpsDoProjeto` em `lib/data/members.ts`.
- `conferirGpsResponsaveis` em `app/(app)/orcamentos/actions.ts` (criar e
  editar projeto); `assertRegionalEGpDoProjeto` em
  `app/(app)/orcamentos/[projetoId]/actions.ts` (criar e editar orçamento);
  a trava em `abertura-actions.ts` (envio para abertura).

## Fica de fora

- Os GPs Responsáveis sem o papel que continuam gravados num projeto (2 no
  DEE-P001/26 em 14/10/2026) não são removidos: saem quando alguém editar o
  projeto e tirá-los. Enquanto isso, não aparecem como opção de GP no
  orçamento.
- O editor do job ("Responsável") também lista todos os membros. A mesma
  regra vale para ele — os GPs Responsáveis do projeto que podem ser GP,
  mais o gravado, com a conferência no servidor quando muda —, em commit
  próprio, depois da conferência no navegador.
