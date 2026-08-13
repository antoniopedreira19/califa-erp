# Handoff — Financeiro

Registro da implementação do módulo Financeiro, mais as decisões de modelagem e
de negócio tomadas junto com o time durante a execução.

| Parte | Design | Telas | Seções |
|---|---|---|---|
| **I** | `Abertura de Job.dc.html` | fila de abertura, conferência, formulário de registro financeiro | 1 a 10 |
| **I·rev** | revisão de 12/08 (sem design novo) | previsão de desembolso na calha PP, janelas 08/20, os dois números do fechamento | 11 a 14 |
| **II** | `Abertura de Job - Financeiro.dc.html`, aba "Jobs abertos" | lista de jobs abertos, job na visão do financeiro | 15 a 18 |

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
