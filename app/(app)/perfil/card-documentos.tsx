"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBase } from "./card-base";
import {
  colaboradorDocumentoTipoLabel,
  type ColaboradorDocumento,
  type ColaboradorDocumentoTipo,
  type TipoContratacao,
} from "@/lib/types";
import { documentosObrigatorios } from "@/lib/perfil/documentos-obrigatorios";
import {
  uploadDocumentoDoMeuPerfil,
  urlAssinadaDoDocumento,
} from "@/lib/perfil/upload-documento-cliente";
import { removerDocumentoDoMeuPerfil } from "@/app/(app)/_boas-vindas/actions";

interface Props {
  colaboradorId: string;
  tenantId: string;
  tipoContratacao: TipoContratacao;
  documentos: ColaboradorDocumento[];
}

const TIPOS_EXTRA: ColaboradorDocumentoTipo[] = ["foto", "outro"];

/**
 * Documentos do próprio colaborador. Lista agrupada por tipo com
 * upload inline (um input por tipo), remover e abrir (URL assinada).
 *
 * Para sócios, o chamador não renderiza este card — tipo_contratacao
 * 'socio' não tem obrigatórios e não é abordado pelo wizard.
 */
export function CardDocumentos({
  colaboradorId,
  tenantId,
  tipoContratacao,
  documentos: documentosProp,
}: Props) {
  const router = useRouter();
  const [documentos, setDocumentos] =
    React.useState<ColaboradorDocumento[]>(documentosProp);
  const [erro, setErro] = React.useState<string | null>(null);
  const [acaoEm, setAcaoEm] = React.useState<string | null>(null);

  // Mantém sincronizado se a prop mudar por refresh do servidor.
  React.useEffect(() => {
    setDocumentos(documentosProp);
  }, [documentosProp]);

  const obrigs = documentosObrigatorios(tipoContratacao);

  const tiposNaOrdem: ColaboradorDocumentoTipo[] = [
    ...obrigs,
    ...TIPOS_EXTRA.filter((t) => documentos.some((d) => d.tipo === t)),
  ];

  async function abrir(path: string) {
    setErro(null);
    const url = await urlAssinadaDoDocumento(path);
    if (!url) {
      setErro("Não consegui gerar o link. Tenta de novo.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function remover(id: string) {
    if (!confirm("Remover este documento?")) return;
    setErro(null);
    setAcaoEm(id);
    const r = await removerDocumentoDoMeuPerfil(id);
    setAcaoEm(null);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    setDocumentos((prev) => prev.filter((d) => d.id !== id));
    router.refresh();
  }

  async function onUpload(tipo: ColaboradorDocumentoTipo, files: FileList) {
    setErro(null);
    setAcaoEm(tipo);
    for (const file of Array.from(files)) {
      const r = await uploadDocumentoDoMeuPerfil({
        tenant_id: tenantId,
        colaborador_id: colaboradorId,
        tipo,
        arquivo: file,
      });
      if (!r.ok) {
        setErro(r.message ?? "Falha no upload.");
        break;
      }
      if (r.id && r.path) {
        const novo: ColaboradorDocumento = {
          id: r.id,
          tenant_id: tenantId,
          colaborador_id: colaboradorId,
          tipo,
          arquivo_path: r.path,
          arquivo_nome: file.name,
          arquivo_tamanho_bytes: file.size,
          mime_type: file.type,
          uploaded_by: null,
          uploaded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setDocumentos((prev) => [novo, ...prev]);
      }
    }
    setAcaoEm(null);
    router.refresh();
  }

  const faltando = obrigs.filter((t) => !documentos.some((d) => d.tipo === t));

  return (
    <CardBase titulo="Documentos" icon={FileText}>
      {erro && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {faltando.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Falta anexar: {faltando.map((t) => colaboradorDocumentoTipoLabel(t)).join(", ")}.
        </div>
      )}

      {tiposNaOrdem.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Nenhum documento anexado ainda.
        </p>
      ) : (
        <ul className="space-y-3">
          {tiposNaOrdem.map((tipo) => {
            const arquivos = documentos.filter((d) => d.tipo === tipo);
            const obrigatorio = obrigs.includes(tipo);
            const vazio = arquivos.length === 0;
            const subindo = acaoEm === tipo;

            return (
              <li
                key={tipo}
                className="rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {colaboradorDocumentoTipoLabel(tipo)}
                    </p>
                    {obrigatorio &&
                      (vazio ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                          <AlertCircle className="h-3 w-3" />
                          Pendente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-900">
                          <CheckCircle2 className="h-3 w-3" />
                          OK
                        </span>
                      ))}
                  </div>
                  <BotaoUpload
                    tipo={tipo}
                    subindo={subindo}
                    onFiles={(files) => onUpload(tipo, files)}
                    label={vazio ? "Enviar" : "Adicionar"}
                  />
                </div>

                {!vazio && (
                  <ul className="space-y-1">
                    {arquivos.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5"
                      >
                        <span
                          className="flex-1 truncate text-foreground"
                          title={a.arquivo_nome}
                        >
                          {a.arquivo_nome}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(a.uploaded_at).toLocaleDateString("pt-BR")}
                        </span>
                        <button
                          type="button"
                          onClick={() => abrir(a.arquivo_path)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Abrir"
                          title="Abrir"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remover(a.id)}
                          disabled={acaoEm === a.id}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                          aria-label="Remover"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </CardBase>
  );
}

function BotaoUpload({
  tipo,
  subindo,
  onFiles,
  label,
}: {
  tipo: ColaboradorDocumentoTipo;
  subindo: boolean;
  onFiles: (files: FileList) => void;
  label: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
            e.target.value = "";
          }
        }}
        className="hidden"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={subindo}
        onClick={() => ref.current?.click()}
        aria-label={`Enviar ${tipo}`}
      >
        {subindo ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <Upload className="h-3 w-3 mr-1" />
        )}
        {label}
      </Button>
    </>
  );
}
