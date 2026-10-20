/* ---------- Telas do job (simplificadas) e telas vizinhas ---------- */

const BL = {
  orcado: { faixa: "text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]", cab: "text-[#5a76a8] bg-[#f5f9ff] border-l-2 border-l-[#cfe0f7]", cel: "bg-[#f7fbff] text-[#1e4fa3] border-l-2 border-l-[#cfe0f7]", grupo: "bg-[#e8f0fd] border-y border-y-[#cfe0f7] text-[#1e4fa3] border-l-2 border-l-[#b9d1f4]", total: "bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb] text-[#1e4fa3] border-l-2 border-l-[#b9d1f4]" },
  planejado: { faixa: "text-[#047857] bg-[#ecfdf5] border-b-[3px] border-b-[#059669] border-l-2 border-l-[#a7f3d0]", cab: "text-[#3f8a70] bg-[#f3fdf8] border-l-2 border-l-[#bdecd6]", cel: "bg-[#f6fefa] text-[#047857] border-l-2 border-l-[#bdecd6]", grupo: "bg-[#ecfdf5] border-y border-y-[#bdecd6] text-[#047857] border-l-2 border-l-[#a7f3d0]", total: "bg-[#ecfdf5] border-t-2 border-t-[#059669] text-[#047857] border-l-2 border-l-[#a7f3d0]" },
  realizado: { faixa: "text-[#c2410c] bg-[#ffedd5] border-b-[3px] border-b-[#ea580c] border-l-2 border-l-[#f9c296]", cab: "text-[#c2410c] bg-[#fff7ed] border-l-2 border-l-[#f9c296]", cel: "bg-[#fffaf5] text-[#c2410c] border-l-2 border-l-[#f9c296]", grupo: "bg-[#ffedd5] border-y border-y-[#f9c296] text-[#c2410c] border-l-2 border-l-[#f9c296]", total: "bg-[#ffedd5] border-t-2 border-t-[#ea580c] text-[#c2410c] border-l-2 border-l-[#f9c296]" },
};
const LINHA_GRUPO_NOME = "text-left px-3 bg-[#f3f2ee] border-t border-t-[#e3e1db] border-b border-b-border normal-case";
const LINHA_TOTAL_ROTULO = "text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-foreground bg-[#f3f2ee] border-t-2 border-t-foreground";

function itensDaPlanilha(db, jobId) {
  const arred = (v) => Math.round(v / 100) * 100;
  const comPP = db.pps.filter((p) => p.jobId === jobId).map((p) => ({ grupo: p.grupo, item: p.item, orcado: arred(p.valor * 1.32), planejado: arred(p.valor * 1.06), realizado: p.valor, pp: p }));
  const sem = (ITENS_SEM_PP[jobId] || []).map((i) => ({ ...i, realizado: 0, pp: null }));
  const todos = [...comPP, ...sem];
  const grupos = [...new Set(todos.map((i) => i.grupo))];
  return grupos.map((g) => ({ grupo: g, itens: todos.filter((i) => i.grupo === g) }));
}

