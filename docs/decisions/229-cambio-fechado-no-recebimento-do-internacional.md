# 229 — O câmbio fechado no recebimento do job internacional

**Data:** 2026-10-29
**Status:** aceita e implementada (29/10/2026).
**Quem decidiu:** Tiago, em 29/10/2026, depois de ver no protótipo "Como está
hoje" o job internacional do envio para faturamento à conciliação.
**Revê:** a [130](130-recebimento-antes-da-nf.md) (recebimento antes da NF:
um valor só, em reais, até o saldo a faturar), para o job internacional.
**Migrations:** `20261029950001` (origem `cambio_custo`), `20261029950002`
(plano de contas, colunas, funções, fila e fluxo), `20261029950003` (a fila
sem função por linha) e `20261029950004` (sem FK nova entre recebimento e
lançamento).

## O que acontecia

O cliente do job internacional paga em dólar antes da nota. O banco credita
o bruto pela cotação do dia ("ORPAG ORIGEM EXTERIOR") e debita o IOF à
parte ("COBRANÇA DE I.O.F.", 0,38% do crédito, no extrato real do BB de
09/10/2026). No sistema:

- o recebimento antes da NF era um valor só, até o saldo a faturar. Com a
  cotação acima da do orçamento, o crédito passava do saldo e era recusado;
  abaixo, a diferença ficava como previsão no fluxo e virava parcela 2 em
  aberto na nota, que ninguém ia pagar;
- o IOF entrava pela regra do histórico como despesa administrativa
  ("07 · Outros"), sem job;
- na conciliação, o crédito acima do saldo ficava "Sem correspondência" e a
  conta não fechava.

## A regra

1. **No job internacional, o recebimento antes da NF é o câmbio fechado.**
   O financeiro informa o valor na moeda e a cotação do dia; o sistema
   calcula o bruto em R$, que bate com o crédito do banco. Logo abaixo, o
   IOF (0,38% do bruto, sugerido e editável) e a tarifa de câmbio, se o
   banco cobrou. O formulário nasce com o job, para só conferir: o que falta
   receber na moeda, pela cotação de compra da versão aprovada, essa cotação
   e o centro de custo da receita (comentário do Tiago no protótipo,
   29/10/2026). Job internacional = orçamento de modelo `internacional` com
   moeda estrangeira e cotação de compra na versão aprovada.
2. **Três lançamentos ligados ao recebimento e ao job:** a entrada bruta
   (`recebimento_antes_nf`), a saída do IOF e a saída da tarifa (origem nova
   `cambio_custo`). Cada linha do banco casa com o seu lançamento pelo motor
   de hoje (passo 1, valor exato), antes da regra do histórico — que, por
   isso, não lança o IOF de novo. Cancelar o recebimento apaga os três.
3. **Variação cambial.** No internacional o teto aceita o convertido mesmo
   acima do saldo. A diferença do bruto para o saldo a faturar da nota é a
   variação cambial do job (+ ganho, − perda), um resultado financeiro
   separado da operação: não muda o faturamento do job. Ela fica **no
   recebimento** (`recebimentos_antes_nf.variacao_cambial`), porque não é
   dinheiro — não vira lançamento (todo lançamento tem conta), não entra no
   extrato nem no fluxo de caixa.
4. **O envio fecha pelo convertido.** A variação soma no saldo a faturar da
   primeira parcela da nota: na fila do Faturamento (que mostra a variação
   debaixo do saldo), no Faturar e no fluxo de caixa. Sem previsão sobrando e
   sem parcela 2. O registro do envio fica como a produção o mandou —
   mexer no valor dele desligaria o "todo o faturamento enviado" do job.
5. **A nota sai pelo convertido.** A parcela 1 travada é a nota inteira. A
   contabilidade ainda confirma, junto com a pendência do imposto da
   exportação (decisão 184 §5).
6. **Conta nova no plano: 16 · Despesas de câmbio** (001 IOF, 002 Tarifa de
   câmbio), provisória até a revisão dos centros de custo.
7. **IOF, tarifa e, por analogia, todos os impostos e taxas vinculados ou
   rateados ao job são custo do job** na visão do job (resultado de job e
   rentabilidade). Nesta entrega eles nascem com o job; a leitura nos
   relatórios entra no trabalho dos relatórios, que o Tiago está fazendo.
   Motivo: com o job finalizado, a Planilha Interna poderá mostrar os números
   reais no lugar dos da produção.
8. **Uma vez por nota.** O câmbio fecha a nota inteira de uma vez; pagamento
   em dois câmbios fica para quando aparecer um caso.

## Na tela

- Contas a Receber › Faturamento: na linha do job internacional, "Registrar
  recebimento antes da NF" abre o formulário do câmbio (valor na moeda,
  cotação, bruto, IOF, tarifa, líquido na conta e variação). A linha mostra
  o saldo pelo convertido e "variação cambial ±R$" debaixo dele. O "Ver o
  recebimento" mostra o câmbio, o IOF, a tarifa e a variação.
- Página do job: a trilha "Faturamento" conta o envio pelo convertido e
  mostra a variação.

## No banco

- `recebimentos_antes_nf`: `moeda`, `valor_moeda`, `cotacao`, `iof`,
  `tarifa`, `variacao_cambial`, `iof_lancamento_id`, `tarifa_lancamento_id`
  (sem FK: uma segunda e uma terceira FK para `lancamentos_financeiros`
  deixariam ambíguos os embeds sem nome do PostgREST; a migration
  `20261029950004` as tirou 3 minutos depois de criadas).
- `registrar_recebimento_antes_nf_cambio` grava os três lançamentos, o
  recebimento e a auditoria; `cancelar_recebimento_antes_nf` apaga os três.
- `_variacao_cambial_da_parcela` e a variação somada em
  `vw_faturamento_pendente`, `emitir_faturamento`,
  `_antes_nf_abatido_da_parcela` e `vw_fluxo_caixa`.

## Fora desta decisão

- O IOF e a tarifa na `vw_job_rentabilidade` e no Resultado de job (§7).
- A variação cambial na DRE.
- Pagamento em dois câmbios (§8).
- A baixa do título já emitido com câmbio (o cliente que paga depois da
  nota): segue a baixa de hoje.
