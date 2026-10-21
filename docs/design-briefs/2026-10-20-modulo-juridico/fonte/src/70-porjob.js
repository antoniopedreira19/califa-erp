/* ---------- Aba 2: Contratos por job ---------- */

function contratosDoJob(db, jobId, B) {
  const ppsDoJob = db.pps.filter((p) => p.jobId === jobId).map((p) => p.id);
  return db.contratos.filter((c) => visivel(c, B) && (c.parte === "cliente" || c.origem === "solicitacao" ? c.jobId === jobId : c.ppIds.some((id) => ppsDoJob.includes(id))));
}

function resumoDoJob(db, jobId, B) {
  const cs = contratosDoJob(db, jobId, B);
  const resolvidos = cs.filter((c) => RESOLVIDO.includes(c.status)).length;
  return { total: cs.length, resolvidos, cs };
}

function SeletorJob({ jobId, onTroca }) {
  const { db, B } = useStore();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const job = jobDe(db, jobId);
  const cli = CLIENTES[job.clienteId];
  const lista = [...db.jobs].sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).filter((j) => [j.codigo, j.nome, CLIENTES[j.clienteId].fantasia, j.projeto.nome].join(" ").toLowerCase().includes(q.toLowerCase()));
  return html`<div class="relative w-full max-w-[520px]">
    <button type="button" aria-haspopup="listbox" aria-expanded=${aberto} onClick=${() => setAberto(!aberto)}
      class="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-3.5 py-2.5 text-left shadow-soft hover:border-[#d6d6d6]">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-california-red/10 text-california-red"><${Icon} n="briefcase" /></span>
      <span class="min-w-0 flex-1"><span class="block truncate text-[14px] font-bold"><span class="font-mono text-[13px]">${job.codigo}</span> · ${job.nome}</span><span class="block truncate text-[12px] text-muted-foreground">${cli.fantasia} · ${job.projeto.codigo} ${job.projeto.nome}</span></span>
      <span class="hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">Trocar job</span>
      <${Icon} n="chevronDown" c="h-4 w-4 text-muted-foreground" />
    </button>
    ${aberto && html`<div class="fixed inset-0 z-30" onClick=${() => setAberto(false)}></div>
      <div class="absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-xl border border-border bg-white p-2 shadow-elevated anim-sobe">
        <${Busca} id="busca-job" valor=${q} onTroca=${setQ} placeholder="Buscar job, cliente ou projeto" />
        <ul role="listbox" class="mt-2 max-h-[320px] overflow-y-auto">
          ${lista.map((j) => {
            const r = resumoDoJob(db, j.id, B);
            return html`<li key=${j.id}><button type="button" role="option" aria-selected=${j.id === jobId} onClick=${() => { onTroca(j.id); setAberto(false); setQ(""); }}
              class=${cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[#f6f6f4]", j.id === jobId && "bg-[#f6f6f4]")}>
              <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-semibold"><span class="font-mono">${j.codigo}</span> · ${j.nome}</span><span class="block truncate text-[11.5px] text-muted-foreground">${CLIENTES[j.clienteId].fantasia} · aberto em ${dataBr(j.abertoEm)}</span></span>
              <span class=${cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold", r.resolvidos === r.total ? "bg-emerald-50 text-emerald-700" : "bg-[#f1f0ec] text-muted-foreground")}>${r.resolvidos}/${r.total}</span>
            </button></li>`;
          })}
        </ul>
      </div>`}
  </div>`;
}

function AcoesDoContrato({ c, compacto }) {
  const { abrirContrato } = useStore();
  if (!c) return null;
  const rot = c.status === "pendente" ? "Elaborar" : c.status === "elaboracao" ? "Continuar" : "Ver contrato";
  return html`<${Botao} v=${c.status === "pendente" || c.status === "elaboracao" ? "vermelho" : "secundario"} t="xs" onClick=${(e) => { e.stopPropagation(); abrirContrato(c.id); }}>${compacto && c.status !== "pendente" && c.status !== "elaboracao" ? "Ver" : rot}</${Botao}>`;
}

