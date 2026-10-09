"use client";

/**
 * O formulário da PP (decisão 153, 07/10/2026): ele salva a PP A EMITIR.
 *
 * O caminho passou a ser PP a emitir → PP gerada → enviada. O formulário
 * é inteiro e editável, e o rodapé tem "Salvar" (guarda a PP a emitir para
 * depois) e "Gerar PP" (salva, fecha e o painel do item abre a revisão
 * antes de gerar). A PP gerada não se edita mais; o envio ao financeiro,
 * com os documentos, fica no painel. Job aguardando abertura ou devolvido
 * pelo financeiro só salva.
 *
 * Os anexos (decisão 152): área de arrastar, cartões brancos com o mais
 * novo em cima, tipo obrigatório que nasce vazio e, na NF, os dados dela
 * logo abaixo do arquivo. Aqui são opcionais; o envio cobra todos.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  X,
  AlertTriangle,
  Columns2,
  Pencil,
  Plus,
} from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import { cn, formatCurrency, formatDocumento } from "@/lib/utils";
import {
  PP_URGENTE_JUSTIFICATIVA_MIN,
  type Fornecedor,
  type PPAEmitir,
} from "@/lib/types";
import {
  valorDaPPPorUnidade,
  parcelasFecham,
  passaDoPlanejado,
} from "@/lib/calculos/pps-item";
import {
  ParcelasDaPPField,
  montarParcelas,
  parcelasDaPPGravada,
  problemaDasParcelas,
  redividirParcelas,
  trocarDatas,
  type ParcelaLocal,
} from "./parcelas-da-pp";
import {
  ehJanelaDePagamento,
  hojeEmSaoPauloIso,
  isoParaBr,
  primeiraJanelaComEnvioAberto,
  vencimentoAceitaEnvio,
  vencimentosNasJanelas,
} from "@/lib/calculos/janelas-pagamento";
import { carregarFornecedor } from "@/app/(app)/fornecedores/actions";
import {
  reservarPedidoCompra,
  salvarPPAEmitir,
  prefixoAnexosPPAEmitir,
  signedUrlAnexoAEmitir,
} from "./actions-pp";
import { ConferenciaDosDocumentos } from "./conferencia-dos-documentos";
import {
  ExigidosNoEnvio,
  ListaDeAnexos,
  NfDoAnexo,
  ResumoDasNfs,
  ZonaDeAnexos,
  anexoEmEdicao,
  anexoParaEnvio,
  itensDaLista,
  notaExistenteDe,
  parteDaNf,
  useAnexosEmEdicao,
  useNotasExistentes,
  type TomadorDaNf,
} from "./anexos-da-pp";
import { textoAguardaAbertura } from "./pp-a-emitir-ui";
import {
  AvisoPrazoDeEnvioPerdido,
  AvisoPrazoForaDaJanela,
  UrgenciaPPField,
  diaForaDaJanela,
} from "./prazo-e-urgencia-pp";
import { EnvioAte, useFeriadosNacionais } from "./prazo-de-envio-pp";
import { NovoFornecedorDialog } from "@/app/(app)/fornecedores/novo-fornecedor-dialog";
import type { FornecedorResumo } from "@/app/(app)/fornecedores/actions";
import {
  PAGAMENTO_PELO_CADASTRO,
  PagamentoDaPPField,
  estadoDoPagamento,
  pagamentoParaEnvio,
  problemaDoPagamento,
  type PagamentoDaPPEstado,
} from "./pagamento-da-pp-field";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{
    id: string;
    nome: string;
    razao_social: string | null;
    /** Segunda linha da opção e chave de busca (09/09/2026). */
    cpf_cnpj?: string | null;
  }>;
  /** As empresas gerenciais: só o nome da do job aparece (decisão 156). */
  empresas: Array<{ id: string; razao_social: string; nome_fantasia: string | null; principal: boolean }>;
  /** Membros ativos do tenant — exibidos quando switch Verba de Produção está ON. */
  responsaveis: Array<{ id: string; nome: string }>;
  /** `cadastros.fornecedores.editar`. Sem ela, o "+" e o lápis somem: a
   *  action já barrava, mas o GP preenchia o cadastro inteiro para só
   *  então ler "Você não tem permissão para essa ação" (18/09/2026). */
  podeCadastrarFornecedor?: boolean;
  podeEditarFornecedor?: boolean;
  defaultEmpresaId: string;
  itemDescricao: string;
  /** PLANEJADO do item — a referência da PP desde 02/09/2026 (era o
   *  orçado). É contra ele que "Em PPs emitidas" acende em vermelho. */
  valorPlanejado: number;
  /** Decomposição do planejado — R$ Unit. × QT × D/M, para o cartão
   *  mostrar de onde os três campos vêm. São referência apenas: os
   *  campos da PP nascem vazios (decisão do Tiago, 01/09/2026). */
  unitarioPlanejado: number;
  quantidadePlanejada: number;
  dmPlanejado: number;
  /** O que o item já tem em PPs — todas menos as canceladas, a gerada
   *  inclusive (decisão 074). Na GERAÇÃO a prévia do cartão soma esta PP
   *  por cima; na EDIÇÃO ela já está aqui dentro e o valor antigo é
   *  descontado antes. Sem teto: passar do planejado não impede gerar —
   *  muda quem pode enviar. */
  emPPsEmitidas: number;
  /** PP a emitir sendo editada. Null = uma nova (decisão 153: a PP
   *  gerada não se edita mais). */
  aEmitirEditando: PPAEmitir | null;
  /** O item já está marcado como "todas as PPs geradas"? */
  itemConcluido: boolean;
  /** O status do job: aguardando abertura e devolvido só salvam. */
  statusDoJob: string;
  /** Decisão 152: os CNPJs tomadores da NF e o de cada empresa emissora. */
  tomadores: TomadorDaNf[];
  tomadorPorEmpresa: Record<string, string>;
  /** Decisão 156: o CNPJ que a PP nova já traz escolhido (regional do job →
   *  empresa gerencial → principal). A lista de "Empresa emissora" são os
   *  CNPJs (`tomadores`); a empresa gerencial é a do job. */
  cnpjPadraoDaPP: string | null;
  /** "salva": guardou a PP a emitir. "revisar": guardou e o painel abre a
   *  revisão antes de gerar (o "Gerar PP"). */
  onSuccess?: (modo: "salva" | "revisar", id: string) => void;
}

/** O teto do servidor (decisão 077, pergunta 7a): 1 a 6 nos botões e
 *  "Mais de 6…" até 24. */
const MAX_PARCELAS = 24;

/** A primeira janela de pagamento que ainda aceita envio hoje (decisão
 *  157): até 07/10/2026 era a primeira janela depois de hoje (decisão
 *  077), e antes disso hoje + 15 dias. */
function defaultPrazoPagamento(feriados: string[] = []): string {
  return primeiraJanelaComEnvioAberto(hojeEmSaoPauloIso(), feriados);
}

