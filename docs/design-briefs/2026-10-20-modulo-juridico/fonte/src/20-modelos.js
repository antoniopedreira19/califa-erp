/* ---------- Modelos (minutas) e o motor de lacunas ---------- */

const TIPOS = {
  prestacao: { rotulo: "Prestação de serviço", desc: "Serviços contratados com entrega definida: cenografia, catering, pós-produção, elenco." },
  locacao: { rotulo: "Locação", desc: "Equipamentos, estruturas e veículos usados por um período." },
  compra: { rotulo: "Compra e venda", desc: "Materiais e itens adquiridos: gráfica, brindes, insumos." },
  influenciador: { rotulo: "Influenciador", desc: "Entregas por rede social, direitos de imagem e aprovação prévia de conteúdo." },
  aditivo: { rotulo: "Termo aditivo", desc: "Alteração de contrato já assinado: valor, prazo ou escopo.", soNaB: true },
};
const ORDEM_TIPOS = ["prestacao", "locacao", "compra", "influenciador", "aditivo"];

/* Campos que o sistema preenche sozinho. A chave é o que vai na minuta:
 * {{grupo.campo}}. Os grupos espelham de onde o dado vem. */
const CAMPOS_SISTEMA = [
  { grupo: "Agência", itens: [
    ["agencia.razao_social", "Razão social da agência", "Empresa do job"],
    ["agencia.cnpj", "CNPJ da agência", "Empresa do job"],
    ["agencia.endereco", "Endereço da agência", "Empresa do job"],
  ] },
  { grupo: "Contraparte", itens: [
    ["parte.razao_social", "Razão social do cliente ou fornecedor", "Cadastro"],
    ["parte.cnpj", "CNPJ do cliente ou fornecedor", "Cadastro"],
    ["parte.endereco", "Endereço do cliente ou fornecedor", "Cadastro"],
  ] },
  { grupo: "Job", itens: [
    ["job.codigo", "Código do job", "Job"],
    ["job.nome", "Nome do job", "Job"],
    ["job.projeto", "Projeto", "Job"],
    ["job.periodo", "Período do job", "Job"],
    ["job.cidade", "Cidade do job", "Job"],
    ["job.versao", "Versão aprovada do orçamento", "Orçamento"],
  ] },
  { grupo: "PP", itens: [
    ["pp.codigo", "Código da PP", "PP"],
    ["pp.servico", "Serviço descrito na PP", "PP"],
  ] },
  { grupo: "Valores e pagamento", itens: [
    ["valor.total", "Valor total", "PP ou orçamento aprovado"],
    ["valor.extenso", "Valor por extenso", "Calculado"],
    ["pagamento.condicao", "Condição de pagamento", "PP ou orçamento aprovado"],
  ] },
  { grupo: "Responsáveis e datas", itens: [
    ["responsavel.gp", "Gerente de projetos", "Job"],
    ["responsavel.produtor", "Produtor responsável", "Job"],
    ["data.hoje", "Data por extenso", "Calculado"],
    ["foro.cidade", "Cidade do foro", "Configuração do jurídico"],
  ] },
  { grupo: "Aditivo", soNaB: true, itens: [
    ["aditivo.contrato", "Contrato original", "Contrato assinado"],
    ["aditivo.data_original", "Data do contrato original", "Contrato assinado"],
    ["aditivo.valor_anterior", "Valor do contrato original", "Contrato assinado"],
  ] },
];
const ROTULO_CAMPO = Object.fromEntries(CAMPOS_SISTEMA.flatMap((g) => g.itens.map(([k, r, o]) => [k, { rotulo: r, origem: o }])));

