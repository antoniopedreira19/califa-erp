# Subsistema Férias — Spec viva

> **Status**: Descoberta **fechada** em 2026-10-01 com validação da Kika, Mari e Maria (RH). Todas as pendências bloqueantes resolvidas. Pronto pra passar à modelagem (`03-modelo-de-dados.md`) e planejamento de execução.
>
> Este documento é a fonte-verdade do subsistema — toda decisão nova entra aqui, não em commit ou chat.
>
> **Precede implementação.** As únicas pendências que restam (modelo combinado de recibo + empresa emissora) são não-bloqueantes e podem ser resolvidas durante a implementação do gerador de PDF.

## 1. Contexto

Hoje a California controla férias numa planilha Excel (`Controle e Planejamento de Férias - Agência California 2026.xlsx`) com 23 abas. O coração são 4 abas:

- **Controle de Férias** (61 colunas) — uma linha por colaborador, com saldo, status atual e **7 blocos de período aquisitivo** à frente. Fórmulas puxam dias usufruídos da aba Planejador via `SUMIFS`.
- **Planejador de Férias** — log de eventos: cada linha é um lançamento (data início, fim, dias, tipo Gozadas/Pagas, status Finalizada/Pendente).
- **Períodos** — histórico consolidado em texto solto por período aquisitivo. Memória visual do RH.
- **Cálculo** — tabela dinâmica com KPIs agregados.

O subsistema de férias no ERP vai **substituir** esse controle, não espelhá-lo. O ganho principal é tirar o RH do papel de digitador: colaborador solicita, líder/RH aprova, sistema calcula valores (PJ) e gera recibo.

## 2. Objetivo

Controlar o ciclo completo de férias de todos os colaboradores ativos da California (CLT, PJ, Estagiário, ART, sócio), do nascimento do direito ao usufruto e pagamento, com:

- Autoserviço do colaborador pra consultar saldo e solicitar.
- Aprovação do RH (com visibilidade do líder direto).
- Cálculo automático de valores para PJ (CLT recebe recibo pronto da contabilidade).
- Geração de recibo PJ em 3 formatos.
- Notificações granulares para colaborador, líder/urso e RH.
- Integração com rescisão (saldo vencido + proporcional).

## 3. Vocabulário

### Da CLT (termos legais)
- **Período aquisitivo**: 12 meses em que o colaborador "ganha" o direito às férias. Começa na data de admissão.
- **Período concessivo**: 12 meses seguintes, prazo pra gozar.
- **Dobra**: se o concessivo acaba sem o colaborador tirar férias, o empregador paga em dobro (CLT art. 137). **A California não aplica** — ver §4.3.
- **Abono pecuniário**: conversão de até 1/3 das férias em dinheiro (CLT art. 143).
- **1/3 constitucional**: adicional de 1/3 do salário pago junto das férias (CF art. 7º, XVII).

### Da California (termos internos)
- **Urso**: alias usado na planilha pra "líder direto" (coluna L da aba Planejador: "Ursos" = lista de líderes). No sistema é o mesmo campo `colaboradores.lider_id`.
- **Avô** (ou "avo"): termo contábil — cada mês de direito de férias = 1 avô = 1/12 do período aquisitivo (= 2,5 dias). "21 avós" na rescisão significa 21 meses de direito acumulado. Ver §4.7 para a regra de contagem.
- **Férias Gozadas**: dias efetivamente tirados de folga.
- **Férias Pagas** (planilha): abono pecuniário — dias vendidos. **Atenção**: para PJ, a California permite "venda de dias avulsos" separada do bloco de férias (ver §4.4).
- **Pago em rescisão**: saldo quitado na saída do colaborador.
- **Regularizado**: colaborador antigo que teve férias vencidas, mas foi quitado.

