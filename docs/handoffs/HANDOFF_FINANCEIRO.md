# Handoff — Financeiro

Registro da implementação do módulo Financeiro, mais as decisões de modelagem e
de negócio tomadas junto com o time durante a execução.

| Parte | Design | Telas | Seções |
|---|---|---|---|
| **I** | `Abertura de Job.dc.html` | fila de abertura, conferência, formulário de registro financeiro | 1 a 10 |
| **I·rev** | revisão de 12/08 (sem design novo) | previsão de desembolso na calha PP, janelas 08/20, os dois números do fechamento | 11 a 14 |
| **II** | `Abertura de Job - Financeiro.dc.html`, aba "Jobs abertos" | lista de jobs abertos, job na visão do financeiro | 15 a 18 |
| **V** | `Abertura de Job - Telas Atuais.dc.html`, itens 02a e 03 | previsão de recebimento no formulário de abertura, planilha interna em leitura | 33 |
| **VI** | `Contas a Pagar - Titulos a Pagar.dc.html` | aba unificada de títulos a pagar, baixa por parcela, aprovação com data de pagamento | 34 |
| **VII** | `Contas a Receber - Faturamento Agrupado.dc.html` | NF cobrindo vários jobs, faturamento parcial e avulso, previsão de recebimento do título | 35 |
| **VIII** | `Fluxo de Caixa.dc.html` | matriz período × natureza com drill-down; as previsões da abertura entram no caixa | 36 |

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
| `/financeiro/abertura-de-job` | fila dos jobs aguardando abertura, com busca e resumo. ⚠️ **27/08/2026 (decisão 030):** a fila passou a ter **duas coortes** — a faixa **Erratas**, com jobs JÁ ABERTOS que uma errata devolveu para reconferência (botão "Revisar abertura", que abre o resumo da errata), e a faixa **Aberturas novas**, a de sempre. As faixas só aparecem quando as duas existem. |
| — resumo da errata | ⚠️ **Novo em 27/08/2026.** Descrição escrita pelo GP, faturamento e valor do job antes/depois, contagem de linhas afetadas, e "Prosseguir para abertura". |
| — modal de conferência | dados vindos da produção, resumo real da planilha, observações, atalho para a Planilha Interna |
| `/financeiro/abertura-de-job/[jobId]` | formulário de registro financeiro, com rodapé fixo que bloqueia até estar completo. ⚠️ **27/08/2026 (decisão 030):** **salvar aqui É o que encerra a revisão de uma errata** — limpa `jobs.abertura_em_revisao` e libera o envio para faturamento. Não há botão separado de "confirmar revisão". |

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

> ⚠️ **17/08/2026 — resolvido. Esta seção descreve um estado que não existe
> mais.** A migration `20260817000006_vw_fluxo_caixa_previsoes.sql` colocou o
> resíduo da curva na `vw_fluxo_caixa`, exatamente como a decisão 004 manda, e
> fez o mesmo do lado da entrada — que na época desta seção nem tinha regra
> escrita. Ver **seção 36** e `docs/decisions/018`.

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

## 34. Contas a Pagar: a aba "Títulos a Pagar" (2026-08-17)

Protótipo `Contas a Pagar - Titulos a Pagar.dc.html` (25 estados,
interativo). Regras novas em
`docs/decisions/016-titulos-a-pagar-e-baixa-por-parcela.md`.

> ⚠️ **Isto refaz a máquina de pagamento descrita antes deste
> documento.** Até aqui o financeiro aprovava a PP, salvava um "prazo
> financeiro" à parte e baixava a **PP inteira** num lançamento só. Agora
> a aprovação define a **data de pagamento** no mesmo ato, e quem se
> baixa é a **parcela**. Também fecha o adiamento explícito da decisão
> 014 §7.

### As três abas

`Pedidos de Produção (PPs)` · `Títulos a Pagar` · `Recorrências`. A aba
**"Lançamentos Avulsos" foi absorvida**: a avulsa virou um título de
origem `AVULSO` na lista unificada, e a criação passou a ser o botão
"+ Lançamento Avulso" de lá. As rotas de detalhe da avulsa continuam
funcionando. A tela abre em Títulos a Pagar — é o que o financeiro faz
todo dia.

### A lista unificada não tem tabela

Nasce de consulta sobre o que já existe, sem tabela-espelho:

| Chip de origem | Fonte |
|---|---|
| `PP-NNNNN` | `pedidos_compra_parcelas` de PP `aprovada` ou `pago` |
| `AVULSO` | `contas_avulsas` com `recorrente_id` nulo |
| `RECORRÊNCIA` | `contas_avulsas` com `recorrente_id` preenchido |

A recorrência não exigiu nada novo: `gerar_ocorrencias_recorrentes` já
materializava cada ocorrência como uma `contas_avulsas`.

Colunas: Data de pagamento (editável, **vermelha quando difere do
vencimento original**) · Venc. original · Título · Fornecedor · Job ·
Origem · Valor · Parcela `N/T` · Status · Dar baixa. Chips A pagar /
Pagos / Todas, segunda linha de ORIGEM, e faixa de resumo com Em aberto ·
Vencendo em 7 dias · Pagos hoje. Em "Todas", o que ainda precisa sair vem
antes do que já foi pago.

### Duas datas onde havia uma

- **Vencimento original** — o prazo negociado pela produção, impresso no
  PDF. Congelado na emissão.
- **Data de pagamento** — quando o financeiro paga. Nasce na aprovação e
  é repactuável pelo lápis.

O pop-up do lápis exibe **sempre** as duas, mais a **1ª data de
pagamento** já definida — que um trigger no banco congela, para a
promessa não depender da tela.

### PP parcelada: a data desloca todas pelo mesmo delta

Decisão do Tiago. Aprovar em 08/09 uma PP que vencia 01/09 · 01/10 ·
01/11 gera pagamentos em 08/09 · 08/10 · 08/11. Exercitado no banco antes
de liberar, com rollback.

### O formulário de aprovação da PP

| Antes | Agora |
|---|---|
| Bloco "Ações do financeiro" com "Prazo pagamento financeiro" + botão "Salvar prazo" | Campo único **"Data de pagamento" \*** — obrigatório, escolhido antes de aprovar |
| Prazo original numa linha da grade de dados | **Vencimento original em card âmbar destacado**, com o texto "Prazo negociado pela produção com o fornecedor" |
| Botão "Ver PDF" (ícone de olho, abre aba nova) | **"Visualizar documentos"** — PP e anexo(s) lado a lado, em overlay, com as ações de aprovar/rejeitar no rodapé |
| "Dar baixa" e "Cancelar baixa" no rodapé | Saíram. A baixa é da parcela e mora na aba Títulos |

PP fora da avaliação exibe o aviso "Esta PP já saiu da avaliação".
Na lista da aba, a coluna "Prazo Financeiro" virou **"Parcela"** (`1/3`).

### O modal de baixa

Um só, para as três origens. Data do pagamento · Conta que realizará o
pagamento (**sem conta padrão** — escolhida na mão toda vez) · **Centro
de custo do pagamento**, obrigatório.

**"Centro de custo" é o plano de contas (Tipo + Subtipo)** — decisão do
Tiago. Não existe centro de custo no banco, e a legenda do próprio
protótipo ("define onde o custo entra no DRE") descreve o que o plano de
contas já fazia. Vem sugerido pela origem quando ela tem plano, e a
escolha vai para o lançamento sem reescrever a classificação da avulsa.

### Lançamento avulso com dois botões

**Criar** lança a previsão em Títulos a Pagar. **Criar e dar baixa** cria
e abre o modal de baixa em seguida — o pagamento já aconteceu e vai
direto para a conciliação.

### O estorno saiu da UI

Decisão do Tiago: seguir o protótipo, que não tem estorno em lugar
nenhum. `estornarBaixaPP` e `cancelar-baixa-modal.tsx` continuam no
repositório, sem porta na tela — e o arquivo carrega a nota dizendo isso.
**Consequência assumida:** reverter baixa errada hoje exige intervenção
fora da tela.

### Migration

`20260817000004_titulos_a_pagar.sql` — aditiva: 5 colunas
(`data_pagamento` e `data_pagamento_primeira` em
`pedidos_compra_parcelas` e `contas_avulsas`, `pedido_compra_parcela_id`
em `lancamentos_financeiros`), 1 FK, 3 índices, 1 trigger, 3 funções
novas (`aprovar_pp_com_data`, `dar_baixa_pp_parcela`,
`dar_baixa_avulsa_com_plano`, todas `security definer` com `search_path`
fixo e **sem `EXECUTE` para `PUBLIC`**), `gerar_ocorrencias_recorrentes`
redefinida, e as views `vw_a_pagar` / `vw_fluxo_caixa` passando a
listar **uma linha por parcela em aberto** — sem isso o Fluxo de Caixa
nasceria concentrando num dia o que sai em três.

Nada removido: `prazo_pagamento_financeiro` virou espelho da 1ª parcela
(com comentário no banco), e `dar_baixa_pp` / `estornar_baixa_pp`
continuam existindo.

### Fora do escopo, de propósito

- **Contas a Receber e Fluxo de Caixa** não foram tocados (Telas 3.3 e
  3.4).
- **Contato de cobrança** (`jobs_contatos`) segue invisível para o
  financeiro — a lacuna da decisão 012 continua aberta.

---

## 35. Contas a Receber: faturamento agrupado, parcial e avulso (2026-08-17)

Protótipo `Contas a Receber - Faturamento Agrupado.dc.html`, mais o
arquivo `Contas a Receber - Faturamento - notas de implementacao.md` do
mesmo projeto. Regras novas em
`docs/decisions/017-faturamento-agrupado-parcial-e-avulso.md`.

