# 086 — A nota avulsa nasce com rateio de regional

**Data:** 2026-09-16
**Decidido por:** Tiago
**Migrations:** `20260916110001_nota_avulsa_nasce_com_rateio.sql` e
`20260916110002_nota_avulsa_exige_rateio.sql` (esta depois do deploy de ff395c7)

Último lote da garantia de regional em todo lançamento, depois da
[069](069-a-regional-do-job-e-a-fonte.md) (a regional vem do job), da
[082](082-a-despesa-sem-job-nasce-com-rateio-e-a-recorrencia-vira-titulo-30-dias-antes.md)
(a despesa sem job nasce com rateio) e da
[084](084-o-ajuste-da-fatura-do-cartao-vira-compra-com-rateio.md) (o ajuste
da fatura do cartão).

---

## 1. O problema

A nota fiscal sem job — `faturamentos.origem_tipo = 'avulso'`, o
"Faturamento avulso" de Contas a Receber — não tinha de onde tirar regional.
Pela 069 a regional da receita vem do job da nota, e a avulsa não tem job:
o título previsto e a baixa dele entravam no fluxo de caixa e no DRE **sem
regional nenhuma**. A 069 e a 082 deixaram isso registrado como o próximo
lote.

Conferido antes de desenhar: não existe outro caminho de receita sem job. O
app não grava lançamento manual, e a receita de conta avulsa (natureza
entrada) já nasce com rateio desde a 082.

## 2. A regra

> **A nota avulsa leva rateio de regional, definido na emissão.** Uma
> regional ou várias, somando 100%. A nota de job ou de BV não leva — a
> receita fica na regional do job.

- **O rateio é da nota (1a).** Todas as parcelas de recebimento se dividem
  igual, e a baixa de cada uma — e o estorno dela — herda a divisão.
- **As regionais são da empresa emissora (1b)**, e ativas. A tela só oferece
  as da empresa escolhida, e o banco recusa as de outra.
- **Nota emitida não se edita (1c)**, e o rateio vai junto: não há escrita na
  tabela fora da emissão. Errou, cancela e emite de novo.
- **O "Job de referência" saiu do faturamento avulso (1d).** O campo dizia
  "Só para rastreio no DRE", mas o valor escolhido não ia para a action, não
  chegava ao banco e não tinha coluna. E contrariava a regra de que nada de
  job entra por fora (082): receita de job sai pela nota do job.

## 3. Onde fica

Contas a Receber → **Faturamento avulso**. Depois de **Empresa emissora**
aparece **Rateio de regional**, o mesmo editor das despesas sem job: antes
de escolher a empresa ele diz "Escolha a empresa emissora para ver as
regionais dela"; trocar de empresa limpa as regionais que não são dela. A
nota reaberta em leitura mostra a divisão gravada.

Na **Conciliação**, o detalhe do recebimento mostra a divisão da nota em
"Regional". No **fluxo de caixa**, o título previsto e o recebimento
realizado saem divididos por regional.

## 4. Banco

`20260916110001_nota_avulsa_nasce_com_rateio.sql` (aplicada em 16/09/2026):

- tabela **`faturamentos_regionais`** (`faturamento_id`, `regional_id`,
  `percentual`), com RLS: lê quem vê a nota; escrever, só a emissão. GRANT de
  leitura para `authenticated`, nada para `anon`;
- travas de forma: só nota avulsa tem linha aqui, e a soma é 100 (conferida
  no fim da transação);
- `emitir_faturamento` grava o rateio na mesma transação da nota, e confere
  regional escolhida, percentual, repetição, empresa emissora, regional ativa
  e soma;
- `vw_fluxo_caixa` ganha a CTE `fat_rateio`: o título previsto e a baixa
  (com o estorno) de nota com rateio se dividem por ela. Troca por trecho
  exato, com a migration parando se a view tiver mudado por baixo.

`20260916110002_nota_avulsa_exige_rateio.sql` — aplicada em 16/09/2026,
**depois** do deploy de ff395c7: nota avulsa sem rateio não entra mais, e o
rateio de uma nota avulsa não pode ser zerado. Conferida no fim da transação,
porque a nota nasce antes das linhas do rateio. Antes do deploy ela quebraria
a emissão avulsa da versão no ar, que não mandava rateio — a ordem que faltou
em 08/09/2026 e que a 084 seguiu.

## 5. Conferido em 16/09/2026

**Banco, em transação desfeita:** nota avulsa de R$ 1.000 em duas parcelas,
com rateio SP 60% / RJ 40% e a baixa de uma delas — a parcela aberta saiu no
fluxo como SP R$ 300 + RJ R$ 200 previstos, e a baixa como SP R$ 300 + RJ
R$ 200 realizados. Rateio em nota de job recusado; soma de 90% recusada ("O
rateio de regional da nota soma 90,00%; precisa somar 100%.").

**Pela tela** (Contas a Receber → Faturamento avulso, empresa Agência
California):

- sem o "Job de referência"; o rateio pedia a empresa antes; escolhida a
  empresa, a lista ofereceu **NE, NO, RJ, SP e SS** — nenhuma regional das
  outras empresas (Agency, Doca, Hitlab, Teste); na segunda linha, o SP da
  primeira sumiu da lista;
- com regional em branco: "No faturamento avulso, escolha a regional de cada
  linha do rateio."; com SP 60% + RJ 30%: "O rateio de regional da nota
  precisa somar 100%.";
- com SP 60% + RJ 40%, a nota **TESTE-086** (Pevetech, R$ 1.000,00, 2
  parcelas) foi emitida: no banco, o rateio SP 60 / RJ 40, os dois títulos de
  R$ 500 e a auditoria com `regionais_no_rateio: 2`; no fluxo, cada parcela
  como SP R$ 300 + RJ R$ 200;
- reaberta em leitura, mostrou "Rateio de regional · SP 60% · RJ 40%";
- baixa da parcela 1 pela tela, na Conta Teste: o lançamento foi gravado sem
  job e sem regional, como sempre, e o fluxo o dividiu em SP R$ 300 + RJ
  R$ 200 realizados;
- na Conciliação da Conta Teste, o detalhe do recebimento mostrou "Regional ·
  SP 60,00% · RJ 40,00%".

**Pelo transporte real da action**, sem gravar nada: nota avulsa sem rateio
("Rateio de regional: Adicione pelo menos uma regional."), nota de job com
rateio ("Só a nota avulsa leva rateio de regional…") e regional de outra
empresa, barrada pelo banco ("A regional Agency não é da empresa emissora da
nota.").

**A trava que exige o rateio**, testada em transação desfeita antes de
aplicar e de novo depois: nota avulsa com rateio passou; sem rateio, recusada
("Toda nota avulsa precisa de rateio de regional. Informe ao menos uma
regional."); apagar todo o rateio da TESTE-086, recusado; nota de job sem
rateio, seguiu passando.

## 6. O que ficou de fora

- ~~Os dados de teste da nota TESTE-086 (a nota, a baixa da parcela 1 e o PDF
  de teste no storage), esperando a decisão de apagar.~~ Apagados em
  16/09/2026, com a autorização do Tiago: a nota, os dois títulos, o
  lançamento da baixa, o item e o rateio (numa transação só, conferindo as
  contagens antes), e os dois PDFs de teste pela API do Storage. A nota não
  tem exclusão pela tela, por isso o SQL.
