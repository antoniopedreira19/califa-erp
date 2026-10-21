/* ---------- Elaborar contrato (gaveta) e visualizar contrato ---------- */

function modelosPara(db, c, B) {
  return db.modelos.filter((m) => m.ativo && visivel(m, B) && m.parte === c.parte && (c.tipo === "aditivo" ? m.tipo === "aditivo" : m.tipo !== "aditivo"));
}

function modeloSugerido(db, c, info, B) {
  if (c.tipo === "aditivo") return "m-aditivo";
  if (c.parte === "cliente") return "m-cli-prod";
  const tipo = info.pp ? info.pp.tipo : "prestacao";
  const lista = modelosPara(db, c, B).filter((m) => m.tipo === tipo);
  if (info.pp && /motorista|van|caminh/i.test(info.pp.servico + info.pp.especificacoes)) return "m-forn-veic";
  return lista[0] ? lista[0].id : null;
}

function minusculaInicial(t) { return t ? t[0].toLowerCase() + t.slice(1) : t; }

/* Versão B: o que a PP já diz vira sugestão para a lacuna de objeto. */
function sugestaoDeObjeto(info, ppIds, db) {
  if (info.c.tipo === "aditivo") return info.c.aditivo.motivo.replace(/^PP-\d+ reemitida pela produção: /, "");
  if (info.c.parte === "cliente") return `produção da ${info.job.servico.toLowerCase()} “${info.job.nome}”`;
  if (info.origem === "solicitacao") return info.c.solicitacao.escopo;
  return ppIds.map((id) => ppDe(db, id)).map((p) => `${minusculaInicial(p.servico)} (${p.especificacoes})`).join("; ");
}

function rotuloDestino(info, ppIds, db) {
  if (info.c.parte === "cliente") return `Informações do job ${info.job.codigo}`;
  if (info.origem === "solicitacao") return `${info.job.codigo} (Informações do job)`;
  return `${ppIds.map((id) => ppDe(db, id).codigo).join(" e ")} (aba PPs do ${info.job.codigo})`;
}

function CabecalhoGaveta({ info, onFechar, passos, passo, onPasso }) {
  return html`<div class="cabeca-gaveta border-b border-border bg-white px-6 pb-0 pt-5">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <${SeloOrigem} origem=${info.origem} />
          <span class="font-mono text-[12.5px] font-semibold text-muted-foreground">${info.codigo}</span>
          <span class="text-[12.5px] text-muted-foreground">· ${info.c.parte === "cliente" ? "Contrato com o cliente" : info.c.tipo === "aditivo" ? "Aditivo ao contrato do fornecedor" : "Contrato com o fornecedor"}</span>
          <${SeloContrato} status=${info.c.status} />
        </div>
        <h2 class="mt-1.5 truncate text-xl font-bold tracking-tight">${info.contraparte.razao}</h2>
        <p class="truncate text-[13px] text-muted-foreground">${info.job.codigo} · ${info.job.nome} · ${CLIENTES[info.job.clienteId].fantasia}</p>
      </div>
      <button type="button" onClick=${onFechar} aria-label="Fechar" class="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><${Icon} n="x" c="h-5 w-5" /></button>
    </div>
    ${passos ? html`<ol class="mt-4 flex items-center gap-1 overflow-x-auto">
      ${passos.map((p, i) => {
        const n = i + 1, on = passo === n, feito = passo > n;
        return html`<li key=${p} class="flex items-center gap-1">
          <button type="button" disabled=${n > passo} onClick=${() => onPasso(n)} class=${cn("inline-flex items-center gap-2 border-b-2 px-2 pb-3 pt-1 text-[13px] font-semibold disabled:cursor-default", on ? "border-california-red text-foreground" : feito ? "border-transparent text-foreground hover:text-california-red" : "border-transparent text-muted-foreground")}>
            <span class=${cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", on ? "bg-california-red text-white" : feito ? "bg-emerald-500 text-white" : "bg-[#ececea] text-muted-foreground")}>${feito ? html`<${Icon} n="check" c="h-3 w-3" sw="3" />` : n}</span>${p}
          </button>
          ${i < passos.length - 1 && html`<${Icon} n="chevronRight" c="mb-3 h-4 w-4 text-[#cfcfcf]" />`}
        </li>`;
      })}
    </ol>` : html`<div class="h-4"></div>`}
  </div>`;
}

