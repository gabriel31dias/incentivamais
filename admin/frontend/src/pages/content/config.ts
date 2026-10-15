// Configuração dos módulos de conteúdo: cada `kind` do registro genérico
// (/api/records/:kind) descreve seus campos aqui e a RecordsPage monta lista,
// formulário e pré-visualização a partir disso.

export type FieldType =
  | "text"
  | "textarea"
  | "markdown"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "checkbox"
  | "profiles"
  | "distributors"
  | "image"
  | "url"
  | "color"
  | "lines"
  /** índice escolhido entre as linhas do campo `from` (ex.: alternativa correta) */
  | "choice"
  | "repeater";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  /** campos de cada item (repeater) */
  fields?: FieldDef[];
  /** choice: campo irmão com as opções */
  from?: string;
  required?: boolean;
  hint?: string;
  /** ocupa a linha inteira no formulário */
  full?: boolean;
  /** rótulo do botão "adicionar" (repeater) */
  addLabel?: string;
};

export type KindDef = {
  kind: string;
  label: string;
  singular: string;
  /** rótulo do campo título */
  titleLabel?: string;
  fields: FieldDef[];
  /** publicar/despublicar/agendar (conteúdo) ou só ativar/desativar */
  flow: "publish" | "toggle";
  /** texto curto abaixo do título na listagem */
  summary?: (data: Record<string, any>) => string; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** campo de data usado no agendamento */
  scheduleKey?: string;
};

const METRICS = [
  { value: "sales_qty", label: "Unidades vendidas" },
  { value: "sales_amount", label: "Valor vendido (R$)" },
  { value: "product_qty", label: "Unidades de um produto" },
  { value: "trainings", label: "Treinamentos concluídos" },
  { value: "quizzes", label: "Quizzes acertados" },
  { value: "ranking", label: "Posição no ranking" },
  { value: "goal_pct", label: "% da meta" },
];
const OPERATORS = [
  { value: ">=", label: "≥ (pelo menos)" },
  { value: ">", label: "> (mais que)" },
  { value: "=", label: "= (igual a)" },
  { value: "<=", label: "≤ (no máximo)" },
];
const PERIODS = [
  { value: "week", label: "Na semana" },
  { value: "month", label: "No mês" },
  { value: "campaign", label: "Na campanha" },
];

/** condição de conquista configurável (missões, medalhas, desafios) */
const CONDITION: FieldDef = {
  key: "rule",
  label: "Condição de conquista",
  type: "repeater",
  addLabel: "Adicionar condição",
  full: true,
  hint: "Todas as condições precisam ser atendidas (E).",
  fields: [
    { key: "metric", label: "Métrica", type: "select", options: METRICS },
    { key: "operator", label: "Operador", type: "select", options: OPERATORS },
    { key: "value", label: "Valor", type: "number" },
    { key: "period", label: "Período", type: "select", options: PERIODS },
  ],
};

const SEGMENT: FieldDef[] = [
  { key: "profiles", label: "Perfis (vazio = todos)", type: "profiles" },
  { key: "distributorIds", label: "Distribuidoras (vazio = todas)", type: "distributors" },
];

const short = (text: unknown, size = 80) => {
  const s = String(text ?? "");
  return s.length > size ? s.slice(0, size) + "…" : s;
};

