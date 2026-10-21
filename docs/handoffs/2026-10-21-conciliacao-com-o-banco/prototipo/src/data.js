// Dados fictícios do protótipo. Empresas e jobs são os de teste do ERP;
// fornecedores são nomes inventados; colaboradores seguem o padrão
// "COLABORADOR NNN EXEMPLO" do CLAUDE.md.

export const HOJE = "2026-10-20";
export const DIA_OFX = "2026-10-19";

export const CONTAS = [
  { id: "cs", nome: "California Santander", banco: "Santander", agencia: "0001", numero: "13000001-3", empresa: "Agência California" },
  { id: "ci", nome: "California Investimento", banco: "Santander", agencia: "0001", numero: "13000002-1", empresa: "Agência California", tipo: "investimento" },
  { id: "hi", nome: "Hitlab Itaú", banco: "Itaú", agencia: "1234", numero: "45678-9", empresa: "Hitlab" },
  { id: "ct", nome: "Conta Teste", banco: "Banco Teste", agencia: "0001", numero: "12345-6", empresa: "Empresa Teste" },
];

export const CENTROS = {
  "01": "Receita",
  "02": "Custo Operacional",
  "03": "Custo Tributário",
  "04": "Custo Fixo",
  "05": "Despesa com Pessoal",
  "07": "Despesa Administrativa",
  "10": "Receita Financeira",
  "11": "Despesa com Juros",
};
export const SUBTIPOS = {
  "01": ["Geral", "Fee mensal", "BV"],
  "02": ["Cenografia", "Produção", "Hospedagem", "Frete", "Alimentação", "Equipamentos", "Mídia", "Freelancer", "Transporte"],
  "03": ["ISS", "PIS", "COFINS", "IRPJ", "CSLL"],
  "04": ["Água", "Energia", "Internet / Telefone", "Contabilidade", "Obra / Manutenção", "Sistema", "Tarifa bancária", "Aluguel"],
  "05": ["Salário", "ProLabore", "Benefícios (plano de saúde e Total Pass)"],
  "07": ["Material escritório", "Assinaturas", "Motoboy", "Tarifas", "Outros"],
  "10": ["Rendimento de aplicação"],
  "11": ["Juros e multa"],
};

const c = (tipo, sub) => ({ tipo, sub });

let seq = 0;
const id = (p) => `${p}-${++seq}`;

function pp(n, titulo, contraparte, valor, venc, extra = {}) {
  return {
    id: id("pp"),
    lado: "pagar",
    origem: "pp",
    ref: `PP-${String(n).padStart(5, "0")}`,
    titulo,
    contraparte,
    empresa: extra.empresa ?? "Agência California",
    job: extra.job ?? { codigo: "AMB-1003/26", nome: "Ativação Stella Recife" },
    vencimento: venc,
    vencOrig: extra.vencOrig ?? venc,
    valor,
    retencao: extra.retencao ?? 0,
    liquido: Math.round((valor - (extra.retencao ?? 0)) * 100) / 100,
    baixado: extra.baixado ?? 0,
    parcela: extra.parcela ?? [1, 1],
    centro: extra.centro ?? c("02", "Produção"),
    forma: extra.forma ?? "pix",
    nf: extra.nf ?? null,
    ...extra,
  };
}

function avulso(origem, titulo, contraparte, valor, venc, centro, extra = {}) {
  return {
    id: id("av"),
    lado: "pagar",
    origem,
    ref: origem === "folha" ? "Folha 10/2026" : origem === "recorrencia" ? "Recorrência" : `AV-${String(200 + seq).padStart(5, "0")}`,
    titulo,
    contraparte,
    empresa: extra.empresa ?? "Agência California",
    job: null,
    vencimento: venc,
    vencOrig: venc,
    valor,
    retencao: 0,
    liquido: valor,
    baixado: 0,
    parcela: [1, 1],
    centro,
    forma: extra.forma ?? "boleto",
    ...extra,
  };
}

function imposto(tributo, guia, valor, venc, competencia, extra = {}) {
  return {
    id: id("imp"),
    lado: "imposto",
    origem: "imposto",
    ref: guia,
    titulo: tributo,
    contraparte: guia.startsWith("DARF") ? "Receita Federal" : "Prefeitura de Salvador",
    empresa: "Agência California",
    pj: "Agência California Ltda",
    cnpjLocal: "00.000.000/0001-00",
    job: null,
    vencimento: venc,
    vencOrig: venc,
    valor,
    retencao: 0,
    liquido: valor,
    baixado: 0,
    parcela: [1, 1],
    competencia,
    origemImposto: extra.origemImposto ?? "APURAÇÃO",
    guiaArquivo: extra.guiaArquivo ?? `${guia.replace(" ", "-")}-${competencia.replace("/", "-")}.pdf`,
    centro: extra.centro ?? c("03", tributo.split(" ")[0]),
    forma: "guia",
    ...extra,
  };
}

function nf(numero, parcela, descricao, cliente, cnpj, valor, venc, extra = {}) {
  return {
    id: id("nf"),
    lado: "receber",
    origem: "nf",
    ref: `NF ${numero}`,
    titulo: `NF ${numero}${parcela[1] > 1 ? ` · parcela ${parcela[0]}/${parcela[1]}` : ""}`,
    descricaoNf: descricao,
    contraparte: cliente,
    cnpj,
    empresa: extra.empresa ?? "Agência California",
    job: extra.job ?? null,
    // Os dois campos de todo título: o vencimento (da nota, fixo) e a data
    // prevista de recebimento (editável) — que hoje se chama "previsão".
    vencimento: extra.previsao ?? venc,
    vencOrig: venc,
    previsao: extra.previsao ?? venc,
    emitida: extra.emitida ?? "2026-09-20",
    valor,
    retencao: 0,
    liquido: valor,
    baixado: extra.baixado ?? 0,
    parcela,
    centro: c("01", "Geral"),
    forma: "ted",
    entra: true,
    ...extra,
  };
}