function PlanilhaInterna({ jobId, destaque }) {
  const { db } = useStore();
  const grupos = itensDaPlanilha(db, jobId);
  const alvo = useRef(null);
  useEffect(() => { if (alvo.current) alvo.current.scrollIntoView({ block: "center", behavior: "smooth" }); }, [destaque, jobId]);
  const soma = (lista, k) => lista.reduce((s, i) => s + i[k], 0);
  const todos = grupos.flatMap((g) => g.itens);
  const NUM = "px-3 py-1.5 text-right tabular-nums";
  return html`<div class="space-y-3">
    ${destaque && html`<p class="flex items-center gap-2 text-[12.5px] text-muted-foreground"><${Icon} n="sheet" c="h-4 w-4 text-[#047857]" />Item vindo do Jurídico, destacado na planilha: <b class="text-foreground">${destaque}</b></p>`}
    <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table class="w-full min-w-[920px] table-fixed border-collapse text-[13px]">
        <colgroup>${[32, 15, 15, 15, 23].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
        <thead>
          <tr class="text-[10.5px] font-bold uppercase tracking-[0.12em]"><th class="bg-white px-3 py-2 text-left text-muted-foreground">Item</th><th class=${cn("px-3 py-2 text-right", BL.orcado.faixa)}>Orçado</th><th class=${cn("px-3 py-2 text-right", BL.planejado.faixa)}>Planejado</th><th class=${cn("px-3 py-2 text-right", BL.realizado.faixa)}>Realizado</th><th class="bg-white px-3 py-2 text-left text-muted-foreground">PP</th></tr>
          <tr class="border-b border-border text-[10px] font-semibold uppercase tracking-wider"><th class="bg-white px-3 py-1.5 text-left text-muted-foreground">Descrição</th><th class=${cn("px-3 py-1.5 text-right", BL.orcado.cab)}>Total</th><th class=${cn("px-3 py-1.5 text-right", BL.planejado.cab)}>Total</th><th class=${cn("px-3 py-1.5 text-right", BL.realizado.cab)}>Total</th><th class="bg-white px-3 py-1.5 text-left text-muted-foreground">Código · contrato</th></tr>
        </thead>
        <tbody>
          ${grupos.map((g) => [
            html`<tr key=${`g-${g.grupo}`} class="h-10 font-semibold"><td class=${LINHA_GRUPO_NOME}><span class="inline-flex items-center gap-2"><${Icon} n="chevronDown" c="h-3.5 w-3.5 text-muted-foreground" />${g.grupo}<span class="text-[11px] font-medium text-muted-foreground">${g.itens.length} ${g.itens.length === 1 ? "item" : "itens"}</span></span></td><td class=${cn(NUM, BL.orcado.grupo)}>${moeda(soma(g.itens, "orcado"))}</td><td class=${cn(NUM, BL.planejado.grupo)}>${moeda(soma(g.itens, "planejado"))}</td><td class=${cn(NUM, BL.realizado.grupo)}>${moeda(soma(g.itens, "realizado"))}</td><td class="border-y border-y-[#e3e1db] bg-[#f3f2ee]"></td></tr>`,
            ...g.itens.map((i) => {
              const on = destaque && i.item === destaque;
              const c = i.pp && contratoDaPP(db, i.pp.id);
              return html`<tr key=${i.item} ref=${on ? alvo : null} class=${cn("h-8 border-b border-[#f0efeb]", on && "linha-destaque")}>
                <td class="truncate px-3 py-1.5 pl-9">${i.item}</td>
                <td class=${cn(NUM, BL.orcado.cel)}>${moeda(i.orcado)}</td><td class=${cn(NUM, BL.planejado.cel)}>${moeda(i.planejado)}</td><td class=${cn(NUM, BL.realizado.cel)}>${i.realizado ? moeda(i.realizado) : "—"}</td>
                <td class="px-3 py-1.5">${i.pp ? html`<span class="inline-flex items-center gap-1.5"><span class="font-mono text-[11.5px] font-semibold">${i.pp.codigo}</span>${c && html`<${SeloContrato} status=${c.status} />`}</span>` : html`<span class="text-muted-foreground">—</span>`}</td>
              </tr>`;
            }),
          ])}
        </tbody>
        <tfoot><tr class="font-bold"><td class=${LINHA_TOTAL_ROTULO}>Total da planilha</td><td class=${cn(NUM, "py-2", BL.orcado.total)}>${moeda(soma(todos, "orcado"))}</td><td class=${cn(NUM, "py-2", BL.planejado.total)}>${moeda(soma(todos, "planejado"))}</td><td class=${cn(NUM, "py-2", BL.realizado.total)}>${moeda(soma(todos, "realizado"))}</td><td class="border-t-2 border-t-foreground bg-[#f3f2ee]"></td></tr></tfoot>
      </table>
    </div>
    <p class="text-[12px] text-muted-foreground">Planilha simplificada para o protótipo: só o Total de cada bloco.</p>
  </div>`;
}

