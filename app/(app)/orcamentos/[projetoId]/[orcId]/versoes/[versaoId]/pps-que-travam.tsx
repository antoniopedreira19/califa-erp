"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { cancelarPPsQueTravamOEnvio } from "./abertura-actions";

/** PP fora de `cancelada` num job de pré-abertura: é o que trava o
 *  "Cancelar aprovação" do job devolvido e o "Cancelar envio à abertura". */
export interface PPQueTravaOEnvio {
  id: string;
  codigo: string;
  fornecedorNome: string;
  valor: number;
}

/** "a PP-00100", "a PP-00100 e a PP-00101", "a PP-00100, a PP-00101 e a PP-00102". */
function listaDeCodigos(codigos: string[]): string {
  const comArtigo = codigos.map((c) => `a ${c}`);
  if (comArtigo.length <= 1) return comArtigo.join("");
  return `${comArtigo.slice(0, -1).join(", ")} e ${comArtigo[comArtigo.length - 1]}`;
}

/**
 * A lista das PPs que travam o cancelamento, dentro do pop-up, com o botão
 * que as cancela depois de um "Tem certeza?" (decisão 143, variante A: dois
 * passos). Canceladas as PPs, a pessoa volta ao pop-up de baixo, que só
 * então libera a própria confirmação.
 *
 * Vai dentro da `description` do `ConfirmDialog` de baixo; o segundo
 * pop-up abre por cima dele.
 */
export function PPsQueTravam({
  jobId,
  pps,
  depois,
}: {
  jobId: string;
  pps: PPQueTravaOEnvio[];
  /** "cancelar a aprovação" / "cancelar o envio" — fecha o texto do
   *  segundo pop-up. */
  depois: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  // Entre o "ok" do servidor e a lista nova chegar pelo `router.refresh`
  // passam alguns segundos; sem isto o pop-up de baixo voltava a oferecer
  // o "Cancelar as N PPs" de PPs já canceladas. Com a lista nova vazia o
  // componente sai da tela, e o pop-up de cima junto.
  const [concluindo, setConcluindo] = React.useState(false);
  const chaveDaLista = pps.map((pp) => pp.id).join(",");
  const chaveAnterior = React.useRef(chaveDaLista);
  React.useEffect(() => {
    if (chaveAnterior.current === chaveDaLista) return;
    chaveAnterior.current = chaveDaLista;
    // Só depois de um cancelamento que deu certo. Na recusa, o pop-up de
    // cima fica aberto com a mensagem e a lista nova.
    if (concluindo) {
      setConcluindo(false);
      setConfirmando(false);
    }
  }, [chaveDaLista, concluindo]);

  if (pps.length === 0) return null;

  const uma = pps.length === 1;
  const codigos = pps.map((pp) => pp.codigo);
  const lista = listaDeCodigos(codigos);

  function handleCancelar() {
    setErro(null);
    startTransition(async () => {
      const res = await cancelarPPsQueTravamOEnvio(
        jobId,
        pps.map((pp) => pp.id),
      );
      if (!res.ok) {
        setErro(res.message);
        // Parte pode ter sido cancelada: a lista de baixo se atualiza.
        router.refresh();
        return;
      }
      setConcluindo(true);
      router.refresh();
    });
  }

  return (
    <>
      <span className="mt-3 block rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-xs text-california-red">
        {uma
          ? "Antes, a PP gerada no job precisa ser cancelada:"
          : `Antes, as ${pps.length} PPs geradas no job precisam ser canceladas:`}
        <span className="mt-1.5 block space-y-0.5">
          {pps.map((pp) => (
            <span key={pp.id} className="block">
              <span className="font-mono font-semibold">{pp.codigo}</span>
              {" · "}
              {pp.fornecedorNome}
              {" · "}
              <span className="font-mono">{formatCurrency(pp.valor)}</span>
            </span>
          ))}
        </span>
        <button
          type="button"
          onClick={() => {
            setErro(null);
            setConfirmando(true);
          }}
          className="mt-2.5 inline-flex items-center rounded-lg border border-california-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 transition-colors"
        >
          {uma ? "Cancelar a PP" : `Cancelar as ${pps.length} PPs`}
        </button>
      </span>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={(o) => !o && !pending && !concluindo && setConfirmando(false)}
        title={uma ? `Cancelar a ${codigos[0]}?` : `Cancelar as ${pps.length} PPs?`}
        description={
          <>
            Tem certeza?{" "}
            {uma
              ? `A ${codigos[0]} será cancelada, e o item volta a permitir uma nova PP.`
              : `${lista.charAt(0).toUpperCase()}${lista.slice(1)} serão canceladas, e os itens voltam a permitir uma nova PP.`}{" "}
            O PDF e os anexos ficam guardados no histórico.
            <span className="mt-3 block">
              Depois você volta ao pop-up anterior para {depois}.
            </span>
            {erro && (
              <span className="mt-3 block text-xs text-california-red">{erro}</span>
            )}
          </>
        }
        confirmLabel={uma ? "Sim, cancelar a PP" : "Sim, cancelar as PPs"}
        cancelLabel="Voltar"
        pending={pending || concluindo}
        onConfirm={handleCancelar}
      />
    </>
  );
}