### Estados do colaborador na planilha (herdados pelo sistema)
| Rótulo               | Significado                                                     |
|---                   |---                                                              |
| Apto à férias        | Tem período com direito disponível pra gozar                    |
| Dentro do prazo      | Tudo em ordem, nenhum concessivo em risco                       |
| Férias em alerta     | Concessivo perto de acabar (política interna define quando)     |
| Férias Pendentes     | Concessivo estourando no mês corrente                           |
| Férias Vencidas      | Passou do concessivo — **não dobra na California** (ver §4.3)   |
| Período incompleto   | Aquisitivo ainda em andamento, não gerou direito completo       |
| Regularizado         | Férias antigas vencidas já quitadas                             |
| Não habilitado       | Não gerou direito ainda ou desligado antes de completar         |
| Pago em rescisão     | Colaborador desligado com saldo pago na rescisão                |

## 4. Regras de negócio

### 4.1 Nascimento do direito

- Qualquer colaborador ativo (CLT, PJ, Estagiário, ART, sócio) **precisa completar 12 meses** desde a admissão pra ganhar o primeiro período aquisitivo.
- Direito nominal: **30 dias** por período completo. Dias por tipo de contratação são iguais — a California trata PJ como CLT para fins de política de férias.

### 4.2 Períodos aquisitivo e concessivo

- **Aquisitivo**: começa na admissão, dura 12 meses. Fecha no dia anterior ao aniversário da admissão.
- **Concessivo**: começa no dia seguinte ao fecho do aquisitivo, dura 12 meses.
- **Fracionamento**: a planilha reserva 7 blocos de PERÍODO, o que suporta até 7 fracionamentos do mesmo período aquisitivo. Na prática, a California costuma usar 2 a 3 fracionamentos. Lei permite até 3 (um deles ≥14 dias).

> **Pendência**: para recém-admitidos, a planilha mostra data-limite 2027-12-12 em várias linhas (ex.: Amanda Kapazi, admitida 23/09/2026), o que fura a regra padrão (seria agosto/2028). Hipótese: data coletiva de concessivo. **Precisa validar com RH** — ver §12.

### 4.3 Política anti-dobra

> **Decisão California (confirmada pela Kika em 2026-10-01)**: a California **não paga férias em dobro**, nem CLT nem PJ. A gestão é feita pra ninguém chegar nesse ponto.

Consequências para o sistema:
- Não calcular valor em dobro em nenhum cenário.
- **Alertas fortes antes do vencimento** são o controle operacional que substitui a punição legal. O sistema deve alertar com folga quando o concessivo se aproxima.
- Férias vencidas aparecem no painel do RH como pendência de regularização — não como débito automático.

### 4.4 Abono pecuniário — modelo California

- **CLT clássico**: pode vender até 1/3 (10 dias) do período aquisitivo. Modelo tradicional da CLT.
- **PJ na California**: pode vender até **10 dias avulsos, separados do bloco de férias**. É um lançamento próprio, não precisa combinar com dias de folga.
- **Exceção (ambos)**: em casos extremos, a empresa libera a venda de **mais de 10 dias** por acordo. Isso vira um lançamento marcado como "abono excepcional" e precisa de aprovação administrativa.

### 4.5 Cálculo do saldo

- `dias_direito_do_periodo = 30` (sempre, se período aquisitivo completou).
- `dias_usufruidos_do_periodo = SUM(lançamentos aprovados do período, qualquer tipo)`.
- `dias_pendentes_do_periodo = 30 - dias_usufruidos_do_periodo` (nunca negativo).
- `saldo_total = SUM(dias_pendentes de todos os períodos com direito)`.

Enquanto o aquisitivo não fecha, `dias_pendentes = 30` e `dias_direito_efetivo = 0` (ainda não habilitado).

### 4.7 Contagem de meses ("avós") pra rescisão

**Confirmado pelo RH em 2026-10-01:**

Cada período aquisitivo tem **12 avós** (meses). Pra contar como 1 avô, o colaborador precisa ter trabalhado **≥ 15 dias dentro do mês**.

Regra prática:
- **≥ 15 dias trabalhados no mês** → conta 1 avô inteiro.
- **< 15 dias trabalhados no mês** → não conta.

