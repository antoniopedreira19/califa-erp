# 274 — Mídia Off, entrega 4: os veículos do mês (AP, PI, NF e BV)

**Data:** 2026-11-23
**Status:** aceita e implementada (23/11/2026).
**Quem decidiu:** Tiago, em 15/10/2026 (respostas 2a e 3a) e em 23/11/2026 (protótipo aprovado — https://claude.ai/artifact/B1GUS2L5Vw7WpeZwSsEH7J —, as cinco escolhas confirmadas e as duas perguntas desta entrega).
**Continua:** a [273](273-midia-off-pp-do-repasse-e-encerramento.md) (entrega 3) e a [167](167-job-da-midia-off-abrir-e-faturar.md) (entrega 2).
**Migrations:** `20261123500002_documentos_do_veiculo_no_mes.sql` e `20261123500003_documentos_do_veiculo_autor_no_perfil.sql`.

## O que aconteceu

O ciclo da mídia que o Tiago descreveu (167) tem AP e PI "gerados por fora,
anexados no sistema" antes da veiculação, e o job só fatura o mês com a
nota do veículo. Em 15/10 ele fechou:

- **AP e PI por veículo e mês** (3a): "a veiculação só pode ocorrer com AP
  e PI, e ambos os documentos são necessários para o envio a faturamento
  (assim como a NF do veículo)";
- **BV por veículo e por mês** (2a), não por linha nem por meio, e o job
  não encerra com BV a receber.

## A regra

1. **Um card "Veículos de {mês}" no pé de cada mês** da planilha da mídia
   do job: uma linha por veículo, com o tipo (A · Direto, A · Repasse), a
   nota planejada e a realizada (iguais até a entrega 5), AP, PI, a NF do
   veículo, o BV e "Para o faturamento" (Pronto / Falta …).
2. **O que cada veículo precisa para o mês ir ao faturamento:**
   - AP e PI, sempre — número e arquivo;
   - no A · Direto, a NF que o veículo emitiu ao cliente — número, data de
     emissão, valor e arquivo;
   - no A · Repasse, a NF chega pela PP do repasse: a PP precisa estar
     enviada ao financeiro e a linha fechada ("Vem pela PP do repasse: falta
     gerar / falta enviar / falta a última PP").
   Veículo sem veiculação no mês (nota zero) não pede nada.
3. **O envio do mês trava** enquanto faltar documento: o botão aparece
   apagado e a barra diz "Falta para enviar novembro: Veículo (AP, PI e
   NF)"; a régua do mês diz "Falta AP, PI ou NF". O servidor refaz a conta
   no envio.
4. **NF diferente da nota do veículo só avisa** (escolha 3 do protótipo,
   confirmada): o formulário mostra a diferença em âmbar e o anexo passa.
5. **O mês enviado não muda** (escolha 4): depois do envio — pela produção
   ou pelo Novo faturamento do financeiro — os documentos do mês ficam em
   consulta.
6. **Quem anexa, troca e remove:** administrador, GP e produtor (Tiago,
   23/11/2026); abrir o arquivo, qualquer um do tenant. Só com o job
   aberto. Um documento de cada tipo por veículo e mês: anexar de novo
   troca; corrigir só o número, a data ou o valor mantém o arquivo.
7. **O BV do veículo no mês segue o fluxo do BV de hoje** (Tiago,
   23/11/2026): o mesmo formulário, já com o veículo escolhido; o GP lança,
   confirma, e o BV vai à fila de faturamento do financeiro, que emite a NF
   de BV; "Recebido" só na baixa do contas a receber. Lançar é de
   administrador e GP, como no nacional. O BV a receber trava o
   encerramento (a regra de sempre, 087/105). O BV continua aberto depois
   do envio do mês.

## No código

- Regra pura: `lib/calculos/midia-off.ts` — `situacaoDoRepasse`,
  `piorRepasse`, `faltaDoVeiculoNoMes`, `veiculosNoMes`, `listaDoQueFalta`
  (testes em `midia-off.test.ts`).
- Arquivo: `lib/midia/documentos.ts` (bucket, limite, caminho
  `<tenant>/<job>/<uuid>-<nome>`).
- Leitura: `lib/data/midia-do-job.ts` — `lerDocumentosDaMidia` e
  `lerFaltaDosVeiculosNoMes` (a trava do servidor);
  `carregar-detalhe.ts` monta `midia.veiculosPorMes` e `midia.faltaPorMes`.
- Gravação: `realizado/actions-midia-documentos.ts` (reservar o caminho,
  salvar, remover, abrir).
- Tela: `realizado/veiculos-do-mes.tsx` (o card, o formulário do documento
  e o BV), ligado por `veiculosDoMes` em `planilha-midia-do-job.tsx` e
  `midia/planilha-midia.tsx`; `job-realizado-section.tsx` passa os dados.
- Envio do mês: `actions-faturamento.ts` (`conferirEnvioDoMesDaMidia`) e
  `barra-faturamento-mensal.tsx` (`faltaParaEnviar`), via
  `barra-acoes-job.tsx` e `page.tsx`.
- BV: `_bv/bv-dialog.tsx` ganhou `fornecedorPadrao`; o BV do veículo no
  mês mora numa linha do job (a primeira do veículo no mês, ou a que já
  tem BV), para seguir o fluxo inteiro do financeiro sem mudar as views.

## Banco

`20261123500002`: tabela `jobs_midia_documentos` (um AP, um PI e uma NF por
veículo e mês, `uq_jobs_midia_doc`; NF com valor e data), RLS na forma de
conjunto (ler: o tenant; escrever: administrador, GP e produtor), GRANT só
para `authenticated`, índices em tenant e veículo; bucket privado
`jobs-midia` (25 MB), com policies pelo caminho do tenant e sem apagar
arquivo que uma linha ainda aponta. `20261123500003`: quem anexou aponta
para `profiles` (como as tabelas vizinhas do job). Aditivas.

## Conferido no Sandbox (23/11/2026)

- **TES-1026/26, novembro (A · Direto):** a régua "Falta AP, PI ou NF" e o
  envio travado com "Fornecedor Teste (AP, PI e NF)"; o GP anexou AP, PI e
  a NF 1284 (R$ 12.000,00, aviso de −R$ 320,00 abaixo da nota, e o anexo
  passou); "Documentos completos", "Pronto" e o "Enviar faturamento de
  novembro" liberado; o número corrigido para 1285 sem trocar o arquivo.
- **Como produtor:** trocou o arquivo do AP (o antigo saiu do bucket),
  removeu o PI ("Falta PI") e anexou de novo; o BV aparece "Sem BV" (lançar
  é do GP); "Abrir" gera a URL assinada.
- **Dezembro (A · Repasse, já faturado pelo financeiro):** documentos em
  consulta, "Vem pela PP do repasse: falta enviar"; BV de R$ 960,00 (19,53%)
  lançado com o veículo já escolhido, e a trilha "1 BV não recebido
  (Fornecedor Teste)".
- A trava do servidor, lida direto: novembro liberado; dezembro com "AP, PI
  e envio da PP do repasse".

## Em aberto

- **Texto do BV:** o formulário é o nacional e diz que "a planilha desconta
  o valor bruto do realizado"; na planilha da mídia o BV não desconta (ele
  entra na Rentabilidade, como o de todos os jobs).
- **Fila de faturamento do financeiro:** o BV de mídia aparece como
  "BV — " sem o nome da linha (a linha de mídia não tem item). Mexer na
  view é do financeiro; fica para combinar.
- O sistema não impede a veiculação sem AP e PI (ela acontece fora dele):
  trava o envio do mês.
- Entrega 5 (visão única, encerrar antes, estender; AP e PI da extensão).
