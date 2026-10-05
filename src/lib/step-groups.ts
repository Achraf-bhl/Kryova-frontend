import type { StepView } from "@/components/agent-step-list";
import { toolImageFrom } from "@/lib/tool-media";

/**
 * Turn the flat step list into what a person reads (ROAD_TO_10 8.8): the steps of one plan
 * task together, a run of successful look-ups folded into one line.
 *
 * The plan is the model's own (`plan_work` / `update_task`, `app/ai/taskgraph.py`), and the
 * grouping reads **only what those calls say happened**, never a guess about which step
 * belongs where: a step belongs to the task most recently marked `active` and not yet closed.
 * With no plan the list is one ungrouped run, exactly as before.
 *
 * Three rules, each because the opposite hides something:
 * 1. **A refusal is never folded or consumed.** A failed `update_task` ("cannot be marked done
 *    while it waits on …") is the server's answer about the order of the work; it stays a visible
 *    row in the group it happened in.
 * 2. **Only a read that succeeded and drew nothing is folded.** A look-up that failed is news,
 *    and a step that produced a picture (a capture) is shown in its row, not behind a fold.
 * 3. **A fold needs company.** One or two quiet reads are cheaper to show than to hide.
 */

export type TaskState = "pending" | "active" | "done" | "blocked" | "skipped";

export const MIN_FOLDED_READS = 3;

export type StepItem =
  | { kind: "step"; step: StepView }
  | { kind: "reads"; steps: StepView[] };

export interface StepGroup {
  /** The plan task, or null for steps outside any task (before the plan, or between tasks). */
  taskId: string | null;
  title: string | null;
  /** The last state the plan reported for the task; null for the ungrouped run. */
  state: TaskState | null;
  items: StepItem[];
}

const READ_PREFIXES = [
  "list_",
  "get_",
  "read_",
  "search_",
  "catia_list_",
  "catia_get_",
  "catia_measure",
  "catia_inspect",
  "catia_read_",
  "catia_describe_",
];

/** A name that only looks. A prefix rule, because the registry is large and keeps growing. */
export function isReadTool(tool: string): boolean {
  return READ_PREFIXES.some((prefix) => tool.startsWith(prefix));
}

const STATES: readonly string[] = ["pending", "active", "done", "blocked", "skipped"];

function asState(value: unknown): TaskState | null {
  return typeof value === "string" && STATES.includes(value) ? (value as TaskState) : null;
}

function plannedTitles(step: StepView): Map<string, string> {
  const titles = new Map<string, string>();
  const tasks = step.arguments?.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (task && typeof task === "object") {
        const { id, title } = task as { id?: unknown; title?: unknown };
        if (typeof id === "string") titles.set(id, typeof title === "string" && title ? title : id);
      }
    }
  }
  return titles;
}

function foldable(step: StepView): boolean {
  return step.status === "ok" && isReadTool(step.tool) && toolImageFrom(step.result) === null;
}

function foldReads(steps: StepView[]): StepItem[] {
  const items: StepItem[] = [];
  let run: StepView[] = [];
  const flush = () => {
    if (run.length >= MIN_FOLDED_READS) items.push({ kind: "reads", steps: run });
    else for (const step of run) items.push({ kind: "step", step });
    run = [];
  };
  for (const step of steps) {
    if (foldable(step)) {
      run.push(step);
    } else {
      flush();
      items.push({ kind: "step", step });
    }
  }
  flush();
  return items;
}

export function groupSteps(steps: StepView[]): StepGroup[] {
  const titles = new Map<string, string>();
  const groups: { taskId: string | null; title: string | null; state: TaskState | null; steps: StepView[] }[] = [
    { taskId: null, title: null, state: null, steps: [] },
  ];
  const open = () => groups[groups.length - 1];

  for (const step of steps) {
    if (step.tool === "plan_work" && step.status === "ok") {
      for (const [id, title] of plannedTitles(step)) titles.set(id, title);
      open().steps.push(step);
      continue;
    }
    if (step.tool === "update_task" && step.status === "ok") {
      const id = step.arguments?.id;
      const state = asState(step.arguments?.state);
      if (typeof id === "string" && state) {
        if (state === "active") {
          groups.push({ taskId: id, title: titles.get(id) ?? id, state, steps: [] });
        } else if (open().taskId === id) {
          // Closing the open task: record how it ended, and what follows is between tasks.
          open().state = state;
          groups.push({ taskId: null, title: null, state: null, steps: [] });
        } else {
          // A state change for a task that is not the open one (a skip, a block ahead of
          // time) has no group to head, so it stays as a row where it happened.
          open().steps.push(step);
        }
        continue;
      }
    }
    open().steps.push(step);
  }

  return groups
    .filter((group) => group.steps.length > 0 || group.taskId !== null)
    .map((group) => ({
      taskId: group.taskId,
      title: group.title,
      state: group.state,
      items: foldReads(group.steps),
    }));
}

/** True when the plan carried anything — otherwise the list is rendered flat. */
export function hasPlan(groups: StepGroup[]): boolean {
  return groups.some((group) => group.taskId !== null);
}
