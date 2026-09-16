# 082 — A despesa sem job nasce com o rateio, e a recorrência vira título 30 dias antes

**Data:** 2026-09-15
**Status:** aceita
**Contexto:** contas a pagar — conta avulsa, recorrência e desembolso — e
a `vw_fluxo_caixa`. Continua a [069](069-a-regional-do-job-e-a-fonte.md).

## As regras

1. **Avulsa e recorrente não têm job**, como o desembolso desde 10/09.
   Nas palavras do Tiago: *"tudo do job deverá estar contabilizado em sua
   planilha, então nada poderá vir por fora."*
2. **Todo lançamento tem regional**, e se tiver mais de uma, **o rateio é
   definido na criação** (e, no desembolso, exigido de novo na aprovação).
3. **A ocorrência da recorrência vira título 30 dias antes do vencimento.**
   Antes disso ela é previsão no fluxo de caixa.

## 1. Sem job

O campo Job saiu dos formulários, das telas de detalhe, das validações e
das ações de avulsa e recorrente. No banco, CHECK
`conta_avulsa_nao_tem_job` e `recorrente_nao_tem_job`; as colunas ficam,
vazias, porque removê-las é destrutivo. As duas tabelas estavam com 0
linhas.

Com isso some o "força 100% na regional do job" que as duas ações tinham,
e a lista de Títulos a Pagar para de buscar jobs só para alimentar o
drawer (uma consulta de até 500 linhas a menos por carregamento).

## 2. O rateio nasce junto

A tela gravava a despesa numa requisição e o rateio em outra, e por isso
o banco não conseguia exigir o rateio: uma trava no insert dispararia
antes de ele existir. Agora quatro funções gravam as duas coisas numa
transação só — `criar_conta_avulsa`, `substituir_rateio_conta_avulsa`,
`criar_conta_recorrente` e `substituir_rateio_conta_recorrente` —, todas
SECURITY INVOKER, com a RLS de quem chama.

A trava (`trg_avulsa_exige_rateio`, `trg_avulsa_rateio_nao_zera` e as
duas da recorrência) é um constraint trigger adiado: a despesa não
termina a transação sem ao menos uma linha de rateio, e nenhuma troca de
rateio a deixa sem. Excluir a despesa inteira continua valendo.

O estorno de compra no cartão também passou a nascer com o rateio da
compra na mesma transação. Antes a cópia vinha numa segunda requisição e,
se falhasse, o estorno ficava sem regional.

⚠️ **Ordem de aplicação.** A migration da trava
(`20260915210003`) só entra no banco depois de o código que grava tudo
junto estar no ar. Com o código antigo ela recusaria toda criação de
avulsa — o erro de 08/09.

## 3. Quando a recorrência vira título

Postas ao Tiago três opções, com exemplo em cada frequência (a California
paga fornecedor nas janelas dos dias 08 e 20):

| Opção | Aluguel mensal, vence dia 05 | Seguro anual, vence 15/03 | Quinzenal, dias 10 e 25 |
|---|---|---|---|
| Só a próxima é título | título de 05/10 existe desde 05/09 | fica **12 meses** aberto | 1 título aberto |
| Virada do mês | nasce em 01/10, **depois da janela do dia 20** em que teria de ser pago | nasce em 01/03 | 2 títulos nascem no dia 1 |
| **30 dias de antecedência** ✅ | nasce em 05/09 | nasce em 13/02 | cerca de 2 títulos abertos |

Escolhida a de 30 dias: na mensal dá o mesmo que "só a próxima", não
deixa a anual aberta um ano e garante o título antes da janela de
pagamento, qualquer que seja o dia do vencimento.

**Como funciona.**

- A rotina diária (6h) e a própria tela — ao criar, editar e reativar —
  geram como título toda ocorrência que vence em até 30 dias. Data que já
  virou título não é gerada de novo. O 30 mora em
  `recorrencia_antecedencia_dias()`.
- O que vem depois é **previsão**, calculada na leitura a partir da
  recorrência (mesmo princípio da [004](004-previsao-de-desembolso.md) e
  da [018](018-previsoes-no-fluxo-de-caixa.md)): nada é gravado. Aparece
  no fluxo de caixa como "Recorrência prevista", até o fim do 12º mês à
  frente ou até a data de fim, com o valor e o rateio da recorrência.
- **Editar a recorrência muda as previsões na hora; os títulos já criados
  ficam como nasceram**, e podem ser editados um a um.
- **Pausar** apaga as previsões e mantém os títulos.
- No **cartão**, a ocorrência grava `data_compra` = dia da cobrança, que é
  o que escolhe a fatura; a previsão cai no vencimento da fatura, como o
  título. Sem isso a cobrança cairia na fatura aberta no dia da geração —
  30 dias cedo.
- Na rotina diária cada recorrência roda isolada: uma que falhe não
  derruba as outras. Recorrência sem rateio não gera nada.

No fluxo de caixa, o grupo de previsões passou de "Só previsão (abertura
do job)" para "Só previsão (jobs e recorrências)", porque deixou de ser só
da abertura. No fluxo por job o rótulo antigo continua certo.

## Conferido

- **Banco, em transação desfeita (14 casos):** avulsa com job barrada;
  rateio vazio recusado; avulsa e recorrência sem rateio barradas no fim
  da transação; troca de rateio sem deixar a conta vazia; exclusão com
  cascade; mensal vencendo em 10 dias gera 1 título e 12 previsões, sem
  repetir; quinzenal gera 2; anual a 200 dias não gera título; data de fim
  gera a última e desativa; no cartão a cobrança de 05/10 cai na fatura
  que fecha em 25/10; recorrência sem rateio não gera e não trava a
  rotina; a função da tela exige sessão.
- **Navegador, logado, pelos fluxos reais:** os dois drawers sem campo de
  Job; avulsa criada com rateio (AV-00001); recorrência mensal criada e
  com o título de 25/09 aparecendo na hora em Títulos a Pagar; detalhe da
  recorrência com "Próxima prevista"; 12 previsões no fluxo de caixa;
  edição de valor de R$ 2 para R$ 3 mudando as previsões e mantendo o
  título em R$ 2, sem duplicar.

## Em aberto

- Pagamento e ajuste da fatura de cartão (próximo lote).
- ~~Recebimento avulso: a emissão da nota sem job passa a pedir regional
  (lote seguinte).~~ Resolvido em 16/09/2026 — ver a
  [086](086-a-nota-avulsa-nasce-com-rateio-de-regional.md).
- ~~A conciliação lê `lancamentos_financeiros` direto (ver a 069).~~
  Resolvido em 15/09/2026, na mesma frente — ver a 069.

## Referências

- `supabase/migrations/20260915210001_despesa_nasce_com_rateio.sql`
- `supabase/migrations/20260915210002_recorrencia_vira_titulo_30_dias_antes.sql`
- `supabase/migrations/20260915210003_despesa_sem_job_e_rateio_obrigatorio.sql`
- `supabase/migrations/20260915210004_permissoes_das_funcoes_da_recorrencia.sql`
- `docs/handoffs/HANDOFF_FINANCEIRO.md`, seção do `regional_id`
