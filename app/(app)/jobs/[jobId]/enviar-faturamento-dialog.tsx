"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { Combobox, COMBOBOX_COMO_SELECT, type ComboboxItem } from "@/components/ui/combobox";
import { codigoDoCnae, rotuloDoCnae } from "@/lib/fiscal/calculos";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCnpj, formatCurrency, isValidCnpj, onlyDigits } from "@/lib/utils";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import {
  ANEXO_PO_MIMES,
  ANEXO_PO_TAMANHO_MAX,
} from "@/lib/validations/envio-faturamento";
import {
  cadastrarPortalDoClienteDoJob,
  enviarJobParaFaturamento,
} from "./actions-faturamento";
import { listarCnaesDoGrupo, type CnaeDoGrupo } from "./actions-cnae-sugerido";

const SEM_PORTAL = "__sem_portal__";
const BUCKET_ANEXOS = "envios-faturamento";

/* ------------------------------------------------------------------ */
/* CNAE sugerido (módulo fiscal, 02/10/2026)                           */
/* ------------------------------------------------------------------ */

/** O item "Nenhum": escolher ele deixa o campo vazio, como o ✕. */
const CNAE_NENHUM = "__nenhum__";

const CABECALHO_CNAES =
  "Os CNAEs cadastrados nos CNPJs do grupo. O financeiro escolhe o CNPJ que emite e confirma o CNAE no Faturar.";

/**
 * Um item por CNAE cadastrado em algum CNPJ do grupo, sem repetir. Na
 * lista, a atividade e, embaixo, o código (com o subitem da LC 116 quando o
 * CNAE se divide: 82.30-0-01 · 12.08 e · 17.10 saem separados); no campo,
 * que é a 4ª coluna e estreito, só o código. O valor gravado em
 * `cnae_sugerido` é esse código (`codigoDoCnae`), que o Faturar compara com
 * a lista do CNPJ emissor. A busca também acha o código só com números
 * ("7319099") e no formato que o campo de texto pedia ("7319-0/99").
 */
function itensDoCnaeSugerido(cnaes: readonly CnaeDoGrupo[]): ComboboxItem[] {
  return [
    { value: CNAE_NENHUM, label: "Nenhum" },
    ...cnaes.map((c) => {
      const codigo = codigoDoCnae(c);
      const digitos = c.codigo.replace(/\D/g, "");
      return {
        value: codigo,
        label: c.descricao,
        descricao: codigo,
        curto: codigo,
        busca: `${rotuloDoCnae(c)} ${digitos} ${digitos.slice(0, 4)}-${digitos.slice(4, 5)}/${digitos.slice(5)}`,
      };
    }),
  ];
}

export interface PortalOption {
  id: string;
  nome: string;
  url: string;
}

/* ------------------------------------------------------------------ */
/* Datas e dinheiro                                                    */
/* ------------------------------------------------------------------ */

/** Data ISO local — `toISOString` volta em UTC e erra o dia à noite. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function somaDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoLocal(new Date(y, m - 1, d + dias));
}

function hojeIso(): string {
  return isoLocal(new Date());
}

function dataBr(iso: string): string {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

const centavos = (v: number) => Math.round((Number(v) || 0) * 100);

/**
 * Divide o valor em N partes iguais, em centavos, com a sobra na última.
 * A soma volta exata — o servidor confere contra o faturamento previsto.
 */
function dividirEmParcelas(total: number, n: number, primeiraData: string): ParcelaForm[] {
  const cents = centavos(total);
  const base = Math.floor(cents / n);
  const sobra = cents - base * n;
  return Array.from({ length: n }, (_, i) => ({
    id: novoId(),
    valor: (i === n - 1 ? base + sobra : base) / 100,
    data_vencimento: i === 0 ? primeiraData : somaDiasISO(primeiraData, 30 * i),
  }));
}

let sequencia = 0;
function novoId(): string {
  sequencia += 1;
  return `f${sequencia}`;
}

/** "setembro" → "Setembro", para abrir frase. */
function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function nomeSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-120);
}

/* ------------------------------------------------------------------ */
/* Estado do formulário                                                */
/* ------------------------------------------------------------------ */

interface ParcelaForm {
  id: string;
  valor: number;
  data_vencimento: string;
}

/**
 * Uma nota fiscal do envio (decisão 123). Com um vencimento só, `parcelas`
 * é nulo e o vencimento é `venc`; com dois ou mais, as parcelas dividem o
 * valor da nota. Parcela que a pessoa não mexeu à mão acompanha o valor.
 */
interface NotaForm {
  id: string;
  cnpj: string;
  valor: number;
  venc: string;
  parcelas: ParcelaForm[] | null;
  parcelasManuais: boolean;
  cnae: string;
  descritivo: string;
}

type Origem = "abertura" | "novo";

interface ContatoForm {
  id: string;
  nome: string;
  numero: string;
  email: string;
  origem: Origem;
  original: ContatoCobranca | null;
  editando: boolean;
}

interface AnexoForm {
  id: string;
  nome: string;
  tamanho: number;
  mime: string;
  path: string;
  status: "enviando" | "ok" | "erro";
  mensagem?: string;
}

function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const contatoEmBranco = (c: ContatoForm) =>
  !c.nome.trim() && !c.numero.trim() && !c.email.trim();
const contatoIncompleto = (c: ContatoForm) =>
  !contatoEmBranco(c) && (c.nome.trim().length < 2 || !emailValido(c.email));

function situacaoDoContato(c: ContatoForm): "abertura" | "alterado" | "novo" {
  if (c.origem === "novo") return "novo";
  const o = c.original;
  if (
    o &&
    (o.nome !== c.nome || (o.numero ?? "") !== c.numero || o.email !== c.email)
  ) {
    return "alterado";
  }
  return "abertura";
}

