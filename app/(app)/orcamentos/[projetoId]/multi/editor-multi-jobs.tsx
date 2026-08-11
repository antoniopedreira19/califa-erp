"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  FilePlus,
  Layers,
  Lock,
  Pencil,
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
import { cn, formatCurrency } from "@/lib/utils";
import { calcularResultadoOperacional } from "@/lib/calculos/versao-totais";
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
import { OrcamentoForm, type DadosOrcamento } from "../orcamento-form";
import { JobRascunhoCard } from "../../_rascunho/orcamento-card";
import {
  ImportarPlanilhaModal,
  type PlanilhaLida,
} from "../../_rascunho/importar-planilha-modal";
import { ParametrosModal } from "../../_rascunho/parametros-modal";
import { TotaisProjetoCard } from "../../_totais/totais-projeto-card";
import { salvarOrcamentosDoProjeto } from "./actions";
import {
  ITEM_VAZIO,
  contarItens,
  divergenciaHonorarios,
  itensDoJob,
  novoId,
  totaisDoJob,
} from "../../_rascunho/rascunho";
import {
  PARAMETROS_PADRAO,
  type GrupoPayload,
  type ItemRascunho,
  type JobRascunho,
  type OrcamentoProjetoPayload,
  type ParametrosVersao,
} from "../../_rascunho/tipos";

