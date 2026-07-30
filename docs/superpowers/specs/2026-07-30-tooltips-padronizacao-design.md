# Padronização de tooltips do ERP California

**Data:** 2026-07-30
**Status:** Design proposto
**Escopo:** Substituir o uso disperso de `title="..."` nativo por um componente Tooltip único, consistente com a identidade visual do projeto.

## Problema

O ERP hoje não tem componente Tooltip. Todos os avisos que aparecem ao passar o mouse (ex.: "Aprovar versão", "Duplicar versão", "Inativar cliente", "Sair" na sidebar) usam o atributo HTML nativo `title="..."`, que faz o browser renderizar sua caixinha de sistema.

Consequências observadas hoje:
- **Visual fora do design system.** Fundo branco no Chrome/Windows, cinza no macOS, fonte do SO. Não usa a paleta California nem a fonte Inter.
- **Delay ~500ms fixo**, controlado pelo browser.
- **Ignorado em mobile/touch** — usuários de tablet nunca veem as dicas.
- **Acessibilidade instável.** Leitores de tela podem ler `title` + `aria-label` em duplicidade; foco de teclado não abre a dica.
- **Inconsistência de linguagem.** O mesmo botão-ícone em telas diferentes pode ter dica ou não, e sem padrão de nomenclatura.

## Objetivo

Ter um único componente `Tooltip` (mais um helper `IconButton`) usado em toda situação em que hoje existe `title=` em botões e links interativos, com visual próprio, acessibilidade correta e custo de performance desprezível.

## Não-objetivos

- Não introduzir tooltip em elementos que hoje não têm dica alguma. A troca é 1:1 do que já existe.
- Não substituir usos de `title` que são **props de componentes** (ex.: `<ConfirmDialog title="...">`, `<Drawer title="...">`, `<PageHeader title="...">`, `<EmptyState title="...">`, `<Card title="...">`) — esses não são tooltips, são cabeçalhos.
- Não introduzir tooltips com conteúdo rico (ícone + atalho de teclado + parágrafo). MVP é texto puro.

## Inventário atual (auditoria bruta)

Grep de `title="` em `app/` e `components/` retornou 42 ocorrências. Classificação preliminar (a ser confirmada na Task 1 do plano de execução):

### São tooltips (substituir)
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/versoes-list.tsx` — Aprovar / Duplicar / Cancelar / Abrir versão (4)
- `app/(app)/clientes/clientes-list.tsx` — Inativar / Reativar (2)
- `app/(app)/fornecedores/fornecedores-list.tsx` — Inativar / Reativar (2)
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/grupo-card.tsx` — Salvar / Cancelar / Renomear grupo / Remover grupo (4)
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/itens-table.tsx` — Fechar aviso / Descartar linha nova (2)
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` — Baixar planilha XLSX (1)
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-drawer.tsx` — Total orçado / Total planejado / Rentabilidade (3, provavelmente em `<span>` com hint)
- `components/sidebar.tsx` — nav items colapsados, avatar, botão Sair (4)

Subtotal estimado: **~22 tooltips reais**.

### NÃO são tooltips (não tocar)
- Props `title` de `ConfirmDialog`, `Drawer`/`DrawerContent`, `EmptyState`, `PageHeader`, `Card`, `TileCard` nos arquivos: `admin/page.tsx`, `cadastros/page.tsx`, `clientes/page.tsx`, `fornecedores/page.tsx`, `orcamentos/page.tsx`, `financeiro/page.tsx`, `projeto-editor-drawer.tsx`, `aprovar-drawer.tsx`, `rejeitar-drawer.tsx`, `aprovar-rejeitar-buttons.tsx`, `reenviar-aprovacao-button.tsx`, `aprovacao-actions.tsx`, `nova-versao-drawer.tsx`, `novo-grupo-drawer.tsx`, `versao-editor-drawer.tsx`, `orcamento-editor-drawer.tsx`, `criar-job-drawer.tsx`, `regionais-list.tsx`, `categorias-list.tsx`, `categorias-dominio-list.tsx`.

Subtotal estimado: **~20 usos como prop**.

A Task 1 do plano de execução vai confirmar essa classificação arquivo por arquivo.

## Design proposto

### Dependência nova

Adicionar `@radix-ui/react-tooltip` (~4 kB gz). É a base padrão do shadcn/ui, alinha com as outras deps Radix já usadas (`react-dialog`, `react-popover`, `react-select`).

### Componente `components/ui/tooltip.tsx`

Wrapper padrão shadcn expondo `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`. `TooltipContent` já tema-do:

- fundo `bg-foreground` (aprox. `#282828`), texto `text-background`
- `text-xs font-medium`, `px-2.5 py-1.5`, `rounded-md`, `shadow-md`
- `side="top"` default, `sideOffset={6}`, `avoidCollisions=true`
- animação padrão de fade+slide do shadcn