Exemplo: colaborador com demissão em **13/10/2026** → outubro **não conta** (só 13 dias trabalhados). Último avô contado é setembro/2026.

Fórmula pra `meses_de_direito` na rescisão:
```
meses_vencidos      = SUM(avós pendentes de cada período aquisitivo completo não gozado)
meses_proporcionais = número de meses do aquisitivo em curso (regra dos 15 dias)
total_avos          = meses_vencidos + meses_proporcionais
valor_ferias_rescisao = (salário / 12) × total_avos
```

Isso resolve a pendência P2.

### 4.6 1/3 constitucional e 13º proporcional

- **CLT**: a contabilidade manda o recibo pronto com salário + férias + 1/3 + eventualmente 13º integrado. **O sistema não calcula CLT** — só registra o evento e espera o lançamento da contabilidade.
- **PJ**: o sistema calcula e gera o recibo:
  - `valor_ferias = salario / 30 × dias_gozados` (pro-rata diária).
  - `um_terco = valor_ferias / 3`.
  - `abono = salario / 30 × dias_abono` (quando houver).
  - Total do recibo = férias + 1/3 + abono.
  - **Não há 13º nos lançamentos de férias para PJ** — PJ recebe 13º equivalente em pagamento próprio, não integrado às férias.

## 5. Fluxo operacional

### 5.1 Papéis envolvidos

- **Colaborador** (role nova — ver §9): consulta saldo em `/perfil`, solicita quando habilitado.
- **Líder direto** (campo `colaboradores.lider_id`): recebe notificação. **Não aprova** — a aprovação é do RH. A visibilidade existe pra o líder bloquear/renegociar informalmente antes.
- **RH / Administrador**: aprova, altera, cancela, lança diretamente, gera recibo.

### 5.2 Caminho feliz (solicitação pelo colaborador)

1. Colaborador abre `/perfil`, vê card "Minhas férias" com saldo e períodos.
2. Se tem período `Apto à férias`, botão "Solicitar férias" fica ativo.
3. Formulário: data início, data fim (ou dias), tipo (`usufruto` / `abono avulso` / `misto`), observação. Validação: **data início ≥ hoje + 5 dias** (confirmado pelo RH 2026-10-01), dias ≤ saldo do período.
4. Submit cria registro com status `Pendente de aprovação`. Dispara notificação pro líder direto (ciência) e pro RH (ação).
5. RH abre `/rh/ferias/solicitacoes`, revisa, aprova ou reprova (com motivo). Pode mudar pra `Em análise` pra pedir ajuste.
6. Ao aprovar: status vira `Aprovado`. Se PJ: sistema gera recibo PDF. Dispara notificação pro colaborador + líder.
7. No dia de início: status muda automaticamente pra `Concluído em andamento` (ou similar) e dispara aviso de início pro time.
8. No dia de fim: dispara aviso de retorno pro líder + time. Status final `Concluído`.

### 5.3 Lançamento direto pelo RH

RH pode criar um lançamento diretamente sem passar pelo fluxo de solicitação (ex.: lançamento retroativo, importação de histórico, excepcionalidade). Status já nasce `Aprovado`. Tem flag `lancado_direto_por_rh` pra auditoria.

### 5.4 Alteração e cancelamento

- Antes do início: colaborador pode cancelar (vira `Cancelado`). Alteração de data requer re-aprovação do RH.
- Após o início: só RH altera ou cancela, com observação obrigatória.
- Em rescisão: saldo pendente é computado automaticamente — ver §8.

### 5.5 Rescisão com saldo

Hoje o RH faz num Excel separado (`calculo-recisão.xlsx`). O sistema deve absorver esse cálculo:

```
Saldo de salário  = (salário / 30) × dias trabalhados no mês da saída
Férias            = (salário / 12) × meses de direito acumulado
1/3 férias        = Férias / 3
13º proporcional  = (salário / 12) × meses no ano
Total devido      = soma dos 4
Descontos         = planos de saúde + TotalPass + outros
Total a pagar     = Total devido − Descontos
```

