# Handoff — Financeiro

Registro da implementação do módulo Financeiro, mais as decisões de modelagem e
de negócio tomadas junto com o time durante a execução.

| Parte | Design | Telas | Seções |
|---|---|---|---|
| **I** | `Abertura de Job.dc.html` | fila de abertura, conferência, formulário de registro financeiro | 1 a 10 |
| **I·rev** | revisão de 12/08 (sem design novo) | previsão de desembolso na calha PP, janelas 08/20, os dois números do fechamento | 11 a 14 |
| **II** | `Abertura de Job - Financeiro.dc.html`, aba "Jobs abertos" | lista de jobs abertos, job na visão do financeiro | 15 a 18 |
| **V** | `Abertura de Job - Telas Atuais.dc.html`, itens 02a e 03 | previsão de recebimento no formulário de abertura, planilha interna em leitura | 33 |

> Contas a pagar, conciliação e lançamentos financeiros já existiam antes deste
> documento e não estão registrados aqui.

---

# Parte I — Abertura de Job no financeiro

**Data:** 2026-08-11
**Origem do design:** projeto Claude Design, arquivo `Abertura de Job.dc.html`.

---

## 1. O que o módulo resolve

O job nasce na produção com status `aguardando_abertura` e só passa a existir
para o financeiro depois que alguém do financeiro **confere os dados da produção
e completa o registro contábil**.

Até esta entrega essa aprovação era **um botão que só mudava o status**. Nenhum
registro contábil era criado: nem categoria, nem competência, nem previsão de
desembolso. O job entrava "aberto" sem nada que o financeiro pudesse usar.

---

## 2. As três telas

| Rota | O que faz |
|---|---|
| `/financeiro/abertura-de-job` | fila dos jobs aguardando abertura, com busca e resumo |
| — modal de conferência | dados vindos da produção, resumo real da planilha, observações, atalho para a Planilha Interna |
| `/financeiro/abertura-de-job/[jobId]` | formulário de registro financeiro, com rodapé fixo que bloqueia até estar completo |

A rota antiga `/financeiro/jobs-aguardando-abertura` **virou redirect** — havia
links salvos e `revalidatePath` apontando para ela.

---

## 3. O que o financeiro registra

Sete colunas novas em `jobs`, criadas por
`20260811000002_abertura_job_financeiro.sql`:

| Coluna | Por quê |
|---|---|
| `nome_financeiro` | o financeiro renomeia o job **para o uso dele**, sem renomear o job da produção |
| `categoria_id` | classificação contábil (`categorias_dominio`, escopo `job`) |
| `competencia_trimestre` / `competencia_ano` | competência contábil, sugerida pelo início do job |
| `custo_previsto_total` | **cópia** do planejado dos itens de calha PP no instante da abertura (ver nota de 12/08 abaixo) |
| `data_abertura_financeiro` / `aberto_por` | carimbo de quem abriu e quando; não editável pela UI |

Mais a tabela `jobs_previsao_custo`: a **curva de desembolso** — em que datas o
custo previsto deve sair do caixa. Nasce com RLS, 4 policies, `GRANT` explícito
para `authenticated` e três índices.

⚠️ **Correção de regra (2026-08-12, decidida com o financeiro —
`docs/decisions/004-previsao-de-desembolso.md`).** A primeira versão somava o
planejado de **todos** os itens no custo previsto. Errado: itens de calha BV
(tipos A e D) são pagos pelo cliente direto ao fornecedor e nunca saem do caixa
da California. O que mudou:

1. **Custo previsto = planejado da calha PP** (AR, B, C, F, FI), lido de
   `REGRAS_TIPO_CUSTO.calha`. Job 100% A/D abre com custo **zero e sem curva**,
   com aviso na tela — estado legítimo, não erro.
2. **As datas da curva só podem ser janelas de pagamento** (dias 08 e 20,
   empurradas para o dia útil seguinte em fim de semana; feriado é pendência
   conhecida). O calendário trava, e a action revalida.
3. **A conferência e o formulário mostram os dois números** do fechamento
   (Faturamento previsto e Valor do Job), igual ao modal do envio — e a linha
   "Margem prevista" saiu: com o custo virando só desembolso, ela viraria "100%
   de margem" em job 100% A.
4. **`jobs.faturamento_previsto` passou a ser gravado no INSERT do envio**
   (`abertura-actions.ts`) — antes só a coluna `_abertura` era gravada e o job
   nascia nulo. Migration `20260812000001` recalculou os nulos e os custos já
   gravados (JOB-0008 foi a zero e perdeu a curva, corretamente).

---

## 4. As três decisões de modelagem que importam

**Dois nomes, não um sobrescrito.** O texto do design dizia que o nome gravado
"passa a valer no financeiro **e na página do job**". O time decidiu o
contrário: `nome` (produção) e `nome_financeiro` convivem. Sobrescrever
renomearia o job do GP sem aviso e sumiria com o termo pelo qual ele acha o job
no dia a dia. O custo é ambiguidade — mitigado mostrando o nome da produção como
linha secundária nas telas financeiras.

**O custo previsto é cópia, não soma em tempo real.** Vem de
`SUM(jobs_itens_orcado.total_planejado)`, mas fica **congelado** na coluna. Uma
errata posterior muda o planejado, e a previsão de caixa não pode ser reescrita
retroativamente.

**A curva não trava o realizado.** Ela alimenta o fluxo de caixa e o comparativo
com o planejado. PP e baixa seguem independentes dela.

---

## 5. O formulário

