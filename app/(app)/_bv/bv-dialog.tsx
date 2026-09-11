"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BadgePercent,
  Pencil,
  Plus,
  Save,
  SendHorizonal,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { NovoFornecedorDialog } from "@/app/(app)/fornecedores/novo-fornecedor-dialog";
import {
  carregarFornecedor,
  type FornecedorResumo,
} from "@/app/(app)/fornecedores/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency, formatDocumento } from "@/lib/utils";
import { calcularTotaisPlanejados } from "@/lib/calculos/versao-totais";
import { bvLiquido, impostoDoBv } from "@/lib/calculos/bv-planilha";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  type Bloco,
} from "@/app/(app)/_planilha/blocos";
import {
  bvSituacaoLabel,
  type BvSituacao,
  type Fornecedor,
  type ItemBv,
  type TipoCusto,
} from "@/lib/types";
import {
  cancelarBv,
  confirmarBv,
  salvarBv,
  type ActionResult,
  type OrigemBv,
} from "./actions";

export interface FornecedorOpcao {
  id: string;
  nome: string;
  /** CPF/CNPJ — segunda linha da opção e chave de busca. Opcional: nem
   *  toda tela que abre o BV carrega o documento (09/09/2026). */
  cpf_cnpj?: string | null;
}

/** Onde o BV é gravado.
 *
 *  Por padrão nas Server Actions, contra o item já existente no banco. O
 *  editor de orçamento do projeto passa um adaptador que guarda o BV no
 *  rascunho: lá o item ainda não tem id, e a linha em `itens_bv` só nasce
 *  no "Salvar orçamentos", depois que os itens existem. */
export interface AdaptadorBv {
  /** `chaveDoItem` é a chave do item **no espaço de quem grava**: o id em
   *  `versoes_orcamento_itens` nas Server Actions, a chave local da linha
   *  no rascunho. Quem chama o dialog é que sabe qual das duas é — ver a
   *  prop `chaveDoItem`.
   *
   *  `bvId` ausente ⇒ BV novo na linha (decisão 062: vários por item). */
  salvar: (
    chaveDoItem: string,
    formData: FormData,
    bvId?: string | null,
  ) => Promise<ActionResult>;
  cancelar: (bvId: string) => Promise<ActionResult>;
  /** No-op no rascunho: o estado do React já é a fonte. */
  aposEscrita: () => void;
}

/** O que o formulário precisa do item, para desenhar o cabeçalho e as
 *  caixas de valores. `VersaoOrcamentoItem` (orçamento) e
 *  `ItemPlanilhaJob` (job) satisfazem os dois.
 *
 *  **O `id` daqui NÃO é a chave do BV.** Ele significa coisas diferentes
 *  conforme a tela — no orçamento é o item da versão, no job é a cópia em
 *  `jobs_itens_orcado` —, e foi exatamente essa ambiguidade que deixou a
 *  gravação do job devolvendo "Item não encontrado." (decisão 071). A
 *  chave de gravação vem separada, na prop `chaveDoItem`. */
export interface ItemComBv {
  id: string;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
}

/** Bloco Realizado — só existe na planilha do job. */
export interface RealizadoDoItem {
  valorUnitario: number;
  quantidade: number;
  diasMeses: number;
  total: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ItemComBv;
  /** A chave por onde o BV é gravado — **obrigatória e explícita**,
   *  porque `item.id` não serve para as duas telas:
   *
   *  - orçamento: `versoes_orcamento_itens.id`, que é o próprio
   *    `item.id`;
   *  - job: `ItemPlanilhaJob.item_versao_id`, e **não** o `item.id`, que
   *    lá é o id da cópia em `jobs_itens_orcado`;
   *  - rascunho (com `adaptador`): a chave local da linha.
   *
   *  Linha de job nascida de errata tem `item_versao_id` nulo e por isso
   *  não tem BV: a calha não oferece o botão (decisão 071). */
  chaveDoItem: string;
  grupoNome: string;
  versaoLabel: string;
  categoriaNome: string | null;
  moeda: string;
  /** TODOS os BVs ativos da linha. Um item pode ter vários desde
   *  08/09/2026 (decisão 062), cada um com fornecedor, alíquota e
   *  situação próprios. Lista vazia ⇒ o formulário abre criando o
   *  primeiro. */
  bvs: ItemBv[];
  fornecedores: FornecedorOpcao[];
  /** Alíquota do job (`versoes_orcamento.percentual_imposto`). Serve só
   *  de SUGESTÃO ao campo do BV novo — desde 08/09/2026 cada BV tem a
   *  própria alíquota, e é ela que vale (decisão 062). */
  percentualImposto: number;
  /** Muda o rodapé e o terceiro bloco de valores. */
  origem: OrigemBv;
  /** Job: substitui a caixa de rentabilidade. Ignorado no orçamento. */
  realizado?: RealizadoDoItem | null;
  /** Contexto congelado (versão aprovada no orçamento, job encerrado):
   *  o BV é consultado, nunca gravado. */
  readOnly?: boolean;
  /** Ausente ⇒ grava direto nas Server Actions. */
  adaptador?: AdaptadorBv;
}

