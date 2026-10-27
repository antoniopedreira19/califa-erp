# Kanban de fluxo das férias no RH + anexo CLT abono California

**Data:** 2026-10-27
**Status:** Design (aguardando aprovação do dono)

## Intenção

Unificar as abas separadas **Solicitações** e **Pagamentos** de `/rh/ferias` num kanban único de 4 colunas que mostra o fluxo completo de uma solicitação — da aprovação do RH até o pagamento final — com visualização direta do progresso de documentos pendentes por lançamento.

## Por quê

Hoje o RH precisa pular entre 2 telas pra acompanhar uma mesma solicitação:

1. **Solicitações** mostra o lançamento (pendente/aprovado/reprovado/cancelado).
2. **Pagamentos** mostra as folhas de pagamento geradas quando o RH aprova — até 4 folhas por lançamento quando é híbrido com abono combinado.

Problema real: um lançamento híbrido com abono combinado gera 4 linhas na aba Pagamentos (CA-usufruto, CA-abono, Contab-usufruto, Contab-abono). As 4 linhas vivem lado a lado com folhas de OUTROS colaboradores, perdendo totalmente o contexto do lançamento original. O RH tem que mentalmente agrupar as 4 linhas pra lembrar "ah, essas são todas do mesmo Antonio".

Adicionalmente:
- A aba Pagamentos hoje **assume que PJ é sempre enviável** (não checa NF). Precisa travar o envio até o colab anexar a NF no quadro do perfil.
- O recibo de abono California (modelo separado assinado pelo colab) existe no mundo real mas não tem fluxo no sistema — hoje o botão "Anexar" trata toda folha CLT com o mesmo modal.

O kanban resolve as duas coisas: agrupa por lançamento (uma linha = uma solicitação do colab) e mostra claramente onde cada doc está no fluxo.

## Metas

- **Nova aba única** no `/rh/ferias` chamada **"Fluxo"** (combina Solicitações + Pagamentos). As duas abas antigas somem.
- **Kanban de 5 colunas** horizontais:
  1. **Pendentes de aprovação** — card com ícones de ✓ Aprovar e ✗ Reprovar diretos
  2. **Em andamento** — lançamentos aprovados aguardando docs, card mostra progresso "N/M anexados"; clicar abre modal detalhado
  3. **Enviadas** — todas as folhas no financeiro, nenhuma paga ainda
  4. **Parcialmente paga** — pelo menos uma folha paga mas outras ainda enviadas (comum em híbrido: CLT paga dia 5 na folha salarial, PJ paga dia 10 na remessa de fornecedores)
  5. **Finalizadas** — todas pagas, ou reprovadas, ou canceladas
- **Card = lançamento, não folha.** Mesmo quando há 4 folhas (híbrido + abono combinado), o kanban mostra 1 card.
- **Modal detalhado da coluna "Em andamento":** mostra os slots de documento por folha (até 4), com UI diferente por tipo:
  - **CLT usufruto** → "Recibo da contabilidade" (upload PDF + valor líquido digitado pelo RH)
  - **CLT abono** → "Recibo de abono California" (RH preenche fora, imprime assinado, anexa o PDF)
  - **PJ usufruto** → "NF de férias" (anexada pelo colab via Quadro de NFs no `/perfil`) — RH vê status mas não anexa
  - **PJ abono** → "NF de abono" (idem)
- **Envio ao financeiro em lote por lançamento** — botão único no modal, só habilita quando todas as folhas do lançamento têm doc anexado. Envia TODAS as folhas do lançamento de uma vez.
- **Travamento PJ:** folha com `origem='california'` só é enviável quando o colab anexou a NF correspondente no quadro (checa `colaboradores_nf_anexos` por `(colaborador_id, escopo_tipo, escopo_id=lancamento_ferias_id)`).

## Não-metas

