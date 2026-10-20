/* ---------- Dados de exemplo (fictícios) ---------- */

const USUARIO = { nome: "Helena Castro", papel: "Jurídico" };

const AGENCIA = {
  razao: "Agência California Comunicação Ltda.",
  cnpj: "00.000.000/0001-00",
  endereco: "Rua Exemplo, 100, Pinheiros, São Paulo/SP",
};

const CLIENTES = {
  nebula: { id: "nebula", fantasia: "Nébula Bebidas", razao: "Nébula Bebidas S.A.", cnpj: "22.222.222/0001-30", endereco: "Av. Exemplo, 2000, Itaim Bibi, São Paulo/SP" },
  orla: { id: "orla", fantasia: "Orla Cosméticos", razao: "Orla Cosméticos Ltda.", cnpj: "33.333.333/0001-41", endereco: "Rua Exemplo, 455, Botafogo, Rio de Janeiro/RJ" },
  ventosul: { id: "ventosul", fantasia: "Vento Sul Seguros", razao: "Vento Sul Seguros S.A.", cnpj: "44.444.444/0001-52", endereco: "Av. Exemplo, 1200, Moinhos de Vento, Porto Alegre/RS" },
  prisma: { id: "prisma", fantasia: "Prisma Telecom", razao: "Prisma Telecom S.A.", cnpj: "55.555.555/0001-63", endereco: "Av. Exemplo, 900, Vila Olímpia, São Paulo/SP" },
  rotaverde: { id: "rotaverde", fantasia: "Rota Verde Alimentos", razao: "Rota Verde Alimentos Ltda.", cnpj: "66.666.666/0001-74", endereco: "Rodovia Exemplo, km 12, Ribeirão Preto/SP" },
};

const FORNECEDORES = {
  luzcine: { id: "luzcine", nome: "LuzCine Locações", razao: "LuzCine Locação de Equipamentos Ltda.", cnpj: "77.777.777/0001-85", endereco: "Rua Exemplo, 88, Barra Funda, São Paulo/SP" },
  vertice: { id: "vertice", nome: "Estúdio Vértice", razao: "Estúdio Vértice Produções Ltda.", cnpj: "88.888.888/0001-96", endereco: "Rua Exemplo, 310, Vila Madalena, São Paulo/SP" },
  sabor: { id: "sabor", nome: "Sabor de Set", razao: "Sabor de Set Buffet e Eventos Ltda.", cnpj: "99.999.999/0001-07", endereco: "Rua Exemplo, 27, Mooca, São Paulo/SP" },
  atelier: { id: "atelier", nome: "Atelier Norte", razao: "Atelier Norte Cenografia Ltda.", cnpj: "11.111.111/0001-18", endereco: "Av. Exemplo, 1500, Lapa, São Paulo/SP" },
  rodas: {
    id: "rodas", nome: "Rodas Transportes", razao: "Rodas Transportes e Logística Ltda.", cnpj: "22.222.222/0002-11", endereco: "Rua Exemplo, 640, Vila Leopoldina, São Paulo/SP",
    // Versão B: fornecedor recorrente com contrato-quadro vigente.
    quadro: { codigo: "CQ-0007", assinadoEm: "2026-01-15", vigencia: "2026-12-31", objeto: "Transporte de carga e de pessoas, com motorista, sob demanda" },
  },
  grafica: { id: "grafica", nome: "Gráfica Ponto Firme", razao: "Gráfica Ponto Firme Ltda.", cnpj: "33.333.333/0002-22", endereco: "Rua Exemplo, 75, Cambuci, São Paulo/SP" },
  somepalco: { id: "somepalco", nome: "Som & Palco", razao: "Som & Palco Sonorização Ltda.", cnpj: "44.444.444/0002-33", endereco: "Rua Exemplo, 19, Centro, Rio de Janeiro/RJ" },
  perfil: { id: "perfil", nome: "Perfil Exemplo Conteúdo", razao: "Perfil Exemplo Conteúdo Digital Ltda.", cnpj: "55.555.555/0002-44", endereco: "Rua Exemplo, 501, Leblon, Rio de Janeiro/RJ" },
  talento: { id: "talento", nome: "Talento Casting", razao: "Talento Casting e Elenco Ltda.", cnpj: "66.666.666/0002-55", endereco: "Rua Exemplo, 230, Moinhos de Vento, Porto Alegre/RS" },
};

