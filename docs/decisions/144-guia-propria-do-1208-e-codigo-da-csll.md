# 144 — Módulo fiscal: guia própria do 12.08 e o código da CSLL

**Data:** 2026-10-04
**Decidido por:** Tiago ("Sim, corrija a guia do 12.08 e o código da CSLL", 04/10/2026)
**Status:** aceita — entregue em 04/10/2026
**Migration:** nenhuma (a chave da guia é texto livre em `fiscal_aprovacoes`,
e o tributo continua `PIS` e `COFINS`)

---

## 1. O que estava errado

Na revisão do estorno do crédito no 12.08 (o lembrete das decisões 139 e
141), a pesquisa achou dois erros do motor que a lei já resolve, sem margem
de escolha:

1. **O débito do 12.08 entrava na guia do regime não cumulativo.** Numa PJ do
   lucro real, o PIS e a COFINS das notas no 12.08 (0,65% e 3%) somavam na
   mesma guia do PIS e da COFINS não cumulativos, com os códigos 6912 e 5856,
   e o crédito dos custos abatia a soma. A lei pede DARF separado para a
   parte cumulativa, e o crédito só se desconta do não cumulativo.
2. **A CSLL do lucro real trimestral saía com o código 6773**, que é o do
   saldo do ajuste anual. O do trimestre é 6012.

## 2. O que mudou

| Ponto | Como ficou |
|---|---|
| Guia própria do 12.08 | Em PJ do lucro real, as notas de CNAE cumulativo (o 12.08) saem em guias próprias: **"PIS cumulativo · DARF 8109"** e **"COFINS cumulativa · DARF 2172"**, chaves `pis_cum\|<PJ>\|AAAA-MM` e `cofins_cum\|<PJ>\|AAAA-MM`, com o mesmo vencimento do PIS/COFINS (dia 25 do mês seguinte, antecipando o dia não útil) e o mesmo local (a matriz). Não têm crédito nem estorno. A retenção que o cliente fez ao pagar uma nota do 12.08 abate esta guia; a que sobra passa de mês nela, como "Saldo de &lt;mês&gt; · retenção que passou do mês anterior", com o aviso "Retenção maior que o débito". A guia só aparece no mês que tem nota no 12.08 (ou saldo). |
| Guia não cumulativa | "PIS · DARF 6912" e "COFINS · DARF 5856" ficam com as notas fora do 12.08, os créditos, os estornos do job faturado no 12.08 e o saldo credor. Chave e texto iguais aos de antes. Sem nota no mês, o rateio da guia vai pelos jobs dos estornos. ⚠️ 04/10/2026: os estornos deram lugar ao rateio proporcional do crédito (decisão 146); sem nota no mês, o rateio da guia vai pelos jobs dos custos com crédito. |
| Lucro presumido (Hitlab) | Sem mudança: uma guia de PIS e uma de COFINS, 8109 e 2172. |
| Aviso depois de emitir a NF | A nota do 12.08 confere também as guias cumulativas da competência (`guiasDaEmissaoParaConferir` recebe `cnaeCumulativo`). |
| CSLL do lucro real | DARF 6012 (era 6773). |

O total de imposto não muda; mudam o mês e o código. No exemplo dos testes
(nota de R$ 55.000,00 no 12.08 em novembro, num mês em que o crédito passa o
débito normal): antes, novembro não pagava nada, porque o crédito absorvia o
débito do 12.08, e dezembro pagava R$ 804,50 de PIS; agora, novembro paga
R$ 357,50 de PIS cumulativo, e dezembro, R$ 447,00 (COFINS: R$ 1.650,00 em
novembro e R$ 2.056,00 em dezembro, no lugar de R$ 3.706,00 em dezembro).

## 3. Base legal

- O crédito se desconta "do valor apurado na forma do art. 2º", o regime não
  cumulativo (Lei 10.833/2003, art. 3º, caput; para o PIS, Lei 10.637/2002).
  O débito cumulativo se paga inteiro.
- Cada código de receita vai num DARF: PIS 8109 e COFINS 2172 no cumulativo;
  6912 e 5856 no não cumulativo. A EFD-Contribuições separa as duas partes
  (registros M200 e M600) e detalha cada uma por código de receita (M205 e
  M605).
- CSLL: 6012 é a das PJs do lucro real no trimestre; 6773, o ajuste anual
  (tabela de códigos da Receita para a DCTF).

## 4. O que não mudou e o que fica em aberto

- O estorno do crédito do job faturado no 12.08 continua no mês da primeira
  nota: a EFD-Contribuições tem o ajuste de redução de crédito no próprio mês
  (M110 e M510), e a lei não escolhe entre esse caminho e retificar o mês do
  custo. ⚠️ 04/10/2026: o estorno saiu com a decisão 146 (rateio
  proporcional do crédito, sem vínculo ao job).
- O IRPJ do lucro real trimestral segue com 0220, o código de quem é
  obrigado ao lucro real; quem optou por ele usa 3373. A confirmar com a
  contabilidade.
- Nenhuma nota real no 12.08 e nenhuma guia aprovada até 04/10/2026: nada
  aprovado mudou de valor.

## 5. Arquivos

`lib/fiscal/codigos-darf.ts` (`CODIGOS_DARF_CUMULATIVO`, `codigoDarf` com a
opção `cumulativo`, CSLL 6012), `lib/fiscal/apuracao.ts`
(`ParteDoPisCofins`, `chaveDoPisCofins`, `guiaPisCofins` por parte,
`calcularApuracao` com as duas partes no lucro real), `lib/fiscal/faturar.ts`
e `app/(app)/financeiro/contas-a-receber/actions.ts` (o aviso da emissão).

## 6. Verificação

- `lib/fiscal/apuracao.test.ts`: as tabelas do protótipo atualizadas só onde
  a regra mudou (guias de PIS/COFINS da California de novembro e dezembro,
  as duas guias cumulativas de novembro, as aprovações e os títulos delas) e
  um teste próprio da regra: crédito que não abate o 12.08, retenção da nota
  do 12.08 na guia cumulativa e o saldo de retenção que passa de mês.
- 159 testes do fiscal, `tsc`, lint e `next build` limpos.
- Build de produção local (porta 3072): a Apuração mostra a CSLL do 4º
  trimestre com DARF 6012 e, em outubro, PIS 6912 e COFINS 5856 com o
  crédito das NFs de teste; sem guia cumulativa, porque ainda não há nota no
  12.08.