- **Ler o PDF por IA pra extrair valor** — fica pra iteração futura. Por ora RH digita o valor líquido manualmente ao anexar o recibo contabilidade.
- **Gerar automaticamente o PDF do modelo abono California** — por ora RH preenche fora do sistema, assinatura é offline, anexa só o PDF já assinado.
- **Drag-and-drop dos cards entre colunas** — a mudança de coluna é consequência de ações (aprovar/anexar/enviar), não de arrastar. Isso é um kanban "sinalizador de estado", não gestão livre.
- **Edição do lançamento a partir do kanban** — se precisar corrigir, cancela e refaz. Rotas de edição ficam no detalhe do colab (fora de escopo).
- **Reorganização visual mobile** — foco em desktop (uso real do RH). Mobile pode cair pra 1 coluna rolável sem otimização visual especial.
- **Anotações livres por card** — o campo `observacao` do lançamento continua existindo mas não vamos criar fluxo novo pra anotações no kanban.
- **Notificações push ao colab** — hoje depende do hub de notificações que ainda não existe. Fora de escopo.

## Anti-metas

- **UI que mostra 4 folhas separadas pro mesmo lançamento no kanban.** O ponto é agrupar.
- **Botão "Enviar ao financeiro" por folha individual.** Nunca — só por lançamento inteiro. Enviar só a parte PJ enquanto espera o CLT é operacionalmente problemático: o RH pode esquecer de voltar depois pro CLT. Força o lote inteiro.
- **Permitir enviar lançamento com documentos faltando mesmo "só uma vez".** Sem exceções: 4/4 ou nada.
- **Deletar as actions existentes de `actions-pagamentos.ts`.** A nova UI reusa `enviarFolhasFerias`, `anexarReciboContabilFolhaFerias`, `gerarUrlUploadReciboContabil`, `cancelarFolhaFerias`. Só muda quem chama.
- **Mudar o modelo do banco (status de `folhas_pagamento`)** — rascunho → enviada → aprovada → paga continua igual. O kanban só reorganiza visualmente.

## Restrições

- Banco pelo ciclo do MCP (`docs/FLUXO-BANCO.md`).
- `lib/types.ts` à mão.
- Strings pt-BR com acento.
- Nenhum PII em arquivo versionado.
- `node --test` + `tsx` pra testes puros (helpers de agrupamento, cálculo de progresso).
- Reusar o Dialog do shadcn (já tem padrão no projeto, inclusive `revisar-folha-drawer.tsx` do financeiro). Modal detalhado é `max-w-2xl`.
- Reusar lógica de preview do `previewValoresFerias` quando aprovar.
- O botão "Aprovar" no card ainda abre o `ConfirmDialog` com preview de valores (criado na iteração anterior) — não troca o fluxo pra "aprovar sem perguntar".
- Mesmo CSS/paleta de cores das outras partes do RH (Palmtree ícone, california-red na primária).

## Modelo de dados

### View nova `vw_rh_ferias_fluxo`

Agrega lançamentos + folhas + status de NF por lançamento. Alimenta o kanban.

```sql
CREATE VIEW public.vw_rh_ferias_fluxo WITH (security_invoker = on) AS
SELECT
  l.id                               AS lancamento_id,
  l.tenant_id,
  l.colaborador_id,
  c.nome                             AS colaborador_nome,
  c.tipo_contratacao,
  l.tipo                             AS tipo_lancamento,
  l.data_inicio,
  l.data_fim,
  l.dias,
  l.dias_abono,
  l.status                           AS status_lancamento,
  l.created_at,
  l.aprovado_em,
  l.motivo_reprovacao,
  l.observacao,
  -- Agregados das folhas filhas
  count(f.id) FILTER (WHERE f.id IS NOT NULL)                     AS folhas_total,
  count(f.id) FILTER (WHERE f.anexo_url IS NOT NULL)              AS folhas_com_anexo_rh,
  -- Para PJ, "anexado" significa NF do colab existe
  count(f.id) FILTER (
    WHERE f.origem = 'california'
      AND EXISTS (
        SELECT 1 FROM colaboradores_nf_anexos n
        WHERE n.colaborador_id = l.colaborador_id
          AND n.escopo_id = l.id
          AND n.escopo_tipo = CASE
            WHEN f.tipo_folha_ferias = 'usufruto' THEN 'ferias_usufruto'::nf_anexo_escopo
            WHEN f.tipo_folha_ferias = 'abono'    THEN 'ferias_abono'::nf_anexo_escopo
          END
      )
  )                                                                AS folhas_pj_com_nf,
  count(f.id) FILTER (WHERE f.origem = 'california')               AS folhas_pj_total,
  count(f.id) FILTER (WHERE f.origem = 'contabilidade')            AS folhas_clt_total,
  count(f.id) FILTER (
    WHERE f.origem = 'contabilidade' AND f.anexo_url IS NOT NULL
  )                                                                AS folhas_clt_com_recibo,
  min(f.status)                                                    AS folha_status_min,
  max(f.status)                                                    AS folha_status_max,
  bool_and(f.status = 'paga')                                      AS todas_pagas,
  bool_and(f.status IN ('enviada','aprovada','paga','pendente_correcao'))  AS todas_enviadas,
  min(f.data_pagamento_prevista)                                   AS vencimento_mais_proximo
FROM colaboradores_ferias_lancamentos l
JOIN colaboradores c ON c.id = l.colaborador_id
LEFT JOIN folhas_pagamento f
  ON f.lancamento_ferias_id = l.id AND f.tipo = 'ferias'
GROUP BY l.id, c.id;
```

