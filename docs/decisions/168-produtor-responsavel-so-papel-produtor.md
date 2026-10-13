# 168 — Produtor Responsável só lista quem tem o papel Produtor, e GP e Produtor aceitam digitação

**Data:** 2026-10-13
**Status:** aceita e implementada em 13/10/2026.
**Quem decidiu:** Tiago, em 13/10/2026, sobre a tela "Novo orçamento" do TES-P002/26.
**Migration:** `20261013600001_produtores_ativos_do_tenant.sql` — função nova, aditiva.

## O pedido

"Quero que esse campo seja digitável, para que seja possível achar os nomes
procurados com facilidade, assim como o de clientes é. Além disso, acredito
que haja algum erro e ele não esteja mostrando apenas os cadastros de
produtor como disponíveis."

## O que estava acontecendo

Não era erro de filtro: o campo listava **todos os membros ativos** do
tenant (`membros_ativos_do_tenant`), de propósito, desde quando o produtor
ainda não era papel próprio. Em 13/10/2026 eram 97 pessoas: 31 Produtores,
48 GPs, 7 Administradores, 5 Freelancers, 4 do Financeiro e 2 do RH.

Quem estava gravado como produtor em orçamento real sem ter o papel: 1
freelancer (9 orçamentos), 1 administradora (12 orçamentos da AMBEV) e 7 GPs
(20 orçamentos).

## A regra

1. **A lista do Produtor Responsável só tem quem tem o papel Produtor**
   (`tenant_members.role = 'produtor'`, membro e perfil ativos). Vale para o
   "Novo orçamento", o editor do orçamento, o "Criar orçamento de job" da
   visão agregada e o "Enviar job para abertura". Opções que o Tiago não
   escolheu: Produtor + Freelancer (36 pessoas) e Produtor + Freelancer + GP
   (84).
2. **Quem já está gravado fica.** Na edição e no envio para abertura, o
   produtor gravado entra na lista mesmo sem o papel, para o campo não abrir
   vazio. O orçamento antigo salva sem trocar ninguém.
3. **O servidor confere o papel quando o produtor muda** — na criação, na
   edição e no envio para abertura. Produtor igual ao gravado passa sem
   conferência. A recusa diz: "O produtor escolhido não tem o papel
   Produtor. Selecione outro."
4. **GP Responsável e Produtor Responsável viram campo com busca** (o
   `Combobox` do campo de cliente do projeto): digitar filtra a lista,
   ignorando acento e maiúsculas. A lista nunca fica mais estreita que
   280px, para os nomes longos não cortarem no editor lateral. A lista do
   GP continua sendo a dos responsáveis do projeto.

## Onde mora

- `produtores_ativos_do_tenant(p_tenant_id)` — id e nome, só para quem é
  membro ativo do tenant. Mesma régua da `membros_ativos_do_tenant`: o papel
  dos outros continua fechado em `tenant_members`.
- `listarProdutoresAtivos` em `lib/data/members.ts`.
- `assertProdutor` em `app/(app)/orcamentos/[projetoId]/actions.ts`
  (criação e edição) e a conferência em `abertura-actions.ts` (envio).

## Fica de fora

- O job aberto não tem edição de produtor; o detalhe do job só mostra o
  nome gravado.
- A Equipe do projeto e a responsável da verba continuam com todos os
  membros ativos.