const JOBS = [
  {
    id: "j412", codigo: "JOB-0412", nome: "Lançamento Nébula Zero", projeto: { codigo: "PRJ-0187", nome: "Nébula Verão 2027" },
    clienteId: "nebula", gp: "Júlia Prado", produtor: "Rafael Moura", status: "em_producao", servico: "Ativação", produto: "Nébula Zero",
    abertoEm: "2026-10-16T14:20", abertoPor: "Paula Mendes", inicio: "2026-11-03", fim: "2026-11-14", cidade: "São Paulo/SP",
    valor: 486300, condicao: "50% na assinatura e 50% em 30 dias após o evento", versao: "Nébula Zero - V3",
  },
  {
    id: "j409", codigo: "JOB-0409", nome: "Orla Experience Rio", projeto: { codigo: "PRJ-0183", nome: "Orla 20 anos" },
    clienteId: "orla", gp: "Bianca Torres", produtor: "Diego Lins", status: "em_producao", servico: "Evento", produto: "Linha Maresia",
    abertoEm: "2026-10-09T10:05", abertoPor: "Paula Mendes", inicio: "2026-10-29", fim: "2026-11-01", cidade: "Rio de Janeiro/RJ",
    valor: 312750, condicao: "30 dias após o faturamento", versao: "Orla Experience - V2",
  },
  {
    id: "j415", codigo: "JOB-0415", nome: "Filme Segurança em Casa", projeto: { codigo: "PRJ-0190", nome: "Vento Sul Residencial" },
    clienteId: "ventosul", gp: "Júlia Prado", produtor: "Caio Nunes", status: "aberto", servico: "Produção audiovisual", produto: "Seguro Residencial",
    abertoEm: "2026-10-19T16:42", abertoPor: "Paula Mendes", inicio: "2026-11-24", fim: "2026-11-28", cidade: "Porto Alegre/RS",
    valor: 228900, condicao: "45 dias após o faturamento", versao: "Segurança em Casa - V1",
  },
  {
    id: "j401", codigo: "JOB-0401", nome: "Ativação Prisma 5G", projeto: { codigo: "PRJ-0176", nome: "Prisma 5G Shoppings" },
    clienteId: "prisma", gp: "Bianca Torres", produtor: "Lívia Rocha", status: "em_producao", servico: "Ativação", produto: "Prisma 5G",
    abertoEm: "2026-09-25T09:30", abertoPor: "Paula Mendes", inicio: "2026-10-05", fim: "2026-10-26", cidade: "São Paulo/SP",
    valor: 154200, condicao: "30 dias após o faturamento", versao: "Prisma 5G - V4",
  },
  {
    id: "j418", codigo: "JOB-0418", nome: "Feira Rota Verde Agro", projeto: { codigo: "PRJ-0192", nome: "Rota Verde Feiras 2026" },
    clienteId: "rotaverde", gp: "Bianca Torres", produtor: "Diego Lins", status: "aberto", servico: "Evento", produto: "Institucional",
    abertoEm: "2026-10-20T09:15", abertoPor: "Paula Mendes", inicio: "2026-12-01", fim: "2026-12-04", cidade: "Ribeirão Preto/SP",
    valor: 197400, condicao: "À vista na assinatura", versao: "Rota Verde Agro - V2",
  },
];

/* Cada PP aponta para o item da planilha interna do job (grupo · item),
 * como no protótipo de Suprimentos. `tipo` sugere o tipo de modelo. */
