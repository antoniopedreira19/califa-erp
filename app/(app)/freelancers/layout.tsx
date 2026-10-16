import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { pode } from "@/lib/permissoes";
import { FreelancersSubNav } from "./_components/sub-nav";

export default async function FreelancersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  return (
    <div className="space-y-0">
      <FreelancersSubNav />
      {children}
    </div>
  );
}