O custo previsto é **read-only**, com selo "Do planejado" e cadeado — vem da
planilha interna, não se digita. O subtítulo mostra a margem calculada. Os chips
de 50%/60% do protótipo saíram.

A curva de desembolso é editável e **tem que fechar com o total** (tolerância de
um centavo — ver `curva.ts`, que arredonda em centavos para dinheiro não
circular com cauda binária). O rodapé fixo bloqueia enquanto faltar campo, com a
mensagem dizendo o que falta.

Sem custo planejado na planilha, a abertura é bloqueada. Antes de implementar
isso foi verificado no banco que **nenhum job real seria travado** por essa
regra hoje.

---

## 6. Um bypass foi fechado

A página do job tinha um botão "Aprovar abertura" que levava o job direto para
`aberto`. Com os campos financeiros obrigatórios, esse caminho abriria jobs
**sem categoria, sem competência e sem custo previsto** — exatamente o buraco
que esta entrega veio fechar.

O botão virou link para o formulário novo, e a server action
`aprovarAberturaJob` foi removida.

---

## 7. Desvios do design, de propósito

- O texto do modal de reprovação dizia que a justificativa "é enviada na
  comunicação do job". Hoje ela só grava `motivo_rejeicao` — o texto foi
  reescrito para o que de fato acontece.
- O botão "Reiniciar" do cabeçalho é controle do protótipo e não entrou.

---

## 8. Verificação (2026-08-11)

`tsc --noEmit` e `next lint` limpos. Fluxo exercitado no navegador **até a
gravação real**, abrindo o JOB-0008:

| Campo | Valor gravado |
|---|---|
| `status` | `aberto` |
| `nome` (produção) | Teste Orçamento — **intacto** |
| `nome_financeiro` | Teste Orçamento |
| categoria · competência | Evento · 3T/2026 |
| `custo_previsto_total` | 8.000,00 |
| `data_abertura_financeiro` / `aberto_por` | 11/08 22:53 UTC · Tiago Mendonça |
| curva | 1 linha · 16/08/2026 · R$ 8.000,00 |

Auditoria gravou `job.aberto_no_financeiro` com competência, custo e número de
datas. Redirecionou para a página do job, que mostra "ABERTO" e custo planejado
de R$ 8.000,00 — o mesmo número. A fila voltou a zero com o empty state certo.

Confirmado que o custo previsto é **relido do banco na Server Action**: o valor
gravado veio de `SUM(total_planejado)`, não do formulário.

⚠️ Durante esta entrega o `.next` corrompeu (`Cannot find module for page`,
`ENOENT ... 0.pack.gz`) por rodar build com o dev server ligado. O conserto é
apagar `.next` e reiniciar. Ver a mesma armadilha na Entrega 16 do
`HANDOFF_ORCAMENTO.md`.

---

## 9. O que ficou aberto

1. **Aba "Jobs abertos"** — a barra de abas já está montada com a aba única e o
   badge de contagem, para a segunda encaixar sem retrabalho de layout.
2. **Páginas próprias do financeiro para o job**, com diferenças de coluna e,
   dentro de *Informações do Job*, previsões de pagamento e PPs.
3. **Faturamento.** Os chips de filtro por faturamento **não** entraram de
   propósito: chip de filtro promete filtrar, e ligado num campo inexistente
   retornaria zero jobs sempre — quem usa concluiria que o dado sumiu, não que a
   feature não existe. "Aguardando encerramento" ainda exigiria mexer no
   `job_status`, cujo fluxo de encerramento está bloqueado em `lib/types.ts`.
4. ~~**`jobs.observacoes`** grava e nenhuma tela lê~~ — desatualizado: o modal
   de conferência lê desde 11/08 ("Observações da produção").
5. **Integração da curva com o Fluxo de caixa** — ver seção 14: a tela da
   task015 ainda não lê `jobs_previsao_custo`.

---

## 10. Migrations

| Migration | O que faz |
|---|---|
| `20260811000002_abertura_job_financeiro.sql` | 7 colunas em `jobs`, tabela `jobs_previsao_custo` com RLS + 4 policies + GRANT + índices, escopo `job` em `categorias_dominio` |
| `20260811000003_categorias_dominio_job_seed.sql` | 5 categorias de job iniciais, idempotente |
| `20260812000001_previsao_desembolso_calha_pp.sql` | recalcula `custo_previsto_total` dos jobs abertos com a regra da calha PP, apaga curvas de desembolso zero e faz backfill de `faturamento_previsto` nulo |

---

# Revisão de 12/08 — previsão de desembolso, janelas de pagamento e os dois números

**Data:** 2026-08-12
**Regra de negócio:** `docs/decisions/004-previsao-de-desembolso.md`
**Origem:** revisão da entrega com o financeiro. Sem design novo — as mudanças
são de regra, não de layout.

---

## 11. Custo previsto passou a ser só o que a California desembolsa

A primeira versão somava o planejado de **todos** os itens no custo previsto.
Errado: itens de calha BV (tipos A e D) são pagos pelo cliente direto ao
fornecedor — esse dinheiro nunca sai do caixa da California e estaria inflando
o fluxo de caixa com desembolsos que não existem.

**A regra agora:** custo previsto = planejado dos itens de **calha PP**
(`AR`, `B`, `C`, `F`, `FI`). O planejado dos tipos A e D **continua existindo
como controle interno da planilha, mas nunca gera previsão de custo** — isso,
por decisão do financeiro, não muda nem em fase futura.

Onde a regra mora:

