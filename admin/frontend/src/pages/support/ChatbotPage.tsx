// Chatbot simulado: respostas pré-definidas por palavra-chave, sem IA nem
// integração externa. "Falar com atendente" abre um chamado real (SQLite).
import { Badge, card, fieldClass, primaryButton, secondaryButton } from "@/shared/components/kit";
import { api, useAuth } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Bot, Headset, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Rec } from "../content/RecordForm";

type Msg = { from: "bot" | "user" | "system"; text: string };

const INTENTS: { key: string; label: string; words: string[]; answer: string }[] = [
  {
    key: "saldo",
    label: "Meu saldo de pontos",
    words: ["saldo", "pontos", "quantos pontos", "extrato"],
    answer:
      "Seu saldo aparece em Pontos → Meu Extrato no app. Os pontos de uma venda são creditados depois que o ponto focal da sua distribuidora envia a planilha do mês e o lote é processado.",
  },
  {
    key: "importacao",
    label: "Prazo de importação",
    words: ["prazo", "importação", "importacao", "planilha", "enviar vendas"],
    answer:
      "Os pontos focais enviam as vendas de cada mês até o dia 10 do mês seguinte. Se a planilha tiver inconsistências, o lote fica pendente até ser corrigido e reenviado.",
  },
  {
    key: "resgate",
    label: "Como resgatar prêmios",
    words: ["resgate", "resgatar", "prêmio", "premio", "trocar"],
    answer:
      "Acesse Prêmios no app, escolha o item e confirme. O pedido passa por: Solicitado → Aprovado → Enviado → Entregue. O mínimo para resgate é de 500 pontos.",
  },
  {
    key: "treinamento",
    label: "Treinamentos",
    words: ["treinamento", "curso", "aula", "certificado"],
    answer:
      "Os cursos ficam em Conteúdos → Treinamentos. Ao concluir todas as aulas (e o quiz, quando houver) você ganha os pontos do curso e, se houver, o certificado.",
  },
];

const CATEGORY: Record<string, string> = { saldo: "Pontuação", importacao: "Importação", resgate: "Premiações", treinamento: "Treinamentos" };

const answerFor = (text: string) => {
  const t = text.toLowerCase();
  return INTENTS.find((i) => i.words.some((w) => t.includes(w)));
};

const WELCOME: Msg = { from: "bot", text: "Olá! Sou o assistente da Incentiva+. Posso ajudar com pontos, importação de vendas, resgates e treinamentos." };

export function ChatbotPage() {
  const user = useAuth((s) => s.user);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [text, setText] = useState("");
  const [ticket, setTicket] = useState<Rec | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [messages]);

  const ask = (question: string) => {
    if (!question.trim()) return;
    const intent = answerFor(question);
    setMessages((m) => [
      ...m,
      { from: "user", text: question },
      {
        from: "bot",
        text: intent?.answer ?? "Não entendi muito bem. Você pode escolher um dos assuntos abaixo ou falar com um atendente humano.",
      },
    ]);
    setText("");
  };

  const transfer = useMutation({
    mutationFn: () => {
      const transcript = messages
        .filter((m) => m.from !== "system")
        .map((m) => `${m.from === "bot" ? "Bot" : user?.name ?? "Usuário"}: ${m.text}`)
        .join("\n");
      const firstQuestion = messages.find((m) => m.from === "user")?.text;
      return api.post<Rec>("/records/ticket/open", {
        title: `Chatbot: ${firstQuestion ? firstQuestion.slice(0, 80) : "solicitação de atendimento"}`,
        transcript,
        category: CATEGORY[answerFor(firstQuestion ?? "")?.key ?? ""] ?? "Chatbot",
      });
    },
    onSuccess: (rec) => {
      setTicket(rec);
      setMessages((m) => [...m, { from: "system", text: `Conversa transferida. Chamado #${rec.id} aberto para um atendente humano.` }]);
      toast.success(`Chamado #${rec.id} aberto.`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className={cn(card, "flex h-[70vh] min-h-[480px] flex-col overflow-hidden")}>
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] px-5 py-4 dark:border-border/40">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00E6A0]/15 text-[#00A876] dark:text-[#00E6A0]">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[#1F1F24] dark:text-white">Assistente Incentiva+</p>
            <p className="text-xs text-[#73737D] dark:text-muted-foreground">Respostas pré-definidas</p>
          </div>
          <Badge tone="yellow">Simulado</Badge>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
          {messages.map((m, i) =>
            m.from === "system" ? (
              <p key={i} className="text-center text-xs font-semibold text-[#00A876] dark:text-[#00E6A0]">
                {m.text}
              </p>
            ) : (
              <div key={i} className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                    m.from === "user" ? "bg-[#00E6A0] text-[#03261A]" : "bg-[#F1F3F5] text-[#1F1F24] dark:bg-white/[0.06] dark:text-white",
                  )}
                >
                  {m.text}
                </div>
              </div>
            ),
          )}
          {!ticket && (
            <div className="flex flex-wrap gap-2 pt-1">
              {INTENTS.map((i) => (
                <button key={i.key} className={cn(secondaryButton, "h-8 rounded-full px-3 text-xs")} onClick={() => ask(i.label)}>
                  {i.label}
                </button>
              ))}
            </div>
          )}
          <div ref={end} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
          className="flex gap-2 border-t border-[#E5E7EB] p-4 dark:border-border/40"
        >
          <input
            aria-label="Mensagem"
            className={fieldClass}
            placeholder={ticket ? "Conversa transferida para atendimento humano" : "Digite sua dúvida..."}
            value={text}
            disabled={!!ticket}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className={primaryButton} disabled={!!ticket || !text.trim()} aria-label="Enviar">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </section>

      <aside className={cn(card, "h-fit space-y-4 p-5")}>
        <h2 className="flex items-center gap-2 font-bold text-[#1F1F24] dark:text-white">
          <Headset className="h-5 w-5 text-[#00A876] dark:text-[#00E6A0]" />
          Atendimento humano
        </h2>
        <p className="text-sm text-[#73737D] dark:text-muted-foreground">
          Se o assistente não resolver, transfira: abrimos um chamado com toda a conversa para a equipe de atendimento.
        </p>
        {ticket ? (
          <div className="space-y-3">
            <Badge tone="green">Chamado #{ticket.id} aberto</Badge>
            <Link to="/atendimento/chamados" className={cn(secondaryButton, "w-full")}>
              Ver em Chamados
            </Link>
            <button
              className={cn(secondaryButton, "w-full")}
              onClick={() => {
                setTicket(null);
                setMessages([WELCOME]);
              }}
            >
              Nova conversa
            </button>
          </div>
        ) : (
          <button className={cn(primaryButton, "w-full")} onClick={() => transfer.mutate()} disabled={transfer.isPending}>
            <Headset className="h-4 w-4" />
            {transfer.isPending ? "Transferindo..." : "Falar com atendente"}
          </button>
        )}
        <p className="text-xs text-[#8C8C96]">Demonstração: o chat não usa IA nem serviços externos; o chamado é gravado no banco local.</p>
      </aside>
    </div>
  );
}
