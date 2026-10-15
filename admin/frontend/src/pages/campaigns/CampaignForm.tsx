import { CheckGroup, Field, fieldClass, FormDialog, secondaryButton, textareaClass } from "@/shared/components/kit";
import { api, PROFILE_LABEL, useLookups, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fail, fromCents, Group, toCents, type Campaign } from "./shared";

const MAX_BANNER = 300 * 1024;

type Form = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  goal: string;
  distributorIds: number[];
  audience: ProfileKey[];
  productIds: number[];
  rewards: string;
  banner: string | null;
};

const empty: Form = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  goal: "",
  distributorIds: [],
  audience: ["seller"],
  productIds: [],
  rewards: "",
  banner: null,
};

/** criar (campaign = null) ou editar campanha */
export function CampaignForm({ open, onOpenChange, campaign }: { open: boolean; onOpenChange: (o: boolean) => void; campaign: Campaign | null }) {
  const lookups = useLookups().data;
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      campaign
        ? {
            name: campaign.name,
            description: campaign.description,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
            goal: campaign.goalCents ? fromCents(campaign.goalCents) : "",
            distributorIds: campaign.distributorIds,
            audience: campaign.audience as ProfileKey[],
            productIds: campaign.productIds,
            rewards: campaign.rewards.join("\n"),
            banner: campaign.banner,
          }
        : empty,
    );
  }, [open, campaign]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (campaign ? api.patch<Campaign>(`/campaigns/${campaign.id}`, body) : api.post<Campaign>("/campaigns", body)),
    onSuccess: (c) => {
      toast.success(campaign ? "Campanha atualizada" : "Campanha criada como rascunho", { description: c.name });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      onOpenChange(false);
    },
    onError: fail,
  });

  const submit = () => {
    const e: typeof errors = {};
    if (form.name.trim().length < 3) e.name = "Informe pelo menos 3 caracteres";
    if (!form.startDate) e.startDate = "Obrigatório";
    if (!form.endDate) e.endDate = "Obrigatório";
    if (form.startDate && form.endDate && form.endDate < form.startDate) e.endDate = "Término antes do início";
    const goalCents = form.goal.trim() ? toCents(form.goal) : 0;
    if (Number.isNaN(goalCents) || goalCents < 0) e.goal = "Valor inválido";
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      name: form.name.trim(),
      description: form.description,
      startDate: form.startDate,
      endDate: form.endDate,
      goalCents,
      distributorIds: form.distributorIds,
      audience: form.audience,
      productIds: form.productIds,
      rewards: form.rewards.split("\n").map((r) => r.trim()).filter(Boolean),
      ...(form.banner ? (form.banner !== campaign?.banner ? { banner: form.banner } : {}) : campaign?.banner ? { removeBanner: true } : {}),
    });
  };

  const pickBanner = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Envie uma imagem (png, jpg, webp ou gif)");
    if (file.size > MAX_BANNER) return toast.error("Imagem maior que 300 KB", { description: "Reduza a imagem e tente de novo." });
    const reader = new FileReader();
    reader.onload = () => set("banner", String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={campaign ? `Editar campanha` : "Nova campanha"}
      description={campaign ? campaign.name : "A campanha nasce como rascunho; agende quando estiver pronta."}
      onSubmit={submit}
      busy={save.isPending}
      submitLabel={campaign ? "Salvar alterações" : "Criar campanha"}
    >
      <Field label="Nome" error={errors.name}>
        <input className={fieldClass} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required />
      </Field>
      <Field label="Descrição">
        <textarea className={textareaClass} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Início" error={errors.startDate}>
          <input type="date" className={fieldClass} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} required />
        </Field>
        <Field label="Término" error={errors.endDate}>
          <input type="date" className={fieldClass} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} required />
        </Field>
        <Field label="Meta de vendas (R$)" error={errors.goal}>
          <input className={fieldClass} inputMode="decimal" placeholder="0,00" value={form.goal} onChange={(e) => set("goal", e.target.value)} />
        </Field>
      </div>
      <Group label="Público-alvo" hint="Perfis que participam da campanha">
        <CheckGroup
          columns={3}
          options={(lookups?.profiles ?? []).filter((p) => p.key !== "super_admin").map((p) => ({ value: p.key, label: PROFILE_LABEL[p.key] }))}
          value={form.audience}
          onChange={(v) => set("audience", v)}
        />
      </Group>
      <div className="grid gap-4 md:grid-cols-2">
        <Group label={`Distribuidoras participantes (${form.distributorIds.length || "todas"})`} hint="Nenhuma marcada = todas participam">
          <CheckGroup columns={1} options={(lookups?.distributors ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }))} value={form.distributorIds} onChange={(v) => set("distributorIds", v)} />
        </Group>
        <Group label={`Produtos elegíveis (${form.productIds.length || "todos"})`} hint="Nenhum marcado = todos os produtos pontuam">
          <CheckGroup columns={1} options={(lookups?.products ?? []).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} value={form.productIds} onChange={(v) => set("productIds", v)} />
        </Group>
      </div>
      <Field label="Premiações" hint="Uma por linha">
        <textarea className={textareaClass} value={form.rewards} onChange={(e) => set("rewards", e.target.value)} placeholder={"Viagem para os 10 primeiros\nVale-compras R$ 500"} />
      </Field>
      <Group label="Banner da campanha" hint="Imagem até 300 KB (proporção 3:1 fica melhor)">
        {form.banner ? (
          <div className="relative overflow-hidden rounded-xl border border-[#E5E7EB] dark:border-border/40">
            <img src={form.banner} alt="Pré-visualização do banner" className="h-32 w-full object-cover" />
            <button type="button" onClick={() => set("banner", null)} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-xs font-semibold text-white">
              <Trash2 className="h-3.5 w-3.5" /> Remover
            </button>
          </div>
        ) : (
          <label className={`${secondaryButton} w-fit cursor-pointer`}>
            <ImagePlus className="h-4 w-4" />
            Escolher imagem
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => pickBanner(e.target.files?.[0])} />
          </label>
        )}
      </Group>
    </FormDialog>
  );
}