function Pagamento({ pp }) {
  const { db, B } = useStore();
  const s = situacaoPagamento(db, pp, B);
  return html`<span class=${cn("inline-flex items-start gap-1.5 text-[12.5px] font-semibold leading-snug", s.cls)}><${Icon} n=${s.icone} c="mt-0.5 h-3.5 w-3.5" />${s.rotulo}</span>`;
}

/* Tela inicial da aba (pedido de 21/10/2026): todos os jobs com a situação
 * dos contratos; a pasta do job só abre depois de escolher um. */
function ListaJobsDoJuridico({ onAbrir }) {
  const { db, B } = useStore();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const linhas = [...db.jobs].sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).map((j) => {
    const r = resumoDoJob(db, j.id, B);
    const forn = r.cs.filter((c) => c.parte === "fornecedor");
    const travadas = db.pps.filter((p) => p.jobId === j.id && situacaoPagamento(db, p, B).k === "travado");
    return { j, cli: CLIENTES[j.clienteId], cCli: contratoDoJob(db, j.id), forn: forn.length, fornRes: forn.filter((c) => RESOLVIDO.includes(c.status)).length, pend: r.total - r.resolvidos, travadas, valorTravado: travadas.reduce((s, p) => s + p.valor, 0) };
  });
  const busca = q.trim().toLowerCase();
  const visiveis = linhas.filter((l) => (filtro === "todos" || (filtro === "pendentes" ? l.pend > 0 : l.pend === 0)) && (!busca || [l.j.codigo, l.j.nome, l.cli.fantasia, l.j.projeto.nome, l.j.gp].join(" ").toLowerCase().includes(busca)));
  const TH = "px-4 py-3 font-semibold";
  return html`<div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2.5">
      <${Busca} id="busca-jobs-juridico" valor=${q} onTroca=${setQ} placeholder="Buscar job, cliente, projeto ou GP" class="w-full sm:w-80" />
      <${Segmentado} rotulo="Situação dos contratos" valor=${filtro} onTroca=${setFiltro} opcoes=${[
        { k: "todos", rotulo: "Todos", n: linhas.length },
        { k: "pendentes", rotulo: "Com pendências", n: linhas.filter((l) => l.pend > 0).length },
        { k: "concluidos", rotulo: "Tudo resolvido", n: linhas.filter((l) => l.pend === 0).length },
      ]} />
      <span class="ml-auto text-[12.5px] text-muted-foreground">Escolha um job para ver o contrato com o cliente e os de todos os fornecedores.</span>
    </div>
    ${visiveis.length === 0 ? html`<${Vazio} icone="briefcase" titulo="Nenhum job com esses filtros" texto="Limpe a busca ou troque o filtro de situação." />` : html`
    <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table class="w-full min-w-[1080px] table-fixed border-collapse text-sm">
        <colgroup>${[25, 14, 11, 15, 15, 12, 8].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
        <thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          <th class=${TH}>Job</th><th class=${TH}>Cliente</th><th class=${TH}>GP</th><th class=${TH}>Contrato do cliente</th><th class=${TH}>Fornecedores</th><th class=${cn(TH, "text-right")}>Pagamento travado</th><th class="py-3"><span class="sr-only">Abrir</span></th>
        </tr></thead>
        <tbody>
          ${visiveis.map((l) => html`<tr key=${l.j.id} tabIndex="0" onClick=${() => onAbrir(l.j.id)} onKeyDown=${(e) => e.key === "Enter" && onAbrir(l.j.id)} class="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-[#fafaf8] focus-visible:bg-[#fafaf8] focus-visible:outline-none">
            <td class="px-4 py-3"><p class="truncate font-semibold"><span class="font-mono text-[12.5px]">${l.j.codigo}</span> · ${l.j.nome}</p><p class="truncate text-[11.5px] text-muted-foreground">${l.j.projeto.codigo} · ${l.j.projeto.nome} · aberto em ${dataBr(l.j.abertoEm)}</p></td>
            <td class="truncate px-4 py-3 font-medium">${l.cli.fantasia}</td>
            <td class="truncate px-4 py-3">${l.j.gp}</td>
            <td class="px-4 py-3"><${SeloContrato} status=${l.cCli.status} /></td>
            <td class="px-4 py-3">${l.forn === 0 ? html`<span class="text-[12.5px] text-muted-foreground">Nenhuma PP ainda</span>` : html`
              <p class="text-[12.5px]"><b class="tabular-nums">${l.fornRes} de ${l.forn}</b> <span class="text-muted-foreground">resolvidos</span></p>
              <div class="mt-1 h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-[#efeeea]"><div class="h-full rounded-full bg-emerald-500" style=${`width:${(l.fornRes / l.forn) * 100}%`}></div></div>`}</td>
            <td class="px-4 py-3 text-right">${l.travadas.length ? html`<p class="inline-flex items-center gap-1 font-semibold tabular-nums text-[#b3323c]"><${Icon} n="lock" c="h-3.5 w-3.5" />${moeda(l.valorTravado)}</p><p class="text-[11px] text-muted-foreground">${l.travadas.length} ${l.travadas.length === 1 ? "PP" : "PPs"}</p>` : html`<span class="text-muted-foreground">—</span>`}</td>
            <td class="px-3 py-3 text-right"><span class="inline-flex items-center gap-1 text-[12.5px] font-semibold text-california-red">Abrir<${Icon} n="chevronRight" c="h-3.5 w-3.5" /></span></td>
          </tr>`)}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

function PorJob() {
  const { db, B, ui, setUi, irJob, toast } = useStore();
  const f = ui.porjob;
  const setF = (patch) => setUi((u) => ({ ...u, porjob: { ...u.porjob, ...patch } }));
  if (!f.jobId || !jobDe(db, f.jobId)) return html`<${ListaJobsDoJuridico} onAbrir=${(id) => setF({ jobId: id, fornecedor: "todos", status: "todos" })} />`;
  const job = jobDe(db, f.jobId);
  const cli = CLIENTES[job.clienteId];
  const cCli = contratoDoJob(db, job.id);
  const pps = db.pps.filter((p) => p.jobId === job.id);
  const fornecedoresDoJob = [...new Set(pps.map((p) => p.fornecedorId))];
  const r = resumoDoJob(db, job.id, B);

  const filtradas = pps.filter((p) => (f.fornecedor === "todos" || p.fornecedorId === f.fornecedor) && (f.status === "todos" || (contratoDaPP(db, p.id) || {}).status === f.status));

  const resumo = html`<div class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-white p-5 shadow-soft sm:grid-cols-3 xl:grid-cols-6">
    ${[["Cliente", cli.razao], ["Projeto", `${job.projeto.codigo} · ${job.projeto.nome}`], ["Gerente de projetos", job.gp], ["Produtor", job.produtor], ["Período", `${dataBr(job.inicio)} → ${dataBr(job.fim)}`], ["Valor aprovado", moeda(job.valor)]].map(([k, v]) => html`<div key=${k} class="min-w-0"><p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">${k}</p><p class=${cn("mt-0.5 truncate text-[13.5px] font-semibold", k === "Valor aprovado" && "tabular-nums")} title=${v}>${v}</p></div>`)}
  </div>`;

  const topo = html`<div class="flex flex-wrap items-center gap-3">
    <${Botao} v="secundario" t="sm" icone="chevronLeft" onClick=${() => setF({ jobId: null })}>Todos os jobs</${Botao}>
    <${SeletorJob} jobId=${job.id} onTroca=${(id) => setF({ jobId: id, fornecedor: "todos", status: "todos" })} />
    <div class="ml-auto flex flex-wrap gap-2">
      <${Botao} v="secundario" t="sm" icone="sheet" onClick=${() => irJob(job.id, "planilha")}>Planilha interna</${Botao}>
      <${Botao} v="secundario" t="sm" icone="external" onClick=${() => irJob(job.id, "info")}>Abrir o job</${Botao}>
      ${B && html`<${Botao} v="escuro" t="sm" icone="download" onClick=${() => toast({ titulo: "Pasta do job", texto: `No sistema, baixa ${job.codigo}-contratos.zip com os ${r.cs.filter((c) => c.arquivo).length} PDFs da pasta.` })}>Baixar pasta</${Botao}>`}
    </div>
  </div>`;

  const filtros = html`<div class="flex flex-wrap items-center gap-2">
    <${Selecao} id="filtro-fornecedor" rotulo="Fornecedor" valor=${f.fornecedor} onTroca=${(v) => setF({ fornecedor: v })} class="w-[260px]"
      opcoes=${[{ k: "todos", rotulo: `Todos os fornecedores (${fornecedoresDoJob.length})` }, ...fornecedoresDoJob.map((id) => ({ k: id, rotulo: `${FORNECEDORES[id].nome} (${pps.filter((p) => p.fornecedorId === id).length})` }))]} />
    <${Selecao} id="filtro-status-job" rotulo="Status do contrato" valor=${f.status} onTroca=${(v) => setF({ status: v })} class="w-[220px]"
      opcoes=${[{ k: "todos", rotulo: "Todos os status" }, ...Object.entries(STATUS_CONTRATO).filter(([k]) => B || (k !== "dispensado" && k !== "quadro")).map(([k, s]) => ({ k, rotulo: s.rotulo }))]} />
  </div>`;

  if (!B) {
    const TH = "px-4 py-3 font-semibold";
    return html`<div class="space-y-6">
      ${topo}${resumo}
      <section class="space-y-3">
        <h2 class="text-[15px] font-bold">Contrato com o cliente</h2>
        <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table class="w-full min-w-[980px] table-fixed border-collapse text-sm">
            <colgroup>${[24, 22, 11, 20, 13, 10].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
            <thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"><th class=${TH}>Cliente</th><th class=${TH}>Modelo</th><th class=${cn(TH, "text-right")}>Valor</th><th class=${TH}>Arquivo</th><th class=${TH}>Status</th><th class=${cn(TH, "text-center")}>Ação</th></tr></thead>
            <tbody><tr class="align-middle">
              <td class="px-4 py-3"><p class="truncate font-semibold">${cli.razao}</p><p class="text-[11.5px] tabular-nums text-muted-foreground">${cli.cnpj}</p></td>
              <td class="px-4 py-3 text-[13px]">${cCli.modeloId ? html`${modeloDe(db, cCli.modeloId)?.nome || "—"} <span class="text-muted-foreground">· v${cCli.modeloVersao}</span>` : html`<span class="text-muted-foreground">Ainda não escolhido</span>`}</td>
              <td class="px-4 py-3 text-right font-semibold tabular-nums">${moeda(job.valor)}</td>
              <td class="px-4 py-3 text-[12.5px]">${cCli.arquivoAssinado || cCli.arquivo ? html`<span class="inline-flex items-center gap-1.5 font-medium"><${Icon} n="paperclip" c="h-3.5 w-3.5 text-muted-foreground" />${cCli.arquivoAssinado || cCli.arquivo}</span>` : html`<span class="text-muted-foreground">—</span>`}</td>
              <td class="px-4 py-3"><${SeloContrato} status=${cCli.status} /></td>
              <td class="px-4 py-3 text-center"><${AcoesDoContrato} c=${cCli} /></td>
            </tr></tbody>
          </table>
        </div>
      </section>
      <section class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div><h2 class="text-[15px] font-bold">Contratos com fornecedores</h2><p class="text-[12.5px] text-muted-foreground">Um por PP. ${pps.filter((p) => RESOLVIDO.includes((contratoDaPP(db, p.id) || {}).status)).length} de ${pps.length} assinados.</p></div>
          ${filtros}
        </div>
        ${filtradas.length === 0 ? html`<${Vazio} icone="package" titulo="Nenhuma PP com esses filtros" texto="Troque o fornecedor ou o status para ver as outras PPs do job." />` : html`
        <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table class="w-full min-w-[1180px] table-fixed border-collapse text-sm">
            <colgroup>${[9, 15, 21, 9, 10, 12, 13, 3, 8].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
            <thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              <th class=${TH}>PP</th><th class=${TH}>Fornecedor</th><th class=${TH}>Serviço</th><th class=${cn(TH, "text-right")}>Valor</th><th class=${TH}>Status da PP</th><th class=${TH}>Contrato</th><th class=${TH}>Pagamento</th><th class="py-3"><span class="sr-only">Planilha</span></th><th class=${cn(TH, "text-center")}>Ação</th>
            </tr></thead>
            <tbody>
              ${filtradas.map((p) => {
                const c = contratoDaPP(db, p.id);
                return html`<tr key=${p.id} class="border-b border-border align-middle last:border-0">
                  <td class="px-4 py-3 font-mono text-[12.5px] font-semibold">${p.codigo}</td>
                  <td class="px-4 py-3"><p class="truncate font-semibold">${FORNECEDORES[p.fornecedorId].nome}</p><p class="truncate text-[11.5px] tabular-nums text-muted-foreground">${FORNECEDORES[p.fornecedorId].cnpj}</p></td>
                  <td class="px-4 py-3"><p class="truncate" title=${p.servico}>${p.servico}</p><p class="truncate text-[11.5px] text-muted-foreground">${p.grupo} · ${p.item}</p></td>
                  <td class="px-4 py-3 text-right font-semibold tabular-nums">${moeda(p.valor)}</td>
                  <td class="px-4 py-3"><${SeloPP} status=${p.status} /></td>
                  <td class="px-4 py-3">${c ? html`<${SeloContrato} status=${c.status} />` : "—"}</td>
                  <td class="px-4 py-3"><${Pagamento} pp=${p} /></td>
                  <td class="py-3"><${LinkPlanilha} planilha=${{ jobId: job.id, item: p.item }} /></td>
                  <td class="px-3 py-3 text-center"><${AcoesDoContrato} c=${c} compacto /></td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>`}
      </section>
    </div>`;
  }

  /* ----- Versão B: a pasta do job ----- */
  const contagem = (s) => r.cs.filter((c) => c.status === s).length;
  const travadas = pps.filter((p) => situacaoPagamento(db, p, B).k === "travado");
  const fornFiltrados = f.fornecedor === "todos" ? fornecedoresDoJob : [f.fornecedor];

  return html`<div class="space-y-6">
    ${topo}
    <div class="grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside class="space-y-4">
        <div class="rounded-2xl border border-border bg-white p-5 shadow-soft">
          <div class="flex items-center gap-4">
            <${Rosca} valor=${r.resolvidos} total=${r.total} tamanho=${104} />
            <div class="min-w-0 space-y-1.5 text-[12.5px]">
              ${[["assinado", "Assinados"], ["assinatura", "Em assinatura"], ["elaboracao", "Em elaboração"], ["pendente", "Pendentes"]].map(([k, rot]) => html`<p key=${k} class="flex items-center gap-2"><span class=${cn("h-2 w-2 rounded-full", k === "assinado" ? "bg-emerald-500" : k === "assinatura" ? "bg-blue-500" : k === "elaboracao" ? "bg-amber-400" : "bg-california-red")}></span><span class="flex-1 text-muted-foreground">${rot}</span><span class="font-mono font-bold">${contagem(k) + (k === "assinado" ? contagem("quadro") + contagem("dispensado") : 0)}</span></p>`)}
            </div>
          </div>
          ${travadas.length > 0 && html`<div class="mt-4 rounded-xl border border-california-red/25 bg-[#fffafa] px-3.5 py-3">
            <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#b3323c]"><${Icon} n="lock" c="h-3.5 w-3.5" />Pagamento travado</p>
            <p class="mt-1 text-[20px] font-bold tabular-nums text-[#b3323c]">${moeda(travadas.reduce((s, p) => s + p.valor, 0))}</p>
            <p class="text-[12px] text-muted-foreground">${travadas.map((p) => p.codigo).join(", ")}</p>
          </div>`}
        </div>
        <div class="rounded-2xl border border-border bg-white p-5 text-[12.5px] shadow-soft">
          <p class="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">O job</p>
          <dl class="space-y-2.5">
            ${[["Cliente", cli.fantasia], ["GP", job.gp], ["Produtor", job.produtor], ["Aberto em", `${dataBr(job.abertoEm)} por ${job.abertoPor}`], ["Período", `${dataBr(job.inicio)} → ${dataBr(job.fim)}`], ["Valor aprovado", moeda(job.valor)]].map(([k, v]) => html`<div key=${k} class="flex justify-between gap-3"><dt class="text-muted-foreground">${k}</dt><dd class="text-right font-semibold tabular-nums">${v}</dd></div>`)}
          </dl>
        </div>
      </aside>

      <div class="min-w-0 space-y-5">
        <section class="rounded-2xl border border-border bg-white shadow-soft">
          <header class="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
            <${Icon} n="folderOpen" c="h-4 w-4 text-california-red" />
            <h2 class="text-[14px] font-bold">Cliente</h2>
            <span class="text-[12.5px] text-muted-foreground">· ${cli.razao}</span>
          </header>
          <${LinhaPasta} c=${cCli} titulo=${cCli.modeloId ? modeloDe(db, cCli.modeloId)?.nome : "Contrato com o cliente"} sub=${`${job.codigo} · ${moeda(job.valor)} · ${job.condicao}`} />
        </section>

        <section class="rounded-2xl border border-border bg-white shadow-soft">
          <header class="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5">
            <${Icon} n="folderOpen" c="h-4 w-4 text-california-red" />
            <h2 class="text-[14px] font-bold">Fornecedores</h2>
            <span class="text-[12.5px] text-muted-foreground">· ${pps.length} PPs de ${fornecedoresDoJob.length} fornecedores</span>
          </header>
          <div class="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
            ${[{ k: "todos", rot: "Todos", n: pps.length }, ...fornecedoresDoJob.map((id) => ({ k: id, rot: FORNECEDORES[id].nome, n: pps.filter((p) => p.fornecedorId === id).length }))].map((o) => html`<button key=${o.k} type="button" aria-pressed=${f.fornecedor === o.k} onClick=${() => setF({ fornecedor: o.k })}
              class=${cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors", f.fornecedor === o.k ? "border-california-dark bg-california-dark text-white" : "border-border bg-white text-muted-foreground hover:text-foreground")}>${o.rot}<span class="font-mono text-[11px] opacity-70">${o.n}</span></button>`)}
          </div>
          <div class="divide-y divide-border">
            ${fornFiltrados.map((fid) => {
              const forn = FORNECEDORES[fid];
              const dele = pps.filter((p) => p.fornecedorId === fid);
              const contratos = r.cs.filter((c) => c.parte === "fornecedor" && c.ppIds.some((id) => dele.some((p) => p.id === id)));
              return html`<div key=${fid} class="px-5 py-4">
                <div class="mb-2.5 flex flex-wrap items-center gap-2">
                  <${Icon} n="building" c="h-4 w-4 text-muted-foreground" />
                  <p class="text-[13.5px] font-bold">${forn.razao}</p>
                  <span class="text-[11.5px] tabular-nums text-muted-foreground">${forn.cnpj}</span>
                  ${forn.quadro && html`<${Etiqueta} cor="verde" icone="shield">Contrato-quadro ${forn.quadro.codigo} até ${dataBr(forn.quadro.vigencia)}</${Etiqueta}>`}
                  ${contratos.some((c) => c.ppIds.length > 1) && html`<${Etiqueta} cor="roxo" icone="link">1 contrato para ${contratos.find((c) => c.ppIds.length > 1).ppIds.length} PPs</${Etiqueta}>`}
                </div>
                <div class="space-y-2">
                  ${contratos.map((c) => {
                    const ppsDoC = c.ppIds.map((id) => ppDe(db, id));
                    return html`<${LinhaPasta} key=${c.id} c=${c} embutida
                      titulo=${c.tipo === "aditivo" ? `Aditivo · ${ppsDoC[0].codigo}` : `${ppsDoC.map((p) => p.codigo).join(" + ")} · ${ppsDoC.map((p) => p.servico).join(" + ")}`}
                      sub=${c.tipo === "aditivo" ? `${moeda(c.aditivo.de)} → ${moeda(c.aditivo.para)} · ${c.aditivo.motivo}` : `${moeda(ppsDoC.reduce((s, p) => s + p.valor, 0))} · ${ppsDoC[0].condicao}`}
                      pps=${ppsDoC} />`;
                  })}
                </div>
              </div>`;
            })}
          </div>
        </section>

        ${r.cs.some((c) => c.origem === "solicitacao") && html`<section class="rounded-2xl border border-border bg-white shadow-soft">
          <header class="flex items-center gap-2.5 border-b border-border px-5 py-3.5"><${Icon} n="folderOpen" c="h-4 w-4 text-california-red" /><h2 class="text-[14px] font-bold">Solicitações avulsas</h2><span class="text-[12.5px] text-muted-foreground">· pedidas pela produção, sem PP</span></header>
          <div class="space-y-2 px-5 py-4">${r.cs.filter((c) => c.origem === "solicitacao").map((c) => html`<${LinhaPasta} key=${c.id} c=${c} embutida titulo=${`${c.codigo} · ${c.solicitacao.tipoRotulo}`} sub=${`${FORNECEDORES[c.solicitacao.fornecedorId].razao} · ${moeda(c.solicitacao.valor)}`} />`)}</div>
        </section>`}
      </div>
    </div>
  </div>`;
}

/* Uma linha da pasta: o documento (ou a pendência) e o que fazer com ele. */
function LinhaPasta({ c, titulo, sub, embutida, pps }) {
  const { db, abrirContrato } = useStore();
  const arquivo = c.arquivoAssinado || c.arquivo;
  return html`<div class=${cn("flex flex-wrap items-center gap-3", embutida ? "rounded-xl border border-border px-3.5 py-2.5" : "px-5 py-3.5")}>
    <span class=${cn("flex h-10 w-9 shrink-0 items-center justify-center rounded-md text-[9px] font-bold", arquivo ? (c.arquivoAssinado ? "bg-emerald-50 text-emerald-700" : "bg-california-red-soft text-california-red") : "border border-dashed border-[#d6d6d6] text-muted-foreground")}>${arquivo ? "PDF" : html`<${Icon} n="filePen" c="h-4 w-4" />`}</span>
    <div class="min-w-0 flex-1 basis-[240px]">
      <p class="truncate text-[13px] font-semibold" title=${titulo}>${titulo}</p>
      <p class="truncate text-[11.5px] text-muted-foreground" title=${sub}>${arquivo ? `${arquivo} · ` : ""}${sub}</p>
    </div>
    ${pps && pps.length > 0 && html`<div class="flex flex-col items-start gap-0.5">${pps.map((p) => html`<${Pagamento} key=${p.id} pp=${p} />`)}</div>`}
    <${SeloContrato} status=${c.status} />
    <${AcoesDoContrato} c=${c} compacto />
  </div>`;
}