const CLAUSULAS = {
  conf: { titulo: "DA CONFIDENCIALIDADE", texto: "As partes manterão sigilo sobre as informações a que tiverem acesso em razão deste contrato, inclusive sobre a campanha antes do seu lançamento, pelo prazo de 2 (dois) anos após o seu término.", resumo: "Sigilo sobre a campanha por 2 anos" },
  lgpd: { titulo: "DA PROTEÇÃO DE DADOS", texto: "As partes tratarão os dados pessoais eventualmente compartilhados em conformidade com a Lei nº 13.709/2018 (LGPD), exclusivamente para a execução deste contrato.", resumo: "Tratamento de dados conforme a LGPD" },
  multa: { titulo: "DA MULTA", texto: "O descumprimento dos prazos aqui previstos sujeitará a parte infratora à multa de 2% (dois por cento) sobre o valor total do contrato, acrescida de juros de 1% (um por cento) ao mês.", resumo: "Multa de 2% + juros de 1% a.m. por atraso" },
  seguro: { titulo: "DO SEGURO", texto: "A LOCADORA declara que os bens locados estão cobertos por seguro contra roubo, furto e danos, cuja apólice será apresentada à LOCATÁRIA antes da retirada.", resumo: "Bens cobertos por seguro da locadora" },
  imagem: { titulo: "DA CESSÃO DE DIREITOS", texto: "Fica cedido à CONTRATANTE, em caráter não exclusivo, o direito de uso do material produzido, inclusive imagem e voz, na campanha a que se refere este contrato, pelo prazo de 12 (doze) meses, em todo o território nacional.", resumo: "Uso de imagem e voz por 12 meses" },
  exclusividade: { titulo: "DA EXCLUSIVIDADE", texto: "Durante o período de veiculação e por 30 (trinta) dias após o seu término, a CONTRATADA não publicará conteúdo patrocinado por marcas concorrentes da anunciante.", resumo: "Sem concorrentes por 30 dias após a veiculação" },
};

const ABERTURA_FORN = (contratante, contratada) => `Pelo presente instrumento particular, de um lado {{agencia.razao_social}}, inscrita no CNPJ sob o nº {{agencia.cnpj}}, com sede em {{agencia.endereco}}, doravante denominada ${contratante}, e, de outro lado, {{parte.razao_social}}, inscrita no CNPJ sob o nº {{parte.cnpj}}, com sede em {{parte.endereco}}, doravante denominada ${contratada}, têm entre si justo e contratado o que segue.`;
const FECHO = `[clausulas_opcionais]

## DO FORO
Fica eleito o foro da comarca de {{foro.cidade}} para dirimir quaisquer dúvidas oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.

E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em duas vias de igual teor e forma.

{{foro.cidade}}, {{data.hoje}}.

[assinaturas]`;

