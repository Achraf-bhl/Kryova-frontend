"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type {
  DomainRole,
  Invitation,
  InvitationIssued,
  Member,
  OrganisationMembership,
  OrgRole,
} from "@/types/api";

/**
 * The whole of P2 task 6 in one widget: switch team, manage members and their
 * roles, invite people, and see what is pending.
 *
 * **Two role ladders, shown as two columns, because they are two questions.**
 * The platform role governs the organisation — billing, members, deletion. The
 * domain role governs the work: `reviewer` is who may sign off a gate, and
 * E16.5/P5 read it. Collapsing them into one dropdown would mean promoting
 * somebody to admin so they could approve a design, which is exactly the
 * conflation the two-layer model exists to prevent.
 *
 * **What the UI will not offer, because the backend refuses it anyway:** an
 * admin cannot invite or promote an owner (that is the one move that takes the
 * tenant), and the last owner cannot be demoted or removed. Both are enforced
 * server-side; hiding the controls is a courtesy, not the guard.
 */

const PLATFORM_ROLES: { value: OrgRole; label: string; blurb: string }[] = [
  { value: "owner", label: "Owner", blurb: "Everything, including billing and deletion" },
  { value: "admin", label: "Admin", blurb: "Members and settings, not billing" },
  { value: "member", label: "Member", blurb: "Use the product" },
  { value: "viewer", label: "Viewer", blurb: "Read only" },
];

const DOMAIN_ROLES: { value: DomainRole | ""; label: string }[] = [
  { value: "", label: "Not set" },
  { value: "engineer", label: "Engineer — authors designs, runs simulations" },
  { value: "reviewer", label: "Reviewer — approves gates, cannot edit geometry" },
  { value: "operator", label: "Operator — runs released missions" },
];

