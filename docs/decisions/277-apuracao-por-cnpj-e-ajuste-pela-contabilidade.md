# 277 — A Apuração por CNPJ e o ajuste pela contabilidade (o 4º trimestre inteiro no sistema)

**Data:** 2026-11-23
**Status:** aceita. Implementadas em 23/11/2026: a entrega 1 (Apuração por CNPJ) e a entrega 2a (saldo credor da contabilidade, rateio por gerencial na aprovação e a regional da nota avulsa). Faltam a 2b (Guia da contabilidade) e a 3 (guia já paga pela planilha).
**Quem decidiu:** Tiago, em 23/11/2026, sobre o protótipo do Fiscal (versões 6 a 8): "Acho que podemos agrupar os impostos de cada um dos CNPJs, ou separá-los em filtros"; "Ambos"; sobre a função de ajuste, "precisamos incluir uma função onde podemos ajustar a apuração para o valor real dependendo do envio da contabilidade, até tudo estar sendo lançado pelo sistema"; "precisamos fechar 4T com tudo no sistema batendo com a planilha"; "o rateio dos impostos entre as regionais deverá ser feito por percentual da receita (fora o caso de Hitlab, que se trata de Hitlab, e GoCrazy, que corresponderá a São Sebastião da California)"; e "ok" às recomendações.
**Revê:** a [181](181-empresas-de-teste-e-apuracao-por-vencimento.md) (a lista única por vencimento com o seletor de CNPJ) e a [183](183-a-apurar-na-lista-e-conta-da-empresa-teste-presumido.md) (a coluna CNPJ das linhas "A apurar").
**Migration:** nenhuma na entrega 1; `20261123400002_saldo_credor_da_contabilidade.sql` na 2a.

## 1. A Apuração por CNPJ (entrega 1, implementada)

- **Botões de CNPJ** abaixo de "Mostrar" e "Competência", como os de competência: "Todos" e um por CNPJ com guia, cada um com a contagem do filtro "Mostrar". Substituem o seletor do canto direito.
- **Um bloco por CNPJ**, na ordem do cadastro, com a faixa do grupo (`FAIXA_GRUPO_LISTA`, a mesma da lista da Conciliação). Na faixa:
  - nome, CNPJ da matriz e regime;
  - o que vence primeiro, com o prazo;
  - quantas guias estão a aprovar e em curso, e quantas linhas "A apurar";
  - o total a aprovar, sob o Apurado;
  - "Aprovar as N pelo calculado", só daquele CNPJ.

  Clicar na faixa recolhe o bloco. Dentro do bloco, a ordem continua a de vencimento. O "Aprovar as N guias pelo valor calculado" do resumo continua valendo para todos.
- **A coluna CNPJ vira "Local"**: o município da guia de ISS ou "Federal". O CNPJ está na faixa.
- **O imposto por extenso**: "PIS não cumulativo" (6912) e "COFINS não cumulativa" (5856), em vez de "PIS" e "COFINS". O código do DARF vai numa linha menor, com a explicação na dica. O código é o número impresso na guia que diz à Receita qual imposto está sendo pago. O mesmo nome vale no diálogo do "Aprovar pelo calculado" e no filtro da coluna Guia.
- **Larguras**: o espaço da coluna CNPJ foi para Base, Débito e Apurado. As larguras foram medidas pelos maiores valores reais de 23/11/2026 (R$ 46.500.000,00 na base do IOF e R$ 2.661.685,92 no débito do IRPJ do 4º trimestre) na tela de 1.616 px. Antes, esses valores passavam da coluna.

## 2. O 4º trimestre inteiro no sistema (entregas 2 e 3, a fazer)

As regras combinadas para lançar os impostos que foram pagos fora do sistema, até tudo sair pelo sistema batendo com a planilha:

1. **Todo imposto pago no 4º trimestre entra com o valor do DARF.** Inclui o de competência anterior: o ISS e o PIS/COFINS de setembro, pagos em outubro, e as cotas do IRPJ/CSLL do 3º trimestre.
   - Da competência outubro em diante, a guia é aprovada na Apuração pelo "Valor da guia (contabilidade)", com justificativa quando difere do calculado. Isso já existe.
   - O que o sistema não calcula entra como **"Guia da contabilidade"**, um botão na faixa do CNPJ. A guia entra aprovada, com o motivo, e vai para Impostos a Pagar.
2. **Saldo credor da contabilidade.** Ao aprovar o PIS ou a COFINS não cumulativos, o saldo credor que a contabilidade levou para o mês seguinte substitui o calculado. Hoje o mês seguinte parte do saldo calculado, mesmo quando a guia aprovada foi outra.
3. **Rateio.**
   - O valor de cada empresa gerencial é o da planilha, somando os trimestres do job. A "CMH" da planilha é a CCH do sistema.
   - Dentro de cada gerencial, as regionais dividem pela receita da competência da guia: o mês, ou o trimestre no IRPJ/CSLL.
   - Exceções: Hitlab → regional Hitlab; GoCrazy → SS da California. A "Distribuição de lucro" das guias da GoCrazy também vai para California · SS.
   - Antes de outubro, a receita vem das notas do histórico da planilha, que trazem a regional de cada job.
