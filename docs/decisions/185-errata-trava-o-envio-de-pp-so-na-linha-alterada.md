# 185 — A errata em revisão trava o envio de PP só na linha que ela alterou (revê a 040)

**Data:** 2026-10-16
**Status:** aceita e implementada em 16/10/2026. Revista em 19/10/2026:
as linhas da revisão aparecem com borda vermelha na planilha do financeiro
(seção "As linhas em destaque na revisão").
**Quem decidiu:** Tiago, em 16/10/2026, com a recomendação que acompanhava
a pergunta.
**Revê:** [040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md)
§2 — "enquanto a errata aguarda a revisão da abertura, nenhuma PP sai para
o financeiro". A §1 da 040 (linha com PP no financeiro não entra em
errata) não muda.
**Migration:** nenhuma. O banco não trava o envio por revisão; as duas
travas eram e continuam sendo de código.

## O pedido

> "O certo seria apenas travar o envio de PPs ao financeiro em itens que
> foram modificados pela errata. Caso não haja nenhuma alteração em uma
> linha, deveria ser possível continuar com os envios ao financeiro
> normalmente."

O caso que mostrou o problema, em 16/10/2026: o **ANI-1001/26** entrou em
revisão com uma errata que tirou R$ 8.000,00 da "VERBA DE PRODUÇÃO"
(13.332,30 → 5.332,30) e criou a linha "UNA: Viagem Itabira" (orçado
8.000, planejado 7.000). Havia 5 PPs geradas paradas: 3 na linha nova
(3 × R$ 750,00) e 2 prontas para envio em linhas que a errata não tocou
(PP-00240, R$ 1.550,00, e PP-00241, R$ 800,00). Pela 040 as 5 esperavam;
pela 185, só as 3 da linha nova.

## A regra

1. **Com o job em revisão da abertura, o envio da PP trava só se a linha
   dela foi mudada por uma errata ainda não revisada.** As outras linhas
   enviam normalmente.
2. **"Ainda não revisada"** é a janela do mural do financeiro: a errata
   registrada depois do último registro de abertura ou revisão
   (`jobs_aberturas.registrado_em`) ou, sem registro, da data de abertura.
   Com duas erratas na mesma revisão, valem as linhas das duas. Quando o
   financeiro salva a revisão, a janela fecha e todas as linhas voltam.
3. **"Mudou a linha"** é a errata ter gravado a linha em
   `jobs_erratas_itens`: orçado, planejado ou tipo de custo alterados,
   linha nova, linha cancelada. É o mesmo critério do pop-up da errata
   ("O que muda na planilha").
4. **A errata que só reorganiza a planilha não trava nada** (decisão 162:
   mover item de grupo, renomear, criar ou tirar grupo). Ela não grava
   linha em `jobs_erratas_itens`, e nenhum valor mudou. Escolha do Tiago
   entre "não travar" (recomendada) e "o item movido conta como alterado".
5. **O faturamento continua travado pelo job inteiro** enquanto a revisão
   estiver pendente: a errata muda o valor do job e o faturamento previsto.
   A 185 não mexe nisso.
6. **Revisão aberta só por pedido de save** (decisão 099, pedido no job
   aberto, sem errata) não trava linha nenhuma por esta regra. A linha do
   save já recusa PP pelo gatilho `pp_recusa_linha_com_save`.
7. Gerar, editar e cancelar PP seguem liberados em todas as linhas, como
   na 040.

## Onde mora

| Regra | Onde |
|---|---|
| Janela e linhas alteradas | `lib/data/linhas-da-revisao.ts` (`inicioDaRevisao`, `linhasAlteradasDesde`, `linhasAlteradasNaRevisao`), com 4 testes em `linhas-da-revisao.test.ts` (`npm run test:linhas-da-revisao`) |
| Servidor | `barrarEnvioDePP` (`jobs/[jobId]/realizado/actions-pp.ts`) recebe a linha da PP. Motivo da auditoria: `linha_alterada_em_revisao`. Se não conseguir ler as erratas, trava como antes, com `abertura_em_revisao` |
| Tela | O carregador do job (`carregar-detalhe.ts`) devolve `linhasComEnvioTravado`; `podeEnviarPP` não olha mais a revisão. O painel do item mostra a faixa só na linha travada; a aba PPs desabilita o ícone de envio só das PPs dessas linhas (`realizadosComEnvioTravado`), com a frase `TEXTO_LINHA_ALTERADA_EM_REVISAO` (`pp-a-emitir-ui.tsx`) |

