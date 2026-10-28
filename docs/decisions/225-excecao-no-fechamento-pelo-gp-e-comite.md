# 225 — O GP registra a exceção no fechamento, e a versão vai ao Comitê

**Data:** 2026-10-28
**Status:** implementada em 28/10/2026.
**Quem decidiu:** Tiago, em 28/10/2026, a partir do aviso da
[224](224-parametros-do-job-na-abertura.md) de que só o administrador mudava
as três taxas do internacional: "pode permitir que o GP modifique isso e use
a função 'exceção', porém isso fará com que a aprovação da versão precise
passar pelo comitê de aprovações".
**Revê:** a [206](206-excecao-no-fechamento-do-internacional.md) (a Exceção
era só do administrador) e acrescenta uma regra à
[223](223-comite-de-aprovacoes.md).
**Migration:** `20261028500001_excecao_no_fechamento_pelo_gp_e_comite.sql`.

## O que muda

- O botão **Exceção** da versão internacional passa a aparecer também para
  o **GP** (`gerente_producao`): `orcamentos.excecao_fechamento` e o gatilho
  `versao_fechamento_internacional_no_padrao` aceitam os dois papéis.
- **Regra nova do Comitê:** "Exceção no fechamento do internacional", a
  última da seção **Abertura de job** em Comitê de Aprovações →
  Configurações (`comite_config.excecao_ligada`), **ligada por padrão**.
  Com ela ligada, a versão com exceção registrada só é aprovada pelo
  Comitê: o "Aprovar versão" do GP vira "Solicitar aprovação", e o quadro
  do motivo mostra as três taxas. O pop-up da Exceção avisa o GP.
- **O administrador** segue a chave "O administrador aprova direto na
  tela", como nas outras regras.

## Respostas do Tiago

1. Regra ligada por padrão, a última da seção "Abertura de job".
2. O administrador, como nas outras regras.
3. **Volta ao Comitê só se as taxas mudarem:** o pedido aprovado do
   orçamento cobre a exceção enquanto int. taxes, Impostos BR e custo de
   transação forem os do retrato aprovado (`comite_pedidos.snapshot.excecao`).
4. **De volta ao padrão, não volta ao Comitê:** a regra só pega com a
   exceção registrada; remover a exceção (taxas no padrão) tira a regra.

## Onde mora

- Banco: `comite_config.excecao_ligada`, `comite_regras`,
  `comite_retrato_da_excecao`, `comite_situacao_da_versao` (chave
  `excecao` e a cobertura pelas taxas), `comite_pedido_guarda` (retrato com
  as taxas), `versao_confere_limites_na_aprovacao` (a frase do motivo),
  `versao_fechamento_internacional_no_padrao` (o GP).
- TS: `RegrasDoComite.excecaoLigada` e `motivosDaVersaoNoComite`
  (`lib/calculos/limites-orcamento.ts`), `carregarComiteDaVersao`
  (`pegaExcecao`, `taxasDaExcecao`, `excecaoVaiAoComite`), a regra nas
  Configurações, a linha no quadro do motivo e o selo "Exceção no
  fechamento" na caixa do Comitê.

## Testes

- Banco, como o "GP Teste" (transação desfeita), no rascunho "ZZ Teste 225
  exceção pelo GP" (P-0006/26): o GP registrou a exceção (0,37% · 19,53% ·
  R$ 550); a situação ficou `regra` e `excecao` verdadeiras; aprovar foi
  recusado com "há exceção no fechamento do internacional"; de volta ao
  padrão, a regra saiu. Com um pedido aprovado pelo administrador, as mesmas
  taxas ficaram cobertas, int. taxes 0,50 não, e de volta a 0,37 sim.
- Tela, como administrador: a regra aparece ligada e por último na seção;
  o pop-up da Exceção abre sem o aviso do Comitê (o administrador aprova
  direto). A tela do GP não foi aberta (sem o link mágico).
