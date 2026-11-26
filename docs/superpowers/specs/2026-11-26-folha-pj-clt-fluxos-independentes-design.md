# Folha mensal: PJ e CLT em fluxos independentes

**Data:** 2026-11-26
**Status:** Design proposto
**Escopo:** Reorganizar a página `/rh/folhas/[competencia]` em dois cards independentes (PJ e CLT), cada um com seu próprio ciclo de atualização e envio ao financeiro. Embutir "Aplicar benefícios" como passo interno do "Enviar PJ" (zero botão dedicado). CLT perde o checkpoint de benefícios (não tem desconto no sistema).

## Contexto

Hoje a página `/rh/folhas/[competencia]` tem **um bloco agregado** com 3 checkpoints sequenciais (`checklist-competencia.tsx`): PJ gerada → CLT importada → Benefícios aplicados. Um único botão **"Enviar ao financeiro"** só libera quando os 3 estão verdes — envia PJ+CLT juntos, numa só ação.

Esse desenho acopla os dois fluxos a um ritmo que não bate com a realidade operacional:

- **PJ sai cedo** (gerada no sistema a partir da Camada 1).
- **CLT vem tarde** (arquivo importado da contabilidade, chega dias depois).

A Kika precisa esperar a CLT da contabilidade pra poder liberar o pagamento dos PJ. Isso atrasa o pagamento de 15–30 pessoas desnecessariamente.

Além do timing, o fluxo atual tem uma assimetria escondida: **benefícios só descontam linha PJ** (ADR 174). A linha CLT já vem líquida da contabilidade (o desconto do colaborador já foi aplicado antes do arquivo ser gerado). Colocar "Benefícios aplicados" como um 3º checkpoint que trava o envio CLT sugere que CLT depende de benefícios, mas CLT não depende de nada — poderia ir pro financeiro assim que importada.

## Problema

- **Timing travado:** PJ espera CLT que espera contabilidade. Fluxo serializado artificialmente.
- **Botão de benefícios desnecessário:** o passo "Aplicar benefícios" é obrigatório mas sempre feito, sempre no mesmo lugar do fluxo. É cerimônia; poderia ser efeito colateral do "Enviar PJ".
- **CLT com checkpoint que não é dela:** "Benefícios aplicados" trava o envio CLT, mas benefícios não tocam linha CLT — é prerequisito falso.

## Objetivo

Separar fisicamente PJ e CLT em dois cards independentes, cada um com seu próprio botão **"Enviar ao financeiro"**. Embutir a aplicação de benefícios + geração de avulsas de operadora como passos invisíveis do "Enviar PJ" (sem checkpoint, sem botão extra). CLT fica com um fluxo curto (importar → enviar), sem passar por benefícios.

## Não-objetivos

- Não mudar o modelo de dados de `folhas_pagamento`, `beneficio_fechamento_mensal`, `contas_avulsas`. Zero migration de schema.
- Não mudar as RPCs `aplicar_fechamento_beneficios`, `gerar_avulsas_fechamento_beneficios`. Elas já são idempotentes e cobrem o fluxo novo. Mudança é só em quem/quando chama.
- **Exceção:** `desaplicar_fechamento_beneficios` ganha uma precondição nova (trava se linha PJ já saiu de rascunho). Migration aditiva, sem impacto em dados existentes. Ver §"Mudança no RPC `desaplicar_fechamento_beneficios`" abaixo.
- Não mudar a aba "Folhas de Pagamento" em `/financeiro/contas-a-pagar`. Linhas continuam chegando lá do mesmo jeito; só chegam em dois momentos diferentes (PJ primeiro, CLT depois).
- Não introduzir "folha PJ" e "folha CLT" como entidades separadas no banco. Continua sendo uma folha por competência, com `origem` distinguindo as linhas.
- Não mudar reconciliação com fatura real da operadora (ADR 174 §5 continua: Daniel edita avulsa à mão se vier diferente).

