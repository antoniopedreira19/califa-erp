# 240 — O financeiro põe o job no Interno, ou tira dele, pelo "Editar registro"

**Data:** 2026-11-05
**Decidido por:** Tiago
**Migrations:** `20261105800001_job_entra_e_sai_do_interno_no_registro.sql` e
`20261106800001_bloqueios_do_interno_sem_erro_de_array.sql` (conserto da
soma dos motivos, achado no teste)

Revê a [105](105-servico-interno-e-job-sem-faturamento.md) §2, resposta 3-a
("na abertura, o financeiro não põe nem tira um job do Interno"), e abre uma
exceção à [055](055-servico-no-job-e-rateio-de-competencia.md) só para o
Interno: trocar o serviço do job para dentro ou para fora do Interno troca
também o do orçamento.

---

## 1. O problema

No "Editar registro" do job aberto, o campo Serviço escondia o Interno
(`servicosDoLado`), e o banco recusava a troca
(`job_servico_e_categoria_seguem_a_planilha`). Um job que nasceu como
Ativação ou Always On e que, depois, a California decide bancar sozinha não
tinha como virar Interno, e o contrário também não.

## 2. A regra (respostas do Tiago, 05/11/2026)

- **Os dois sentidos ficam liberados**, só no "Editar registro" do job
  aberto. Na fila de abertura, o job continua do lado do Interno do
  orçamento.
- **Entrar no Interno:** todas as linhas viram FI e o planejado passa a ser
  o orçado. O BV em negociação é cancelado.
- **Sair do Interno:** as linhas FI viram B. O planejado fica como está.
  FI só existe em job ou orçamento Interno.
- **O orçamento vai junto** (exceção à 055, só para o Interno): todas as
  regras do Interno (errata, planejado, save, faturamento) leem o serviço do
  orçamento, então o job só é Interno de verdade se o orçamento também for.
  Todas as versões do orçamento são convertidas.
- **Bloqueiam a entrada:** linha em save ou pedido de save aguardando, BV
  confirmado ou recebido, nota emitida, recebimento registrado. Também o
  envio para faturamento já feito: o Interno não fatura, e o envio ficaria
  pendente no financeiro sem nota a emitir. **Linhas A e D não bloqueiam:**
  viram FI e passam a ser pagas pela California, por PP.
- **Fluxo de caixa:** na entrada, as previsões de recebimento e de impostos
  são canceladas e o desembolso passa a seguir o orçado; na saída, o
  recebimento e os impostos voltam a ser previstos pela regra de sempre.
- **O pop-up "tem certeza"** aparece nos dois sentidos: uma frase, o quadro
  "Hoje → Ao salvar" (tipo de custo só com as siglas, planejado e
  faturamento) e uma explicação curta. Desenho aprovado no protótipo
  "Interno no registro" (versão 5, opção "Hoje → FI").

## 3. Como funciona

- Escolher o serviço do outro lado do Interno chama
  `carregarTrocaDoInterno`, que devolve a prévia (`lib/data/troca-do-interno.ts`):
  os bloqueios (`bloqueios_do_job_para_o_interno`) e os números do job
  depois da troca, pela mesma conta dos espelhos do job
  (`lib/data/espelhos-do-job.ts`) sobre as linhas convertidas. Nada é
  gravado.
- Com "Sim, trocar", o formulário passa a fechar com esses números: as
  previsões acompanham na tela (a curva de desembolso também, só nesta
  troca), e o aviso embaixo do campo diz o que o salvar fará. Voltar ao
  serviço do lado de antes desfaz a prévia; "Cancelar" a edição também.
- "Salvar alterações" refaz a prévia no servidor, confere as previsões
  contra ela e, com tudo conferido, chama a RPC
  `trocar_job_de_lado_do_interno`, que numa transação troca o serviço do
  orçamento (o gatilho `orcamento_entra_no_interno` converte as versões),
  converte as linhas do job, grava os espelhos (valor total, faturamento
  previsto) e registra `job.servico_interno_trocado` na auditoria. Só então
  o registro é regravado, como sempre.
- A troca não vai junto de uma revisão de errata, de uma aprovação de save
  nem do "Editar planilha": nesses casos o serviço fica do lado de antes.

## 4. Fora daqui

- **Always On → Ativação** (pedido no mesmo protótipo): o Tiago decidiu que
  vale a regra do orçamento (decisão 128: os meses se juntam numa planilha
  só, nada é apagado), que o financeiro escolhe a categoria nacional, e que
  um mês com PP, nota ou save segue como o sistema já trata. Tirar um job
  aberto da planilha mensal ainda não existe (a categoria do job só troca
  dentro do mesmo modelo de planilha) e fica para uma entrega própria.
- O texto "Todo o valor deste job é pago diretamente pelo cliente ao
  fornecedor", que aparecia no job Interno sem faturamento, passou a dizer
  que o job é Interno.
