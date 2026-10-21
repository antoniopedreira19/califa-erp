"use client";

/**
 * "Exportar remessa Santander" na aba Títulos da conciliação (decisão 195):
 * o primeiro clique lê os títulos da remessa e abre o MESMO diálogo de
 * Títulos a Pagar; daí em diante o botão é o dele.
 */

import * as React from "react";
import { Landmark, Loader2 } from "lucide-react";
import { ExportarRemessaCnabDialog } from "../contas-a-pagar/remessa-cnab-dialog";
import { carregarDadosDaRemessa } from "./actions-remessa";

type Dados = Extract<Awaited<ReturnType<typeof carregarDadosDaRemessa>>, { ok: true }>;

export function BotaoRemessaSantander() {
  const [dados, setDados] = React.useState<Dados | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  if (dados) {
    return (
      <ExportarRemessaCnabDialog
        contasSantander={dados.contasSantander}
        titulos={dados.titulos}
        canGerar={dados.canGerar}
        abrirAoMontar
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {erro && <span className="text-xs text-california-red">{erro}</span>}
      <button
        type="button"
        disabled={carregando}
        onClick={() => {
          setCarregando(true);
          setErro(null);
          carregarDadosDaRemessa()
            .then((r) => (r.ok ? setDados(r) : setErro(r.message)))
            .catch(() => setErro("Não foi possível ler os títulos da remessa. Tente de novo."))
            .finally(() => setCarregando(false));
        }}
        className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-california-red bg-white px-4 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red hover:text-white disabled:cursor-wait disabled:opacity-60"
      >
        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
        Exportar remessa Santander
      </button>
    </span>
  );
}
