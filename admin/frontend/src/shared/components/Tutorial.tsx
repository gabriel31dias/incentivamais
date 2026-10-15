// Tutorial do painel: abre sozinho no primeiro acesso e pelo botão "Tutorial" no header.
import { primaryButton, secondaryButton } from "@/shared/components/kit";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";
import { can, useAuth, type Permission } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CloudUpload,
  Coins,
  FlaskConical,
  ListTree,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type Step = {
  icon: LucideIcon;
  title: string;
  text: string;
  points: string[];
  link?: { label: string; path: string; perm?: Permission[] };
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Bem-vindo ao painel Incentiva+",
    text: "Aqui você administra a campanha de incentivo: quem participa, como as vendas viram pontos e o que cada perfil vê no app.",
    points: [
      "O menu lateral é dividido em grupos. Clique no nome de um grupo para recolher ou expandir.",
      "O botão no topo da barra lateral recolhe o menu. No celular, o menu abre pelo ícone ☰.",
      "Toda listagem tem busca, filtros (botão Filtros) e ordenação clicando no título da coluna.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Perfis, permissões e escopo",
    text: "O que aparece para você depende dos seus perfis. Um usuário pode ter mais de um, por exemplo Gerente + Ponto Focal.",
    points: [
      "As permissões dos perfis se somam e vale o maior escopo: próprios dados, própria equipe, distribuidoras atribuídas ou toda a organização.",
      "Esconder um menu não é segurança: o servidor confere a permissão em cada operação.",
      "Toda alteração fica registrada em Logs e Auditoria, com o valor anterior e o novo.",
    ],
    link: { label: "Abrir Perfis e Permissões", path: "/config/perfis", perm: ["USERS_EDIT"] },
  },
  {
    icon: Building2,
    title: "Gestão comercial",
    text: "Cadastre a estrutura da campanha: distribuidoras, gerentes, pontos focais, equipes e vendedores.",
    points: [
      "Fluxo sugerido: cadastrar distribuidora → criar gerente → cadastrar vendedores → vincular à equipe.",
      "Na lista de usuários, marque várias linhas para editar em massa, bloquear ou transferir de equipe.",
      "Clique numa distribuidora para ver o painel dela: vendas, equipes, metas e importações.",
    ],
    link: { label: "Ir para Distribuidoras", path: "/distribuidoras", perm: ["USERS_VIEW"] },
  },
  {
    icon: CloudUpload,
    title: "Importação de vendas",
    text: "Todo mês o ponto focal envia a planilha de vendas da distribuidora. O assistente tem 5 etapas: Selecionar → Validar → Prévia → Confirmar → Processar.",
    points: [
      "Sem planilha? Use “Planilha de exemplo” (válida, com inconsistências ou de correção), que já vem anexada.",
      "Na prévia, cada inconsistência vem com orientação de correção e dá para baixar os erros em CSV.",
      "Reenviar ou reprocessar nunca duplica pontos: cada venda tem uma chave única (distribuidora:documento:item).",
      "Uma venda corrigida gera um ajuste ou estorno pela diferença. O original é preservado.",
    ],
    link: { label: "Fazer uma importação", path: "/importacao/nova", perm: ["SALES_IMPORT"] },
  },
  {
    icon: Coins,
    title: "Campanhas, regras e pontos",
    text: "As regras de pontuação definem quantos pontos cada venda gera. Por exemplo: Produto A vale 10 pts por unidade e o Produto C, 5 pts a cada R$ 100.",
    points: [
      "Editar uma regra cria uma versão nova. Os pontos já creditados não mudam.",
      "Use o simulador na tela de regras para testar uma venda antes de publicar.",
      "Ajustes manuais exigem justificativa e confirmação. O extrato nunca apaga lançamentos: corrige com estorno vinculado.",
    ],
    link: { label: "Ver Regras de Pontuação", path: "/regras", perm: ["POINT_RULES_MANAGE"] },
  },
  {
    icon: ListTree,
    title: "Menus dinâmicos do app",
    text: "Monte o menu que vendedores, gerentes e pontos focais veem no aplicativo, sem alterar código.",
    points: [
      "Arraste os itens na árvore para reordenar ou soltar dentro de outro e virar submenu.",
      "Marque vários menus para mudar perfis, vigência, visibilidade ou distribuidoras de uma vez só.",
      "Teste com “Gerar 100 menus”: uma única operação ajusta todos, então o trabalho não cresce com a quantidade.",
      "A pré-visualização mostra o menu no celular como cada perfil vai ver.",
    ],
    link: { label: "Abrir Menus Dinâmicos", path: "/config/menus", perm: ["MENUS_MANAGE"] },
  },
  {
    icon: BarChart3,
    title: "Acompanhamento",
    text: "Acompanhe resultados e o que precisa de atenção.",
    points: [
      "Dashboard: vendas, pontos, metas, ranking das distribuidoras e alertas, com filtros por período, distribuidora e campanha.",
      "Central de atividades: pendências (lotes para confirmar, chamados, resgates) e o histórico de ações.",
      "Relatórios: gráficos, tabelas e exportação para CSV.",
    ],
    link: { label: "Ir para o Dashboard", path: "/dashboard" },
  },
  {
    icon: FlaskConical,
    title: "Ambiente de demonstração",
    text: "Todos os dados são fictícios e gravam apenas no banco local. Fique à vontade para testar.",
    points: [
      "Entre com outros usuários na tela de login (senha demo123) para ver o painel como gerente ou vendedor.",
      "Super Admin: “Restaurar dados fictícios”, no menu do usuário, recria todo o banco.",
      "Este tutorial pode ser aberto de novo pelo botão “Tutorial”, no topo da tela.",
    ],
  },
];