**RLS:** `security_invoker=on` — herda das tabelas-base (admin/RH leem tudo do tenant).

### Classificação da coluna do kanban (regra em código puro)

Função pura `classificarColunaFluxo(lancamento, agregados): 'pendente' | 'em_andamento' | 'enviada' | 'parcial' | 'finalizada'`:

- `status_lancamento = 'pendente_aprovacao'` → **pendente**
- `status_lancamento in ('reprovado', 'cancelado')` → **finalizada**
- `status_lancamento = 'concluido'` → **finalizada**
- `status_lancamento = 'aprovado'`:
  - `folhas_total = 0` → **em_andamento** (edge case: aprovado sem folhas geradas, bug anterior)
  - `todas_pagas` (count de `status='paga'` = `folhas_total`) → **finalizada**
  - `alguma_paga && alguma_nao_paga` → **parcial** (algumas pagas + outras enviadas/aprovadas)
  - `todas_enviadas` (nenhuma `rascunho`, nenhuma `paga`) → **enviada**
  - Senão → **em_andamento** (ao menos uma folha ainda em rascunho)

### Enviabilidade por folha (regra em código puro)

Função pura `folhaEnviavel(folha, nfAnexos): boolean`:

- `folha.status != 'rascunho'` → false (não é rascunho)
- `folha.origem = 'contabilidade'` → `!!folha.anexo_url` (precisa de recibo PDF anexado)
- `folha.origem = 'california'` → tem entrada em `colaboradores_nf_anexos` com (colaborador_id, escopo_tipo, escopo_id=lancamento_id)

### Enviabilidade por lançamento

**TODAS** as folhas do lançamento precisam ser enviáveis. O "4/4" vem desse agregado.

### Nenhuma mudança destrutiva no DB

Só adiciona view. Nenhuma coluna nova, nenhum enum alterado.

## UI

### Trigger

Rota continua `/rh/ferias?tab=fluxo` (nova). As rotas antigas `?tab=solicitacoes` e `?tab=pagamentos` **redirecionam** pra `?tab=fluxo` (sem perder usuário com link antigo).

### Layout do kanban

Container de largura total (`max-w-7xl mx-auto`). Grid responsivo:
- Desktop (≥1280px): `grid-cols-5` com gap 3
- Tablet (768-1280px): `grid-cols-2` com scroll horizontal pra ver as 5
- Mobile (<768px): `grid-cols-1`, colunas empilhadas verticalmente

**Header de cada coluna:**
- Título (ex: "Pendentes de aprovação")
- Badge de contagem (ex: "6")
- Cor sutil de fundo pela natureza:
  - Pendentes: amber
  - Em andamento: sky
  - Enviadas: violet
  - Parcialmente paga: fuchsia
  - Finalizadas: slate

**Scroll vertical interno** em cada coluna — a altura total do kanban é fixa (ex: `h-[calc(100vh-16rem)]`) e cada coluna rola independente. Nunca a página inteira rola.

### Card (base comum entre colunas)

Compacto:
- Nome do colaborador (bold)
- Tipo de lançamento (badge pequeno: "Férias", "Abono combinado", "Só venda", "Abono excepcional")
- Linha menor: `N dias · DD/MM a DD/MM`
- Badge do tipo de contratação: "PJ", "CLT", "Híbrido", "MEI", "Estágio" (usa `formatarTipoContratacao` já existente)

