/**
 * O contato de cobrança do job, nas telas do financeiro.
 *
 * A produção informa no envio para abertura e o sistema exige ao menos um
 * (`docs/decisions/012`). Até 17/08/2026 o dado era só de escrita: a
 * única leitura existia no modal "Ver dados do job", do lado do
 * orçamento — ou seja, quem precisava cobrar não enxergava a quem cobrar,
 * e a justificativa da própria feature não se cumpria.
 *
 * Duas apresentações, porque são dois contextos:
 *
 *   <ContatosCobrancaCaixa>  — bloco, no padrão visual da caixa do
 *                              "Descritivo do Job". Para a conferência da
 *                              fila e para o job aberto.
 *   <ContatosCobrancaInline> — compacto, para caber dentro da célula de
 *                              uma tabela densa (Faturamento e Títulos a
 *                              Receber).
 *
 * As duas moram aqui de propósito. O mesmo bloco copiado em quatro
 * arquivos foi como as cores das planilhas divergiram entre si
 * (`docs/09-identidade-visual-ui.md`).
 */

import { Mail, Phone, UserRound } from "lucide-react";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";

export type { ContatoCobranca };

/** Job anterior à Tela 1.6 não tem contato — é estado legítimo. */
const SEM_CONTATO = "Sem contato de cobrança informado.";

function Linha({ contato }: { contato: ContatoCobranca }) {
  const nome = contato.nome?.trim();
  const email = contato.email?.trim();
  const numero = contato.numero?.trim();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {nome || "Sem nome"}
      </span>
      {email && (
        <a
          href={`mailto:${email}`}
          className="inline-flex items-center gap-1.5 text-california-red hover:underline"
        >
          <Mail className="h-3.5 w-3.5 shrink-0" />
          {email}
        </a>
      )}
      {numero && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          {numero}
        </span>
      )}
    </div>
  );
}

export function ContatosCobrancaCaixa({
  contatos,
  titulo = "Contato de cobrança",
}: {
  contatos: ContatoCobranca[];
  /** `null` para quem já tem um cabeçalho próprio em volta da caixa. */
  titulo?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      {titulo ? (
        <p className="text-[12.5px] font-semibold">{titulo}</p>
      ) : null}
      <div className="space-y-2 rounded-lg border border-border bg-muted px-3.5 py-3 text-[12.5px] leading-relaxed">
        {contatos.length === 0 ? (
          <span className="text-muted-foreground">{SEM_CONTATO}</span>
        ) : (
          contatos.map((c, i) => <Linha key={i} contato={c} />)
        )}
      </div>
    </div>
  );
}

export function ContatosCobrancaInline({
  contatos,
}: {
  contatos: ContatoCobranca[];
}) {
  if (contatos.length === 0) {
    return (
      <span className="text-[11px] italic text-muted-foreground/60">
        sem contato de cobrança
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      {contatos.map((c, i) => {
        const nome = c.nome?.trim() || "Sem nome";
        const email = c.email?.trim();
        return (
          <span key={i} className="text-muted-foreground">
            {nome}
            {email && (
              <>
                {" · "}
                <a
                  href={`mailto:${email}`}
                  className="text-california-red hover:underline"
                >
                  {email}
                </a>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
