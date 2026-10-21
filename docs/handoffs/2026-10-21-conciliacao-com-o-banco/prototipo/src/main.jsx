import * as React from "react";
import { createRoot } from "react-dom/client";
import { Receipt } from "lucide-react";
import { CARTOES, DIA_OFX, FATURAS_INICIAIS, HOJE, LANCAMENTOS_INICIAIS, LOTES, ofxDeExemplo, ofxDoDia, REGRAS, SALDO_INICIAL_OUTUBRO, SOMA_DO_DIA, TITULOS_INICIAIS } from "./data";
import { casar, diasEntre, digitais, formaDoHistorico, lerOfx, normalizar, somaDias } from "./ofx";
import { cn, dataBR, FiltrosConta, moeda, PageHeader, Sidebar, Tabs, Toast, Voltar } from "./ui";
import { aberto, correcaoDaBaixa, descricaoDoLancamento, faturaDestino, lancamentoDaBaixa, r2, registrarFaturas, rotuloCompetencia } from "./logica";
import { AbaExtrato, AbaTitulosAtual, AbaTitulosNova } from "./titulos";
import { AbaBancoPedida, AbaBancoRecomendada, ArquivoRecusado, BannerDoFechamento, contaDoArquivo, CorrigirBaixaDialog, ProcurarTitulo, ReabrirDialog } from "./banco";
import { ContasAPagar, ContasAReceber, ImpostosAPagar } from "./modulos";
import { VisualizadorDeDocumentos, documentosDe } from "./documentos";
import { VARIANTES_DETALHES } from "./detalhes";
import { comoRecomendada, FORMAS_REGIONAL } from "./logica";
import { DetalhesContexto } from "./titulos";
import {
  AcaoDialog,
  AntesDaNfDialog,
  BaixaDialog,
  ImpostoAvulsoDialog,
  PagamentoAvulsoDialog,
  RecebimentoAvulsoDialog,
  RecorrenciaDialog,
  RemessaDialog,
} from "./dialogos";

// O saldo que o banco informa no arquivo de exemplo: o do sistema em 1/10,
// mais tudo o que já estava conciliado, mais os 55 movimentos do dia.
const SALDO_DO_EXEMPLO = (() => {
  const movs = lerOfx(ofxDeExemplo("091923").replace("__SALDO__", "0")).movimentos;
  const v = SALDO_INICIAL_OUTUBRO + LANCAMENTOS_INICIAIS.filter((l) => l.conciliado).reduce((s, l) => s + l.valor, 0) + movs.reduce((s, m) => s + m.valor, 0);
  return r2(v).toFixed(2).replace(".", ",");
})();
const exemplo = (h) => ofxDeExemplo(h).replace("__SALDO__", SALDO_DO_EXEMPLO);

const TELAS = [
  ["titulos", "Conciliação · Títulos"],
  ["extrato", "Conciliação · Extrato"],
  ["banco", "Conciliação · Conciliação automática"],
  ["cp", "Contas a Pagar"],
  ["cartao", "Contas a Pagar · Cartão"],
  ["cr", "Contas a Receber"],
  ["imp", "Impostos a Pagar"],
];
const VERSOES = [
  ["atual", "Atual"],
  ["pedida", "Pedida"],
  ["recomendada", "Recomendada"],
  ["alternativa", "Alternativa"],
];
const COMPARAR = [
  [null, "Uma por vez"],
  [["atual", "pedida"], "Atual × Pedida"],
  [["atual", "recomendada"], "Atual × Recomendada"],
  [["pedida", "recomendada"], "Pedida × Recomendada"],
  [["recomendada", "alternativa"], "Recomendada × Alternativa"],
];

