"use client";

/**
 * O arquivo da declaração de optante do Simples (IN SRF 459, anexo I) no
 * cadastro do fornecedor (decisão 142). O desenho é o do campo de arquivo
 * do protótipo do módulo fiscal; o comportamento, o dos anexos de Impostos
 * a Pagar (`components/financeiro/anexo-de-imposto.tsx`):
 *
 *   * **escolher sobe na hora**, do navegador para o bucket privado
 *     `fornecedores`, no caminho que o servidor reserva
 *     (`<tenant>/declaracoes/<uuid>-<nome>`);
 *   * o **nome abre o arquivo** numa aba nova (URL assinada de 10 minutos);
 *   * o **✕ tira o arquivo** do campo — para trocar, tira e escolhe outro;
 *   * o que **subiu e não foi gravado** sai do bucket ao ser trocado ou
 *     tirado, e quando o formulário fecha sem salvar — e o servidor não
 *     apaga arquivo que algum cadastro aponta. O arquivo que o cadastro já
 *     tinha nunca sai do bucket: trocado ou tirado, ele deixa o cadastro ao
 *     salvar e fica guardado (o caminho antigo vai para o audit), como a
 *     guia gravada nos impostos.
 */

import * as React from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  BUCKET_DO_FORNECEDOR,
  nomeDoArquivoDaDeclaracao,
  recusaDoArquivoDaDeclaracao,
} from "@/lib/fiscal/regime-do-fornecedor";
import {
  descartarArquivosDaDeclaracao,
  reservarArquivoDaDeclaracao,
  urlDaDeclaracaoSimples,
} from "./actions";

/** Sobe o arquivo e devolve o caminho no bucket. */
async function enviarArquivoDaDeclaracao(
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const recusa = recusaDoArquivoDaDeclaracao(file.name, file.size, file.type);
  if (recusa) return { ok: false, message: recusa };
  const falha = {
    ok: false as const,
    message: `Não foi possível enviar “${file.name}”. Confira a conexão e tente de novo.`,
  };
  const reserva = await reservarArquivoDaDeclaracao({
    nome: file.name,
    tamanho: file.size,
    tipo: file.type,
  }).catch(() => null);
  if (!reserva) return falha;
  if (!reserva.ok) return reserva;
  const { error } = await createClient()
    .storage.from(BUCKET_DO_FORNECEDOR)
    .upload(reserva.path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[fornecedores.declaracao.enviar]", error.message);
    return falha;
  }
  return { ok: true, path: reserva.path };
}

/** Sem esperar e em silêncio: o servidor só apaga o que nenhum cadastro aponta. */
function descartar(paths: string[]) {
  if (paths.length === 0) return;
  void descartarArquivosDaDeclaracao(paths).catch(() => undefined);
}

/**
 * O estado do arquivo no formulário: o caminho à vista, o envio em curso e
 * os arquivos que subiram nesta tela e ainda não foram gravados.
 */
