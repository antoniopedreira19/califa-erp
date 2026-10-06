# 140 — Baixa em lote e a aba Títulos na conciliação

**Data:** 2026-10-02
**Decidido por:** Tiago
**Status:** aceita — entregue em 02/10/2026; revista em 05/10/2026 (folha no lote e uma origem por lote, §6), entregue em 06/10/2026
**Migration:** nenhuma (cada título continua baixado pela função de baixa que já existia)

---

## 1. O pedido

*"Uma maneira de dar baixa em mais do que um item em títulos a pagar,
títulos a receber ou impostos a pagar, selecionando vários e dando baixa de
vez."* E: *"dentro da tela da planilha de conciliação de uma dada conta
bancária, quero que seja possível selecionar uma segunda aba chamada
Títulos. Nela, deverá estar agregado tudo que está no contas a pagar, no
contas a receber e no fiscal aguardando baixa, para que seja possível dar
baixa ali mesmo selecionando a conta bancária. Essa aba será comum e igual
independente da conta bancária selecionada."*

Desenho aprovado por protótipo clicável em 02/10/2026. Os impostos entram
quando a Apuração e os Impostos a Pagar forem entregues (decisão 139, §4).

## 2. Baixa em lote

- Em **Títulos a Pagar** e **Títulos a Receber**, uma coluna de seleção (a
  mesma caixa da remessa CNAB), a barra escura com a quantidade e o quanto
  sai e entra, e o diálogo **Dar baixa em N títulos**: a data, a conta e a
  forma de pagamento uma vez só; cada título vira a SUA baixa e a sua linha
  na conciliação, como se fosse feita uma a uma.
- Cada título é baixado pelo **valor em aberto** (o parcial, pelo que
  falta). Baixa parcial e recebimento com imposto retido pelo cliente ficam
  na baixa de um por um.
- **A PP retém o que a aprovação decidiu** (decisão 139): a coluna "Ajuste"
  mostra "− R$ X retido na fonte", "Na conta" e "Saem da conta" vêm pelo
  líquido, e o servidor relê as alíquotas de `pedidos_compra_retencoes`
  antes da primeira baixa — se não conseguir ler, não baixa nada (a PP
  sairia pelo bruto). PP de verba e parcela em remessa saem cheias, como na
  baixa de um por um. Retenção diferente da aprovada: baixa de um por um.
- O centro de custo é o que o título já tem; quem não tem recebe o do lote:
  "02 · Custo Operacional" + o subtipo escolhido nos pagamentos (onde toda
  PP nasce, decisão 068) e "01 · Receita" + o subtipo nos recebimentos.
- **Entram:** a pagar de PP, avulso, recorrência e folha (desde 05/10/2026,
  §6); a receber de NF e recebimento avulso — inadimplente e parcial também.
  **Uma origem por lote** (§6).
- **Ficam fora** (caixa desligada, com o motivo ao passar o mouse): pago e
  cancelado; fatura de cartão e devolução de verba, que têm baixa própria; o previsto no cartão (vira item da fatura na baixa, decisão 093);
  a PP com **pagamento fora do cadastro** (para onde vai o dinheiro só
  aparece na baixa dela, decisão 137); o **desembolso**, cujo centro de
  custo o financeiro escolhe na baixa — o lote não tem como escolhê-lo, e o
  protótipo não o tinha; rendimento e transferência entre contas.
- Os títulos são baixados na ordem, pela mesma Server Action da baixa
  individual (as mesmas travas); se um falhar, os anteriores ficam baixados
  e a tela diz qual parou e por quê.

## 3. A aba Títulos na conciliação

- Na página de uma conta, duas abas: **Extrato** (o de sempre) e
  **Títulos · N** — tudo o que aguarda baixa em contas a pagar e a receber,
  igual para qualquer conta (o mesmo recorte de "A pagar" em Títulos a
  Pagar, sem os do cartão, e de "Em aberto" em Títulos a Receber).