/** Parcelas que ninguém mexeu à mão acompanham o valor da nota. */
function acompanharValor(n: NotaForm): NotaForm {
  if (!n.parcelas || n.parcelasManuais) return n;
  const soma = n.parcelas.reduce((s, p) => s + centavos(p.valor), 0);
  if (soma === centavos(n.valor)) return n;
  const novas = dividirEmParcelas(Math.max(0, n.valor), n.parcelas.length, n.parcelas[0].data_vencimento);
  return {
    ...n,
    parcelas: n.parcelas.map((p, i) => ({ ...p, valor: novas[i].valor })),
  };
}

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  jobId: string;
  jobCodigo: string;
  /** Tenant do job — o primeiro segmento do caminho dos anexos da PO. */
  tenantId: string;
  /** Faturamento previsto atual — vai travado no formulário. */
  valorFaturado: number;
  /** Quanto desse total é saldo em save (decisão 028). Zero em job sem
   *  save, e aí a leitura nem aparece. */
  valorSave?: number;
  /** Data prevista na abertura do job; o 1º vencimento nasce com ela. */
  dataPrevistaFaturamento: string | null;
  /** CNPJ do cadastro do cliente do job — cada nota nasce com ele. */
  cnpjCliente: string | null;
  /** Os contatos de cobrança que a abertura registrou (D1). */
  contatosCobranca: ContatoCobranca[];
  portais: PortalOption[];
  moeda: string;
  /** Modelo mensal (decisão 078): o mês que este envio leva. O valor é o
   *  faturamento DAQUELE mês e o vencimento nasce vazio (Tiago, 14/09/2026). */
  mes?: { iso: string; nome: string };
  /** Texto do botão que abre o formulário. */
  rotuloBotao?: string;
  /** Botão em contorno, para as linhas da barra de faturamento expandida. */
  botaoContorno?: boolean;
  /** O job já foi encerrado (decisão 087): o envio continua aceito, mas
   *  nenhum mês segue editável — a confirmação não pode dizer o contrário. */
  jobEncerrado?: boolean;
}

/** O que a página do job passa às barras para o formulário de envio. */
export type ContextoDoEnvio = Pick<Props, "tenantId" | "cnpjCliente" | "contatosCobranca">;

/**
 * "Enviar job para faturamento": o que a produção libera ao financeiro.
 *
 * Desde a decisão 123 (29/09/2026) é um pop-up em duas colunas, e não mais
 * um drawer: à esquerda, as NOTAS FISCAIS — cada uma com o próprio CNPJ do
 * cliente, valor, vencimento (ou parcelas: "uma nota, vários
 * vencimentos"), CNAE sugerido e descritivo; à direita, fixos, o valor
 * total travado, a divisão entre as notas, a PO com anexos, o portal e os
 * contatos de cobrança para revisar.
 *
 * O valor total é read-only de propósito — vem do faturamento previsto do
 * job e é relido no servidor. As notas só dizem como reparti-lo; o envio
 * sai quando a soma fecha (D6: todas as notas se digitam, como as parcelas).
 */