## Anti-objetivos

- **Fragmentar avulsas da operadora em "parte PJ" e "parte CLT".** A fatura real da SulAmérica/Bradesco é corporativa única (PJ+CLT juntos). Gerar 2 avulsas por operadora (= 4 avulsas/mês) só pra espelhar o split interno quebra a reconciliação com a fatura real e multiplica títulos a pagar sem motivo.
- **Permitir enviar PJ sem aplicar benefícios ou enviar sem confirmação.** Benefícios continuam obrigatórios pra PJ — só deixam de ser um clique separado.
- **Deixar "Atualizar" rodar sobre linhas já enviadas.** Atualização só mexe em rascunho. Correção pós-envio continua pelo drawer linha a linha (fluxo atual).

## Abordagens consideradas

### A. Dois cards, benefícios só no card PJ (recomendada)

Divide o bloco atual em dois cards lado a lado. Card PJ tem gerar/atualizar/enviar. Card CLT tem importar/atualizar/enviar. "Enviar PJ" é uma transação que roda `aplicar_fechamento_beneficios` (se ainda não rodou) + `gerar_avulsas_fechamento_beneficios` + marca linhas PJ como `enviada`. CLT não dispara benefícios.

Edge case único: CLT enviada antes de PJ (raro). CLT vai sozinha pro financeiro; o snapshot de benefícios fecha quando PJ for enviada. A fatura cheia continua correta (snapshot soma vínculos ativos independente de origem da folha, isso é o que `fn_beneficios_calcular_fechamento` já faz).

- Prós: fluxo honesto (CLT não "tem" nada pra fazer com benefícios), mínimo cognitive load (2 botões por card no total), zero mudança de schema, 1 avulsa cheia por operadora (reconcilia com fatura real 1:1).
- Contras: "benefícios" some da UI como conceito explícito — fica só no texto de confirmação do Enviar PJ e no detalhe do card. Precisa comunicar bem na preview do que vai acontecer.

### B. Dois cards, botão "Aplicar benefícios" nos dois lados (snapshot compartilhado)

Mesmo que A, mas mantém "Aplicar benefícios" como checkpoint visível nos dois cards. Clicar em qualquer um aplica a competência inteira; o outro vira "☑ aplicado".

- Prós: mais explícito ("tem um passo de benefícios").
- Contras: botão duplicado que faz a mesma coisa confunde; 3 cliques por card; o botão no card CLT é cosmético (CLT não é afetada pelo desconto). Mantém a cerimônia que A elimina.

### C. Dois snapshots independentes (um por origem)

Cada card fecha seu próprio snapshot. Card PJ desconta PJ + gera avulsa com a porção PJ de cada operadora. Card CLT não desconta + gera avulsa com a porção CLT.

- Prós: cards totalmente autônomos, cada um "dono" dos seus benefícios.
- Contras: **duplica avulsas** (2 por operadora, uma PJ-share + uma CLT-share). Quebra reconciliação com a fatura real (que é cheia). Exige mudar schema (snapshot passa a ter dimensão `origem`), mudar RPCs, mudar view de DRE. Alto custo pra resolver um problema que A já resolve sem schema change.

### D. Benefícios como terceiro card separado

Mantém 1 card por folha (PJ e CLT) + card dedicado "Benefícios da competência" lado a lado.

- Prós: desacopla benefícios de ambas as folhas; cada um no seu ritmo.
- Contras: 3 cards competindo por atenção; volta a ter o botão "Aplicar benefícios" explícito que A eliminou; aumenta cognitive load. "Benefícios" não é uma coisa autônoma da Kika — é consequência do fechamento da folha.

### Escolha: A

Resolve o problema de timing (PJ e CLT independentes) e elimina cerimônia (benefícios some como etapa visível). Zero migration. Único trade-off (benefícios some da UI como conceito) é mitigado por preview claro no "Enviar PJ".

## Design

