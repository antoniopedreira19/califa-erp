"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, FolderKanban, Plus, Save, X } from "lucide-react";
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
  Cidade,
  Profile,
  Regional,
  TipoCusto,
} from "@/lib/types";
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
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  cidades: Pick<Cidade, "id" | "nome">[];
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  produtores: Pick<Profile, "id" | "nome">[];
  categoriasItem: Categoria[];
  fornecedores: FornecedorOpcao[];
}

/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */
const TIPOS_COM_BV: string[] = ["A", "D"];

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
  honorariosCliente,
  orcamentosExistentes,
  inicial,
  categorias,
  regionaisDoProjeto,
  cidades,
  gpsDoProjeto,
  produtores,
  categoriasItem,
  fornecedores,
}: Props) {
  const router = useRouter();
  const [orcamentos, setOrcamentos] =
    React.useState<OrcamentoRascunho[]>(inicial);
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
      cidade: new Map(cidades.map((c) => [c.id, c.nome])),
      gp: new Map(gpsDoProjeto.map((g) => [g.id, g.nome])),
    }),
    [categorias, regionaisDoProjeto, cidades, gpsDoProjeto],
  );

  function descricao(orc: OrcamentoRascunho): string {
    return [
      orc.categoria_id ? nomePor.categoria.get(orc.categoria_id) : null,
      nomePor.regional.get(orc.regional_id),
      nomePor.cidade.get(orc.cidade_id),
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
    setOrcamentos((atuais) => [
      ...atuais,
      {
        ...dados,
        id: novoId("orc"),
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
            !TIPOS_COM_BV.includes(String(parsed.data))
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
        if (!TIPOS_COM_BV.includes(alvo.tipo_custo)) {
          return {
            ok: false,
            message: "BV só pode ser lançado em item de custo tipo A ou D.",
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
  const linhasTotais = React.useMemo(() => {
    let novos = -1;
    return orcamentos.map((orc) => {
      if (!orc.origemBanco) novos += 1;
      const t = totaisDoJob(orc, orc.parametros);
      return {
        id: orc.id,
        codigo: codigoDe(orc, novos),
        nome: orc.nome,
        detalhe: orc.origemBanco
          ? `v${orc.origemBanco.numeroVersao}${
              orc.origemBanco.statusVersao === "aprovada" ? " · aprovada" : ""
            }`
          : "novo",
        orcado: t.orcado,
        planejado: t.planejado,
        honorarios: t.honorarios,
        imposto: t.imposto,
        faturamento: t.faturamento,
        subtotaisPorTipo: t.subtotaisPorTipo,
        percentualHonorarios: t.percentualHonorarios,
        percentualImposto: orc.parametros.percentual_imposto,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcamentos, orcamentosExistentes, projeto.codigo]);

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

  const resumo = linhasTotais.reduce(
    (acc, l) => ({
      faturamento: acc.faturamento + l.faturamento,
      imposto: acc.imposto + l.imposto,
      planejado: acc.planejado + l.planejado,
    }),
    { faturamento: 0, imposto: 0, planejado: 0 },
  );
  const { resultadoGeral } = calcularResultadoOperacional(
    resumo.faturamento,
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

  let contadorNovos = -1;

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
            <p className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-muted-foreground">
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
            </p>
          </div>

          <ResumoRentabilidade
            faturamento={resumo.faturamento}
            custoPlanejado={resumo.planejado}
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

      <div className="flex flex-col gap-4">
        {orcamentos.map((orc) => {
          if (!orc.origemBanco) contadorNovos += 1;
          const codigo = codigoDe(orc, contadorNovos);
          const bloqueio = orc.origemBanco?.bloqueio ?? null;
          return (
            <JobRascunhoCard
              key={orc.id}
              job={orc}
              codigo={codigo}
              parametros={orc.parametros}
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
            regionaisDoProjeto={regionaisDoProjeto}
            cidades={cidades}
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
          codigo={codigoDe(orcImportando, 0)}
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
