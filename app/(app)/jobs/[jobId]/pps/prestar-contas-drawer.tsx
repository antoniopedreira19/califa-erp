"use client";

/**
 * Prestar contas da verba — e corrigir a prestação reprovada (decisões 081
 * e 189).
 *
 * Abre pela trilha da aba de PPs e pelo cartão da verba no "PPs" da
 * Planilha Interna. Desde a 189 (versão A do protótipo aprovado em
 * 19/10/2026, "Junta e envia no fim"):
 *
 * - cada documento fica salvo no banco assim que entra, e os campos se
 *   salvam a cada pausa da digitação. Vale desde que a PP foi enviada ao
 *   financeiro, mesmo antes do pagamento;
 * - nada vai ao financeiro até o envio único, que só libera com a verba
 *   paga. O financeiro aprova ou reprova a prestação inteira; reprovada, os
 *   documentos voltam para cá e se corrigem no lugar;
 * - os 7 tipos do sistema, cada um com os seus campos
 *   (`lib/calculos/prestacao-da-verba.ts`). Boleto e contrato não têm valor
 *   e não somam no comprovado;
 * - "Não houve gasto" continua: a prestação vai sem documento, e a verba
 *   volta inteira.
 *
 * A leitura do documento por IA fica para depois (com a da decisão 178).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  documentoTipoLabel,
  nomeDeQuemRecebeAVerba,
  rotuloDaVerba,
  rotuloDeQuemRecebeAVerba,
  tipoDaVerba,
  type DocumentoTipo,
  type PPAnexoMimetype,
  type PedidoCompraNaLista,
} from "@/lib/types";
import {
  TIPOS_DA_PRESTACAO,
  camposDoDocumento,
  faltasDoDocumento,
  formatarCpfCnpj,
  producaoEditaPrestacao,
  rotuloDoDocumento,
  somaComprovadaEmCentavos,
  tipoSomaNoComprovado,
  type CampoDoDocumento,
  type CamposDoDocumento,
} from "@/lib/calculos/prestacao-da-verba";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { producaoEditaNfDaAuditoria } from "@/lib/calculos/midia-system";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import {
  BarraDoComprovado,
  SeloDoDocumento,
  situacaoDoDocumento,
} from "@/components/financeiro/prestacao-da-verba";
import type { TomadorDaNf } from "../realizado/anexos-da-pp";
import {
  enviarPrestacaoVerba,
  linkDocumentoPrestacao,
  prefixoUploadPrestacao,
  removerDocumentoPrestacao,
  salvarDocumentoPrestacao,
} from "./actions-prestacao";

const BUCKET = "pedidos-compra";
/** A pausa da digitação que salva o documento. */
const ESPERA_PARA_SALVAR = 700;

const rotulo = "text-[11px] font-medium text-muted-foreground";
const altura = "h-8 px-2 text-xs";
const VERMELHO = "border-california-red ring-2 ring-california-red/15";

interface DocLocal {
  /** Chave local; vira o id quando o documento é salvo. */
  chave: string;
  id: string | null;
  nome: string;
  tamanho: number;
  mimetype: string;
  /** Caminho no Storage do arquivo que subiu e ainda não foi salvo. */
  path: string | null;
  arquivo: "subindo" | "ok" | "erro";
  campos: CamposDoDocumento;
  salvo: "salvo" | "pendente" | "salvando" | "erro";
  mensagem: string | null;
}