> **Pendência**: definir o cálculo exato de "meses de direito acumulado" (soma dos vencidos + proporcional do aquisitivo em curso?). Ver §12.

Valor da rescisão vira um título em `contas_avulsas` do colaborador, mesmo motor da folha mensal.

## 6. Notificações

### 6.1 Tipos de aviso (enum)
`solicitacao`, `alteracao`, `cancelamento`, `lembrete`, `inicio`, `retorno`.

### 6.2 Status de solicitação (enum)
`pendente_aprovacao`, `em_analise`, `aprovado`, `reprovado`, `cancelado`, `concluido`.

### 6.3 Alertas automáticos (gerados pelo sistema)

| Evento                                | Destinatários                        | Quando dispara                                  |
|---                                    |---                                   |---                                              |
| Concessivo liberado                   | Colaborador + líder direto + RH      | No dia que o aquisitivo completa 12 meses       |
| Concessivo em alerta                  | Colaborador + líder direto + RH      | **60 dias antes do fim do concessivo**          |
| PJ: emitir NF antes de sair           | Colaborador PJ                       | **5 dias antes do início do lançamento aprovado** |
| Retorno de férias                     | Líder direto + RH + time             | 1 dia antes do fim do lançamento                |
| Férias vencidas                       | RH                                   | No dia que o concessivo acaba sem uso           |
| Solicitação aguardando aprovação      | RH                                   | Imediato após submit do colaborador             |
| Férias aprovadas                      | Colaborador + líder                  | Imediato após aprovação                         |
| Férias reprovadas                     | Colaborador                          | Imediato após reprovação                        |

### 6.4 Painel de notificações (UI)

Dentro de `/rh/ferias` tem uma seção "Notificações" com:
- Contadores: solicitações aguardando / concessivo vencendo em 30/60 dias / férias vencidas sem regularização.
- Lista cronológica com filtros por tipo e status.
- Marcar como lida (não deleta — mantém histórico).

Pendente definir: notificação só in-app, ou também e-mail? Padrão sugerido pro MVP: só in-app. Depois adicionamos e-mail se necessário.

## 7. Recibos (só PJ)

CLT: nada — contabilidade manda pronto.

PJ precisa de **3 modelos de recibo** gerados pelo sistema (PDF):
1. **Férias + abono combinados** — usufruto e abono do mesmo evento.
2. **Só férias** — apenas usufruto, sem abono. ✅ Modelo recebido 2026-10-01 (`_MODELO FÉRIAS.pdf`).
3. **Só abono** — venda avulsa de dias (até 10, ou excepcional). ✅ Modelo recebido 2026-10-01 (`MODELO ABONO.pdf`).

### 7.1 Layout dos recibos (confirmado pelo RH)

Estrutura comum aos três modelos:

- **Cabeçalho**: logo California (urso), centralizado.
- **Título**: "RECIBO DE FÉRIAS" / "RECIBO DE ABONO" / (combinado — a definir).
- **Dados fixos da empresa**:
  - EMPRESA: `CALIFORNIA FILMES E PUBLICIDADE LTDA`
  - CNPJ: `19.437.976/0001-54`
- **Prestador de serviço**: nome completo do PJ.
- **Seção CÁLCULO**:
  - PERÍODO AQUISITIVO (ex.: 2024/2025)
  - PERÍODO PARA GOZO (férias) ou ABONO DE FÉRIAS (DIAS) (abono) — rótulo literal do PDF, mantido fiel ao original
  - VALOR BASE REMUNERAÇÃO (salário mensal do PJ)
  - Linha "FÉRIAS (N dias): R$ X" ou "ABONO (N dias): R$ X"
  - Linha "1/3 FÉRIAS: R$" ou "1/3 ABONO: R$"
  - TOTAL: R$
- **Seção RECIBO**:
  - "Recebi a importância de R$ X (X por extenso) correspondente a N dias de férias/abono."
  - Local e data (Cidade, DD de MÊS de AAAA)
  - Linha de assinatura com "Nome do Prestador"

### 7.2 Pendências de recibo

