# 277 — A Apuração por CNPJ e o ajuste pela contabilidade (o 4º trimestre inteiro no sistema)

**Data:** 2026-11-23
**Status:** aceita. Implementadas em 23/11/2026: a entrega 1 (Apuração por CNPJ), a 2a (saldo credor da contabilidade, rateio por gerencial na aprovação e a regional da nota avulsa) e a 2b (Guia da contabilidade). Falta a 3 (guia já paga pela planilha).
**Quem decidiu:** Tiago, em 23/11/2026, sobre o protótipo do Fiscal (versões 6 a 8): "Acho que podemos agrupar os impostos de cada um dos CNPJs, ou separá-los em filtros"; "Ambos"; sobre a função de ajuste, "precisamos incluir uma função onde podemos ajustar a apuração para o valor real dependendo do envio da contabilidade, até tudo estar sendo lançado pelo sistema"; "precisamos fechar 4T com tudo no sistema batendo com a planilha"; "o rateio dos impostos entre as regionais deverá ser feito por percentual da receita (fora o caso de Hitlab, que se trata de Hitlab, e GoCrazy, que corresponderá a São Sebastião da California)"; e "ok" às recomendações.
**Revê:** a [181](181-empresas-de-teste-e-apuracao-por-vencimento.md) (a lista única por vencimento com o seletor de CNPJ) e a [183](183-a-apurar-na-lista-e-conta-da-empresa-teste-presumido.md) (a coluna CNPJ das linhas "A apurar").
**Migration:** nenhuma na entrega 1; `20261123400002_saldo_credor_da_contabilidade.sql` na 2a; `20261123400003_guia_da_contabilidade.sql` na 2b.

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

## 2. O 4º trimestre inteiro no sistema (entregas 2 e 3)

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
4. **Guia paga no histórico.** A guia já paga fora do sistema sai de A pagar com a data e a conta do pagamento, sem lançamento: o pagamento já está no histórico da planilha, que é por onde o DRE e o fluxo de caixa contam. Não nasce outro débito, para o pagamento não contar duas vezes. Nesse caminho, o PDF do DARF e o comprovante são opcionais. A ideia inicial (ligar a baixa às linhas da planilha) não serve: as linhas de 04/11 e 10/11 já estão conciliadas com o banco pelo histórico, e as de 20/11 esperam o extrato. O Tiago escolheu esta opção (A) em 23/11 e o nome "paga no histórico" (não "paga pela planilha").
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

## 4. Entrega 2b (implementada): a Guia da contabilidade

- **"+ Guia da contabilidade"** fica na faixa de cada CNPJ. Todo CNPJ tem a faixa, mesmo sem guia no filtro, para lançar por ela.
- **O diálogo** pede:
  - o imposto, com o código do DARF do regime do CNPJ;
  - o município, no ISS;
  - a competência, de julho/2026 até hoje, ou o trimestre e a cota no IRPJ/CSLL;
  - o vencimento, o valor e o motivo (mínimo de 10 caracteres);
  - o rateio por empresa gerencial.
- **A divisão entre regionais** vem da receita do período, lida no servidor (`lib/fiscal/receita-do-periodo.ts`). De outubro/2026 em diante, vem das notas do sistema. Antes, vem das notas do histórico da planilha (`historico_notas`, só a carga ativa e sem as canceladas), pela regional do job da planilha: `regional_id` ou a divisão `rateio_regional`, cujo código é o nome da regional (AGE = Agency, DOC = Doca).
- **A guia que o sistema já calcula** (mesmo CNPJ, competência e código, ou município no ISS) não se lança por aqui: o diálogo manda aprovar pela lista.
- **No banco:** `impostos_a_pagar.da_contabilidade` e a RPC `lancar_guia_da_contabilidade`. A RPC cria pelo `criar_imposto_avulso`, com as mesmas travas, marca a guia e registra a auditoria `fiscal.guia_da_contabilidade`. A origem continua `avulso`, então fluxo, conciliação, DRE e baixa a tratam como já tratavam.
- **Na Apuração**, a guia aparece no bloco do CNPJ, em "Aprovadas" e "Todas", como "guia da contabilidade · sem cálculo no sistema · Aprovada". A competência dela entra nos botões de competência. Em Impostos a Pagar, ela fica para a baixa.
- **Conferido no Sandbox** (Empresa Teste), pela tela:
  - PIS não cumulativo de setembro/2026, de R$ 2.450,00, sem receita no histórico do Sandbox, com a regional escolhida (Teste).
  - IOF do mútuo de novembro/2026, de R$ 1.000,00, com a regional pela receita das notas de novembro (Teste).
  - As duas guias aparecem em "Aprovadas" e em Impostos a Pagar, com o rateio e a auditoria no banco.
  - 191 testes do fiscal passam; `tsc`, lint e build limpos.

## 5. Entrega 3 (implementada): paga no histórico

- **No banco** (`20261123400004_imposto_pago_no_historico.sql`):
  - `impostos_a_pagar.pago_no_historico`.
  - A regra `chk_imposto_pago_consistente` aceita o pago sem comprovante só quando é no histórico. Para as linhas que já existiam, a regra é a mesma.
  - A RPC `marcar_imposto_pago_no_historico(imposto, data, conta, guia, comprovante)`: só admin e financeiro, só imposto A pagar, data até hoje (Brasília), as travas de conta da baixa (`_conta_da_baixa`). Não cria lançamento e registra a auditoria `fiscal.imposto_pago_no_historico`.
  - `cancelar_baixa_imposto` desfaz também a marca. O pago no histórico não tem lançamento a apagar.
