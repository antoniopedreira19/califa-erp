"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  AlertTriangle,
  AlertOctagon,
  CheckCircle,
  XCircle,
  FileText,
  Search,
  ArrowRight,
  Palmtree,
  type LucideIcon,
} from "lucide-react";
import type { FeriasNotificacaoTipo } from "@/lib/types";
import { marcarNotificacaoLida } from "@/app/(app)/rh/ferias/actions";

type NotifRow = {
  id: string;
  tipo: FeriasNotificacaoTipo;
  colaborador_id: string;
  lancamento_id: string | null;
  periodo_id: string | null;
  titulo: string;
  mensagem: string;
  criada_em: string;
  lida_em: string | null;
};

type Props = {
  notificacao: NotifRow;
};

export function LinhaNotificacao({ notificacao: n }: Props) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const naoLida = !n.lida_em;

  const { Icon, cor, href } = infoNotificacao(n);

  function marcarLida() {
    if (!naoLida) return;
    startTransition(async () => {
      await marcarNotificacaoLida(n.id);
      router.refresh();
    });
  }

  const conteudo = (
    <>
      <div className={`shrink-0 rounded-lg p-2 ${cor.bg}`}>
        <Icon className={`h-4 w-4 ${cor.icon}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${naoLida ? "font-semibold text-foreground" : "font-normal text-muted-foreground"} truncate`}
        >
          {n.titulo}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {n.mensagem}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {haQuantoTempo(n.criada_em)}
        </p>
      </div>
      {naoLida && (
        <span className="shrink-0 inline-block h-2 w-2 rounded-full bg-california-red" />
      )}
    </>
  );

  return (
    <li className={naoLida ? "bg-california-red/[0.02]" : ""}>
      {href ? (
        <Link
          href={href}
          prefetch={false}
          onClick={marcarLida}
          className="flex items-start gap-3 p-3 hover:bg-muted/40 transition-colors"
        >
          {conteudo}
        </Link>
      ) : (
        <button
          type="button"
          onClick={marcarLida}
          className="flex items-start gap-3 p-3 w-full text-left hover:bg-muted/40 transition-colors"
        >
          {conteudo}
        </button>
      )}
    </li>
  );
}

function infoNotificacao(n: NotifRow): {
  Icon: LucideIcon;
  cor: { bg: string; icon: string };
  href: string | null;
} {
  const corVencidas = {
    bg: "bg-red-100",
    icon: "text-red-700",
  };
  const corAlerta = {
    bg: "bg-amber-100",
    icon: "text-amber-700",
  };
  const corSucesso = {
    bg: "bg-emerald-100",
    icon: "text-emerald-700",
  };
  const corInfo = {
    bg: "bg-sky-100",
    icon: "text-sky-700",
  };
  const corAcao = {
    bg: "bg-california-red/10",
    icon: "text-california-red",
  };
  const corNeutro = {
    bg: "bg-muted",
    icon: "text-muted-foreground",
  };

  switch (n.tipo) {
    case "concessivo_liberado":
      return {
        Icon: Palmtree,
        cor: corSucesso,
        href: "/perfil",
      };
    case "concessivo_em_alerta":
      return {
        Icon: AlertTriangle,
        cor: corAlerta,
        href: "/perfil",
      };
    case "ferias_vencidas":
      return {
        Icon: AlertOctagon,
        cor: corVencidas,
        href: "/rh/ferias?tab=painel",
      };
    case "solicitacao":
      return {
        Icon: Clock,
        cor: corAcao,
        href: n.lancamento_id
          ? `/rh/ferias?tab=solicitacoes&status=pendente_aprovacao`
          : "/rh/ferias?tab=solicitacoes",
      };
    case "em_analise":
      return {
        Icon: Search,
        cor: corInfo,
        href: "/perfil",
      };
    case "aprovada":
      return { Icon: CheckCircle, cor: corSucesso, href: "/perfil" };
    case "reprovada":
      return { Icon: XCircle, cor: corVencidas, href: "/perfil" };
    case "alteracao":
      return { Icon: FileText, cor: corInfo, href: "/perfil" };
    case "cancelamento":
      return { Icon: XCircle, cor: corNeutro, href: "/perfil" };
    case "lembrete":
      return { Icon: Clock, cor: corInfo, href: null };
    case "inicio":
      return { Icon: Palmtree, cor: corSucesso, href: null };
    case "retorno":
      return { Icon: ArrowRight, cor: corInfo, href: null };
    case "emitir_nf":
      return { Icon: FileText, cor: corAcao, href: "/perfil" };
    default:
      return { Icon: Palmtree, cor: corNeutro, href: null };
  }
}

function haQuantoTempo(iso: string): string {
  const agora = new Date();
  const dt = new Date(iso);
  const diff = agora.getTime() - dt.getTime();
  const minutos = Math.floor(diff / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `há ${dias}d`;
  return dt.toLocaleDateString("pt-BR");
}
