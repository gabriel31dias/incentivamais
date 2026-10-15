import { api } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Rec } from "../content/RecordForm";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** configurações gerais (registro único kind=settings); save faz merge raso no backend */
export function useSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Rec>("/records/settings/current") });
  const save = useMutation({
    mutationFn: (data: Record<string, any>) => api.patch<Rec>("/records/settings/current", { data }),
    onSuccess: (rec) => {
      qc.setQueryData(["settings"], rec);
      qc.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Configurações salvas.");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return { data: query.data?.data ?? {}, rec: query.data, isLoading: query.isLoading, save };
}
