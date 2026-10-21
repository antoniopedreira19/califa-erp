import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Home,
  Landmark,
  Search,
  UserCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { CENTROS, HOJE } from "./data";

export function cn(...a) {
  return a.filter(Boolean).join(" ");
}

export function moeda(n) {
  return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function trimestre(iso) {
  const m = parseInt(iso.slice(5, 7), 10);
  return m <= 3 ? "T1" : m <= 6 ? "T2" : m <= 9 ? "T3" : "T4";
}

export const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function diaDaSemana(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function centroTexto(c) {
  if (!c) return null;
  return { tipo: `${c.tipo} · ${CENTROS[c.tipo] ?? ""}`, sub: c.sub };
}

export function hojeIso() {
  return HOJE;
}

// ---------------------------------------------------------------------------
// A casca do ERP
// ---------------------------------------------------------------------------

const MENU = [
  ["Home", Home],
  ["Orçamentos", FileText],
  ["Jobs", Briefcase],
  ["Desembolsos", Wallet],
  ["Financeiro", Landmark],
  ["Relatórios", BarChart3],
  ["RH", Users],
  ["Freelancers", UserCheck],
];

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[78px] shrink-0 flex-col bg-california-dark text-white md:flex">
      <div className="flex justify-center px-3 pb-5 pt-6">
        <svg viewBox="0 0 40 24" className="h-7 w-10" aria-hidden="true">
          <path d="M3 15c3-6 9-9 16-9 5 0 9 2 13 1 2 0 4-1 5-2-1 4-3 7-7 8l3 6h-4l-3-5c-3 1-6 1-9 0l-3 5H10l2-6c-3 0-6-1-9 2z" fill="#E74B56" />
        </svg>
      </div>
      <div className="px-4">
        <div className="h-px bg-white/10" />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {MENU.map(([label, Icon]) => (
          <div
            key={label}
            title={label}
            className={cn(
              "relative flex h-11 items-center justify-center rounded-xl text-white/60",
              label === "Financeiro" && "bg-white/10 text-white",
            )}
          >
            {label === "Financeiro" && <span className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-california-red" />}
            <Icon className="h-[18px] w-[18px]" />
          </div>
        ))}
      </nav>
      <div className="flex justify-center p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-california-red text-[11px] font-semibold">TM</div>
      </div>
    </aside>
  );
}

export function Voltar() {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-semibold shadow-soft hover:bg-muted/50"
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar
    </button>
  );
}

export function PageHeader({ eyebrow = "FINANCEIRO", title, description, icon: Icon, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-california-red">{eyebrow}</p>
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        </div>
        {description && <p className="max-w-[900px] text-sm text-muted-foreground">{description}</p>}
      </div>
      {right}
    </div>
  );
}

