/* ---------- Sidebar (cópia do comportamento de components/sidebar.tsx) ---------- */

const LOGO = "data:image/png;base64,__LOGO__";

function Sidebar() {
  const { ui, ir, db, B } = useStore();
  const [hover, setHover] = useState(false);
  const [mob, setMob] = useState(false);
  const exp = hover || mob;
  const pendentes = contratosEmAberto(db, B).filter((c) => c.status === "pendente").length;
  const links = [
    { k: "home", rot: "Home", ic: "home" },
    { k: "orcamentos", rot: "Orçamentos", ic: "fileText" },
    { k: "jobs", rot: "Jobs", ic: "briefcase" },
    { k: "suprimentos", rot: "Suprimentos", ic: "package" },
    { k: "juridico", rot: "Jurídico", ic: "scale", badge: pendentes, novo: true },
    { k: "desembolsos", rot: "Desembolsos", ic: "wallet" },
    { k: "financeiro", rot: "Financeiro", ic: "landmark" },
    { k: "relatorios", rot: "Relatórios", ic: "barChart" },
    { k: "rh", rot: "RH", ic: "users" },
    { k: "freelancers", rot: "Freelancers", ic: "userCheck" },
  ];
  const ativo = ui.tela === "job" ? "jobs" : ui.tela;
  const larguraItem = exp ? 232 : 44;
  const trans = "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]";
  return html`
    <button type="button" class="menu-movel fixed z-50 rounded-lg bg-california-dark p-2.5 text-white shadow-elevated md:hidden" onClick=${() => setMob(!mob)} aria-label=${mob ? "Fechar menu" : "Abrir menu"}><${Icon} n=${mob ? "x" : "menu"} c="h-5 w-5" /></button>
    ${mob && html`<div class="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden" onClick=${() => setMob(false)}></div>`}
    <aside onMouseEnter=${() => setHover(true)} onMouseLeave=${() => setHover(false)}
      class=${cn("barra-lateral scrollbar-dark fixed inset-y-0 left-0 z-40 flex flex-col bg-california-dark text-white", trans, "w-64 -translate-x-full md:translate-x-0", mob && "translate-x-0", exp ? "md:w-64" : "md:w-[76px]", hover && "md:shadow-2xl md:shadow-black/30")}>
      <div class="px-3 pb-5 pt-6">
        <div class="flex items-center gap-3">
          <img src=${LOGO} alt="Agência California" width="48" height="48" class="h-12 w-12 shrink-0 object-contain" />
          <div class=${cn("min-w-0 overflow-hidden", trans, exp ? "opacity-100" : "pointer-events-none -translate-x-2 opacity-0")}>
            <p class="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">Agência</p>
            <p class="mt-1 whitespace-nowrap font-display text-xl font-semibold leading-none tracking-tight">California</p>
          </div>
        </div>
      </div>
      <div class="px-4"><div class="h-px bg-white/10"></div></div>
      <nav class="scrollbar-dark flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-5">
        <p class=${cn("mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40", trans, exp ? "opacity-100" : "opacity-0")}>Menu</p>
        ${links.map((l) => {
          const on = ativo === l.k;
          return html`<button key=${l.k} type="button" title=${exp ? undefined : l.rot} onClick=${() => { setMob(false); ir(l.k); }} class="group block w-full text-left">
            <div style=${`width:${larguraItem}px`} class=${cn("relative flex h-11 shrink-0 items-center overflow-hidden rounded-lg text-sm font-medium", trans, on ? "bg-[#3E3E3E] text-white" : "text-white/60 group-hover:bg-white/5 group-hover:text-white")}>
              ${on && html`<span class="absolute inset-y-0 left-0 w-1 bg-california-red"></span>`}
              <div class="relative flex h-full w-11 shrink-0 items-center justify-center">
                <${Icon} n=${l.ic} c=${cn("h-[18px] w-[18px] transition-colors", on ? "text-california-red" : "text-white/50 group-hover:text-white/80")} />
                ${l.badge > 0 && !exp && html`<span class="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-california-red ring-2 ring-california-dark"></span>`}
              </div>
              <div class=${cn("flex min-w-0 flex-1 items-center gap-2 pr-3", trans, exp ? "opacity-100" : "opacity-0")}>
                <span class="flex-1 truncate whitespace-nowrap">${l.rot}</span>
                ${l.novo && html`<span class="rounded bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-white/70">novo</span>`}
                ${l.badge > 0 && html`<span class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">${l.badge}</span>`}
              </div>
            </div>
          </button>`;
        })}
      </nav>
      <div class="px-4"><div class="h-px bg-white/10"></div></div>
      <div class="flex items-center gap-3 px-4 py-4">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-bold">${iniciais(USUARIO.nome)}</span>
        <div class=${cn("min-w-0", trans, exp ? "opacity-100" : "opacity-0")}>
          <p class="truncate whitespace-nowrap text-[13px] font-semibold">${USUARIO.nome}</p>
          <p class="whitespace-nowrap text-[11px] text-white/50">${USUARIO.papel}</p>
        </div>
      </div>
    </aside>`;
}

