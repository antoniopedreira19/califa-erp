"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularTotaisPlanejados } from "@/lib/calculos/versao-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoItem,
  type Categoria,
  type ItemBv,
} from "@/lib/types";
import {
  adicionarItem,
  atualizarCampoItem,
  removerItem,
  type ActionResult,
} from "../actions";
import {
  ColunasFixas,
  LARGURA_MINIMA,
  LARGURA_MINIMA_SAVE,
  colunasDoRotulo,
  totalDeColunas,
  type ColunasVisiveis,
} from "@/app/(app)/_planilha/grade-orcamento";
import {
  CabecalhoSaveColuna,
  CabecalhoSaveFaixa,
  CelulaSave,
  SAVE_VAZIO,
  classesDaLinhaComSave,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import { AlcaDaColunaSave } from "@/app/(app)/_planilha/exibir-colunas";
import {
  direcaoDaTecla,
  direcaoNoCampo,
  type Direcao,
} from "@/app/(app)/_planilha/navegacao";
import {
  DicasDeTeclado,
  Miolo,
  useSelecaoPlanilha,
  type CelulaSelecionada,
  type ColunaDaGrade,
  type Selecao,
  type TipoEditor,
} from "@/app/(app)/_planilha/selecao";
import {
  ORCADO,
  PLANEJADO,
  RENTABILIDADE,
  FAIXA_ROTULO,
  FAIXA_GRUPO,
  LINHA_GRUPO_NOME,
  LINHA_NOVO_GRUPO,
  LINHA_TOTAL_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";
import {
  Calha,
  LinhaDaCalha,
  usePosicoesDaCalha,
} from "@/app/(app)/_planilha/calha";
import {
  BvDialog,
  type AdaptadorBv,
  type FornecedorOpcao,
} from "@/app/(app)/_bv/bv-dialog";
import {
  BvActionButton,
  LARGURA_CALHA_BV,
} from "@/app/(app)/_bv/bv-action-button";
import { aceitaBV, TIPOS_CUSTO } from "@/lib/calculos/versao-totais";
import {
  blocosDoItem,
  planejadoEspelhaOrcado,
  rotuloColunaTotal,
  somarBlocosDosItens,
  valorNaVisao,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";

/** Onde a grade grava.
 *
 *  Por padrão, nas Server Actions da versão. O editor de orçamento do
 *  projeto passa um adaptador que mexe no rascunho em memória — lá nada
 *  existe no banco até o "Salvar orçamentos", mas a planilha é a mesma e
 *  não pode ser reescrita só por causa do destino da escrita. */
export interface AdaptadorItens {
  atualizarCampo: (
    itemId: string,
    campo: string,
    valor: string | null,
  ) => Promise<ActionResult>;
  adicionar: (grupoId: string, formData: FormData) => Promise<ActionResult>;
  remover: (itemId: string) => Promise<ActionResult>;
  /** Recarrega a origem dos dados depois de cada escrita. No rascunho é
   *  no-op: o estado do React já é a fonte. */
  aposEscrita: () => void;
}

/** Um agrupamento da planilha, com os itens já separados. */
export interface GrupoDaPlanilha {
  id: string;
  nome: string;
  itens: VersaoOrcamentoItem[];
}

interface Props {
  /** TODOS os agrupamentos da planilha, na ordem em que aparecem.
   *
   *  Até 24/08/2026 este componente desenhava UM grupo, e a tela
   *  empilhava um card por grupo. O handoff "Planilha Interna - Grupos
   *  Unificados" juntou tudo numa tabela só: um cabeçalho de colunas,
   *  uma calha de números, e cada grupo virando uma linha que carrega o
   *  próprio subtotal. */
  grupos: GrupoDaPlanilha[];
  moeda: string;
  /** Alíquota da versão — vira o BV líquido descontado na vista Líquido. */
  percentualImposto: number;
  /** Bruto (padrão) ou Líquido (− BV). Decidida uma vez por página. */
  visao: VisaoBv;
  readOnly?: boolean;
  categorias: Categoria[];
  /** BV por id do item. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  /** Ausente ⇒ grava direto nas Server Actions da versão. */
  adaptador?: AdaptadorItens;
  /** Repassado ao formulário de BV; mesma regra do adaptador acima. */
  adaptadorBv?: AdaptadorBv;
  /** Grupo recolhido esconde as linhas, o "Novo item" e as ações de item.
   *  A linha do grupo — com o subtotal e a rentabilidade — continua à
   *  vista: é ela que justifica recolher. */
  estaAberto: (grupoId: string) => boolean;
  onAlternarGrupo: (grupoId: string) => void;
  /** O NOME do grupo dentro da linha dele. Só o nome: o chevron e o
   *  contador de itens são iguais em toda tela e saem daqui de dentro.
   *  Quem passa isto é a tela, porque renomear muda de mecanismo entre
   *  elas — Server Action na versão, estado local no rascunho. */
  nomeDoGrupo?: (grupo: GrupoDaPlanilha) => React.ReactNode;
  /** Ações do grupo (remover) — vão para a calha à direita, na altura da
   *  linha do grupo, no mesmo eixo das lixeiras de item. */
  acoesDoGrupo?: (grupo: GrupoDaPlanilha) => React.ReactNode;
  /** Gatilho de "Novo grupo", na linha tracejada que fecha o corpo da
   *  tabela. Ausente ⇒ a linha não existe (versão congelada). */
  novoGrupo?: React.ReactNode;
  /** BASE do rótulo do pé da tabela. Default: "Total do orçamento". A
   *  vista Líquido acrescenta o sufixo sozinha, para o rótulo não ter que
   *  ser reescrito em cada tela. */
  rotuloTotal?: string;
  /** Liga a coluna SAVE. Desligada, a grade volta às 13 colunas de sempre
   *  e nada nesta tabela muda — é o estado de quem nunca usou save. */
  saveVisivel?: boolean;
  /** Liga e desliga a coluna Save pela alça colada na borda esquerda
   *  da planilha. Ausente ⇒ a alça não aparece. */
  onAlternarSave?: () => void;
  /** Estado do save por id do item da versão. Item ausente = linha limpa. */
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  /** Abre o formulário de save da linha. Ausente ⇒ a coluna mostra o
   *  estado mas não deixa mexer: é como o financeiro e a versão aprovada
   *  leem a planilha. */
  onAbrirSave?: (item: VersaoOrcamentoItem) => void;
  /** Blocos ocultáveis pelo menu "Exibir" (03/09/2026). Default: visíveis
   *  — é assim que as agregadas e o rascunho do projeto leem a planilha.
   *  Escondido, o bloco sai da grade INTEIRA: faixa, sub-cabeçalho,
   *  linha de grupo, linhas de item, linha nova e total. As colunas do
   *  Orçado também saem da ordem do Tab. PLANEJADO não é ocultável. */
  orcadoVisivel?: boolean;
  rentabilidadeVisivel?: boolean;
}

/** Campos que a grade edita — espelha o allowlist do server action. */
type Campo =
  | "item"
  | "tipo_custo"
  | "categoria_id"
  | "valor_unitario_orcado"
  | "quantidade_orcada"
  | "dias_meses_orcado"
  | "valor_unitario_planejado"
  | "quantidade_planejada"
  | "dias_meses_planejado";

/** Os campos numéricos do bloco ORÇADO e do PLANEJADO. */
const CAMPOS_ORCADO: readonly Campo[] = [
  "valor_unitario_orcado",
  "quantidade_orcada",
  "dias_meses_orcado",
];
const CAMPOS_PLANEJADO: readonly Campo[] = [
  "valor_unitario_planejado",
  "quantidade_planejada",
  "dias_meses_planejado",
];

type ValorCampo = string | number | null;

/** Célula em edição.
 *
 *  `porTeclado` distingue a célula que o Tab abriu da que o clique
 *  abriu: só na primeira o `<select>` continua a navegação sozinho
 *  depois da escolha. */
type CelulaAtiva = {
  rowId: string;
  campo: Campo;
  porTeclado?: boolean;
  /** O caractere que abriu a célula ao ser digitado sobre ela: o campo
   *  nasce com ele no lugar do conteúdo, como numa planilha. */
  semente?: string;
} | null;

/** As colunas que a seleção percorre, na ordem da tela — inclusive as
 *  calculadas (Total, Rentabilidade), que selecionam mas não abrem. */
const COLUNA_ITEM: ColunaDaGrade[] = [
  { chave: "item", rotulo: "Item" },
  { chave: "tipo_custo", rotulo: "Tipo" },
  { chave: "categoria_id", rotulo: "Categoria" },
];
const COLUNAS_ORCADO: ColunaDaGrade[] = [
  { chave: "valor_unitario_orcado", rotulo: "R$ Unit.", bloco: "Orçado" },
  { chave: "quantidade_orcada", rotulo: "QT", bloco: "Orçado" },
  { chave: "dias_meses_orcado", rotulo: "D/M", bloco: "Orçado" },
  { chave: "total_orcado", rotulo: "Total", bloco: "Orçado" },
];
const COLUNAS_PLANEJADO: ColunaDaGrade[] = [
  { chave: "valor_unitario_planejado", rotulo: "R$ Unit.", bloco: "Planejado" },
  { chave: "quantidade_planejada", rotulo: "QT", bloco: "Planejado" },
  { chave: "dias_meses_planejado", rotulo: "D/M", bloco: "Planejado" },
  { chave: "total_planejado", rotulo: "Total", bloco: "Planejado" },
];
const COLUNAS_RENTAB: ColunaDaGrade[] = [
  { chave: "rentab_valor", rotulo: "R$", bloco: "Rentabilidade" },
  { chave: "rentab_pct", rotulo: "%", bloco: "Rentabilidade" },
];
const CAMPOS_LISTA: readonly Campo[] = ["tipo_custo", "categoria_id"];

/** Uma linha nova que já saiu da tela do rascunho e está indo para o
 *  banco. Ela é desenhada como item — com um id provisório — para o
 *  cursor não ter que esperar a resposta do servidor (decisão 046). */
interface Provisorio {
  /** `tmp:N` enquanto grava; o id real assim que o servidor responde. */
  id: string;
  grupoId: string;
  item: VersaoOrcamentoItem;
  estado: "gravando" | "gravado" | "erro";
  /** O rascunho de origem, para a linha voltar a ser editável se o
   *  servidor recusar. */
  rascunho: Draft;
  erro?: string;
}

type Overrides = Record<string, Partial<Record<Campo, ValorCampo>>>;

/** Radix Select não aceita value="" — sentinela para "sem categoria". */
const SEM_CATEGORIA = "__nenhuma__";
const DRAFT_ID = "__draft__";

/** Altura fixa da linha de item. A calha à direita não depende mais
 *  disto — ela mede cada linha —, mas a grade continua respirando melhor
 *  com a altura travada do que deixando o conteúdo decidir. */
const ALTURA_LINHA = "h-7";

/** Fio vertical entre as colunas neutras (Item, Tipo, Categoria). */
const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

/** Recuo dos itens sob a linha do grupo. É ele que faz a hierarquia
 *  aparecer sem precisar de card por agrupamento. */
const RECUO_ITEM = "pl-[30px]";

/** 2px menor que a linha (28px), como no handoff — o campo respira dentro
 *  da célula em vez de encostar nas bordas. */
const CAMPO_CLASSES =
  "h-[26px] w-full rounded-md border border-california-red/40 bg-white px-2 text-xs outline-none focus:border-california-red";

interface Draft {
  /** A que grupo a linha nova pertence. Com uma tabela só para a planilha
   *  inteira, o rascunho precisa dizer onde nasceu. */
  grupoId: string;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
}

/** Planejado nasce igual ao orçado (0 · 1 · 1): a linha nova é uma folha
 *  em branco nos dois blocos, e não um planejado zerado ao lado de um
 *  orçado preenchido. */
function draftVazio(grupoId: string): Draft {
  return {
    grupoId,
    item: "",
    tipo_custo: "B",
    categoria_id: null,
    valor_unitario_orcado: 0,
    quantidade_orcada: 1,
    dias_meses_orcado: 1,
    valor_unitario_planejado: 0,
    quantidade_planejada: 1,
    dias_meses_planejado: 1,
  };
}

/** A linha nova ainda em branco — nenhum campo saiu do estado de
 *  nascimento. É por este teste que ela some sozinha no Esc e em
 *  qualquer clique fora dela: enquanto ninguém digitou nada, a linha não
 *  é um item, é só o cursor esperando. Digitou qualquer coisa (inclusive
 *  um valor sem descrição), ela fica na tela até o usuário decidir. */
function draftIntocado(d: Draft): boolean {
  const zero = draftVazio(d.grupoId);
  return (Object.keys(zero) as Array<keyof Draft>).every(
    (campo) => d[campo] === zero[campo],
  );
}

/** O item que a linha provisória mostra enquanto o banco não responde.
 *  Os campos que só o banco sabe (tenant, versão, datas) ficam vazios —
 *  ninguém os lê na tabela, e o item real os traz no refresh. */
function itemProvisorio(id: string, d: Draft): VersaoOrcamentoItem {
  return {
    id,
    tenant_id: "",
    versao_orcamento_id: "",
    grupo_id: d.grupoId,
    ordem: Number.MAX_SAFE_INTEGER,
    planilha_origem: null,
    item: d.item,
    tipo_custo: d.tipo_custo,
    valor_unitario_orcado: d.valor_unitario_orcado,
    quantidade_orcada: d.quantidade_orcada,
    dias_meses_orcado: d.dias_meses_orcado,
    total_orcado:
      d.valor_unitario_orcado * d.quantidade_orcada * d.dias_meses_orcado,
    categoria_id: d.categoria_id,
    valor_unitario_planejado: d.valor_unitario_planejado,
    quantidade_planejada: d.quantidade_planejada,
    dias_meses_planejado: d.dias_meses_planejado,
    total_planejado:
      d.valor_unitario_planejado *
      d.quantidade_planejada *
      d.dias_meses_planejado,
    bv_liquido_planejado: null,
    em_save: false,
    save_consumido: 0,
    fornecedor_id: null,
    observacoes: null,
    created_at: "",
    updated_at: "",
  };
}

/** Aceita "1.234,56" e "1234.56". Vírgula presente ⇒ ponto é milhar. */
function parseNumero(raw: string): number | null {
  const limpo = raw.trim();
  if (limpo === "") return 0;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Número cru para digitação: vírgula decimal, sem separador de milhar. */
function paraEdicao(valor: number): string {
  if (!Number.isFinite(valor)) return "";
  return String(valor).replace(".", ",");
}

/** Rentabilidade de uma linha (ou do subtotal) pela fórmula oficial da
 *  versão — mesma função do card de Totais. */
function rentabilidadeDe(orcado: number, planejado: number) {
  return calcularTotaisPlanejados([
    { total_orcado: orcado, total_planejado: planejado },
  ]);
}

/** Mesmo formato do card de Totais: uma casa decimal, vírgula decimal. */
function formatarPercentual(percentual: number): string {
  return `${percentual.toFixed(1).replace(".", ",")}%`;
}

function num(v: ValorCampo): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mesmoValor(a: ValorCampo, b: ValorCampo): boolean {
  if (typeof a === "number" || typeof b === "number") return num(a) === num(b);
  return (a ?? null) === (b ?? null);
}

export function ItensTable({
  grupos,
  moeda,
  percentualImposto,
  visao,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
  adaptador,
  adaptadorBv,
  estaAberto,
  onAlternarGrupo,
  nomeDoGrupo,
  acoesDoGrupo,
  novoGrupo,
  rotuloTotal,
  saveVisivel = false,
  onAlternarSave,
  savePorItem,
  onAbrirSave,
  orcadoVisivel = true,
  rentabilidadeVisivel = true,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  /** Direcao padrão das escritas: o banco, via Server Actions. */
  const acoes = React.useMemo<AdaptadorItens>(
    () =>
      adaptador ?? {
        atualizarCampo: atualizarCampoItem,
        adicionar: adicionarItem,
        remover: removerItem,
        aposEscrita: () => router.refresh(),
      },
    [adaptador, router],
  );
  const [ativa, setAtiva] = React.useState<CelulaAtiva>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [removendo, setRemovendo] =
    React.useState<VersaoOrcamentoItem | null>(null);
  const [bvAberto, setBvAberto] = React.useState<VersaoOrcamentoItem | null>(
    null,
  );

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  /** Linhas novas a caminho do banco (decisão 046). */
  const [provisorios, setProvisorios] = React.useState<Provisorio[]>([]);
  const seqProvisorio = React.useRef(0);
  /** Rascunhos já enviados: o handler de confirmação pode rodar duas
   *  vezes (blur + tecla), e o segundo disparo não pode inserir de novo. */
  const persistidos = React.useRef(new WeakSet<Draft>());

  const editavel = !readOnly;

  /** Os grupos COMO A TELA OS MOSTRA: os itens do banco mais as linhas
   *  provisórias de cada grupo. Tudo abaixo — navegação, subtotais,
   *  calha — lê daqui, para a linha nova contar em tudo desde o
   *  primeiro instante. A provisória some sozinha quando o item real
   *  chega pelas props. */
  const gruposDaTela = React.useMemo<GrupoDaPlanilha[]>(() => {
    if (provisorios.length === 0) return grupos;
    return grupos.map((g) => {
      const reais = new Set(g.itens.map((i) => i.id));
      const extras = provisorios
        .filter((p) => p.grupoId === g.id && !reais.has(p.id))
        .map((p) => p.item);
      return extras.length === 0 ? g : { ...g, itens: [...g.itens, ...extras] };
    });
  }, [grupos, provisorios]);

  // O item real chegou (refresh depois do `adicionar`): a provisória
  // cumpriu o papel. Sem isso ela duplicaria a linha para sempre.
  React.useEffect(() => {
    setProvisorios((prev) => {
      if (prev.length === 0) return prev;
      const reais = new Set(grupos.flatMap((g) => g.itens.map((i) => i.id)));
      const restantes = prev.filter((p) => !reais.has(p.id));
      return restantes.length === prev.length ? prev : restantes;
    });
  }, [grupos]);

  /** Quais colunas esta tela está desenhando. Vai para o `colgroup` e
   *  para todos os `colSpan` de linha inteira — os três têm que sair da
   *  MESMA fonte, senão a tabela desalinha sem erro de compilação. */
  const colunas: ColunasVisiveis = {
    save: saveVisivel,
    orcado: orcadoVisivel,
    rentabilidade: rentabilidadeVisivel,
  };

  /** As colunas que a seleção percorre, na ordem da tela. */
  const colunasDaGrade = React.useMemo<ColunaDaGrade[]>(
    () => [
      ...COLUNA_ITEM,
      ...(orcadoVisivel ? COLUNAS_ORCADO : []),
      ...COLUNAS_PLANEJADO,
      ...(rentabilidadeVisivel ? COLUNAS_RENTAB : []),
    ],
    [orcadoVisivel, rentabilidadeVisivel],
  );

  /** Todos os itens da planilha, achatados — a navegação e a busca por
   *  id atravessam os gruposDaTela e não podem depender de qual card era. */
  const itensPorId = React.useMemo(() => {
    const mapa = new Map<string, VersaoOrcamentoItem>();
    for (const g of gruposDaTela) for (const it of g.itens) mapa.set(it.id, it);
    return mapa;
  }, [gruposDaTela]);

  const todosOsItens = React.useMemo(
    () => gruposDaTela.flatMap((g) => g.itens),
    [gruposDaTela],
  );

  // A calha vive fora do frame da tabela e agora acompanha linhas de
  // alturas diferentes (grupo, item, "Novo item"). Medir é a única forma
  // de acertar — ver o cabeçalho de `_planilha/calha`.
  const posicoesCalha = usePosicoesDaCalha(wrapperRef, [
    gruposDaTela,
    draft,
    readOnly,
    visao,
    // Recolher/expandir muda o que existe no DOM e, com isso, todos os
    // offsets abaixo do grupo que se moveu.
    gruposDaTela.map((g) => (estaAberto(g.id) ? "1" : "0")).join(""),
  ]);

  // O handler de clique-fora lê o rascunho por ref, e não pela closure:
  // ver o porquê logo abaixo.
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const descarteAgendado = React.useRef<ReturnType<typeof setTimeout>>();

  // Enquanto a linha nova estiver em branco, qualquer clique fora dela a
  // descarta: ela ainda não é um item, é só o cursor esperando alguém
  // digitar. `pointerdown` e não `click` porque o clique numa outra
  // célula já teria aberto a edição de lá antes de o descarte acontecer.
  // Ficam de fora a própria linha e o menu do Radix, que abre em portal
  // fora da tabela — escolher um Tipo não pode matar a linha.
  //
  // O descarte espera um tique porque o campo em edição só entrega o que
  // foi digitado no `blur`, e o navegador dispara o `blur` DEPOIS deste
  // handler. Matar a linha aqui apagaria a descrição recém-digitada
  // antes de ela ser gravada.
  //
  // Daí a inscrição ser de mount, com `[]`: o `blur` chama `setDraft` com
  // um objeto NOVO, e um efeito que dependesse de `draft` se
  // reinscreveria no meio do caminho — a limpeza cancelaria o descarte
  // que acabou de ser agendado, e a linha em branco ficaria na tela.
  // Defeito real, visto no navegador em 25/08/2026: com clique
  // sintético (sem troca de foco) passava, com clique de verdade não.
  React.useEffect(() => {
    const aoApontar = (e: PointerEvent) => {
      const atual = draftRef.current;
      if (!atual || !draftIntocado(atual)) return;

      const alvo = e.target instanceof Element ? e.target : null;
      if (
        alvo?.closest(`[data-calha="${DRAFT_ID}"]`) ||
        alvo?.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }

      descarteAgendado.current = setTimeout(() => {
        setDraft((d) => (d && draftIntocado(d) ? null : d));
        setAtiva((ativa) => (ativa?.rowId === DRAFT_ID ? null : ativa));
      }, 0);
    };

    document.addEventListener("pointerdown", aoApontar);
    return () => {
      document.removeEventListener("pointerdown", aoApontar);
      clearTimeout(descarteAgendado.current);
    };
  }, []);

  // Descarta o valor otimista quando o servidor já devolveu o mesmo valor.
  React.useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Overrides = {};
      for (const item of todosOsItens) {
        const campos = prev[item.id];
        if (!campos) continue;
        const restante: Partial<Record<Campo, ValorCampo>> = {};
        for (const [campo, valor] of Object.entries(campos)) {
          const doServidor = item[campo as Campo] as ValorCampo;
          if (!mesmoValor(doServidor, valor as ValorCampo)) {
            restante[campo as Campo] = valor as ValorCampo;
          }
        }
        if (Object.keys(restante).length > 0) next[item.id] = restante;
      }
      return next;
    });
  }, [todosOsItens]);

  function valorAtual(item: VersaoOrcamentoItem, campo: Campo): ValorCampo {
    const campos = overrides[item.id];
    if (campos && campo in campos) return campos[campo] as ValorCampo;
    return item[campo] as ValorCampo;
  }

  function totaisDoItem(item: VersaoOrcamentoItem) {
    // Sem edição pendente usa o valor GENERATED do banco; com edição,
    // recalcula na hora (valor × qtd × dias/meses).
    const orcado = overrides[item.id]
      ? num(valorAtual(item, "valor_unitario_orcado")) *
        num(valorAtual(item, "quantidade_orcada")) *
        num(valorAtual(item, "dias_meses_orcado"))
      : Number(item.total_orcado);

    // Linha em save não tem custo (decisão 028 §9): o espelho de `A` e `D`
    // não vale nela, senão o custo que o banco zerou voltaria pela tela.
    if (item.em_save === true) return { orcado, planejado: 0 };

    // Em `A` e `D` o planejado É o orçado — inclusive enquanto o usuário
    // ainda está digitando o orçado, para o espelho não piscar atrasado.
    if (planejadoEspelhaOrcado(
      String(valorAtual(item, "tipo_custo")) as VersaoOrcamentoItem["tipo_custo"],
    )) {
      return { orcado, planejado: orcado };
    }

    const planejado = overrides[item.id]
      ? num(valorAtual(item, "valor_unitario_planejado")) *
        num(valorAtual(item, "quantidade_planejada")) *
        num(valorAtual(item, "dias_meses_planejado"))
      : Number(item.total_planejado);

    return { orcado, planejado };
  }

  /** Os blocos da linha, com a dedução de BV separada. No orçamento não
   *  há realizado — só o par orçado × planejado importa aqui. */
  function blocosDe(item: VersaoOrcamentoItem) {
    const totais = totaisDoItem(item);
    return blocosDoItem(
      {
        tipo_custo: String(
          valorAtual(item, "tipo_custo"),
        ) as VersaoOrcamentoItem["tipo_custo"],
        total_orcado: totais.orcado,
        total_planejado: totais.planejado,
        bv_liquido_planejado: item.bv_liquido_planejado,
        // Sem isto o subtotal do grupo contaria a linha em save na
        // rentabilidade e discordaria do card de Totais logo abaixo.
        em_save: item.em_save,
      },
      bvsPorItem[item.id] ?? null,
      0,
      percentualImposto,
    );
  }

  /** Ordem das linhas para a navegação — a planilha INTEIRA, e não mais
   *  um grupo de cada vez (decisão do Tiago, 24/08/2026). O Tab que sai
   *  do último item de um grupo cai no primeiro do grupo seguinte, que é
   *  o comportamento de planilha de verdade. Grupo recolhido não tem
   *  linha na tela: fica fora da lista e o Tab pula por cima dele.
   *
   *  A linha nova entra logo depois do último item DO GRUPO DELA, que é
   *  onde ela aparece. */
  const linhasNavegaveis = React.useMemo(() => {
    const ids: string[] = [];
    for (const g of gruposDaTela) {
      if (!estaAberto(g.id)) continue;
      for (const it of g.itens) ids.push(it.id);
      if (draft?.grupoId === g.id) ids.push(DRAFT_ID);
    }
    return ids;
  }, [gruposDaTela, draft, estaAberto]);

  /** Último item visível de cada grupo → id do grupo dele. É por aqui
   *  que o Enter/↓ da última linha sabe que o destino não é o primeiro
   *  item do grupo de baixo, e sim o "Novo item" DESTE grupo. */
  const grupoDoUltimoItem = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const g of gruposDaTela) {
      if (!estaAberto(g.id)) continue;
      const ultimo = g.itens[g.itens.length - 1];
      if (ultimo) mapa.set(ultimo.id, g.id);
    }
    return mapa;
  }, [gruposDaTela, estaAberto]);

  /** As três colunas de PLANEJADO travadas nesta linha.
   *
   *  Em `A` e `D` o planejado espelha o orçado e não se digita — o Tab
   *  precisa PULAR essas células, senão a navegação morre numa célula
   *  que não abre para edição. A linha nova (draft) nasce sem tipo
   *  definido, então nunca trava. */
  const planejadoTravadoEm = React.useCallback(
    (rowId: string): boolean => {
      const item = itensPorId.get(rowId);
      if (!item) return false;
      // Em save o planejado é zero e não se digita — o Tab pula igual.
      if (item.em_save === true) return true;
      const campos = overrides[rowId];
      const tipo =
        campos && "tipo_custo" in campos
          ? campos.tipo_custo
          : item.tipo_custo;
      return planejadoEspelhaOrcado(
        String(tipo) as VersaoOrcamentoItem["tipo_custo"],
      );
    },
    [itensPorId, overrides],
  );

  /** A linha provisória ainda sem id real não abre célula: qualquer
   *  escrita nela iria para um id que o banco não conhece. */
  const provisoriaTravada = React.useCallback(
    (rowId: string) =>
      provisorios.some((p) => p.id === rowId && p.estado !== "gravado"),
    [provisorios],
  );

  /** O que cada célula abre. `null` = calculada, travada ou só leitura:
   *  seleciona, mas não abre. */
  const editorDe = React.useCallback(
    (rowId: string, coluna: string): TipoEditor | null => {
      if (!editavel) return null;
      if (rowId !== DRAFT_ID && provisoriaTravada(rowId)) return null;
      if (coluna === "item") return "texto";
      if ((CAMPOS_LISTA as readonly string[]).includes(coluna)) return "lista";
      if ((CAMPOS_ORCADO as readonly string[]).includes(coluna)) return "numero";
      if ((CAMPOS_PLANEJADO as readonly string[]).includes(coluna)) {
        return rowId !== DRAFT_ID && planejadoTravadoEm(rowId) ? null : "numero";
      }
      return null;
    },
    [editavel, provisoriaTravada, planejadoTravadoEm],
  );

  const selecao: Selecao = useSelecaoPlanilha({
    linhas: linhasNavegaveis,
    colunas: colunasDaGrade,
    editorDe,
    onAbrir: (c, semente) =>
      setAtiva({ rowId: c.linhaId, campo: c.coluna as Campo, porTeclado: true, semente }),
    // ↓ na última linha do grupo abre o "Novo item" DELE em vez de cair no
    // grupo seguinte (pedido do Tiago, 25/08/2026): é assim que se
    // acrescenta item sem tirar a mão do teclado. Rascunho em branco em
    // OUTRO grupo é descartado no caminho; ↓ num rascunho em branco o
    // descarta e segue para o grupo de baixo.
    aoDescer: (rowId) => {
      if (!editavel) return false;
      if (rowId === DRAFT_ID) {
        if (draft && draftIntocado(draft)) setDraft(null);
        return false;
      }
      const grupoId = grupoDoUltimoItem.get(rowId);
      if (!grupoId) return false;
      if (draft && !(draft.grupoId !== grupoId && draftIntocado(draft))) return false;
      abrirDraft(grupoId);
      return true;
    },
    editando: ativa !== null,
    wrapperRef,
  });
  const selecaoRef = React.useRef(selecao.celula);
  selecaoRef.current = selecao.celula;

  // Campo fechou: o foco volta ao card, para as setas continuarem de
  // onde a célula ficou. Só quando há seleção — no primeiro render
  // ninguém pediu foco.
  const ativaAnterior = React.useRef(ativa);
  React.useEffect(() => {
    if (ativaAnterior.current !== null && ativa === null && selecaoRef.current) {
      selecao.focar();
    }
    ativaAnterior.current = ativa;
  }, [ativa, selecao]);

  /** Fecha a célula aberta e anda a seleção. */
  function fecharEMover(de: CelulaSelecionada, destino?: Direcao) {
    setAtiva(null);
    if (destino) selecao.mover(destino, de);
  }

  function gravar(itemId: string, campo: Campo, valor: ValorCampo) {
    const anterior = overrides[itemId];
    setErro(null);
    setOverrides((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [campo]: valor },
    }));

    const reverter = () =>
      setOverrides((prev) => {
        const next = { ...prev };
        if (anterior) next[itemId] = anterior;
        else delete next[itemId];
        return next;
      });

    startTransition(async () => {
      try {
        const res = await acoes.atualizarCampo(
          itemId,
          campo,
          valor === null ? null : String(valor),
        );
        if (!res.ok) {
          reverter();
          setErro(res.message);
          return;
        }
        acoes.aposEscrita();
      } catch (e) {
        // Falha de rede: sem reverter, a célula mostraria para sempre um
        // valor que não está no banco. Repassa o erro para o Next tratar
        // (inclusive o redirect de sessão expirada).
        reverter();
        throw e;
      }
    });
  }

  /** Confirma uma célula de item já existente e anda a seleção. */
  function confirmarCampo(
    item: VersaoOrcamentoItem,
    campo: Campo,
    valor: ValorCampo,
    destino?: Direcao,
  ) {
    const de = { linhaId: item.id, coluna: campo };
    // Valor igual não vira escrita — mas a navegação acontece do mesmo
    // jeito, senão passar por uma célula sem alterar nada mataria o Tab.
    if (!mesmoValor(valorAtual(item, campo), valor)) {
      gravar(item.id, campo, valor);
    }
    fecharEMover(de, destino);
  }

  function confirmarNumero(
    item: VersaoOrcamentoItem,
    campo: Campo,
    raw: string,
    destino?: Direcao,
  ) {
    const n = parseNumero(raw);
    if (n === null) {
      // Entrada inválida interrompe a navegação de propósito: seguir em
      // frente esconderia o aviso atrás da próxima célula.
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    confirmarCampo(item, campo, n, destino);
  }

  /** Fecha a célula SE ela ainda for a ativa.
   *
   *  O `<select>` avisa que fechou também quando é desmontado pela
   *  navegação — sem esta guarda, o aviso de fechamento chegaria depois
   *  do `setAtiva` da próxima célula e cancelaria o Tab. */
  const fecharCelula = React.useCallback((rowId: string, campo: Campo) => {
    setAtiva((atual) =>
      atual && atual.rowId === rowId && atual.campo === campo ? null : atual,
    );
  }, []);

  /** A linha nova vira item PROVISÓRIO na hora e vai ao banco por trás
   *  (decisão 046). Antes ela ficava como rascunho até a resposta chegar,
   *  com o "Novo item" e a navegação travados no meio do caminho.
   *
   *  A seleção sai do rascunho para a provisória e anda como pediram; o
   *  id provisório é trocado pelo real quando o servidor responde, e a
   *  linha some quando o item de verdade chega pelo refresh. */
  function persistirDraft(d: Draft, campo: Campo, destino?: Direcao) {
    if (persistidos.current.has(d)) return;
    persistidos.current.add(d);

    seqProvisorio.current += 1;
    const tmpId = `tmp:${seqProvisorio.current}`;
    setProvisorios((prev) => [
      ...prev,
      {
        id: tmpId,
        grupoId: d.grupoId,
        item: itemProvisorio(tmpId, d),
        estado: "gravando",
        rascunho: d,
      },
    ]);
    setDraft(null);
    setAtiva(null);
    // O destino é calculado a partir da posição do rascunho — a
    // provisória nasce exatamente nela — e depois religado ao id novo.
    const alvo = destino
      ? selecao.mover(destino, { linhaId: DRAFT_ID, coluna: campo })
      : null;
    selecao.selecionar(
      alvo && alvo.linhaId !== DRAFT_ID
        ? alvo
        : { linhaId: tmpId, coluna: alvo?.coluna ?? campo },
    );

    const formData = new FormData();
    formData.set("item", d.item);
    formData.set("tipo_custo", d.tipo_custo);
    if (d.categoria_id) formData.set("categoria_id", d.categoria_id);
    formData.set("valor_unitario_orcado", String(d.valor_unitario_orcado));
    formData.set("quantidade_orcada", String(d.quantidade_orcada));
    formData.set("dias_meses_orcado", String(d.dias_meses_orcado));
    formData.set(
      "valor_unitario_planejado",
      String(d.valor_unitario_planejado),
    );
    formData.set("quantidade_planejada", String(d.quantidade_planejada));
    formData.set("dias_meses_planejado", String(d.dias_meses_planejado));

    startTransition(async () => {
      let res: ActionResult;
      try {
        res = await acoes.adicionar(d.grupoId, formData);
      } catch (e) {
        marcarErro(tmpId, "Falha ao gravar a linha. Confira a conexão e tente de novo.");
        throw e;
      }
      if (!res.ok) {
        marcarErro(tmpId, res.message);
        return;
      }
      const idReal = res.id;
      if (!idReal) {
        // Origem que não devolve id: sem como casar com o item real, a
        // provisória sai e o refresh a traz de volta como item.
        setProvisorios((prev) => prev.filter((p) => p.id !== tmpId));
        acoes.aposEscrita();
        return;
      }
      // Troca o id provisório pelo real: a linha passa a aceitar edição
      // ANTES do refresh, porque o id já é o do banco.
      setProvisorios((prev) =>
        prev.map((p) =>
          p.id === tmpId
            ? { ...p, id: idReal, item: { ...p.item, id: idReal }, estado: "gravado" }
            : p,
        ),
      );
      const sel = selecaoRef.current;
      if (sel && sel.linhaId === tmpId) {
        selecao.selecionar({ linhaId: idReal, coluna: sel.coluna });
      }
      acoes.aposEscrita();
    });
  }

  /** O servidor recusou a linha nova: ela não some com o que foi
   *  digitado. Se o rascunho estiver livre, volta a ser rascunho no
   *  mesmo lugar; senão fica marcada na grade até ser clicada. */
  function marcarErro(tmpId: string, mensagem: string) {
    setErro(mensagem);
    setProvisorios((prev) =>
      prev.map((p) => (p.id === tmpId ? { ...p, estado: "erro", erro: mensagem } : p)),
    );
    restaurarComoDraft(tmpId);
  }

  function restaurarComoDraft(tmpId: string) {
    setDraft((atual) => {
      if (atual && !draftIntocado(atual)) return atual; // ocupado
      const prov = provisoriosRef.current.find((p) => p.id === tmpId);
      if (!prov) return atual;
      setProvisorios((prev) => prev.filter((p) => p.id !== tmpId));
      const sel = selecaoRef.current;
      selecao.selecionar({ linhaId: DRAFT_ID, coluna: sel?.linhaId === tmpId ? sel.coluna : "item" });
      return { ...prov.rascunho };
    });
  }
  const provisoriosRef = React.useRef(provisorios);
  provisoriosRef.current = provisorios;

  function confirmarDraft(campo: Campo, valor: ValorCampo, destino?: Direcao) {
    if (!draft) return;
    const atualizado = { ...draft, [campo]: valor } as Draft;
    setErro(null);
    // Sem descrição o banco recusa: a linha fica local até ter texto, e a
    // navegação segue dentro do próprio rascunho.
    if (atualizado.item.trim().length > 0) {
      persistirDraft(atualizado, campo, destino);
      return;
    }
    setDraft(atualizado);
    fecharEMover({ linhaId: DRAFT_ID, coluna: campo }, destino);
  }

  function confirmarDraftNumero(campo: Campo, raw: string, destino?: Direcao) {
    const n = parseNumero(raw);
    if (n === null) {
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    confirmarDraft(campo, n, destino);
  }

  function handleRemoveConfirm() {
    if (!removendo) return;
    const alvo = removendo;
    startTransition(async () => {
      const res = await acoes.remover(alvo.id);
      if (!res.ok) setErro(res.message);
      setRemovendo(null);
      acoes.aposEscrita();
    });
  }

  /** Abre a linha nova NO grupo pedido, com o cursor na descrição. */
  function abrirDraft(grupoId: string) {
    setDraft(draftVazio(grupoId));
    selecao.selecionar({ linhaId: DRAFT_ID, coluna: "item" });
    setAtiva({ rowId: DRAFT_ID, campo: "item", porTeclado: true });
  }

  /** Esc numa célula da linha nova: em branco, ela some junto. */
  const descartarDraftIntocado = React.useCallback(() => {
    setDraft((atual) => (atual && draftIntocado(atual) ? null : atual));
  }, []);

  /** O BV existe em A, AR e D — os tipos em que há comissão a negociar
   *  com o fornecedor. O AR entrou em 13/08/2026: nele o principal passa
   *  pela California e ainda assim há comissão. Usa o valor otimista:
   *  mudar o tipo na célula acende/apaga o botão na hora.
   *
   *  Aqui a pílula nunca se divide, mesmo em AR: a PP nasce do realizado
   *  do job (`pedidos_compra` referencia `job_itens_realizado`), e no
   *  orçamento nada disso existe ainda. A calha dividida é da planilha do
   *  job. */
  const temBv = (item: VersaoOrcamentoItem) =>
    // Linha em save não negocia comissão: o serviço não acontece neste
    // projeto, então não há fornecedor. O trigger `bv_exige_item_com_bv`
    // recusa no banco; aqui o botão nem aparece.
    item.em_save !== true &&
    aceitaBV(String(valorAtual(item, "tipo_custo")));

  /** Subtotais de cada grupo e o fechamento da planilha inteira — a
   *  mesma conta, aplicada a recortes diferentes da mesma lista. */
  const subtotaisPorGrupo = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof somarBlocosDosItens>>();
    for (const g of gruposDaTela) {
      mapa.set(g.id, somarBlocosDosItens(g.itens.map(blocosDe)));
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gruposDaTela, overrides, bvsPorItem, percentualImposto]);

  const totaisDaPlanilha = React.useMemo(
    () => somarBlocosDosItens(todosOsItens.map(blocosDe)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todosOsItens, overrides, bvsPorItem, percentualImposto],
  );

  const totalOrcado = totaisDaPlanilha.orcado;
  const totalPlanejado = valorNaVisao(totaisDaPlanilha.planejado, visao);
  const {
    rentabilidade: resultadoTotal,
    percentualRentabilidade: percentualTotal,
    // `orcadoRentabilidade`, e não `orcado`: a coluna Total continua cheia,
    // mas a linha em save fica fora da comparação com o custo.
  } = rentabilidadeDe(totaisDaPlanilha.orcadoRentabilidade, totalPlanejado);

  const rotuloDoTotal = `${rotuloTotal ?? "Total do orçamento"}${
    visao === "liquido" ? " · líquido (− BV)" : ""
  }`;

  // Em versão congelada a calha não some: ela ainda mostra os BVs já
  // lançados, em modo consulta. Sem nada a mostrar, não há calha.
  const temBvVisivel = todosOsItens.some((it) => bvsPorItem[it.id]);
  const temCalha = editavel || temBvVisivel;

  /** A linha de dicas só faz sentido com células à vista. */
  const temDica = gruposDaTela.some((g) => estaAberto(g.id));

  /** Índice das linhas provisórias, para a linha de item se desenhar. */
  const provisorioPorId = React.useMemo(
    () => new Map(provisorios.map((p) => [p.id, p])),
    [provisorios],
  );


  return (
    <>
      {/* O card da planilha inteira. Ele mora AQUI, e não no chamador,
          porque desde 25/08/2026 a dica de teclado fica FORA dele — e um
          componente não consegue devolver nada fora do próprio card se
          quem desenha o card é quem o chama. Sem `overflow-hidden`: a
          calha de ações precisa escapar do frame, e são os filhos que
          arredondam os cantos. */}
      <div
        ref={wrapperRef}
        // O card é quem recebe as teclas da seleção: `tabIndex` para
        // poder ter foco, sem anel — a moldura da célula é o foco visível.
        tabIndex={0}
        onKeyDown={selecao.onKeyDown}
        className="relative rounded-2xl border border-border bg-card shadow-soft outline-none"
      >
        {/* A alça da coluna Save, colada na borda ESQUERDA e fora do
            frame — o lado oposto ao da calha de BV e PP. É o caminho de
            um clique para trazer a coluna de volta; o menu "Exibir" faz o
            mesmo em dois. O componente existia desde 26/08/2026 e nunca
            tinha sido ligado: quem fechava a coluna, ou abria o orçamento
            de um cliente sem save nenhum, ficava sem porta visível para
            marcar a primeira linha (31/08/2026). */}
        {onAlternarSave && (
          <div className="absolute right-full top-0 flex h-full items-start">
            <AlcaDaColunaSave
              visivel={saveVisivel}
              onAlternar={onAlternarSave}
            />
          </div>
        )}
        {erro && (
          <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
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

        {/* A tabela fecha o card sozinha: abaixo dela não há mais nada
            dentro do frame. */}
        <div
          className={cn(
            "overflow-x-auto rounded-b-2xl",
            !erro && "rounded-t-2xl",
          )}
        >
          <table
            className={cn(
              "w-full table-fixed text-sm border-collapse",
              saveVisivel ? LARGURA_MINIMA_SAVE : LARGURA_MINIMA,
            )}
          >
            <ColunasFixas {...colunas} />
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {/* Linha 1 — a faixa dos blocos. Ela é UMA para a planilha
                  inteira: era esta repetição, um cabeçalho por grupo, que
                  o handoff "Grupos Unificados" veio eliminar. */}
              <tr>
                {saveVisivel && <CabecalhoSaveFaixa />}
                <th colSpan={3} className={FAIXA_GRUPO} />
                {orcadoVisivel && (
                  <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                    ORÇADO
                  </th>
                )}
                <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                  PLANEJADO
                </th>
                {rentabilidadeVisivel && (
                  <th
                    colSpan={2}
                    className={cn(FAIXA_ROTULO, RENTABILIDADE.faixa)}
                  >
                    RENTABILIDADE
                  </th>
                )}
              </tr>

              {/* Linha 2 — sub-cabeçalho de colunas */}
              <tr className="bg-muted/40">
                {saveVisivel && <CabecalhoSaveColuna />}
                <th className="text-left font-semibold px-3 py-2 border-r border-r-border">
                  Grupo · Item
                </th>
                <th className="text-left font-semibold px-3 py-2 border-r border-r-border">
                  Tipo
                </th>
                <th className="text-left font-semibold px-3 py-2">Categoria</th>
                {/* bloco ORÇADO */}
                {orcadoVisivel && (
                  <>
                    <th
                      className={cn(
                        "text-right font-semibold px-3 py-2",
                        ORCADO.cabecalhoAbre,
                      )}
                    >
                      R$ Unit.
                    </th>
                    <th
                      className={cn(
                        "text-right font-semibold px-3 py-2",
                        ORCADO.cabecalhoMeio,
                      )}
                    >
                      QT
                    </th>
                    <th
                      className={cn(
                        "text-right font-semibold px-3 py-2",
                        ORCADO.cabecalhoMeio,
                      )}
                    >
                      D/M
                    </th>
                    <th
                      className={cn(
                        "text-right font-semibold px-3 py-2",
                        ORCADO.cabecalhoFim,
                      )}
                    >
                      Total
                    </th>
                  </>
                )}
                {/* bloco PLANEJADO */}
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoAbre,
                  )}
                >
                  R$ Unit.
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoMeio,
                  )}
                >
                  QT
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoMeio,
                  )}
                >
                  D/M
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoFim,
                  )}
                >
                  {rotuloColunaTotal(visao)}
                </th>
                {/* bloco RENTABILIDADE */}
                {rentabilidadeVisivel && (
                  <>
                    <th
                      className={cn(
                        "text-right font-semibold px-3 py-2",
                        RENTABILIDADE.cabecalhoAbre,
                      )}
                    >
                      R$
                    </th>
                    <th
                      className={cn(
                        "text-right font-semibold px-3 py-2",
                        RENTABILIDADE.cabecalhoFim,
                      )}
                    >
                      %
                    </th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {gruposDaTela.map((grupo) => {
                const aberto = estaAberto(grupo.id);
                const sub =
                  subtotaisPorGrupo.get(grupo.id) ??
                  somarBlocosDosItens([]);
                const subOrcado = sub.orcado;
                const subPlanejado = valorNaVisao(sub.planejado, visao);
                const {
                  rentabilidade: subResultado,
                  percentualRentabilidade: subPercentual,
                  // Base da rentabilidade sem as linhas em save — a coluna
                  // Total do subtotal continua cheia, como manda o design.
                } = rentabilidadeDe(sub.orcadoRentabilidade, subPlanejado);

                return (
                  <React.Fragment key={grupo.id}>
                    {/* A LINHA DO GRUPO: nome à esquerda e o subtotal já
                        alinhado às colunas Total de cada bloco. Era o
                        `tfoot` de um card inteiro; agora é uma linha. */}
                    <tr data-calha={`g:${grupo.id}`} className="h-10">
                      <td
                        colSpan={colunasDoRotulo(colunas)}
                        className={LINHA_GRUPO_NOME}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => onAlternarGrupo(grupo.id)}
                            title={
                              aberto
                                ? "Ocultar itens do grupo"
                                : "Mostrar itens do grupo"
                            }
                            aria-expanded={aberto}
                            className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
                          >
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform duration-150",
                                !aberto && "-rotate-90",
                              )}
                            />
                          </button>
                          {nomeDoGrupo ? (
                            nomeDoGrupo(grupo)
                          ) : (
                            <TruncateTooltip
                              text={grupo.nome}
                              className="text-[13.5px] font-bold tracking-[-0.01em] text-foreground"
                            />
                          )}
                          <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
                            {grupo.itens.length}{" "}
                            {grupo.itens.length === 1 ? "item" : "itens"}
                            {!aberto && grupo.itens.length > 0 && " ocultos"}
                          </span>
                        </div>
                      </td>
                      {orcadoVisivel && (
                        <>
                          <td colSpan={3} className={ORCADO.grupoVazio} />
                          <td
                            className={cn(
                              "px-3 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                              ORCADO.grupoValor,
                            )}
                          >
                            {formatCurrency(subOrcado, moeda)}
                          </td>
                        </>
                      )}
                      <td colSpan={3} className={PLANEJADO.grupoVazio} />
                      <td
                        className={cn(
                          "px-3 text-right whitespace-nowrap",
                          PLANEJADO.grupoValor,
                        )}
                      >
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-[13px] font-bold leading-[1.2]">
                            {formatCurrency(subPlanejado, moeda)}
                          </span>
                          {/* A soma dos BVs de todos os itens do grupo. */}
                          {visao === "liquido" && (
                            <SubLinhaBv
                              deducao={sub.planejado.deducaoBv}
                              formatar={(v) => formatCurrency(v, moeda)}
                              cor={PLANEJADO.texto}
                              corRotulo={PLANEJADO.textoSuave}
                            />
                          )}
                        </div>
                      </td>
                      {rentabilidadeVisivel && (
                        <>
                          <td
                            className={cn(
                              "px-3 text-right whitespace-nowrap font-mono text-xs font-semibold",
                              RENTABILIDADE.bordaAbre,
                              RENTABILIDADE.grupoValor,
                            )}
                          >
                            {formatCurrency(subResultado, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-3 text-right whitespace-nowrap font-mono text-xs font-semibold",
                              RENTABILIDADE.grupoValor,
                            )}
                          >
                            {subPercentual === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              formatarPercentual(subPercentual)
                            )}
                          </td>
                        </>
                      )}
                    </tr>

                    {aberto &&
                      grupo.itens.length === 0 &&
                      draft?.grupoId !== grupo.id && (
                        <tr className="border-b border-border">
                          <td
                            colSpan={totalDeColunas(colunas)}
                            className="py-5 pl-[30px] pr-3 text-xs text-muted-foreground"
                          >
                            Sem itens neste grupo ainda.
                          </td>
                        </tr>
                      )}

                    {aberto &&
                      grupo.itens.map((item) => {
                        const totais = totaisDoItem(item);
                        const blocos = blocosDe(item);
                        const planejadoNaVisao = valorNaVisao(
                          blocos.planejado,
                          visao,
                        );
                        const emSave = item.em_save === true;
                        // Duas perguntas diferentes: o planejado ESPELHA o
                        // orçado (`A` e `D`), e o planejado está TRAVADO. A
                        // linha em save trava sem espelhar — ela não tem
                        // custo nenhum (decisão 028 §9).
                        const planejadoEspelha =
                          !emSave &&
                          planejadoEspelhaOrcado(
                            String(
                              valorAtual(item, "tipo_custo"),
                            ) as VersaoOrcamentoItem["tipo_custo"],
                          );
                        const planejadoTravado = planejadoEspelha || emSave;
                        const save = savePorItem?.[item.id] ?? SAVE_VAZIO;
                        const categoriaId = valorAtual(item, "categoria_id") as
                          | string
                          | null;
                        const categoria = categorias.find(
                          (c) => c.id === categoriaId,
                        );
                        const ativaAqui = (campo: Campo) =>
                          ativa?.rowId === item.id && ativa.campo === campo;
                        const sementeDe = (campo: Campo) =>
                          ativaAqui(campo) ? ativa?.semente : undefined;
                        const provisorio = provisorioPorId.get(item.id);

                        return (
                          <tr
                            key={item.id}
                            data-calha={`i:${item.id}`}
                            // Gravando: a linha já está na grade, mais
                            // clara, e as células selecionam mas não
                            // abrem. Recusada: fica marcada, e o clique
                            // a devolve ao rascunho com o que foi digitado.
                            title={provisorio?.estado === "erro" ? provisorio.erro : undefined}
                            onClick={
                              provisorio?.estado === "erro"
                                ? () => restaurarComoDraft(item.id)
                                : undefined
                            }
                            className={cn(
                              ALTURA_LINHA,
                              "border-b border-border transition-colors",
                              editavel && "hover:bg-accent/40",
                              saveVisivel && classesDaLinhaComSave(save),
                              provisorio?.estado === "gravando" && "opacity-60",
                              provisorio?.estado === "erro" &&
                                "cursor-pointer bg-california-red/5",
                            )}
                          >
                            {saveVisivel && (
                              <CelulaSave
                                estado={save}
                                moeda={moeda}
                                totalOrcado={totais.orcado}
                                onAbrir={
                                  onAbrirSave
                                    ? () => onAbrirSave(item)
                                    : undefined
                                }
                                disabled={pending}
                              />
                            )}
                            <CelulaTexto
                              valor={String(valorAtual(item, "item") ?? "")}
                              editando={ativaAqui("item")}
                              semente={sementeDe("item")}
                              nav={selecao.celulaProps(item.id, "item")}
                              moldura={selecao.moldura(item.id, "item")}
                              onConfirmar={(v, d) =>
                                confirmarCampo(item, "item", v.trim(), d)
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={cn(
                                "text-foreground",
                                RECUO_ITEM,
                                GRADE_NEUTRA,
                              )}
                            />

                            <CelulaSelect
                              editando={ativaAqui("tipo_custo")}
                              valor={String(valorAtual(item, "tipo_custo"))}
                              opcoes={TIPOS_CUSTO.map((t) => ({
                                value: t,
                                label: tipoCustoLabel(t),
                              }))}
                              nav={selecao.celulaProps(item.id, "tipo_custo")}
                              moldura={selecao.moldura(item.id, "tipo_custo")}
                              // Escolher grava e FICA na célula — quem
                              // anda é a seta ou o Tab (decisão 046).
                              onConfirmar={(v) => confirmarCampo(item, "tipo_custo", v)}
                              onNavegar={(d) =>
                                fecharEMover({ linhaId: item.id, coluna: "tipo_custo" }, d)
                              }
                              onFechar={() => fecharCelula(item.id, "tipo_custo")}
                              tdClassName={cn(GRADE_NEUTRA, "px-2")}
                            >
                              <Badge variant="outline" className="px-1.5">
                                {String(valorAtual(item, "tipo_custo"))}
                              </Badge>
                            </CelulaSelect>

                            <CelulaSelect
                              editando={ativaAqui("categoria_id")}
                              valor={categoriaId ?? SEM_CATEGORIA}
                              opcoes={[
                                { value: SEM_CATEGORIA, label: "Nenhuma" },
                                ...categorias
                                  .filter(
                                    (c) => c.ativo || c.id === item.categoria_id,
                                  )
                                  .map((c) => ({
                                    value: c.id,
                                    label: c.ativo
                                      ? c.nome
                                      : `${c.nome} (inativa)`,
                                  })),
                              ]}
                              vazio="Nenhuma categoria cadastrada em /categorias"
                              nav={selecao.celulaProps(item.id, "categoria_id")}
                              moldura={selecao.moldura(item.id, "categoria_id")}
                              onConfirmar={(v) =>
                                confirmarCampo(
                                  item,
                                  "categoria_id",
                                  v === SEM_CATEGORIA ? null : v,
                                )
                              }
                              onNavegar={(d) =>
                                fecharEMover({ linhaId: item.id, coluna: "categoria_id" }, d)
                              }
                              onFechar={() =>
                                fecharCelula(item.id, "categoria_id")
                              }
                            >
                              {categoria ? (
                                <Badge variant="neutral">{categoria.nome}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </CelulaSelect>

                            {orcadoVisivel && (
                              <>
                                <CelulaNumero
                                  valor={num(
                                    valorAtual(item, "valor_unitario_orcado"),
                                  )}
                                  formato="moeda"
                                  moeda={moeda}
                                  editando={ativaAqui("valor_unitario_orcado")}
                                  semente={sementeDe("valor_unitario_orcado")}
                                  nav={selecao.celulaProps(item.id, "valor_unitario_orcado")}
                              moldura={selecao.moldura(item.id, "valor_unitario_orcado")}
                                  onConfirmar={(raw, d) =>
                                    confirmarNumero(
                                      item,
                                      "valor_unitario_orcado",
                                      raw,
                                      d,
                                    )
                                  }
                                  onCancelar={() => setAtiva(null)}
                                  tdClassName={cn("font-mono", ORCADO.celulaAbre)}
                                />
                                <CelulaNumero
                                  valor={num(valorAtual(item, "quantidade_orcada"))}
                                  editando={ativaAqui("quantidade_orcada")}
                                  semente={sementeDe("quantidade_orcada")}
                                  nav={selecao.celulaProps(item.id, "quantidade_orcada")}
                              moldura={selecao.moldura(item.id, "quantidade_orcada")}
                                  onConfirmar={(raw, d) =>
                                    confirmarNumero(item, "quantidade_orcada", raw, d)
                                  }
                                  onCancelar={() => setAtiva(null)}
                                  tdClassName={ORCADO.celulaMeio}
                                />
                                <CelulaNumero
                                  valor={num(valorAtual(item, "dias_meses_orcado"))}
                                  editando={ativaAqui("dias_meses_orcado")}
                                  semente={sementeDe("dias_meses_orcado")}
                                  nav={selecao.celulaProps(item.id, "dias_meses_orcado")}
                              moldura={selecao.moldura(item.id, "dias_meses_orcado")}
                                  onConfirmar={(raw, d) =>
                                    confirmarNumero(item, "dias_meses_orcado", raw, d)
                                  }
                                  onCancelar={() => setAtiva(null)}
                                  tdClassName={ORCADO.celulaMeio}
                                />
                                <CelulaCalculada
                                  selecao={selecao}
                                  linhaId={item.id}
                                  coluna="total_orcado"
                                  className={cn("font-mono font-semibold", ORCADO.celulaTotal)}
                                >
                                  {formatCurrency(totais.orcado, moeda)}
                                </CelulaCalculada>
                              </>
                            )}

                            {/* Planejado espelha o Orçado: zero é
                                "R$ 0,00 · 0 · 0", não travessão. Em `A` e
                                `D` o espelho é literal e as células não
                                abrem: lá o cliente paga o fornecedor
                                direto, e o custo da agência É o orçado
                                menos o BV. */}
                            <CelulaNumero
                              valor={
                                planejadoEspelha
                                  ? num(valorAtual(item, "valor_unitario_orcado"))
                                  : num(
                                      valorAtual(item, "valor_unitario_planejado"),
                                    )
                              }
                              formato="moeda"
                              moeda={moeda}
                              editando={ativaAqui("valor_unitario_planejado")}
                              semente={sementeDe("valor_unitario_planejado")}
                              nav={selecao.celulaProps(item.id, "valor_unitario_planejado")}
                              moldura={selecao.moldura(item.id, "valor_unitario_planejado")}
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "valor_unitario_planejado",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={cn("font-mono", PLANEJADO.celulaAbre)}
                            />
                            <CelulaNumero
                              valor={
                                planejadoEspelha
                                  ? num(valorAtual(item, "quantidade_orcada"))
                                  : num(valorAtual(item, "quantidade_planejada"))
                              }
                              editando={ativaAqui("quantidade_planejada")}
                              semente={sementeDe("quantidade_planejada")}
                              nav={selecao.celulaProps(item.id, "quantidade_planejada")}
                              moldura={selecao.moldura(item.id, "quantidade_planejada")}
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "quantidade_planejada",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={PLANEJADO.celulaMeio}
                            />
                            <CelulaNumero
                              valor={
                                planejadoEspelha
                                  ? num(valorAtual(item, "dias_meses_orcado"))
                                  : num(valorAtual(item, "dias_meses_planejado"))
                              }
                              editando={ativaAqui("dias_meses_planejado")}
                              semente={sementeDe("dias_meses_planejado")}
                              nav={selecao.celulaProps(item.id, "dias_meses_planejado")}
                              moldura={selecao.moldura(item.id, "dias_meses_planejado")}
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "dias_meses_planejado",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={PLANEJADO.celulaMeio}
                            />
                            <CelulaCalculada
                              selecao={selecao}
                              linhaId={item.id}
                              coluna="total_planejado"
                              className={PLANEJADO.celulaTotal}
                            >
                              <div className="flex flex-col items-end">
                                <span className="font-mono text-xs font-semibold leading-[1.2]">
                                  {formatCurrency(planejadoNaVisao, moeda)}
                                </span>
                                {visao === "liquido" && (
                                  <SubLinhaBv
                                    deducao={blocos.planejado.deducaoBv}
                                    formatar={(v) => formatCurrency(v, moeda)}
                                    cor={PLANEJADO.texto}
                                    corRotulo={PLANEJADO.textoSuave}
                                  />
                                )}
                              </div>
                            </CelulaCalculada>

                            {rentabilidadeVisivel && (
                              <CelulasRentabilidade
                                selecao={selecao}
                                linhaId={item.id}
                                orcado={totais.orcado}
                                planejado={planejadoNaVisao}
                                moeda={moeda}
                              />
                            )}
                          </tr>
                        );
                      })}

                    {/* Linha nova — preenchida na própria grade, sem drawer. */}
                    {aberto && draft?.grupoId === grupo.id && (
                      <LinhaDraft
                        draft={draft}
                        saveVisivel={saveVisivel}
                        orcadoVisivel={orcadoVisivel}
                        rentabilidadeVisivel={rentabilidadeVisivel}
                        moeda={moeda}
                        categorias={categorias}
                        ativa={ativa}
                        selecao={selecao}
                        onFechar={() => {
                          setAtiva(null);
                          // Esc num rascunho em branco o descarta — e a
                          // seleção volta para a última linha do grupo,
                          // em vez de morrer junto com ele.
                          if (draft && draftIntocado(draft)) {
                            const ultimo = grupo.itens[grupo.itens.length - 1];
                            selecao.selecionar(
                              ultimo ? { linhaId: ultimo.id, coluna: "item" } : null,
                            );
                          }
                          descartarDraftIntocado();
                        }}
                        onConfirmarTexto={(campo, v, d) =>
                          confirmarDraft(campo, v, d)
                        }
                        onConfirmarNumero={(campo, raw, d) =>
                          confirmarDraftNumero(campo, raw, d)
                        }
                        onNavegar={(campo, d) =>
                          fecharEMover({ linhaId: DRAFT_ID, coluna: campo }, d)
                        }
                        onFecharCelula={(campo) => fecharCelula(DRAFT_ID, campo)}
                      />
                    )}

                    {/* "Novo item" fecha o agrupamento, e não a tabela —
                        é o que dá ao grupo um fim visível sem precisar do
                        card que ele tinha antes. */}
                    {aberto && editavel && (
                      <tr className="h-[30px] border-b border-border">
                        <td
                          colSpan={totalDeColunas(colunas)}
                          className="pl-[30px] pr-3"
                        >
                          <button
                            type="button"
                            onClick={() => abrirDraft(grupo.id)}
                            // Rascunho em branco não trava nada: o clique
                            // aqui o descarta (pointerdown, acima) e abre
                            // a linha nova neste grupo.
                            disabled={draft !== null && !draftIntocado(draft)}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold text-california-red transition-colors hover:text-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" />
                            Novo item em {grupo.nome}
                          </button>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {/* "Novo grupo" — depois do último grupo e antes do total,
                  que é onde o grupo novo vai nascer. */}
              {novoGrupo && (
                <tr>
                  <td
                    colSpan={totalDeColunas(colunas)}
                    className={LINHA_NOVO_GRUPO}
                  >
                    <div className="flex items-center gap-2.5">
                      {novoGrupo}
                      <span className="text-[11px] text-muted-foreground">
                        o grupo novo entra aqui, no fim da ordem
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={colunasDoRotulo(colunas)} className={LINHA_TOTAL_ROTULO}>
                  {rotuloDoTotal}
                </td>
                {orcadoVisivel && (
                  <>
                    <td colSpan={3} className={ORCADO.subtotalVazio} />
                    <td
                      className={cn(
                        "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                        ORCADO.subtotalValor,
                      )}
                    >
                      {formatCurrency(totalOrcado, moeda)}
                    </td>
                  </>
                )}
                <td colSpan={3} className={PLANEJADO.subtotalVazio} />
                <td
                  className={cn(
                    "px-3 py-2 text-right whitespace-nowrap",
                    PLANEJADO.subtotalValor,
                  )}
                >
                  <div className="flex flex-col items-end">
                    <span className="font-mono text-[13px] font-bold">
                      {formatCurrency(totalPlanejado, moeda)}
                    </span>
                    {visao === "liquido" && (
                      <SubLinhaBv
                        deducao={totaisDaPlanilha.planejado.deducaoBv}
                        formatar={(v) => formatCurrency(v, moeda)}
                        cor={PLANEJADO.texto}
                        corRotulo={PLANEJADO.textoSuave}
                      />
                    )}
                  </div>
                </td>
                {rentabilidadeVisivel && (
                  <>
                    <td
                      className={cn(
                        "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                        RENTABILIDADE.bordaAbre,
                        RENTABILIDADE.subtotalValor,
                      )}
                    >
                      {formatCurrency(resultadoTotal, moeda)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                        RENTABILIDADE.subtotalValor,
                      )}
                    >
                      {percentualTotal === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatarPercentual(percentualTotal)
                      )}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* A calha — fora do frame da tabela, ao lado das linhas. Cada
            pílula é presa à posição MEDIDA da linha que ela acompanha:
            numa tabela só, as linhas têm alturas diferentes e altura
            chutada acumularia erro a cada grupo. */}
        {temCalha && (
          <Calha>
            {gruposDaTela.map((grupo) => {
              const aberto = estaAberto(grupo.id);
              const acoesGrupo = acoesDoGrupo?.(grupo);

              return (
                <React.Fragment key={grupo.id}>
                  {acoesGrupo && (
                    <LinhaDaCalha posicao={posicoesCalha[`g:${grupo.id}`]}>
                      {/* A vaga do BV fica vazia para a lixeira do grupo
                          cair no mesmo eixo das lixeiras de item. */}
                      <span
                        className={cn("flex-none", LARGURA_CALHA_BV)}
                        aria-hidden
                      />
                      {acoesGrupo}
                    </LinhaDaCalha>
                  )}

                  {aberto &&
                    grupo.itens.map((item) => {
                      const bv = bvsPorItem[item.id] ?? null;
                      // Sem BV numa versão congelada não há nada a
                      // consultar — a vaga fica vazia para não desalinhar.
                      const mostraBv = temBv(item) && (editavel || bv !== null);
                      if (!mostraBv && !editavel) return null;
                      // Ainda sem id real não há o que remover nem a que
                      // prender um BV — a vaga fica vazia para as de
                      // baixo não desalinharem.
                      if (provisoriaTravada(item.id)) return null;

                      return (
                        <LinhaDaCalha
                          key={item.id}
                          posicao={posicoesCalha[`i:${item.id}`]}
                        >
                          <span
                            className={cn(
                              "flex flex-none items-center",
                              LARGURA_CALHA_BV,
                            )}
                          >
                            {mostraBv && (
                              <BvActionButton
                                temBv={bv !== null}
                                itemNome={item.item}
                                // BV que já saiu para o financeiro abre em
                                // consulta mesmo com a versão aberta.
                                somenteLeitura={
                                  !editavel ||
                                  (bv !== null && bv.situacao !== "a_negociar")
                                }
                                onClick={() => setBvAberto(item)}
                              />
                            )}
                          </span>

                          {editavel && (
                            <button
                              type="button"
                              onClick={() => setRemovendo(item)}
                              title={`Remover ${item.item}`}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </LinhaDaCalha>
                      );
                    })}
                </React.Fragment>
              );
            })}

            {draft && (
              <LinhaDaCalha posicao={posicoesCalha[DRAFT_ID]}>
                {/* A linha nova ainda não existe no banco: sem id, não há
                    a que prender um BV. O botão entra depois de salva. */}
                <span
                  className={cn("flex-none", LARGURA_CALHA_BV)}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setAtiva(null);
                  }}
                  title="Descartar linha nova"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </LinhaDaCalha>
            )}
          </Calha>
        )}
      </div>

      {/* A dica de teclado vive FORA do card (pedido do Tiago, 25/08 e
          03/09/2026): dentro do frame ela lia como mais uma linha. */}
      {temDica && <DicasDeTeclado editavel={editavel} />}

      {bvAberto && (
        <BvDialog
          open
          onOpenChange={(o) => !o && setBvAberto(null)}
          item={bvAberto}
          grupoNome={
            gruposDaTela.find((g) => g.itens.some((i) => i.id === bvAberto.id))
              ?.nome ?? ""
          }
          versaoLabel={versaoLabel}
          categoriaNome={
            categorias.find((c) => c.id === bvAberto.categoria_id)?.nome ?? null
          }
          moeda={moeda}
          bv={bvsPorItem[bvAberto.id] ?? null}
          fornecedores={fornecedores}
          percentualImposto={percentualImposto}
          origem="orcamento"
          readOnly={readOnly}
          adaptador={adaptadorBv}
        />
      )}

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(o) => !o && setRemovendo(null)}
        title="Remover item?"
        description={
          <>
            <strong className="text-foreground">{removendo?.item}</strong> será
            removido do grupo{" "}
            <strong className="text-foreground">
              {gruposDaTela.find((g) => g.itens.some((i) => i.id === removendo?.id))
                ?.nome ?? ""}
            </strong>
            . Você pode adicionar novamente depois se precisar.
          </>
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleRemoveConfirm}
      />
    </>
  );
}

// ============================================================
// Células
// ============================================================

const TD_BASE = "text-xs align-middle";

type NavDaCelula = ReturnType<Selecao["celulaProps"]>;

/** Foco no campo recém-aberto. Aberto por Enter, o conteúdo inteiro fica
 *  selecionado (digitar substitui). Aberto por um caractere digitado, o
 *  caractere já está lá e o cursor fica no fim dele. */
function focarCampo(el: HTMLInputElement, semente?: string) {
  if (semente === undefined) {
    el.select();
    return;
  }
  const fim = el.value.length;
  el.setSelectionRange(fim, fim);
}

/** Célula calculada (Total, Rentabilidade): seleciona, não abre. Também
 *  serve de moldura para qualquer célula só de leitura. */
function CelulaCalculada({
  selecao,
  linhaId,
  coluna,
  className,
  children,
}: {
  selecao: Selecao;
  linhaId: string;
  coluna: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { className: navClasse, ...handlers } = selecao.celulaProps(linhaId, coluna);
  return (
    <td
      className={cn(TD_BASE, "px-3 text-right whitespace-nowrap", className, navClasse)}
      {...handlers}
    >
      <Miolo moldura={selecao.moldura(linhaId, coluna)}>{children}</Miolo>
    </td>
  );
}

function CelulaTexto({
  valor,
  editando,
  nav,
  moldura,
  semente,
  onConfirmar,
  onCancelar,
  tdClassName,
}: {
  valor: string;
  editando: boolean;
  nav: NavDaCelula;
  moldura: string;
  semente?: string;
  onConfirmar: (valor: string, destino?: Direcao) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  // Sem este reset o ref ficava `true` para sempre depois do primeiro
  // Enter, e a partir daí sair da célula pelo clique não gravava mais
  // nada. Passava despercebido porque o Enter fechava a edição; com a
  // navegação por teclado a mesma célula é reaberta o tempo todo.
  React.useEffect(() => {
    if (editando) finalizado.current = false;
  }, [editando]);

  if (editando) {
    return (
      <td className={cn(TD_BASE, "px-1.5", tdClassName)}>
        <input
          autoFocus
          defaultValue={semente ?? valor}
          onFocus={(e) => focarCampo(e.currentTarget, semente)}
          onKeyDown={(e) => {
            const destino = direcaoNoCampo(e, e.currentTarget);
            if (destino) {
              // preventDefault é o que impede o navegador de levar o foco
              // para o próximo elemento por conta própria: quem decide
              // para onde ir é a grade, não a ordem do DOM.
              e.preventDefault();
              finalizado.current = true;
              onConfirmar(e.currentTarget.value, destino);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              finalizado.current = true;
              onCancelar();
            }
          }}
          onBlur={(e) => {
            if (!finalizado.current) onConfirmar(e.currentTarget.value);
          }}
          className={CAMPO_CLASSES}
        />
      </td>
    );
  }

  const { className: navClasse, ...handlers } = nav;
  return (
    <td className={cn(TD_BASE, "px-3", tdClassName, navClasse)} {...handlers}>
      <Miolo moldura={moldura}>
        <TruncateTooltip text={valor} />
      </Miolo>
    </td>
  );
}

function CelulaNumero({
  valor,
  formato,
  moeda,
  editando,
  nav,
  moldura,
  semente,
  onConfirmar,
  onCancelar,
  tdClassName,
}: {
  valor: number;
  formato?: "moeda";
  moeda?: string;
  editando: boolean;
  nav: NavDaCelula;
  moldura: string;
  semente?: string;
  onConfirmar: (raw: string, destino?: Direcao) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  React.useEffect(() => {
    if (editando) finalizado.current = false;
  }, [editando]);

  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <input
          autoFocus
          inputMode="decimal"
          defaultValue={semente ?? paraEdicao(valor)}
          onFocus={(e) => focarCampo(e.currentTarget, semente)}
          onKeyDown={(e) => {
            const destino = direcaoNoCampo(e, e.currentTarget);
            if (destino) {
              e.preventDefault();
              finalizado.current = true;
              onConfirmar(e.currentTarget.value, destino);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              finalizado.current = true;
              onCancelar();
            }
          }}
          onBlur={(e) => {
            if (!finalizado.current) onConfirmar(e.currentTarget.value);
          }}
          className={cn(CAMPO_CLASSES, "text-right font-mono")}
        />
      </td>
    );
  }

  const { className: navClasse, ...handlers } = nav;
  return (
    <td
      className={cn(TD_BASE, "px-3 text-right whitespace-nowrap", tdClassName, navClasse)}
      {...handlers}
    >
      <Miolo moldura={moldura}>
        {formato === "moeda" ? formatCurrency(valor, moeda) : valor}
      </Miolo>
    </td>
  );
}

/** Célula de escolha (Tipo, Categoria).
 *
 *  As setas aqui são do dropdown — é com elas que se percorrem as opções
 *  —, então esta célula navega só por Tab. Escolher um valor fecha a
 *  lista e a seleção FICA na célula: não desce nem pula para a próxima.
 *  Quem quer andar usa a seta ou o Tab (decisão 046, como no Excel). */
function CelulaSelect({
  valor,
  opcoes,
  vazio,
  editando,
  nav,
  moldura,
  onConfirmar,
  onNavegar,
  onFechar,
  tdClassName,
  children,
}: {
  valor: string;
  opcoes: { value: string; label: string }[];
  /** Texto auxiliar quando só existe a opção "Nenhuma". */
  vazio?: string;
  editando: boolean;
  nav: NavDaCelula;
  moldura: string;
  onConfirmar: (valor: string) => void;
  onNavegar: (destino: Direcao) => void;
  onFechar: () => void;
  tdClassName?: string;
  children: React.ReactNode;
}) {
  /** Só o Tab é nosso: ele atravessa a coluna sem escolher nada. O Enter
   *  pertence ao Radix, que o usa para confirmar a opção destacada —
   *  interceptá-lo aqui deixaria o dropdown sem como escolher pelo
   *  teclado. As setas também são dele, para percorrer as opções. */
  function navegarNaLista(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    onNavegar(e.shiftKey ? "anterior" : "proxima");
  }

  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <Select
          value={valor}
          defaultOpen
          onValueChange={onConfirmar}
          onOpenChange={(aberto) => {
            if (!aberto) onFechar();
          }}
        >
          <SelectTrigger
            className={cn(CAMPO_CLASSES, "justify-between gap-1 py-0")}
          >
            <SelectValue />
          </SelectTrigger>
          {/* Tab com a lista aberta atravessa sem escolher — é o jeito de
              passar por uma coluna que já está certa. */}
          <SelectContent onKeyDown={navegarNaLista}>
            {opcoes.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
            {vazio && opcoes.length === 1 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">{vazio}</p>
            )}
          </SelectContent>
        </Select>
      </td>
    );
  }

  const { className: navClasse, ...handlers } = nav;
  return (
    // px-3 antes de tdClassName: a coluna Tipo tem só 4,5% da largura e
    // precisa reduzir o padding para o badge não ser cortado.
    <td className={cn(TD_BASE, "px-3", tdClassName, navClasse)} {...handlers}>
      <Miolo moldura={moldura} className="max-w-[160px] truncate">
        {children}
      </Miolo>
    </td>
  );
}

/** Linha em branco da grade: vive no cliente até ter descrição. */
function LinhaDraft({
  draft,
  moeda,
  categorias,
  ativa,
  selecao,
  onFechar,
  onConfirmarTexto,
  onConfirmarNumero,
  onNavegar,
  onFecharCelula,
  saveVisivel,
  orcadoVisivel = true,
  rentabilidadeVisivel = true,
}: {
  draft: Draft;
  moeda: string;
  categorias: Categoria[];
  ativa: CelulaAtiva;
  selecao: Selecao;
  onFechar: () => void;
  onConfirmarTexto: (campo: Campo, valor: ValorCampo, destino?: Direcao) => void;
  onConfirmarNumero: (campo: Campo, raw: string, destino?: Direcao) => void;
  /** Tab/Enter num `<select>` da linha nova: navega sem gravar valor. */
  onNavegar: (campo: Campo, destino: Direcao) => void;
  /** Fecha só se a célula ainda for a ativa — mesma guarda das linhas de
   *  item, para o aviso de fechamento do Radix não cancelar o Tab. */
  onFecharCelula: (campo: Campo) => void;
  /** A grade tem a coluna de Save aberta: a linha nova precisa da célula
   *  vaga, senão ela escorrega uma casa em relação às de cima. A linha
   *  ainda não existe no banco, então não há save a definir nela. */
  saveVisivel?: boolean;
  /** Os mesmos blocos da grade acima — a linha nova tem que ter as
   *  MESMAS colunas das linhas de item, senão ela escorrega. */
  orcadoVisivel?: boolean;
  rentabilidadeVisivel?: boolean;
}) {
  const ativaAqui = (campo: Campo) =>
    ativa?.rowId === DRAFT_ID && ativa.campo === campo;
  const sementeDe = (campo: Campo) =>
    ativaAqui(campo) ? ativa?.semente : undefined;
  const totalOrcado =
    draft.valor_unitario_orcado *
    draft.quantidade_orcada *
    draft.dias_meses_orcado;
  const totalPlanejado =
    draft.valor_unitario_planejado *
    draft.quantidade_planejada *
    draft.dias_meses_planejado;
  const categoria = categorias.find((c) => c.id === draft.categoria_id);

  return (
    <tr
      data-calha={DRAFT_ID}
      className={cn(
        ALTURA_LINHA,
        "border-b border-border bg-california-red/[0.03]",
      )}
    >
      {saveVisivel && (
        <td className="border-r border-r-[#e8e7e3]" aria-hidden />
      )}
      <CelulaTexto
        valor={draft.item}
        editando={ativaAqui("item")}
        semente={sementeDe("item")}
        nav={selecao.celulaProps(DRAFT_ID, "item")}
        moldura={selecao.moldura(DRAFT_ID, "item")}
        onConfirmar={(v, d) => onConfirmarTexto("item", v.trim(), d)}
        onCancelar={onFechar}
        tdClassName={cn("text-foreground", RECUO_ITEM, GRADE_NEUTRA)}
      />
      <CelulaSelect
        editando={ativaAqui("tipo_custo")}
        valor={draft.tipo_custo}
        opcoes={TIPOS_CUSTO.map((t) => ({ value: t, label: tipoCustoLabel(t) }))}
        nav={selecao.celulaProps(DRAFT_ID, "tipo_custo")}
        moldura={selecao.moldura(DRAFT_ID, "tipo_custo")}
        onConfirmar={(v) => onConfirmarTexto("tipo_custo", v)}
        onNavegar={(d) => onNavegar("tipo_custo", d)}
        onFechar={() => onFecharCelula("tipo_custo")}
        tdClassName={cn(GRADE_NEUTRA, "px-2")}
      >
        <Badge variant="outline" className="px-1.5">
          {draft.tipo_custo}
        </Badge>
      </CelulaSelect>
      <CelulaSelect
        editando={ativaAqui("categoria_id")}
        valor={draft.categoria_id ?? SEM_CATEGORIA}
        opcoes={[
          { value: SEM_CATEGORIA, label: "Nenhuma" },
          ...categorias
            .filter((c) => c.ativo || c.id === draft.categoria_id)
            .map((c) => ({
              value: c.id,
              label: c.ativo ? c.nome : `${c.nome} (inativa)`,
            })),
        ]}
        vazio="Nenhuma categoria cadastrada em /categorias"
        nav={selecao.celulaProps(DRAFT_ID, "categoria_id")}
        moldura={selecao.moldura(DRAFT_ID, "categoria_id")}
        onConfirmar={(v) =>
          onConfirmarTexto("categoria_id", v === SEM_CATEGORIA ? null : v)
        }
        onNavegar={(d) => onNavegar("categoria_id", d)}
        onFechar={() => onFecharCelula("categoria_id")}
      >
        {categoria ? (
          <Badge variant="neutral">{categoria.nome}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </CelulaSelect>

      {orcadoVisivel && (
        <>
          <CelulaNumero
            valor={draft.valor_unitario_orcado}
            formato="moeda"
            moeda={moeda}
            editando={ativaAqui("valor_unitario_orcado")}
            semente={sementeDe("valor_unitario_orcado")}
            nav={selecao.celulaProps(DRAFT_ID, "valor_unitario_orcado")}
        moldura={selecao.moldura(DRAFT_ID, "valor_unitario_orcado")}
            onConfirmar={(raw, d) =>
              onConfirmarNumero("valor_unitario_orcado", raw, d)
            }
            onCancelar={onFechar}
            tdClassName={cn("font-mono", ORCADO.celulaAbre)}
          />
          <CelulaNumero
            valor={draft.quantidade_orcada}
            editando={ativaAqui("quantidade_orcada")}
            semente={sementeDe("quantidade_orcada")}
            nav={selecao.celulaProps(DRAFT_ID, "quantidade_orcada")}
        moldura={selecao.moldura(DRAFT_ID, "quantidade_orcada")}
            onConfirmar={(raw, d) =>
              onConfirmarNumero("quantidade_orcada", raw, d)
            }
            onCancelar={onFechar}
            tdClassName={ORCADO.celulaMeio}
          />
          <CelulaNumero
            valor={draft.dias_meses_orcado}
            editando={ativaAqui("dias_meses_orcado")}
            semente={sementeDe("dias_meses_orcado")}
            nav={selecao.celulaProps(DRAFT_ID, "dias_meses_orcado")}
        moldura={selecao.moldura(DRAFT_ID, "dias_meses_orcado")}
            onConfirmar={(raw, d) =>
              onConfirmarNumero("dias_meses_orcado", raw, d)
            }
            onCancelar={onFechar}
            tdClassName={ORCADO.celulaMeio}
          />
          <CelulaCalculada
            selecao={selecao}
            linhaId={DRAFT_ID}
            coluna="total_orcado"
            className={cn("font-mono font-semibold", ORCADO.celulaTotal)}
          >
            {formatCurrency(totalOrcado, moeda)}
          </CelulaCalculada>
        </>
      )}

      {/* Sem vazioComoTraco: na linha nova o planejado espelha o orçado —
          R$ 0,00 · 1 · 1 em vez de três travessões. */}
      <CelulaNumero
        valor={draft.valor_unitario_planejado}
        formato="moeda"
        moeda={moeda}
        editando={ativaAqui("valor_unitario_planejado")}
        semente={sementeDe("valor_unitario_planejado")}
        nav={selecao.celulaProps(DRAFT_ID, "valor_unitario_planejado")}
        moldura={selecao.moldura(DRAFT_ID, "valor_unitario_planejado")}
        onConfirmar={(raw, d) => onConfirmarNumero("valor_unitario_planejado", raw, d)}
        onCancelar={onFechar}
        tdClassName={cn("font-mono", PLANEJADO.celulaAbre)}
      />
      <CelulaNumero
        valor={draft.quantidade_planejada}
        editando={ativaAqui("quantidade_planejada")}
        semente={sementeDe("quantidade_planejada")}
        nav={selecao.celulaProps(DRAFT_ID, "quantidade_planejada")}
        moldura={selecao.moldura(DRAFT_ID, "quantidade_planejada")}
        onConfirmar={(raw, d) => onConfirmarNumero("quantidade_planejada", raw, d)}
        onCancelar={onFechar}
        tdClassName={PLANEJADO.celulaMeio}
      />
      <CelulaNumero
        valor={draft.dias_meses_planejado}
        editando={ativaAqui("dias_meses_planejado")}
        semente={sementeDe("dias_meses_planejado")}
        nav={selecao.celulaProps(DRAFT_ID, "dias_meses_planejado")}
        moldura={selecao.moldura(DRAFT_ID, "dias_meses_planejado")}
        onConfirmar={(raw, d) => onConfirmarNumero("dias_meses_planejado", raw, d)}
        onCancelar={onFechar}
        tdClassName={PLANEJADO.celulaMeio}
      />
      <CelulaCalculada
        selecao={selecao}
        linhaId={DRAFT_ID}
        coluna="total_planejado"
        className={cn("font-mono font-semibold", PLANEJADO.celulaTotal)}
      >
        {formatCurrency(totalPlanejado, moeda)}
      </CelulaCalculada>

      {rentabilidadeVisivel && (
        <CelulasRentabilidade
          selecao={selecao}
          linhaId={DRAFT_ID}
          orcado={totalOrcado}
          planejado={totalPlanejado}
          moeda={moeda}
        />
      )}
    </tr>
  );
}

/** Rentabilidade da linha: valor absoluto e percentual sobre o orçado.
 *  Sem planejado ainda não há rentabilidade a mostrar. Selecionáveis,
 *  como toda célula calculada — é assim que se destaca um número. */
function CelulasRentabilidade({
  selecao,
  linhaId,
  orcado,
  planejado,
  moeda,
}: {
  selecao: Selecao;
  linhaId: string;
  orcado: number;
  planejado: number;
  moeda: string;
}) {
  const { rentabilidade, percentualRentabilidade } = rentabilidadeDe(
    orcado,
    planejado,
  );
  const semPlanejado = planejado <= 0;

  return (
    <>
      <CelulaCalculada
        selecao={selecao}
        linhaId={linhaId}
        coluna="rentab_valor"
        className={cn("font-mono", RENTABILIDADE.celulaAbre)}
      >
        {semPlanejado ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={RENTAB_VALOR}>
            {formatCurrency(rentabilidade, moeda)}
          </span>
        )}
      </CelulaCalculada>
      <CelulaCalculada
        selecao={selecao}
        linhaId={linhaId}
        coluna="rentab_pct"
        className={cn("font-mono", RENTABILIDADE.celulaTotal)}
      >
        {percentualRentabilidade === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={RENTAB_VALOR}>
            {formatarPercentual(percentualRentabilidade)}
          </span>
        )}
      </CelulaCalculada>
    </>
  );
}
