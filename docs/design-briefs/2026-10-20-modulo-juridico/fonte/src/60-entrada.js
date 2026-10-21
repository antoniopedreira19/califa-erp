/* ---------- Aba 1: Caixa de entrada ---------- */

const LIMITE_DISPENSA = 5000;

function linhasDaEntrada(db) {
  return contratosEmAberto(db).map((c) => infoContrato(db, c));
}

/* Outras PPs do mesmo fornecedor no mesmo job, ainda sem contrato. */
function ppsIrmasSemContrato(db, info) {
  if (info.c.parte !== "fornecedor" || info.c.tipo === "aditivo" || info.origem === "solicitacao") return [];
  return db.pps.filter((p) => p.jobId === info.job.id && p.fornecedorId === info.pp.fornecedorId && !info.c.ppIds.includes(p.id) && p.status !== "pago").filter((p) => {
    const c = contratoDaPP(db, p.id);
    return c && c.status === "pendente" && c.ppIds.length === 1;
  });
}

function etiquetas(db, info) {
  const out = [];
  if (info.c.tipo === "aditivo") out.push(html`<${Etiqueta} cor="roxo" icone="layers">${moeda(info.c.aditivo.de)} → ${moeda(info.c.aditivo.para)}</${Etiqueta}>`);
  const irmas = ppsIrmasSemContrato(db, info);
  if (irmas.length) out.push(html`<${Etiqueta} cor="roxo" icone="link">+${irmas.length} PP do mesmo fornecedor</${Etiqueta}>`);
  if (info.contraparte.quadro && info.c.tipo !== "aditivo") out.push(html`<${Etiqueta} cor="verde" icone="shield">Contrato-quadro ${info.contraparte.quadro.codigo}</${Etiqueta}>`);
  if (info.c.parte === "fornecedor" && info.c.tipo !== "aditivo" && info.valor < LIMITE_DISPENSA) out.push(html`<${Etiqueta} cor="cinza">Abaixo do limite</${Etiqueta}>`);
  if (info.origem === "solicitacao") out.push(html`<${Etiqueta} cor="azul" icone="message">Pedido de ${info.c.solicitacao.solicitante}</${Etiqueta}>`);
  return out;
}

function rotuloAcao(status) {
  return status === "pendente" ? "Elaborar" : status === "elaboracao" ? "Continuar" : "Ver";
}

