# Teste ponta a ponta — save, errata, cartão e esteiras (31/08/2026)

> ⚠️ **Este arquivo é avulso de propósito.** As notas abaixo pertencem a
> `HANDOFF_FINANCEIRO.md` e `HANDOFF_JOBS.md`. Foi escrito à parte porque
> os dois estavam entre os 59 arquivos que a outra frente mudou nos 33
> commits que este checkout ainda não tinha — escrever neles antes do pull
> garantiria conflito. **O pull já foi feito**; dobrar este conteúdo nos
> handoffs é trabalho de quem for commitar, e vale conferir se a outra
> frente não mexeu neles de novo nesse meio-tempo.

Projeto do teste: **TESTE-0006/26 · Teste Novas Alterações**, cliente
Teste. Quatro orçamentos, três jobs (JOB-0026, JOB-0027, JOB-0028), uma
fatura de cartão levada de ponta a ponta.

---

## 1. O que foi exercitado e bateu

### Save (decisão 028)

A conta da decisão foi reproduzida **célula a célula**, com honorários
10% e imposto 19,53%:

| | Job A (JOB-0026) | Job B (JOB-0027) | Soma |
|---|---:|---:|---:|
| Faturamento previsto | 109.357,52 | 20.504,54 | 129.862,06 |
| Valor do Job | 68.348,45 | 61.513,61 | 129.862,06 |

A invariante das duas somas fechou exata. Também conferiram:

- **Crédito × receita que migra** no pop-up da linha: R$ 30.000,00 de
  crédito e R$ 41.009,07 de faturamento (§4).
- **Rascunho não segura saldo**: o disponível de JOB-0026 só caiu de
  30.000 para 0 na **aprovação** da versão de JOB-0027 (nota de 26/08 §3).
- **O consumo muda de ponta na abertura**: `saves_consumos` nasceu em
  `item_versao_id` e passou para `job_item_orcado_id` na criação do job
  (nota de 27/08 §2).
- **Consumo parcial**: 26.000 de 30.000, sobra de 4.000 volta a aparecer
  no seletor do orçamento seguinte.
- **§11 — job pago só por save**: JOB-0028, faturamento previsto zero e
  consumo de save, abriu com o aviso "Não há nota a emitir aqui" e foi
  direto para *Enviar job para encerramento*, sem passar pelo faturamento.

### Errata (decisão 030)

Corrigir R$ unitário, criar **linha vermelha** (orçado e planejado
zerados, badge `SÓ REALIZADO`), o card de histórico com o "antes → depois"
dos dois números, `abertura_em_revisao`, a faixa **Erratas** no mural com
*Revisar abertura*, e o envio para faturamento bloqueado até a revisão ser
salva. Tudo conferido na tela.

### Cartão (decisões 031 e 032)

Ciclo completo numa fatura só (FC-00001):

```text
compra 3x (HITLAB, R$ 900) → parcelas em 3 competências seguidas
estorno parcial de R$ 400 apontando para a cabeça, teto = total do grupo
fechar por 1.553,34, com a diferença de R$ 20 classificada
→ 9 lançamentos de item + 1 de ajuste, cada um com seu plano de contas
→ título único em Títulos a Pagar
baixa: saída no Santander + entrada no cartão
estorno da baixa: contra-lançamento
reabertura: apaga os lançamentos do fechamento
```

Conferido também que a compra de 31/08 **não** entrou na fatura de
competência 25/09 (paga) e rolou para a de 25/10 — a regra da 032 §1 —, e
que a lista de contas e de formas de pagamento da baixa **exclui o
cartão** (031: fatura de cartão não se paga com outro cartão).

### Conciliação e fluxo de caixa

Extrato bate: saldo final R$ 165.635,42 com as pernas do cartão, as
pastilhas **SAVE** e **RATEADO**, e a coluna Origem apontando `FC-00001`.
No fluxo de caixa do job consumidor, a linha
`previsao_recebimento_save_consumido` aparece como entrada na data do
recebimento da origem — **é o desenho**, não erro: o dinheiro entrou, e
entrou pelo job que gastou o crédito.