| Peça | Papel |
|---|---|
| `REGRAS_TIPO_CUSTO.calha` (`lib/calculos/versao-totais.ts`) | campo novo `"PP" \| "BV"`, na mesma matriz das demais regras por tipo — espelha a coluna Calha de `docs/decisions/003` e o trigger `bv_tipo_com_bv` do banco |
| `tipoGeraDesembolso()` / `TIPOS_CALHA_PP` | helpers derivados; tipo novo com `calha: "PP"` entra sozinho |
| `dados.ts` → `planilha_desembolso` | agregado separado do `planilha_planejado` (que segue sendo o total, controle interno) |
| Server Action | relê os itens do banco e refaz a soma com o filtro — não confia no formulário |

**Job 100% A/D abre com custo zero, sem curva e com aviso** ("Nenhum desembolso
previsto pela California") — é estado legítimo, não erro. A action valida a
simetria: custo zero exige curva vazia; custo positivo exige curva que some o
total. A auditoria ganhou `sem_desembolso` no metadata.

Junto com isso, a linha **"Margem prevista" saiu do formulário**: com o custo
virando só desembolso, ela diria "100% de margem" num job 100% A. Rentabilidade
tem casa própria (Resultado planejado, na página do job).

---

## 12. Janelas de pagamento e os dois números do fechamento

**Janelas.** A California paga em duas janelas por mês — **dia 08 e dia 20**,
empurrados para o dia útil seguinte quando caem em fim de semana. As datas da
curva agora só podem ser janelas: a sugestão automática já nasce nelas, o
calendário desabilita os demais dias (`DatePicker` ganhou o prop opcional
`dateDisabled`, aditivo), e a Server Action revalida — regra crítica não
depende do frontend. A matemática vive em `curva.ts`
(`proximaJanelaDePagamento`, `ehJanelaDePagamento`, `janelaSeguinte`).

> ⚠️ Feriado ainda não é tratado — não existe calendário de feriados no
> sistema. Quando existir, o ajuste entra em `ajustarParaDiaUtil`, num lugar só.

**Os dois números.** A conferência, o card "Dados da produção" do formulário e
o modal de confirmação passaram a mostrar **Faturamento previsto** (vermelho) e
**Valor total**, na mesma ordem e hierarquia do modal do envio de job — era a
única tela do fluxo que ainda mostrava um número só. O subtítulo do card "Valor
total do job", que dizia "Faturamento previsto do orçamento" (verdade até os
dois números se separarem), virou "Compromisso total do cliente, somando o que
ele paga direto ao fornecedor".

**`jobs.faturamento_previsto` corrigido nas duas pontas:** o INSERT do envio
(`abertura-actions.ts`) agora grava a coluna viva — antes só a `_abertura` era
gravada e todo job nascia nulo; a migration `20260812000001` recalculou os
nulos com a mesma fórmula determinística do backfill original.

**Abatimento por PP** (para a entrega do fluxo de caixa — as regras já estão
fechadas em `docs/decisions/004`): a PP é o título; quando um item ganha PP, o
planejado inteiro daquele item sai da previsão; o consumo é da data mais
próxima para as seguintes; saldo que passa da data rola para a próxima janela;
encerramento do job encerra o resíduo. Implementação recomendada e registrada:
**resíduo calculado na leitura**, nunca reescrevendo a curva da abertura.

---

## 13. Verificação (2026-08-12)

`tsc --noEmit` e `next lint` limpos. Matemática das janelas validada com casos
reais: 08/08/2026 (sábado) → 10/08; 20/09/2026 (domingo) → 21/09; 21/08 → 08/09.

Fluxo de **desembolso zero** exercitado no navegador até a gravação real,
abrindo o JOB-0009 (100% tipo A):

| Checagem | Resultado |
|---|---|
| Card "Custo previsto total" | R$ 0,00 · "Nenhum item de calha PP" |
| Bloco da curva | substituído pelo aviso âmbar; sem "Adicionar data" |
| Rodapé | "Tudo pronto. Este job não tem desembolso previsto pela California — abre sem curva." |
| Conferência | Faturamento previsto R$ 149,12 (vermelho) + Valor total R$ 1.149,12 |
| Gravação | `aberto`, Evento, 3T/2026, custo 0,00, **zero** linhas de curva |
| Auditoria | `job.aberto_no_financeiro` com `sem_desembolso: true` |
| Migration | JOB-0008 recalculado para custo 0,00 e curva apagada; `faturamento_previsto` do JOB-0009 backfilled (149,12) |

---

## 14. Integração pendente com o Fluxo de caixa (task015)

A task015 (paralela a esta revisão) criou a tela **Fluxo de caixa** sobre a
view `vw_fluxo_caixa` — que lê PPs, contas avulsas e lançamentos, mas **não lê
`jobs_previsao_custo`**. Ou seja: o "previsto" daquela tela hoje é título
emitido, não previsão de abertura.

A integração que falta é exatamente o que `docs/decisions/004` especifica: o
resíduo da curva (curva − planejado dos itens que já têm PP, consumido na ordem
das datas, rolado por janela) entra como camada de previsão por cima dos
títulos. Sem isso, o fluxo de caixa enxerga o desembolso só depois da PP
existir — some o horizonte entre a abertura do job e a emissão das PPs.

---

# Parte II — Jobs abertos

**Data:** 2026-08-12
**Origem do design:** `Abertura de Job - Financeiro.dc.html`, aba "Jobs abertos"
e tela "Job aberto — visão do financeiro".

---

## 15. As duas telas

| Rota | O que faz |
|---|---|
| `/financeiro/abertura-de-job` | ganhou a **segunda aba**: lista dos jobs já abertos, agrupada por projeto |
| `/financeiro/jobs/[jobId]` | o job na visão do financeiro — somente leitura, focada em dinheiro |

