/** Paleta dos blocos das planilhas — Orçamento e Job, individuais e agregadas.
 *
 *  Uma cor por bloco, a mesma em todo o produto: ORÇADO azul, PLANEJADO
 *  verde, REALIZADO laranja. RENTABILIDADE fica em grafite de propósito —
 *  não é um bloco de entrada, é o resultado da conta, e o neutro diz isso
 *  sem competir com os outros três.
 *
 *  Sem "use client": as planilhas são client, os cards de Totais são
 *  server, e os dois lados importam daqui. As classes são literais para o
 *  Tailwind conseguir varrer (`./app/**\/*.{ts,tsx}` no content).
 */

export interface Bloco {
  /** Faixa do bloco — 1ª linha do thead, onde vive o rótulo. */
  faixa: string;
  /** Sub-cabeçalho: 1ª coluna do bloco, a que abre com a borda grossa. */
  cabecalhoAbre: string;
  /** Sub-cabeçalho: colunas do meio (QT, D/M). */
  cabecalhoMeio: string;
  /** Sub-cabeçalho: última coluna (Total) — sem borda à direita. */
  cabecalhoFim: string;
  /** Linha de item: 1ª célula do bloco. */
  celulaAbre: string;
  /** Linha de item: células do meio. */
  celulaMeio: string;
  /** Linha de item: célula de Total, com o valor na cor do bloco. */
  celulaTotal: string;
  /** Célula vazia que cobre as colunas de detalhe nos cards de Totais. */
  celulaVazia: string;
  /** Linha de subtotal/total: célula vazia, fundo forte e linha de topo. */
  subtotalVazio: string;
  /** Linha de subtotal/total: célula do valor. */
  subtotalValor: string;
  /** Linha do GRUPO dentro da tabela única: célula vazia. Mesmo fundo
   *  forte do subtotal, mas com fios de 1px em cima e embaixo — ela
   *  separa dois trechos de itens, não fecha a tabela. */
  grupoVazio: string;
  /** Linha do GRUPO: célula do valor (subtotal do agrupamento). */
  grupoValor: string;
  /** Cor do bloco para rótulos e valores fora da tabela. */
  texto: string;
  /** Variação suave, para rótulos pequenos. */
  textoSuave: string;
  /** Borda de abertura, para faixas de resumo fora da tabela. */
  bordaAbre: string;
}

/** Azul — o que foi vendido ao cliente. */
export const ORCADO: Bloco = {
  faixa:
    "text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]",
  cabecalhoAbre:
    "text-[#5a76a8] bg-[#f5f9ff] border-l-2 border-l-[#cfe0f7] border-r border-r-[#dfeafb]",
  cabecalhoMeio: "text-[#5a76a8] bg-[#f5f9ff] border-r border-r-[#dfeafb]",
  cabecalhoFim: "text-[#5a76a8] bg-[#f5f9ff]",
  celulaAbre:
    "bg-[#f7fbff] border-l-2 border-l-[#cfe0f7] border-r border-r-[#e6eff9]",
  celulaMeio: "bg-[#f7fbff] border-r border-r-[#e6eff9]",
  celulaTotal: "bg-[#f7fbff] text-[#1e4fa3]",
  celulaVazia: "bg-[#f7fbff] border-l-2 border-l-[#cfe0f7]",
  subtotalVazio:
    "bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t-2 border-t-[#2f6fdb]",
  subtotalValor: "bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb] text-[#1e4fa3]",
  grupoVazio:
    "bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-y border-y-[#cfe0f7]",
  grupoValor: "bg-[#e8f0fd] border-y border-y-[#cfe0f7] text-[#1e4fa3]",
  texto: "text-[#1e4fa3]",
  textoSuave: "text-[#5a76a8]",
  bordaAbre: "border-l-2 border-l-[#b9d1f4]",
};

/** Verde — o que a agência planeja desembolsar. */
export const PLANEJADO: Bloco = {
  faixa:
    "text-[#047857] bg-[#ecfdf5] border-b-[3px] border-b-[#059669] border-l-2 border-l-[#a7f3d0]",
  cabecalhoAbre:
    "text-[#3f8a70] bg-[#f3fdf8] border-l-2 border-l-[#bdecd6] border-r border-r-[#dcf5e8]",
  cabecalhoMeio: "text-[#3f8a70] bg-[#f3fdf8] border-r border-r-[#dcf5e8]",
  cabecalhoFim: "text-[#3f8a70] bg-[#f3fdf8]",
  celulaAbre:
    "bg-[#f6fefa] border-l-2 border-l-[#bdecd6] border-r border-r-[#e4f7ed]",
  celulaMeio: "bg-[#f6fefa] border-r border-r-[#e4f7ed]",
  celulaTotal: "bg-[#f6fefa] text-[#047857]",
  celulaVazia: "bg-[#f6fefa] border-l-2 border-l-[#bdecd6]",
  subtotalVazio:
    "bg-[#ecfdf5] border-l-2 border-l-[#a7f3d0] border-t-2 border-t-[#059669]",
  subtotalValor: "bg-[#ecfdf5] border-t-2 border-t-[#059669] text-[#047857]",
  grupoVazio:
    "bg-[#ecfdf5] border-l-2 border-l-[#a7f3d0] border-y border-y-[#bdecd6]",
  grupoValor: "bg-[#ecfdf5] border-y border-y-[#bdecd6] text-[#047857]",
  texto: "text-[#047857]",
  textoSuave: "text-[#3f8a70]",
  bordaAbre: "border-l-2 border-l-[#a7f3d0]",
};

