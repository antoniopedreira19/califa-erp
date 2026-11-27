# Aplicar benefícios como passo separado do card PJ

**Data:** 2026-11-27
**Status:** Design proposto
**Escopo:** Reverter uma decisão da feature anterior ([`2026-11-26-folha-pj-clt-fluxos-independentes-design.md`](2026-11-26-folha-pj-clt-fluxos-independentes-design.md)): "Aplicar benefícios" volta a ser um botão/passo explícito no card PJ, e os valores da tabela de folha abaixo passam a refletir o desconto imediatamente após a aplicação. CLT segue inalterada. Todas as mudanças ficam contidas na área de folha PJ.

## Contexto

Na feature anterior, embutimos a aplicação de benefícios como efeito colateral invisível do botão "Enviar PJ ao financeiro". A justificativa era simplicidade ("um clique só, benefícios é cerimônia"). A operação real da Kika mostrou que isso quebra duas necessidades:

1. **Ver a folha com os descontos aplicados antes de enviar.** Hoje a tabela mostra o `salario_base` que, até o Enviar, é o bruto. Kika quer revisar os valores que vão ser realmente pagos — ou seja, pós-desconto — sem precisar enviar primeiro.
2. **Saber quem teve desconto.** Com benefícios embutido no Enviar, não há sinalização por colaborador até depois do envio. Kika quer identificar visualmente, na lista, quais colaboradores saíram com benefício deduzido naquela competência.

## Problema

- Tabela da folha mostra só bruto até o Enviar; impossível revisar valores finais sem atravessar a fronteira RH→Financeiro.
- Nenhum indicador por linha de quem teve desconto aplicado.
- O usuário quer separar o fluxo em passos observáveis: gerar → aplicar → conferir → enviar.

## Objetivo

Restaurar "Aplicar benefícios" como passo explícito dentro do card PJ. Depois de aplicado, a tabela da folha mostra o `salario_base` já reduzido e cada linha PJ com `desconto_beneficios > 0` ganha um badge "Benefícios −R$ X" ao lado do valor.

As avulsas da operadora (SulAmérica + Bradesco Dental) **continuam sendo criadas no Enviar PJ** — nunca na aplicação. Isso preserva o princípio "financeiro só vê quando Kika confirma envio".

## Não-objetivos

- Não mudar CLT em nada. CLT não tem desconto no sistema, segue com fluxo curto (importar → enviar).
- Não mudar as RPCs `aplicar_fechamento_beneficios`, `gerar_avulsas_fechamento_beneficios`, `desaplicar_fechamento_beneficios`. Já são idempotentes e cobrem o fluxo novo.
- Não mudar o modelo de dados (`folhas_pagamento`, `beneficio_fechamento_mensal`). Zero migration de schema.
- Não reintroduzir o `ChecklistCompetencia` ou a action `enviarCompetencia` (removidos na feature anterior).
- Não criar um botão "Aplicar benefícios" global (fora do card). O botão vive dentro do card PJ, ao lado de "Atualizar".
- Não permitir editar `salario_base` de linha PJ enquanto o fechamento está aplicado (ver decisão D3).

## Anti-objetivos

- **Criar avulsas no "Aplicar benefícios".** Isso faz com que o financeiro veja títulos antes da folha PJ ser confirmada — Daniel pode pagar a operadora antes da Kika acabar o trabalho dela. Avulsas continuam exclusivas do Enviar.
- **Permitir Enviar PJ sem benefícios aplicados.** O botão Enviar fica bloqueado até o checkpoint benefícios estar verde (mesmo quando `nenhum_vinculo_ativo` — nesse caso o checkpoint vira "✓ Sem vínculos nesta competência" + Enviar liberado).
- **Mostrar o desconto na linha CLT.** Informação que o sistema não controla; divergiria da fatura real.

## Abordagens consideradas

### A. Aplicar benefícios tudo-em-um (snapshot + desconto + avulsas), Enviar só manda linhas

Clicar Aplicar roda `aplicar_fechamento_beneficios` + `gerar_avulsas_fechamento_beneficios`. Enviar só promove linhas rascunho → enviada.

- Prós: um clique só na transição que afeta o banco.
- Contras: **avulsas aparecem no `/financeiro/contas-a-pagar` antes do Enviar PJ**. Daniel pode pagar a operadora sem a Kika ter confirmado a folha. Quebra o princípio do portão único RH→Financeiro.

### B. Aplicar faz snapshot + desconto; Enviar cria avulsas + promove linhas (recomendada)

Clicar Aplicar roda só `aplicar_fechamento_beneficios`. Clicar Enviar roda `gerar_avulsas_fechamento_beneficios` + UPDATE linhas → enviada, tudo numa transação.

- Prós: financeiro só vê tudo (folha + avulsas) no mesmo instante do Enviar. Desaplicar permanece 100% reversível enquanto Kika está trabalhando — nunca há risco de avulsa já paga.
- Contras: Kika precisa clicar 3 vezes no total (gerar → aplicar → enviar). Praticamente a mesma coisa que a feature original tinha com checkpoint.