A aba é estado de tela, não rota: as duas listas descem prontas do server
component, carregadas em `Promise.all`. Trocar de aba não refaz query, e as duas
contagens do cabeçalho ficam sempre verdadeiras. A aba inicial é "Jobs abertos"
quando a fila está vazia — que é o estado normal do dia a dia.

**Rota própria para o job, e não a página de Jobs**, porque as duas respondem a
perguntas diferentes: lá é a operação, aqui é o compromisso financeiro. Planilha
interna, erratas e comunicação continuam morando em `/jobs/[jobId]`, e daqui se
navega para lá — duplicar essas três seria criar duas telas caras para manter em
sincronia.

**Nenhuma migration.** Esta entrega é só leitura do que já existe.

---

## 16. O que saiu do design, e por quê

Três coisas do design **não** entraram, todas por falta de dado real por trás —
decisões tomadas com o time antes de codar:

1. **Chips e coluna de faturamento** (`Faturado` / `Aguardando faturamento`) e a
   linha de totais por faturamento. Não existe nada no banco que diga se um job
   foi faturado. Chip de filtro ligado em campo inexistente devolve zero linhas
   sempre, e quem usa conclui que o dado sumiu — não que a feature não existe.
   Entra junto de contas a receber. No lugar, o resumo mostra a contagem e o
   **valor total** dos jobs visíveis, que recalcula com os filtros.
2. **Badge "Aguardando encerramento".** `job_status` não tem esse estado e o
   fluxo de encerramento está registrado como bloqueado em `lib/types.ts`.
3. **Coluna "Situação" nas previsões de pagamento.** No design, a parcela vira
   "Pago" quando a data já passou — mas data que passa não paga nada. Pela
   decisão 004, a previsão é abatida quando a PP do item é emitida. Enquanto
   esse abatimento não existir de verdade, o card mostra o que sabe (data, valor
   e % do total) em vez de inventar um estado. Ver seção 18.

Duas colunas **entraram** no lugar das que saíram, porque agora há dado:
**Categoria** e **Competência**. O filtro "Ano" usa o **ano da competência**, o
eixo contábil, não o do calendário do job.

O KPI de topo segue a regra de 12/08 — **um número só, o Valor do Job** — e não
o "Faturamento previsto" que o design mostrava, anterior a essa regra.

---

## 17. Detalhes que valem registro

- **Nome duplo na lista.** A linha mostra o nome do financeiro e, quando difere,
  o da produção abaixo em cinza. A busca casa com os **dois**: quem procura pode
  lembrar do nome antigo, não do que o financeiro deu.
- **Grupos nascem abertos**, e o state guarda os *fechados* — evita semear o
  state com os ids dos projetos no mount. Com filtro ativo o grupo abre sempre:
  fechado, ele esconderia justamente o job que o filtro encontrou. Mesmo padrão
  de `/jobs`.
- **`aberto_por` não entra como embed.** A FK aponta para `auth.users`, não para
  `profiles`, então o PostgREST não enxerga relação por ali e devolve *"Could not
  find a relationship between 'jobs' and 'profiles'"*. O nome vem de uma consulta
  à parte por id (`profiles.id == auth.users.id`), em paralelo com a do
  realizado.
- **PPs rejeitadas e canceladas** aparecem na tabela, mas ficam **fora** do total
  e dos rodapés: não são compromisso nem desembolso. O rodapé separa o que já
  saiu do caixa (`pago`) do que está comprometido e ainda não pago
  (`em_avaliacao` + `aprovada`).

---

## 18. Verificação (2026-08-12)

`tsc --noEmit` e `next lint` limpos; `npm run build` compilou com as duas rotas
no bundle. No navegador, com dados reais:

| Checagem | Resultado |
|---|---|
| Lista | 10 jobs em 5 projetos, total R$ 2.649.570,15 |
| Filtro GP = Debora Brito | 2 jobs, total recalculado para R$ 537.749,98 |
| Job com curva e PP (JOB-0010) | previsão de 20/08 · R$ 11.760,00 (100%); PP-00007 rejeitada, fora do total ativo; margem R$ 12.316,81 · 51,2% |
| Job sem desembolso (JOB-0008) | card de previsões explica a calha BV; card de PPs mostra o vazio |
| Competência e abertura | preenchidas nas 10 linhas, efeito do backfill dos jobs legados |

---

## 19. O que ficou aberto

1. **Faturamento** — chips, coluna e totais, junto de contas a receber.
2. **Encerramento** — badge e chip, quando o fluxo existir.
3. **Abatimento da previsão por PP** — a coluna "Situação" do card de previsões
   e a integração com `vw_fluxo_caixa` (seção 14). As regras já estão fechadas em
   `docs/decisions/004-previsao-de-desembolso.md`.

---

# Parte III — Envio do job para faturamento

**Data:** 2026-08-13
**Escopo combinado com o time:** etapa 1 de 2. O **encerramento** (resumo de
fechamento, trava por PP/BV em aberto e job somente-leitura) ficou para a etapa
seguinte, por ser a que mais toca o módulo de Jobs.

---

## 20. O passo que faltava

Antes desta entrega não havia nada entre "job aberto" e "financeiro emite a
NF": a `vw_faturamento_pendente` listava **todo job aberto** com faturamento
previsto, e o financeiro descobria sozinho o que estava pronto. Faltavam
justamente as informações que só a produção tem — número da PO, CNAE a usar,
portal do cliente e o vencimento acordado.

Agora a produção **libera** o job, e é essa liberação que põe o job na fila.

