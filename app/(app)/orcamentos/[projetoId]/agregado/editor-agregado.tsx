"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  EyeOff,
  FolderKanban,
  Plus,
  Save,
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
import { bvSchema } from "@/lib/validations/bv";
import type {
  Categoria,
  CategoriaDominio,
  Profile,
  Regional,
  TipoCusto,
  VersaoOrcamentoItem,
} from "@/lib/types";
import type { CidadeOption } from "../../cidade-combobox";
import type { AdaptadorItens } from "../[orcId]/versoes/[versaoId]/itens-table";
import type { AdaptadorBv, FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import { ResumoRentabilidade } from "../[orcId]/versoes/[versaoId]/resumo-rentabilidade";
import { OrcamentoForm, type DadosOrcamento } from "../orcamento-form";
import { JobRascunhoCard } from "../../_rascunho/orcamento-card";
import {
  ImportarPlanilhaModal,
  type PlanilhaLida,
} from "../../_rascunho/importar-planilha-modal";
import { ParametrosModal } from "../../_rascunho/parametros-modal";
import { TotaisProjetoCard } from "../../_totais/totais-projeto-card";
import {
  ITEM_VAZIO,
  contarItens,
  divergenciaHonorarios,
  novoId,
  totaisDoJob,
} from "../../_rascunho/rascunho";
import {
  PARAMETROS_PADRAO,
  type AlteracoesProjetoPayload,
  type GrupoPayload,
  type ItemRascunho,
  type OrcamentoRascunho,
  type ParametrosVersao,
} from "../../_rascunho/tipos";
import { salvarAlteracoesDoProjeto } from "./actions";
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
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import { SAVE_VAZIO } from "@/app/(app)/_planilha/save-coluna";
import { SaveDialog, type LinhaDoSave } from "@/app/(app)/_planilha/save-dialog";
import type { SaldoDeSave } from "@/lib/data/saves";
import {
  marcarSaveDaLinha,
  salvarConsumoDeSave,
} from "../[orcId]/versoes/[versaoId]/save-actions";

interface Props {
  projeto: {
    id: string;
    codigo: string;
    nome: string;
    cliente: string | null;
    responsavel: string | null;
  };
  /** Honorários do cadastro do cliente. Vale para os orçamentos criados
   *  aqui; os que já existem mantêm o percentual gravado na versão. */
  honorariosCliente: number;
  /** Quantos orçamentos o projeto já tem — base do código previsto dos novos. */
  orcamentosExistentes: number;
  /** Estado inicial, montado no servidor a partir da versão vigente. */
  inicial: OrcamentoRascunho[];
  /** Os orçamentos gravados, como o seletor "Exportar" os vê — versão
   *  vigente e o valor que a aba imprime, calculados sobre o que está no
   *  banco. A exportação lê o banco, não o rascunho da tela. */
  exportaveis: OrcamentoExportavel[];
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  /** Serviço do job — escopo `projeto` de `categorias_dominio`,
   *  lista distinta das categorias acima (decisão 037). */
  servicos: Pick<CategoriaDominio, "id" | "nome">[];
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
 * Junta num lugar só os orçamentos que já existem — cada um na sua versão
 * vigente — e os que forem criados aqui. Tudo é rascunho no navegador até
 * o "Salvar alterações", que grava o lote de uma vez, do mesmo jeito que o
 * editor do orçamento do projeto.
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
export function EditorAgregado({
  projeto,
  savePorItem,
  saldosDeSave,
  nomeDoGrupo,
  honorariosCliente,
  orcamentosExistentes,
  inicial,
  exportaveis,
  categorias,
  servicos,
  regionaisDoProjeto,
  cidadesIniciais,
  gpsDoProjeto,
  produtores,
  categoriasItem,
  fornecedores,
}: Props) {
  const router = useRouter();
  // Uma chave para a página inteira, como na tela da versão: vários
  // orçamentos na mesma tela em modos diferentes não teriam leitura.
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);
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
  } | null>(null);
  const [orcamentos, setOrcamentos] =
    React.useState<OrcamentoRascunho[]>(inicial);
  // "Exibir": filtro de TELA. Cards e Totais seguem esta lista; os três
  // indicadores do topo são do projeto inteiro e não seguem. Nada é
  // salvo — o que está escondido continua entrando no "Salvar
  // alterações" como estava.
  const [exibidos, setExibidos] = React.useState<string[]>(() =>
    inicial.map((o) => o.id),
  );
  const [modal, setModal] = React.useState<Modal>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [askSair, setAskSair] = React.useState(false);
  const [salvando, startSalvar] = React.useTransition();

  /** O XLSX de cada orçamento importado nesta sessão. Fora do estado
   *  porque `File` não é serializável e nenhum render depende dele. */
  const arquivos = React.useRef(new Map<string, File>());

  /** Retrato do que está gravado. É contra ele que "houve mudança?" é
   *  respondido — sem isso o botão de salvar ficaria sempre aceso.
   *  `aberto` fica de fora: expandir um card não é alteração de conteúdo.
   *  Em estado, e não em ref, porque atualizar depois de salvar precisa
   *  redesenhar o rodapé. */
  const [baseline, setBaseline] = React.useState(() => assinatura(inicial));
  const sujo = assinatura(orcamentos) !== baseline;

  React.useEffect(() => {
    if (!sujo) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  // ---------- rótulos ----------
  const nomePor = React.useMemo(
    () => ({
      categoria: new Map(categorias.map((c) => [c.id, c.nome])),
      regional: new Map(regionaisDoProjeto.map((r) => [r.id, r.nome])),
      gp: new Map(gpsDoProjeto.map((g) => [g.id, g.nome])),
    }),
    [categorias, regionaisDoProjeto, gpsDoProjeto],
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

  /** Existente mostra o código real; novo, o próximo da sequência. */
  function codigoDe(orc: OrcamentoRascunho, indiceEntreNovos: number): string {
    if (orc.origemBanco) return orc.origemBanco.codigo;
    const seq = orcamentosExistentes + indiceEntreNovos + 1;
    return `${projeto.codigo}-${String(seq).padStart(2, "0")}`;
  }

  // ---------- mutações ----------
  const mutarItem = React.useCallback(
    (itemId: string, fn: (item: ItemRascunho) => ItemRascunho) => {
      setOrcamentos((atuais) =>
        atuais.map((orc) => ({
          ...orc,
          grupos: orc.grupos.map((grupo) => ({
            ...grupo,
            itens: grupo.itens.map((it) => (it.id === itemId ? fn(it) : it)),
          })),
        })),
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

  function criarOrcamento(dados: DadosOrcamento) {
    const id = novoId("orc");
    // O orçamento recém-criado sempre aparece, mesmo com a tela filtrada:
    // ninguém cria um orçamento para não vê-lo.
    setExibidos((atuais) => [...atuais, id]);
    setOrcamentos((atuais) => [
      ...atuais,
      {
        ...dados,
        id,
        aberto: true,
        origem: null,
        grupos: [],
        arquivoNome: null,
        percentualHonorariosDetectado: null,
        // Orçamento novo nasce com os honorários do cadastro do cliente.
        parametros: {
          ...PARAMETROS_PADRAO,
          percentual_honorarios: honorariosCliente,
        },
      },
    ]);
    setModal(null);
    setErro(null);
  }

  function removerOrcamento(id: string) {
    arquivos.current.delete(id);
    setOrcamentos((atuais) => atuais.filter((o) => o.id !== id));
    setExibidos((atuais) => atuais.filter((x) => x !== id));
  }

  function criarPlanilha(id: string) {
    mutarOrcamento(id, (o) => ({
      ...o,
      origem: "manual",
      grupos: [
        {
          id: novoId("g"),
          nome: "Novo grupo",
          itens: [{ ...ITEM_VAZIO, id: novoId("it") }],
        },
      ],
    }));
  }

  function aplicarImportacao(id: string, planilha: PlanilhaLida) {
    arquivos.current.set(id, planilha.arquivo);
    mutarOrcamento(id, (o) => ({
      ...o,
      origem: "importado",
      arquivoNome: planilha.arquivo.name,
      percentualHonorariosDetectado: planilha.percentualHonorarios,
      grupos: planilha.grupos.map((g: GrupoPayload) => ({
        id: novoId("g"),
        nome: g.nome,
        itens: g.itens.map((it) => ({ ...it, id: novoId("it"), bv: null })),
      })),
    }));
    setErro(null);
  }

  function novoGrupo(id: string) {
    mutarOrcamento(id, (o) => ({
      ...o,
      grupos: [
        ...o.grupos,
        {
          id: novoId("g"),
          nome: `Novo grupo ${o.grupos.length + 1}`,
          itens: [{ ...ITEM_VAZIO, id: novoId("it") }],
        },
      ],
    }));
  }

  // ---------- adaptadores da planilha ----------
  const adaptador = React.useMemo<AdaptadorItens>(
    () => ({
      atualizarCampo: async (itemId, campo, valor) => {
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
        mutarItem(itemId, (item) => {
          const atualizado = { ...item, [campo]: parsed.data } as ItemRascunho;
          if (
            campo === "tipo_custo" &&
            !aceitaBV(String(parsed.data))
          ) {
            atualizado.bv = null;
          }
          return atualizado;
        });
        return { ok: true, id: itemId };
      },

      adicionar: async (grupoId, formData) => {
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
        const id = novoId("it");
        setOrcamentos((atuais) =>
          atuais.map((orc) => ({
            ...orc,
            grupos: orc.grupos.map((grupo) =>
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
          })),
        );
        return { ok: true, id };
      },

      remover: async (itemId) => {
        setOrcamentos((atuais) =>
          atuais.map((orc) => ({
            ...orc,
            grupos: orc.grupos.map((grupo) => ({
              ...grupo,
              itens: grupo.itens.filter((it) => it.id !== itemId),
            })),
          })),
        );
        return { ok: true, id: itemId };
      },

      aposEscrita: () => {},
    }),
    [mutarItem],
  );

  const adaptadorBv = React.useMemo<AdaptadorBv>(
    () => ({
      salvar: async (itemId, formData) => {
        const alvo = acharItem(itemId);
        if (!alvo) return { ok: false, message: "Item não encontrado." };
        if (!aceitaBV(alvo.tipo_custo)) {
          return {
            ok: false,
            message:
              "BV só pode ser lançado em item de custo tipo A, A · Repasse ou D.",
          };
        }
        const parsed = bvSchema.safeParse({
          fornecedor_id: formData.get("fornecedor_id")?.toString() ?? "",
          valor: formData.get("valor")?.toString() ?? "",
          prazo_repasse: formData.get("prazo_repasse")?.toString() ?? "",
        });
        if (!parsed.success) {
          return {
            ok: false,
            message: parsed.error.errors[0]?.message ?? "BV inválido.",
          };
        }
        mutarItem(itemId, (item) => ({ ...item, bv: parsed.data }));
        return { ok: true, id: itemId };
      },
      cancelar: async (itemId) => {
        mutarItem(itemId, (item) => ({ ...item, bv: null }));
        return { ok: true, id: itemId };
      },
      aposEscrita: () => {},
    }),
    [acharItem, mutarItem],
  );

  // ---------- consolidado ----------
  // Código de cada orçamento, calculado uma vez sobre a lista INTEIRA: os
  // novos numeram pela posição entre os novos, e o filtro "Exibir" não
  // pode renumerar ninguém ao esconder um deles.
  const codigos = React.useMemo(() => {
    let novos = -1;
    return new Map(
      orcamentos.map((orc) => {
        if (!orc.origemBanco) novos += 1;
        return [orc.id, codigoDe(orc, novos)] as const;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcamentos, orcamentosExistentes, projeto.codigo]);

  const linhasTodas = React.useMemo(() => {
    return orcamentos.map((orc) => {
      const t = totaisDoJob(orc, orc.parametros);
      return {
        id: orc.id,
        codigo: codigos.get(orc.id) ?? "",
        nome: orc.nome,
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
        faturamentoPrevisto: t.faturamentoPrevisto,
        valorJob: t.valorJob,
        subtotaisPorTipo: t.subtotaisPorTipo,
        save: t.save,
        percentualHonorarios: t.percentualHonorarios,
        percentualImposto: orc.parametros.percentual_imposto,
      };
    });
  }, [orcamentos, codigos]);

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
  const resumo = linhasTodas.reduce(
    (acc, l) => ({
      faturamentoPrevisto: acc.faturamentoPrevisto + l.faturamentoPrevisto,
      valorJob: acc.valorJob + l.valorJob,
      imposto: acc.imposto + l.imposto,
      planejado: acc.planejado + l.planejado,
    }),
    { faturamentoPrevisto: 0, valorJob: 0, imposto: 0, planejado: 0 },
  );
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    resumo.valorJob,
    resumo.imposto,
    resumo.planejado,
  );

  const moedaProjeto = orcamentos[0]?.parametros.moeda ?? "BRL";
  const novosSemItens = orcamentos.filter(
    (o) => !o.origemBanco && contarItens(o.grupos) === 0,
  );

  // ---------- salvamento ----------
  function salvar() {
    if (!sujo) return;
    if (novosSemItens.length > 0) {
      setErro(
        `Sem itens em: ${novosSemItens.map((o) => o.nome).join(", ")}. Importe uma planilha ou adicione itens antes de salvar.`,
      );
      return;
    }
    setErro(null);

    const editados = orcamentos
      .filter((o) => o.origemBanco && !o.origemBanco.bloqueio)
      .map((o) => ({
        orcamentoId: o.origemBanco!.orcamentoId,
        versaoId: o.origemBanco!.versaoId,
        parametros: o.parametros,
        grupos: o.grupos.map((g) => ({
          // Id local (prefixo "g-") = grupo criado agora; o servidor insere.
          id: g.id.startsWith("g-") ? null : g.id,
          localId: g.id,
          nome: g.nome,
          itens: g.itens.map((it) => ({
            id: it.id.startsWith("it-") ? null : it.id,
            localId: it.id,
            item: it.item,
            tipo_custo: it.tipo_custo as TipoCusto,
            categoria_id: it.categoria_id,
            valor_unitario_orcado: it.valor_unitario_orcado,
            quantidade_orcada: it.quantidade_orcada,
            dias_meses_orcado: it.dias_meses_orcado,
            valor_unitario_planejado: it.valor_unitario_planejado,
            quantidade_planejada: it.quantidade_planejada,
            dias_meses_planejado: it.dias_meses_planejado,
            planilha_origem: it.planilha_origem,
            bv: it.bv,
          })),
        })),
      }));

    const novos = orcamentos.filter((o) => !o.origemBanco);

    const payload: AlteracoesProjetoPayload = {
      editados,
      novos: novos.map((o) => ({
        nome: o.nome,
        categoria_id: o.categoria_id,
        servico_id: o.servico_id,
        descritivo: o.descritivo,
        regional_id: o.regional_id,
        cidade_id: o.cidade_id,
        gp_responsavel_id: o.gp_responsavel_id,
        produtor_id: o.produtor_id,
        data_inicio_prevista: o.data_inicio_prevista,
        data_fim_prevista: o.data_fim_prevista,
        arquivoCampo: arquivos.current.has(o.id) ? `arquivo_${o.id}` : null,
        grupos: o.grupos.map((g) => ({
          nome: g.nome,
          itens: g.itens.map((it) => ({
            item: it.item,
            tipo_custo: it.tipo_custo as TipoCusto,
            categoria_id: it.categoria_id,
            valor_unitario_orcado: it.valor_unitario_orcado,
            quantidade_orcada: it.quantidade_orcada,
            dias_meses_orcado: it.dias_meses_orcado,
            valor_unitario_planejado: it.valor_unitario_planejado,
            quantidade_planejada: it.quantidade_planejada,
            dias_meses_planejado: it.dias_meses_planejado,
            planilha_origem: it.planilha_origem,
            bv: it.bv,
          })),
        })),
      })),
      parametrosNovos: novos.map((o) => o.parametros),
    };

    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    for (const o of novos) {
      const arquivo = arquivos.current.get(o.id);
      if (arquivo) formData.set(`arquivo_${o.id}`, arquivo);
    }

    startSalvar(async () => {
      const res = await salvarAlteracoesDoProjeto(projeto.id, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      // As linhas criadas agora trocam o id local pelo real. Sem isso, um
      // segundo salvamento antes de a página recarregar as inseriria de
      // novo — e recarregar pode falhar.
      const comIds = trocarIds(orcamentos, res.ids);
      setOrcamentos(comIds);
      setBaseline(assinatura(comIds));
      router.refresh();
    });
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
        <Link
          href={`/orcamentos/${projeto.id}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projeto.codigo} · {projeto.nome}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
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
                <ImportarOrcamentosDrawer projetoId={projeto.id} />
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
            Edite a planilha de cada orçamento aqui e veja o impacto no
            consolidado do projeto. As alterações caem na versão aberta de cada
            um — orçamento aprovado ou já aberto como job fica em consulta.
          </p>
          <button
            type="button"
            onClick={() => setModal({ tipo: "form" })}
            className="inline-flex flex-none items-center gap-2 rounded-xl bg-california-red px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-4 w-4" />
            Criar orçamento de job
          </button>
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
        <div className="flex justify-end">
          <ChaveBrutoLiquido visao={visao} onChange={setVisao} />
        </div>
        {visiveis.map((orc) => {
          const codigo = codigos.get(orc.id) ?? "";
          const bloqueio = orc.origemBanco?.bloqueio ?? null;
          return (
            <JobRascunhoCard
              savePorItem={savePorItem}
              saveVisivel={saveVisivel}
              onAlternarSave={() => setSaveVisivel((v) => !v)}
              onAbrirSave={
                orc.origemBanco && !bloqueio
                  ? (item) =>
                      setLinhaSave({ item, parametros: orc.parametros })
                  : undefined
              }
              key={orc.id}
              job={orc}
              codigo={codigo}
              parametros={orc.parametros}
              visao={visao}
              descricao={descricao(orc)}
              categorias={categoriasItem}
              fornecedores={fornecedores}
              adaptador={adaptador}
              adaptadorBv={adaptadorBv}
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
              onRemover={() => removerOrcamento(orc.id)}
              onImportar={() =>
                setModal({ tipo: "importar", orcamentoId: orc.id })
              }
              onCriarPlanilha={() => criarPlanilha(orc.id)}
              onNovoGrupo={() => novoGrupo(orc.id)}
              onRenomearGrupo={(grupoId, nome) =>
                mutarOrcamento(orc.id, (o) => ({
                  ...o,
                  grupos: o.grupos.map((g) =>
                    g.id === grupoId ? { ...g, nome } : g,
                  ),
                }))
              }
              onRemoverGrupo={(grupoId) =>
                mutarOrcamento(orc.id, (o) => ({
                  ...o,
                  grupos: o.grupos.filter((g) => g.id !== grupoId),
                }))
              }
            />
          );
        })}
      </div>

        <TotaisProjetoCard
          moeda={moedaProjeto}
          descricao="Orçado × Planejado por orçamento · a versão vigente de cada um, com as alterações ainda não salvas já refletidas."
          linhas={linhasTotais}
        />
      </div>

      <div className="sticky bottom-0 z-30 -mx-5 border-t border-border bg-white/95 backdrop-blur md:-mx-8">
        <div className="flex items-center gap-4 px-5 py-3.5 md:px-8">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-semibold">
              {sujo ? "Alterações não salvas" : "Nada alterado ainda"}
            </span>
            <span className="text-xs text-muted-foreground">
              {sujo
                ? "Nada foi gravado até você salvar."
                : "Edite a planilha de qualquer orçamento para começar."}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              sujo ? setAskSair(true) : router.push(`/orcamentos/${projeto.id}`)
            }
            className="inline-flex items-center rounded-xl border border-border bg-white px-4 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={!sujo || salvando}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors",
              sujo && !salvando
                ? "bg-california-red hover:bg-california-red-hover"
                : "cursor-not-allowed bg-muted-foreground/40",
            )}
          >
            {salvando ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar alterações
              </>
            )}
          </button>
        </div>
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
            O código será gerado quando as alterações forem salvas.
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
          codigo={codigos.get(orcImportando.id) ?? ""}
          onImportado={(planilha) =>
            aplicarImportacao(orcImportando.id, planilha)
          }
        />
      )}

      {orcParametros && (
        <ParametrosModal
          open
          onOpenChange={(o) => !o && setModal(null)}
          parametros={orcParametros.parametros}
          onSalvar={(p: ParametrosVersao) =>
            mutarOrcamento(orcParametros.id, (o) => ({ ...o, parametros: p }))
          }
          clienteNome={projeto.cliente ?? "cliente"}
        />
      )}

      <ConfirmDialog
        open={askSair}
        onOpenChange={setAskSair}
        title="Sair sem salvar?"
        description="As alterações feitas nesta tela serão perdidas. Nada foi gravado ainda."
        confirmLabel="Sair sem salvar"
        cancelLabel="Continuar editando"
        variant="destructive"
        onConfirm={() => {
          setAskSair(false);
          setBaseline(assinatura(orcamentos));
          router.push(`/orcamentos/${projeto.id}`);
        }}
      />

      <SaveDialog
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
        clienteNome={projeto.cliente ?? "cliente"}
        onMarcarSave={
          linhaSave
            ? async (marcar) => {
                const r = await marcarSaveDaLinha(linhaSave.item.id, marcar);
                if (r.ok) router.refresh();
                return r;
              }
            : undefined
        }
        onSalvarConsumo={
          linhaSave
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

/** Aplica o mapa "id local → id real" devolvido pelo salvamento. */
function trocarIds(
  orcamentos: OrcamentoRascunho[],
  ids: Record<string, string>,
): OrcamentoRascunho[] {
  if (Object.keys(ids).length === 0) return orcamentos;
  return orcamentos.map((orc) => ({
    ...orc,
    grupos: orc.grupos.map((g) => ({
      ...g,
      id: ids[g.id] ?? g.id,
      itens: g.itens.map((it) => ({ ...it, id: ids[it.id] ?? it.id })),
    })),
  }));
}

/** Só o que vai para o banco. Abrir e fechar cards não conta como edição. */
function assinatura(orcamentos: OrcamentoRascunho[]): string {
  return JSON.stringify(
    orcamentos.map(({ aberto: _aberto, ...resto }) => resto),
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