/** Aceita "1.234,56" e "1234.56". Vírgula presente ⇒ ponto é milhar.
 *  Mesma regra da edição inline da planilha. */
function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Só roda ao abrir o formulário, nunca a cada tecla — durante a digitação
 *  o campo fica cru. Campo de dinheiro tem que reabrir "750,50", não
 *  "750,5"; o separador de milhar volta a ser lido por `parseNumero`,
 *  que trata ponto como milhar quando há vírgula. */
function paraEdicao(valor: number): string {
  if (valor === 0) return "";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarPercentual(percentual: number): string {
  return `${percentual.toFixed(1).replace(".", ",")}%`;
}

/** Alíquota em duas casas — 19,53% e 24,27%. Uma casa só (o formato do
 *  percentual do BV) não distinguiria 19,53 de 19,54, que é justamente o
 *  par que a decisão 006 existe para separar. */
function formatarAliquota(percentual: number): string {
  return `${Number(percentual ?? 0).toFixed(2).replace(".", ",")}%`;
}

/** O subtítulo mudava de verdade com o A · Repasse: nele o principal NÃO
 *  vai direto ao fornecedor, passa pela California. Dizer "cliente paga o
 *  fornecedor diretamente" numa linha AR seria informação errada. */
function descricaoDaCalha(tipo: TipoCusto): string {
  return tipo === "AR"
    ? "a California repassa o principal ao fornecedor"
    : "cliente paga o fornecedor diretamente";
}

/** Cor da pílula por situação: âmbar enquanto se negocia, grafite quando
 *  fechado, verde quando o dinheiro entrou. A mesma família das pílulas
 *  de tipo da planilha — pastilha com ponto, não etiqueta de formulário. */
const TOM_SITUACAO: Record<
  BvSituacao,
  { moldura: string; ponto: string }
> = {
  a_negociar: {
    moldura: "border-amber-200 bg-amber-50 text-amber-800",
    ponto: "bg-amber-500",
  },
  confirmado: {
    moldura: "border-border bg-muted text-foreground",
    ponto: "bg-foreground",
  },
  recebido: {
    moldura: "border-emerald-200 bg-emerald-50 text-emerald-800",
    ponto: "bg-emerald-600",
  },
  cancelado: {
    moldura: "border-border bg-muted text-muted-foreground",
    ponto: "bg-muted-foreground",
  },
};

/** Situação como ESTADO no cabeçalho, e não campo no corpo: ninguém a
 *  escolhe — ela anda sozinha com os eventos das outras telas. */
function PilulaSituacao({ situacao }: { situacao: BvSituacao }) {
  const tom = TOM_SITUACAO[situacao];
  return (
    <span
      title="A situação anda sozinha: nasce em A negociar, vira Confirmado no envio ao financeiro e Recebido na baixa do contas a receber."
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border py-1 pl-2 pr-3 text-xs font-semibold",
        tom.moldura,
      )}
    >
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", tom.ponto)} />
      {bvSituacaoLabel(situacao)}
    </span>
  );
}

