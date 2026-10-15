/**
 * Centralized toast utility.
 *
 * Always import from here — never directly from "sonner".
 * All visual configuration lives in @/shared/components/ui/sonner.tsx.
 *
 * Usage:
 *   import { toast } from "@/shared/lib/toast"
 *   toast.success("Operação concluída!")
 *   toast.error("Algo deu errado.", { description: "Detalhe do erro" })
 *   toast.warning("Atenção necessária.")
 *   toast.info("Informação relevante.")
 */
export { toast } from "sonner";
