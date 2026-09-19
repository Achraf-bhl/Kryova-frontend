"use client";

import { useEffect, useRef, useState } from "react";

import { Pill } from "@/components/ui/pill";
import { BoltIcon, SendIcon, StopIcon } from "@/components/ui/icons";

const MAX_HEIGHT_PX = 216;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** A turn is streaming. The field stays usable; only sending is held back. */
  busy?: boolean;
  onStop?: () => void;
  /** A stop has been asked for and the turn has not ended yet (P5.6). */
  stopping?: boolean;
  deepAnalysis: boolean;
  onDeepAnalysisChange: (value: boolean) => void;
  /** Attach control, supplied by the parent because it needs a project. */
  attachSlot?: React.ReactNode;
  /** The CATIA status chip, right where geometry is about to be asked for. */
  statusSlot?: React.ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * Files dropped on the composer. Absent means the composer takes no drops —
   * a chat with no project has nowhere to put them, and a drop zone that
   * silently swallowed a file would be worse than none.
   */
  onFilesDropped?: (files: File[]) => void;
}

/**
 * The composer.
 *
 * A `<textarea>`, not an `<input>`: the previous single-line input checked
 * `shiftKey` on Enter to "insert a newline" it was structurally incapable of
 * holding. Enter sends, Shift+Enter breaks the line, and the box grows with the
 * message up to a cap and then scrolls.
 *
 * The field is never disabled while the agent runs. A CATIA build can take a
 * minute and the next instruction is usually already in the user's head;
 * locking the box makes them hold it. Sending waits — there is one agent —
 * which the send button says by turning into a stop button.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  busy = false,
  onStop,
  stopping = false,
  deepAnalysis,
  onDeepAnalysisChange,
  attachSlot,
  statusSlot,
  placeholder = "Describe a part, or ask about a run…",
  autoFocus = false,
  onFilesDropped,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dropping, setDropping] = useState(false);

  // Drag events fire on children too, so a naive `onDragLeave` clears the state
  // the moment the pointer crosses the textarea. Counting enters against leaves
  // is what keeps the highlight steady while moving across the box.
  const dragDepth = useRef(0);

  const takesDrops = Boolean(onFilesDropped);

  // Grow to fit, then scroll. Reset to `auto` first or the box can only ever
  // get taller — `scrollHeight` never shrinks below the height already set.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
    element.style.overflowY = element.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <div
      className={`k-composer px-3 pb-2 pt-3${dropping ? " ring-2 ring-accent/60" : ""}`}
      onDragEnter={
        takesDrops
          ? (event) => {
              // Only a file drag. Dragging selected *text* across the composer is
              // an ordinary thing to do and must not look like an upload.
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              dragDepth.current += 1;
              setDropping(true);
            }
          : undefined
      }
      onDragOver={
        takesDrops
          ? (event) => {
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              // Without this the browser navigates to the file instead, losing
              // the conversation.
              event.preventDefault();
            }
          : undefined
      }
      onDragLeave={
        takesDrops
          ? () => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDropping(false);
            }
          : undefined
      }
      onDrop={
        takesDrops
          ? (event) => {
              const files = Array.from(event.dataTransfer.files);
              dragDepth.current = 0;
              setDropping(false);
              if (files.length === 0) return;
              event.preventDefault();
              onFilesDropped?.(files);
            }
          : undefined
      }
    >
      <label htmlFor="composer" className="sr-only">
        Message the Kryova agent
      </label>
      <textarea
        id="composer"
        ref={textareaRef}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // `isComposing` guards IME input: mid-composition Enter commits a
          // candidate word and must not send the message.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (value.trim() && !busy) onSubmit();
          }
        }}
        placeholder={placeholder}
        // `max-h-54` is 54 x 0.25rem = 13.5rem = 216px, which must stay equal to
        // MAX_HEIGHT_PX above: the JS caps the inline height it sets while
        // growing, and this caps the box if JS has not run yet (first paint,
        // hydration). If the two drift, the textarea either clips its own text
        // or grows past the cap for one frame.
        className="k-scroll block max-h-54 w-full resize-none bg-transparent px-1 text-[0.9375rem] leading-6 text-accent outline-none placeholder:text-faint"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill
          active={deepAnalysis}
          onClick={() => onDeepAnalysisChange(!deepAnalysis)}
          title="Let the agent run tools that change things: create projects, drive CATIA, start solves."
        >
          <BoltIcon className="size-3.5" />
          Deep analysis
        </Pill>

        {attachSlot}
        {statusSlot}

        <div className="ml-auto flex items-center gap-2">
          {busy && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="k-pill"
              aria-label={
                stopping
                  ? "Stopping after the current step — press again to cut the stream"
                  : "Stop the current run"
              }
              title={
                stopping
                  ? "Finishing the step already in flight, then stopping. Press again to cut the stream instead — that ends the connection, not the work."
                  : "Stop after the current step. Everything already done is kept."
              }
            >
              <StopIcon className="size-3" />
              {/* Named rather than left as "Stop", because the gap between the
                  press and the turn ending is real — the loop finishes the tool
                  call in flight first. A button that said nothing during that
                  gap reads as "nothing happened" and gets pressed again, which
                  is the hard abort. */}
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label={busy ? "Waiting for the current run to finish" : "Send message"}
            title={busy ? "The agent is still working on the last message." : "Send (Enter)"}
            className="flex size-9 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover disabled:bg-border-strong disabled:text-faint"
          >
            <SendIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
