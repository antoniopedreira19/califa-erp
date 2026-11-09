# 246 — A produção cancela o envio da prestação de contas da verba

**Data:** 2026-11-06
**Status:** aceita e implementada em 06/11/2026.
**Quem decidiu:** Tiago, em 06/11/2026, sobre o protótipo interativo
"Cancelar o envio da prestação" (componentes reais, opções A e B):
https://claude.ai/artifact/5vkSEdY1Cjrt86ySK1Jkr1. Ele aprovou **as duas
formas juntas**, porque uma não interfere na outra.
**Revê:** a [189](189-prestacao-de-contas-da-verba-documento-a-documento.md)
num ponto: a prestação em avaliação não "só volta se o financeiro
reprovar". O resto da 189 continua.
**Migrations:** `20261106950001_cancelar_envio_da_prestacao.sql`,
`20261106950002_comentario_da_decisao_246.sql` e
`20261106950003_trava_de_papel_da_prestacao.sql`, aplicadas pelo MCP em
06/11/2026.
**Número:** nasceu como 245; antes do push, a 245 já estava no `main`
(prazo de envio das PPs de 20/11) e esta virou 246. Os comentários
dentro das funções já aplicadas dizem 245 e ficaram como estão no banco.

## O que aconteceu

A produção enviou a prestação de uma verba achando que ela "ficava aberta"
e pediu para reabri-la. Até aqui, a prestação em avaliação só voltava para
a produção se o financeiro reprovasse.

## A regra

1. **Quando:** só com a prestação **em avaliação** — o financeiro ainda não
   aprovou nem reprovou. Aprovada ou reprovada, não há o que cancelar.
2. **Quem:** quem presta contas da verba (as mesmas portas do envio,
   `_verba_para_prestar`). Só a verba de produção: a PP que foi sem NF na
   Mídia System (216) e o reembolso (187) ficam como estão.
3. **Para onde volta:**
   - primeiro envio → **rascunho**, com os mesmos documentos ("Continuar
     prestação");
   - reenvio depois de reprovada → **reprovada**, com o motivo do
     financeiro à vista ("Corrigir prestação") — é o estado de antes do
     reenvio;
   - enviada com "Não houve gasto" → os documentos já tinham saído no
     envio; a prestação some e a verba volta a "Prestar contas".
4. **O que fica:** os documentos e o que o financeiro já tiver corrigido
   neles na conferência. O realizado do item não muda (só a prestação
   aprovada desconta o saldo).
5. **Sem pop-up**, como o "Cancelar envio" do Comitê: volta a enviar com o
   mesmo botão de sempre.
6. **Histórico da PP:** evento novo **"Envio da prestação cancelado"**, com
   quem cancelou — aparece no "Ver formulário" da produção e no histórico
   da tela do financeiro. Auditoria `verba_producao.prestacao_envio_cancelado`
   (metadata: `pp_codigo`, `volta`).
7. **Corrida com o financeiro:** a função trava a linha da prestação; quem
   chegar depois encontra o status novo e é recusado (aprovar uma prestação
   que voltou a rascunho dá "Esta verba ainda não tem prestação de
   contas").

## As telas (as duas opções do protótipo)

- **A · no cartão e na linha:** ícone ↶ "Cancelar envio da prestação" ao
  lado do "Ver prestação" no cartão da verba (painel "Destrinchar
  realizado") e na trilha da aba PPs.
- **B · dentro da prestação:** a gaveta aberta pelo "Ver prestação" tem
  **Cancelar envio** no rodapé, no lugar do "Enviar"; com um clique ela
  volta a aceitar documentos, sem fechar. Na aba PPs, a linha da verba com
  a prestação enviada ganhou o ícone "Ver prestação", que não existia.
- A regra de quando mostrar mora em `producaoCancelaEnvioDaPrestacao`
  (`lib/calculos/prestacao-da-verba.ts`), com teste.

## No banco

| Objeto | O quê |
|---|---|
| `cancelar_envio_prestacao_verba(uuid)` | nova, SECURITY DEFINER; devolve `rascunho`, `reprovada` ou `sem_prestacao`; execução só para `authenticated` |
| `pedidos_compra_eventos_evento_check` | refeita com os valores que estavam no banco (inclusive `nota_anexada` e `nota_conferida`) + `prestacao_envio_cancelado` |
| `prestacao_verba_registra_evento` | a volta feita pela função nova (marcada na transação por `califa.envio_da_prestacao`) vira "Envio da prestação cancelado", e não "reprovada" |

## Conferido

Em 06/11/2026, pelas telas, no TES-1025/26 (P-0006/26), com a **PP-00951**
(verba de produção de R$ 100,00, titular terceiro "Fornecedor Teste",
aprovada e baixada na Conta Teste) e dois documentos "Outro" (R$ 30,00 e
R$ 20,00):

- **A, painel do item:** enviada → ↶ → "Aguardando prestação · 2
  documentos salvos, a enviar · Continuar prestação"; banco em rascunho com
  os 2 documentos, evento e auditoria gravados.
- **B, painel do item:** "Ver prestação" → "Cancelar envio" → a mesma
  gaveta virou "Prestar contas" com "Enviar prestação ao financeiro"; ao
  fechar, o cartão voltou a "Continuar prestação".
- **Aba PPs:** "Ver prestação" e ↶ na linha; o ↶ mostrou "Envio da
  prestação de PP-00951 cancelado. Ela voltou para você." e a linha voltou
  a "Continuar prestação".
- **Reenvio:** o financeiro reprovou ("Teste 245: falta o recibo do frete,
  reenvie com ele."), a produção reenviou e cancelou: voltou a "Corrigir
  prestação" com o motivo; eventos enviada → reprovada → reenviada → envio
  cancelado.
- **Histórico:** os cancelamentos aparecem no "Ver formulário" e na tela
  do financeiro.
- **Travas, numa transação desfeita:** reprovada, aprovada e sem prestação
  são recusadas com a frase de cada caso; "Não houve gasto" no primeiro
  envio apaga a prestação e grava o evento; `anon` não executa a função.
- A PP-00951 ficou com a prestação **reprovada** (fora da fila do
  financeiro).

## A trava de papel da prestação (corrigida em 06/11/2026)

O defeito já existia antes da 246 e apareceu no teste dela. Em
`_verba_para_prestar` (189), `v_pp.responsavel_verba_id = v_uid` dava NULL na
verba sem responsável (todas desde a 171), e `if not (... or NULL ...)` não
recusava: **qualquer papel ativo do tenant** passava pelas quatro funções da
produção (salvar, remover, enviar e cancelar). Na transação de teste, o
"Financeiro Teste" cancelou um envio. A tela só mostrava os botões para quem
presta contas, e a auditoria até 06/11 só tinha administrador, GP e produtor
nesse caminho.

Corrigido com o Tiago ("Sim, corrija") na migration
`20261106950003_trava_de_papel_da_prestacao.sql`: um
`coalesce(..., false)`; o resto da função ficou igual. Conferido numa
transação desfeita: financeiro e freela de fora do projeto são recusados
(também ao remover documento); produtor, GP, administrador e o freela
ligado ao projeto passam.

Fica como está: as funções auxiliares da prestação (`_verba_para_prestar`,
`_faltas_…`, `_conferir_…`, `_campos_…`) têm execução para `authenticated`
no banco, apesar do `revoke` da 189. Com a trava certa, chamar
`_verba_para_prestar` direto só devolve a PP a quem já presta contas dela.