- **Pendente**: modelo do recibo **combinado** (férias + abono no mesmo documento). Precisa pedir pro RH — pode ser montagem simples das 2 seções no mesmo PDF.
- **Pendente de confirmação**: fonte da empresa emissora. Hoje a planilha mostra `CALIFORNIA FILMES E PUBLICIDADE LTDA` como emissora fixa. Precisamos confirmar se é sempre essa empresa, ou se varia conforme a alocação do colaborador (Ventura, Vibe, etc.).

## 8. Cálculo da rescisão (preview)

Reproduz a aba "Rescisão" do `calculo-recisão.xlsx`. Mesma estrutura para CLT e PJ. Sistema calcula, mostra pro RH revisar, gera recibo PJ, e gera título em `contas_avulsas`.

Fora do MVP de férias: **TotalPass** (vale-transporte, aba separada da planilha com planos TP1 a TP7) e **planos de saúde** (SulAmérica, Bradesco Dental) são descontos recorrentes do colaborador. Devem aparecer no cálculo final da rescisão como descontos, mas o cadastro dos benefícios é tema do subsistema "Benefícios" (ver `30-proximos-passos.md`).

## 9. Permissões e nova role `colaborador`

### 9.1 Decisão

Será criada uma nova role `colaborador`:
- Role **inicial** de todo usuário do sistema que seja colaborador ativo.
- Acesso **apenas** à página `/perfil` (nada de sidebar completa, nada de outros módulos).
- Pode: ver seus dados pessoais, ver suas férias (saldo + histórico + solicitar), ver seus holerites quando o módulo entrar.
- Não pode: ver dados de outros colaboradores, ver folha, ver orçamentos, nada.

### 9.2 Como `/perfil` muda por role

| Role                            | O que vê em `/perfil`                                                                 |
|---                              |---                                                                                    |
| `colaborador`                   | Página inteira = `/perfil`. Sem sidebar, só acesso ao próprio perfil.                 |
| `rh`, `administrador`, outros   | `/perfil` é o perfil dele mesmo, acessível pelo ícone no footer da sidebar. Sidebar continua funcional. |

### 9.3 Convite automático

Toda contratação efetivada hoje já cria um `tenant_members` ativo. Precisa:
- Garantir que o papel inicial é `colaborador` (não `membro` genérico).
- Convite por e-mail magic link já funciona (ver `20260923140001_rh_socio_e_campos_pessoais`).
- Opcional: fluxo de "primeiro acesso" com termo de uso. Fora do MVP.

### 9.4 Permissões por operação (férias)

| Operação                        | colaborador | líder direto | rh  | admin |
|---                              |:---:|:---:|:---:|:---:|
| Ver próprio saldo e histórico   | ✅  | ✅ (do liderado) | ✅  | ✅  |
| Ver saldo de outros             | ❌  | ✅ (dos liderados) | ✅  | ✅  |
| Solicitar férias próprias       | ✅  | ✅  | ✅  | ✅  |
| Aprovar/reprovar solicitação    | ❌  | ❌  | ✅  | ✅  |
| Lançar direto (sem fluxo)       | ❌  | ❌  | ✅  | ✅  |
| Cancelar solicitação própria    | ✅ (antes do início) | — | ✅  | ✅  |
| Alterar depois do início        | ❌  | ❌  | ✅  | ✅  |
| Gerar/baixar recibo             | ✅ (próprio) | ❌ | ✅  | ✅  |
| Calcular rescisão               | ❌  | ❌  | ✅  | ✅  |

RLS: todas as policies de leitura filtram por `colaborador_id = (select auth.uid())` pra role `colaborador`.

## 10. UI/UX

### 10.1 `/perfil` do colaborador

- Header: foto, nome, função, nível, tipo contratação, admissão.
- Card "Meus dados" (edição em drawer).
- Card "Dados bancários" (edição em drawer; alerta se PIX desatualizado).
- Card "**Minhas férias**":
  - Saldo total (número grande).
  - Status atual (badge colorido).
  - Lista dos períodos aquisitivos, cada um com dias usufruídos/pendentes e data-limite.
  - Botão "Solicitar férias" (ativo se há período apto).
  - Histórico de lançamentos (data início/fim, dias, status).
  - Lista de notificações pessoais (concessivo liberado, aprovada, etc.).

