/* ---------- Raiz ---------- */

function TelaJuridico() {
  const { ui, setUi, db, B, abrirModal } = useStore();
  const abertos = contratosEmAberto(db, B).length;
  const modelosAtivos = db.modelos.filter((m) => m.ativo && visivel(m, B)).length;
  return html`<div class="space-y-6">
    <${Cabecalho} kicker="Contratos" icone="scale" titulo="Jurídico" descricao="Contratos com clientes e fornecedores. Cada job aberto pelo financeiro e cada PP gerada por Suprimentos chegam aqui como contrato pendente.">
      <${Sino} />
      ${B && html`<${Botao} v="secundario" icone="plus" onClick=${() => abrirModal({ tipo: "solicitacao" })}>Nova solicitação</${Botao}>`}
    </${Cabecalho}>
    <${Abas} rotulo="Seções do jurídico" ativa=${ui.aba} onTroca=${(a) => setUi((u) => ({ ...u, aba: a }))} abas=${[
      { k: "entrada", rotulo: "Caixa de entrada", n: abertos },
      { k: "porjob", rotulo: "Contratos por job", n: null },
      { k: "modelos", rotulo: "Modelos de contrato", n: modelosAtivos },
    ]} />
    ${ui.aba === "entrada" ? html`<${Entrada} />` : ui.aba === "porjob" ? html`<${PorJob} />` : html`<${Modelos} />`}
  </div>`;
}

