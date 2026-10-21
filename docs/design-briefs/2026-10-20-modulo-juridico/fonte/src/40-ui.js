/* ---------- Peças de interface (mesma gramática do ERP) ---------- */

const BOTAO_BASE = "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/40";
const BOTAO_VAR = {
  primario: "bg-california-red text-white shadow-sm hover:bg-california-red-hover",
  escuro: "bg-california-dark text-white hover:bg-california-dark-soft",
  secundario: "border border-border bg-white text-foreground hover:bg-[#f4f4f4]",
  vermelho: "border border-california-red/30 bg-white text-california-red hover:bg-california-red-soft",
  fantasma: "text-muted-foreground hover:bg-[#f1f1f1] hover:text-foreground",
  perigo: "bg-[#b42318] text-white hover:bg-[#912018]",
};
const BOTAO_TAM = { md: "h-9 px-4 text-[13px]", sm: "h-8 px-3 text-[12.5px]", xs: "h-7 px-2.5 text-[12px]", icone: "h-8 w-8", iconeSm: "h-7 w-7" };

function Botao({ v = "primario", t = "md", icone, children, class: extra, ...p }) {
  return html`<button type="button" class=${cn(BOTAO_BASE, BOTAO_VAR[v], BOTAO_TAM[t], extra)} ...${p}>${icone && html`<${Icon} n=${icone} c=${t === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />`}${children}</button>`;
}

const SELO = "inline-flex items-center gap-1 rounded-[11px] border px-2.5 py-0.5 text-[10px] font-semibold uppercase leading-[1.35] tracking-wider";

function SeloContrato({ status, class: extra }) {
  const s = STATUS_CONTRATO[status] || STATUS_CONTRATO.pendente;
  return html`<span class=${cn(SELO, s.cls, extra)}>${s.rotulo}</span>`;
}
function SeloPP({ status }) {
  const s = PP_STATUS[status];
  return html`<span class=${cn(SELO, "whitespace-nowrap", s.cls)}>${s.rotulo}</span>`;
}
function SeloJob({ status }) {
  const s = JOB_STATUS[status] || JOB_STATUS.aberto;
  return html`<span class=${cn(SELO, "whitespace-nowrap", s.cls)}>${s.rotulo}</span>`;
}

const ORIGENS = {
  job: { rotulo: "Job aberto", icone: "briefcase", cls: "border-[#cfd8e3] bg-[#f3f6fa] text-[#3b4a5e]" },
  pp: { rotulo: "PP gerada", icone: "package", cls: "border-[#e2dccd] bg-[#f8f5ee] text-[#6b5a35]" },
  aditivo: { rotulo: "Aditivo", icone: "layers", cls: "border-[#e9d5ff] bg-[#faf5ff] text-[#7e22ce]" },
  solicitacao: { rotulo: "Solicitação", icone: "message", cls: "border-[#cfe0f7] bg-[#f5f9ff] text-[#1e4fa3]" },
};
function SeloOrigem({ origem }) {
  const o = ORIGENS[origem];
  return html`<span class=${cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold", o.cls)}><${Icon} n=${o.icone} c="h-3 w-3" />${o.rotulo}</span>`;
}

/* Etiqueta pequena de contexto ("Mesmo fornecedor", "Abaixo do limite"…). */
const ETIQUETAS = {
  roxo: "bg-[#faf5ff] text-[#7e22ce] border-[#e9d5ff]",
  verde: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cinza: "bg-[#f4f4f2] text-[#5f5d57] border-[#e2e0da]",
  azul: "bg-blue-50 text-blue-700 border-blue-200",
  ambar: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]",
};
function Etiqueta({ cor = "cinza", icone, children }) {
  return html`<span class=${cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-[10.5px] font-semibold", ETIQUETAS[cor])}>${icone && html`<${Icon} n=${icone} c="h-3 w-3" />`}${children}</span>`;
}

