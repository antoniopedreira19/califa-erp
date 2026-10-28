# 226 — A linha vermelha sai da errata, e a versão aprovada mostra as erratas

**Data:** 2026-10-28
**Status:** implementada em 28/10/2026.
**Quem decidiu:** Tiago. Pedido em 28/10/2026: "ao gerarmos uma linha
vermelha a alteração não seja considerada uma errata e o novo item já fique
disponível para a geração de PPs, mesmo sem aprovação ou do financeiro", e
"quando uma errata for realizada, a alteração seja feita também no orçamento
aprovado [...] com um botão de histórico". Protótipo aprovado no mesmo dia
(https://claude.ai/artifact/HFuUCqNQyV27GqDQqYv5yy, v4), com os comentários
dele: barra neutra enquanto nada é errata, "Histórico" à esquerda do
"Exibir" e linha vermelha salva sem pop-up.
**Revê:** a [030](030-errata-na-planilha-e-a-linha-vermelha.md) (a linha
vermelha nascia na errata e a versão aprovada não mudava), a
[159](159-errata-pronta-para-envio.md) (a vermelha do produtor esperava o GP)
e a [185](185-errata-trava-o-envio-de-pp-so-na-linha-alterada.md) (a vermelha
travava o envio da PP até a revisão do financeiro).
**Migration:** `20261028800001_linha_vermelha_fora_da_errata.sql`.

## 1. "Realizar errata" vira "Editar planilha"

O botão liga o mesmo modo de edição de sempre, que agora faz duas coisas: a
errata e a linha vermelha. Ligado, ele diz "Editando planilha". A barra do
rodapé fica neutra enquanto nada é errata — "Planilha em edição", botão
"Salvar" — e só fala de errata quando aparece mudança de valor, item novo,
cancelamento ou reorganização. A linha vermelha criada e removida vazia não
conta.

## 2. A linha vermelha não é errata

Ela nasce zerada no orçado e no planejado: não muda valor do job,
faturamento nem a curva do financeiro. Por isso:

- **Só linha vermelha no rascunho:** o "Salvar linha vermelha" do rodapé
  grava direto, sem pop-up e sem descrição (`salvarLinhasVermelhas`).
- **Errata com linha vermelha junto:** o "Confirmar errata" abre como
  sempre; a vermelha aparece numa seção própria, "fora da errata", e entra
  ANTES da errata. Se a errata falhar depois, a vermelha já gravada sai do
  rascunho (a tela recebe `vermelhasGravadas`) e o reenvio não a duplica.
- **Produtor:** grava a vermelha sozinho, sem esperar o GP (resposta 1 do
  Tiago). Com o resto do rascunho, o resto fica pronto para o GP como hoje.
- **Não volta ao mural**, não toca `abertura_em_revisao` nem os espelhos do
  job, e não trava o envio de PP: a 185 lê só as linhas das erratas.
- **Comitê:** a regra de PP em linha vermelha continua desligada (resposta
  3).
- **Mesmas portas da errata:** job aberto ou em produção, e não enviado para
  faturamento (no mensal, o mês do agrupamento).

A separação é do servidor (`separarLinhasVermelhas`, em
`lib/calculos/linha-vermelha-fora-da-errata.ts`, `npm run
test:linha-vermelha-fora-da-errata`): a vermelha nova num agrupamento que
já existe sai da errata; a criada num agrupamento novo desta mesma errata
fica nela, porque o agrupamento só nasce com a errata (decisão 162). Vale
também para a errata pronta antiga que tiver vermelha.

**Banco:** `jobs_itens_orcado.criada_por` (quem criou a vermelha fora da
errata) e `adicionar_linhas_vermelhas_do_job(p_job_id, p_linhas)` —
administrador, GP e produtor; grava a linha no fim do agrupamento e a âncora
de realizado, sem `jobs_erratas`. Auditoria `job.linha_vermelha_criada`.

**Histórico da planilha (186):** a vermelha sem errata vira o momento
"Linha vermelha", com autor e hora (resposta 2). Ela não entra no card de
Erratas.

## 3. A versão aprovada mostra as erratas

As erratas são combinadas com o cliente. Com job aberto, a versão aprovada
do orçamento passa a mostrar a planilha do job: linhas, valores e
agrupamentos de hoje, sem a linha vermelha (não tem orçado) e sem a linha
cancelada, que some (resposta 4). A faixa da versão aprovada diz isso.

A versão aprovada **continua gravada como o cliente aprovou** —
`guarda_orcamento_so_leitura` não muda e nada se copia para ela. Quem lê é
`lib/data/versao-aprovada-do-job.ts` (`versaoMostraOJob` e
`planilhaDoJobNaVersao`), usado pela página e pelas exportações. Fica de
fora: job devolvido pelo financeiro (a versão abre para correção, decisão
128), job cancelado e Mídia Off (planilha com conta própria, decisão 167).
Os honorários e impostos mostrados são os da versão; o retrato que o
financeiro grava em `jobs_parametros` (decisão 224) continua só no job.

**Histórico do orçamento:** o botão "Histórico", à esquerda do "Exibir",
traz a versão que o cliente aprovou ("Aprovada pelo cliente", na data
`versoes_orcamento.aprovado_em`) e cada momento que mudou o que o cliente
combinou: errata, alteração do financeiro e save. Envio, abertura e linha
vermelha ficam de fora. Escolher um momento mostra a planilha dele, só
leitura, com a faixa e "Destacar o que mudou" (a borda da 185). Mesma
reconstrução da 186 (`historicoDoOrcamento`), com as peças da tela do job.
No mensal, um botão só, no primeiro mês.

**Exportação:** a planilha da versão aprovada sai sempre como está hoje
(resposta 5) — na exportação da versão e na consolidada do projeto, que já
só aceita orçamento sem job aberto.

## 4. Linha com PP não se cancela pela tela

Junto desta entrega: o "Cancelar" da calha da errata trava também com PP só
gerada (nota de 28/10/2026 na [151](151-errata-nao-mexe-no-planejado-e-cancela-linha.md)).

## Em aberto

- **Vermelha num agrupamento novo:** fica na errata. Em 28/10/2026 o
  BOC-1003/26 tinha uma errata pronta do produtor com 7 linhas vermelhas num
  agrupamento novo "LINHA VERMELHA" — esse caso continua esperando o GP.
- **Linha cuja única PP foi cancelada:** a tela oferece "Cancelar" e o
  servidor recusa (nota na 151).

## Conferência (28/10/2026)

- TES-1003/26: linha "ZZ Teste 226 linha vermelha" salva direto pelo
  administrador; nenhuma errata nova (seguem 6), job fora do mural, momento
  "Linha vermelha" no histórico. Fica no job de teste.
- TES-1025/26: errata "Teste da decisão 226" cancela o Item 8 com a linha
  "ZZ Teste 226 vermelha junto da errata" fora dela (`errata_origem_id`
  nulo). O job segue em revisão, como já estava.
- Produtor: a função, com o papel do Produtor Teste Claude simulado numa
  transação desfeita, gravou a linha com `criada_por` dele.
- Orçamento do TES-1025/26: versão aprovada com a linha nova da errata e os
  agrupamentos renomeados; "Aprovada pelo cliente" bate item a item com
  `versoes_orcamento_itens`; o destaque marca as linhas da errata de 15/10;
  a exportação sai com a planilha de hoje. Mensal conferido no TES-1035/26.