4. **Guia já paga pela planilha.** A baixa entra na data e na conta do banco, ligada às linhas da planilha que registram o pagamento (a soma tem de fechar). Não nasce outro débito, para o pagamento não contar duas vezes no extrato, no fluxo e no DRE. Nesse caminho, o PDF do DARF é opcional e pode ser anexado depois.
5. **IRPJ e CSLL da California que somam zero** na planilha (as três cotas do 3º trimestre: os créditos anulam e não houve DARF) ficam fora do Fiscal.

O inventário das 52 guias do 4º trimestre (de 01/10 a 31/12, com o valor por gerencial) foi lido da planilha de 23/11. Ele fica fora do git, por ter os valores do financeiro.

## 3. Entrega 2a (implementada)

- **Saldo credor da contabilidade.**
  - `fiscal_aprovacoes.saldo_credor_contabil` guarda o saldo.
  - A RPC `definir_saldo_credor_contabil(tenant, chave, valor)` grava ou limpa o saldo. Ela só aceita admin e financeiro, só a guia de PIS ou COFINS não cumulativos já aprovada, e registra auditoria (`fiscal.saldo_credor_contabil`).
  - Ao aprovar, o campo "Saldo credor para o mês seguinte (contabilidade)" aparece no painel. Na guia já aprovada, o saldo se informa ou se corrige depois, com a opção de voltar ao calculado.
  - O motor (`calcularApuracao`) faz o mês seguinte partir do saldo da contabilidade, e a memória diz "o saldo que a contabilidade levou do mês anterior". A linha mostra "saldo credor R$ X (contabilidade)".
- **Rateio por empresa gerencial na aprovação.**
  - O painel tem o valor de cada gerencial (a sugestão vem do rateio do sistema) e, abaixo, as regionais pela regra.
  - O servidor confere e monta o rateio com `rateioPorGerencial` (`lib/fiscal/rateio-gerencial.ts`). As regras vêm do banco, por `carregarRegrasDoRateio`:
    - a regional padrão do CNPJ (`empresas_contabeis.regional_padrao_id`; a GoCrazy aponta para SS) leva a parte da gerencial do CNPJ inteira;
    - a empresa de uma regional só vai inteira para ela;
    - sem receita no período, a regional é escolhida;
    - a parte sem regional da receita fica fora da divisão.
  - O "Aprovar pelo calculado" (o lote) continua com o rateio do sistema.
- **A nota avulsa entra pelo rateio de regionais dela** (`faturamentos_regionais`, decisão 086). Até aqui ela caía na empresa, sem regional. Isso pesava porque as notas da planilha carregadas pela 276 são avulsas, com a regional do job da planilha.
- **Conferido no Sandbox** (Empresa Teste), pela tela, logado como admin:
  - A COFINS de outubro foi confirmada com o saldo da contabilidade de R$ 1.000,00 (o calculado era R$ 1.368,00). A COFINS de novembro passou a partir dele: o apurado foi de R$ 4.780,24 para R$ 5.148,24.
  - A COFINS de novembro foi aprovada com R$ 4.000,00 na Empresa Teste (pela receita, regional Teste) e R$ 1.148,24 na Agência California (sem receita no CNPJ, regional escolhida). O título nasceu com essas duas partes.
  - Testes do fiscal: 189 passando, incluindo o motor, a nota avulsa e as regras do rateio. `tsc`, lint e build limpos.

## Arquivos (entrega 1)

- `app/(app)/financeiro/fiscal/apuracao/aba-apuracao.tsx`: botões de CNPJ, blocos, faixa, lote por CNPJ, coluna Local e larguras.
- `app/(app)/financeiro/fiscal/apuracao/ui.tsx`: `NOME_DO_CODIGO`, `tituloPorExtenso`, `NomeDaGuia`, `cnpjBr`; o `nomeGuia` por extenso.
- `app/(app)/financeiro/fiscal/apuracao/a-apurar.tsx`: a linha "A apurar" no bloco (`semCnpj`) e com o nome por extenso.

## Conferido (entrega 1)

- Na produção, só leitura: três blocos (California, GoCrazy, Hitlab) e os botões de CNPJ com contagem.
  - O botão "GoCrazy" deixa só o bloco dela.
  - A faixa recolhe as 16 linhas da California.
  - O "Aprovar" do bloco da GoCrazy lista só as guias dela. Foi cancelado, sem aprovar.
  - Nenhuma célula passa da coluna.
- `tsc`, lint, os 181 testes do fiscal e o build.

## Arquivos (entrega 2a)

- `supabase/migrations/20261123400002_saldo_credor_da_contabilidade.sql`.
- `lib/fiscal/apuracao.ts` (+ teste): `AprovacaoFiscal.saldo_credor_contabil` e o saldo do mês seguinte.
- `lib/fiscal/apuracao-fatos.ts` (+ teste): o saldo da aprovação e a nota avulsa pelas regionais dela.
- `lib/fiscal/rateio-gerencial.ts` (+ teste) e `lib/fiscal/rateio-gerencial-dados.ts`: a regra e as regras lidas do banco.
- `app/(app)/financeiro/fiscal/apuracao/actions.ts`: `aprovarGuia` com `rateio_gerencial` e `saldo_credor_contabil`; `informarSaldoCredorDaContabilidade`.
- `app/(app)/financeiro/fiscal/apuracao/rateio-por-gerencial.tsx`, `memoria-dialog.tsx`, `aba-apuracao.tsx`, `dados.ts`, `aprovacao.ts`; `lib/types.ts`.