Ações variam por coluna (ver abaixo).

### Coluna "Pendentes de aprovação"

Cards com dois botões-ícone no rodapé:
- **Reprovar** (ícone ✗ vermelho outline) — abre o Dialog de reprovação atual
- **Aprovar** (ícone ✓ verde fill) — abre o `ConfirmDialog` com preview de valores (atual `AcoesLancamento`)

**Nenhum clique no corpo do card** — o card é compacto demais pra ter outra interação. Se quiser detalhe, aprova/reprova.

### Coluna "Em andamento"

Card com barra de progresso + badge "N/M anexados":

```
Antonio Pedreira (TESTE)
Abono combinado · Híbrido
30 dias · 02/11 a 21/11

[████░░░░] 2/4 documentos
```

**Clique no card** → abre `ModalDocumentos`. Sem botões de ação no card em si (envio é dentro do modal).

### Modal `ModalDocumentos`

Dialog centralizado `max-w-2xl`.

**Header:**
- Nome do colaborador + Tipo contratação
- Linha: tipo de lançamento, período, dias, dias_abono (se aplicável)
- Vencimento (data mais próxima entre as folhas)

**Progresso visual:**
- Barra `N/M` grande no topo
- Mensagem: "Faltam X documento(s) pra enviar ao financeiro" ou "Pronto pra envio!"

**Lista dos slots (1 slot = 1 folha):**

Cada slot é um bloco com:
- Ícone + badge do tipo: Férias/PJ, Abono/PJ, Férias/CLT, Abono/CLT
- Nome do doc esperado:
  - Férias/PJ: "NF de férias"
  - Abono/PJ: "NF de abono"
  - Férias/CLT: "Recibo da contabilidade"
  - Abono/CLT: "Recibo de abono California"
- Status:
  - ✓ Anexado em DD/MM — link pra ver (abre PDF em nova aba via signed URL)
  - ✗ Pendente — ação condicional:
    - CLT: botão **"Anexar"** → abre `ModalAnexarRecibo` existente (ajustado pra diferenciar usufruto/abono — ver abaixo)
    - PJ: label "Aguardando colab anexar no perfil" (RH não tem botão, só vê status). Opcionalmente link "Ver quadro NF do colab" que abre `/perfil?user=<id>` (fora de escopo imediato — por ora só o label)
- Valor da folha (preview): `R$ X.XXX,XX`

**Footer do modal:**
- Botão "Fechar" (esquerda)
- Botão "**Enviar ao financeiro**" (direita, primário vermelho California)
  - Habilitado só quando TODAS as folhas estão anexadas
  - Tooltip no desabilitado: "Faltam N documento(s)"
- Ao clicar: chama `enviarFolhasFerias({ ids: [<todas as folhas do lançamento>] })` — reusa action existente, só muda que agora envia 1 lançamento inteiro por vez
- Depois do sucesso: fecha modal, revalida → o card migra pra coluna "Enviadas"

### Modal `ModalAnexarRecibo` (ajuste do existente)

Hoje o modal pede PDF + valor líquido. Precisa diferenciar pelos 2 tipos de folha CLT:

**Pra `tipo_folha_ferias='usufruto'`:**
- Título: "Anexar recibo da contabilidade"
- Campo PDF: "Recibo da contabilidade (como o modelo da Mariana)"
- Campo valor: "Valor líquido do recibo (R$)" — ajuda: "Valor que o financeiro vai pagar efetivamente"

**Pra `tipo_folha_ferias='abono'`:**
- Título: "Anexar recibo de abono California"
- Nota explicativa: "Esse é o modelo California do abono, preenchido e assinado pelo colaborador. Baixe o template em branco se precisar."
- Campo PDF: "Recibo assinado"
- Campo valor: "Valor do abono (R$)" — ajuda: "Deve bater com o abono calculado R$ X.XXX,XX" (mostra o valor atual pra conferência)
- (Opcional iteração futura) Link "Baixar template em branco" pra o modelo California armazenado em assets estáticos

Em ambos: PDF opcional pra substituir, valor obrigatório. Reusa `anexarReciboContabilFolhaFerias` + `gerarUrlUploadReciboContabil`.

### Coluna "Enviadas"

