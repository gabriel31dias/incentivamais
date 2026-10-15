// Formulário gerado a partir do config.ts (campos por kind).
import { CheckGroup, Field, fieldClass, FormDialog, secondaryButton, textareaClass, iconButton } from "@/shared/components/kit";
import { api, PROFILE_LABEL, useLookups, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { emptyValue, type FieldDef, type KindDef } from "./config";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rec = {
  id: number;
  kind: string;
  title: string;
  status: string;
  data: Record<string, any>;
  history: { at: string; by: string; action: string }[];
  updatedAt: string;
  createdAt: string;
};

const MAX_IMAGE = 300 * 1024;

export function ImageInput({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const pick = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Envie um arquivo de imagem.");
    if (file.size > MAX_IMAGE) return toast.error("Imagem maior que 300 KB.", { description: "Reduza a imagem e tente de novo." });
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      {value ? (
        <img src={value} alt="Pré-visualização" className="h-20 w-32 rounded-xl border border-[#E5E7EB] object-cover dark:border-border/40" />
      ) : (
        <div className="flex h-20 w-32 items-center justify-center rounded-xl border border-dashed border-[#E5E7EB] text-[#8C8C96] dark:border-border/40">
          <ImagePlus className="h-6 w-6" />
        </div>
      )}
      <label className={cn(secondaryButton, "cursor-pointer")}>
        Escolher imagem
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {value && (
        <button type="button" className={secondaryButton} onClick={() => onChange("")}>
          Remover
        </button>
      )}
      <span className="w-full text-xs text-[#8C8C96]">PNG/JPG até 300 KB (guardada no banco como data URL — upload simulado).</span>
    </div>
  );
}

/** markdown mínimo para pré-visualização (negrito, itálico, listas, parágrafos) */
export function Markdown({ text }: { text?: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
      part.startsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part.startsWith("*") && part.length > 2 ? <i key={i}>{part.slice(1, -1)}</i> : <Fragment key={i}>{part}</Fragment>,
    );
  const blocks = String(text ?? "").split(/\n\s*\n/).filter((b) => b.trim());
  return (
    <div className="space-y-2 text-sm leading-6">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i} className="list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(b)}</p>;
      })}
    </div>
  );
}

function MarkdownInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-1 text-xs font-semibold">
        {["Escrever", "Pré-visualizar"].map((l, i) => (
          <button
            type="button"
            key={l}
            onClick={() => setPreview(i === 1)}
            className={cn("rounded-lg px-3 py-1", preview === (i === 1) ? "bg-[#00E6A0]/15 text-[#00A876] dark:text-[#00E6A0]" : "text-[#73737D]")}
          >
            {l}
          </button>
        ))}
      </div>
      {preview ? (
        <div className="min-h-[140px] rounded-xl border border-[#E5E7EB] p-3 dark:border-border/40">
          {value ? <Markdown text={value} /> : <span className="text-sm text-[#8C8C96]">Nada para pré-visualizar.</span>}
        </div>
      ) : (
        <textarea className={cn(textareaClass, "min-h-[140px]")} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function FieldInput({ f, value, onChange, siblings }: { f: FieldDef; value: any; onChange: (v: any) => void; siblings?: Record<string, any> }) {
  const lookups = useLookups();
  switch (f.type) {
    case "textarea":
      return <textarea className={textareaClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={f.required} />;
    case "markdown":
      return <MarkdownInput value={value ?? ""} onChange={onChange} />;
    case "number":
      return <input type="number" className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} required={f.required} />;
    case "date":
      return <input type="date" className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={f.required} />;
    case "datetime":
      return <input type="datetime-local" className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={f.required} />;
    case "url":
      return <input type="url" placeholder="https://" className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={f.required} />;
    case "color":
      return (
        <span className="flex items-center gap-2">
          <input type="color" aria-label={f.label} className="h-10 w-12 cursor-pointer rounded-lg border border-[#E5E7EB] bg-transparent dark:border-border/40" value={value || "#00E6A0"} onChange={(e) => onChange(e.target.value)} />
          <input className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="#00E6A0" pattern="^#[0-9A-Fa-f]{6}$" />
        </span>
      );
    case "select":
      return (
        <select className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={f.required}>
          <option value="">Selecione</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <span className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#00E6A0]" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          Sim
        </span>
      );
    case "profiles":
      return (
        <CheckGroup<ProfileKey>
          options={(Object.keys(PROFILE_LABEL) as ProfileKey[]).map((k) => ({ value: k, label: PROFILE_LABEL[k] }))}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );
    case "distributors":
      return (
        <CheckGroup<number>
          columns={1}
          options={(lookups.data?.distributors ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }))}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );
    case "image":
      return <ImageInput value={value} onChange={onChange} />;
    case "lines":
      return (
        <textarea
          className={textareaClass}
          value={Array.isArray(value) ? value.join("\n") : value ?? ""}
          onChange={(e) => onChange(e.target.value.split("\n"))}
          required={f.required}
        />
      );
    case "choice": {
      const options: string[] = (Array.isArray(siblings?.[f.from!]) ? siblings![f.from!] : []).filter((o: string) => o.trim());
      return (
        <select className={fieldClass} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))}>
          {options.length === 0 && <option value={0}>Cadastre as alternativas</option>}
          {options.map((o, i) => (
            <option key={i} value={i}>
              {String.fromCharCode(65 + i)}) {o}
            </option>
          ))}
        </select>
      );
    }
    case "repeater":
      return <Repeater f={f} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    default:
      return <input className={fieldClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={f.required} />;
  }
}

