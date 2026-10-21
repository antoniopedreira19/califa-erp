/* ---------- Edição direto no documento (como no Docs ou no Word) ----------
 *
 * O texto continua guardado com marcadores ({{parte.cnpj}}, {{lacuna.objeto}},
 * "## cláusula"), mas quem edita vê o documento. Campos do sistema e lacunas
 * viram blocos que não se digitam por dentro: entram pela barra e saem com
 * Apagar. Na implementação real, isso é um editor como o TipTap/ProseMirror
 * com nós próprios para campo e lacuna; aqui é contenteditable puro.
 *
 * O componente editável é NÃO controlado: o HTML inicial entra uma vez (o
 * `__html` só muda quando a `versao` muda) e cada digitação volta como texto
 * com marcadores. Re-renderizar o conteúdo a cada tecla perderia o cursor. */

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function chipHtml(chave, lacunas) {
  const [g, k] = chave.split(".");
  if (g === "lacuna") {
    const l = lacunas.find((x) => x.chave === k);
    return `<span class="chip chip-lac" contenteditable="false" data-k="${esc(chave)}" title="Lacuna: preenchida em cada contrato">${esc(l ? l.rotulo : k.replace(/_/g, " "))}</span>`;
  }
  const info = ROTULO_CAMPO[chave];
  if (!info) return `<span class="chip chip-erro" contenteditable="false" data-k="${esc(chave)}" title="O sistema não conhece este campo">${esc(chave)}</span>`;
  return `<span class="chip chip-sys" contenteditable="false" data-k="${esc(chave)}" title="Do sistema · ${esc(info.origem)}">${esc(info.rotulo)}</span>`;
}

function linhaParaHtml(texto, lacunas) {
  let out = "", ult = 0;
  texto.replace(RE_CAMPO, (m, g, k, pos) => { out += esc(texto.slice(ult, pos)) + chipHtml(`${g}.${k}`, lacunas); ult = pos + m.length; return m; });
  return out + esc(texto.slice(ult));
}

const BLOCO_OPCIONAIS = `<div class="bloco-fixo" contenteditable="false" data-t="opcionais">Aqui entram as cláusulas opcionais marcadas em cada contrato</div>`;
const BLOCO_ASSINATURAS = `<div class="bloco-fixo" contenteditable="false" data-t="assinaturas">Assinaturas das partes</div>`;

function corpoParaHtml(corpo, lacunas) {
  const out = [];
  let par = [];
  const fecha = () => { if (par.length) { out.push(`<p>${linhaParaHtml(par.join(" "), lacunas)}</p>`); par = []; } };
  for (const crua of corpo.split("\n")) {
    const l = crua.trim();
    if (!l) { fecha(); continue; }
    if (l.startsWith("# ")) { fecha(); out.push(`<h3>${linhaParaHtml(l.slice(2), lacunas)}</h3>`); continue; }
    if (l.startsWith("## ")) { fecha(); out.push(`<h4>${linhaParaHtml(l.slice(3), lacunas)}</h4>`); continue; }
    if (l === "[clausulas_opcionais]") { fecha(); out.push(BLOCO_OPCIONAIS); continue; }
    if (l === "[assinaturas]") { fecha(); out.push(BLOCO_ASSINATURAS); continue; }
    par.push(l);
  }
  fecha();
  return out.join("");
}

function inlineParaTexto(no) {
  let s = "";
  for (const n of no.childNodes) {
    if (n.nodeType === 3) s += n.textContent.replace(/ /g, " ");
    else if (n.nodeType === 1) {
      if (n.dataset && n.dataset.k) s += `{{${n.dataset.k}}}`;
      else if (n.tagName === "BR") s += " ";
      else s += inlineParaTexto(n);
    }
  }
  return s;
}

function htmlParaCorpo(raiz) {
  const blocos = [];
  for (const el of raiz.childNodes) {
    if (el.nodeType === 3) { const t = el.textContent.replace(/ /g, " ").trim(); if (t) blocos.push(t); continue; }
    if (el.nodeType !== 1) continue;
    if (el.dataset && el.dataset.t === "opcionais") { blocos.push("[clausulas_opcionais]"); continue; }
    if (el.dataset && el.dataset.t === "assinaturas") { blocos.push("[assinaturas]"); continue; }
    if (el.dataset && el.dataset.k) { blocos.push(`{{${el.dataset.k}}}`); continue; }
    const txt = inlineParaTexto(el).replace(/\s+/g, " ").trim();
    if (!txt) continue;
    if (el.tagName === "H3") blocos.push("# " + txt);
    else if (el.tagName === "H4") blocos.push("## " + txt);
    else blocos.push(txt);
  }
  return blocos.join("\n\n");
}