const PPS = [
  { id: "pp521", codigo: "PP-00521", jobId: "j412", fornecedorId: "luzcine", tipo: "locacao", grupo: "Equipamentos", item: "Câmera e kit de lentes", servico: "Locação de câmera e kit de lentes", especificacoes: "1 câmera cinema 6K com 2 cartões, kit de 5 lentes prime, 3 diárias de filmagem", valor: 18600, prazoPgto: "2026-10-24", condicao: "50% na reserva e 50% na devolução", status: "aprovada", geradaEm: "2026-10-17T11:30" },
  { id: "pp522", codigo: "PP-00522", jobId: "j412", fornecedorId: "vertice", tipo: "prestacao", grupo: "Pós-produção", item: "Edição e finalização", servico: "Edição e finalização do filme", especificacoes: "Montagem, correção de cor e finalização de 1 filme de 60s e 3 cortes de 15s", valor: 42000, prazoPgto: "2026-11-05", condicao: "30 dias da nota fiscal", status: "em_avaliacao", geradaEm: "2026-10-17T15:10" },
  { id: "pp523", codigo: "PP-00523", jobId: "j412", fornecedorId: "sabor", tipo: "prestacao", grupo: "Alimentação", item: "Catering de set", servico: "Catering para equipe de set", especificacoes: "Café da manhã, almoço e lanche para 45 pessoas, 3 dias", valor: 9450, prazoPgto: "2026-10-23", condicao: "À vista, mediante nota fiscal", status: "aprovada", geradaEm: "2026-10-16T17:02" },
  { id: "pp524", codigo: "PP-00524", jobId: "j412", fornecedorId: "atelier", tipo: "prestacao", grupo: "Cenografia", item: "Cenário praia artificial", servico: "Construção de cenário — praia artificial", especificacoes: "Projeto, construção, montagem e desmontagem de cenário de 120 m² em estúdio", valor: 67800, prazoPgto: "2026-11-10", condicao: "40% no início e 60% na entrega", status: "em_avaliacao", geradaEm: "2026-10-18T09:44" },
  { id: "pp525", codigo: "PP-00525", jobId: "j412", fornecedorId: "luzcine", tipo: "locacao", grupo: "Equipamentos", item: "Iluminação", servico: "Locação de iluminação", especificacoes: "Kit de 12 refletores LED, 4 tripés, 1 gerador silencioso, 3 diárias", valor: 12300, prazoPgto: "2026-11-03", condicao: "50% na reserva e 50% na devolução", status: "gerada", geradaEm: "2026-10-19T10:20" },
  { id: "pp526", codigo: "PP-00526", jobId: "j412", fornecedorId: "rodas", tipo: "locacao", grupo: "Transporte", item: "Van com motorista", servico: "Van com motorista", especificacoes: "Van executiva de 15 lugares com motorista, 3 diárias de 10 horas", valor: 4200, prazoPgto: "2026-10-15", condicao: "15 dias da nota fiscal", status: "pago", geradaEm: "2026-10-10T08:50" },
  { id: "pp527", codigo: "PP-00527", jobId: "j412", fornecedorId: "grafica", tipo: "compra", grupo: "Material gráfico", item: "Material de PDV", servico: "Impressão de material de PDV", especificacoes: "500 displays de balcão e 2.000 folhetos em couché 150 g", valor: 3150, prazoPgto: "2026-10-30", condicao: "À vista, mediante nota fiscal", status: "em_avaliacao", geradaEm: "2026-10-19T14:05" },

  { id: "pp498", codigo: "PP-00498", jobId: "j409", fornecedorId: "somepalco", tipo: "locacao", grupo: "Estrutura", item: "Som e palco", servico: "Locação de som e palco", especificacoes: "Palco 8×6 m, sistema de som para 500 pessoas e técnico operador", valor: 31200, valorOriginal: 28400, prazoPgto: "2026-10-31", condicao: "30 dias da nota fiscal", status: "aprovada", geradaEm: "2026-10-10T16:20" },
  { id: "pp499", codigo: "PP-00499", jobId: "j409", fornecedorId: "atelier", tipo: "prestacao", grupo: "Cenografia", item: "Estandes da marca", servico: "Montagem de estandes da marca", especificacoes: "3 estandes de 9 m² com iluminação e mobiliário", valor: 54900, prazoPgto: "2026-10-27", condicao: "40% no início e 60% na entrega", status: "aprovada", geradaEm: "2026-10-11T11:00" },
  { id: "pp503", codigo: "PP-00503", jobId: "j409", fornecedorId: "perfil", tipo: "influenciador", grupo: "Mídia social", item: "Influenciadora — cobertura", servico: "Cobertura do evento por influenciadora", especificacoes: "3 stories e 1 reels no Instagram durante o evento, com 1 menção à marca em cada", valor: 18000, prazoPgto: "2026-10-31", condicao: "30 dias após a publicação", status: "em_avaliacao", geradaEm: "2026-10-14T13:40" },
  { id: "pp505", codigo: "PP-00505", jobId: "j409", fornecedorId: "sabor", tipo: "prestacao", grupo: "Alimentação", item: "Coquetel de abertura", servico: "Coquetel de abertura", especificacoes: "Coquetel volante para 200 convidados, 3 horas, com bebidas não alcoólicas", valor: 21600, prazoPgto: "2026-10-22", condicao: "À vista, mediante nota fiscal", status: "aprovada", geradaEm: "2026-10-15T10:12" },
  { id: "pp506", codigo: "PP-00506", jobId: "j409", fornecedorId: "rodas", tipo: "locacao", grupo: "Transporte", item: "Transporte de carga", servico: "Transporte de carga para montagem", especificacoes: "2 caminhões baú, ida e volta São Paulo–Rio, com ajudantes", valor: 6800, prazoPgto: "2026-10-25", condicao: "15 dias da nota fiscal", status: "aprovada", geradaEm: "2026-10-16T09:00" },

  { id: "pp530", codigo: "PP-00530", jobId: "j415", fornecedorId: "talento", tipo: "prestacao", grupo: "Elenco", item: "Casting e cachê", servico: "Casting e cachê de elenco", especificacoes: "Seleção e cachê de 2 atores principais, 2 diárias, com cessão de imagem por 12 meses", valor: 16000, prazoPgto: "2026-11-12", condicao: "30 dias da nota fiscal", status: "gerada", geradaEm: "2026-10-20T08:40" },
  { id: "pp531", codigo: "PP-00531", jobId: "j415", fornecedorId: "luzcine", tipo: "locacao", grupo: "Equipamentos", item: "Câmera", servico: "Locação de câmera", especificacoes: "1 câmera cinema 6K com 2 cartões, 2 diárias", valor: 11400, prazoPgto: "2026-11-12", condicao: "50% na reserva e 50% na devolução", status: "gerada", geradaEm: "2026-10-20T08:55" },

  { id: "pp470", codigo: "PP-00470", jobId: "j401", fornecedorId: "atelier", tipo: "prestacao", grupo: "Cenografia", item: "Estande da ativação", servico: "Estande da ativação", especificacoes: "Estande de 30 m² em shopping, montagem e desmontagem", valor: 38200, prazoPgto: "2026-10-10", condicao: "40% no início e 60% na entrega", status: "pago", geradaEm: "2026-09-26T10:00" },
  { id: "pp471", codigo: "PP-00471", jobId: "j401", fornecedorId: "somepalco", tipo: "locacao", grupo: "Estrutura", item: "Sonorização", servico: "Sonorização do estande", especificacoes: "Sistema de som ambiente e 2 microfones sem fio, 21 dias", valor: 7900, prazoPgto: "2026-10-12", condicao: "30 dias da nota fiscal", status: "pago", geradaEm: "2026-09-26T10:30" },
  { id: "pp472", codigo: "PP-00472", jobId: "j401", fornecedorId: "grafica", tipo: "compra", grupo: "Material gráfico", item: "Adesivagem e sinalização", servico: "Adesivagem e sinalização", especificacoes: "Adesivos de piso, totens e sinalização do estande", valor: 5300, prazoPgto: "2026-10-08", condicao: "À vista, mediante nota fiscal", status: "pago", geradaEm: "2026-09-27T15:00" },
];

