# 183 — O "a apurar no recebimento" vira linhas da lista; a conta da Empresa Teste Presumido

**Data:** 2026-10-16
**Status:** aceita e implementada (16/10/2026).
**Quem decidiu:** Tiago, em 16/10/2026, sobre o protótipo das duas formas
(pendência 4 da [182](182-adiantamento-na-emissao-e-ajustes-da-apuracao.md)):
"Vamos com a opção A, pode implementar"; e "acho que não criou contas para
os novos CNPJs, e ainda estão vazios. Faça isso, para que tudo fique pronto
para os testes".
**Revê:** a [181](181-empresas-de-teste-e-apuracao-por-vencimento.md) (o
cartão "<PJ> · a apurar no recebimento" no fim da lista) e fecha a pendência
4 da [182](182-adiantamento-na-emissao-e-ajustes-da-apuracao.md).
**Migration:** `20261016600003_conta_da_empresa_teste_presumido.sql`.

## 1. As linhas "A apurar" na lista por vencimento

**Antes.** No lucro presumido pelo caixa (a Hitlab), PIS, COFINS, IRPJ e
CSLL só nascem quando o cliente paga. O que ainda falta receber aparecia num
cartão por PJ no fim da página, fora da ordem de vencimento.

**Agora (opção A do protótipo).** Cada imposto que vai nascer no
recebimento vira uma linha da própria lista, na data em que vai vencer:

- **PIS e COFINS:** uma linha por PJ e mês do recebimento previsto da
  parcela, com o vencimento da guia daquele mês (o mesmo que o motor dá).
- **IRPJ e CSLL:** uma linha por PJ e trimestre, com o acréscimo que as
  parcelas em aberto trazem ao trimestre (os números do fluxo de caixa,
  `irpjCsllAApurar`).
- A linha tem "previsão" sob a data, o código do DARF, "NF · parcela" sob a
  guia, o valor em itálico e a pílula tracejada **A APURAR** na situação.
  Ela não se aprova: o olho abre o pop-up com as parcelas (nota, recebimento
  previsto, a receber, PIS + COFINS, vencimento) e a frase do IRPJ/CSLL do
  trimestre.

**Filtros.** O chip **"A apurar"** (em Mostrar) mostra só essas linhas;
"Em aberto" e "Todas" as incluem. Elas seguem o atalho de CNPJ e o chip de
competência ou trimestre. Os filtros por coluna são das guias: com um deles
ligado, as linhas "A apurar" saem. Com a lista ordenada por uma coluna, elas
vão para o fim; sem ordenação, entram pela data.

**Resumo.** O topo ganha "A apurar no recebimento · N parcelas · R$ …",
só leitura. O cartão do fim da página saiu; o aviso de erro da projeção
continua.

**Hoje no banco** não aparece nenhuma linha "A apurar": a Hitlab não tem
nota com CNPJ emissor, e as 3 notas da Empresa Teste Presumido estão
canceladas. As linhas aparecem com a primeira nota de uma PJ do presumido
pelo caixa que ainda tenha parcela em aberto.

## 2. A conta da Empresa Teste Presumido

A 181 criou as duas PJs de teste. A Empresa Teste já tinha contas ("Conta
Teste", "Teste" e o cartão "ZZ Teste Empresa Teste"); a Empresa Teste
Presumido nasceu sem nenhuma. A migration cria a **"Conta Teste
Presumido"**: conta corrente no "Banco Teste", saldo inicial de
R$ 100.000,00 em 01/09/2026 (o mesmo da "Conta Teste"), sem empresa
gerencial (decisão 064). Ela aparece na Conciliação, visão "Teste".

## 3. A LC 224 é só do lucro presumido?

Na apuração, sim. A LC 224/2025 tratou o lucro presumido como benefício e
aumentou em 10% os percentuais de presunção (32% → 35,2% nos serviços) sobre
a receita acima de R$ 5 milhões no ano. Isso só atinge as PJs do presumido:
a Hitlab e a Empresa Teste Presumido. California, GoCrazy e Empresa Teste
estão no lucro real, que parte do lucro contábil e não usa presunção.

A mesma lei mexe em outros pontos que não passam pela Apuração: o IRRF sobre
juros sobre capital próprio subiu de 15% para 17,5% (art. 8º), e outros
benefícios fiscais federais foram reduzidos. Se California ou GoCrazy pagam
JCP ou usam algum benefício federal, isso fica a confirmar com a
contabilidade (pesquisa de 01/10/2026,
`docs/superpowers/specs/2026-10-01-modulo-fiscal-pesquisa-tributaria.md`).

## 4. Pendências (registradas a pedido do Tiago)

1. **LC 224 · receita de jan–set/2026 da Hitlab:** os três números, para
   lançar em Cadastros › Impostos › Parâmetros (182 §3, item 1).
2. **LC 224 · guias de IRPJ e CSLL do 1º ao 3º trimestre de 2026 da
   Hitlab:** trazer as guias pagas para conferir se o acréscimo da LC 224
   foi recolhido e incluí-las no sistema (o ajuste do ano, no 4º trimestre,
   desconta o que foi pago a mais).
3. **Rendimento de aplicação no lucro presumido:** quando houver conta de
   aplicação (182 §3, item 2).
4. **A Hitlab retém quando paga fornecedor?** O Tiago vai confirmar (182 §3,
   item 3).

## Arquivos

- `app/(app)/financeiro/fiscal/apuracao/a-apurar.tsx` (novo) —
  `projecoesDe`, `LinhaProjecao`, `ItemDoResumo` e `DialogoAApurar`.
- `app/(app)/financeiro/fiscal/apuracao/aba-apuracao.tsx` — as linhas na
  lista, o chip "A apurar", o item do resumo; sai o cartão do fim.
- `app/(app)/financeiro/fiscal/apuracao/dados.ts` — `aApurarIrpjCsll`.
- `supabase/migrations/20261016600003_conta_da_empresa_teste_presumido.sql`.
