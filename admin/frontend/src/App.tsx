import { Layout } from "@/shared/components/Layout";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { can, type Permission, useAuth } from "@/shared/lib/api";
import { NAV_ITEMS } from "@/shared/lib/nav";
import { useThemeStore } from "@/shared/stores/theme.store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuditPage } from "./pages/admin/AuditPage";
import { ProfilesPage } from "./pages/admin/ProfilesPage";
import { SecurityPage } from "./pages/admin/SecurityPage";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { AdjustmentsPage } from "./pages/campaigns/AdjustmentsPage";
import { CampaignDetailPage } from "./pages/campaigns/CampaignDetailPage";
import { CampaignsPage } from "./pages/campaigns/CampaignsPage";
import { GoalsPage } from "./pages/campaigns/GoalsPage";
import { LedgerPage } from "./pages/campaigns/LedgerPage";
import { RulesPage } from "./pages/campaigns/RulesPage";
import { RecordsPage } from "./pages/content/RecordsPage";
import { RewardsPage } from "./pages/content/RewardsPage";
import { ActivityPage } from "./pages/dashboard/ActivityPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { BatchDetailPage } from "./pages/imports/BatchDetailPage";
import { BatchesPage } from "./pages/imports/BatchesPage";
import { InconsistenciesPage } from "./pages/imports/InconsistenciesPage";
import { NewImportPage } from "./pages/imports/NewImportPage";
import { ReprocessPage } from "./pages/imports/ReprocessPage";
import { LoginPage } from "./pages/LoginPage";
import { MenusPage } from "./pages/menus/MenusPage";
import { DistributorDetailPage } from "./pages/people/DistributorDetailPage";
import { DistributorsPage } from "./pages/people/DistributorsPage";
import { TeamsPage } from "./pages/people/TeamsPage";
import { UsersPage } from "./pages/people/UsersPage";
import { ReportsPage } from "./pages/reports/ReportsPage";
import { ChatbotPage } from "./pages/support/ChatbotPage";
import { TicketsPage } from "./pages/support/TicketsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Private({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** mesma permissão do item de menu; a API também recusa (403) — isto é só UX */
function Guard({ path, children }: { path: string; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const perm = NAV_ITEMS.find((i) => i.path === path)?.perm as Permission[] | undefined;
  if (!can(user, ...(perm ?? []))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const ROUTES: [string, ReactNode, string?][] = [
  ["/dashboard", <DashboardPage />],
  ["/atividades", <ActivityPage />],
  ["/distribuidoras", <DistributorsPage />],
  ["/distribuidoras/:id", <DistributorDetailPage />, "/distribuidoras"],
  ["/equipes", <TeamsPage />],
  ["/gerentes", <UsersPage key="manager" preset="manager" />],
  ["/vendedores", <UsersPage key="seller" preset="seller" />],
  ["/pontos-focais", <UsersPage key="focal" preset="focal" />],
  ["/campanhas", <CampaignsPage />],
  ["/campanhas/:id", <CampaignDetailPage />, "/campanhas"],
  ["/metas", <GoalsPage />],
  ["/regras", <RulesPage />],
  ["/extrato", <LedgerPage />],
  ["/ajustes", <AdjustmentsPage />],
  ["/premiacoes", <RewardsPage />],
  ["/importacao/nova", <NewImportPage />],
  ["/importacao/lotes", <BatchesPage />],
  ["/importacao/lotes/:id", <BatchDetailPage />, "/importacao/lotes"],
  ["/importacao/validacao", <InconsistenciesPage />],
  ["/importacao/reprocessamentos", <ReprocessPage />],
  ["/conteudos/noticias", <RecordsPage key="news" section="news" />],
  ["/conteudos/banners", <RecordsPage key="banners" section="banners" />],
  ["/conteudos/comunicados", <RecordsPage key="notices" section="notices" />],
  ["/conteudos/treinamentos", <RecordsPage key="trainings" section="trainings" />],
  ["/conteudos/quiz", <RecordsPage key="quiz" section="quiz" />],
  ["/conteudos/gamificacao", <RecordsPage key="gamification" section="gamification" />],
  ["/config/menus", <MenusPage />],
  ["/config/perfis", <ProfilesPage />],
  ["/config/usuarios", <UsersPage key="all" />],
  ["/config/auditoria", <AuditPage />],
  ["/config/seguranca", <SecurityPage />],
  ["/config/geral", <SettingsPage />],
  ["/atendimento/chamados", <TicketsPage key="open" />],
  ["/atendimento/chatbot", <ChatbotPage />],
  ["/atendimento/historico", <TicketsPage key="history" history />],
  ["/relatorios/:kind", <ReportsPage />, "/relatorios/vendas"],
];

export default function App() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <Private>
                  <Layout />
                </Private>
              }
            >
              {ROUTES.map(([path, element, permPath]) => (
                <Route key={path} path={path} element={<Guard path={permPath ?? path}>{element}</Guard>} />
              ))}
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        {/* cores do toast do ~/loja (ui/sonner.tsx), sem next-themes */}
        <Toaster
          theme={theme}
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!w-[var(--toast-width)] !min-h-[var(--toast-min-height)] !rounded-[var(--toast-radius)] !border-none !shadow-lg font-sans",
              title: "!text-sm !font-semibold",
              description: "!text-xs !opacity-90",
              success: "!bg-toast-success !text-white",
              error: "!bg-toast-error !text-white",
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
