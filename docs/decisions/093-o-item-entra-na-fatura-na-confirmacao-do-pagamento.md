# 093 — O item entra na fatura na confirmação do pagamento, não na aprovação

**Data:** 2026-09-18
**Decidido por:** Tiago
**Status:** decidida, desenhada e **implementada por inteiro em
20/09/2026** — entregas 1 (banco + baixa, §8), 2 (aba Cartão, §9) e 3
(conciliação em dois níveis + fluxo de caixa, §10), todas testadas no
navegador.
**Migrations:** `20260920100001_o_item_entra_na_fatura_na_baixa.sql`,
`20260920100002_estorno_de_compra_sem_prefixo_duplicado.sql`,
`20260920100003_fluxo_projeta_cartao_pela_fatura.sql`.

---

## 1. Como é hoje

O cartão é escolhido **antes** de qualquer pagamento, e a escolha já
amarra o item a uma fatura:

- **PP:** no diálogo de aprovar, em "Como vai ser pago". Escolhendo Cartão
  de Crédito, a aprovação chama `rotear_pp_para_cartao`, que grava
  `forma_pagamento`, `cartao_credito_id` e o plano de contas na PP e
  carimba **cada parcela ainda não paga** com `fatura_cartao_id` — a fatura
  aberta correspondente à data daquela parcela. Uma PP 30/60/90 vira três
  itens em três faturas.
- **Conta avulsa e recorrência:** na criação ou edição. O gatilho
  `avulsa_entra_na_fatura` põe a avulsa na fatura aberta do cartão e troca
  a data de pagamento dela pelo **vencimento da fatura**.