export function Tabs({ abas, ativa, onChange }) {
  return (
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto border-b border-border">
      {abas.map((a) => (
        <button
          key={a.key}
          type="button"
          role="tab"
          aria-selected={ativa === a.key}
          onClick={() => onChange?.(a.key)}
          className={cn(
            "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
            ativa === a.key ? "border-california-red text-california-red" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {a.label}
          {a.novo && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-violet-700">novo</span>}
          {a.count > 0 && (
            <span
              className={cn(
                "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                ativa === a.key ? "bg-california-red text-white" : "bg-muted text-muted-foreground",
              )}
            >
              {a.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function FiltrosConta({ conta = "California Santander · Santander" }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <div className="min-w-[280px] flex-1 space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">Conta bancária</label>
        <div className="flex h-11 items-center justify-between rounded-lg border border-border bg-white px-4 text-sm">
          {conta}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      {[
        ["De", "01/10/2026"],
        ["Até", "31/10/2026"],
      ].map(([l, v]) => (
        <div key={l} className="space-y-1">
          <label className="text-[11px] uppercase text-muted-foreground">{l}</label>
          <div className="flex h-11 w-[150px] items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {v}
            <X className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips, pílulas e botões
// ---------------------------------------------------------------------------

export function StatusChip({ ativo, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo ? "border-california-red bg-california-red text-white" : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
    </button>
  );
}

export function Chip({ ativo, onClick, label, count, tom }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? tom === "suave"
            ? "border-california-red bg-california-red/10 text-california-red"
            : "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn("tabular-nums", ativo && tom !== "suave" ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>
      )}
    </button>
  );
}

export function Busca({ value, onChange, placeholder, className }) {
  return (
    <div className={cn("relative min-w-[240px] max-w-sm flex-1", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
      />
    </div>
  );
}

export function Pill({ children, className, title }) {
  return (
    <span title={title} className={cn("inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", className)}>
      {children}
    </span>
  );
}

export const CHIP_TIPO = {
  pagar: ["A pagar", "bg-rose-50 text-rose-700"],
  receber: ["A receber", "bg-emerald-50 text-emerald-700"],
  imposto: ["Imposto", "bg-amber-50 text-amber-800"],
  transf: ["Transferência", "bg-sky-50 text-sky-700"],
};

export const ORIGEM = {
  pp: ["PP", "border-border bg-muted text-muted-foreground"],
  avulso: ["AVULSO", "border-violet-200 bg-violet-50 text-violet-700"],
  recorrencia: ["RECORRÊNCIA", "border-blue-200 bg-blue-50 text-blue-700"],
  folha: ["FOLHA", "border-rose-200 bg-rose-50 text-rose-700"],
  desembolso: ["DESEMBOLSO", "border-amber-200 bg-amber-50 text-amber-800"],
  verba: ["ESTORNO DE VERBA", "border-teal-200 bg-teal-50 text-teal-700"],
  fatura: ["FATURA", "border-slate-300 bg-slate-100 text-slate-700"],
  nf: ["NOTA FISCAL", "border-red-200 bg-red-50 text-california-red"],
  rec_avulso: ["RECEB. AVULSO", "border-violet-200 bg-violet-50 text-violet-700"],
  rendimento: ["RENDIMENTO", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  transferencia: ["TRANSFERÊNCIA", "border-sky-200 bg-sky-50 text-sky-700"],
  imposto: ["IMPOSTO", "border-amber-200 bg-amber-50 text-amber-800"],
};

export function OrigemPill({ t, curta }) {
  const [label, cls] = ORIGEM[t.origem] ?? ["—", ""];
  const texto = curta ? label : t.origem === "pp" || t.origem === "desembolso" || t.origem === "fatura" ? t.ref : label;
  return <span className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide", cls)}>{texto}</span>;
}

export function Botao({ children, onClick, variante = "primario", className, disabled, title, type = "button" }) {
  const v = {
    primario: "bg-california-red text-white hover:bg-california-red-hover",
    verde: "bg-emerald-600 text-white hover:bg-emerald-700",
    contorno: "border border-border bg-white text-foreground hover:bg-muted/50",
    contornoVermelho: "border border-california-red/40 bg-white text-california-red hover:bg-california-red/5",
    fantasma: "text-muted-foreground hover:bg-muted hover:text-foreground",
    escuro: "bg-[#282828] text-white hover:bg-black",
  }[variante];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        v,
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Diálogo e campos
// ---------------------------------------------------------------------------

export function Dialogo({ aberto, onFechar, titulo, icone: Icon, corIcone = "text-california-red", descricao, largura = 640, children, rodape }) {
  React.useEffect(() => {
    if (!aberto) return;
    const k = (e) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]" onMouseDown={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: largura }}
        className="w-full rounded-2xl border border-border bg-white shadow-elevated"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {Icon && <Icon className={cn("h-5 w-5", corIcone)} />}
              {titulo}
            </h2>
            {descricao && <p className="text-sm text-muted-foreground">{descricao}</p>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">{children}</div>
        {rodape && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{rodape}</div>}
      </div>
    </div>
  );
}

export function Campo({ label, obrigatorio, ajuda, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-xs font-semibold">
        {label}
        {obrigatorio && <span className="text-california-red"> *</span>}
      </label>
      {children}
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

export const INPUT = "h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:border-california-red focus:outline-none";

export function Entrada({ id, value, onChange, placeholder, className, type = "text", mono }) {
  return (
    <input
      id={id}
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(INPUT, mono && "font-mono", className)}
    />
  );
}

export function Escolha({ id, value, onChange, opcoes, placeholder }) {
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} className={cn(INPUT, "pr-8")}>
      {placeholder && <option value="">{placeholder}</option>}
      {opcoes.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}

export function Resumo({ itens }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-muted/50 px-4 py-3 text-sm sm:grid-cols-4">
      {itens.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <span className="block text-[11px] text-muted-foreground">{k}</span>
          <span className="block truncate font-semibold" title={typeof v === "string" ? v : undefined}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Nota({ children, tom = "neutro", icone: Icon }) {
  const t = {
    neutro: "border-dashed border-border bg-muted/30 text-muted-foreground",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    azul: "border-sky-200 bg-sky-50 text-sky-900",
    verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
    vermelho: "border-red-200 bg-red-50 text-red-900",
    violeta: "border-violet-200 bg-violet-50 text-violet-900",
  }[tom];
  return (
    <div className={cn("flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", t)}>
      {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Toast({ texto, onFechar }) {
  React.useEffect(() => {
    if (!texto) return;
    const t = setTimeout(onFechar, 7000);
    return () => clearTimeout(t);
  }, [texto, onFechar]);
  if (!texto) return null;
  return (
    <div role="status" className="fixed bottom-6 right-6 z-[1200] flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated">
      <Check className="h-4 w-4 shrink-0 text-emerald-700" />
      <span className="text-sm font-semibold text-emerald-900">{texto}</span>
      <button type="button" onClick={onFechar} aria-label="Fechar aviso" className="text-emerald-700 hover:text-emerald-900">
        ×
      </button>
    </div>
  );
}

/** O título de coluna com o funil do filtro (só o desenho: o filtro de
 *  verdade é o da decisão 165, que continua igual). */
export function Th({ children, className, alinhar = "left", semFiltro }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-3 font-semibold", alinhar === "right" ? "text-right" : alinhar === "center" ? "text-center" : "text-left", className)}>
      <span className={cn("inline-flex items-center gap-1", alinhar === "right" && "flex-row-reverse")}>
        {children}
        {!semFiltro && <ChevronDown className="h-3 w-3 opacity-50" />}
      </span>
    </th>
  );
}

export function Caixa({ marcado, onClick, desligada, title }) {
  return (
    <span
      role="checkbox"
      aria-checked={marcado}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!desligada) onClick?.();
      }}
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded border align-middle",
        marcado ? "border-california-red bg-california-red text-white" : "border-gray-300 bg-white",
        desligada ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      )}
    >
      {marcado && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/** Menu suspenso simples (o ⋯ da linha e o "Novo lançamento"). */
export function Menu({ gatilho, itens, alinhar = "right", largura = 260 }) {
  const [aberto, setAberto] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!aberto) return;
    const f = (e) => ref.current && !ref.current.contains(e.target) && setAberto(false);
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [aberto]);
  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {gatilho(() => setAberto((a) => !a), aberto)}
      {aberto && (
        <div
          style={{ width: largura }}
          className={cn("absolute top-full z-[900] mt-1 rounded-xl border border-border bg-white p-1.5 text-left shadow-elevated", alinhar === "right" ? "right-0" : "left-0")}
        >
          {itens.map((it, i) =>
            it.secao ? (
              <p key={i} className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {it.secao}
              </p>
            ) : it.divisor ? (
              <div key={i} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={i}
                type="button"
                disabled={it.desligado}
                title={it.motivo}
                onClick={() => {
                  setAberto(false);
                  it.onClick?.();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45",
                  it.perigo && "text-california-red",
                )}
              >
                {it.icone && <it.icone className={cn("mt-0.5 h-4 w-4 shrink-0", it.cor ?? "text-muted-foreground")} />}
                <span className="min-w-0">
                  <span className="block font-medium">{it.label}</span>
                  {it.ajuda && <span className="block text-[11px] leading-snug text-muted-foreground">{it.ajuda}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A dica de uma célula abreviada (o centro de custo inteiro, o rateio da
 * regional): aparece ao passar o mouse e fica presa no clique — o `title`
 * do navegador não abre no clique nem no toque. Clique fora, Esc ou rolar
 * a página fecham.
 */
export function Dica({ conteudo, children, className }) {
  const ref = React.useRef(null);
  const caixa = React.useRef(null);
  const [estado, setEstado] = React.useState(null); // null | "mouse" | "preso"
  const [pos, setPos] = React.useState(null);
  const abrir = (como) => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 300), top: r.bottom + 6 });
    setEstado(como);
  };
  React.useEffect(() => {
    if (estado !== "preso") return;
    const fora = (e) => !ref.current?.contains(e.target) && !caixa.current?.contains(e.target) && setEstado(null);
    const esc = (e) => e.key === "Escape" && setEstado(null);
    const rolou = () => setEstado(null);
    document.addEventListener("mousedown", fora);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", rolou, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", rolou, true);
    };
  }, [estado]);
  if (!conteudo) return <span className={className}>{children}</span>;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={() => !estado && abrir("mouse")}
        onMouseLeave={() => estado === "mouse" && setEstado(null)}
        onClick={(e) => {
          e.stopPropagation();
          estado === "preso" ? setEstado(null) : abrir("preso");
        }}
        className={cn("max-w-full cursor-pointer text-left", className)}
      >
        {children}
      </button>
      {estado &&
        pos &&
        createPortal(
          <div
            ref={caixa}
            role="tooltip"
            style={{ left: pos.left, top: pos.top }}
            className="fixed z-[1050] max-w-[300px] rounded-lg bg-[#282828] px-3 py-2 text-[11.5px] leading-relaxed text-white shadow-elevated"
          >
            {conteudo}
          </div>,
          document.body,
        )}
    </>
  );
}
