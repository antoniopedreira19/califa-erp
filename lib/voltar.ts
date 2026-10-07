/**
 * Botão Voltar — decisão 108.
 *
 * Aqui mora só a regra: o rastro das páginas por onde a pessoa passou nesta
 * aba do navegador, e para onde o voltar leva a partir dele. O estado que
 * vive no navegador (sessionStorage, eventos) está em
 * `components/voltar/estado.ts`; o botão, em `components/voltar/botao-voltar.tsx`.
 *
 * As regras, decididas pelo Tiago em 27/09/2026:
 * 1. O voltar leva à PÁGINA anterior. Aba, filtro, versão, mês, drawer e
 *    pop-up não são página: trocar só a query da URL continua na mesma.
 * 2. As abas da faixa do projeto (decisão 106) são da mesma sessão: o voltar
 *    as pula e leva para onde a pessoa estava antes de entrar no projeto.
 * 3. Se a página anterior é a Home, o voltar vai para o início do módulo —
 *    a reserva de cada tela, que é o voltar fixo de antes.
 * 4. Sem página anterior (link colado, aba nova), vale a mesma reserva.
 */

/** O rastro de uma aba do navegador. `entradas` guarda a URL de cada
 *  página visitada (caminho + query), e `cursor` aponta a atual. */
export interface Rastro {
  entradas: string[];
  cursor: number;
  /** Índice para onde o botão Voltar acabou de mandar a pessoa. Quando a
   *  URL chegar lá, o rastro é cortado ali em vez de ganhar uma entrada
   *  nova — senão o voltar seguinte levaria de volta à tela de onde se
   *  saiu. */
  pendente: number | null;
}

/** O que uma página diz de si mesma, por caminho: o grupo da faixa do
 *  projeto a que pertence e o nome que aparece no balão do voltar. */
export interface MarcaDaPagina {
  grupo?: string;
  rotulo?: string;
}
export type Marcas = Record<string, MarcaDaPagina>;

export const RASTRO_VAZIO: Rastro = { entradas: [], cursor: -1, pendente: null };

/** Mais que isso ninguém volta clicando; o que passa sai pelo começo. */
const LIMITE_DO_RASTRO = 60;

