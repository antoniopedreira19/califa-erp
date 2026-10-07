"use client";

import { PERCENTUAL_INT_TAXES_PADRAO } from "@/lib/impostos";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  EyeOff,
  FolderKanban,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  calcularResultadoOperacional,
} from "@/lib/calculos/versao-totais";
import {
  camposItemEditaveis,
  isCampoItemEditavel,
  itemSchema,
} from "@/lib/validations/itens";
import type {
  Categoria,
  CategoriaDominio,
  ItemBv,
  Profile,
  Regional,
  TipoCusto,
  VersaoOrcamentoItem,
} from "@/lib/types";
import type { CidadeOption } from "../../cidade-combobox";
import type { CategoriaParaServico } from "@/lib/categorias-do-servico";
import type { AdaptadorItens } from "../[orcId]/versoes/[versaoId]/itens-table";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import { ResumoRentabilidade } from "../[orcId]/versoes/[versaoId]/resumo-rentabilidade";
import { OrcamentoForm, type DadosOrcamento } from "../orcamento-form";
import { JobRascunhoCard } from "../../_rascunho/orcamento-card";
import {
  ImportarPlanilhaModal,
  type PlanilhaLida,
} from "../../_rascunho/importar-planilha-modal";
import { ParametrosModal } from "../../_rascunho/parametros-modal";
import { TotaisProjetoCard } from "../../_totais/totais-projeto-card";
import { CardMidiaNaAgregada, type OrcamentoMidiaNaAgregada } from "./card-midia";
import {
  ITEM_VAZIO,
  itemDoInterno,
  contarItens,
  divergenciaHonorarios,
  novoId,
  totaisDoJob,
} from "../../_rascunho/rascunho";
import {
  PARAMETROS_PADRAO,
  type GrupoRascunho,
  type ItemRascunho,
  type OrcamentoRascunho,
  type OrigemBanco,
  type ParametrosVersao,
} from "../../_rascunho/tipos";
import { importarPlanilhaNaAgregada } from "./actions";
import { criarOrcamentoDaAgregada } from "../actions";
import {
  adicionarItem,
  atualizarCampoItem,
  atualizarVersao,
  criarGrupo,
  moverItem,
  removerGrupo,
  removerItem,
  renomearGrupo,
} from "../[orcId]/versoes/actions";
import { estagioFunil } from "@/lib/calculos/funil";
import { moverNaLista } from "@/lib/calculos/ordem-itens";
import { aceitaBV } from "@/lib/calculos/versao-totais";
import {
  estagioFunilBadgeClasses,
  estagioFunilLabel,
} from "@/lib/calculos/funil";
import { ImportarOrcamentosDrawer } from "../../_selecao/importar-orcamentos-drawer";
import {
  ExibirOrcamentosMenu,
  type OrcamentoExibivel,
} from "../../_selecao/exibir-orcamentos-menu";
import {
  ExportarOrcamentosMenu,
  type OrcamentoExportavel,
} from "../../_selecao/exportar-orcamentos-menu";
import { type VisaoBv } from "@/lib/calculos/bv-planilha";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { SAVE_VAZIO } from "@/app/(app)/_planilha/save-coluna";
import { SaveDialog, type LinhaDoSave } from "@/app/(app)/_planilha/save-dialog";
import type { SaldoDeSave } from "@/lib/data/saves";
import {
  marcarSaveDaLinha,
  salvarConsumoDeSave,
} from "../[orcId]/versoes/[versaoId]/save-actions";
import { useProtegerSaida } from "@/components/voltar/estado";

interface Props {
  projeto: {
    id: string;
    codigo: string;
    nome: string;
    cliente: string | null;
    responsavel: string | null;
  };
  /** Faixa do projeto (decisão 106), montada no servidor: o voltar, a
   *  agregada e os orçamentos do projeto. */
  faixa: React.ReactNode;
  /** Honorários do cadastro do cliente. Vale para os orçamentos criados
   *  aqui; os que já existem mantêm o percentual gravado na versão. */
  honorariosCliente: number;
  /** Projeto arquivado (decisão 118): tudo em consulta, sem orçamento novo. */
  projetoArquivado: boolean;
  /** `orcamentos.editar`. Sem ela a agregada fica em consulta, como no
   *  projeto arquivado: o servidor já manda o bloqueio em cada card, e aqui
   *  somem o "Criar orçamento de job" e o status da gravação (07/10/2026). */
  podeEditar: boolean;
  /** O "Importar" da planilha do projeto: projeto ativo e
   *  `orcamentos.criar`, a permissão que a importação confere no servidor
   *  (07/10/2026). */
  podeImportar: boolean;
  /** `orcamentos.editar_impostos` — trava os Impostos BR do internacional
   *  no modal de parâmetros (decisão do Tiago, 14/09/2026). */
  podeEditarImpostos: boolean;
  /** `orcamentos.marcar_em_save` — administrador e GP geram e consomem
   *  save (24/09/2026). Sem ela o pop-up de save abre só para ver. */
  podeMarcarSave: boolean;
  /** Estado inicial, montado no servidor a partir da versão vigente. */
  inicial: OrcamentoRascunho[];
  /** Os orçamentos de Mídia Off (decisão 147): só consulta, com o atalho
   *  para a tela do orçamento. Entram nos três indicadores do topo, e não
   *  no quadro de Totais, que é o da planilha nacional. */
  midias: OrcamentoMidiaNaAgregada[];
  /** Os orçamentos gravados, como o seletor "Exportar" os vê — versão
   *  vigente e o valor que a aba imprime, calculados sobre o que está no
   *  banco. A exportação lê o banco, não o rascunho da tela. */
  exportaveis: OrcamentoExportavel[];
  /** Só as categorias que se criam por aqui: as exclusivas de planilha
   *  mensal (Fee, Always On) ficam de fora — orçamento mensal nasce na
   *  tela do orçamento (decisão 078). As do Mídia ficam (decisão 131). */
  categorias: CategoriaParaServico[];
  /** TODAS as categorias de orçamento, só para o rótulo dos cards: o
   *  orçamento de Fee aparece aqui em consulta e precisa do nome dela. */
  nomesDeCategoria: Pick<CategoriaDominio, "id" | "nome">[];
  /** Serviço do job — escopo `projeto` de `categorias_dominio`,
   *  lista distinta das categorias acima (decisão 037). */
  servicos: Pick<CategoriaDominio, "id" | "nome" | "investimento_interno">[];
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  /** Primeiras cidades do cadastro — o combobox do formulário busca o
   *  resto no servidor. O rótulo do card sai de `orc.cidade_nome`. */
  cidadesIniciais: CidadeOption[];
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  produtores: Pick<Profile, "id" | "nome">[];
  categoriasItem: Categoria[];
  fornecedores: FornecedorOpcao[];
  /** Estado da coluna Save por item, de TODAS as versões desta tela. Só
   *  leitura nesta etapa: a coluna mostra os quatro estados e não abre o
   *  diálogo — marcar save segue na planilha da versão. */
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  /** Os BVs de cada item, do banco (vários por item, decisão 062). A janela
   *  do BV da agregada grava pelas actions da versão e o refresh traz a
   *  lista de volta (decisão 148). */
  bvsPorItem: Record<string, ItemBv[]>;
  /** Saldos de save que este cliente tem para gastar — alimentam o
   *  formulário de "consumir save de outro job". */
  saldosDeSave?: SaldoDeSave[];
  /** Nome do grupo por id, de todos os orçamentos da tela: o formulário
   *  mostra de qual grupo a linha veio. */
  nomeDoGrupo?: Record<string, string>;
}