export function BvDialog({
  open,
  onOpenChange,
  item,
  chaveDoItem,
  grupoNome,
  versaoLabel,
  categoriaNome,
  moeda,
  bvs,
  fornecedores,
  percentualImposto,
  origem,
  realizado,
  readOnly,
  adaptador,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const acoes = React.useMemo<AdaptadorBv>(
    () =>
      adaptador ?? {
        salvar: (chave, formData, bvId) =>
          salvarBv(chave, formData, origem, bvId),
        cancelar: (bvId) => cancelarBv(bvId, origem),
        aposEscrita: () => router.refresh(),
      },
    [adaptador, origem, router],
  );
  const [erro, setErro] = React.useState<string | null>(null);
  const [askRemover, setAskRemover] = React.useState(false);
  const [askConfirmar, setAskConfirmar] = React.useState(false);

  const [fornecedorId, setFornecedorId] = React.useState<string | null>(null);
  /** O cadastro de fornecedor de dentro do BV (09/09/2026): "+" cria,
   *  lápis revisa o escolhido. */
  const [novoFornecedorOpen, setNovoFornecedorOpen] = React.useState(false);
  const [fornecedorEditando, setFornecedorEditando] = React.useState<
    string | null
  >(null);
  const [nomeSugerido, setNomeSugerido] = React.useState("");
  const [fornecedorParaEditar, setFornecedorParaEditar] =
    React.useState<Fornecedor | null>(null);
  /** O recém-cadastrado, que ainda não está na lista que veio do
   *  servidor. Ele fica aqui até o dialog fechar e a tela recarregar. */
  const [fornecedorNovo, setFornecedorNovo] =
    React.useState<FornecedorOpcao | null>(null);
  const fornecedoresVisiveis = React.useMemo(
    () =>
      fornecedorNovo && !fornecedores.some((f) => f.id === fornecedorNovo.id)
        ? [...fornecedores, fornecedorNovo].sort((x, y) =>
            x.nome.localeCompare(y.nome, "pt-BR"),
          )
        : fornecedores,
    [fornecedores, fornecedorNovo],
  );
  /** Nome em cima, documento embaixo — e a busca olha os dois. */
  const itensFornecedor = React.useMemo(
    () =>
      fornecedoresVisiveis.map((f) => ({
        value: f.id,
        label: f.nome,
        descricao: f.cpf_cnpj ? formatDocumento(f.cpf_cnpj) : undefined,
      })),
    [fornecedoresVisiveis],
  );
  React.useEffect(() => {
    if (!fornecedorEditando) {
      setFornecedorParaEditar(null);
      return;
    }
    let vivo = true;
    carregarFornecedor(fornecedorEditando).then((res) => {
      if (!vivo) return;
      if (res.ok) setFornecedorParaEditar(res.fornecedor);
      else {
        setNovoFornecedorOpen(false);
        setFornecedorEditando(null);
      }
    });
    return () => {
      vivo = false;
    };
  }, [fornecedorEditando]);

  /** Escolher um fornecedor que pode não estar na lista do servidor: o
   *  que acabou de ser criado, ou o que o cadastro achou pelo documento.
   *  Sem `router.refresh()` aqui — no meio do preenchimento ele
   *  re-renderiza a tela e zera o formulário (visto na PP em 04/09). */
  function adotarFornecedor(f: FornecedorResumo) {
    setFornecedorNovo({ id: f.id, nome: f.nome, cpf_cnpj: f.cpf_cnpj ?? null });
    setFornecedorId(f.id);
  }
  const [valorRaw, setValorRaw] = React.useState("");
  const [aliquotaRaw, setAliquotaRaw] = React.useState("");

  /** Qual BV da lista o formulário está editando. `null` = está criando
   *  um BV novo, que é como a linha sem nenhum BV abre. */
  const [selecionadoId, setSelecionadoId] = React.useState<string | null>(null);

  const noJob = origem === "job";

  const bvSelecionado = React.useMemo(
    () => bvs.find((b) => b.id === selecionadoId) ?? null,
    [bvs, selecionadoId],
  );

  /** Criando um BV, o formulário está em branco — e todo BV nasce em "A
   *  negociar". As páginas só entregam BVs ativos, então cancelado nunca
   *  chega aqui. */
  const situacaoAtual: BvSituacao = bvSelecionado?.situacao ?? "a_negociar";

  /** Confirmado já foi ao financeiro; recebido já teve baixa no contas a
   *  receber. Nos dois casos ninguém altera mais nada NESTE BV — os
   *  outros da mesma linha seguem editáveis (decisão 062). */
  const travadoPorSituacao = situacaoAtual !== "a_negociar";
  const somenteLeitura = Boolean(readOnly) || travadoPorSituacao;

  // Abrir a linha seleciona o primeiro BV editável; não havendo nenhum, a
  // lista abre no formulário de BV novo. Sem isto, uma linha só com BVs
  // já confirmados abriria travada e sem caminho para lançar o próximo.
  React.useEffect(() => {
    if (!open) return;
    const editavel = bvs.find((b) => b.situacao === "a_negociar");
    setSelecionadoId(editavel?.id ?? bvs[0]?.id ?? null);
    setErro(null);
  }, [open, bvs]);

  // Trocar de BV na lista (ou voltar para "BV novo") tem que trazer os
  // valores daquele BV — senão o formulário mostraria os do anterior.
  React.useEffect(() => {
    if (!open) return;
    setFornecedorId(bvSelecionado?.fornecedor_id ?? null);
    setValorRaw(paraEdicao(Number(bvSelecionado?.valor ?? 0)));
    setAliquotaRaw(
      bvSelecionado
        ? bvSelecionado.percentual_imposto === null ||
          bvSelecionado.percentual_imposto === undefined
          ? ""
          : String(bvSelecionado.percentual_imposto).replace(".", ",")
        : "",
    );
  }, [open, bvSelecionado]);

  const totalOrcado = Number(item.total_orcado);
  const totalPlanejado = Number(item.total_planejado);
  const { rentabilidade, percentualRentabilidade } = calcularTotaisPlanejados([
    { total_orcado: totalOrcado, total_planejado: totalPlanejado },
  ]);

  const valorBv = parseNumero(valorRaw) ?? 0;
  // Percentual sobre o orçado: é sobre esse total que o BV é negociado.
  const percentualBv = totalOrcado > 0 ? (valorBv / totalOrcado) * 100 : null;

  // A alíquota deste BV. Vazia enquanto se negocia — aí não há imposto a
  // mostrar, e o líquido é o próprio bruto até alguém informá-la.
  const aliquotaDoBv = parseNumero(aliquotaRaw);
  const temAliquota = aliquotaDoBv !== null;

  // O que a California de fato recebe. Informativo desde 08/09/2026: o
  // que a planilha subtrai do REALIZADO é o BRUTO (decisão 062).
  // Acompanha a digitação — o usuário vê o líquido mudar enquanto
  // negocia, que é o ponto de mostrá-lo aqui.
  const impostoBv = temAliquota ? impostoDoBv(valorBv, aliquotaDoBv) : 0;
  const liquidoBv = temAliquota ? bvLiquido(valorBv, aliquotaDoBv) : valorBv;

  /** Soma dos BVs que já descontam o realizado — o número que a planilha
   *  mostra na sub-linha. Só faz sentido com mais de um BV na linha. */
  const somaQueDesconta = bvs.reduce(
    (acc, b) =>
      b.situacao === "confirmado" || b.situacao === "recebido"
        ? acc + Number(b.valor ?? 0)
        : acc,
    0,
  );

  const prazoRef = React.useRef<HTMLFormElement>(null);

  /** Lê o prazo do input escondido do DatePicker e monta o payload. */
  function montarFormData(): FormData | null {
    const valor = parseNumero(valorRaw);
    if (valor === null) {
      setErro("Informe o valor do BV.");
      return null;
    }
    if (aliquotaRaw.trim() !== "" && aliquotaDoBv === null) {
      setErro("Alíquota inválida.");
      return null;
    }
    const formData = new FormData();
    if (fornecedorId) formData.set("fornecedor_id", fornecedorId);
    formData.set("valor", String(valor));
    if (aliquotaDoBv !== null) {
      formData.set("percentual_imposto", String(aliquotaDoBv));
    }
    const prazo = prazoRef.current
      ? new FormData(prazoRef.current).get("prazo_repasse")
      : null;
    if (prazo) formData.set("prazo_repasse", prazo.toString());
    return formData;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (somenteLeitura) return;

    const formData = montarFormData();
    if (!formData) return;

    setErro(null);
    startTransition(async () => {
      const res = await acoes.salvar(chaveDoItem, formData, selecionadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      acoes.aposEscrita();
    });
  }

  /** Confirmar exige fornecedor: é quem vai devolver o valor, e sem nome
   *  não existe cobrança. A trava também vale no servidor. */
  function handlePedirConfirmacao() {
    if (!fornecedorId) {
      setErro("Informe o fornecedor antes de confirmar o BV.");
      return;
    }
    if (parseNumero(valorRaw) === null) {
      setErro("Informe o valor do BV.");
      return;
    }
    // A alíquota só é cobrada AQUI — é o envio ao contas a receber que
    // precisa dela (decisão 062). Lançar e negociar o BV sem alíquota
    // continua valendo.
    if (aliquotaDoBv === null) {
      setErro(
        "Informe a alíquota do imposto antes de enviar o BV ao contas a receber.",
      );
      return;
    }
    setErro(null);
    setAskConfirmar(true);
  }

  function handleConfirmar() {
    startTransition(async () => {
      // Grava primeiro o que estiver na tela: confirmar sem salvar
      // enviaria ao financeiro um valor diferente do que o usuário vê.
      const formData = montarFormData();
      if (!formData) {
        setAskConfirmar(false);
        return;
      }
      const salvo = await acoes.salvar(chaveDoItem, formData, selecionadoId);
      if (!salvo.ok) {
        setAskConfirmar(false);
        setErro(salvo.message);
        return;
      }
      // O id vem do salvamento: num BV recém-criado ele só existe depois
      // de gravar, e confirmar pelo id do item deixaria de funcionar com
      // vários BVs na linha.
      const alvo = selecionadoId ?? salvo.id;
      if (!alvo) {
        setAskConfirmar(false);
        setErro("Não foi possível identificar o BV para confirmar.");
        return;
      }
      const res = await confirmarBv(alvo);
      setAskConfirmar(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleRemover() {
    if (!selecionadoId) {
      setAskRemover(false);
      return;
    }
    startTransition(async () => {
      const res = await acoes.cancelar(selecionadoId);
      setAskRemover(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      acoes.aposEscrita();
    });
  }

  const fornecedorFaltando = noJob && !fornecedorId && !somenteLeitura;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          <form ref={prazoRef} onSubmit={handleSubmit}>
            {/* Cabeçalho — identifica a linha da planilha de onde o
                formulário foi aberto, e mostra em que ponto do ciclo o BV
                está. A Situação vive AQUI, e não no corpo: ela é estado,
                não campo — ninguém a escolhe. Encostada à direita, no
                espaço que já estava vazio ao lado do fechar. */}
            <div className="flex items-start gap-4 px-6 pb-4 pt-5 pr-16">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-lg font-bold tracking-tight">
                    {item.item}
                  </DialogTitle>
                  <Badge variant="outline" className="px-1.5">
                    {item.tipo_custo}
                  </Badge>
                  {categoriaNome && (
                    <Badge variant="neutral">{categoriaNome}</Badge>
                  )}
                </div>
                <DialogDescription className="text-xs">
                  Grupo {grupoNome} · versão {versaoLabel} ·{" "}
                  {descricaoDaCalha(item.tipo_custo)}
                </DialogDescription>
              </div>
              <div className="flex flex-none items-center gap-2.5 pt-0.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Situação
                </span>
                <PilulaSituacao situacao={situacaoAtual} />
              </div>
            </div>

            {erro && (
              <div className="flex items-center justify-between gap-3 border-y border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
                <span>{erro}</span>
                <button
                  type="button"
                  onClick={() => setErro(null)}
                  className="rounded-md p-1 hover:bg-california-red/10"
                  title="Fechar aviso"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="grid border-t border-border md:grid-cols-2">
              {/* Coluna esquerda — de onde o BV é calculado. Só leitura:
                  editar número de planilha continua sendo na planilha. */}
              <div className="flex flex-col gap-4 border-b border-border px-6 py-5 md:border-b-0 md:border-r">
                <BlocoValores
                  titulo="Orçado"
                  valorUnitario={Number(item.valor_unitario_orcado)}
                  quantidade={Number(item.quantidade_orcada)}
                  diasMeses={Number(item.dias_meses_orcado)}
                  total={totalOrcado}
                  moeda={moeda}
                />
                <BlocoValores
                  titulo="Planejado"
                  valorUnitario={Number(item.valor_unitario_planejado)}
                  quantidade={Number(item.quantidade_planejada)}
                  diasMeses={Number(item.dias_meses_planejado)}
                  total={totalPlanejado}
                  moeda={moeda}
                  tom="planejado"
                />

                {/* No job o terceiro bloco é o Realizado — é o número que
                    importa em execução. A rentabilidade do item continua
                    na planilha, no rodapé do grupo. No orçamento não há
                    realizado, então fica a caixa de rentabilidade. */}
                {noJob ? (
                  <BlocoValores
                    titulo="Realizado"
                    valorUnitario={realizado?.valorUnitario ?? 0}
                    quantidade={realizado?.quantidade ?? 0}
                    diasMeses={realizado?.diasMeses ?? 0}
                    total={realizado?.total ?? 0}
                    moeda={moeda}
                    tom="realizado"
                  />
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800/80">
                      Rentabilidade do item
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-baseline gap-2 whitespace-nowrap font-mono",
                        rentabilidade >= 0
                          ? "text-emerald-700"
                          : "text-california-red",
                      )}
                    >
                      <span className="text-[15px] font-bold">
                        {formatCurrency(rentabilidade, moeda)}
                      </span>
                      <span className="text-xs font-semibold">
                        {percentualRentabilidade === null
                          ? "—"
                          : formatarPercentual(percentualRentabilidade)}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Coluna direita — o BV propriamente dito. */}
              <div className="flex flex-col gap-4 bg-muted/30 px-6 py-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BadgePercent className="h-4 w-4 text-california-red" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                      BV do item
                    </span>
                  </div>
                  {bvs.length > 0 && (
                    <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                      {bvs.length === 1 ? "1 BV" : `${bvs.length} BVs`}
                    </span>
                  )}
                </div>

                {/* A LISTA dos BVs da linha, no desenho do painel de PPs:
                    um item pode ter vários desde 08/09/2026 (decisão 062),
                    e cada um anda sozinho — tem fornecedor, alíquota e
                    situação próprios, e é confirmado sozinho.

                    Ela só aparece quando há BV lançado: numa linha vazia
                    seria uma caixa vazia acima de um formulário que já é
                    o caminho certo. */}
                {bvs.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {bvs.map((b) => {
                      const ativo = b.id === selecionadoId;
                      const nomeFornecedor =
                        fornecedoresVisiveis.find(
                          (f) => f.id === b.fornecedor_id,
                        )?.nome ?? "Sem fornecedor";
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setSelecionadoId(b.id);
                            setErro(null);
                          }}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                            ativo
                              ? "border-foreground bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                              : "border-border bg-white/60 hover:border-[#d7d7d7]",
                          )}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-[12.5px] font-semibold text-foreground">
                              {nomeFornecedor}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {formatCurrency(Number(b.valor ?? 0), moeda)}
                            </span>
                          </span>
                          <PilulaSituacao situacao={b.situacao} />
                        </button>
                      );
                    })}

                    {/* "Novo BV" é o que permite somar uma comissão depois
                        de outra já confirmada — o caso que motivou a
                        lista. Fica fora quando a tela é de consulta. */}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelecionadoId(null);
                          setErro(null);
                        }}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-2 text-[12.5px] font-semibold transition-colors",
                          selecionadoId === null
                            ? "border-california-red bg-california-red/5 text-california-red"
                            : "border-border text-muted-foreground hover:border-california-red/40 hover:text-california-red",
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Novo BV
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="bv-fornecedor"
                    className="text-[13px] font-semibold text-foreground"
                  >
                    Fornecedor
                    {noJob && <span className="ml-1 text-california-red">*</span>}
                  </label>
                  {/* Mesmo campo da PP desde 09/09/2026: busca por nome
                      OU documento, ✕ para zerar, e o botão ao lado que é
                      "+" com o campo vazio e lápis com alguém escolhido. */}
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Combobox
                        id="bv-fornecedor"
                        items={itensFornecedor}
                        value={fornecedorId}
                        onChange={setFornecedorId}
                        placeholder="Selecione o fornecedor"
                        buscaPlaceholder="Escreva o nome ou o documento"
                        limpavel={!somenteLeitura}
                        disabled={somenteLeitura || pending}
                        acaoSemResultado={
                          somenteLeitura
                            ? undefined
                            : {
                                rotulo: (busca) =>
                                  `Cadastrar “${busca}” como novo fornecedor`,
                                onClick: (busca) => {
                                  setNomeSugerido(busca);
                                  setFornecedorEditando(null);
                                  setNovoFornecedorOpen(true);
                                },
                              }
                        }
                        className={cn(
                          "h-11 rounded-xl",
                          fornecedorFaltando &&
                            "border-amber-400 ring-2 ring-amber-200",
                        )}
                      />
                    </div>
                    {!somenteLeitura && (
                      <button
                        type="button"
                        onClick={() => {
                          setNomeSugerido("");
                          setFornecedorEditando(fornecedorId ?? null);
                          setNovoFornecedorOpen(true);
                        }}
                        disabled={pending}
                        title={
                          fornecedorId
                            ? "Editar cadastro do fornecedor"
                            : "Cadastrar fornecedor"
                        }
                        aria-label={
                          fornecedorId
                            ? "Editar cadastro do fornecedor"
                            : "Cadastrar fornecedor"
                        }
                        className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50"
                      >
                        {fornecedorId ? (
                          <Pencil className="h-4 w-4" />
                        ) : (
                          <Plus className="h-[17px] w-[17px]" />
                        )}
                      </button>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[11.5px] leading-relaxed",
                      fornecedorFaltando
                        ? "font-medium text-amber-700"
                        : "text-muted-foreground",
                    )}
                  >
                    {noJob
                      ? "Obrigatório para confirmar: é quem devolve o valor à California."
                      : "Opcional aqui — pode ser definido depois, no acompanhamento do job."}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="bv-valor"
                    className="text-[13px] font-semibold text-foreground"
                  >
                    Valor do BV
                  </label>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border border-border bg-white px-3.5 py-2.5 transition-colors",
                      "focus-within:border-foreground focus-within:ring-[3px] focus-within:ring-foreground/[0.07]",
                      somenteLeitura && "opacity-70",
                    )}
                  >
                    <span className="font-mono text-[13px] text-muted-foreground">
                      {moeda === "BRL" ? "R$" : moeda}
                    </span>
                    <input
                      id="bv-valor"
                      inputMode="decimal"
                      value={valorRaw}
                      onChange={(e) => setValorRaw(e.target.value)}
                      disabled={somenteLeitura || pending}
                      placeholder="0,00"
                      className="min-w-0 flex-1 bg-transparent font-mono text-[15px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
                    />
                    <span className="whitespace-nowrap font-mono text-[13px] font-semibold text-muted-foreground">
                      {percentualBv === null
                        ? "—"
                        : formatarPercentual(percentualBv)}
                    </span>
                  </div>
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    Percentual calculado sobre o total orçado.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">
                    Prazo de repasse
                  </span>
                  <DatePicker
                    // `key` força o DatePicker a remontar ao trocar de BV
                    // na lista: ele lê o valor só no defaultValue, e sem
                    // isto a data do BV anterior ficaria na tela.
                    key={selecionadoId ?? "novo"}
                    name="prazo_repasse"
                    defaultValue={bvSelecionado?.prazo_repasse ?? ""}
                    disabled={somenteLeitura || pending}
                    placeholder="Selecione a data"
                    className="rounded-xl"
                  />
                </div>

                {/* A alíquota é DIGITADA desde 08/09/2026 (decisão 062).
                    Ela pode ficar vazia enquanto se negocia — quem a cobra
                    é o Confirmar, que é o envio ao contas a receber. E ela
                    não mexe mais na planilha: o realizado desconta o
                    BRUTO. */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="bv-aliquota"
                    className="text-[13px] font-semibold text-foreground"
                  >
                    Impostos
                    {noJob && (
                      <span className="ml-1 text-california-red">*</span>
                    )}
                  </label>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border border-border bg-white px-3.5 py-2.5 transition-colors",
                      "focus-within:border-foreground focus-within:ring-[3px] focus-within:ring-foreground/[0.07]",
                      somenteLeitura && "opacity-70",
                    )}
                  >
                    <input
                      id="bv-aliquota"
                      inputMode="decimal"
                      value={aliquotaRaw}
                      onChange={(e) => setAliquotaRaw(e.target.value)}
                      disabled={somenteLeitura || pending}
                      placeholder={formatarAliquota(percentualImposto)}
                      className="min-w-0 flex-1 bg-transparent font-mono text-sm font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
                    />
                    <span className="font-mono text-[13px] text-muted-foreground">
                      %
                    </span>
                    <span className="whitespace-nowrap font-mono text-sm text-muted-foreground">
                      − {formatCurrency(impostoBv, moeda)}
                    </span>
                  </div>
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {temAliquota
                      ? "Alíquota deste BV, aplicada sobre o valor dele."
                      : `Em branco usa a do job (${formatarAliquota(percentualImposto)}) só como referência. Obrigatória para enviar ao contas a receber.`}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">
                    BV líquido
                  </span>
                  <div className="flex items-center justify-between gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800/80">
                      Valor do BV − impostos
                    </span>
                    <span className="whitespace-nowrap font-mono text-base font-bold text-emerald-700">
                      {formatCurrency(liquidoBv, moeda)}
                    </span>
                  </div>
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {travadoPorSituacao
                      ? situacaoAtual === "recebido"
                        ? "Já teve baixa no contas a receber — nada mais muda neste BV."
                        : "Já foi enviado ao financeiro — nada mais muda neste BV."
                      : "É o que sobra da comissão depois do imposto. A planilha desconta o valor BRUTO do realizado."}
                  </span>
                  {somaQueDesconta > 0 && (
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                      Este item já desconta{" "}
                      <strong className="font-semibold text-foreground">
                        {formatCurrency(somaQueDesconta, moeda)}
                      </strong>{" "}
                      do realizado, somando os BVs confirmados.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-border bg-card px-6 py-4">
              {bvSelecionado && !somenteLeitura ? (
                <button
                  type="button"
                  onClick={() => setAskRemover(true)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-california-red transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remover BV
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-xl border border-border bg-white px-5 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                >
                  {somenteLeitura ? "Fechar" : "Cancelar"}
                </button>
                {!somenteLeitura && (
                  <button
                    type="submit"
                    disabled={pending}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50",
                      // No job, Salvar é o passo intermediário e Confirmar
                      // é a ação de peso — a hierarquia visual segue isso.
                      noJob
                        ? "border border-border bg-white text-foreground"
                        : "bg-foreground text-white",
                    )}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {pending ? "Salvando..." : noJob ? "Salvar" : "Salvar BV"}
                  </button>
                )}
                {noJob && !somenteLeitura && (
                  <button
                    type="button"
                    onClick={handlePedirConfirmacao}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <SendHorizonal className="h-3.5 w-3.5" />
                    Confirmar
                  </button>
                )}
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={askRemover}
        onOpenChange={setAskRemover}
        title="Remover BV?"
        description={
          <>
            O BV de <strong className="text-foreground">{item.item}</strong>{" "}
            passa para <strong className="text-foreground">Cancelado</strong> e
            sai da planilha. Você pode lançar um novo no mesmo item depois — os
            valores atuais serão substituídos.
          </>
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleRemover}
      />

      {/* O envio ao financeiro é irreversível: confirmado, o BV trava nas
          duas telas. Por isso a confirmação explica o que acontece antes
          de acontecer.
          O botão ficou DESABILITADO até 21/08/2026, com o aviso "o módulo
          de faturamento ainda não existe" — que envelheceu: a esteira
          entrou em 14/08 (decisão 009). E sem confirmar não há como o BV
          chegar ao REALIZADO, que é exatamente a regra nova. */}
      <ConfirmDialog
        open={askConfirmar}
        onOpenChange={setAskConfirmar}
        title="Confirmar e enviar ao financeiro?"
        description={
          <>
            O BV de <strong className="text-foreground">{item.item}</strong> no
            valor de{" "}
            <strong className="text-foreground">
              {formatCurrency(valorBv, moeda)}
            </strong>{" "}
            será enviado ao financeiro para cobrança do fornecedor{" "}
            <strong className="text-foreground">
              {fornecedoresVisiveis.find((f) => f.id === fornecedorId)?.nome ??
                "—"}
            </strong>
            , no líquido de{" "}
            <strong className="text-foreground">
              {formatCurrency(liquidoBv, moeda)}
            </strong>{" "}
            depois dos impostos. Depois de confirmado, o BV passa a{" "}
            <strong>Confirmado</strong>, é descontado do Realizado do item na
            vista Líquido, e não pode mais ser editado nem removido — nem
            aqui, nem no orçamento.
          </>
        }
        confirmLabel="Confirmar envio"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={handleConfirmar}
      />

      {/* O cadastro de fornecedor de dentro do BV (09/09/2026, decisão
          067): o mesmo dialog da PP, para não haver dois formulários de
          fornecedor com regras diferentes. */}
      <NovoFornecedorDialog
        // Só abre a edição quando o cadastro completo chegou: dialog
        // vazio piscando é pior que meio segundo de espera.
        open={
          novoFornecedorOpen &&
          (!fornecedorEditando || fornecedorParaEditar !== null)
        }
        onOpenChange={(aberto) => {
          setNovoFornecedorOpen(aberto);
          if (!aberto) {
            setFornecedorEditando(null);
            setNomeSugerido("");
          }
        }}
        fornecedor={fornecedorParaEditar ?? undefined}
        nomeInicial={nomeSugerido || undefined}
        contexto="bv"
        onCriado={adotarFornecedor}
        onSelecionarExistente={adotarFornecedor}
        // A edição não mexe na escolha: o fornecedor continua o mesmo,
        // com o cadastro atualizado.
        onSalvo={() => {
          setFornecedorEditando(null);
          router.refresh();
        }}
      />
    </>
  );
}

/** Mini-blocos do formulário nas cores do produto.
 *
 *  Elas saem de `_planilha/blocos.ts`, e não de hex escrito aqui: a regra
 *  do CLAUDE.md é que a cor de um bloco tem uma fonte só. Até 21/08/2026
 *  este arquivo tinha a sua própria paleta, com o PLANEJADO em AZUL —
 *  herança de antes de 11/08, quando o azul era dele. Hoje azul é do
 *  ORÇADO e o planejado é verde, e o formulário estava contando outra
 *  história que a planilha logo atrás dele.
 *
 *  A borda fica neutra nos três: `Bloco` não tem uma borda de moldura
 *  externa, e inventar uma aqui recriaria exatamente o problema. */
const TONS = {
  orcado: ORCADO,
  planejado: PLANEJADO,
  realizado: REALIZADO,
} satisfies Record<string, Bloco>;

type Tom = keyof typeof TONS;

/** Mini-planilha de leitura: repete um bloco da linha para o usuário ver
 *  sobre o que está negociando o BV. */
function BlocoValores({
  titulo,
  valorUnitario,
  quantidade,
  diasMeses,
  total,
  moeda,
  tom = "orcado",
}: {
  titulo: string;
  valorUnitario: number;
  quantidade: number;
  diasMeses: number;
  total: number;
  moeda: string;
  tom?: Tom;
}) {
  const c = TONS[tom];
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-[0.1em]",
          c.textoSuave,
        )}
      >
        {titulo}
      </span>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr
              className={cn(
                "border-b border-border text-[9.5px] font-semibold uppercase tracking-wider",
                c.cabecalhoFim,
              )}
            >
              <th className="w-[30%] px-3 py-1.5 text-left">R$ Unit.</th>
              <th className="w-[20%] px-1.5 py-1.5 text-center">QT</th>
              <th className="w-[16%] px-1.5 py-1.5 text-center">D/M</th>
              <th className="w-[34%] px-3 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {/* `celulaTotal` traz fundo E cor do bloco. As três primeiras
                células devolvem a cor ao texto normal: só o Total é que
                fala na cor do bloco, como na planilha. */}
            <tr className={cn("h-9 font-mono", c.celulaTotal)}>
              <td className="whitespace-nowrap px-3 text-foreground">
                {formatCurrency(valorUnitario, moeda)}
              </td>
              <td className="px-1.5 text-center text-foreground">
                {quantidade}
              </td>
              <td className="px-1.5 text-center text-foreground">{diasMeses}</td>
              <td className="whitespace-nowrap px-3 text-right font-bold">
                {formatCurrency(total, moeda)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