function Cabecalho({ kicker, icone, titulo, descricao, children }) {
  return html`<header class="flex flex-wrap items-end justify-between gap-4">
    <div class="space-y-2 min-w-0">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">${kicker}</p>
      <div class="flex items-center gap-3">
        <div class="rounded-lg bg-california-red/10 p-2"><${Icon} n=${icone} c="h-5 w-5 text-california-red" /></div>
        <h1 class="text-3xl font-bold tracking-tight">${titulo}</h1>
      </div>
      ${descricao && html`<p class="max-w-2xl text-sm text-muted-foreground">${descricao}</p>`}
    </div>
    ${children && html`<div class="flex flex-wrap items-center gap-2">${children}</div>`}
  </header>`;
}

/* Abas no padrão da Abertura de Job: rótulo + contagem em pílula. */
function Abas({ abas, ativa, onTroca, rotulo }) {
  return html`<div role="tablist" aria-label=${rotulo} class="flex items-center gap-1 overflow-x-auto border-b border-border">
    ${abas.map((a) => {
      const on = ativa === a.k;
      return html`<button key=${a.k} type="button" role="tab" aria-selected=${on} onClick=${() => onTroca(a.k)}
        class=${cn("mr-5 inline-flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors", on ? "border-california-red text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
        ${a.icone && html`<${Icon} n=${a.icone} c=${cn("h-4 w-4", on ? "text-california-red" : "")} />`}
        ${a.rotulo}
        ${a.n != null && html`<span class=${cn("inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold", on ? "bg-california-red/10 text-[#b3323c]" : "bg-[#f1f0ec] text-muted-foreground")}>${a.n}</span>`}
      </button>`;
    })}
  </div>`;
}

/* Abas do job (mesma forma de job-tabs.tsx). */
function AbasJob({ abas, ativa, onTroca }) {
  return html`<div role="tablist" aria-label="Seções do job" class="flex items-center gap-1 overflow-x-auto border-b border-border">
    ${abas.map((a) => html`<button key=${a.k} type="button" role="tab" aria-selected=${ativa === a.k} onClick=${() => onTroca(a.k)}
      class=${cn("shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors", ativa === a.k ? "border-california-red text-california-red" : "border-transparent text-muted-foreground hover:text-foreground")}>
      ${a.rotulo}${a.n ? html`<span class="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">${a.n}</span>` : null}
    </button>`)}
  </div>`;
}

function Segmentado({ opcoes, valor, onTroca, rotulo }) {
  return html`<div role="radiogroup" aria-label=${rotulo} class="inline-flex rounded-lg border border-border bg-white p-0.5">
    ${opcoes.map((o) => html`<button key=${o.k} type="button" role="radio" aria-checked=${valor === o.k} onClick=${() => onTroca(o.k)}
      class=${cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors", valor === o.k ? "bg-california-dark text-white" : "text-muted-foreground hover:text-foreground")}>
      ${o.icone && html`<${Icon} n=${o.icone} c="h-3.5 w-3.5" />`}${o.rotulo}${o.n != null && html`<span class=${cn("font-mono text-[11px]", valor === o.k ? "text-white/70" : "text-muted-foreground/70")}>${o.n}</span>`}
    </button>`)}
  </div>`;
}

const CAMPO = "h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-california-red/50 focus:ring-2 focus:ring-california-red/15";
const AREA = "w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-california-red/50 focus:ring-2 focus:ring-california-red/15";

function Selecao({ id, valor, onTroca, opcoes, class: extra, rotulo }) {
  return html`<div class=${cn("relative", extra)}>
    <select id=${id} aria-label=${rotulo} value=${valor} onChange=${(e) => onTroca(e.target.value)} class=${cn(CAMPO, "appearance-none pr-8 font-medium")}>
      ${opcoes.map((o) => html`<option key=${o.k} value=${o.k}>${o.rotulo}</option>`)}
    </select>
    <${Icon} n="chevronDown" c="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </div>`;
}

function Busca({ id, valor, onTroca, placeholder, class: extra }) {
  return html`<div class=${cn("relative flex items-center", extra)}>
    <${Icon} n="search" c="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
    <input id=${id} type="search" value=${valor} onInput=${(e) => onTroca(e.target.value)} placeholder=${placeholder}
      class="h-[38px] w-full rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none focus:border-california-red/40" />
  </div>`;
}

function Rotulo({ para, children, obrigatorio, extra }) {
  return html`<label for=${para} class="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">${children}${obrigatorio && html`<span class="text-california-red">*</span>`}${extra}</label>`;
}

/* Janela grande centralizada (até 21/10/2026 era uma gaveta lateral; o
 * pedido foi ganhar largura). Fecha com Esc e com clique fora. No celular
 * ocupa a tela toda. */
function Gaveta({ aberta, onFechar, largura = "max-w-[1480px]", children, rotulo }) {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = ""; };
  }, [aberta]);
  if (!aberta) return null;
  return html`<div class="janela-grande fixed inset-0 z-50 flex items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label=${rotulo}>
    <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px] anim-fade" onClick=${onFechar}></div>
    <div class=${cn("relative flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl anim-janela sm:rounded-2xl sm:border sm:border-black/5", largura)}>${children}</div>
  </div>`;
}

