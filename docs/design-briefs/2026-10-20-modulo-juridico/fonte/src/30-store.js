/* ---------- Estado, seletores e ações ---------- */

const Store = createContext(null);
const useStore = () => useContext(Store);

function estadoInicial() {
  return { jobs: clone(JOBS), pps: clone(PPS), contratos: clone(CONTRATOS), modelos: clone(MODELOS), notificacoes: clone(NOTIFICACOES), seq: { job: 419, pp: 532 } };
}

const STATUS_CONTRATO = {
  pendente: { rotulo: "Pendente", cls: "border-california-red/25 bg-california-red-soft text-[#b3323c]" },
  elaboracao: { rotulo: "Em elaboração", cls: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]" },
  assinatura: { rotulo: "Aguardando assinatura", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  assinado: { rotulo: "Assinado", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  dispensado: { rotulo: "Dispensado", cls: "border-border bg-muted text-muted-foreground" },
  quadro: { rotulo: "Contrato-quadro", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};
const EM_ABERTO = ["pendente", "elaboracao", "assinatura"];
const RESOLVIDO = ["assinado", "dispensado", "quadro"];

const PP_STATUS = {
  gerada: { rotulo: "Gerada", cls: "border-[#d7d7d7] bg-[#f6f6f6] text-foreground" },
  em_avaliacao: { rotulo: "Em avaliação", cls: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]" },
  aprovada: { rotulo: "Aprovada", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  pago: { rotulo: "Pago", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

const JOB_STATUS = {
  aberto: { rotulo: "Aberto", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  em_producao: { rotulo: "Em produção", cls: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]" },
};

const jobDe = (db, id) => db.jobs.find((j) => j.id === id);
const ppDe = (db, id) => db.pps.find((p) => p.id === id);
const modeloDe = (db, id) => db.modelos.find((m) => m.id === id);

/* O contrato que a tela considera "da PP": o original (não o aditivo). */
function contratoDaPP(db, ppId, B) {
  return db.contratos.find((c) => c.parte === "fornecedor" && c.tipo !== "aditivo" && (c.ppIds || []).includes(ppId));
}
function aditivoDaPP(db, ppId, B) {
  if (!B) return null;
  return db.contratos.find((c) => c.tipo === "aditivo" && (c.ppIds || []).includes(ppId) && EM_ABERTO.includes(c.status));
}
const contratoDoJob = (db, jobId) => db.contratos.find((c) => c.parte === "cliente" && c.jobId === jobId);

function visivel(c, B) {
  return B || !c.soNaB;
}

/* Tudo o que a linha precisa saber sobre um contrato, num lugar só. */
function infoContrato(db, c) {
  if (c.parte === "cliente") {
    const job = jobDe(db, c.jobId);
    const cli = CLIENTES[job.clienteId];
    const ate = dias(HOJE, job.inicio);
    return {
      c, job, pps: [], codigo: job.codigo, contraparte: { nome: cli.fantasia, razao: cli.razao, cnpj: cli.cnpj, endereco: cli.endereco },
      valor: c.valor || job.valor, condicao: job.condicao, origem: "job",
      urgencia: { dias: ate, texto: ate <= 0 ? "Job em andamento" : `Job começa em ${ate} dias`, nivel: ate <= 7 ? "alta" : ate <= 21 ? "media" : "baixa" },
      planilha: { jobId: job.id, item: null },
    };
  }
  if (c.origem === "solicitacao") {
    const s = c.solicitacao;
    const job = jobDe(db, s.jobId);
    const f = FORNECEDORES[s.fornecedorId];
    const ate = dias(HOJE, s.prazo);
    return {
      c, job, pps: [], codigo: c.codigo, contraparte: { nome: f.nome, razao: f.razao, cnpj: f.cnpj, endereco: f.endereco, quadro: f.quadro },
      valor: s.valor, condicao: s.condicao, origem: "solicitacao",
      urgencia: { dias: ate, texto: ate <= 0 ? "Prazo pedido: hoje" : `Prazo pedido em ${ate} dias`, nivel: ate <= 5 ? "alta" : ate <= 10 ? "media" : "baixa" },
      planilha: { jobId: job.id, item: null },
    };
  }
  const pps = c.ppIds.map((id) => ppDe(db, id)).filter(Boolean);
  const pp = pps[0];
  const job = jobDe(db, pp.jobId);
  const f = FORNECEDORES[pp.fornecedorId];
  const prazo = pps.map((p) => p.prazoPgto).sort()[0];
  const ate = dias(HOJE, prazo);
  const valor = c.tipo === "aditivo" ? c.aditivo.para : c.valor && c.status !== "pendente" ? c.valor : pps.reduce((s, p) => s + p.valor, 0);
  return {
    c, job, pps, pp, codigo: pps.map((p) => p.codigo).join(" + "), contraparte: { nome: f.nome, razao: f.razao, cnpj: f.cnpj, endereco: f.endereco, quadro: f.quadro },
    valor, condicao: pp.condicao, origem: c.tipo === "aditivo" ? "aditivo" : c.origem === "solicitacao" ? "solicitacao" : "pp",
    urgencia: {
      dias: ate,
      texto: ate < 0 ? `Pagamento vencido há ${-ate} ${-ate === 1 ? "dia" : "dias"}` : ate === 0 ? "Pagamento hoje" : ate === 1 ? "Pagamento amanhã" : `Pagamento em ${ate} dias`,
      nivel: ate <= 5 ? "alta" : ate <= 10 ? "media" : "baixa",
    },
    planilha: { jobId: job.id, item: pp.item },
  };
}

/* A trava do pagamento (reunião com o jurídico): a PP anda no
 * financeiro, mas não é paga sem contrato assinado. */
function situacaoPagamento(db, pp, B) {
  if (pp.status === "pago") return { k: "pago", rotulo: "Pago", icone: "check", cls: "text-emerald-700" };
  const c = contratoDaPP(db, pp.id, B);
  const ad = aditivoDaPP(db, pp.id, B);
  if (c && RESOLVIDO.includes(c.status) && !ad) return { k: "liberado", rotulo: "Liberado", icone: "unlock", cls: "text-emerald-700" };
  if (ad) return { k: "travado", rotulo: "Travado · aditivo pendente", icone: "lock", cls: "text-[#b3323c]" };
  if (pp.status === "aprovada") return { k: "travado", rotulo: "Travado · sem contrato assinado", icone: "lock", cls: "text-[#b3323c]" };
  return { k: "aguarda", rotulo: "Vai travar sem contrato", icone: "clock", cls: "text-muted-foreground" };
}

function contratosEmAberto(db, B) {
  return db.contratos.filter((c) => visivel(c, B) && EM_ABERTO.includes(c.status));
}

function usarAcoes(setDb, toast, getDb) {
  const mudarContrato = (id, fn) => setDb((db) => ({ ...db, contratos: db.contratos.map((c) => (c.id === id ? fn({ ...c, historico: [...(c.historico || [])] }) : c)) }));
  const registrar = (c, texto) => { c.historico.push({ em: agoraIso(), por: USUARIO.nome, texto }); c.atualizadoEm = agoraIso(); return c; };

  return {
    salvarRascunho(id, dados) {
      mudarContrato(id, (c) => registrar(Object.assign(c, dados, { status: "elaboracao", responsavel: USUARIO.nome }), `Rascunho salvo com o modelo ${dados.modeloNome} (v${dados.modeloVersao}).`));
      toast({ titulo: "Rascunho salvo", texto: "O contrato ficou em elaboração na caixa de entrada." });
    },
    gerar(id, dados, rotuloDestino, irPara) {
      const db = getDb();
      const atual = db.contratos.find((c) => c.id === id);
      const base = atual.parte === "cliente" ? `CTR-${jobDe(db, atual.jobId).codigo.slice(4)}-CLI` : atual.origem === "solicitacao" ? `CTR-${atual.codigo}` : `CTR-${ppDe(db, dados.ppIds[0]).codigo.slice(3)}`;
      const versaoArq = (atual.versaoArquivo || 0) + 1;
      const arquivo = `${base}${atual.tipo === "aditivo" ? "-AD1" : ""}-v${versaoArq}.pdf`;
      setDb((d) => {
        let contratos = d.contratos.map((c) => {
          if (c.id !== id) return c;
          const n = { ...c, historico: [...(c.historico || [])], ...dados, status: "assinatura", responsavel: USUARIO.nome, arquivo, versaoArquivo: versaoArq };
          return registrar(n, `Contrato gerado (${arquivo}) com o modelo ${dados.modeloNome} (v${dados.modeloVersao}) e anexado a ${rotuloDestino}.`);
        });
        // PPs agrupadas num contrato só (versão B): o contrato próprio delas sai da fila.
        if (dados.ppIds && dados.ppIds.length > 1) {
          contratos = contratos.filter((c) => !(c.id !== id && c.parte === "fornecedor" && c.tipo !== "aditivo" && EM_ABERTO.includes(c.status) && c.ppIds.length === 1 && dados.ppIds.includes(c.ppIds[0])));
        }
        return { ...d, contratos };
      });
      toast({ titulo: "Contrato gerado", texto: `${arquivo} anexado a ${rotuloDestino}. Agora aguarda a assinatura.`, acao: irPara ? { rotulo: "Ver no job", fn: irPara } : null });
    },
    assinar(id, arquivo, data, pagamentoTexto) {
      mudarContrato(id, (c) => registrar(Object.assign(c, { status: "assinado", arquivoAssinado: arquivo, assinadoEm: data }), `Contrato assinado anexado (${arquivo}).${pagamentoTexto ? " Pagamento liberado." : ""}`));
      toast({ titulo: "Contrato assinado", texto: pagamentoTexto || "O contrato assinado está anexado ao job." });
    },
    reabrir(id) {
      mudarContrato(id, (c) => registrar(Object.assign(c, { status: "elaboracao" }), "Contrato reaberto para uma nova versão."));
      toast({ titulo: "Contrato reaberto", texto: "Edite as lacunas e gere uma nova versão." });
    },
    dispensar(id, motivo, justificativa) {
      mudarContrato(id, (c) => registrar(Object.assign(c, { status: "dispensado", dispensa: { motivo, justificativa } }), `Contrato dispensado: ${motivo}.${justificativa ? " " + justificativa : ""}`));
      toast({ titulo: "Contrato dispensado", texto: "O pagamento da PP foi liberado e a justificativa ficou no histórico." });
    },
    vincularQuadro(id, quadro) {
      mudarContrato(id, (c) => registrar(Object.assign(c, { status: "quadro", quadro: quadro.codigo }), `PP vinculada ao contrato-quadro ${quadro.codigo}, vigente até ${dataBr(quadro.vigencia)}.`));
      toast({ titulo: "Vinculada ao contrato-quadro", texto: `${quadro.codigo} cobre esta PP. Pagamento liberado.` });
    },
    pedirInfo(id, para, mensagem) {
      mudarContrato(id, (c) => registrar(c, `Pedido de informação enviado a ${para}: "${mensagem}"`));
      toast({ titulo: "Pedido enviado", texto: `${para} recebe a pergunta na Comunicação do job.` });
    },
    salvarModelo(modelo, novo) {
      setDb((db) => ({ ...db, modelos: novo ? [...db.modelos, modelo] : db.modelos.map((m) => (m.id === modelo.id ? modelo : m)) }));
      toast({ titulo: novo ? "Modelo criado" : "Modelo salvo", texto: novo ? `${modelo.nome} já aparece na escolha de modelos.` : `${modelo.nome} está na versão ${modelo.versao}.` });
    },
    apagarModelo(id, nome) {
      setDb((db) => ({ ...db, modelos: db.modelos.filter((m) => m.id !== id) }));
      toast({ titulo: "Modelo apagado", texto: `${nome} saiu da lista. Contratos já gerados não mudam.` });
    },
    arquivarModelo(id, nome, arquivar = true) {
      setDb((db) => ({ ...db, modelos: db.modelos.map((m) => (m.id === id ? { ...m, ativo: !arquivar } : m)) }));
      toast({ titulo: arquivar ? "Modelo arquivado" : "Modelo restaurado", texto: arquivar ? `${nome} não aparece mais na escolha, mas os contratos dele continuam abertos.` : `${nome} voltou para a escolha de modelos.` });
    },
    novaSolicitacao(dados) {
      const db = getDb();
      const n = db.contratos.filter((c) => c.origem === "solicitacao").length + 1;
      const codigo = `SOL-${String(n).padStart(4, "0")}`;
      const contrato = { id: `c-sol-${n}`, codigo, parte: "fornecedor", origem: "solicitacao", soNaB: true, jobId: dados.jobId, ppIds: [], status: "pendente", chegouEm: agoraIso(), campos: { objeto: dados.escopo }, solicitacao: dados, valor: dados.valor,
        historico: [{ em: agoraIso(), por: dados.solicitante, texto: `Solicitação aberta (${dados.tipoRotulo}). Prazo pedido: ${dataBr(dados.prazo)}.` }] };
      setDb((d) => ({ ...d, contratos: [contrato, ...d.contratos] }));
      toast({ titulo: "Solicitação registrada", texto: `${codigo} entrou na caixa de entrada como pendente.` });
    },
    simularJob() {
      const db = getDb();
      const n = db.seq.job;
      const job = { id: `j${n}`, codigo: `JOB-0${n}`, nome: "Convenção de Vendas Nébula", projeto: { codigo: "PRJ-0187", nome: "Nébula Verão 2027" }, clienteId: "nebula", gp: "Júlia Prado", produtor: "Caio Nunes", status: "aberto", servico: "Evento", produto: "Institucional", abertoEm: agoraIso(), abertoPor: "Paula Mendes", inicio: "2026-12-08", fim: "2026-12-10", cidade: "São Paulo/SP", valor: 264800, condicao: "30 dias após o faturamento", versao: "Convenção de Vendas - V2" };
      ITENS_SEM_PP[job.id] = [{ grupo: "Estrutura", item: "Palco e telão", orcado: 48000, planejado: 41000 }, { grupo: "Alimentação", item: "Almoço para 300 pessoas", orcado: 39000, planejado: 33500 }];
      const contrato = { id: `c-${job.id}`, parte: "cliente", jobId: job.id, status: "pendente", chegouEm: agoraIso(), historico: [{ em: agoraIso(), por: "Sistema", texto: "Job aberto pelo financeiro (Paula Mendes). Contrato com o cliente criado como pendente." }] };
      const notif = { id: `n${Date.now()}`, em: agoraIso(), lida: false, contratoId: contrato.id, texto: `${job.codigo} aberto pelo financeiro`, sub: "Contrato com Nébula Bebidas a elaborar" };
      setDb((d) => ({ ...d, jobs: [...d.jobs, job], contratos: [contrato, ...d.contratos], notificacoes: [notif, ...d.notificacoes], seq: { ...d.seq, job: n + 1 } }));
      toast({ titulo: "Novo job aberto", texto: `O financeiro abriu ${job.codigo}. O contrato com o cliente entrou na caixa de entrada.`, sino: true });
    },
    simularPP() {
      const db = getDb();
      const n = db.seq.pp;
      const pp = { id: `pp${n}`, codigo: `PP-00${n}`, jobId: "j415", fornecedorId: "atelier", tipo: "prestacao", grupo: "Cenografia", item: "Cenário sala de estar", servico: "Construção de cenário — sala de estar", especificacoes: "Cenário de 40 m² com paredes cenográficas e mobiliário, montagem e desmontagem", valor: 24600, prazoPgto: "2026-11-20", condicao: "40% no início e 60% na entrega", status: "gerada", geradaEm: agoraIso() };
      const contrato = { id: `c-${pp.id}`, parte: "fornecedor", ppIds: [pp.id], status: "pendente", chegouEm: agoraIso(), historico: [{ em: agoraIso(), por: "Sistema", texto: `${pp.codigo} gerada por Suprimentos (Otávio Reis). Contrato com o fornecedor criado como pendente.` }] };
      const notif = { id: `n${Date.now()}`, em: agoraIso(), lida: false, contratoId: contrato.id, texto: `${pp.codigo} gerada por Suprimentos`, sub: "Contrato com Atelier Norte a elaborar" };
      setDb((d) => ({ ...d, pps: [...d.pps, pp], contratos: [contrato, ...d.contratos], notificacoes: [notif, ...d.notificacoes], seq: { ...d.seq, pp: n + 1 } }));
      toast({ titulo: "Nova PP gerada", texto: `Suprimentos gerou ${pp.codigo}. O contrato com o fornecedor entrou na caixa de entrada.`, sino: true });
    },
    lerNotificacoes() {
      setDb((db) => ({ ...db, notificacoes: db.notificacoes.map((n) => ({ ...n, lida: true })) }));
    },
  };
}

/* Valores que a minuta lê do sistema, para um contrato (ou uma prévia). */
function contextoDoContrato(db, c) {
  const { parte, ppIds } = c;
  const sol = c.origem === "solicitacao" ? c.solicitacao : null;
  const pps = (ppIds || []).map((id) => ppDe(db, id)).filter(Boolean);
  const job = jobDe(db, c.jobId || (sol && sol.jobId) || pps[0].jobId);
  const cp = parte === "cliente" ? CLIENTES[job.clienteId] : FORNECEDORES[sol ? sol.fornecedorId : pps[0].fornecedorId];
  const valor = parte === "cliente" ? job.valor : sol ? sol.valor : pps.reduce((s, p) => s + p.valor, 0);
  const ctx = {
    "agencia.razao_social": AGENCIA.razao, "agencia.cnpj": AGENCIA.cnpj, "agencia.endereco": AGENCIA.endereco,
    "parte.razao_social": cp.razao, "parte.cnpj": cp.cnpj, "parte.endereco": cp.endereco,
    "job.codigo": job.codigo, "job.nome": job.nome, "job.projeto": `${job.projeto.codigo} — ${job.projeto.nome}`, "job.periodo": `${dataBr(job.inicio)} a ${dataBr(job.fim)}`, "job.cidade": job.cidade, "job.versao": job.versao,
    "pp.codigo": pps.map((p) => p.codigo).join(" e ") || (sol ? c.codigo : "—"), "pp.servico": pps.map((p) => p.servico).join("; ") || (sol ? sol.escopo : "—"),
    "valor.total": moeda(valor), "valor.extenso": porExtenso(valor),
    "pagamento.condicao": parte === "cliente" ? job.condicao : sol ? sol.condicao : pps[0].condicao,
    "responsavel.gp": job.gp, "responsavel.produtor": job.produtor,
    "data.hoje": dataExtenso(HOJE), "foro.cidade": "São Paulo/SP",
    _partes: parte === "cliente" ? [cp.razao, AGENCIA.razao] : [AGENCIA.razao, cp.razao],
    _valor: valor,
  };
  if (c.tipo === "aditivo") {
    const original = contratoDaPP(db, pps[0].id);
    ctx["aditivo.contrato"] = (original.arquivo || "").replace(/-v\d+\.pdf$/, "");
    ctx["aditivo.data_original"] = dataBr(original.assinadoEm);
    ctx["aditivo.valor_anterior"] = moeda(c.aditivo.de);
  }
  return ctx;
}