const D = DIA_OFX;

// ---------------------------------------------------------------------------
// Os títulos que o extrato de exemplo vai encontrar (pagos em 19/10)
// ---------------------------------------------------------------------------

const FOLHA_VALORES = [
  14250.0, 12980.5, 11870.0, 10450.75, 9980.0, 9875.3, 9620.0, 10870.45, 11240.0, 8960.0, 9230.6, 10115.0, 12045.9,
  8790.0, 9365.5, 10560.0, 9410.0,
];
const folhaSoma = FOLHA_VALORES.reduce((s, v) => s + v, 0);
FOLHA_VALORES.push(Math.round((188494 - folhaSoma) * 100) / 100);

export const LOTE_FOLHA_ID = "lote-folha-10";
const folha = FOLHA_VALORES.map((v, i) =>
  avulso("folha", `Salário de outubro · COLABORADOR ${String(i + 1).padStart(3, "0")} EXEMPLO`, `COLABORADOR ${String(i + 1).padStart(3, "0")} EXEMPLO`, v, D, c("05", i < 2 ? "ProLabore" : "Salário"), {
    forma: "pix",
    loteId: LOTE_FOLHA_ID,
  }),
);

const doExtrato = [
  pp(131, "Montagem do estande — sinal", "Versa Stands Locações e Equipamentos", 40000, D, { centro: c("02", "Cenografia") }),
  avulso("recorrencia", "Água e esgoto — setembro", "Companhia de Água Exemplo", 93.29, D, c("04", "Água"), { forma: "concessionaria" }),
  avulso("recorrencia", "Internet fibra — outubro", "Provedor Fibra Exemplo", 199.9, D, c("04", "Internet / Telefone"), { forma: "concessionaria" }),
  pp(120, "Motoboy — entregas do evento", "Motoboy Express Entregas", 120, D, { centro: c("02", "Frete") }),
  avulso("avulso", "Material de escritório", "Papelaria Central Exemplo", 278.97, D, c("07", "Material escritório")),
  avulso("avulso", "Assinatura do software de design", "Software Criativo Exemplo", 302.2, D, c("07", "Assinaturas")),
  pp(133, "Diária de assistente de produção", "Produtora Ponto Exemplo", 500, D),
  // Baixada à mão em 19/10 com R$ 0,36 de "juros" digitados por engano: o
  // banco debitou R$ 516,59. A conciliação destaca a divergência.
  { ...avulso("avulso", "Manutenção do ar-condicionado", "Clima Frio Manutenção", 516.59, D, c("04", "Obra / Manutenção"), { pagoEm: D, baixado: 516.59 }), id: "av-manutencao", ref: "AV-00214" },
  pp(134, "Transporte do material do estande", "Rota Transportes e Logística", 600, D, { centro: c("02", "Transporte") }),
  pp(135, "Impressão das credenciais", "Gráfica Ponto Impresso", 653.9, D),
  imposto("ISS próprio", "Guia municipal", 695.65, D, "setembro/2026", { local: "Salvador-BA" }),
  pp(139, "Locação de rádios comunicadores", "Rádio Link Locações", 749, D, { centro: c("02", "Equipamentos") }),
  imposto("PIS", "DARF 8109", 884.85, D, "setembro/2026"),
  pp(136, "Fotografia do evento — diária", "Clic Fotografia e Vídeo", 1000, D, { job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" } }),
  pp(137, "Arte para o painel de entrada", "Atelier Recorte Cenografia", 1000, D),
  pp(138, "Locação de gerador", "Energia Móvel Geradores", 1200, D, { centro: c("02", "Equipamentos") }),
  avulso("avulso", "Locação de impressora — setembro", "Print Solutions Exemplo", 1650, "2026-10-13", c("07", "Outros")),
  // Boleto que venceu num sábado: o atraso conta a partir da segunda (19/10).
  avulso("avulso", "Limpeza pós-evento", "Limpeza Rápida Exemplo", 845.4, "2026-10-17", c("02", "Produção")),
  pp(145, "Buffet da equipe de montagem", "Copa & Cozinha Catering", 1685, D, { centro: c("02", "Alimentação") }),
  pp(112, "Cenografia — parcela 2", "Studio 3 Comunicação e Cenografia", 1763.82, D, { parcela: [2, 3], centro: c("02", "Cenografia") }),
  pp(146, "Som e microfones do palco", "Som Total Sonorização", 1840, D, { centro: c("02", "Equipamentos") }),
  pp(140, "Recepcionistas — 2 diárias", "Agência Recepção Exemplo", 2000, D),
  {
    // O centro de custo vem da aprovação do desembolso (pendência: hoje ele
    // é escolhido na baixa, decisão 069).
    ...avulso("desembolso", "Adiantamento de viagem — equipe técnica", "Produtora Ponto Exemplo", 2000, "2026-10-18", c("02", "Transporte"), { forma: "pix" }),
    ref: "DES-00021",
    job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" },
  },
  pp(147, "Iluminação cênica", "Luz & Cena Iluminação", 2300, D, { centro: c("02", "Equipamentos") }),
  pp(148, "Transporte rodoviário da equipe", "Rota Transportes e Logística", 2460, D, { centro: c("02", "Transporte") }),
  avulso("recorrencia", "Honorários da contabilidade — outubro", "Contabilidade Exemplo Ltda", 2500, D, c("04", "Contabilidade"), { forma: "pix" }),
  pp(141, "Direção de arte — freela", "Arte Viva Estúdio", 3000, D, { centro: c("02", "Freelancer") }),
  pp(142, "Produção executiva — freela", "Produtora Ponto Exemplo", 3000, D, { centro: c("02", "Freelancer") }),
  pp(143, "Roteiro do vídeo — freela", "Roteiro & Cia", 3000, D, { centro: c("02", "Freelancer"), job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" } }),
  // Um quarto título de R$ 3.000,00 para o mesmo dia, e o banco só tem três
  // linhas: um deles não foi pago, e alguém decide qual.
  pp(157, "Locução do vídeo — freela", "Estúdio Voz Exemplo", 3000, D, { centro: c("02", "Freelancer"), job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" } }),
  // Duas PPs do mesmo fornecedor pagas num PIX só (R$ 2.080,00).
  pp(162, "Montagem do estande — diária extra", "Atelier Recorte Cenografia", 1250, D, { centro: c("02", "Cenografia") }),
  pp(163, "Pintura do painel de fundo", "Atelier Recorte Cenografia", 830, D, { centro: c("02", "Cenografia") }),
  imposto("IRRF retido de fornecedores", "DARF 1708", 3495.54, D, "setembro/2026", { centro: c("02", "Repasse do IRRF retido") }),
  pp(144, "Edição e finalização do vídeo", "Corte Final Pós-Produção", 3945.13, D, {
    retencao: 242.63,
    retencoes: "IRRF 1,5% · PIS/COFINS/CSLL 4,65%",
    // As retenções da aprovação, imposto a imposto: a baixa começa nelas,
    // editáveis (módulo fiscal, 02/10/2026).
    retencaoAprovacao: { IRRF: 59.18, PIS: 25.64, COFINS: 118.36, CSLL: 39.45 },
    aprovadaEm: "2026-10-03",
    nf: "602",
    job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" },
  }),
  pp(149, "Estrutura de tenda", "Tenda Forte Estruturas", 3715, D, { centro: c("02", "Cenografia") }),
  avulso("avulso", "Locação de equipamentos de TI — outubro", "Tech Rent Exemplo", 3965.3, D, c("04", "Sistema")),
  pp(150, "Mobiliário do estande", "Versa Stands Locações e Equipamentos", 4000, D, { centro: c("02", "Cenografia") }),
  pp(151, "Cachê do apresentador", "Palco Talentos Agenciamento", 5000, D),
  pp(152, "Cobertura em vídeo", "Clic Fotografia e Vídeo", 5000, D, { job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" } }),
  pp(153, "Ativação — promotores", "Agência Recepção Exemplo", 5000, "2026-10-17"),
  pp(154, "Brindes personalizados", "Gráfica Ponto Impresso", 5000, "2026-10-20"),
  pp(155, "Locação do espaço — sinal", "Espaço Eventos Exemplo", 6000, D),
  pp(40, "Confecção de pódio e painel em marcenaria", "Studio 3 Comunicação e Cenografia", 6611.86, D, { parcela: [2, 3], centro: c("02", "Cenografia") }),
  pp(156, "Buffet do evento", "Moinho Buffet e Eventos", 8500, D, { centro: c("02", "Alimentação") }),
  pp(157, "Sonorização e painel de LED", "Som Total Sonorização", 9191.38, D, { centro: c("02", "Equipamentos") }),
  pp(158, "Produção do vídeo institucional", "Corte Final Pós-Produção", 24800, D, { job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" } }),
  pp(159, "Montagem do estande — 1ª parcela", "Versa Stands Locações e Equipamentos", 25000, D, { parcela: [1, 2], centro: c("02", "Cenografia") }),
  pp(160, "Mídia OOH — painéis", "Painel Urbano Mídia", 32000, D, { centro: c("02", "Mídia"), job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" } }),
  pp(161, "Cenografia completa do estande", "Atelier Recorte Cenografia", 48000, D, { centro: c("02", "Cenografia") }),
  // O cliente reteve IRRF 1,5% e PIS/COFINS/CSLL 4,65%: o banco tem
  // R$ 18.770,00 dos R$ 20.000,00 da nota. A conciliação reconhece a
  // retenção e a baixa já abre com ela destrinchada.
  nf(1190, [1, 1], "Ativação em pontos de venda", "Marca de Bebidas Exemplo", "00.000.000/0001-00", 20000, "2026-10-17", {
    job: { codigo: "CAL-1009/26", nome: "Fee Marca de Bebidas" },
  }),
  nf(1188, [1, 1], "Prestação de serviços de ativação de marca", "Cervejaria Exemplo S.A.", "11.222.333/0001-81", 33400, "2026-10-18", {
    job: { codigo: "AMB-1003/26", nome: "Ativação Stella Recife" },
  }),
  // O cliente pagou duas notas numa TED só (R$ 11.800,00).
  nf(1196, [1, 1], "Locação de estrutura para o evento", "Cervejaria Exemplo S.A.", "11.222.333/0001-81", 7500, "2026-10-18", {
    job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" },
  }),
  nf(1197, [1, 1], "Produção de conteúdo para redes", "Cervejaria Exemplo S.A.", "11.222.333/0001-81", 4300, "2026-10-19", {
    job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" },
  }),
];

// ---------------------------------------------------------------------------
// O restante do que aguarda baixa (as linhas da tela de hoje)
// ---------------------------------------------------------------------------

const outros = [
  pp(44, "Hospedagem da equipe para o projeto", "Airbnb Brasil Serviços Digitais", 1443.91, "2026-09-24", {
    empresa: "Hitlab",
    job: { codigo: "AMB-1002/26", nome: "Convenção Hitlab" },
    centro: c("02", "Hospedagem"),
  }),
  nf(1, [1, 2], "Prestação de serviços referente a: Teste sistema", "TESTE", "00.000.000/0001-00", 68874.73, "2026-09-24", {
    empresa: "Empresa Teste",
    job: { codigo: "TES-1001/26", nome: "Job de teste" },
  }),
  {
    ...avulso("fatura", "Fatura ZZ Teste Empresa Teste · fecha 25/09/2026", "ZZ Teste Empresa Teste", 12500, "2026-10-05", c("02", "Produção")),
    ref: "FC-00004",
    empresa: "Empresa Teste",
    faturaId: "fc4",
    cartao: "cc2",
    centro: null,
  },
  pp(34, "Confecção de Glorify para o job da Stella em Recife-PE", "Versa Stands Locações e Equipamentos", 1400, "2026-10-08", {
    centro: c("02", "Cenografia"),
  }),
  pp(79, "Teste", "Fornecedor Teste Ltda", 4000, "2026-10-08", { empresa: "Empresa Teste", job: { codigo: "TES-1001/26", nome: "Job de teste" } }),
  pp(102, "Teste da decisão 136: pagamento fora do cadastro", "Fornecedor Teste Ltda", 300, "2026-10-08", {
    empresa: "Empresa Teste",
    job: { codigo: "TES-1001/26", nome: "Job de teste" },
    foraDoCadastro: true,
  }),
  pp(129, "Teste da PP a emitir (decisão 151)", "Fornecedor Teste Ltda", 6000, "2026-10-08", {
    empresa: "Empresa Teste",
    job: { codigo: "TES-1014/26", nome: "Job de teste 14" },
    nf: "9001",
  }),
  imposto("COFINS", "DARF 2172", 4083.6, "2026-10-24", "setembro/2026"),
  imposto("CSLL", "DARF 2372", 2876.4, "2026-10-31", "3º trimestre/2026", { cota: "1/3" }),
  nf(1, [2, 2], "Prestação de serviços referente a: Teste sistema", "TESTE", "00.000.000/0001-00", 68874.74, "2026-10-24", {
    empresa: "Empresa Teste",
    job: { codigo: "TES-1001/26", nome: "Job de teste" },
  }),
  nf(1191, [1, 1], "Fee mensal de outubro", "Marca de Bebidas Exemplo", "00.000.000/0001-00", 42500, "2026-10-28", {
    previsao: "2026-10-30",
    job: { codigo: "CAL-1009/26", nome: "Fee Marca de Bebidas" },
  }),
  {
    id: "rec-av-1",
    lado: "receber",
    origem: "rec_avulso",
    ref: "AV-00231",
    titulo: "Reembolso das passagens do evento",
    contraparte: "Cervejaria Exemplo S.A.",
    empresa: "Agência California",
    job: null,
    vencimento: "2026-10-23",
    vencOrig: "2026-10-23",
    valor: 3870,
    retencao: 0,
    liquido: 3870,
    baixado: 0,
    parcela: [1, 1],
    centro: c("01", "Geral"),
    entra: true,
  },
  {
    id: "rend-1",
    lado: "receber",
    origem: "rendimento",
    ref: "AV-00232",
    titulo: "Rendimento de outubro · California Investimento",
    contraparte: "California Investimento · Santander",
    empresa: "Agência California",
    job: null,
    vencimento: "2026-10-31",
    vencOrig: "2026-10-31",
    valor: 6214.37,
    retencao: 0,
    liquido: 6214.37,
    baixado: 0,
    parcela: [1, 1],
    centro: c("10", "Rendimento de aplicação"),
    entra: true,
    contaFixa: "ci",
  },
  {
    id: "tr-1",
    lado: "transf",
    origem: "transferencia",
    ref: "TR-00004",
    titulo: "Aplicação do caixa do mês",
    contraparte: "California Santander → California Investimento",
    empresa: "—",
    job: null,
    vencimento: "2026-10-27",
    vencOrig: "2026-10-27",
    valor: 150000,
    retencao: 0,
    liquido: 150000,
    baixado: 0,
    parcela: [1, 1],
    centro: null,
    origemConta: "cs",
    destinoConta: "ci",
  },
  avulso("recorrencia", "Aluguel do galpão — novembro", "Imobiliária Exemplo", 9800, "2026-11-05", c("04", "Aluguel")),
  pp(162, "Locação de van — semana do evento", "Rota Transportes e Logística", 3380, "2026-10-22", {
    centro: c("02", "Transporte"),
    job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" },
  }),
  pp(163, "Segunda parcela da cenografia", "Atelier Recorte Cenografia", 48000, "2026-10-29", { parcela: [2, 2], centro: c("02", "Cenografia") }),
  // Baixado à mão em 19/10, mas não aparece no extrato do banco: pago em
  // outra conta, com a data errada, ou não pago. A conciliação destaca.
  { ...pp(168, "Frete — retirada do material", "Rota Transportes e Logística", 380, D, { centro: c("02", "Frete"), pagoEm: D, baixado: 380 }), id: "pp-168" },
  // Estornos de verba (decisão 081): a sobra da verba que volta depois da
  // prestação de contas. Despesa negativa no DRE; entrada na conta.
  {
    ...pp(118, "Verba de produção — Recife", "Verba — COLABORADOR 021 EXEMPLO", 850, "2026-10-21", { valor: 850 }),
    origem: "verba",
    ref: "ESTORNO PP-00118",
    titulo: "Estorno de verba PP-00118 — produção Recife",
    entra: true,
    centro: c("02", "Produção"),
    verba: {
      valor: 2500,
      pagaEm: "2026-09-30",
      gasto: 1650,
      aprovadaEm: "2026-10-16",
      documentos: [
        ["NF 4512", "Locação de som — Recife", 980],
        ["Recibo", "Carreto do material", 320],
        ["Cupom fiscal", "Alimentação da equipe", 350],
      ],
    },
  },
  {
    ...pp(121, "Verba de alimentação — equipe Rio", "Verba — COLABORADOR 022 EXEMPLO", 600, "2026-10-24", {
      valor: 600,
      job: { codigo: "CAL-1004/26", nome: "Campanha de inverno" },
    }),
    origem: "verba",
    ref: "ESTORNO PP-00121",
    titulo: "Estorno de verba PP-00121 — alimentação da equipe Rio",
    entra: true,
    centro: c("02", "Alimentação"),
    verba: { valor: 600, pagaEm: "2026-10-10", gasto: 0, aprovadaEm: "2026-10-18", documentos: [], semGasto: true },
  },
  // Previstos no cartão (decisão 093): a forma escolhida na aprovação é só
  // intenção. O item entra na fatura quando alguém dá a baixa no cartão.
  pp(167, "Passagens aéreas — retorno da equipe", "Companhia Aérea Exemplo", 2940, "2026-10-23", {
    centro: c("02", "Transporte"),
    forma: "cartao",
    formaPrevista: "cartao",
    cartaoPrevisto: "cc1",
  }),
  avulso("recorrencia", "Assinatura da plataforma de design", "Software Criativo Exemplo", 159, "2026-10-26", c("07", "Assinaturas"), {
    forma: "cartao",
    formaPrevista: "cartao",
    cartaoPrevisto: "cc1",
  }),
  // BV: o veículo paga à agência a bonificação sobre a mídia do job; a
  // agência emite a NF para ele (decisões 080 e 184).
  nf(1195, [1, 1], "BV — veiculação dos painéis OOH de setembro", "Painel Urbano Mídia", "00.000.000/0001-00", 6400, "2026-10-29", {
    job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" },
    bv: true,
    centro: c("02", "Mídia"),
  }),
];

export const TITULOS_INICIAIS = [...outros, ...doExtrato, ...folha];

// ---------------------------------------------------------------------------
// Cartões de crédito e faturas (decisões 031, 032, 084 e 093). O cartão é
// uma conta espelho; a fatura é uma janela sobre ela. Valor positivo é
// compra (débito); negativo é estorno (crédito).
// ---------------------------------------------------------------------------

export const CARTOES = [
  { id: "cc1", nome: "Corporativo California", banco: "Santander", bandeira: "Visa", final: "0001", fechamento: 25, vencimento: 5, dono: "COLABORADOR 031 EXEMPLO", empresa: "Agência California" },
  { id: "cc2", nome: "ZZ Teste Empresa Teste", banco: "Banco Teste", bandeira: "Master", final: "0002", fechamento: 25, vencimento: 5, dono: "COLABORADOR 032 EXEMPLO", empresa: "Empresa Teste" },
];

const JOB_RECIFE = { codigo: "AMB-1003/26", nome: "Ativação Stella Recife" };
const JOB_VERAO = { codigo: "CAL-1007/26", nome: "Lançamento Verão" };
const JOB_TESTE = { codigo: "TES-1001/26", nome: "Job de teste" };

const item = (data, tipo, codigo, descricao, fornecedor, valor, centro, extra = {}) => ({
  id: id("it"),
  data,
  tipo, // pp · avulso · recorrencia · desembolso · estorno · ajuste
  codigo,
  descricao,
  fornecedor,
  valor,
  centro,
  empresa: extra.empresa ?? "Agência California",
  job: extra.job ?? null,
  ...extra,
});

export const FATURAS_INICIAIS = [
  {
    id: "fc10",
    codigo: "FC-00010",
    cartao: "cc1",
    competencia: "2026-09",
    fecha: "2026-09-25",
    vence: "2026-10-05",
    status: "paga",
    valorCobrado: 8430,
    pagaEm: "2026-10-05",
    pagaPor: "cs",
    itens: [
      item("2026-08-28", "pp", "PP-00104 1/1", "Passagens aéreas — visita técnica Recife", "Companhia Aérea Exemplo", 3260, c("02", "Transporte"), { job: JOB_RECIFE }),
      item("2026-09-02", "recorrencia", "AV-00188", "Assinatura do software de edição", "Software Criativo Exemplo", 289.9, c("07", "Assinaturas")),
      item("2026-09-09", "pp", "PP-00109 1/1", "Hospedagem — visita técnica Recife", "Hotel Exemplo Recife", 2480, c("02", "Hospedagem"), { job: JOB_RECIFE }),
      item("2026-09-15", "avulso", "AV-00190", "Material de cenografia — loja online", "Loja Online Exemplo", 1950.1, c("02", "Cenografia"), { job: JOB_VERAO }),
      item("2026-09-25", "ajuste", "AV-00195", "IOF e anuidade", "Santander", 450, c("04", "Tarifa bancária")),
    ],
  },
  {
    id: "fc11",
    codigo: "FC-00011",
    cartao: "cc1",
    competencia: "2026-10",
    fecha: "2026-10-25",
    vence: "2026-11-05",
    status: "aberta",
    itens: [
      item("2026-09-27", "pp", "PP-00164 1/1", "Passagens aéreas da equipe — Recife", "Companhia Aérea Exemplo", 4380, c("02", "Transporte"), { job: JOB_RECIFE }),
      item("2026-10-02", "recorrencia", "AV-00207", "Assinatura do software de edição", "Software Criativo Exemplo", 289.9, c("07", "Assinaturas")),
      item("2026-10-06", "pp", "PP-00166 1/1", "Hospedagem da equipe — Recife", "Hotel Exemplo Recife", 3120, c("02", "Hospedagem"), { job: JOB_RECIFE }),
      item("2026-10-09", "avulso", "AV-00241", "Material de cenografia — loja online", "Loja Online Exemplo", 1250, c("02", "Cenografia"), { job: JOB_RECIFE }),
      item("2026-10-12", "desembolso", "DES-00019", "Corridas de aplicativo — produção", "Mobilidade Exemplo", 186.4, c("02", "Transporte"), { job: JOB_VERAO }),
      item("2026-10-15", "estorno", "AV-00243", "Estorno · material de cenografia devolvido", "Loja Online Exemplo", -310, c("02", "Cenografia"), { job: JOB_RECIFE, estornoDe: "AV-00241" }),
      item("2026-10-17", "avulso", "AV-00245", "Pacote de e-mail corporativo", "Nuvem Exemplo Serviços", 642, c("04", "Sistema")),
    ],
  },
  {
    id: "fc4",
    codigo: "FC-00004",
    cartao: "cc2",
    competencia: "2026-09",
    fecha: "2026-09-25",
    vence: "2026-10-05",
    status: "fechada",
    valorCobrado: 12500,
    itens: [
      item("2026-09-03", "pp", "PP-00098 1/1", "Locação de equipamentos de filmagem", "Locadora Exemplo", 7800, c("02", "Equipamentos"), { job: JOB_TESTE, empresa: "Empresa Teste" }),
      item("2026-09-10", "avulso", "AV-00186", "Passagens — visita técnica", "Companhia Aérea Exemplo", 2640, c("02", "Transporte"), { job: JOB_TESTE, empresa: "Empresa Teste" }),
      item("2026-09-18", "avulso", "AV-00189", "Licença de banco de imagens", "Imagens Exemplo", 1590, c("07", "Assinaturas"), { empresa: "Empresa Teste" }),
      item("2026-09-25", "ajuste", "AV-00194", "IOF e anuidade", "Banco Teste", 470, c("04", "Tarifa bancária"), { empresa: "Empresa Teste" }),
    ],
  },
  {
    id: "fc12",
    codigo: "FC-00012",
    cartao: "cc2",
    competencia: "2026-10",
    fecha: "2026-10-25",
    vence: "2026-11-05",
    status: "aberta",
    itens: [item("2026-10-08", "avulso", "AV-00238", "Licença de banco de imagens", "Imagens Exemplo", 380, c("07", "Assinaturas"), { empresa: "Empresa Teste" })],
  },
];

export const LOTES = [
  {
    id: LOTE_FOLHA_ID,
    nome: "remessa da folha 10/2026",
    descricao: "Remessa Santander · Folha 10/2026",
    total: 188494,
    titulos: folha,
  },
];

// Os títulos que os lançamentos de antes do protótipo pagaram — para o ⓘ
// do Extrato mostrar a origem e os documentos deles.
function pago(campos) {
  const valor = campos.valor;
  return { retencao: 0, parcela: [1, 1], empresa: "Agência California", job: null, ...campos, liquido: valor - (campos.retencao ?? 0), baixado: valor - (campos.retencao ?? 0), vencOrig: campos.vencOrig ?? campos.vencimento };
}

// O extrato do sistema na California Santander, em outubro, antes de
// qualquer coisa desta tela.
export const LANCAMENTOS_INICIAIS = [
  { id: "l1", titulo: pago({ id: "t-l1", lado: "receber", origem: "nf", ref: "NF 1", titulo: "NF 1", descricaoNf: "Prestação de serviços de produção", contraparte: "Marca de Bebidas Exemplo", cnpj: "00.000.000/0001-00", job: { codigo: "CAL-1004/26", nome: "Campanha de inverno" }, vencimento: "2026-10-01", emitida: "2026-09-01", valor: 68874.73, centro: c("01", "Geral"), forma: "ted", entra: true }), detalhe: { codigo: "NF 1 1/1", documento: "NF 1", rateio: [["RJ", 100]] }, data: "2026-10-01", valor: 68874.73, descricao: "Recebimento NF 1/1 — Prestação de serviços de produção", fornecedor: "Marca de Bebidas Exemplo", job: "CAL-1004/26", centro: c("01", "Geral"), empresa: "Agência California", conciliado: true },
  { id: "l2", titulo: pago({ id: "t-l2", lado: "pagar", origem: "recorrencia", ref: "Recorrência", titulo: "Honorários da contabilidade — setembro", contraparte: "Contabilidade Exemplo Ltda", vencimento: "2026-10-02", valor: 2500, centro: c("04", "Contabilidade"), forma: "pix" }), detalhe: { tag: "avulsa", codigo: "AV-00198", recorrente: true, rateio: [["NE", 60], ["SP", 40]] }, data: "2026-10-02", valor: -2500, descricao: "Honorários da contabilidade — setembro", fornecedor: "Contabilidade Exemplo Ltda", job: null, centro: c("04", "Contabilidade"), empresa: "Agência California", conciliado: true },
  { id: "l3", titulo: pago({ id: "t-l3", lado: "pagar", origem: "recorrencia", ref: "Recorrência", titulo: "Aluguel do galpão — outubro", contraparte: "Imobiliária Exemplo", vencimento: "2026-10-05", valor: 9800, centro: c("04", "Aluguel"), forma: "boleto" }), detalhe: { tag: "avulsa", codigo: "AV-00197", recorrente: true, documento: "Boleto", rateio: [["NE", 100]] }, data: "2026-10-05", valor: -9800, descricao: "Aluguel do galpão — outubro", fornecedor: "Imobiliária Exemplo", job: null, centro: c("04", "Aluguel"), empresa: "Agência California", conciliado: true },
  { id: "l4", titulo: pago({ id: "t-l4", lado: "pagar", origem: "folha", ref: "Folha 09/2026", titulo: "Folha de pagamento 09/2026", contraparte: "17 colaboradores", vencimento: "2026-10-06", valor: 175340.22, centro: c("05", "Salário"), forma: "pix" }), detalhe: { tag: "avulsa", codigo: "Folha 09/2026", rateio: [["NE", 82], ["SP", 18]] }, data: "2026-10-06", valor: -175340.22, descricao: "Folha de pagamento 09/2026", fornecedor: null, job: null, centro: c("05", "Salário"), empresa: "Agência California", conciliado: true, multiplas: 17 },
  { id: "l5", titulo: pago({ id: "t-l5", lado: "receber", origem: "nf", ref: "NF 1175", titulo: "NF 1175", descricaoNf: "Campanha de verão", contraparte: "Cervejaria Exemplo S.A.", cnpj: "11.222.333/0001-81", job: { codigo: "CAL-1007/26", nome: "Lançamento Verão" }, vencimento: "2026-10-09", emitida: "2026-09-10", valor: 120000, centro: c("01", "Geral"), forma: "ted", entra: true }), detalhe: { codigo: "NF 1175 1/1", documento: "NF 1175", rateio: [["SP", 83.33], ["NE", 16.67]], origens: [{ codigo: "CAL-1007/26", nome: "Lançamento Verão", valor: 100000 }, { codigo: "CAL-1003/26", save: true, valor: 20000 }] }, data: "2026-10-09", valor: 120000, descricao: "Recebimento NF 1175/1 — Campanha de verão", fornecedor: "Cervejaria Exemplo S.A.", job: "CAL-1007/26", centro: c("01", "Geral"), empresa: "Agência California", conciliado: true },
  { id: "l6", titulo: pago({ id: "t-l6", lado: "pagar", origem: "pp", ref: "PP-00109", titulo: "Cenografia do estande — parcela 1", contraparte: "Studio 3 Comunicação e Cenografia", job: { codigo: "AMB-1003/26", nome: "Ativação Stella Recife" }, vencimento: "2026-10-14", valor: 18750, parcela: [1, 3], nf: "588", centro: c("02", "Cenografia"), forma: "pix" }), detalhe: { tag: "pp", codigo: "PP-00109 1/3", documento: "NF 588", rateio: [["NE", 100]] }, data: "2026-10-14", valor: -18750, descricao: "PP-00109 · Cenografia do estande — parcela 1", fornecedor: "Studio 3 Comunicação e Cenografia", job: "AMB-1003/26", centro: c("02", "Cenografia"), empresa: "Agência California", conciliado: true },
  { id: "l7", titulo: pago({ id: "t-l7", lado: "imposto", origem: "imposto", ref: "Guia municipal", titulo: "ISS próprio", contraparte: "Prefeitura de Salvador", pj: "Agência California Ltda", cnpjLocal: "00.000.000/0001-00", local: "Salvador-BA", competencia: "agosto/2026", origemImposto: "APURAÇÃO", guiaArquivo: "Guia-ISS-agosto-2026.pdf", vencimento: "2026-10-15", valor: 6240.55, centro: c("03", "ISS"), forma: "guia" }), detalhe: { codigo: "ISS próprio · agosto/2026", documento: "Guia municipal", rateio: [["NE", 70], ["SP", 30]] }, data: "2026-10-15", valor: -6240.55, descricao: "Guia de ISS próprio · agosto/2026", fornecedor: null, job: null, centro: c("03", "ISS"), empresa: "Agência California", conciliado: true },
  { id: "l9", titulo: pago({ id: "t-l9", lado: "pagar", origem: "fatura", ref: "FC-00010", titulo: "Fatura Corporativo California · fecha 25/09/2026", contraparte: "Corporativo California", vencimento: "2026-10-05", valor: 8430, centro: null, forma: "pix", faturaId: "fc10", cartao: "cc1" }), detalhe: { codigo: "FC-00010", documento: "Fatura do cartão" }, data: "2026-10-05", valor: -8430, descricao: "FC-00010 · Fatura Corporativo California · fecha 25/09/2026", fornecedor: "Corporativo California", job: null, centro: { tipo: "—", sub: "Pagamento de fatura · fora do DRE" }, empresa: "Agência California", conciliado: true, faturaId: "fc10" },
  // Baixados à mão em 19/10, ainda sem extrato do banco. O aluguel bate com
  // o banco; a manutenção tem R$ 0,36 a mais; o frete não está no banco.
  { id: "l10", tituloId: "av-manutencao", detalhe: { tag: "avulsa", codigo: "AV-00214", documento: "Boleto", rateio: [["NE", 100]] }, data: "2026-10-19", valor: -516.95, juros: 0.36, descricao: "Manutenção do ar-condicionado", fornecedor: "Clima Frio Manutenção", job: null, centro: c("04", "Obra / Manutenção"), empresa: "Agência California", conciliado: false },
  { id: "l11", tituloId: "pp-168", detalhe: { tag: "pp", codigo: "PP-00168 1/1", rateio: [["NE", 100]] }, data: "2026-10-19", valor: -380, descricao: "PP-00168 · Frete — retirada do material", fornecedor: "Rota Transportes e Logística", job: "AMB-1003/26", centro: c("02", "Frete"), empresa: "Agência California", conciliado: false },
  { id: "l8", titulo: pago({ id: "t-l8", lado: "pagar", origem: "recorrencia", ref: "Recorrência", titulo: "Aluguel do escritório — outubro", contraparte: "Imobiliária Exemplo", vencimento: "2026-10-19", valor: 15000, centro: c("04", "Aluguel"), forma: "boleto" }), detalhe: { tag: "avulsa", codigo: "AV-00197", recorrente: true, documento: "Boleto", rateio: [["NE", 100]] }, data: "2026-10-19", valor: -15000, descricao: "Aluguel do escritório — outubro", fornecedor: "Imobiliária Exemplo", job: null, centro: c("04", "Aluguel"), empresa: "Agência California", conciliado: false },
];

export const SALDO_INICIAL_OUTUBRO = 1029764.73;

export const REGRAS = [
  { id: "r1", padrao: "TAR ", centro: "04 · Custo Fixo · Tarifa bancária", tipo: "04", sub: "Tarifa bancária", empresa: "Agência California", criadaEm: "02/09/2026", usos: 38 },
  { id: "r2", padrao: "IOF ", centro: "11 · Despesa com Juros · Juros e multa", tipo: "11", sub: "Juros e multa", empresa: "Agência California", criadaEm: "02/09/2026", usos: 4 },
];

// O extrato que o Tiago mandou (Santander, 22/05/2026), com a data trazida
// para 19/10/2026, a conta trocada por uma fictícia e o CNPJ do TED
// recebido trocado pelo do cliente de exemplo. Os valores e os históricos
// são os do arquivo, menos as duas linhas marcadas "não está no arquivo",
// que mostram uma linha do banco pagando vários títulos.
const MOVS = [
  ["DEBIT", "-9,00", "497169", "TAR EMISSAO TED CIP PGTO FORNEC"],
  ["DEBIT", "-150,00", "497169", "TAR PIX PGTO FORNEC - MESMA INST"],
  ["DEBIT", "-1920,00", "497169", "TAR PIX PGTO FORNEC - OUTRA INST"],
  ["DEBIT", "-10,00", "497169", "TAR PIX PGTO FORNEC - MESMA INST"],
  ["DEBIT", "-50,00", "497169", "TAR PIX PGTO FORNEC - OUTRA INST"],
  ["CREDIT", "33400,00", "00000000", "TED RECEBIDA     11222333000181"],
  ["CREDIT", "18770,00", "00000000", "TED RECEBIDA     00000000000100"],
  ["CREDIT", "11800,00", "00000000", "TED RECEBIDA     11222333000181"], // não está no arquivo
  ["CREDIT", "40000,00", "00000000", "DEVOLUCAO DE PIX NAO EFETUADA     900020123"],
  ["DEBIT", "-93,29", "110522", "PGTO FORNECEDORES -CONCESSIONARIAS     0001.1300013"],
  ["DEBIT", "-120,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-199,90", "110522", "PGTO FORNECEDORES -CONCESSIONARIAS     0001.1300013"],
  ["DEBIT", "-278,97", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-302,20", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-500,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-516,59", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-600,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-653,90", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-695,65", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-749,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-884,85", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-1000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-1000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-1200,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-1200,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-1671,61", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-1685,00", "030522", "PAGFOR PIX MESMA INST-DIFERENT TIT     0001.1300013"],
  ["DEBIT", "-1763,82", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-1840,00", "030522", "PAGFOR PIX MESMA INST-DIFERENT TIT     0001.1300013"],
  ["DEBIT", "-2000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-2000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-2080,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"], // não está no arquivo
  ["DEBIT", "-2300,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-2460,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-2500,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-3000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-3000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-3000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-3495,54", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-3702,50", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-3715,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-3965,30", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-4000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-5000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-5000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-5000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-5000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-6000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-6611,86", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-8500,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-9191,38", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-15000,00", "310522", "PAGAMENTO DE TITULO     0001.1300013"],
  ["DEBIT", "-24800,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-25000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-32000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-40000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-48000,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-188494,00", "030522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
];

export function ofxDeExemplo(horario, moeda = "BRL") {
  const trn = MOVS.map(
    ([tipo, valor, doc, memo], i) => `<STMTTRN>
<TRNTYPE>${tipo}
<DTPOSTED>20261019000000[-3:GMT]
<TRNAMT>${valor}
<FITID>00011300001320261020${horario}${i}
<CHECKNUM>${doc}
<PAYEEID>0
<MEMO>${memo}
</STMTTRN>`,
  ).join("\n");
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20261020${horario}[-3:GMT]
<LANGUAGE>ENG
<FI><ORG>SANTANDER<FID>SANTANDER</FI>
</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>${moeda}
<BANKACCTFROM><BANKID>033<ACCTID>0001130000013<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261019000000[-3:GMT]<DTEND>20261019000000[-3:GMT]
${trn}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>__SALDO__<DTASOF>20261020${horario}[-3:GMT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

// O extrato de hoje, baixado no meio do dia (20/10 às 11:40): as linhas de
// hoje podem ser conciliadas, mas o dia ainda não terminou e não entra no
// fechamento. Só no protótipo.
const MOVS_DO_DIA = [
  ["DEBIT", "-3380,00", "200522", "PAGFOR PIX OUTRA INST- DIFEREN TIT     0001.1300013"],
  ["DEBIT", "-10,00", "497169", "TAR PIX PGTO FORNEC - MESMA INST"],
  ["CREDIT", "3870,00", "00000000", "TED RECEBIDA     11222333000181"],
];
export const SOMA_DO_DIA = 480;

export function ofxDoDia() {
  const trn = MOVS_DO_DIA.map(
    ([tipo, valor, doc, memo], i) => `<STMTTRN>
<TRNTYPE>${tipo}
<DTPOSTED>20261020000000[-3:GMT]
<TRNAMT>${valor}
<FITID>0001130000132026102011401${i}
<CHECKNUM>${doc}
<PAYEEID>0
<MEMO>${memo}
</STMTTRN>`,
  ).join("\n");
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20261020114012[-3:GMT]
<LANGUAGE>ENG
<FI><ORG>SANTANDER<FID>SANTANDER</FI>
</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>033<ACCTID>0001130000013<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261020000000[-3:GMT]<DTEND>20261020000000[-3:GMT]
${trn}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>__SALDO__<DTASOF>20261020114012[-3:GMT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

// A última baixa com retenção de cada cliente ou fornecedor: o "Repetir as
// alíquotas" da baixa (decisão 125, D6 2a).
export const ULTIMA_RETENCAO = {
  "Cervejaria Exemplo S.A.": { referencia: "NF 1175", data: "2026-10-09", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1 } },
  "Marca de Bebidas Exemplo": { referencia: "NF 1", data: "2026-10-01", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1 } },
  "Corte Final Pós-Produção": { referencia: "PP-00128", data: "2026-09-18", aliquotas: { IRRF: 1.5, PIS: 0.65, COFINS: 3, CSLL: 1 } },
};
