# Handoff — Financeiro

Registro da implementação do módulo Financeiro, mais as decisões de modelagem e
de negócio tomadas junto com o time durante a execução.

| Parte | Design | Telas | Seções |
|---|---|---|---|
| **I** | `Abertura de Job.dc.html` | fila de abertura, conferência, formulário de registro financeiro | 1 a 9 |

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
| `custo_previsto_total` | **cópia** do custo planejado da planilha no instante da abertura |
| `data_abertura_financeiro` / `aberto_por` | carimbo de quem abriu e quando; não editável pela UI |

Mais a tabela `jobs_previsao_custo`: a **curva de desembolso** — em que datas o
custo previsto deve sair do caixa. Nasce com RLS, 4 policies, `GRANT` explícito
para `authenticated` e três índices.

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
4. **`jobs.observacoes`** grava desde a Entrega 9 do módulo de Jobs e nenhuma
   tela lê. Esta é a tela onde faria sentido: é contexto para quem abre.

---

## 10. Migrations

| Migration | O que faz |
|---|---|
| `20260811000002_abertura_job_financeiro.sql` | 7 colunas em `jobs`, tabela `jobs_previsao_custo` com RLS + 4 policies + GRANT + índices, escopo `job` em `categorias_dominio` |
| `20260811000003_categorias_dominio_job_seed.sql` | 5 categorias de job iniciais, idempotente |