A partir daí a decisão é difícil de desfazer: `dar_baixa_pp_parcela`
recusa a parcela já roteada ("Parcela paga no cartão não se baixa sozinha:
ela espera na aba Cartão e sai na baixa da fatura inteira"), e voltar atrás
passa por reabrir fatura ou reprovar a PP.

Depois, quem marca os itens como pagos é o **fechamento** da fatura, não a
baixa: `fechar_fatura_cartao` preenche o `pago_em` das parcelas, muda o
status das avulsas, vira cada item num lançamento na conta-espelho do
cartão e faz a fatura descer como **um título único** para Títulos a Pagar,
onde a baixa tira o dinheiro do banco.

## 2. A regra nova

> **O cartão escolhido na aprovação (ou no cadastro da avulsa) é INTENÇÃO,
> não vínculo.** Ele alimenta a previsão de fluxo de caixa. O item só entra
> na fatura quando o pagamento é CONFIRMADO — e nesse momento ainda é
> possível trocar a forma de pagamento.

O porquê: em todo o resto do sistema a forma de pagamento se confirma na
hora de pagar; o cartão era a exceção. A produção diz "vai no cartão" na
aprovação, mas quem paga é o financeiro, e ele pode acabar pagando por PIX.
Hoje essa troca custa desfazer roteamento; com a regra nova, custa um
clique.

## 3. O modelo completo (fechado em 18/09/2026)

**Não há "Previsão Cartão".** Entre a aprovação e a confirmação, o item
com intenção de cartão é um título a pagar como qualquer outro, e mora em
Títulos a Pagar — que é onde a baixa acontece. Chegou-se a desenhar uma
seção "Previsão Cartão" na aba Cartão e ela foi **descartada em
19/09/2026**: seria um recorte de Títulos a Pagar por um campo que é
intenção (mudável na baixa), criando uma segunda lista para a mesma fila;
o argumento forte para prever por cartão seria limite comprometido, e
`cartoes_credito` não guarda limite; e a pergunta "quanto sai e quando" já
é do Fluxo de caixa. **A aba Cartão mostra só o que já teve baixa.**

**A aba Cartão é o extrato do cartão.** Sem cartão escolhido, uma capa —
grade de cards até cinco cartões, lista com busca de seis em diante, a
tela decide sozinha. Escolhido o cartão, a fatura **atual** por padrão,
com um cabeçalho de uma linha: seletor de cartão (com o valor da fatura em
curso de cada um), setas de competência e um calendário de faturas com o
ano dentro, para saltar direto. As anteriores — inclusive as pagas, que
hoje somem da aba — ficam acessíveis por ali. A tabela tem **as mesmas
colunas da conciliação** (Data · Crédito · Débito · Acumulado · Descrição
· Fornecedor · Job · Centro de Custo · Trimestre · Empresa), porque a
fatura É o extrato da conta-espelho: cada item é um lançamento com todos
esses campos. Botões Exportar e Fechar fatura; o fechamento segue como é
hoje, com os ajustes de IOF, anuidade e juros.

**A baixa escolhe o cartão.** No diálogo de baixa, a forma de pagamento é
confirmada; sendo cartão, escolhe-se qual. O item entra na fatura daquele
cartão pela **data do pagamento informada**: antes do dia de fechamento,
entra na fatura em curso; depois, na seguinte; se a competência daquela
data já fechou, rola para a próxima aberta (é o que
`fatura_aberta_do_cartao(cartao, data)` já faz). O botão continua se
chamando **"Dar baixa"** — a baixa é do pagamento, que de fato aconteceu —
mas nessa forma **nada sai da conta bancária**: o item vira lançamento na
conta-espelho do cartão, e o dinheiro sai depois, na baixa da fatura.

**O item fica pago na confirmação.** Quem marca o item como pago passa a
ser a baixa, não mais o fechamento da fatura (`fechar_fatura_cartao` deixa
de preencher `pago_em` das parcelas e de mexer no status das avulsas). É
mais fiel: quem recebeu foi o fornecedor, no dia em que o cartão passou.

**A conciliação abre em dois níveis.** No extrato da conta que pagou a
fatura, a linha do pagamento expande primeiro por **centro de custo** e,
dentro de cada um, nos **itens**. O total fecha com o débito da linha.

**A previsão de caixa projeta pela fatura, não pela data do título.** A
aprovação continua registrando qual cartão — é por ele que a projeção sabe
o dia de fechamento e, daí, a data em que o dinheiro sai. Uma compra de
09/11 num cartão que fecha dia 25 não sai do caixa em novembro, sai em
05/12; prever pela data do título antecipa a saída em quase um mês e
esconde justamente o efeito do cartão (empurrar e concentrar). A
`vw_fluxo_caixa` já faz isso para recorrências
(`proxima_fatura_cartao(cartao, data)`); passa a fazer para PP e avulsa.
Sem cartão marcado, o item cai na data dele — o comportamento conservador.
Nada é gravado: a data do título continua sendo a dele, e a projeção é
feita na leitura; se o financeiro trocar o cartão na baixa, a previsão
muda junto.

Cada real aparece em **um estado só** da previsão:

| estado do item | onde aparece | em que data |
|---|---|---|
| aprovado, intenção de cartão, não confirmado | título a pagar | vencimento da fatura projetada pelo cartão da intenção |
| confirmado na baixa, fatura ainda aberta | **uma linha por fatura** | vencimento daquela fatura |
| fatura fechada | título da fatura (já é assim) | vencimento |
| fatura paga | realizado | data da baixa |

O segundo estado **não existe hoje** e precisa nascer: entre a confirmação
e o fechamento o item já saiu de "a pagar" e a fatura ainda não virou
título — o valor sumiria. Um branch novo na `vw_fluxo_caixa`, "fatura de
cartão não paga", resolve, e aparece como o caixa sente: um débito só,
"Fatura Nubank · dez/26".

**Migração:** o que já está roteado fica como está (hoje, a parcela 3 da
PP-00011, na FC-00002). A regra nova vale dali para frente.

## 4. O que a implementação precisa resolver

Duas coisas que o roteamento na aprovação resolvia de graça:

**a) A data da previsão.** Hoje é o roteamento que faz a previsão cair no
vencimento da fatura (a avulsa tem a data trocada pelo gatilho; a parcela
entra na competência certa). Sem vínculo, a previsão passaria a mostrar a
data original da parcela — 09/11 em vez de 05/12, por exemplo — e ficaria
errada justamente onde o Tiago quer usá-la. A projeção tem de continuar
sendo a da fatura, calculada pelo cartão escolhido
(`proxima_fatura_cartao`, `lib/cartoes/proxima-fatura`) **sem gravar**
`fatura_cartao_id`.