export function EnviarFaturamentoDialog({
  jobId,
  jobCodigo,
  tenantId,
  valorFaturado,
  valorSave = 0,
  dataPrevistaFaturamento,
  cnpjCliente,
  contatosCobranca,
  portais,
  moeda,
  mes,
  rotuloBotao,
  botaoContorno = false,
  jobEncerrado = false,
}: Props) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [open, setOpen] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const cnpjDoCadastro = onlyDigits(cnpjCliente ?? "").slice(0, 14);
  const vencInicial = mes ? "" : (dataPrevistaFaturamento ?? hojeIso());

  const [numeroPo, setNumeroPo] = React.useState("");
  const [notas, setNotas] = React.useState<NotaForm[]>(() => [
    {
      id: novoId(),
      cnpj: cnpjDoCadastro,
      valor: valorFaturado,
      venc: vencInicial,
      parcelas: null,
      parcelasManuais: false,
      cnae: "",
      descritivo: "",
    },
  ]);
  const [contatos, setContatos] = React.useState<ContatoForm[]>(() =>
    contatosCobranca.length > 0
      ? contatosCobranca.map((c) => ({
          id: novoId(),
          nome: c.nome,
          numero: c.numero ?? "",
          email: c.email,
          origem: "abertura" as const,
          original: c,
          editando: false,
        }))
      : [
          // Job anterior a 17/08/2026 não tem contato: a lista abre com uma
          // linha em edição, porque o envio agora pede ao menos um.
          {
            id: novoId(),
            nome: "",
            numero: "",
            email: "",
            origem: "novo" as const,
            original: null,
            editando: true,
          },
        ],
  );
  const [anexos, setAnexos] = React.useState<AnexoForm[]>([]);
  const [erroAnexo, setErroAnexo] = React.useState<string | null>(null);
  const [portalId, setPortalId] = React.useState(SEM_PORTAL);

  // A lista do CNAE sugerido (módulo fiscal) vem do cadastro de impostos e
  // é lida quando o pop-up abre, e uma vez só: a página do job não carrega
  // nada a mais por ela. Se a leitura falhar, abrir de novo tenta outra vez.
  const [cnaesDoGrupo, setCnaesDoGrupo] = React.useState<CnaeDoGrupo[] | null>(null);
  const [erroCnaes, setErroCnaes] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open || cnaesDoGrupo !== null) return;
    let vivo = true;
    setErroCnaes(null);
    listarCnaesDoGrupo()
      .then((res) => {
        if (!vivo) return;
        if (res.ok) setCnaesDoGrupo(res.cnaes);
        else setErroCnaes(res.message);
      })
      .catch(() => {
        if (vivo) setErroCnaes("Não foi possível carregar a lista de CNAEs. Feche e abra o envio de novo.");
      });
    return () => {
      vivo = false;
    };
  }, [open, cnaesDoGrupo]);
  const itensCnae = React.useMemo(() => itensDoCnaeSugerido(cnaesDoGrupo ?? []), [cnaesDoGrupo]);

  // Rola até a nota nova depois que o React a desenha.
  const fimDasNotas = React.useRef<HTMLDivElement>(null);
  const [rolarParaNova, setRolarParaNova] = React.useState(false);
  React.useEffect(() => {
    if (!rolarParaNova) return;
    fimDasNotas.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setRolarParaNova(false);
  }, [rolarParaNova]);

  /* ---------------- Portal (decisão 050) ---------------- */

  // Cadastro do portal sem sair do envio (decisão 050, 04/09/2026). A
  // lista vem do server component, então o portal que acabou de nascer
  // só chegaria nela depois de um refresh — e refresh no meio do
  // preenchimento zera o formulário (048). Enquanto isso ele mora aqui,
  // mesclado à lista e deduplicado por id.
  const [cadastrandoPortal, setCadastrandoPortal] = React.useState(false);
  const [portalNome, setPortalNome] = React.useState("");
  const [portalUrl, setPortalUrl] = React.useState("");
  const [portalErro, setPortalErro] = React.useState<string | null>(null);
  const [portalFieldErrors, setPortalFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [salvandoPortal, startSalvarPortal] = React.useTransition();
  const [portaisNovos, setPortaisNovos] = React.useState<PortalOption[]>([]);
  const portaisVisiveis = React.useMemo(() => {
    const extras = portaisNovos.filter((n) => !portais.some((p) => p.id === n.id));
    if (extras.length === 0) return portais;
    return [...portais, ...extras].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [portais, portaisNovos]);

  // A seleção entra em dois tempos, de propósito: o Select do Radix
  // espelha o valor num <select> nativo escondido, e se o valor e a
  // <option> nova chegam na mesma renderização ele volta pra "" e dispara
  // `onValueChange("")`, apagando a escolha. Primeiro o portal entra na
  // lista; só quando já está lá o efeito seleciona.
  const [portalPendenteId, setPortalPendenteId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!portalPendenteId) return;
    if (portaisVisiveis.some((p) => p.id === portalPendenteId)) {
      setPortalId(portalPendenteId);
      setPortalPendenteId(null);
    }
  }, [portalPendenteId, portaisVisiveis]);

  const portalEscolhido = portaisVisiveis.find((p) => p.id === portalId) ?? null;

  function abrirCadastroPortal() {
    setPortalNome("");
    setPortalUrl("");
    setPortalErro(null);
    setPortalFieldErrors({});
    setCadastrandoPortal(true);
  }

  function handleSalvarPortal() {
    setPortalErro(null);
    setPortalFieldErrors({});
    startSalvarPortal(async () => {
      const res = await cadastrarPortalDoClienteDoJob(jobId, {
        nome: portalNome.trim(),
        url: portalUrl.trim(),
      });
      if (!res.ok) {
        setPortalErro(res.message);
        if (res.fieldErrors) setPortalFieldErrors(res.fieldErrors);
        return;
      }
      setPortaisNovos((atuais) => [...atuais, res.portal]);
      setPortalPendenteId(res.portal.id);
      setCadastrandoPortal(false);
    });
  }

  /* ---------------- Notas ---------------- */

  function mexerNota(id: string, f: (n: NotaForm) => NotaForm) {
    setNotas((ns) => ns.map((n) => (n.id === id ? acompanharValor(f(n)) : n)));
  }

  function adicionarNota() {
    setNotas((ns) => {
      const primeiraVenc = ns[0]
        ? (ns[0].parcelas ? ns[0].parcelas[0].data_vencimento : ns[0].venc)
        : vencInicial;
      return [
        ...ns,
        {
          id: novoId(),
          cnpj: cnpjDoCadastro,
          valor: 0,
          venc: primeiraVenc,
          parcelas: null,
          parcelasManuais: false,
          cnae: "",
          descritivo: "",
        },
      ];
    });
    setRolarParaNova(true);
  }

  function definirParcelas(id: string, k: number) {
    mexerNota(id, (n) => {
      const prim = (n.parcelas ? n.parcelas[0].data_vencimento : n.venc) || vencInicial || hojeIso();
      if (k === 1) return { ...n, parcelas: null, parcelasManuais: false, venc: prim };
      return {
        ...n,
        venc: prim,
        parcelasManuais: false,
        parcelas: dividirEmParcelas(Math.max(0, n.valor), k, prim),
      };
    });
  }

  function novaParcela(id: string) {
    mexerNota(id, (n) => {
      const base = n.parcelas ?? [{ id: novoId(), valor: n.valor, data_vencimento: n.venc }];
      const ultima = base[base.length - 1].data_vencimento || n.venc || hojeIso();
      return {
        ...n,
        parcelasManuais: true,
        parcelas: [...base, { id: novoId(), valor: 0, data_vencimento: somaDiasISO(ultima, 30) }],
      };
    });
  }

  function removerParcela(id: string, parcelaId: string) {
    mexerNota(id, (n) => {
      const restantes = (n.parcelas ?? []).filter((p) => p.id !== parcelaId);
      if (restantes.length <= 1) {
        return {
          ...n,
          parcelas: null,
          parcelasManuais: false,
          venc: restantes[0]?.data_vencimento ?? n.venc,
        };
      }
      return { ...n, parcelas: restantes, venc: restantes[0].data_vencimento };
    });
  }

  function alterarParcela(id: string, parcelaId: string, patch: Partial<ParcelaForm>) {
    mexerNota(id, (n) => {
      const parcelas = (n.parcelas ?? []).map((p) => (p.id === parcelaId ? { ...p, ...patch } : p));
      return {
        ...n,
        parcelas,
        parcelasManuais: n.parcelasManuais || patch.valor !== undefined,
        venc: parcelas[0]?.data_vencimento ?? n.venc,
      };
    });
  }

  /* ---------------- Contatos ---------------- */

  function alterarContato(id: string, patch: Partial<ContatoForm>) {
    setContatos((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function adicionarContato() {
    setContatos((cs) => [
      ...cs,
      { id: novoId(), nome: "", numero: "", email: "", origem: "novo", original: null, editando: true },
    ]);
  }
  function removerContato(id: string) {
    setContatos((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs));
  }

  /* ---------------- Anexos da PO ---------------- */

  async function anexarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErroAnexo(null);
    const aceitos: AnexoForm[] = [];
    for (const file of Array.from(files)) {
      if (!(ANEXO_PO_MIMES as readonly string[]).includes(file.type)) {
        setErroAnexo(`${file.name}: envie um PDF ou uma imagem (PNG ou JPG).`);
        continue;
      }
      if (file.size > ANEXO_PO_TAMANHO_MAX) {
        setErroAnexo(`${file.name} passa de 10 MB.`);
        continue;
      }
      const id = crypto.randomUUID();
      aceitos.push({
        id,
        nome: file.name,
        tamanho: file.size,
        mime: file.type,
        path: `${tenantId}/${jobId}/${id}-${nomeSeguro(file.name)}`,
        status: "enviando",
      });
    }
    if (aceitos.length === 0) return;
    setAnexos((atuais) => [...atuais, ...aceitos]);

    // O arquivo sobe direto do navegador ao Storage: Server Action tem
    // teto de 1 MB (decisão 110), e a PO chega a 10 MB.
    await Promise.all(
      aceitos.map(async (a) => {
        const file = Array.from(files).find((f) => f.name === a.nome && f.size === a.tamanho);
        if (!file) return;
        const { error } = await supabase.storage
          .from(BUCKET_ANEXOS)
          .upload(a.path, file, { contentType: a.mime, upsert: false });
        setAnexos((atuais) =>
          atuais.map((x) =>
            x.id === a.id
              ? { ...x, status: error ? "erro" : "ok", mensagem: error ? "Não subiu. Remova e tente de novo." : undefined }
              : x,
          ),
        );
      }),
    );
  }

  async function removerAnexo(id: string) {
    const alvo = anexos.find((a) => a.id === id);
    setAnexos((atuais) => atuais.filter((a) => a.id !== id));
    if (alvo?.status === "ok") {
      await supabase.storage.from(BUCKET_ANEXOS).remove([alvo.path]);
    }
  }

  /* ---------------- O que falta ---------------- */

  const multi = notas.length > 1;
  const somaNotas = notas.reduce((s, n) => s + centavos(n.valor), 0);
  const somaFecha = somaNotas === centavos(valorFaturado);

  const pendencias = React.useMemo(() => {
    const p: string[] = [];
    notas.forEach((n, i) => {
      const r = multi ? `nota ${i + 1}` : "nota";
      if (!isValidCnpj(n.cnpj)) p.push(`CNPJ da ${r}`);
      if (centavos(n.valor) <= 0) p.push(`valor da ${r}`);
      if (n.parcelas) {
        if (n.parcelas.some((x) => x.data_vencimento.length !== 10)) {
          p.push(`vencimento das parcelas da ${r}`);
        }
        const soma = n.parcelas.reduce((s, x) => s + centavos(x.valor), 0);
        if (n.parcelas.some((x) => centavos(x.valor) <= 0)) p.push(`valor das parcelas da ${r}`);
        else if (soma !== centavos(n.valor)) p.push(`parcelas da ${r} (a soma não fecha)`);
      } else if (n.venc.length !== 10) {
        p.push(`vencimento da ${r}`);
      }
    });
    if (!somaFecha) p.push("a soma das notas não fecha com o valor total");
    const preenchidos = contatos.filter((c) => !contatoEmBranco(c));
    if (preenchidos.length === 0) p.push("ao menos um contato de cobrança");
    else if (preenchidos.some(contatoIncompleto)) p.push("nome e e-mail dos contatos de cobrança");
    if (anexos.some((a) => a.status === "enviando")) p.push("esperar o anexo da PO terminar de subir");
    if (anexos.some((a) => a.status === "erro")) p.push("remover o anexo da PO que não subiu");
    if (cadastrandoPortal) p.push("salvar ou cancelar o cadastro do portal");
    return p;
  }, [notas, multi, somaFecha, contatos, anexos, cadastrandoPortal]);

  const podeEnviar = pendencias.length === 0;

  function handleEnviar() {
    setErro(null);
    startTransition(async () => {
      const res = await enviarJobParaFaturamento(jobId, {
        numero_po: numeroPo.trim() || null,
        portal_id: portalId === SEM_PORTAL ? null : portalId,
        mes: mes?.iso ?? null,
        notas: notas.map((n) => ({
          cnpj: n.cnpj,
          cnae_sugerido: n.cnae.trim() || null,
          descritivo: n.descritivo.trim() || null,
          parcelas: n.parcelas
            ? n.parcelas.map((p) => ({ valor: p.valor, data_vencimento: p.data_vencimento }))
            : [{ valor: n.valor, data_vencimento: n.venc }],
        })),
        anexos_po: anexos
          .filter((a) => a.status === "ok")
          .map((a) => ({
            path: a.path,
            nome_arquivo: a.nome,
            mime_type: a.mime as (typeof ANEXO_PO_MIMES)[number],
            tamanho_bytes: a.tamanho,
          })),
        contatos: contatos
          .filter((c) => !contatoEmBranco(c))
          .map((c) => ({
            nome: c.nome.trim(),
            numero: c.numero.trim() || null,
            email: c.email.trim(),
          })),
      });
      if (!res.ok) {
        setErro(res.message);
        setConfirmar(false);
        return;
      }
      setConfirmar(false);
      setOpen(false);
      router.refresh();
    });
  }

  const primeiroVenc = notas
    .flatMap((n) => (n.parcelas ? n.parcelas.map((p) => p.data_vencimento) : [n.venc]))
    .filter((d) => d.length === 10)
    .sort()[0];
  const contatosMudados = contatos.filter(
    (c) => !contatoEmBranco(c) && situacaoDoContato(c) !== "abertura",
  ).length;
  const anexosOk = anexos.filter((a) => a.status === "ok").length;

  return (
    <>
      {/* Altura e raio da barra fixa do rodapé, que é onde este botão
          passou a morar em 19/08/2026. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] font-semibold transition-colors",
          botaoContorno
            ? "h-8 border border-border bg-white px-3 text-xs text-foreground hover:border-california-red/40 hover:text-california-red"
            : "h-9 bg-california-red px-4 text-[13px] text-white hover:bg-california-red-hover",
        )}
      >
        <Send className={botaoContorno ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {rotuloBotao ?? "Enviar job para faturamento"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Pop-up em duas colunas, no molde do "Enviar job" da abertura
            (decisão 123): cabeçalho e rodapé fixos, as notas rolando à
            esquerda e o resumo fixo à direita. */}
        <DialogContent className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1280px]">
          <DialogHeader className="border-b border-border p-6 pr-12">
            <DialogTitle>
              {mes
                ? `Enviar ${mes.nome} de ${jobCodigo} para faturamento`
                : `Enviar ${jobCodigo} para faturamento`}
            </DialogTitle>
            <DialogDescription>
              {mes
                ? `${comMaiuscula(mes.nome)} entra na fila de faturamento do financeiro com estas informações. O valor total vem do faturamento de ${mes.nome} na planilha e não é editável aqui.`
                : "O job entra na fila de faturamento do financeiro com estas informações. O valor total vem do faturamento previsto e não é editável aqui."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* ---------- Notas fiscais ---------- */}
            <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">Notas fiscais</h3>
                  <p className="text-xs text-muted-foreground">
                    Uma nota para cada CNPJ, CNAE ou descritivo diferente. Parcelas são vencimentos da mesma nota.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={adicionarNota}
                  className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar nota fiscal
                </button>
              </div>

              {notas.map((n, i) => (
                <CartaoNota
                  key={n.id}
                  nota={n}
                  indice={i}
                  multi={multi}
                  moeda={moeda}
                  itensCnae={itensCnae}
                  carregandoCnaes={cnaesDoGrupo === null && !erroCnaes}
                  erroCnaes={erroCnaes}
                  onMexer={(f) => mexerNota(n.id, f)}
                  onRemover={() => setNotas((ns) => ns.filter((x) => x.id !== n.id))}
                  onParcelas={(k) => definirParcelas(n.id, k)}
                  onNovaParcela={() => novaParcela(n.id)}
                  onRemoverParcela={(pid) => removerParcela(n.id, pid)}
                  onAlterarParcela={(pid, patch) => alterarParcela(n.id, pid, patch)}
                />
              ))}
              <div ref={fimDasNotas} />
            </div>

            {/* ---------- Resumo e cobrança ---------- */}
            <aside className="min-h-0 w-[380px] flex-none space-y-6 overflow-y-auto border-l border-border bg-muted/30 p-6">
              <div className="space-y-2.5">
                <div className="space-y-2">
                  <Label>Valor a ser faturado</Label>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5">
                    <span className="font-mono text-base font-bold">
                      {formatCurrency(valorFaturado, moeda)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                      {mes ? `Do faturamento de ${mes.nome}` : "Do faturamento previsto"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {mes
                      ? "Já considera as erratas registradas até agora no mês."
                      : "Já considera as erratas registradas até agora."}
                    {valorSave > 0.005 && (
                      <>
                        {" "}
                        Deste total,{" "}
                        <strong className="text-[#5f5d57]">
                          {formatCurrency(valorSave, moeda)}
                        </strong>{" "}
                        é saldo em save: o cliente paga agora e gasta em outro job.
                      </>
                    )}
                  </p>
                </div>

                {(multi || !somaFecha) && (
                  <div
                    className={cn(
                      "space-y-1.5 rounded-xl border bg-white p-3",
                      somaFecha ? "border-border" : "border-california-red/40",
                    )}
                  >
                    {multi &&
                      notas.map((n, i) => (
                        <div key={n.id} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="min-w-0 truncate">
                            <span className="font-semibold">NF {i + 1}</span>
                            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                              {formatCnpj(n.cnpj)}
                            </span>
                          </span>
                          <span className="flex-none font-mono font-semibold">
                            {formatCurrency(n.valor, moeda)}
                          </span>
                        </div>
                      ))}
                    <div className={cn(multi && "border-t border-border pt-1.5")}>
                      <p
                        className={cn(
                          "text-xs font-medium",
                          somaFecha ? "text-emerald-700" : "text-california-red",
                        )}
                      >
                        Soma {formatCurrency(somaNotas / 100, moeda)} /{" "}
                        {formatCurrency(valorFaturado, moeda)}
                      </p>
                      {!somaFecha && (
                        <p className="text-[11px] text-california-red">
                          {somaNotas < centavos(valorFaturado)
                            ? `Faltam ${formatCurrency((centavos(valorFaturado) - somaNotas) / 100, moeda)}.`
                            : `Passam ${formatCurrency((somaNotas - centavos(valorFaturado)) / 100, moeda)}.`}{" "}
                          A soma não fecha.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="numero-po">Número da PO</Label>
                  <Input
                    id="numero-po"
                    value={numeroPo}
                    onChange={(e) => setNumeroPo(e.target.value)}
                    maxLength={60}
                    placeholder="Opcional — nem todo cliente emite PO"
                  />
                </div>

                {/* Anexos da PO (decisão 123): opcionais, vários arquivos. O
                    desenho é o do "Anexo da NF" do Faturar. */}
                <div className="space-y-2">
                  <Label>
                    Anexos da PO{" "}
                    <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  {anexos.length > 0 && (
                    <div className="space-y-1.5">
                      {anexos.map((a) => (
                        <div
                          key={a.id}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px]",
                            a.status === "erro"
                              ? "border-california-red/40 bg-california-red/5"
                              : "border-border bg-muted/50",
                          )}
                        >
                          {a.status === "enviando" ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : a.status === "ok" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-california-red" />
                          )}
                          <span className="min-w-0 flex-1 truncate" title={a.nome}>
                            {a.nome}
                          </span>
                          <span className="flex-none text-[11px] text-muted-foreground">
                            {a.status === "erro" ? a.mensagem : tamanhoLegivel(a.tamanho)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removerAnexo(a.id)}
                            disabled={a.status === "enviando"}
                            aria-label={`Remover ${a.nome}`}
                            title="Remover anexo"
                            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                      <Paperclip className="h-3.5 w-3.5" />
                      {anexos.length > 0 ? "Anexar outro arquivo" : "Anexar PO"}
                      <input
                        type="file"
                        multiple
                        accept={ANEXO_PO_MIMES.join(",")}
                        className="sr-only"
                        aria-label="Anexar PO"
                        onChange={(e) => {
                          const files = e.target.files;
                          void anexarArquivos(files).finally(() => {
                            e.target.value = "";
                          });
                        }}
                      />
                    </label>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      PDF ou imagem · até 10 MB cada
                    </p>
                  </div>
                  {erroAnexo && <p className="text-[11px] text-california-red">{erroAnexo}</p>}
                </div>
              </div>

              {/* Portal de fornecedor do cliente (decisão 050). */}
              <div className="space-y-2">
                <Label htmlFor="portal">Portal de fornecedor do cliente</Label>
                {portaisVisiveis.length === 0 ? (
                  <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-3">
                    <p className="text-xs text-muted-foreground">
                      Este cliente não tem portal cadastrado. Se a nota precisar ser lançada em um, cadastre aqui mesmo.
                    </p>
                    {!cadastrandoPortal && (
                      <button
                        type="button"
                        onClick={abrirCadastroPortal}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:border-california-red hover:text-california-red disabled:opacity-50"
                      >
                        <Plus className="h-3 w-3" />
                        Cadastrar portal
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Select value={portalId} onValueChange={setPortalId}>
                        <SelectTrigger id="portal">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_PORTAL}>Sem portal</SelectItem>
                          {portaisVisiveis.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Cadastrar outro portal sem sair do envio — o mesmo
                        "+" do fornecedor na PP (decisão 048). */}
                    <button
                      type="button"
                      onClick={abrirCadastroPortal}
                      disabled={pending || cadastrandoPortal}
                      title="Cadastrar portal"
                      aria-label="Cadastrar portal"
                      className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50"
                    >
                      <Plus className="h-[17px] w-[17px]" />
                    </button>
                  </div>
                )}

                {cadastrandoPortal && (
                  <div className="space-y-3 rounded-xl border border-california-red/30 bg-california-red/[0.03] p-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider">
                        Novo portal deste cliente
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Fica no cadastro do cliente e vale para os próximos jobs dele. Ao salvar, já entra selecionado aqui.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-nome">
                        Nome <span className="text-california-red">*</span>
                      </Label>
                      <Input
                        id="portal-nome"
                        value={portalNome}
                        onChange={(e) => setPortalNome(e.target.value)}
                        maxLength={80}
                        autoFocus
                        placeholder="Ex.: Coupa, Ariba, Portal NF"
                      />
                      {portalFieldErrors.nome?.map((m, i) => (
                        <p key={i} className="text-xs text-california-red">
                          {m}
                        </p>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-url">
                        Link <span className="text-california-red">*</span>
                      </Label>
                      <Input
                        id="portal-url"
                        value={portalUrl}
                        onChange={(e) => setPortalUrl(e.target.value)}
                        maxLength={500}
                        placeholder="https://..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!salvandoPortal) handleSalvarPortal();
                          }
                        }}
                      />
                      {portalFieldErrors.url?.map((m, i) => (
                        <p key={i} className="text-xs text-california-red">
                          {m}
                        </p>
                      ))}
                    </div>
                    {portalErro && (
                      <p className="rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                        {portalErro}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setCadastrandoPortal(false)}
                        disabled={salvandoPortal}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSalvarPortal}
                        disabled={
                          salvandoPortal ||
                          portalNome.trim().length === 0 ||
                          portalUrl.trim().length === 0
                        }
                        className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {salvandoPortal ? "Salvando..." : "Salvar e selecionar"}
                      </button>
                    </div>
                  </div>
                )}

                {portalEscolhido && (
                  <a
                    href={portalEscolhido.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 break-all text-xs text-california-red hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 flex-none" />
                    {portalEscolhido.url}
                  </a>
                )}
              </div>

              {/* Contatos de cobrança (D1): vieram da abertura; o que mudar
                  aqui passa a ser a lista do job. */}
              <div className="space-y-2">
                <Label>
                  Contatos de cobrança <span className="text-california-red">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Vieram da abertura do job. O que mudar aqui vale para o job: é esta lista que o financeiro vê no Faturamento e em Títulos a Receber.
                </p>
                <div className="space-y-2 pt-1">
                  {contatos.map((c) =>
                    c.editando ? (
                      <div
                        key={c.id}
                        className="space-y-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] p-3"
                      >
                        <Input
                          value={c.nome}
                          onChange={(e) => alterarContato(c.id, { nome: e.target.value })}
                          maxLength={120}
                          placeholder="Nome *"
                          aria-label="Nome do contato"
                          autoFocus
                          className="h-9 text-[13px]"
                        />
                        <Input
                          type="email"
                          value={c.email}
                          onChange={(e) => alterarContato(c.id, { email: e.target.value })}
                          maxLength={200}
                          placeholder="E-mail *"
                          aria-label="E-mail do contato"
                          className="h-9 text-[13px]"
                        />
                        <Input
                          value={c.numero}
                          onChange={(e) => alterarContato(c.id, { numero: e.target.value })}
                          maxLength={40}
                          placeholder="Número (opcional)"
                          aria-label="Número do contato"
                          className="h-9 text-[13px]"
                        />
                        <div className="flex items-center justify-between gap-2">
                          {contatoIncompleto(c) ? (
                            <span className="text-[11px] text-california-red">
                              Nome e e-mail válido são obrigatórios.
                            </span>
                          ) : (
                            <span />
                          )}
                          <div className="flex gap-1.5">
                            {c.origem === "novo" && contatoEmBranco(c) && contatos.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removerContato(c.id)}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                              >
                                Descartar
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={contatoIncompleto(c) || contatoEmBranco(c)}
                              onClick={() => alterarContato(c.id, { editando: false })}
                              className="rounded-lg bg-california-red px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
                            >
                              Pronto
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={c.id}
                        className="flex items-start gap-2.5 rounded-xl border border-border bg-white px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{c.nome || "—"}</span>
                            <SeloContato situacao={situacaoDoContato(c)} />
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{c.email || "sem e-mail"}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.numero || "sem número"}</p>
                        </div>
                        <div className="flex flex-none items-center">
                          <button
                            type="button"
                            onClick={() => alterarContato(c.id, { editando: true })}
                            aria-label="Editar contato"
                            title="Editar contato"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removerContato(c.id)}
                            disabled={contatos.length === 1}
                            aria-label="Remover contato"
                            title="Remover contato"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={adicionarContato}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar contato
                  </button>
                </div>
              </div>
            </aside>
          </div>

          {erro && (
            <div className="flex items-start gap-2 border-t border-california-red/20 bg-california-red/5 px-6 py-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 border-t border-border p-4">
            <div className="min-w-0 flex-1">
              {pendencias.length > 0 ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertCircle className="mt-px h-3.5 w-3.5 flex-none text-california-red" />
                  <span>
                    <span className="font-semibold text-foreground">Falta:</span>{" "}
                    {pendencias.join("; ")}.
                  </span>
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" />
                  Tudo pronto para enviar.
                </p>
              )}
            </div>
            <div className="flex flex-none items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setConfirmar(true)}
                disabled={!podeEnviar || pending}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Enviar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmar}
        onOpenChange={(o) => !o && setConfirmar(false)}
        contentClassName="sm:max-w-[560px]"
        title={
          mes
            ? `Enviar ${mes.nome} de ${jobCodigo} para faturamento?`
            : `Enviar ${jobCodigo} para faturamento?`
        }
        description={
          <span className="block space-y-3">
            <span className="block">
              {mes ? comMaiuscula(mes.nome) : "O job"} entra na fila de faturamento do financeiro no valor de{" "}
              <strong>{formatCurrency(valorFaturado, moeda)}</strong>
              {multi ? (
                <>
                  , em <strong>{notas.length} notas fiscais</strong>:
                </>
              ) : (
                <>, em uma nota fiscal:</>
              )}
            </span>
            <span className="block overflow-hidden rounded-xl border border-border">
              {notas.map((n, i) => (
                <span
                  key={n.id}
                  className={cn(
                    "grid grid-cols-[48px_1fr_auto] gap-x-3 px-3.5 py-2 text-foreground",
                    i > 0 && "border-t border-border",
                  )}
                >
                  <span className="pt-px text-xs font-semibold text-muted-foreground">NF {i + 1}</span>
                  <span className="min-w-0 text-[13px]">
                    <span className="block font-mono">{formatCnpj(n.cnpj)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {n.parcelas
                        ? `${n.parcelas.length} parcelas, de ${dataBr(n.parcelas[0].data_vencimento)} a ${dataBr(n.parcelas[n.parcelas.length - 1].data_vencimento)}`
                        : `vence em ${dataBr(n.venc)}`}
                      {n.cnae.trim() ? ` · CNAE ${n.cnae.trim()}` : ""}
                    </span>
                  </span>
                  <span className="font-mono text-[13px] font-semibold">
                    {formatCurrency(n.valor, moeda)}
                  </span>
                </span>
              ))}
            </span>
            <span className="block">
              {numeroPo.trim() || anexosOk > 0
                ? `PO ${numeroPo.trim() || "sem número"}${anexosOk > 0 ? `, com ${anexosOk === 1 ? "1 anexo" : `${anexosOk} anexos`}` : ", sem anexo"}. `
                : ""}
              {contatosMudados > 0
                ? `${contatosMudados === 1 ? "1 contato de cobrança novo ou alterado passa" : `${contatosMudados} contatos de cobrança novos ou alterados passam`} a valer para o job. `
                : ""}
              {primeiroVenc ? `O primeiro vencimento é ${dataBr(primeiroVenc)}. ` : ""}
              {/* Gerar save segue valendo depois do envio, até o encerramento;
                  o que o envio fecha é a errata e o consumo de save (decisão
                  099 §14, 22/09/2026). */}
              {mes
                ? jobEncerrado
                  ? "O envio é definitivo. O job já está encerrado: nenhum mês aceita errata nem save."
                  : `O envio é definitivo: errata e consumo de save de ${mes.nome} ficam travados, e os outros meses seguem editáveis.`
                : "O envio é definitivo: depois dele não há mais errata nem consumo de save neste job."}
            </span>
          </span>
        }
        confirmLabel="Sim, enviar"
        pending={pending}
        onConfirm={handleEnviar}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

const SELO: Record<"abertura" | "alterado" | "novo", [string, string]> = {
  abertura: ["Da abertura", "border-border bg-white text-muted-foreground"],
  alterado: ["Alterado", "border-amber-200 bg-amber-50 text-amber-800"],
  novo: ["Novo", "border-emerald-200 bg-emerald-50 text-emerald-700"],
};

function SeloContato({ situacao }: { situacao: "abertura" | "alterado" | "novo" }) {
  const [texto, classes] = SELO[situacao];
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        classes,
      )}
    >
      {texto}
    </span>
  );
}

function CartaoNota({
  nota,
  indice,
  multi,
  moeda,
  itensCnae,
  carregandoCnaes,
  erroCnaes,
  onMexer,
  onRemover,
  onParcelas,
  onNovaParcela,
  onRemoverParcela,
  onAlterarParcela,
}: {
  nota: NotaForm;
  indice: number;
  multi: boolean;
  moeda: string;
  /** A lista do CNAE sugerido ("Nenhum" e os CNAEs do grupo). */
  itensCnae: ComboboxItem[];
  carregandoCnaes: boolean;
  erroCnaes: string | null;
  onMexer: (f: (n: NotaForm) => NotaForm) => void;
  onRemover: () => void;
  onParcelas: (k: number) => void;
  onNovaParcela: () => void;
  onRemoverParcela: (parcelaId: string) => void;
  onAlterarParcela: (parcelaId: string, patch: Partial<ParcelaForm>) => void;
}) {
  const [cnpjTocado, setCnpjTocado] = React.useState(false);
  const qtdParcelas = nota.parcelas ? nota.parcelas.length : 1;
  const cnpjErrado = cnpjTocado && nota.cnpj.length > 0 && !isValidCnpj(nota.cnpj);
  const somaParcelas = (nota.parcelas ?? []).reduce((s, p) => s + p.valor, 0);
  const parcelasFecham = centavos(somaParcelas) === centavos(nota.valor);
  // Valor que não está na lista (texto livre de antes dela) aparece como
  // está, para não sumir do campo.
  const itensDaNota =
    nota.cnae && !itensCnae.some((i) => i.value === nota.cnae)
      ? [{ value: nota.cnae, label: nota.cnae, curto: nota.cnae }, ...itensCnae]
      : itensCnae;

  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-california-red" />
          Nota fiscal {indice + 1}
          <span className="font-mono text-[13px] font-medium text-muted-foreground">
            {formatCurrency(nota.valor, moeda)}
          </span>
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Parcelas
          </span>
          <div className="flex gap-1">
            {[1, 2, 3, 6].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onParcelas(k)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  qtdParcelas === k
                    ? "border-california-red bg-california-red/10 text-california-red"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/40 hover:text-foreground",
                )}
              >
                {k}×
              </button>
            ))}
          </div>
          {multi && (
            <button
              type="button"
              onClick={onRemover}
              aria-label={`Remover nota ${indice + 1}`}
              title={`Remover nota ${indice + 1}`}
              className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
          <div className="space-y-1.5">
            <Label>
              CNPJ do cliente <span className="text-california-red">*</span>
            </Label>
            <MaskedInput
              mask="cnpj"
              defaultValue={nota.cnpj}
              onDigitsChange={(d) => onMexer((n) => ({ ...n, cnpj: d }))}
              onBlur={() => setCnpjTocado(true)}
              aria-label={`CNPJ do cliente da nota ${indice + 1}`}
              className={cn(
                "font-mono",
                cnpjErrado && "border-california-red ring-2 ring-california-red/15",
              )}
            />
            {cnpjErrado && (
              <p className="text-[11px] text-california-red">
                {nota.cnpj.length < 14 ? "Faltam números no CNPJ." : "CNPJ inválido."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>
              Valor da nota <span className="text-california-red">*</span>
            </Label>
            <MoneyInput
              value={nota.valor}
              onValueChange={(v) => onMexer((n) => ({ ...n, valor: v }))}
              aria-label={`Valor da nota ${indice + 1}`}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Vencimento <span className="text-california-red">*</span>
            </Label>
            {nota.parcelas ? (
              <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3.5 text-sm text-muted-foreground">
                <span className="truncate">{nota.parcelas.length} parcelas</span>
              </div>
            ) : (
              <DatePicker
                // O DatePicker só lê `defaultValue` ao montar: a chave o
                // remonta quando o vencimento muda por fora (1× depois de 2×).
                key={`venc-${nota.id}-${nota.venc}`}
                name={`venc-${nota.id}`}
                defaultValue={nota.venc}
                onDateChange={(d) => onMexer((n) => ({ ...n, venc: d ? isoLocal(d) : "" }))}
              />
            )}
          </div>

          {/* Módulo fiscal (02/10/2026): continua na 4ª coluna, na linha do
              CNPJ, do valor e do vencimento, mas deixa de ser texto livre:
              lista com busca dos CNAEs cadastrados, com "Nenhum" (o ✕ também
              limpa). O campo mostra só o código; a lista abre mais larga,
              para a esquerda, com a atividade por extenso. Segue opcional. */}
          <div className="space-y-1.5">
            <Label>
              CNAE sugerido{" "}
              <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Combobox
              items={itensDaNota}
              value={nota.cnae || null}
              onChange={(v) => onMexer((n) => ({ ...n, cnae: v && v !== CNAE_NENHUM ? v : "" }))}
              disabled={carregandoCnaes}
              placeholder={carregandoCnaes ? "Carregando…" : "Opcional"}
              buscaPlaceholder="Escreva o código ou a atividade"
              ariaLabel={`CNAE sugerido da nota ${indice + 1}`}
              limpavel
              className={cn(COMBOBOX_COMO_SELECT, "font-mono")}
              larguraLista="w-[520px]"
              alinharLista="end"
              cabecalhoLista={CABECALHO_CNAES}
            />
            {erroCnaes && <p className="text-[11px] text-california-red">{erroCnaes}</p>}
          </div>
        </div>

        {nota.parcelas && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wider text-foreground">
                Parcelas desta nota
              </span>{" "}
              · uma nota só, com um vencimento por parcela.
            </p>
            <div className="max-w-[640px] space-y-2">
              {nota.parcelas.map((p, j) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[34px_minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-2"
                >
                  <span className="text-center font-mono text-xs text-muted-foreground">
                    {j + 1}/{nota.parcelas?.length}
                  </span>
                  <MoneyInput
                    value={p.valor}
                    onValueChange={(v) => onAlterarParcela(p.id, { valor: v })}
                    aria-label={`Valor da parcela ${j + 1} da nota ${indice + 1}`}
                  />
                  <DatePicker
                    key={`venc-${p.id}-${p.data_vencimento}`}
                    name={`venc-${p.id}`}
                    defaultValue={p.data_vencimento}
                    onDateChange={(d) =>
                      onAlterarParcela(p.id, { data_vencimento: d ? isoLocal(d) : "" })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => onRemoverParcela(p.id)}
                    aria-label="Remover parcela"
                    className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={onNovaParcela}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-white px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-california-red/40 hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                  Nova parcela
                </button>
                <p
                  className={cn(
                    "text-xs font-medium",
                    parcelasFecham ? "text-emerald-700" : "text-california-red",
                  )}
                >
                  Soma {formatCurrency(somaParcelas, moeda)} / {formatCurrency(nota.valor, moeda)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>
              Descritivo da nota fiscal{" "}
              <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {nota.descritivo.length.toLocaleString("pt-BR")} de 2.000 caracteres
            </span>
          </div>
          <Textarea
            rows={3}
            value={nota.descritivo}
            onChange={(e) => onMexer((n) => ({ ...n, descritivo: e.target.value }))}
            maxLength={2000}
            aria-label={`Descritivo da nota ${indice + 1}`}
            placeholder="Ex.: Serviços de produção audiovisual referentes à campanha X, conforme PO 4500123456."
          />
          {indice === 0 && (
            <p className="text-xs text-muted-foreground">
              É o texto que o financeiro copia para a nota. Escreva como o cliente exige ver — se a nota voltar por descrição errada, o recebimento atrasa.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