### UI: `/rh/folhas/[competencia]`

Substitui o bloco único `ChecklistCompetencia` por dois componentes irmãos: `CardFolhaPJ` e `CardFolhaCLT`, lado a lado em `grid grid-cols-1 md:grid-cols-2 gap-4`.

**`CardFolhaPJ`** (`app/(app)/rh/folhas/_components/card-folha-pj.tsx`)

```
┌─ Folha PJ · Outubro/2026 ──────────────────────┐
│ 15 linhas · R$ 180.000 bruto                   │
│ Benefícios previstos: −R$ 54.200 (aplicados no │
│   Enviar)                                       │
│                                                 │
│ Status: 12 rascunho · 3 pendentes correção     │
│                                                 │
│ [Atualizar folha PJ]  [Enviar PJ ao fin. →]    │
└─────────────────────────────────────────────────┘

Depois do Enviar (snapshot aplicado):
┌─ Folha PJ · Outubro/2026 ──────────────────────┐
│ 15 linhas · R$ 180.000 bruto − R$ 54.200 benef │
│   = R$ 125.800 líquido                         │
│ ✓ Benefícios aplicados · 2 avulsas geradas     │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

Decisão de UX: enquanto o snapshot não foi aplicado, o card mostra **bruto + linha separada de "benefícios previstos"**. Não mostra "líquido estimado" riscando o bruto, porque o `salario_base` no banco ainda é o bruto e isso seria enganar visualmente. Só depois do Enviar (quando `desconto_beneficios > 0` nas linhas) o card mostra o líquido efetivo.

**`CardFolhaCLT`** (`app/(app)/rh/folhas/_components/card-folha-clt.tsx`)

```
┌─ Folha CLT · Outubro/2026 ─────────────────────┐
│ 32 linhas rascunho · R$ 240.000 líquido        │
│ (já vem descontado da contabilidade)           │
│                                                 │
│ Status: 32 rascunho                            │
│                                                 │
│ [Reimportar arquivo]  [Enviar CLT ao fin. →]   │
└─────────────────────────────────────────────────┘
```

Regras visuais:
- Cards usam `rounded-2xl border border-border bg-card p-5 shadow-soft` (padrão do projeto).
- Quando não há linhas na origem (folha ainda não gerada/importada), o card mostra CTA grande no centro: "Gerar folha PJ" ou "Importar folha CLT".
- Quando todas as linhas da origem já foram enviadas E nenhuma está em `pendente_correcao`, o card mostra "✓ Enviada ao financeiro" com data e link "Ver no financeiro →".
- Botão "Atualizar" / "Reimportar" só habilitado se houver pelo menos 1 linha rascunho (ou nenhuma linha — permite gerar/importar). Se tudo já foi enviado, botão some.
- Botão "Enviar" habilitado se houver linha em `rascunho` ou `pendente_correcao` (ambos são estados "editáveis pelo RH").

Rodapé consolidado embaixo dos dois cards: só aparece quando **nenhuma linha está em `rascunho` ou `pendente_correcao`** em nenhuma das duas origens. Mostra "Competência enviada · 47 linhas · R$ Y total · Ver em `/financeiro/contas-a-pagar` →". Enquanto houver linha pendente de correção em qualquer lado, o rodapé não aparece (seria mentira dizer "enviada").

### Server actions

**Arquivo novo:** `app/(app)/rh/folhas/envio-actions.ts` — separa envio de `importar-actions.ts` (que trata upload e geração) pra deixar escopos claros. Ambos ficam no mesmo diretório.

**`enviarFolhaPJ({ ano, mes })`**

Fluxo:
1. Valida permissão (admin ou RH).
2. Busca `beneficio_fechamento_mensal` vigente da competência (`reaberto_em is null`).
3. **Se não existir snapshot:** chama `aplicar_fechamento_beneficios(tenant, ano, mes)`.
   - Se der `nenhum_vinculo_ativo` → **trata como caso OK** (tenant sem benefícios cadastrados / sem vínculos no mês): pula passo 4, segue direto pro 5 e envia PJ sem avulsas de operadora. Audit sinaliza `beneficios: 'sem_vinculos'`.
   - Se der `catalogo_incompleto: X` → erro propagado com mensagem amigável.
   - Outros erros → mensagem genérica + log.
4. **Se o snapshot existe (ou acabou de ser criado):** chama `gerar_avulsas_fechamento_beneficios(fechamento_id)`. Idempotente — retorna as avulsas (novas ou pré-existentes).
5. Promove linhas `folhas_pagamento` dessa competência com `origem='california'` e `status in ('rascunho', 'pendente_correcao')` para `status='enviada'`, `enviada_em=now()`, `enviada_por=auth.uid()`. Linhas em `pendente_correcao` têm `motivo_pendencia` limpo (mas mantido no audit).
6. Log audit `folha_competencia.enviada` com metadata `{ competencia, origem: 'california', linhas: N, fechamento_id, avulsas: [...] }`.
7. `revalidatePath(/rh/folhas/${yyyy-mm})` + `revalidatePath(/financeiro/contas-a-pagar)`.
8. Retorna `{ ok: true, linhasEnviadas, fechamentoId, avulsas: [{ id, operadora, valor }] }`.

Erros propagados ao cliente:
- `catalogo_incompleto: X` → "Catálogo de benefícios está incompleto: X. Edite em /rh/beneficios → Catálogo antes de enviar."
- `competencia_ja_aplicada` → não dispara (passo 3 só chama se snapshot não existe).
- Nenhuma linha elegível PJ → "Não há linha PJ para enviar (rascunho ou pendente de correção)."

**`enviarFolhaCLT({ ano, mes })`**

Fluxo:
1. Valida permissão.
2. Promove linhas `folhas_pagamento` dessa competência com `origem='contabilidade'` e `status in ('rascunho', 'pendente_correcao')` para `status='enviada'`, limpando `motivo_pendencia`.
3. Log audit `folha_competencia.enviada` com metadata `{ competencia, origem: 'contabilidade', linhas: N }`.
4. Revalidate paths.
5. Retorna `{ ok: true, linhasEnviadas }`.

Sem interação com benefícios.

**Decisão sobre `pendente_correcao`:** o botão agregado "Enviar PJ" / "Enviar CLT" promove tanto `rascunho` quanto `pendente_correcao`, pra alinhar com o `enviarLinhaFolha` individual que já aceita os dois. Evita obrigar a Kika a reenviar linha por linha no drawer depois de corrigir várias.

**A action antiga `enviarCompetencia(ano, mes)`** fica obsoleta. Remover (hoje em `app/(app)/rh/folhas/importar-actions.ts`; único caller é `ModalEnviarFinanceiro`, que também vai embora).

**Nome do evento de audit:** mantém `folha_competencia.enviada` (como já existe hoje em `importar-actions.ts`), só adicionando `origem` ao metadata. Renomear quebraria filtros/timeline históricos.

### Preview de confirmação (modal)

Substituir `modal-enviar-financeiro.tsx` por dois modais ou um modal parametrizado por origem.

**Modal "Enviar PJ"** (quando benefícios ainda não aplicado):
```
Enviar folha PJ de Outubro/2026 ao financeiro?