function TelaJob() {
  const { db, B, ui, setUi, ir, abrirContrato } = useStore();
  const job = jobDe(db, ui.jobId);
  const cli = CLIENTES[job.clienteId];
  const pps = db.pps.filter((p) => p.jobId === job.id);
  const cCli = contratoDoJob(db, job.id);
  const aba = ui.jobAba;
  const setAba = (a) => setUi((u) => ({ ...u, jobAba: a, destaque: a === "planilha" ? u.destaque : null }));
  const travadas = pps.filter((p) => situacaoPagamento(db, p, B).k === "travado");
  const resolvidosForn = pps.filter((p) => { const c = contratoDaPP(db, p.id); return c && RESOLVIDO.includes(c.status) && !aditivoDaPP(db, p.id, B); }).length;
  const msgs = B ? db.contratos.filter((c) => (c.jobId === job.id || (c.ppIds || []).some((id) => pps.some((p) => p.id === id)))).flatMap((c) => (c.historico || []).filter((h) => h.texto.startsWith("Pedido de informação")).map((h) => ({ ...h, c }))) : [];

  const ficha = [
    ["Projeto", `${job.projeto.codigo} · ${job.projeto.nome}`], ["Cliente", cli.razao], ["Serviço", job.servico], ["Produto", job.produto],
    ["Cidade", job.cidade], ["Período", `${dataBr(job.inicio)} → ${dataBr(job.fim)}`], ["Aberto em", `${dataHoraBr(job.abertoEm)} · ${job.abertoPor}`],
    ["Gerente de projetos", job.gp], ["Produtor", job.produtor], ["Versão aprovada", job.versao], ["Valor aprovado", moeda(job.valor)], ["Condição de pagamento", job.condicao],
  ];

  return html`<div class="space-y-6">
    <div class="space-y-2">
      <button type="button" onClick=${() => ir("jobs")} class="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"><${Icon} n="chevronLeft" c="h-3.5 w-3.5" />Jobs</button>
      <div class="flex flex-wrap items-center gap-3"><span class="font-mono text-[15px] font-semibold text-muted-foreground">${job.codigo}</span><h1 class="text-2xl font-bold tracking-tight">${job.nome}</h1><${SeloJob} status=${job.status} /></div>
      <p class="text-[13px] text-muted-foreground">${job.projeto.codigo} · ${job.projeto.nome} · ${cli.fantasia}</p>
    </div>
    <p class="flex items-center gap-2 rounded-xl border border-dashed border-[#d9d8d3] bg-[#fbfbfa] px-4 py-2.5 text-[12.5px] text-muted-foreground"><${Icon} n="info" c="h-4 w-4" />Tela do job simplificada: o protótipo mostra só onde os contratos aparecem.</p>

    <${AbasJob} ativa=${aba} onTroca=${setAba} abas=${[{ k: "info", rotulo: "Informações do Job" }, { k: "planilha", rotulo: "Planilha Interna" }, { k: "pps", rotulo: "Pedidos de Produção (PPs)", n: pps.length }, { k: "chat", rotulo: "Comunicação", n: msgs.length }]} />

    ${aba === "info" && html`<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section class="rounded-2xl border border-border bg-white p-6 shadow-soft">
        <h2 class="text-[15px] font-bold">Ficha do job</h2>
        <dl class="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">${ficha.map(([k, v]) => html`<div key=${k} class="min-w-0"><dt class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">${k}</dt><dd class="mt-0.5 text-[13.5px] font-medium">${v}</dd></div>`)}</dl>
      </section>
      <div class="space-y-4">
        <section class="destaque-novo rounded-2xl border border-california-red/25 bg-white p-5 shadow-soft">
          <div class="flex items-center justify-between gap-2"><p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-california-red">Jurídico · novo</p><${SeloContrato} status=${cCli.status} /></div>
          <h2 class="mt-1.5 text-[15px] font-bold">Contrato com o cliente</h2>
          <div class="mt-3 space-y-2">
            ${cCli.arquivoAssinado && html`<${Arquivo} nome=${cCli.arquivoAssinado} sub=${`Assinado em ${dataBr(cCli.assinadoEm)}`} assinado onAbrir=${() => abrirContrato(cCli.id)} />`}
            ${cCli.arquivo && !cCli.arquivoAssinado && html`<${Arquivo} nome=${cCli.arquivo} sub="Enviado ao cliente, aguardando assinatura" onAbrir=${() => abrirContrato(cCli.id)} />`}
            ${!cCli.arquivo && html`<p class="text-[12.5px] leading-relaxed text-muted-foreground">${cCli.status === "elaboracao" ? "O jurídico está elaborando o contrato." : `O jurídico foi avisado em ${dataHoraBr(cCli.chegouEm)}.`} O contrato não trava a abertura do job nem as PPs.</p>`}
          </div>
          <button type="button" onClick=${() => ir("juridico", { aba: "porjob", jobId: job.id })} class="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-california-red hover:underline">Ver no Jurídico<${Icon} n="arrowRight" c="h-3.5 w-3.5" /></button>
        </section>
        <section class="rounded-2xl border border-border bg-white p-5 shadow-soft">
          <h2 class="text-[14px] font-bold">Contratos de fornecedores</h2>
          <p class="mt-1 text-[12.5px] text-muted-foreground">${resolvidosForn} de ${pps.length} PPs com contrato resolvido.</p>
          <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#efeeea]"><div class="h-full rounded-full bg-emerald-500" style=${`width:${pps.length ? (resolvidosForn / pps.length) * 100 : 0}%`}></div></div>
          ${travadas.length > 0 && html`<p class="mt-3 flex items-start gap-2 text-[12.5px] font-semibold text-[#b3323c]"><${Icon} n="lock" c="mt-0.5 h-3.5 w-3.5" />${travadas.length} ${travadas.length === 1 ? "PP aprovada está" : "PPs aprovadas estão"} com pagamento travado: ${travadas.map((p) => p.codigo).join(", ")}.</p>`}
          <button type="button" onClick=${() => setAba("pps")} class="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-california-red hover:underline">Ver na aba PPs<${Icon} n="arrowRight" c="h-3.5 w-3.5" /></button>
        </section>
      </div>
    </div>`}

    ${aba === "planilha" && html`<${PlanilhaInterna} jobId=${job.id} destaque=${ui.destaque} />`}

    ${aba === "pps" && html`<div class="space-y-3">
      ${travadas.length > 0 && html`<p class="flex items-start gap-2.5 rounded-xl border border-california-red/25 bg-[#fffafa] px-4 py-3 text-[13px] text-[#9f2a33]"><${Icon} n="lock" c="mt-0.5 h-4 w-4" /><span><b>${travadas.length} ${travadas.length === 1 ? "PP aprovada" : "PPs aprovadas"} pelo financeiro sem contrato assinado.</b> O pagamento só sai quando o jurídico anexar o assinado.</span></p>`}
      <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table class="w-full min-w-[1100px] table-fixed border-collapse text-sm">
          <colgroup>${[10, 16, 22, 10, 10, 15, 17].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
          <thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"><th class="px-4 py-3">Código</th><th class="px-4 py-3">Fornecedor</th><th class="px-4 py-3">Serviço</th><th class="px-4 py-3 text-right">Valor</th><th class="px-4 py-3">Status</th><th class="destaque-coluna px-4 py-3">Contrato</th><th class="destaque-coluna px-4 py-3">Pagamento</th></tr></thead>
          <tbody>
            ${pps.map((p) => {
              const c = contratoDaPP(db, p.id);
              const arq = c && (c.arquivoAssinado || c.arquivo);
              return html`<tr key=${p.id} class="border-b border-border align-middle last:border-0">
                <td class="px-4 py-3 font-mono text-[12.5px] font-semibold">${p.codigo}</td>
                <td class="truncate px-4 py-3 font-medium">${FORNECEDORES[p.fornecedorId].nome}</td>
                <td class="px-4 py-3"><p class="truncate">${p.servico}</p><p class="truncate text-[11.5px] text-muted-foreground">${p.grupo} · ${p.item}</p></td>
                <td class="px-4 py-3 text-right font-semibold tabular-nums">${moeda(p.valor)}</td>
                <td class="px-4 py-3"><${SeloPP} status=${p.status} /></td>
                <td class="destaque-coluna px-4 py-3">${c ? html`<div class="flex flex-col items-start gap-1"><${SeloContrato} status=${c.status} />${arq && html`<button type="button" onClick=${() => abrirContrato(c.id)} class="inline-flex max-w-full items-center gap-1 truncate text-[11.5px] font-semibold text-california-red hover:underline"><${Icon} n="paperclip" c="h-3 w-3" />${arq}</button>`}</div>` : "—"}</td>
                <td class="destaque-coluna px-4 py-3"><${Pagamento} pp=${p} /></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <p class="text-[12px] text-muted-foreground">As colunas Contrato e Pagamento são novas. O financeiro vê a mesma trava no Contas a Pagar.</p>
    </div>`}

    ${aba === "chat" && (msgs.length ? html`<div class="space-y-3">${msgs.map((m, i) => html`<div key=${i} class="max-w-2xl rounded-2xl border border-border bg-white p-4 shadow-soft"><p class="text-[12px] font-semibold text-california-red">${m.por} · Jurídico</p><p class="mt-1 text-[13.5px]">${m.texto.replace(/^Pedido de informação enviado a [^:]+: /, "").replace(/^"|"$/g, "")}</p><p class="mt-1.5 text-[11px] text-muted-foreground">${dataHoraBr(m.em)} · sobre ${infoContrato(db, m.c).codigo}</p></div>`)}</div>`
      : html`<${Vazio} icone="message" titulo="Comunicação do job" texto=${B ? "Quando o jurídico usar “Pedir ao produtor”, a pergunta aparece aqui." : "Fora do escopo do protótipo."} />`)}
  </div>`;
}

function ListaJobs() {
  const { db, irJob } = useStore();
  return html`<div class="space-y-6">
    <${Cabecalho} kicker="Operação" icone="briefcase" titulo="Jobs" descricao="Lista simplificada para o protótipo, com a nova coluna do contrato com o cliente." />
    <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table class="w-full min-w-[900px] table-fixed border-collapse text-sm">
        <colgroup>${[11, 27, 20, 12, 14, 16].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
        <thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"><th class="px-4 py-3">Código</th><th class="px-4 py-3">Job</th><th class="px-4 py-3">Cliente</th><th class="px-4 py-3">Status</th><th class="px-4 py-3 text-right">Valor</th><th class="destaque-coluna px-4 py-3">Contrato do cliente</th></tr></thead>
        <tbody>${[...db.jobs].sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).map((j) => html`<tr key=${j.id} tabIndex="0" onClick=${() => irJob(j.id, "info")} onKeyDown=${(e) => e.key === "Enter" && irJob(j.id, "info")} class="cursor-pointer border-b border-border last:border-0 hover:bg-[#fafaf8]">
          <td class="px-4 py-3 font-mono text-[12.5px] font-semibold">${j.codigo}</td><td class="truncate px-4 py-3 font-semibold">${j.nome}</td><td class="truncate px-4 py-3">${CLIENTES[j.clienteId].fantasia}</td><td class="px-4 py-3"><${SeloJob} status=${j.status} /></td><td class="px-4 py-3 text-right tabular-nums">${moeda(j.valor)}</td><td class="destaque-coluna px-4 py-3"><${SeloContrato} status=${contratoDoJob(db, j.id).status} /></td>
        </tr>`)}</tbody>
      </table>
    </div>
  </div>`;
}

function TelaSuprimentos() {
  const { db, acoes, B } = useStore();
  const recentes = [...db.pps].sort((a, b) => b.geradaEm.localeCompare(a.geradaEm)).slice(0, 6);
  return html`<div class="space-y-6">
    <${Cabecalho} kicker="Operação" icone="package" titulo="Suprimentos" descricao="O módulo de Suprimentos tem protótipo próprio. Aqui fica só o elo com o Jurídico: cada PP gerada vira um contrato pendente." />
    <div class="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div class="min-w-0 flex-1"><p class="text-[14px] font-bold">Último passo de Suprimentos: gerar a PP</p><p class="text-[12.5px] text-muted-foreground">Ao gerar, o sistema cria o contrato com o fornecedor na caixa de entrada do Jurídico e avisa no sino.</p></div>
      <${Botao} icone="zap" onClick=${acoes.simularPP}>Simular PP gerada</${Botao}>
    </div>
    <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table class="w-full min-w-[860px] table-fixed border-collapse text-sm">
        <colgroup>${[12, 22, 30, 13, 23].map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
        <thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"><th class="px-4 py-3">PP</th><th class="px-4 py-3">Fornecedor</th><th class="px-4 py-3">Serviço</th><th class="px-4 py-3">Gerada</th><th class="px-4 py-3">Contrato no Jurídico</th></tr></thead>
        <tbody>${recentes.map((p) => html`<tr key=${p.id} class="border-b border-border last:border-0"><td class="px-4 py-3 font-mono text-[12.5px] font-semibold">${p.codigo}</td><td class="truncate px-4 py-3">${FORNECEDORES[p.fornecedorId].nome}</td><td class="truncate px-4 py-3">${p.servico}</td><td class="px-4 py-3 tabular-nums">${dataHoraBr(p.geradaEm)}</td><td class="px-4 py-3"><${SeloContrato} status=${(contratoDaPP(db, p.id, B) || {}).status || "pendente"} /></td></tr>`)}</tbody>
      </table>
    </div>
  </div>`;
}

const TELAS_FORA = {
  home: ["home", "Home", "Início"], orcamentos: ["fileText", "Orçamentos", "Comercial"], desembolsos: ["wallet", "Desembolsos", "Financeiro"],
  financeiro: ["landmark", "Financeiro", "Financeiro"], relatorios: ["barChart", "Relatórios", "Gestão"], rh: ["users", "RH", "Pessoas"], freelancers: ["userCheck", "Freelancers", "Pessoas"],
};
function TelaFora({ tela }) {
  const { ir } = useStore();
  const [ic, tit, kick] = TELAS_FORA[tela];
  return html`<div class="space-y-6"><${Cabecalho} kicker=${kick} icone=${ic} titulo=${tit} />
    <${Vazio} icone=${ic} titulo="Fora do protótipo" texto="Esta tela já existe no ERP e não muda com o módulo Jurídico."><${Botao} v="secundario" t="sm" icone="scale" onClick=${() => ir("juridico")}>Voltar ao Jurídico</${Botao}></${Vazio}>
  </div>`;
}