const NOTAS = {
  titulos: {
    atual: ["Como está no ar: Vencimento · Tipo · Título · Contraparte · Empresa · Job · Valor.", "A PP aparece pelo bruto: a retenção só aparece dentro do diálogo da baixa.", "Não cria lançamento nenhum, e a transferência “A transferir” fica fora."],
    pedida: [
      "As colunas são as do Extrato: Data · Crédito · Débito · Saldo · Descrição · Fornecedor · Job · Centro de Custo · Trimestre · Empresa. Cada linha é o lançamento como a baixa vai gravá-lo.",
      "Crédito e Débito pelo líquido, o que de fato entra ou sai da conta. A retenção da PP aparece embaixo do valor.",
      "Saldo previsto: o saldo da conta aberta, linha a linha, se cada título for baixado nela na data prevista. O vencido entra como hoje.",
      "“Novo lançamento” traz o que hoje está espalhado: pagamento avulso, recorrência, imposto avulso, recebimento avulso, recebimento antes da NF, rendimento e transferência entre contas. A remessa Santander também.",
      "Termos padronizados: “Vencimento” (do documento, nunca muda) e “Data prevista” de pagamento ou de recebimento (do financeiro, pelo lápis na coluna). Embaixo da data prevista, “venc. dd/mm” quando são diferentes, em vermelho quando a prevista passa do vencimento. O ⓘ de cada linha mostra só o que a linha não mostra: a trilha da origem, para onde vai o dinheiro, a retenção, o rateio de regional e os documentos. Compare os três desenhos em “Detalhes ⓘ”, na barra. Documento abre um, dois ou três lado a lado, como na tela de aprovar PPs; sem documento, não há o que abrir.",
      "A baixa mostra a prévia: as linhas novas no meio do extrato da conta, com o saldo recalculado.",
    ],
    recomendada: [
      "Tudo da pedida, mais:",
      "Agrupado por dia, na faixa do agrupamento das planilhas: quanto sai, quanto entra e o saldo no fim do dia. Aviso quando o saldo previsto fica negativo.",
      "Depois de importar o OFX (aba Conciliação automática), o título que já está no extrato do banco ganha o sinal escolhido em “Sinal do banco”, na barra (faixa verde à esquerda e ícone do banco ao lado da data, que explica no clique), e o botão vira “Conciliar”: a baixa usa a data do banco. A linha não muda de altura.",
      "“Ver no Extrato antes”: os títulos marcados aparecem no Extrato como linhas previstas, em lilás, sem gravar nada.",
    ],
    alternativa: [
      "A aba Títulos da recomendada, como você escolheu: agrupada por dia, saldo previsto com aviso de negativo, selo do extrato do banco e “Ver no Extrato antes”.",
      "A baixa é a do sistema (o bloco de valores com baixa parcial e impostos retidos editáveis, o “Repetir as alíquotas” e o “No fiscal”), com só três acréscimos: juros e multa no boleto (a caixa só aparece com a forma Boleto; na guia de imposto o campo já existe), a fatura na baixa no cartão e os avisos da conciliação e do fechamento. A prévia do Extrato fica só na recomendada.",
      "Aberta pela conciliação, quando a diferença do banco bate com retenção (a NF 1190: R$ 20.000,00 na nota, R$ 18.770,00 no banco), a baixa já vem com os impostos retidos destrinchados.",
    ],
  },
  extrato: {
    atual: ["O Extrato de hoje. As baixas feitas no protótipo entram aqui."],
    pedida: ["Igual ao de hoje, com o botão “Importar extrato do banco (OFX)”, que abre a aba Conciliação automática."],
    recomendada: ["Coluna Banco: ✓ quando a linha foi conciliada com o extrato do banco, ○ quando ainda não apareceu nele.", "Os títulos marcados na aba Títulos aparecem como previstos, para ver o saldo antes de baixar."],
    alternativa: [
      "O Extrato da recomendada: coluna Banco (✓ conciliado, ○ aguardando) e os títulos marcados como previstos.",
      "Depois de importar o extrato do banco: a baixa feita à mão que diverge (valor diferente, ou que não está no banco) fica com ⚠ vermelho na coluna Banco, e a faixa no topo leva à Conciliação automática.",
      "Fechamento: escolha na barra entre “Trava até reabrir” e “Só registra”, e use “Simular fechado até 19/10” para ver a faixa, o cadeado nas linhas, o bloqueio da baixa com data até lá e o reabrir com motivo.",
    ],
  },
  banco: {
    atual: ["Não existe. Hoje a conferência com o banco é feita a olho, linha por linha, entre o internet banking e o Extrato."],
    pedida: [
      "Lê o OFX aqui na tela. Dá para testar com os seus dois arquivos: o protótipo leva as datas dos títulos fictícios para a data do arquivo.",
      "Cada linha do banco ganha uma situação: título encontrado (valor exato + data), já lançado, ou sem correspondência.",
      "“Dar baixa” abre a baixa de hoje já preenchida com a data, a conta e o valor do banco. “Dar baixa nos N encontrados” faz todos de uma vez.",
      "Sem correspondência: “Lançar avulso” abre o pagamento ou o recebimento avulso com a data, o valor e o histórico da linha.",
      "O 2º arquivo que você mandou é o mesmo dia, baixado 12 segundos depois, com outro FITID: o sistema reconhece e não importa nada de novo.",
      "Repare no PIX de R$ 40.000,00 que voltou: aqui o débito vira “título encontrado” e a devolução fica sem par. É o caso que a recomendada resolve.",
    ],
    recomendada: [
      "Banco × sistema, por grau de certeza, cada seção com a sua ação em massa.",
      "Saldo informado pelo banco × saldo do sistema e a diferença, que zera quando tudo estiver conciliado. Aí “Fechar a conciliação até 19/10” trava o período.",
      "Remessa: uma linha do banco = os 18 títulos da folha, pela soma.",
      "PIX que saiu e voltou no mesmo dia: entra no extrato como as duas linhas, e a PP continua a pagar.",
      "Regras de histórico: “TAR …” vira tarifa bancária sozinho. No avulso, “Lembrar como regra” cria a próxima.",
      "Boleto pago com juros: a diferença vira juros e multa (11 · Despesa com Juros) na mesma baixa.",
      "Mesmo valor no mesmo dia (4 PIX de R$ 5.000,00): o banco não diz qual fornecedor recebeu cada um, então vai para “Conferir antes”.",
    ],
    alternativa: ["As seções da recomendada (prontos, conferir antes, remessa, saiu e voltou, regras, sem correspondência, conciliados), cada uma com a sua ação em massa, e o saldo do banco × sistema com a diferença.", "Dentro de cada seção, a tabela da pedida: Data · Histórico do banco · Crédito · Débito · Situação · No sistema · Ação. Todas as seções usam as mesmas larguras, então as colunas se alinham de uma para a outra.", "Embaixo do título sugerido, em cinza, o motivo da sugestão.",
      "Na importação, a baixa feita à mão que bate com o banco (mesmo valor, até 3 dias) se concilia sozinha, com a data do banco: aparece na seção própria, “Baixas feitas à mão que bateram com o banco”, aberta e com Desfazer. Só o que diverge pede alguém: a seção “A baixa feita à mão não bate com o banco” (corrigir para o valor do banco) e “Baixa no sistema, sem linha no banco” (cancelar ou corrigir).",
      "Para o título que ainda não teve baixa, a ação é “Baixar e conciliar”: o banco mostra que o dinheiro saiu, mas qual título ele pagou é uma decisão (há 4 PPs de R$ 5.000,00).",
      "“Na importação”, na barra: “Baixa sozinho o que é certo” resolve na hora o título com valor exato e um título só com esse valor (pago na data e pela forma previstas, ou com o CNPJ do cliente no histórico), a remessa que soma centavo a centavo e a tarifa pela regra; “Só sugere” deixa tudo para um clique. Cada linha é avaliada uma vez; o que alguém desfez não volta sozinho.",
      "O fechamento vai até o último dia completo: o dia em que o arquivo foi gerado não conta. “Importar o extrato de hoje (11:40)” mostra o dia em andamento.",
      "Linhas iguais (mesmo dia, mesmo valor): com tantos títulos quanto linhas, cada linha paga um e elas se baixam sozinhas (R$ 1.000,00, R$ 2.000,00 e R$ 5.000,00). Com mais títulos que linhas, ficam agrupadas em “Conferir antes”, com “Trocar” em cada linha: os R$ 3.000,00 têm 4 títulos para 3 linhas.",
      "Uma linha, vários títulos da mesma contraparte: R$ 2.080,00 são duas PPs da Atelier Recorte num PIX; R$ 11.800,00, duas notas da Cervejaria numa TED. Com uma soma só possível, vão para Prontos; com mais de uma, pedem escolha.",
      "A lupa lista os títulos pela proximidade do valor, com a diferença ao lado. O valor vem do banco: título maior vira retenção na fonte (se bate com as alíquotas de sempre) ou baixa parcial; menor, juros de boleto ou de guia; vários, só quando a soma bate. A baixa só concilia quando o total bate com a linha.",
    ],
  },
  cp: {
    atual: ["Títulos a Pagar como está no ar. O título pago no cartão some daqui: só aparece na fatura."],
    pedida: [
      "As mesmas colunas da planilha da conciliação, sem saldo: aqui a conta só se escolhe na baixa.",
      "Como você pediu: Crédito fino, só com —, e o estorno de verba no Débito com sinal de menos (despesa negativa, decisão 081). Filtre por “Estornos de verba” para ver os dois casos.",
      "A baixa agora tem Cartão de Crédito (PP, avulso, recorrência e desembolso, um por vez), com o campo Fatura: vem pela data do pagamento e pode ser trocado, quando o banco lançou a compra em outra. A prévia mostra a linha na fatura, não no banco.",
      "A PP aprovada com cartão só vem com ele escolhido na baixa. Não vira previsão em fatura nenhuma, nem tira do saldo do banco.",
      "A baixa em lote também aceita o cartão: escolhido, todos os títulos entram na mesma fatura, cada um como um item; com outra forma, todos seguem a forma escolhida. Folha não vai para o cartão.",
    ],
    recomendada: [
      "A coluna é a do banco, como o Extrato vai mostrar: o estorno de verba entra no Crédito (+), e o DRE fica no centro de custo (02, abatendo o custo da PP). O resumo “Em aberto” continua líquido.",
      "Crédito na largura normal, com — onde não há valor.",
      "O pago no cartão fica na lista como “No cartão”, com a fatura em que entrou.",
      "A fatura de cartão abre nos itens (“N itens”), nas mesmas colunas: o centro mostra “Itens da fatura”, e o pagamento fica fora do DRE.",
    ],
    alternativa: ["Igual à recomendada, com a baixa do sistema: sem a prévia do Extrato, com juros e multa no boleto (a caixa só aparece com a forma Boleto; na guia de imposto o campo já existe), a fatura do cartão e os avisos da conciliação e do fechamento."],
  },
  cartao: {
    atual: ["A aba Cartão como está no ar: a capa com um card por cartão e, dentro, o extrato da fatura (Data · Crédito · Débito · Acumulado · Descrição · Fornecedor · Job · Centro de Custo · Trimestre · Empresa · ⓘ · Ação), com largura automática.", "O pagamento da fatura não aparece no extrato do cartão."],
    pedida: ["A capa e o cabeçalho da fatura ficam como no sistema. Muda a tabela: a planilha da conciliação, com as larguras fixas da aba Títulos, o centro de custo só pelo tipo e a Regional. O tipo do item (PP, avulso, estorno, ajuste) fica na etiqueta embaixo da descrição.", "Fechar a fatura: valor cobrado pelo banco, e a diferença vira item de ajuste com centro de custo. Fechada, ela vira um título em Títulos a Pagar."],
    recomendada: [
      "Tudo da pedida. Fatura paga: a última linha é o pagamento, como num extrato de cartão, e o acumulado volta a zero.",
      "A forma escolhida na aprovação da PP não põe nada na fatura: intenção não é ocorrência. Só a baixa no cartão cria o item.",
    ],
    alternativa: ["Igual à recomendada, com a baixa do sistema: sem a prévia do Extrato, com juros e multa no boleto (a caixa só aparece com a forma Boleto; na guia de imposto o campo já existe), a fatura do cartão e os avisos da conciliação e do fechamento."],
  },
  cr: {
    atual: ["Títulos a Receber como está no ar."],
    pedida: [
      "As mesmas colunas da planilha. O lápis da previsão fica na data; o ⓘ da linha abre os detalhes, com a NF emitida para visualizar e as informações de cobrança.",
      "Como você pediu: Débito na largura normal, com — onde não há valor, e o BV (NF 1195) como débito negativo. A transferência fica no Débito, em cinza e fora do total.",
    ],
    recomendada: [
      "A coluna é a do banco: o BV entra no Crédito (+), como o Extrato vai mostrar; que ele é custo negativo da mídia do job, quem diz é o centro de custo (decisão 184, pendente).",
      "A transferência aparece nas duas colunas, em cinza: sai de uma conta, entra na outra. Fica fora dos totais.",
    ],
    alternativa: ["Igual à recomendada, com a baixa do sistema: sem a prévia do Extrato, com juros e multa no boleto (a caixa só aparece com a forma Boleto; na guia de imposto o campo já existe), a fatura do cartão e os avisos da conciliação e do fechamento."],
  },
  imp: {
    atual: ["Impostos a Pagar como está no ar."],
    pedida: ["As mesmas colunas da planilha. O ⓘ da linha abre os detalhes, com a guia para visualizar e cancelar. O valor não se corrige aqui: só na Apuração, onde a guia é aprovada; na baixa entram só multa e juros.", "Crédito fino, só com —: imposto só sai da conta."],
    recomendada: ["Igual à pedida. Sem saldo previsto: a conta só se escolhe na baixa."],
    alternativa: ["Igual à recomendada, com a baixa do sistema: sem a prévia do Extrato, com juros e multa no boleto (a caixa só aparece com a forma Boleto; na guia de imposto o campo já existe), a fatura do cartão e os avisos da conciliação e do fechamento."],
  },
};

// ===========================================================================