### C. Aplicar faz tudo em status "rascunho" invisível; Enviar "aprova" avulsas e manda linhas

Snapshot + desconto + cria avulsas com status interno "rascunho" (não aparecem em contas a pagar até promovidas). Enviar promove avulsas e envia linhas.

- Prós: todo o trabalho persistido logo após Aplicar.
- Contras: cria uma nova camada de estado no `contas_avulsas` (hoje a tabela não tem conceito de "avulsa rascunho"). Mudança de schema e de telas do financeiro. Muito alto custo pra resolver um problema que B já resolve.

### Escolha: B

Restaura o passo observável sem violar o portão RH→Financeiro. Zero migration. Mudança é só na UI + na divisão de responsabilidades entre `aplicarBeneficios` (já existe, só reativar na UI) e `enviarFolhaPJ` (remove a aplicação inline, mantém geração de avulsas).

## Design

### Card PJ: 3 estados funcionais

O card PJ tem agora 3 estados principais, baseados em dois booleans: `temLinhasPJ` (linhas PJ existem na competência) e `beneficiosAplicado` (snapshot vigente existe).

**Estado 1 — Não gerado** (`!temLinhasPJ`):
- CTA grande "Gerar PJ".
- Sem checkpoints visíveis.

**Estado 2 — Gerado, benefícios não aplicados** (`temLinhasPJ && !beneficiosAplicado`):
- Resumo: "N linhas · R$ bruto"
- Linha abaixo: "Benefícios previstos: −R$ X (clique Aplicar pra descontar)"
- Botões: `[Atualizar PJ]` `[Aplicar benefícios]` primário
- `[Enviar PJ ao financeiro →]` **desabilitado**, com tooltip "Aplique os benefícios antes de enviar."

Exceção: se `previsualizarAplicacao` retornar `nenhum_vinculo_ativo`, o botão Aplicar ainda aparece (chamar o RPC simplesmente não faz nada além de criar snapshot vazio). Isso mantém o fluxo uniforme. Alternativa: pular direto pro estado 3 "sem vínculos" com Enviar liberado. Decisão: **permitir Aplicar normalmente** — um snapshot vazio é informação útil ("essa competência não tem benefício a cobrar") e habilita o Enviar depois.

**Estado 3 — Gerado, benefícios aplicados** (`temLinhasPJ && beneficiosAplicado`):
- Resumo em duas linhas:
  - "N linhas · R$ bruto"
  - "− R$ X benefícios = R$ líquido" (número grande, destaque)
- Linha abaixo: "✓ Benefícios aplicados · K colaboradores com desconto" (verde, com `Check` do lucide)
- Botões: `[Atualizar PJ]` `[Desaplicar benefícios]` (secundário discreto) `[Enviar PJ ao financeiro →]` primário **habilitado**
- Modal do Enviar mostra preview do que vai acontecer (avulsas + envio).

**Estado 4 — Pós-envio** (todas linhas PJ saíram de `rascunho`):
- Resumo compacto.
- Badge verde "✓ Enviada ao financeiro".
- Sem botões de ação (ou só link "Ver no financeiro →").

### Alerta de catálogo incompleto (mantido)

Igual à feature anterior: banner no topo do card quando `catalogoIncompleto != null`. Desabilita AMBOS Aplicar e Enviar, com mensagem apontando pra `/rh/beneficios → Catálogo`.

### Tabela de linhas da folha

A tabela atual (`FolhaCompetenciaView`) já mostra todas as linhas (PJ + CLT) com status, alocação, valor. **Duas mudanças**:

1. **Coluna "Valor" passa a mostrar sempre o `salario_base` atual.** Antes de aplicar benefícios o `salario_base` é o bruto; depois, é o líquido. A mudança é transparente — a coluna não muda de nome, mas os valores mudam após o Aplicar.
2. **Badge "Benefícios −R$ X" ao lado do valor em linhas PJ com `desconto_beneficios > 0`.** Posição: logo depois do número do valor, em pílula pequena, estilo:
   ```
   R$ 10.780,00  ⚡ −R$ 220
   ```
   Classes do chip: `inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800`. Ícone `Shield` ou `PiggyBank` do lucide. Tooltip no hover: "Benefícios aplicados nesta competência".

Linha CLT **nunca** recebe o badge (ADR 174: CLT já vem líquido). Se por algum bug `desconto_beneficios > 0` numa linha CLT, log warning e não renderiza o badge.

### Drawer de edição de linha PJ

Hoje a Kika clica numa linha rascunho e edita `salario_base`. Com o fechamento aplicado, **a edição fica bloqueada**:
- Drawer abre read-only, campo `salario_base` em display-only, sem botão Salvar.
- Banner no topo: "Benefícios aplicados. Pra editar, Desaplique primeiro."
- Botão rápido "Ir pra Desaplicar" (opcional; pode ser só texto).

Comportamento quando `beneficios.aplicado = false`: drawer edita normal como hoje.

### Fluxo das server actions

**`aplicarBeneficios({ ano, mes })`** — já existe em `lib/actions/beneficios/fechamento.ts`. Nenhuma mudança.