function sanitizeName(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const isoDoDia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CAMPOS_VAZIOS: CamposDoDocumento = {
  documento_tipo: null,
  documento_numero: "",
  documento_data: "",
  valor: null,
  tomador_estabelecimento_id: null,
  emitente_documento: "",
  emitente_nome: "",
  descricao: "",
};

export function PrestarContasDrawer({
  open,
  onOpenChange,
  pp,
  tomadores,
  podeEditar,
  onSuccess,
  fornecedor,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  pp: PedidoCompraNaLista | null;
  /** Os CNPJs tomadores da NF e da fatura (cadastro de impostos). */
  tomadores: TomadorDaNf[];
  /** O papel presta contas desta verba (decisões 164 e 171). Sem ele, a
   *  gaveta só mostra. */
  podeEditar: boolean;
  onSuccess: (mensagem: string) => void;
  /** Decisão 216: o fornecedor da PP que foi sem NF na auditoria da Mídia
   *  System — nome na gaveta e emitente da NF já preenchido. `null` na
   *  verba (não tem fornecedor). */
  fornecedor: { nome: string; razao_social: string | null; cpf_cnpj: string | null } | null;
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();
  const [prefixo, setPrefixo] = React.useState<string | null>(null);
  const [docs, setDocs] = React.useState<DocLocal[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const [tentouEnviar, setTentouEnviar] = React.useState(false);
  /** "Não houve gasto": vai sem documento, e a verba volta inteira. */
  const [semGasto, setSemGasto] = React.useState(false);
  const docsRef = React.useRef<DocLocal[]>([]);
  docsRef.current = docs;
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** O que está indo ao servidor agora, por documento — o envio espera. */
  const salvando = React.useRef(new Map<string, Promise<void>>());
  /** Algo mudou no banco: a página se atualiza quando a gaveta fecha. */
  const mudouRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  /** A PP aberta, para o que roda fora do render (salvar ao fechar). */
  const ppIdRef = React.useRef<string | null>(null);
  if (pp) ppIdRef.current = pp.id;

  // Decisão 216: a PP que foi sem NF presta contas da nota na mesma gaveta.
  const editavel = !!pp && podeEditar && (producaoEditaPrestacao(pp) || producaoEditaNfDaAuditoria(pp));

  const atualizar = React.useCallback((chave: string, mudanca: Partial<DocLocal>) => {
    setDocs((prev) => prev.map((d) => (d.chave === chave ? { ...d, ...mudanca } : d)));
  }, []);

  /** Salva os campos de um documento agora (um salvamento por vez, por
   *  documento: o segundo espera o primeiro, e lê o estado mais novo). */
  const salvarAgora = React.useCallback(
    async (chave: string): Promise<void> => {
      const anterior = salvando.current.get(chave);
      if (anterior) await anterior;
      const doc = docsRef.current.find((d) => d.chave === chave);
      const ppId = ppIdRef.current;
      if (!doc?.id || !ppId) return;
      const id = doc.id;
      const promessa = (async () => {
        atualizar(chave, { salvo: "salvando", mensagem: null });
        const res = await salvarDocumentoPrestacao({
          pp_id: ppId,
          documento: { id, ...doc.campos },
        });
        mudouRef.current = true;
        // Se a pessoa digitou de novo enquanto salvava, o próximo
        // salvamento já está agendado: o estado fica "pendente".
        const agendado = timers.current.has(chave);
        atualizar(
          chave,
          res.ok
            ? { salvo: agendado ? "pendente" : "salvo", mensagem: null }
            : { salvo: "erro", mensagem: res.message },
        );
      })();
      salvando.current.set(chave, promessa);
      try {
        await promessa;
      } finally {
        if (salvando.current.get(chave) === promessa) salvando.current.delete(chave);
      }
    },
    [atualizar],
  );

  // Cada abertura começa do que a PP tem no banco. Chaveado no id, e não
  // no objeto, para um refresh do pai não zerar o que a pessoa digitou.
  React.useEffect(() => {
    if (!open || !pp) return;
    setErro(null);
    setTentouEnviar(false);
    setPrefixo(null);
    setSemGasto(pp.prestacao?.status === "reprovada" && pp.prestacao.documentos.length === 0);
    setDocs(
      (pp.prestacao?.documentos ?? []).map((d) => ({
        chave: d.id,
        id: d.id,
        nome: d.arquivo_nome_original,
        tamanho: d.arquivo_tamanho_bytes,
        mimetype: d.arquivo_mimetype,
        path: null,
        arquivo: "ok" as const,
        campos: {
          ...camposDoDocumento(d),
          emitente_documento: formatarCpfCnpj(d.emitente_documento),
        },
        salvo: "salvo" as const,
        mensagem: null,
      })),
    );
    if (!podeEditar || !(producaoEditaPrestacao(pp) || producaoEditaNfDaAuditoria(pp))) return;
    let vivo = true;
    (async () => {
      const res = await prefixoUploadPrestacao(pp.id);
      if (!vivo) return;
      if (res.ok) setPrefixo(res.prefixo);
      else setErro(res.message);
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pp?.id]);

  // Fechar com um campo ainda por salvar: salva antes de sair, e só depois
  // atualiza a página (o botão da trilha, o cartão do painel).
  React.useEffect(() => {
    if (open) return;
    const chaves = [...timers.current.keys()];
    for (const chave of chaves) {
      clearTimeout(timers.current.get(chave));
      timers.current.delete(chave);
    }
    void (async () => {
      await Promise.all([...chaves.map((c) => salvarAgora(c)), ...salvando.current.values()]);
      if (mudouRef.current) {
        mudouRef.current = false;
        router.refresh();
      }
    })();
  }, [open, router, salvarAgora]);

  if (!open || !pp) return null;
  const ppAtual = pp;
  const prestacao = ppAtual.prestacao;
  const reprovada = prestacao?.status === "reprovada";
  // Decisão 216: a PP que foi sem NF na auditoria da Mídia System presta
  // contas da nota. Muda só o que é da verba: valor da PP e fornecedor no
  // lugar de verba e titular, sem "Não houve gasto" nem saldo a devolver, e
  // o envio não espera o pagamento.
  const ehMidia = ppAtual.sem_nf_na_auditoria && !ppAtual.verba_producao;
  const paga = ppAtual.status === "pago" || ehMidia;
  const situacao = situacaoDoDocumento(prestacao?.status ?? null);

  const validos = docs.filter((d) => d.arquivo === "ok");
  const gastoCentavos = semGasto
    ? 0
    : somaComprovadaEmCentavos(validos.map((d) => ({ documento_tipo: d.campos.documento_tipo, valor: d.campos.valor })));
  const verbaCentavos = Math.round(Number(ppAtual.valor) * 100);
  const saldoCentavos = verbaCentavos - gastoCentavos;
  const passouDaVerba = saldoCentavos < 0;
  const reais = (centavos: number) => formatCurrency(centavos / 100, "BRL");
  const ocupado = docs.some((d) => d.arquivo === "subindo" || d.salvo === "salvando");
  const tomadorPadrao =
    ppAtual.estabelecimento_id && tomadores.some((t) => t.id === ppAtual.estabelecimento_id)
      ? ppAtual.estabelecimento_id
      : null;

  function mudarCampos(chave: string, campos: Partial<CamposDoDocumento>) {
    setDocs((prev) =>
      prev.map((d) => {
        if (d.chave !== chave) return d;
        const novos = { ...d.campos, ...campos };
        // A NF e a fatura saem contra o CNPJ da PP (decisão 156): o tomador
        // já vem escolhido.
        if (
          campos.documento_tipo &&
          (campos.documento_tipo === "nota_fiscal" || campos.documento_tipo === "fatura") &&
          !novos.tomador_estabelecimento_id
        ) {
          novos.tomador_estabelecimento_id = tomadorPadrao;
        }
        // Na PP da auditoria o emitente da NF é o fornecedor da PP: vem
        // preenchido, e se troca se a nota vier de outro CNPJ.
        if (ehMidia && fornecedor && campos.documento_tipo === "nota_fiscal" && !novos.emitente_documento) {
          novos.emitente_documento = formatarCpfCnpj(fornecedor.cpf_cnpj);
          novos.emitente_nome = fornecedor.razao_social ?? fornecedor.nome;
        }
        if (campos.documento_tipo && !tipoSomaNoComprovado(campos.documento_tipo)) novos.valor = null;
        return { ...d, campos: novos, salvo: "pendente" };
      }),
    );
    const t = timers.current.get(chave);
    if (t) clearTimeout(t);
    timers.current.set(
      chave,
      setTimeout(() => {
        timers.current.delete(chave);
        void salvarAgora(chave);
      }, ESPERA_PARA_SALVAR),
    );
  }

  async function salvarPendentes() {
    const chaves = [...timers.current.keys()];
    for (const chave of chaves) {
      clearTimeout(timers.current.get(chave));
      timers.current.delete(chave);
    }
    await Promise.all([...chaves.map((c) => salvarAgora(c)), ...salvando.current.values()]);
  }

  async function adicionarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!prefixo) {
      setErro("Aguarde: a preparação ainda não terminou. Tente de novo em 2 segundos.");
      return;
    }
    let soma = docs.reduce((s, d) => s + d.tamanho, 0);
    const novos: DocLocal[] = [];
    const arquivos = new Map<string, File>();
    for (const file of Array.from(files)) {
      const chave = crypto.randomUUID();
      arquivos.set(chave, file);
      const base: DocLocal = {
        chave,
        id: null,
        nome: file.name,
        tamanho: file.size,
        mimetype: file.type,
        path: null,
        arquivo: "erro",
        campos: CAMPOS_VAZIOS,
        salvo: "salvo",
        mensagem: null,
      };
      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        novos.push({ ...base, mensagem: "Formato não aceito — use PDF, JPG, PNG ou WEBP." });
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        novos.push({ ...base, mensagem: "Acima de 8 MB." });
        continue;
      }
      if (soma + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({ ...base, mensagem: "Os documentos passariam de 25 MB juntos." });
        continue;
      }
      soma += file.size;
      novos.push({ ...base, path: `${prefixo}${chave}-${sanitizeName(file.name)}`, arquivo: "subindo" });
    }
    setDocs((prev) => [...prev, ...novos]);
    if (inputRef.current) inputRef.current.value = "";

    // Um de cada vez, na ordem: a ordem da prestação é a de entrada.
    for (const n of novos) {
      const file = arquivos.get(n.chave);
      if (n.arquivo !== "subindo" || !n.path || !file) continue;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(n.path, file, { contentType: file.type, upsert: false });
      if (error) {
        atualizar(n.chave, { arquivo: "erro", mensagem: "O arquivo não subiu. Remova e tente de novo." });
        continue;
      }
      const res = await salvarDocumentoPrestacao({
        pp_id: ppAtual.id,
        documento: {
          id: null,
          path: n.path,
          nome_original: n.nome,
          tamanho_bytes: n.tamanho,
          mimetype: n.mimetype,
          ...CAMPOS_VAZIOS,
        },
      });
      if (!res.ok) {
        await supabase.storage.from(BUCKET).remove([n.path]);
        atualizar(n.chave, { arquivo: "erro", path: null, mensagem: res.message });
        continue;
      }
      mudouRef.current = true;
      atualizar(n.chave, { id: res.id, arquivo: "ok", path: null, salvo: "salvo" });
    }
  }

  async function remover(doc: DocLocal) {
    const t = timers.current.get(doc.chave);
    if (t) clearTimeout(t);
    timers.current.delete(doc.chave);
    if (!doc.id) {
      setDocs((prev) => prev.filter((p) => p.chave !== doc.chave));
      if (doc.path) await supabase.storage.from(BUCKET).remove([doc.path]);
      return;
    }
    const pendente = salvando.current.get(doc.chave);
    if (pendente) await pendente;
    const res = await removerDocumentoPrestacao({ pp_id: ppAtual.id, documento_id: doc.id });
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    mudouRef.current = true;
    setDocs((prev) => prev.filter((p) => p.chave !== doc.chave));
  }

  async function abrir(id: string) {
    const res = await linkDocumentoPrestacao(id);
    if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
    else setErro(res.message);
  }

  function enviar() {
    setTentouEnviar(true);
    setErro(null);
    if (!paga) {
      setErro("O envio ao financeiro libera depois que a verba estiver paga. Os documentos ficam salvos até lá.");
      return;
    }
    if (!semGasto) {
      if (docs.some((d) => d.arquivo === "subindo")) {
        setErro("Aguarde os arquivos terminarem de subir.");
        return;
      }
      if (docs.some((d) => d.arquivo === "erro")) {
        setErro("Remova os arquivos que não subiram antes de enviar.");
        return;
      }
      if (validos.length === 0) {
        setErro(ehMidia ? "Anexe a NF do fornecedor." : "Anexe ao menos um documento — ou marque “Não houve gasto”.");
        return;
      }
      if (ehMidia && !validos.some((d) => d.campos.documento_tipo === "nota_fiscal")) {
        setErro("Anexe a NF do fornecedor, com o tipo NF.");
        return;
      }
      const incompleto = validos.find((d) => faltasDoDocumento(d.campos).length > 0);
      if (incompleto) {
        setErro(`Complete o documento “${incompleto.nome}” antes de enviar: os campos em vermelho faltam.`);
        return;
      }
      if (gastoCentavos <= 0) {
        setErro(
          "Anexe ao menos um documento que comprove gasto — NF, recibo, fatura, cupom fiscal ou outro. Boleto e contrato acompanham a compra, mas não somam.",
        );
        return;
      }
      if (passouDaVerba) {
        setErro(
          ehMidia
            ? `As NFs somam ${reais(gastoCentavos)}, acima do valor da PP (${reais(verbaCentavos)}). Em cada NF, informe só a parte desta PP.`
            : `Os documentos somam ${reais(gastoCentavos)}, acima da verba de ${reais(verbaCentavos)}. Retire documentos até fechar dentro da verba — o excedente precisa de uma PP nova.`,
        );
        return;
      }
    }
    startTransition(async () => {
      await salvarPendentes();
      if (docsRef.current.some((d) => d.salvo === "erro")) {
        setErro("Um documento não foi salvo. Corrija o campo indicado e tente de novo.");
        return;
      }
      const res = await enviarPrestacaoVerba({ pp_id: ppAtual.id, sem_gasto: semGasto });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      mudouRef.current = true;
      onSuccess(
        semGasto
          ? `Devolução total de ${res.codigo} enviada ao financeiro.`
          : res.reenvio
            ? `Prestação de ${res.codigo} corrigida e reenviada ao financeiro.`
            : `Prestação de ${res.codigo} enviada ao financeiro.`,
      );
      onOpenChange(false);
    });
  }

  const salvos = validos.length;
  const textoDoRodape = !editavel
    ? null
    : !paga
      ? "Verba ainda não paga: o envio libera depois do pagamento."
      : salvos === 0
        ? "Nada salvo ainda."
        : `${salvos === 1 ? "1 documento salvo" : `${salvos} documentos salvos`}. Nada vai ao financeiro até você enviar.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>
            {reprovada && editavel ? "Corrigir prestação" : editavel ? "Prestar contas" : "Prestação de contas"} ·{" "}
            <span className="font-mono">{ppAtual.codigo}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {erro && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span className="flex-1">{erro}</span>
                <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {reprovada && prestacao?.motivo_reprovacao && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-[12px]">
                <p className="font-semibold text-california-red">
                  Reprovada pelo financeiro
                  {prestacao.reprovada_em ? ` · ${formatDiaBr(prestacao.reprovada_em)}` : ""}
                  {prestacao.reprovada_por_nome ? `, ${prestacao.reprovada_por_nome}` : ""}
                </p>
                <p className="mt-0.5 text-foreground/80">“{prestacao.motivo_reprovacao}”</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Os documentos voltaram para você. Troque o que precisa e reenvie.
                </p>
              </div>
            )}
            {prestacao?.status === "em_avaliacao" && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-[12px] text-yellow-900">
                <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span>A prestação está com o financeiro. Ela volta para você se for reprovada.</span>
              </div>
            )}
            {prestacao?.status === "aprovada" && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span>
                  Prestação aprovada{prestacao.aprovada_em ? ` em ${formatDiaBr(prestacao.aprovada_em)}` : ""}.
                  {ppAtual.devolucao
                    ? ` O saldo de ${formatCurrency(ppAtual.devolucao.valor, "BRL")} volta pelo estorno de verba.`
                    : " Sem saldo a devolver."}
                </span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div>
                {/* Decisão 164: o tipo da verba, e quem a recebe. */}
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {ehMidia ? "Valor da PP" : rotuloDaVerba(tipoDaVerba(ppAtual) ?? "producao")}
                </p>
                <p className="font-mono text-[13px] font-bold">{formatCurrency(Number(ppAtual.valor), "BRL")}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Paga em</p>
                <p className={cn("font-mono text-[13px] font-bold", !paga && "font-sans font-semibold text-muted-foreground")}>
                  {paga ? formatDiaBr(ppAtual.pago_em) : "Ainda não paga"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {ehMidia ? "Fornecedor" : rotuloDeQuemRecebeAVerba(ppAtual)}
                </p>
                <p className="truncate text-[13px] font-semibold">{ehMidia ? (fornecedor?.nome ?? "—") : (nomeDeQuemRecebeAVerba(ppAtual) ?? "—")}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border px-4 py-3">
              <BarraDoComprovado
                status={prestacao?.status ?? null}
                comprovado={gastoCentavos / 100}
                verba={Number(ppAtual.valor)}
                devolucao={ppAtual.devolucao}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {ehMidia ? "NF do fornecedor" : "Documentos do gasto"}
              </h3>
              {editavel && !ehMidia && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-white p-3">
                  <input
                    type="checkbox"
                    checked={semGasto}
                    onChange={(e) => {
                      setSemGasto(e.target.checked);
                      setErro(null);
                    }}
                    disabled={pending}
                    className="mt-0.5 h-4 w-4 flex-none accent-california-red"
                  />
                  <span className="text-[12.5px]">
                    <span className="font-semibold">Não houve gasto — a verba volta inteira</span>
                    <span className="block text-[11px] text-muted-foreground">
                      A prestação vai sem documento, e a aprovação cria o estorno de{" "}
                      {formatCurrency(Number(ppAtual.valor), "BRL")}.
                    </span>
                    {semGasto && docs.length > 0 && (
                      <span className="mt-1 block text-[11px] font-semibold text-amber-800">
                        {docs.length === 1
                          ? "O documento salvo sai da prestação ao enviar."
                          : `Os ${docs.length} documentos salvos saem da prestação ao enviar.`}
                      </span>
                    )}
                  </span>
                </label>
              )}
              {!semGasto && (
                <>
                  {docs.length === 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {prestacao && prestacao.status !== "rascunho"
                        ? "Sem gasto — a verba volta inteira, sem documento."
                        : "Nenhum documento ainda."}
                    </p>
                  )}
                  {docs.map((d, i) => (
                    <CartaoDoDocumento
                      key={d.chave}
                      d={d}
                      i={i}
                      editavel={editavel}
                      situacao={situacao}
                      tentou={tentouEnviar}
                      tomadores={tomadores}
                      bloqueado={pending}
                      onCampos={(c) => mudarCampos(d.chave, c)}
                      onRemover={() => void remover(d)}
                      onAbrir={() => d.id && void abrir(d.id)}
                      onSairDoCampo={() => {
                        // Saiu do campo: salva já, sem esperar a pausa.
                        const t = timers.current.get(d.chave);
                        if (!t) return;
                        clearTimeout(t);
                        timers.current.delete(d.chave);
                        void salvarAgora(d.chave);
                      }}
                    />
                  ))}

                  {editavel && (
                    <>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground transition-colors hover:border-california-red/40",
                          (pending || !prefixo) && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <Upload className="h-4 w-4" />
                        Anexar documentos · PDF, JPG, PNG ou WEBP, até 8 MB cada
                        <input
                          ref={inputRef}
                          type="file"
                          multiple
                          accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                          className="hidden"
                          disabled={pending || !prefixo}
                          onChange={(e) => void adicionarArquivos(e.target.files)}
                        />
                      </label>
                      <p className="text-[11px] text-muted-foreground">
                        Cada documento fica salvo assim que entra. Junte todos e envie de uma vez no fim.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="space-y-1.5 border-t border-border pt-3 text-[12.5px]">
              <div className="flex justify-between font-semibold">
                <span>{ehMidia ? "NFs anexadas" : "Gasto comprovado"}</span>
                <span className={cn("font-mono", passouDaVerba && "text-california-red")}>
                  {reais(gastoCentavos)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{ehMidia ? "Valor da PP" : "Verba"}</span>
                <span className="font-mono">{reais(verbaCentavos)}</span>
              </div>
              {passouDaVerba ? (
                <p className="text-[11.5px] text-california-red">
                  {ehMidia ? (
                    <>As NFs passam do valor da PP em {reais(-saldoCentavos)}. Em cada NF, informe só a parte desta PP.</>
                  ) : (
                    <>
                      O gasto passa da verba em {reais(-saldoCentavos)}. Retire documentos até fechar dentro da verba — o
                      excedente precisa de uma PP nova, que passa pela aprovação.
                    </>
                  )}
                </p>
              ) : ehMidia ? null : (
                <>
                  <div className="flex justify-between rounded-lg bg-teal-50 px-3 py-2 font-semibold text-teal-800">
                    <span>Saldo a devolver</span>
                    <span className="font-mono">{reais(saldoCentavos)}</span>
                  </div>
                  {saldoCentavos > 0 && editavel && (
                    <p className="text-[11px] text-muted-foreground">
                      Depois da aprovação, o saldo vira um estorno de verba de −{reais(saldoCentavos)} em Títulos a
                      Pagar, esperando o dinheiro voltar.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            {textoDoRodape && (
              <span className="mr-auto text-[11.5px] text-muted-foreground">{textoDoRodape}</span>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="whitespace-nowrap rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              Fechar
            </button>
            {editavel && (
              <button
                type="button"
                onClick={enviar}
                disabled={pending || !paga || passouDaVerba || ocupado}
                title={!paga ? "O envio libera depois que a verba estiver paga." : undefined}
                className="whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              >
                {pending
                  ? "Enviando…"
                  : reprovada
                    ? "Reenviar prestação ao financeiro"
                    : "Enviar prestação ao financeiro"}
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Um documento
// ---------------------------------------------------------------------------

function CartaoDoDocumento({
  d,
  i,
  editavel,
  situacao,
  tentou,
  tomadores,
  bloqueado,
  onCampos,
  onRemover,
  onAbrir,
  onSairDoCampo,
}: {
  d: DocLocal;
  i: number;
  editavel: boolean;
  situacao: ReturnType<typeof situacaoDoDocumento>;
  tentou: boolean;
  tomadores: TomadorDaNf[];
  bloqueado: boolean;
  onCampos: (c: Partial<CamposDoDocumento>) => void;
  onRemover: () => void;
  onAbrir: () => void;
  onSairDoCampo: () => void;
}) {
  const Icone = d.mimetype.startsWith("image/") ? ImageIcon : FileText;
  const faltas = tentou && editavel && d.arquivo === "ok" ? faltasDoDocumento(d.campos) : [];
  const idBase = `doc-${d.chave.slice(0, 8)}`;
  return (
    <div
      className={cn(
        "space-y-2.5 rounded-lg border bg-white p-3",
        d.arquivo === "erro" || d.salvo === "erro" ? "border-california-red/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <Icone className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        <span className="min-w-0 truncate text-[12px] font-semibold" title={d.nome}>
          {i + 1} · {d.nome}
        </span>
        <span className="flex-none text-[10.5px] text-muted-foreground">{formatarTamanho(d.tamanho)}</span>
        {d.id && (
          <button
            type="button"
            onClick={onAbrir}
            title="Abrir o documento"
            aria-label={`Abrir ${d.nome}`}
            className="flex-none text-muted-foreground hover:text-california-red"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
        <span className="flex-1" />
        {d.arquivo === "subindo" ? (
          <span className="inline-flex flex-none items-center gap-1 text-[10.5px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            subindo…
          </span>
        ) : d.arquivo === "ok" ? (
          <>
            {editavel && (d.salvo === "salvando" || d.salvo === "pendente") && (
              <span className="flex-none text-[10.5px] text-muted-foreground">salvando…</span>
            )}
            <SeloDoDocumento situacao={situacao} />
          </>
        ) : null}
        {editavel && (
          <button
            type="button"
            onClick={onRemover}
            disabled={bloqueado || d.arquivo === "subindo"}
            title="Remover documento"
            aria-label={`Remover ${d.nome}`}
            className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-california-red hover:bg-california-red/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {d.mensagem && (
        <p className="text-[11px] font-medium text-california-red">{d.mensagem}</p>
      )}

      {d.arquivo !== "ok" ? null : editavel ? (
        <>
          <div className="w-[180px]">
            <label htmlFor={`${idBase}-tipo`} className={rotulo}>
              Tipo do documento *
            </label>
            {/* Select do sistema: o menu do `<select>` nativo não aplica a
                escolha dentro de drawer (decisão 090). */}
            <Select
              value={d.campos.documento_tipo ?? undefined}
              onValueChange={(v) => onCampos({ documento_tipo: v as DocumentoTipo })}
              disabled={bloqueado}
            >
              <SelectTrigger
                id={`${idBase}-tipo`}
                aria-label={`Tipo do documento ${i + 1}`}
                className={cn(altura, faltas.includes("tipo") && VERMELHO)}
              >
                <SelectValue placeholder="Escolha o tipo" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DA_PRESTACAO.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {documentoTipoLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CamposDoDocumentoEditaveis
            campos={d.campos}
            faltas={faltas}
            idBase={idBase}
            tomadores={tomadores}
            bloqueado={bloqueado}
            onCampos={onCampos}
            onSairDoCampo={onSairDoCampo}
          />
          {!tipoSomaNoComprovado(d.campos.documento_tipo) && (
            <p className="text-[11px] text-muted-foreground">
              {documentoTipoLabel(d.campos.documento_tipo as DocumentoTipo)} acompanha a compra e não soma no
              comprovado — anexe também a NF, o cupom ou o recibo do gasto.
            </p>
          )}
        </>
      ) : (
        <ResumoDoDocumento campos={d.campos} />
      )}
    </div>
  );
}

function Campo({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={rotulo}>
        {titulo}
      </label>
      {children}
    </div>
  );
}

function CamposDoDocumentoEditaveis({
  campos: c,
  faltas,
  idBase,
  tomadores,
  bloqueado,
  onCampos,
  onSairDoCampo,
}: {
  campos: CamposDoDocumento;
  faltas: CampoDoDocumento[];
  idBase: string;
  tomadores: TomadorDaNf[];
  bloqueado: boolean;
  onCampos: (c: Partial<CamposDoDocumento>) => void;
  onSairDoCampo: () => void;
}) {
  const t = c.documento_tipo;
  const hoje = hojeEmSaoPauloIso();
  const marca = (campo: CampoDoDocumento) => faltas.includes(campo) && VERMELHO;

  const data = (titulo: string) => (
    <Campo id={`${idBase}-data`} titulo={titulo}>
      <DatePicker
        key={`${idBase}-data-${t}`}
        id={`${idBase}-data`}
        name={`${idBase}_data`}
        defaultValue={c.documento_data || undefined}
        placeholder="Selecione"
        onDateChange={(x) => onCampos({ documento_data: x ? isoDoDia(x) : "" })}
        dateDisabled={(x) => isoDoDia(x) > hoje}
        disabled={bloqueado}
        className={cn(altura, marca("data"))}
      />
    </Campo>
  );
  const valor = (titulo: string) => (
    <Campo id={`${idBase}-valor`} titulo={titulo}>
      <MoneyInput
        id={`${idBase}-valor`}
        value={c.valor && c.valor > 0 ? c.valor : null}
        onValueChange={(v) => onCampos({ valor: v > 0 ? v : null })}
        onBlur={onSairDoCampo}
        disabled={bloqueado}
        aria-label={titulo.replace(" *", "")}
        className={cn(altura, marca("valor"))}
      />
    </Campo>
  );
  const texto = (
    campo: "documento_numero" | "emitente_documento" | "emitente_nome" | "descricao",
    falta: CampoDoDocumento,
    titulo: string,
    o: { mono?: boolean; placeholder?: string; max?: number } = {},
  ) => (
    <Campo id={`${idBase}-${campo}`} titulo={titulo}>
      <Input
        id={`${idBase}-${campo}`}
        value={c[campo]}
        onChange={(ev) => onCampos({ [campo]: ev.target.value } as Partial<CamposDoDocumento>)}
        onBlur={(ev) => {
          if (campo === "emitente_documento") {
            const f = formatarCpfCnpj(ev.target.value);
            if (f !== ev.target.value) onCampos({ emitente_documento: f });
          }
          onSairDoCampo();
        }}
        placeholder={o.placeholder}
        maxLength={o.max ?? 200}
        autoComplete="off"
        disabled={bloqueado}
        className={cn(o.mono && "font-mono", altura, marca(falta))}
      />
    </Campo>
  );
  const tomador = tomadores.find((x) => x.id === c.tomador_estabelecimento_id);

  if (!t) return null;
  if (t === "nota_fiscal" || t === "fatura") {
    const nf = t === "nota_fiscal";
    return (
      <div className="space-y-2">
        {/* Os campos da NF da PP normal (decisão 152), na mesma grade. A
            fatura faz o papel da nota onde não há NF (decisão 178). */}
        <div className="grid grid-cols-[116px_148px_132px_minmax(0,1fr)] gap-x-2 gap-y-2">
          {texto("documento_numero", "numero", nf ? "Número da NF *" : "Número da fatura *", { mono: true, max: 60 })}
          {data("Data de emissão *")}
          {valor(nf ? "Valor da NF *" : "Valor da fatura *")}
          <Campo id={`${idBase}-tomador`} titulo="CNPJ tomador *">
            <Select
              value={c.tomador_estabelecimento_id ?? undefined}
              onValueChange={(v) => onCampos({ tomador_estabelecimento_id: v })}
              disabled={bloqueado}
            >
              <SelectTrigger
                id={`${idBase}-tomador`}
                aria-label="CNPJ tomador"
                className={cn("font-mono text-[11px]", altura, marca("tomador"))}
              >
                <SelectValue placeholder="Selecione">{tomador ? tomador.cnpj : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {tomadores.map((x) => (
                  <SelectItem key={x.id} value={x.id} className="text-xs">
                    {x.nome} · <span className="font-mono">{x.cnpj}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </div>
        {/* Na PP normal o emitente é o fornecedor; na verba, cada nota é de
            uma loja diferente — o emitente entra na própria nota. */}
        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-2">
          {texto("emitente_documento", "emitenteDocumento", "CNPJ do emitente *", {
            mono: true,
            placeholder: "00.000.000/0000-00",
            max: 18,
          })}
          {texto("emitente_nome", "emitenteNome", "Razão social do emitente *")}
        </div>
      </div>
    );
  }
  if (t === "cupom_fiscal") {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[100px_148px_132px_minmax(0,1fr)] gap-x-2">
          {texto("documento_numero", "numero", "Número *", { mono: true, max: 60 })}
          {data("Data de emissão *")}
          {valor("Valor *")}
          {texto("emitente_documento", "emitenteDocumento", "CNPJ do emitente *", {
            mono: true,
            placeholder: "00.000.000/0000-00",
            max: 18,
          })}
        </div>
        {texto("emitente_nome", "emitenteNome", "Razão social do emitente")}
      </div>
    );
  }
  if (t === "recibo") {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[100px_148px_132px_minmax(0,1fr)] gap-x-2">
          {texto("documento_numero", "numero", "Número", { mono: true, max: 60 })}
          {data("Data *")}
          {valor("Valor *")}
          {texto("emitente_nome", "emitenteNome", "Quem recebeu *")}
        </div>
        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-2">
          {texto("emitente_documento", "emitenteDocumento", "CPF/CNPJ de quem recebeu", { mono: true, max: 18 })}
        </div>
      </div>
    );
  }
  if (t === "boleto" || t === "contrato") {
    // Anexo de apoio: sem valor, não soma no comprovado (decisão 189).
    return (
      <div className="grid grid-cols-[180px_148px] gap-x-2">
        {texto("documento_numero", "numero", t === "boleto" ? "Número do boleto *" : "Número do contrato *", {
          mono: true,
          max: 60,
        })}
        {data("Data *")}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_148px_132px] gap-x-2">
      {texto("descricao", "descricao", "Descrição *", { placeholder: "Ex.: ticket de estacionamento" })}
      {data("Data *")}
      {valor("Valor *")}
    </div>
  );
}

function ResumoDoDocumento({ campos: c }: { campos: CamposDoDocumento }) {
  const partes = [
    rotuloDoDocumento(c),
    c.documento_data ? formatDiaBr(c.documento_data) : null,
    c.documento_tipo !== "outro" ? c.emitente_nome || null : null,
  ].filter(Boolean);
  return (
    <div className="flex items-center justify-between gap-3 text-[11.5px]">
      <span className="min-w-0 truncate text-muted-foreground">{partes.join(" · ")}</span>
      <span className="flex-none font-mono font-semibold">
        {tipoSomaNoComprovado(c.documento_tipo) ? formatCurrency(Number(c.valor ?? 0), "BRL") : "—"}
      </span>
    </div>
  );
}
