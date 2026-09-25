# 105 — O serviço Interno é investimento da agência, e o job sem faturamento só precisa ser encerrado

**Data:** 2026-09-25
**Decidido por:** Tiago
**Migration:** `20260925100001_servico_interno.sql`

Revê a [037](037-servico-no-orcamento-equipe-no-projeto-e-marca.md) (o
serviço "Interno" deixa de ser só um rótulo), a
[078](078-orcamento-mensal-fee-e-always-on.md) §2 (a categoria Always On passa
a valer também para o Interno), a [028](028-save-entre-jobs.md) §11 (o job
pago só com save aparece "Sem faturamento", não "Faturado") e fecha a
pendência da [087](087-faturamento-e-encerramento-correm-separados.md) §7
sobre o card "Jobs prontos pra encerrar".

---

## 1. O problema

Três coisas, levantadas pelo Tiago em 25/09/2026:

1. **"Interno" era só um rótulo.** Nenhuma conta nem trava olhava para o
   serviço: um orçamento Interno aceitava custo B, faturava honorário e
   imposto, e o planejado era digitado linha a linha. O único orçamento
   Interno do banco ("Audiovisual Raízes do Futuro", HIT-0002/26) estava
   certo só porque quem o montou escolheu FI em todas as linhas.
2. **O job sem nada a faturar aparecia como se faltasse faturar.** A
   finalização já funcionava (o banco grava "Finalizado" no encerramento
   quando o faturamento previsto é zero, desde a 087), mas a esteira do
   financeiro só reconhecia o job pago só com save. O job todo em FI ficava
   "Aguardando envio" para sempre — até depois de finalizado —, contava no
   card "Jobs com faturamento próximo", e o envio para abertura exigia uma
   data de recebimento que não existe.
3. **O card "Jobs prontos pra encerrar" usava o critério anterior à 087:**
   exigia envio para faturamento e não olhava PP, BV, verba nem itens. Por
   isso contava job que o botão de encerrar recusava e nunca contava o job
   sem faturamento.

## 2. A regra (respostas do Tiago, 25/09/2026)

### O serviço Interno

- **Só custo F · Interno (FI).** Em todas as versões do orçamento e na cópia
  do job. FI é o custo que a California paga por PP e não fatura
  ([003](003-tipos-de-custo.md)): sem honorário, sem imposto, faturamento
  previsto zero.
- **O planejado é o orçado, e não se digita.** "É o investimento interno,
  então não tem como rentabilizar o planejamento por linha."
- **Categoria:** a Internacional some; a **Always On** aparece, e com ela o
  orçamento Interno sai no modelo mensal de sempre (planilha por mês,
  envio para abertura trimestral), mantendo FI e planejado = orçado. A Fee
  continua só do serviço Fee.
- **Orçamento já preenchido que passa a ser Interno** (resposta 1-b):
  **converte tudo** — as linhas de todas as versões viram FI e o planejado
  de cada uma vira o orçado. A tela pede confirmação antes.
- **Sem save** (resposta 2-a): o Interno não gera nem consome save — save é
  crédito de cliente, e aqui não há cliente pagando.
- **Na abertura, o financeiro não põe nem tira um job do Interno**, nem
  troca a categoria por outra de modelo de planilha diferente (resposta
  3-a): Internacional só por internacional, Fee e Always On entre si, e as
  nacionais entre si.

### O job sem faturamento

- **Não tem faturamento, e a tela diz isso** em todo lugar (resposta 2).
- **Só precisa ser encerrado para ficar finalizado** — já era assim no
  banco; nada mudou nesta regra.
- **O job pago só com save também é "Sem faturamento"** (resposta 4-a),
  desde que nenhuma linha que não consome save precise ser faturada — ou
  seja, faturamento previsto zero. Consumo ainda aguardando o financeiro
  continua "Aguardando envio": ele pode ser recusado e o faturamento voltar
  (099).
- **No envio para abertura, a data prevista para recebimento fica
  travada** ("Sem recebimento").

### "Jobs prontos pra encerrar"

- Job aberto **sem nenhuma pendência**: todos os itens marcados como "todas
  as PPs geradas", toda PP gerada enviada ao financeiro **e paga**, e toda
  verba de produção com a prestação de contas **aprovada pelo financeiro**
  (resposta 5: "prestação feita" = aprovada). Também entram, porque o
  botão de encerrar já cobra: nenhum BV por receber, nenhum save ou consumo
  aguardando ou nunca enviado, nenhuma revisão da abertura pendente.
- O envio para faturamento **não** entra (087).

## 3. Banco

- **`categorias_dominio.investimento_interno`** (no serviço) e
  **`categorias_dominio.aceita_servico_interno`** (na categoria). Backfill:
  só o serviço Interno e a categoria Always On. O Interno é reconhecido pela
  marca, nunca pelo nome. As duas marcas só mudam por migration
  (`categoria_marcas_do_interno_travadas`).
- **`orcamento_servico_e_categoria_coerentes`**: o ramo do Interno recusa a
  categoria internacional e aceita a exclusiva marcada `aceita_servico_interno`.