- Filtros por vencimento (Vencidos · Até hoje · Próximos 7 dias · Todos),
  por tipo (Todos · A pagar · A receber) e busca. "Baixar" abre a baixa real
  do título com a conta da conciliação já escolhida (trocável); a seleção
  abre a baixa em lote com a mesma conta. O aviso depois da baixa diz se o
  movimento foi para o extrato desta conta, de outra ou fora do período.
- Cada aba só lê o que é dela: o Extrato não consulta títulos (o número
  "Títulos · N" só aparece com a aba aberta) e a aba Títulos não consulta o
  extrato. A aba vai na URL (`&aba=titulos`).
- A transferência entre contas "A transferir" fica fora da aba (as duas
  contas já estão no título); o filtro de empresa de Contas a Pagar não vale
  aqui (a conta não pertence a empresa, decisão 064).
- A coluna **Empresa** mostra a empresa gerencial do título, a mesma das
  listas de Contas a Pagar e a Receber. O protótipo do fiscal mostrava a PJ
  (empresa contábil) em todas as linhas; os impostos, que entraram na aba
  com a decisão 141, mostram a PJ da guia (ver 141 §6).
- Para a aba, as consultas de Contas a Pagar e de Contas a Receber saíram
  das páginas para `dados-dos-titulos.ts` (o mesmo código, movido); a
  decisão de quem entra no lote está copiada em
  `conciliacao/alvos-da-baixa.ts` — mudou numa lista, muda lá também.

## 4. Verificação (02/10/2026, no TES-P001/26 e na Conta Teste)

- Títulos a Receber: as duas parcelas da NF 1 (TES-1001/26) marcadas → a
  barra mostrou "Entram R$ 137.749,47" → "Dar baixa em 2" → duas baixas,
  dois lançamentos na Conta Teste (01 · Receita · Geral), cada um na sua
  linha do Extrato. Canceladas pelo olho do título, voltaram para Em aberto.
- Aba Títulos da Conta Teste: "Baixar" na parcela 2/2 abriu a baixa real com
  a Conta Teste escolhida; o aviso disse "O movimento já está no Extrato
  desta conta"; o título saiu da aba. Depois, as duas parcelas pela seleção
  da aba: o diálogo do lote veio com a Conta Teste escolhida.
- Lote com retenção: PP-00110 (R$ 8.000,00, aprovada com PIS 0,65 · COFINS
  3 · CSLL 1 · IRRF 1,5) → Ajuste "− R$ 492,00", lançamento de R$ 7.508,00
  na Conta Teste e as quatro retenções (52 · 240 · 80 · 120) em
  `baixas_retencoes`. Baixa cancelada depois; a PP ficou A pagar.
- Contas a Pagar e Contas a Receber reorganizadas: os números (abas,
  filtros, "Em aberto R$ 1.252.652,73") iguais aos do servidor do `main`.
- Sem erro no console nem no servidor.

## 5. Perguntas que ficaram para o Tiago

1. **Desembolso no lote:** hoje fica fora. Se entrar, o lote precisa de um
   campo de tipo para ele (não pode ir sempre para 02).
2. **NF de BV no lote:** entra, e o lote põe "01 · Receita" se ela não tiver
   centro de custo. Não existe nenhuma NF de BV emitida ainda; se o BV deve
   ir para outro tipo (14 · Bonificação?), a NF de BV sai do lote.
3. **Devolução de verba na aba Títulos:** aparece como "+ R$" (dinheiro que
   volta), com o chip "A pagar" — de onde ela mora.
4. **"Títulos · N" com o Extrato aberto:** custaria ler os títulos ali
   também; hoje o número só aparece com a aba aberta.
5. **Lote muito grande:** as baixas são uma a uma no servidor; dezenas de
   títulos podem passar do tempo máximo da função na Vercel.
6. **A barra da seleção** mostra "Saem" pelo bruto (a lista não tem as
   alíquotas); só o diálogo mostra o líquido. A barra também deve buscar?

## 6. ⚠️ Revisão de 2026-10-05 — folha no lote e uma origem por lote

