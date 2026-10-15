// Menu do painel admin: fonte única para a sidebar e o título do header.
// `perm`: some do menu sem a permissão (conveniência; quem protege é o backend).
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  ClipboardCheck,
  CloudUpload,
  Coins,
  FileDown,
  FileWarning,
  Flag,
  Gift,
  GraduationCap,
  Grid2X2,
  History,
  Image,
  KeyRound,
  ListTree,
  Megaphone,
  MessageSquare,
  Newspaper,
  PieChart,
  RefreshCcw,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Trophy,
  UserCog,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "./api";

export type NavItem = { icon: LucideIcon; label: string; path: string; perm?: Permission[] };
export type NavSection = { label: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    label: "Visão Geral",
    items: [
      { icon: Grid2X2, label: "Dashboard", path: "/dashboard" },
      { icon: Activity, label: "Central de atividades", path: "/atividades", perm: ["REPORTS_VIEW"] },
    ],
  },
  {
    label: "Gestão Comercial",
    items: [
      { icon: Building2, label: "Distribuidoras", path: "/distribuidoras", perm: ["USERS_VIEW"] },
      { icon: UsersRound, label: "Equipes", path: "/equipes", perm: ["TEAMS_MANAGE"] },
      { icon: UserCog, label: "Gerentes", path: "/gerentes", perm: ["USERS_VIEW"] },
      { icon: Users, label: "Vendedores", path: "/vendedores", perm: ["USERS_VIEW"] },
      { icon: UserRound, label: "Pontos Focais", path: "/pontos-focais", perm: ["USERS_VIEW"] },
    ],
  },
  {
    label: "Campanhas e Incentivos",
    items: [
      { icon: Megaphone, label: "Campanhas", path: "/campanhas", perm: ["CAMPAIGNS_MANAGE"] },
      { icon: Target, label: "Metas", path: "/metas", perm: ["CAMPAIGNS_MANAGE", "TEAMS_MANAGE"] },
      { icon: Scale, label: "Regras de Pontuação", path: "/regras", perm: ["POINT_RULES_MANAGE"] },
      { icon: Coins, label: "Extrato de Pontos", path: "/extrato", perm: ["POINTS_ADJUST", "REPORTS_VIEW"] },
      { icon: SlidersHorizontal, label: "Ajustes de Pontos", path: "/ajustes", perm: ["POINTS_ADJUST"] },
      { icon: Gift, label: "Premiações", path: "/premiacoes", perm: ["CONTENT_MANAGE"] },
    ],
  },
  {
    label: "Importação de Vendas",
    items: [
      { icon: CloudUpload, label: "Nova Importação", path: "/importacao/nova", perm: ["SALES_IMPORT"] },
      { icon: ClipboardCheck, label: "Histórico de Lotes", path: "/importacao/lotes", perm: ["SALES_IMPORT", "SALES_VALIDATE", "SALES_APPROVE"] },
      { icon: FileWarning, label: "Validação e Inconsistências", path: "/importacao/validacao", perm: ["SALES_VALIDATE", "SALES_APPROVE"] },
      { icon: RefreshCcw, label: "Reprocessamentos", path: "/importacao/reprocessamentos", perm: ["SALES_REPROCESS", "SALES_APPROVE"] },
    ],
  },
  {
    label: "Conteúdos",
    items: [
      { icon: Newspaper, label: "Notícias", path: "/conteudos/noticias", perm: ["CONTENT_MANAGE"] },
      { icon: Image, label: "Banners", path: "/conteudos/banners", perm: ["CONTENT_MANAGE"] },
      { icon: Megaphone, label: "Comunicados", path: "/conteudos/comunicados", perm: ["CONTENT_MANAGE"] },
      { icon: GraduationCap, label: "Treinamentos", path: "/conteudos/treinamentos", perm: ["CONTENT_MANAGE"] },
      { icon: ClipboardCheck, label: "Quiz e Enquetes", path: "/conteudos/quiz", perm: ["CONTENT_MANAGE"] },
      { icon: Flag, label: "Missões e Medalhas", path: "/conteudos/gamificacao", perm: ["CONTENT_MANAGE"] },
    ],
  },
  {
    label: "Configurações",
    items: [
      { icon: ListTree, label: "Menus Dinâmicos", path: "/config/menus", perm: ["MENUS_MANAGE"] },
      { icon: ShieldCheck, label: "Perfis e Permissões", path: "/config/perfis", perm: ["USERS_EDIT"] },
      { icon: Users, label: "Usuários", path: "/config/usuarios", perm: ["USERS_VIEW"] },
      { icon: ScrollText, label: "Logs e Auditoria", path: "/config/auditoria", perm: ["REPORTS_VIEW", "USERS_EDIT"] },
      { icon: KeyRound, label: "Segurança", path: "/config/seguranca", perm: ["USERS_DISABLE"] },
      { icon: Settings, label: "Configurações Gerais", path: "/config/geral", perm: ["USERS_EDIT"] },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { icon: MessageSquare, label: "Chamados", path: "/atendimento/chamados", perm: ["CONTENT_MANAGE"] },
      { icon: Bot, label: "Chatbot", path: "/atendimento/chatbot" },
      { icon: History, label: "Histórico de Atendimentos", path: "/atendimento/historico", perm: ["CONTENT_MANAGE"] },
    ],
  },
  {
    label: "Relatórios",
    items: [
      { icon: TrendingUp, label: "Vendas", path: "/relatorios/vendas", perm: ["REPORTS_VIEW"] },
      { icon: BarChart3, label: "Desempenho", path: "/relatorios/desempenho", perm: ["REPORTS_VIEW"] },
      { icon: Coins, label: "Pontuação", path: "/relatorios/pontuacao", perm: ["REPORTS_VIEW"] },
      { icon: Building2, label: "Distribuidoras", path: "/relatorios/distribuidoras", perm: ["REPORTS_VIEW"] },
      { icon: PieChart, label: "Campanhas", path: "/relatorios/campanhas", perm: ["REPORTS_VIEW"] },
      { icon: Trophy, label: "Rankings", path: "/relatorios/rankings", perm: ["REPORTS_VIEW"] },
      { icon: FileDown, label: "Exportações", path: "/relatorios/exportacoes", perm: ["REPORTS_VIEW"] },
    ],
  },
];

export const NAV_ITEMS = NAV.flatMap((s) => s.items);

/** item do menu para a rota atual (rotas de detalhe herdam do pai) */
export const navFor = (pathname: string) =>
  [...NAV_ITEMS].sort((a, b) => b.path.length - a.path.length).find((i) => pathname === i.path || pathname.startsWith(i.path + "/")) ??
  NAV_ITEMS[0];
