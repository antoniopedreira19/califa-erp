# 273 — Mídia Off, entrega 3: a PP do repasse e o encerramento depois da veiculação

**Data:** 2026-11-23
**Status:** aceita e implementada (23/11/2026).
**Quem decidiu:** Tiago, no plano das entregas 3 a 5 e no protótipo com tudo (https://claude.ai/artifact/B1GUS2L5Vw7WpeZwSsEH7J — "Gostei"; "Pode começar" em 23/11/2026).
**Revê:** a [167](167-job-da-midia-off-abrir-e-faturar.md), regras 6, 7 e 8 (o envio do último mês encerrava o job; o job de mídia não tinha PP).
**Segue:** a [062](062-bv-so-no-realizado-multiplo-e-com-aliquota-propria.md) §6 (o A · Repasse só fecha com as PPs cobrindo o valor) e a [105](105-servico-interno-e-job-sem-faturamento.md) (uma régua só para o encerramento: botão, home do GP e lista de Jobs).
**Migration:** `20261123500001_planejado_da_midia_e_a_nota_do_veiculo.sql`.

## O que aconteceu

Na entrega 2 (167) o job de Mídia Off abria e faturava por mês, mas a linha
A · Repasse — a que passa pela California e vira pagamento ao veículo — não
tinha PP. Por isso um job com Repasse não conseguia fechar o ciclo, e o
envio do último mês encerrava o job junto.

O Tiago aprovou, para as entregas seguintes:

- **PP do repasse paga** para encerrar ("Concordo");
- **PP nova já preenchida** com o veículo e o valor da nota — o veículo é o
  fornecedor de cada linha;
- o encerramento **pelo botão de sempre**, depois da veiculação;
- o BV **por veículo e por mês** (entrega 4), e não por linha.

## A regra

1. **A PP do repasse mora na linha A · Repasse.** A planilha da mídia do job
   ganhou a calha com a pílula "Gerar PP" / "PPs · N", a mesma do nacional:
   painel do item, formulário, revisão, envio ao financeiro, Comitê,
   prestação. O A · Direto não tem PP: o veículo fatura direto ao cliente.
   O BV sai da linha — é por veículo e mês, na entrega 4.
2. **A PP nova vem preenchida:** o veículo da linha, o serviço
   ("Veiculação de dezembro de 2026 · OOH · Outdoor · 9 x 3 m (lona) ·
   Salvador/BA"), o valor que falta para a nota do veículo e "Esta é a
   última PP deste item? Sim". Na primeira PP o valor é a nota inteira,
   decomposta em unitário × quantidade × períodos da linha quando fecha no
   centavo; senão vai em 1 × 1. Tudo editável. A PP a emitir e a PP gerada
   abrem como foram salvas.
3. **O A · Repasse fecha na nota do veículo, não no negociado.** A trava da
   062 (as PPs precisam somar o valor para concluir o item e para ir ao
   financeiro) mede contra a nota = negociado × a parte do veículo dos
   parâmetros de HOJE do job (224). No TES-1026/26: R$ 16.000,00, 80% de
   R$ 20.000,00.
4. **O planejado da linha do job de mídia é a nota do veículo:** unitário ×
   a parte do veículo, com a quantidade e os períodos do orçado. A abertura
   grava; é o "Planejado do item" do painel e do formulário e a régua do
   aviso de PP acima do planejado. Se o financeiro muda a parte do veículo
   com o job na fila, o planejado acompanha; depois da abertura fica o da
   abertura (151), e a trava da regra 3 segue os parâmetros do job.
5. **O envio do último mês não encerra mais o job** (revê a 167 §6). A Mídia
   Off encerra pelo "Enviar job para encerramento", que espera:
   - **a veiculação terminar** — o dia seguinte à última veiculação da
     campanha inteira (a maior data com inserção, ou o maior fim de
     período, entre os meses); antes disso a trilha diz "Campanha no ar até
     31/12/2026";
   - **as PPs do repasse pagas** — a regra de sempre das PPs em aberto
     (083);
   - **a linha A · Repasse concluída** ("1 linha A · Repasse com a PP do
     repasse por fechar").

   É a mesma régua no botão, no card da home do GP, no filtro "Prontos para
   encerrar" da lista de Jobs e no servidor (`impedimentosDosJobs`). O BV do
   veículo entra na entrega 4.
6. **O faturamento por mês fica como estava** (167 §5): cada mês vai no dia
   seguinte à veiculação dele. A barra perdeu o "Enviar e encerrar".

## No código

- Conta: `lib/calculos/midia-off.ts` — `planejadoDaLinhaMidia`,
  `alvoDoRepasse`, `decomposicaoDoRepasse`, `ultimaVeiculacaoDaCampanha`
  (testes em `midia-off.test.ts`).
- Planejado na abertura: `orcamentos/.../abertura-actions.ts`; na fila,
  `realizado/actions-parametros-do-job.ts`.
- Trava do A · Repasse: `realizado/actions-pp.ts`
  (`barrarARComOrcadoEmAberto`), `realizado/conclusao-item.ts` e
  `realizado/job-realizado-section.tsx` (`itensEmAberto`). A trava "o job de
  mídia não tem PP" saiu (`lib/data/midia-do-job.ts`).
- Calha e PP: a planilha da mídia entra pela `JobItemRealizadoTable`
  (`corpoDaMidia`, `nomeDaLinhaMidia`, `sugestaoDaPP`), que segue dona do
  painel, do formulário e do Comitê; `planilha-midia-do-job.tsx`,
  `midia/planilha-midia.tsx` e `midia/secoes.tsx` (`calhaDoJob`) desenham
  a calha; `gerar-pp-drawer.tsx` (`sugestao`).
- Veículo no combo da PP: `carregar-detalhe.ts` manda os veículos das
  linhas na lista de fornecedores do job (255).
- Encerramento: `lib/data/impedimentos-encerramento.ts` (`veiculacaoAte`,
  `textoDaVeiculacao`), `actions-encerramento.ts`, `carregar-detalhe.ts`
  (`FechamentoDoJob.veiculacaoAte`), `barra-acoes-job.tsx`,
  `enviar-encerramento-dialog.tsx`. Sem o "encerra junto":
  `actions-faturamento.ts`, `barra-faturamento-mensal.tsx`,
  `enviar-faturamento-dialog.tsx`, `page.tsx`.

## Banco

`20261123500001`: preenche o planejado das linhas de job de Mídia Off que
estavam com o planejado vazio (unitário × a parte do veículo do job,
quantidade e períodos do orçado), fora de save e de linha vermelha.
Aditiva: só preenche o que estava vazio. Em 23/11/2026 eram as 5 linhas dos
jobs de teste do Sandbox (TES-1026/26 e TES-1027/26); a produção não tem
job de Mídia Off.

## Conferido no Sandbox (23/11/2026)

- **TES-1026/26**, com o GP de teste: a linha A · Repasse de dezembro
  (Outdoor, Salvador/BA) com "Gerar PP" na calha; o painel "Salvador/BA ·
  Fornecedor Teste", planejado R$ 16.000,00 (R$ 2.000,00 × 4 × 2); o
  formulário com o veículo, 2.000,00 × 4 × 2, o serviço e "Sim, é a
  última"; a **PP-00958** gerada, e a linha concluída com R$ 16.000,00 (a
  nota, não os R$ 20.000,00 do negociado); a pílula "PPs · 1" com o ✓ e o
  círculo da PP não enviada; a trilha "Campanha no ar até 31/12/2026 · 1 PP
  em aberto (PP-00958)", com o botão travado; o realizado do cabeçalho
  igual ao planejado (R$ 2.962,58).
- **TES-1025/26** (nacional): a planilha e a calha de sempre.
- A leitura nova do encerramento (grupo → mês) respondendo: o job nacional
  sem linha, o de mídia com as datas e o mês de cada linha.

## Em aberto

- O envio da PP do repasse ao financeiro e o pagamento não foram
  percorridos no teste (pedem a NF). O envio usa a mesma trava da conclusão.
- No PDF da PP da mídia a célula "Item" fica de fora: a linha de mídia não
  tem item. O serviço leva o meio, o formato e a praça.
- O TES-1027/26 encerrou pela regra antiga (167 §6) e fica como está.
- Entrega 5 (visão única, encerrar antes, estender). A entrega 4 (veículos
  do mês: AP, PI, NF e BV) saiu na [274](274-midia-off-veiculos-do-mes.md),
  com as cinco escolhas do protótipo confirmadas pelo Tiago em 23/11/2026.
