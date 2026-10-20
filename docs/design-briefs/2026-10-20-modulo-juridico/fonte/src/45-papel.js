/* ---------- O papel: a minuta renderizada ---------- */

/* modo "edicao": campos do sistema sublinhados em azul, lacunas
 * preenchidas em verde, lacunas vazias como botão vermelho que leva ao
 * campo. modo "final": texto corrido, como sai no PDF. */
function Papel({ nos, ctx, lacunas, modo = "edicao", onIrLacuna, compacto }) {
  const rotuloLacuna = (k) => (lacunas.find((l) => l.chave === k) || { rotulo: k }).rotulo;
  const seg = (s, i) => {
    if (s.t === "txt") return s.v;
    if (s.t === "sys") {
      const info = ROTULO_CAMPO[s.k];
      if (s.v === undefined) return html`<span key=${i} class="ph ph-erro" title="Campo que o sistema não conhece">{{${s.k}}}</span>`;
      return modo === "final" ? s.v : html`<span key=${i} class="ph ph-sys" title=${`Do sistema · ${info ? info.rotulo + " (" + info.origem + ")" : s.k}`}>${s.v}</span>`;
    }
    if (s.v) return modo === "final" ? s.v : html`<span key=${i} class="ph ph-ok" title=${`Lacuna preenchida · ${rotuloLacuna(s.k)}`}>${s.v}</span>`;
    return html`<button key=${i} type="button" class="ph ph-vazia" onClick=${() => onIrLacuna && onIrLacuna(s.k)} title="Clique para preencher">[${rotuloLacuna(s.k)}]</button>`;
  };
  return html`<article class=${cn("papel", compacto && "papel-compacto")}>
    ${nos.map((no, i) => {
      if (no.t === "titulo") return html`<h3 key=${i} class="papel-titulo">${no.segs.map(seg)}</h3>`;
      if (no.t === "clausula") return html`<h4 key=${i} class=${cn("papel-clausula", no.opcional && modo !== "final" && "papel-opcional")}>CLÁUSULA ${ORDINAL(no.n)} — ${no.segs.map(seg)}${no.opcional && modo !== "final" ? html`<span class="papel-tag">opcional</span>` : null}</h4>`;
      if (no.t === "assinaturas") {
        const [a, b] = ctx && ctx._partes ? ctx._partes : ["CONTRATANTE", "CONTRATADA"];
        return html`<div key=${i} class="papel-assinaturas"><div><span></span>${a}</div><div><span></span>${b}</div></div>`;
      }
      return html`<p key=${i} class=${cn("papel-par", no.opcional && modo !== "final" && "papel-opcional")}>${no.segs.map(seg)}</p>`;
    })}
  </article>`;
}

/* Legenda das marcas do papel. */
function LegendaPapel() {
  return html`<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
    <span class="inline-flex items-center gap-1.5"><span class="ph ph-sys text-[11px]">Abc</span>Do sistema</span>
    <span class="inline-flex items-center gap-1.5"><span class="ph ph-ok text-[11px]">Abc</span>Lacuna preenchida</span>
    <span class="inline-flex items-center gap-1.5"><span class="ph ph-vazia text-[11px] pointer-events-none">[ ]</span>Lacuna a preencher</span>
  </div>`;
}
