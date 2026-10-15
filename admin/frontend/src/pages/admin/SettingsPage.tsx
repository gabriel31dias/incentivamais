import { card, Panel, primaryButton, Skeleton, Tabs } from "@/shared/components/kit";
import { formatDate, useLookups } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useEffect, useState } from "react";
import { KINDS, type FieldDef, type KindDef } from "../content/config";
import { RecordFields } from "../content/RecordForm";
import { RecordsList } from "../content/RecordsPage";
import { SecurityForm } from "./SecurityPage";
import { useSettings } from "./useSettings";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "org" | "brand" | "campaign" | "points" | "notifications" | "security" | "templates";

const yesNo = (key: string, label: string): FieldDef => ({ key, label, type: "checkbox" });

function useTabs(): Record<Exclude<Tab, "security" | "templates">, { title: string; fields: FieldDef[] }> {
  const lookups = useLookups();
  return {
    org: {
      title: "Dados da organização",
      fields: [
        { key: "orgName", label: "Nome da organização", type: "text", required: true },
        { key: "orgCnpj", label: "CNPJ", type: "text" },
        { key: "contactEmail", label: "E-mail de contato", type: "text" },
        { key: "contactPhone", label: "Telefone", type: "text" },
        { key: "address", label: "Endereço", type: "text", full: true },
        { key: "supportHours", label: "Horário de atendimento", type: "text", hint: "Ex.: seg a sex, 8h às 18h" },
      ],
    },
    brand: {
      title: "Identidade visual",
      fields: [
        { key: "appName", label: "Nome exibido no app", type: "text" },
        { key: "logo", label: "Logo", type: "image", full: true },
        { key: "primaryColor", label: "Cor primária", type: "color" },
        { key: "backgroundColor", label: "Cor de fundo", type: "color" },
        { key: "cardColor", label: "Cor dos cards", type: "color" },
        { key: "accentColor", label: "Cor de destaque", type: "color" },
      ],
    },
    campaign: {
      title: "Configurações da campanha",
      fields: [
        {
          key: "mainCampaignId",
          label: "Campanha principal",
          type: "select",
          options: (lookups.data?.campaigns ?? []).map((c) => ({ value: String(c.id), label: c.name })),
        },
        { key: "importDeadlineDay", label: "Dia limite para envio das vendas", type: "number", hint: "Dia do mês seguinte à competência" },
        { key: "timezone", label: "Fuso horário", type: "select", options: ["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Cuiaba"].map((v) => ({ value: v, label: v })) },
        { key: "welcomeMessage", label: "Mensagem de boas-vindas", type: "textarea", full: true },
        yesNo("rankingPublic", "Ranking visível para todos os vendedores"),
      ],
    },
    points: {
      title: "Política de pontos",
      fields: [
        { key: "pointsExpireMonths", label: "Expiração dos pontos (meses)", type: "number", hint: "0 = não expiram" },
        { key: "minRedeemPoints", label: "Mínimo para resgate (pontos)", type: "number" },
        { key: "pointValueCents", label: "Valor de referência de 1 ponto (centavos)", type: "number" },
        { key: "maxAdjustmentWithoutApproval", label: "Ajuste manual máximo sem 2ª aprovação", type: "number" },
        yesNo("allowNegativeBalance", "Permitir saldo negativo após estorno"),
        yesNo("adjustmentRequiresReason", "Exigir justificativa em todo ajuste manual"),
      ],
    },
    notifications: {
      title: "Notificações",
      fields: [
        yesNo("notifyEmail", "Enviar por e-mail"),
        yesNo("notifyPush", "Enviar push no app"),
        yesNo("notifyOnCredit", "Avisar o vendedor quando receber pontos"),
        yesNo("notifyOnImportError", "Avisar o ponto focal quando o lote tiver inconsistências"),
        yesNo("notifyOnRedemption", "Avisar sobre mudanças no status do resgate"),
        {
          key: "digest",
          label: "Resumo para gestores",
          type: "select",
          options: [
            { value: "none", label: "Não enviar" },
            { value: "daily", label: "Diário" },
            { value: "weekly", label: "Semanal" },
          ],
        },
      ],
    },
  };
}

function BrandPreview({ data }: { data: Record<string, any> }) {
  const primary = data.primaryColor || "#00E6A0";
  return (
    <div className="rounded-[24px] border-4 p-4" style={{ background: data.backgroundColor || "#020F14", borderColor: data.cardColor || "#071E24" }}>
      <div className="mb-4 flex items-center gap-2">
        <img src={data.logo || "/logo.png"} alt="" className="h-8 w-auto" />
        <span className="font-bold text-white">{data.appName || "Incentiva+"}</span>
      </div>
      <div className="space-y-3 rounded-2xl p-4" style={{ background: data.cardColor || "#071E24" }}>
        <p className="text-sm text-white/70">Saldo atual</p>
        <p className="text-3xl font-bold text-white">2.450</p>
        <p className="text-xs font-bold" style={{ color: data.accentColor || primary }}>
          ↑ 12% este mês
        </p>
        <button type="button" className="w-full rounded-xl py-2.5 text-sm font-bold" style={{ background: primary, color: "#03261A" }}>
          Resgatar prêmios
        </button>
      </div>
    </div>
  );
}

function SettingsForm({ tab, def }: { tab: Tab; def: { title: string; fields: FieldDef[] } }) {
  const settings = useSettings();
  const [data, setData] = useState<Record<string, any>>({});
  useEffect(() => {
    if (settings.rec) setData(settings.rec.data);
  }, [settings.rec]);
  if (settings.isLoading) return <Skeleton className="h-72" />;
  const kind = { kind: "settings", label: def.title, singular: "", flow: "toggle", fields: def.fields } as KindDef;
  const save = () => settings.save.mutate(Object.fromEntries(def.fields.filter((f) => data[f.key] !== undefined).map((f) => [f.key, data[f.key]])));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className={cn("grid gap-5", tab === "brand" && "lg:grid-cols-[minmax(0,1fr)_340px]")}
    >
      <Panel title={def.title}>
        <RecordFields def={kind} data={data} onChange={setData} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {settings.rec && (
            <span className="text-xs text-[#8C8C96]">
              Última alteração: {formatDate(settings.rec.updatedAt)}
              {settings.rec.history.at(-1) && ` · ${settings.rec.history.at(-1)!.by}`}
            </span>
          )}
          <button type="submit" className={primaryButton} disabled={settings.save.isPending}>
            {settings.save.isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </Panel>
      {tab === "brand" && (
        <div className={cn(card, "h-fit space-y-3 p-5")}>
          <p className="text-sm font-bold">Pré-visualização no app</p>
          <BrandPreview data={data} />
          <p className="text-xs text-[#8C8C96]">As cores ficam salvas na configuração; aplicar no app é feito pela integração do app.</p>
        </div>
      )}
    </form>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("org");
  const tabs = useTabs();
  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "org", label: "Organização" },
          { value: "brand", label: "Identidade visual" },
          { value: "campaign", label: "Campanha" },
          { value: "points", label: "Política de pontos" },
          { value: "notifications", label: "Notificações" },
          { value: "security", label: "Segurança" },
          { value: "templates", label: "Modelos de mensagens" },
        ]}
      />
      {tab === "security" ? (
        <SecurityForm />
      ) : tab === "templates" ? (
        <RecordsList def={KINDS.message_template} />
      ) : (
        <SettingsForm key={tab} tab={tab} def={tabs[tab]} />
      )}
    </div>
  );
}
