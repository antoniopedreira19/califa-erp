import { CardNfMes } from "@/app/(app)/perfil/_components/card-nf-mes";

/** Alias semântico: na página do colaborador, o RH vê o mesmo card que o
 *  colaborador vê em /perfil (reaproveita UI; permissão `rh.nf.anexar_qualquer`
 *  é validada pela server action). */
export const CardNfColaborador = CardNfMes;
