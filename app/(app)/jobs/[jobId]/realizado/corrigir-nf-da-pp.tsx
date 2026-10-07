"use client";

/**
 * "Corrigir a NF" da PP em avaliação (revisão da decisão 152, 07/10/2026).
 *
 * A PP já está no financeiro e a NF foi enviada errada. Antes, só o
 * financeiro corrigia, e só aprovando. Agora quem envia (GP e
 * administrador) e o financeiro corrigem daqui, sem aprovar:
 *
 *  • o valor da NF nesta PP, sempre — até o valor da nota, até o valor da
 *    PP e até o que sobra da nota depois das outras PPs;
 *  • os dados da nota (número, emissão, valor e CNPJ tomador) enquanto o
 *    financeiro não a registrou; a correção vale para todas as PPs com ela.
 *
 * Abre pelo painel do item (a PP "Já no financeiro") e pelo envio de outra
 * PP com a mesma nota ("Corrigir a PP-…"). O banco confere tudo de novo
 * (`corrigir_notas_fiscais_da_pp`).
 */

import * as React from "react";
import { Eye, FileText, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { signedUrlAnexo } from "./actions-pp";
import {
  carregarNfsDaPPParaCorrigir,
  corrigirNfsDaPP,
  type PPParaCorrigirNf,
} from "./actions-notas-da-pp";
import {
  NfDoAnexo,
  ResumoDasNfs,
  faltaNasNfs,
  faltasDaNf,
  notaExistenteDe,
  parteDaNf,
  useNotasExistentes,
  type NfDigitada,
  type TomadorDaNf,
} from "./anexos-da-pp";

interface NfEmCorrecao {
  anexoId: string;
  nome: string;
  nf: NfDigitada;
}

export function CorrigirNfDialog({
  alvo,
  onOpenChange,
  fornecedorNome,
  nomeDaEmpresa,
  tomadores,
  tomadorPorEmpresa,
  onCorrigida,
}: {
  /** A PP em avaliação a corrigir (null = fechado). */
  alvo: { id: string; codigo: string } | null;
  onOpenChange: (o: boolean) => void;
  fornecedorNome: string;
  nomeDaEmpresa: (empresaId: string) => string;
  tomadores: TomadorDaNf[];
  tomadorPorEmpresa: Record<string, string>;
  onCorrigida: (codigo: string) => void;
}) {
  const [pp, setPp] = React.useState<PPParaCorrigirNf | null>(null);
  const [nfs, setNfs] = React.useState<NfEmCorrecao[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const [tentou, setTentou] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // Cada abertura começa no que a PP tem gravado.
  const alvoId = alvo?.id ?? null;
  React.useEffect(() => {
    if (!alvoId) return;
    setPp(null);
    setNfs([]);
    setErro(null);
    setTentou(false);
    let vivo = true;
    carregarNfsDaPPParaCorrigir(alvoId).then((res) => {
      if (!vivo) return;
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPp(res.pp);
      setNfs(
        res.pp.nfs.map((n) => ({
          anexoId: n.anexo_id,
          nome: n.nome,
          nf: {
            numero: n.numero,
            emissao: n.emissao,
            valor: n.valor,
            tomador: n.tomador ?? tomadorPorEmpresa[res.pp.empresa_id] ?? "",
            valorNaPP: n.valor_na_pp ?? n.valor,
            cobreOutra: n.valor_na_pp !== null && n.valor > 0 && Math.abs(n.valor_na_pp - n.valor) > 0.004,
          },
        })),
      );
    });
    return () => {
      vivo = false;
    };
    // Só quando outra PP abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvoId]);

  const existentes = useNotasExistentes(
    pp?.fornecedor_id ?? null,
    nfs.map((n) => n.nf.numero),
    pp?.id ?? null,
  );

  if (!alvo) return null;

  // Só o que mudou, juntado ao estado mais novo: o DatePicker guarda a
  // função da primeira renderização.
  function mudarNf(anexoId: string, parte: Partial<NfDigitada>) {
    setNfs((atuais) => atuais.map((n) => (n.anexoId === anexoId ? { ...n, nf: { ...n.nf, ...parte } } : n)));
  }

  function verNota(anexoId: string) {
    startTransition(async () => {
      const res = await signedUrlAnexo(anexoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function salvar() {
    if (!pp) return;
    setTentou(true);
    const falta = faltaNasNfs(
      nfs.map((n) => ({ nome: n.nome, nf: n.nf })),
      pp.valor,
      existentes,
    );
    if (falta) {
      setErro(falta);
      return;
    }
    setErro(null);
    const alvoPP = pp;
    startTransition(async () => {
      const res = await corrigirNfsDaPP({
        ppId: alvoPP.id,
        notas: nfs.map((n) => ({
          anexo_id: n.anexoId,
          numero: n.nf.numero.trim(),
          data_emissao: n.nf.emissao,
          valor: n.nf.valor,
          tomador_estabelecimento_id: n.nf.tomador,
          valor_na_pp: parteDaNf(n.nf),
        })),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onCorrigida(res.codigo);
    });
  }

  const empresaNome = pp ? nomeDaEmpresa(pp.empresa_id) : "";
  const tomadorEsperado = pp ? (tomadorPorEmpresa[pp.empresa_id] ?? null) : null;

  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-[680px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="text-[17px]">
            Corrigir a NF da <span className="font-mono">{alvo.codigo}</span>
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            {pp ? (
              <>
                {fornecedorNome} · <span className="font-mono">{formatCurrency(pp.valor, "BRL")}</span>
                {pp.servico ? <> · {pp.servico}</> : null}. A PP segue em avaliação no financeiro; a correção fica
                registrada no seu nome.
              </>
            ) : (
              "Carregando a PP…"
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="relative max-h-[70vh] space-y-3 overflow-y-auto px-6 py-4">
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-california-red/40 bg-california-red/5 px-3 py-2 text-[12.5px] text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {!pp && !erro && (
            <p className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando as notas…
            </p>
          )}
          {pp &&
            nfs.map((n) => (
              <div key={n.anexoId} className="overflow-hidden rounded-xl border border-border bg-white">
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-california-red/5 text-california-red">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{n.nome}</span>
                  <button
                    type="button"
                    onClick={() => verNota(n.anexoId)}
                    disabled={pending}
                    title="Ver a nota"
                    aria-label="Ver a nota"
                    className="inline-flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="border-t border-border px-3.5 py-3">
                  <NfDoAnexo
                    nf={n.nf}
                    onMudar={(parte) => mudarNf(n.anexoId, parte)}
                    faltas={tentou ? faltasDaNf(n.nf, pp.valor) : []}
                    idBase={`corrigir-${n.anexoId}`}
                    tomadores={tomadores}
                    tomadorEsperado={tomadorEsperado}
                    empresaNome={empresaNome}
                    existente={notaExistenteDe(existentes, n.nf.numero)}
                    valorPP={pp.valor}
                    modo="correcao"
                    obrigatorio
                    disabled={pending}
                  />
                </div>
              </div>
            ))}
          {pp && <ResumoDasNfs valores={nfs.map((n) => parteDaNf(n.nf))} valorPP={pp.valor} />}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pending || !pp}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar correção"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