interface Props {
  projeto: { id: string; codigo: string; nome: string; status: string };
  /** Honorários do cadastro do cliente. Único percentual válido aqui — o
   *  campo nasce preenchido e travado, e o servidor regrava por cima. */
  honorariosCliente: number;
  clienteNome: string;
  /** Quantos orçamentos o projeto já tem — base do código previsto. */
  orcamentosExistentes: number;
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
  | { tipo: "importar"; jobId: string }
  | { tipo: "parametros" }
  | null;

/**
 * Orçamento do projeto: vários orçamentos de job montados juntos.
 *
 * Tudo aqui é rascunho no navegador. Criar o orçamento, importar a
 * planilha, digitar item, lançar BV — nada disso toca o banco. O botão
 * "Salvar orçamentos" grava o lote inteiro de uma vez, cada orçamento na
 * sua versão v1, e é só então que eles aparecem na lista do projeto e na
 * tela de acompanhamento de versões.
 *
 * A consequência que justifica o desenho: abandonar a tela não deixa
 * meio-orçamento gravado no projeto.
 */
export function EditorMultiJobs({
  projeto,
  honorariosCliente,
  clienteNome,
  orcamentosExistentes,
  categorias,
  regionaisDoProjeto,
  cidades,
  gpsDoProjeto,
  produtores,
  categoriasItem,
  fornecedores,
}: Props) {
  const router = useRouter();
  const [parametros, setParametros] = React.useState<ParametrosVersao>({
    ...PARAMETROS_PADRAO,
    percentual_honorarios: honorariosCliente,
  });
  const [jobs, setJobs] = React.useState<JobRascunho[]>([]);
  const [modal, setModal] = React.useState<Modal>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [askCancelar, setAskCancelar] = React.useState(false);
  const [salvando, startSalvar] = React.useTransition();

  /** O XLSX original de cada job importado. Fora do estado porque `File`
   *  não é serializável e nenhum render depende dele — ele só reaparece
   *  no FormData do salvamento, para ser arquivado no bucket. */
  const arquivos = React.useRef(new Map<string, File>());

  // Fechar a aba com rascunho montado perde tudo. O aviso do navegador é
  // o único freio possível — não há nada gravado para recuperar depois.
  React.useEffect(() => {
    if (jobs.length === 0) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [jobs.length]);

  // ---------- consulta de rótulos ----------
  const nomePor = React.useMemo(
    () => ({
      categoria: new Map(categorias.map((c) => [c.id, c.nome])),
      regional: new Map(regionaisDoProjeto.map((r) => [r.id, r.nome])),
      cidade: new Map(cidades.map((c) => [c.id, c.nome])),
      gp: new Map(gpsDoProjeto.map((g) => [g.id, g.nome])),
    }),
    [categorias, regionaisDoProjeto, cidades, gpsDoProjeto],
  );

  function descricaoDoJob(job: JobRascunho): string {
    const partes = [
      job.categoria_id ? nomePor.categoria.get(job.categoria_id) : null,
      nomePor.regional.get(job.regional_id),
      nomePor.cidade.get(job.cidade_id),
      nomePor.gp.get(job.gp_responsavel_id)
        ? `GP ${nomePor.gp.get(job.gp_responsavel_id)}`
        : null,
      periodo(job.data_inicio_prevista, job.data_fim_prevista),
    ].filter(Boolean);
    return partes.join(" · ");
  }

  function codigoPrevisto(indice: number): string {
    const seq = orcamentosExistentes + indice + 1;
    return `${projeto.codigo}-${String(seq).padStart(2, "0")}`;
  }

  // ---------- mutações do rascunho ----------
  const mutarJobs = React.useCallback(
    (fn: (jobs: JobRascunho[]) => JobRascunho[]) => setJobs(fn),
    [],
  );

  const mutarItem = React.useCallback(
    (itemId: string, fn: (item: ItemRascunho) => ItemRascunho) => {
      setJobs((atuais) =>
        atuais.map((job) => ({
          ...job,
          grupos: job.grupos.map((grupo) => ({
            ...grupo,
            itens: grupo.itens.map((it) => (it.id === itemId ? fn(it) : it)),
          })),
        })),
      );
    },
    [],
  );

  /** Os adaptadores são criados uma vez e vivem enquanto a tela existir;
   *  o espelho em ref é o que deixa eles lerem a lista atual sem serem
   *  recriados (e sem remontar a planilha) a cada tecla digitada. */
  const jobsRef = React.useRef(jobs);
  jobsRef.current = jobs;

  const acharItem = React.useCallback((itemId: string): ItemRascunho | null => {
    for (const job of jobsRef.current) {
      for (const grupo of job.grupos) {
        const achado = grupo.itens.find((it) => it.id === itemId);
        if (achado) return achado;
      }
    }
    return null;
  }, []);

  function criarJob(dados: DadosOrcamento) {
    setJobs((atuais) => [
      ...atuais,
      { ...dados, id: novoId("job"), aberto: true, origem: null, grupos: [], arquivoNome: null, percentualHonorariosDetectado: null },
    ]);
    setModal(null);
    setErro(null);
  }

  function removerJob(jobId: string) {
    arquivos.current.delete(jobId);
    mutarJobs((atuais) => atuais.filter((j) => j.id !== jobId));
  }

  function alternarJob(jobId: string) {
    mutarJobs((atuais) =>
      atuais.map((j) => (j.id === jobId ? { ...j, aberto: !j.aberto } : j)),
    );
  }

  /** "Criar planilha" já abre com um grupo e uma linha em branco: o
   *  próximo passo é sempre digitar o primeiro item. */
  function criarPlanilha(jobId: string) {
    mutarJobs((atuais) =>
      atuais.map((j) =>
        j.id === jobId
          ? {
              ...j,
              origem: "manual",
              grupos: [
                {
                  id: novoId("g"),
                  nome: "Novo grupo",
                  itens: [{ ...ITEM_VAZIO, id: novoId("it") }],
                },
              ],
            }
          : j,
      ),
    );
  }

  function aplicarImportacao(jobId: string, planilha: PlanilhaLida) {
    arquivos.current.set(jobId, planilha.arquivo);
    mutarJobs((atuais) =>
      atuais.map((j) =>
        j.id === jobId
          ? {
              ...j,
              origem: "importado",
              arquivoNome: planilha.arquivo.name,
              percentualHonorariosDetectado: planilha.percentualHonorarios,
              grupos: planilha.grupos.map((g: GrupoPayload) => ({
                id: novoId("g"),
                nome: g.nome,
                itens: g.itens.map((it) => ({
                  ...it,
                  id: novoId("it"),
                  bv: null,
                })),
              })),
            }
          : j,
      ),
    );
    setErro(null);
  }

  function novoGrupo(jobId: string) {
    mutarJobs((atuais) =>
      atuais.map((j) =>
        j.id === jobId
          ? {
              ...j,
              grupos: [
                ...j.grupos,
                {
                  id: novoId("g"),
                  nome: `Novo grupo ${j.grupos.length + 1}`,
                  itens: [{ ...ITEM_VAZIO, id: novoId("it") }],
                },
              ],
            }
          : j,
      ),
    );
  }

  function renomearGrupo(jobId: string, grupoId: string, nome: string) {
    mutarJobs((atuais) =>
      atuais.map((j) =>
        j.id === jobId
          ? {
              ...j,
              grupos: j.grupos.map((g) =>
                g.id === grupoId ? { ...g, nome } : g,
              ),
            }
          : j,
      ),
    );
  }

  function removerGrupo(jobId: string, grupoId: string) {
    mutarJobs((atuais) =>
      atuais.map((j) =>
        j.id === jobId
          ? { ...j, grupos: j.grupos.filter((g) => g.id !== grupoId) }
          : j,
      ),
    );
  }

  // ---------- adaptadores da planilha ----------
  // A grade e o formulário de BV são os mesmos da tela da versão. Só o
  // destino da escrita muda: aqui é o estado do React, e a validação é a
  // mesma dos Server Actions porque os schemas Zod vêm do mesmo lugar.
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
          // BV só existe em item tipo A ou D. Sair desses tipos cancela o
          // que estava lá — no rascunho todo BV está "a negociar", então
          // não há o caso, travado no banco, de BV já no financeiro.
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
        mutarJobs((atuais) =>
          atuais.map((job) => ({
            ...job,
            grupos: job.grupos.map((grupo) =>
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
        mutarJobs((atuais) =>
          atuais.map((job) => ({
            ...job,
            grupos: job.grupos.map((grupo) => ({
              ...grupo,
              itens: grupo.itens.filter((it) => it.id !== itemId),
            })),
          })),
        );
        return { ok: true, id: itemId };
      },

      aposEscrita: () => {},
    }),
    [mutarItem, mutarJobs],
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

  // ---------- totais do cabeçalho ----------
  const resumo = React.useMemo(() => {
    let planejado = 0;
    let faturamento = 0;
    let imposto = 0;
    for (const job of jobs) {
      const t = totaisDoJob(job, parametros);
      planejado += t.planejado;
      faturamento += t.faturamento;
      imposto += t.imposto;
    }
    const { resultadoGeral } = calcularResultadoOperacional(
      faturamento,
      imposto,
      planejado,
    );
    return { planejado, faturamento, resultadoGeral };
  }, [jobs, parametros]);

  /** Planilhas cujo % de honorários não é o do cadastro do cliente. Não
   *  bloqueia nada — o cadastro vence — mas quem importou precisa saber. */
  const divergencias = React.useMemo(
    () =>
      jobs
        .map((job) => ({
          nome: job.nome,
          daPlanilha: divergenciaHonorarios(job, parametros),
        }))
        .filter(
          (d): d is { nome: string; daPlanilha: number } =>
            d.daPlanilha !== null,
        ),
    [jobs, parametros],
  );

  /** Cada job do rascunho vira uma linha do consolidado, no mesmo formato
   *  que a visão agregada usa para os orçamentos já gravados. */
  const linhasTotais = React.useMemo(
    () =>
      jobs.map((job, i) => {
        const t = totaisDoJob(job, parametros);
        return {
          id: job.id,
          codigo: codigoPrevisto(i),
          nome: job.nome,
          orcado: t.orcado,
          planejado: t.planejado,
          honorarios: t.honorarios,
          imposto: t.imposto,
          faturamento: t.faturamento,
          subtotaisPorTipo: t.subtotaisPorTipo,
          percentualHonorarios: t.percentualHonorarios,
          percentualImposto: parametros.percentual_imposto,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, parametros, orcamentosExistentes, projeto.codigo],
  );

  const totalItens = jobs.reduce((s, j) => s + contarItens(j.grupos), 0);
  const jobsSemItens = jobs.filter((j) => itensDoJob(j).length === 0);
  const podeSalvar =
    jobs.length > 0 && jobsSemItens.length === 0 && !salvando;

  // ---------- salvamento ----------
  function salvar() {
    if (jobs.length === 0) {
      setErro("Crie ao menos um orçamento de job.");
      return;
    }
    if (jobsSemItens.length > 0) {
      setErro(
        `Sem itens em: ${jobsSemItens.map((j) => j.nome).join(", ")}. Importe uma planilha ou adicione itens antes de salvar.`,
      );
      return;
    }
    setErro(null);

    const payload: OrcamentoProjetoPayload = {
      ...parametros,
      jobs: jobs.map((job) => ({
        nome: job.nome,
        categoria_id: job.categoria_id,
        regional_id: job.regional_id,
        cidade_id: job.cidade_id,
        gp_responsavel_id: job.gp_responsavel_id,
        produtor_id: job.produtor_id,
        data_inicio_prevista: job.data_inicio_prevista,
        data_fim_prevista: job.data_fim_prevista,
        arquivoCampo: arquivos.current.has(job.id)
          ? `arquivo_${job.id}`
          : null,
        grupos: job.grupos.map((grupo) => ({
          nome: grupo.nome,
          itens: grupo.itens.map((item) => ({
            item: item.item,
            tipo_custo: item.tipo_custo as TipoCusto,
            categoria_id: item.categoria_id,
            valor_unitario_orcado: item.valor_unitario_orcado,
            quantidade_orcada: item.quantidade_orcada,
            dias_meses_orcado: item.dias_meses_orcado,
            valor_unitario_planejado: item.valor_unitario_planejado,
            quantidade_planejada: item.quantidade_planejada,
            dias_meses_planejado: item.dias_meses_planejado,
            planilha_origem: item.planilha_origem,
            bv: item.bv,
          })),
        })),
      })),
    };

    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    for (const job of jobs) {
      const arquivo = arquivos.current.get(job.id);
      if (arquivo) formData.set(`arquivo_${job.id}`, arquivo);
    }

    startSalvar(async () => {
      const res = await salvarOrcamentosDoProjeto(projeto.id, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      // Some o aviso de saída: o rascunho virou registro.
      setJobs([]);
      router.push(`/orcamentos/${projeto.id}`);
      router.refresh();
    });
  }

  const modalImportar = modal?.tipo === "importar" ? modal : null;
  const jobImportando = modalImportar
    ? jobs.find((j) => j.id === modalImportar.jobId)
    : null;
  const indiceImportando = modalImportar
    ? jobs.findIndex((j) => j.id === modalImportar.jobId)
    : -1;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 pb-28">
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
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-mono text-sm font-semibold text-muted-foreground">
                v1
              </span>
              <h1 className="text-3xl font-bold tracking-tight">
                Orçamento do projeto
              </h1>
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700">
                Rascunho
              </span>
              <button
                type="button"
                onClick={() => setModal({ tipo: "parametros" })}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-muted-foreground">
              <span>
                Moeda:{" "}
                <strong className="font-semibold text-foreground">
                  {parametros.moeda}
                </strong>
              </span>
              <span aria-hidden className="text-border">·</span>
              <span className="inline-flex items-center gap-1.5">
                Honorários:{" "}
                <strong className="font-semibold text-foreground">
                  {formatarPercentual(parametros.percentual_honorarios)}
                </strong>
                <Lock
                  className="h-3 w-3"
                  aria-label={`Vem do cadastro de ${clienteNome}`}
                />
              </span>
              <span aria-hidden className="text-border">·</span>
              <span>
                Impostos:{" "}
                <strong className="font-semibold text-foreground">
                  {formatarPercentual(parametros.percentual_imposto)}
                </strong>
              </span>
            </p>
          </div>

          <div className="flex flex-none rounded-2xl border border-border bg-card shadow-soft">
            <Kpi
              rotulo="Faturamento previsto"
              valor={formatCurrency(resumo.faturamento, parametros.moeda)}
            />
            <Kpi
              rotulo="Custo planejado"
              valor={formatCurrency(resumo.planejado, parametros.moeda)}
              borda
            />
            <Kpi
              rotulo="Resultado geral"
              valor={
                resumo.resultadoGeral === null
                  ? "—"
                  : formatarPercentual(resumo.resultadoGeral)
              }
              tomVerde={resumo.resultadoGeral !== null && resumo.resultadoGeral >= 0}
              borda
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Layers className="h-4 w-4 text-california-red" />
            <span>
              {jobs.length === 0
                ? "Nenhum orçamento neste rascunho ainda"
                : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"} · ${totalItens} ${totalItens === 1 ? "item" : "itens"} · ${jobs.length === 1 ? "1 orçamento será criado" : `${jobs.length} orçamentos serão criados`}`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setModal({ tipo: "form" })}
            className="inline-flex items-center gap-2 rounded-xl bg-california-red px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover"
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
            Honorários da planilha ignorados: os orçamentos vão usar{" "}
            <strong>
              {formatarPercentual(parametros.percentual_honorarios)}
            </strong>{" "}
            do cadastro de {clienteNome}, não o percentual da planilha (
            {divergencias
              .map((d) => `${d.nome}: ${formatarPercentual(d.daPlanilha)}`)
              .join(" · ")}
            ).
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

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
            <FilePlus className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="mt-1.5 text-[15px] font-semibold">
            Nenhum orçamento ainda
          </p>
          <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
            Crie o primeiro orçamento de job. Cada um recebe sua própria
            planilha e vira um job quando aprovado.
          </p>
          <button
            type="button"
            onClick={() => setModal({ tipo: "form" })}
            className="mt-2.5 inline-flex items-center gap-2 rounded-xl bg-california-red px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-4 w-4" />
            Criar orçamento de job
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job, i) => (
            <JobRascunhoCard
              key={job.id}
              job={job}
              codigo={codigoPrevisto(i)}
              parametros={parametros}
              descricao={descricaoDoJob(job)}
              categorias={categoriasItem}
              fornecedores={fornecedores}
              adaptador={adaptador}
              adaptadorBv={adaptadorBv}
              onAlternar={() => alternarJob(job.id)}
              onRemover={() => removerJob(job.id)}
              onImportar={() => setModal({ tipo: "importar", jobId: job.id })}
              onCriarPlanilha={() => criarPlanilha(job.id)}
              onNovoGrupo={() => novoGrupo(job.id)}
              onRenomearGrupo={(grupoId, nome) =>
                renomearGrupo(job.id, grupoId, nome)
              }
              onRemoverGrupo={(grupoId) => removerGrupo(job.id, grupoId)}
            />
          ))}

          {/* Consolidado do projeto, na mesma leitura da visão agregada de
              Jobs: uma linha por orçamento, fechamento e resultado somando
              todos. */}
          <TotaisProjetoCard moeda={parametros.moeda} linhas={linhasTotais} />
        </div>
      )}

      {/* Rodapé fixo: no lugar do "Aprovar versão" da tela da versão, aqui
          o que fecha o fluxo é gravar o lote inteiro. */}
      <div className="sticky bottom-0 z-30 -mx-5 border-t border-border bg-white/95 backdrop-blur md:-mx-8">
        <div className="flex items-center gap-4 px-5 py-3.5 md:px-8">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-semibold">
              {jobs.length === 0
                ? "Nada para salvar ainda"
                : `Salvar ${jobs.length} ${jobs.length === 1 ? "orçamento" : "orçamentos"}`}
            </span>
            <span className="text-xs text-muted-foreground">
              {jobs.length === 0
                ? "Crie ao menos um orçamento de job."
                : "Cada um é gravado na versão v1 e aparece na lista do projeto."}
            </span>
          </div>
          {/* Sair leva o rascunho junto, e navegação do Next não dispara o
              aviso do navegador — a confirmação tem que ser nossa. */}
          <button
            type="button"
            onClick={() =>
              jobs.length > 0
                ? setAskCancelar(true)
                : router.push(`/orcamentos/${projeto.id}`)
            }
            className="inline-flex items-center rounded-xl border border-border bg-white px-4 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={!podeSalvar}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors",
              podeSalvar
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
                Salvar orçamentos
              </>
            )}
          </button>
        </div>
      </div>

      {/* O formulário é o MESMO da tela de sempre — em modo rascunho ele
          valida e devolve os campos em vez de gravar. */}
      <Dialog
        open={modal?.tipo === "form"}
        onOpenChange={(o) => !o && setModal(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-lg font-bold tracking-tight">
            Novo orçamento de job
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            O código será gerado no formato{" "}
            <span className="font-mono">{codigoPrevisto(jobs.length)}</span>{" "}
            quando o lote for salvo.
          </DialogDescription>
          <OrcamentoForm
            projetoId={projeto.id}
            categorias={categorias}
            regionaisDoProjeto={regionaisDoProjeto}
            cidades={cidades}
            gpsDoProjeto={gpsDoProjeto}
            produtores={produtores}
            onRascunho={criarJob}
            onCancel={() => setModal(null)}
            rotuloSubmit="Criar orçamento"
          />
        </DialogContent>
      </Dialog>

      {jobImportando && (
        <ImportarPlanilhaModal
          open
          onOpenChange={(o) => !o && setModal(null)}
          codigo={codigoPrevisto(indiceImportando)}
          onImportado={(planilha) =>
            aplicarImportacao(jobImportando.id, planilha)
          }
        />
      )}

      <ParametrosModal
        open={modal?.tipo === "parametros"}
        onOpenChange={(o) => !o && setModal(null)}
        parametros={parametros}
        onSalvar={setParametros}
        clienteNome={clienteNome}
      />

      <ConfirmDialog
        open={askCancelar}
        onOpenChange={setAskCancelar}
        title="Descartar o rascunho?"
        description={
          <>
            {jobs.length === 1
              ? "1 orçamento montado"
              : `${jobs.length} orçamentos montados`}{" "}
            com {totalItens} {totalItens === 1 ? "item" : "itens"} serão
            perdidos. Nada foi gravado ainda, então não há como recuperar
            depois.
          </>
        }
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        variant="destructive"
        onConfirm={() => {
          setAskCancelar(false);
          setJobs([]);
          router.push(`/orcamentos/${projeto.id}`);
        }}
      />
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  borda,
  tomVerde,
}: {
  rotulo: string;
  valor: string;
  borda?: boolean;
  tomVerde?: boolean;
}) {
  return (
    <div className={cn("px-6 py-3.5", borda && "border-l border-border")}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1.5 whitespace-nowrap font-mono text-xl font-bold leading-none",
          tomVerde && "text-emerald-700",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

function formatarPercentual(valor: number): string {
  return `${valor.toFixed(2).replace(".", ",").replace(/,00$/, "")}%`;
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
