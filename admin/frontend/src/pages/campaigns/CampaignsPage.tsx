import { Badge, card, EmptyState, primaryButton, SearchInput, Skeleton, StatusBadge, Tabs, Toolbar, useList } from "@/shared/components/kit";
import { cents, formatDay, PROFILE_LABEL, type ProfileKey } from "@/shared/lib/api";
import { Megaphone, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CampaignActions } from "./CampaignActions";
import { CampaignForm } from "./CampaignForm";
import type { Campaign, CampaignStatus } from "./shared";

const TABS: { value: "" | CampaignStatus; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "scheduled", label: "Agendadas" },
  { value: "draft", label: "Rascunhos" },
  { value: "paused", label: "Pausadas" },
  { value: "ended", label: "Encerradas" },
];

export function CampaignsPage() {
  const list = useList<Campaign, Record<CampaignStatus, number>>("campaigns", "/campaigns", {}, 60);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [open, setOpen] = useState(false);
  const summary = list.data?.summary;
  const total = summary ? Object.values(summary).reduce((a, b) => a + b, 0) : undefined;

  const edit = (c: Campaign | null) => {
    setEditing(c);
    setOpen(true);
  };

  return (
    <div className="space-y-5">
      <Toolbar
        actions={
          <button className={primaryButton} onClick={() => edit(null)}>
            <Plus className="h-4 w-4" /> Nova campanha
          </button>
        }
      >
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar campanha..." />
      </Toolbar>

      <Tabs
        tabs={TABS.map((t) => ({
          value: t.value,
          label: (
            <>
              {t.label}
              <span className="text-xs opacity-70">{t.value ? summary?.[t.value] ?? "" : total ?? ""}</span>
            </>
          ),
        }))}
        value={(list.filters.status ?? "") as "" | CampaignStatus}
        onChange={(status) => list.patch({ status })}
      />

      {list.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : !list.data?.data.length ? (
        <div className={card}>
          <EmptyState title={list.isError ? "Não foi possível carregar as campanhas" : "Nenhuma campanha encontrada"}>
            {list.isError ? "Verifique se o backend está rodando." : "Ajuste a busca ou crie uma nova campanha."}
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.data.map((c) => (
            <article key={c.id} className={`${card} flex flex-col overflow-hidden`}>
              <Link to={`/campanhas/${c.id}`} className="block" aria-label={`Abrir ${c.name}`}>
                {c.banner ? (
                  <img src={c.banner} alt="" className="h-28 w-full object-cover" />
                ) : (
                  <div className="flex h-28 items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(0,230,160,0.35),transparent_60%),linear-gradient(135deg,#071E24,#020F14)]">
                    <Megaphone className="h-10 w-10 text-[#00E6A0]" />
                  </div>
                )}
              </Link>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/campanhas/${c.id}`} className="text-base font-bold leading-snug text-[#1F1F24] hover:text-[#00A876] dark:text-white dark:hover:text-[#00E6A0]">
                    {c.name}
                  </Link>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">
                  {formatDay(c.startDate)} – {formatDay(c.endDate)} · Meta {c.goalCents ? cents(c.goalCents) : "—"}
                </p>
                {c.description && <p className="line-clamp-2 text-sm text-[#73737D] dark:text-muted-foreground">{c.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="gray">{c.distributorIds.length ? `${c.distributorIds.length} distribuidora(s)` : "Todas as distribuidoras"}</Badge>
                  <Badge tone="gray">{c.productIds.length ? `${c.productIds.length} produto(s)` : "Todos os produtos"}</Badge>
                  {c.audience.map((a) => (
                    <Badge key={a} tone="blue">
                      {PROFILE_LABEL[a as ProfileKey] ?? a}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto pt-1">
                  <CampaignActions campaign={c} onEdit={() => edit(c)} compact />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <CampaignForm open={open} onOpenChange={setOpen} campaign={editing} />
    </div>
  );
}