/* Contratos. `parte`: cliente (nasce na abertura do job pelo financeiro)
 * ou fornecedor (nasce na geração da PP por Suprimentos). */
const H = (em, por, texto) => ({ em, por, texto });
const CONTRATOS = [
  { id: "c-j412", parte: "cliente", jobId: "j412", status: "assinatura", modeloId: "m-cli-prod", modeloVersao: 2, chegouEm: "2026-10-16T14:20", atualizadoEm: "2026-10-18T10:05", responsavel: "Helena Castro", arquivo: "CTR-0412-CLI-v1.pdf", valor: 486300,
    campos: { objeto: "produção e execução da ativação de lançamento do produto Nébula Zero, incluindo filme de 60 segundos e evento de imprensa", entregaveis: "1 filme de 60s, 3 cortes de 15s e 1 evento de lançamento para 150 convidados" },
    clausulas: ["conf", "imagem"],
    historico: [H("2026-10-16T14:20", "Sistema", "Job aberto pelo financeiro (Paula Mendes). Contrato com o cliente criado como pendente."), H("2026-10-17T09:12", "Helena Castro", "Rascunho iniciado com o modelo Prestação de serviços de produção — cliente (v2)."), H("2026-10-18T10:05", "Helena Castro", "Contrato gerado (CTR-0412-CLI-v1.pdf) e anexado ao job. Enviado ao cliente pelo GP.")] },
  { id: "c-j409", parte: "cliente", jobId: "j409", status: "assinado", modeloId: "m-cli-prod", modeloVersao: 2, chegouEm: "2026-10-09T10:05", atualizadoEm: "2026-10-13T17:40", responsavel: "Marcos Vianna", arquivo: "CTR-0409-CLI-v1.pdf", arquivoAssinado: "CTR-0409-CLI-assinado.pdf", assinadoEm: "2026-10-13", valor: 312750,
    campos: { objeto: "produção e execução do evento Orla Experience Rio", entregaveis: "1 evento de 4 dias para público de 2.000 pessoas, com 3 estandes de marca" }, clausulas: ["conf"],
    historico: [H("2026-10-09T10:05", "Sistema", "Job aberto pelo financeiro. Contrato com o cliente criado como pendente."), H("2026-10-10T15:30", "Marcos Vianna", "Contrato gerado e anexado ao job."), H("2026-10-13T17:40", "Marcos Vianna", "Contrato assinado anexado.")] },
  { id: "c-j415", parte: "cliente", jobId: "j415", status: "pendente", chegouEm: "2026-10-19T16:42", historico: [H("2026-10-19T16:42", "Sistema", "Job aberto pelo financeiro (Paula Mendes). Contrato com o cliente criado como pendente.")] },
  { id: "c-j401", parte: "cliente", jobId: "j401", status: "assinado", modeloId: "m-cli-prod", modeloVersao: 1, chegouEm: "2026-09-25T09:30", atualizadoEm: "2026-09-30T11:00", responsavel: "Helena Castro", arquivo: "CTR-0401-CLI-v1.pdf", arquivoAssinado: "CTR-0401-CLI-assinado.pdf", assinadoEm: "2026-09-30", valor: 154200,
    campos: { objeto: "produção e execução da ativação Prisma 5G em shoppings", entregaveis: "Ativação em 3 shoppings por 21 dias, com equipe de promotores" }, clausulas: [],
    historico: [H("2026-09-25T09:30", "Sistema", "Job aberto pelo financeiro. Contrato com o cliente criado como pendente."), H("2026-09-30T11:00", "Helena Castro", "Contrato assinado anexado.")] },
  { id: "c-j418", parte: "cliente", jobId: "j418", status: "pendente", chegouEm: "2026-10-20T09:15", historico: [H("2026-10-20T09:15", "Sistema", "Job aberto pelo financeiro (Paula Mendes). Contrato com o cliente criado como pendente.")] },

  { id: "c-pp521", parte: "fornecedor", ppIds: ["pp521"], status: "pendente", chegouEm: "2026-10-17T11:30", historico: [H("2026-10-17T11:30", "Sistema", "PP-00521 gerada por Suprimentos (Otávio Reis). Contrato com o fornecedor criado como pendente.")] },
  { id: "c-pp522", parte: "fornecedor", ppIds: ["pp522"], status: "elaboracao", modeloId: "m-forn-prest", modeloVersao: 4, chegouEm: "2026-10-17T15:10", atualizadoEm: "2026-10-19T18:22", responsavel: "Helena Castro", valor: 42000,
    campos: { objeto: "serviços de edição, correção de cor e finalização de filme publicitário", entregaveis: "", prazo_execucao: "" }, clausulas: ["conf", "imagem"],
    historico: [H("2026-10-17T15:10", "Sistema", "PP-00522 gerada por Suprimentos (Otávio Reis). Contrato com o fornecedor criado como pendente."), H("2026-10-19T18:22", "Helena Castro", "Rascunho salvo com o modelo Prestação de serviços — fornecedor (v4).")] },
  { id: "c-pp523", parte: "fornecedor", ppIds: ["pp523"], status: "assinatura", modeloId: "m-forn-prest", modeloVersao: 4, chegouEm: "2026-10-16T17:02", atualizadoEm: "2026-10-18T11:40", responsavel: "Helena Castro", arquivo: "CTR-00523-v1.pdf", valor: 9450,
    campos: { objeto: "serviços de catering para a equipe de set", entregaveis: "café da manhã, almoço e lanche para 45 pessoas", prazo_execucao: "3 dias, de 04/11/2026 a 06/11/2026" }, clausulas: [],
    historico: [H("2026-10-16T17:02", "Sistema", "PP-00523 gerada por Suprimentos. Contrato com o fornecedor criado como pendente."), H("2026-10-18T11:40", "Helena Castro", "Contrato gerado (CTR-00523-v1.pdf) e anexado à PP-00523.")] },
  { id: "c-pp524", parte: "fornecedor", ppIds: ["pp524"], status: "pendente", chegouEm: "2026-10-18T09:44", historico: [H("2026-10-18T09:44", "Sistema", "PP-00524 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },
  { id: "c-pp525", parte: "fornecedor", ppIds: ["pp525"], status: "pendente", chegouEm: "2026-10-19T10:20", historico: [H("2026-10-19T10:20", "Sistema", "PP-00525 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },
  { id: "c-pp526", parte: "fornecedor", ppIds: ["pp526"], status: "assinado", modeloId: "m-forn-veic", modeloVersao: 1, chegouEm: "2026-10-10T08:50", atualizadoEm: "2026-10-12T10:00", responsavel: "Marcos Vianna", arquivo: "CTR-00526-v1.pdf", arquivoAssinado: "CTR-00526-assinado.pdf", assinadoEm: "2026-10-12", valor: 4200,
    campos: { objeto: "1 van executiva de 15 lugares com motorista", roteiro: "Base da agência ↔ estúdio, em São Paulo/SP", periodo_locacao: "3 diárias de 10 horas" }, clausulas: [],
    historico: [H("2026-10-10T08:50", "Sistema", "PP-00526 gerada por Suprimentos."), H("2026-10-12T10:00", "Marcos Vianna", "Contrato assinado anexado. Pagamento liberado.")] },
  { id: "c-pp527", parte: "fornecedor", ppIds: ["pp527"], status: "pendente", chegouEm: "2026-10-19T14:05", historico: [H("2026-10-19T14:05", "Sistema", "PP-00527 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },

  { id: "c-pp498", parte: "fornecedor", ppIds: ["pp498"], status: "assinado", modeloId: "m-forn-loc", modeloVersao: 3, chegouEm: "2026-10-10T16:20", atualizadoEm: "2026-10-14T12:00", responsavel: "Marcos Vianna", arquivo: "CTR-00498-v1.pdf", arquivoAssinado: "CTR-00498-assinado.pdf", assinadoEm: "2026-10-14", valor: 28400,
    campos: { objeto: "palco de 8×6 m e sistema de som para 500 pessoas, com técnico operador", periodo_locacao: "4 diárias, de 29/10/2026 a 01/11/2026", local_entrega: "Marina da Glória, Rio de Janeiro/RJ", valor_reposicao: "R$ 380.000,00" }, clausulas: ["seguro"],
    historico: [H("2026-10-10T16:20", "Sistema", "PP-00498 gerada por Suprimentos."), H("2026-10-14T12:00", "Marcos Vianna", "Contrato assinado anexado. Pagamento liberado.")] },
  // Só na versão B: a PP foi reemitida com valor maior depois do contrato assinado.
  { id: "c-pp498-ad", parte: "fornecedor", ppIds: ["pp498"], tipo: "aditivo", soNaB: true, status: "pendente", chegouEm: "2026-10-19T11:15", aditivo: { de: 28400, para: 31200, motivo: "PP-00498 reemitida pela produção: inclusão de 1 diária de montagem" },
    historico: [H("2026-10-19T11:15", "Sistema", "PP-00498 reemitida com valor maior que o do contrato assinado (R$ 28.400,00 → R$ 31.200,00). Aditivo criado como pendente.")] },
  { id: "c-pp499", parte: "fornecedor", ppIds: ["pp499"], status: "assinatura", modeloId: "m-forn-prest", modeloVersao: 4, chegouEm: "2026-10-11T11:00", atualizadoEm: "2026-10-15T16:30", responsavel: "Marcos Vianna", arquivo: "CTR-00499-v1.pdf", valor: 54900,
    campos: { objeto: "projeto, construção e montagem de 3 estandes da marca", entregaveis: "3 estandes de 9 m² montados, com iluminação e mobiliário", prazo_execucao: "montagem até 28/10/2026 e desmontagem em 02/11/2026" }, clausulas: ["multa"],
    historico: [H("2026-10-11T11:00", "Sistema", "PP-00499 gerada por Suprimentos."), H("2026-10-15T16:30", "Marcos Vianna", "Contrato gerado (CTR-00499-v1.pdf) e anexado à PP-00499.")] },
  { id: "c-pp503", parte: "fornecedor", ppIds: ["pp503"], status: "pendente", chegouEm: "2026-10-14T13:40", historico: [H("2026-10-14T13:40", "Sistema", "PP-00503 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },
  { id: "c-pp505", parte: "fornecedor", ppIds: ["pp505"], status: "pendente", chegouEm: "2026-10-15T10:12", historico: [H("2026-10-15T10:12", "Sistema", "PP-00505 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },
  { id: "c-pp506", parte: "fornecedor", ppIds: ["pp506"], status: "pendente", chegouEm: "2026-10-16T09:00", historico: [H("2026-10-16T09:00", "Sistema", "PP-00506 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },

  { id: "c-pp530", parte: "fornecedor", ppIds: ["pp530"], status: "pendente", chegouEm: "2026-10-20T08:40", historico: [H("2026-10-20T08:40", "Sistema", "PP-00530 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },
  { id: "c-pp531", parte: "fornecedor", ppIds: ["pp531"], status: "pendente", chegouEm: "2026-10-20T08:55", historico: [H("2026-10-20T08:55", "Sistema", "PP-00531 gerada por Suprimentos. Contrato com o fornecedor criado como pendente.")] },

  { id: "c-pp470", parte: "fornecedor", ppIds: ["pp470"], status: "assinado", modeloId: "m-forn-prest", modeloVersao: 3, chegouEm: "2026-09-26T10:00", assinadoEm: "2026-09-29", arquivo: "CTR-00470-v1.pdf", arquivoAssinado: "CTR-00470-assinado.pdf", valor: 38200, campos: { objeto: "construção e montagem do estande da ativação", entregaveis: "1 estande de 30 m²", prazo_execucao: "de 01/10/2026 a 26/10/2026" }, clausulas: [], historico: [H("2026-09-29T14:00", "Helena Castro", "Contrato assinado anexado.")] },
  { id: "c-pp471", parte: "fornecedor", ppIds: ["pp471"], status: "assinado", modeloId: "m-forn-loc", modeloVersao: 3, chegouEm: "2026-09-26T10:30", assinadoEm: "2026-09-29", arquivo: "CTR-00471-v1.pdf", arquivoAssinado: "CTR-00471-assinado.pdf", valor: 7900, campos: { objeto: "sistema de som ambiente e 2 microfones sem fio", periodo_locacao: "21 dias", local_entrega: "Shopping Exemplo, São Paulo/SP", valor_reposicao: "R$ 45.000,00" }, clausulas: [], historico: [H("2026-09-29T15:00", "Helena Castro", "Contrato assinado anexado.")] },
  { id: "c-pp472", parte: "fornecedor", ppIds: ["pp472"], status: "assinado", modeloId: "m-forn-compra", modeloVersao: 2, chegouEm: "2026-09-27T15:00", assinadoEm: "2026-09-30", arquivo: "CTR-00472-v1.pdf", arquivoAssinado: "CTR-00472-assinado.pdf", valor: 5300, campos: { objeto: "adesivos de piso, totens e sinalização do estande", prazo_entrega: "até 03/10/2026", local_entrega: "Shopping Exemplo, São Paulo/SP" }, clausulas: [], historico: [H("2026-09-30T10:00", "Helena Castro", "Contrato assinado anexado.")] },
];

const NOTIFICACOES = [
  { id: "n1", em: "2026-10-20T09:15", lida: false, contratoId: "c-j418", texto: "JOB-0418 aberto pelo financeiro", sub: "Contrato com Rota Verde Alimentos a elaborar" },
  { id: "n2", em: "2026-10-20T08:55", lida: false, contratoId: "c-pp531", texto: "PP-00531 gerada por Suprimentos", sub: "Contrato com LuzCine Locações a elaborar" },
  { id: "n3", em: "2026-10-20T08:40", lida: false, contratoId: "c-pp530", texto: "PP-00530 gerada por Suprimentos", sub: "Contrato com Talento Casting a elaborar" },
  { id: "n4", em: "2026-10-19T16:42", lida: true, contratoId: "c-j415", texto: "JOB-0415 aberto pelo financeiro", sub: "Contrato com Vento Sul Seguros a elaborar" },
];

/* Itens da planilha interna que não viraram PP (completam a grade). */
const ITENS_SEM_PP = {
  j412: [{ grupo: "Equipamentos", item: "Seguro de equipamentos", orcado: 6200, planejado: 5400 }, { grupo: "Cenografia", item: "Produção de objetos de cena", orcado: 8900, planejado: 7600 }],
  j409: [{ grupo: "Estrutura", item: "Gerador de energia", orcado: 9800, planejado: 8700 }],
  j415: [{ grupo: "Equipamentos", item: "Iluminação", orcado: 14800, planejado: 12900 }, { grupo: "Pós-produção", item: "Edição e finalização", orcado: 38000, planejado: 33500 }],
  j401: [],
  j418: [{ grupo: "Estrutura", item: "Estande 60 m²", orcado: 72000, planejado: 61000 }, { grupo: "Alimentação", item: "Coquetel", orcado: 18500, planejado: 15800 }],
};
