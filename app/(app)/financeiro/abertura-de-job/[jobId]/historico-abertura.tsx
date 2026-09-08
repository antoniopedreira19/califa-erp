"use client";

/**
 * O histórico da abertura na tela — decisão 059 (08/09/2026).
 *
 * Três peças, para dois momentos do mesmo formulário:
 *
 *   * `HistoricoDaAbertura` — a faixa do topo no job já aberto: a
 *     abertura e cada revisão ou edição depois dela, uma linha por foto,
 *     cada uma com o seu "Visualizar". Substituiu a faixa "somente
 *     leitura · aberto em … por …", que só sabia da abertura.
 *   * `ResumoDaAberturaAnterior` — a faixa do topo durante a REVISÃO:
 *     a errata que pediu a revisão e a abertura anterior em uma linha,
 *     com o botão que abre a foto inteira. É o que a pessoa olha enquanto
 *     reconfere previsão, curva e competência sobre os números novos.
 *   * `FotoDaAberturaDialog` — a foto inteira, em leitura: registro,
 *     rateio, parcelas de recebimento e cronograma de desembolsos.
 *
 * Nada aqui grava. A foto é imutável por desenho.
 */

import * as React from "react";
import {
  Eye,
  FilePenLine,
  History,
  Landmark,
  Lock,
  Pencil,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import {
  rateioLabel,
  rotuloDaFoto,
  type FotoDaAbertura,
  type LinhaPrevisaoFoto,
} from "@/lib/types";
import type { RevisaoDeErrata } from "../dados";
import { formatDataBr, formatDataHoraBr } from "../formatos";

/** "08/09/2026 · 03:30 · Tiago Mendonça" */
function quandoEQuem(foto: FotoDaAbertura): string {
  return [foto.registradoEmLabel, foto.registradoPorNome]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------
// A faixa do job aberto: uma linha por foto
// ---------------------------------------------------------------------

export function HistoricoDaAbertura({
  fotos,
  onEditar,
}: {
  fotos: FotoDaAbertura[];
  /** "Editar registro". Ausente quando o job não aceita edição. */
  onEditar?: () => void;
}) {
  const [aberta, setAberta] = React.useState<FotoDaAbertura | null>(null);
  const atual = fotos[fotos.length - 1] ?? null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-center gap-2.5 px-[18px] py-3">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">
          Registro da abertura · somente leitura
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          {atual
            ? `o formulário abaixo mostra o registro como está desde ${atual.registradoEmLabel}`
            : "o registro como foi confirmado"}
        </span>
        {onEditar && (
          <button
            type="button"
            onClick={onEditar}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-[7px] text-[12.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar registro
          </button>
        )}
      </div>

      {fotos.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {fotos.map((foto) => (
            <li
              key={foto.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2"
            >
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-[12.5px] font-semibold">
                {rotuloDaFoto(foto)}
              </span>
              {foto.errata && foto.errata.titulo && (
                <span className="max-w-[360px] truncate text-[12px] italic text-muted-foreground">
                  “{foto.errata.titulo}”
                </span>
              )}
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {quandoEQuem(foto)}
              </span>
              {foto.reconstituida && (
                <span
                  title="Foto montada em 08/09/2026 do registro como estava naquele dia — antes disso a abertura não guardava foto."
                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-[1px] text-[10px] font-semibold text-amber-700"
                >
                  reconstituída
                </span>
              )}
              <button
                type="button"
                onClick={() => setAberta(foto)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-[5px] text-[12px] font-semibold transition-colors hover:bg-muted"
              >
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                Visualizar
              </button>
            </li>
          ))}
        </ul>
      )}

      <FotoDaAberturaDialog
        foto={aberta}
        onOpenChange={(o) => !o && setAberta(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// A faixa da revisão: a errata e a abertura anterior
// ---------------------------------------------------------------------

export function ResumoDaAberturaAnterior({
  foto,
  revisao,
}: {
  /** A última foto — o registro que a revisão vai substituir. */
  foto: FotoDaAbertura | null;
  revisao: RevisaoDeErrata | null;
}) {
  const [aberta, setAberta] = React.useState(false);

  return (
    <div className="rounded-2xl border border-california-red/30 bg-california-red/[0.04] px-[18px] py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <FilePenLine className="h-3.5 w-3.5 text-california-red" />
        <span className="text-[12.5px] font-semibold">
          Revisão da abertura após errata
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          reconfira previsão de recebimento, curva de desembolso e
          competência sobre os números novos — a data e o usuário da
          abertura não mudam
        </span>
      </div>

      {revisao && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          Errata{" "}
          <span className="italic text-foreground">“{revisao.descricao}”</span>
          {revisao.autorNome ? ` · ${revisao.autorNome}` : ""} ·{" "}
          {formatDataHoraBr(revisao.em)} · faturamento previsto{" "}
          <span className="font-mono line-through">
            {formatCurrency(revisao.faturamentoAntes ?? 0)}
          </span>{" "}
          <span className="font-mono font-semibold text-foreground">
            {formatCurrency(revisao.faturamentoDepois ?? 0)}
          </span>{" "}
          · {revisao.linhasAlteradas} alterada
          {revisao.linhasAlteradas === 1 ? "" : "s"} · {revisao.linhasNovas} nova
          {revisao.linhasNovas === 1 ? "" : "s"} · {revisao.linhasRemovidas}{" "}
          removida{revisao.linhasRemovidas === 1 ? "" : "s"}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-white px-3.5 py-2.5">
        <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {foto ? (
          <>
            <span className="text-[12.5px] font-semibold">
              Abertura anterior · {rotuloDaFoto(foto)}
            </span>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {quandoEQuem(foto)}
            </span>
            <span className="text-[12px] text-muted-foreground">
              faturamento previsto{" "}
              <span className="font-mono text-foreground">
                {formatCurrency(foto.faturamentoPrevisto ?? 0)}
              </span>{" "}
              · custo previsto{" "}
              <span className="font-mono text-foreground">
                {formatCurrency(foto.custoPrevisto ?? 0)}
              </span>{" "}
              · competência{" "}
              <span className="font-mono text-foreground">
                {rateioLabel(foto.competencias)}
              </span>{" "}
              · {foto.recebimento.length}{" "}
              {foto.recebimento.length === 1 ? "parcela" : "parcelas"} ·{" "}
              {foto.curva.length}{" "}
              {foto.curva.length === 1 ? "data de custo" : "datas de custo"}
            </span>
            <button
              type="button"
              onClick={() => setAberta(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-[5px] text-[12px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
            >
              <Eye className="h-3.5 w-3.5" />
              Ver abertura anterior
            </button>
          </>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">
            Este job não tem foto da abertura anterior.
          </span>
        )}
      </div>

      <FotoDaAberturaDialog
        foto={aberta ? foto : null}
        onOpenChange={(o) => !o && setAberta(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// A foto inteira, em leitura
// ---------------------------------------------------------------------

function Linha({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] text-muted-foreground">{rotulo}</span>
      <span
        className={cn(
          "text-right text-[12.5px] font-semibold",
          mono && "font-mono",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

function TabelaPrevisao({
  titulo,
  linhas,
  total,
  vazio,
}: {
  titulo: string;
  linhas: LinhaPrevisaoFoto[];
  total: number;
  vazio: string;
}) {
  const soma = linhas.reduce((s, l) => s + l.valor, 0);
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-baseline justify-between border-b border-border bg-muted/50 px-3.5 py-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {titulo}
        </span>
        <span className="font-mono text-[11.5px] font-semibold">
          {formatCurrency(total)}
        </span>
      </div>
      {linhas.length === 0 ? (
        <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">
          {vazio}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {linhas.map((l, i) => (
            <li
              key={`${l.data_prevista}-${i}`}
              className="flex items-center justify-between gap-3 px-3.5 py-1.5"
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 font-mono text-[12px]">
                {formatDataBr(l.data_prevista)}
              </span>
              <span className="font-mono text-[12px] font-semibold">
                {formatCurrency(l.valor)}
              </span>
              <span className="w-14 text-right font-mono text-[11px] text-muted-foreground">
                {total > 0
                  ? `${((l.valor / total) * 100).toFixed(1).replace(".", ",")}%`
                  : "—"}
              </span>
            </li>
          ))}
          {Math.abs(soma - total) >= 0.005 && (
            <li className="px-3.5 py-1.5 text-[11px] text-amber-700">
              As linhas somam {formatCurrency(soma)} — não fecham com o total
              registrado.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function FotoDaAberturaDialog({
  foto,
  onOpenChange,
}: {
  foto: FotoDaAbertura | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  return (
    <Dialog open={foto !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[640px] overflow-y-auto">
        {foto && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
                  <Landmark className="h-[18px] w-[18px] text-california-red" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px]">
                    {rotuloDaFoto(foto)}
                  </DialogTitle>
                  <DialogDescription className="pt-1 text-[12.5px] leading-relaxed">
                    Registrada em {quandoEQuem(foto)}
                    {foto.errata?.titulo ? (
                      <>
                        {" "}
                        · errata{" "}
                        <span className="italic text-foreground">
                          “{foto.errata.titulo}”
                        </span>
                      </>
                    ) : null}
                    {foto.reconstituida && (
                      <>
                        {" "}
                        ·{" "}
                        <span className="text-amber-700">
                          reconstituída em 08/09/2026 do registro como estava
                          naquele dia
                        </span>
                      </>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { rotulo: "Valor do job", valor: foto.valorJob },
                  { rotulo: "Faturamento previsto", valor: foto.faturamentoPrevisto },
                  { rotulo: "Custo previsto", valor: foto.custoPrevisto },
                ].map((c) => (
                  <div
                    key={c.rotulo}
                    className="rounded-xl border border-border bg-muted/30 px-3 py-2.5"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {c.rotulo}
                    </p>
                    <p className="mt-0.5 font-mono text-[14px] font-bold">
                      {c.valor === null ? "—" : formatCurrency(c.valor)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3.5">
                <Linha rotulo="Nome do job" valor={foto.nomeFinanceiro ?? "—"} />
                <Linha rotulo="Projeto" valor={foto.projetoLabel ?? "—"} />
                <Linha rotulo="Categoria" valor={foto.categoriaNome ?? "—"} />
                <Linha rotulo="Serviço" valor={foto.servicoNome ?? "—"} />
                <Linha
                  rotulo="Competência"
                  valor={rateioLabel(foto.competencias)}
                  mono
                />
                <Linha
                  rotulo="Conta de recebimento"
                  valor={foto.contaRecebimentoLabel ?? "Não definida"}
                />
                <Linha
                  rotulo="Conta de pagamento"
                  valor={foto.contaPagamentoLabel ?? "Não definida"}
                />
              </div>

              <TabelaPrevisao
                titulo="Parcelas de recebimento"
                linhas={foto.recebimento}
                total={foto.faturamentoPrevisto ?? 0}
                vazio="Sem faturamento previsto — nenhuma parcela."
              />
              <TabelaPrevisao
                titulo="Cronograma de desembolsos"
                linhas={foto.curva}
                total={foto.custoPrevisto ?? 0}
                vazio="Sem desembolso previsto pela California — nenhuma data."
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