Isso vai, em uma única transação:
• Fechar a competência de benefícios
• Descontar R$ 54.200 das linhas PJ (benefícios)
• Gerar avulsa SulAmérica R$ 110.500 (vence 05/12/2026)
• Gerar avulsa Bradesco Dental R$ 962 (vence 29/11/2026)
• Enviar 15 linhas PJ para aprovação do financeiro

Após enviar, correções exigem desaplicar benefícios (se nenhuma avulsa paga).

[Cancelar]  [Enviar]
```

**Modal "Enviar PJ"** (quando benefícios já aplicado):
```
Enviar folha PJ de Outubro/2026 ao financeiro?

Isso vai:
• Enviar 15 linhas PJ para aprovação do financeiro

(Benefícios já foram aplicados.)

[Cancelar]  [Enviar]
```

**Modal "Enviar CLT"**:
```
Enviar folha CLT de Outubro/2026 ao financeiro?

Isso vai:
• Enviar 32 linhas CLT para aprovação do financeiro

[Cancelar]  [Enviar]
```

Valores dos benefícios no primeiro modal vêm de `previsualizarAplicacao(tenant, ano, mes)` que já existe (chama `fn_beneficios_calcular_fechamento` sem gravar).

### Queries

A query atual é inline no server component `[competencia]/page.tsx` (hidrata linhas + alocações + férias + NFs + rateio + fechamento + avulsaPaga). **Não refatorar a query inteira** — risco alto de regressão no cálculo de dias de férias e rateio Hub/regional.

**Em vez disso:** adicionar um helper específico `obterResumoCardsFolha(tenant, ano, mes)` em `lib/queries/folhas-resumo.ts` (arquivo novo), que roda **em paralelo com a query atual** e devolve só o shape que os dois cards precisam. O server component compõe os dois.

Shape de `obterResumoCardsFolha`:

```ts
{
  pj: {
    linhasRascunho: number;
    linhasEnviadas: number;
    linhasAprovadas: number;
    linhasPagas: number;
    linhasPendentesCorrecao: number;
    totalBruto: number;           // soma de salario_base + desconto_beneficios
    totalLiquido: number;         // soma de salario_base
    totalDescontoBeneficios: number;
    previewDescontoBeneficios: number | null;  // só se snapshot não aplicado
  };
  clt: {
    linhasRascunho: number;
    linhasEnviadas: number;
    linhasAprovadas: number;
    linhasPagas: number;
    linhasPendentesCorrecao: number;
    totalLiquido: number;          // salario_base (CLT não tem desconto no sistema)
  };
  beneficios: {
    aplicado: boolean;
    fechamentoId: string | null;
    avulsasGeradas: boolean;       // true se gerar_avulsas já rodou
    avulsaPaga: boolean;
    qtdVinculos: number;
    totalEmpresa: number;
    totalColaborador: number;
    totalIntegral: number;
    catalogoIncompleto: string | null;  // nome do benefício inválido, pra pré-aviso no card PJ
  };
}
```

**Pré-validação de catálogo:** para evitar o usuário descobrir o erro só ao clicar "Enviar PJ", o helper roda uma check leve: se existir `beneficios.ativo = true` sem `fornecedor_id`/`empresa_id`/`dia_vencimento_fatura`/`regional_id` preenchidos, devolve o nome em `catalogoIncompleto`. O card PJ mostra alerta visível ("Catálogo de benefícios incompleto: X. Edite em /rh/beneficios → Catálogo antes de enviar.") e desabilita o botão Enviar.

Esse helper substitui o que hoje alimenta `ChecklistCompetencia`.

### Botão "Desaplicar benefícios"

Fica acessível mas discreto. Lugar sugerido: dentro do card PJ, como um link "Desaplicar benefícios desta competência" no rodapé do card, só visível se:
- `beneficios.aplicado = true`
- `beneficios.avulsaPaga = false`
- Usuário é admin ou RH

Comportamento inalterado (chama `desaplicarBeneficios`). Depois de desaplicar, as linhas PJ voltam ao valor bruto, avulsas são apagadas, e Kika pode rodar "Atualizar folha PJ" pra pegar colaboradores novos (ou editar à mão) e enviar de novo.

**Importante:** desaplicar não cancela o envio das linhas PJ se elas já foram enviadas. Se a Kika desaplicar com linhas PJ já `enviada`/`aprovada`/`paga`, o `salario_base` volta ao bruto nelas também — isso quebra a aprovação do financeiro. Precisamos travar: `desaplicar_fechamento_beneficios` só roda se **nenhuma linha PJ** dessa competência estiver em estado diferente de `rascunho`. Isso cobre `enviada`, `aprovada`, `paga` **e** `pendente_correcao` (nesse último, a linha já saiu pro financeiro e voltou — o `salario_base` descontado já foi analisado, reverter por baixo é perigoso).

Isso é uma **mudança comportamental** no RPC atual: hoje o RPC só checa `avulsa_ja_paga`. Precisa adicionar check `folha_pj_ja_enviada`.

### Audit

Eventos mantidos (nomes atuais):
- `beneficio.fechamento.aplicado` — emitido dentro de `enviarFolhaPJ` quando snapshot é criado.
- `beneficio.fechamento.desaplicado` — emitido quando Kika clica "Desaplicar".
- `folha_competencia.enviada` (já existe em `importar-actions.ts`) — continua sendo o evento agregado; ganha campo `origem` no metadata (`california` ou `contabilidade`) para distinguir os dois envios.
- `folha.linha.enviada` (já existe) — continua por linha, inalterado.

Nenhum nome de evento renomeado (preserva filtros/timeline já em uso).

### Mudança no RPC `desaplicar_fechamento_beneficios`

Nova precondição (bloqueia todos os estados não-rascunho — ver justificativa acima):

```sql
if exists (
  select 1 from public.folhas_pagamento
   where competencia_ano = v_f.ano
     and competencia_mes = v_f.mes
     and origem = 'california'
     and status <> 'rascunho'
) then
  raise exception 'folha_pj_ja_enviada';