O Tiago tentou marcar os títulos da folha 09/2026 em Títulos a Pagar e a
caixa estava desligada ("Folha tem baixa própria"). Conferido: a folha não
tem baixa própria. A baixa de um título de folha é a mesma do avulso
(`darBaixaTitulo` → `baixar_conta_avulsa`), e o que ela tem de diferente —
só o valor inteiro, nunca no cartão (revisão de 01/10/2026) — o lote já
cumpre: paga sempre o que falta, pela conta bancária. Os 112 títulos de
folha em aberto já têm o centro de custo deles (Despesa com Pessoal ·
Salário ou ProLabore), então o "02 · Custo Operacional" do lote não entra.

**Decidido pelo Tiago em 05/10/2026:**

1. **A folha entra no lote** (`ORIGENS_PAGAR_NO_LOTE`). Fatura de cartão e
   devolução de verba continuam fora.
2. **Um lote leva uma origem só.** Origem é cada chip das telas: PP,
   Avulso, Folha e Recorrência a pagar; Nota fiscal e Recebimento avulso a
   receber; Imposto. Avulso e Recorrência são origens diferentes, como os
   chips. Vale em Títulos a Pagar, Títulos a Receber, Impostos a Pagar e na
   aba Títulos da conciliação (onde a pagar, a receber e imposto também
   deixam de se misturar).
   - Marcado o primeiro título, os de outra origem ficam com a caixa
     desligada e o motivo: *"Só uma origem por lote: os títulos marcados
     são de Folha."*
   - **A caixa do cabeçalho segue a origem já marcada:** marca todos os
     visíveis dela (*"Selecionar todos os títulos de Folha"*). Sem nada
     marcado, marca todos só se a lista mostra uma origem; com várias, fica
     desligada: *"Marque um título, ou filtre uma origem, para selecionar
     todos."*
   - **O servidor também recusa** o lote misto (`baixaEmLoteSchema`):
     *"Só uma origem por lote: este mistura PP e Folha. Faça um lote para
     cada origem."*

**Por quê:** cada origem tem efeito diferente na baixa — a PP retém o que a
aprovação decidiu e fecha a parcela, a folha cai em Despesa com Pessoal —, e
o lote misto fica difícil de conferir antes de confirmar e depois, no
extrato. Entrada e saída no mesmo lote (aba Títulos) era o caso pior.

**Código:** `lib/financeiro/baixa-em-lote.ts` (`OrigemDoLote`,
`origemDoLote`, `selecaoPorOrigem` e a trava no schema) e `useSelecao`
(`components/financeiro/baixa-em-lote.tsx`), usado pelas quatro listas.
Sem migration.

**Conferido em 06/10/2026, sem gravar nada:** em Títulos a Pagar, as 112
folhas com a caixa ligada; uma folha marcada desligou as 15 PPs e os 2
avulsos com o motivo; o cabeçalho marcou as 112 (R$ 881.202,63, o total do
banco) e o diálogo disse "Os 112 pagamentos usam o centro de custo que já
têm" — fechado por Esc, sem confirmar. Na aba Títulos da conciliação, uma
folha marcada desligou os outros a pagar e os a receber. A action chamada
pelo console com PP + Folha voltou a mensagem da trava; só Folha, com id
inexistente, passou pelo schema e parou em "Lançamento não encontrado". Os
112 títulos seguem "aprovada" no banco.

**Risco em aberto (pergunta 5 do §5, agora concreta):** a folha é o caso de
lote grande — 112 títulos de uma vez. O lote baixa um por um, numa única
chamada ao servidor, e o projeto não configura `maxDuration`: vale o padrão
da Vercel do plano, que não consegui ver daqui. Se a chamada passar do
tempo, as baixas já feitas ficam (cada uma é uma transação), o diálogo
mostra erro e os títulos que faltam continuam na lista para outro lote — não
duplica, porque o já baixado sai da lista e o servidor recusa ("Já está
baixado"). A saída sugerida ao Tiago: o diálogo mandar o lote em partes (por
exemplo, de 20 em 20) e mostrar o andamento.