export const KINDS: Record<string, KindDef> = {
  news: {
    kind: "news",
    label: "Notícias",
    singular: "notícia",
    flow: "publish",
    scheduleKey: "publishAt",
    summary: (d) => short(d.summary),
    fields: [
      { key: "summary", label: "Resumo", type: "textarea", full: true, required: true },
      { key: "body", label: "Conteúdo", type: "markdown", full: true, hint: "Aceita **negrito**, *itálico*, listas com - e linhas em branco entre parágrafos." },
      { key: "image", label: "Imagem de capa", type: "image", full: true },
      { key: "publishAt", label: "Publicar em", type: "date", hint: "Data futura → fica agendada." },
      ...SEGMENT,
    ],
  },
  video: {
    kind: "video",
    label: "Vídeos",
    singular: "vídeo",
    flow: "publish",
    scheduleKey: "publishAt",
    summary: (d) => short(d.url),
    fields: [
      { key: "url", label: "URL do vídeo", type: "url", required: true, full: true },
      { key: "duration", label: "Duração (min)", type: "number" },
      { key: "publishAt", label: "Publicar em", type: "date" },
      { key: "description", label: "Descrição", type: "textarea", full: true },
      { key: "image", label: "Miniatura", type: "image", full: true },
      ...SEGMENT,
    ],
  },
  material: {
    kind: "material",
    label: "Materiais",
    singular: "material",
    flow: "publish",
    scheduleKey: "publishAt",
    summary: (d) => short(d.format ? `${d.format} · ${d.url ?? ""}` : d.url),
    fields: [
      { key: "url", label: "Link do arquivo", type: "url", required: true, full: true },
      {
        key: "format",
        label: "Formato",
        type: "select",
        options: ["PDF", "Planilha", "Apresentação", "Imagem", "Outro"].map((v) => ({ value: v, label: v })),
      },
      { key: "publishAt", label: "Publicar em", type: "date" },
      { key: "description", label: "Descrição", type: "textarea", full: true },
      ...SEGMENT,
    ],
  },
  banner: {
    kind: "banner",
    label: "Banners",
    singular: "banner",
    flow: "publish",
    scheduleKey: "startDate",
    summary: (d) => `${d.startDate ? `de ${d.startDate.split("-").reverse().join("/")}` : ""} ${d.endDate ? `até ${d.endDate.split("-").reverse().join("/")}` : ""} · ${d.link ?? ""}`,
    fields: [
      { key: "image", label: "Imagem do banner", type: "image", full: true, hint: "Proporção sugerida 3:1." },
      { key: "link", label: "Link ao tocar", type: "text", hint: "Rota do app (/campanhas/2) ou URL." },
      { key: "startDate", label: "Exibir de", type: "date" },
      { key: "endDate", label: "Exibir até", type: "date" },
      ...SEGMENT,
    ],
  },
  notice: {
    kind: "notice",
    label: "Comunicados",
    singular: "comunicado",
    flow: "publish",
    scheduleKey: "publishAt",
    summary: (d) => short(d.body),
    fields: [
      { key: "body", label: "Mensagem", type: "markdown", full: true, required: true },
      {
        key: "channel",
        label: "Canal",
        type: "select",
        options: [
          { value: "app", label: "Somente no app" },
          { value: "app_push", label: "App + notificação push" },
          { value: "app_email", label: "App + e-mail" },
        ],
      },
      { key: "publishAt", label: "Publicar em", type: "date" },
      ...SEGMENT,
    ],
  },
  training: {
    kind: "training",
    label: "Treinamentos",
    singular: "curso",
    titleLabel: "Nome do curso",
    flow: "publish",
    summary: (d) => {
      const modules = Array.isArray(d.modules) ? d.modules : [];
      const lessons = modules.reduce(
        (s: number, m: { lessons?: unknown }) => s + (Array.isArray(m.lessons) ? m.lessons.length : Number(m.lessons ?? 0)),
        0,
      );
      return `${modules.length} módulo(s) · ${lessons} aula(s) · ${d.points ?? 0} pts`;
    },
    fields: [
      { key: "description", label: "Descrição", type: "textarea", full: true },
      { key: "image", label: "Capa", type: "image", full: true },
      {
        key: "category",
        label: "Categoria",
        type: "select",
        options: ["Vendas", "Produtos", "Atendimento", "Sistema", "Compliance"].map((c) => ({ value: c, label: c })),
      },
      { key: "points", label: "Pontos por conclusão", type: "number" },
      { key: "completionRule", label: "Regra de conclusão", type: "text", hint: "Ex.: 100% das aulas + quiz ≥ 70%" },
      { key: "certificate", label: "Emite certificado", type: "checkbox" },
      { key: "workloadHours", label: "Carga horária (h)", type: "number" },
      {
        key: "modules",
        label: "Módulos",
        type: "repeater",
        full: true,
        addLabel: "Adicionar módulo",
        fields: [
          { key: "title", label: "Título do módulo", type: "text" },
          {
            key: "lessons",
            label: "Aulas",
            type: "repeater",
            addLabel: "Adicionar aula",
            fields: [
              { key: "title", label: "Aula", type: "text" },
              { key: "video", label: "URL do vídeo", type: "url" },
              { key: "material", label: "Material complementar (URL)", type: "url" },
              { key: "minutes", label: "Minutos", type: "number" },
            ],
          },
        ],
      },
      ...SEGMENT,
    ],
  },
  quiz: {
    kind: "quiz",
    label: "Quiz",
    singular: "quiz",
    flow: "publish",
    summary: (d) =>
      `${Array.isArray(d.questions) ? d.questions.length : 0} pergunta(s) · ${d.points ?? 0} pts · ${d.attempts ?? 1} tentativa(s)` +
      (d.startDate ? ` · ${String(d.startDate).split("-").reverse().join("/")} a ${String(d.endDate ?? "").split("-").reverse().join("/")}` : ""),
    fields: [
      { key: "points", label: "Pontuação", type: "number" },
      { key: "timeLimit", label: "Tempo limite (segundos)", type: "number" },
      { key: "attempts", label: "Nº de tentativas", type: "number" },
      { key: "passPct", label: "Acerto mínimo (%)", type: "number" },
      { key: "startDate", label: "Vigência: início", type: "date" },
      { key: "endDate", label: "Vigência: fim", type: "date" },
      {
        key: "questions",
        label: "Perguntas",
        type: "repeater",
        full: true,
        addLabel: "Adicionar pergunta",
        fields: [
          { key: "q", label: "Pergunta", type: "text" },
          { key: "options", label: "Alternativas (uma por linha)", type: "lines" },
          { key: "correct", label: "Resposta correta", type: "choice", from: "options" },
        ],
      },
      ...SEGMENT,
    ],
  },
  poll: {
    kind: "poll",
    label: "Enquetes",
    singular: "enquete",
    flow: "publish",
    summary: (d) => {
      const votes: number[] = Array.isArray(d.votes) ? d.votes : [];
      return `${Array.isArray(d.options) ? d.options.length : 0} opção(ões) · ${votes.reduce((a, b) => a + Number(b || 0), 0).toLocaleString("pt-BR")} voto(s)`;
    },
    fields: [
      { key: "options", label: "Opções (uma por linha)", type: "lines", full: true, required: true },
      { key: "startDate", label: "Vigência: início", type: "date" },
      { key: "endDate", label: "Vigência: fim", type: "date" },
      ...SEGMENT,
    ],
  },
  mission: {
    kind: "mission",
    label: "Missões",
    singular: "missão",
    flow: "toggle",
    summary: (d) => `${d.points ?? 0} pts${d.medal ? ` · medalha ${d.medal}` : ""}`,
    fields: [
      { key: "description", label: "Descrição", type: "textarea", full: true },
      { key: "points", label: "Pontos ao concluir", type: "number" },
      { key: "medal", label: "Medalha concedida", type: "text", hint: "Nome de uma medalha cadastrada." },
      CONDITION,
      ...SEGMENT,
    ],
  },
  medal: {
    kind: "medal",
    label: "Medalhas",
    singular: "medalha",
    flow: "toggle",
    summary: (d) => short(d.condition ?? ""),
    fields: [
      { key: "condition", label: "Descrição da conquista", type: "text", full: true },
      { key: "image", label: "Ícone/imagem", type: "image", full: true },
      { key: "points", label: "Pontos bônus", type: "number" },
      CONDITION,
    ],
  },
  level: {
    kind: "level",
    label: "Níveis",
    singular: "nível",
    flow: "toggle",
    summary: (d) => `A partir de ${Number(d.minPoints ?? 0).toLocaleString("pt-BR")} pontos`,
    fields: [
      { key: "minPoints", label: "Pontos mínimos", type: "number", required: true },
      { key: "benefits", label: "Benefícios", type: "textarea", full: true },
      { key: "color", label: "Cor (hex)", type: "text", hint: "#CD7F32" },
    ],
  },
  challenge: {
    kind: "challenge",
    label: "Desafios",
    singular: "desafio",
    flow: "toggle",
    summary: (d) => `${d.points ?? 0} pts${d.startDate ? ` · ${String(d.startDate).split("-").reverse().join("/")} a ${String(d.endDate ?? "").split("-").reverse().join("/")}` : ""}`,
    fields: [
      { key: "description", label: "Descrição", type: "textarea", full: true },
      { key: "points", label: "Pontos ao vencer", type: "number" },
      {
        key: "mode",
        label: "Modalidade",
        type: "select",
        options: [
          { value: "individual", label: "Individual" },
          { value: "team", label: "Por equipe" },
          { value: "distributor", label: "Entre distribuidoras" },
        ],
      },
      { key: "startDate", label: "Início", type: "date" },
      { key: "endDate", label: "Fim", type: "date" },
      CONDITION,
      ...SEGMENT,
    ],
  },
  reward: {
    kind: "reward",
    label: "Catálogo",
    singular: "prêmio",
    titleLabel: "Nome do prêmio",
    flow: "toggle",
    summary: (d) => `${Number(d.points ?? 0).toLocaleString("pt-BR")} pts · estoque ${d.stock ?? 0}`,
    fields: [
      { key: "points", label: "Pontos necessários", type: "number", required: true },
      { key: "stock", label: "Estoque", type: "number", required: true },
      { key: "startDate", label: "Vigência: início", type: "date" },
      { key: "endDate", label: "Vigência: fim", type: "date" },
      { key: "description", label: "Descrição", type: "textarea", full: true },
      { key: "image", label: "Foto", type: "image", full: true },
      ...SEGMENT,
    ],
  },
  message_template: {
    kind: "message_template",
    label: "Modelos de mensagens",
    singular: "modelo",
    flow: "toggle",
    summary: (d) => `${d.channel ?? "e-mail"} · ${short(d.subject ?? d.body, 60)}`,
    fields: [
      {
        key: "channel",
        label: "Canal",
        type: "select",
        options: [
          { value: "e-mail", label: "E-mail" },
          { value: "push", label: "Push" },
          { value: "sms", label: "SMS" },
          { value: "whatsapp", label: "WhatsApp" },
        ],
      },
      { key: "event", label: "Evento", type: "text", hint: "Ex.: pontos_creditados, resgate_aprovado" },
      { key: "subject", label: "Assunto", type: "text", full: true },
      { key: "body", label: "Mensagem", type: "textarea", full: true, hint: "Variáveis: {{nome}}, {{pontos}}, {{campanha}}" },
    ],
  },
};

/** seções do menu → abas (kinds) */
export const SECTIONS: Record<string, { kinds: string[]; intro: string }> = {
  news: { kinds: ["news", "video", "material"], intro: "Notícias, vídeos e materiais exibidos no app, com segmentação e agendamento." },
  banners: { kinds: ["banner"], intro: "Banners rotativos da tela inicial do app." },
  notices: { kinds: ["notice"], intro: "Comunicados oficiais para perfis e distribuidoras específicos." },
  trainings: { kinds: ["training"], intro: "Cursos com módulos e aulas, pontos por conclusão e certificado." },
  quiz: { kinds: ["quiz", "poll"], intro: "Quizzes pontuados e enquetes de opinião." },
  gamification: { kinds: ["mission", "medal", "level", "challenge"], intro: "Missões, medalhas, níveis e desafios com condições de conquista." },
};

/** valor inicial vazio para um campo */
export function emptyValue(f: FieldDef): unknown {
  if (f.type === "repeater" || f.type === "profiles" || f.type === "distributors" || f.type === "lines") return [];
  if (f.type === "checkbox") return false;
  if (f.type === "choice") return 0;
  return "";
}
