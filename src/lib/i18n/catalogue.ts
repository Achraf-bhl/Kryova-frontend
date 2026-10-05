/**
 * The message catalogue (ROAD_TO_10 8.6): English is the source, French the first translation.
 *
 * **In-house on purpose.** Doctrine allows three runtime dependencies, so an i18n library
 * would be a named decision in the master plan, and what this product needs is a keyed lookup
 * with `{name}` placeholders. `Messages` is derived from `en`, so a French table missing a key
 * (or carrying a stray one) is a type error, and `catalogue.test.ts` also checks that every
 * placeholder in an English message appears in its translation.
 *
 * Scope, stated: this translates the interface's own copy — the shell, the composer, the stop
 * banner, the shortcut sheet. Server error strings stay English (the plan's own scope), and
 * the surfaces not yet moved here still read English; moving one is adding keys, not a
 * rewrite. The CATIA seat is French V5-R33 and its menu names are the KB's business, not this
 * file's.
 *
 * Wording is French as an engineer writes it ("pièce", "analyse", "approbation"); a
 * native-speaker review is owed and is the user's call.
 */

export const en = {
  "nav.projects": "Projects",
  "nav.runs": "Runs",
  "nav.files": "Files",
  "nav.history": "History",
  "nav.approvals": "Approvals",
  "nav.teams": "Teams",
  "nav.settings": "Settings",
  "nav.operations": "Operations",
  "nav.sections": "Sections",
  "nav.home": "Kryova home",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",
  "chat.new": "New chat",
  "chat.search": "Search chats",
  "chat.searchLabel": "Search conversations",
  "auth.signOut": "Sign out",

  "composer.label": "Message the Kryova agent",
  "composer.placeholder": "Describe a part, or ask about a run…",
  "composer.deepAnalysis": "Deep analysis",
  "composer.deepAnalysisHint":
    "Let the agent run tools that change things: create projects, drive CATIA, start solves.",
  "composer.send": "Send message",
  "composer.sendHint": "Send (Enter)",
  "composer.sendBusy": "Waiting for the current run to finish",
  "composer.sendBusyHint": "The agent is still working on the last message.",
  "composer.stop": "Stop",
  "composer.stopping": "Stopping…",
  "composer.stopLabel": "Stop the current run",
  "composer.stoppingLabel": "Stopping after the current step — press again to cut the stream",
  "composer.stopHint": "Stop after the current step. Everything already done is kept.",
  "composer.stoppingHint":
    "Finishing the step already in flight, then stopping. Press again to cut the stream instead — that ends the connection, not the work.",

  "theme.system": "Theme: follows your system",
  "theme.light": "Theme: light",
  "theme.dark": "Theme: dark",
  "theme.change": "{state} — press to change",
  "locale.label": "Language",

  "shortcuts.title": "Keyboard shortcuts",
  "shortcuts.close": "Close",
  "shortcuts.stop": "Stop the running turn after its current step",
  "shortcuts.send": "Send the message",
  "shortcuts.new": "Start a new conversation",
  "shortcuts.search": "Search conversations",
  "shortcuts.help": "Show this list of shortcuts",

  "stop.cancelled":
    "You stopped this turn. Everything above really ran — say what to do next and it carries on from there.",
  "stop.repeated_calls":
    "The agent stopped because it kept repeating a call that had already been refused. Tell it what to do differently — it keeps everything it built.",
  "stop.needs_input.prompt":
    "The agent stopped to ask you something rather than keep retrying. Answer below and it carries on from what is built.",
  "stop.needs_input.prose":
    "The agent stopped to ask you something rather than keep retrying — the question is at the end of its answer. Answer it and it carries on from what is built.",
  "stop.awaiting_approval.prompt":
    "The agent reached a checkpoint that needs sign-off. Nothing past it has run — decide below, or open it under Approvals.",
  "stop.awaiting_approval.prose":
    "The agent reached a checkpoint that needs sign-off. Nothing past it has run; approve or reject it under Approvals and it carries on from there.",
  "stop.awaiting_approval.link": "Open Approvals",
  "stop.task_boundary":
    "The agent stopped at the end of a task because the rest of the plan would not fit in this turn's tool rounds. Everything above ran — press Continue to start the next task.",
  "stop.provider_busy":
    "The model provider stayed too busy to answer after several tries. Nothing was lost — press Continue to try again.",
  "stop.step_budget.continue":
    "The agent used all of its tool rounds for that turn. Everything above ran — press Continue to carry on from what is built.",
  "stop.step_budget.plain":
    "The agent ran out of tool rounds for that turn. Ask for one thing at a time and it will get further.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const fr: Messages = {
  "nav.projects": "Projets",
  "nav.runs": "Calculs",
  "nav.files": "Fichiers",
  "nav.history": "Historique",
  "nav.approvals": "Approbations",
  "nav.teams": "Équipes",
  "nav.settings": "Réglages",
  "nav.operations": "Exploitation",
  "nav.sections": "Sections",
  "nav.home": "Accueil Kryova",
  "nav.openMenu": "Ouvrir le menu",
  "nav.closeMenu": "Fermer le menu",
  "chat.new": "Nouvelle conversation",
  "chat.search": "Rechercher",
  "chat.searchLabel": "Rechercher dans les conversations",
  "auth.signOut": "Se déconnecter",

  "composer.label": "Écrire à l'agent Kryova",
  "composer.placeholder": "Décrivez une pièce, ou posez une question sur un calcul…",
  "composer.deepAnalysis": "Analyse approfondie",
  "composer.deepAnalysisHint":
    "Autoriser l'agent à lancer des outils qui modifient des choses : créer des projets, piloter CATIA, lancer des calculs.",
  "composer.send": "Envoyer le message",
  "composer.sendHint": "Envoyer (Entrée)",
  "composer.sendBusy": "En attente de la fin de l'exécution en cours",
  "composer.sendBusyHint": "L'agent travaille encore sur le dernier message.",
  "composer.stop": "Arrêter",
  "composer.stopping": "Arrêt en cours…",
  "composer.stopLabel": "Arrêter l'exécution en cours",
  "composer.stoppingLabel": "Arrêt après l'étape en cours — appuyez à nouveau pour couper le flux",
  "composer.stopHint": "Arrêter après l'étape en cours. Tout ce qui est déjà fait est conservé.",
  "composer.stoppingHint":
    "L'étape en cours se termine, puis l'agent s'arrête. Appuyez à nouveau pour couper le flux : cela ferme la connexion, pas le travail.",

  "theme.system": "Thème : celui du système",
  "theme.light": "Thème : clair",
  "theme.dark": "Thème : sombre",
  "theme.change": "{state} — appuyez pour changer",
  "locale.label": "Langue",

  "shortcuts.title": "Raccourcis clavier",
  "shortcuts.close": "Fermer",
  "shortcuts.stop": "Arrêter le tour en cours après son étape actuelle",
  "shortcuts.send": "Envoyer le message",
  "shortcuts.new": "Commencer une nouvelle conversation",
  "shortcuts.search": "Rechercher dans les conversations",
  "shortcuts.help": "Afficher cette liste de raccourcis",

  "stop.cancelled":
    "Vous avez arrêté ce tour. Tout ce qui précède a bien été exécuté — dites ce qu'il faut faire ensuite et l'agent reprend à partir de là.",
  "stop.repeated_calls":
    "L'agent s'est arrêté parce qu'il répétait un appel déjà refusé. Dites-lui quoi faire autrement — il conserve tout ce qu'il a construit.",
  "stop.needs_input.prompt":
    "L'agent s'est arrêté pour vous poser une question plutôt que de réessayer. Répondez ci-dessous et il reprend à partir de ce qui est construit.",
  "stop.needs_input.prose":
    "L'agent s'est arrêté pour vous poser une question plutôt que de réessayer — la question est à la fin de sa réponse. Répondez-y et il reprend à partir de ce qui est construit.",
  "stop.awaiting_approval.prompt":
    "L'agent a atteint un point de contrôle qui demande une validation. Rien au-delà n'a été exécuté — décidez ci-dessous, ou ouvrez-le dans Approbations.",
  "stop.awaiting_approval.prose":
    "L'agent a atteint un point de contrôle qui demande une validation. Rien au-delà n'a été exécuté ; approuvez ou rejetez-le dans Approbations et l'agent reprend à partir de là.",
  "stop.awaiting_approval.link": "Ouvrir Approbations",
  "stop.task_boundary":
    "L'agent s'est arrêté à la fin d'une tâche car le reste du plan ne tiendrait pas dans les tours d'outils de ce tour. Tout ce qui précède a été exécuté — appuyez sur Continuer pour lancer la tâche suivante.",
  "stop.provider_busy":
    "Le fournisseur du modèle est resté trop occupé après plusieurs essais. Rien n'est perdu — appuyez sur Continuer pour réessayer.",
  "stop.step_budget.continue":
    "L'agent a utilisé tous ses tours d'outils pour ce tour. Tout ce qui précède a été exécuté — appuyez sur Continuer pour poursuivre à partir de ce qui est construit.",
  "stop.step_budget.plain":
    "L'agent a épuisé ses tours d'outils pour ce tour. Demandez une seule chose à la fois et il ira plus loin.",
};

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "kryova-locale";

export const LOCALE_NAME: Record<Locale, string> = { en: "English", fr: "Français" };

const TABLES: Record<Locale, Messages> = { en, fr };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** One message with `{name}` placeholders filled. A missing key falls back to English. */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = TABLES[locale][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export interface LocaleSources {
  /** The `kryova-locale` cookie — an explicit choice, which beats everything. */
  cookie?: string | null;
  /** `Accept-Language` on the server, or `navigator.languages` joined on the client. */
  acceptLanguage?: string | null;
}

/**
 * An explicit choice wins; otherwise the first language the browser lists that we have
 * (`fr-CA` is French, `de` is skipped, not mapped to English early); otherwise English.
 * Quality values are honoured by order, not weight — browsers send them sorted.
 */
export function resolveLocale({ cookie, acceptLanguage }: LocaleSources): Locale {
  if (isLocale(cookie)) return cookie;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const primary = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
