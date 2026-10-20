/* ---------- Aba 3: Modelos de contrato ---------- */

const FAIXA_GRUPO_LISTA = "bg-[#eceae5] border-y border-y-[#dcd9d2]";

const CORPO_NOVO = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS

${ABERTURA_FORN("CONTRATANTE", "CONTRATADA")}

## DO OBJETO
O presente contrato tem por objeto {{lacuna.objeto}}, no âmbito do job {{job.codigo}} — {{job.nome}}, conforme o pedido de produção {{pp.codigo}}.

## DO PREÇO E DO PAGAMENTO
A CONTRATANTE pagará à CONTRATADA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}.

${FECHO}`;

function Modelos() {
  const { db, B, ui, setUi, abrirEditor, acoes } = useStore();
  const f = ui.modelos;
  const setF = (patch) => setUi((u) => ({ ...u, modelos: { ...u.modelos, ...patch } }));
  const [apagando, setApagando] = useState(null);
  const [verArquivados, setVerArquivados] = useState(false);

  const q = f.busca.trim().toLowerCase();
  const todos = db.modelos.filter((m) => visivel(m, B));
  const filtra = (m) => (f.parte === "todos" || m.parte === f.parte) && (!q || (m.nome + " " + m.descricao).toLowerCase().includes(q));
  const ativos = todos.filter((m) => m.ativo && filtra(m));
  const arquivados = todos.filter((m) => !m.ativo && filtra(m));
  const tipos = ORDEM_TIPOS.filter((t) => B || !TIPOS[t].soNaB);
  const cols = B ? [34, 11, 8, 7, 15, 10, 15] : [38, 12, 9, 15, 11, 15];
  const TH = "px-4 py-3 font-semibold";

  const linha = (m) => html`<tr key=${m.id} tabIndex="0" onClick=${() => abrirEditor(m.id)} onKeyDown=${(e) => e.key === "Enter" && abrirEditor(m.id)} class=${cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-[#fafaf8]", !m.ativo && "opacity-60")}>
    <td class="px-4 py-3"><p class="flex items-center gap-2 font-semibold">${m.nome}${m.rascunho && html`<${Etiqueta} cor="ambar">Rascunho</${Etiqueta}>`}</p><p class="truncate text-[12px] text-muted-foreground" title=${m.descricao}>${m.descricao}</p></td>
    <td class="px-4 py-3"><span class=${cn(SELO, "whitespace-nowrap", m.parte === "cliente" ? "border-[#cfd8e3] bg-[#f3f6fa] text-[#3b4a5e]" : "border-[#e2dccd] bg-[#f8f5ee] text-[#6b5a35]")}>${m.parte === "cliente" ? "Cliente" : "Fornecedor"}</span></td>
    <td class="px-4 py-3 tabular-nums">${lacunasDoModelo(m).length}</td>
    ${B && html`<td class="px-4 py-3 font-mono text-[12.5px]">v${m.versao}</td>`}
    <td class="px-4 py-3"><p class="tabular-nums">${dataBr(m.atualizadoEm)}</p><p class="truncate text-[11.5px] text-muted-foreground">${m.atualizadoPor}</p></td>
    <td class="px-4 py-3 tabular-nums">${m.usos} ${m.usos === 1 ? "contrato" : "contratos"}</td>
    <td class="px-3 py-3"><div class="flex items-center justify-center gap-0.5" onClick=${(e) => e.stopPropagation()}>
      <button type="button" title="Editar" aria-label=${`Editar ${m.nome}`} onClick=${() => abrirEditor(m.id)} class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#efefef] hover:text-foreground"><${Icon} n="pencil" /></button>
      <button type="button" title="Duplicar" aria-label=${`Duplicar ${m.nome}`} onClick=${() => acoes.salvarModelo({ ...clone(m), id: `m-${Date.now()}`, nome: `${m.nome} (cópia)`, versao: 1, usos: 0, ativo: true, atualizadoEm: HOJE, atualizadoPor: USUARIO.nome }, true)} class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#efefef] hover:text-foreground"><${Icon} n="copy" /></button>
      ${B && !m.ativo ? html`<button type="button" title="Restaurar" aria-label=${`Restaurar ${m.nome}`} onClick=${() => acoes.arquivarModelo(m.id, m.nome, false)} class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#efefef] hover:text-foreground"><${Icon} n="rotate" /></button>`
        : html`<button type="button" title="Apagar" aria-label=${`Apagar ${m.nome}`} onClick=${() => setApagando(m)} class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-[#b42318]"><${Icon} n="trash" /></button>`}
    </div></td>
  </tr>`;

  const colgroup = html`<colgroup>${cols.map((w, i) => html`<col key=${i} style=${`width:${w}%`} />`)}</colgroup>`;
  const thead = html`<thead><tr class="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"><th class=${TH}>Modelo</th><th class=${TH}>Aplica-se a</th><th class=${TH}>Lacunas</th>${B && html`<th class=${TH}>Versão</th>`}<th class=${TH}>Atualizado</th><th class=${TH}>Usado em</th><th class=${cn(TH, "text-center")}>Ações</th></tr></thead>`;

  return html`<div class="space-y-5">
    <div class="flex flex-wrap items-center gap-2.5">
      <${Busca} id="busca-modelos" valor=${f.busca} onTroca=${(v) => setF({ busca: v })} placeholder="Buscar modelo" class="w-full sm:w-72" />
      <${Segmentado} rotulo="Aplica-se a" valor=${f.parte} onTroca=${(v) => setF({ parte: v })} opcoes=${[{ k: "todos", rotulo: "Todos" }, { k: "cliente", rotulo: "Cliente" }, { k: "fornecedor", rotulo: "Fornecedor" }]} />
      <div class="ml-auto"><${Botao} icone="plus" onClick=${() => abrirEditor(null)}>Novo modelo</${Botao}></div>
    </div>

    <div class="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table class="w-full min-w-[980px] table-fixed border-collapse text-sm">
        ${colgroup}${thead}
        <tbody>
          ${tipos.map((t) => {
            const ms = ativos.filter((m) => m.tipo === t);
            const futuro = !B && t === "influenciador";
            if (!ms.length && !futuro) return null;
            return [
              html`<tr key=${`g-${t}`} class=${FAIXA_GRUPO_LISTA}><td colSpan=${cols.length} class="px-4 py-2"><span class="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">${TIPOS[t].rotulo}</span><span class="ml-2 text-[12px] text-muted-foreground">${futuro ? "2ª etapa" : `${ms.length} ${ms.length === 1 ? "modelo" : "modelos"}`} · ${TIPOS[t].desc}</span></td></tr>`,
              ...ms.map(linha),
              futuro && html`<tr key="futuro"><td colSpan=${cols.length} class="px-4 py-4 text-[13px] text-muted-foreground"><span class="inline-flex items-center gap-2"><${Icon} n="clock" c="h-4 w-4" />Previsto para a 2ª etapa: o caso mais complexo, com entregas por rede, aprovação prévia e direitos de imagem.</span></td></tr>`,
            ];
          })}
        </tbody>
      </table>
    </div>

    ${B && arquivados.length > 0 && html`<div>
      <button type="button" aria-expanded=${verArquivados} onClick=${() => setVerArquivados(!verArquivados)} class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"><${Icon} n="archive" />Arquivados (${arquivados.length})<${Icon} n="chevronDown" c=${cn("h-4 w-4 transition-transform", verArquivados && "rotate-180")} /></button>
      ${verArquivados && html`<div class="mt-3 overflow-x-auto rounded-2xl border border-border bg-card"><table class="w-full min-w-[980px] table-fixed border-collapse text-sm">${colgroup}<tbody>${arquivados.map(linha)}</tbody></table></div>`}
    </div>`}

    <p class="text-[12px] text-muted-foreground">Os modelos desta aba são os que aparecem na escolha de modelo ao elaborar o contrato de um job ou de uma PP.</p>

    ${apagando && html`<${Modal} aberta onFechar=${() => setApagando(null)} titulo=${B && apagando.usos > 0 ? "Este modelo já foi usado" : "Apagar modelo?"}
      descricao=${apagando.nome}
      rodape=${B && apagando.usos > 0 ? html`<${Botao} v="secundario" onClick=${() => setApagando(null)}>Cancelar</${Botao}><${Botao} v="secundario" class="text-[#b42318]" onClick=${() => { acoes.apagarModelo(apagando.id, apagando.nome); setApagando(null); }}>Apagar mesmo assim</${Botao}><${Botao} v="primario" icone="archive" onClick=${() => { acoes.arquivarModelo(apagando.id, apagando.nome); setApagando(null); }}>Arquivar</${Botao}>`
        : html`<${Botao} v="secundario" onClick=${() => setApagando(null)}>Cancelar</${Botao}><${Botao} v="perigo" icone="trash" onClick=${() => { acoes.apagarModelo(apagando.id, apagando.nome); setApagando(null); }}>Apagar modelo</${Botao}>`}>
      <p class="text-[13.5px] leading-relaxed">${B && apagando.usos > 0
        ? `Ele gerou ${apagando.usos} ${apagando.usos === 1 ? "contrato" : "contratos"}. Arquivar tira o modelo da escolha e mantém o histórico de qual minuta cada contrato usou. Apagar perde essa referência.`
        : apagando.usos > 0 ? `Ele sai da escolha de modelos. Os ${apagando.usos} contratos já gerados com ele não mudam.` : "Ele sai da escolha de modelos. Nenhum contrato foi gerado com ele."}</p>
    </${Modal}>`}
  </div>`;
}

/* Editor de modelo: texto da minuta à esquerda, prévia ao vivo à direita. */
function EditorModelo({ id, onFechar }) {
  const { db, B, acoes } = useStore();
  const original = id ? modeloDe(db, id) : null;
  const [m, setM] = useState(() => original ? clone(original) : { id: `m-${Date.now()}`, nome: "", tipo: "prestacao", parte: "fornecedor", versao: 1, usos: 0, ativo: true, descricao: "", lacunas: [{ chave: "objeto", rotulo: "Objeto da contratação", tipo: "longo", obrigatoria: true, dica: "" }], clausulasOpcionais: [], corpo: CORPO_NOVO });
  const [menuCampo, setMenuCampo] = useState(false);
  const [novaLacuna, setNovaLacuna] = useState(null);
  const texto = useRef(null);
  const cursor = useRef(null);
  const guardarCursor = (ev) => { cursor.current = [ev.target.selectionStart, ev.target.selectionEnd]; };

  const amostras = db.contratos.filter((c) => c.parte === m.parte && c.origem !== "solicitacao" && (m.tipo === "aditivo" ? c.tipo === "aditivo" : c.tipo !== "aditivo") && visivel(c, B));
  const [amostraId, setAmostraId] = useState(null);
  const amostra = amostras.find((c) => c.id === amostraId) || amostras[0];
  const ctx = amostra ? contextoDoContrato(db, amostra) : {};
  const lacunas = lacunasDoModelo(m);
  const nos = montarDocumento(m.corpo, ctx, {}, B ? m.clausulasOpcionais : []);
  const desconhecidos = chavesDeSistema(m.corpo).filter((k) => !(k in ROTULO_CAMPO) || (!B && k.startsWith("aditivo.")));
  const set = (patch) => setM((x) => ({ ...x, ...patch }));

  const inserir = (trecho) => {
    const el = texto.current;
    const [ini, fim] = cursor.current || [m.corpo.length, m.corpo.length];
    const corpo = m.corpo.slice(0, ini) + trecho + m.corpo.slice(fim);
    set({ corpo });
    cursor.current = [ini + trecho.length, ini + trecho.length];
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = ini + trecho.length; } });
  };
  const mudarLacuna = (chave, patch) => {
    const existe = m.lacunas.some((l) => l.chave === chave);
    const base = lacunas.find((l) => l.chave === chave);
    set({ lacunas: existe ? m.lacunas.map((l) => (l.chave === chave ? { ...l, ...patch } : l)) : [...m.lacunas, { ...base, ...patch }] });
  };
  const confirmarLacuna = () => {
    const rot = (novaLacuna || "").trim();
    if (!rot) return;
    let chave = slug(rot), i = 2;
    while (lacunas.some((l) => l.chave === chave)) chave = `${slug(rot)}_${i++}`;
    set({ lacunas: [...m.lacunas, { chave, rotulo: rot, tipo: "curto", obrigatoria: true, dica: "" }] });
    setNovaLacuna(null);
    setTimeout(() => inserir(`{{lacuna.${chave}}}`), 0);
  };
  const salvar = () => {
    const limpo = { ...m, lacunas: lacunas.map((l) => ({ ...l })), atualizadoEm: HOJE, atualizadoPor: USUARIO.nome, versao: original && B ? original.versao + 1 : m.versao };
    acoes.salvarModelo(limpo, !original);
    onFechar();
  };
  const podeSalvar = m.nome.trim() && m.corpo.trim() && desconhecidos.length === 0;

  return html`<div class="flex h-full min-h-0 flex-col">
    <div class="cabeca-gaveta flex items-start justify-between gap-4 border-b border-border bg-white px-6 py-5">
      <div class="min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">Modelos de contrato</p>
        <h2 class="mt-1 truncate text-xl font-bold tracking-tight">${original ? `Editar · ${original.nome}` : "Novo modelo"}</h2>
        ${original && B && html`<p class="text-[12.5px] text-muted-foreground">Versão atual v${original.versao}. Salvar cria a v${original.versao + 1}; os ${original.usos} contratos já gerados continuam na v${original.versao}.</p>`}
      </div>
      <button type="button" onClick=${onFechar} aria-label="Fechar" class="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><${Icon} n="x" c="h-5 w-5" /></button>
    </div>
    <div class="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
      <div class="min-h-0 space-y-5 px-6 py-6 lg:overflow-y-auto lg:border-r lg:border-border">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2"><${Rotulo} para="mod-nome" obrigatorio>Nome do modelo</${Rotulo}><input id="mod-nome" value=${m.nome} onInput=${(e) => set({ nome: e.target.value })} placeholder="Ex.: Locação de equipamentos" class=${CAMPO} /></div>
          <div><${Rotulo} para="mod-tipo" obrigatorio>Tipo</${Rotulo}><${Selecao} id="mod-tipo" valor=${m.tipo} onTroca=${(v) => set({ tipo: v })} opcoes=${ORDEM_TIPOS.filter((t) => B || (!TIPOS[t].soNaB && t !== "influenciador")).map((t) => ({ k: t, rotulo: TIPOS[t].rotulo }))} /></div>
          <div><${Rotulo} para="mod-parte" obrigatorio>Aplica-se a</${Rotulo}><${Selecao} id="mod-parte" valor=${m.parte} onTroca=${(v) => { set({ parte: v }); setAmostraId(null); }} opcoes=${[{ k: "fornecedor", rotulo: "Fornecedor (PP)" }, { k: "cliente", rotulo: "Cliente (job)" }]} /></div>
          <div class="sm:col-span-2"><${Rotulo} para="mod-desc">Descrição curta</${Rotulo}><input id="mod-desc" value=${m.descricao} onInput=${(e) => set({ descricao: e.target.value })} placeholder="Aparece no cartão de escolha do modelo" class=${CAMPO} /></div>
        </div>

        <div>
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <p class="mr-auto text-[12px] font-semibold">Texto da minuta <span class="text-california-red">*</span></p>
            <div class="relative">
              <${Botao} v="secundario" t="xs" icone="lock" onClick=${() => setMenuCampo(!menuCampo)}>Campo do sistema<${Icon} n="chevronDown" c="h-3 w-3" /></${Botao}>
              ${menuCampo && html`<div class="fixed inset-0 z-[60]" onClick=${() => setMenuCampo(false)}></div>
                <div class="absolute right-0 top-[calc(100%+6px)] z-[61] max-h-[340px] w-[300px] overflow-y-auto rounded-xl border border-border bg-white p-1.5 shadow-elevated">
                  ${CAMPOS_SISTEMA.filter((g) => B || !g.soNaB).map((g) => html`<div key=${g.grupo}><p class="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">${g.grupo}</p>
                    ${g.itens.map(([k, r]) => html`<button key=${k} type="button" onClick=${() => { setMenuCampo(false); inserir(`{{${k}}}`); }} class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[#f4f4f2]"><span>${r}</span><code class="text-[10.5px] text-muted-foreground">${k}</code></button>`)}
                  </div>`)}
                </div>`}
            </div>
            ${novaLacuna === null ? html`<${Botao} v="secundario" t="xs" icone="plus" onClick=${() => setNovaLacuna("")}>Lacuna</${Botao}>`
              : html`<span class="inline-flex items-center gap-1"><input id="nova-lacuna" autoFocus value=${novaLacuna} onInput=${(e) => setNovaLacuna(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") confirmarLacuna(); if (e.key === "Escape") setNovaLacuna(null); }} placeholder="Nome da lacuna" class="h-7 w-40 rounded-md border border-border px-2 text-[12px] outline-none focus:border-california-red/50" /><${Botao} t="xs" onClick=${confirmarLacuna}>Inserir</${Botao}></span>`}
          </div>
          <textarea id="mod-corpo" ref=${texto} rows="18" value=${m.corpo} onInput=${(e) => { set({ corpo: e.target.value }); guardarCursor(e); }} onSelect=${guardarCursor} onKeyUp=${guardarCursor} onClick=${guardarCursor} spellcheck="false" class=${cn(AREA, "font-mono text-[12px] leading-[1.6]")}></textarea>
          <p class="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground"><code># </code>título · <code>## </code>cláusula, numerada sozinha · <code>{{lacuna.nome}}</code> lacuna · ${B && html`<code>[clausulas_opcionais]</code> onde entram as opcionais · `}<code>[assinaturas]</code> bloco de assinaturas</p>
          ${desconhecidos.length > 0 && html`<p class="mt-2 flex gap-2 rounded-lg bg-california-red-soft px-3 py-2 text-[12px] text-[#9f2a33]"><${Icon} n="alert" c="mt-0.5 h-3.5 w-3.5" />O sistema não conhece: ${desconhecidos.join(", ")}. Use o botão “Campo do sistema”.</p>`}
        </div>

        <section>
          <p class="mb-2 text-[12px] font-semibold">Lacunas deste modelo · ${lacunas.length}</p>
          ${lacunas.length === 0 ? html`<p class="text-[12.5px] text-muted-foreground">Nenhuma lacuna no texto. Toda minuta precisa ao menos do objeto da contratação.</p>` : html`<div class="space-y-2">
            ${lacunas.map((l) => html`<div key=${l.chave} class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 sm:grid-cols-[minmax(0,3fr)_110px_auto]">
              <input aria-label=${`Rótulo da lacuna ${l.chave}`} value=${l.rotulo} onInput=${(e) => mudarLacuna(l.chave, { rotulo: e.target.value })} class="h-8 min-w-0 rounded-md border border-transparent px-2 text-[13px] font-semibold outline-none hover:border-border focus:border-california-red/50" />
              <select aria-label="Tamanho do campo" value=${l.tipo} onChange=${(e) => mudarLacuna(l.chave, { tipo: e.target.value })} class="hidden h-8 rounded-md border border-border bg-white px-2 text-[12px] sm:block"><option value="curto">Texto curto</option><option value="longo">Texto longo</option></select>
              <label class="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"><input type="checkbox" checked=${l.obrigatoria} onChange=${(e) => mudarLacuna(l.chave, { obrigatoria: e.target.checked })} class="accent-[#E74B56]" />Obrigatória</label>
            </div>`)}
          </div>`}
        </section>

        ${B && html`<section>
          <p class="mb-2 text-[12px] font-semibold">Cláusulas opcionais oferecidas</p>
          ${!m.corpo.includes("[clausulas_opcionais]") && html`<p class="mb-2 text-[12px] text-[#92400e]">Coloque <code>[clausulas_opcionais]</code> no texto para elas aparecerem.</p>`}
          <div class="grid gap-2 sm:grid-cols-2">${Object.entries(CLAUSULAS).map(([k, c]) => {
            const on = m.clausulasOpcionais.includes(k);
            return html`<label key=${k} class=${cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2", on ? "border-california-red/35 bg-[#fffafa]" : "border-border bg-white")}><input type="checkbox" checked=${on} onChange=${() => set({ clausulasOpcionais: on ? m.clausulasOpcionais.filter((x) => x !== k) : [...m.clausulasOpcionais, k] })} class="mt-0.5 accent-[#E74B56]" /><span class="min-w-0"><span class="block text-[12.5px] font-semibold">${c.titulo}</span><span class="block text-[11.5px] text-muted-foreground">${c.resumo}</span></span></label>`;
          })}</div>
        </section>`}
      </div>

      <div class="min-h-0 bg-[#efeeeb] px-4 py-6 sm:px-8 lg:overflow-y-auto">
        <div class="mx-auto mb-3 flex max-w-[720px] flex-wrap items-center justify-between gap-2">
          <p class="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Prévia ${B ? "com dados reais" : "com dados de exemplo"}</p>
          ${B && amostras.length > 0 && html`<${Selecao} id="amostra" rotulo="Prévia com" valor=${amostra.id} onTroca=${setAmostraId} class="w-[260px]" opcoes=${amostras.map((c) => { const i = infoContrato(db, c); return { k: c.id, rotulo: `${i.codigo} · ${i.contraparte.nome}` }; })} />`}
        </div>
        <${Papel} nos=${nos} ctx=${ctx} lacunas=${lacunas} />
      </div>
    </div>
    <div class="rodape-gaveta flex flex-wrap items-center justify-end gap-2 border-t border-border bg-white px-6 py-3">
      ${!podeSalvar && html`<p class="mr-auto text-[12px] text-muted-foreground">${!m.nome.trim() ? "Dê um nome ao modelo para salvar." : desconhecidos.length ? "Corrija os campos que o sistema não conhece." : ""}</p>`}
      <${Botao} v="secundario" t="sm" onClick=${onFechar}>Cancelar</${Botao}>
      <${Botao} t="sm" icone="check" disabled=${!podeSalvar} onClick=${salvar}>${original ? (B ? `Salvar como v${original.versao + 1}` : "Salvar modelo") : "Criar modelo"}</${Botao}>
    </div>
  </div>`;
}
