"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FolderKanban,
  LayoutGrid,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AGREGADA,
  destinoDaAba,
  type ItemDaFaixa,
  type ModuloDaFaixa,
} from "@/lib/faixa-do-projeto";

interface Props {
  modulo: ModuloDaFaixa;
  /** O voltar de sempre de cada tela — mesmo destino, texto encurtado. */
  voltar: { href: string; rotulo: string; titulo: string };
  projeto: { codigo: string; nome: string };
  agregadaHref: string;
  /** `null` enquanto carregam (fallback do Suspense na tela do orçamento). */
  itens: ItemDaFaixa[] | null;
  /** Id do item aberto na tela, ou `AGREGADA`. */
  ativo: string;
}

/**
 * Faixa do projeto — decisão 106 (opção A do protótipo "Abas do projeto").
 *
 * Primeira linha das telas de orçamento, de job e das visões agregadas, nos
 * três módulos: o voltar, o projeto e uma aba para a agregada e para cada
 * orçamento ou job irmão. É um nível acima das abas que a tela já tinha
 * (versões, seções do job), e por isso tem forma própria — pílula escura,
 * da cor da barra lateral — em vez do sublinhado vermelho delas.
 *
 * As abas são links, não estado: cada uma é uma página. O destino depende
 * da aba de seção aberta agora (lida do `?aba=` a cada render; as abas do
 * job gravam o `?aba=` com `replaceState`, e o Next reflete isso no
 * `useSearchParams`). A regra está em `destinoDaAba`.
 *
 * Quando as abas não cabem, os nomes já vêm encurtados e aparece o botão
 * "Todos", com a lista inteira — nada fica rolado para fora sem aviso.
 */
