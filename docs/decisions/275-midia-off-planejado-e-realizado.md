# 275 — Mídia Off, entrega 5: planejado e realizado (encerrar antes, estender)

**Data:** 2026-11-23
**Status:** aceita e implementada (23/11/2026).
**Quem decidiu:** Tiago — 15/10/2026 (encerrar antes, opção 1c; realizado sem errata), 23/11/2026 (visão única, opção A; as cinco escolhas do protótipo confirmadas; a previsão do financeiro "ajusta sozinha"). Protótipo aprovado: https://claude.ai/artifact/B1GUS2L5Vw7WpeZwSsEH7J.
**Continua:** a [274](274-midia-off-veiculos-do-mes.md) (entrega 4), a [273](273-midia-off-pp-do-repasse-e-encerramento.md) (entrega 3) e a [167](167-job-da-midia-off-abrir-e-faturar.md).
**Segue o modelo de:** a [224](224-parametros-do-job-na-abertura.md) (a previsão acompanha a diferença do mês, como na edição do orçado pelo financeiro) e a [219](219-os-tres-meses-do-trimestre.md) (o mês novo entra na versão aprovada).
**Migrations:** `20261123500004_realizado_da_midia.sql`; nas pendências de 23/11, `20261123500005_bv_da_midia_com_nome_na_fila.sql` e `20261123500006_data_do_job_acompanha_a_extensao.sql`.

## O que aconteceu

A campanha de mídia muda com o job aberto: o cliente encerra uma veiculação
antes do fim, ou pede mais dias. O Tiago pediu (15/10/2026) que o cliente
pague só o que foi ao ar, que a extensão seja ganho registrado, e que tudo
fique registrado sem passar pela errata. Em 23/11 ele trocou a chave
Planejado | Realizado do protótipo por uma **visão única**.

## A regra

1. **Visão única (opção A).** A planilha do job mostra a campanha como está.
   O bloco segue azul (ORÇADO); só a linha que mudou fica laranja, com o
   valor inicial riscado embaixo; a inserção que não foi ao ar e o fim
   planejado ficam riscados; a extensão é a linha vermelha do nacional, com
   a pastilha "Extensão". O planejado inicial é a versão aprovada.
2. **Card "Planejado e realizado"**, acima da planilha: valor do job,
   faturamento e resultado — inicial → atual —, os botões "Encerrar
   veiculação antes" e "Estender veiculação", e o registro de cada mudança
   (antes → depois, motivo, quem e quando). O cabeçalho do job se divide em
   inicial e atual, como na errata.
3. **Encerrar antes** (1c): o último dia no ar e as linhas que iam ao ar
   depois dele (marcadas, desmarcáveis). Na grade, as inserções depois do
   dia saem; no período, o fim vira o dia e o negociado é o proporcional aos
   dias que ficaram, sugerido e editável (nunca acima do que a linha tinha).
   Linha que não chega a ir ao ar fica "Cancelada". Na A · Repasse cuja PP
   já passa da nota que fica, o pop-up avisa para ajustar a PP — não trava.
4. **Estender** (escolha 1, confirmada): a extensão é **linha nova**, sem
   planejado inicial, no unitário da linha de origem, no mês dela ou num dos
   dois seguintes. Grade: dias e inserções; período: início, fim e o
   negociado (o da linha por dia × os dias, sugerido e editável). Se o mês
   não está no job, ele entra — na versão aprovada e no job, com faturamento
   próprio. Na A · Repasse a extensão tem a PP do repasse dela.
5. **AP e PI de antes da extensão não a cobrem** (escolha 2): o veículo com
   extensão no mês volta a pedir "AP da extensão" / "PI da extensão" até um
   documento anexado depois dela.
6. **O mês enviado não muda** (escolha 4): as linhas de mês já enviado ao
   faturamento (pela produção ou pelo financeiro) ficam fora do encerramento,
   e a extensão não vai para mês enviado. Os meses não precisam ir em ordem.
7. **Motivo opcional** (escolha 5).
8. **O financeiro acompanha sozinho** (Tiago, 23/11/2026, "Ajusta sozinha"):
   - os espelhos do job (`valor_total`, `faturamento_previsto`) passam a ser
     os de hoje; os da abertura não mudam;
   - a previsão de recebimento de cada mês muda pela diferença do
     faturamento do mês; o mês novo da extensão ganha a previsão dele, no
     mesmo dia e na mesma distância do último mês (dezembro recebe em 10/01
     → janeiro recebe em 10/02);
   - a previsão de impostos muda pela diferença do imposto do job,
     espalhada pelas parcelas, como na edição do orçado pelo financeiro
     (224). A curva de desembolso não acompanha, como lá.
   Sem travar o envio e sem revisão da abertura.
9. **Quem faz:** administrador e GP — os mesmos que enviam o mês ao
   faturamento (`jobs.enviar_faturamento`), com o job aberto.
10. **Resultado no cabeçalho:** o planejado é o inicial (as notas da versão
    aprovada); o realizado soma o BV do veículo recebido, líquido do imposto
    dele (o protótipo aprovado).

## No código

- Regra pura: `lib/calculos/midia-off.ts` — `diasEntre`,
  `proporcionalDoPeriodo`, `veiculaDepois`, `cortarLinha`,
  `linhaDaExtensao`, `negociadoPorDia`, `infoDoRealizado`; e, nos veículos
  do mês, `extensaoEm` / `apAntesDaExtensao` (testes em `midia-off.test.ts`).
- Gravação: `realizado/actions-midia-realizado.ts` (`encerrarVeiculacaoAntes`,
  `estenderVeiculacao`: as linhas, os espelhos, as previsões) →
  `registrar_alteracao_da_midia`.