> ⚠️ **Isto muda o formulário de emissão descrito antes deste
> documento.** Uma NF deixa de ser "uma nota, um job": passa a cobrir
> vários jobs do mesmo cliente, e pode cobrir só parte do saldo de cada
> um. **Tipo e Subtipo saíram do formulário de emissão** e passaram a ser
> pedidos na baixa do título. **Série saiu das telas** (continua no banco,
> com default `1`). E o título a receber ganhou uma **previsão de
> recebimento** editável, ao lado do vencimento.

### A nota virou cabeçalho + linhas

| Camada | Tabela | Responde |
|---|---|---|
| Cabeçalho | `faturamentos` | o que é esta nota |
| **Linhas** | **`faturamento_itens`** (nova) | **o que ela cobre, e por quanto de cada** |
| Recebimento | `titulos_receber` | como o dinheiro entra |

`faturamentos.origem_id` fica **vazio na nota agrupada** — quem quiser
saber o que a nota cobre lê `faturamento_itens`. Gravar "o primeiro job"
faria qualquer leitura futura atribuir a nota inteira a ele.

### A aba Faturamento agora tem uma linha por PARCELA

Tabela nova `jobs_envio_faturamento_parcelas`: ao enviar o job para
faturamento, **a produção informa em quantas notas ele será faturado**,
com valor e vencimento de cada parcela. Cada parcela é uma linha da aba,
faturada por sua própria NF.

Não confundir com `jobs_previsao_recebimento` (seção 33): aquela diz
*quando o dinheiro entra*, esta diz *em quantas notas o job sai*.

Colunas: Origem · Job/descrição · Cliente · Valor (da parcela) · Já
faturado · Saldo a faturar (com "total do job") · Parcela `N/T` ·
Vencimento · Ação. Chips de filtro **por cliente com contagem**, busca, e
faixa "A faturar".

**Notas já emitidas permanecem na aba**, em verde, com chip `FATURADO` e
botão `NF <número>` que reabre o mesmo formulário em **somente leitura**
(campos bloqueados, sem seletor total/parcial, sem lixeiras nem atalhos,
rodapé "Fechar", e **Visualizar NF** abrindo o PDF no próprio painel).

### Agrupado, parcial e avulso

- **Agrupado:** botão "Faturamento Agrupado" liga o modo de seleção
  (checkbox por linha + selecionar todos). Com mais de um cliente na
  seleção **o formulário não abre** — o erro sai na própria barra,
  nomeando os clientes. **BV nunca entra**: a contraparte dele é o
  fornecedor, e o checkbox fica desabilitado.
- **Parcial:** seletor `Valor integral` × `Faturamento parcial` no topo
  de "Jobs nesta NF". No parcial cada job ganha campo editável, botão
  `50% do valor`, selo "Parcial" e a linha "R$ X volta para a aba
  Faturamento", com resumo azul do que retorna. Valor acima do saldo
  bloqueia no cliente, na action **e** na RPC.
- **Avulso:** mesmo drawer, com cliente, valor total, job de referência
  (só rastreio — não consome saldo) e centro de custo obrigatório. Não
  altera saldo de nenhum job.

**Não existe NF programada.** O modelo "1 NF por parcela" foi avaliado no
protótipo e descartado; quem não quer faturar tudo agora usa o parcial.

### Aba Títulos a Receber

Colunas: ✎ Vencimento · Previsão de recebimento · Nota fiscal · Cliente ·
Jobs cobertos · Data de recebimento · Valor · Parcela · Status · Ação.
NF de vários jobs exibe o selo **"Agrupada · N jobs"** e a lista.

Três datas, e **duas são imutáveis**: o vencimento da NF e a 1ª previsão
registrada, as duas congeladas por trigger. O lápis muda só a previsão,
que aparece em **âmbar** quando difere do vencimento — e é ela que
`vw_fluxo_caixa` passou a ler.

A baixa pede **data do recebimento**, **conta bancária que recebeu** e
**centro de custo do recebimento** (o par Tipo + Subtipo). Título
recebido sempre tem data — invariante garantida no diálogo, no schema e
dentro da RPC.

**Estorno e cancelamento de NF não têm porta nesta tela**, seguindo o
protótipo e a mesma decisão da 016 §9. As actions continuam no
repositório.

### Migration `20260817000005_contas_a_receber_agrupado.sql`

Aplicada e conferida pelo MCP. Duas tabelas novas
(`jobs_envio_faturamento_parcelas` e `faturamento_itens`, ambas com RLS,
policies só para `authenticated` via `is_tenant_member`, índices e ACL
sem `anon`), 2 colunas em `titulos_receber`, 1 trigger,
`dar_baixa_titulo_com_plano` nova (`security definer`, `search_path`
fixo, **sem `EXECUTE` para `PUBLIC`**), `emitir_faturamento` e
`cancelar_faturamento` redefinidas, e as views `vw_faturamento_pendente`
(uma linha por parcela) e `vw_fluxo_caixa` (título pela previsão).

Backfill aditivo: os 3 envios existentes ganharam 1 parcela `1/1` com o
valor e a data que já tinham.

**Único item do lado destrutivo, autorizado pelo Tiago:** o CHECK
`chk_faturamento_origem` foi substituído por uma versão que aceita
`origem_id` nulo em job/BV. `faturamentos` tinha 0 linhas.

Lógica exercitada no banco com rollback: NF parcial de R$ 4.000 sobre uma
parcela de R$ 7.025,60 deixou saldo de R$ 3.025,60; cancelar a NF
devolveu os R$ 7.025,60; e um `update` forçando vencimento e 1ª previsão
para 1999 manteve as duas intactas.

### Fora do escopo, de propósito

- **Fluxo de Caixa** (Tela 3.4) não foi tocado.
- **Contato de cobrança** (`jobs_contatos`) segue invisível para o
  financeiro, por decisão do Tiago nesta sessão — a lacuna da decisão 012
  continua aberta.
- **O abatimento da previsão de recebimento da abertura** pelo título
  emitido continua sem regra escrita (pendência da seção 33 / decisão
  015). É a Tela 3.4 que vai precisar dela.

---

# Parte VIII — Fluxo de Caixa

**Data:** 2026-08-17
**Origem do design:** `Fluxo de Caixa.dc.html`, projeto Claude Design
`69342d83`. (O arquivo `Fluxo de Caixa - Tela Atual.dc.html`, no mesmo
projeto, é só o "antes".)

---

## 36. A tela virou matriz, e as previsões entraram no caixa

A tela anterior era uma lista de períodos com três colunas — previsto,
realizado, saldo acumulado. Ela respondia "quanto entra e quanto sai", mas
não respondia as duas perguntas que o financeiro faz de verdade: **de onde
vem esse previsto** e **quando o caixa aperta**.

A tela nova é uma **matriz período × natureza**: 3 colunas de passado mais
o horizonte, cada uma rotulada `REALIZADO`, `EM CURSO` (a fronteira do
hoje, destacada) ou `PREVISTO`. As linhas-mestre são Entradas, Saídas,
Líquido do período e Saldo projetado.

### As três camadas, que são o ponto da tela

Cada natureza se abre em três componentes, iguais em todas as colunas:

| Componente | O que é | De onde vem |
|---|---|---|
| Já movimentado nas contas | caixa efetivo, já baixado | `lancamentos_financeiros` |
| Títulos em aberto | documento emitido, ainda não pago | parcela de PP, conta avulsa aprovada, título a receber |
| Só previsão (abertura do job) | curva do job, ainda sem documento | `jobs_previsao_custo`, `jobs_previsao_recebimento`, parcelas do envio |

**Essa separação é a entrega.** Antes, "previsto" misturava título e
previsão — e previsão da abertura nem chegava à tela. Agora dá para ver
que R$ 300 mil de saída em outubro são R$ 100 mil de PP já emitida e
R$ 200 mil de curva que ainda pode mudar. São dois graus de certeza
diferentes, e decidir pagamento com eles somados é decidir no escuro.

Cada componente expande até o item, com descrição, data, regional e conta
bancária (ou "sem conta alocada").

### A regra mora no banco

A `vw_fluxo_caixa` ganhou a coluna `classe` (`movimento` / `titulo` /
`previsao`) e as linhas de previsão. **A tela não recalcula nada** — só
agrupa e soma. Consequência: o DRE e qualquer leitor futuro da view
recebem o abatimento e as rolagens prontos.

O que a view passou a fazer, e que ninguém fazia antes:

- **Saída:** resíduo da curva = curva da abertura − planejado dos itens que
  já têm PP, consumido da data mais próxima para a mais distante com piso
  em zero, e o que venceu sem virar PP rola para a próxima janela de
  pagamento. É a decisão 004, enfim implementada.
- **Entrada:** job **sem** envio para faturamento projeta pela previsão da
  abertura; job **com** envio projeta pelas parcelas do envio, menos o que
  já virou título. Previsão vencida sem NF é lida em hoje + 1. Era a
  lacuna que as decisões 015 e 017 registraram — agora é a **decisão 018**.
- **Regional:** rateio entra proporcional, o que fez a view emitir uma
  linha por regional nas origens rateadas.

### Conferência no banco (17/08/2026)

Resíduo da curva, batido job a job contra `curva − planejado dos itens com
PP`: JOB-0001 2.500 − 1.000 = **1.500**; JOB-0004 250.900 − 4.500 =
**246.400**; JOB-0010 11.760 − 0 = **11.760**; JOB-0013 65.000 − 40.000 =
**25.000** (a 1ª das 2 parcelas da curva zerou inteira, e só a 2ª aparece).

Rolagem: as previsões vencidas caíram todas em **20/08** (a próxima janela
de pagamento a partir de 17/08); a parcela de envio vencida do JOB-0001
caiu em **18/08** (hoje + 1); a do JOB-0010, com vencimento futuro em
25/08, ficou onde estava.