| Tabela | Papel |
|---|---|
| `cliente_portais` | portais de fornecedor do cliente. **Vários por cliente** — decisão do time: certos clientes têm mais de um |
| `jobs_envio_faturamento` | a liberação: valor, PO, vencimento, CNAE, portal escolhido, quem enviou e quando. Um por job |

⚠️ **`vw_faturamento_pendente` mudou** (migration `20260813000018`): o ramo
`job` agora exige o envio, e passa a usar o **valor liberado** e o **vencimento
acordado** no lugar do previsto corrente e da data da abertura. O ramo `bv`
ficou intacto. Feita com `create or replace` e lista de colunas idêntica — a UI
da task016 não precisou mudar. **Consequência aceita pelo time: job aberto que
ainda não foi enviado some da aba Faturamento até alguém enviá-lo.**

---

## 21. Decisões

- **O valor vai travado.** Vem de `jobs.faturamento_previsto` (já com erratas) e
  é **relido no servidor** — valor de nota fiscal não vem do formulário. O
  campo é read-only, com selo "Do faturamento previsto".
- **Cópia, não referência.** `valor_faturado` é congelado no envio: errata
  posterior mudaria o valor que a produção declarou ter liberado.
- **CNAE é texto livre nesta fase**, por decisão do time — não existe cadastro
  de CNAE no projeto e criar um agora seria antecipar estrutura sem uso
  definido. Quando virar lista, o campo vira FK.
- **O portal guarda snapshot da URL** além da FK: se o cadastro mudar depois, o
  registro do envio continua dizendo para onde a nota devia ir. O servidor
  confere que o portal escolhido é **do cliente daquele job** — a lista do
  formulário não é garantia.
- **Envio é único por job** (unique em `job_id`) e **não tem DELETE**: é evento,
  não rascunho. NF parcial continua possível do lado do financeiro, onde
  `faturamentos` controla o saldo.
- **O encerramento só aparece depois do envio** — antes disso não há o que
  encerrar.

---

## 22. Abertura saiu da página do job

O bloco "Aprovação financeira" foi **removido** de `/jobs/[jobId]`: abrir e
rejeitar viraram ações exclusivas da Central Financeira, onde o modal de
conferência já tem as duas. Uma responsabilidade, um lugar. No lugar do bloco,
job aguardando abertura mostra só para onde ir.

Sobre "nenhuma PP enquanto o job não for aberto": **já estava valendo** nas duas
camadas — `checarGatesRealizado` (server) e `podeEditarRealizado` (UI) exigem
`aberto` ou `em_producao`. Verificado no navegador: JOB-0011, aguardando
abertura, não mostra "Gerar PP".

---

## 23. Verificação (2026-08-13)

`tsc --noEmit` e `next lint` limpos; `npm run build` compilou. Banco conferido
pelo MCP: 2 tabelas, 7 policies, `authenticated` com acesso, `anon` sem nenhum.

| Checagem | Resultado |
|---|---|
| JOB-0011 (aguardando) | sem "Abrir no financeiro", sem "Rejeitar", sem "Gerar PP"; aviso aponta para a Central Financeira |
| JOB-0010 (aberto) | "Enviar job para faturamento" aparece; encerramento escondido |
| Formulário | valor travado em R$ 21.076,81 (o previsto **após a errata**, não o valor do job); vencimento pré-preenchido com 25/08/2026 da abertura; "Enviar" bloqueado sem CNAE; aviso de portal não cadastrado |

---

## 24. O que falta desta frente

> ⚠️ **Atualizado em 13/08/2026.** Os quatro itens desta lista foram
> entregues — ver seções 25 a 27. O que sobrou está na seção 28.

1. **Cadastro de portais no cliente.** ✅ Entregue — `PortaisCard` em
   `/clientes/[id]`, com inativação em vez de exclusão.
2. **A gravação não foi exercitada de ponta a ponta.** ✅ Exercitada no
   JOB-0010 (seção 25).
3. **Etapa 2 — encerramento.** ✅ Entregue (seção 26).
4. **Jobs Abertos ganha a coluna de faturamento.** ✅ Entregue (seção 27).

---

## 25. Parte IV — o envio para faturamento, exercitado

O JOB-0010 foi enviado de ponta a ponta: `valor_faturado` R$ 21.076,81,
`numero_po` PO-2026-0042, vencimento 25/08/2026, CNAE preenchido, portal
"Coupa" do cliente gravado junto com a URL do momento do envio. A auditoria
registrou `job.enviado_para_faturamento`; o botão de envio sumiu da tela e o
de encerramento apareceu no lugar.

O `portal_url` é **cópia**, não referência: o cadastro do cliente pode mudar
de endereço depois, e o registro do envio não pode mudar junto.

---

## 26. Parte IV — encerramento

Regras completas em `docs/decisions/008-encerramento-do-job.md`. O resumo:

- **Só encerra job já enviado para faturamento.**
- **Trava por documento em aberto:** PP em `em_avaliacao`/`aprovada` ou BV em
  `a_negociar`/`confirmado` bloqueiam, e a tela diz **quais** — pelo código da
  PP e pelo item do BV.
- **Resumo de fechamento** antes de gravar: faturamento previsto na abertura ×
  Faturamento (o previsto de agora), desmembrado em custos orçados, honorários
  e encargos/impostos, mais custo realizado e **margem em valor e percentual**.
- **Job encerrado é congelado** — `jobEstaCongelado()` barra edição, PP, BV,
  realizado e errata, no servidor e na interface.

Dois achados no caminho:

1. **`atualizarJob` não tinha gate de status nenhum.** Job cancelado era
   editável. Ganhou a trava.