- Tela: `realizado/realizado-da-midia.tsx` (o card e os dois pop-ups);
  `midia/secoes.tsx` e `midia/planilha-midia.tsx` (`realizadoDoJob`, as
  marcas); `planilha-midia-do-job.tsx` (`realizado`, `cardDoRealizado`);
  `job-realizado-section.tsx` monta tudo.
- Leitura: `carregar-detalhe.ts` (`midia.realizado`: a versão aprovada e o
  registro; `aberturaMidia` para o cabeçalho); `lib/data/midia-do-job.ts`
  (a data da extensão na trava do envio).

## Banco

`20261123500004`: `jobs_midia_alteracoes` (a mudança: tipo, data, motivo,
quem) e `jobs_midia_alteracoes_linhas` (cada linha, com o antes e o depois),
RLS na forma de conjunto (ler: o tenant; gravar: administrador e GP), GRANT
só para `authenticated`; `jobs_itens_orcado.midia_extensao_id` (a linha
nascida de extensão — não é linha vermelha, que tem orçado zero); a função
`registrar_alteracao_da_midia`, que confere o papel, o job, o mês enviado e
que cada linha é do job, e grava tudo numa transação. Aditiva.

## Conferido no Sandbox (23/11/2026)

**TES-1026/26**, com o GP de teste:
- **Encerrar antes em 05/11**, uma das duas linhas de TV de novembro: 7 → 3
  inserções (R$ 7.700,00 → R$ 3.300,00). Previsão de novembro R$ 1.601,60 →
  R$ 1.144,00; impostos −R$ 89,37; valor do job R$ 32.001,60 → R$ 28.024,00;
  a abertura preservada.
- **Na tela:** a linha "Encerrada em 05/11", o dia 10 riscado e os valores
  iniciais riscados; o cabeçalho dividido; o card com o registro.
- **Estender o outdoor de dezembro** para 01 a 15/01/2027 (mês novo):
  R$ 9.677,42 sugeridos, janeiro entrou na versão e no job. Previsão de
  janeiro criada em 10/02/2027 com R$ 8.748,39; impostos +R$ 196,56.
- **Janeiro na tela:** a linha vermelha "Extensão", "Em veiculação até 15/01"
  na régua, o card dos veículos pedindo AP, PI e a PP do repasse, o "Gerar
  PP" na calha e a trilha "Campanha no ar até 15/01/2027".
- **Sem regressão:** dezembro (já faturado pelo financeiro) ficou fora do
  encerramento; TES-1027/26 (finalizado) com o card sem botões; TES-1025/26
  (nacional) sem mudança.

## Pendências fechadas (23/11/2026, Tiago: "Confira, corrija e valide")

Conferidas no Sandbox, no TES-1026/26:

1. **BV de mídia sem nome na fila do financeiro** → "BV — praça ·
   agrupamento · MM/AAAA" (migration `20261123500005`, só a descrição do
   BV em `vw_faturamento_pendente`; contagem, soma e linhas da parte do job
   e da do BV idênticas antes e depois). Na tela do Contas a Receber:
   "BV — Salvador/BA · OOH · Outdoor · 9 x 3 m (lona) · 12/2026".
2. **A data do job acompanha a extensão** (migration `20261123500006`):
   `registrar_alteracao_da_midia` recebe o último dia no ar da extensão e
   move `jobs.data_fim_prevista` só para frente. Encerrar antes não mexe na
   data. Teste: extensão da TV de novembro para 20 e 22/01/2027 → período
   01/11/2026 → 22/01/2027.
3. **Textos do nacional:** o cabeçalho dividido diz "antes das mudanças da
   veiculação" (`mudancaDepoisDaAbertura="veiculacao"` no
   `ResumoResultado`); o BV do veículo diz que não desconta da planilha e
   que o líquido entra no resultado realizado quando é recebido
   (`daMidia` no `BvDialog`).
4. **PP do repasse de ponta a ponta:** PP-00958 (R$ 16.000) enviada com a
   NF pelo GP, aprovada e baixada pelo administrador; o veículo passou a
   "Na PP do repasse (paga)" e a trilha do encerramento perdeu "1 PP em
   aberto".
5. **"Item" do PDF da PP:** sem item, "praça · veículo" (`nomeDaLinhaDoJob`),
   também na origem da lista de PPs, no Comitê, na conclusão do item e nos
   avisos do encerramento. PDF da PP-00959: "Item: Salvador/BA · Fornecedor
   Teste".
6. **Previsão de impostos sem mês:** conferido, fica como está. A previsão
   de impostos da abertura é uma lista livre (data e valor), sem mês, e a
   edição do financeiro (224) já espalha a diferença do mesmo jeito.

**Achado no teste e corrigido:** a PP sugerida para a extensão de 15 dias
num mês de 31 vinha com D/M 0,968 (a PP guarda 3 casas) e passava R$ 2,06
da nota. `decomposicaoDoRepasse` agora faz a conta com as casas da PP e,
quando não fecha no centavo, sugere valor × 1 × 1 (PP-00959: R$ 7.741,94).

**Card "Erratas" fora da Mídia Off** (Tiago, 23/11/2026: "Pode tirar"):
na mídia não há errata (a planilha não tem o "Editar planilha"), e o card
ficava em "Nenhuma errata registrada" mandando usar um botão que não existe.
Saiu da aba Informações do job, na produção e no financeiro
(`detalhe.midia === null`); o registro das mudanças é o do card "Planejado e
realizado". Nos outros jobs, nada muda.

## Em aberto

- Contrato do veículo (Tiago: "para um momento seguinte").
