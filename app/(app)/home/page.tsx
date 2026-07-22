import { requireSession } from "@/lib/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/types";
import { FileText, Briefcase, ShieldCheck } from "lucide-react";

const proximasEntregas = [
  {
    icon: FileText,
    label: "Versões e importação de planilha",
    task: "Task 004",
  },
  {
    icon: Briefcase,
    label: "Criação de job a partir de orçamento aprovado",
    task: "Task 005",
  },
];

export default async function HomePage() {
  const session = await requireSession();

  return (
    <div className="space-y-8">
      {/* Cabeçalho */}
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          California ERP
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bem-vindo, {session.profile.nome.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Fundação, cadastros e orçamentos comerciais no ar. Próximos passos:
          versões de orçamento e criação de job a partir da aprovação.
        </p>
      </header>

      {/* Cartões de contexto */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Tenant ativo</CardDescription>
            <CardTitle>{session.activeTenant.nome}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground font-mono">
              {session.activeTenant.slug}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Seu papel</CardDescription>
            <CardTitle>{roleLabel(session.activeRole)}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-california-red" />
            <p className="text-xs text-muted-foreground">
              Permissões aplicadas via RLS no Postgres
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Módulos ativos</CardDescription>
            <CardTitle>Tasks 001 · 002 · 003</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex flex-wrap gap-1.5">
            <Badge variant="soft">Auth</Badge>
            <Badge variant="soft">RLS</Badge>
            <Badge variant="soft">Cadastros</Badge>
            <Badge variant="soft">Orçamentos</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Roadmap */}
      <Card>
        <CardHeader>
          <CardTitle>Próximas entregas do MVP</CardTitle>
          <CardDescription>
            O ERP será construído incrementalmente. Cada task carrega suas
            tabelas, RLS e auditoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {proximasEntregas.map((item) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.label}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-california-red/10 text-california-red shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {item.label}
                    </p>
                  </div>
                  <Badge variant="neutral">{item.task}</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