A frase da tela: "A errata alterou esta linha e a abertura está em revisão
no financeiro: o envio das PPs dela volta quando a revisão for salva."

## As linhas em destaque na revisão (19/10/2026)

> "Quero que ao abrir os casos de erratas para fazer a revisão da
> abertura, ao clicar em visualizar planilha ou irmos à aba de 'planilha
> interna', a(s) linha(s) onde a errata foi feita fique(m) destacada(s)."

Do protótipo de 17/10/2026, o Tiago ficou com a forma mais simples: **só
destacar a linha**, com a **borda vermelha** do design do módulo
Suprimentos (a linha de onde a PP a emitir saiu). Sem faixa de texto, sem
selo e sem a lista de conferência na faixa da revisão, que estavam nas
duas propostas do protótipo.

- **Quais linhas:** as mesmas desta decisão, pela mesma função
  (`linhasAlteradasNaRevisao`): o que está destacado é o que está com o
  envio de PP travado. Alterada, nova e cancelada; a errata que só
  reorganiza não destaca nada. O destaque some quando a revisão é
  registrada, porque a janela fecha.
- **Onde:** na página do job no financeiro — a aba Planilha Interna e o
  pop-up do "Visualizar planilha interna" do formulário em revisão. A
  produção, a fila da abertura e as planilhas de outros jobs não destacam.
- **Forma:** `ERRATA.linhaEmRevisao` (`_planilha/blocos.ts`): 2px de
  `#E74B56` em volta da linha inteira, por sombra interna nas células, sem
  fundo. A linha que também está em `destacarItens` (a do pedido de save em
  aprovação, ou a da versão antiga do histórico) fica com aquele destaque;
  a versão antiga do histórico não destaca as linhas da revisão.
- **Código:** a prop `linhasDaRevisao` (obrigatória) em
  `JobRealizadoSection`, `JobItemRealizadoTable` e `AberturaForm`;
  opcional no `PopUpDaPlanilha`, como o `destacarItens`. A página
  `financeiro/jobs/[jobId]` lê as linhas junto da revisão
  (`Promise.all`); leitura que falha só tira o destaque.
- **Conferido em 22/10/2026** (dev do worktree, como administrador, sem
  gravar nada): no TES-1025/26, em revisão, a aba Planilha Interna e o
  pop-up do "Visualizar planilha interna" mostram com a borda vermelha
  exatamente o Item 3, o Item 6 (cancelado) e o "Item novo da errata" —
  as três linhas da errata de 15/10 — e nenhuma outra das 18.

## Efeito colateral aceito

Na aba PPs, o "Cancelar e refazer" da PP rejeitada também dependia de
`podeEnviarPP` e sumia com o job em revisão. Agora aparece, como já
aparecia no painel do item. Ele só gera a PP nova (`gerada`); o envio dela
passa pela trava desta decisão.

## Conferido (16/10/2026, logado como administrador)

- **ANI-1001/26, só leitura:** na aba PPs, o envio da PP-00240 e da
  PP-00241 liberado e o das PP-00231, 00234 e 00235 desabilitado, com a
  frase nova no tooltip. No painel do item, "UNA: Paulo Viva a Praça Bom
  Despacho" sem faixa e com "Enviar ao financeiro" ativo; "UNA: Viagem
  Itabira" com a faixa e os 3 envios desabilitados. Nada foi enviado.
- **TES-1025/26 (em revisão, errata no Item 3, no "Item novo da errata" e
  no Item 6):** PP-00243 (verba, R$ 100,00, Fornecedor Teste) no Item 1
  enviada pela tela — foi a `em_avaliacao` com o job em revisão.
  PP-00244 no Item 3: faixa e envio desabilitados no painel e na aba; a
  action chamada direto pelo console recusou com a mensagem da linha, a
  PP ficou `gerada` e a auditoria gravou `acao_negada` /
  `linha_alterada_em_revisao`. As duas PPs foram canceladas pela tela no
  fim. O TES-1025/26 segue em revisão, como já estava.