function DadosDoSistema({ info, ctx }) {
  const linhas = [
    [info.c.parte === "cliente" ? "Contratante" : "Contratada", info.contraparte.razao, info.c.parte === "cliente" ? "Cadastro do cliente" : "Cadastro do fornecedor"],
    ["CNPJ", info.contraparte.cnpj, "Cadastro"],
    ["Endereço", info.contraparte.endereco, "Cadastro"],
    ["Valor", `${ctx["valor.total"]} (${ctx["valor.extenso"]})`, info.c.parte === "cliente" ? "Versão aprovada do orçamento" : info.origem === "solicitacao" ? "Solicitação" : "PP"],
    ["Condição de pagamento", ctx["pagamento.condicao"], info.c.parte === "cliente" ? "Orçamento" : "PP"],
    ["Job", `${info.job.codigo} · ${info.job.nome}`, "Job"],
    ["Período do job", ctx["job.periodo"], "Job"],
    [info.c.parte === "cliente" ? "Gerente de projetos" : "Produtor responsável", info.c.parte === "cliente" ? info.job.gp : info.job.produtor, "Job"],
  ];
  return html`<div class="rounded-2xl border border-border bg-white shadow-soft">
    <div class="flex items-center gap-2 border-b border-border px-5 py-3"><${Icon} n="lock" c="h-3.5 w-3.5 text-muted-foreground" /><p class="text-[13px] font-bold">Dados que o sistema já preenche</p><span class="text-[12px] text-muted-foreground">· vêm do cadastro, do job e da ${info.c.parte === "cliente" ? "versão aprovada" : "PP"}</span></div>
    <dl class="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
      ${linhas.map(([k, v, o]) => html`<div key=${k} class="min-w-0"><dt class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">${k}</dt><dd class="mt-0.5 text-[13px] font-medium leading-snug">${v}</dd><dd class="text-[11px] text-muted-foreground/80">${o}</dd></div>`)}
    </dl>
  </div>`;
}

function GerarContrato({ id, onFechar, passoInicial }) {
  const { db, B, acoes, irJob, abrirModal } = useStore();
  const c = db.contratos.find((x) => x.id === id);
  const info = infoContrato(db, c);
  const [modeloId, setModeloId] = useState(c.modeloId || (B ? modeloSugerido(db, c, info, B) : null));
  const [passo, setPasso] = useState(c.modeloId ? 2 : passoInicial && modeloId ? passoInicial : 1);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [campos, setCampos] = useState({ ...(c.campos || {}) });
  const [clausulas, setClausulas] = useState(c.clausulas || []);
  const [ppIds, setPpIds] = useState(c.ppIds || []);
  // Texto ajustado à mão na revisão (pedido de 21/10/2026: editar direto no contrato).
  const [textoEditado, setTextoEditado] = useState(c.textoEditado || null);
  const [editando, setEditando] = useState(false);
  const [baseEdicao, setBaseEdicao] = useState(null);
  const corpoRef = useRef(null);

  const modelo = modeloId ? modeloDe(db, modeloId) : null;
  const ctx = contextoDoContrato(db, { ...c, ppIds });
  const lacunas = modelo ? lacunasDoModelo(modelo) : [];
  const faltando = lacunas.filter((l) => l.obrigatoria && !(campos[l.chave] || "").trim());
  const nos = modelo ? montarDocumento(modelo.corpo, ctx, campos, B ? clausulas : []) : [];
  const irmas = B ? ppsIrmasSemContrato(db, info) : [];
  const disponiveis = modelosPara(db, c, B);
  const tiposVisiveis = ORDEM_TIPOS.filter((t) => (B || !TIPOS[t].soNaB) && (c.tipo === "aditivo" ? t === "aditivo" : t !== "aditivo"));
  const sugerido = B ? modeloSugerido(db, c, info, B) : null;

  const irLacuna = (k) => {
    const el = document.getElementById(`lac-${k}`);
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus(); }
  };
  const dadosParaSalvar = () => ({ modeloId, modeloVersao: modelo.versao, modeloNome: modelo.nome, campos, clausulas, ppIds, valor: ctx._valor, textoEditado });
  const comecarEdicao = () => { setBaseEdicao(textoEditado || contratoParaHtml(nos, ctx)); setEditando(true); };
  const destino = rotuloDestino(info, ppIds, db);
  const irParaJob = () => { onFechar(); irJob(info.job.id, c.parte === "cliente" || info.origem === "solicitacao" ? "info" : "pps"); };

  const escolherModelo = (m) => {
    setModeloId(m.id);
    if (B) setClausulas((atual) => (c.modeloId === m.id ? atual : []));
  };

  /* ----- Passo 1: modelo ----- */
  const passo1 = html`<div class="mx-auto max-w-[1180px] space-y-5 px-6 py-6">
    <${DadosDoSistema} info=${info} ctx=${ctx} />

    ${B && irmas.length > 0 && html`<div class="rounded-2xl border border-[#e9d5ff] bg-[#fdfaff] px-5 py-4">
      <p class="flex items-center gap-2 text-[13px] font-bold text-[#6b21a8]"><${Icon} n="link" />Mesmo fornecedor, mesmo job</p>
      <p class="mt-1 text-[12.5px] text-[#6b5a7a]">${info.contraparte.nome} tem outra PP neste job ainda sem contrato. Dá para cobrir as duas num contrato só.</p>
      <div class="mt-3 space-y-2">${irmas.map((p) => {
        const on = ppIds.includes(p.id);
        return html`<label key=${p.id} class="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e9d5ff] bg-white px-3.5 py-2.5">
          <input id=${`incluir-${p.id}`} type="checkbox" checked=${on} onChange=${() => setPpIds(on ? ppIds.filter((x) => x !== p.id) : [...ppIds, p.id])} class="h-4 w-4 accent-[#E74B56]" />
          <span class="min-w-0 flex-1 text-[13px]"><span class="font-mono font-semibold">${p.codigo}</span> · ${p.servico} <span class="text-muted-foreground">· ${p.condicao}</span></span>
          <span class="font-semibold tabular-nums">${moeda(p.valor)}</span>
        </label>`;
      })}</div>
      ${ppIds.length > 1 && html`<p class="mt-2.5 text-[12.5px] font-semibold text-[#6b21a8]">Valor do contrato: ${moeda(ctx._valor)} (${ppIds.length} PPs)</p>`}
    </div>`}

    ${B && info.contraparte.quadro && c.tipo !== "aditivo" && info.origem !== "solicitacao" && html`<div class="flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4">
      <${Icon} n="shield" c="h-5 w-5 text-emerald-700" />
      <div class="min-w-0 flex-1"><p class="text-[13px] font-bold text-emerald-800">Contrato-quadro ${info.contraparte.quadro.codigo} vigente até ${dataBr(info.contraparte.quadro.vigencia)}</p><p class="text-[12.5px] text-emerald-900/70">${info.contraparte.quadro.objeto}. A PP pode ser vinculada a ele, sem contrato novo.</p></div>
      <${Botao} v="secundario" t="sm" icone="shield" onClick=${() => abrirModal({ tipo: "quadro", id: c.id })}>Vincular ao contrato-quadro</${Botao}>
    </div>`}

    <div>
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h3 class="text-[15px] font-bold">Escolha o modelo</h3><p class="text-[12.5px] text-muted-foreground">${c.parte === "cliente" ? "Modelos para contratos com o cliente." : "Modelos para contratos com fornecedores."} O modelo traz a minuta pronta; você só preenche as lacunas.</p></div>
        <div class="flex flex-wrap gap-1.5">
          ${["todos", ...tiposVisiveis].map((t) => html`<button key=${t} type="button" aria-pressed=${filtroTipo === t} onClick=${() => setFiltroTipo(t)} class=${cn("rounded-full border px-3 py-1 text-[12px] font-semibold", filtroTipo === t ? "border-california-dark bg-california-dark text-white" : "border-border bg-white text-muted-foreground hover:text-foreground")}>${t === "todos" ? "Todos os tipos" : TIPOS[t].rotulo}</button>`)}
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        ${tiposVisiveis.filter((t) => filtroTipo === "todos" || filtroTipo === t).flatMap((t) => {
          const ms = disponiveis.filter((m) => m.tipo === t);
          if (!ms.length && t === "influenciador" && !B) return [html`<div key="infl" class="flex min-h-[148px] flex-col justify-between rounded-2xl border border-dashed border-border bg-[#fafaf9] p-4 text-muted-foreground">
            <div><p class="text-[11px] font-semibold uppercase tracking-[0.08em]">${TIPOS[t].rotulo}</p><p class="mt-1.5 text-[14px] font-semibold text-foreground/60">Previsto para a 2ª etapa</p><p class="mt-1 text-[12.5px]">O caso mais complexo, com entregas por rede e direitos de imagem.</p></div>
            <span class="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold"><${Icon} n="clock" c="h-3.5 w-3.5" />Em breve</span>
          </div>`];
          return ms.map((m) => {
            const on = modeloId === m.id;
            const lac = lacunasDoModelo(m);
            return html`<button key=${m.id} type="button" aria-pressed=${on} onClick=${() => escolherModelo(m)}
              class=${cn("relative flex min-h-[148px] flex-col rounded-2xl border bg-white p-4 text-left transition-shadow", on ? "border-california-red shadow-[0_0_0_3px_rgba(231,75,86,0.15)]" : "border-border hover:border-[#d6d6d6] hover:shadow-soft")}>
              <div class="flex items-center justify-between gap-2">
                <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">${TIPOS[m.tipo].rotulo}</p>
                ${on ? html`<span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-california-red text-white"><${Icon} n="check" c="h-3 w-3" sw="3" /></span>` : sugerido === m.id ? html`<${Etiqueta} cor="azul" icone="sparkles">Sugerido pela PP</${Etiqueta}>` : null}
              </div>
              <p class="mt-1.5 text-[14px] font-bold leading-snug">${m.nome}</p>
              <p class="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">${m.descricao}</p>
              <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[11.5px] text-muted-foreground">
                <span>${lac.length} ${lac.length === 1 ? "lacuna" : "lacunas"}</span>
                ${B && html`<span>v${m.versao}</span>`}
                <span>Usado ${m.usos} ${m.usos === 1 ? "vez" : "vezes"}</span>
                ${m.rascunho && html`<${Etiqueta} cor="ambar">Rascunho</${Etiqueta}>`}
              </div>
            </button>`;
          });
        })}
      </div>
    </div>
    ${B && c.parte === "fornecedor" && c.tipo !== "aditivo" && info.origem !== "solicitacao" && html`<p class="text-[12.5px] text-muted-foreground">Esta PP não precisa de contrato? <button type="button" class="font-semibold text-california-red hover:underline" onClick=${() => abrirModal({ tipo: "dispensa", id: c.id })}>Dispensar com justificativa</button></p>`}
  </div>`;

  /* ----- Passo 2: lacunas ----- */
  const sugestao = B ? sugestaoDeObjeto(info, ppIds, db) : "";
  const passo2 = modelo && html`<div class="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:overflow-hidden">
    <div class="space-y-5 border-border px-6 py-6 lg:min-h-0 lg:overflow-y-auto lg:border-r">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Modelo</p><p class="truncate text-[14px] font-bold">${modelo.nome} <span class="font-medium text-muted-foreground">· v${modelo.versao}</span></p></div>
        <${Botao} v="fantasma" t="xs" icone="rotate" onClick=${() => setPasso(1)}>Trocar</${Botao}>
      </div>

      ${textoEditado && html`<div class="flex items-start gap-2.5 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3.5 py-3 text-[12.5px] text-[#92400e]">
        <${Icon} n="alert" c="mt-0.5 h-3.5 w-3.5" />
        <p class="min-w-0 flex-1">Você ajustou o texto do contrato na revisão. O que mudar aqui não chega a esse texto.</p>
        <button type="button" class="shrink-0 font-bold hover:underline" onClick=${() => setTextoEditado(null)}>Descartar ajustes</button>
      </div>`}
      <section class="space-y-4">
        <div class="flex items-center justify-between"><h3 class="text-[14px] font-bold">Lacunas a preencher</h3><span class=${cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-bold", faltando.length ? "bg-california-red-soft text-[#b3323c]" : "bg-emerald-50 text-emerald-700")}>${lacunas.length - faltando.length} de ${lacunas.length}</span></div>
        ${lacunas.map((l) => {
          const v = campos[l.chave] || "";
          const set = (val) => setCampos({ ...campos, [l.chave]: val });
          return html`<div key=${l.chave}>
            <${Rotulo} para=${`lac-${l.chave}`} obrigatorio=${l.obrigatoria} extra=${B && l.chave === "objeto" && c.parte === "fornecedor" && info.origem !== "solicitacao" && html`<button type="button" class="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-california-red hover:underline" onClick=${() => abrirModal({ tipo: "pedir", id: c.id })}><${Icon} n="message" c="h-3 w-3" />Pedir ao produtor</button>`}>${l.rotulo}</${Rotulo}>
            ${l.tipo === "longo" ? html`<textarea id=${`lac-${l.chave}`} rows="3" value=${v} onInput=${(e) => set(e.target.value)} placeholder=${l.dica} class=${AREA}></textarea>` : html`<input id=${`lac-${l.chave}`} type="text" value=${v} onInput=${(e) => set(e.target.value)} placeholder=${l.dica} class=${CAMPO} />`}
            ${B && l.chave === "objeto" && !v.trim() && sugestao && html`<div class="mt-2 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2.5">
              <${Icon} n="sparkles" c="mt-0.5 h-3.5 w-3.5 text-blue-700" />
              <p class="min-w-0 flex-1 text-[12.5px] leading-snug text-blue-900"><span class="font-semibold">Sugestão ${c.parte === "cliente" ? "a partir do job" : c.tipo === "aditivo" ? "a partir da reemissão" : "a partir da PP"}:</span> ${sugestao}</p>
              <button type="button" class="shrink-0 text-[12px] font-bold text-blue-700 hover:underline" onClick=${() => set(sugestao)}>Usar</button>
            </div>`}
          </div>`;
        })}
      </section>

      ${B && (modelo.clausulasOpcionais || []).length > 0 && html`<section class="space-y-2.5">
        <h3 class="text-[14px] font-bold">Cláusulas opcionais</h3>
        <p class="text-[12.5px] text-muted-foreground">Entram antes do foro. A numeração se ajusta sozinha.</p>
        ${modelo.clausulasOpcionais.map((k) => {
          const on = clausulas.includes(k);
          return html`<label key=${k} class=${cn("flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5", on ? "border-california-red/35 bg-[#fffafa]" : "border-border bg-white")}>
            <input id=${`cl-${k}`} type="checkbox" checked=${on} onChange=${() => setClausulas(on ? clausulas.filter((x) => x !== k) : [...clausulas, k])} class="mt-0.5 h-4 w-4 accent-[#E74B56]" />
            <span class="min-w-0"><span class="block text-[13px] font-semibold">${CLAUSULAS[k].titulo.replace(/^DA |^DO /, "").toLowerCase().replace(/^./, (x) => x.toUpperCase())}</span><span class="block text-[12px] text-muted-foreground">${CLAUSULAS[k].resumo}</span></span>
          </label>`;
        })}
      </section>`}

      <details class="group rounded-xl border border-border bg-white">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold"><${Icon} n="lock" c="h-3.5 w-3.5 text-muted-foreground" />Campos do sistema neste modelo<span class="ml-auto text-[12px] font-medium text-muted-foreground">${chavesDeSistema(modelo.corpo).length}</span><${Icon} n="chevronDown" c="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
        <dl class="space-y-2 border-t border-border px-4 py-3">
          ${chavesDeSistema(modelo.corpo).map((k) => html`<div key=${k} class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 text-[12.5px]"><dt class="text-muted-foreground">${(ROTULO_CAMPO[k] || { rotulo: k }).rotulo}</dt><dd class="font-medium">${ctx[k] ?? "—"}</dd></div>`)}
        </dl>
      </details>
    </div>
    <div class="bg-[#efeeeb] px-4 py-6 sm:px-8 lg:min-h-0 lg:overflow-y-auto">
      <div class="mx-auto mb-3 flex max-w-[720px] flex-wrap items-center justify-between gap-2"><p class="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Prévia do contrato</p><${LegendaPapel} /></div>
      <${Papel} nos=${nos} ctx=${ctx} lacunas=${lacunas} onIrLacuna=${irLacuna} />
    </div>
  </div>`;

  /* ----- Passo 3: revisão ----- */
  const passo3 = modelo && html`<div class="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:overflow-hidden">
    <div class="space-y-5 px-6 py-6 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border">
      <section class="rounded-2xl border border-border bg-white p-5 shadow-soft">
        <h3 class="text-[14px] font-bold">Resumo</h3>
        <dl class="mt-3 space-y-2.5 text-[12.5px]">
          ${[["Modelo", `${modelo.nome} · v${modelo.versao}`], ["Partes", ctx._partes.join(" e ")], ["Valor", ctx["valor.total"]], ["Condição", ctx["pagamento.condicao"]], ...(B ? [["Cláusulas opcionais", clausulas.length ? clausulas.map((k) => CLAUSULAS[k].resumo).join("; ") : "Nenhuma"]] : []), ...(ppIds.length > 1 ? [["PPs cobertas", ppIds.map((x) => ppDe(db, x).codigo).join(", ")]] : []), ...(textoEditado ? [["Texto", "Ajustado à mão na revisão"]] : [])].map(([k, v]) => html`<div key=${k} class="grid grid-cols-[110px_minmax(0,1fr)] gap-3"><dt class="text-muted-foreground">${k}</dt><dd class="font-medium">${v}</dd></div>`)}
        </dl>
      </section>
      <section class="rounded-2xl border border-border bg-white p-5 shadow-soft">
        <h3 class="text-[14px] font-bold">Ao gerar o contrato</h3>
        <ul class="mt-3 space-y-2.5 text-[12.5px] leading-snug">
          <li class="flex gap-2.5"><${Icon} n="paperclip" c="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /><span>O PDF é anexado a <b>${destino}</b>.</span></li>
          <li class="flex gap-2.5"><${Icon} n="clock" c="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /><span>O status passa a <b>Aguardando assinatura</b>. Quando o assinado chegar, você o anexa aqui.</span></li>
          ${c.parte === "fornecedor" ? html`<li class="flex gap-2.5"><${Icon} n="lock" c="mt-0.5 h-3.5 w-3.5 text-[#b3323c]" /><span>O pagamento ${ppIds.length > 1 ? "das PPs" : "da PP"} continua travado até o contrato assinado ser anexado.</span></li>`
            : html`<li class="flex gap-2.5"><${Icon} n="unlock" c="mt-0.5 h-3.5 w-3.5 text-emerald-700" /><span>O job segue normalmente: o contrato com o cliente não trava a abertura nem as PPs.</span></li>`}
        </ul>
      </section>
      ${faltando.length > 0 && html`<p class="flex items-start gap-2 rounded-xl border border-california-red/25 bg-california-red-soft px-3.5 py-2.5 text-[12.5px] text-[#9f2a33]"><${Icon} n="alert" c="mt-0.5 h-3.5 w-3.5" />Falta preencher: ${faltando.map((l) => l.rotulo).join(", ")}.</p>`}
    </div>
    <div class="bg-[#efeeeb] px-4 py-6 sm:px-8 lg:min-h-0 lg:overflow-y-auto">
      <div class="mx-auto mb-3 flex max-w-[720px] flex-wrap items-center gap-2">
        <p class="mr-auto text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">${editando ? "Editando o texto do contrato" : "Como vai sair no PDF"}</p>
        ${!editando && textoEditado && html`<${Etiqueta} cor="ambar" icone="pencil">Texto ajustado à mão</${Etiqueta}><${Botao} v="fantasma" t="xs" icone="rotate" onClick=${() => setTextoEditado(null)}>Desfazer ajustes</${Botao}>`}
        ${editando ? html`<${Botao} t="xs" icone="check" onClick=${() => setEditando(false)}>Concluir edição</${Botao}>`
          : html`<${Botao} v="secundario" t="xs" icone="pencil" disabled=${faltando.length > 0} title=${faltando.length ? "Preencha as lacunas antes de editar o texto" : undefined} onClick=${comecarEdicao}>Editar o texto</${Botao}>`}
      </div>
      ${editando && html`<p class="mx-auto mb-3 max-w-[720px] rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-[12px] leading-snug text-blue-900">Edite como no Word: clique em qualquer trecho. Os dados em azul vêm do cadastro e da PP e ficam travados; se estiverem errados, a correção é na origem.</p>`}
      ${editando ? html`<${ContratoEditavel} key="editando" htmlInicial=${baseEdicao} editavel onMuda=${setTextoEditado} />`
        : textoEditado ? html`<${ContratoEditavel} key="ajustado" htmlInicial=${textoEditado} />`
        : html`<${Papel} nos=${nos} ctx=${ctx} lacunas=${lacunas} modo="final" onIrLacuna=${(k) => { setPasso(2); setTimeout(() => irLacuna(k), 60); }} />`}
    </div>
  </div>`;

  return html`<div class="flex h-full min-h-0 flex-col">
    <${CabecalhoGaveta} info=${info} onFechar=${onFechar} passos=${["Modelo", "Lacunas", "Revisão"]} passo=${passo} onPasso=${setPasso} />
    <div ref=${corpoRef} class=${cn("flex min-h-0 flex-1 flex-col", passo === 1 && "overflow-y-auto")}>${passo === 1 ? passo1 : passo === 2 ? passo2 : passo3}</div>
    <div class="rodape-gaveta flex flex-wrap items-center gap-2 border-t border-border bg-white px-6 py-3">
      <button type="button" onClick=${() => { onFechar(); irJob(info.planilha.jobId, "planilha", info.planilha.item); }} class="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#047857] hover:underline"><${Icon} n="sheet" c="h-4 w-4" />Ver ${info.planilha.item ? "o item" : ""} na planilha interna</button>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        ${passo > 1 && html`<${Botao} v="fantasma" t="sm" icone="chevronLeft" onClick=${() => setPasso(passo - 1)}>Voltar</${Botao}>`}
        ${passo > 1 && html`<${Botao} v="secundario" t="sm" onClick=${() => { acoes.salvarRascunho(c.id, dadosParaSalvar()); onFechar(); }}>Salvar rascunho</${Botao}>`}
        ${passo === 1 && html`<${Botao} v="primario" t="sm" disabled=${!modelo} onClick=${() => setPasso(2)}>Preencher lacunas<${Icon} n="arrowRight" c="h-3.5 w-3.5" /></${Botao}>`}
        ${passo === 2 && html`<${Botao} v="primario" t="sm" onClick=${() => setPasso(3)}>Revisar<${Icon} n="arrowRight" c="h-3.5 w-3.5" /></${Botao}>`}
        ${passo === 3 && html`<${Botao} v="primario" t="sm" icone="fileCheck" disabled=${faltando.length > 0 || editando} onClick=${() => acoes.gerar(c.id, dadosParaSalvar(), destino, irParaJob)}>Gerar contrato</${Botao}>`}
      </div>
    </div>
  </div>`;
}

/* Contrato já gerado, assinado, dispensado ou coberto por contrato-quadro. */
function VerContrato({ id, onFechar }) {
  const { db, B, acoes, irJob } = useStore();
  const c = db.contratos.find((x) => x.id === id);
  const info = infoContrato(db, c);
  const [arquivo, setArquivo] = useState("");
  const [data, setData] = useState(HOJE);
  const modelo = c.modeloId ? modeloDe(db, c.modeloId) : null;
  const ctx = contextoDoContrato(db, c);
  const nos = modelo ? montarDocumento(modelo.corpo, ctx, c.campos || {}, B ? c.clausulas || [] : []) : [];
  const nomeAssinado = (c.arquivo || "contrato.pdf").replace(/-v\d+\.pdf$/, "-assinado.pdf");
  const pagamentoTexto = c.parte === "fornecedor" ? `Pagamento de ${info.pps.map((p) => p.codigo).join(" e ") || info.codigo} liberado para o financeiro.` : null;
  const destinoJob = () => { onFechar(); irJob(info.job.id, c.parte === "cliente" || info.origem === "solicitacao" ? "info" : "pps"); };

  return html`<div class="flex h-full min-h-0 flex-col">
    <${CabecalhoGaveta} info=${info} onFechar=${onFechar} />
    <div class="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:overflow-hidden">
      <div class="space-y-4 px-6 py-6 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border">
        ${c.status === "assinatura" && html`<section class="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
          <h3 class="flex items-center gap-2 text-[14px] font-bold"><${Icon} n="upload" c="h-4 w-4 text-blue-700" />Registrar assinatura</h3>
          <p class="mt-1 text-[12.5px] text-muted-foreground">Anexe o contrato assinado pelas duas partes.${c.parte === "fornecedor" ? " O pagamento da PP é liberado na hora." : ""}</p>
          <div class="mt-4 space-y-3">
            <div>
              <${Rotulo} para="arquivo-assinado" obrigatorio>PDF assinado</${Rotulo}>
              <label class="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#bcd0ee] bg-white px-3.5 py-3 hover:border-blue-400">
                <${Icon} n="paperclip" c="h-4 w-4 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate text-[13px] ${arquivo ? "font-semibold" : "text-muted-foreground"}">${arquivo || "Escolher arquivo…"}</span>
                <input id="arquivo-assinado" type="file" accept=".pdf,application/pdf" class="sr-only" onChange=${(e) => setArquivo(e.target.files[0] ? e.target.files[0].name : "")} />
              </label>
              ${!arquivo && html`<button type="button" class="mt-1.5 text-[12px] font-semibold text-blue-700 hover:underline" onClick=${() => setArquivo(nomeAssinado)}>Usar um arquivo de exemplo</button>`}
            </div>
            <div><${Rotulo} para="data-assinatura" obrigatorio>Data da assinatura</${Rotulo}><input id="data-assinatura" type="date" value=${data} max=${HOJE} onInput=${(e) => setData(e.target.value)} class=${CAMPO} /></div>
            <${Botao} v="primario" icone="fileCheck" class="w-full" disabled=${!arquivo || !data} onClick=${() => acoes.assinar(c.id, arquivo, data, pagamentoTexto)}>Anexar contrato assinado</${Botao}>
          </div>
        </section>`}

        ${c.status === "dispensado" && html`<section class="rounded-2xl border border-border bg-white p-5 shadow-soft"><h3 class="flex items-center gap-2 text-[14px] font-bold"><${Icon} n="ban" c="h-4 w-4 text-muted-foreground" />Contrato dispensado</h3><p class="mt-2 text-[13px]">${c.dispensa.motivo}</p>${c.dispensa.justificativa && html`<p class="mt-1 text-[12.5px] text-muted-foreground">${c.dispensa.justificativa}</p>`}</section>`}
        ${c.status === "quadro" && html`<section class="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5"><h3 class="flex items-center gap-2 text-[14px] font-bold"><${Icon} n="shield" c="h-4 w-4 text-emerald-700" />Coberta pelo ${c.quadro}</h3><p class="mt-2 text-[12.5px] text-muted-foreground">${info.contraparte.quadro.objeto}. Assinado em ${dataBr(info.contraparte.quadro.assinadoEm)}, vigente até ${dataBr(info.contraparte.quadro.vigencia)}.</p></section>`}

        <section class="space-y-2">
          <h3 class="text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Anexado a ${c.parte === "cliente" ? "Informações do job" : "PP"}</h3>
          ${c.arquivoAssinado && html`<${Arquivo} nome=${c.arquivoAssinado} sub=${`Assinado em ${dataBr(c.assinadoEm)}`} assinado onAbrir=${() => {}} />`}
          ${c.arquivo && html`<${Arquivo} nome=${c.arquivo} sub=${modelo ? `Gerado com ${modelo.nome} · v${c.modeloVersao}` : "Gerado"} onAbrir=${() => {}} />`}
          ${!c.arquivo && !c.arquivoAssinado && html`<p class="text-[12.5px] text-muted-foreground">Nenhum arquivo.</p>`}
          <button type="button" onClick=${destinoJob} class="inline-flex items-center gap-1.5 pt-1 text-[12.5px] font-semibold text-california-red hover:underline"><${Icon} n="external" c="h-3.5 w-3.5" />Ver no job ${info.job.codigo}</button>
        </section>

        ${c.parte === "fornecedor" && info.pps.length > 0 && html`<section class="rounded-2xl border border-border bg-white p-4 shadow-soft">
          <h3 class="mb-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Pagamento</h3>
          ${info.pps.map((p) => html`<div key=${p.id} class="flex items-center justify-between gap-3 py-1 text-[12.5px]"><span><span class="font-mono font-semibold">${p.codigo}</span> · <${SeloPP} status=${p.status} /></span><${Pagamento} pp=${p} /></div>`)}
        </section>`}

        ${B && html`<section>
          <h3 class="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground"><${Icon} n="history" c="h-3.5 w-3.5" />Histórico</h3>
          <ol class="relative space-y-3 border-l border-border pl-4">
            ${[...(c.historico || [])].reverse().map((h, i) => html`<li key=${i} class="relative"><span class="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#bdbdbd]"></span><p class="text-[12.5px] leading-snug">${h.texto}</p><p class="text-[11px] text-muted-foreground">${dataHoraBr(h.em)} · ${h.por}</p></li>`)}
          </ol>
        </section>`}

        ${c.status === "assinatura" && html`<${Botao} v="fantasma" t="sm" icone="pencil" onClick=${() => acoes.reabrir(c.id)}>Corrigir e gerar nova versão</${Botao}>`}
      </div>
      <div class="bg-[#efeeeb] px-4 py-6 sm:px-8 lg:min-h-0 lg:overflow-y-auto">
        ${c.textoEditado ? html`<p class="mx-auto mb-3 max-w-[720px]"><${Etiqueta} cor="ambar" icone="pencil">Texto ajustado à mão antes de gerar</${Etiqueta}></p><${ContratoEditavel} htmlInicial=${c.textoEditado} />`
          : modelo ? html`<${Papel} nos=${nos} ctx=${ctx} lacunas=${lacunasDoModelo(modelo)} modo="final" />` : html`<div class="mx-auto mt-10 max-w-[420px] text-center text-[13px] text-muted-foreground">${c.status === "quadro" ? "Esta PP não tem contrato próprio: ela é coberta pelo contrato-quadro do fornecedor." : "Sem contrato gerado."}</div>`}
      </div>
    </div>
  </div>`;
}

/* ---------- Pop-ups da versão B ---------- */

const MOTIVOS_DISPENSA = ["Valor abaixo do limite de R$ 5.000,00", "Compra com nota fiscal e entrega imediata", "Coberto por outro instrumento já assinado", "Outro motivo"];

function ModalDispensa({ id, onFechar }) {
  const { db, acoes } = useStore();
  const info = infoContrato(db, db.contratos.find((c) => c.id === id));
  const [motivo, setMotivo] = useState(info.valor < LIMITE_DISPENSA ? MOTIVOS_DISPENSA[0] : MOTIVOS_DISPENSA[1]);
  const [just, setJust] = useState("");
  const precisaJust = motivo === "Outro motivo";
  return html`<${Modal} aberta onFechar=${onFechar} titulo="Dispensar contrato" descricao=${`${info.codigo} · ${info.contraparte.nome} · ${moeda(info.valor)}`}
    rodape=${html`<${Botao} v="secundario" onClick=${onFechar}>Cancelar</${Botao}><${Botao} v="primario" disabled=${precisaJust && !just.trim()} onClick=${() => { acoes.dispensar(id, motivo, just.trim()); onFechar(); }}>Dispensar contrato</${Botao}>`}>
    <div class="space-y-4">
      <div class="space-y-2">${MOTIVOS_DISPENSA.map((m) => html`<label key=${m} class=${cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-[13px]", motivo === m ? "border-california-red/40 bg-[#fffafa] font-semibold" : "border-border")}><input type="radio" name="motivo-dispensa" checked=${motivo === m} onChange=${() => setMotivo(m)} class="accent-[#E74B56]" />${m}</label>`)}</div>
      <div><${Rotulo} para="just-dispensa" obrigatorio=${precisaJust}>Justificativa</${Rotulo}><textarea id="just-dispensa" rows="3" value=${just} onInput=${(e) => setJust(e.target.value)} placeholder="Fica no histórico do contrato e da PP." class=${AREA}></textarea></div>
      <p class="flex gap-2 text-[12.5px] text-muted-foreground"><${Icon} n="unlock" c="mt-0.5 h-3.5 w-3.5" />Ao dispensar, o pagamento da PP é liberado para o financeiro.</p>
    </div>
  </${Modal}>`;
}

function ModalQuadro({ id, onFechar }) {
  const { db, acoes } = useStore();
  const info = infoContrato(db, db.contratos.find((c) => c.id === id));
  const q = info.contraparte.quadro;
  return html`<${Modal} aberta onFechar=${onFechar} titulo=${`Vincular ao ${q.codigo}`} descricao=${`${info.codigo} · ${info.contraparte.razao}`}
    rodape=${html`<${Botao} v="secundario" onClick=${onFechar}>Cancelar</${Botao}><${Botao} v="primario" icone="shield" onClick=${() => { acoes.vincularQuadro(id, q); onFechar(); }}>Vincular e liberar pagamento</${Botao}>`}>
    <dl class="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-[13px]">
      ${[["Objeto", q.objeto], ["Assinado em", dataBr(q.assinadoEm)], ["Vigência", `até ${dataBr(q.vigencia)}`], ["Esta PP", `${info.pp.servico} · ${moeda(info.valor)}`]].map(([k, v]) => html`<div key=${k} class="grid grid-cols-[110px_minmax(0,1fr)] gap-3"><dt class="text-muted-foreground">${k}</dt><dd class="font-medium">${v}</dd></div>`)}
    </dl>
    <p class="mt-3 text-[12.5px] text-muted-foreground">A PP fica registrada como coberta pelo contrato-quadro. Nenhum contrato novo é gerado.</p>
  </${Modal}>`;
}

function ModalPedir({ id, onFechar }) {
  const { db, acoes } = useStore();
  const info = infoContrato(db, db.contratos.find((c) => c.id === id));
  const [msg, setMsg] = useState(`Para fechar o contrato da ${info.codigo} (${info.contraparte.nome}), preciso do escopo detalhado: o que exatamente será entregue, em que quantidade e em que datas.`);
  return html`<${Modal} aberta onFechar=${onFechar} titulo="Pedir informação ao produtor" descricao=${`Vai para a Comunicação do ${info.job.codigo}, para ${info.job.produtor}.`}
    rodape=${html`<${Botao} v="secundario" onClick=${onFechar}>Cancelar</${Botao}><${Botao} v="primario" icone="send" disabled=${!msg.trim()} onClick=${() => { acoes.pedirInfo(id, info.job.produtor, msg.trim()); onFechar(); }}>Enviar pergunta</${Botao}>`}>
    <${Rotulo} para="msg-produtor">Mensagem</${Rotulo}>
    <textarea id="msg-produtor" rows="5" value=${msg} onInput=${(e) => setMsg(e.target.value)} class=${AREA}></textarea>
  </${Modal}>`;
}

const TIPOS_SOLICITACAO = ["Contrato antes da PP (fornecedor já escolhido)", "Termo de confidencialidade", "Aditivo pedido pela produção", "Contrato de influenciador", "Outro"];

function ModalSolicitacao({ onFechar }) {
  const { db, acoes } = useStore();
  const [d, setD] = useState({ tipo: TIPOS_SOLICITACAO[0], jobId: "j415", fornecedorId: "atelier", escopo: "", valor: "", condicao: "", prazo: "2026-10-27" });
  const set = (k, v) => setD({ ...d, [k]: v });
  const valorNum = Number(String(d.valor).replace(/\./g, "").replace(",", ".")) || 0;
  const ok = d.escopo.trim() && valorNum > 0 && d.condicao.trim() && d.prazo;
  return html`<${Modal} aberta onFechar=${onFechar} largura="max-w-2xl" titulo="Nova solicitação ao jurídico" descricao="Para o contrato que não nasce de job aberto nem de PP gerada."
    rodape=${html`<${Botao} v="secundario" onClick=${onFechar}>Cancelar</${Botao}><${Botao} v="primario" icone="send" disabled=${!ok} onClick=${() => { acoes.novaSolicitacao({ ...d, valor: valorNum, tipoRotulo: d.tipo, solicitante: "Júlia Prado (GP)" }); onFechar(); }}>Enviar solicitação</${Botao}>`}>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="sm:col-span-2"><${Rotulo} para="sol-tipo" obrigatorio>Tipo de contrato</${Rotulo}><${Selecao} id="sol-tipo" valor=${d.tipo} onTroca=${(v) => set("tipo", v)} opcoes=${TIPOS_SOLICITACAO.map((t) => ({ k: t, rotulo: t }))} /></div>
      <div><${Rotulo} para="sol-job" obrigatorio>Job</${Rotulo}><${Selecao} id="sol-job" valor=${d.jobId} onTroca=${(v) => set("jobId", v)} opcoes=${db.jobs.map((j) => ({ k: j.id, rotulo: `${j.codigo} · ${j.nome}` }))} /></div>
      <div><${Rotulo} para="sol-forn" obrigatorio>Qualificação · fornecedor</${Rotulo}><${Selecao} id="sol-forn" valor=${d.fornecedorId} onTroca=${(v) => set("fornecedorId", v)} opcoes=${Object.values(FORNECEDORES).map((f) => ({ k: f.id, rotulo: f.razao }))} /></div>
      <div class="sm:col-span-2"><${Rotulo} para="sol-escopo" obrigatorio>Escopo</${Rotulo}><textarea id="sol-escopo" rows="3" value=${d.escopo} onInput=${(e) => set("escopo", e.target.value)} placeholder="O que será contratado, com entregas e datas." class=${AREA}></textarea></div>
      <div><${Rotulo} para="sol-valor" obrigatorio>Valor (R$)</${Rotulo}><input id="sol-valor" inputmode="decimal" value=${d.valor} onInput=${(e) => set("valor", e.target.value)} placeholder="24.600,00" class=${CAMPO} /></div>
      <div><${Rotulo} para="sol-cond" obrigatorio>Condição de pagamento</${Rotulo}><input id="sol-cond" value=${d.condicao} onInput=${(e) => set("condicao", e.target.value)} placeholder="Ex.: 30 dias da nota fiscal" class=${CAMPO} /></div>
      <div><${Rotulo} para="sol-prazo" obrigatorio>Prazo para o contrato</${Rotulo}><input id="sol-prazo" type="date" min=${HOJE} value=${d.prazo} onInput=${(e) => set("prazo", e.target.value)} class=${CAMPO} /></div>
    </div>
  </${Modal}>`;
}