Card readonly:
- Badge "Enviado ao financeiro" + data
- Clique no card → modal readonly mostrando os docs anexados (links pra baixar) + status da folha (aprovada/paga). Sem ações.

### Coluna "Parcialmente paga"

Card readonly com progresso de pagamento:
- Badge "N/M pagas" (ex: `2/4 pagas`)
- Barra de progresso visual
- Clique → mesmo modal readonly com os docs + status individual de cada folha (quais pagas, quais ainda esperando pagamento)

### Coluna "Finalizadas"

Card readonly compacto:
- Pagas: ícone ✓ verde + data pagamento + total pago
- Reprovadas: ícone ✗ vermelho + motivo
- Canceladas: ícone traço + data

Clique → mesmo modal readonly com histórico.

## Comportamento

### Fluxo end-to-end (caso Antonio híbrido abono combinado)

1. Antonio solicita → aparece em **Pendentes de aprovação**
2. RH clica ✓ no card → preview mostra valores (R$ 7000-base) → confirma → cria 4 folhas → card vai pra **Em andamento** com badge `0/4`
3. Antonio vê no `/perfil` quadro NF: 2 linhas (ferias_usufruto + ferias_abono do seu lançamento)
4. Antonio anexa NF de férias → badge do card do RH vai pra `1/4`
5. Antonio anexa NF de abono → `2/4`
6. Contabilidade manda recibo pro RH → RH abre modal → anexa recibo contab (Férias/CLT) → digita 3267.80 → `3/4`
7. RH preenche modelo California do abono, imprime, pede pro Antonio assinar, scanneia, anexa (Abono/CLT) → `4/4`
8. Botão "Enviar ao financeiro" habilita → RH clica → 4 folhas vão pra `status=enviada` → card migra pra **Enviadas**
9. Financeiro aprova e paga as 2 folhas CLT na remessa do dia 5 → card migra pra **Parcialmente paga** (`2/4 pagas`)
10. Financeiro paga as 2 PJ na remessa de fornecedores do dia 10 → `4/4 pagas` → card migra pra **Finalizadas**

### Fluxo CLT puro (Mariana)

1. Solicita → **Pendentes**
2. RH aprova → cria 1 folha (contabilidade/usufruto) → vai pra **Em andamento** `0/1`
3. Contabilidade manda recibo → RH anexa → `1/1`
4. RH envia → **Enviadas**
5. Pago → **Finalizadas**

### Fluxo PJ puro usufruto (comum)

1. Solicita → **Pendentes**
2. RH aprova → cria 1 folha (california/usufruto) → **Em andamento** `0/1`
3. Colab anexa NF no quadro → `1/1`
4. RH abre o card, botão envio habilitado → envia → **Enviadas**

### Edge cases

- **Lançamento aprovado sem folhas geradas** (bug anterior): mostra em **Em andamento** com aviso "Sem folhas associadas — contate o admin". Botão de regeneração só se admin.
- **Lançamento reprovado após ter ido pra em_andamento?** Não existe fluxo que leva daqui pra reprovado hoje (reprovar só do pendente). Se existir, trata como edge e marca pra iteração futura.
- **Cancelar folha individual** (ação atual): mantém funcionando dentro do modal — se cancelar TODAS as folhas de um lançamento, o card vira "Finalizadas" com nota "Folhas canceladas". Fora de escopo imediato, mas não quebra.

## Permissões e RLS

Sem mudança. View herda das tabelas (admin + RH).

## Ordem de execução

1. **Migration** — cria `vw_rh_ferias_fluxo`
2. **Types + helpers puros** — `lib/ferias/classificar-coluna-fluxo.ts` + testes dos 2 helpers (classificar coluna, folhaEnviavel)
3. **Nova aba `/rh/ferias?tab=fluxo`** — componente server que consume a view + componente kanban cliente
4. **Modal `ModalDocumentos`** — client component com os slots + progresso + botão enviar
5. **Ajuste `ModalAnexarRecibo`** — diferencia usufruto/abono CLT
6. **Redirecionamento** das rotas `?tab=solicitacoes` e `?tab=pagamentos` → `?tab=fluxo`
7. **Deletar `aba-solicitacoes.tsx` e `aba-pagamentos.tsx` + `pagamentos-lista-cliente.tsx`** — nenhum outro consumer