function Modal({ aberta, onFechar, titulo, descricao, children, rodape, largura = "max-w-lg" }) {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta]);
  if (!aberta) return null;
  return html`<div class="fixed inset-0 z-[60] flex items-center justify-center p-4 modal-seguro" role="dialog" aria-modal="true" aria-label=${titulo}>
    <div class="absolute inset-0 bg-black/40 anim-fade" onClick=${onFechar}></div>
    <div class=${cn("relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-elevated anim-sobe", largura)}>
      <div class="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div class="min-w-0"><h2 class="text-lg font-bold tracking-tight">${titulo}</h2>${descricao && html`<p class="mt-1 text-[13px] text-muted-foreground">${descricao}</p>`}</div>
        <button type="button" onClick=${onFechar} aria-label="Fechar" class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><${Icon} n="x" /></button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">${children}</div>
      ${rodape && html`<div class="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-[#fbfbfa] px-6 py-3.5">${rodape}</div>`}
    </div>
  </div>`;
}

/* Menu de ações em posição fixa: a tabela vive num overflow-x-auto, e um
 * popover absoluto seria cortado nas últimas linhas. */
function MenuAcoes({ itens, rotulo = "Mais ações" }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  useEffect(() => {
    if (!pos) return;
    const fechar = () => setPos(null);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => { window.removeEventListener("scroll", fechar, true); window.removeEventListener("resize", fechar); };
  }, [pos]);
  const abrir = (e) => {
    e.stopPropagation();
    const r = btn.current.getBoundingClientRect();
    const alto = itens.length * 36 + 12;
    const top = r.bottom + alto > window.innerHeight - 8 ? r.top - alto - 4 : r.bottom + 4;
    setPos({ top, left: Math.max(8, Math.min(r.right - 248, window.innerWidth - 256)) });
  };
  return html`<span onClick=${(e) => e.stopPropagation()}>
    <button ref=${btn} type="button" aria-label=${rotulo} aria-haspopup="menu" aria-expanded=${!!pos} onClick=${abrir} class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#efefef] hover:text-foreground"><${Icon} n="more" /></button>
    ${pos && html`<div class="fixed inset-0 z-[70]" onClick=${() => setPos(null)}></div>
      <div role="menu" class="fixed z-[71] w-[248px] rounded-xl border border-border bg-white p-1.5 shadow-elevated anim-sobe" style=${`top:${pos.top}px;left:${pos.left}px`}>
        ${itens.map((it) => html`<button key=${it.rotulo} type="button" role="menuitem" disabled=${it.desabilitado} onClick=${() => { setPos(null); it.fn(); }}
          class=${cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium disabled:opacity-40", it.perigo ? "text-[#b42318] hover:bg-red-50" : "text-foreground hover:bg-[#f4f4f2]")}>
          <${Icon} n=${it.icone} c="h-4 w-4 text-muted-foreground" />${it.rotulo}
        </button>`)}
      </div>`}
  </span>`;
}

function Vazio({ icone = "inbox", titulo, texto, children }) {
  return html`<div class="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center">
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><${Icon} n=${icone} c="h-5 w-5" /></div>
    <p class="text-base font-semibold">${titulo}</p>
    ${texto && html`<p class="max-w-[420px] text-[13.5px] text-muted-foreground">${texto}</p>`}
    ${children}
  </div>`;
}