const MODELOS = [
  {
    id: "m-forn-prest", nome: "Prestação de serviços — fornecedor", tipo: "prestacao", parte: "fornecedor", versao: 4, atualizadoEm: "2026-10-02", atualizadoPor: "Helena Castro", usos: 41, ativo: true,
    descricao: "Serviço com entrega definida, pessoa jurídica. Cobre cenografia, catering, pós-produção e elenco.",
    lacunas: [
      { chave: "objeto", rotulo: "Objeto da contratação", tipo: "longo", obrigatoria: true, dica: "O que será feito, com que alcance. Ex.: serviços de edição e finalização de filme publicitário." },
      { chave: "entregaveis", rotulo: "Entregáveis", tipo: "longo", obrigatoria: true, dica: "O que a contratada entrega, com quantidades e formatos." },
      { chave: "prazo_execucao", rotulo: "Prazo de execução", tipo: "curto", obrigatoria: true, dica: "Ex.: de 03/11/2026 a 14/11/2026." },
    ],
    clausulasOpcionais: ["conf", "imagem", "multa", "lgpd"],
    corpo: `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS

${ABERTURA_FORN("CONTRATANTE", "CONTRATADA")}

## DO OBJETO
O presente contrato tem por objeto {{lacuna.objeto}}, no âmbito do job {{job.codigo}} — {{job.nome}}, do projeto {{job.projeto}}, conforme o pedido de produção {{pp.codigo}}.

## DAS ENTREGAS E DO PRAZO
A CONTRATADA se obriga a entregar {{lacuna.entregaveis}}, no prazo de {{lacuna.prazo_execucao}}.

## DO PREÇO E DO PAGAMENTO
Pela execução do objeto, a CONTRATANTE pagará à CONTRATADA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}, mediante a apresentação da nota fiscal correspondente.

## DAS OBRIGAÇÕES DA CONTRATADA
A CONTRATADA executará os serviços com pessoal próprio e qualificado, responsabilizando-se integralmente pelos encargos trabalhistas, previdenciários, fiscais e comerciais decorrentes deste contrato, sem qualquer vínculo empregatício com a CONTRATANTE.

## DO ACOMPANHAMENTO
A CONTRATANTE indica {{responsavel.produtor}} como responsável pelo acompanhamento da execução, a quem a CONTRATADA reportará o andamento dos serviços.

## DA RESCISÃO
O descumprimento de qualquer cláusula deste contrato autoriza a parte prejudicada a rescindi-lo mediante notificação por escrito, sem prejuízo das perdas e danos apuradas.

${FECHO}`,
  },
  {
    id: "m-forn-loc", nome: "Locação de equipamentos e estruturas", tipo: "locacao", parte: "fornecedor", versao: 3, atualizadoEm: "2026-09-18", atualizadoPor: "Marcos Vianna", usos: 27, ativo: true,
    descricao: "Câmera, luz, som, palco e geradores, por diária ou período.",
    lacunas: [
      { chave: "objeto", rotulo: "Bens locados", tipo: "longo", obrigatoria: true, dica: "Liste os equipamentos com marca, modelo e quantidade." },
      { chave: "periodo_locacao", rotulo: "Período da locação", tipo: "curto", obrigatoria: true, dica: "Ex.: 3 diárias, de 04/11/2026 a 06/11/2026." },
      { chave: "local_entrega", rotulo: "Local de entrega e retirada", tipo: "curto", obrigatoria: true, dica: "Endereço do set ou do evento." },
      { chave: "valor_reposicao", rotulo: "Valor de reposição declarado", tipo: "curto", obrigatoria: true, dica: "Teto da indenização em caso de perda ou dano. Ex.: R$ 250.000,00." },
    ],
    clausulasOpcionais: ["seguro", "multa", "conf"],
    corpo: `# CONTRATO DE LOCAÇÃO DE EQUIPAMENTOS

${ABERTURA_FORN("LOCATÁRIA", "LOCADORA")}

## DO OBJETO
A LOCADORA dá em locação à LOCATÁRIA os seguintes bens: {{lacuna.objeto}}, para uso exclusivo no job {{job.codigo}} — {{job.nome}}, conforme o pedido de produção {{pp.codigo}}.

## DO PRAZO E DA ENTREGA
A locação vigorará por {{lacuna.periodo_locacao}}. Os bens serão entregues e retirados em {{lacuna.local_entrega}}, em perfeito estado de funcionamento.

## DO PREÇO E DO PAGAMENTO
Pela locação, a LOCATÁRIA pagará à LOCADORA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}, mediante a apresentação da nota fiscal correspondente.

## DA CONSERVAÇÃO E DA REPOSIÇÃO
A LOCATÁRIA zelará pela guarda e conservação dos bens durante a locação. Em caso de perda, furto ou dano por mau uso, a indenização terá como teto o valor de reposição declarado de {{lacuna.valor_reposicao}}.

## DO ACOMPANHAMENTO
O acompanhamento da locação pela LOCATÁRIA ficará a cargo de {{responsavel.produtor}}.

${FECHO}`,
  },
  {
    id: "m-forn-veic", nome: "Locação de veículo com motorista", tipo: "locacao", parte: "fornecedor", versao: 1, atualizadoEm: "2026-08-04", atualizadoPor: "Helena Castro", usos: 6, ativo: true,
    descricao: "Vans, carros e caminhões com motorista e combustível incluídos.",
    lacunas: [
      { chave: "objeto", rotulo: "Veículos e quantidade", tipo: "longo", obrigatoria: true, dica: "Ex.: 1 van executiva de 15 lugares." },
      { chave: "roteiro", rotulo: "Roteiro", tipo: "curto", obrigatoria: true, dica: "Pontos de saída e chegada." },
      { chave: "periodo_locacao", rotulo: "Período", tipo: "curto", obrigatoria: true, dica: "Ex.: 3 diárias de 10 horas." },
    ],
    clausulasOpcionais: ["multa"],
    corpo: `# CONTRATO DE LOCAÇÃO DE VEÍCULO COM MOTORISTA

${ABERTURA_FORN("LOCATÁRIA", "LOCADORA")}

## DO OBJETO
A LOCADORA dá em locação à LOCATÁRIA, com motorista habilitado e combustível incluídos, {{lacuna.objeto}}, para o job {{job.codigo}} — {{job.nome}}, conforme o pedido de produção {{pp.codigo}}.

## DO ROTEIRO E DO PERÍODO
O serviço cobrirá o roteiro {{lacuna.roteiro}}, pelo período de {{lacuna.periodo_locacao}}.

## DO PREÇO E DO PAGAMENTO
A LOCATÁRIA pagará à LOCADORA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}.

## DA RESPONSABILIDADE
A LOCADORA responde pela manutenção e pelo seguro dos veículos e pelas infrações de trânsito cometidas durante o serviço.

${FECHO}`,
  },
  {
    id: "m-forn-compra", nome: "Compra e venda de materiais", tipo: "compra", parte: "fornecedor", versao: 2, atualizadoEm: "2026-07-22", atualizadoPor: "Marcos Vianna", usos: 9, ativo: true,
    descricao: "Materiais gráficos, brindes e insumos com entrega única.",
    lacunas: [
      { chave: "objeto", rotulo: "Itens e quantidades", tipo: "longo", obrigatoria: true, dica: "Descreva cada item com especificação e quantidade." },
      { chave: "prazo_entrega", rotulo: "Prazo de entrega", tipo: "curto", obrigatoria: true, dica: "Ex.: até 28/10/2026." },
      { chave: "local_entrega", rotulo: "Local de entrega", tipo: "curto", obrigatoria: true, dica: "Endereço completo." },
    ],
    clausulasOpcionais: ["multa"],
    corpo: `# CONTRATO DE COMPRA E VENDA

${ABERTURA_FORN("COMPRADORA", "VENDEDORA")}

## DO OBJETO
A VENDEDORA vende à COMPRADORA {{lacuna.objeto}}, destinados ao job {{job.codigo}} — {{job.nome}}, conforme o pedido de produção {{pp.codigo}}.

## DA ENTREGA
Os itens serão entregues {{lacuna.prazo_entrega}}, em {{lacuna.local_entrega}}, livres de custos de frete para a COMPRADORA.

## DO PREÇO E DO PAGAMENTO
A COMPRADORA pagará à VENDEDORA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}.

## DA GARANTIA
A VENDEDORA garante a qualidade dos itens e substituirá, sem custo, os entregues com defeito ou em desacordo com o pedido, em até 5 (cinco) dias úteis da reclamação.

${FECHO}`,
  },
  {
    id: "m-cli-prod", nome: "Prestação de serviços de produção — cliente", tipo: "prestacao", parte: "cliente", versao: 2, atualizadoEm: "2026-09-30", atualizadoPor: "Helena Castro", usos: 22, ativo: true,
    descricao: "Contrato com o cliente a cada job aberto. Agência como contratada.",
    lacunas: [
      { chave: "objeto", rotulo: "Escopo do job", tipo: "longo", obrigatoria: true, dica: "O que a agência produz para o cliente neste job." },
      { chave: "entregaveis", rotulo: "Entregáveis", tipo: "longo", obrigatoria: true, dica: "Filmes, eventos, peças: com quantidade e formato." },
    ],
    clausulasOpcionais: ["conf", "imagem", "lgpd", "multa"],
    corpo: `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE PRODUÇÃO

Pelo presente instrumento particular, de um lado {{parte.razao_social}}, inscrita no CNPJ sob o nº {{parte.cnpj}}, com sede em {{parte.endereco}}, doravante denominada CONTRATANTE, e, de outro lado, {{agencia.razao_social}}, inscrita no CNPJ sob o nº {{agencia.cnpj}}, com sede em {{agencia.endereco}}, doravante denominada CONTRATADA, têm entre si justo e contratado o que segue.

## DO OBJETO
O presente contrato tem por objeto a prestação, pela CONTRATADA, de serviços de {{lacuna.objeto}}, referentes ao job {{job.codigo}} — {{job.nome}}, do projeto {{job.projeto}}, conforme a versão aprovada do orçamento {{job.versao}}.

## DAS ENTREGAS E DO CRONOGRAMA
A CONTRATADA entregará {{lacuna.entregaveis}}, no período de {{job.periodo}}, em {{job.cidade}}.

## DO PREÇO E DO PAGAMENTO
Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}.

## DA APROVAÇÃO DAS ENTREGAS
As entregas serão consideradas aprovadas se a CONTRATANTE não apresentar objeção fundamentada em até 5 (cinco) dias úteis do recebimento.

## DA COORDENAÇÃO
A CONTRATADA indica {{responsavel.gp}} como gerente do projeto e ponto focal junto à CONTRATANTE.

${FECHO}`,
  },
  {
    // Versão B: o tipo mais complexo, para a 2ª etapa, já como rascunho.
    id: "m-forn-infl", nome: "Contratação de influenciador", tipo: "influenciador", parte: "fornecedor", versao: 1, atualizadoEm: "2026-10-19", atualizadoPor: "Helena Castro", usos: 0, ativo: true, soNaB: true, rascunho: true,
    descricao: "Entregas por rede, aprovação prévia e uso de imagem. Rascunho para validar com o jurídico.",
    lacunas: [
      { chave: "objeto", rotulo: "Perfis e redes", tipo: "curto", obrigatoria: true, dica: "Ex.: perfil no Instagram e no TikTok." },
      { chave: "entregas", rotulo: "Entregas", tipo: "longo", obrigatoria: true, dica: "Formatos e quantidades: stories, reels, posts." },
      { chave: "periodo_veiculacao", rotulo: "Período de veiculação", tipo: "curto", obrigatoria: true, dica: "Ex.: de 29/10/2026 a 01/11/2026." },
      { chave: "aprovacao", rotulo: "Aprovação prévia do conteúdo", tipo: "curto", obrigatoria: true, dica: "Ex.: roteiro aprovado pela agência com 48 horas de antecedência." },
      { chave: "prazo_imagem", rotulo: "Prazo de uso de imagem", tipo: "curto", obrigatoria: true, dica: "Ex.: 6 meses após a última publicação." },
    ],
    clausulasOpcionais: ["exclusividade", "conf", "multa"],
    corpo: `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE INFLUENCIADOR

${ABERTURA_FORN("CONTRATANTE", "CONTRATADA")}

## DO OBJETO
A CONTRATADA produzirá e publicará conteúdo nos seus perfis {{lacuna.objeto}}, para o job {{job.codigo}} — {{job.nome}}, conforme o pedido de produção {{pp.codigo}}.

## DAS ENTREGAS E DA VEICULAÇÃO
A CONTRATADA entregará {{lacuna.entregas}}, publicadas no período de {{lacuna.periodo_veiculacao}}.

## DA APROVAÇÃO PRÉVIA
Nenhum conteúdo será publicado sem aprovação da CONTRATANTE, segundo o fluxo: {{lacuna.aprovacao}}.

## DO USO DE IMAGEM
A CONTRATANTE poderá usar o conteúdo e a imagem da CONTRATADA na campanha por {{lacuna.prazo_imagem}}.

## DO PREÇO E DO PAGAMENTO
A CONTRATANTE pagará à CONTRATADA o valor total de {{valor.total}} ({{valor.extenso}}), da seguinte forma: {{pagamento.condicao}}.

${FECHO}`,
  },
];