/** Laranja — o terceiro momento da mesma linha, o que de fato saiu. */
export const REALIZADO: Bloco = {
  faixa:
    "text-[#c2410c] bg-[#ffedd5] border-b-[3px] border-b-[#ea580c] border-l-2 border-l-[#f9c296]",
  cabecalhoAbre:
    "text-[#c2410c] bg-[#fff7ed] border-l-2 border-l-[#f9c296] border-r border-r-[#fbd8b8]",
  cabecalhoMeio: "text-[#c2410c] bg-[#fff7ed] border-r border-r-[#fbd8b8]",
  cabecalhoFim: "text-[#c2410c] bg-[#fff7ed]",
  celulaAbre:
    "bg-[#fffaf5] border-l-2 border-l-[#f9c296] border-r border-r-[#fbe4d2]",
  celulaMeio: "bg-[#fffaf5] border-r border-r-[#fbe4d2]",
  celulaTotal: "bg-[#fffaf5] text-[#c2410c]",
  celulaVazia: "bg-[#fffaf5] border-l-2 border-l-[#f9c296]",
  subtotalVazio:
    "bg-[#ffedd5] border-l-2 border-l-[#f9c296] border-t-2 border-t-[#ea580c]",
  subtotalValor: "bg-[#ffedd5] border-t-2 border-t-[#ea580c] text-[#c2410c]",
  grupoVazio:
    "bg-[#ffedd5] border-l-2 border-l-[#f9c296] border-y border-y-[#f9c296]",
  grupoValor: "bg-[#ffedd5] border-y border-y-[#f9c296] text-[#c2410c]",
  texto: "text-[#c2410c]",
  textoSuave: "text-[#9a5a33]",
  bordaAbre: "border-l-2 border-l-[#f9c296]",
};

/** Grafite — resultado da conta, não um quarto status. */
export const RENTABILIDADE: Bloco = {
  faixa:
    "text-[#282828] bg-[#eceae5] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#c9c6bf]",
  cabecalhoAbre:
    "text-[#5f5d57] bg-[#f3f2ef] border-l-2 border-l-[#c9c6bf] border-r border-r-[#e2e0da]",
  cabecalhoMeio: "text-[#5f5d57] bg-[#f3f2ef] border-r border-r-[#e2e0da]",
  cabecalhoFim: "text-[#5f5d57] bg-[#f3f2ef]",
  celulaAbre:
    "bg-[#f7f6f3] border-l-2 border-l-[#c9c6bf] border-r border-r-[#e2e0da]",
  celulaMeio: "bg-[#f7f6f3] border-r border-r-[#e2e0da]",
  celulaTotal: "bg-[#f7f6f3] text-[#282828]",
  celulaVazia: "bg-[#f7f6f3] border-l-2 border-l-[#c9c6bf]",
  subtotalVazio:
    "bg-[#eceae5] border-l-2 border-l-[#c9c6bf] border-t-2 border-t-[#282828]",
  subtotalValor: "bg-[#eceae5] border-t-2 border-t-[#282828] text-[#282828]",
  grupoVazio:
    "bg-[#eceae5] border-l-2 border-l-[#c9c6bf] border-y border-y-[#dcd9d2]",
  grupoValor: "bg-[#eceae5] border-y border-y-[#dcd9d2] text-[#282828]",
  texto: "text-[#282828]",
  textoSuave: "text-[#5f5d57]",
  bordaAbre: "border-l-2 border-l-[#c9c6bf]",
};

/** Rótulo da faixa — mesma tipografia nos quatro blocos. */
export const FAIXA_ROTULO =
  "text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case";

/** Célula do nome do agrupamento, que agora divide a faixa com os blocos.
 *  Fundo branco: ela não pertence a nenhum bloco, é a âncora da linha. */
export const FAIXA_GRUPO =
  "text-left px-6 py-2 bg-card border-b border-border normal-case";

/** Rentabilidade sempre em grafite — positiva ou negativa. O sinal já está
 *  no número; a cor não precisa repetir e ainda brigaria com o verde do
 *  PLANEJADO. Decisão do time, 11/08/2026. */
export const RENTAB_VALOR = "text-[#282828]";

/** Célula do NOME do agrupamento na tabela única — a que abre a linha de
 *  grupo, à esquerda dos blocos. Neutra de propósito: o grupo não
 *  pertence a ORÇADO nem a PLANEJADO, ele atravessa os dois. Os fios de
 *  1px em cima e embaixo são os mesmos do `grupoVazio` dos blocos, para
 *  a linha inteira fechar no mesmo nível. */
export const LINHA_GRUPO_NOME =
  "text-left px-3 bg-[#f3f2ee] border-t border-t-[#e3e1db] border-b border-b-border normal-case";

/** Célula do rótulo do TOTAL da planilha — a última linha da tabela, no
 *  `tfoot`. Fundo igual ao da linha de grupo, mas com o fio grosso de
 *  topo: é ele que diz "aqui a planilha fecha". */
export const LINHA_TOTAL_ROTULO =
  "text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-foreground bg-[#f3f2ee] border-t-2 border-t-foreground";

/** Linha tracejada do "Novo grupo", no pé do corpo da tabela — depois do
 *  último grupo e antes do total. Ela mostra ONDE o grupo vai nascer, e
 *  fecha a simetria com o "＋ Novo item" que encerra cada agrupamento. */
export const LINHA_NOVO_GRUPO =
  "px-3 py-2 border-t border-t-[#e3e1db] bg-[#fcfcfb]";

/** O gatilho que mora nessa linha. Tracejado e leve de propósito: ali
 *  dentro um botão sólido seria o elemento mais pesado da planilha e
 *  competiria com os números. As duas origens de "Novo grupo" — o drawer
 *  da versão e o botão local do rascunho — usam esta mesma forma. */
export const BOTAO_NOVO_GRUPO =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-california-red bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red transition-colors hover:bg-california-red/10 disabled:cursor-not-allowed disabled:opacity-50";
