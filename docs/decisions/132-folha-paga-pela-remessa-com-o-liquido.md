# 132 — A folha paga pela remessa com o líquido, sem mexer no salário do cadastro

**Data:** 2026-09-30
**Decidido por:** Tiago
**Escopo:** folha mensal (aprovação no financeiro) e remessa Santander
**Migrations:** `20260930100001_pagamento_do_colaborador_para_o_financeiro.sql`
(estrutura) e `20260930100005_financeiro_acessa_todas_as_empresas.sql` (§8).
As cargas de dado de setembro — 100002, 100003 e 100004 — ficam fora do
repositório (§9).

Revoga a D5 da [097](097-folha-mensal-em-duas-camadas.md) (aprovar propaga o
valor para o salário do cadastro) e muda a geração de títulos da mesma
decisão (um título por alocação).

---

## 1. O pedido

A folha de setembro vai ser paga pelo arquivo de remessa do Santander, em vez
de um lançamento por vez no banco. O módulo de RH ainda não calcula retenção
nem líquido, então, só desta vez, o valor de cada linha é o **líquido** da
planilha da folha (bruto do mês menos benefícios e descontos). Nas próximas
semanas o RH volta a trabalhar com o bruto e a base de cálculo.

Os 11 PJs com ISS retido entram com o líquido antes do ISS; o financeiro
digita o valor final na aprovação.

## 2. As regras

| Pergunta | Resposta |
|---|---|
| Onde fica o líquido? | **Só na linha da folha do mês.** O salário do cadastro continua bruto; não há nada para desfazer em outubro. |
| Aprovar muda o salário do cadastro? | **Não, nunca** (revoga a D5 da 097). O valor da folha é o que se paga no mês — líquido, proporcional, com ISS descontado —, e salário é do RH, na tela do colaborador. |
| O financeiro pode mudar o valor na aprovação? | Sim, como já podia. O botão mostra o valor ("Aprovar R$ 5.248,48") e, se ele mudou, o painel mostra o que o RH enviou. |
| Rateio entre regionais | **Um título por pessoa, um PIX**, com o rateio de regional dentro do título (como o lançamento avulso). Antes eram 2 ou 4 títulos, um por regional. Com alocação em mais de uma empresa, sai um título por empresa. |
| Dado de pagamento | O cadastro pede **chave PIX ou conta** (uma basta). A remessa paga por PIX sempre que houver chave; TED só para quem não tem PIX. |
| Quem informa o pagamento que falta? | O financeiro, no painel de aprovação (seção "Pagamento"). Grava no cadastro do colaborador, com registro em `audit_events`. |
| Corrigir depois de aprovado | **"Devolver para a aprovação"**, no título da folha: apaga o título e reabre a linha em "Aguardando aprovação". Vale enquanto não houver baixa e o título não estiver num arquivo de remessa ativo. Editar o valor direto no título deixaria a folha dizendo um valor e o título outro. |
| CLT e estágio | Vão para a aba com o salário do cadastro e esperam o líquido da contabilidade; o selo âmbar e o filtro de contratação separam das linhas de PJ. |
| CLT + Recibo | Uma linha por pessoa por mês (índice único). Nesta folha a linha leva **só o Recibo**, pago agora; a parte CLT fica para quando vier o valor da contabilidade. |
| Remessa só da folha | O diálogo da remessa ganhou filtro por origem; "Marcar todos" marca só o que está visível e tem dado de pagamento. |

## 3. O que mudou no código

- `aprovarLinhaFolha` (`actions-folhas.ts`): compara valor e alocação como
  número — a comparação de texto (`"12000"` × `"12000.00"`) via edição onde
  não houve e reabria o salário do cadastro a cada aprovação; não propaga mais
  nada para `colaboradores_salarios`; cria um título por empresa com o rateio
  de regional pela RPC `criar_conta_avulsa`; aceita o pagamento do
  colaborador junto.
- `salvarPagamentoDaFolha` e `devolverFolhaParaAprovacao`: actions novas, com
  a permissão de quem aprova folha (`rh.folhas.aprovar_financeiro`).
- Aba Folhas de Pagamento: selo e filtro de contratação, coluna Pagamento
  (PIX, TED ou "Sem dados"), total do que está filtrado.
- Painel de aprovação: "Valor a pagar", seção Pagamento (mostra, informa,
  altera), texto do rateio.
- Títulos a Pagar e página do título: "Devolver para a aprovação" nos títulos
  de folha; na página do título, ele substitui "Editar" e "Excluir" e, depois
  de devolver, volta para onde a pessoa estava (como o "Excluir", decisão 108)
  — recarregar a página de um título apagado dava 404.
