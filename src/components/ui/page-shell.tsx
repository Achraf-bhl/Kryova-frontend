/**
 * The padded, centred container the non-chat pages sit in.
 *
 * `dashboard/layout.tsx` deliberately does not apply this itself: the chat is
 * the front door now and it needs the full height of the viewport, edge to
 * edge, with its own internal scroll. A max-width wrapper in the layout would
 * either cage the chat or force every other page to undo it.
 */
export function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 ${className}`}>{children}</div>
  );
}