**b) O gesto não se chama "baixa".** Confirmar que o item foi no cartão não
tira dinheiro do banco: ele apenas entra na fatura, e o dinheiro sai depois,
na baixa da fatura inteira. Se o mesmo botão "Dar baixa" fizer as duas
coisas, a palavra passa a significar duas coisas diferentes. A confirmação
no cartão precisa de nome próprio ("Confirmar no cartão", "Enviar para a
fatura") e **não pode** gerar lançamento na conta bancária.

O terceiro problema que eu havia levantado — o fechamento acusar diferença
enorme por causa de item não confirmado — **deixa de existir** com a
Previsão Cartão: a fatura no sistema passa a conter só o que foi
confirmado, e o fechamento é justamente onde ela é acertada contra o
extrato do banco, com os ajustes que já existem.

## 5. O que não muda

Fechamento da fatura, o título único em Títulos a Pagar, a baixa da fatura,
o estorno de compra e a conciliação seguem como estão. A mudança é só
**quando** o item passa a pertencer a uma fatura.

## 6. Fica para depois

- Um filtro por **forma prevista** ("cartão") em Títulos a Pagar, ao lado
  dos filtros de origem — o fio que resta da Previsão Cartão, sem tela
  nova. Não entra na primeira entrega.

## 7. Ponto solto encontrado no levantamento

A parcela que ficou como "decidir na baixa" **aceita hoje** cartão como
forma no diálogo de baixa, e nesse caminho gera saída direta na conta
bancária, sem passar por fatura nenhuma — o oposto do que a regra do cartão
manda. Com a decisão 093 os dois caminhos passam pelo mesmo lugar; até lá,
fica registrado que ele existe.

⚠️ **20/09/2026 — resolvido pela Entrega 1.** A baixa com forma "cartão"
passou a ser o único caminho para dentro da fatura, venha a parcela com
intenção de cartão ou como "decidir na baixa" (§8).

## 8. Entrega 1 — banco e baixa (20/09/2026)

Implementada em branch própria (`feat/cartao-confirma-na-baixa-093`),
testada de ponta a ponta no navegador e conferida no banco. A regra
organizadora que a migration segue:

> **Pertencer à fatura = ter lançamento `item`/`ajuste` na conta-espelho do
> cartão com aquele `fatura_cartao_id`.** O `fatura_cartao_id` da avulsa ou
> da parcela é só um ponteiro para esse lançamento.

### 8a. O que mudou no banco

- **`cartao_lancar_item(...)`** — helper `security definer` que resolve a
  fatura pela data (`fatura_aberta_do_cartao`) e grava o lançamento na
  conta-espelho, com `forma_pagamento = cartao_credito`, `papel_na_fatura`
  e `fatura_cartao_id`. Só as RPCs chamam; `revoke` de `public`, `anon` e
  `authenticated`.
- **`dar_baixa_pp_parcela` / `dar_baixa_avulsa_com_plano` /
  `dar_baixa_desembolso_parcela`** — com forma cartão: sem conta bancária,
  chamam o helper, marcam pago com `fatura_cartao_id`. Item legado já
  roteado (fatura setada, não pago) continua recusando a baixa própria:
  entra no fechamento, como antes.
- **`aprovar` da PP** (`actions-titulos.ts`) — deixou de chamar
  `rotear_pp_para_cartao` (agora comentada como LEGADO); grava
  `forma_pagamento`, `cartao_credito_id` e o plano de contas na PP. A
  parcela nasce sem fatura e vai para Títulos a Pagar.
- **`avulsa_entra_na_fatura`** (gatilho) — não amarra mais à fatura no
  cadastro. Continua validando fatura explícita e, quando a avulsa nasce
  sem `data_prevista_pagamento`, preenche com o vencimento projetado por
  `proxima_fatura_cartao` (antes era o roteamento que fazia isso).
- **`avulsa_estorno_lanca_no_cartao`** (gatilho AFTER INSERT, novo) — o
  estorno de compra vira lançamento de **entrada** na fatura aberta na
  hora e nasce `baixada`.
- **`fechar_fatura_cartao`** — a prevista soma lançamentos `item`/`ajuste`
  + pendentes legados; os ajustes de diferença entram pelo helper com
  papel `ajuste`; **não marca mais item como pago**. O legado pendente é
  convertido em lançamento na data da competência.
- **`reabrir_fatura_cartao`** — desfaz só os ajustes (avulsa volta a
  `aprovada` apontando para a fatura; lançamento apagado). Item confirmado
  fica.
- **`estornar_baixa_*`** — item em fatura **aberta**: apaga o lançamento,
  limpa `pago_em`/`fatura_cartao_id`, audita
  `pedido_compra.parcela_saiu_da_fatura` / `conta_avulsa.saiu_da_fatura`.
  Fatura fechada ou paga: recusa ("Reabra a fatura, ou estorne o
  pagamento dela").

### 8b. O que mudou na tela

- **Dialog de baixa** — com forma cartão esconde a conta bancária, ignora a
  data sugerida e avisa em qual fatura o item entra ("Entra na fatura de
  set/26 — fecha 25/09, vence 05/10"). Vem pré-preenchido com a forma e o
  cartão da intenção (`forma_prevista`/`cartao_previsto_id`, campos novos
  e **obrigatórios** em `TituloRow`).
- **Baixa registrada** — `viaCartao` (obrigatório em
  `BaixaRegistradaAlvo`) troca o aviso do estorno: "sai da fatura do
  cartão… sem mexer em conta bancária. Se a fatura já fechou, reabra-a
  antes". Contas a Receber manda `false`.
- Textos de **Fechar fatura**, **Reabrir fatura**, **Aprovar PP** e o
  rodapé da aba Cartão reescritos para a regra nova.
- O botão continua **"Dar baixa"** / "Confirmar baixa" (Tiago,
  19/09/2026): a baixa é do pagamento, que aconteceu; o que muda é onde o
  dinheiro sai.

### 8c. O que foi exercitado (Projeto Teste PEV-0007/26, cartão ZZ Teste Fatia 2)

| fluxo | resultado conferido no banco |
|---|---|
| Avulsa AV-00001 cadastrada com cartão | `fatura_cartao_id` nulo; aparece em Títulos a Pagar, não na aba Cartão |
| Baixa com cartão em 20/09 | FC-00003 criada (fecha 25/09, vence 05/10); lançamento `item` R$ 150 na conta-espelho; avulsa `baixada`; nenhum lançamento em conta bancária |
| Estorno dessa baixa | lançamento apagado; avulsa `aprovada`, sem fatura; volta a Títulos a Pagar; FC-00003 com 0 itens |
| Estorno de compra (R$ 50) | AV-00002 `baixada`, lançamento de **entrada** R$ 50 na FC-00003 na hora; faixa "2 itens · R$ 100,00" |
| Fechar FC-00003 com valor cobrado R$ 110 | ajuste AV-00003 (R$ 10, 11 · Despesa com Juros) `baixada` com lançamento `ajuste` na competência; soma = 110; título FC-00003 em Títulos a Pagar |
| Reabrir FC-00003 | só o ajuste desfeito (avulsa `aprovada`, lançamento apagado); AV-00001 e AV-00002 continuam pagos e na fatura; audit `ajustes_apagados: 1` |
| PP-00060 enviada e **aprovada com cartão** | PP `forma_pagamento = cartao_credito`, cartão e plano gravados; parcela **sem fatura**, em Títulos a Pagar; nada na aba Cartão |
| Baixa da parcela com cartão | dialog já veio com cartão e ZZ; parcela paga na FC-00003; lançamento `item` R$ 250 com `pedido_compra_parcela_id`; PP `pago` |
| Estorno da baixa da parcela | lançamento apagado, parcela sem `pago_em`/fatura, PP `aprovada`; audit `parcela_saiu_da_fatura` + `parcela_baixa_estornada` |

Observações que ficaram:

- O dialog de baixa de **parcela de PP** não pré-preenche o subtipo gravado
  na aprovação (o tipo vem). Comportamento anterior à 093, ligado à ordem
  de carga do Combobox; não foi mexido.
- AV-00001 ficou com `data_pagamento` nulo (criada antes do complemento do
  gatilho); a coluna Vencimento da aba mostra "—". Só esse registro.
- O toast da baixa segue "enviado para a conciliação" — vale também para o
  cartão (extrato da conta-espelho), mas pode ganhar texto próprio na
  Entrega 2.
- Depois do teste, `git`/dado: FC-00003 aberta com AV-00001, AV-00002 e o
  ajuste AV-00003 pendente; PP-00060 aprovada com intenção de cartão e em
  aberto — estado bom para exercitar as Entregas 2 e 3.

## 9. Entrega 2 — a aba Cartão (20/09/2026)

A aba deixou de ser a lista de títulos agrupada por cartão e virou o que o
desenho aprovado em 19/09 mostra (artboards "Fusao-B-C" e
"Capa-Muitos-Cartoes"): **a capa é a porta, e dentro do cartão a fatura é
o extrato.** Mesmo padrão da Conciliação (091): sem cartão na URL, a capa;
com `?tab=cartao&cartao=<id>&competencia=AAAA-MM`, a fatura daquela
competência.

### 9a. O que a tela faz

- **Capa** (`cartao-capa.tsx`): um card por cartão ativo com a fatura em
  curso — a aberta mais antiga (é a que se fecha primeiro), senão a
  fechada que espera baixa —, competência, status e "Abrir". Até cinco
  cartões, grade; de seis em diante, lista com busca e o filtro "Só com
  fatura aberta". Total em faturas abertas e "Lançar pagamento" no topo.
- **Dentro do cartão** (`cartao-fatura.tsx`): cabeçalho de uma linha —
  "‹ Cartões", seletor de cartão com a fatura em curso de cada um, setas
  de competência, calendário de faturas com o ano dentro (valor em cada
  mês que tem fatura), código e status da fatura ("aberta · fecha … ·
  vence …", "fechada · aguardando baixa", "paga em … · conta") — e, à
  direita, Lançar pagamento (já com o cartão), **Exportar** e
  Fechar/Reabrir fatura. Quatro números: compras, estornos, ajustes do
  fechamento (com o legado pendente ao lado) e total. Competência sem
  fatura abre um estado vazio, não some.
- **A tabela** (`fatura-extrato.tsx`): Data · Crédito · Débito ·
  **Acumulado** · Descrição · Fornecedor · Job · Centro de Custo ·
  Trimestre · Empresa · detalhes (o mesmo popover da conciliação) · Ação
  (estornar compra, ver a baixa registrada). O item que ainda não é
  lançamento — legado roteado antes da 093, ou ajuste de um fechamento
  reaberto — entra esmaecido, com a marca "entra no fechamento", para a
  soma da tela bater com a faixa e com o que o fechamento vai cobrar.
- **Exportar** (`/api/financeiro/cartao/faturas/[id]/export`): a mesma
  tabela em Excel, com origem, regional e a situação de cada item.
- As faturas **pagas** voltaram a ser visíveis: pelo calendário e pelas
  setas. A aba antiga as escondia assim que eram pagas.

### 9b. Como foi feito

- **Uma fonte para o extrato.** A tradução de lançamento cru para linha do
  extrato, que morava inline na página da Conciliação, saiu para
  `lib/data/lancamento-linha.ts` e passou a servir as duas telas — a
  fatura é literalmente o mesmo extrato, recortado por `fatura_cartao_id`.
  `lib/data/fatura-cartao-extrato.ts` lê os lançamentos `item`/`ajuste`
  da fatura, junta o legado pendente (avulsa `aprovada` e parcela sem
  `pago_em` que apontam para ela) e calcula acumulado e os quatro números;
  tela e exportação leem daí.
- **A aba viaja na URL.** `contas-pagar-tabs.tsx` abre na aba pedida por
  `?tab=` e, ao trocar de aba pelo clique, escreve a URL com
  `history.replaceState` (sem ida ao servidor); ao sair do Cartão,
  `cartao` e `competencia` saem junto. `lerTab` mora num módulo puro
  (`contas-pagar-tab-url.ts`): função exportada de módulo `"use client"`
  chega ao servidor como referência e quebra em tempo de execução — foi o
  primeiro erro da tela.
- **As ações continuam as mesmas.** `TituloRow` ganhou
  `fatura_cartao_id` (obrigatório) e a linha do extrato é ligada ao título
  pela origem (`avulso:<id>`, `pp:<id da parcela>`, `desembolso:<id>`);
  estornar compra, ver/estornar baixa, fechar e reabrir usam os diálogos e
  as actions que já existiam. `titulos-cartao-list.tsx` foi removido.
- `avulsa_estorno_lanca_no_cartao` deixou de prefixar "Estorno · " numa
  descrição que já vinha prefixada (migration 20260920100002); a tela
  colapsa a repetição do que já foi gravado e esconde o "Cartão · " do
  lançamento, redundante dentro da fatura.

### 9c. Conferido no navegador (20/09/2026)

| o quê | resultado |
|---|---|
| `?tab=cartao` | capa com ZZ Teste Fatia 2 · R$ 110,00 · set/26 · aberta; total em abertas R$ 110 |
| Abrir o cartão | URL ganha `cartao=`; FC-00003 aberta; KPIs 150 / 50 / 0 (+10 pendente) / 110; três linhas com acumulado 150 → 100 → 110; ajuste marcado "entra no fechamento" |
| Calendário | set 110 · nov 200, os outros vazios; clicar "nov" abre FC-00002 com a parcela legada da PP-00011 (R$ 200, pendente) |
| Seta ‹ a partir de nov | out/26 sem fatura: estado vazio, Exportar desabilitado, sem Fechar |
| "‹ Cartões" | volta à capa, URL `?tab=cartao` |
| Trocar de aba | `?tab=titulos` sem `cartao`; voltar ao Cartão → `?tab=cartao` |
| Exportar | 200, `.xlsx`, `Fatura FC-00003 - ZZ Teste Fatia 2 - 2026-09.xlsx` |
| Fechar fatura / Baixa registrada / Estornar compra / Lançar pagamento | abrem da nova tela com os dados certos (soma 110 e diferença 0; conta ZZ; já estornado R$ 50; cartão pré-selecionado) |
| Conciliação (Conta Teste) | extrato igual ao de antes da extração do mapeador |

Fica para depois: a coluna Ação em fatura **paga** mostra só a baixa
registrada (o estorno da baixa exige reabrir, e a RPC recusa com a
mensagem certa); o badge da aba continua contando o legado "a pagar".

## 10. Entrega 3 — a conciliação em dois níveis e o fluxo pela fatura (20/09/2026)

### 10a. A conciliação abre o pagamento da fatura

No extrato da conta que pagou, a linha do pagamento da fatura ganhou uma
seta: abre primeiro por **centro de custo** (tipo do plano de contas, com
o total e a quantidade de itens) e, dentro de cada um, os **itens** —
data, crédito/débito, descrição, fornecedor, job, subtipo. As linhas
seguem as colunas da linha-mãe (valor sob Débito, nome sob Descrição), e o
rodapé "Total da fatura · N itens" fecha com o débito do pagamento. Só a
perna do banco e só o pagamento vivo (o estorno é a linha reversa, e não
se expande). Os itens vêm de `carregarExtratoDaFatura` agrupados por
`agruparPorCentro` — uma leitura por fatura paga no período.

### 10b. O fluxo de caixa projeta pela fatura

Migration `20260920100003`, no padrão de troca de trechos da definição
viva da `vw_fluxo_caixa`:

- **PP e avulsa com intenção de cartão** passam a cair no vencimento da
  fatura em que a compra cai — `proxima_fatura_cartao(cartao, data)`,
  com `data_pagamento` da parcela e `data_compra` da avulsa como base —
  em vez da data do título. Nada é gravado; se a forma mudar na baixa, a
  previsão muda junto.
- **O que já pertence a uma fatura sai dos ramos de PP e avulsa** (a
  parcela e a avulsa legadas, roteadas antes da 093) — senão entrariam
  duas vezes.
- **Ramo novo `fatura_cartao`**: cada fatura aberta ou fechada vira uma
  saída prevista, classe `titulo`, no vencimento — uma linha por
  regional, rateada pelos itens (lançamentos `item`/`ajuste` + legado
  pendente). Fatura credora não entra; a paga vira o lançamento do banco.
  Rótulo "Fatura de cartão" na composição.
- **A conta-espelho sai do escopo "todas as contas"** na tela do Fluxo de
  caixa: o item confirmado no cartão já está na previsão como fatura, e o
  lançamento dele na conta-espelho não é dinheiro que saiu. Os
  lançamentos continuam na view — o fluxo do job precisa deles —; quem os
  tira do caixa é a tela, pela lista de contas de cartão que a página
  passa.

Cada real aparece num estado só, como a tabela do §3 previa: título
previsto (pela intenção) → linha da fatura (confirmado) → realizado
(baixa da fatura).

### 10c. Conferido (20/09/2026)

| o quê | resultado |
|---|---|
| View, por SQL | PP-00060 saiu de 21/09 para **05/10**; parcela 12/12 da PP-00011 (venc. 09/08/2027) para 05/09/2027; a parcela 3 legada saiu do ramo de PP e a FC-00002 apareceu em 05/12 (R$ 200); FC-00003 em 05/10 em duas regionais (100 + 10) |
| Fluxo de caixa, na tela | "Títulos em aberto (a pagar)": out/26 R$ 360 (fatura 110 + PP-00060 250), dez/26 R$ 200; a composição lista "Fatura ZZ Teste Fatia 2 · FC-00003 · 09/26 · rateada em 2 regionais" |
| Fechar FC-00003 e pagar pela Conta Teste (PIX) | fatura `paga`; saída de R$ 110 na Conta Teste e contrapartida na conta-espelho; a fatura saiu do ramo do fluxo; a aba Cartão mostra "paga em 20/09 · Conta Teste" |
| Conciliação da Conta Teste | a linha "Fatura FC-00003 · ZZ Teste Fatia 2 · 2 centros de custo" abre em "02 · Custo Operacional · 2 itens · 100,00" (150 e −50) e "11 · Despesa com Juros · 1 item · 10,00"; total 110 = débito |

Observação que ficou: o painel do navegador embutido recarrega a aba na
URL de lançamento quando o dev server compila outra rota — o que
derrubava a sessão de teste para `/home` no meio de um diálogo. Não é do
app.

## 11. Teste geral, integrado ao main (20/09/2026, à noite)

Antes do push, a branch foi rebaseada sobre o `main` do Antonio (folha
mensal do RH e a aba "Folhas de Pagamento" em Contas a Pagar — os dois
mexeram em `contas-pagar-tabs.tsx` e `page.tsx`, conflitos resolvidos
mantendo os dois lados; `"folhas"` entrou no `TabKey` do módulo puro) e o
ciclo inteiro foi refeito no código integrado, **na Empresa Teste, com um
cartão dela** ("ZZ Teste Empresa Teste", fecha 25 · vence 5, cadastrado
pela tela; conta-espelho criada junto) e a fatura paga pela Conta Teste.

| passo | resultado conferido (tela + banco + `vw_fluxo_caixa`) |
|---|---|
| Recorrência mensal (dia 25, R$ 30) com cartão | ocorrência AV-00004 nasce `aprovada`, sem fatura, em Títulos a Pagar; fluxo a projeta em **05/10** (pela fatura), e as ocorrências futuras em 05/11, 05/12… |
| Lançamento avulso (R$ 80) pela aba Cartão, cartão pré-selecionado | AV-00005 sem fatura; `data_prevista` 05/10 pelo gatilho; fluxo 05/10 |
| Desembolso DES-00001 (R$ 60) → aprovação com data 25/09 | título em Títulos a Pagar; fluxo em **25/09** — desembolso não tem intenção de cartão na aprovação (ver abaixo) |
| PP-00060 (R$ 250) aprovada com cartão ZZ Fatia 2 | título 21/09, fluxo 05/10 |
| Baixa dos quatro no cartão da Empresa Teste (na PP, o cartão foi **trocado** na baixa) | FC-00005 (set/26) nasce com 4 lançamentos `item` (80 + 30 + 60 + 250 = 420); PP e desembolso `pago`; os quatro somem do fluxo e entra "Fatura ZZ Teste Empresa Teste · FC-00005 · 09/26" em 05/10 |
| Aba Cartão | capa com os dois cartões (420 e a FC-00004 vazia do Fatia 2); FC-00005 com as quatro origens, KPIs, acumulado 80 → 110 → 170 → 420; Excel 200 |
| Estorno da baixa da ocorrência (fatura aberta) | AV-00004 volta a `aprovada` sem fatura; fatura 390; fluxo volta a projetar a ocorrência em 05/10; baixa refeita pré-preenchida |
| Fechar FC-00005 (soma 420, diferença 0) | `fechada`; título FC-00005 em Títulos a Pagar; fluxo mantém a fatura em 05/10 |
| Baixa da fatura pela Conta Teste (transferência) | `paga`; saída de R$ 420 na Conta Teste + contrapartida na conta-espelho; fatura sai do fluxo; "Já movimentado" de set/26 sobe 10.202 → 10.732 (= FC-00003 + FC-00005), sem contar a conta-espelho |
| Conciliação da Conta Teste | linha do pagamento abre em "02 · Custo Operacional · 4 itens · 420,00" com os quatro itens (avulso, recorrência, desembolso, PP com link do job) |

**O que ficou anotado:**

- **Desembolso não tem intenção de cartão.** A aprovação pede só a data;
  a baixa aceita cartão e o item entra na fatura normalmente, mas até lá
  o fluxo projeta pela data do título (25/09 aqui), não pela fatura. PP e
  avulsa têm a intenção; desembolso e recorrência-gerada seguem regras
  próprias. Incluir `forma_pagamento`/`cartao_credito_id` no desembolso é
  decisão do Tiago — não foi feito.
- **FC-00004 (out/26, ZZ Teste Fatia 2) está vazia:** foi criada por
  efeito colateral de uma consulta de verificação minha
  (`select fatura_aberta_do_cartao(...)` — a função INSERE a fatura quando
  não existe). Sem item, sem valor; apagar é decisão do Tiago (linha do
  banco). A capa do Fatia 2 mostra essa como "em curso" porque é a aberta
  mais antiga.
- No dialog de baixa, o Radix Select aceita trigger + digitar + Enter
  (funcionou para PIX e falhou para "Cartão"/"Conta Teste" com espaço); o
  Combobox do plano de contas não aceita Enter — o item se escolhe pelo
  clique. Só vale para automação de teste.
- `descricaoDaFatura` limpava "PP " antes de tirar "Cartão · " e a linha
  saía "PP PP-00060"; a ordem foi invertida, e a expansão da conciliação
  passou a limpar por origem também.
