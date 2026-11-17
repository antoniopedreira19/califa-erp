import Link from "next/link";
import { History } from "lucide-react";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import type { ExtratoAntesDoInicio } from "./extrato-antes-do-inicio";

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * A faixa do Extrato contínuo (16/11/2026): até a véspera do início, o
 * histórico e as baixas antigas, só para leitura; o saldo do banco no início;
 * e a diferença, que fica na linha do ajuste de abertura. Quando a véspera
 * não está no período, o link leva ao mês dela.
 */
export function AvisoDoAjusteDeAbertura({ antes, contaId }: { antes: ExtratoAntesDoInicio; contaId: string }) {
  const vesperaNoPeriodo = antes.periodo?.ate === antes.vespera;
  const semDiferenca = Math.abs(antes.ajuste) < 0.005;
  const mes = mesDe(antes.vespera);
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
      <History className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
      <p>
        Até {formatDiaBr(antes.vespera)}, o extrato mostra o <strong className="text-foreground">histórico da planilha</strong> e
        as baixas do sistema com data anterior, só para leitura. A conta começa no sistema em {formatDiaBr(antes.corte)} com
        o saldo do banco, {dinheiro(antes.saldoInicial)}.{" "}
        {semDiferenca ? (
          "O histórico fecha com o saldo do banco."
        ) : (
          <>
            A diferença para o histórico,{" "}
            <strong className="text-amber-800">{dinheiro(antes.ajuste)}</strong>, fica na linha &ldquo;Ajuste de
            abertura&rdquo; de {formatDiaBr(antes.vespera)}
            {!vesperaNoPeriodo && (
              <>
                {" "}
                (
                <Link
                  href={`/financeiro/conciliacao?conta=${contaId}&de=${mes.de}&ate=${mes.ate}`}
                  prefetch={false}
                  className="font-semibold text-california-red hover:underline"
                >
                  ver {mes.nome}
                </Link>
                )
              </>
            )}
            . Ela diminui sozinha à medida que os lançamentos que faltam entram no histórico.
          </>
        )}
      </p>
    </div>
  );
}

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O mês da data, do primeiro ao último dia, e o nome dele. */
function mesDe(data: string): { de: string; ate: string; nome: string } {
  const [ano, mes] = data.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return {
    de: `${ano}-${mm}-01`,
    ate: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}`,
    nome: `${MESES[mes - 1]} de ${ano}`,
  };
}
