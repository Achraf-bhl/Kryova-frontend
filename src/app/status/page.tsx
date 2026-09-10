import { StatusBoard } from "./_components/status-board";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kryova status",
  description: "Is Kryova working, and what happened recently.",
};

/**
 * The public status page (P10.4).
 *
 * **Signed out on purpose**, like `/trust`. The whole value is that somebody
 * whose run is stuck can find out whether it is them or us without opening a
 * ticket — and a status page only its operator can read is a private dashboard.
 *
 * It carries none of the fleet's numbers. Queue depth, storage, live sessions
 * and user totals are on `/admin/health` where they belong: on a public URL
 * they are the size of the business and the hours nobody is watching, and none
 * of them answers "is it working".
 */
export default async function StatusPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="font-display text-2xl font-semibold">Kryova status</h1>
      <p className="mt-1 text-sm text-muted">
        Declared by a person, not inferred from a failure rate. A quiet hour with
        two bad runs is not an outage, and this page will not say it is.
      </p>
      <div className="mt-6">
        <StatusBoard />
      </div>
    </main>
  );
}