2. **O card de Status sumiria do job encerrado**, levando junto o registro do
   faturamento — a condição de render dependia só de haver transição ou envio
   pendente. Corrigido: com envio registrado o card fica, e uma frase explica o
   que "encerrado" significa.

**Onde a divergência aparece:** se uma errata mexer no job entre o envio e o
encerramento, o resumo mostra o valor enviado ao lado do faturamento atual e
manda confirmar com o financeiro. O sistema não escolhe qual foi para a nota.

### Verificação (2026-08-13)

`tsc --noEmit` e `next lint` limpos. Conferido no navegador, JOB-0010:

| Checagem | Resultado |
|---|---|
| Trava | "Este job ainda não pode ser encerrado. 1 BV ainda não recebido: Sinalização." — botão desabilitado |
| Faturamento previsto na abertura | R$ 19.684,81 (bate com `faturamento_previsto_abertura`) |
| Faturamento | R$ 21.076,81 (bate com `faturamento_previsto` e com o valor enviado — sem divergência) |
| Desmembramento | custos R$ 17.820,00 · honorários 12% R$ 2.138,40 · encargos 19,54% R$ 4.118,41 → Valor do Job R$ 24.076,81 |
| Margem | R$ 9.958,40 e 41,4% — igual ao "Resultado realizado" do cabeçalho |
| `levantarImpedimentos` (servidor) | rota temporária de leitura devolveu, para os 11 jobs, exatamente o que o SQL direto devolve |

> ⚠️ **Atualizado em 14/08/2026.** O encerramento foi executado de ponta a
> ponta no JOB-0009 — ver seção 29.

---

## 27. Jobs Abertos alinhado ao design

A lista passou a ter as colunas do design: **Código · Nome · Empresa ·
Projeto · Cliente · GP responsável · Abertura · Valor total · Faturamento**.
Saíram Categoria e Competência — não estão no design; os dois campos
continuam existindo no job e aparecem no detalhe do financeiro.

O projeto aparece **duas vezes** de propósito: na faixa do agrupamento e na
coluna. Com o grupo colapsado por um filtro, a linha vira resultado de busca
solto e "de que projeto é isso?" some.

**Chips:** ver seção 29 — o "Aguardando encerramento" do design saiu em
14/08/2026, e a esteira ganhou dois estados de dinheiro.

A tabela `faturamentos` é da outra frente (contas a receber) e está vazia
hoje — por isso "Faturado R$ 0,00". A ligação é polimórfica
(`origem_tipo`/`origem_id`), então não há embed possível: são queries rasas
em `Promise.all`, cruzadas em memória, como manda `docs/PERFORMANCE.md`.

---

## 28. Correção do valor do JOB-0001

`jobs.valor_total` do JOB-0001 estava em **R$ 1.000.000,00** sobre um único
item orçado de R$ 4.000,00 — resquício do campo de valor editável à mão que
o drawer teve antes de o fluxo estar estruturado (o campo já não existe; ver
comentário no topo de `app/(app)/jobs/actions.ts`).

O número correto sai de `calcularTotaisVersao`: 4.000 de custo + 520 de
honorários (13%) + 1.097,00 de imposto 19,53% "por dentro" = **R$ 5.617,00**
— exatamente o que `faturamento_previsto` e `valor_job_abertura` já
traziam. Só a coluna `valor_total` divergia.

Corrigido pela migration `20260814000001_corrige_valor_total_job_0001.sql`,
com guarda no `WHERE` que a torna idempotente e impede que toque em qualquer
outro job. **Autorizado pelo Tiago em 14/08/2026.**

**Conferência do universo inteiro antes de mexer:** a fórmula foi replicada
em SQL e rodada contra os 11 jobs. Os outros 10 batem ao centavo com o
gravado — o JOB-0001 era o único divergente. É o que dá confiança de que a
correção acerta o número, e não que a fórmula estivesse errada.

---

## 29. A esteira ganhou Liquidado e Inadimplente

Regras completas em `docs/decisions/009-esteira-do-faturamento.md`.

O chip "Aguardando encerramento" do design **saiu**: se sobrepunha a
"Faturado" e os dois devolviam o mesmo conjunto (decisão do Tiago,
14/08/2026). No lugar entraram os dois estados de dinheiro:

| Estado | Condição |
|---|---|
| Aguardando envio | sem `jobs_envio_faturamento` |
| Enviado | envio registrado, sem nota |
| Faturado | nota emitida, nada vencido |
| **Inadimplente** | nota emitida e parcela vencida em aberto |
| **Liquidado** | todas as parcelas recebidas |

Chips: **Todos · Aguardando faturamento · Faturado · Liquidado ·
Inadimplente**. "Aguardando faturamento" cobre os dois estados antes da
nota. Liquidado e Inadimplente entram no resumo **só quando existem** —
enquanto o módulo de recebimento não roda, a linha fica igual à do design.

O nome é **"Liquidado"**, e não "Recebido": o sistema já usa `recebido` para
BV e `pago` para PP, e um terceiro "recebido" no nível do job criaria
ambiguidade na tela onde os três aparecem.

A regra mora em `lib/calculos/esteira-faturamento.ts` como **função pura**,
de propósito: `faturamentos` e `titulos_receber` são da frente de contas a
receber, e conferir pela interface exigiria emitir nota no módulo do outro.

---

## 30. Bug corrigido: envio sem PO não funcionava

O campo "Número da PO" é opcional, mas o envio com ele **vazio** falhava,
mostrando ao usuário a mensagem crua do Zod em inglês: *"Expected string,
received null"*.