function Kpis({ db, linhas, filtro, onFiltro }) {
  const n = (s) => linhas.filter((l) => l.c.status === s).length;
  const travadas = db.pps.filter((p) => situacaoPagamento(db, p).k === "travado");
  const valorTravado = travadas.reduce((s, p) => s + p.valor, 0);
  const cli = linhas.filter((l) => l.c.status === "pendente" && l.c.parte === "cliente").length;
  const tiles = [
    { k: "pendente", rot: "Pendentes", v: n("pendente"), sub: `${cli} de clientes · ${n("pendente") - cli} de fornecedores` },
    { k: "elaboracao", rot: "Em elaboração", v: n("elaboracao"), sub: "Rascunhos salvos" },
    { k: "assinatura", rot: "Aguardando assinatura", v: n("assinatura"), sub: "Gerados, sem o assinado anexado" },
    { k: "travado", rot: "Pagamentos travados", v: moeda(valorTravado), sub: `${travadas.length} PPs aprovadas pelo financeiro sem contrato`, alerta: true },
  ];
  return html`<div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
    ${tiles.map((t) => {
      const on = filtro === t.k;
      return html`<button key=${t.k} type="button" aria-pressed=${on} onClick=${() => onFiltro(on ? "todos" : t.k)}
        class=${cn("min-w-0 rounded-2xl border p-4 text-left shadow-soft transition-colors", t.alerta ? "border-california-red/30 bg-[#fffafa] hover:bg-[#fff3f4]" : "border-border bg-white hover:bg-[#fcfcfb]", on && "ring-2 ring-california-red/35")}>
        <p class=${cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]", t.alerta ? "text-[#b3323c]" : "text-muted-foreground")}>${t.alerta && html`<${Icon} n="lock" c="h-3.5 w-3.5" />`}${t.rot}</p>
        <p class=${cn("mt-1.5 truncate text-[21px] sm:text-[26px] font-bold leading-none tracking-tight tabular-nums", t.alerta && "text-[#b3323c]")}>${t.v}</p>
        <p class="mt-2 text-[12px] leading-snug text-muted-foreground">${t.sub}</p>
      </button>`;
    })}
  </div>`;
}

function Entrada() {
  const { db, ui, setUi, abrirContrato, irJob, abrirModal } = useStore();
  const f = ui.entrada;
  const setF = (patch) => setUi((u) => ({ ...u, entrada: { ...u.entrada, ...patch } }));
  const todas = linhasDaEntrada(db);

  let linhas = todas.filter((l) => (f.origem === "todos" ? true : l.c.parte === f.origem));
  if (f.status === "travado") linhas = linhas.filter((l) => l.pps.some((p) => situacaoPagamento(db, p).k === "travado"));
  else if (f.status !== "todos") linhas = linhas.filter((l) => l.c.status === f.status);
  const q = f.busca.trim().toLowerCase();
  if (q) linhas = linhas.filter((l) => [l.codigo, l.contraparte.nome, l.contraparte.razao, l.job.codigo, l.job.nome, CLIENTES[l.job.clienteId].fantasia].join(" ").toLowerCase().includes(q));
  const ordenarPorUrgencia = f.ordem === "urgencia";
  linhas = [...linhas].sort((a, b) => (ordenarPorUrgencia ? a.urgencia.dias - b.urgencia.dias : 0) || b.c.chegouEm.localeCompare(a.c.chegouEm));

  const contagem = (o) => todas.filter((l) => (o === "todos" ? true : l.c.parte === o)).length;
  const statusOpcoes = [
    { k: "todos", rotulo: "Todos os status" },
    { k: "pendente", rotulo: "Pendente" },
    { k: "elaboracao", rotulo: "Em elaboração" },
    { k: "assinatura", rotulo: "Aguardando assinatura" },
    { k: "travado", rotulo: "Com pagamento travado" },
  ];

  const acoesDaLinha = (l) => {
    const itens = [
      { rotulo: l.c.status === "assinatura" ? "Ver contrato" : "Elaborar contrato", icone: "filePen", fn: () => abrirContrato(l.c.id) },
      { rotulo: "Ver na planilha interna", icone: "sheet", fn: () => irJob(l.job.id, "planilha", l.planilha.item) },
      { rotulo: "Abrir o job", icone: "briefcase", fn: () => irJob(l.job.id, l.c.parte === "cliente" ? "info" : "pps") },
    ];
    if (l.c.parte === "fornecedor" && l.c.status !== "assinatura" && l.origem !== "solicitacao") {
      itens.push({ rotulo: "Pedir informação ao produtor", icone: "message", fn: () => abrirModal({ tipo: "pedir", id: l.c.id }) });
      if (l.contraparte.quadro && l.c.tipo !== "aditivo") itens.push({ rotulo: `Vincular ao ${l.contraparte.quadro.codigo}`, icone: "shield", fn: () => abrirModal({ tipo: "quadro", id: l.c.id }) });
      if (l.c.tipo !== "aditivo") itens.push({ rotulo: "Dispensar contrato", icone: "ban", fn: () => abrirModal({ tipo: "dispensa", id: l.c.id }) });
    }
    return itens;
  };

  const COLUNAS = [9, 9, 18, 16, 10, 14, 11, 3, 10];
  const TH = "px-4 py-3 font-semibold";

  return html`<div class="space-y-5">
    ${html`<${Kpis} db=${db} linhas=${todas} filtro=${f.status} onFiltro=${(s) => setF({ status: s })} />`}

    <div class="flex flex-wrap items-center gap-2.5">
      <${Busca} id="busca-entrada" valor=${f.busca} onTroca=${(v) => setF({ busca: v })} placeholder="Buscar por job, PP, cliente ou fornecedor" class="w-full sm:w-80" />
      <${Segmentado} rotulo="Origem" valor=${f.origem} onTroca=${(v) => setF({ origem: v })} opcoes=${[
        { k: "todos", rotulo: "Todos", n: contagem("todos") },
        { k: "cliente", rotulo: "Clientes", icone: "briefcase", n: contagem("cliente") },
        { k: "fornecedor", rotulo: "Fornecedores", icone: "package", n: contagem("fornecedor") },
      ]} />
      <${Selecao} id="status-entrada" rotulo="Status" valor=${f.status} onTroca=${(v) => setF({ status: v })} opcoes=${statusOpcoes} class="w-[210px]" />
      ${html`<${Selecao} id="ordem-entrada" rotulo="Ordenar" valor=${f.ordem} onTroca=${(v) => setF({ ordem: v })} opcoes=${[{ k: "urgencia", rotulo: "Ordenar por prazo" }, { k: "chegada", rotulo: "Ordenar por chegada" }]} class="w-[190px]" />`}
      <div class="ml-auto flex items-center gap-3">
        <span class="text-[12.5px] text-muted-foreground">${linhas.length} ${linhas.length === 1 ? "contrato" : "contratos"} em aberto</span>
        ${html`<${Segmentado} rotulo="Visão" valor=${f.visao} onTroca=${(v) => setF({ visao: v })} opcoes=${[{ k: "lista", rotulo: "Lista", icone: "list" }, { k: "quadro", rotulo: "Quadro", icone: "grid" }]} />`}
      </div>
    </div>

    ${f.visao === "quadro" ? html`<${Quadro} linhas=${linhas} />` : linhas.length === 0 ? html`<${Vazio} icone="fileCheck" titulo="Nenhum contrato em aberto com esses filtros" texto="Limpe a busca ou troque o filtro de origem e de status para ver a fila inteira." />` : html`
    <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table class="w-full min-w-[1180px] table-fixed border-collapse text-sm">
        <colgroup>${COLUNAS.map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>
        <thead>
          <tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            <th class=${TH}>Origem</th><th class=${TH}>Código</th><th class=${TH}>Contraparte</th><th class=${TH}>Job</th>
            <th class=${cn(TH, "text-right")}>Valor</th>
            <th class=${TH}>Prazo</th>
            <th class=${TH}>Status</th><th class="py-3"><span class="sr-only">Planilha interna</span></th><th class=${cn(TH, "text-center")}>Ação</th>
          </tr>
        </thead>
        <tbody>
          ${linhas.map((l) => html`<tr key=${l.c.id} tabIndex="0" onClick=${() => abrirContrato(l.c.id)} onKeyDown=${(e) => { if (e.key === "Enter") abrirContrato(l.c.id); }}
            class="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-[#fafaf8] focus-visible:bg-[#fafaf8] focus-visible:outline-none">
            <td class=${cn("px-4 py-3 align-middle", FAIXA_URGENCIA[l.urgencia.nivel])}>
              <${SeloOrigem} origem=${l.origem} />
              <p class="mt-1 text-[11px] text-muted-foreground">${l.c.parte === "cliente" ? "Financeiro" : l.origem === "solicitacao" ? "Produção" : "Suprimentos"}</p>
            </td>
            <td class="px-4 py-3 align-middle font-mono text-[12.5px] font-semibold leading-snug">${l.codigo}</td>
            <td class="px-4 py-3 align-middle">
              <p class="truncate font-semibold" title=${l.contraparte.razao}>${l.contraparte.nome}</p>
              <p class="truncate text-[11.5px] tabular-nums text-muted-foreground">${l.contraparte.cnpj}</p>
              ${html`<div class="mt-1 flex flex-wrap gap-1">${etiquetas(db, l)}</div>`}
            </td>
            <td class="px-4 py-3 align-middle">
              <p class="truncate font-medium" title=${l.job.nome}>${l.job.nome}</p>
              <p class="truncate text-[11.5px] text-muted-foreground">${l.c.parte === "cliente" ? `GP ${l.job.gp}` : `${l.job.codigo} · ${CLIENTES[l.job.clienteId].fantasia}`}</p>
            </td>
            <td class="px-4 py-3 text-right align-middle">
              <p class="whitespace-nowrap font-semibold tabular-nums">${moeda(l.valor)}</p>
              ${html`<p class="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title=${l.condicao}>${l.condicao}</p>`}
            </td>
            <td class="px-4 py-3 align-middle">
                <p class=${cn("text-[12.5px] font-semibold", TEXTO_URGENCIA[l.urgencia.nivel])}>${l.urgencia.texto}</p>
                <p class="text-[11px] text-muted-foreground">Chegou ${relativo(l.c.chegouEm)}</p>
              </td>
            <td class="px-4 py-3 align-middle"><${SeloContrato} status=${l.c.status} /></td>
            <td class="py-3 align-middle"><${LinkPlanilha} planilha=${l.planilha} /></td>
            <td class="px-3 py-3 text-center align-middle">
              <div class="flex items-center justify-center gap-1">
                <${Botao} v=${l.c.status === "assinatura" ? "secundario" : "vermelho"} t="xs" onClick=${(e) => { e.stopPropagation(); abrirContrato(l.c.id); }}>${rotuloAcao(l.c.status)}</${Botao}>
                ${html`<${MenuAcoes} itens=${acoesDaLinha(l)} />`}
              </div>
            </td>
          </tr>`)}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

/* A mesma fila em colunas por status. */
function Quadro({ linhas }) {
  const { db, abrirContrato } = useStore();
  const recentes = db.contratos.filter((c) => RESOLVIDO.includes(c.status) && c.atualizadoEm && dias(c.atualizadoEm, HOJE) <= 10).map((c) => infoContrato(db, c));
  const colunas = [
    { k: "pendente", rot: "Pendentes", itens: linhas.filter((l) => l.c.status === "pendente") },
    { k: "elaboracao", rot: "Em elaboração", itens: linhas.filter((l) => l.c.status === "elaboracao") },
    { k: "assinatura", rot: "Aguardando assinatura", itens: linhas.filter((l) => l.c.status === "assinatura") },
    { k: "assinado", rot: "Resolvidos nos últimos 10 dias", itens: recentes },
  ];
  return html`<div class="overflow-x-auto pb-2">
    <div class="grid min-w-[1080px] grid-cols-4 gap-3">
      ${colunas.map((col) => html`<section key=${col.k} class="flex min-w-0 flex-col rounded-2xl border border-border bg-[#f4f4f2] p-2.5">
        <header class="flex items-center justify-between px-1.5 pb-2.5 pt-1">
          ${col.k === "assinado" ? html`<span class="text-[12px] font-semibold text-muted-foreground">${col.rot}</span>` : html`<${SeloContrato} status=${col.k} />`}
          <span class="font-mono text-[12px] font-bold text-muted-foreground">${col.itens.length}</span>
        </header>
        <div class="flex flex-col gap-2">
          ${col.itens.length === 0 && html`<p class="rounded-xl border border-dashed border-[#d9d8d3] px-3 py-6 text-center text-[12px] text-muted-foreground">Nada aqui</p>`}
          ${col.itens.map((l) => html`<button key=${l.c.id} type="button" onClick=${() => abrirContrato(l.c.id)} class=${cn("rounded-xl border border-border bg-white p-3 text-left shadow-soft transition-colors hover:border-california-red/30", col.k !== "assinado" && FAIXA_URGENCIA[l.urgencia.nivel])}>
            <div class="flex items-center justify-between gap-2"><${SeloOrigem} origem=${l.origem} /><span class="truncate font-mono text-[11.5px] font-semibold text-muted-foreground">${l.codigo}</span></div>
            <p class="mt-2 truncate text-[13.5px] font-semibold">${l.contraparte.nome}</p>
            <p class="truncate text-[12px] text-muted-foreground">${l.job.codigo} · ${l.job.nome}</p>
            <div class="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2">
              <span class="text-[12.5px] font-semibold tabular-nums">${moeda(l.valor)}</span>
              ${col.k === "assinado" ? html`<${SeloContrato} status=${l.c.status} />` : html`<span class=${cn("text-[11.5px] font-semibold", TEXTO_URGENCIA[l.urgencia.nivel])}>${l.urgencia.texto}</span>`}
            </div>
          </button>`)}
        </div>
      </section>`)}
    </div>
  </div>`;
}

function Sino() {
  const { db, acoes, abrirContrato } = useStore();
  const [aberto, setAberto] = useState(false);
  const naoLidas = db.notificacoes.filter((n) => !n.lida).length;
  return html`<div class="relative">
    <button type="button" aria-label=${`Notificações${naoLidas ? `, ${naoLidas} não lidas` : ""}`} aria-expanded=${aberto} onClick=${() => setAberto(!aberto)}
      class="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground hover:text-foreground">
      <${Icon} n="bell" />
      ${naoLidas > 0 && html`<span class="absolute -right-1.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white ring-2 ring-background">${naoLidas}</span>`}
    </button>
    ${aberto && html`<div class="fixed inset-0 z-40" onClick=${() => setAberto(false)}></div>
      <div class="absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-white shadow-elevated anim-sobe">
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <p class="text-[13px] font-bold">Notificações</p>
          ${naoLidas > 0 && html`<button type="button" class="text-[12px] font-semibold text-california-red hover:underline" onClick=${acoes.lerNotificacoes}>Marcar todas como lidas</button>`}
        </div>
        <ul class="max-h-[360px] overflow-y-auto py-1">
          ${db.notificacoes.map((n) => html`<li key=${n.id}><button type="button" onClick=${() => { setAberto(false); abrirContrato(n.contratoId); }} class="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-[#f7f7f5]">
            <span class=${cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.lida ? "bg-transparent" : "bg-california-red")}></span>
            <span class="min-w-0 flex-1"><span class="block text-[13px] font-semibold">${n.texto}</span><span class="block text-[12px] text-muted-foreground">${n.sub}</span><span class="mt-0.5 block text-[11px] text-muted-foreground/80">${dataHoraBr(n.em)}</span></span>
          </button></li>`)}
        </ul>
      </div>`}
  </div>`;
}