---

## 2. Bugs corrigidos nesta sessão

| # | Onde | O que acontecia |
|---|---|---|
| 1 | `financeiro/abertura-de-job/actions.ts` | **"Conta bancária inválida."** ao abrir job. A conferência comparava o tamanho da lista de ids pedidos com o número de linhas do `.in()`, que vem deduplicado — e a California tem UMA conta, então recebimento e pagamento são o mesmo id. Nenhum job podia ser aberto com as duas contas preenchidas. |
| 2 | `components/ui/dialog.tsx` | `DialogContent` não tinha teto de altura. O diálogo de confirmação do envio do job mede 983px; numa janela de 840px ele escapava pelos dois lados e o botão **Sim, enviar job** ficava fora do alcance. Corrigido no primitivo (`max-h-[88vh] overflow-y-auto`), o que cobre os 24 diálogos que não declaravam o próprio. |
| 3 | `jobs/[jobId]/realizado/actions-errata.ts` | **Nenhuma errata gravava.** O insert ainda mandava `justificativa`, coluna removida pela migration `20260827120001` (decisão 030). O PostgREST recusava o insert inteiro e a tela dizia só "Falha ao registrar a errata." |
| 4 | `financeiro/abertura-de-job/resumo-errata-dialog.tsx` | **Revisar abertura era beco sem saída.** O botão levava a `/financeiro/abertura-de-job/[jobId]`, que redireciona todo job que não está `aguardando_abertura`. Quem encerra a revisão é `editarRegistroDaAbertura`, em `/financeiro/jobs/[jobId]`. Sem isso, `abertura_em_revisao` nunca saía e o job ficava preso fora do faturamento para sempre. |
| 5 | `jobs/[jobId]/realizado/save-errata-actions.ts` | A errata de **save** mudava faturamento previsto e valor do job **sem** marcar `abertura_em_revisao`. O financeiro nunca era chamado a reconferir as parcelas de recebimento, e o job seguia liberado para faturamento com a previsão no número velho. |
| 6 | `_planilha/save-dialog.tsx` | Reabrir uma linha que já consome mostrava **"livre R$ 0,00 · sobra −R$ 30.000,00"** em vermelho: o `disponivel` do banco já desconta o consumo da própria linha, e a tela descontava de novo. |
| 7 | `_planilha/exibir-colunas.tsx` (uso) | A **alça da coluna Save** existia desde 26/08 e nunca tinha sido renderizada. Quem fechava a coluna — ou abria o orçamento de um cliente sem save nenhum, onde ela nasce fechada — ficava sem porta visível para marcar a primeira linha. Ligada nas duas planilhas (orçamento e job). |
| 8 | `jobs/[jobId]/realizado/job-item-realizado-table.tsx` | O botão **Remover** da errata era oferecido em linha com save, que o servidor sempre recusa (`barrarRemocao`). O usuário montava a errata inteira, escrevia a descrição e só então tomava o erro — com a linha já sumida da tabela e sem desfazer. |
| 9 | `job-realizado-section.tsx` + `alterar-orcado-button.tsx` | **Alterar orçado** e o pop-up de save continuavam abrindo depois do envio para faturamento, que fecha as duas portas (028, nota de 27/08). O servidor recusava; a tela deixava chegar até o fim. |
| 10 | migration `20260831140001` | `estornar_baixa_fatura_cartao` contra-lançava **todos** os pagamentos da fatura, inclusive os já estornados num ciclo anterior. Numa fatura que passou por pagar → estornar → pagar, o segundo estorno devolveria também o primeiro pagamento: **dinheiro inventado no banco**. Passa a estornar só o que entrou depois do último estorno. |
| 11 | `financeiro/contas-a-pagar/page.tsx` | A conferência da baixa da fatura mostrava data, conta e centro de custo do pagamento **antigo, já estornado** — o `find` pegava o primeiro `pagamento` da lista. Mesmo corte por data da migration acima. |
| 12 | `lib/validations/projetos.ts` | `regional_ids` e `responsavel_ids` sem dedupe: o mesmo id repetido reprovaria com "Regional inválida." e estouraria a unique do vínculo. Mesma classe do bug #1, corrigida por prevenção. |

