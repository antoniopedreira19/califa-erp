"use client";

/**
 * As apresentações do projeto (decisão 213): os arquivos mostrados ao
 * cliente. O campo "Apresentação" do formulário do projeto e a lista que
 * abre cada arquivo no card PROJETO da ficha do job.
 *
 * O comportamento é o da declaração do Simples
 * (`app/(app)/fornecedores/declaracao-simples.tsx`):
 *
 *   * **escolher sobe na hora**, do navegador para o bucket privado, no
 *     caminho que o servidor reserva (`<tenant>/<uuid>-<nome>`);
 *   * quantos arquivos forem: cada um entra na lista e sai pelo ✕;
 *   * o que **subiu e não foi gravado** sai do bucket ao ser tirado da
 *     lista e quando o formulário fecha sem salvar. O arquivo já gravado
 *     que sai da lista deixa o projeto ao salvar (o servidor apaga).
 */

import * as React from "react";
import { AlertCircle, ExternalLink, Loader2, Presentation, UploadCloud, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  BUCKET_DAS_APRESENTACOES,
  EXTENSOES_DA_APRESENTACAO,
  LIMITE_DA_APRESENTACAO_MB,
  recusaDaApresentacao,
  tamanhoLegivel,
  type ApresentacaoDoProjeto,
} from "@/lib/apresentacoes-do-projeto";
import {
  descartarApresentacoes,
  reservarApresentacao,
  urlDaApresentacao,
} from "@/app/(app)/orcamentos/apresentacoes-actions";

/** Sobe o arquivo e devolve a apresentação pronta para a lista. */
async function enviarApresentacao(
  file: File,
): Promise<{ ok: true; apresentacao: ApresentacaoDoProjeto } | { ok: false; message: string }> {
  const recusa = recusaDaApresentacao(file.name, file.size);
  if (recusa) return { ok: false, message: recusa };
  const falha = {
    ok: false as const,
    message: `${file.name}: não foi possível enviar. Confira a conexão e tente de novo.`,
  };
  const reserva = await reservarApresentacao({ nome: file.name, tamanho: file.size }).catch(
    () => null,
  );
  if (!reserva) return falha;
  if (!reserva.ok) return reserva;
  const { error } = await createClient()
    .storage.from(BUCKET_DAS_APRESENTACOES)
    .upload(reserva.path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) {
    console.error("[projetos.apresentacoes.enviar]", error.message);
    return falha;
  }
  return {
    ok: true,
    apresentacao: {
      path: reserva.path,
      nome: file.name,
      tamanho: file.size,
      tipo: file.type || null,
    },
  };
}

/** Sem esperar e em silêncio: o servidor só apaga o que nenhum projeto aponta. */
function descartar(paths: string[]) {
  if (paths.length === 0) return;
  void descartarApresentacoes(paths).catch(() => undefined);
}

/** O estado do campo no formulário: a lista, os envios em curso e os
 *  arquivos que subiram nesta tela e ainda não foram gravados. */