As **duas cópias da regra de janela** — `curva.ts` no TypeScript e
`fc_proxima_janela_pagamento` no SQL — foram comparadas em 6 datas,
incluindo os casos de fim de semana (08/11/2026 é domingo → 09/11;
20/12/2026 é domingo → 21/12). Concordam em todas.

### Saldo bancário: lido, não reconstruído

O protótipo reconstrói o saldo de abertura da janela a partir do saldo de
hoje. Aqui ele vem do razão, pela função nova `fc_saldos_por_conta(date)`:
saldo inicial cadastrado da conta + lançamentos até a data. O servidor
pede o saldo na véspera da âncora (4 meses atrás) e o cliente caminha daí
para frente — um número exato, e uma consulta só.

### Migrations

`20260817000006_vw_fluxo_caixa_previsoes.sql` — a `vw_fluxo_caixa`
redefinida com `create or replace` (as 13 colunas antigas no mesmo nome,
tipo e posição; `classe` e `regional_id` no fim), mais
`fc_ajusta_dia_util`, `fc_proxima_janela_pagamento` e
`fc_saldos_por_conta`. **Nenhuma linha de dado tocada.**

`20260817000007_fc_janelas_grant_public.sql` — correção. A 000006 revogou
`execute` de `public` nas três funções seguindo o padrão das RPCs do
projeto, e isso quebrou a leitura da view: o teste de `execute` é feito
contra quem consulta, não contra o dono da view, então qualquer papel que
leia `vw_fluxo_caixa` precisa executar a função de janela. As duas funções
de data voltaram ao `public` — são aritmética pura, sem acesso a tabela.
`fc_saldos_por_conta`, que lê dado, continua restrita a `authenticated`.

### Fora do escopo, de propósito

- **Filtro "Divisão" do protótipo removido** — o conceito não existe no
  banco. Decisão do Tiago (decisão 018 §5).
- **`security_invoker` nas views** — as três views do schema ignoram a RLS
  das tabelas de baixo. Ligar fecha numa linha e foi conferido que não
  quebraria nada; o Tiago colocou acessos na fase de cadastro de usuários,
  depois de todas as telas definidas.
- **Verificação no navegador** — não feita nesta sessão, por combinação:
  segue consolidada na etapa final de testes.
- **Contato de cobrança** (`jobs_contatos`) segue invisível para o
  financeiro; a lacuna da decisão 012 continua aberta.

---

## 37. O contato de cobrança ficou visível para o financeiro (P1)

**Data:** 2026-08-17

A Tela 1.6 criou `jobs_contatos` e passou a **exigir** ao menos um
contato de cobrança para enviar o job para abertura. Mas a leitura só
existia num lugar: o modal "Ver dados do job", na tela da versão — lado
do **orçamento**. Nenhuma tela do financeiro exibia o dado.

Ou seja: o campo era obrigatório, estava gravado e íntegro, e **quem
precisava cobrar não conseguia ver a quem cobrar**. A justificativa da
decisão 012 não se cumpria.

### Onde entrou

| Tela | Forma | Por quê ali |
|---|---|---|
| `abertura-de-job/conferencia-dialog.tsx` | caixa, no padrão do Descritivo | é o único momento de devolver o job por contato faltando ou e-mail torto, **antes** de assumi-lo |
| `financeiro/jobs/[jobId]` | seção própria | a referência do dia a dia, com o job já aberto |
| Contas a Receber · aba **Faturamento** | linha compacta sob a contraparte | quem cobrar ao lado de quem é cobrado, no momento em que a nota nasce |
| Contas a Receber · aba **Títulos a Receber** | linha compacta sob os jobs cobertos | é onde a cobrança de fato acontece |

