// Sidebar e Header no visual do ~/sistema-pg, com os grupos do Incentiva+,
// grupos recolhíveis, sidebar recolhível e gaveta no mobile.
import { ThemeToggle } from "@/shared/components/ThemeToggle/ThemeToggle";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/shared/components/ui/sheet";
import { Tutorial, useTutorial } from "@/shared/components/Tutorial";
import { api, can, PROFILE_LABEL, useAuth } from "@/shared/lib/api";
import { NAV, navFor } from "@/shared/lib/nav";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { ChevronDown, CircleHelp, FlaskConical, LogOut, Menu as MenuIcon, PanelLeft, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo.png" alt="" className="h-9 w-auto" />
      <span className="text-lg font-bold text-white">
        Incentiva<span className="text-[#00E6A0]">+</span>
      </span>
    </div>
  );
}

const CLOSED_KEY = "incentiva-admin-closed-groups";

function Nav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const [closed, setClosed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(closed));
    } catch {
      /* sem storage: só não lembra */
    }
  }, [closed]);
  const active = navFor(location.pathname).path;

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {NAV.map((section, i) => {
        const items = section.items.filter((item) => can(user, ...(item.perm ?? [])));
        if (!items.length) return null;
        const isClosed = !collapsed && closed.includes(section.label) && !items.some((it) => it.path === active);
        return (
          <div key={section.label} className={cn("space-y-2 pb-3", i > 0 && "border-t border-[#12343C] pt-3")}>
            {!collapsed && (
              <button
                onClick={() =>
                  setClosed((c) => (c.includes(section.label) ? c.filter((l) => l !== section.label) : [...c, section.label]))
                }
                className="flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-[#00E6A0]"
                aria-expanded={!isClosed}
              >
                {section.label}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isClosed && "-rotate-90")} />
              </button>
            )}
            {!isClosed && (
              <div className="space-y-1">
                {items.map((item) => {
                  const on = item.path === active;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-[10px] overflow-hidden rounded-lg px-3 text-[#A2A5B3] transition-all duration-200 hover:bg-primary/10",
                        collapsed && "h-10 justify-center px-0",
                        on && "border border-[#12343C] bg-[#0A2A31] text-white shadow-[0_0_18px_rgba(0,230,160,0.12)]",
                      )}
                    >
                      {on && (
                        <span className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#00E6A0]/70 via-[#00E6A0]/20 to-transparent" />
                      )}
                      <item.icon color="#00E6A0" size={19} className="relative z-10 shrink-0" />
                      {!collapsed && (
                        <span className={cn("relative z-10 truncate text-[13px] font-medium", on ? "text-white" : "text-[#A2A5B3]")}>
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const logout = useLogout();
  return (
    <aside
      className={cn(
        "dark fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-sidebar-border bg-[#020F14] transition-all duration-300 lg:flex",
        collapsed ? "w-16" : "w-[268px]",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center px-4", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && <Logo />}
        <Button variant="ghost" size="icon" onClick={onToggle} aria-label="Recolher menu" className="text-[#00E6A0] hover:bg-primary/10">
          <PanelLeft className="h-5 w-5" />
        </Button>
      </div>
      <Nav collapsed={collapsed} />
      <div className="mt-auto border-t border-sidebar-border p-3">
        <button
          onClick={logout}
          className={cn("flex w-full items-center gap-3 rounded-xl px-4 py-2.5 transition-colors hover:bg-destructive/10", collapsed && "justify-center px-0")}
        >
          <LogOut className="h-5 w-5 text-[#00E6A0]" />
          {!collapsed && <span className="text-base font-medium text-muted-foreground">Sair</span>}
        </button>
      </div>
    </aside>
  );
}

function useLogout() {
  const logout = useAuth((s) => s.logout);
  return () => {
    api.post("/auth/logout").catch(() => null);
    logout();
  };
}

function Header({ onMenu }: { onMenu: () => void }) {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const location = useLocation();
  const current = navFor(location.pathname);
  const isSuper = user?.profiles.includes("super_admin");
  const tutorial = useTutorial();

  const reset = async () => {
    if (!confirm("Restaurar os dados fictícios? Todas as alterações feitas na demonstração serão perdidas.")) return;
    const id = toast.loading("Recriando dados fictícios (10.000 usuários)...");
    try {
      await api.post("/admin/reset-demo");
      toast.success("Dados fictícios restaurados. Entre novamente.", { id });
      logout();
    } catch (e) {
      toast.error((e as Error).message, { id });
    }
  };

  return (
    <header className="flex min-h-12 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onMenu} aria-label="Abrir menu" className="lg:hidden">
          <MenuIcon className="h-6 w-6 text-[#00E6A0]" />
        </Button>
        <current.icon color="#00E6A0" className="hidden shrink-0 sm:block" />
        <h1 className="truncate text-xl font-bold leading-none text-[#1F1F24] dark:text-white sm:text-2xl">{current.label}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <Button
          variant="ghost"
          onClick={() => tutorial.setOpen(true)}
          aria-label="Abrir tutorial"
          className="gap-1.5 rounded-full px-3 text-[#00A876] hover:bg-primary/10 dark:text-[#00E6A0]"
        >
          <CircleHelp className="h-5 w-5" />
          <span className="hidden sm:inline">Tutorial</span>
        </Button>
        <Tutorial open={tutorial.open} onOpenChange={tutorial.setOpen} />
        <span
          title="Dados fictícios. Operações gravam no SQLite local, sem integração com sistemas reais."
          className="hidden items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-bold text-[#B76E00] dark:text-warning md:inline-flex"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          Ambiente de demonstração
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="flex items-center gap-2 rounded-full bg-white px-2 py-2 hover:bg-white focus-visible:ring-0 dark:bg-[rgba(255,255,255,0.03)] sm:px-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-[#1F1F24] dark:text-white">
                  {user?.name?.charAt(0) ?? "U"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-[#1F1F24] dark:text-white sm:inline">{user?.name}</span>
              <span className="hidden rounded-full bg-[#00E6A0]/15 px-2 py-0.5 text-[11px] font-bold uppercase text-[#00A876] dark:text-[#00E6A0] md:inline">
                {user?.profiles.map((p) => PROFILE_LABEL[p]).join(" + ")}
              </span>
              <ChevronDown className="h-4 w-4 text-[#00E6A0]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[240px] rounded-[15px] border-0 bg-white p-3 shadow-[0px_4px_55px_rgba(0,0,0,0.08)] dark:bg-[#071E24] dark:shadow-[0px_4px_55px_rgba(0,0,0,0.5)]"
          >
            {isSuper && (
              <DropdownMenuItem onClick={reset} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm focus:bg-[rgba(0,230,160,0.08)]">
                <RotateCcw className="h-4 w-4 text-[#00E6A0]" />
                Restaurar dados fictícios
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={logout} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm focus:bg-[rgba(0,230,160,0.08)]">
              <LogOut className="h-4 w-4 text-[#00E6A0]" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className={cn("transition-all duration-300", collapsed ? "lg:pl-16" : "lg:pl-[268px]")}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="dark flex w-[280px] flex-col border-sidebar-border bg-[#020F14] p-0">
          <SheetTitle className="flex h-16 shrink-0 items-center px-4">
            <Logo />
          </SheetTitle>
          <Nav collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-h-screen min-w-0 flex-col gap-6 p-4 sm:p-6 lg:gap-8 lg:p-8">
        <Header onMenu={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1 pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