Causa: o drawer manda `null` quando o campo fica em branco, e o schema era
`z.string().optional()` — que aceita `undefined`, não `null`. Corrigido com
`.nullable()` em `numero_po`. Aproveitando, `portal_id` ganhou mensagem em
português no `.uuid()`, que era o outro caminho capaz de vazar inglês.

**Por que passou despercebido até agora:** os dois envios anteriores
(JOB-0010 e JOB-0001) tinham PO preenchida. O caso opcional só apareceu no
primeiro envio sem PO — exatamente o que o campo opcional existe para
permitir.

---

## 31. Verificação (2026-08-14)

`tsc --noEmit` limpo, `next lint` sem novidades (só os 2 warnings
pré-existentes de `combobox`/`multi-select`), `npm run build` compilou.

### Fluxo completo, JOB-0001

| Checagem | Resultado |
|---|---|
| Valor corrigido | R$ 5.617,00 no cabeçalho, no metadata e no valor de faturamento |
| Envio para faturamento | gravado: R$ 5.617,00, PO-2026-0001, venc. 14/08/2026, CNAE, sem portal (cliente não tem) |
| Trava do encerramento | "Este job ainda não pode ser encerrado. 1 PP sem baixa: PP-00001." — botão desabilitado |
| Resumo | custos R$ 4.000,00 · honorários 13% R$ 520,00 · encargos 19,53% R$ 1.097,00 → Valor do Job R$ 5.617,00 |
| Margem | R$ 2.520,00 e 44,9% — igual ao "Resultado realizado" do cabeçalho |

**O JOB-0001 não foi encerrado.** Para isso seria preciso dar baixa na
PP-00001, e a baixa chama `dar_baixa_pp`, que gera lançamento financeiro e
movimenta saldo de conta bancária — módulo de contas a pagar da outra
frente. Não entrei nele. O caminho feliz foi exercitado no JOB-0009, abaixo.

### Caminho feliz, JOB-0009

| Checagem | Resultado |
|---|---|
| Envio **sem PO** | gravou `numero_po: null` — o bug da seção 30, corrigido e conferido |
| Resumo sem trava | botão "Encerrar job" ativo |
| Números | custos R$ 1.000,00 · honorários 12% R$ 120,00 · encargos 19,53% R$ 29,12 → Valor do Job R$ 1.149,12 |
| Margem sem custo realizado | "—" nos dois campos, com a frase explicando que a conta apareceria como se a receita inteira fosse lucro |
| Encerramento | status `encerrado`, auditoria `job.encerrado` com `{faturamento: 149.12}` |
| Congelamento (interface) | botão "Editar" sumiu; planilha sem "Alterar orçado", sem calha de BV e sem "Gerar PP"; card de Status manteve o registro do faturamento e ganhou "Job encerrado — é histórico. Não aceita edição, PP nem BV." |
| Saiu da lista | Jobs Abertos foi de 10 para 9 |

### Congelamento no SERVIDOR, exercitado

A interface esconder o botão não prova nada — a regra tem que estar na
action. As três foram chamadas direto contra o JOB-0009 já encerrado, por
uma rota temporária, e **as três recusaram**:

| Action | Resposta |
|---|---|
| `atualizarJob` | "Job encerrado — não pode mais ser editado." |
| `cancelarBv` | "Job encerrado — o BV não pode mais ser alterado." |
| `encerrarJob` (de novo) | "Só job aberto pode ser encerrado. Este está em encerrado." |

O teste foi montado para **não gravar em nenhum cenário**, inclusive se a
trava tivesse falhado: `atualizarJob` recebeu os mesmos valores que já
estavam no banco, e `cancelarBv` rodou num item sem BV (a action pararia no
"BV não encontrado" antes de criar qualquer coisa).

Confirmado depois: `updated_at` do JOB-0009 continua no instante do
encerramento (04:55:07), sem rastro da tentativa das 06:47 — e a auditoria
registrou `acao_negada` com `{acao_tentada: "job.atualizado", motivo:
"status_bloqueia_edicao", status_atual: "encerrado"}`.

`cancelarBv` é a prova das três ações de BV: `salvarBv`, `confirmarBv` e
`cancelarBv` passam todas pelo mesmo `carregarContexto`, onde a trava mora.

### A esteira

10 casos rodados contra a função de produção (`classificarFaturamento`),
**10/10 corretos**: os cinco estados, parcela vencendo hoje, parcela paga
com atraso, e a mistura de paga + vencida.

### Jobs Abertos

| Checagem | Resultado |
|---|---|
| Resumo | 9 jobs abertos · Faturado R$ 0,00 · Aguardando faturamento R$ 1.209.838,03 · Valor total R$ 1.654.038,03 |
| Somas conferidas | R$ 1.209.838,03 = R$ 1.209.987,15 − R$ 149,12 (JOB-0009 encerrado). Valor total = R$ 2.649.570,15 − R$ 1.149,12 − R$ 994.383,00 (correção do JOB-0001) |
| Coluna | JOB-0001 e JOB-0010 com selo âmbar "ENVIADO"; os demais "AGUARDANDO ENVIO" |
| Chips | "Liquidado" e "Inadimplente" devolvem 0 jobs e R$ 0,00 — correto, `faturamentos` está vazia |

---

## 32. O que falta desta frente

1. **Liquidado e Inadimplente nunca foram vistos com dado real.** A regra
   está conferida em 10 casos, mas depende de `faturamentos` e
   `titulos_receber` receberem movimento pela frente de contas a receber.
