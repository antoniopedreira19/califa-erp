"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  FileSignature,
  FileText,
  FileX2,
  History,
  Loader2,
  Upload,
} from "lucide-react";
import {
  anexarNfPorEscopoForm,
  baixarNfColaborador,
  removerNfPorEscopo,
} from "@/lib/nf/anexos-actions";
import {
  anexarTermoQuitacao,
  baixarTermoQuitacao,
  removerTermoQuitacao,
} from "@/lib/rescisao/termo-quitacao-actions";
import { rescisaoStatusLabel, type RescisaoStatus } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

interface RescisaoAtiva {
  id: string;
  colaborador_id: string;
  data_rescisao: string;
  status: RescisaoStatus;
  total_liquido: number | null;
  termo_quitacao_nome: string | null;
  termo_quitacao_uploaded_at: string | null;
}

interface NfAnexada {
  id: string;
  arquivo_nome: string;
  uploaded_at: string;
}

interface Props {
  rescisao: RescisaoAtiva | null;
  nfAnexada: NfAnexada | null;
  dataEncerramento: string | null;
}

const STATUS_STYLE: Record<RescisaoStatus, { chip: string; dot: string }> = {
  rascunho: {
    chip: "bg-slate-50 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  },
  enviada_financeiro: {
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
  },
  paga: {
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  cancelada: {
    chip: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
  },
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function CardRescisao({ rescisao, nfAnexada, dataEncerramento }: Props) {
  if (!rescisao) {
    return (
      <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
        <HeaderRescisao />
        {dataEncerramento ? (
          <p className="text-sm text-foreground">
            Colaborador encerrado em{" "}
            <span className="font-semibold tabular-nums">
              {formatDate(dataEncerramento)}
            </span>
            . A rescisão ainda não foi aberta — gere em{" "}
            <span className="font-medium">/rh/rescisoes</span>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma rescisão registrada. Esta seção reúne NF, termo de
            quitação e documentos quando o colaborador for encerrado.
          </p>
        )}
      </div>
    );
  }

  const style = STATUS_STYLE[rescisao.status];

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft space-y-4">
      <div className="flex items-center justify-between gap-2">
        <HeaderRescisao />
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold shrink-0",
            style.chip,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
          {rescisaoStatusLabel(rescisao.status)}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">Data da rescisão: </span>
          <span className="font-semibold tabular-nums">
            {formatDate(rescisao.data_rescisao)}
          </span>
        </div>
        {rescisao.total_liquido !== null && (
          <div>
            <span className="text-xs text-muted-foreground">Líquido: </span>
            <span className="font-semibold tabular-nums">
              {brl.format(rescisao.total_liquido)}
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SlotNfRescisao
          rescisaoId={rescisao.id}
          colaboradorId={rescisao.colaborador_id}
          nf={nfAnexada}
        />
        <SlotTermoQuitacao
          rescisaoId={rescisao.id}
          nome={rescisao.termo_quitacao_nome}
          uploadedAt={rescisao.termo_quitacao_uploaded_at}
        />
      </div>
    </div>
  );
}

function HeaderRescisao() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
        <FileX2 className="h-3.5 w-3.5" />
      </div>
      <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
        Rescisão
      </h3>
    </div>
  );
}

function SlotNfRescisao({
  rescisaoId,
  colaboradorId: _colaboradorId,
  nf,
}: {
  rescisaoId: string;
  colaboradorId: string;
  nf: NfAnexada | null;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErro(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("escopoTipo", "rescisao");
      fd.set("escopoId", rescisaoId);
      fd.set("file", file);
      const r = await anexarNfPorEscopoForm(fd);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  function handleBaixar() {
    if (!nf) return;
    setErro(null);
    startTransition(async () => {
      const r = await baixarNfColaborador(nf.id);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleRemover() {
    if (!nf) return;
    if (!confirm("Remover a NF anexada?")) return;
    setErro(null);
    startTransition(async () => {
      const r = await removerNfPorEscopo({
        escopoTipo: "rescisao",
        escopoId: rescisaoId,
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-california-red" />
        <h4 className="text-sm font-semibold">NF de rescisão</h4>
      </div>

      {nf ? (
        <div className="flex items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="truncate">
            {nf.arquivo_nome} ·{" "}
            {new Date(nf.uploaded_at).toLocaleDateString("pt-BR")}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhuma NF anexada. Aceita PDF até 10 MB.
        </p>
      )}

      {erro && (
        <p className="text-xs text-california-red">{erro}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={handleArquivo}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {nf ? "Substituir" : "Anexar NF"}
        </button>
        {nf && (
          <>
            <button
              type="button"
              onClick={handleBaixar}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar
            </button>
            <button
              type="button"
              onClick={handleRemover}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-muted-foreground hover:text-california-red transition-colors disabled:opacity-50"
            >
              <History className="h-3.5 w-3.5" />
              Remover
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SlotTermoQuitacao({
  rescisaoId,
  nome,
  uploadedAt,
}: {
  rescisaoId: string;
  nome: string | null;
  uploadedAt: string | null;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const existe = !!nome;

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErro(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("rescisaoId", rescisaoId);
      fd.set("file", file);
      const r = await anexarTermoQuitacao(fd);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  function handleBaixar() {
    setErro(null);
    startTransition(async () => {
      const r = await baixarTermoQuitacao({ rescisaoId });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleRemover() {
    if (!confirm("Remover o termo de quitação?")) return;
    setErro(null);
    startTransition(async () => {
      const r = await removerTermoQuitacao({ rescisaoId });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileSignature className="h-4 w-4 text-california-red" />
        <h4 className="text-sm font-semibold">Termo de quitação</h4>
      </div>

      {existe ? (
        <div className="flex items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="truncate">
            {nome}
            {uploadedAt && (
              <>
                {" · "}
                {new Date(uploadedAt).toLocaleDateString("pt-BR")}
              </>
            )}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Anexe o termo assinado pelo colaborador. Aceita PDF até 10 MB.
        </p>
      )}

      {erro && (
        <p className="text-xs text-california-red">{erro}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={handleArquivo}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-all"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {existe ? "Substituir" : "Anexar termo"}
        </button>
        {existe && (
          <>
            <button
              type="button"
              onClick={handleBaixar}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar
            </button>
            <button
              type="button"
              onClick={handleRemover}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-muted-foreground hover:text-california-red transition-colors disabled:opacity-50"
            >
              <History className="h-3.5 w-3.5" />
              Remover
            </button>
          </>
        )}
      </div>
    </div>
  );
}
