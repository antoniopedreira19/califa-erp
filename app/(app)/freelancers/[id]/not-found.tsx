import Link from "next/link";
import { UserX, ArrowLeft } from "lucide-react";

export default function FreelancerNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 mb-4">
        <UserX className="h-7 w-7 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-bold text-foreground">
        Freelancer não encontrado
      </h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        O cadastro que você tentou abrir não existe, foi removido ou está em
        outro tenant.
      </p>
      <Link
        href="/freelancers/lista"
        prefetch={false}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para a lista
      </Link>
    </div>
  );
}