### ⚠️ Sobre a migration 20260831140001

O corte é por `created_at`, e **não** por `estorno_de_lancamento_id`. A
coluna existe, mas `chk_estorno_consistente` só a aceita quando `origem`
é um dos cinco `*_estorno`, e a baixa da fatura grava `origem = 'manual'`.
Usá-la exigiria valor novo no enum `origem_lancamento` **e** substituição
do CHECK — mudança que precisa de autorização (ver "Decisões pendentes"
no relatório da sessão).

---

## 3. Depois do pull: a esteira do faturamento, completa

O `git pull --ff-only` trouxe os 33 commits da outra frente sem conflito —
os 17 arquivos desta sessão não cruzam com os 59 dela. Com o CNAE já no
drawer "Faturar" (decisão 033), a esteira foi percorrida inteira no
JOB-0026:

```text
envio (descrição da NF vem do GP, R$ 109.357,52, save destacado)
  → NF 900501, CNAE do financeiro, PDF anexado
  → dois itens na nota: job R$ 68.348,45 + save R$ 41.009,07
  → título a receber R$ 109.357,52
  → baixa em 31/08, California Santander, 01 · Receita
  → conciliação
```

O split do save no fluxo de caixa fecha exato: a parte `job` fica em
JOB-0026 e a parte `save` se divide entre quem consumiu —
`lancamento_save_consumido` de R$ 35.541,19 para JOB-0027 e R$ 5.467,88
para JOB-0028, somando os R$ 41.009,07 do `faturamento_save_previsto`.

### O job encerrado sumia da fila — agora trava (decisão 034)

`vw_faturamento_pendente` filtra `j.status = 'aberto'`, e o encerramento
só olhava se o job **foi enviado** — não se a nota saiu. Como o envio pode
dividir o job em várias parcelas, dava para encerrar com metade faturada,
e o saldo sumia da fila sem aviso e sem volta.

Travado em 31/08/2026: o saldo a faturar entra na mesma lista de
impedimentos da PP sem baixa e do BV não recebido. A conta mora em
`lib/data/saldo-a-faturar.ts` e é a mesma da fila. A exceção do save
(028 §11) continua de pé — job pago só por save não tem parcela e encerra
direto.

**Não existe escape, e é de propósito.** Perguntei ao Tiago se um job
legitimamente não faturado por inteiro não ficaria preso aberto, já que não
há como cancelar o envio: "a negociação já terá terminado no momento de
envio para faturamento, e novas erratas realmente não deverão poder ser
feitas". Envio congelado, errata fechada e encerramento travado são a mesma
regra vista de três lugares (decisão 034 §5).

Junto: a mensagem das portas de errata e save mandava "peça ao financeiro
para desfazer o envio", e esse caminho **não existe** — o único `delete` em
`jobs_envio_faturamento` é o rollback de um insert que falhou. Reescrita.

**Dois jobs já encerraram com saldo antes da trava** e continuam fora da
fila: `JOB-0027` (R$ 30.073,32) e `JOB-0009` (R$ 149,12). A trava impede
novos; não conserta os antigos — é o que restou em aberto na decisão 034.

## 4. Segunda rodada de correções (mesma sessão)

