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

/** SAVE — a coluna e os estados de linha do crédito entre jobs.
 *
 *  Não é um quinto bloco: é uma **calha de estado**, e por isso empresta o
 *  grafite da RENTABILIDADE em vez de estrear uma cor. Save não é um
 *  momento da linha (como orçado, planejado e realizado); é uma marca
 *  sobre ela, e o neutro diz isso sem competir com os três.
 *
 *  A distinção entre gerar e consumir fica na TEXTURA, não no matiz:
 *
 *  - **gera save** → hachura diagonal. O serviço não acontece aqui, e a
 *    linha listrada diz "vendido, mas não executado neste projeto" sem
 *    precisar de legenda.
 *  - **consome save** → fundo grafite claro, cheio. A linha acontece
 *    aqui; o que veio de fora é o dinheiro.
 *
 *  Do design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *  `69342d83`), 26/08/2026.
 */
export const SAVE = {
  /** Célula da coluna na FAIXA dos blocos — vazia, e branca como a faixa
   *  do agrupamento ao lado. A coluna não é um bloco e não ganha rótulo
   *  lá em cima: quem a nomeia é o sub-cabeçalho, uma linha abaixo, junto
   *  de "Grupo · Item" e "Tipo". */
  faixaVazia: "bg-card border-b border-b-[#e8e7e3] border-r border-r-[#e2e0da]",
  /** SUB-cabeçalho da coluna — é aqui que "Save" aparece escrito. O cinza
   *  é um degrau mais claro que o dos irmãos (#6b6b6b) porque a coluna é
   *  calha de estado: o rótulo situa, mas não disputa com "Grupo · Item". */
  cabecalho:
    "text-center p-0 font-semibold text-[#8a8880] border-b border-b-[#e8e7e3] border-r border-r-[#e2e0da]",
  /** A alça na borda esquerda da planilha com a coluna ABERTA: discreta,
   *  só o chevron apontando para onde a coluna vai sumir. */
  alca: "mt-10 h-[34px] w-[15px] items-center justify-center rounded-l-[7px] border border-r-0 border-[#dedcd7] bg-[#f3f2ee] text-[#6b6b6b]",
  /** A mesma alça com a coluna RECOLHIDA: mais alta e mais escura, porque
   *  passa a ser a única coisa que lembra que a coluna existe — e é por
   *  isso que só neste estado ela carrega o rótulo. */
  alcaRecolhida:
    "mt-10 h-[94px] w-[15px] flex-col items-center justify-center gap-[5px] rounded-l-[7px] border border-r-0 border-[#c9c6bf] bg-[#eceae5] text-[#282828]",
  /** As letras S-A-V-E empilhadas dentro da alça recolhida. Empilhadas, e
   *  não rotacionadas: a alça tem 15px de largura e texto girado dentro
   *  dela sai da caixa em vez de caber. */
  alcaRotulo:
    "flex flex-col items-center text-[8px] font-bold leading-[1.25] tracking-[.02em]",
  /** Célula da coluna Save numa linha qualquer. */
  celula: "text-center border-r border-r-[#e8e7e3]",
  /** Textura da linha que GERA save — aplicada na célula do Save e nas
   *  células de texto da linha. */
  hachura:
    "bg-[repeating-linear-gradient(135deg,rgba(40,40,40,.055)_0_3px,transparent_3px_7px)]",
  /** Fundo da linha que CONSOME save. */
  linhaConsome: "bg-[#f7f6f3]",
  /** Borda que abre a célula do Save numa linha consumidora. */
  bordaConsome: "border-l-2 border-l-[#5f5d57]",
  /** Botão "ainda não definido": tracejado no vermelho California, porque
   *  é a única ação de criação da coluna. */
  botaoVazio:
    "inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border border-dashed border-california-red bg-california-red/[0.07] text-california-red",
  /** Botão da linha que gera save e ainda não tem destino: grafite cheio. */
  botaoGera:
    "inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border border-[#5f5d57] bg-[#5f5d57] text-white",
  /** Botão que mostra o código do job, nas duas direções. */
  botaoCodigo:
    "inline-flex items-center gap-px font-mono text-[9px] font-bold tracking-[-.04em] text-foreground",
  /** Pastilha "+N" quando a linha consome de mais de uma origem. */
  pastilhaMais:
    "inline-flex items-center justify-center ml-0.5 min-w-[13px] h-3 px-0.5 rounded-[3px] bg-[#5f5d57] text-white font-mono text-[8px] font-bold",
  /** Texto apagado da linha em save — ela não tem custo a mostrar. */
  textoApagado: "text-[#5f5d57]",
  /** Cor do ícone de direção. */
  icone: "text-[#5f5d57]",
} as const;