- **`orcamento_entra_no_interno`** (AFTER UPDATE OF `servico_id`): recusa se
  alguma linha tem save ou se há BV confirmado ou recebido; cancela o BV em
  negociação (com a auditoria `item_bv.cancelado`); desliga o "save por
  padrão"; regrava o tipo de todas as linhas como FI. Vale para os dois
  caminhos que trocam o serviço: `atualizarOrcamento` e a RPC
  `trocar_modelo_mensal_do_orcamento`.
- **`planejado_espelha_orcado`** (o nome é histórico — 062) ganhou o ramo do
  Interno antes do ramo do save, nas duas tabelas de itens: FI, planejado =
  orçado, e save recusado. Virou SECURITY DEFINER, porque uma leitura
  barrada por RLS deixaria a regra passar em silêncio. A lista de colunas
  do gatilho ganhou `save_consumido`. É o único ponto por onde passam todos
  os caminhos de escrita: célula, linha nova, importação, sobrescrever,
  editor agregado, cópia de mês, duplicar versão, abertura e errata.
- **`versao_do_interno_sem_save_por_padrao`**: recusa ligar o "save por
  padrão" numa versão do Interno.
- **`job_servico_e_categoria_seguem_a_planilha`** (jobs, só quando serviço
  ou categoria mudam): recusa a troca que cruza o Interno ou o modelo de
  planilha. Nenhum job divergia do seu orçamento em 25/09/2026.
- Funções auxiliares `servico_de_investimento_interno` e
  `orcamento_de_investimento_interno`. Todas as funções novas são fechadas
  para `anon` e `authenticated`.
- **Nenhum dado existente mudou.** O único orçamento Interno já estava em FI
  com planejado = orçado.

## 4. Telas

### Orçamento

- **Formulário** (novo, editar, visão agregada): com o Interno, a categoria
  lista as nacionais e a Always On; aparece a nota "Investimento da
  California: todo custo é F · Interno, o planejado é igual ao orçado e não
  há faturamento." Passar um orçamento existente para o Interno abre a
  confirmação da conversão — somada à da planilha mensal quando as duas
  acontecem juntas. A regra do par mora em `lib/categorias-do-servico.ts`
  (tela e action).
- **`atualizarOrcamento`** confere antes de gravar (save, BV confirmado),
  exige `confirmar_entrada_interno` e grava a auditoria
  `orcamento.virou_interno` com o número de linhas convertidas.
- **Planilha da versão** (`ItensTable`, prop `interno` obrigatória): linha
  nova nasce FI; o Tipo não abre; o planejado mostra o orçado ao vivo e não
  abre; sem coluna Save, sem alça, sem "Orçamento de save". Vale para a
  versão nacional, cada mês do mensal, o trimestre e a visão agregada. Na
  agregada, o estado do rascunho é normalizado num lugar só
  (`itemDoInterno`, em `_rascunho/rascunho.ts`).
- **Importar planilha:** a pergunta "de onde vem o planejado" some; o
  preview avisa que toda linha entra como F · Interno com planejado igual
  ao orçado. Linha com tipo inválido na planilha continua ficando de fora
  com aviso (o leitor usa a coluna de tipo para reconhecer agrupamentos).
- **Enviar job para abertura:** com faturamento previsto zero, "Data
  prevista para recebimento" aparece travada ("Sem recebimento — O job não
  tem faturamento previsto."), não é cobrada, e a confirmação diz
  "Recebimento em: Sem recebimento". O servidor decide pelo mesmo número e
  grava a data vazia.

### Job

- **Errata:** linha nova nasce FI; Tipo e planejado não abrem; a prévia usa
  planejado = orçado. Sem coluna de save nem pedido de save.
- **Ficha:** "Prev. recebimento: Sem faturamento".
- **Barra do mensal:** com todos os meses sem faturamento, "Este job não tem
  faturamento previsto: não há nota a emitir." (era "Envie cada mês quando
  o cliente validar.").

### Financeiro

- **Abertura e "Editar registro":** o Serviço só oferece os do mesmo lado do
  Interno que o orçamento; a Categoria, só as do mesmo modelo de planilha
  (`servicosDoLado`, `conferirServico`, `conferirCategoriaDoJob`).
- **"Dados da produção":** "Recebimento em: Sem recebimento".
- **Esteira** (`faturamentoPorJob`): situação nova **`sem_faturamento`**,
  selo "Sem faturamento" em contorno neutro, fora do filtro "Aguardando
  faturamento". Vale para "Visualizar Jobs" e para o cabeçalho do job.
- **Prazos do job:** sem faturamento, "—", e fora da média do projeto.

### Home e lista de jobs

- **"Jobs com faturamento próximo"** (administrador e GP) e o filtro
  `faturamento_proximo`: o job com faturamento previsto zero sai.
- **"Jobs prontos pra encerrar"** (GP): conta pela régua do encerramento.
  Subtítulo "Seus jobs abertos sem nenhuma pendência de produção". O link
  abre `/jobs?filtro=encerrar_pronto`, que passou a filtrar de verdade (era
  TODO), com mensagem própria quando não há nenhum.