- Diálogo da remessa: chips de origem (Todas, Folha, PP, Avulsos…).
- `linhaFolhaSchema` (`lib/validations/rh-folhas.ts`): o valor é lido como
  número nos dois formatos (§7). Teste em `npm run test:folha`.
- Aprovação sem acesso à empresa da linha: mensagem própria, em vez de
  "Falha ao criar título a pagar." (§8).
- Lista da aba e painel de pagamento, revistos no mesmo dia (§10).

## 4. Achado no caminho: o financeiro não enxergava o colaborador

A RLS de `colaboradores` é só de administrador e RH. Com o papel financeiro,
a aba de folha mostrava "—" no nome, a aprovação falhava com "Colaborador não
encontrado" e os títulos de folha sumiam do diálogo da remessa. Tudo tinha
sido testado como administrador.

Em vez de abrir a tabela inteira (RG, endereço, nascimento…), duas funções
`security definer` expõem só o que o pagamento usa, para administrador, RH e
financeiro: `colaboradores_pagamento(tenant, ids)` e
`atualizar_pagamento_colaborador(id, dados)`. As CHECKs de formato da tabela
continuam valendo.

## 5. Os dados de setembro

Conferência das três planilhas (folha de setembro, Planilha Unificada e dados
bancários) contra o cadastro, em 30/09. Autorizado pelo Tiago:

- **PE000023 cancelado** e títulos **AV-00005** (R$ 524.848,00 para uma linha
  de R$ 5.248,48; a causa foi o erro do §7, não digitação), **AV-00006** e
  **AV-00007** apagados; as três linhas voltaram para a aprovação.
- **177 linhas** de PJ e Recibo com o líquido (R$ 1.413.897,61 antes do ISS);
  conferidas pela soma e por uma soma ponderada pelo CPF.
- **14 linhas** geradas pela tela ("Gerar folha"): 4 admissões de setembro e
  10 CLT da regional AMBEV.
- **202 linhas** em "Aguardando aprovação" (PJ, Recibo, CLT e estágio). Ficam
  em rascunho os 3 sócios e duas pessoas sem valor a receber em setembro.
- **152 pessoas** com chave PIX ou conta carregadas da planilha, só onde o
  cadastro estava vazio e sem dúvida (hash conferido). As demais o
  financeiro informa na aprovação.

## 6. O que ficou de fora

- **19 CPFs gravados errados** na reconciliação de 29/09 (zero à esquerda
  perdido; 9 nem passam no dígito verificador). Não afetam esta remessa —
  todos têm CNPJ no cadastro, que é o documento que o arquivo manda, e as
  chaves CPF vieram da planilha de bancos —, mas precisam de correção. É dado
  da frente do RH: fica para o Tiago combinar com o Antonio.
- Baixa em lote pela remessa e leitura do arquivo de retorno.
- Cancelar um arquivo de remessa pela tela.
- A numeração dos títulos avulsos reaproveita código apagado (os títulos dos
  testes de 30/09 nasceram todos AV-00005).
- Gerentes de produção e produtores sem a Ventura, e empresas criadas daqui
  em diante (§8).

## 7. Achado no teste: valor com centavos multiplicado por 100

O painel de aprovação manda o valor como decimal com ponto (`"5248.48"`, o
formato do banco); o painel do RH manda o texto do campo de moeda, em pt-BR
(`"5.248,48"`). O `linhaFolhaSchema`, que os dois usam, tirava **todo** ponto
como separador de milhar: `"5248.48"` virava 524848. Toda aprovação de linha
com centavos gerava título 100 vezes maior — valor inteiro (`3500`) passava
ileso, porque o banco o devolve sem ponto.

- **Em produção** atingiu uma aprovação só: o AV-00005 (29/09), apagado pela
  migration 100002 antes de qualquer pagamento. O histórico de
  `folha.linha.aprovada` foi conferido inteiro.
- **Achado em 30/09**, no teste do painel novo: uma linha editada para
  3.400,00 gravou título de R$ 340.000,00.
- **Correção:** com vírgula, é pt-BR (ponto é milhar); sem vírgula, o ponto é
  o decimal. O painel do RH sempre manda vírgula (o campo de moeda formata com
  duas casas), então para ele nada muda.
- **Testado no navegador:** a mesma linha, reaprovada com o valor da planilha,
  gerou o título certo, com o rateio de quatro regionais; uma linha com
  centavos aprovada **sem edição** (o caso que quebrava) gerou título com o
  valor exato e nenhum registro de edição. As duas foram devolvidas e estão em
  "Aguardando aprovação", com o valor da planilha.

