import { redirect } from "next/navigation";

/**
 * Rota antiga da fila de abertura. A tela virou "Abertura de Job" em
 * /financeiro/abertura-de-job, com conferência e formulário de registro
 * financeiro. Mantida como redirect por causa de links já salvos e de
 * `revalidatePath` antigos.
 */
export default function JobsAguardandoAberturaPage() {
  redirect("/financeiro/abertura-de-job");
}