export function useApresentacoesDoProjeto(gravadas: ApresentacaoDoProjeto[]) {
  const [lista, setLista] = React.useState<ApresentacaoDoProjeto[]>(gravadas);
  /** Os nomes dos arquivos que estão subindo. */
  const [enviando, setEnviando] = React.useState<string[]>([]);
  const [erros, setErros] = React.useState<string[]>([]);
  const atual = React.useRef(lista);
  atual.current = lista;
  const soltos = React.useRef<Set<string>>(new Set());
  const montado = React.useRef(true);

  const escolher = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const recusados: string[] = [];
    const vao: File[] = [];
    const nomes = new Set(atual.current.map((a) => a.nome));
    for (const f of files) {
      if (nomes.has(f.name)) {
        recusados.push(`${f.name}: já está na lista.`);
        continue;
      }
      const recusa = recusaDaApresentacao(f.name, f.size);
      if (recusa) recusados.push(recusa);
      else {
        nomes.add(f.name);
        vao.push(f);
      }
    }
    setErros(recusados);
    if (vao.length === 0) return;
    setEnviando((e) => [...e, ...vao.map((f) => f.name)]);
    const resultados = await Promise.all(vao.map(enviarApresentacao));
    // Fechou no meio do envio: os arquivos já não têm formulário.
    if (!montado.current) {
      descartar(resultados.flatMap((r) => (r.ok ? [r.apresentacao.path] : [])));
      return;
    }
    setEnviando((e) => e.filter((n) => !vao.some((f) => f.name === n)));
    const novas: ApresentacaoDoProjeto[] = [];
    for (const r of resultados) {
      if (r.ok) {
        soltos.current.add(r.apresentacao.path);
        novas.push(r.apresentacao);
      } else recusados.push(r.message);
    }
    setErros(recusados);
    if (novas.length > 0) setLista((l) => [...l, ...novas]);
  }, []);

  const tirar = React.useCallback((path: string) => {
    setErros([]);
    if (soltos.current.has(path)) {
      soltos.current.delete(path);
      descartar([path]);
    }
    setLista((l) => l.filter((a) => a.path !== path));
  }, []);

  /**
   * O formulário vai gravar com esta lista: daqui em diante os arquivos
   * são do projeto — a criação redireciona sem voltar aqui. Se não gravar,
   * `naoGravou` os devolve aos soltos.
   */
  const gravando = React.useCallback(() => {
    const vao = atual.current.map((a) => a.path).filter((p) => soltos.current.has(p));
    for (const p of vao) soltos.current.delete(p);
    return {
      naoGravou: () => {
        for (const p of vao) {
          if (montado.current && atual.current.some((a) => a.path === p)) soltos.current.add(p);
          else descartar([p]);
        }
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

  return { lista, enviando, erros, escolher, tirar, gravando };
}

export type ApresentacoesDoForm = ReturnType<typeof useApresentacoesDoProjeto>;

/** O campo "Apresentação": a lista e, embaixo, a área de envio. */
export function CampoApresentacao({
  campo,
  disabled,
}: {
  campo: ApresentacoesDoForm;
  disabled?: boolean;
}) {
  const [arrastando, setArrastando] = React.useState(false);
  const id = React.useId();
  const { lista, enviando, erros, escolher, tirar } = campo;

  return (
    <div className="space-y-2">
      {/* O servidor lê a lista daqui (`lerApresentacoesDoForm`). */}
      <input type="hidden" name="apresentacoes" value={JSON.stringify(lista)} />
      {(lista.length > 0 || enviando.length > 0) && (
        <ul className="space-y-1.5">
          {lista.map((a) => (
            <li
              key={a.path}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
            >
              <Presentation className="h-4 w-4 flex-none text-california-red" />
              <span
                className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
                title={a.nome}
              >
                {a.nome}
              </span>
              <span className="flex-none font-mono text-[11px] text-muted-foreground">
                {tamanhoLegivel(a.tamanho)}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => tirar(a.path)}
                title={`Tirar ${a.nome}`}
                aria-label={`Tirar ${a.nome}`}
                className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-california-red/10 hover:text-california-red disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {enviando.map((nome) => (
            <li
              key={`enviando-${nome}`}
              className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2"
            >
              <Loader2 className="h-4 w-4 flex-none animate-spin text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={nome}>
                {nome}
              </span>
              <span className="flex-none text-[11px] text-muted-foreground">Enviando…</span>
            </li>
          ))}
        </ul>
      )}
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (!disabled) void escolher(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-3.5 py-2.5 transition-colors",
          arrastando
            ? "border-california-red/60 bg-california-red/5"
            : "border-border bg-muted/20 hover:border-california-red/40 hover:bg-california-red/5",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <UploadCloud className="h-6 w-6 flex-none text-california-red/70" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {lista.length ? "Anexar outra" : "Anexar apresentação"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            PDF, PPT ou Keynote · até {LIMITE_DA_APRESENTACAO_MB} MB
          </span>
        </span>
        <span className="flex-none rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground">
          Procurar
        </span>
      </label>
      <input
        id={id}
        type="file"
        multiple
        disabled={disabled}
        accept={EXTENSOES_DA_APRESENTACAO.join(",")}
        className="sr-only"
        onChange={(e) => {
          void escolher(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {erros.length > 0 && (
        <div className="space-y-0.5">
          {erros.map((m) => (
            <p key={m} className="flex items-start gap-1.5 text-xs text-california-red">
              <AlertCircle className="mt-px h-3.5 w-3.5 flex-none" />
              {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** A lista do card PROJETO da ficha do job: cada nome abre o arquivo numa
 *  aba nova (URL assinada de 10 minutos). */
export function ApresentacoesDaFicha({
  apresentacoes,
}: {
  apresentacoes: ApresentacaoDoProjeto[];
}) {
  const [abrindo, setAbrindo] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  async function abrir(path: string) {
    setErro(null);
    setAbrindo(path);
    // A aba abre no clique (o navegador barra janela aberta depois de await).
    const aba = window.open("about:blank", "_blank");
    const res = await urlDaApresentacao(path).catch(() => null);
    setAbrindo(null);
    if (!res || !res.ok) {
      aba?.close();
      setErro(res && !res.ok ? res.message : "Não foi possível abrir o arquivo.");
      return;
    }
    if (aba) aba.location.href = res.url;
    else window.open(res.url, "_blank", "noopener");
  }

  if (apresentacoes.length === 0) {
    return <p className="mt-0.5 text-sm text-muted-foreground">Nenhuma anexada</p>;
  }
  return (
    <div className="mt-1.5 space-y-1.5">
      {apresentacoes.map((a) => (
        <button
          key={a.path}
          type="button"
          onClick={() => void abrir(a.path)}
          disabled={abrindo === a.path}
          className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5 disabled:opacity-60"
        >
          {abrindo === a.path ? (
            <Loader2 className="h-4 w-4 flex-none animate-spin text-california-red" />
          ) : (
            <Presentation className="h-4 w-4 flex-none text-california-red" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={a.nome}>
            {a.nome}
          </span>
          <span className="flex-none font-mono text-[11px] text-muted-foreground">
            {tamanhoLegivel(a.tamanho)}
          </span>
          <ExternalLink className="h-3.5 w-3.5 flex-none text-muted-foreground group-hover:text-california-red" />
        </button>
      ))}
      {erro && (
        <p className="flex items-start gap-1.5 text-xs text-california-red">
          <AlertCircle className="mt-px h-3.5 w-3.5 flex-none" />
          {erro}
        </p>
      )}
    </div>
  );
}