export function useArquivoDaDeclaracao(gravado: string | null) {
  const [path, setPath] = React.useState<string | null>(gravado);
  /** O nome do arquivo que está subindo. */
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const atual = React.useRef<string | null>(gravado);
  /** Subiram nesta tela e não foram gravados: saem ao trocar, tirar ou fechar. */
  const soltos = React.useRef<Set<string>>(new Set());
  const montado = React.useRef(true);

  const trocar = React.useCallback((novo: string | null, enviadoAgora: boolean) => {
    const antigo = atual.current;
    if (antigo && antigo !== novo && soltos.current.has(antigo)) {
      soltos.current.delete(antigo);
      descartar([antigo]);
    }
    if (novo && enviadoAgora) soltos.current.add(novo);
    atual.current = novo;
    setPath(novo);
  }, []);

  const escolher = React.useCallback(
    async (file: File) => {
      setErro(null);
      setEnviando(file.name);
      const res = await enviarArquivoDaDeclaracao(file);
      // Fechou no meio do envio: o arquivo já não tem formulário.
      if (!montado.current) {
        if (res.ok) descartar([res.path]);
        return;
      }
      setEnviando(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      trocar(res.path, true);
    },
    [trocar],
  );

  const tirar = React.useCallback(() => {
    setErro(null);
    trocar(null, false);
  }, [trocar]);

  /**
   * O formulário vai gravar com este caminho: daqui em diante ele é do
   * cadastro — a página de cadastro redireciona sem voltar aqui. Se não
   * gravar, `naoGravou` o devolve aos soltos.
   */
  const gravando = React.useCallback((caminho: string | null) => {
    const vai = caminho && soltos.current.has(caminho) ? caminho : null;
    if (vai) soltos.current.delete(vai);
    return {
      naoGravou: () => {
        if (!vai) return;
        if (atual.current === vai && montado.current) soltos.current.add(vai);
        else descartar([vai]);
      },
    };
  }, []);

  // Fechou sem salvar: o que subiu e ficou solto sai do bucket.
  React.useEffect(() => {
    montado.current = true;
    const pendentes = soltos.current;
    return () => {
      montado.current = false;
      descartar(Array.from(pendentes));
      pendentes.clear();
    };
  }, []);

  return { path, enviando, erro, escolher, tirar, gravando };
}

export type ArquivoDaDeclaracao = ReturnType<typeof useArquivoDaDeclaracao>;

/** Abre o arquivo numa aba nova (URL assinada de 10 minutos). */
function useAbrirDeclaracao() {
  const [abrindo, setAbrindo] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  async function abrir(path: string) {
    setErro(null);
    setAbrindo(true);
    // A aba abre no clique (o navegador barra janela aberta depois de await).
    const aba = window.open("about:blank", "_blank");
    const res = await urlDaDeclaracaoSimples(path).catch(() => null);
    setAbrindo(false);
    if (!res || !res.ok) {
      aba?.close();
      setErro(res && !res.ok ? res.message : "Não foi possível abrir o arquivo.");
      return;
    }
    if (aba) aba.location.href = res.url;
    else window.open(res.url, "_blank", "noopener");
  }
  return { abrir, abrindo, erro };
}

/** O campo "Arquivo da declaração": escolher sobe o arquivo na hora. */
export function CampoArquivoDaDeclaracao({
  arquivo,
  disabled,
  errosDoServidor,
  className,
}: {
  arquivo: ArquivoDaDeclaracao;
  /** Enquanto o cadastro grava: o arquivo à vista é o que está indo. */
  disabled?: boolean;
  errosDoServidor?: string[];
  className?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const { abrir, abrindo, erro: erroAoAbrir } = useAbrirDeclaracao();
  const erro = arquivo.erro ?? erroAoAbrir;
  const path = arquivo.path;

  return (
    <div className={className} data-field="declaracao_simples_path">
      <div className="space-y-1.5">
        {/* O rótulo com o desenho dos rótulos deste formulário. */}
        <p className="text-[12.5px] font-semibold leading-none">Arquivo da declaração</p>
        {arquivo.enviando ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span className="truncate">Enviando {arquivo.enviando}…</span>
          </div>
        ) : path ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm">
            <button
              type="button"
              onClick={() => void abrir(path)}
              className="flex min-w-0 items-center gap-2 text-left hover:text-california-red"
              title="Abrir o arquivo"
            >
              {abrindo ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-california-red" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-california-red" />
              )}
              <span className="truncate">{nomeDoArquivoDaDeclaracao(path)}</span>
            </button>
            <button
              type="button"
              onClick={arquivo.tirar}
              disabled={disabled}
              className="rounded p-1 text-muted-foreground hover:text-california-red disabled:opacity-50"
              aria-label="Remover arquivo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-white px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Selecionar arquivo
            <span className="text-[11px] text-muted-foreground/80">· PDF ou imagem, até 10 MB</span>
          </button>
        )}
        {erro && <p className="text-[11.5px] text-california-red">{erro}</p>}
        {errosDoServidor?.map((msg, i) => (
          <p key={i} className="text-[11.5px] text-california-red">
            {msg}
          </p>
        ))}
        <input
          ref={ref}
          type="file"
          className="hidden"
          accept="application/pdf,image/png,image/jpeg"
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = "";
            if (f) void arquivo.escolher(f);
          }}
        />
      </div>
    </div>
  );
}