### 10.2 `/rh/ferias` (gestão RH)

Página principal do subsistema. Estrutura sugerida (vai detalhar em design):
- **KPIs no topo**: pendentes de aprovação, concessivos vencendo em 30d, férias vencidas sem regularização, colaboradores em férias hoje.
- **Tabs**:
  - **Solicitações** — fila de pendentes + histórico com filtros.
  - **Quadro geral** — espelho da aba "Controle de Férias" (uma linha por colaborador, saldo, status, períodos).
  - **Planejador** — timeline/calendário dos lançamentos aprovados.
  - **Notificações** — painel de alertas.
  - **Rescisões** — cálculos de saída pendentes.

Filtros globais: por empresa, regional, tipo contratação, status.

### 10.3 Padrões de UI (herdados)

- Mesma identidade visual do resto do ERP (shadcn/ui, vermelho California, cards com shadow-soft).
- `<ConfirmDialog>` pra cancelamentos e aprovações destrutivas.
- Drawer pra formulários de solicitação e aprovação.
- Combobox com busca pra escolha de colaborador em telas de RH (padrão herdado da sessão 2026-09-30).
- Linha inteira clicável em listas, ações secundárias com `stopPropagation`.

## 11. Modelagem (preview — detalhar em `03-modelo-de-dados.md` depois)

```
colaboradores_ferias_periodos
  id uuid pk
  tenant_id uuid fk
  colaborador_id uuid fk
  numero int                              -- 1, 2, 3... (ordem do aquisitivo)
  aquisitivo_inicio date
  aquisitivo_fim date
  concessivo_inicio date
  concessivo_fim date
  dias_direito int default 30
  status enum ('incompleto'|'apto'|'em_alerta'|'vencido'|
               'regularizado'|'nao_habilitado'|'pago_rescisao')
  created_at timestamptz
  unique (colaborador_id, numero)

colaboradores_ferias_lancamentos
  id uuid pk
  tenant_id uuid fk
  colaborador_id uuid fk
  periodo_id uuid fk nullable             -- null para abono avulso PJ
  tipo enum ('usufruto'|'abono_combinado'|'abono_avulso'|'abono_excepcional')
  data_inicio date
  data_fim date
  dias int
  status enum ('pendente_aprovacao'|'em_analise'|'aprovado'|
               'reprovado'|'cancelado'|'concluido')
  solicitado_por uuid fk
  aprovado_por uuid fk nullable
  motivo_reprovacao text nullable
  observacao text nullable
  lancado_direto_por_rh bool default false
  valor_ferias numeric(14,2) nullable     -- só PJ
  valor_um_terco numeric(14,2) nullable   -- só PJ
  valor_abono numeric(14,2) nullable      -- só PJ
  recibo_url text nullable                -- storage path
  conta_avulsa_id uuid fk nullable        -- link pro título gerado
  created_at timestamptz
  updated_at timestamptz

colaboradores_ferias_notificacoes
  id uuid pk
  tenant_id uuid fk
  tipo enum ('solicitacao'|'alteracao'|'cancelamento'|
             'lembrete'|'inicio'|'retorno'|'concessivo_liberado'|
             'emitir_nf'|'ferias_vencidas'|'aprovada'|'reprovada')
  colaborador_id uuid fk                  -- a quem se refere
  lancamento_id uuid fk nullable
  destinatario_user_id uuid fk            -- quem precisa ver
  payload jsonb                           -- detalhes contextuais
  lida_em timestamptz nullable
  criada_em timestamptz
```

Constraints importantes:
- `dias = (data_fim - data_inicio + 1)` validado em CHECK.
- Soma de `dias` por `periodo_id` nunca pode ultrapassar `dias_direito` (via trigger ou RPC).
- RLS: `colaborador` só vê linhas onde `colaborador_id = auth.uid()`.
- GRANT explícito pra `authenticated`.

