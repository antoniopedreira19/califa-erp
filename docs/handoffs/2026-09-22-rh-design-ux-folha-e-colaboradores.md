# RH · Design & UX da folha e da lista de colaboradores (2026-09-22)

> Sessão implementou o P0 do módulo RH — as três decisões (D1, D2, D3) já travadas na sessão anterior. Sem mudanças de banco. A listagem de folhas passou a comunicar "em que ponto está a folha do mês" em vez de contar cada estado; o detalhe da folha ganhou cards de resumo; a lista de colaboradores ganhou os 4 cards de estado atual. Próxima sessão pega **P1**: import da planilha atual, estorno de folha aprovada, ou benefícios (nessa ordem, ver `30-proximos-passos.md`).

## O que entrou

- **D1 — `/rh/folhas` enxuta:** 4 colunas escaneáveis (Competência · Colaboradores · Total · Status). Status agregado (`rascunho`/`enviada`/`concluída`) é derivado das linhas em runtime — sem coluna nova no banco. Total (R$) somado no servidor a partir de `salario_base`. `folhas-list.tsx` perdeu 4 colunas de contagem; ganhou badge de status agregado.
- **D2 — `/rh/folhas/[competencia]` com cards:** faixa de 6 cards no topo (Total destaque · Colaboradores · Enviadas · Pendências · Aprovadas · Pagas). Pendências ficam em vermelho quando > 0; Pagas em verde quando > 0. Contagens derivadas das linhas que já são carregadas — zero query extra. A tabela mantém badge granular por linha.
- **D3 — `/rh/colaboradores` com cards de estado:** faixa de 4 cards antes dos filtros (Ativos · Folha do mês atual · Admissões no mês · Demissões no mês). Folha atual mostra "—" + hint "Folha não gerada" quando `folhas_pagamento` da competência corrente está vazia. As 4 agregações rodam em `Promise.all` com as queries existentes: três `head:true count:'exact'` e uma seleção mínima de `salario_base`. Sem embed pesado.

## Migrations aplicadas

Nenhuma. Todo o trabalho é derivação em runtime dos dados que já existem no banco.

## Docs / ADRs relacionados

- [`docs/modulos/rh/30-proximos-passos.md`](../modulos/rh/30-proximos-passos.md) §P0 — as três decisões (D1/D2/D3) que orientaram esta sessão.
- [`docs/handoffs/2026-09-21-rh-fechamento-de-ciclo.md`](2026-09-21-rh-fechamento-de-ciclo.md) — contexto de onde as decisões foram tomadas.
- Nenhum ADR novo: nenhuma das mudanças cria divergência semântica entre UI e banco a ponto de justificar registro. "Concluída" na UI = todas as linhas em `paga` no banco continua sendo mapeamento trivial; se o vocabulário virar diferença de verdade (ex.: um estado "concluída parcial"), aí sim vira ADR.

## Commits relevantes

- `b7524eb` — feat(rh): listagem de folhas enxuta com status agregado
- `2c3e18b` — feat(rh): cards de resumo no detalhe da folha por competência
- `c649d0f` — feat(rh): cards de estado atual na lista de colaboradores

### Rodada 2 (mesma sessão) — resposta à crítica de "muito cinza / cards desorganizados"

- `f818d72` — feat(rh): redesign do detalhe da folha (cards balanceados + tabs + regional)
- `ef6ee64` — feat(rh): KPIs anuais na listagem de folhas + card visual consistente
- `39e8a0c` — feat(rh): delta vs mês anterior nos cards de colaboradores

**O que mudou na Rodada 2:**

- **Grid quebrado corrigido** — o detalhe da folha tinha `col-span-2` no Total + 5 cards de 1 col = 7 células em grid-6, e "Pagas" caía sozinha na 2ª linha. Substituído por 4 cards iguais.
- **Análise no card** — Total, Colaboradores e Folha do mês ganham delta vs mês anterior (% ou absoluto, com seta ↑/↓ colorida). Ativos usa cálculo sem histórico: `ativos_hoje − admissões + demissões`. Demissões inverte a cor (subir é ruim).
- **Barra de progresso do fluxo** — o quarto card do detalhe substitui os 4 antigos (Enviadas/Aprovadas/Pagas/Pendências) por uma barra empilhada horizontal — verde no fim, cinza no começo, vermelho no meio quando tem pendência. Leitura instantânea de onde a folha está.
- **Tabs de status** — o Select "Todos (1)" do detalhe da folha virou tabs no padrão Financeiro (Todos · Rascunho · Enviada · Pendente · Aprovada · Paga), cada uma com badge de contagem colorido.
- **Filtro de regional client-side** — dropdown ao lado da busca no detalhe da folha; filtra linhas cujas alocações pertençam à regional selecionada.
- **Visual consistente** — todos os cards e cards de tabela agora usam `rounded-2xl + bg-card + shadow-soft` + ícone lucide em quadradinho `bg-california-red/10`. Antes eram `rounded-xl + bg-background` sem ícone, o que dava a impressão de "menos importante" que o Financeiro.
- **Layout do detalhe da folha corrigido** — removido `max-w-7xl mx-auto` (violava a decisão 085 — tela principal não tem largura própria).

## Pontos de atenção pra próxima sessão

- **Filtro por empresa no PageHeader ficou de fora da Rodada 2** — foi discutido, mas a semântica em RH não é 1:1 com Financeiro (colaborador tem alocação múltipla; linha de folha idem). Aplicar `showEmpresaFilter` em `/rh/colaboradores` e `/rh/folhas/[competencia]` exige decidir se filtra por "alocação vigente em X" ou "pelo menos uma alocação em X". Se voltar como P0 na próxima, alinhar com Kika primeiro.
- **P1 já está desbloqueado.** A ordem sugerida em `30-proximos-passos.md` é: (1) import da planilha atual — destrava a Kika usar de verdade; (2) estorno de folha aprovada — remove necessidade de SQL manual; (3) benefícios. Peça pra escolher qual antes de codar.
- **Status agregado como lógica de servidor:** hoje ele é computado depois da listagem completa das linhas de `folhas_pagamento` do tenant. Para poucos meses × ~22 colaboradores o payload é minúsculo. Se a lista crescer (histórico longo, mais tenants), migrar pra RPC com `count(*) filter (where status = 'X')` por competência — está mapeado nas notas de implementação da D1.
- **Card "Folha do mês atual" precisa da folha gerada.** Se a Kika abrir `/rh/colaboradores` no dia 1 antes de gerar a folha, o card aparece "—" com "Folha não gerada". É comportamento esperado; se virar friction, o próximo passo é um CTA "Gerar folha" dentro do card.
- **Datas do mês corrente vêm do server (`new Date()`).** Server em UTC + Brasil UTC-3 = pode aparecer "outubro" às 21h de 30/09. Só relevante quando a virada de mês estiver a ~3h. Se surgir bug, colar `Intl.DateTimeFormat` com `timeZone: "America/Sao_Paulo"`.
- **Layout `max-w-7xl mx-auto` no detalhe da folha continua como dívida técnica.** É violação do padrão `09-identidade-visual-ui.md` (decisão 085 — tela principal não tem largura própria). Não corrigi porque estava fora do escopo desta sessão; anotar pra próxima varredura de layout.