const SEEN_KEY = "incentiva-admin-tutorial-seen";

/** estado do tutorial: abre sozinho uma vez por navegador */
export function useTutorial() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* sem storage: não abre sozinho */
    }
  }, []);
  const close = (o: boolean) => {
    setOpen(o);
    if (!o)
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ok */
      }
  };
  return { open, setOpen: close };
}

export function Tutorial({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [i, setI] = useState(0);
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const link = step.link && can(user, ...(step.link.perm ?? [])) ? step.link : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl gap-0 overflow-hidden rounded-2xl p-0">
        <div className="relative overflow-hidden bg-[#020F14] px-6 pb-5 pt-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,230,160,0.28),transparent_60%)]" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#00E6A0]/15 text-[#00E6A0]">
              <step.icon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#00E6A0]">
                Tutorial · {i + 1} de {STEPS.length}
              </p>
              <DialogTitle className="text-lg font-bold text-white">{step.title}</DialogTitle>
            </div>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-6 py-5">
          <DialogDescription className="text-sm leading-6 text-[#52525B] dark:text-[#C7CCD1]">{step.text}</DialogDescription>
          <ul className="mt-4 space-y-2.5">
            {step.points.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm leading-6 text-[#1F1F24] dark:text-white">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#00E6A0]" />
                {p}
              </li>
            ))}
          </ul>
          {link && (
            <button
              onClick={() => {
                onOpenChange(false);
                navigate(link.path);
              }}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#00A876] hover:underline dark:text-[#00E6A0]"
            >
              {link.label}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#E5E7EB] px-6 py-4 dark:border-border/40">
          <div className="flex gap-1.5" role="tablist" aria-label="Etapas do tutorial">
            {STEPS.map((s, n) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={n === i}
                aria-label={`Etapa ${n + 1}: ${s.title}`}
                onClick={() => setI(n)}
                className={cn("h-2 rounded-full transition-all", n === i ? "w-6 bg-[#00E6A0]" : "w-2 bg-[#D4D4D8] hover:bg-[#00E6A0]/60 dark:bg-white/20")}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 ? (
              <button className={secondaryButton} onClick={() => setI(i - 1)}>
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Voltar</span>
              </button>
            ) : (
              <button className={secondaryButton} onClick={() => onOpenChange(false)}>
                Pular
              </button>
            )}
            <button className={primaryButton} onClick={() => (last ? onOpenChange(false) : setI(i + 1))}>
              {last ? "Começar" : "Próximo"}
              {!last && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