/** ERRATA — o modo de edição do Orçado na planilha do job.
 *
 *  Não é um bloco novo: é um ESTADO da planilha, e por isso não estreia
 *  cor. Quem muda de tom é só o bloco ORÇADO, que fica um degrau mais
 *  saturado enquanto está editável — o azul continua sendo o azul do
 *  orçado, e a diferença diz "isto aqui aceita digitação".
 *
 *  A exceção é a LINHA VERMELHA. Ela não é decoração: é a linha que nasce
 *  sem orçado e sem planejado e só recebe realizado, por Pedido de
 *  Produção. O vermelho é o mesmo vermelho California do resto do
 *  produto, aplicado à linha inteira porque a linha inteira se comporta
 *  de um jeito diferente das outras.
 *
 *  Do design `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto
 *  Claude Design `69342d83`), 27/08/2026.
 */
export const ERRATA = {
  /** Célula do bloco Orçado enquanto ela aceita digitação. */
  celulaEditavel: "bg-[#eff6ff]",
  /** O input dentro da célula do Orçado. */
  input:
    "w-full min-w-0 rounded-md border border-[#9dc0ee] bg-white px-1.5 py-1 text-right font-mono text-[11.5px] font-semibold text-[#1e4fa3] outline-none focus:border-[#2f6fdb] focus:ring-1 focus:ring-[#2f6fdb]/30",
  /** Input do nome, na linha recém-criada. */
  inputNome:
    "w-full min-w-0 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground outline-none focus:border-california-red focus:ring-1 focus:ring-california-red/25",
  /** Linha inteira, quando é vermelha. */
  linhaVermelha: "bg-[#fef2f2]",
  /** Célula de texto de uma linha vermelha. */
  celulaVermelha: "bg-[#fef2f2] text-[#b91c1c] border-r border-r-[#fecaca]",
  /** Célula de número de uma linha vermelha — apagada no Orçado e no
   *  Planejado, viva só no Realizado, que é o único que ela recebe. */
  celulaVermelhaApagada: "bg-[#fef2f2] text-[#c88] border-r border-r-[#fecaca]",
  celulaVermelhaViva:
    "bg-[#fef2f2] text-[#b91c1c] border-r border-r-[#fecaca]",
  /** Linha tracejada dos botões de criar item, no pé de cada grupo. */
  linhaAcao: "px-3 py-2 bg-[#fcfcfb] border-b border-b-border",
  /** "＋ Novo item" — mesma forma do "Novo grupo", que já existia. */
  botaoNovoItem: BOTAO_NOVO_GRUPO,
  /** "＋ Linha vermelha" — tracejado, mas no vermelho mais forte, porque
   *  a linha que ele cria se comporta de outro jeito. */
  botaoLinhaVermelha:
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-[#dc2626] bg-[#fef2f2] px-3 py-1.5 text-xs font-semibold text-[#b91c1c] transition-colors hover:bg-[#fee2e2] disabled:cursor-not-allowed disabled:opacity-50",
  /** Pastilha que marca a linha na tabela e no pop-up. */
  tagAlterada:
    "inline-flex items-center rounded-full border border-[#f3b4b9] bg-[#fdf2f3] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#b83b45]",
  tagNova:
    "inline-flex items-center rounded-full border border-[#a7f3d0] bg-[#ecfdf5] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#047857]",
  tagVermelha:
    "inline-flex items-center rounded-full border border-[#fca5a5] bg-[#fef2f2] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#b91c1c]",
  tagRemovida:
    "inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-muted-foreground",
  /** Botão "Alterar orçado" enquanto o modo está LIGADO. */
  botaoAtivo:
    "inline-flex items-center gap-1.5 rounded-lg border border-california-red bg-california-red/[0.07] px-3 py-1.5 text-xs font-bold text-[#b83b45] shadow-[inset_0_1px_2px_rgba(231,75,86,0.18)]",
} as const;