function App() {
  const [titulos, setTitulos] = React.useState(TITULOS_INICIAIS);
  const [faturas, setFaturas] = React.useState(FATURAS_INICIAIS);
  registrarFaturas(faturas);
  const [lancamentos, setLancamentos] = React.useState(LANCAMENTOS_INICIAIS);
  const [regras, setRegras] = React.useState(REGRAS);
  const [tela, setTela] = React.useState("titulos");
  const [versao, setVersao] = React.useState("alternativa");
  const [comparar, setComparar] = React.useState(null);
  const [notas, setNotas] = React.useState(true);
  const [toast, setToast] = React.useState(null);
  const [dialogo, setDialogo] = React.useState(null);
  const [acao, setAcao] = React.useState(null);
  const [procurando, setProcurando] = React.useState(null);
  const [banco, setBanco] = React.useState({ movimentos: [], importacoes: [], resolucoes: {}, contaId: "cs" });
  // O fechamento da conciliação da California Santander: até quando, se
  // está valendo, e o histórico de fechar e reabrir. A regra (trava ou só
  // registra) se escolhe na barra, para o Tiago decidir.
  const [fechamento, setFechamento] = React.useState(null);
  const [modoFechamento, setModoFechamento] = React.useState("trava");
  const [reabrindo, setReabrindo] = React.useState(false);
  const [corrigindo, setCorrigindo] = React.useState(null);
  // Na importação: "auto" baixa e concilia sozinho o que é certo; "sugere"
  // só sugere, e cada linha pede um clique (para comparar).
  const [modoImportacao, setModoImportacao] = React.useState("auto");
  const fechadoAte = fechamento?.ativo ? fechamento.ate : null;
  const [previa, setPrevia] = React.useState([]);
  const [docsDe, setDocsDe] = React.useState(null);
  const [variante, setVariante] = React.useState("a");
  // O protótipo abre na configuração escolhida (20/10/2026): Alternativa,
  // TRI + REG abreviada, ⓘ A, faixa + ícone, baixa sozinho o que é certo e
  // fechamento com trava.
  const [formaRegional, setFormaRegional] = React.useState(4);
  const [sinalBanco, setSinalBanco] = React.useState("faixa");

  const saldoHoje = r2(SALDO_INICIAL_OUTUBRO + lancamentos.filter((l) => l.data <= HOJE).reduce((s, l) => s + l.valor, 0));
  const ultimaImp = banco.importacoes[banco.importacoes.length - 1] ?? null;
  const deslocamento = ultimaImp?.deslocamento ?? 0;

  // ---- O motor: só as linhas do banco ainda sem solução ----
  const resultadosDe = (rec) => {
    if (!banco.movimentos.length) return [];
    const pend = banco.movimentos.filter((m) => !banco.resolucoes[m.digital]);
    const lotes = LOTES.filter((l) => l.titulos.every((t) => !titulos.find((x) => x.id === t.id)?.pagoEm));
    const res = casar(
      pend.map((m) => m.mov),
      {
        titulos: titulos.filter((t) => !t.pagoEm),
        // "Já lançado" procura no extrato da conta escolhida (no protótipo, só a Santander tem).
        lancamentos: banco.contaId === "cs" ? lancamentos.filter((l) => !l.conciliado) : [],
        lotes,
        regras,
        deslocamento,
      },
      { recomendada: rec },
    );
    const porMov = new Map(res.map((r) => [r.mov, r]));
    return banco.movimentos.map((m) => {
      const resol = banco.resolucoes[m.digital];
      if (resol) return { mov: m.mov, digital: m.digital, resolvido: resol };
      const r = porMov.get(m.mov);
      return { ...r, digital: m.digital, par: r.par ? { ...r.par } : undefined };
    });
  };
  const resPedida = React.useMemo(() => resultadosDe(false), [banco, titulos, lancamentos, regras]);
  const resRec = React.useMemo(() => resultadosDe(true), [banco, titulos, lancamentos, regras]);
  const sugestoes = React.useMemo(() => {
    const s = {};
    resRec.forEach((r) => {
      if (!r.resolvido && r.titulo && (r.estado === "sugestao" || r.estado === "diferenca")) s[r.titulo.id] = { data: r.mov.data, motivo: r.motivo, digital: r.digital };
    });
    return s;
  }, [resRec]);

  // ---- Importar ----
  const [recusado, setRecusado] = React.useState(null);

  function importar(arquivo, texto, simular = false) {
    let ofx;
    try {
      ofx = lerOfx(texto);
    } catch (e) {
      setToast("Não foi possível ler o arquivo: ele não parece um OFX.");
      return;
    }
    if (!ofx.movimentos.length) return setToast("O arquivo não tem movimentos.");
    // A conta vem do arquivo e não se troca: só entra o extrato da conta
    // aberta no topo (aqui, a California Santander).
    const reconhecida = contaDoArquivo(ofx)?.id ?? null;
    if (reconhecida !== "cs" && !simular) {
      setRecusado({ arquivo, texto, ofx, contaReconhecida: reconhecida });
      irPara("banco", versao === "atual" ? "pedida" : versao);
      return;
    }
    setRecusado(null);
    const dig = digitais(ofx.movimentos, "cs");
    const vistos = new Set(banco.movimentos.map((m) => m.digital));
    const novos = ofx.movimentos.map((mov, i) => ({ mov, digital: dig[i] })).filter((m) => !vistos.has(m.digital));
    const anterior = banco.importacoes.find((i) => dig.some((d) => i.digitais.includes(d)));
    const imp = {
      arquivo,
      ofx,
      texto,
      digitais: dig,
      novos: novos.length,
      repetidos: ofx.movimentos.length - novos.length,
      // Só o arquivo antigo (o do Tiago, de maio) anda até 19/10; os de
      // outubro ficam onde estão.
      deslocamento: (ofx.fim ?? ofx.movimentos[0].data) >= DIA_OFX ? 0 : diasEntre(DIA_OFX, ofx.fim ?? ofx.movimentos[0].data),
      anterior: anterior ? `“${anterior.arquivo}”` : "",
      simulada: simular,
    };
    setBanco((b) => ({ ...b, movimentos: [...b.movimentos, ...novos], importacoes: [...b.importacoes, imp] }));
    irPara("banco", versao === "atual" ? "pedida" : versao);
    setToast(
      novos.length
        ? modoImportacao === "auto"
          ? `${novos.length} movimentos lidos de ${arquivo}. O que é certo já foi baixado e conciliado; o resto espera você.`
          : `${novos.length} movimentos lidos de ${arquivo}. Nada foi gravado ainda.`
        : `Nada novo em ${arquivo}: os ${imp.repetidos} movimentos já tinham sido importados.`,
    );
  }
  const usarExemplo = () => importar("extrato-pj-20_10_2026_09h19m23s.ofx", exemplo("091923"));
  // O extrato de hoje, gerado às 11:40: o dia ainda não terminou.
  const importarDoDia = () => importar("extrato-pj-20_10_2026_11h40m12s.ofx", ofxDoDia().replace("__SALDO__", (Number(SALDO_DO_EXEMPLO.replace(",", ".")) + SOMA_DO_DIA).toFixed(2).replace(".", ",")));
  const reimportar = () => {
    if (!ultimaImp) return;
    const texto = ultimaImp.texto.replace(/<FITID>(\d+)/g, (_, d) => `<FITID>${d}7`);
    importar(ultimaImp.arquivo.replace(/(\.ofx)$/i, "_1$1"), texto, ultimaImp.simulada);
  };

  // ---- Gravar ----
  function baixar(itens, { data, contaId, valor, juros, centro, parcial, quita, retido }, conciliado = false) {
    const novos = itens.map((t) => ({ ...lancamentoDaBaixa(t, { data, contaId, valor: valor ?? aberto(t), juros, centro: t.centro ?? centro }), conciliado, novo: true }));
    setTitulos((ts) =>
      ts.map((t) => {
        if (!itens.find((i) => i.id === t.id)) return t;
        const pago = r2((t.baixado ?? 0) + (valor ?? aberto(t)));
        // Com retenção na baixa, o líquido pago é menor que o do título: a
        // baixa do valor inteiro (não parcial) quita do mesmo jeito.
        return pago >= t.liquido - 0.004 || quita ? { ...t, baixado: pago, pagoEm: data, centro: t.centro ?? centro } : { ...t, baixado: pago };
      }),
    );
    setLancamentos((ls) => [...ls, ...novos.filter((l) => l.contaId === "cs")]);
    return novos;
  }

  // ---- Cartão (decisão 093): a baixa no cartão põe o item na fatura e não
  // toca no banco; fechar a fatura cria o título dela; a baixa desse título
  // é que tira o dinheiro do banco. ----
  function baixarNoCartao(itens, { data, cartaoId, centro, fatura: escolhida }) {
    const cartao = CARTOES.find((c) => c.id === cartaoId);
    // A fatura escolhida na baixa; sem escolha, a da data do pagamento. No
    // lote, todos entram na mesma, cada título um item.
    const destino = escolhida ?? faturaDestino(cartao, data, faturas);
    const novosItens = itens.map((t) => ({
      id: `it-${t.id}`,
      data,
      tipo: t.origem,
      codigo: t.origem === "pp" ? `${t.ref} ${t.parcela[0]}/${t.parcela[1]}` : t.ref,
      descricao: t.titulo,
      fornecedor: t.contraparte,
      valor: aberto(t),
      centro: t.centro ?? centro,
      empresa: t.empresa,
      job: t.job,
      novo: true,
    }));
    const total = r2(novosItens.reduce((s, i) => s + i.valor, 0));
    let codigo = destino.existente?.codigo;
    if (destino.existente) {
      setFaturas((fs) => fs.map((f) => (f.id === destino.existente.id ? { ...f, itens: [...f.itens, ...novosItens] } : f)));
    } else {
      codigo = `FC-${String(Math.max(...faturas.map((f) => Number(f.codigo.slice(3)))) + 1).padStart(5, "0")}`;
      setFaturas((fs) => [...fs, { id: `fc-${Date.now()}`, codigo, cartao: cartaoId, competencia: destino.competencia, fecha: destino.fecha, vence: destino.vence, status: "aberta", itens: novosItens }]);
    }
    setTitulos((ts) => ts.map((x) => (itens.some((i) => i.id === x.id) ? { ...x, baixado: x.liquido, pagoEm: data, centro: x.centro ?? centro, noCartao: { cartao: cartaoId, fatura: codigo } } : x)));
    setToast(
      itens.length === 1
        ? `Confirmado no cartão · ${moeda(total)} entrou na fatura de ${rotuloCompetencia(destino.competencia)} do ${cartao.nome} (${codigo}). Nada saiu do banco.`
        : `Confirmado no cartão · ${itens.length} títulos, ${moeda(total)}, entraram na fatura de ${rotuloCompetencia(destino.competencia)} do ${cartao.nome} (${codigo}). Nada saiu do banco.`,
    );
  }

  function fecharFatura(f, { valorCobrado, ajuste }) {
    const cartao = CARTOES.find((c) => c.id === f.cartao);
    const itensAjuste = ajuste
      ? [{ id: `aj-${f.id}`, data: f.fecha, tipo: "ajuste", codigo: "AV-00250", descricao: ajuste.descricao, fornecedor: cartao.banco, valor: ajuste.valor, centro: ajuste.centro, empresa: cartao.empresa, job: null, novo: true }]
      : [];
    setFaturas((fs) => fs.map((x) => (x.id === f.id ? { ...x, status: "fechada", valorCobrado, itens: [...x.itens, ...itensAjuste] } : x)));
    if (valorCobrado > 0) {
      setTitulos((ts) => [
        ...ts,
        {
          id: `fat-${f.id}`,
          lado: "pagar",
          origem: "fatura",
          ref: f.codigo,
          titulo: `Fatura ${cartao.nome} · fecha ${dataBR(f.fecha)}`,
          contraparte: cartao.nome,
          empresa: cartao.empresa,
          job: null,
          vencimento: f.vence,
          vencOrig: f.vence,
          valor: valorCobrado,
          retencao: 0,
          liquido: valorCobrado,
          baixado: 0,
          parcela: [1, 1],
          centro: null,
          forma: "pix",
          faturaId: f.id,
          cartao: f.cartao,
        },
      ]);
    }
    setToast(
      valorCobrado > 0
        ? `Fatura ${f.codigo} fechada em ${moeda(valorCobrado)}. Ela já está em Títulos a Pagar, para a baixa em ${dataBR(f.vence)}.`
        : `Fatura ${f.codigo} fechada credora: não vira título.`,
    );
  }

  function reabrirFatura(f) {
    setFaturas((fs) => fs.map((x) => (x.id === f.id ? { ...x, status: "aberta", valorCobrado: undefined, itens: x.itens.filter((i) => i.tipo !== "ajuste") } : x)));
    setTitulos((ts) => ts.filter((t) => !(t.faturaId === f.id && !t.pagoEm)));
    setToast(`Fatura ${f.codigo} reaberta: o ajuste do fechamento saiu e o título dela saiu de Títulos a Pagar. Os itens confirmados continuam nela.`);
  }

  function resolver(digital, info) {
    setBanco((b) => ({ ...b, resolucoes: { ...b.resolucoes, [digital]: info } }));
  }

  const acoesBanco = {
    conciliar: (r) => {
      const ls = baixar([r.titulo], { data: r.mov.data, contaId: banco.contaId, juros: r.diferenca ?? 0 }, true);
      resolver(r.digital, { estado: "conciliado", texto: `Baixa de ${descricaoDoLancamento(r.titulo)}`, lancIds: ls.map((l) => l.id), tituloIds: [r.titulo.id] });
    },
    conferir: (r) => setDialogo({ tipo: "baixa", itens: [r.titulo], versao: versao === "atual" ? "pedida" : versao, linha: r, dataInicial: r.mov.data, juros: r.diferenca ?? 0, retencao: r.retencaoSugerida ?? null }),
    // Um título escolhido no grupo de linhas iguais, que ainda pede algo na
    // baixa (o centro de custo).
    conferirTitulo: (r, t) => setDialogo({ tipo: "baixa", itens: [t], versao: versao === "atual" ? "pedida" : versao, linha: r, dataInicial: r.mov.data }),
    // Vários títulos da mesma contraparte numa linha: a baixa em lote, que
    // só concilia quando a soma bate.
    // A soma única: cada título com a sua baixa, todas ligadas à linha.
    conciliarCombinacao: (r, calado) => {
      const ls = baixar(r.titulos, { data: r.mov.data, contaId: banco.contaId, juros: 0 }, true);
      resolver(r.digital, { estado: "conciliado", texto: `Baixa de ${r.titulos.map((t) => t.ref).join(" + ")} · ${r.titulos[0].contraparte}, numa linha só`, lancIds: ls.map((l) => l.id), tituloIds: r.titulos.map((t) => t.id) });
      if (!calado) setToast(`${r.titulos.length} títulos de ${r.titulos[0].contraparte} baixados e conciliados com a linha de ${moeda(Math.abs(r.mov.valor))}.`);
    },
    conferirCombinacao: (r) => setDialogo({ tipo: "baixa", itens: r.titulos, versao: versao === "atual" ? "pedida" : versao, linha: r, dataInicial: r.mov.data }),
    // As linhas iguais do banco e os títulos marcados: um título por linha,
    // na ordem; qual fica com qual não muda o Extrato.
    conciliarGrupo: (g, escolhidos, centros) => {
      const linhas = [...g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem);
      const grupo = `grupo-${Date.now()}`;
      const lancIds = [];
      linhas.forEach((r, i) => {
        const t = escolhidos[i];
        lancIds.push(...baixar([t], { data: r.mov.data, contaId: banco.contaId, juros: 0, centro: centros[t.id] }, true).map((l) => l.id));
      });
      const tituloIds = escolhidos.map((t) => t.id);
      const res = Object.fromEntries(linhas.map((r, i) => [r.digital, { estado: "conciliado", grupo, texto: `Baixa de ${descricaoDoLancamento(escolhidos[i])} · grupo de ${linhas.length} ${linhas.length === 1 ? "linha" : "linhas iguais"}`, lancIds, tituloIds }]));
      setBanco((b) => ({ ...b, resolucoes: { ...b.resolucoes, ...res } }));
      setToast(
        linhas.length === 1
          ? `${descricaoDoLancamento(escolhidos[0])} baixado e conciliado.`
          : `${linhas.length} títulos baixados e conciliados com as ${linhas.length} linhas de ${moeda(Math.abs(linhas[0].mov.valor))}.`,
      );
    },
    ligar: (r) => {
      // A data do extrato do sistema passa a ser a do banco (com a anterior
      // guardada para o desfazer e para a auditoria).
      const antes = r.lancamento.data;
      const mudou = antes !== r.mov.data;
      setLancamentos((ls) => ls.map((l) => (l.id === r.lancamento.id ? { ...l, conciliado: true, data: r.mov.data, dataAntes: antes } : l)));
      resolver(r.digital, {
        estado: "conciliado",
        texto: `Baixa feita à mão: “${r.lancamento.descricao}”${mudou ? ` · data de ${dataBR(antes)} para ${dataBR(r.mov.data)}, a do banco` : ""}`,
        ligados: [r.lancamento.id],
      });
    },
    conciliarLote: (r) => resolver(r.digital, lancarLote(r)),
    conciliarPar: (r) => {
      const ref = r.titulo ? `${r.titulo.ref} · ${r.titulo.contraparte}` : "PIX";
      const base = { fornecedor: r.titulo?.contraparte ?? null, job: r.titulo?.job?.codigo ?? null, centro: { tipo: "—", sub: "Pagamento devolvido pelo banco · fora do DRE" }, empresa: r.titulo?.empresa ?? null, conciliado: true, novo: true, tituloId: r.titulo?.id, detalhe: { tag: r.titulo ? "pp" : null, codigo: r.titulo ? `${r.titulo.ref} 1/1` : null, rateio: [["NE", 100]] } };
      const sai = { ...base, id: `par-s-${Date.now()}`, data: r.par.mov.data, valor: r.par.mov.valor, descricao: `PIX que voltou · ${ref}` };
      const volta = { ...base, id: `par-v-${Date.now()}`, data: r.mov.data, valor: r.mov.valor, descricao: `Devolução do PIX · ${ref}` };
      if (banco.contaId === "cs") setLancamentos((ls) => [...ls, sai, volta]);
      const info = { estado: "conciliado", grupo: `par-${Date.now()}`, texto: `Saída e devolução registradas; ${r.titulo ? `${r.titulo.ref} continua a pagar` : "nenhum título baixado"}`, lancIds: [sai.id, volta.id] };
      setBanco((b) => ({ ...b, resolucoes: { ...b.resolucoes, [r.digital]: info, [r.par.digital ?? digitalDe(r.par.mov)]: { ...info, lancIds: [] } } }));
    },
    lancarRegra: (r) => lancarRegra([r]),
    lancarVariasRegras: (rs) => lancarRegra(rs),
    conciliarVarios: (rs) => {
      rs.forEach((r) => {
        if (r.estado === "ja_lancado") acoesBanco.ligar(r);
        else if (r.estado === "soma") acoesBanco.conciliarLote(r);
        else if (r.estado === "combinacao") acoesBanco.conciliarCombinacao(r, true);
        else if (r.titulo) acoesBanco.conciliar(r);
      });
      setToast(`${rs.length === 1 ? "1 linha do banco conciliada" : `${rs.length} linhas do banco conciliadas`}. Cada baixa já está no Extrato, com a data do banco.`);
    },
    lancarAvulso: (r) => {
      const hist = r.mov.historico.replace(/\s{2,}.*$/, "");
      const inicial = {
        descricao: hist.charAt(0) + hist.slice(1).toLowerCase(),
        valor: Math.abs(r.mov.valor).toFixed(2).replace(".", ","),
        data: r.mov.data,
        doBanco: r.mov.historico,
        padrao: normalizar(hist).split(" ").slice(0, 3).join(" "),
      };
      setDialogo({ tipo: r.mov.valor < 0 ? "novo_pagamento" : "novo_recebimento", tipoReceb: "avulso", inicial, linha: r, versao });
    },
    procurar: (r) => setProcurando(r),
    ignorar: (r) => resolver(r.digital, { estado: "ignorado", texto: "Ignorada: não entra no extrato do sistema" }),
    desfazer: (r) => {
      if (bloqueado(r.mov.data)) return;
      const info = banco.resolucoes[r.digital];
      if (info?.corrigidos)
        setLancamentos((ls) =>
          ls.map((l) =>
            info.corrigidos.includes(l.id)
              ? { ...l, valor: l.valorAntes ?? l.valor, juros: l.jurosAntes ?? l.juros, data: l.dataAntes ?? l.data, conciliado: false, historico: [...(l.historico ?? []), { tipo: "desfeita", em: HOJE, por: "você" }] }
              : l,
          ),
        );
      if (info?.lancIds?.length) setLancamentos((ls) => ls.filter((l) => !info.lancIds.includes(l.id)));
      if (info?.ligados) setLancamentos((ls) => ls.map((l) => (info.ligados.includes(l.id) ? { ...l, conciliado: false, data: l.dataAntes ?? l.data } : l)));
      if (info?.tituloIds) setTitulos((ts) => ts.map((t) => (info.tituloIds.includes(t.id) ? { ...t, pagoEm: undefined, baixado: 0 } : t)));
      setBanco((b) => {
        const res = { ...b.resolucoes };
        delete res[r.digital];
        Object.keys(res).forEach((k) => {
          if (info?.grupo && res[k].grupo === info.grupo) delete res[k];
        });
        // O conciliado sozinho que alguém desfez não volta a se conciliar.
        return { ...b, resolucoes: res, semAuto: info?.sozinho ? [...(b.semAuto ?? []), r.digital] : b.semAuto };
      });
    },
    // A baixa feita à mão com outro valor: abre a confirmação, que mostra o
    // que muda e pede o motivo.
    corrigirBaixa: (r) => {
      if (bloqueado(r.mov.data) || bloqueado(r.lancamento.data)) return;
      setCorrigindo(r);
    },
    // A baixa feita à mão que não está no banco.
    cancelarBaixa: (l) => {
      if (bloqueado(l.data)) return;
      setLancamentos((ls) => ls.filter((x) => x.id !== l.id));
      if (l.tituloId) setTitulos((ts) => ts.map((t) => (t.id === l.tituloId ? { ...t, pagoEm: undefined, baixado: 0 } : t)));
      setToast(`Baixa cancelada: “${l.descricao}” voltou para Títulos a Pagar.`);
    },
    corrigirLancamento: () => setToast("No sistema, abre a baixa registrada para trocar a conta ou a data."),
  };

  /** A correção confirmada: a baixa fica com o valor e a data do banco, e o
   *  registro (de, para, motivo, quem e quando) entra no histórico dela. */
  function corrigirBaixa(r, motivo) {
    const l = r.lancamento;
    const { antes, depois } = correcaoDaBaixa(l, r.mov, titulos.find((t) => t.id === l.tituloId));
    const registro = { tipo: "correcao", em: HOJE, por: "você", antes, depois, motivo };
    setLancamentos((ls) =>
      ls.map((x) =>
        x.id === l.id
          ? { ...x, valor: r.mov.valor, juros: depois.juros, data: r.mov.data, conciliado: true, valorAntes: x.valor, jurosAntes: x.juros, dataAntes: x.data, historico: [...(x.historico ?? []), registro] }
          : x,
      ),
    );
    resolver(r.digital, { estado: "conciliado", texto: `Baixa corrigida de ${moeda(antes.total)} para ${moeda(depois.total)}, o valor do banco · “${motivo}”`, corrigidos: [l.id] });
    setCorrigindo(null);
    setToast(`Baixa corrigida para ${moeda(depois.total)} e conciliada. A correção, com o motivo, está no ⓘ do lançamento no Extrato.`);
  }

  /** Na regra "trava", o que tem data até o fechamento não muda. */
  function bloqueado(data) {
    if (modoFechamento === "trava" && fechadoAte && data <= fechadoAte) {
      setToast(`Período fechado até ${dataBR(fechadoAte)}: reabra a conciliação para mudar esse lançamento.`);
      return true;
    }
    return false;
  }

  function fecharPeriodo(ate) {
    setFechamento((f) => ({ ate, em: HOJE, ativo: true, historico: [...(f?.historico ?? []), { tipo: "fechou", em: HOJE, ate }] }));
    setToast(
      modoFechamento === "trava"
        ? `Conciliação da California Santander fechada até ${dataBR(ate)}. Lançamento até essa data só muda reabrindo o período.`
        : `Conciliação da California Santander marcada como conferida até ${dataBR(ate)}.`,
    );
  }

  function reabrirPeriodo(motivo) {
    setFechamento((f) => ({ ...f, ativo: false, historico: [...f.historico, { tipo: "reabriu", em: HOJE, motivo }] }));
    setReabrindo(false);
    setToast(`Período até ${dataBR(fechamento.ate)} reaberto. O motivo ficou na auditoria.`);
  }

  // Na importação, o que é certo se resolve sozinho (Tiago, 20/10/2026):
  //  - a baixa feita à mão que bate com o banco (mesmo valor, até 3 dias):
  //    só liga as duas linhas, com a data do banco;
  //  - na regra "auto", também o título sem baixa com valor exato, um título
  //    só com esse valor, data e forma batendo (confiança alta); a remessa
  //    que soma centavo a centavo; a tarifa pela regra do histórico.
  // O resto (empate, juros, centro a escolher, sem correspondência,
  // divergência) fica para alguém decidir. Cada linha do banco é avaliada uma
  // vez: o que alguém desfez não volta a se resolver sozinho.
  React.useEffect(() => {
    const avaliados = new Set(banco.avaliados ?? []);
    const semAuto = new Set(banco.semAuto ?? []);
    const pendentes = resRec.filter((r) => !r.resolvido && !semAuto.has(r.digital));
    // A baixa à mão vale a qualquer momento (pode vir depois da importação).
    const manuais = pendentes.filter((r) => r.estado === "ja_lancado");
    const novos = modoImportacao === "auto" ? pendentes.filter((r) => !avaliados.has(r.digital)) : [];
    const titulosAuto = novos.filter((r) => r.estado === "sugestao" && r.confianca === "alta" && r.titulo?.centro);
    const lotesAuto = novos.filter((r) => r.estado === "soma");
    const regrasAuto = novos.filter((r) => r.estado === "regra");
    const naoVistos = modoImportacao === "auto" ? resRec.filter((r) => !r.resolvido && !avaliados.has(r.digital)) : [];
    if (!manuais.length && !titulosAuto.length && !lotesAuto.length && !regrasAuto.length && !naoVistos.length) return;
    const res = {};
    if (manuais.length) {
      const porId = new Map(manuais.map((r) => [r.lancamento.id, r]));
      setLancamentos((ls) => ls.map((l) => (porId.has(l.id) ? { ...l, conciliado: true, data: porId.get(l.id).mov.data, dataAntes: l.data } : l)));
      manuais.forEach((r) => {
        const mudou = r.lancamento.data !== r.mov.data;
        res[r.digital] = {
          estado: "conciliado",
          sozinho: "manual",
          texto: `Baixa feita à mão: “${r.lancamento.descricao}”${mudou ? ` · data de ${dataBR(r.lancamento.data)} para ${dataBR(r.mov.data)}, a do banco` : ""}`,
          ligados: [r.lancamento.id],
        };
      });
    }
    titulosAuto.forEach((r) => {
      const ls = baixar([r.titulo], { data: r.mov.data, contaId: banco.contaId, juros: 0 }, true);
      res[r.digital] = { estado: "conciliado", sozinho: "titulo", texto: `Baixado e conciliado sozinho: ${descricaoDoLancamento(r.titulo)}`, lancIds: ls.map((l) => l.id), tituloIds: [r.titulo.id] };
    });
    lotesAuto.forEach((r) => (res[r.digital] = { ...lancarLote(r), sozinho: "remessa" }));
    if (regrasAuto.length) {
      const ls = lancamentosDaRegra(regrasAuto);
      if (banco.contaId === "cs") setLancamentos((x) => [...x, ...ls]);
      regrasAuto.forEach((r, i) => (res[r.digital] = { estado: "conciliado", sozinho: "regra", texto: `Lançado sozinho pela regra: ${r.regra.centro}`, lancIds: [ls[i].id] }));
    }
    setBanco((b) => ({ ...b, resolucoes: { ...b.resolucoes, ...res }, avaliados: [...(b.avaliados ?? []), ...naoVistos.map((r) => r.digital)] }));
  }, [resRec]);

  // O último dia completo dos extratos importados: o arquivo gerado no
  // mesmo dia do último movimento ainda não tinha o dia inteiro (Tiago,
  // 20/10/2026), então o fechamento vai até a véspera.
  const diaCompleto = (imp) => (imp.ofx.geradoEm && imp.ofx.fim && imp.ofx.geradoEm > imp.ofx.fim ? imp.ofx.fim : somaDias(imp.ofx.fim, -1));
  const fechavelAte = banco.importacoes.length ? banco.importacoes.map(diaCompleto).sort().pop() : null;
  const diaEmAndamento = ultimaImp && ultimaImp.ofx.geradoEm === ultimaImp.ofx.fim ? { dia: ultimaImp.ofx.fim, hora: ultimaImp.ofx.geradoHora } : null;

  // As baixas feitas à mão, com data num dia completo dos extratos
  // importados, que o banco não tem. O dia em andamento não conta: a linha
  // pode entrar até o fim dele.
  const naoApareceu = React.useMemo(() => {
    if (!banco.movimentos.length || !fechavelAte) return [];
    const usados = new Set(resRec.filter((r) => r.lancamento && !r.resolvido).map((r) => r.lancamento.id));
    const ini = banco.movimentos.map((m) => m.mov.data).sort()[0];
    return lancamentos.filter((l) => !l.conciliado && l.data >= ini && l.data <= fechavelAte && !usados.has(l.id));
  }, [resRec, lancamentos, banco.movimentos, fechavelAte]);

  // O saldo no fim do último dia completo, no banco e no sistema: é o que o
  // fechamento confere.
  const saldoBancoNoFechamento = ultimaImp?.ofx.saldoBanco == null ? null : r2(ultimaImp.ofx.saldoBanco - banco.movimentos.filter((m) => m.mov.data > fechavelAte).reduce((s, m) => s + m.mov.valor, 0));
  const saldoSistemaNoFechamento = fechavelAte ? r2(SALDO_INICIAL_OUTUBRO + lancamentos.filter((l) => l.data <= fechavelAte).reduce((s, l) => s + l.valor, 0)) : null;

  // O que o Extrato destaca em vermelho: a baixa que diverge e a que falta.
  const alertasDoExtrato = React.useMemo(() => {
    const a = {};
    resRec.filter((r) => !r.resolvido && r.estado === "divergencia").forEach((r) => (a[r.lancamento.id] = `Não bate com o banco. ${r.motivo}`));
    naoApareceu.forEach((l) => (a[l.id] = `Não está no extrato do banco até ${dataBR(fechavelAte)}: paga em outra conta, com a data errada ou não paga.`));
    return a;
  }, [resRec, naoApareceu]);

  /** A remessa da folha: baixa dos títulos e uma linha só no Extrato. */
  function lancarLote(r) {
    const ts = r.lote.titulos.map((t) => titulos.find((x) => x.id === t.id));
    setTitulos((all) => all.map((t) => (ts.find((x) => x.id === t.id) ? { ...t, baixado: t.liquido, pagoEm: r.mov.data } : t)));
    const l = {
      id: `lote-${r.digital}`,
      data: r.mov.data,
      valor: r.mov.valor,
      descricao: "Folha de pagamento 10/2026 · remessa Santander",
      fornecedor: null,
      job: null,
      centro: { tipo: "05", sub: "Salário" },
      empresa: "Agência California",
      conciliado: true,
      novo: true,
      multiplas: ts.length,
      detalhe: { tag: "avulsa", codigo: "Folha 10/2026", documento: "Remessa CNAB", rateio: [["NE", 82], ["SP", 18]] },
    };
    if (banco.contaId === "cs") setLancamentos((ls) => [...ls, l]);
    return { estado: "conciliado", texto: `Baixa dos ${ts.length} títulos da folha 10/2026, numa linha só`, lancIds: [l.id], tituloIds: ts.map((t) => t.id) };
  }

  function digitalDe(mov) {
    return banco.movimentos.find((m) => m.mov === mov)?.digital;
  }

  /** O avulso que a regra do histórico lança (a tarifa do banco). */
  function lancamentosDaRegra(rs) {
    return rs.map((r, i) => ({
      id: `regra-${Date.now()}-${i}`,
      data: r.mov.data,
      valor: r.mov.valor,
      descricao: `Tarifa bancária · ${r.mov.historico.replace(/^TAR\s+/i, "").toLowerCase()}`,
      fornecedor: "Santander",
      job: null,
      centro: { tipo: r.regra.tipo, sub: r.regra.sub },
      empresa: r.regra.empresa,
      conciliado: true,
      novo: true,
      detalhe: { tag: "avulsa", codigo: `AV-0024${i}`, rateio: [["NE", 100]] },
    }));
  }

  function lancarRegra(rs) {
    const novos = lancamentosDaRegra(rs);
    if (banco.contaId === "cs") setLancamentos((ls) => [...ls, ...novos]);
    setBanco((b) => {
      const res = { ...b.resolucoes };
      rs.forEach((r, i) => (res[r.digital] = { estado: "conciliado", texto: `Avulso lançado pela regra: ${r.regra.centro}`, lancIds: [novos[i].id] }));
      return { ...b, resolucoes: res };
    });
    setToast(`${rs.length} ${rs.length === 1 ? "tarifa lançada" : "tarifas lançadas"} em ${rs[0].regra.centro}, já conciliadas.`);
  }

  // ---- Diálogos ----
  function abrir(versaoDoPainel) {
    return (tipo, t, extra) => {
      if (tipo === "abrir_apuracao")
        return setToast(`No sistema, abre a guia de ${t?.titulo ?? "imposto"} (${t?.competencia ?? ""}) na Apuração, no Fiscal. O valor é aprovado lá: a guia que a contabilidade mandar diferente se corrige lá, com justificativa e a guia anexa.`);
      if (["editar_data", "editar_previsao", "editar_prevista", "corrigir_imposto", "cancelar_imposto", "excluir", "devolver_folha", "info_nf", "abrir_pp", "abrir_avulso", "ver_guia", "ver_baixas"].includes(tipo))
        return setAcao({ acao: tipo, titulo: t });
      setDialogo({ tipo, tipoReceb: extra, versao: versaoDoPainel });
    };
  }

  function avisoDaBaixa(contaId, data, n = 1) {
    const plural = n > 1 ? `${n} baixas registradas` : "Baixa registrada";
    if (contaId !== "cs") return `${plural} em outra conta, em ${dataBR(data)}: o movimento está no extrato dela.`;
    return `${plural}. O movimento já está no Extrato desta conta, em ${dataBR(data)}.`;
  }

  function criarTitulo(t, baixarAgora, lembrar) {
    const linha = dialogo?.linha;
    setTitulos((ts) => [...ts, t]);
    if (lembrar && dialogo?.inicial?.padrao) {
      setRegras((rg) => [
        ...rg,
        {
          id: `r-${Date.now()}`,
          padrao: dialogo.inicial.padrao,
          centro: `${t.centro.tipo} · ${t.centro.sub}`,
          tipo: t.centro.tipo,
          sub: t.centro.sub,
          empresa: t.empresa,
          criadaEm: "20/10/2026",
          usos: 1,
        },
      ]);
    }
    if (baixarAgora && linha) {
      const ls = baixar([t], { data: linha.mov.data, contaId: banco.contaId }, true);
      resolver(linha.digital, { estado: "conciliado", texto: `Avulso criado e baixado: ${t.titulo}`, lancIds: ls.map((l) => l.id), tituloIds: [t.id] });
      setDialogo(null);
      setToast(`Avulso criado e conciliado com a linha do banco de ${dataBR(linha.mov.data)}.${lembrar ? " A regra vale da próxima importação em diante." : ""}`);
      return;
    }
    if (baixarAgora) {
      setDialogo({ tipo: "baixa", itens: [t], versao: dialogo.versao });
      return;
    }
    setDialogo(null);
    setToast(`${t.ref ?? "Título"} criado: ${t.titulo}. Ele já aparece na aba Títulos.`);
  }

  function irPara(t, v) {
    setTela(t);
    if (v) setVersao(v);
  }

  // ---- Telas ----
  const resultadosPara = (v) => (comoRecomendada(v) ? resRec : resPedida);

  function renderConciliacao(v) {
    const aba = tela === "extrato" ? "extrato" : tela === "banco" ? "banco" : "titulos";
    const nAbertos = titulos.filter((t) => !t.pagoEm && (v !== "atual" || t.lado !== "transf")).length;
    const pendBanco = resultadosPara(v).filter((r) => !r.resolvido).length;
    const abrirV = abrir(v);
    return (
      <div className="space-y-6">
        <Voltar />
        <PageHeader title="Conciliação" icon={Receipt} description="Extrato por conta bancária — base pra bater com o extrato do banco e alimentar o DRE." />
        <FiltrosConta />
        {v !== "atual" && (
          <BannerDoFechamento fechamento={fechamento} modo={modoFechamento} onReabrir={() => setReabrindo(true)} onFecharDeNovo={() => fecharPeriodo(fechamento.ate)} />
        )}
        <Tabs
          ativa={aba}
          onChange={(k) => setTela(k)}
          abas={[
            { key: "extrato", label: "Extrato" },
            { key: "titulos", label: "Títulos", count: nAbertos },
            ...(v === "atual" ? [] : [{ key: "banco", label: "Conciliação automática", count: pendBanco, novo: !banco.movimentos.length }]),
          ]}
        />
        {aba === "titulos" &&
          (v === "atual" ? (
            <AbaTitulosAtual titulos={titulos} onBaixar={(t) => setDialogo({ tipo: "baixa", itens: [t], versao: v })} onLote={(itens, limpar) => setDialogo({ tipo: "baixa", itens, versao: v, limpar })} />
          ) : (
            <AbaTitulosNova
              key={v}
              titulos={titulos}
              versao={v}
              saldoHoje={saldoHoje}
              sugestoes={sugestoes}
              onBaixar={(t) => {
                const s = comoRecomendada(v) ? sugestoes[t.id] : null;
                const r = s ? resRec.find((x) => x.digital === s.digital) : null;
                setDialogo({ tipo: "baixa", itens: [t], versao: v, linha: r, dataInicial: r?.mov.data, juros: r?.diferenca ?? 0, retencao: r?.retencaoSugerida ?? null });
              }}
              onLote={(itens, limpar) => setDialogo({ tipo: "baixa", itens, versao: v, limpar })}
              abrir={abrirV}
              irParaExtrato={(t) => setTela(t)}
              onPrevia={comoRecomendada(v) ? setPrevia : undefined}
            />
          ))}
        {aba === "extrato" && (
          <AbaExtrato
            lancamentos={lancamentos}
            saldoInicial={SALDO_INICIAL_OUTUBRO}
            versao={v}
            previstos={comoRecomendada(v) ? previa : []}
            onImportar={() => setTela("banco")}
            alertas={comoRecomendada(v) ? alertasDoExtrato : {}}
            travadoAte={modoFechamento === "trava" ? fechadoAte : null}
          />
        )}
        {aba === "banco" && v === "pedida" && (
          <AbaBancoPedida imp={ultimaImp} resultados={resPedida} onArquivo={importar} onExemplo={usarExemplo} onReimportar={reimportar} acoes={acoesBanco} recusado={
              recusado ? (
                <ArquivoRecusado
                  pendente={recusado}
                  onSimular={() => importar(recusado.arquivo, recusado.texto, true)}
                  onDescartar={() => setRecusado(null)}
                  onAbrirOutra={() => setToast("No sistema, abre a conciliação dessa conta já com o arquivo lido.")}
                />
              ) : null
            } />
        )}
        {aba === "banco" && comoRecomendada(v) && (
          <AbaBancoRecomendada
            imp={ultimaImp}
            resultados={resRec}
            onArquivo={importar}
            onExemplo={usarExemplo}
            onReimportar={reimportar}
            acoes={acoesBanco}
            recusado={
              recusado ? (
                <ArquivoRecusado
                  pendente={recusado}
                  onSimular={() => importar(recusado.arquivo, recusado.texto, true)}
                  onDescartar={() => setRecusado(null)}
                  onAbrirOutra={() => setToast("No sistema, abre a conciliação dessa conta já com o arquivo lido.")}
                />
              ) : null
            }
            saldoSistema={r2(SALDO_INICIAL_OUTUBRO + lancamentos.filter((l) => l.data <= (ultimaImp?.ofx.fim ?? DIA_OFX)).reduce((s, l) => s + l.valor, 0))}
            colunas={v === "alternativa"}
            fechada={fechadoAte}
            fechavelAte={fechavelAte}
            diaEmAndamento={diaEmAndamento}
            difNoFechamento={saldoBancoNoFechamento === null || saldoSistemaNoFechamento === null ? null : r2(saldoBancoNoFechamento - saldoSistemaNoFechamento)}
            onImportarDoDia={importarDoDia}
            onFechar={() => fecharPeriodo(fechavelAte)}
            onReabrir={modoFechamento === "trava" ? () => setReabrindo(true) : undefined}
            naoApareceu={naoApareceu}
          />
        )}
        {aba === "banco" && v === "atual" && (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">Não existe hoje.</div>
        )}
      </div>
    );
  }

  function renderTela(v) {
    const abrirV = abrir(v);
    const comum = {
      versao: v,
      titulos,
      saldoHoje,
      abrir: abrirV,
      onBaixar: (t) => setDialogo({ tipo: "baixa", itens: [t], versao: v }),
      onLote: (itens, limpar) => setDialogo({ tipo: "baixa", itens, versao: v, limpar }),
    };
    if (tela === "cp" || tela === "cartao")
      return (
        <ContasAPagar
          {...comum}
          aba={tela === "cartao" ? "cartao" : "titulos"}
          onAba={(a) => setTela(a === "cartao" ? "cartao" : "cp")}
          faturas={faturas}
          onFecharFatura={fecharFatura}
          onReabrirFatura={reabrirFatura}
          avisar={setToast}
        />
      );
    if (tela === "cr") return <ContasAReceber {...comum} />;
    if (tela === "imp") return <ImpostosAPagar {...comum} />;
    return renderConciliacao(v);
  }

  const notasDaTela = NOTAS[tela];
  const versoesNaTela = comparar ?? [versao];

  const contextoDetalhes = {
    variante,
    onVerDocumentos: (t, i) => setDocsDe({ t, inicial: i }),
    abrirAcao: (tipo, t) => setAcao({ acao: tipo, titulo: t }),
    titulos,
    regional: formaRegional,
    sinalBanco,
    faturas,
  };

  return (
    <DetalhesContexto.Provider value={contextoDetalhes}>
    <div className="pg-app">
      <div className="pg-tool">
        <div className="pg-linha">
          <span className="pg-titulo">Protótipo · Conciliação com o banco</span>
          <div className="pg-seg" role="tablist" aria-label="Tela">
            {TELAS.map(([k, l]) => (
              <button key={k} type="button" className={cn(tela === k && "ativo")} onClick={() => setTela(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="pg-linha">
          <span className="pg-rotulo">Versão</span>
          <div className="pg-seg">
            {VERSOES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={cn(!comparar && versao === k && "ativo", (k === "recomendada" || k === "alternativa") && "destaque")}
                onClick={() => {
                  setVersao(k);
                  setComparar(null);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="pg-rotulo">Lado a lado</span>
          <div className="pg-seg">
            {COMPARAR.map(([k, l]) => (
              <button key={l} type="button" className={cn(JSON.stringify(comparar) === JSON.stringify(k) && "ativo")} onClick={() => setComparar(k)}>
                {l}
              </button>
            ))}
          </div>
          <span className="pg-rotulo" title="O que o ⓘ da linha abre, na planilha de títulos das versões pedida e recomendada">Detalhes ⓘ</span>
          <div className="pg-seg">
            {VARIANTES_DETALHES.map(([k, l]) => (
              <button key={k} type="button" className={cn(variante === k && "ativo", k === "a" && "destaque")} onClick={() => setVariante(k)}>
                {l}
                {k === "a" && " (recomendada)"}
              </button>
            ))}
          </div>
        </div>
        <div className="pg-linha">
          <span className="pg-rotulo" title="A coluna Regional, ao lado de Empresa, na planilha de títulos e no Extrato das versões pedida e recomendada">Coluna Regional</span>
          <div className="pg-seg">
            {FORMAS_REGIONAL.map(([k, l]) => (
              <button key={k} type="button" className={cn(formaRegional === k && "ativo")} onClick={() => setFormaRegional(k)}>
                {l}
              </button>
            ))}
          </div>
          <span className="pg-rotulo" title="Como a linha da aba Títulos mostra que o título já está no extrato do banco importado (versões recomendada e alternativa)">Sinal do banco</span>
          <div className="pg-seg">
            {[
              ["faixa", "Faixa + ícone (recomendada)"],
              ["icone", "Só o ícone"],
              ["botao", "Só o botão Conciliar"],
            ].map(([k, l]) => (
              <button key={k} type="button" className={cn(sinalBanco === k && "ativo", k === "faixa" && "destaque")} onClick={() => setSinalBanco(k)}>
                {l}
              </button>
            ))}
          </div>
          <span className="pg-rotulo" title="O que a importação do extrato faz sozinha: para decidir">Na importação</span>
          <div className="pg-seg">
            {[
              ["auto", "Baixa sozinho o que é certo"],
              ["sugere", "Só sugere"],
            ].map(([k, l]) => (
              <button key={k} type="button" className={cn(modoImportacao === k && "ativo")} onClick={() => setModoImportacao(k)}>
                {l}
              </button>
            ))}
          </div>
          <span className="pg-rotulo" title="O que “Fechar a conciliação” faz com o período: para decidir">Fechamento</span>
          <div className="pg-seg">
            {[
              ["trava", "Trava até reabrir"],
              ["registra", "Só registra"],
            ].map(([k, l]) => (
              <button key={k} type="button" className={cn(modoFechamento === k && "ativo")} onClick={() => setModoFechamento(k)}>
                {l}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pg-botao"
            title="Pula a conciliação inteira: fecha o período até 19/10 para ver a faixa, o bloqueio e o reabrir"
            onClick={() => {
              fecharPeriodo(DIA_OFX);
              setTela("extrato");
            }}
          >
            Simular fechado até 19/10
          </button>
          <button type="button" className="pg-botao" onClick={() => setNotas((n) => !n)}>
            {notas ? "Esconder notas" : "Mostrar notas"}
          </button>
          <button
            type="button"
            className="pg-botao"
            onClick={() => {
              setTitulos(TITULOS_INICIAIS);
              setFaturas(FATURAS_INICIAIS);
              setLancamentos(LANCAMENTOS_INICIAIS);
              setRegras(REGRAS);
              setBanco({ movimentos: [], importacoes: [], resolucoes: {}, contaId: "cs" });
              setRecusado(null);
              setFechamento(null);
              setPrevia([]);
              setToast("Protótipo recomeçado: nenhuma baixa, nenhum extrato importado.");
            }}
          >
            Recomeçar
          </button>
        </div>
        {notas && (
          <div className="pg-notas">
            {versoesNaTela.map((v) => (
              <div key={v} className="pg-nota">
                <strong>{VERSOES.find(([k]) => k === v)[1]}</strong>
                <ul>
                  {notasDaTela[v].map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {comparar ? (
        <div className="pg-lado">
          {comparar.map((v) => (
            <Painel key={v} rotulo={VERSOES.find(([k]) => k === v)[1]}>
              {renderTela(v)}
            </Painel>
          ))}
        </div>
      ) : (
        <div className="pg-janela">
          <Sidebar />
          <main className="min-w-0 flex-1 px-4 py-8 md:px-10 lg:px-16">
            <div className="mx-auto max-w-[1700px]">
              {renderTela(versao)}
            </div>
          </main>
        </div>
      )}

      {/* Diálogos (do painel que os abriu) */}
      {dialogo?.tipo === "baixa" && (
        <BaixaDialog
          aberto
          itens={dialogo.itens}
          contaInicial={dialogo.linha ? banco.contaId : "cs"}
          versao={dialogo.versao}
          lancamentos={lancamentos}
          saldoInicial={SALDO_INICIAL_OUTUBRO}
          dataInicial={dialogo.dataInicial}
          juros={dialogo.juros}
          retencao={dialogo.retencao ?? null}
          valorDoBanco={dialogo.linha ? Math.abs(dialogo.linha.mov.valor) : null}
          origemOfx={dialogo.linha ? `${dataBR(dialogo.linha.mov.data)} · ${dialogo.linha.mov.historico.replace(/\s{2,}.*$/, "")} · ${moeda(Math.abs(dialogo.linha.mov.valor))}` : null}
          formaDoBanco={dialogo.linha ? formaDoHistorico(dialogo.linha.mov.historico) : null}
          faturas={faturas}
          fechadoAte={fechadoAte}
          modoFechamento={modoFechamento}
          onFechar={() => setDialogo(null)}
          onConfirmar={(p) => {
            if (p.forma === "cartao") {
              baixarNoCartao(p.itens, p);
              dialogo.limpar?.();
              setDialogo(null);
              return;
            }
            const ls = baixar(p.itens, p, !!dialogo.linha);
            const fat = p.itens.find((t) => t.faturaId)?.faturaId;
            if (fat) setFaturas((fs) => fs.map((f) => (f.id === fat ? { ...f, status: "paga", pagaEm: p.data, pagaPor: p.contaId } : f)));
            if (dialogo.linha) resolver(dialogo.linha.digital, { estado: "conciliado", texto: `Baixa de ${descricaoDoLancamento(p.itens[0])}`, lancIds: ls.map((l) => l.id), tituloIds: p.itens.map((t) => t.id) });
            dialogo.limpar?.();
            setDialogo(null);
            setToast(dialogo.linha ? `Conciliado: ${p.itens.length > 1 ? `as ${p.itens.length} baixas entraram` : "a baixa entrou"} no Extrato com a data do banco (${dataBR(p.data)}).` : avisoDaBaixa(p.contaId, p.data, p.itens.length));
          }}
        />
      )}
      <PagamentoAvulsoDialog aberto={dialogo?.tipo === "novo_pagamento"} inicial={dialogo?.inicial} onFechar={() => setDialogo(null)} onCriar={criarTitulo} />
      <RecebimentoAvulsoDialog aberto={dialogo?.tipo === "novo_recebimento"} tipoInicial={dialogo?.tipoReceb ?? "avulso"} inicial={dialogo?.inicial} onFechar={() => setDialogo(null)} onCriar={criarTitulo} />
      <ImpostoAvulsoDialog aberto={dialogo?.tipo === "novo_imposto"} onFechar={() => setDialogo(null)} onCriar={criarTitulo} />
      <RecorrenciaDialog
        aberto={dialogo?.tipo === "nova_recorrencia"}
        onFechar={() => setDialogo(null)}
        onCriar={() => {
          setDialogo(null);
          setToast("Recorrência criada. O primeiro título aparece aqui 30 dias antes do vencimento.");
        }}
      />
      <AntesDaNfDialog
        aberto={dialogo?.tipo === "antes_nf"}
        onFechar={() => setDialogo(null)}
        onConfirmar={() => {
          setDialogo(null);
          setToast("Recebimento registrado. Quando a NF sair, ele vira a parcela 1, já recebida.");
        }}
      />
      <RemessaDialog
        aberto={dialogo?.tipo === "remessa"}
        titulos={titulos}
        onFechar={() => setDialogo(null)}
        onGerar={() => {
          setDialogo(null);
          setToast("Arquivo da remessa gerado. A baixa vem depois, pela conciliação com o banco.");
        }}
      />
      {docsDe && (
        <VisualizadorDeDocumentos t={docsDe.t} docs={documentosDe(docsDe.t)} inicial={docsDe.inicial} onFechar={() => setDocsDe(null)} />
      )}
      {acao && (
        <AcaoDialog
          acao={acao.acao}
          titulo={acao.titulo}
          onFechar={() => setAcao(null)}
          onAplicar={(novo, msg) => {
            setTitulos((ts) => (novo ? ts.map((t) => (t.id === acao.titulo.id ? novo : t)) : ts.filter((t) => t.id !== acao.titulo.id)));
            setAcao(null);
            setToast(msg);
          }}
        />
      )}
      {procurando && (
        <ProcurarTitulo
          r={procurando}
          titulos={titulos}
          onFechar={() => setProcurando(null)}
          onEscolher={(ts, retencao) => {
            // Um título: o banco pagou mais (juros, já conferidos na busca)
            // ou menos (retenção na fonte, ou a baixa abre parcial). Vários:
            // a soma bate.
            const dif = ts.length === 1 ? r2(Math.abs(procurando.mov.valor) - aberto(ts[0])) : 0;
            setDialogo({ tipo: "baixa", itens: ts, versao: versao === "atual" ? "pedida" : versao, linha: procurando, dataInicial: procurando.mov.data, juros: dif > 0 ? dif : 0, retencao: retencao ?? null });
            setProcurando(null);
          }}
        />
      )}
      {corrigindo && (
        <CorrigirBaixaDialog r={corrigindo} titulo={titulos.find((t) => t.id === corrigindo.lancamento.tituloId)} onFechar={() => setCorrigindo(null)} onConfirmar={(motivo) => corrigirBaixa(corrigindo, motivo)} />
      )}
      {reabrindo && fechamento && <ReabrirDialog fechamento={fechamento} onFechar={() => setReabrindo(false)} onConfirmar={reabrirPeriodo} />}
      <Toast texto={toast} onFechar={() => setToast(null)} />
    </div>
    </DetalhesContexto.Provider>
  );
}

/** Um painel do lado a lado: a tela inteira, reduzida para caber. */
function Painel({ rotulo, children }) {
  const ref = React.useRef(null);
  const [zoom, setZoom] = React.useState(0.6);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, Math.max(0.35, e.contentRect.width / 1640))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <section className="pg-painel" ref={ref}>
      <header className="pg-painel-rotulo">{rotulo}</header>
      <div style={{ zoom }} className="px-8 py-6">
        {children}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
