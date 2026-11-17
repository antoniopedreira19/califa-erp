"use client";
// O pop-up que mostra os anexos do pedido (decisão 264, pedido do Tiago em
// 17/11), com a navegação dos anexos da PP: os números 1, 2, 3… no
// cabeçalho do painel. O arquivo que acabou de subir abre pelo próprio
// arquivo; o já gravado, por um endereço temporário.
import * as React from "react";
import { Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PainelDocumento, VazioDoPainel, VisualizadorDeArquivo } from "@/components/documentos/painel-documento";
import { signedUrlAnexoDesembolso } from "./actions";
import { NavegacaoDosAnexos } from "./comum";

export interface AnexoParaVer {
  id: string;
  nome: string;
  imagem: boolean;
  /** O arquivo que acabou de subir (mostrado por ele). */
  file?: File;
  /** O anexo gravado (aberto por endereço temporário). */
  salvo: boolean;
}

/** O endereço para mostrar o anexo: o do arquivo local ou o assinado do gravado. */
export function useEnderecoDoAnexo(anexo: AnexoParaVer | null, ativo: boolean) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => {
    setUrl(null);
    setErro(null);
    if (!ativo || !anexo) return;
    if (anexo.file) {
      const u = URL.createObjectURL(anexo.file);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (!anexo.salvo) return;
    let vivo = true;
    setCarregando(true);
    signedUrlAnexoDesembolso(anexo.id).then((r) => {
      if (!vivo) return;
      setCarregando(false);
      if (r.ok) setUrl(r.url);
      else setErro(r.message);
    });
    return () => {
      vivo = false;
    };
    // O id resume o anexo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anexo?.id, ativo]);
  return { url, carregando, erro };
}

export function VisualizarAnexos({
  itens,
  foco,
  onFechar,
}: {
  itens: AnexoParaVer[];
  /** O anexo que abre primeiro (null = fechado). */
  foco: string | null;
  onFechar: () => void;
}) {
  const [ativo, setAtivo] = React.useState(0);
  const [erroDoPainel, setErroDoPainel] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (foco) setAtivo(Math.max(0, itens.findIndex((x) => x.id === foco)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco]);
  const atual = itens[ativo] ?? itens[0] ?? null;
  const aberto = foco !== null && atual !== null;
  const { url, carregando, erro } = useEnderecoDoAnexo(atual, aberto);
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent
        className="z-[60] flex h-[86vh] w-[1120px] max-w-[94vw] flex-col gap-0 overflow-clip p-0"
        overlayClassName="z-[60]"
      >
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{itens.length > 1 ? "Anexos do pedido" : "Anexo do pedido"}</DialogTitle>
          <DialogDescription>{atual?.nome}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col bg-muted/40 p-3">
          {atual && (
            <PainelDocumento
              icone={<Paperclip className="h-4 w-4 text-violet-700" />}
              titulo={itens.length > 1 ? "Comprovantes" : "Comprovante"}
              legenda={atual.nome}
              oculto={false}
              url={url}
              nomeArquivo={atual.nome}
              expandido={false}
              onExpandir={() => undefined}
              onErro={setErroDoPainel}
              extra={
                <NavegacaoDosAnexos total={itens.length} ativo={ativo} onAtivo={setAtivo} nomes={itens.map((x) => x.nome)} />
              }
            >
              {url ? (
                <VisualizadorDeArquivo key={atual.id} url={url} nome={atual.nome} imagem={atual.imagem} />
              ) : (
                <VazioDoPainel texto={carregando ? "Carregando o anexo..." : erro ?? erroDoPainel ?? "Anexo indisponível."} />
              )}
            </PainelDocumento>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