MODELOS.push({
  id: "m-aditivo", nome: "Termo aditivo de valor", tipo: "aditivo", parte: "fornecedor", versao: 1, atualizadoEm: "2026-10-19", atualizadoPor: "Helena Castro", usos: 3, ativo: true, soNaB: true,
  descricao: "Quando a PP é reemitida com valor acima do contrato assinado.",
  lacunas: [{ chave: "objeto", rotulo: "Alteração acordada", tipo: "longo", obrigatoria: true, dica: "O que mudou em relação ao contrato. Ex.: inclusão de 1 diária de montagem." }],
  clausulasOpcionais: [],
  corpo: `# TERMO ADITIVO AO CONTRATO {{aditivo.contrato}}

Pelo presente termo, {{agencia.razao_social}}, inscrita no CNPJ sob o nº {{agencia.cnpj}}, e {{parte.razao_social}}, inscrita no CNPJ sob o nº {{parte.cnpj}}, partes do contrato {{aditivo.contrato}}, firmado em {{aditivo.data_original}}, resolvem aditá-lo nos termos abaixo.

## DA ALTERAÇÃO
Fica alterado o contrato para {{lacuna.objeto}}, em razão da reemissão do pedido de produção {{pp.codigo}}.

## DO NOVO VALOR
O valor total do contrato passa de {{aditivo.valor_anterior}} para {{valor.total}} ({{valor.extenso}}), mantida a condição de pagamento: {{pagamento.condicao}}.

## DA RATIFICAÇÃO
Permanecem inalteradas e em pleno vigor as demais cláusulas do contrato original, que este termo integra.

{{foro.cidade}}, {{data.hoje}}.

[assinaturas]`,
});