2. **JOB-0001 segue aberto**, com a PP-00001 em avaliação. Encerrá-lo exige
   baixa no módulo de contas a pagar — decisão sua.
3. **Abatimento da previsão de desembolso pela PP** e integração com
   `vw_fluxo_caixa` (seção 14).
4. **Feriados na janela de pagamento.** Hoje o ajuste só empurra sábado e
   domingo (seção 12).

---

## 33. Previsão de recebimento e planilha em leitura na abertura (2026-08-17)

Itens **02 (versão 02a)** e **03** do catálogo
`Abertura de Job - Telas Atuais.dc.html`. Regra nova em
`docs/decisions/015-previsao-de-recebimento-na-abertura.md`.

> ⚠️ **Isto muda o formulário descrito nas seções 3 a 6.** Até aqui a
> abertura registrava **uma** previsão (a curva de desembolso). Agora são
> **duas**, em cards separados: "Previsão de recebimento" em cima,
> "Previsão de custos" embaixo. O selo de status do cabeçalho
> ("Conferido") **foi removido** — decisão do Tiago: é desnecessário.

### O card novo — Previsão de recebimento

Dois números no topo, os mesmos dois do fechamento do envio: **Valor
total do job** (compromisso do cliente) e **Faturamento previsto** (o que
a California recebe, com o selo "Do orçamento"). Abaixo, a tabela de
parcelas — mesma anatomia da curva de desembolso: `#`, data prevista,
valor, % do total, lixeira; "Distribuir igualmente" no cabeçalho,
"Adicionar parcela" no rodapé, e o chip verde/âmbar dizendo se a soma
fecha.

| | Curva de desembolso | Parcelas de recebimento |
|---|---|---|
| Fecha contra | `custo_previsto_total` (planejado da calha PP) | `jobs.faturamento_previsto` |
| Primeira data | janela de pagamento dentro do período do job | data prevista de faturamento do envio |
| Datas seguintes | próxima janela (08/20, ajustada) | +30 dias da anterior |
| Restrição de data | **só** janelas de pagamento | nenhuma — quem manda é o cliente |
| Total zero | abre sem curva (job 100% A/D) | abre sem previsão (nada a faturar) |

O total **não vem do formulário**: a action relê `faturamento_previsto`
do banco antes de conferir a soma, como já fazia com o custo previsto.

### Migration

`20260817000003_jobs_previsao_recebimento.sql` — aditiva, espelho exato
de `jobs_previsao_custo`: 9 colunas, `tenant_id`, RLS ligada, 4 policies
só para `authenticated` via `is_tenant_member`, 3 índices + PK + unique
`(job_id, ordem)`, trigger de `updated_at` e GRANT explícito. Tipo
`JobPrevisaoRecebimento` em `lib/types.ts`, no mesmo commit.

### O resto do quadro 02a

| Onde | O que mudou |
|---|---|
| Cabeçalho | selo de status removido; subtítulo passou a citar as duas previsões |
| Lateral | card novo **"Descritivo do Job"** — o texto que a produção escreveu no envio (`jobs.observacoes`), mais "Enviado por" (o `created_by` do job) e "Orçamento de origem" |
| Lateral | "Ver planilha interna" virou o bloco do protótipo: ícone, título e o resumo real da planilha (`N agrupamentos · N itens · orçado R$ X`) |
| Resumo do registro | ganhou **Faturamento previsto**, **Recebimentos** e **Margem prevista** (faturamento − custo, verde quando positiva) |
| Confirmação | linha "Recebimento" com `N× · primeira → última`, ao lado da linha da curva |

### Item 03 — planilha interna em leitura

Rota nova `/financeiro/abertura-de-job/[jobId]/planilha`, aberta pelo
bloco "Visualizar planilha interna" da lateral. É **a mesma planilha** da
aba Planilha Interna do job — `JobGrupoCard` e `JobTotaisCard`, os
mesmos componentes, sem cópia — com `editable` e `podeAcoes` em `false`:
sem edição de realizado, sem "Alterar orçado", sem trilha de BV/PP.
Cabeçalho com "Voltar para a abertura" e o selo "Somente leitura".

Job que já saiu da fila cai por redirect na planilha da página do job:
esta rota é passo do fluxo de abertura, não uma segunda casa da planilha.

### Fora do escopo, de propósito

- **Itens 01 e 04 a 07 do catálogo não foram tocados** — inclusive o
  diálogo de conferência da fila, que continua existindo (é por isso que
  o protótipo mostra "Em conferência" no cabeçalho e nós não mostramos
  selo nenhum).
- **02b** (card único "Previsões" com tabela unificada) foi avaliado e
  descartado pelo Tiago.
- **Contato de cobrança** (`jobs_contatos`, criado na entrega de
  17/08 do `HANDOFF_ORCAMENTO.md`) **continua invisível para o
  financeiro** — não entrou aqui. A decisão 012 aponta para esta tela e
  está errada; o destino segue em aberto.
- **Duas divergências conscientes do protótipo**, porque copiá-lo diria
  algo falso sobre o nosso dado: o subtítulo de "Valor total do job" no
  card de custos (o protótipo escreve "Faturamento previsto do
  orçamento", mas aqui os dois números são diferentes) e o rótulo
  "Descritivo do Job" no lugar de "Observações da produção" (nome que o
  campo passou a ter nas duas pontas em 17/08).

### Arquivos

`[jobId]/abertura-form.tsx`, `[jobId]/page.tsx`,
`[jobId]/planilha/page.tsx` (novo), `dados.ts`, `curva.ts`, `actions.ts`,
`lib/validations/abertura-financeiro.ts`, `lib/types.ts`.