export function caminhoDe(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

function parametrosDe(url: string): URLSearchParams {
  const i = url.indexOf("?");
  return new URLSearchParams(i === -1 ? "" : url.slice(i + 1).split("#")[0]);
}

/**
 * Duas URLs são a mesma página quando só a query muda: aba, filtro,
 * versão, mês, pop-up aberto pela URL. A exceção é a Conciliação, em que o
 * `?conta=` troca a lista de contas pelo extrato de uma conta — outra
 * página, com voltar próprio (decisão 091).
 */
export function chaveDaPagina(url: string): string {
  const caminho = caminhoDe(url);
  if (caminho === "/financeiro/conciliacao" && parametrosDe(url).get("conta")) {
    return `${caminho}#extrato`;
  }
  return caminho;
}

/**
 * Rotas que só redirecionam e não têm tela: nunca entram no rastro, senão o
 * voltar mandaria para elas e elas devolveriam a pessoa à mesma página.
 */
const SO_REDIRECIONAM = [
  /^\/orcamentos\/[^/]+\/[^/]+\/versoes\/[^/]+$/,
  /^\/financeiro\/jobs-aguardando-abertura$/,
];

/**
 * Registra uma URL nova no rastro.
 *
 * - Mesma página (só a query mudou): a entrada é atualizada, não somada. É
 *   o que faz o voltar devolver a lista na aba em que a pessoa estava.
 * - Chegada ao destino do botão Voltar (`pendente`): o rastro é cortado ali.
 * - Voltar/avançar do navegador (`popstate`): o cursor anda para a vizinha,
 *   se for ela. Senão, conta como página nova.
 * - `substituirAtual`: a página atual acabou de chegar e já foi trocada —
 *   foi um redirecionamento (página que manda para outra ao abrir), e a
 *   nova toma o lugar dela em vez de somar.
 */
export function registrarNavegacao(
  rastro: Rastro,
  url: string,
  opts: { popstate: boolean; substituirAtual?: boolean },
): Rastro {
  if (SO_REDIRECIONAM.some((r) => r.test(caminhoDe(url)))) return rastro;
  const { entradas, cursor, pendente } = rastro;
  const atual = entradas[cursor];
  if (atual === undefined) return { entradas: [url], cursor: 0, pendente: null };
  if (url === atual) return rastro;

  if (pendente !== null && entradas[pendente] === url) {
    return { entradas: entradas.slice(0, pendente + 1), cursor: pendente, pendente: null };
  }

  const chave = chaveDaPagina(url);
  if (chave === chaveDaPagina(atual)) {
    const novas = [...entradas];
    novas[cursor] = url;
    return { entradas: novas, cursor, pendente: null };
  }

  if (opts.popstate) {
    for (const vizinho of [cursor - 1, cursor + 1]) {
      const e = entradas[vizinho];
      if (e !== undefined && chaveDaPagina(e) === chave) {
        const novas = [...entradas];
        novas[vizinho] = url;
        return { entradas: novas, cursor: vizinho, pendente: null };
      }
    }
  }

  if (opts.substituirAtual && cursor > 0) {
    const novas = [...entradas.slice(0, cursor), url];
    return { entradas: novas, cursor, pendente: null };
  }

  const novas = [...entradas.slice(0, cursor + 1), url].slice(-LIMITE_DO_RASTRO);
  return { entradas: novas, cursor: novas.length - 1, pendente: null };
}

export interface DestinoDoVoltar {
  href: string;
  /** Posição do destino no rastro; `null` quando é a reserva. */
  indice: number | null;
}

/**
 * Para onde o voltar da página atual leva.
 *
 * Anda o rastro para trás a partir da página atual, pulando o que é a mesma
 * página e o que é do mesmo grupo da faixa do projeto. A primeira página
 * diferente é o destino — com a URL completa de quando a pessoa saiu dela,
 * então a aba e os filtros que estão na URL voltam junto. Se essa página é
 * a Home, ou se não há nenhuma, vale a `reserva`.
 */
export function destinoDoVoltar(
  rastro: Rastro,
  marcas: Marcas,
  urlAtual: string,
  reserva: string,
): DestinoDoVoltar {
  const semRastro = { href: reserva, indice: null };
  const atual = rastro.entradas[rastro.cursor];
  // O rastro só vale se estiver nesta página. Não está quando a tela abriu
  // antes de o rastro ser gravado — no primeiro instante da página.
  if (atual === undefined || chaveDaPagina(atual) !== chaveDaPagina(urlAtual)) {
    return semRastro;
  }

  const chave = chaveDaPagina(atual);
  const grupo = marcas[caminhoDe(atual)]?.grupo;
  for (let i = rastro.cursor - 1; i >= 0; i--) {
    const entrada = rastro.entradas[i];
    if (chaveDaPagina(entrada) === chave) continue;
    if (grupo && marcas[caminhoDe(entrada)]?.grupo === grupo) continue;
    if (caminhoDe(entrada) === "/home") return semRastro;
    return { href: entrada, indice: i };
  }
  return semRastro;
}

/** Marca o índice de destino antes de o botão navegar. */
export function marcarVoltar(rastro: Rastro, indice: number | null): Rastro {
  return { ...rastro, pendente: indice };
}

// ---------------------------------------------------------------------------
// Nome da página, para o balão do botão ("Voltar para …").
// ---------------------------------------------------------------------------

const ID = "[^/]+";

/** Da mais específica para a mais geral: a primeira que casa vale. */
const NOMES: Array<[RegExp, string | ((url: string) => string)]> = [
  [/^\/home$/, "Home"],

  [/^\/orcamentos$/, "Projetos"],
  [/^\/orcamentos\/novo$/, "Novo projeto"],
  [/^\/orcamentos\/categorias$/, "Categorias"],
  [new RegExp(`^/orcamentos/${ID}/novo$`), "Novo orçamento"],
  [new RegExp(`^/orcamentos/${ID}/agregado$`), "Visão agregada"],
  [new RegExp(`^/orcamentos/${ID}/${ID}$`), "o orçamento"],
  [new RegExp(`^/orcamentos/${ID}$`), "o projeto"],

  [/^\/jobs$/, "Jobs"],
  [new RegExp(`^/jobs/projeto/${ID}$`), "Visão agregada"],
  [new RegExp(`^/jobs/${ID}$`), "o job"],

  [/^\/financeiro$/, "Central Financeira"],
  [
    /^\/financeiro\/abertura-de-job$/,
    (url) => {
      const aba = parametrosDe(url).get("aba");
      if (aba === "abertos") return "Visualizar Jobs";
      if (aba === "calendario") return "Calendário de Jobs";
      if (aba === "aguardando") return "Fila de abertura";
      return "Abertura de Job";
    },
  ],
  [new RegExp(`^/financeiro/abertura-de-job/${ID}/planilha$`), "a planilha da abertura"],
  [new RegExp(`^/financeiro/abertura-de-job/${ID}$`), "a abertura do job"],
  [/^\/financeiro\/cadastros$/, "Cadastros do financeiro"],
  [/^\/financeiro\/cadastros\/contas-bancarias$/, "Contas bancárias"],
  [/^\/financeiro\/cadastros\/cartoes-credito$/, "Cartões de crédito"],
  [/^\/financeiro\/cadastros\/plano-de-contas$/, "Plano de contas"],
  [
    /^\/financeiro\/conciliacao$/,
    (url) => (parametrosDe(url).get("conta") ? "o extrato da conta" : "Conciliação"),
  ],
  [/^\/financeiro\/contas-a-pagar$/, "Contas a Pagar"],
  [new RegExp(`^/financeiro/contas-a-pagar/avulsa/${ID}$`), "a conta avulsa"],
  [new RegExp(`^/financeiro/contas-a-pagar/recorrente/${ID}$`), "a recorrência"],
  [/^\/financeiro\/contas-a-receber$/, "Contas a Receber"],
  [/^\/financeiro\/desembolsos$/, "Desembolsos"],
  [new RegExp(`^/financeiro/desembolsos/${ID}$`), "o desembolso"],
  [/^\/financeiro\/fluxo-caixa$/, "Fluxo de Caixa"],
  [new RegExp(`^/financeiro/jobs/${ID}$`), "o job"],
  [new RegExp(`^/financeiro/projetos/${ID}$`), "Visão agregada"],

  [/^\/relatorios$/, "Relatórios"],
  [/^\/relatorios\/faturamento$/, "Relatório de Faturamento"],
  [/^\/relatorios\/rentabilidade$/, "Relatório de Rentabilidade"],

  [/^\/rh$/, "RH"],
  [/^\/rh\/colaboradores$/, "Colaboradores"],
  [/^\/rh\/colaboradores\/novo$/, "Novo colaborador"],
  [/^\/rh\/colaboradores\/niveis$/, "Níveis"],
  [new RegExp(`^/rh/colaboradores/${ID}$`), "o colaborador"],
  [/^\/rh\/folhas$/, "Folhas de pagamento"],
  [new RegExp(`^/rh/folhas/${ID}$`), "a folha"],

  [/^\/cadastros$/, "Cadastros"],
  [/^\/cadastros\/cidades$/, "Cidades"],
  [/^\/cadastros\/veiculos$/, "Veículos"],
  [/^\/cadastros\/veiculos\/novo$/, "Novo veículo"],
  [new RegExp(`^/cadastros/veiculos/${ID}$`), "o veículo"],
  [/^\/clientes$/, "Clientes"],
  [/^\/clientes\/novo$/, "Novo cliente"],
  [new RegExp(`^/clientes/${ID}$`), "o cliente"],
  [/^\/fornecedores$/, "Fornecedores"],
  [/^\/fornecedores\/novo$/, "Novo fornecedor"],
  [new RegExp(`^/fornecedores/${ID}$`), "o fornecedor"],

  [/^\/admin$/, "Administração"],
  [/^\/admin\/empresas$/, "Empresas"],
  [/^\/admin\/rateios-regionais$/, "Rateios regionais"],
  [/^\/admin\/usuarios$/, "Usuários"],
  [/^\/admin\/usuarios\/permissoes$/, "Matriz de permissões"],
  [/^\/configuracoes$/, "Configurações"],
];

/** Nome da página no balão do voltar: o que ela mesma registrou (código e
 *  nome do job, do orçamento, do projeto) ou o nome da rota. */
export function nomeDaPagina(url: string, marcas: Marcas): string {
  const caminho = caminhoDe(url);
  const registrado = marcas[caminho]?.rotulo;
  if (registrado) return registrado;
  for (const [padrao, nome] of NOMES) {
    if (padrao.test(caminho)) return typeof nome === "string" ? nome : nome(url);
  }
  return "a página anterior";
}
