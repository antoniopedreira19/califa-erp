import { redirect } from "next/navigation";

// Até 2026-11-10 esta rota era um hub com dois cards (Cadastros e
// Administração). Cadastros virou módulo da barra lateral e a engrenagem
// passou a abrir a antiga Administração, renomeada para Configurações, em
// /admin. A rota fica só para quem tem o endereço antigo salvo.
export default function ConfiguracoesPage() {
  redirect("/admin");
}