/* ---------- Barra do protótipo (não faz parte do ERP) ---------- */

function BarraPrototipo({ onNotas }) {
  const { ui, setVersao, acoes, reiniciar } = useStore();
  const [menu, setMenu] = useState(false);
  const B = ui.versao === "B";
  return html`<div class="barra-proto fixed z-[45] flex max-w-[calc(100vw-24px)] items-center gap-1.5 rounded-2xl border border-[#3a3a3a] bg-[#1d1d1d]/95 p-1.5 text-white shadow-2xl backdrop-blur">
    <span class="hidden items-center gap-1.5 pl-2 pr-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/50 lg:inline-flex"><span class="h-1.5 w-1.5 rounded-full bg-california-red"></span>Protótipo</span>
    <div role="radiogroup" aria-label="Versão do protótipo" class="inline-flex rounded-xl bg-white/5 p-0.5">
      ${[["A", "Versão A", "como pedido"], ["B", "Versão B", "recomendada"]].map(([k, r, s]) => html`<button key=${k} type="button" role="radio" aria-checked=${ui.versao === k} onClick=${() => setVersao(k)}
        class=${cn("rounded-[10px] px-3 py-1.5 text-left leading-tight transition-colors", ui.versao === k ? "bg-white text-california-dark" : "text-white/70 hover:text-white")}>
        <span class="block text-[12.5px] font-bold">${r}</span><span class=${cn("hidden text-[10.5px] sm:block", ui.versao === k ? "text-[#6b6b6b]" : "text-white/45")}>${s}</span>
      </button>`)}
    </div>
    <div class="relative">
      <button type="button" aria-haspopup="menu" aria-expanded=${menu} onClick=${() => setMenu(!menu)} class="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-white/85 hover:bg-white/10"><${Icon} n="zap" c="h-4 w-4 text-[#fbbf24]" /><span class="hidden sm:inline">Simular</span><${Icon} n="chevronDown" c="h-3.5 w-3.5 text-white/50" /></button>
      ${menu && html`<div class="fixed inset-0 z-[56]" onClick=${() => setMenu(false)}></div>
        <div role="menu" class="absolute bottom-[calc(100%+8px)] left-1/2 z-[57] w-[300px] -translate-x-1/2 rounded-xl border border-border bg-white p-1.5 text-foreground shadow-elevated anim-sobe">
          <p class="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Gatilhos do módulo</p>
          <button type="button" role="menuitem" onClick=${() => { setMenu(false); acoes.simularJob(); }} class="flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#f4f4f2]"><${Icon} n="briefcase" c="mt-0.5 h-4 w-4 text-muted-foreground" /><span><span class="block text-[13px] font-semibold">Financeiro abre um job</span><span class="block text-[11.5px] text-muted-foreground">Orçamento aprovado vira contrato com o cliente</span></span></button>
          <button type="button" role="menuitem" onClick=${() => { setMenu(false); acoes.simularPP(); }} class="flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#f4f4f2]"><${Icon} n="package" c="mt-0.5 h-4 w-4 text-muted-foreground" /><span><span class="block text-[13px] font-semibold">Suprimentos gera uma PP</span><span class="block text-[11.5px] text-muted-foreground">PP gerada vira contrato com o fornecedor</span></span></button>
          <div class="my-1 h-px bg-border"></div>
          <button type="button" role="menuitem" onClick=${() => { setMenu(false); reiniciar(); }} class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium hover:bg-[#f4f4f2]"><${Icon} n="rotate" c="h-4 w-4 text-muted-foreground" />Recomeçar com os dados de exemplo</button>
        </div>`}
    </div>
    <button type="button" onClick=${onNotas} class=${cn("inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold hover:bg-white/10", B ? "text-white" : "text-white/85")}><${Icon} n="sparkles" c="h-4 w-4 text-[#f9a8b0]" /><span class="hidden sm:inline">O que muda na B</span><span class="sm:hidden">B?</span></button>
  </div>`;
}

const NOTAS_B = [
  { aba: "Caixa de entrada", itens: [
    { t: "Painel do que trava pagamento", d: "Quatro números no topo, com o valor das PPs aprovadas que não podem ser pagas por falta de contrato. Clicar num número filtra a fila.", ir: { aba: "entrada" } },
    { t: "Prazo no lugar de “chegou em”", d: "A fila ordena pelo que trava pagamento primeiro: o vencimento da PP (fornecedor) ou o início do job (cliente). Faixa vermelha até 5 dias, âmbar até 10.", ir: { aba: "entrada" } },
    { t: "Lista ou quadro", d: "A mesma fila em colunas por status, para quem prefere ver o funil.", ir: { aba: "entrada", visao: "quadro" } },
    { t: "Aditivo automático", d: "PP reemitida com valor acima do contrato assinado gera um aditivo pendente e volta a travar o pagamento. Exemplo: PP-00498.", ir: { aba: "entrada", busca: "00498" } },
    { t: "Solicitação manual", d: "Para o que não nasce de job nem de PP: confidencialidade, contrato antecipado, aditivo pedido pela produção. Os campos são os da reunião: qualificação, escopo, valor, condição e prazo.", ir: { aba: "entrada", modal: "solicitacao" } },
  ] },
  { aba: "Elaboração do contrato", itens: [
    { t: "Um contrato para várias PPs", d: "Quando o mesmo fornecedor tem mais de uma PP pendente no job, dá para gerar um contrato só. Exemplo: LuzCine no JOB-0412.", ir: { contrato: "c-pp521" } },
    { t: "Contrato-quadro", d: "Fornecedor recorrente com contrato vigente: a PP é vinculada a ele e o pagamento libera, sem contrato novo. Exemplo: Rodas Transportes.", ir: { contrato: "c-pp506" } },
    { t: "Dispensa com justificativa", d: "PP abaixo do limite (R$ 5.000 no exemplo, configurável) pode ser dispensada. O motivo fica no histórico e libera o pagamento.", ir: { contrato: "c-pp527" } },
    { t: "Objeto sugerido pela PP", d: "O escopo, única lacuna sem dado no sistema, vem sugerido do serviço e das especificações da PP. Se faltar informação, “Pedir ao produtor” manda a pergunta para a Comunicação do job.", ir: { contrato: "c-pp524" } },
    { t: "Cláusulas opcionais", d: "Confidencialidade, cessão de imagem, multa, seguro e LGPD. Cada modelo diz quais oferece, e a numeração das cláusulas se ajusta sozinha.", ir: { contrato: "c-pp524" } },
    { t: "Histórico do contrato", d: "Cada passo fica registrado: quando chegou, quem salvou, qual versão do modelo, quem anexou o assinado.", ir: { contrato: "c-j412" } },
  ] },
  { aba: "Contratos por job", itens: [
    { t: "Pasta do job", d: "A aba vira uma pasta: progresso do job, cliente no topo e fornecedores agrupados, cada um com suas PPs e aditivos.", ir: { aba: "porjob", jobId: "j412" } },
  ] },
  { aba: "Modelos de contrato", itens: [
    { t: "Modelos com versão", d: "Salvar um modelo cria uma versão nova; o contrato guarda a versão que usou. Modelo já usado é arquivado em vez de apagado.", ir: { aba: "modelos" } },
    { t: "Influenciador como rascunho", d: "O tipo da 2ª etapa já entra como rascunho, com entregas por rede, aprovação prévia e prazo de imagem, para o jurídico validar.", ir: { aba: "modelos" } },
    { t: "Prévia com dados reais", d: "O editor mostra a minuta preenchida com uma PP ou um job de verdade.", ir: { aba: "modelos" } },
  ] },
];

function NotasB({ aberta, onFechar, onMostrar }) {
  return html`<${Modal} aberta=${aberta} onFechar=${onFechar} largura="max-w-2xl" titulo="O que muda na versão B"
    descricao="A versão A é o módulo como foi pedido. A B mantém tudo e acrescenta o que recomendo. Cada item tem um atalho para ver na tela."
    rodape=${html`<${Botao} v="secundario" onClick=${onFechar}>Fechar</${Botao}>`}>
    <div class="space-y-6">
      ${NOTAS_B.map((g) => html`<section key=${g.aba}>
        <p class="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-california-red">${g.aba}</p>
        <ul class="divide-y divide-border rounded-xl border border-border">
          ${g.itens.map((it) => html`<li key=${it.t} class="flex items-start gap-3 px-4 py-3">
            <div class="min-w-0 flex-1"><p class="text-[13.5px] font-semibold">${it.t}</p><p class="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">${it.d}</p></div>
            <${Botao} v="secundario" t="xs" onClick=${() => onMostrar(it.ir)}>Ver<${Icon} n="arrowRight" c="h-3 w-3" /></${Botao}>
          </li>`)}
        </ul>
      </section>`)}
    </div>
  </${Modal}>`;
}