function dateToIso(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

/** Fator (QT, D/M) sem zeros à direita: "2", não "2,000". */
function formatFator(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Dinheiro sem o "R$" — a moeda já está no rótulo da coluna. */
function formatUnitario(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Aceita "1.234,56" e "1234.56", como o resto das grades do sistema. */
function parseNumeroLocal(bruto: string): number {
  const s = bruto.trim();
  if (s === "") return 0;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

export function GerarPPDrawer({
  open,
  onOpenChange,
  itemRealizadoId,
  jobId,
  fornecedores,
  empresas,
  responsaveis,
  podeCadastrarFornecedor = false,
  podeEditarFornecedor = false,
  defaultEmpresaId,
  itemDescricao,
  valorPlanejado,
  unitarioPlanejado,
  quantidadePlanejada,
  dmPlanejado,
  emPPsEmitidas,
  itemConcluido,
  aEmitirEditando,
  statusDoJob,
  tomadores,
  cnpjPadraoDaPP,
  onSuccess,
}: Props) {
  const editando = aEmitirEditando !== null;
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [ppId, setPpId] = React.useState<string | null>(null);
  const [uploadPrefix, setUploadPrefix] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  // Switch Verba de Produção: OFF (default) → fornecedor obrigatório;
  // ON → responsável interno obrigatório, fornecedor escondido.
  const [verbaProducao, setVerbaProducao] = React.useState(false);
  const [fornecedorId, setFornecedorId] = React.useState<string>("");
  // Pagamento fora do cadastro (decisão 127). Trocar de fornecedor volta
  // para o cadastro: a chave ou a conta digitada era do anterior.
  const [pagamento, setPagamento] =
    React.useState<PagamentoDaPPEstado>(PAGAMENTO_PELO_CADASTRO);
  const [faltaPagamento, setFaltaPagamento] = React.useState(false);
  // Cadastro rápido de fornecedor (04/09/2026, decisão 048). O combo vem
  // do server component, então o fornecedor que acabou de nascer só
  // chegaria nele depois do `router.refresh()`; enquanto isso ele mora
  // aqui, mesclado à lista — igual ao projeto novo da abertura.
  const [novoFornecedorOpen, setNovoFornecedorOpen] = React.useState(false);
  /** Id do fornecedor que o LÁPIS abriu para revisão. Null = cadastro novo. */
  const [fornecedorEditando, setFornecedorEditando] = React.useState<
    string | null
  >(null);
  /** O que foi digitado na busca quando ela não achou ninguém — o cadastro
   *  abre com o nome já preenchido. */
  const [nomeSugerido, setNomeSugerido] = React.useState("");
  const [fornecedorNovo, setFornecedorNovo] =
    React.useState<FornecedorResumo | null>(null);
  const fornecedoresVisiveis = React.useMemo(() => {
    if (!fornecedorNovo || fornecedores.some((f) => f.id === fornecedorNovo.id)) {
      return fornecedores;
    }
    return [...fornecedores, fornecedorNovo].sort((a, b) =>
      (a.razao_social ?? a.nome).localeCompare(b.razao_social ?? b.nome),
    );
  }, [fornecedores, fornecedorNovo]);

  /** As opções do combo: nome em cima, documento embaixo — e a busca do
   *  Combobox olha os dois (09/09/2026). */
  const itensFornecedor = React.useMemo(
    () =>
      fornecedoresVisiveis.map((f) => ({
        value: f.id,
        label: f.razao_social ?? f.nome,
        descricao: f.cpf_cnpj ? formatDocumento(f.cpf_cnpj) : undefined,
      })),
    [fornecedoresVisiveis],
  );

  /** O cadastro completo que o lápis abre. Carregado sob demanda: a lista
   *  do drawer traz só o necessário para escolher. */
  const [fornecedorParaEditar, setFornecedorParaEditar] =
    React.useState<Fornecedor | null>(null);
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
        setErro(res.message);
        setNovoFornecedorOpen(false);
        setFornecedorEditando(null);
      }
    });
    return () => {
      vivo = false;
    };
  }, [fornecedorEditando]);

  // A seleção entra em dois tempos, de propósito. O Select do Radix
  // espelha o valor num <select> nativo escondido, e se o valor e a
  // <option> nova chegam na mesma renderização o nativo ainda não tem a
  // opção: ele volta pra "" e dispara `onValueChange("")`, apagando a
  // escolha (visto em 04/09/2026). Então primeiro o fornecedor entra na
  // lista, e só quando ele já está lá o efeito abaixo seleciona.
  const [fornecedorPendenteId, setFornecedorPendenteId] =
    React.useState<string | null>(null);
  React.useEffect(() => {
    if (!fornecedorPendenteId) return;
    if (fornecedoresVisiveis.some((f) => f.id === fornecedorPendenteId)) {
      setFornecedorId(fornecedorPendenteId);
      setPagamento(PAGAMENTO_PELO_CADASTRO);
      setFornecedorPendenteId(null);
    }
  }, [fornecedorPendenteId, fornecedoresVisiveis]);

  /** Selecionar um fornecedor que pode não estar na lista do server
   *  ainda (o recém-criado, ou o existente achado pelo documento). */
  function adotarFornecedor(f: FornecedorResumo) {
    if (!fornecedores.some((x) => x.id === f.id)) setFornecedorNovo(f);
    setFornecedorPendenteId(f.id);
    // Sem `router.refresh()` aqui, de propósito: o refresh no meio do
    // preenchimento re-renderiza a página inteira e zerava o formulário
    // (visto em 04/09/2026). A lista mesclada segura o fornecedor novo
    // até o drawer fechar — e o fechamento já dispara o refresh.
  }
  // "Esta é a última PP deste item?" — obrigatória (decisão 052). Null é
  // "ainda não respondeu", e é o que segura o botão de gerar.
  const [ultimaPP, setUltimaPP] = React.useState<boolean | null>(null);
  const [faltaResposta, setFaltaResposta] = React.useState(false);
  /** A pergunta agora rola com o formulário: quem tenta gerar sem
   *  responder precisa ser levado até ela (17/09/2026). */
  const refUltimaPP = React.useRef<HTMLDivElement>(null);
  const [responsavelId, setResponsavelId] = React.useState<string>("");
  // A empresa GERENCIAL é a do job (decisão 156): não se escolhe aqui.
  const [empresaId, setEmpresaId] = React.useState<string>(defaultEmpresaId);
  // O CNPJ da PP — a "Empresa emissora" do formulário (decisão 156).
  const [cnpjId, setCnpjId] = React.useState<string>(cnpjPadraoDaPP ?? "");
  const [prazoPagamento, setPrazoPagamento] = React.useState<string>(defaultPrazoPagamento());
  // Prazo de envio (decisão 157): os feriados nacionais chegam depois do
  // primeiro render. O ref deixa a abertura do formulário usar a lista
  // sem refazer o formulário quando ela chega.
  const feriados = useFeriadosNacionais();
  const feriadosRef = React.useRef(feriados);
  feriadosRef.current = feriados;
  // Descrição e quantidade abrem VAZIAS desde 17/08/2026: com PPs
  // parciais, herdar o nome e a quantidade do item induzia a pedir o item
  // inteiro para um fornecedor só, que é o oposto do que a tela faz.
  const [servico, setServico] = React.useState<string>("");
  const [especificacoes, setEspecificacoes] = React.useState<string>("");
  // O trio que define o valor da PP, espelhando as colunas do item na
  // planilha (01/09/2026). Nascem VAZIOS de propósito: preenchidos com o
  // orçado, induziriam a pedir o item inteiro a um fornecedor só, que é o
  // oposto do que a tela de PPs parciais faz. A decomposição do orçado
  // fica no cartão de cima, como referência do que digitar.
  const [unitario, setUnitario] = React.useState<string>("");
  const [quantidade, setQuantidade] = React.useState<string>("");
  const [dm, setDm] = React.useState<string>("");
  // Parcelas: sempre ao menos uma, e a primeira acompanha o "Prazo de
  // pagamento" — ela É o prazo, não uma linha extra.
  const [parcelas, setParcelas] = React.useState<ParcelaLocal[]>([]);
  /** "Mais de 6…" escolhido: o número passa a ser digitado (7 a 24). */
  const [maisDeSeis, setMaisDeSeis] = React.useState(false);
  const [parcelasTexto, setParcelasTexto] = React.useState("7");
  /** Prazo gravado da PP em edição: a data anterior à regra das janelas
   *  pode continuar como está (decisão 077, pergunta 6a). */
  const [prazoOriginal, setPrazoOriginal] = React.useState<string | null>(null);
  // Pagamento urgente (decisão 077).
  const [urgente, setUrgente] = React.useState(false);
  const [justificativa, setJustificativa] = React.useState("");
  const [faltaJustificativa, setFaltaJustificativa] = React.useState(false);
  // Decisão 152: os anexos com tipo, número e, na NF, os dados dela. O
  // CNPJ tomador sugerido é o CNPJ da PP (decisão 156).
  const tomadorPadrao = cnpjId || null;
  const nomeDoCnpj = tomadores.find((t) => t.id === cnpjId)?.nome ?? "o CNPJ da PP";
  const {
    anexos,
    setAnexos,
    subir,
    remover,
    mudar,
    mudarNf,
    aviso: avisoDosAnexos,
    setAviso: setAvisoDosAnexos,
  } = useAnexosEmEdicao(uploadPrefix, tomadorPadrao);
  const existentes = useNotasExistentes(
    verbaProducao ? null : fornecedorId || null,
    anexos.filter((a) => a.tipo === "nota_fiscal").map((a) => a.nf.numero),
    ppId,
  );
  /** Os documentos lado a lado (decisão 153, entrega 3), abertos num
   *  documento. Sem o PDF da PP: a PP a emitir ainda não tem. */
  const [ladoALado, setLadoALado] = React.useState<{ foco: string | null } | null>(null);
  React.useEffect(() => {
    if (!open) setLadoALado(null);
  }, [open]);
  /** A PP rejeitada que esta PP a emitir refaz, com o motivo (decisão 153). */
  const refaz = aEmitirEditando?.refaz ?? null;
  const travaDaAbertura = textoAguardaAbertura(statusDoJob);
  const abortedRef = React.useRef(false);
  // Lock sincrono contra double-submit: `pending` do useTransition ativa
  // 1 render depois, então dois cliques rápidos passam pelo disabled=pending.
  // Ref é setado ANTES do await → segundo click no mesmo tick é bloqueado.
  const submittingRef = React.useRef(false);

  // Chave para forcar remontagem do DatePicker ao reabrir o drawer
  const [drawerKey, setDrawerKey] = React.useState(0);

  // Reset ao abrir — e SÓ ao abrir. A chave diz qual sessão do
  // formulário está de pé (item + gerar/editar); enquanto ela não muda,
  // nenhum re-render do pai mexe no que a pessoa digitou. Antes o
  // efeito dependia de props que trocam de identidade num
  // `router.refresh()`, e o formulário zerava no meio do caminho
  // (04/09/2026).
  const chaveSessao = open
    ? `${itemRealizadoId ?? ""}|${aEmitirEditando?.id ?? "nova"}`
    : null;
  const sessaoRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || !itemRealizadoId) {
      sessaoRef.current = null;
      return;
    }
    if (sessaoRef.current === chaveSessao) return;
    sessaoRef.current = chaveSessao;
    abortedRef.current = false;
    setErro(null);
    setPpId(null);
    setFornecedorPendenteId(null);
    setFaltaResposta(false);
    setFaltaPagamento(false);
    // A PP a emitir volta com a resposta que foi salva; a nova pergunta do
    // zero (a que refaz uma rejeitada também: o item pode ter mudado).
    setUltimaPP(aEmitirEditando?.ultima_pp_do_item ?? null);
    setUploadPrefix(null);
    setAnexos([]);
    setAvisoDosAnexos(null);
    setDrawerKey((k) => k + 1);
    setFaltaJustificativa(false);

    if (aEmitirEditando) {
      // A PP a emitir abre inteira, como foi salva (decisão 153).
      const d = aEmitirEditando.dados;
      setVerbaProducao(d.verba_producao);
      setFornecedorId(d.fornecedor_id ?? "");
      setPagamento(
        estadoDoPagamento(
          d.pagamento_fora_do_cadastro ? { ...d.pagamento_fora_do_cadastro, banco_nome: null } : null,
        ),
      );
      setResponsavelId(d.responsavel_verba_id ?? "");
      setEmpresaId(d.empresa_id);
      setCnpjId(d.estabelecimento_id ?? cnpjPadraoDaPP ?? "");
      setPrazoPagamento(d.prazo_pagamento.slice(0, 10));
      setPrazoOriginal(d.prazo_pagamento.slice(0, 10));
      setUrgente(d.urgente === true);
      setJustificativa(d.urgente_justificativa ?? "");
      const parcelasSalvas = Math.max(d.parcelas.length, 1);
      setMaisDeSeis(parcelasSalvas > 6);
      setParcelasTexto(String(Math.max(parcelasSalvas, 7)));
      setServico(d.servico);
      setUnitario(formatUnitario(Number(d.valor_unitario)));
      setQuantidade(formatFator(Number(d.quantidade)));
      setDm(formatFator(Number(d.dias_meses)));
      setEspecificacoes(d.especificacoes ?? "");
      // O % de cada parcela se refaz do R$ salvo (decisão 138).
      setParcelas(
        d.parcelas.length > 1
          ? parcelasDaPPGravada(d.parcelas, aEmitirEditando.valor)
          : [],
      );
      setAnexos(
        aEmitirEditando.anexos.map((a) =>
          anexoEmEdicao(a, d.estabelecimento_id ?? cnpjPadraoDaPP ?? null),
        ),
      );
      setPpId(aEmitirEditando.id);
      (async () => {
        const res = await prefixoAnexosPPAEmitir(aEmitirEditando.id);
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        setUploadPrefix(res.upload_prefix);
      })();
      return;
    }

    setVerbaProducao(false);
    setFornecedorId("");
    setPagamento(PAGAMENTO_PELO_CADASTRO);
    setResponsavelId("");
    setEmpresaId(defaultEmpresaId);
    setCnpjId(cnpjPadraoDaPP ?? "");
    setPrazoPagamento(defaultPrazoPagamento(feriadosRef.current));
    setPrazoOriginal(null);
    setUrgente(false);
    setJustificativa("");
    setMaisDeSeis(false);
    setParcelasTexto("7");
    setServico("");
    setUnitario("");
    setQuantidade("");
    setDm("");
    setEspecificacoes("");
    setParcelas([]);

    // Reserva pp_id + upload_prefix
    (async () => {
      const res = await reservarPedidoCompra(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPpId(res.pp_id);
      setUploadPrefix(res.upload_prefix);
    })();
    // A chave resume as deps que importam; as demais (defaultEmpresaId,
    // a PP a emitir inteira) só seriam relidas numa sessão nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemRealizadoId, chaveSessao]);

  // DESABILITADO — o cleanup automatico estava disparando entre upload e
  // finalizar (quando ppId mudava por qualquer re-render), apagando os
  // anexos que o user acabou de subir. Arquivos orfaos ficam no bucket ate
  // cancelamento explicito. Aceitavel no MVP; job de limpeza noturno futuro.
  //
  // React.useEffect(() => {
  //   return () => {
  //     if (!ppId || abortedRef.current) return;
  //     abortarReserva(ppId, jobId).catch(() => {});
  //   };
  // }, [ppId, jobId]);

  // ---- Valor da PP: R$ Unit. × QT × D/M ----
  // A PP é montada como a linha da planilha. Os três fatores são do GP —
  // nenhum é derivado do planejado, então o unitário pode ser o desconto
  // que o fornecedor deu. Nada limita o valor (02/09/2026): o teto por PP
  // saiu. Passar do planejado não impede gerar — no envio, pede o
  // responsável do job ou administrador, com confirmação.
  const unitNum = parseNumeroLocal(unitario);
  const qtdNum = parseNumeroLocal(quantidade);
  const dmNum = parseNumeroLocal(dm);
  const valorPP = valorDaPPPorUnidade(unitNum, qtdNum, dmNum);
  // Prévia de "Em PPs emitidas" com esta PP. A PP a emitir não está na
  // base (decisão 153): ela só conta no item quando for gerada.
  const previaEmPPs = Math.round((emPPsEmitidas + valorPP) * 100) / 100;
  const passaPlanejado = valorPP > 0 && passaDoPlanejado(previaEmPPs, valorPlanejado);

  const numeroDeParcelas = Math.max(parcelas.length, 1);

  /**
   * Trocar o número de parcelas refaz a escada: datas derivadas da janela
   * do 1º vencimento, mês a mês (decisão 077, pergunta 5a), e divisão
   * igual. As datas não se editam uma a uma — o que move a escada é o
   * prazo.
   */
  function mudarNumeroDeParcelas(bruto: number) {
    const n = Math.max(1, Math.min(MAX_PARCELAS, Math.floor(bruto) || 1));
    if (n === 1) {
      setParcelas([]);
      return;
    }
    // Mesmo número: nada muda, e os valores já ajustados ficam.
    if (n === parcelas.length) return;
    setParcelas(montarParcelas(vencimentosNasJanelas(prazoPagamento, n), valorPP));
  }

  function mudarPrazo(iso: string) {
    setPrazoPagamento(iso);
    if (parcelas.length > 0) {
      // Mover a 1ª data reconstrói a escada: as seguintes acompanham. A
      // divisão fica (decisão 138) — antes ela voltava a ser igual.
      setParcelas((prev) => trocarDatas(prev, vencimentosNasJanelas(iso, prev.length)));
    }
  }

  // Um handler por campo do trio: cada um refaz a conta com o valor novo
  // do seu campo e os dois já digitados nos outros. `unitNum`/`qtdNum`/
  // `dmNum` são do render atual, então não há estado atrasado aqui. As
  // parcelas mantêm o % de cada uma (decisão 138); `valorPP` ainda é o
  // valor de antes da mudança.
  function mudarUnitario(bruto: string) {
    setUnitario(bruto);
    const novo = valorDaPPPorUnidade(parseNumeroLocal(bruto), qtdNum, dmNum);
    setParcelas((prev) => redividirParcelas(prev, valorPP, novo));
  }

  function mudarQuantidade(bruto: string) {
    setQuantidade(bruto);
    const novo = valorDaPPPorUnidade(unitNum, parseNumeroLocal(bruto), dmNum);
    setParcelas((prev) => redividirParcelas(prev, valorPP, novo));
  }

  function mudarDm(bruto: string) {
    setDm(bruto);
    const novo = valorDaPPPorUnidade(unitNum, qtdNum, parseNumeroLocal(bruto));
    setParcelas((prev) => redividirParcelas(prev, valorPP, novo));
  }

  /** O que vai para a action: PP sem parcelamento manda 1 parcela. */
  function parcelasParaEnvio(): Array<{ data_vencimento: string; valor: number }> {
    if (parcelas.length === 0) {
      return [{ data_vencimento: prazoPagamento, valor: valorPP }];
    }
    return parcelas.map((p) => ({
      data_vencimento: p.data_vencimento,
      valor: parseNumeroLocal(p.valor),
    }));
  }

  const hoje = hojeEmSaoPauloIso();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Dois botões no mesmo formulário: quem diz qual foi é o `submitter`.
    // Enter num campo usa o primeiro, "Salvar" — o seguro.
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const gerar = submitter?.getAttribute("data-acao") === "gerar";
    if (gerar && travaDaAbertura) {
      setErro(travaDaAbertura);
      return;
    }
    // A data salva que perdeu o prazo de envio ainda se salva, mas não gera
    // PP (decisão 157) — o servidor diria o mesmo na revisão.
    if (gerar && !vencimentoAceitaEnvio(prazoPagamento, hoje, feriados)) {
      setErro(
        `O prazo de envio do vencimento ${isoParaBr(prazoPagamento)} já passou. Escolha outra data para gerar a PP.`,
      );
      return;
    }
    if (!validar()) return;
    salvar(gerar);
  }

  /** As checagens do formulário. Devolve false e escreve o erro. */
  function validar(): boolean {
    setErro(null);
    if (!ppId || !itemRealizadoId) return false;
    if (verbaProducao && !responsavelId) {
      setErro("Escolha um responsável.");
      return false;
    }
    if (ultimaPP === null) {
      setFaltaResposta(true);
      setErro("Responda se esta é a última PP deste item.");
      // `behavior` padrão (instantâneo): o suave depende de animação, e
      // animação não roda em aba fora do primeiro plano — o campo ficava
      // fora de vista com o erro na tela.
      refUltimaPP.current?.scrollIntoView({ block: "center" });
      return false;
    }
    if (!verbaProducao && !fornecedorId) {
      setErro("Escolha um fornecedor.");
      return false;
    }
    if (!verbaProducao) {
      const problema = problemaDoPagamento(pagamento);
      if (problema) {
        setFaltaPagamento(true);
        setErro(problema);
        return false;
      }
    }
    if (!cnpjId) {
      setErro("Escolha a empresa emissora (o CNPJ da PP).");
      return false;
    }
    if (!prazoPagamento) {
      setErro("Prazo de pagamento é obrigatório.");
      return false;
    }
    if (!servico.trim()) {
      setErro("Serviço é obrigatório.");
      return false;
    }
    if (unitNum <= 0) {
      setErro("R$ Unit. deve ser um número positivo.");
      return false;
    }
    if (qtdNum <= 0) {
      setErro("QT deve ser um número positivo.");
      return false;
    }
    if (dmNum <= 0) {
      setErro("D/M deve ser um número positivo.");
      return false;
    }
    if (valorPP <= 0) {
      setErro("O valor desta PP ficaria zerado. Confira R$ Unit., QT e D/M.");
      return false;
    }
    const parcelasEnvio = parcelasParaEnvio();
    if (parcelasEnvio.some((p) => !p.data_vencimento)) {
      setErro("Toda parcela precisa de uma data de vencimento.");
      return false;
    }
    const problemaParcelas = problemaDasParcelas(parcelas, valorPP);
    if (problemaParcelas) {
      setErro(problemaParcelas);
      return false;
    }
    if (!parcelasFecham(parcelasEnvio.map((p) => p.valor), valorPP)) {
      setErro(
        `A soma das parcelas precisa fechar com o valor da PP (${formatCurrency(valorPP, "BRL")}).`,
      );
      return false;
    }
    // O anexo deixou de travar a geração (02/09/2026): a PP pode nascer
    // sem nota e ficar no job. Quem exige a NF é o envio ao financeiro,
    // no painel do item. Verba de Produção segue sem anexo nos dois
    // momentos — é adiantamento, e as notas entram na prestação de contas.
    if (anexos.some((a) => a.status === "uploading" || a.status === "selecionado")) {
      setErro("Aguarde os uploads terminarem antes de continuar.");
      return false;
    }

    if (urgente && justificativa.trim().length < PP_URGENTE_JUSTIFICATIVA_MIN) {
      setFaltaJustificativa(true);
      setErro(
        `Justifique o pagamento urgente (mín. ${PP_URGENTE_JUSTIFICATIVA_MIN} caracteres).`,
      );
      return false;
    }
    // O calendário já só acende janelas; isto cobre a data digitada por
    // outro caminho. O servidor checa de novo.
    if (
      prazoPagamento !== prazoOriginal &&
      (prazoPagamento < hoje || !ehJanelaDePagamento(prazoPagamento))
    ) {
      setErro(
        "O prazo de pagamento precisa ser uma janela a partir de hoje: dia 08 ou 20 — caindo em fim de semana, na segunda-feira seguinte.",
      );
      return false;
    }
    if (prazoPagamento !== prazoOriginal && !vencimentoAceitaEnvio(prazoPagamento, hoje, feriados)) {
      setErro(
        `O prazo de envio do vencimento ${isoParaBr(prazoPagamento)} já passou: o financeiro recebe a PP até 15 dias antes da janela. A primeira data possível hoje é ${isoParaBr(primeiraJanelaComEnvioAberto(hoje, feriados))}.`,
      );
      return false;
    }
    return true;
  }

  /** Salva a PP a emitir. Com `gerar`, o painel abre a revisão dela. */
  function salvar(gerar: boolean) {
    if (!ppId || !itemRealizadoId || ultimaPP === null) return;
    const parcelasEnvio = parcelasParaEnvio();

    // Lock síncrono contra double-submit (pending do useTransition ativa 1
    // render depois — clique duplo rápido passa pelo disabled=pending).
    if (submittingRef.current) return;
    submittingRef.current = true;

    startTransition(async () => {
      try {
        const dadosBase = {
          empresa_id: empresaId,
          estabelecimento_id: cnpjId || null,
          prazo_pagamento: prazoPagamento,
          servico: servico.trim(),
          valor_unitario: unitNum,
          quantidade: qtdNum,
          dias_meses: dmNum,
          especificacoes: especificacoes.trim() || null,
          urgente,
          urgente_justificativa: urgente ? justificativa.trim() : null,
          parcelas: parcelasEnvio,
        };
        const dados = verbaProducao
          ? {
              ...dadosBase,
              verba_producao: true as const,
              responsavel_verba_id: responsavelId,
              fornecedor_id: null,
            }
          : {
              ...dadosBase,
              verba_producao: false as const,
              fornecedor_id: fornecedorId,
              responsavel_verba_id: null,
              pagamento_fora_do_cadastro: pagamentoParaEnvio(pagamento),
            };
        const res = await salvarPPAEmitir(
          ppId,
          itemRealizadoId,
          dados,
          // Verba de produção não leva anexo: as notas vão na prestação.
          verbaProducao ? [] : anexos.filter((a) => a.status === "ok").map(anexoParaEnvio),
          ultimaPP,
        );
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        // Sucesso: fecha e o efeito abaixo pede o refresh fora da transição.
        abortedRef.current = true;
        onSuccess?.(gerar ? "revisar" : "salva", res.id);
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  // Detecta sucesso e dispara refresh FORA do startTransition principal
  // (via ref pra evitar dep instável no useEffect).
  React.useEffect(() => {
    if (!open) {
      // Se drawer fechou por sucesso (abortedRef=true), refresh a página
      // pra pegar a nova PP e os ícones Ver/Cancelar aparecerem na trilha.
      if (abortedRef.current) {
        router.refresh();
      }
    }
  }, [open, router]);

  if (!open || !itemRealizadoId) return null;

  /** Os campos da NF de um arquivo — na lista e, `compacta`, na coluna da
   *  tela lado a lado. */
  function camposDaNf(id: string, compacta: boolean) {
    const a = anexos.find((x) => x.id === id);
    if (!a) return null;
    return (
      <NfDoAnexo
        nf={a.nf}
        onMudar={(parte) => mudarNf(id, parte)}
        faltas={[]}
        idBase={`${compacta ? "conferencia" : "pp-nf"}-${id}`}
        tomadores={tomadores}
        tomadorEsperado={cnpjId || null}
        empresaNome={nomeDoCnpj}
        existente={notaExistenteDe(existentes, a.nf.numero)}
        valorPP={valorPP}
        compacta={compacta}
        disabled={pending}
        anexoPath={a.path || null}
        anexoMimetype={a.mime}
        fornecedores={fornecedores}
        fornecedorAtualId={fornecedorId || null}
        fornecedorAtualNome={fornecedores.find((f) => f.id === fornecedorId)?.nome ?? null}
        servicoAtual={servico}
        onUsarDescricao={(d) => setServico(d)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>
            {editando
              ? `Editar PP a emitir${refaz ? ` · refaz a ${refaz.codigo}` : ""}`
              : "Novo Pedido de Produção"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 space-y-4 p-6 overflow-y-auto">
            {/* Refazendo uma PP rejeitada: o motivo no topo (decisão 153). */}
            {refaz && (
              <div className="rounded-xl border border-california-red/30 bg-california-red/5 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-california-red">
                  Refazendo a <span className="font-mono">{refaz.codigo}</span>, rejeitada pelo financeiro
                </p>
                <p className="mt-1 text-[12.5px] leading-snug text-foreground">
                  {refaz.motivo_rejeicao || "— sem motivo informado"}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                  A <span className="font-mono">{refaz.codigo}</span> já está cancelada. Corrija o que precisar e gere a
                  PP nova, com outro código.
                </p>
              </div>
            )}
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="font-medium">{itemDescricao}</p>
              {/* Duas colunas, como no design de 02/09/2026: a referência
                  do item virou o PLANEJADO (era o orçado), e o "Máximo
                  aceito" deu lugar à prévia de "Em PPs emitidas" com esta
                  PP — sem teto, ela só avisa quando passa do planejado. */}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Planejado do item</p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(valorPlanejado, "BRL")}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatUnitario(unitarioPlanejado)} ×{" "}
                    {formatFator(quantidadePlanejada)} ×{" "}
                    {formatFator(dmPlanejado)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Em PPs emitidas</p>
                  <p
                    className={cn(
                      "font-mono font-semibold",
                      passaPlanejado && "text-california-red",
                    )}
                  >
                    {formatCurrency(previaEmPPs, "BRL")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    com esta PP · sem teto por PP
                  </p>
                </div>
              </div>
            </div>

            {/* Fornecedor & Empresa */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fornecedor & Empresa
              </h3>

              {/* Switch Verba de Produção */}
              <label className="flex cursor-pointer items-center gap-2.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={verbaProducao}
                  onClick={() => {
                    setVerbaProducao((v) => {
                      if (!v) setFornecedorId(""); // vai ligar: limpa fornecedor
                      else setResponsavelId("");   // vai desligar: limpa responsável
                      return !v;
                    });
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors",
                    verbaProducao ? "bg-california-red" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                      verbaProducao ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
                <span className="text-sm font-medium">Verba de Produção</span>
                {verbaProducao && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Pago ao responsável interno
                  </span>
                )}
              </label>

              {/* Valor desta PP — as mesmas colunas do item na planilha.
                  Fica logo abaixo do switch porque primeiro se decide se é
                  verba de produção, depois quanto vale a PP: quando o prazo
                  de pagamento é escolhido, o dinheiro já está definido. */}
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Valor desta PP
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    mesmas colunas do item na planilha
                  </span>
                </div>

                <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] gap-2.5">
                  <div>
                    <label className="text-xs font-medium">R$ Unit. *</label>
                    <Input
                      value={unitario}
                      onChange={(e) => mudarUnitario(e.target.value)}
                      className="no-spinner text-right font-mono font-semibold"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">QT *</label>
                    <Input
                      value={quantidade}
                      onChange={(e) => mudarQuantidade(e.target.value)}
                      className="no-spinner text-right font-mono font-semibold"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">D/M *</label>
                    <Input
                      value={dm}
                      onChange={(e) => mudarDm(e.target.value)}
                      className="no-spinner text-right font-mono font-semibold"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="flex items-end justify-between gap-4 border-t border-border pt-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      Valor desta PP
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {valorPP > 0
                        ? `${formatUnitario(unitNum)} × ${formatFator(qtdNum)} × ${formatFator(dmNum)}`
                        : "preencha os três campos"}
                    </p>
                  </div>
                  <span className="font-mono text-[22px] font-bold leading-none">
                    {valorPP > 0 ? formatCurrency(valorPP, "BRL") : "—"}
                  </span>
                </div>

                {/* O aviso mora aqui, ao vivo. Não barra: passar do
                    planejado muda quem pode ENVIAR, não se dá para gerar. */}
                {passaPlanejado && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none text-amber-700" />
                    <span className="text-[11px] leading-relaxed text-amber-900">
                      Com esta PP o item passa do planejado. Ela é gerada do
                      mesmo jeito — o <strong>envio ao financeiro</strong>{" "}
                      pedirá confirmação do responsável do job ou de um
                      administrador.
                    </span>
                  </div>
                )}
              </div>

              {/* Decisão 156: a "Empresa emissora" é o CNPJ da PP — sai no
                  PDF e é contra ele que o fornecedor emite a nota. A empresa
                  gerencial vem do job e não se escolhe. Desde a decisão 161
                  ela vem ANTES do fornecedor (pedido do Tiago, 09/10/2026):
                  primeiro quem contrata, depois quem recebe. */}
              <div>
                <label className="text-xs font-medium">Empresa emissora *</label>
                <Select value={cnpjId || undefined} onValueChange={setCnpjId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o CNPJ" />
                  </SelectTrigger>
                  <SelectContent>
                    {tomadores.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nome} · <span className="font-mono">{t.cnpj}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  A nota do fornecedor vem neste CNPJ. Empresa gerencial do job:{" "}
                  {(() => {
                    const g = empresas.find((e) => e.id === empresaId);
                    return g ? (g.nome_fantasia ?? g.razao_social) : "—";
                  })()}
                  .
                </p>
              </div>

              {/* Fornecedor (modo normal) ou Responsável (modo verba) */}
              {verbaProducao ? (
                <div>
                  <label className="text-xs font-medium">Responsável *</label>
                  <Combobox
                    items={responsaveis.map((r) => ({
                      value: r.id,
                      label: r.nome,
                    }))}
                    value={responsavelId || null}
                    onChange={(v) => setResponsavelId(v ?? "")}
                    placeholder="Escolha um responsável"
                    buscaPlaceholder="Escreva o nome"
                    className={COMBOBOX_COMO_SELECT}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium">Fornecedor *</label>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      {/* Combo com busca desde 09/09/2026 (desenho "PP -
                          Campo Fornecedor"): a lista passou de dezenas de
                          nomes, e rolar um Select para achar um deles
                          custava mais que digitar. Procura por nome E por
                          documento, que é o que separa homônimos. */}
                      <Combobox
                        items={itensFornecedor}
                        value={fornecedorId || null}
                        onChange={(v) => {
                          setFornecedorId(v ?? "");
                          setPagamento(PAGAMENTO_PELO_CADASTRO);
                          setFaltaPagamento(false);
                        }}
                        placeholder="Escolha o fornecedor"
                        buscaPlaceholder="Escreva o nome ou o documento"
                        limpavel
                        acaoSemResultado={
                          podeCadastrarFornecedor
                            ? {
                                rotulo: (busca) =>
                                  `Cadastrar “${busca}” como novo fornecedor`,
                                onClick: (busca) => {
                                  setNomeSugerido(busca);
                                  setFornecedorEditando(null);
                                  setNovoFornecedorOpen(true);
                                },
                              }
                            : undefined
                        }
                      />
                    </div>
                    {/* O MESMO botão, dois papéis: "+" cadastra sem sair
                        da PP (decisão 048); com um fornecedor escolhido
                        ele vira o lápis e abre o cadastro dele para
                        revisão. O ✕ de dentro do campo é o caminho de
                        volta para o "+".

                        São duas permissões diferentes (18/09/2026): criar
                        aqui é `cadastros.fornecedores.inline`, que o GP e
                        o produtor têm porque a PP é o fluxo deles; abrir
                        para editar é `cadastros.fornecedores.editar`, do
                        administrador e do financeiro. Por isso o gate segue o
                        papel do botão, e não o botão. */}
                    {(fornecedorId ? podeEditarFornecedor : podeCadastrarFornecedor) && (
                    <button
                      type="button"
                      onClick={() => {
                        setNomeSugerido("");
                        setFornecedorEditando(
                          fornecedorId ? fornecedorId : null,
                        );
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
                      className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50"
                    >
                      {fornecedorId ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Plus className="h-[17px] w-[17px]" />
                      )}
                    </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    {fornecedorId
                      ? podeEditarFornecedor
                        ? "O lápis abre o cadastro deste fornecedor. O ✕ limpa o campo e traz o + de volta."
                        : "O ✕ limpa o campo. Revisar o cadastro de um fornecedor é com o administrador."
                      : podeCadastrarFornecedor
                      ? "Escreva para buscar na lista. O + cadastra um fornecedor novo sem sair da PP."
                      : "Escreva para buscar na lista. Cadastro de fornecedor é com o administrador."}
                  </p>
                  {fornecedorId && (
                    <div className="mt-3">
                      <PagamentoDaPPField
                        fornecedorId={fornecedorId}
                        valor={pagamento}
                        onChange={setPagamento}
                        destacarFalta={faltaPagamento}
                        disabled={pending}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Prazo e Parcelas dividem a linha: o prazo é o vencimento
                  da 1ª parcela, e o seletor ao lado diz em quantas vezes o
                  fornecedor recebe. Desde 14/09/2026 os dois obedecem às
                  janelas de pagamento (decisão 077). */}
              <div className="grid grid-cols-[190px_1fr] gap-3">
                <div>
                  <label className="text-xs font-medium">Prazo de pagamento *</label>
                  <DatePicker
                    key={`prazo-${drawerKey}`}
                    name="prazo_pagamento"
                    defaultValue={prazoPagamento}
                    onDateChange={(date) => mudarPrazo(dateToIso(date))}
                    dateDisabled={diaForaDaJanela(hoje, prazoOriginal, feriados)}
                  />
                  <EnvioAte vencimento={prazoPagamento} feriados={feriados} />
                </div>
                <div>
                  <span className="text-xs font-medium">Parcelas</span>
                  <div
                    role="radiogroup"
                    aria-label="Parcelas"
                    className="flex h-11 items-center gap-1.5"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => {
                      const ativo = !maisDeSeis && numeroDeParcelas === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={ativo}
                          onClick={() => {
                            setMaisDeSeis(false);
                            mudarNumeroDeParcelas(n);
                          }}
                          disabled={pending}
                          className={cn(
                            "h-9 w-9 flex-none rounded-lg border font-mono text-[13px] font-semibold transition-colors disabled:opacity-50",
                            ativo
                              ? "border-foreground bg-foreground text-white"
                              : "border-border bg-white hover:bg-muted/60",
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={maisDeSeis}
                      onClick={() => {
                        setMaisDeSeis(true);
                        if (numeroDeParcelas < 7) {
                          setParcelasTexto("7");
                          mudarNumeroDeParcelas(7);
                        } else {
                          setParcelasTexto(String(numeroDeParcelas));
                        }
                      }}
                      disabled={pending}
                      className={cn(
                        "h-9 flex-none rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                        maisDeSeis
                          ? "border-foreground bg-foreground text-white"
                          : "border-border bg-white hover:bg-muted/60",
                      )}
                    >
                      Mais de 6…
                    </button>
                    {maisDeSeis && (
                      <Input
                        aria-label={`Número de parcelas (7 a ${MAX_PARCELAS})`}
                        value={parcelasTexto}
                        onChange={(e) => {
                          const texto = e.target.value.replace(/\D/g, "").slice(0, 2);
                          setParcelasTexto(texto);
                          const n = Number(texto);
                          if (n >= 7 && n <= MAX_PARCELAS) mudarNumeroDeParcelas(n);
                        }}
                        onBlur={() => {
                          const n = Math.max(
                            7,
                            Math.min(MAX_PARCELAS, Number(parcelasTexto) || 7),
                          );
                          setParcelasTexto(String(n));
                          mudarNumeroDeParcelas(n);
                        }}
                        className="no-spinner h-9 w-14 text-center font-mono"
                        inputMode="numeric"
                      />
                    )}
                  </div>
                  {maisDeSeis && (
                    <p className="text-[11px] text-muted-foreground">
                      De 7 a {MAX_PARCELAS} parcelas.
                    </p>
                  )}
                </div>
              </div>
              <AvisoPrazoForaDaJanela prazo={prazoPagamento} original={prazoOriginal} />
              <AvisoPrazoDeEnvioPerdido prazo={prazoPagamento} hojeIso={hoje} feriados={feriados} />

              {parcelas.length > 1 && (
                <ParcelasDaPPField
                  parcelas={parcelas}
                  setParcelas={setParcelas}
                  valorPP={valorPP}
                  disabled={pending}
                />
              )}

              <UrgenciaPPField
                urgente={urgente}
                justificativa={justificativa}
                onUrgenteChange={(ligado) => {
                  setUrgente(ligado);
                  if (!ligado) setFaltaJustificativa(false);
                }}
                onJustificativaChange={setJustificativa}
                destacarFalta={faltaJustificativa}
                disabled={pending}
              />
            </div>

            {/* Servico */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Serviço
              </h3>

              <div>
                <label className="text-xs font-medium">Descrição do serviço *</label>
                <Input
                  value={servico}
                  onChange={(e) => setServico(e.target.value)}
                  maxLength={500}
                />
              </div>

              {/* QT saiu daqui: era o mesmo número do bloco de valor, em
                  dois campos distantes um do outro. Serviço fica só com
                  descrição e especificações. */}
              <div>
                <label className="text-xs font-medium">Especificações (opcional)</label>
                <textarea
                  value={especificacoes}
                  onChange={(e) => setEspecificacoes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded border border-border p-2 text-sm"
                />
              </div>
            </div>

            {/* Anexos (decisões 152 e 153): opcionais para salvar e gerar,
                obrigatórios no envio ao financeiro. Verba de produção segue
                sem anexo: as notas entram na prestação de contas. */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {verbaProducao
                  ? "Anexos (não exigidos na verba de produção)"
                  : "Anexos (obrigatórios para o envio ao financeiro)"}
              </h3>
              {verbaProducao ? (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Verba de produção é adiantamento: a PP sai antes de existir nota e as notas entram na prestação de
                  contas.
                </p>
              ) : (
                <>
                  {/* Decisão 153, entrega 3: os documentos lado a lado, como
                      no Contas a Pagar. */}
                  {anexos.length > 0 && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setLadoALado({ foco: itensDaLista(anexos)[0]?.id ?? null })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                      >
                        <Columns2 className="h-3.5 w-3.5" />
                        Ver documentos lado a lado
                      </button>
                    </div>
                  )}
                  {/* Decisão 161: paga por boleto, o envio exige o boleto e a nota. */}
                  {pagamento.escolha === "boleto" && <ExigidosNoEnvio anexos={anexos} />}
                  <ZonaDeAnexos id="pp-arquivos" pronto={!!uploadPrefix} onArquivos={subir} />
                  {avisoDosAnexos && (
                    <p className="text-[11.5px] font-semibold text-california-red">{avisoDosAnexos}</p>
                  )}
                  <ListaDeAnexos
                    itens={itensDaLista(anexos)}
                    onTipo={(id, t) => mudar(id, { tipo: t })}
                    onNumero={(id, numero) => mudar(id, { numero })}
                    onRemover={remover}
                    tipoInvalido={() => false}
                    disabled={pending}
                    onVer={(id) => setLadoALado({ foco: id })}
                    renderNf={(id) => camposDaNf(id, false)}
                  />
                  <ResumoDasNfs
                    valores={anexos
                      .filter((a) => a.status === "ok" && a.tipo === "nota_fiscal")
                      .map((a) => parteDaNf(a.nf))}
                    valorPP={valorPP}
                  />
                </>
              )}
            </div>
            {/* A pergunta que fecha (ou mantém aberto) o item. Ela não é
                sobre esta PP: é sobre o ITEM, e é o que troca a base da
                previsão de custo dele no fluxo de caixa (decisão 052).

                Desde 17/09/2026 ela ROLA com o resto do formulário em vez
                de ficar presa acima dos botões: continua obrigatória, com
                as mesmas regras, e quem tenta gerar sem responder é levado
                até ela. */}
            <div
              ref={refUltimaPP}
              className="flex scroll-mt-4 flex-col gap-2 border-t border-border pt-4"
            >
              <span className="text-xs font-medium">
                Esta é a última PP deste item? *
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { valor: false, rotulo: "Não, ainda faltam PPs" },
                  { valor: true, rotulo: "Sim, é a última" },
                ].map((opcao) => {
                  const escolhida = ultimaPP === opcao.valor;
                  return (
                    <button
                      key={opcao.rotulo}
                      type="button"
                      role="radio"
                      aria-checked={escolhida}
                      onClick={() => {
                        setUltimaPP(opcao.valor);
                        setFaltaResposta(false);
                      }}
                      disabled={pending}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors disabled:opacity-50",
                        escolhida && opcao.valor
                          ? "border-emerald-600 bg-emerald-50"
                          : escolhida
                            ? "border-foreground bg-muted"
                            : faltaResposta
                              ? "border-california-red bg-white"
                              : "border-border bg-white hover:bg-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full border-[1.5px]",
                          escolhida
                            ? opcao.valor
                              ? "border-emerald-700"
                              : "border-foreground"
                            : "border-[#C9C4B8]",
                        )}
                      >
                        <span
                          className={cn(
                            "h-[7px] w-[7px] rounded-full",
                            escolhida
                              ? opcao.valor
                                ? "bg-emerald-700"
                                : "bg-foreground"
                              : "bg-transparent",
                          )}
                        />
                      </span>
                      {opcao.rotulo}
                    </button>
                  );
                })}
              </div>
              {/* A mensagem de erro do formulário fica no topo, e depois da
                  rolagem até aqui ela some de vista: quem tenta gerar sem
                  responder via só a borda vermelha, sem o motivo
                  (17/09/2026). */}
              {faltaResposta && (
                <span className="text-[11.5px] font-semibold text-california-red">
                  Responda se esta é a última PP deste item.
                </span>
              )}
              <span className="text-[11px] leading-snug text-muted-foreground">
                {ultimaPP === true
                  ? `A previsão de custo deste item deixa de usar o planejado (${formatCurrency(valorPlanejado, "BRL")}) e passa a valer o que as PPs dizem (${formatCurrency(previaEmPPs, "BRL")}).`
                  : "Enquanto houver PP por vir, a previsão de custo do item segue pelo planejado."}
              </span>
            </div>

          </div>

          {/* Salvar guarda a PP a emitir; Gerar PP salva e o painel abre a
              revisão antes de gerar (Tiago, 06/10/2026). Os dois são de
              todos que abrem o formulário; com o job na pré-abertura, só
              Salvar, e a frase diz por quê. */}
          <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-acao="salvar"
                disabled={
                  pending ||
                  !ppId ||
                  anexos.some((a) => a.status === "uploading") ||
                  (verbaProducao ? !responsavelId : !fornecedorId)
                }
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50",
                  travaDaAbertura
                    ? "bg-california-red text-white hover:bg-california-red-hover"
                    : "border border-border bg-white hover:bg-accent",
                )}
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="submit"
                data-acao="gerar"
                disabled={
                  pending ||
                  !ppId ||
                  travaDaAbertura !== null ||
                  anexos.some((a) => a.status === "uploading") ||
                  (verbaProducao ? !responsavelId : !fornecedorId)
                }
                title={travaDaAbertura ?? undefined}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold",
                  travaDaAbertura
                    ? "cursor-not-allowed border border-border bg-muted text-muted-foreground/70"
                    : "bg-california-red text-white hover:bg-california-red-hover disabled:opacity-50",
                )}
              >
                Gerar PP
              </button>
            </div>
            <p className="flex items-start justify-end gap-1.5 text-right text-[11px] leading-snug text-muted-foreground">
              {travaDaAbertura && <AlertTriangle className="mt-0.5 h-3 w-3 flex-none text-amber-600" />}
              {travaDaAbertura ??
                "“Salvar” guarda a PP a emitir para editar depois; “Gerar PP” salva e mostra a revisão antes de gerar. O envio ao financeiro é no painel do item."}
            </p>
          </div>
        </form>

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
          onCriado={adotarFornecedor}
          onSelecionarExistente={adotarFornecedor}
          // A edição não mexe na escolha: o fornecedor continua o mesmo,
          // com o cadastro atualizado. O refresh do form já recarrega a
          // lista do servidor.
          onSalvo={() => {
            setFornecedorEditando(null);
            router.refresh();
          }}
        />
        {/* Decisão 153, entrega 3: os documentos e os dados lado a lado. O
            estado é o deste formulário. */}
        {!verbaProducao && (
          <ConferenciaDosDocumentos
            open={ladoALado !== null}
            onOpenChange={(o) => !o && setLadoALado(null)}
            codigo="PP a emitir"
            selo={editando ? "Em edição" : "Nova"}
            descricao="Documentos e dados — lado a lado. O PDF da PP aparece aqui depois de gerar."
            ppIdDoPdf={null}
            anexos={anexos}
            focar={ladoALado?.foco ?? null}
            urlDoGravado={signedUrlAnexoAEmitir}
            prontoParaAnexar={!!uploadPrefix}
            onArquivos={subir}
            onTipo={(id, t) => mudar(id, { tipo: t })}
            onNumero={(id, numero) => mudar(id, { numero })}
            onRemover={remover}
            renderNf={(id) => camposDaNf(id, true)}
            mostrarFaltas={false}
            obrigatorio={false}
            valorPP={valorPP}
            moeda="BRL"
            aviso={avisoDosAnexos}
            onFecharAviso={() => setAvisoDosAnexos(null)}
            rodapeEsquerda="Para salvar e gerar, os anexos são opcionais; no envio ao financeiro, todos os campos são obrigatórios."
            rodape={
              <button
                type="button"
                onClick={() => setLadoALado(null)}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-white/90"
              >
                Voltar ao formulário
              </button>
            }
            disabled={pending}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}