A rescisão aproveita `contas_avulsas` já existente — não cria tabela nova.

## 12. Pendências abertas

**Status geral**: Todas as pendências bloqueantes foram resolvidas em 2026-10-01. Restam apenas 2 pontos pendentes de confirmação em D1 (modelo combinado de recibo + empresa emissora), que não bloqueiam a modelagem nem o fluxo — podem ser resolvidos durante a implementação.

### Resolvidas

- ~~**[P1]** Data-limite do primeiro concessivo pros recém-admitidos~~ → **Decidido (2026-10-01)**: aplica regra padrão CLT (admissão + 12m = fim do aquisitivo; + 12m = fim do concessivo). A data `2027-12-12` que aparecia na planilha é placeholder visual pra admitidos recentes, não é convenção real. Import ignora esse campo e recalcula.

- ~~**[P2]** Cálculo de meses na rescisão~~ → **Resolvido pelo RH (2026-10-01)**: regra dos **avós** — 12 avós por período aquisitivo; conta 1 avô se trabalhou ≥ 15 dias no mês. Detalhado em §4.7.

- ~~**[D2]** Antecedência mínima da solicitação~~ → **Decidido pelo RH (2026-10-01)**: **5 dias** entre a solicitação e a data de início das férias.

- ~~**[D3]** Alerta de concessivo vencendo~~ → **Decidido pelo RH (2026-10-01)**: **60 dias antes** do fim do concessivo.

- ~~**[D4]** Antecedência do aviso "PJ: emitir NF"~~ → **Decidido pelo RH (2026-10-01)**: **5 dias** antes do início do lançamento.

- ~~**[I1]** Notificação por e-mail~~ → **Decidido (2026-10-01)**: só in-app no MVP. E-mail fica para evolução futura.

- ~~**[I2]** TotalPass e planos de saúde na rescisão~~ → **Decidido (2026-10-01)**: ficam zerados no MVP de férias/rescisão. Viram tema do subsistema **Benefícios** (ver `30-proximos-passos.md`). Quando Benefícios for implementado, o cálculo de rescisão passa a puxar os descontos recorrentes do colaborador automaticamente.

- ~~**[I3]** Fluxo de primeiro acesso com termo de uso~~ → **Decidido (2026-10-01)**: não é necessário. Colaborador acessa direto via magic link.

### Ainda pendentes (não bloqueantes)

- **[D1-parcial]** Modelo de recibo PJ:
  - ✅ **Só férias** recebido 2026-10-01 (`_MODELO FÉRIAS.pdf`).
  - ✅ **Só abono** recebido 2026-10-01 (`MODELO ABONO.pdf`).
  - ⏳ **Férias + abono combinados**: ainda pendente — provavelmente é montagem das 2 seções no mesmo PDF, mas confirmar com RH.
  - ⏳ Empresa emissora: hoje aparece `CALIFORNIA FILMES E PUBLICIDADE LTDA` fixa. Confirmar se varia por empresa de alocação (Ventura, Vibe, etc.).

## 13. Fora de escopo do MVP

- Encargos CLT completos (INSS, IRRF do empregador) — contabilidade cuida.
- Holerite PDF do colaborador — depende do subsistema Folha concluído, outro tema.
- Integração com ponto eletrônico (não existe hoje).
- Cálculo de benefícios como VR/VA proporcionais nas férias — tema de Benefícios.
- Férias coletivas (fechamento de empresa inteira) — se virar necessidade, entra em evolução.

## 14. Decisões travadas (decision log do subsistema)