**`desaplicarBeneficios({ fechamentoId })`** — já existe no mesmo arquivo. Nenhuma mudança. O RPC já trava se linha PJ já saiu de rascunho (fix da Task 1).

**`enviarFolhaPJ({ ano, mes })`** — modificação:
- **Remove** a chamada inline a `aplicar_fechamento_beneficios`. Se ao buscar `beneficio_fechamento_mensal` vigente retornar `null`, devolver `{ ok: false, message: "Aplique os benefícios antes de enviar." }`.
- **Mantém** chamada a `gerar_avulsas_fechamento_beneficios`.
- **Mantém** UPDATE das linhas PJ rascunho/pendente_correcao → enviada.
- **Mantém** audit + revalidate paths.

Shape de retorno pode perder o campo `sem_beneficios` (era usado pra sinalizar que o aplicar inline tratou `nenhum_vinculo_ativo` como OK; agora esse caso é tratado pelo próprio Aplicar).

**`enviarFolhaCLT`** — nenhuma mudança.

### Helper `obterResumoCardsFolha`

Shape do `pj` ganha um campo novo:
```ts
colaboradoresComDesconto: number;  // count distinct colaborador_id com desconto_beneficios > 0
```

(Serve pra mostrar "K colaboradores com desconto" no Estado 3 do card.)

Estados `previewDescontoBeneficios` e `previewQtdVinculos` continuam sendo preenchidos quando snapshot não aplicado. Quando aplicado, podem ficar `null` (como já é hoje).

### Query da tabela

A query inline em `page.tsx` já lê `desconto_beneficios`? Verificar. Se não, adicionar à lista de `.select(...)` para a renderização da tabela mostrar o badge. (A query principal da tabela é extensa; mudança é só acrescentar a coluna ao select — `salario_base` já está lá.)

### Audit

- Evento `beneficio.fechamento.aplicado` já existe (emitido por `aplicarBeneficios`).
- Evento `beneficio.fechamento.desaplicado` idem.
- Evento `folha_competencia.enviada` já existe. Metadata precisa deixar claro que avulsas foram geradas nesse envio (já faz hoje).

Nada muda em audit.

## Arquivos afetados

**Modificados:**
- `app/(app)/rh/folhas/_components/card-folha-pj.tsx` — adicionar botão Aplicar; refatorar lógica de estados; mostrar preview em estado 2.
- `app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx` — remover lógica condicional de `beneficiosAplicado` (passa a assumir sempre aplicado, já que Enviar é bloqueado sem aplicação).
- `app/(app)/rh/folhas/envio-actions.ts` — remover chamada inline a `aplicar_fechamento_beneficios`; retornar erro amigável se snapshot não existe.
- `app/(app)/rh/folhas/[competencia]/page.tsx` — garantir que a query da tabela traga `desconto_beneficios`; eventualmente reorganizar props do `FolhaCompetenciaView`.
- `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx` — renderizar o badge na coluna Valor para linhas PJ com desconto.
- `app/(app)/rh/folhas/[competencia]/editar-linha-folha-drawer.tsx` — bloquear edição quando `beneficios.aplicado && origem === 'california'`; adicionar banner.
- `lib/queries/folhas-resumo.ts` — adicionar `colaboradoresComDesconto` ao shape.
- `lib/types.ts` — atualizar `ResumoFolhaOrigem` ou subtipo.

**Novos:** nenhum.

**Removidos:** nenhum.

## Verificação pós-implementação

- [ ] Em competência fresca (nenhuma linha): card mostra CTA Gerar PJ.
- [ ] Gerar PJ → card mostra estado 2 com "Benefícios previstos" + botão Aplicar.
- [ ] Clicar Aplicar → RPC roda → tabela abaixo atualiza mostrando líquido + badges nas linhas afetadas.
- [ ] Card entra em estado 3 ("Benefícios aplicados · K colaboradores com desconto"). Enviar fica habilitado.
- [ ] Clicar em linha PJ no drawer → banner "Benefícios aplicados. Desaplique primeiro." + campos read-only.
- [ ] Clicar Desaplicar → RPC roda → tabela volta pros valores brutos → badges somem → card volta pro estado 2.
- [ ] Clicar Enviar PJ → 2 avulsas aparecem em /financeiro/contas-a-pagar + linhas viram enviada.
- [ ] Depois do envio: Desaplicar bloqueado pela trava `folha_pj_ja_enviada` com mensagem amigável.
- [ ] Catálogo incompleto: banner no card + botões Aplicar e Enviar desabilitados.
- [ ] `tsc`, `lint`, `build` limpos.

## Fora do escopo

- Permitir edição de linha PJ após Aplicar (opção B "editar bruto, recalcular líquido"). Pode voltar numa v2 se a Kika reportar fricção.
- Mostrar desconto na linha CLT. CLT é opaco por design.
- Visualizar o breakdown por operadora no drawer ou no modal — a preview no modal de Enviar já mostra isso, basta.
- Permitir Aplicar parcialmente (ex: só um colaborador). Snapshot é sempre da competência inteira.

## Decisões abertas

Nenhuma. Direção confirmada no brainstorm de 2026-11-27.