end if;
```

Mensagem no client:
> "Não dá pra desaplicar: a folha PJ dessa competência já foi enviada ao financeiro. Para corrigir, use o drawer linha a linha ou peça pro financeiro reprovar as linhas afetadas."

Migration aditiva: `20261126HHMMSS_desaplicar_beneficios_trava_folha_enviada.sql`. Zero impacto em dados existentes (não há competência em prod onde esse estado ocorra; validar via MCP antes de aplicar).

## Arquivos afetados

**Novos:**
- `app/(app)/rh/folhas/_components/card-folha-pj.tsx`
- `app/(app)/rh/folhas/_components/card-folha-clt.tsx`
- `app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx`
- `app/(app)/rh/folhas/_components/modal-enviar-folha-clt.tsx`
- `app/(app)/rh/folhas/envio-actions.ts` — contém `enviarFolhaPJ` e `enviarFolhaCLT`.
- `lib/queries/folhas-resumo.ts` — contém `obterResumoCardsFolha`.
- `supabase/migrations/20261126HHMMSS_desaplicar_beneficios_trava_folha_enviada.sql`

**Modificados:**
- `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx` (ou `page.tsx`) — substitui `<ChecklistCompetencia>` por `<CardFolhaPJ>` + `<CardFolhaCLT>` em grid; chama `obterResumoCardsFolha` em paralelo com a query atual.
- `app/(app)/rh/folhas/importar-actions.ts` — remove `enviarCompetencia` (hoje mora aqui).
- `lib/types.ts` — adiciona tipos novos para o resumo e retornos das actions.
- `app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx` — adiciona tratamento do erro novo `folha_pj_ja_enviada`.

**Removidos:**
- `app/(app)/rh/folhas/_components/checklist-competencia.tsx`
- `app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx` (aplicação vira interna do enviarFolhaPJ)
- `app/(app)/rh/folhas/_components/modal-enviar-financeiro.tsx` (substituído pelos 2 modais novos)

**Possivelmente adaptado:**
- `app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx` — passa a mostrar mensagem de erro nova (`folha_pj_ja_enviada`); tratar no switch de erros.

## Verificação pós-implementação

- [ ] Gerar PJ de uma competência limpa, clicar "Enviar PJ" → snapshot criado + salário PJ descontado + 2 avulsas em `/financeiro/contas-a-pagar` + 15 linhas PJ como `enviada`.
- [ ] Imediatamente depois, importar CLT e clicar "Enviar CLT" → só as linhas CLT viram `enviada`; snapshot não é tocado (não cria avulsa duplicada).
- [ ] Importar CLT antes do PJ → "Enviar CLT" funciona (envia linhas CLT); `/financeiro/contas-a-pagar` não tem avulsa de operadora ainda; enviar PJ depois → avulsas aparecem.
- [ ] Após "Enviar PJ", tentar desaplicar benefícios → erro `folha_pj_ja_enviada` com mensagem clara.
- [ ] Antes de "Enviar PJ", desaplicar → funciona (reverte salário PJ, apaga snapshot se não tiver avulsa).
- [ ] Após "Enviar PJ" e "Enviar CLT", voltar a `/rh/folhas/[competencia]` → ambos cards mostram "✓ Enviada ao financeiro", rodapé mostra resumo consolidado.
- [ ] `/financeiro/contas-a-pagar` → aba Folhas de Pagamento lista PJ+CLT juntos (como hoje); aba Avulsas tem 2 novas.
- [ ] Preview do modal "Enviar PJ" mostra valores corretos antes de confirmar.
- [ ] `tsc`, `lint`, `build` limpos.

## Fora do escopo desta mudança

- Permitir rever/cancelar envio por conta própria. Correção pós-envio continua pelo drawer linha a linha ou pelo fluxo de reprovar no financeiro → voltar pra RH.
- Permitir configurar ordem de aparição dos cards (PJ sempre à esquerda).
- "Enviar PJ parcialmente" (só algumas linhas). Continua sendo tudo-ou-nada por origem.
- Mudar como o financeiro aprova (`/financeiro/contas-a-pagar` → aba Folhas de Pagamento) — segue linha a linha como hoje.
- Notificar o financeiro automaticamente. Daniel vê quando entrar no sistema (como hoje).

## Decisões abertas para o builder

Nenhuma. Builder check rodado em 2026-11-26 e todas as 10 dúvidas levantadas foram absorvidas no doc (ver seção "Nota do builder check" abaixo).

## Nota do builder check (2026-11-26)

O builder check levantou 10 pontos. Nenhum exigiu decisão do usuário; todos resolvidos aqui com decisão documentada:

1. **RPC `desaplicar` muda, não só a chamada** → Não-objetivos ajustado para citar a exceção.
2. **Snapshot depois de CLT já enviada** → `aplicar_fechamento_beneficios` só toca `origem='california'` no UPDATE de salário; CLT já enviada/aprovada fica intocada. Fluxo funciona.
3. **Preview de salário descontado antes do Enviar** → Card mostra bruto + linha "benefícios previstos" separada. Não finge que já está descontado.
4. **`pendente_correcao` no envio agregado** → Botão "Enviar PJ"/"Enviar CLT" promove `rascunho` **e** `pendente_correcao`.
5. **`lib/queries/folhas.ts` não existe** → Query atual inline em `page.tsx` fica; adiciona helper `lib/queries/folhas-resumo.ts` em paralelo, sem refatorar o legado.
6. **Rodapé "enviada" mente com `pendente_correcao`** → Só aparece quando nenhuma linha está em `rascunho` **nem** `pendente_correcao` nas duas origens.
7. **Catálogo incompleto descoberto só no modal** → Helper devolve `catalogoIncompleto` no shape; card PJ mostra alerta e desabilita Enviar.
8. **Tenant sem benefícios cadastrados** → `nenhum_vinculo_ativo` tratado como caso OK no `enviarFolhaPJ` (segue sem gerar avulsa).
9. **Localização do arquivo de action** → Novo `app/(app)/rh/folhas/envio-actions.ts` (ao lado de `importar-actions.ts`).
10. **Nome do audit event** → Mantém `folha_competencia.enviada`, só adiciona `origem` no metadata.