export function FaixaDoProjeto({
  modulo,
  voltar,
  projeto,
  agregadaHref,
  itens,
  ativo,
}: Props) {
  const searchParams = useSearchParams();
  const abaAtual = searchParams.get("aba");
  const from = searchParams.get("from");

  const trilhoRef = React.useRef<HTMLDivElement>(null);
  const ancoraRef = React.useRef<HTMLDivElement>(null);
  const [transborda, setTransborda] = React.useState(false);
  const [menuAberto, setMenuAberto] = React.useState(false);

  const destino = (alvo: string, href: string) =>
    destinoDaAba({ modulo, alvo, ativo, href, abaAtual, from });

  // O botão "Todos" só existe quando as abas não cabem na largura.
  React.useLayoutEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const medir = () =>
      setTransborda(trilho.scrollWidth - trilho.clientWidth > 1);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(trilho);
    return () => observador.disconnect();
  }, [itens]);

  // A aba aberta sempre à vista, mesmo num projeto com muitos itens. Roda
  // de novo quando o "Todos" aparece: ele estreita o trilho e pode cortar
  // a aba que estava inteira.
  React.useLayoutEffect(() => {
    const trilho = trilhoRef.current;
    const aberta = trilho?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!trilho || !aberta) return;
    const inicio = aberta.offsetLeft - trilho.offsetLeft;
    const fim = inicio + aberta.offsetWidth;
    if (inicio < trilho.scrollLeft || fim > trilho.scrollLeft + trilho.clientWidth) {
      trilho.scrollLeft = Math.max(0, inicio - 48);
    }
  }, [itens, ativo, transborda]);

  React.useEffect(() => {
    if (!menuAberto) return;
    function onMouseDown(e: MouseEvent) {
      if (!ancoraRef.current?.contains(e.target as Node)) setMenuAberto(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuAberto(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuAberto]);

  const contagem =
    itens === null
      ? null
      : `${itens.length} ${
          modulo === "orcamentos"
            ? itens.length === 1
              ? "orçamento"
              : "orçamentos"
            : itens.length === 1
              ? "job"
              : "jobs"
        }`;

  const chipDoProjeto = (
    <>
      <FolderKanban className="h-4 w-4 flex-none text-california-red" />
      <span className="font-mono text-[11.5px] font-semibold text-muted-foreground">
        {projeto.codigo}
      </span>
      <span className="max-w-[240px] truncate text-[13px] font-semibold text-foreground">
        {projeto.nome}
      </span>
    </>
  );

  return (
    <nav
      aria-label="Navegação do projeto"
      className="relative flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-soft"
    >
      {/* Em Orçamentos o voltar vai para o próprio projeto: seta e projeto
          são um link só. Nos outros módulos vai para a lista. */}
      {modulo === "orcamentos" ? (
        <Link
          href={voltar.href}
          prefetch={false}
          title={voltar.titulo}
          className="inline-flex h-8 min-w-0 flex-none items-center gap-2 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5 flex-none" />
          {chipDoProjeto}
        </Link>
      ) : (
        <>
          <Link
            href={voltar.href}
            prefetch={false}
            title={voltar.titulo}
            className="inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {voltar.rotulo}
          </Link>
          <Divisoria />
          <span className="inline-flex min-w-0 flex-none items-center gap-2 px-2">
            {chipDoProjeto}
          </span>
        </>
      )}

      <Divisoria />

      {/* Sem barra de rolagem: com muitos itens o gesto é arrastar, e o
          "Todos" mostra o que ficou de fora. */}
      <div
        ref={trilhoRef}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Aba
          href={destino(AGREGADA, agregadaHref)}
          aberta={ativo === AGREGADA}
          titulo={`Visão agregada · ${projeto.codigo}`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Visão agregada
        </Aba>

        {itens === null ? (
          <>
            <span className="h-5 w-32 flex-none animate-pulse rounded-md bg-muted" />
            <span className="h-5 w-32 flex-none animate-pulse rounded-md bg-muted" />
          </>
        ) : (
          itens.map((item) => {
            const aberta = item.id === ativo;
            return (
              <Aba
                key={item.id}
                href={destino(item.id, item.href)}
                aberta={aberta}
                titulo={`${item.codigo} · ${item.nome}${item.travado ? " · somente leitura" : ""}${item.emRevisao ? " · em revisão" : ""}`}
              >
                <span
                  className={cn(
                    "font-mono text-[11px] font-semibold",
                    aberta ? "text-white/60" : "text-[#b3323c]",
                  )}
                >
                  {item.codigo}
                </span>
                <span className="max-w-[300px] truncate">{item.nome}</span>
                {item.travado && (
                  <Lock
                    className={cn(
                      "h-3 w-3 flex-none",
                      aberta ? "text-white/50" : "text-muted-foreground/70",
                    )}
                  />
                )}
                {item.emRevisao && (
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />
                )}
              </Aba>
            );
          })
        )}
      </div>

      {transborda && itens !== null && (
        <div ref={ancoraRef} className="relative flex-none">
          <button
            type="button"
            onClick={() => setMenuAberto((a) => !a)}
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
              menuAberto
                ? "border-california-red/40 bg-california-red/10 text-california-red"
                : "border-border bg-white text-foreground hover:border-california-red/40 hover:text-california-red",
            )}
          >
            Todos
            <span className="font-mono text-[11px] text-muted-foreground">
              {itens.length + 1}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {menuAberto && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+0.375rem)] z-30 w-[380px] rounded-2xl border border-border bg-card p-1.5 text-left shadow-elevated"
            >
              <p className="truncate px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {projeto.codigo} · {projeto.nome}
              </p>
              <div className="flex max-h-[360px] flex-col overflow-y-auto">
                <ItemDoMenu
                  href={destino(AGREGADA, agregadaHref)}
                  aberta={ativo === AGREGADA}
                  titulo="Visão agregada"
                  subtitulo={contagem ?? ""}
                  onEscolher={() => setMenuAberto(false)}
                />
                <div className="mx-2.5 my-1 h-px bg-border" role="separator" />
                {itens.map((item) => (
                  <ItemDoMenu
                    key={item.id}
                    href={destino(item.id, item.href)}
                    aberta={item.id === ativo}
                    titulo={item.nome}
                    subtitulo={item.codigo}
                    travado={item.travado}
                    emRevisao={item.emRevisao}
                    onEscolher={() => setMenuAberto(false)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

/**
 * Link de um job na árvore da visão agregada. Leva aonde a aba do mesmo
 * job na faixa levaria (decisão do Tiago, 25/09/2026): hoje, a Planilha
 * Interna — ou, no Financeiro com o Fluxo de Caixa do Projeto aberto, o
 * Fluxo de Caixa do Job. É client só para ler o `?aba=` da agregada.
 */
export function LinkDoJobNaAgregada({
  modulo,
  href,
  className,
  children,
}: {
  modulo: ModuloDaFaixa;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const destino = destinoDaAba({
    modulo,
    alvo: href,
    ativo: AGREGADA,
    href,
    abaAtual: searchParams.get("aba"),
    from: searchParams.get("from"),
  });
  return (
    <Link href={destino} prefetch={false} className={className}>
      {children}
    </Link>
  );
}

function Divisoria() {
  return <span aria-hidden className="mx-1 h-5 w-px flex-none bg-border" />;
}

function Aba({
  href,
  aberta,
  titulo,
  children,
}: {
  href: string;
  aberta: boolean;
  titulo: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    "inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors",
    aberta
      ? "bg-california-dark font-semibold text-white"
      : "font-medium text-foreground/80 hover:bg-muted hover:text-foreground",
  );
  // A aba aberta não é link: clicar nela não recarregaria nada de útil.
  if (aberta) {
    return (
      <span aria-current="page" title={titulo} className={classes}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} prefetch={false} title={titulo} className={classes}>
      {children}
    </Link>
  );
}

function ItemDoMenu({
  href,
  aberta,
  titulo,
  subtitulo,
  travado,
  emRevisao,
  onEscolher,
}: {
  href: string;
  aberta: boolean;
  titulo: string;
  subtitulo: string;
  travado?: boolean;
  emRevisao?: boolean;
  onEscolher: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      role="menuitem"
      aria-current={aberta ? "page" : undefined}
      onClick={onEscolher}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="flex h-4 w-4 flex-none items-center justify-center text-california-red">
        {aberta && <Check className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {titulo}
        </span>
        <span className="block font-mono text-[11px] text-muted-foreground">
          {subtitulo}
        </span>
      </span>
      {travado && <Lock className="h-3 w-3 flex-none text-muted-foreground/70" />}
      {emRevisao && (
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />
      )}
    </Link>
  );
}