/* Colar sempre como texto: a formatação do Word não entra no contrato. */
function colarComoTexto(e) {
  e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, t);
}

/* Clique num campo travado: o cursor vai para logo depois dele, em vez de
 * o clique se perder (o bloco não é editável por dentro). */
function cursorDepoisDoBloco(e, raiz) {
  const bloco = e.target.closest && e.target.closest('[contenteditable="false"]');
  if (!bloco || !raiz || bloco === raiz || !raiz.contains(bloco)) return;
  e.preventDefault();
  raiz.focus();
  const r = document.createRange();
  r.setStartAfter(bloco);
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function usarSelecaoGuardada(ref) {
  const sel = useRef(null);
  useEffect(() => {
    const guardar = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && ref.current && ref.current.contains(s.anchorNode)) sel.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", guardar);
    return () => document.removeEventListener("selectionchange", guardar);
  }, []);
  const restaurar = () => {
    const el = ref.current;
    el.focus();
    const s = window.getSelection();
    let r = sel.current;
    if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
    s.removeAllRanges();
    s.addRange(r);
    return r;
  };
  return restaurar;
}

const BOTAO_BARRA = "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold text-foreground hover:bg-[#f1f1ef] disabled:opacity-40";

/* Editor de MODELO: a minuta inteira, com campos e lacunas como blocos. */
function EditorDocumento({ corpo, lacunas, versao, onMuda, onNovaLacuna }) {
  const ref = useRef(null);
  const restaurar = usarSelecaoGuardada(ref);
  const [menuCampo, setMenuCampo] = useState(false);
  const [novaLacuna, setNovaLacuna] = useState(null);
  const inicial = useMemo(() => ({ __html: corpoParaHtml(corpo, lacunas) }), [versao]);

  // O rótulo da lacuna, editado na lista ao lado, acompanha no documento.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll('[data-k^="lacuna."]').forEach((el) => {
      const l = lacunas.find((x) => x.chave === el.dataset.k.slice(7));
      if (l && el.textContent !== l.rotulo) el.textContent = l.rotulo;
    });
  });

  const sincronizar = () => onMuda(htmlParaCorpo(ref.current));
  const bloco = (tag) => { restaurar(); document.execCommand("formatBlock", false, tag); sincronizar(); };
  const inserirChip = (chave, lacs = lacunas) => {
    const r = restaurar();
    r.deleteContents();
    const tmp = document.createElement("span");
    tmp.innerHTML = chipHtml(chave, lacs);
    const chip = tmp.firstChild;
    const espaco = document.createTextNode(" ");
    r.insertNode(espaco);
    r.insertNode(chip);
    const depois = document.createRange();
    depois.setStartAfter(espaco);
    depois.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(depois);
    sincronizar();
  };
  const confirmarLacuna = () => {
    const rot = (novaLacuna || "").trim();
    if (!rot) return;
    const { chave, lacunas: novas } = onNovaLacuna(rot);
    setNovaLacuna(null);
    inserirChip(`lacuna.${chave}`, novas);
  };
  const semRoubarFoco = (e) => e.preventDefault();

  return html`<div class="mx-auto max-w-[760px]">
    <div class="barra-doc sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-0.5 rounded-xl border border-border bg-white p-1 shadow-soft">
      <button type="button" class=${BOTAO_BARRA} onMouseDown=${semRoubarFoco} onClick=${() => bloco("h3")} title="Título do contrato">Título</button>
      <button type="button" class=${BOTAO_BARRA} onMouseDown=${semRoubarFoco} onClick=${() => bloco("h4")} title="Começa uma cláusula. A numeração é automática.">Cláusula</button>
      <button type="button" class=${BOTAO_BARRA} onMouseDown=${semRoubarFoco} onClick=${() => bloco("p")} title="Texto corrido">Texto</button>
      <span class="mx-1 h-5 w-px bg-border"></span>
      <div class="relative">
        <button type="button" class=${BOTAO_BARRA} onMouseDown=${semRoubarFoco} onClick=${() => setMenuCampo(!menuCampo)} aria-expanded=${menuCampo}><span class="h-2.5 w-2.5 rounded-sm border border-[#9dbbe9] bg-[#eef4fd]"></span>Campo do sistema<${Icon} n="chevronDown" c="h-3 w-3" /></button>
        ${menuCampo && html`<div class="fixed inset-0 z-[60]" onMouseDown=${semRoubarFoco} onClick=${() => setMenuCampo(false)}></div>
          <div class="absolute left-0 top-[calc(100%+6px)] z-[61] max-h-[340px] w-[300px] overflow-y-auto rounded-xl border border-border bg-white p-1.5 shadow-elevated">
            ${CAMPOS_SISTEMA.map((g) => html`<div key=${g.grupo}><p class="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">${g.grupo}</p>
              ${g.itens.map(([k, r, o]) => html`<button key=${k} type="button" onMouseDown=${semRoubarFoco} onClick=${() => { setMenuCampo(false); inserirChip(k); }} class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[#f4f4f2]"><span>${r}</span><span class="text-[10.5px] text-muted-foreground">${o}</span></button>`)}
            </div>`)}
          </div>`}
      </div>
      ${novaLacuna === null ? html`<button type="button" class=${BOTAO_BARRA} onMouseDown=${semRoubarFoco} onClick=${() => setNovaLacuna("")}><span class="h-2.5 w-2.5 rounded-sm border border-dashed border-[#f3a3aa] bg-[#fdecee]"></span>Lacuna</button>`
        : html`<span class="inline-flex items-center gap-1 px-1"><input id="nova-lacuna" autoFocus value=${novaLacuna} onInput=${(e) => setNovaLacuna(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarLacuna(); } if (e.key === "Escape") setNovaLacuna(null); }} placeholder="Nome da lacuna" class="h-7 w-40 rounded-md border border-border px-2 text-[12px] outline-none focus:border-california-red/50" /><${Botao} t="xs" onMouseDown=${semRoubarFoco} onClick=${confirmarLacuna}>Inserir</${Botao}></span>`}
    </div>
    <article id="mod-documento" ref=${ref} class="papel doc-livre doc-editando" contenteditable="true" spellcheck="true" aria-label="Texto da minuta"
      onFocus=${() => document.execCommand("defaultParagraphSeparator", false, "p")}
      onMouseDown=${(e) => cursorDepoisDoBloco(e, ref.current)}
      onInput=${sincronizar} onPaste=${(e) => { colarComoTexto(e); sincronizar(); }}
      dangerouslySetInnerHTML=${inicial}></article>
    <p class="mt-3 text-center text-[11.5px] leading-relaxed text-muted-foreground">Escreva direto no documento. Campos do sistema (azul) e lacunas (vermelho) entram pela barra e saem com Apagar. A numeração das cláusulas é automática.</p>
  </div>`;
}

/* O contrato já montado, em HTML: os dados do sistema continuam travados
 * (vêm do cadastro e da PP); o resto vira texto que se edita livremente. */
function contratoParaHtml(nos, ctx) {
  const seg = (s) => s.t === "txt" ? esc(s.v) : s.t === "sys" ? `<span class="ph ph-sys" contenteditable="false" data-k="${esc(s.k)}" title="Do sistema: corrija no cadastro ou na PP">${esc(s.v ?? "")}</span>` : esc(s.v || "");
  return nos.map((no) => {
    const segs = (no.segs || []).map(seg).join("");
    if (no.t === "titulo") return `<h3>${segs}</h3>`;
    if (no.t === "clausula") return `<h4>${segs}</h4>`;
    if (no.t === "par") return `<p>${segs}</p>`;
    if (no.t === "assinaturas") { const [a, b] = ctx._partes; return `<div class="papel-assinaturas" contenteditable="false"><div><span></span>${esc(a)}</div><div><span></span>${esc(b)}</div></div>`; }
    return "";
  }).join("");
}

/* O contrato editável. `htmlInicial` precisa ficar estável enquanto se
 * edita: quem chama guarda o HTML do momento em que a edição começou. */
function ContratoEditavel({ htmlInicial, editavel, onMuda }) {
  const ref = useRef(null);
  const inicial = useMemo(() => ({ __html: htmlInicial }), [htmlInicial]);
  return html`<article ref=${ref} class=${cn("papel doc-livre", editavel ? "doc-editando" : "doc-final")} contenteditable=${editavel ? "true" : "false"} aria-label="Texto do contrato"
    onFocus=${() => editavel && document.execCommand("defaultParagraphSeparator", false, "p")}
    onMouseDown=${(e) => editavel && cursorDepoisDoBloco(e, ref.current)}
    onInput=${() => onMuda && onMuda(ref.current.innerHTML)} onPaste=${(e) => { if (!editavel) return; colarComoTexto(e); onMuda && onMuda(ref.current.innerHTML); }}
    dangerouslySetInnerHTML=${inicial}></article>`;
}