## Decisões incorporadas após builder-check

**Pelo dono:**
- Mistura de status (algumas folhas pagas, outras ainda enviadas) → **nova coluna "Parcialmente paga"** (opção B). Kanban passa a ter **5 colunas**.

**Pelo construtor (minhas calls):**
- **`enviarFolhasFerias` ganha validação server-side pra PJ**: antes de permitir envio, consulta `colaboradores_nf_anexos` por `(colaborador_id, escopo_tipo, escopo_id=lancamento_ferias_id)`. Se PJ sem NF, bloqueia com mensagem explícita. Defesa em profundidade (UI já não deixa clicar; server é a última linha).
- **`anexarReciboContabilFolhaFerias` continua idêntica no server** — não precisa diferenciar usufruto/abono CLT. Só a UI do modal muda (título, placeholder, mensagem).
- **Folha cancelada não polui o count**: hoje `cancelarFolhaFerias` **deleta** a folha (não vira status). Nenhum tratamento especial precisa.
- **`data_pagamento_prevista`** já é populado no INSERT da folha via `fn_calcular_vencimento_ferias` (visto em `criar-folhas-pagamento.ts`). OK pro header do modal.
- **Ordenação dentro de cada coluna**:
  - Pendentes: `created_at` asc (FIFO — mais antigos primeiro)
  - Em andamento: `vencimento_mais_proximo` asc (urgência)
  - Enviadas e Parcialmente paga: `enviada_em` desc (mais recentes primeiro)
  - Finalizadas: `data_pagamento` (ou `aprovado_em` se reprovado/cancelado) desc
- **Redirect** das rotas antigas (`?tab=solicitacoes`, `?tab=pagamentos`): server-side via `redirect()` no `page.tsx` antes do render. Zero JS no cliente, SEO-friendly.
- **Refactor do `AcoesLancamento`**: construtor decide — pode extrair só os dialogs em component separado reusável no card, ou duplicar os triggers no card e manter o original no fluxo antigo (que vai sumir). Qualquer um serve.

## Pontos abertos (ainda pra o dono decidir, não bloqueantes)

- **Nome da aba: "Fluxo" ou "Solicitações"?** Decidi "Fluxo" pra deixar claro que agora é a visão end-to-end. Se preferir manter "Solicitações" (familiaridade), muda sem impacto técnico.
- **Cancelamento de folha individual** (ação atual em Pagamentos) — hoje é um botão de lixeira na linha. No kanban novo, decidi manter dentro do modal "Em andamento" (botão discreto por folha, só pra admin, caso emergência). Fora de "Enviadas" e "Finalizadas" (financeiro cuida).

## O que fica a cargo do construtor

- Formato visual exato dos cards (padding, hover state).
- Ícones específicos de lucide (sugestões: `Palmtree` pra férias, `Split` pra abono combinado, `DollarSign` pra abono avulso, `FileText` pros docs).
- Granularidade dos testes dos helpers puros.
- Reuso do `ConfirmDialog` existente pra reprovação.
- Query no servidor: 1 query pra view + 1 query pros docs anexados por lançamento (ou agregar na própria view se performar).
- Decisão de usar `security_invoker=on` ou policies dedicadas na view.
- Transição visual quando um card muda de coluna (pode ser instantâneo via `router.refresh()`).

## Referências

- `docs/FLUXO-BANCO.md`
- `docs/modulos/rh/25-ferias.md`
- `app/(app)/rh/ferias/aba-solicitacoes.tsx` — vira parte do kanban
- `app/(app)/rh/ferias/aba-pagamentos.tsx` — vira parte do kanban
- `app/(app)/rh/ferias/pagamentos-lista-cliente.tsx` — deletar
- `app/(app)/rh/ferias/modal-anexar-recibo.tsx` — ajustar pra diferenciar usufruto/abono
- `app/(app)/rh/ferias/actions-pagamentos.ts` — reusar actions existentes
- `app/(app)/rh/ferias/acoes-lancamento.tsx` — lógica de aprovar/reprovar reusada no card
- `supabase/migrations/20261026700003_vw_nf_quadro_e_people.sql` — padrão de views `security_invoker=on`
- `lib/colaboradores/format-tipo-contratacao.ts` — helper já existente