/* Lê a minuta e devolve nós prontos para o papel:
 *   { t: "titulo" | "clausula" | "par" | "assinaturas", segs?: [...] }
 * Segmento: { t: "txt", v } | { t: "sys", k, v } | { t: "lac", k, v }
 * A numeração das cláusulas é automática, para as opcionais entrarem no
 * meio sem quebrar a sequência. */
const RE_CAMPO = /\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/g;

function segmentar(texto, ctx, campos) {
  const segs = [];
  let ult = 0;
  texto.replace(RE_CAMPO, (m, g, k, pos) => {
    if (pos > ult) segs.push({ t: "txt", v: texto.slice(ult, pos) });
    if (g === "lacuna") segs.push({ t: "lac", k, v: (campos && campos[k]) || "" });
    else segs.push({ t: "sys", k: `${g}.${k}`, v: ctx ? ctx[`${g}.${k}`] : undefined });
    ult = pos + m.length;
    return m;
  });
  if (ult < texto.length) segs.push({ t: "txt", v: texto.slice(ult) });
  return segs;
}

function montarDocumento(corpo, ctx, campos, clausulasMarcadas = []) {
  const nos = [];
  let n = 0, par = [];
  const fechaPar = () => { if (par.length) { nos.push({ t: "par", segs: segmentar(par.join(" "), ctx, campos) }); par = []; } };
  for (const linhaCrua of corpo.split("\n")) {
    const linha = linhaCrua.trim();
    if (!linha) { fechaPar(); continue; }
    if (linha.startsWith("# ")) { fechaPar(); nos.push({ t: "titulo", segs: segmentar(linha.slice(2), ctx, campos) }); continue; }
    if (linha.startsWith("## ")) { fechaPar(); n++; nos.push({ t: "clausula", n, segs: segmentar(linha.slice(3), ctx, campos) }); continue; }
    if (linha === "[clausulas_opcionais]") {
      fechaPar();
      for (const id of clausulasMarcadas) {
        const c = CLAUSULAS[id];
        if (!c) continue;
        n++;
        nos.push({ t: "clausula", n, opcional: true, segs: [{ t: "txt", v: c.titulo }] });
        nos.push({ t: "par", opcional: true, segs: segmentar(c.texto, ctx, campos) });
      }
      continue;
    }
    if (linha === "[assinaturas]") { fechaPar(); nos.push({ t: "assinaturas" }); continue; }
    par.push(linha);
  }
  fechaPar();
  return nos;
}

function chavesDeLacunas(corpo) {
  const vistas = [];
  corpo.replace(RE_CAMPO, (m, g, k) => { if (g === "lacuna" && !vistas.includes(k)) vistas.push(k); return m; });
  return vistas;
}
function chavesDeSistema(corpo) {
  const vistas = [];
  corpo.replace(RE_CAMPO, (m, g, k) => { const c = `${g}.${k}`; if (g !== "lacuna" && !vistas.includes(c)) vistas.push(c); return m; });
  return vistas;
}

/* Lacunas do modelo na ordem em que aparecem no texto, com o metadado
 * declarado (ou um padrão, para a lacuna recém-digitada no editor). */
function lacunasDoModelo(modelo) {
  return chavesDeLacunas(modelo.corpo).map((k) => modelo.lacunas.find((l) => l.chave === k) || { chave: k, rotulo: k.replace(/_/g, " "), tipo: "curto", obrigatoria: true, dica: "" });
}

const ORDINAL = (n) => `${n}ª`;