/* Botão de ícone da coluna "planilha" — leva ao item na planilha interna. */
function LinkPlanilha({ planilha, titulo }) {
  const { irJob } = useStore();
  return html`<button type="button" title=${titulo || (planilha.item ? `Ver “${planilha.item}” na planilha interna` : "Abrir a planilha interna do job")} aria-label="Ver na planilha interna"
    onClick=${(e) => { e.stopPropagation(); irJob(planilha.jobId, "planilha", planilha.item); }}
    class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#047857] hover:bg-[#ecfdf5]"><${Icon} n="sheet" c="h-4 w-4" /></button>`;
}

/* Arquivo anexado (PDF). Abrir mostra o contrato no visualizador. */
function Arquivo({ nome, sub, onAbrir, assinado }) {
  return html`<button type="button" onClick=${onAbrir} class="group flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5 text-left hover:border-california-red/30 hover:bg-[#fffafa]">
    <span class=${cn("flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-[9px] font-bold", assinado ? "bg-emerald-50 text-emerald-700" : "bg-california-red-soft text-california-red")}>PDF</span>
    <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-semibold">${nome}</span>${sub && html`<span class="block truncate text-[11.5px] text-muted-foreground">${sub}</span>`}</span>
    <${Icon} n="eye" c="h-4 w-4 text-muted-foreground group-hover:text-california-red" />
  </button>`;
}

function Toasts({ itens, onFechar }) {
  return html`<div class="toasts pointer-events-none fixed z-[80] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
    ${itens.map((t) => html`<div key=${t.id} class="pointer-events-auto flex gap-3 rounded-xl border border-border bg-white p-3.5 shadow-elevated anim-sobe">
      <span class=${cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", t.sino ? "bg-california-red/10 text-california-red" : "bg-emerald-50 text-emerald-700")}><${Icon} n=${t.sino ? "bell" : "check"} c="h-3.5 w-3.5" /></span>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-semibold">${t.titulo}</p>
        <p class="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">${t.texto}</p>
        ${t.acao && html`<button type="button" class="mt-1.5 text-[12.5px] font-semibold text-california-red hover:underline" onClick=${() => { t.acao.fn(); onFechar(t.id); }}>${t.acao.rotulo} →</button>`}
      </div>
      <button type="button" aria-label="Fechar aviso" onClick=${() => onFechar(t.id)} class="self-start rounded p-0.5 text-muted-foreground hover:text-foreground"><${Icon} n="x" c="h-3.5 w-3.5" /></button>
    </div>`)}
  </div>`;
}

/* Rosca de progresso (assinados ÷ total), desenhada a escala. */
function Rosca({ valor, total, tamanho = 112 }) {
  const r = 44, circ = 2 * Math.PI * r, frac = total ? valor / total : 0;
  return html`<svg width=${tamanho} height=${tamanho} viewBox="0 0 112 112" role="img" aria-label=${`${valor} de ${total} contratos resolvidos`}>
    <circle cx="56" cy="56" r=${r} fill="none" stroke="#efeeea" stroke-width="12" />
    <circle cx="56" cy="56" r=${r} fill="none" stroke="#059669" stroke-width="12" stroke-linecap="round" stroke-dasharray=${`${circ * frac} ${circ}`} transform="rotate(-90 56 56)" />
    <text x="56" y="54" text-anchor="middle" font-size="22" font-weight="700" fill="#282828" style="font-variant-numeric:tabular-nums">${valor}/${total}</text>
    <text x="56" y="72" text-anchor="middle" font-size="10" font-weight="600" fill="#6b6b6b">resolvidos</text>
  </svg>`;
}

/* Severidade de prazo: faixa à esquerda da linha. */
const FAIXA_URGENCIA = { alta: "faixa-alta", media: "faixa-media", baixa: "" };
const TEXTO_URGENCIA = { alta: "text-[#b3323c]", media: "text-[#92400e]", baixa: "text-muted-foreground" };