| # | Data       | Decisão                                                                               | Por quê                                       |
|---|---         |---                                                                                    |---                                            |
| F1 | 2026-10-01 | California não paga férias em dobro, nem CLT nem PJ                                 | Validação Kika — gestão impede o vencimento   |
| F2 | 2026-10-01 | PJ tem mesmas regras de CLT para férias (30 dias, concessivo 12m)                   | Política interna da California                |
| F3 | 2026-10-01 | PJ pode vender dias avulsos (até 10) separados do bloco de férias                   | Prática já em uso na planilha                 |
| F4 | 2026-10-01 | CLT: recibo vem da contabilidade; PJ: sistema calcula e gera recibo                 | Divisão operacional atual                     |
| F5 | 2026-10-01 | Criar role `colaborador` com acesso só a `/perfil`                                  | Autoserviço de solicitação de férias         |
| F6 | 2026-10-01 | Solicitação é feita pelo próprio colaborador; aprovação é do RH (líder só é notificado) | Decisão arquitetural simples e auditável   |
| F7 | 2026-10-01 | Notificações in-app no MVP; e-mail depois se necessário                             | Reduzir escopo inicial                        |
| F8 | 2026-10-01 | Rescisão aproveita `contas_avulsas` existente, não cria tabela nova                 | Reusar motor financeiro já consolidado        |
| F9 | 2026-10-01 | TotalPass e planos de saúde ficam zerados no MVP; viram tema de Benefícios          | Separação limpa de escopo                     |
| F10 | 2026-10-01 | Sem fluxo de primeiro acesso com termo — magic link direto                         | Simplicidade; sem exigência jurídica atual    |
| F11 | 2026-10-01 | Regra padrão CLT para aquisitivo/concessivo (12m + 12m). Data 2027-12-12 na planilha é placeholder | Confirmado por análise + ausência de convenção interna |
| F12 | 2026-10-01 | Rescisão usa "avós": 12 avós/período; conta avô se trabalhou ≥ 15 dias no mês     | Prática atual do RH (Mari/Maria)              |
| F13 | 2026-10-01 | Antecedência mínima da solicitação: 5 dias                                         | Prática atual do RH                           |
| F14 | 2026-10-01 | Alerta "concessivo em alerta": 60 dias antes do vencimento                         | Prática atual do RH                           |
| F15 | 2026-10-01 | Aviso "PJ emitir NF": 5 dias antes do início do lançamento                         | Prática atual do RH                           |

## 15. Próximos passos

1. **Fechar pendências de §12 com RH** (reunião curta, estimativa 30min).
2. **Pedir modelos de recibo PJ atuais** pra desenhar o PDF-gerador.
3. **Escrever `03-modelo-de-dados.md` atualizado** com as 3 tabelas novas, policies, GRANTs, triggers.
4. **Esboçar wireframes** de `/perfil` (card de férias) e `/rh/ferias` (as 5 tabs).
5. **Fatiar em migrations incrementais** (seguindo `docs/FLUXO-BANCO.md`):
   - Migration 1: `colaboradores_ferias_periodos` + geração automática dos períodos pros 209 ativos.
   - Migration 2: `colaboradores_ferias_lancamentos` + `colaboradores_ferias_notificacoes` + enums + policies.
   - Migration 3: triggers de recálculo de saldo e geração de notificações automáticas.
6. **Importar histórico** de lançamentos da planilha pra `colaboradores_ferias_lancamentos` (equivalente ao que já fizemos com salários e banco).
7. **Implementar `/perfil` + role `colaborador`** antes de qualquer tela de RH (porque a role é fundação).
8. **Implementar `/rh/ferias`** com as 5 tabs, começando por "Solicitações" (fila MVP).
9. **Gerador de recibo PJ** (3 templates).
10. **Rescisão** — última peça, encosta em `contas_avulsas`.

## 16. Fontes

- `tmp/Controle e Planejamento de Férias - Agência California 2026.xlsx` (planilha atual da Kika).
- `tmp/calculo-recisão.xlsx` (fórmulas de rescisão em uso).
- Validação com Kika (RH) em 2026-10-01 via chat da sessão.
- CLT arts. 129-153 (férias) e 142-144 (abono pecuniário).
- `docs/FLUXO-BANCO.md` (ciclo migration → aplicação → verificação).
- `docs/09-identidade-visual-ui.md` (padrões de UI).