/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */

type Modal =
  | { tipo: "form" }
  | { tipo: "importar"; orcamentoId: string }
  | { tipo: "parametros"; orcamentoId: string }
  | null;

/**
 * Visão agregada editável: a continuação do orçamento do projeto.
 *
 * Junta num lugar só os orçamentos do projeto — cada um na sua versão
 * vigente. Desde 06/10/2026 (decisão 148) cada alteração grava na hora,
 * pelas mesmas actions da tela da versão: a célula, o item, o grupo, a
 * ordem, os parâmetros, o BV e o save. O "Criar orçamento de job" grava o
 * orçamento com a v1 vazia. Não há mais "Salvar alterações" — ele mandava
 * a tela inteira e apagava do banco o que não estava na tela de quem
 * salvava, e foi por ele que o AMB-P017/26 ganhou 36 cópias.
 *
 * Duas travas vêm do domínio e não são negociáveis na tela: versão aprovada
 * não se altera, e orçamento que já virou job aberto pelo financeiro
 * também não. Esses aparecem em consulta, com o motivo à vista. O servidor
 * confere de novo — a trava não pode morar só aqui.
 *
 * Esta tela nunca cria versão nova de um orçamento existente: as edições
 * caem na versão aberta. Versão nova continua sendo ato da tela do
 * orçamento.
 */
/**
 * Aplica `fn` a cada grupo e devolve os MESMOS objetos para o que não mudou
 * — orçamento, lista de grupos e grupo. Quem não foi editado mantém a
 * referência, então a planilha dele não recalcula nem remede a calha.
 * Se nada mudou, devolve a própria lista (o React descarta o setState).
 */
function nosGrupos(
  orcamentos: OrcamentoRascunho[],
  fn: (grupo: GrupoRascunho) => GrupoRascunho,
): OrcamentoRascunho[] {
  let algum = false;
  const proximos = orcamentos.map((orc) => {
    let mudou = false;
    const grupos = orc.grupos.map((grupo) => {
      const novo = fn(grupo);
      if (novo !== grupo) mudou = true;
      return novo;
    });
    if (!mudou) return orc;
    algum = true;
    return { ...orc, grupos };
  });
  return algum ? proximos : orcamentos;
}

/** Um tique: o que vem depois já não é atualização da transição de quem
 *  chamou (o React só marca o trecho síncrono do `startTransition`). Ver
 *  o porquê nos adaptadores da planilha, dentro do editor. */
function foraDaTransicao(): Promise<void> {
  return Promise.resolve();
}