## 8. Achado no teste: ninguém do financeiro acessa a Ventura

A RLS de `contas_avulsas` só deixa criar e ver título de empresa a que o
usuário tem acesso (`empresa_members`). Os cinco usuários do financeiro têm
Califórnia Filmes, CCH e Hitlab, e **nenhum tem a Ventura LTDA** — conferido
por simulação com o papel financeiro (recusa 42501). Três linhas da folha de
setembro são 100% Ventura (R$ 26.180,47). Aprovadas por alguém do
financeiro, falham com "Você não tem acesso a uma das empresas desta linha…";
aprovadas por um administrador, os títulos não aparecem para o financeiro em
Títulos a Pagar nem na remessa.

**A causa:** em 16/09 o acesso foi marcado como "todas" na tela de usuários,
que grava uma linha por empresa existente naquele momento. A Ventura nasceu em
24/09 e ninguém marcado como "todas" ganhou acesso a ela.

**Resolvido em 30/09** (Tiago: "tanto os usuários do financeiro quanto
administradores deverão ter acesso a todas as empresas"): a migration
`20260930100005` deu aos cinco usuários do financeiro acesso amplo à Ventura,
com registro em `audit_events` como a tela faz. Conferido por simulação: com o
papel financeiro, o título da Ventura é criado e aparece. Administrador não
precisa de linha: o papel já libera todas as empresas, inclusive as futuras.

**Ficou para decidir:** cinco gerentes de produção e três produtores também
foram marcados como "todas" em 16/09 e estão sem a Ventura; e a próxima
empresa criada vai repetir o problema para quem não é administrador, porque o
"todas" da tela não vale para empresa nova.

## 9. Dado pessoal fica fora do repositório

O repositório é público no GitHub. As três cargas de setembro levam CPF,
valor líquido, chave PIX e conta de cada pessoa, então **não foram
versionadas** aqui:

| Migration | O que fez | Estado |
|---|---|---|
| `20260930100002_folha_setembro_liquido_e_aprovacoes_desfeitas` | PE000023 cancelado, AV-00005/6/7 apagados, líquido em 177 linhas | aplicada |
| `20260930100003_folha_setembro_para_aprovacao` | 202 linhas para "Aguardando aprovação" | aplicar depois do deploy |
| `20260930100004_pagamento_dos_colaboradores_da_planilha` | chave PIX ou conta de 152 pessoas | aplicada |

O SQL de cada uma fica registrado no próprio banco
(`supabase_migrations.schema_migrations`) e os arquivos, na pasta `tmp/`
(ignorada pelo git) da máquina do Tiago. Carga de dado com informação pessoal
não entra em migration versionada enquanto o repositório for público.

## 10. A lista da aba: ordem, regional e "Hub" (30/09, pedido do Tiago)

| Pergunta | Resposta |
|---|---|
| Em que ordem as linhas aparecem? | **Nome de A a Z**, sem distinguir acento ("Álvaro" fica entre os A). Clicar em "Colaborador" inverte; clicar em "Valor" ordena do maior para o menor e, de novo, do menor para o maior. Até aqui a ordem dentro do mês era a do banco, ao acaso. |
| Filtro por regional | O mesmo seletor da aba de PPs (várias regionais; nenhuma marcada = todas), só com as regionais que têm linha e a contagem de cada uma. Ele recorta a lista antes das contagens de status e contratação, como na aba de PPs. |
| Linha com mais de uma regional | Fica num grupo só, **"Hub · várias regionais"**, e não aparece em cada regional do rateio. Na coluna Alocação: "Empresa · Hub" e o rateio numa linha ("SP 30% · NE 25% · …"). |
| Por que "Hub"? | O Tiago pediu "TDs", como na Planilha Unificada ("TD"). O sistema nunca usou "TD": a lista de colaboradores do RH chama de **Hub** quem é alocado em todas as regionais pelo rateio anual, e em setembro as 25 linhas com mais de uma regional eram exatamente os 25 Hub (18 da Agência California, 7 da CCH). "Todas as regionais" ficou de fora porque, nos filtros, quer dizer "sem filtro". |
| Pagamento no painel | A chave PIX com o tipo; a conta com o tipo (corrente, poupança), o banco pelo nome, agência e conta; e o que a remessa vai fazer: PIX, TED ou crédito em conta no Santander, com o documento que o arquivo leva ("a conta precisa ser desse titular"). Na lista, a coluna Pagamento mostra o tipo da chave ("PIX · Telefone"). |