- **Onde se marca:**
  - em Impostos a Pagar, nos detalhes do imposto ("Marcar como paga no histórico") e pelo link "Já foi paga e está no histórico da planilha?" do diálogo de baixa;
  - na Guia da contabilidade, com a caixa "Já foi paga": a guia entra aprovada e já paga;
  - no painel de aprovação, com a mesma caixa, só na guia de um título. Com cotas, cada cota se marca em Impostos a Pagar.
- **A conferência:** escolhidas a data e a conta, a tela lê as linhas de imposto do histórico da planilha naquele dia e naquela conta, agrupadas pela descrição (`lib/fiscal/pago-no-historico.ts`). O grupo que soma o valor da guia aparece como "bate com a guia". A linha de crédito ("PIS CRÉDITO") soma no grupo do imposto, porque a planilha abre o PIS e a COFINS não cumulativos em débito cheio menos crédito. Sem linha nenhuma, a tela avisa: marcar como paga um pagamento que não está no histórico tira a saída do DRE e do fluxo.
- **Como aparece:** o status do imposto em Impostos a Pagar diz "Pago dd/mm/aaaa · no histórico". O olho abre "Paga no histórico", com "Desfazer: voltar a A pagar". Na Apuração, a guia da contabilidade diz "paga no histórico".
- **Conferido no Sandbox** (Empresa Teste), pela tela, logado como admin:
  - O PIS de setembro foi marcado em Impostos a Pagar (sem linha no histórico do Sandbox, com o aviso). Depois foi desfeito, e voltou a A pagar.
  - A COFINS de setembro, de R$ 1.234,56, foi lançada como Guia da contabilidade já paga.
  - O ISS próprio de novembro, de R$ 2.431,01, foi aprovado já pago.
  - Nos três, nenhum lançamento, e a auditoria ficou no banco.
  - A trava de papel também funcionou: no meio do teste, outra sessão trocou o login do 127.0.0.1 para o GP do Sandbox, e a conferência respondeu "Apenas admin ou financeiro" (`acao_negada` no audit).
- **Conferido na produção, só leitura:** a regra da conferência acha o ISS de 04/11 (11 linhas, R$ 175.230,82, e o de R$ 9.787,91) e o PIS/COFINS de 20/11 (R$ 42.805,20 e R$ 338.470,20, débito menos crédito).
- Os testes de fiscal, financeiro e conciliação passam (368). `tsc` e lint estão limpos.

## 6. Ajustes depois da carga de 23/11 (implementados)

A carga das 12 guias pagas em outubro (feita pela tela, na produção) mostrou três defeitos:

- **Mútuos contava o IOF duas vezes.** A tela de mútuos soma o IOF do histórico (`mutuos_iof_historico`, pela linha do extrato) e soma também a guia de IOF paga. Uma guia paga no histórico pode ser o mesmo pagamento. Agora ela só soma quando o histórico não tem um pagamento do mesmo CNPJ e valor (`guiasDeIofAContar`, `lib/financeiro/mutuo.ts`). A guia baixada no sistema sempre soma.
- **A sugestão do rateio ficava em R$ 0,00** quando o valor da guia era digitado depois de a receita do período carregar. Agora, enquanto a pessoa não mexe no rateio, a sugestão refaz a conta com o valor da guia. Vale na Guia da contabilidade e no painel de aprovação.
- **A conferência trazia linhas que não são de imposto**: a palavra "tributo" aparece em descrição de serviço na planilha ("tributo" a uma banda). Ela saiu da lista de palavras.

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

## Arquivos (entrega 2b)

- `supabase/migrations/20261123400003_guia_da_contabilidade.sql`.
- `lib/fiscal/receita-do-periodo.ts` (+ teste): a receita do período pelas notas do sistema ou pelo histórico.
- `app/(app)/financeiro/fiscal/apuracao/actions.ts`: `previaDaReceitaDoPeriodo` e `lancarGuiaDaContabilidade`.
- `app/(app)/financeiro/fiscal/apuracao/guia-da-contabilidade.tsx`: o diálogo e a linha; `aba-apuracao.tsx` (faixa, linhas, contagens, competências) e `dados.ts` (`guiasDaContabilidade`); `rateio-por-gerencial.tsx`.

## Arquivos (entrega 3)

- `supabase/migrations/20261123400004_imposto_pago_no_historico.sql`.
- `lib/fiscal/pago-no-historico.ts` (+ teste): a conferência com o histórico.
- `app/(app)/financeiro/fiscal/impostos/pago-no-historico.tsx`: o diálogo, os campos embutidos e a conferência; `actions.ts` (`marcarImpostoPagoNoHistorico`, `linhasDoHistoricoNoDia`); `dialogos.tsx` (o link na baixa, "Paga no histórico" e o desfazer); `aba-impostos.tsx`; `dados.ts`.
- `app/(app)/financeiro/fiscal/apuracao/`: `actions.ts` (`aprovarGuia` e `lancarGuiaDaContabilidade` com `pago_no_historico`), `memoria-dialog.tsx`, `guia-da-contabilidade.tsx`, `aba-apuracao.tsx`, `dados.ts` (as contas e a marca).
- `lib/financeiro/planilha-de-titulos.ts` (+ teste), `components/financeiro/planilha-de-titulos/planilha.tsx` e `app/(app)/financeiro/conciliacao/linhas-da-aba.ts`: o `pagoNoHistorico` da linha e o "no histórico" no status.
- `lib/types.ts`: `ImpostoAPagar.da_contabilidade` e `pago_no_historico`.