As duas últimas **revertem** a decisão que o Tiago tinha tomado horas
antes, na sessão da Tela 3.3 (decisão 017: "contato de cobrança não entra
nesta tela"). Nota ⚠️ datada nas duas decisões, 012 e 017.

### Dois arquivos novos, e o motivo de existirem

`lib/data/contatos-cobranca.ts` e
`components/financeiro/contatos-cobranca.tsx`. São quatro telas lendo o
mesmo dado e desenhando o mesmo bloco — a alternativa era o mesmo
`select` e o mesmo JSX copiados quatro vezes, que é **exatamente** como as
cores das planilhas divergiram entre si
(`docs/09-identidade-visual-ui.md`). O componente tem duas
apresentações, `Caixa` e `Inline`, porque são dois contextos: diálogo e
tabela densa.

A query é uma só por tela, por lote de job ids, coberta pelo índice
`idx_jobs_contatos_job` — nada de N+1 por linha de tabela.

### Detalhes que valem registro

- **NF agrupada junta os contatos dos vários jobs**, deduplicados por
  e-mail (nome como reserva, quando não há e-mail). O mesmo contato
  respondendo por três jobs aparece uma vez.
- **BV não tem contato**, porque não tem job — a contraparte é o
  fornecedor.
- **Job anterior a 17/08/2026 não tem contato** e nunca terá: a exigência
  nasceu com a Tela 1.6 e não houve backfill. A tela diz "sem contato de
  cobrança" em vez de esconder a seção — ausência é informação.

### Sem migration

Nada mudou no banco. `jobs_contatos` já existia com RLS, policies e
índice; esta entrega é só leitura.

## 38. Verificação no navegador: três correções no financeiro (2026-08-18)

A etapa final de verificação do plano de telas percorreu a esteira
inteira com dado real — JOB-0015 aberto, PP-00009 de R$ 12.000,00 em 3
parcelas, NF 900123 agrupando duas parcelas com faturamento parcial. Ela
achou três coisas que as entregas 34 e 35 deixaram passar, e que este
item corrige. Migration
`20260818000001_baixa_por_parcela_e_data_aprovacao.sql`.

### ⚠️ A baixa por parcela estava bloqueada da SEGUNDA em diante

**Corrige a entrega 34.** A `20260805000003_lancamentos_financeiros.sql`
criou `uniq_baixa_ativa_por_pp`, único em
`lancamentos_financeiros(pedido_compra_id) where origem = 'pp_baixa'`,
numa época em que uma PP tinha uma baixa. A entrega 34 passou a inserir
**um lançamento por parcela** e não substituiu o índice: a 1ª parcela
baixava, e da 2ª em diante o Postgres recusava — com a mensagem crua
`duplicate key value violates unique constraint` chegando à tela. Na
prática, **PP parcelada nunca chegava a `pago`**.

O índice virou `uniq_baixa_ativa_por_parcela`, em
`(pedido_compra_parcela_id)`. A unicidade continua existindo, só que na
granularidade certa; o estorno segue funcionando porque troca a origem
para `pp_baixa_estornada` e sai do índice parcial. O índice antigo foi
recriado como caso de borda (`uniq_baixa_ativa_por_pp_sem_parcela`), para
lançamento de baixa sem parcela vinculada — que o fluxo atual não produz.

Conferido depois da correção: as parcelas 2/3 e 3/3 da PP-00009 baixaram
pela tela, a PP passou a `pago` na última, e ficaram 3 linhas em
`lancamentos_financeiros`.

⚠️ **Fora do escopo, e conhecido:** `estornar_baixa_pp` (estorno da PP
inteira) ainda pega `limit 1` dos lançamentos e devolve a PP a
`aprovada` sem limpar `pago_em` das parcelas. Desde a decisão 016 ela não
tem porta na interface; consertá-la exige decidir a semântica do estorno
com parcelas.

### ⚠️ Aprovar PP sem data de pagamento passava no servidor

**Corrige a entrega 34.** A decisão 016 fez da "Data de pagamento" o que
a aprovação decide. O caminho da tela sempre esteve certo
(`aprovarPPComData` → `aprovar_pp_com_data`, que exige a data e desloca
as parcelas). O furo era a action **legada** `aprovarPP`, que ficou sem
chamador na UI mas continua exposta pela rede: chamada direta, aprovava
com `prazo_pagamento_financeiro` nulo, e os títulos nasciam com data de
pagamento vazia e sem 1ª data registrada — quebrando a repactuação.

A trava entrou nos dois lugares: na RPC `aprovar_pp` (último portão) e na
action, para a mensagem chegar em português.

### A NF reaberta mostrava uma parcela em vez das que existem

**Corrige a entrega 35.** Em `faturar-drawer.tsx`, o modo leitura montava
**uma parcela sintética** com o total da nota. Uma NF emitida em 2×
reabria dizendo 1×, com o valor cheio — os títulos no banco estavam
certos, e a própria lista marcava a linha como `2x`, mas o formulário de
conferência contava outra história.

O `page.tsx` já carregava os títulos para contar as parcelas; agora leva
junto valor e vencimento de cada uma, em `FaturadoRow.parcelas`, e o
drawer usa essas. O fallback sintético sobrou só para nota antiga sem
título vinculado.

### Mensagem de erro da baixa

Violação de constraint deixou de vazar para o usuário: `mensagemDeBaixa`
em `actions-titulos.ts` traduz as que conhecemos, deixa passar o texto
das RPCs (que já é português) e cai numa frase genérica no resto,
mandando o original para o log do servidor.

### Cadastro: subtipos provisórios do plano de contas

A verificação esbarrou num impedimento que **não é de código**: a baixa
exige centro de custo com Tipo **e** Subtipo, e só 2 dos 15 tipos tinham
subtipo cadastrado. Na prática, toda baixa era obrigada a sair como
"05 · Despesa com Pessoal / Salário", inclusive a de um pedido de
produção.

Por decisão do Tiago (18/08/2026), os 13 tipos restantes ganharam **um
subtipo provisório `999 · Geral (provisório)`**, criado pela action
`criarSubtipo` — com validação e auditoria, não por SQL direto. O código
999 é proposital: deixa a faixa 001–099 livre para o plano de contas real
e marca na tela o que ainda é provisório. **Trocar por subtipos de
verdade é trabalho pendente do cadastro.**

## 39. As duas decisões do dia: estorno por parcela e saldo sem regional (2026-08-18)

Fecham as duas perguntas que a verificação deixou em aberto. Migration
`20260818000002_estorno_por_parcela.sql`.

### Estorno virou por parcela — e a versão antiga foi desarmada

A decisão 016 mudou a baixa para a parcela e **deixou o estorno para
trás**. O Tiago fechou a simetria: aprovar é por PP (e gera um título por
parcela), dar baixa e estornar são por parcela.

`estornar_baixa_pp_parcela` gera o lançamento reverso, devolve a parcela
para em aberto e traz a PP de `pago` de volta a `aprovada` — espelho
exato da baixa, que só promove a `pago` quando a última parcela cai. A
action é `estornarBaixaParcela`, em `actions-titulos.ts`, ao lado da
baixa que ela reverte; a antiga `estornarBaixaPP` **saiu** de
`actions.ts`.

A RPC velha `estornar_baixa_pp` não foi derrubada: ela agora levanta
exceção apontando para a substituta. Derrubar calaria um chamador; assim
ele é avisado. Também perdeu o `execute` para `public`, que arrastava
desde as 13 funções antigas.

**Por que ela era um perigo:** pegava `limit 1` dos lançamentos da PP,
criava um reverso e devolvia a PP a `aprovada` **sem limpar `pago_em` das
parcelas**. Numa PP de 3 parcelas pagas, o resultado seria uma PP
"aprovada" com as 3 parcelas ainda marcadas como pagas e um só lançamento
revertido.

**O estorno continua sem porta na UI**, como a decisão 016 mandou — o
protótipo não tem estorno em lugar nenhum. `cancelar-baixa-modal.tsx`
segue parado, mas agora aponta para a action certa e recebe uma
**parcela** em vez de uma PP: religá-lo é montá-lo em algum lugar.

**Ciclo exercitado ao vivo:** PP-00009 com as 3 parcelas pagas → estorno
da 3/3 (parcela em aberto, PP de volta a `aprovada`, original virou
`pp_baixa_estornada`, nasceu um `pp_estorno` de entrada) → nova baixa da
3/3 (PP de volta a `pago`). Parcelas 1 e 2 intactas o tempo todo.

### Fluxo de caixa: o saldo é da conta, nunca da regional

A verificação mostrou que, com filtro de regional, os indicadores partem
do saldo bancário inteiro. **Decisão do Tiago: está certo assim** — conta
bancária não tem regional, então o ponto de partida é escolhido pelo
filtro de CONTA ("Todas agregadas" ou uma conta específica), e o filtro
de regional recorta só os **fluxos**.

Nada mudou no código; ficou registrado em `docs/decisions/018` para não
ser "consertado" por engano depois.

## 40. O estorno voltou para a tela, no título já pago (2026-08-18)

Fecha o que a entrega 39 deixou pela metade: a semântica do estorno já
estava certa (por parcela), mas ele continuava sem porta na interface. O
Tiago pediu a porta de volta — "adicione a opção de fazer um estorno ao
clicar em um título sobre o qual já foi dado baixa, com um botão no
formulário aberto com o clique". **Revoga a parte da decisão 016 que
tirava o estorno da UI**; ver a segunda nota de 18/08 lá.

### O que abre no clique

`components/financeiro/baixa-registrada-dialog.tsx` — espelho em leitura
do `BaixaTituloDialog`. Em cima, os dados do título (origem, parcela,
venc. original, data de pagamento, valor). Embaixo, um bloco verde
**"Enviado para a conciliação"** com o que a baixa gravou: **pago em ·
conta · centro de custo**. É a conferência que antes só existia como
texto miúdo embaixo da descrição na tabela.

Abrem o diálogo: a **linha inteira** do título pago e o chip
**"Conciliação"**, que virou botão. Título em aberto **não** é clicável
na linha — as ações dele são o lápis da data e o "Dar baixa", e um
clique solto não pode disparar pagamento.

### O estorno em dois tempos

Dentro do formulário, primeiro aparece só o botão **"Estornar baixa"**.
Clicando nele é que surgem o campo de motivo (mínimo 10 caracteres) e o
**"Confirmar estorno"**, com um "Voltar" para desistir. É a ação mais
destrutiva da aba — desfaz dinheiro que já foi para a conciliação —,
então não fica a um clique de quem só queria conferir a baixa.

### A action

`estornarBaixaTitulo({origem, id, motivo})`, irmã de `darBaixaTitulo` e
com a mesma assinatura: origem `pp` cai em `estornarBaixaParcela`,
`avulso` e `recorrencia` em `estornarBaixaAvulsa`. A aba unificada não
precisa saber que por baixo existem duas tabelas — é a mesma escolha que
a baixa já fazia.

Sem migration: as duas RPCs já existiam (a de parcela nasceu na entrega
39). `cancelar-baixa-modal.tsx`, que estava parado esperando exatamente
isto, foi **removido** — o diálogo novo faz o que ele fazia e mais.

**Exercitado pela tela:** parcela 3/3 da PP-00009 → clique → "Estornar
baixa" → motivo curto manteve o confirmar desabilitado → motivo completo
liberou → estornada. Contadores acompanharam (Pagos 3→2, A pagar 1→2, Em
aberto R$ 6.000,00), a PP voltou a `aprovada` e o extrato ganhou o par
`pp_baixa_estornada` + `pp_estorno`.

---

## 41. A categoria do job passou a vir do orçamento (2026-08-19)

**Origem:** pedido do Tiago de 19/08 — *"O campo atual não existe e não
faz sentido."* Regra na
[decisão 019](docs/decisions/019-categoria-do-job.md).

O select **"Categoria do job"** da abertura oferecia um vocabulário
próprio do financeiro (`categorias_dominio`, escopo `job`: Ativação de
marca, Conteúdo · Digital, Evento, Fee mensal, Trade · PDV) que não
existia em nenhuma outra tela e que quem abria o job preenchia do zero.
Agora ele mostra **a categoria que a produção deu ao job no orçamento** —
escopo `orcamento`: Ativação, Conteúdo, Extra, Influencer.

### O que mudou nas telas da abertura

1. **Formulário de abertura** — o campo chega **pré-selecionado** com a
   categoria do orçamento e lista o mesmo vocabulário. Abaixo dele, a
   legenda "Vem do orçamento `NOV-0002/26-02`. Pode ser trocada aqui sem
   alterar o orçamento" — mesmo espírito da legenda do "Nome do job".
   Continua obrigatório para abrir.
2. **Pop-up "Conferir o job antes de abrir"** — linha **Categoria** entre
   "Produto" e "Cidade · Regional", com o mesmo valor.
3. **Painel "Dados da produção"** (coluna direita do formulário) — mesma
   linha, mesma posição, mas com o valor **do orçamento**, fixo. Ele não
   acompanha o select: se o financeiro trocar a categoria, o painel segue
   mostrando a que a produção mandou e o **"Resumo do registro"**, no pé
   da página, mostra a escolhida. É a mesma divisão que o nome do job já
   fazia entre as duas caixas.
4. **Botão do pop-up de conferência** — "Aprovar e preencher abertura"
   virou **"Preencher Abertura"**. Ele nunca aprovou nada: só navega para
   o formulário, e a aprovação é o "Abrir job no financeiro" lá no fim.

### Trocar aqui não mexe no orçamento

A troca grava em `jobs.categoria_id` e para por aí — mesmo padrão do
`nome_financeiro`. A Server Action passou a exigir escopo `orcamento`
(era `job`), além de tenant e `ativo`, que já conferia.

**Categoria inativada** entre o envio e a abertura deixa o campo vazio em
vez de pré-selecionar um id que o servidor recusaria: o rodapé volta a
pedir "Selecione a categoria do job", e o botão fica travado.

### A troca de vocabulário em si não pediu migration

`jobs.categoria_id` é FK solta para `categorias_dominio`, sem CHECK de
escopo — quem valida é a action. O que exigiu migration foi o passo
seguinte, na nota abaixo.

**Leitura sem custo novo:** `categoria_id` e o nome entram no embed de
`orcamento` que `SELECT_JOB_FILA` já fazia para pegar o código — nenhuma
query a mais na fila nem na tela de abertura.

**Verificação:** `tsc --noEmit` e `next lint` limpos. Exercitado no
navegador com o JOB-0014 (orçamento NOV-0002/26-02, categoria
**Ativação**): a conferência mostrou "Categoria · Ativação" e o botão
"Preencher Abertura"; o formulário abriu com "Ativação" selecionada e o
dropdown listando exatamente Ativação, Conteúdo, Extra e Influencer.
Nada gravado — o job segue em `aguardando_abertura`.

---

⚠️ **O escopo `job` foi apagado, no mesmo dia (2026-08-19).** O parágrafo
acima dizia que as 5 categorias ficariam no banco e que o destino delas
era assunto aberto — não é mais. O Tiago decidiu apagar, e a migration
`20260819000001_encerra_escopo_job_das_categorias.sql` fez em três passos:

1. **Os 12 jobs saíram de lá primeiro** — a FK é `ON DELETE RESTRICT`, o
   DELETE não passaria com eles apontando. Cada um herdou a categoria do
   orçamento dele: JOB-0005 a 0010, 0013 e 0015 (8) viraram **Ativação**;
   JOB-0001 a 0004 (4) ficaram **sem categoria**, porque ORC-0001/0002/0003
   e PEVETE-0002/26-01 são anteriores à obrigatoriedade de 17/08 e nunca
   tiveram uma. Nulo é estado legítimo aqui — perda aceita pelo Tiago, em
   vez de inventar valor.
2. **Uma trava** aborta a migration se sobrar algum job preso, com a
   contagem no erro, em vez de estourar FK no meio do DELETE.
3. **As 5 linhas foram apagadas.**

No código, `'job'` saiu do tipo `CategoriaDominioEscopo`, do Zod
(`lib/validations/categorias-dominio.ts`), do seletor do drawer e do
filtro da lista. **Cadastros › Categorias virou "(Projeto/Orçamento)"**, e
a descrição da tela agora diz que o job herda a categoria do orçamento.

**Conferido pelo MCP depois de aplicar:** `categorias_dominio` só tem
`projeto` (4) e `orcamento` (4); os 8 jobs migrados aparecem com
**Ativação · escopo orcamento** e os 4 antigos sem categoria.

---

## 42. Abertura de Job: projeto do financeiro, contas do job e as cinco abas (2026-08-20)

Design: `Abertura de Job - Financeiro.dc.html`.
Regra completa em [`docs/decisions/021`](../decisions/021-projeto-do-financeiro-e-edicao-da-abertura.md).
Migration: `20260820000011_projetos_financeiro_e_contas_do_job.sql`.

Duas telas mudaram: o **formulário de abertura** e o que abre ao **clicar
num job** na aba de jobs abertos.

### O que entrou no formulário de abertura

| Campo | O que é |
|---|---|
| **Projeto** * | Editável, com "+" para criar projeto ali mesmo. Arrumação do financeiro, invisível para a produção |
| **Recebimento em** | Conta bancária de entrada do job, com saldo de hoje na opção |
| **Pagamento em** | Conta bancária de saída do job |

Mais o badge **Em conferência** no cabeçalho, a linha **Projeto** no
Resumo do registro e no modal de confirmação, e o subtítulo citando
projeto.

### ⚠️ A aba "Jobs abertos" virou "Visualizar Jobs"

E passou a **agrupar pelo projeto do financeiro**, não pelo da produção.
A coluna Projeto da linha acompanha (com fallback no da produção, para
job aberto antes da migration).

**A "Visão agregada" da faixa some** quando o grupo do financeiro junta
jobs de projetos de produção diferentes — aquela tela é da produção
(`/jobs/projeto/[id]`) e não existe um projeto único para onde apontar.

### ⚠️ A tela do job aberto virou casca de cinco abas

`/financeiro/jobs/[jobId]` deixou de ser resumo em cards:

**Abertura do Job · Informações do Job · Planilha Interna · Fluxo de
Caixa do Job · Comunicação.**

Três dessas abas são os **mesmos componentes** de `/jobs/[jobId]`. Para
isso o carregamento daquela página saiu dela e virou
`app/(app)/jobs/[jobId]/carregar-detalhe.ts`, chamado pelas duas telas. A
Planilha Interna entra sempre em leitura no financeiro (`editable=false`,
`podeAcoes=false`).

**A aba Abertura do Job é o próprio formulário**, em modo leitura, com o
botão **Editar registro**. `AberturaForm` passou a ter três modos:
`abertura` (fila), `leitura` e `edicao`.

### ⚠️ Cards que saíram desta tela

`PrevisoesCard`, `PpsCard` e o card "Contato de cobrança" não são mais
renderizados por `/financeiro/jobs/[jobId]` — o conteúdo deles agora vive
nas abas (previsões no formulário de abertura, PPs no Fluxo de Caixa e na
trilha da Planilha, contatos na ficha de Informações).
`app/(app)/financeiro/jobs/[jobId]/dados.ts`, `previsoes-card.tsx` e
`pps-card.tsx` ficaram **sem uso** e continuam no repositório à espera da
decisão do Tiago sobre removê-los.

### Editar registro: congela o consumido, libera o saldo

O consumo anda em ordem de data e a parcela que fica no meio **parte em
duas** — a fatia consumida trava (cadeado) e o resto segue editável. Vale
para a curva (consome PP) e para o recebimento (consome nota). Regra
única em `lib/calculos/previsao-congelada.ts`, usada pela tela e pela
Server Action.

Toda alteração vai para `audit_events`
(`job.registro_abertura_editado`), com de/para de cada campo e das duas
previsões. **Sem bloco de histórico na tela**, por decisão do Tiago.

### Conferência no banco (20/08/2026)

`projetos_financeiro`: 12 linhas espelhadas, RLS ligada, 3 policies,
`authenticated` com select/insert/update e `anon` sem nada. Os 16 jobs
com `projeto_financeiro_id` preenchido.

### Conferido no navegador

As cinco abas renderizam sem erro de console; `/jobs/[jobId]` segue
íntegra depois da extração do carregamento. A repartição do congelado foi
conferida contra JOB-0015 (12.000 🔒 + 6.000 🔒 + 6.000 livre) e JOB-0013
(37.500 🔒 + 2.500 + 25.000).

### ⚠️ Depois: o financeiro deixou de encaminhar para outros módulos (2026-08-20)

Regra do Tiago no mesmo dia: **o módulo financeiro não deve encaminhar a
telas de outros módulos**. Entrou a tela
**`/financeiro/projetos/[projetoId]`** — a visão agregada do projeto
dentro do próprio financeiro — e quatro links passaram a apontar para
dentro:

| Onde | Ia para | Vai para |
|---|---|---|
| Faixa de grupo, "Visão agregada" | `/jobs/projeto/[id]` | `/financeiro/projetos/[id]` |
| Ficha do job, card Projeto | `/orcamentos/[projetoId]` | `/financeiro/projetos/[id]` |
| Ficha do job, "Jobs do projeto" | `/jobs/[id]` | `/financeiro/jobs/[id]` |
| Conferência da fila, planilha interna | `/jobs/[id]?aba=planilha` | `/financeiro/abertura-de-job/[id]/planilha` |

**A visão agregada é a MESMA tela da produção**, no recorte do
financeiro: árvore dos jobs, cards, um bloco de planilha por job e Totais
consolidado. Os jobs vêm de `projeto_financeiro_id` e levam o
`nome_financeiro`. A montagem saiu da página da produção e virou
`app/(app)/jobs/projeto/[projetoId]/carregar-planilhas.ts`, usada pelas
duas.

⚠️ **Ela tem duas abas** (21/08/2026): *Planilha Interna agregada* e
*Fluxo de Caixa do Projeto*. O fluxo soma todos os jobs, cada sub-linha
abre por job, e uma barra filtra por job ou por conta bancária —
recalculando no cliente, sem ida ao servidor. Por isso o cálculo da
matriz virou função pura (`lib/calculos/fluxo-caixa-matriz.ts`) e o
componente (`components/financeiro/fluxo-caixa-jobs.tsx`) serve a aba do
job e a do projeto. **Prazos no agregado são a média** dos jobs que têm a
data.

⚠️ **Entram só os jobs da aba "Visualizar Jobs"** (`aberto`,
`em_producao`, `encerrado`). Job aguardando abertura não aparece na
agregada — tem aba própria.

**Exceção combinada:** "Orçamento aprovado" continua saindo para
Orçamentos — é o único destino sem equivalente aqui —, mas agora com
confirmação ("Sair para o módulo de Orçamentos?"), via
`components/financeiro/link-saida-de-modulo.tsx`.

**Pendência:** `contas-a-pagar/pp-drawer-financeiro.tsx` ainda aponta para
`/jobs/[id]`. Não mexido nesta rodada — o arquivo tem commits do Antonio.

A classificação da esteira de faturamento saiu de `dados-abertos.ts` e
virou `lib/data/faturamento-por-job.ts`, usada pela lista e pelo agregado
do projeto: duas cópias divergiriam na primeira nota cancelada.


---

## ⚠️ 21/08/2026 — a conferência da abertura passou a enxergar o BV

Regra completa em `docs/decisions/022-bv-liquido-e-realizado-por-pp.md`.

`/financeiro/abertura-de-job/[jobId]/planilha` carregava `bvsPorItem={{}}`,
com o comentário "job aguardando abertura não tem PP nem BV". **A metade
sobre o BV estava errada**: o BV nasce no ORÇAMENTO, antes da aprovação,
então um job na fila já pode ter BV lançado. Na prática o financeiro
conferia um custo planejado com a comissão ainda embutida — e é
exatamente nesta tela que o planejado congela.

Agora a tela carrega os BVs da versão e ganhou a chave **Bruto ⇄
Líquido**, num componente client (`PlanilhaConferencia`) porque a chave
vale para os grupos e para o card de Totais juntos.

`/financeiro/jobs/[jobId]` e `/financeiro/projetos/[projetoId]` herdaram a
chave junto: as duas reaproveitam os componentes da produção
(`JobRealizadoSection` e `PlanilhasDoProjeto`).

**Verificação:** `tsc --noEmit`, `next lint` e `npm run build` limpos.

**Conferência logada no navegador, 21/08/2026** — JOB-0012, na fila de
abertura: a chave aparece, "Somente leitura" continua no lugar, e o bloco
REALIZADO inteiro fica em travessão (total e quebra). Esse último ponto
foi um defeito achado NA conferência: o item `A` mostrava o orçado no
realizado antes de o job abrir, contra a regra "desde a abertura".
Corrigido com o flag `jobAberto`; job encerrado segue mostrando o
realizado, porque ali ele é histórico.

`/financeiro/jobs/[jobId]` conferido no JOB-0010: mesma planilha da
produção, mesma chave, e o resumo do cabeçalho com realizado R$ 7.000,00
— que é o número certo só porque `dados.ts` parou de somar a coluna crua
(ela zera os itens `A`).

Zero erros de console e zero rolagem horizontal.

### O BV confirmado cai na fila de faturamento (nada novo, mas agora alcançável)

A esteira do BV já existia inteira — `vw_faturamento_pendente` inclui
`itens_bv` com `situacao = 'confirmado'`, e `dar_baixa_titulo` fecha o
ciclo em `recebido`. O que faltava era **chegar até ela**: o botão
Confirmar da planilha nascia desabilitado. Com ele liberado, o caminho
Confirmar → fila de Faturamento → nota → título → baixa → `recebido`
passa a rodar de ponta a ponta.

⚠️ A fila propõe `bv.valor`, o **bruto**; a planilha desconta o
**líquido**. É intencional: a nota contra o fornecedor é pela comissão
cheia e o imposto sai de dentro dela; o que abate o custo do item é o que
sobra. Decisão 022, §8.


---

## ⚠️ 21/08/2026 — recolher agrupamento nas planilhas do financeiro

`/financeiro/abertura-de-job/[jobId]/planilha` (conferência),
`/financeiro/jobs/[jobId]` (Planilha Interna) e
`/financeiro/projetos/[projetoId]` (consolidada) ganharam o **"Recolher
todos"** e o **chevron por grupo**, no mesmo desenho do orçamento.

As duas primeiras herdaram de graça — reaproveitam `JobRealizadoSection`
e `JobGrupoCard` da produção. Na consolidada o botão entrou **dentro de
cada card de job**, agindo nos grupos daquele job.

Recolhido, o grupo mantém subtotal e rentabilidade à vista. Detalhe da
conferência: o "Somente leitura" continua no lugar, e o botão convive com
a chave Bruto ⇄ Líquido na mesma barra.

**Verificação:** conferido logado no JOB-0012 (fila de abertura) e no
JOB-0010 pelo financeiro. Ver o detalhamento no `HANDOFF_JOBS.md`.


---

## ⚠️ 21/08/2026 — `/financeiro/projetos/[projetoId]` estava em branco

Achado na conferência final, e é o tipo de defeito que **só abrir a rota
pega**: `tsc`, `next lint` e `npm run build` passavam todos.

A página passava `jobHref={(id) => \`/financeiro/jobs/${id}\`}` — uma
**função** — para `PlanilhasDoProjeto`, que virou client component nesta
sessão (ele hospeda o estado da chave Bruto ⇄ Líquido). Função não
atravessa a fronteira server → client: o React derrubava a árvore com
*"Functions cannot be passed directly to Client Components"* e a rota
renderizava vazia.

Funcionava antes porque `ProjetoTotaisCard` era server e a função nunca
cruzava nada. E `/jobs/projeto/[projetoId]` não quebrou porque não passa
`jobHref` — usa o default.

**Correção:** a prop virou `jobHrefBase`, uma **string**
(`"/financeiro/jobs"`), e a função é montada dentro do componente client,
onde é inofensiva. A regra da decisão de 20/08 — o financeiro não
encaminha para telas de outros — segue de pé: conferido que os links de
"Abrir job" apontam para `/financeiro/jobs/[id]`.

Varri os outros quatro componentes client criados/convertidos nesta
sessão (`PlanilhaVersao`, `PlanilhaConferencia`, `PlanilhasDoProjeto`,
`JobRealizadoSection`) atrás de props de função vindas de server
components: este era o único caso.

Na mesma conferência: os rótulos de coluna da visão agregada não
acompanhavam a chave — os valores trocavam, mas o cabeçalho continuava
"Total" em vez de "Total líquido". Corrigido nos dois cards.

---

## ⚠️ 2026-08-24 — A planilha de conferência acompanhou a tabela única

**Origem:** projeto Claude Design `69342d83`,
`Planilha Interna - Grupos Unificados.dc.html`. Regra transversal em
`docs/decisions/024-planilha-em-tabela-unica.md`.

A conferência da abertura (`/financeiro/abertura-de-job/[jobId]/planilha`)
e o job na visão do financeiro (`/financeiro/jobs/[jobId]`) mostram a
MESMA planilha da produção — então mudaram junto, sem decisão própria:
uma tabela só, agrupamento em linha, rentabilidade no vão de PLANEJADO e
REALIZADO, e **TOTAL DA PLANILHA** fechando a tabela.

Nada mudou no que estas telas permitem: a conferência segue leitura pura
(sem errata, sem BV, sem PP) e o realizado segue zerado antes da abertura.
O que era `JobGrupoCard` virou o próprio `JobItemRealizadoTable`, que
agora recebe todos os agrupamentos de uma vez.

O projeto do financeiro (`/financeiro/projetos/[projetoId]`) usa o mesmo
`PlanilhasDoProjeto` da produção e acompanhou a correção da visão
agregada — ver o handoff de Jobs.

**Verificação:** conferido logado em 24/08/2026 na conferência do JOB-0012.

---

## ⚠️ 2026-08-24 — "Visualizar Jobs" ganhou Recebimentos, Custos e o seletor de organização

**Origem:** projeto Claude Design `69342d83`,
`Abertura de Job - Financeiro.dc.html`. Regra transversal em
`docs/decisions/025-recebimentos-e-custos-na-lista-de-jobs.md`.

**Isto altera a tabela descrita na seção 27** (`Jobs Abertos alinhado ao
design`) e a coluna Faturamento da seção 29 continua exatamente como
estava — as duas colunas novas ficam à direita dela, não a substituem.

### As duas colunas novas

**Recebimentos** (verde) e **Custos** (grafite-vermelho) mostram o número
mais atual do job: movimentado + título + previsão em aberto, somados de
`vw_fluxo_caixa` pela view nova `vw_fluxo_caixa_job_totais`. Cada célula
traz uma segunda linha dizendo o que o número de cima não conta sozinho:

| segunda linha | quando |
| --- | --- |
| `62% recebido` / `40% realizado` | há movimento na conta |
| `nada recebido` / `sem realizado` | só previsão ou título, nada movimentado |
| `previsto na abertura` | fallback — o job não tem nada daquele lado no caixa |
| `sem previsão` | o total é zero |

O fallback e o porquê dele estão na decisão 025, seção 4. Em resumo: sem
ele, 9 dos 13 jobs de hoje nasceriam com Recebimentos R$ 0,00, porque são
anteriores à `jobs_previsao_recebimento`.

Os dois totais entraram na linha de resumo do topo (somando o que os
filtros deixaram visível) e nas faixas de projeto, somando os jobs do
grupo.

### O seletor "Organizar por"

Pastilha no canto direito da linha de resumo, mesma forma da chave
Bruto/Líquido da planilha:

- **Por projeto** (padrão) — a tela de sempre: faixa do projeto, jobs
  embaixo, "Visão agregada" na faixa.
- **Por job** — lista corrida, sem faixa, ordenada pela abertura mais
  recente. O **código do projeto vira link** para a visão agregada
  (`/financeiro/projetos/[id]`) — decisão do Tiago: sem a faixa, é por
  ele que se chega lá. Job sem projeto do financeiro mostra o código da
  produção como texto, porque essa tela não existe para ele.

O padrão continua "Por projeto": é a arrumação que o financeiro já tinha.
Os chips da esteira, os quatro filtros e a busca valem igual nas duas
visões — a base é a mesma lista filtrada.

### A coluna Empresa saiu

Das duas visões. Decisão do Tiago (24/08/2026): "Empresa não precisa ser
um campo visível em nenhum dos casos — sempre será a empresa
selecionada". O seletor de empresa não existe ainda e não entra agora,
então a coluna só ocupava largura. Saiu junto o embed
`empresa:empresas(...)` da query, que não tinha outro consumidor.

### Arquivos

- `supabase/migrations/20260824000001_vw_fluxo_caixa_job_totais.sql` — view nova
- `lib/data/caixa-por-job.ts` — leitura da view (novo)
- `app/(app)/financeiro/abertura-de-job/dados-abertos.ts` — campos novos e o fallback
- `app/(app)/financeiro/abertura-de-job/jobs-abertos-list.tsx` — as duas visões

**Verificação (2026-08-24, logado):** `npx tsc --noEmit` e `npm run lint`
limpos, `npm run build` passou. A view foi conferida pelo MCP — `SELECT`
só para `authenticated`, nada para `anon`.

Na tela, com os 13 jobs do tenant:

- os números batem job a job com a `vw_fluxo_caixa`. JOB-0015 sai com
  Recebimentos R$ 38.795,58 · `21% recebido` e Custos R$ 20.000,00 ·
  `80% realizado`; JOB-0004 cai no fallback e mostra R$ 513.673,17 ·
  `previsto na abertura`; JOB-0008 e JOB-0009, sem curva, mostram
  R$ 0,00 · `sem previsão`;
- os totais do topo fecham com a soma das faixas — Recebimentos
  R$ 1.418.462,11 e Custos R$ 717.460,00;
- as duas visões trocam pelo seletor, e os chips e filtros valem nas
  duas: com "Faturado" (zero jobs hoje) a lista corrida cai no mesmo
  empty state e os totais zeram;
- na visão Por job, o código do projeto abre
  `/financeiro/projetos/[id]` e o resto da linha abre
  `/financeiro/jobs/[id]` — conferidos os dois.

Console e log do servidor limpos. Uma correção saiu daqui: os códigos de
job e de projeto quebravam em duas linhas nas colunas mais estreitas —
`whitespace-nowrap` nos quatro pontos.

---

## ⚠️ 2026-08-26 — O fluxo de caixa do job perdia dinheiro em dois pontos

Investigação a partir de um sintoma do Tiago: a aba **Fluxo de Caixa do
Job** do JOB-0013 estava com a coluna Entradas inteira vazia e mostrava
R$ 25.000,00 de saída onde a abertura previa R$ 65.000,00. A tela e o
`lib/calculos/fluxo-caixa-matriz.ts` estavam certos — os dois furos eram
de leitura, na `vw_fluxo_caixa`.

Regras novas em [decisão 027](../decisions/027-pp-aprovada-e-a-composicao-do-fluxo-do-job.md).
Migrations `20260826000001`, `20260826000002` e `20260826000003`.

**1. PP em avaliação abatia a curva sem virar título.** `itens_com_pp`
aceitava tudo que não fosse cancelada/rejeitada; o branch da PP só
emitia `aprovada`/`pago`. Entre criar e aprovar, o custo sumia. No
JOB-0013 escondia R$ 40.000,00 (planejado do item da PP-00008, que está
`em_avaliacao`). Agora os dois filtros são o mesmo: **PP aprovada é
título**.

**2. Recebimento pago sumia do job.** `dar_baixa_titulo`,
`dar_baixa_titulo_com_plano` e `estornar_baixa_titulo` gravam o
lançamento **sem `job_id`** — as únicas três de oito RPCs de baixa que
não gravam. A linha "Já movimentado / Entradas" era estruturalmente
zero. O conserto não é preencher a coluna (uma nota soma vários jobs):
a view passa a ratear o lançamento por `titulo_receber_id` →
`fat_composicao`, a mesma régua da classe `titulo`. **Nenhuma RPC foi
tocada** — inclusive para não encostar nas que a outra frente reescreveu
em 25/08 (`20260825000002`, `20260825000005`).

**3. Composição do valor no hover/clique.** Toda célula da matriz abre a
lista dos documentos que a formam — as três sub-linhas, o total de cada
natureza, o **Líquido do período** e a contribuição por job da visão
agregada. É o que nomeia o estorno de PP como estorno *daquela* PP: ele
continua somando na linha de movimento (o número é o do extrato, por
decisão do Tiago), mas deixa de se passar por recebimento de cliente.
Coluna nova `vw_fluxo_caixa.origem_lancamento` carrega
`lancamentos_financeiros.origem` para isso.

No líquido — a única célula onde entrada e saída convivem — cada item sai
com sinal (`+` verde, `−` vermelho) e a cor do valor vem do sinal, não da
natureza. O **Saldo acumulado** ficou de fora: sendo soma corrida, a
composição dele seria a matriz inteira repetida em cada coluna.

**3b. "Curva de desembolso" agora é "Cronograma de desembolsos".** O mesmo
conceito tinha três nomes na interface. O nome único fica um nível abaixo
de "Previsão de custos", que já é o `<h2>` da seção que o contém no form
de Abertura do Job. Trocado na sub-linha da aba, no form de abertura
(bloco, subtítulo e 4 mensagens de erro) e na `descricao` do branch 6 da
view — que virou `Cronograma de desembolsos · JOB-0013 1/2`, no formato
do branch de recebimento. ⚠️ Como esse texto vem do banco, a tela geral
`/financeiro/fluxo-caixa` também passa a exibir o nome novo.

**4. Avulsa e desembolso saem do título do job.** Só PP abate a curva,
então avulsa/desembolso aprovados apareceriam como dívida a mais. No
recorte por job eles só entram depois da baixa; no Fluxo de Caixa geral
continuam como estão. Hoje não muda número: nenhuma das duas está
vinculada a job.

**5. "Saldo do job hoje" era o mês inteiro, com as três classes.** Isso
brigava com a rolagem da decisão 018 §3: a previsão do JOB-0013 rolou de
19/08 para 27/08 — amanhã, mas ainda em agosto —, e a coluna do mês a
trazia de volta. O card mostrava R$ 104.064,87 "já movimentados" num job
sem um centavo na conta. Agora soma só a classe `movimento`, por DATA e
até hoje, que é o que o subtítulo sempre prometeu. Título vencido e não
pago fica de fora (decisão do Tiago). `saldoFim` não muda.

**6. Backfill.** 8 dos 10 jobs abertos ganharam previsão de recebimento
(parcela única = `faturamento_previsto` em `data_prevista_faturamento`).
JOB-0001 e JOB-0002 ficaram sem — `data_prevista_faturamento` nula.

⚠️ **Os números da nota de 2026-08-24 acima envelheceram.** O JOB-0015
saía com Recebimentos R$ 38.795,58 · `21% recebido` e Custos
R$ 20.000,00 · `80% realizado`; depois destes consertos sai com
Recebimentos R$ 49.754,69 · `38% recebido` e Custos R$ 20.000,00 ·
`80% realizado`. O JOB-0013 saiu de R$ 25.000,00 para R$ 65.000,00 de
custo. Os totais do topo mudam na mesma proporção.

**Verificação (2026-08-26):** `npm run typecheck` e `npm run lint`
limpos. Banco conferido pelo MCP: soma dos lançamentos preservada ao
centavo depois do rateio e depois do rename (entrada R$ 18.959,11 e saída
R$ 16.000,00 em `lancamentos_financeiros` e na classe `movimento` da
view), `SELECT` só para `authenticated` nas duas views, backfill sem
sobrescrever nenhuma previsão existente.

O componente foi exercitado numa rota temporária sem sessão (removida em
seguida, junto da liberação no `isPublicRoute`) com os dados reais do
JOB-0015 mais um mês de líquido negativo montado de propósito. Conferidos
no navegador:

- a tabela não quebra com o `PopoverAnchor` no `<td>`;
- Entradas 08/2026 = R$ 18.959,11 abre em `NF 900123/1 · RECEBIMENTO DE
  TÍTULO` + 2 × `PP-00009 3/3 · ESTORNO DE PP` (fundo âmbar);
- Saídas 08/2026 = R$ 16.000,00 abre em 2 × `BAIXA DE PP` + 2 ×
  `BAIXA DE PP (ESTORNADA)` da mesma parcela 3/3 — que é a explicação do
  número dobrado que o Tiago decidiu manter;
- Líquido 09/2026 = −R$ 59.081,77 abre em `+ R$ 5.918,23` de faturamento
  previsto e `− R$ 40.000,00` / `− R$ 25.000,00` de
  `CRONOGRAMA DE DESEMBOLSOS`, nessa ordem, e a célula fica vermelha;
- hover abre com atraso, clique fixa, e dois popovers fixados convivem.

Duas correções saíram daí: o código do documento estava sendo truncado
por dividir a linha com o selo (foi para linha própria), e nas linhas de
previsão o selo e a descrição repetiam a mesma frase (a descrição some
quando é igual ao rótulo).

**A verificação logada, na tela real, fica com o Tiago.**

**Conferência logada (2026-08-26, Tiago logou e a sessão foi verificada
na tela real):** JOB-0013 saiu de Entradas vazias e R$ 25.000,00 de saída
para R$ 104.064,87 de entrada prevista e R$ 65.000,00 de saída, com os
prazos de recebimento (0 e 2 dias) que antes eram travessão; JOB-0015
passou a mostrar R$ 18.959,11 em "já movimentado" das Entradas — o
recebimento de R$ 10.959,11 que sumia mais os dois estornos —, e a
composição no hover nomeia cada um. Líquido do período abre com sinal. A
lista "Visualizar Jobs" bate: JOB-0015 com `R$ 49.754,69 · 38% recebido`
e `R$ 20.000,00 · 80% realizado`; JOB-0013 com `R$ 65.000,00 · sem
realizado`. Depois do conserto do saldo de hoje, JOB-0013 mostra R$ 0,00
e JOB-0015 segue em R$ 2.959,11. Console limpo.

⚠️ **Armadilha de dev que custou tempo aqui:** um `ReferenceError:
quantos is not defined` apareceu no console e derrubou a aba inteira pelo
error boundary. Não era bug no código — era chunk velho de HMR, do
instante em que a variável era usada antes de ser declarada. `tsc` passa
e o repo está correto; o que resolve é parar o dev server, apagar
`.next/cache/webpack` e subir de novo. Buffer de console também sobrevive
ao restart: confira numa aba nova antes de acreditar no erro.

## ⚠️ 24–27/08/2026 — o SAVE no financeiro

**Regra:** `docs/decisions/028-save-entre-jobs.md`, com as regras de fluxo
de caixa definidas pelo Tiago em 26/08/2026.
**Contexto:** ver os handoffs de Orçamentos e de Jobs, mesma data.

O save é crédito entre jobs. Para o financeiro ele aparece em cinco
lugares, e a régua é sempre a mesma: **job primeiro, depois o save**.

### 1. Conferência da abertura

A planilha de conferência (`/financeiro/abertura-de-job/[jobId]/planilha`)
ganhou a coluna SAVE e a quebra do fechamento. Sem isso o financeiro via
"Faturamento previsto R$ 125.512,61" e "Valor do Job R$ 68.348,45"
divergindo, e três linhas sem planejado, **sem nenhuma explicação na
tela**.

No formulário de abertura, o aviso de faturamento zero passou a
distinguir os dois motivos: *"o cliente paga o fornecedor direto"* (o de
sempre) e *"este job é pago com saldo em save de outro job — o cliente já
pagou por ele numa nota anterior"*.

### 2. Fila de faturamento

A linha do job de origem mostra a quebra sob o valor da parcela:
`job R$ 5.592,15 · save R$ 57.164,16`. Vem de `vw_faturamento_pendente`,
que ganhou `valor_proprio_da_parcela`, `valor_save_da_parcela`,
`saldo_proprio` e `saldo_save`.

### 3. A nota sai com dois itens

O drawer mostra a pastilha **Save** e a leitura "R$ 5.592,15 do job ·
R$ 57.164,16 em saldo de save". `emitir_faturamento` grava dois
`faturamento_itens` na MESMA nota:

| origem_tipo | origem_id | valor |
|---|---|---:|
| `job` | JOB-0020 | 5.592,15 |
| `save` | JOB-0020 | 57.164,16 |

O enum `faturamento_origem` ganhou o valor `save` e o CHECK
`chk_fat_item_origem` foi substituído para aceitá-lo — **o único item
destrutivo da frente**, aprovado pelo Tiago.

### 4. Fluxo de caixa

Três origens novas, todas somando o mesmo dinheiro de sempre:

| origem_tipo | O quê | job_id |
|---|---|---|
| `previsao_recebimento_save` / `titulo_save` / `lancamento_save` | saldo em save ainda sem dono | `null` |
| `..._save_consumido` | a parte já consumida, **na data em que o dinheiro entrou** | o job consumidor |
| as antigas | a parte própria do job | o job |

`vw_titulo_partes` concentra a régua "job primeiro" num lugar só: a
primeira parcela cobre a parte própria e o save ocupa o fim da fila; a
parcela que cruza a fronteira parte em duas.

### 5. Conciliação

A transação de baixa ganhou as pastilhas **Rateado** e **Save** e um
detalhe "De onde vem este dinheiro", com as origens somando o valor
lançado. Lançamento de origem única **não** ganha expansão.

### 6. Portão do cancelamento

`cancelar_faturamento` recusa cancelar nota cujo saldo em save já foi
consumido por job **encerrado** — o cancelamento reescreveria a margem de
um job que a decisão 008 declara congelado.

### Achados do teste ponta a ponta (27/08/2026)

1. **A expansão da conciliação nunca aparecia.** A consulta pedia
   `job:jobs!job_id(...)` embedado em `vw_lancamento_origens` — e o
   PostgREST não tem chave estrangeira para inferir join a partir de uma
   VIEW. O erro era silencioso (`data` vinha vazio) e a linha ficava sem
   expansão. Passou a resolver o nome do job numa segunda leitura.
2. **A fila não mostrava a quebra.** Os campos existiam no tipo e não
   eram renderizados.
3. **"Agrupada · 2 jobs" numa nota de um job só.** O badge contava
   ITENS de nota; a nota com save tem dois itens do mesmo job. Passou a
   contar jobs distintos (`qtd_jobs`), e a fila deixou de repetir o código
   do job na linha do faturado.

**Verificação:** conferido logado. JOB-0020 foi enviado em 2 parcelas
(R$ 62.756,30 + R$ 62.756,31); a 1ª ficou toda no job, a 2ª partiu em
`job R$ 5.592,15 + save R$ 57.164,16`; a NF 900500 saiu com os dois itens;
a baixa gerou quatro linhas no fluxo (job, save sem dono e duas do save já
consumido por JOB-0022), somando exatamente o título. `tsc`, `lint` e
`build` limpos.


---

## ⚠️ Conciliação — colunas (27/08/2026)

Duas mudanças na tabela de `/financeiro/conciliacao`, a pedido do Tiago:

**1. O dinheiro subiu.** A ordem passou a ser
`Data · Crédito · Débito · Saldo · Descrição · Fornecedor · Job · Tipo · Subtipo`.
Crédito, Débito e Saldo ficavam no fim da linha, e conferir valor contra
data obrigava a atravessar a tela inteira — que é o oposto de como se lê um
extrato bancário.

**2. "Tipo" mostrava o subtipo.** A coluna era uma só e renderizava
`tipo_codigo · subtipo_nome` — na tela, `05 · Salário`. O **05** é o código
do tipo (*Despesa com Pessoal*), mas o **Salário** é o nome do SUBTIPO, e o
nome do tipo não aparecia em lugar nenhum.

Agora são duas colunas, cada uma com o `código · nome` do seu nível do plano
de contas:

| | Antes (uma coluna "Tipo") | Agora |
|---|---|---|
| **Tipo** | `05 · Salário` | `05 · Despesa com Pessoal` |
| **Subtipo** | — | `001 · Salário` |

`LancamentoLinha` já carregava `tipo_nome` sem ninguém usar; o que faltava
era `subtipo_codigo`, acrescentado à query em `conciliacao/page.tsx`.

O subtipo aparece com o código curto (`001`), e não com o composto que o
Plano de Contas usa na árvore (`05.001`) — ao lado da coluna Tipo, repetir o
`05.` seria redundante.

**3. Coluna Regional**, à direita do Subtipo. A ordem final é
`Data · Crédito · Débito · Saldo · Descrição · Fornecedor · Job · Tipo · Subtipo · Regional`.

⚠️ **Não inventamos regra de regional aqui.** A coluna segue exatamente a
que o `vw_fluxo_caixa` já usava (migration `20260817000006`), para as duas
telas nunca discordarem sobre a mesma linha:

1. **Conta avulsa rateada manda.** É a única origem que se divide entre
   regionais.
2. **Sem rateio, a regional do JOB.**
3. **Sem job, a da EMPRESA.**

O passo 3 não é detalhe: os lançamentos de `titulo_baixa` (recebimento de
NF) têm `job_id` nulo, e sem o fallback metade do extrato ficaria com
travessão.

Quando a avulsa se divide entre **duas ou mais** regionais, a célula mostra
**"Rateada"** — o nome de uma só seria mentira, e a divisão com os
percentuais já vive no detalhe que o botão "Rateado" abre na própria linha.

**4. Coluna Origem** (28/08/2026), à direita da Regional. De onde o
lançamento veio, pelo identificador interno:

| Origem do lançamento | O que a coluna mostra |
|---|---|
| Pedido de Produção | `PP-00009` |
| Desembolso | `DES-00004` |
| Conta avulsa | `AV-00001` — **código novo**, ver abaixo |
| Recebimento de título | `NF 900123/1` |
| Manual | — |

A avulsa **ganhou código** (migration `20260828100001`). Era a única origem
sem identificador: `descricao` é texto livre, e duas avulsas diferentes
ficavam indistinguíveis. O código nasce nos dois caminhos de criação — a
avulsa manual (`actions-avulsas.ts`) e a ocorrência de recorrência, que é
gerada dentro da função `gerar_ocorrencias_recorrentes`.

O **recebimento não tem código interno**, e isso é deliberado: `faturamentos`
não tem `codigo`, e num título a receber a origem *é* a nota. Criar um
`FAT-` só faria a futura coluna Documento repetir esta.

Dois distintivos acompanham o código, sem substituí-lo:

- **Recorrente** — a avulsa nasceu de uma recorrência (assinatura,
  mensalidade). Chamar de "avulso" o que se repete todo mês confunde.
- **Cartão** (`Nubank ·4471`) — forma de PAGAMENTO, não origem. Fica ao
  lado do código de propósito: duas PPs iguais não podem aparecer
  diferentes só porque uma passou no cartão.

⚠️ **Armadilha desta query, para quem for mexer.** `titulos_receber` tem FK
para `lancamentos_financeiros` **nas duas direções**
(`lancamentos_financeiros.titulo_receber_id` e `titulos_receber.lancamento_id`),
então o embed precisa nomear a constraint
(`titulos_receber!lancamentos_financeiros_titulo_receber_id_fkey`). Sem
isso o PostgREST não escolhe e **a query inteira falha**.

O sintoma é traiçoeiro: a página lia `const { data } = await …` sem olhar o
erro, e o resultado era a tela dizer *"nenhum lançamento nesse período"* —
indistinguível de um período vazio de verdade. O erro passou a ser logado.

**5. Coluna Documento** (28/08/2026), à direita da Origem. O comprovante
fiscal — `NF 4471`, `Recibo 88` — como link que abre o arquivo.

### O cadastro que ela exigiu

Não existia. O único documento fiscal estruturado do sistema era a **NF de
saída** (`faturamentos.numero_nf` + `serie`), que só aparece em recebimento.
Do lado da despesa havia apenas `arquivo_path` + `arquivo_nome_original`: o
sistema sabia que tinha um PDF chamado `nota-fornecedor.pdf`, não que era
uma NF nº 4471.

Migration `20260828110001`: enum `documento_tipo` (`nota_fiscal`, `recibo`,
`boleto`, `contrato`, `outro`) e o par `documento_tipo` + `documento_numero`
nas **quatro** tabelas de anexo — PP, conta avulsa, desembolso e prestação
de contas de verba.

**Os campos ficam na LINHA DO ANEXO, não no título.** Uma PP pode ter NF,
boleto e contrato juntos; no título só caberia um, e os outros ficariam sem
identificação. O componente é um só
(`components/financeiro/documento-do-anexo-field.tsx`) para o rótulo e a
lista de tipos não divergirem entre as quatro telas — foi o que aconteceu
com as cores das planilhas.

A coluna mostra o primeiro anexo tipado como **nota ou recibo**
(`DOCUMENTO_TIPOS_FISCAIS`). Contrato e boleto acompanham a compra, mas não
são o documento que a contabilidade procura.

### Onde cada documento entra

| Origem | Quando o documento é informado |
|---|---|
| PP normal | Na emissão — o anexo já é obrigatório ali |
| **PP de Verba de Produção** | Na **prestação de contas**. A PP de verba sai sem anexo (ver HANDOFF_JOBS): ela é adiantamento, e a nota só existe depois que o responsável gasta |
| Conta avulsa | Na criação |
| Desembolso | Na criação |
| Recebimento | Já vinha pronto de `faturamentos` |

⚠️ **O link NÃO recebe bucket e caminho do cliente.** A action
`abrirDocumentoDoLancamento` recebe o **id do lançamento** e re-deriva o
arquivo no servidor. A versão óbvia — o cliente manda `{bucket, path}` e o
servidor assina — deixaria qualquer pessoa logada pedir URL assinada para
qualquer arquivo de qualquer tenant. São quatro origens em três buckets
(`pedidos-compra`, `desembolsos`, `contas-avulsas`, `faturamentos-nf`), e a
tentação de passar o par pronto é grande.

A URL vive 60 segundos e é gerada no clique, não com a página: assinada no
carregamento, ela venceria para quem deixa o extrato aberto.

**Ponta solta:** o tipo é **opcional**. Anexo antigo não tem o que
preencher, e nada obriga a preencher no novo — se ninguém preencher, a
coluna fica em travessão. Tornar obrigatório é uma linha em cada um dos
quatro formulários, quando o time decidir.