function versaoInicial() {
  try { return /versao-b|^#b$/i.test(location.hash) ? "B" : "A"; } catch (e) { return "A"; }
}

const ENTRADA_PADRAO = { busca: "", origem: "todos", status: "todos", visao: "lista", ordem: "urgencia" };

function App() {
  const [db, setDb] = useState(estadoInicial);
  const dbRef = useRef(db);
  dbRef.current = db;
  const [ui, setUi] = useState(() => ({
    versao: versaoInicial(), tela: "juridico", aba: "entrada", jobId: "j412", jobAba: "info", destaque: null, gaveta: null, modal: null,
    entrada: { ...ENTRADA_PADRAO }, porjob: { jobId: "j412", fornecedor: "todos", status: "todos" }, modelos: { busca: "", parte: "todos" },
  }));
  const [toasts, setToasts] = useState([]);
  const [notas, setNotas] = useState(false);
  const B = ui.versao === "B";

  const toast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.acao ? 8000 : 5000);
  }, []);
  const acoes = useMemo(() => usarAcoes(setDb, toast, () => dbRef.current), []);

  const topo = () => { try { window.scrollTo({ top: 0 }); } catch (e) {} };
  const ir = (tela, extra = {}) => {
    setUi((u) => ({ ...u, tela, gaveta: null, ...(extra.aba ? { aba: extra.aba } : {}), ...(extra.jobId ? { porjob: { ...u.porjob, jobId: extra.jobId, fornecedor: "todos", status: "todos" } } : {}) }));
    topo();
  };
  const irJob = (jobId, aba = "info", destaque = null) => { setUi((u) => ({ ...u, tela: "job", jobId, jobAba: aba, destaque, gaveta: null })); topo(); };
  const abrirContrato = (id, passo) => setUi((u) => ({ ...u, gaveta: { tipo: "contrato", id, passo } }));
  const abrirEditor = (id) => setUi((u) => ({ ...u, gaveta: { tipo: "modelo", id } }));
  const abrirModal = (m) => setUi((u) => ({ ...u, modal: m }));
  const fecharGaveta = () => setUi((u) => ({ ...u, gaveta: null }));
  const setVersao = (v) => setUi((u) => ({
    ...u, versao: v,
    entrada: v === "A" ? { ...u.entrada, visao: "lista", status: u.entrada.status === "travado" ? "todos" : u.entrada.status } : u.entrada,
    modal: v === "A" ? null : u.modal,
  }));
  const reiniciar = () => { setDb(estadoInicial()); setUi((u) => ({ ...u, gaveta: null, modal: null, entrada: { ...ENTRADA_PADRAO } })); toast({ titulo: "Dados reiniciados", texto: "O protótipo voltou aos dados de exemplo." }); };

  const mostrarNota = (alvo) => {
    setNotas(false);
    setUi((u) => {
      const n = { ...u, versao: "B", tela: "juridico", gaveta: null, modal: null };
      if (alvo.aba) n.aba = alvo.aba;
      if (alvo.aba === "entrada") n.entrada = { ...ENTRADA_PADRAO, visao: alvo.visao || "lista", busca: alvo.busca || "" };
      if (alvo.modal) n.modal = { tipo: alvo.modal };
      if (alvo.contrato) {
        n.aba = "entrada";
        n.entrada = { ...ENTRADA_PADRAO };
        if (alvo.contrato === "c-pp527") n.modal = { tipo: "dispensa", id: alvo.contrato };
        else n.gaveta = { tipo: "contrato", id: alvo.contrato, passo: alvo.contrato === "c-pp524" ? 2 : undefined };
      }
      return n;
    });
    topo();
  };

  const store = { db, setDb, ui, setUi, B, acoes, toast, ir, irJob, abrirContrato, abrirEditor, abrirModal, setVersao, reiniciar };

  let gaveta = null;
  const g = ui.gaveta;
  if (g && g.tipo === "contrato") {
    const c = db.contratos.find((x) => x.id === g.id);
    if (c && visivel(c, B)) {
      gaveta = c.status === "pendente" || c.status === "elaboracao"
        ? html`<${GerarContrato} key=${`g-${c.id}-${ui.versao}`} id=${c.id} passoInicial=${g.passo} onFechar=${fecharGaveta} />`
        : html`<${VerContrato} key=${`v-${c.id}-${c.status}`} id=${c.id} onFechar=${fecharGaveta} />`;
    }
  } else if (g && g.tipo === "modelo") {
    gaveta = html`<${EditorModelo} key=${`m-${g.id}-${ui.versao}`} id=${g.id} onFechar=${fecharGaveta} />`;
  }

  const m = ui.modal;
  const fecharModal = () => setUi((u) => ({ ...u, modal: null }));
  let modal = null;
  if (m && B) {
    if (m.tipo === "dispensa") modal = html`<${ModalDispensa} id=${m.id} onFechar=${fecharModal} />`;
    if (m.tipo === "quadro") modal = html`<${ModalQuadro} id=${m.id} onFechar=${fecharModal} />`;
    if (m.tipo === "pedir") modal = html`<${ModalPedir} id=${m.id} onFechar=${fecharModal} />`;
    if (m.tipo === "solicitacao") modal = html`<${ModalSolicitacao} onFechar=${fecharModal} />`;
  }

  let tela;
  if (ui.tela === "juridico") tela = html`<${TelaJuridico} />`;
  else if (ui.tela === "job") tela = html`<${TelaJob} />`;
  else if (ui.tela === "jobs") tela = html`<${ListaJobs} />`;
  else if (ui.tela === "suprimentos") tela = html`<${TelaSuprimentos} />`;
  else tela = html`<${TelaFora} tela=${ui.tela} />`;

  return html`<${Store.Provider} value=${store}>
    <${Sidebar} />
    <main class="conteudo">
      <div class="gutter mx-auto max-w-[1680px] pb-36 pt-20 md:pt-8">${tela}</div>
    </main>
    <${Gaveta} aberta=${!!gaveta} onFechar=${fecharGaveta} rotulo="Contrato" largura=${g && g.tipo === "modelo" ? "max-w-[1240px]" : "max-w-[1180px]"}>${gaveta}</${Gaveta}>
    ${modal}
    <${NotasB} aberta=${notas} onFechar=${() => setNotas(false)} onMostrar=${mostrarNota} />
    <${Toasts} itens=${toasts} onFechar=${(id) => setToasts((ts) => ts.filter((x) => x.id !== id))} />
    <${BarraPrototipo} onNotas=${() => setNotas(true)} />
  </${Store.Provider}>`;
}

try { document.documentElement.lang = "pt-BR"; } catch (e) {}
const raiz = document.getElementById("app");
raiz.textContent = "";
render(html`<${App} />`, raiz);