### `TooltipProvider` global

Colocado em `app/layout.tsx` (root layout) envolvendo `{children}`, com `delayDuration={300}` e `skipDelayDuration={100}`. É Context puro, custo zero em SSR.

### Helper `components/ui/icon-button.tsx`

Para não poluir os 22 sites com wrapper de 4 linhas, criar helper:

```tsx
type IconButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  hint?: string;
  hintSide?: "top" | "right" | "bottom" | "left";
};
```

Comportamento:
- Se `hint` presente → renderiza `<Tooltip><TooltipTrigger asChild><button aria-label={hint} .../></TooltipTrigger><TooltipContent side={hintSide}>{hint}</TooltipContent></Tooltip>`.
- Se `hint` ausente → renderiza `<button .../>` puro.
- `aria-label` sempre setado a partir do `hint` (a11y para leitor de tela).

Isso resolve o caso dominante (botão-ícone em linha de tabela). Para os 3 casos de `<span>` com hint (indicadores do `importar-drawer`), usar `<Tooltip>` explícito.

### Uso em `Link`

O sidebar tem `<Link title="...">`. Padrão:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Link href={...}>...</Link>
  </TooltipTrigger>
  <TooltipContent side="right">{label}</TooltipContent>
</Tooltip>
```

Sem helper dedicado — poucos casos.

## Impacto em performance

Cotejando com `docs/PERFORMANCE.md`:

- **Zero query nova, zero prefetch, zero embed.** Não toca em `lib/supabase/**` nem em `app/(app)/**` no eixo data-fetching.
- **Bundle**: +~4 kB gz (Radix Tooltip). Sem impacto perceptível em LCP.
- **Runtime**: `TooltipProvider` é Context; `TooltipContent` só monta no portal ao hover/focus (lazy). Sem overhead na render inicial das listas.
- **`force-dynamic` e `prefetch={false}`**: intocados. A migração não altera nenhuma das regras não-negociáveis.

Conclusão: não há regressão de performance esperada. Nenhum caso listado no `PERFORMANCE.md` é afetado.

## Impacto em fluxos e a11y

- **Fluxos de negócio**: nenhum. Substituição 1:1 semântica.
- **Acessibilidade**: melhora — `aria-label` explícito no `IconButton` + foco de teclado abre a tooltip via Radix.
- **Mobile/touch**: melhora — Radix suporta long-press. Antes, `title=""` era invisível em mobile.
- **Dentro de `Dialog`/`Drawer`**: Radix usa portal e z-index correto; validar visualmente nos drawers de importação e edição.

## Riscos

1. **Tooltip cortada por `overflow:hidden` de container**. Mitigação: `TooltipContent` usa portal, então overflow do pai não corta. Validar no drawer.
2. **z-index colidindo com Dialog aberto**. Mitigação: Radix cuida disso; conferir visualmente.
3. **`asChild` requer que o filho aceite `ref`**. Componentes como `Link` do Next e `<button>` nativo aceitam. Se algum wrapper interno não aceitar, ajustar caso a caso.
4. **Migração parcial**. Enquanto a PR não fecha, ficam dois estilos convivendo (title nativo + Tooltip novo). Mitigação: fazer a migração completa em uma única PR pequena focada nisso.

## Critérios de aceite

- [ ] `@radix-ui/react-tooltip` no `package.json`.
- [ ] `components/ui/tooltip.tsx` criado no padrão shadcn com o tema California.
- [ ] `components/ui/icon-button.tsx` criado com prop `hint`.
- [ ] `TooltipProvider` montado no `app/layout.tsx` com `delayDuration={300}`.
- [ ] Zero ocorrências de `<button title="...">` ou `<Link title="...">` (atributo HTML como tooltip) em `app/` e `components/`. Props `title=` de outros componentes permanecem.
- [ ] `aria-label` presente em todo botão-ícone que perdeu o `title`.
- [ ] `pnpm build` e `pnpm lint` limpos.
- [ ] Validação visual manual: sidebar colapsada, `versoes-list`, `grupo-card`, `itens-table`, `importar-drawer`.

## Ordem sugerida de execução (para o plano)

1. Confirmar o inventário separando "atributo HTML" vs. "prop de componente".
2. Instalar dep, criar `Tooltip` e `IconButton`, montar `TooltipProvider` no root.
3. Migrar sidebar (baixo risco, validação visual rápida).
4. Migrar listas (`versoes-list`, `clientes-list`, `fornecedores-list`).
5. Migrar telas de versão (`grupo-card`, `itens-table`, `page.tsx` de versão).
6. Migrar `importar-drawer` (spans com hint).
7. Rodar `lint`/`build`, revisar visualmente cada tela migrada, commit único.