| # | Onde | O que mudou |
|---|---|---|
| 13 | migrations `20260831150001/2/3` | A fatura de cartão entra na **tríade** de `origem_lancamento` (`fatura_cartao_baixa` / `_estornada` / `_estorno`), como os outros cinco documentos estornáveis. Três CHECKs estendidos, backfill das 10 linhas antigas, e o índice único parcial `uniq_baixa_ativa_por_fatura_cartao` — que torna duas baixas vivas impossíveis no banco. Substitui o corte por data da 140001. |
| 14 | `contas-a-pagar/page.tsx` | A conferência da baixa lê `origem = 'fatura_cartao_baixa'` em vez de comparar datas. |
| 15 | `errata-rascunho.ts` + barra | **Desfazer** no modo errata: pilha de 20 passos, botão na barra e **Cmd+Z / Ctrl+Z**. A digitação coalesce por campo (um passo por célula, não por tecla); ação estrutural é sempre um passo. |
| 16 | `errata-barra.tsx`, `errata-confirmar-dialog.tsx` | O delta passa a ser a diferença dos valores **arredondados** — os mesmos que a tela mostra e que o job passa a ter. Antes subtraía os intermediários e exibia "20.504,54 → 24.605,44 +4.100,91", que não fecha. |
| 17 | `save-dialog.tsx` | O pop-up abre em **"Gerar save"**. Só cai em "Consumir" quando a linha já consome. |

### Por que a tríade, e não o corte por data

Todo documento estornável do sistema já tinha três valores no enum e um
índice único parcial sobre `X_baixa`. A fatura era a única exceção:
gravava `manual` nas quatro linhas, sem link e sem estado. Era exatamente
a ausência desse invariante que deixou o estorno duplicar um pagamento
(bug 10). O corte por data resolvia o sintoma; a tríade impede o problema
no banco.

## 5. Terceira rodada: a porta do `anon`

| # | Onde | O que mudou |
|---|---|---|
| 18 | migration `20260831160001` | Nenhuma função do schema `public` responde mais a quem não está logado. |
| 19 | `actions-encerramento.ts`, `encerrar-dialog.tsx`, `carregar-detalhe.ts`, `lib/data/saldo-a-faturar.ts` | A trava da decisão 034. |

### O que estava aberto, medido

O Supabase publica como endpoint HTTP toda função de `public` que o papel
do requisitante possa executar. **Trinta funções respondiam ao `anon`** —
o papel de quem chega só com a chave pública, que viaja no bundle do
navegador. Sem login nenhum:

```text
POST /rest/v1/rpc/gerar_codigo_pp {"p_tenant_id": "<qualquer uuid>"}
-> "PP-00001"
```

A tabela nega (`permission denied for table jobs`), mas a função responde:
é `SECURITY DEFINER`, roda com os poderes do dono e passa por cima da RLS.
A pior do lote era `gerar_ocorrencias_recorrentes()`, que **escreve** —
insere contas avulsas já aprovadas, mexe nos templates e grava auditoria.

### Por que `FROM PUBLIC` e não `FROM anon`

A ACL das trinta trazia `=X/postgres`: grantee vazio é o **PUBLIC**, e é
esse o default do Postgres para função nova. O `anon` não tinha concessão
própria — executava porque PUBLIC executava. `REVOKE ... FROM anon` seria
um no-op, porque o Postgres só remove concessão feita àquele grantee.

Depois da migration: `anon` = 0 funções, `authenticated` = 49,
`service_role` = 73. As quinze que sobraram fora do `authenticated` são
funções de trigger (que disparam sem precisar de EXECUTE) e
`gerar_ocorrencias_recorrentes`, que é do cron. A mesma chamada acima
agora devolve `permission denied for function gerar_codigo_pp`.

E o `alter default privileges` faz a próxima nascer fechada — sem isso, a
primeira migration que esquecesse o GRANT reabriria o buraco, que foi
exatamente como as trinta chegaram lá.

### As views `SECURITY DEFINER` não eram o problema

Conferido: **nenhuma view é legível pelo `anon`**, e a RLS deste banco
filtra só por `tenant_id` — não por papel. Com um tenant só, trocar as
views para `security_invoker` não restringiria nada de novo. Fica para
quando (e se) houver um segundo tenant.