- A régua mora em **`lib/data/impedimentos-encerramento.ts`**
  (`impedimentosDosJobs`, `podeEncerrar`): sete leituras em paralelo para
  qualquer número de jobs. `encerrarJob` passou a usar a mesma função — as
  três pontas (botão, card, filtro) não podem discordar.

## 5. Conferência (25/09/2026)

**No banco, numa transação desfeita** (conferido depois que nada ficou):

| Cenário | Resultado |
|---|---|
| "Orçamento de Teste" (A, AR, B; 1 BV em negociação) → Interno | 65 de 65 linhas FI com planejado = orçado; BV cancelado |
| "Teste A" (Always On, mensal) → Interno mantendo Always On | aceito; 4 de 4 FI |
| "teste" (internacional) → Interno | recusado: "O serviço Interno não aceita categoria de planilha internacional." |
| Linha do Interno marcada em save | recusado |
| Linha do Interno gravada como B com planejado próprio | volta FI, planejado = orçado |
| Job: categoria nacional → Internacional | recusado |
| Job: categoria Evento → Conteúdo | aceito |
| Job: serviço → Interno | recusado |

**Pelas telas** (navegador do app, projeto TES-0001/26, porta 3017 do worktree):

- **TES-0001/26-12 "Teste Interno 105 · nacional"** (Interno + Evento):
  categorias sem Internacional e com Always On; linha nova FI; orçado 5.000
  × 2 → planejado 5.000 × 2 ao vivo; Tipo e planejado não abrem; sem coluna
  nem chave de save (no orçamento Ativação ao lado, as duas aparecem).
- **TES-0001/26-13 "Teste Interno 105 · conversão"**: criado como Ativação,
  com uma linha B (orçado 3.000, planejado 2.000) e uma A (1.500 / 0). Editar
  → Interno → confirmação (Cancelar não grava) → Sim: as duas viraram FI com
  planejado 3.000 e 1.500; auditoria `orcamento.virou_interno` com 2 linhas
  convertidas. Depois → categoria Always On, out–dez/2026: planilha mensal
  com os três meses; cópia de outubro para novembro e dezembro, tudo FI.
- **JOB-0047** (do TES-0001/26-13): versão aprovada; envio para abertura com
  "Sem recebimento" travado e faturamento previsto R$ 0,00; no banco,
  `data_prevista_faturamento` vazia e 6 linhas FI com planejado = orçado.
  Abertura no financeiro: Serviço só "Interno", Categoria só Always On e
  Fee; aberto com a Conta Teste. "Visualizar Jobs": "R$ 0,00 · Sem
  faturamento", fora de "Aguardando faturamento". Cabeçalho: "Aberto · Sem
  faturamento · Aguardando encerramento". Ficha: "Prev. recebimento: Sem
  faturamento". Errata: linha nova FI, prévia com planejado = orçado,
  descartada sem gravar.
- **Prontos pra encerrar:** antes do "Concluir PPs", a lista filtrada trazia
  só o JOB-0043 (conferido no banco: o único aberto sem pendência); depois
  de marcar os 6 itens do JOB-0047, os dois. O card do GP, por rota
  temporária já apagada, contou 2.
- **Encerramento do JOB-0047:** sem o aviso "Falta enviar para faturamento";
  virou **Finalizado** direto, sem envio nenhum, com a auditoria
  `job.finalizado` `{"momento": "encerramento"}`. No financeiro:
  "Finalizado · Sem faturamento". Prazos do job: "—".
- **Visão agregada:** o orçamento Interno abre sem marcar alteração;
  editando o orçado, o planejado acompanha e Tipo/planejado não abrem.
  Nada foi salvo.

`tsc`, `next lint` (só o aviso antigo do `multi-select`), `next build` e os
testes (`esteira-faturamento`, `faturamento-por-mes`, `prazos-do-job`,
`travas-do-encerramento` e os demais de `lib/`) limpos. `test:permissoes`:
as 2 falhas do RH, anteriores.

## 6. Observações e pendências

- **Uma vez, na visão agregada, a tela caiu com "Maximum update depth
  exceeded"** (medição da calha) logo depois de editar uma linha do
  Interno, numa aba que já tinha passado por várias recompilações do
  servidor de desenvolvimento. A mesma sequência, numa aba nova e na
  frente, não repetiu — nem no orçamento Interno, nem no comum. Fica o
  registro, caso alguém veja de novo.
- **"Jobs com faturamento próximo" ainda conta job já enviado para
  faturamento.** Anterior a esta decisão e fora do pedido; não foi mexido.
- **JOB-0046** ("[gravadora/editora] Operação T4", HIT-0001/26) é Always
  On, não Interno, todo em FI com 12% de honorários — faturamento zero. A
  regra do Interno não o atinge; ele passa a aparecer como "Sem
  faturamento". Vale conferir se o tipo de custo dele está certo.
- **Contato de cobrança** continua obrigatório no envio para abertura mesmo
  sem faturamento. Não foi pedido; fica a pergunta.
- **Dado de teste criado** (TES-0001/26): orçamentos TES-0001/26-12 e -13 e
  o JOB-0047, finalizado.