export function EditorAgregado({
  projeto,
  faixa,
  savePorItem,
  bvsPorItem,
  saldosDeSave,
  nomeDoGrupo,
  honorariosCliente,
  projetoArquivado,
  podeEditar,
  podeImportar,
  podeEditarImpostos,
  podeMarcarSave,
  inicial,
  midias,
  exportaveis,
  categorias,
  nomesDeCategoria,
  servicos,
  regionaisDoProjeto,
  cidadesIniciais,
  gpsDoProjeto,
  produtores,
  categoriasItem,
  fornecedores,
}: Props) {
  const router = useRouter();
  // Sem orçamento novo nem gravação: projeto arquivado (decisão 118) ou
  // papel que não edita orçamento (07/10/2026).
  const emConsulta = projetoArquivado || !podeEditar;
  // Uma chave para a página inteira, como na tela da versão: vários
  // orçamentos na mesma tela em modos diferentes não teriam leitura.
  // ⚠️ FIXA em "bruto" desde 08/09/2026 (decisão 062). O BV saiu do
  // planejado, então nesta tela as duas vistas dariam o mesmo número — e
  // a chave que as alternava foi removida daqui. Deixar em "líquido"
  // manteria o rótulo "Total líquido" numa coluna que não deduz nada.
  const visao: VisaoBv = "bruto";
  // A coluna Save nasce aberta em quem já usa save e fechada em quem
  // nunca usou — a mesma regra da planilha da versão. Estado da PÁGINA:
  // os cards e o Totais dividem a leitura.
  const [saveVisivel, setSaveVisivel] = React.useState(
    Object.keys(savePorItem ?? {}).length > 0,
  );
  // A linha cujo formulário de save está aberto, junto do orçamento dela.
  // O orçamento vem junto porque cada um desta tela tem moeda, honorários
  // e imposto PRÓPRIOS — o formulário calcula a receita que migra com as
  // taxas do orçamento de origem, não com uma taxa da página.
  //
  // Só entra aqui linha de orçamento JÁ SALVO: as actions gravam por id
  // do item no banco, e o orçamento novo ainda tem id local.
  const [linhaSave, setLinhaSave] = React.useState<{
    item: VersaoOrcamentoItem;
    parametros: ParametrosVersao;
    /** Decide a cadeia do "Faturamento desta linha" (decisão 072). */
    modeloPlanilha: OrcamentoRascunho["modeloPlanilha"];
  } | null>(null);
  const [orcamentos, setOrcamentos] =
    React.useState<OrcamentoRascunho[]>(inicial);

  // Serviço Interno (decisão 105): toda linha F · Interno, planejado igual
  // ao orçado. Aplicado ao estado num lugar só — linha nova, célula
  // editada, planilha importada, orçamento novo com o Interno —, em vez de
  // em cada mutação. `itemDoInterno` devolve o mesmo objeto quando já está
  // certo, então o efeito só grava quando algo precisou mudar.
  const servicosInternos = React.useMemo(
    () =>
      new Set(servicos.filter((s) => s.investimento_interno).map((s) => s.id)),
    [servicos],
  );
  React.useEffect(() => {
    if (servicosInternos.size === 0) return;
    // Só chama o setState quando há linha a corrigir. Chamado sempre, ele
    // agenda um render mesmo devolvendo a mesma lista, e um render que
    // refaça a lista (atualização ainda pendente na fila) roda o efeito de
    // novo — o laço de "Maximum update depth" visto em 06/10/2026.
    const precisa = orcamentos.some(
      (orc) =>
        !!orc.servico_id &&
        servicosInternos.has(orc.servico_id) &&
        orc.grupos.some((g) => g.itens.some((it) => itemDoInterno(it) !== it)),
    );
    if (!precisa) return;
    setOrcamentos((atuais) => {
      let mudou = false;
      const proximos = atuais.map((orc) => {
        if (!orc.servico_id || !servicosInternos.has(orc.servico_id)) return orc;
        let mudouAqui = false;
        const grupos = orc.grupos.map((grupo) => {
          const itens = grupo.itens.map((it) => {
            const certo = itemDoInterno(it);
            if (certo !== it) mudouAqui = true;
            return certo;
          });
          return mudouAqui ? { ...grupo, itens } : grupo;
        });
        if (!mudouAqui) return orc;
        mudou = true;
        return { ...orc, grupos };
      });
      return mudou ? proximos : atuais;
    });
  }, [orcamentos, servicosInternos]);
  // "Exibir": filtro de TELA. Cards e Totais seguem esta lista; os três
  // indicadores do topo são do projeto inteiro e não seguem. Esconder um
  // orçamento não muda nada nele.
  const [exibidos, setExibidos] = React.useState<string[]>(() =>
    inicial.map((o) => o.id),
  );
  const [modal, setModal] = React.useState<Modal>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  /** Para onde ir quando alguém sai com uma gravação ainda a caminho.
   *  `null` = pergunta fechada. */
  const [askSair, setAskSair] = React.useState<string | null>(null);
  /** A chave do formulário de orçamento novo aberto agora: vai para
   *  `orcamentos.chave_rascunho`, e o segundo envio do mesmo formulário é
   *  recusado pelo índice único (decisão 148). */
  const chaveDoFormulario = React.useRef<string | null>(null);

  // ---------- gravação ----------
  // Cada alteração vai ao banco sozinha. A tela muda na hora e fica como
  // referência — sem recarregar a página a cada célula, que com 10
  // orçamentos deixaria a agregada lenta (docs/PERFORMANCE.md). Recusada,
  // a alteração é desfeita na tela e o motivo aparece.
  const [gravacao, setGravacao] = React.useState<{
    pendentes: number;
    ultima: Date | null;
    falhou: boolean;
  }>({ pendentes: 0, ultima: null, falhou: false });
  const gravar = React.useCallback(
    async <T extends { ok: boolean }>(acao: () => Promise<T>): Promise<T> => {
      setGravacao((g) => ({ ...g, pendentes: g.pendentes + 1 }));
      let res: T;
      try {
        res = await acao();
      } catch (e) {
        setGravacao((g) => ({ ...g, pendentes: Math.max(0, g.pendentes - 1), falhou: true }));
        throw e;
      }
      setGravacao((g) => ({
        pendentes: Math.max(0, g.pendentes - 1),
        ultima: res.ok ? new Date() : g.ultima,
        falhou: !res.ok,
      }));
      return res;
    },
    [],
  );
  const salvandoAgora = gravacao.pendentes > 0;

  React.useEffect(() => {
    if (!salvandoAgora) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [salvandoAgora]);

  // Nada fica "por salvar". Só a gravação ainda a caminho segura a saída
  // pelo voltar e pelas abas da faixa (decisão 108).
  useProtegerSaida(salvandoAgora, (href) => setAskSair(href));

  // ---------- rótulos ----------
  const nomePor = React.useMemo(
    () => ({
      categoria: new Map(nomesDeCategoria.map((c) => [c.id, c.nome])),
      regional: new Map(regionaisDoProjeto.map((r) => [r.id, r.nome])),
      gp: new Map(gpsDoProjeto.map((g) => [g.id, g.nome])),
    }),
    [nomesDeCategoria, regionaisDoProjeto, gpsDoProjeto],
  );

  function descricao(orc: OrcamentoRascunho): string {
    return [
      orc.categoria_id ? nomePor.categoria.get(orc.categoria_id) : null,
      nomePor.regional.get(orc.regional_id),
      orc.cidade_nome || null,
      nomePor.gp.get(orc.gp_responsavel_id)
        ? `GP ${nomePor.gp.get(orc.gp_responsavel_id)}`
        : null,
      periodo(orc.data_inicio_prevista, orc.data_fim_prevista),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  // ---------- mutações ----------
  // Toda mutação de item passa por `nosGrupos`, que devolve o MESMO objeto
  // para o orçamento e o grupo que não mudaram. Até 25/09/2026 cada tecla
  // recriava os grupos de todos os orçamentos da página, e cada planilha
  // remedia todas as linhas (a calha de ações mede o layout): 12 a 15
  // medições por edição no projeto de teste, e a tela chegou a cair uma vez
  // com "Maximum update depth exceeded".
  const mutarItem = React.useCallback(
    (itemId: string, fn: (item: ItemRascunho) => ItemRascunho) => {
      setOrcamentos((atuais) =>
        nosGrupos(atuais, (grupo) => {
          const i = grupo.itens.findIndex((it) => it.id === itemId);
          if (i < 0) return grupo;
          const itens = grupo.itens.slice();
          itens[i] = fn(itens[i]);
          return { ...grupo, itens };
        }),
      );
    },
    [],
  );

  const orcamentosRef = React.useRef(orcamentos);
  orcamentosRef.current = orcamentos;

  const acharItem = React.useCallback((itemId: string): ItemRascunho | null => {
    for (const orc of orcamentosRef.current) {
      for (const grupo of orc.grupos) {
        const achado = grupo.itens.find((it) => it.id === itemId);
        if (achado) return achado;
      }
    }
    return null;
  }, []);

  function mutarOrcamento(
    orcamentoId: string,
    fn: (orc: OrcamentoRascunho) => OrcamentoRascunho,
  ) {
    setOrcamentos((atuais) =>
      atuais.map((o) => (o.id === orcamentoId ? fn(o) : o)),
    );
  }

  /** Grava o orçamento novo com a v1 vazia e o põe na tela como gravado.
   *  Recusado, o formulário continua aberto, com o motivo e o que foi
   *  preenchido. */
  async function criarOrcamento(
    dados: DadosOrcamento,
  ): Promise<{ ok: false; message: string; fieldErrors?: Record<string, string[]> } | void> {
    const chave = chaveDoFormulario.current ?? crypto.randomUUID();
    chaveDoFormulario.current = chave;
    const fd = new FormData();
    fd.set("chave", chave);
    fd.set("nome", dados.nome);
    fd.set("categoria_id", dados.categoria_id ?? "");
    fd.set("servico_id", dados.servico_id ?? "");
    fd.set("descritivo", dados.descritivo ?? "");
    fd.set("regional_id", dados.regional_id);
    fd.set("cidade_id", dados.cidade_id);
    fd.set("gp_responsavel_id", dados.gp_responsavel_id);
    fd.set("produtor_id", dados.produtor_id);
    fd.set("data_inicio_prevista", dados.data_inicio_prevista ?? "");
    fd.set("data_fim_prevista", dados.data_fim_prevista ?? "");

    const res = await gravar(() => criarOrcamentoDaAgregada(projeto.id, fd));
    if (!res.ok) return res;

    // A cadeia vem da categoria escolhida no formulário (decisão 072).
    // Categoria não encontrada cai em nacional — o fechamento que todo
    // orçamento sempre teve.
    const modeloPlanilha =
      categorias.find((c) => c.id === dados.categoria_id)?.modelo_planilha ??
      "nacional";
    const id = res.orcamentoId;
    const origemBanco: OrigemBanco = res.versaoId
      ? {
          orcamentoId: id,
          versaoId: res.versaoId,
          numeroVersao: 1,
          statusOrcamento: "rascunho",
          statusVersao: "rascunho",
          bloqueio: null,
          estagio: estagioFunil("rascunho", null),
        }
      : {
          // O orçamento entrou e a v1 não: em consulta, como a página o
          // mostra, até a versão ser criada na tela do orçamento.
          orcamentoId: id,
          versaoId: "",
          numeroVersao: 0,
          statusOrcamento: "rascunho",
          statusVersao: "",
          bloqueio:
            "Este orçamento ainda não tem nenhuma versão. Crie a primeira na tela do orçamento.",
          estagio: estagioFunil("rascunho", null),
        };
    const novo: OrcamentoRascunho = {
      ...dados,
      id,
      origemBanco,
      aberto: true,
      origem: null,
      grupos: [],
      arquivoNome: null,
      percentualHonorariosDetectado: null,
      // Orçamento novo nunca é mensal por aqui (decisão 078).
      meses: [],
      // Os mesmos valores com que a v1 nasce no servidor: honorários do
      // cadastro do cliente e a alíquota padrão (`criarVersaoInicial`).
      parametros: {
        ...PARAMETROS_PADRAO,
        percentual_honorarios: honorariosCliente,
        ...(modeloPlanilha === "internacional"
          ? {
              moeda_estrangeira: "USD",
              percentual_int_taxes: PERCENTUAL_INT_TAXES_PADRAO,
            }
          : {}),
      },
      modeloPlanilha,
    };
    // O recém-criado sempre aparece, mesmo com a tela filtrada: ninguém
    // cria um orçamento para não vê-lo.
    setOrcamentos((atuais) => [...atuais, novo]);
    setExibidos((atuais) => [...atuais, id]);
    chaveDoFormulario.current = null;
    setModal(null);
    setErro(null);
    // A faixa do projeto e o "Exportar" vêm do servidor.
    router.refresh();
  }

  function abrirFormulario() {
    chaveDoFormulario.current = crypto.randomUUID();
    setModal({ tipo: "form" });
  }

  /** A versão do orçamento na tela — a que recebe as gravações. */
  function versaoDe(orcamentoId: string): string | null {
    const orc = orcamentosRef.current.find((o) => o.id === orcamentoId);
    return orc?.origemBanco?.versaoId || null;
  }

  /** O grupo novo nasce no banco com um nome livre ("Novo grupo", "Novo
   *  grupo 2"…) — o nome é único na versão (no mensal, no mês). A linha em
   *  branco que vem com ele fica só na tela até ganhar descrição. */
  async function novoGrupoNoBanco(orcamentoId: string, mesId: string | null) {
    const orc = orcamentosRef.current.find((o) => o.id === orcamentoId);
    const versaoId = versaoDe(orcamentoId);
    if (!orc || !versaoId) return;
    const usados = new Set(
      orc.grupos.filter((g) => g.mesId === mesId).map((g) => g.nome.trim().toLowerCase()),
    );
    let nome = "Novo grupo";
    for (let n = 2; usados.has(nome.toLowerCase()); n += 1) nome = `Novo grupo ${n}`;

    const fd = new FormData();
    fd.set("nome", nome);
    if (mesId) fd.set("mes_id", mesId);
    const res = await gravar(() => criarGrupo(versaoId, fd));
    if (!res.ok || !res.id) {
      setErro(
        `Orçamento “${orc.nome}”: ${res.ok ? "não foi possível criar o grupo." : res.message}`,
      );
      return;
    }
    const grupoId = res.id;
    mutarOrcamento(orcamentoId, (o) => ({
      ...o,
      origem: o.origem ?? "manual",
      grupos: [
        ...o.grupos,
        { id: grupoId, nome, mesId, itens: [{ ...ITEM_VAZIO, id: novoId("it") }] },
      ],
    }));
    setErro(null);
  }

  function criarPlanilha(id: string) {
    void novoGrupoNoBanco(id, null);
  }

  function novoGrupo(id: string, mesId: string | null) {
    void novoGrupoNoBanco(id, mesId);
  }

  /** A importação grava na hora (a mesma da tela da versão) e a planilha do
   *  card passa a ser a que ficou no banco, com os ids reais. O diálogo
   *  espera: recusada, ele mostra o motivo e guarda o arquivo para tentar
   *  de novo (e o descarta ao fechar). */
  async function aplicarImportacao(
    orcamentoId: string,
    planilha: PlanilhaLida,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const versaoId = versaoDe(orcamentoId);
    if (!versaoId) {
      return { ok: false, message: "Este orçamento não tem versão aberta para receber a planilha." };
    }
    const res = await gravar(() => importarPlanilhaNaAgregada(versaoId, planilha.envio));
    if (!res.ok) return res;
    mutarOrcamento(orcamentoId, (o) => ({
      ...o,
      origem: "importado",
      arquivoNome: planilha.envio.nome,
      percentualHonorariosDetectado: planilha.percentualHonorarios,
      grupos: res.grupos,
    }));
    setErro(null);
    router.refresh();
    return { ok: true };
  }

  async function renomearGrupoNoBanco(orcamentoId: string, grupoId: string, nome: string) {
    const orc = orcamentosRef.current.find((o) => o.id === orcamentoId);
    const antes = orc?.grupos.find((g) => g.id === grupoId)?.nome;
    if (!orc || antes === undefined || antes === nome) return;
    const trocar = (paraNome: string) =>
      mutarOrcamento(orcamentoId, (o) => ({
        ...o,
        grupos: o.grupos.map((g) => (g.id === grupoId ? { ...g, nome: paraNome } : g)),
      }));
    trocar(nome);
    const fd = new FormData();
    fd.set("nome", nome);
    const res = await gravar(() => renomearGrupo(grupoId, fd));
    if (!res.ok) {
      trocar(antes);
      setErro(`Orçamento “${orc.nome}”: ${res.message} O nome voltou a “${antes}”.`);
    }
  }

  async function removerGrupoNoBanco(orcamentoId: string, grupoId: string) {
    const orc = orcamentosRef.current.find((o) => o.id === orcamentoId);
    const indice = orc?.grupos.findIndex((g) => g.id === grupoId) ?? -1;
    if (!orc || indice < 0) return;
    const grupo = orc.grupos[indice];
    mutarOrcamento(orcamentoId, (o) => ({
      ...o,
      grupos: o.grupos.filter((g) => g.id !== grupoId),
    }));
    const res = await gravar(() => removerGrupo(grupoId));
    if (!res.ok) {
      mutarOrcamento(orcamentoId, (o) => {
        const grupos = o.grupos.slice();
        grupos.splice(Math.min(indice, grupos.length), 0, grupo);
        return { ...o, grupos };
      });
      setErro(`Orçamento “${orc.nome}”: ${res.message} O grupo voltou.`);
    }
  }

  /** O grupo onde o item está agora. */
  function grupoDoItem(itemId: string): string | null {
    for (const orc of orcamentosRef.current) {
      for (const g of orc.grupos) {
        if (g.itens.some((it) => it.id === itemId)) return g.id;
      }
    }
    return null;
  }

  /** A linha completa, como o `adicionarItem` da versão a recebe. */
  function formDataDoItem(item: ItemRascunho): FormData {
    const fd = new FormData();
    fd.set("item", item.item);
    fd.set("tipo_custo", item.tipo_custo);
    if (item.categoria_id) fd.set("categoria_id", item.categoria_id);
    fd.set("valor_unitario_orcado", String(item.valor_unitario_orcado));
    fd.set("quantidade_orcada", String(item.quantidade_orcada));
    fd.set("dias_meses_orcado", String(item.dias_meses_orcado));
    fd.set("valor_unitario_planejado", String(item.valor_unitario_planejado));
    fd.set("quantidade_planejada", String(item.quantidade_planejada));
    fd.set("dias_meses_planejado", String(item.dias_meses_planejado));
    return fd;
  }

  // ---------- adaptadores da planilha ----------
  // As mesmas actions da tela da versão. A linha em branco do "Criar
  // planilha" / "Novo grupo" (id local `it-…`) fica só na tela até ganhar
  // descrição, como a linha provisória da versão: sem descrição o banco
  // recusa o item.
  //
  // A planilha chama o adaptador de dentro de um `startTransition`, e o
  // que o editor muda antes do primeiro `await` vira atualização de
  // transição: fica retida até a gravação voltar do servidor. Com a troca
  // de id da linha nova (feita depois do `await`) na mesma fila, cada
  // render refazia a lista de orçamentos, o efeito do Serviço Interno
  // rodava de novo e a tela entrava em laço — a descrição nunca chegava
  // aos totais (visto no navegador em 06/10/2026). Por isso cada função
  // espera um tique antes de mexer no estado: a mudança sai da transição,
  // e o card e o Totais acompanham a célula na hora.
  const adaptador = React.useMemo<AdaptadorItens>(
    () => ({
      atualizarCampo: async (itemId, campo, valor) => {
        await foraDaTransicao();
        if (!isCampoItemEditavel(campo)) {
          return { ok: false, message: "Campo não editável." };
        }
        const parsed = camposItemEditaveis[campo].safeParse(valor ?? undefined);
        if (!parsed.success) {
          return {
            ok: false,
            message: parsed.error.errors[0]?.message ?? "Valor inválido.",
          };
        }
        const anterior = acharItem(itemId);
        if (!anterior) return { ok: false, message: "Item não encontrado." };
        const atualizado = { ...anterior, [campo]: parsed.data } as ItemRascunho;
        if (campo === "tipo_custo" && !aceitaBV(String(parsed.data))) {
          atualizado.bv = null;
        }
        mutarItem(itemId, () => atualizado);

        if (itemId.startsWith("it-")) {
          if (!atualizado.item.trim()) return { ok: true, id: itemId };
          const grupoId = grupoDoItem(itemId);
          if (!grupoId) return { ok: false, message: "Grupo não encontrado." };
          const res = await gravar(() => adicionarItem(grupoId, formDataDoItem(atualizado)));
          if (!res.ok || !res.id) {
            mutarItem(itemId, () => anterior);
            return { ok: false, message: res.ok ? "Não foi possível gravar o item." : res.message };
          }
          const idReal = res.id;
          mutarItem(itemId, (it) => ({ ...it, id: idReal }));
          return { ok: true, id: idReal };
        }

        const res = await gravar(() => atualizarCampoItem(itemId, campo, valor));
        if (!res.ok) {
          mutarItem(itemId, () => anterior);
          return res;
        }
        // Sair de A, AR ou D cancela o BV em negociação no servidor: a
        // lista de BVs vem de lá.
        if (campo === "tipo_custo" && !aceitaBV(String(parsed.data))) router.refresh();
        return { ok: true, id: itemId };
      },

      adicionar: async (grupoId, formData) => {
        await foraDaTransicao();
        const parsed = itemSchema.safeParse({
          item: formData.get("item")?.toString() ?? "",
          tipo_custo: formData.get("tipo_custo")?.toString() ?? "A",
          valor_unitario_orcado:
            formData.get("valor_unitario_orcado")?.toString() ?? "0",
          quantidade_orcada: formData.get("quantidade_orcada")?.toString() ?? "1",
          dias_meses_orcado: formData.get("dias_meses_orcado")?.toString() ?? "1",
          categoria_id: formData.get("categoria_id")?.toString() || null,
          valor_unitario_planejado:
            formData.get("valor_unitario_planejado")?.toString() ?? "0",
          quantidade_planejada:
            formData.get("quantidade_planejada")?.toString() ?? "0",
          dias_meses_planejado:
            formData.get("dias_meses_planejado")?.toString() ?? "0",
        });
        if (!parsed.success) {
          return {
            ok: false,
            message:
              parsed.error.errors[0]?.message ?? "Verifique os campos do item.",
          };
        }
        const res = await gravar(() => adicionarItem(grupoId, formData));
        if (!res.ok || !res.id) {
          return res.ok ? { ok: false, message: "Não foi possível gravar o item." } : res;
        }
        const id = res.id;
        setOrcamentos((atuais) =>
          nosGrupos(atuais, (grupo) =>
            grupo.id === grupoId
              ? {
                  ...grupo,
                  itens: [
                    ...grupo.itens,
                    { ...parsed.data, id, planilha_origem: null, bv: null },
                  ],
                }
              : grupo,
          ),
        );
        return { ok: true, id };
      },

      remover: async (itemId) => {
        await foraDaTransicao();
        let grupoAntes: GrupoRascunho | null = null;
        for (const orc of orcamentosRef.current) {
          const g = orc.grupos.find((x) => x.itens.some((it) => it.id === itemId));
          if (g) grupoAntes = g;
        }
        setOrcamentos((atuais) =>
          nosGrupos(atuais, (grupo) =>
            grupo.itens.some((it) => it.id === itemId)
              ? { ...grupo, itens: grupo.itens.filter((it) => it.id !== itemId) }
              : grupo,
          ),
        );
        if (itemId.startsWith("it-")) return { ok: true, id: itemId };
        const res = await gravar(() => removerItem(itemId));
        if (!res.ok) {
          const volta = grupoAntes;
          if (volta) {
            setOrcamentos((atuais) =>
              nosGrupos(atuais, (grupo) => (grupo.id === volta.id ? volta : grupo)),
            );
          }
          return res;
        }
        return { ok: true, id: itemId };
      },

      // Decisão 104: a ordem nova grava na hora, como na tela da versão. O
      // item só se move entre os grupos do MESMO orçamento — cada card tem
      // a sua planilha, e a tabela só enxerga os grupos dela.
      mover: async (itemId, grupoId, indice) => {
        await foraDaTransicao();
        // Pela ref, como o `acharItem`: o adaptador não se refaz a cada edição.
        const dono = orcamentosRef.current.find(
          (o) =>
            o.grupos.some((g) => g.itens.some((it) => it.id === itemId)) &&
            o.grupos.some((g) => g.id === grupoId),
        );
        if (!dono) {
          return { ok: false, message: "O item só muda de lugar dentro do próprio orçamento." };
        }
        setOrcamentos((atuais) =>
          atuais.map((orc) => {
            if (orc.id !== dono.id) return orc;
            const grupos = moverNaLista(orc.grupos, itemId, grupoId, indice);
            return grupos ? { ...orc, grupos } : orc;
          }),
        );
        if (itemId.startsWith("it-")) return { ok: true, id: itemId };
        const res = await gravar(() => moverItem(itemId, grupoId, indice));
        if (!res.ok) {
          setOrcamentos((atuais) => atuais.map((orc) => (orc.id === dono.id ? dono : orc)));
          return res;
        }
        return { ok: true, id: itemId };
      },

      aposEscrita: () => {},
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutarItem, acharItem, gravar],
  );

  // ---------- consolidado ----------
  // Sem o código do orçamento (nem o previsto dos novos) desde 29/09/2026:
  // ele é só da base de dados e confundia a produção, que fala pelo nome
  // e, depois da aprovação, pelo código do job.
  const linhasTodas = React.useMemo(() => {
    return orcamentos.map((orc) => {
      const t = totaisDoJob(orc, orc.parametros, orc.modeloPlanilha);
      return {
        id: orc.id,
        nome: orc.nome,
        modeloPlanilha: orc.modeloPlanilha,
        detalhe: orc.origemBanco
          ? `v${orc.origemBanco.numeroVersao}${
              orc.origemBanco.statusVersao === "aprovada" ? " · aprovada" : ""
            }`
          : "novo",
        orcado: t.orcado,
        orcadoRentabilidade: t.orcadoRentabilidade,
        planejado: t.planejado,
        honorarios: t.honorarios,
        imposto: t.imposto,
        intTaxes: t.intTaxes,
        intTransactionCosts: t.intTransactionCosts,
        faturamentoPrevisto: t.faturamentoPrevisto,
        valorJob: t.valorJob,
        subtotaisPorTipo: t.subtotaisPorTipo,
        save: t.save,
        percentualHonorarios: t.percentualHonorarios,
        percentualImposto: orc.parametros.percentual_imposto,
      };
    });
  }, [orcamentos]);

  // O que a tela mostra: cards e Totais seguem o "Exibir".
  const visiveis = orcamentos.filter((o) => exibidos.includes(o.id));
  const linhasTotais = linhasTodas.filter((l) => exibidos.includes(l.id));

  const opcoesExibir: OrcamentoExibivel[] = orcamentos.map((orc) => ({
    id: orc.id,
    rotulo: orc.origemBanco
      ? `${orc.nome} - v${orc.origemBanco.numeroVersao}`
      : orc.nome,
    chip: orc.origemBanco?.estagio
      ? estagioFunilLabel(orc.origemBanco.estagio)
      : "Novo",
    chipClasses: orc.origemBanco?.estagio
      ? estagioFunilBadgeClasses(orc.origemBanco.estagio)
      : "bg-muted text-muted-foreground border-border",
  }));

  /** Planilhas importadas cujo % de honorários não é o do orçamento. O
   *  percentual gravado vence — aqui só se avisa quem importou. */
  const divergencias = React.useMemo(
    () =>
      orcamentos
        .map((orc) => ({
          nome: orc.nome,
          aplicado: orc.parametros.percentual_honorarios,
          daPlanilha: divergenciaHonorarios(orc, orc.parametros),
        }))
        .filter(
          (
            d,
          ): d is { nome: string; aplicado: number; daPlanilha: number } =>
            d.daPlanilha !== null,
        ),
    [orcamentos],
  );

  // Os três indicadores do topo são do projeto INTEIRO — não seguem o
  // filtro de exibição (design, 03/09/2026).
  // Cada orçamento fecha pela SUA cadeia e o consolidado soma os
  // fechamentos — a mesma ideia com que o card já lida com taxas
  // diferentes entre orçamentos (decisão 072).
  const resumoDosEditaveis = linhasTodas.reduce(
    (acc, l) => ({
      faturamentoPrevisto: acc.faturamentoPrevisto + l.faturamentoPrevisto,
      valorJob: acc.valorJob + l.valorJob,
      imposto: acc.imposto + l.imposto,
      intTaxes: acc.intTaxes + l.intTaxes,
      intTransactionCosts: acc.intTransactionCosts + l.intTransactionCosts,
      planejado: acc.planejado + l.planejado,
    }),
    {
      faturamentoPrevisto: 0,
      valorJob: 0,
      imposto: 0,
      intTaxes: 0,
      intTransactionCosts: 0,
      planejado: 0,
    },
  );
  // A Mídia Off soma pelo fechamento dela (decisão 147): o imposto já é o
  // de dentro dos honorários, e o planejado são as notas dos veículos.
  const resumo = midias.reduce(
    (acc, m) => ({
      ...acc,
      faturamentoPrevisto: acc.faturamentoPrevisto + m.faturamentoPrevisto,
      valorJob: acc.valorJob + m.valorJob,
      imposto: acc.imposto + m.imposto,
      planejado: acc.planejado + m.custoPlanejado,
    }),
    resumoDosEditaveis,
  );
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    resumo.valorJob,
    // As três deduções: no projeto só nacional as duas últimas são 0 e a
    // conta é a de sempre.
    resumo.imposto + resumo.intTaxes + resumo.intTransactionCosts,
    resumo.planejado,
  );

  const moedaProjeto = orcamentos[0]?.parametros.moeda ?? "BRL";
  /** A alíquota é o único parâmetro do modal: grava na versão pela action
   *  da tela da versão, com as travas dela (internacional, aprovada). */
  async function salvarParametros(orc: OrcamentoRascunho, p: ParametrosVersao) {
    const versaoId = versaoDe(orc.id);
    if (!versaoId) return;
    const antes = orc.parametros;
    mutarOrcamento(orc.id, (o) => ({ ...o, parametros: p }));
    const fd = new FormData();
    fd.set("percentual_imposto", String(p.percentual_imposto));
    const res = await gravar(() => atualizarVersao(versaoId, fd));
    if (!res.ok) {
      mutarOrcamento(orc.id, (o) => ({ ...o, parametros: antes }));
      setErro(`Orçamento “${orc.nome}”: ${res.message}`);
      return;
    }
    // O "Exportar" mostra o valor de cada orçamento, calculado no servidor.
    router.refresh();
  }

  const modalImportar = modal?.tipo === "importar" ? modal : null;
  const orcImportando = modalImportar
    ? orcamentos.find((o) => o.id === modalImportar.orcamentoId)
    : null;
  const modalParametros = modal?.tipo === "parametros" ? modal : null;
  const orcParametros = modalParametros
    ? orcamentos.find((o) => o.id === modalParametros.orcamentoId)
    : null;

  return (
    <div className="flex flex-col gap-6 pb-4">
      <div>
        {faixa}

        <div className="mt-5 flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {projeto.codigo}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <FolderKanban className="h-6 w-6 text-california-red" />
              <h1 className="text-3xl font-bold tracking-tight">
                {projeto.nome}
              </h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm text-muted-foreground">
              <span>
                Cliente:{" "}
                <strong className="font-semibold text-foreground">
                  {projeto.cliente ?? "—"}
                </strong>
              </span>
              <span aria-hidden className="text-border">·</span>
              <span>
                Responsável:{" "}
                <strong className="font-semibold text-foreground">
                  {projeto.responsavel ?? "—"}
                </strong>
              </span>
              <span aria-hidden className="text-border">·</span>
              <span>
                {orcamentos.length}{" "}
                {orcamentos.length === 1 ? "orçamento" : "orçamentos"}
              </span>
              {/* "Exibir", "Importar" e "Exportar" ao lado da contagem, como
                  no design "Exportar e Exibir - Projeto e Visao Agregada". */}
              <span className="flex items-center gap-2">
                <ExibirOrcamentosMenu
                  orcamentos={opcoesExibir}
                  exibidos={exibidos}
                  onChange={setExibidos}
                />
                {podeImportar && <ImportarOrcamentosDrawer projetoId={projeto.id} />}
                <ExportarOrcamentosMenu
                  projetoId={projeto.id}
                  orcamentos={exportaveis}
                />
              </span>
            </div>
          </div>

          <ResumoRentabilidade
            valorJob={resumo.valorJob}
            resultadoOperacional={resultadoOperacional}
            resultadoGeral={resultadoGeral}
            moeda={moedaProjeto}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {projetoArquivado
              ? "Projeto arquivado: a visão agregada fica só para consulta. Reative o projeto na tela dele para editar."
              : !podeEditar
                ? "Visão agregada só para consulta: o seu papel não edita orçamentos. Cada card mostra a versão vigente do orçamento."
                : "Edite a planilha de cada orçamento aqui e veja o impacto no consolidado do projeto. Cada alteração é salva na hora, na versão aberta de cada um — orçamento aprovado ou já aberto como job fica em consulta."}
          </p>
          <div className="flex flex-none items-center gap-4">
          {!emConsulta && <StatusDaGravacao gravacao={gravacao} />}
          {!emConsulta && (
            <button
              type="button"
              onClick={abrirFormulario}
              className="inline-flex flex-none items-center gap-2 rounded-xl bg-california-red px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Plus className="h-4 w-4" />
              Criar orçamento de job
            </button>
          )}
          </div>
        </div>
      </div>

      {divergencias.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            Honorários da planilha ignorados —{" "}
            {divergencias
              .map(
                (d) =>
                  `${d.nome}: planilha com ${formatarPercentual(d.daPlanilha)}, orçamento segue com ${formatarPercentual(d.aplicado)}`,
              )
              .join(" · ")}
            . O percentual vem do cadastro do cliente; alterar só pelo
            &quot;Editar&quot; da tela da versão.
          </span>
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{erro}</span>
          <button
            type="button"
            onClick={() => setErro(null)}
            title="Fechar aviso"
            className="rounded-md p-1 hover:bg-california-red/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {visiveis.length < orcamentos.length && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5 text-[12.5px] text-amber-800">
          <EyeOff className="h-[15px] w-[15px] flex-none" />
          <span>
            {visiveis.length === 0
              ? "Nenhum orçamento selecionado para exibição — cards e Totais estão vazios."
              : `Exibindo ${visiveis.length} de ${orcamentos.length} orçamentos. Cards e Totais seguem esta seleção.`}
          </span>
          <button
            type="button"
            onClick={() => setExibidos(orcamentos.map((o) => o.id))}
            className="ml-auto text-xs font-semibold text-amber-800 underline"
          >
            Exibir todos
          </button>
        </div>
      )}

      {/* Orçamentos e Totais dividem a mesma calha: é o que faz as colunas
          Total / Rentab. / % do card de Totais caírem exatamente sob as
          mesmas colunas das planilhas dos grupos. O pr reserva a trilha de
          ações que fica fora do frame de cada card de grupo: 154px
          comportam o respiro (8px) + a pílula do BV (116px) + a lixeira
          (26px) + o gap. Mesmo arranjo da tela da versão individual. */}
      <div className="flex flex-col gap-6 pr-[154px]">
      <div className="flex flex-col gap-4">
        {midias.map((m) => (
          <CardMidiaNaAgregada
            key={m.id}
            orc={m}
            onAbrir={(evento, href) => {
              // Com gravação a caminho, o atalho pergunta antes de sair.
              if (!salvandoAgora) return;
              evento.preventDefault();
              setAskSair(href);
            }}
          />
        ))}
        {/* ⚠️ A chave Bruto ⇄ Líquido saiu daqui em 08/09/2026 (decisão
            062), pelo mesmo motivo da tela da versão: o BV passou a
            descontar só o REALIZADO, e o rascunho não tem realizado. */}
        {visiveis.map((orc) => {
          const bloqueio = orc.origemBanco?.bloqueio ?? null;
          return (
            <JobRascunhoCard
              modeloPlanilha={orc.modeloPlanilha}
              versaoLabel={`v${orc.origemBanco?.numeroVersao || 1}`}
              interno={
                orc.servico_id !== null && servicosInternos.has(orc.servico_id)
              }
              savePorItem={savePorItem}
              saveVisivel={saveVisivel}
              onAlternarSave={() => setSaveVisivel((v) => !v)}
              onAbrirSave={
                orc.origemBanco && !bloqueio
                  ? (item) =>
                      setLinhaSave({
                        item,
                        parametros: orc.parametros,
                        modeloPlanilha: orc.modeloPlanilha,
                      })
                  : undefined
              }
              key={orc.id}
              job={orc}
              meses={orc.meses}
              hrefOrcamento={
                orc.origemBanco
                  ? `/orcamentos/${projeto.id}/${orc.origemBanco.orcamentoId}?v=${orc.origemBanco.versaoId}`
                  : null
              }
              onAbrirOrcamento={(evento, href) => {
                // Com gravação a caminho, o link pergunta antes de sair.
                if (!salvandoAgora) return;
                evento.preventDefault();
                setAskSair(href);
              }}
              parametros={orc.parametros}
              visao={visao}
              descricao={descricao(orc)}
              categorias={categoriasItem}
              fornecedores={fornecedores}
              adaptador={adaptador}
              bvsPorItem={bvsPorItem}
              bloqueio={bloqueio}
              badge={
                orc.origemBanco
                  ? `v${orc.origemBanco.numeroVersao}`
                  : "Novo"
              }
              onEditarParametros={
                bloqueio
                  ? undefined
                  : () => setModal({ tipo: "parametros", orcamentoId: orc.id })
              }
              onAlternar={() =>
                mutarOrcamento(orc.id, (o) => ({ ...o, aberto: !o.aberto }))
              }
              onImportar={() =>
                setModal({ tipo: "importar", orcamentoId: orc.id })
              }
              onCriarPlanilha={() => criarPlanilha(orc.id)}
              onNovoGrupo={(mesId) => novoGrupo(orc.id, mesId)}
              onRenomearGrupo={(grupoId, nome) =>
                void renomearGrupoNoBanco(orc.id, grupoId, nome)
              }
              onRemoverGrupo={(grupoId) => void removerGrupoNoBanco(orc.id, grupoId)}
            />
          );
        })}
      </div>

        <TotaisProjetoCard
          moeda={moedaProjeto}
          descricao="Orçado × Planejado por orçamento · a versão vigente de cada um."
          linhas={linhasTotais}
        />
      </div>

      <Dialog
        open={modal?.tipo === "form"}
        onOpenChange={(o) => !o && setModal(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-lg font-bold tracking-tight">
            Novo orçamento de job
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            O orçamento é criado ao confirmar, com a v1 vazia. Depois é só
            importar a planilha ou criar a planilha nele.
          </DialogDescription>
          <OrcamentoForm
            projetoId={projeto.id}
            categorias={categorias}
            servicos={servicos}
            regionaisDoProjeto={regionaisDoProjeto}
            cidadesIniciais={cidadesIniciais}
            gpsDoProjeto={gpsDoProjeto}
            produtores={produtores}
            onRascunho={criarOrcamento}
            onCancel={() => setModal(null)}
            rotuloSubmit="Criar orçamento"
          />
        </DialogContent>
      </Dialog>

      {orcImportando && (
        <ImportarPlanilhaModal
          open
          onOpenChange={(o) => !o && setModal(null)}
          nome={orcImportando.nome}
          modeloPlanilha={orcImportando.modeloPlanilha}
          interno={
            orcImportando.servico_id !== null &&
            servicosInternos.has(orcImportando.servico_id)
          }
          onImportado={(planilha) => aplicarImportacao(orcImportando.id, planilha)}
        />
      )}

      {orcParametros && (
        <ParametrosModal
          open
          onOpenChange={(o) => !o && setModal(null)}
          parametros={orcParametros.parametros}
          onSalvar={(p: ParametrosVersao) => void salvarParametros(orcParametros, p)}
          clienteNome={projeto.cliente ?? "cliente"}
          travarImposto={
            orcParametros.modeloPlanilha === "internacional" &&
            !podeEditarImpostos
          }
        />
      )}

      <ConfirmDialog
        open={askSair !== null}
        onOpenChange={(aberto) => !aberto && setAskSair(null)}
        title="Ainda salvando"
        description="Uma alteração ainda está indo para o banco. Saindo agora, ela pode não ser gravada."
        confirmLabel="Sair mesmo assim"
        cancelLabel="Esperar"
        variant="destructive"
        onConfirm={() => {
          const destino = askSair ?? `/orcamentos/${projeto.id}`;
          setAskSair(null);
          router.push(destino);
        }}
      />

      <SaveDialog
        contexto="orcamento"
        open={linhaSave !== null}
        onOpenChange={(aberto) => !aberto && setLinhaSave(null)}
        linha={
          linhaSave
            ? {
                id: linhaSave.item.id,
                nome: linhaSave.item.item,
                grupoNome: nomeDoGrupo?.[linhaSave.item.grupo_id] ?? "—",
                tipoCusto: linhaSave.item.tipo_custo,
                totalOrcado: Number(linhaSave.item.total_orcado ?? 0),
              }
            : null
        }
        estado={
          linhaSave
            ? (savePorItem?.[linhaSave.item.id] ?? SAVE_VAZIO)
            : SAVE_VAZIO
        }
        saldos={saldosDeSave ?? []}
        moeda={linhaSave?.parametros.moeda ?? "BRL"}
        percentualHonorarios={linhaSave?.parametros.percentual_honorarios ?? 0}
        percentualImposto={linhaSave?.parametros.percentual_imposto ?? 0}
        internacional={
          linhaSave
            ? configDaPlanilha(linhaSave.modeloPlanilha, linhaSave.parametros)
                .internacional
            : null
        }
        clienteNome={projeto.cliente ?? "cliente"}
        onMarcarSave={
          linhaSave && podeMarcarSave
            ? async (marcar) => {
                const r = await marcarSaveDaLinha(linhaSave.item.id, marcar);
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
        onSalvarConsumo={
          linhaSave && podeMarcarSave
            ? async (origens) => {
                const r = await salvarConsumoDeSave(
                  linhaSave.item.id,
                  origens,
                );
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
      />
    </div>
  );
}

/** O que substitui o rodapé "Salvar alterações" (decisão 148): fica ao lado
 *  do "Criar orçamento de job" e diz se a última alteração já está gravada. */
function StatusDaGravacao({
  gravacao,
}: {
  gravacao: { pendentes: number; ultima: Date | null; falhou: boolean };
}) {
  const hora = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        gravacao.pendentes === 0 && gravacao.falhou
          ? "text-california-red"
          : "text-muted-foreground",
      )}
    >
      {gravacao.pendentes > 0 ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Salvando…
        </>
      ) : gravacao.falhou ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          Não salvou — a alteração foi desfeita
        </>
      ) : gravacao.ultima ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          Tudo salvo · {hora(gravacao.ultima)}
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          Salvamento automático
        </>
      )}
    </span>
  );
}

function periodo(inicio: string | null, fim: string | null): string | null {
  if (!inicio && !fim) return null;
  const br = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  };
  if (inicio && fim) return `${br(inicio)} — ${br(fim)}`;
  return br((inicio ?? fim) as string);
}

/** Mesma formatação do editor do orçamento do projeto. */
function formatarPercentual(valor: number): string {
  return `${valor.toFixed(2).replace(".", ",").replace(/,00$/, "")}%`;
}