function Repeater({ f, value, onChange }: { f: FieldDef; value: Record<string, any>[]; onChange: (v: any[]) => void }) {
  const blank = () => Object.fromEntries((f.fields ?? []).map((sf) => [sf.key, emptyValue(sf)]));
  const set = (i: number, key: string, v: any) => onChange(value.map((item, j) => (j === i ? { ...item, [key]: v } : item)));
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="rounded-xl border border-[#E5E7EB] p-3 dark:border-border/40">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-[#00A876] dark:text-[#00E6A0]">#{i + 1}</span>
            <button type="button" className={iconButton} aria-label="Remover item" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(f.fields ?? []).map((sf) => (
              <div key={sf.key} className={cn((sf.type === "repeater" || sf.type === "lines" || sf.full) && "sm:col-span-2")}>
                <Field label={sf.label}>
                  {/* legado do seed: "lessons: 4" (número) vira lista vazia editável */}
                  <FieldInput f={sf} value={item[sf.key]} siblings={item} onChange={(v) => set(i, sf.key, v)} />
                </Field>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className={secondaryButton} onClick={() => onChange([...value, blank()])}>
        <Plus className="h-4 w-4" />
        {f.addLabel ?? "Adicionar"}
      </button>
    </div>
  );
}

/** campos do kind num grid de 2 colunas */
export function RecordFields({ def, data, onChange }: { def: KindDef; data: Record<string, any>; onChange: (data: Record<string, any>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {def.fields.map((f) => (
        <div key={f.key} className={cn((f.full || f.type === "profiles" || f.type === "distributors") && "sm:col-span-2")}>
          <Field label={f.label + (f.required ? " *" : "")} hint={f.hint}>
            <FieldInput f={f} value={data[f.key]} siblings={data} onChange={(v) => onChange({ ...data, [f.key]: v })} />
          </Field>
        </div>
      ))}
    </div>
  );
}

/** criar/editar um registro de qualquer kind */
export function RecordDialog({
  def,
  record,
  open,
  onOpenChange,
  extra,
}: {
  def: KindDef;
  record: Rec | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extra?: ReactNode;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(record?.title ?? "");
  const [data, setData] = useState<Record<string, any>>(() => record?.data ?? Object.fromEntries(def.fields.map((f) => [f.key, emptyValue(f)])));

  const save = useMutation({
    mutationFn: (body: { title: string; data: Record<string, any> }) =>
      record
        ? api.patch<Rec>(`/records/${def.kind}/${record.id}`, body)
        : api.post<Rec>(`/records/${def.kind}`, { ...body, status: def.flow === "toggle" ? "published" : "draft" }),
    onSuccess: () => {
      toast.success(record ? "Alterações salvas." : `${def.singular[0].toUpperCase()}${def.singular.slice(1)} criado(a).`);
      qc.invalidateQueries({ queryKey: ["records"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const submit = () => {
    if (title.trim().length < 2) return toast.error("Informe o título (mínimo 2 caracteres).");
    const missing = def.fields.find((f) => f.required && (data[f.key] === "" || data[f.key] == null || (Array.isArray(data[f.key]) && !data[f.key].some((v: unknown) => String(v).trim()))));
    if (missing) return toast.error(`Preencha "${missing.label}".`);
    // limpa linhas vazias de listas
    const clean = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, def.fields.find((f) => f.key === k)?.type === "lines" && Array.isArray(v) ? v.filter((s) => String(s).trim()) : v]),
    );
    setData(clean);
    save.mutate({ title: title.trim(), data: clean });
  };

  return (
    <FormDialog
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Editar ${def.singular}` : `Novo(a) ${def.singular}`}
      description={!record && def.flow === "publish" ? "Fica como rascunho até você publicar ou agendar." : undefined}
      onSubmit={() => void submit()}
      busy={save.isPending}
    >
      <Field label={(def.titleLabel ?? "Título") + " *"}>
        <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
      </Field>
      <RecordFields def={def} data={data} onChange={setData} />
      {extra}
    </FormDialog>
  );
}