export function OrganisationManager() {
  const [organisations, setOrganisations] = useState<OrganisationMembership[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrganisations = useCallback(() => {
    api
      .listOrganisations()
      .then((page) => {
        setOrganisations(page.items);
        setSelectedId((current) => current ?? page.items[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(loadOrganisations, [loadOrganisations]);

  if (error && !organisations) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!organisations) return <p className="text-sm text-muted">Loading teams…</p>;

  const selected = organisations.find((org) => org.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">Your teams</h2>
        <div className="flex flex-wrap gap-2">
          {organisations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => setSelectedId(org.id)}
              aria-current={org.id === selectedId}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                org.id === selectedId
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-accent hover:border-border-strong"
              }`}
            >
              {org.name}
              {org.is_personal && <span className="ml-2 text-xs text-muted">personal</span>}
            </button>
          ))}
        </div>
        <CreateOrganisation onCreated={loadOrganisations} />
      </section>

      {selected && <OrganisationDetail organisation={selected} />}
    </div>
  );
}

function CreateOrganisation({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.createOrganisation(name.trim());
          setName("");
          onCreated();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not create that team");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        id="new-org"
        label="New team"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Acme Machines"
        required
      />
      <Button type="submit" variant="secondary" loading={busy}>
        Create
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function OrganisationDetail({ organisation }: { organisation: OrganisationMembership }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // The error is cleared on the *result*, not before the request: clearing it
    // synchronously here makes this a setState in an effect body, and React
    // rightly calls that a cascading render.
    api
      .listMembers(organisation.id)
      .then((page) => {
        setMembers(page.items);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
    api
      .listInvitations(organisation.id)
      .then((page) => setInvitations(page.items))
      // A viewer cannot read invitations, and that is not an error worth
      // shouting about — the section just does not appear for them.
      .catch(() => setInvitations(null));
  }, [organisation.id]);

  useEffect(load, [load]);

  const canManage = organisation.role === "owner" || organisation.role === "admin";

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-accent">
            Members of {organisation.name}
          </h2>
          <p className="mt-1 text-sm text-muted">
            You are {organisation.role === "owner" ? "an owner" : `a ${organisation.role}`}
            {organisation.domain_role ? ` and a ${organisation.domain_role}` : ""}.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {!members ? (
          <p className="text-sm text-muted">Loading members…</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {members.map((member) => (
              <MemberRow
                key={member.user_id}
                organisationId={organisation.id}
                member={member}
                canManage={canManage}
                actorRole={organisation.role}
                onChanged={load}
              />
            ))}
          </ul>
        )}
      </section>

      {canManage && invitations && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-accent">Invitations</h2>
          <InviteForm organisationId={organisation.id} actorRole={organisation.role} onSent={load} />
          <PendingInvitations
            organisationId={organisation.id}
            invitations={invitations}
            onChanged={load}
          />
        </section>
      )}
    </div>
  );
}

function MemberRow({
  organisationId,
  member,
  canManage,
  actorRole,
  onChanged,
}: {
  organisationId: string;
  member: Member;
  canManage: boolean;
  actorRole: OrgRole;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(roles: { role?: OrgRole; domain_role?: DomainRole | null }) {
    setBusy(true);
    setError(null);
    try {
      await api.updateMember(organisationId, member.user_id, roles);
      onChanged();
    } catch (err) {
      // The backend refuses the moves that would take a tenant or leave it
      // ownerless, and its message says which. Surface it rather than
      // reimplementing the rule here and getting a second opinion wrong.
      setError(err instanceof Error ? err.message : "Could not change that role");
    } finally {
      setBusy(false);
    }
  }

  // Only an owner may create another owner. Enforced server-side; the option is
  // hidden so an admin is not offered a move that will be refused.
  const offerable = PLATFORM_ROLES.filter(
    (role) => role.value !== "owner" || actorRole === "owner",
  );

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{member.full_name ?? member.email}</p>
          {member.full_name && <p className="text-xs text-muted">{member.email}</p>}
        </div>
        {canManage ? (
          <>
            <Select
              id={`role-${member.user_id}`}
              label="Team role"
              value={member.role}
              disabled={busy}
              onChange={(event) => change({ role: event.target.value as OrgRole })}
              options={offerable.map((role) => ({ value: role.value, label: role.label }))}
            />
            <Select
              id={`domain-${member.user_id}`}
              label="Engineering role"
              value={member.domain_role ?? ""}
              disabled={busy}
              onChange={(event) =>
                change({ domain_role: (event.target.value || null) as DomainRole | null })
              }
              options={DOMAIN_ROLES.map((role) => ({
                value: role.value,
                label: role.label,
              }))}
            />
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.removeMember(organisationId, member.user_id);
                  onChanged();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not remove them");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted">
            {member.role}
            {member.domain_role ? ` · ${member.domain_role}` : ""}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

function InviteForm({
  organisationId,
  actorRole,
  onSent,
}: {
  organisationId: string;
  actorRole: OrgRole;
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [domainRole, setDomainRole] = useState<DomainRole | "">("engineer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<InvitationIssued | null>(null);

  const offerable = PLATFORM_ROLES.filter(
    (candidate) => candidate.value !== "owner" || actorRole === "owner",
  );

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setIssued(null);
          try {
            const result = await api.createInvitation(
              organisationId,
              email.trim(),
              role,
              (domainRole || null) as DomainRole | null,
            );
            setIssued(result);
            setEmail("");
            onSent();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not send that invitation");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          id="invite-email"
          label="Invite by email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Select
          id="invite-role"
          label="Team role"
          value={role}
          onChange={(event) => setRole(event.target.value as OrgRole)}
          options={offerable.map((candidate) => ({
            value: candidate.value,
            label: candidate.label,
          }))}
        />
        <Select
          id="invite-domain"
          label="Engineering role"
          value={domainRole}
          onChange={(event) => setDomainRole(event.target.value as DomainRole | "")}
          options={DOMAIN_ROLES.map((candidate) => ({
            value: candidate.value,
            label: candidate.label,
          }))}
        />
        <Button type="submit" loading={busy}>
          Send invitation
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {issued &&
        (issued.token ? (
          // The backend returns the token only when the email did NOT reach a
          // mailbox. Showing it is not a leak, it is the recovery: this is the
          // only copy, and without it the invitee has no way in.
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="text-sm font-medium text-accent">
              We could not email this invitation
            </p>
            <p className="mt-1 text-sm text-muted">
              Send them this link yourself. It is the only copy — we do not store it.
            </p>
            <p className="mt-2 font-mono text-xs break-all">
              {`${window.location.origin}/invitations/accept?token=${issued.token}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Invitation sent to {issued.email}. It expires{" "}
            {relativeTime(issued.expires_at).replace(" ago", " from now")}.
          </p>
        ))}
    </div>
  );
}

function PendingInvitations({
  organisationId,
  invitations,
  onChanged,
}: {
  organisationId: string;
  invitations: Invitation[];
  onChanged: () => void;
}) {
  const pending = invitations.filter(
    (invitation) => !invitation.accepted_at && !invitation.revoked_at,
  );
  if (pending.length === 0) {
    return <p className="text-sm text-muted">No invitations are outstanding.</p>;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
      {pending.map((invitation) => (
        <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{invitation.email}</p>
            <p className="text-xs text-muted">
              {invitation.role}
              {invitation.domain_role ? ` · ${invitation.domain_role}` : ""} · invited{" "}
              {relativeTime(invitation.created_at)}
            </p>
          </div>
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={async () => {
              await api.revokeInvitation(organisationId, invitation.id);
              onChanged();
            }}
          >
            Withdraw
          </Button>
        </li>
      ))}
    </ul>
  );
}
