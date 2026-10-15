// Tipos e utilitários dos menus dinâmicos (árvore, ícones, rótulos)
import type { ProfileKey } from "@/shared/lib/api";
import { icons, type LucideProps } from "lucide-react";

export type MenuType = "page" | "link" | "report" | "content" | "feature";

export interface Menu {
  id: number;
  title: string;
  icon: string;
  type: MenuType;
  target: string;
  parentId: number | null;
  order: number;
  status: "active" | "inactive";
  startDate: string | null;
  endDate: string | null;
  profiles: ProfileKey[];
  distributorIds: number[];
  groups: string[];
  permission: string | null;
  /** item principal do menu próprio de distribuidora */
  ownMenu?: boolean;
  updatedAt: string;
}

export type MenuNode = Menu & { children: MenuNode[] };

export type PreviewNode = { id: number; title: string; icon: string; type: MenuType; target: string; children: PreviewNode[] };

export const TYPE_LABEL: Record<MenuType, string> = {
  page: "Página",
  link: "Link externo",
  report: "Relatório",
  content: "Conteúdo",
  feature: "Funcionalidade",
};

/** ícones oferecidos no seletor (qualquer nome do lucide também funciona) */
export const ICON_CHOICES = [
  "House", "TrendingUp", "ShoppingCart", "Target", "Trophy", "Coins", "ReceiptText", "History", "Newspaper",
  "GraduationCap", "Gamepad2", "CircleHelp", "Flag", "Medal", "Users", "CloudUpload", "Gift", "Megaphone",
  "Calendar", "Star", "Zap", "Rocket", "BookOpen", "Video", "MessageCircle", "Bell", "ChartBar", "Layers",
  "ShoppingBag", "Calculator", "Vote", "ExternalLink", "Settings", "Heart", "MapPin", "Award",
];

export function MenuIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = icons[name as keyof typeof icons] ?? icons.Circle;
  return <Icon {...props} />;
}

export function buildTree(menus: Menu[]): MenuNode[] {
  const nodes = new Map<number, MenuNode>(menus.map((m) => [m.id, { ...m, children: [] }]));
  const roots: MenuNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId != null ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (list: MenuNode[]) => {
    list.sort((a, b) => a.order - b.order || a.id - b.id);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
