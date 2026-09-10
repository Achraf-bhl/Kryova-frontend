import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharePanel, TransferPanel } from "./share-panel";
import type { OrganisationMembership, ShareLink } from "@/types/api";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  mockFetch.mockReset();
});

function jsonOnce(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
}

const LIVE: ShareLink = {
  id: "s1",
  label: "Acme, for quoting",
  note: null,
  created_at: "2026-09-01T09:00:00Z",
  expires_at: "2099-09-01T09:00:00Z",
  revoked_at: null,
  allow_geometry_download: false,
  view_count: 0,
  last_viewed_at: null,
};

describe("SharePanel", () => {
  it("shows the issued link and says it cannot be shown again", async () => {
    // The token is not recoverable from anywhere. A UI that let it scroll away
    // would be a link nobody can send.
    const user = userEvent.setup();
    jsonOnce([]);
    jsonOnce(
      { ...LIVE, token: "raw-token", url: "https://kryova.test/shared/raw-token" },
      201,
    );
    jsonOnce([LIVE]);
    render(<SharePanel projectId="p1" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /create link/i }));

    expect(await screen.findByText("https://kryova.test/shared/raw-token")).toBeInTheDocument();
    expect(screen.getByText(/cannot show it again/i)).toBeInTheDocument();
  });

  it("defaults the CAD download to off", async () => {
    // Sending somebody your results and sending them your geometry are
    // different decisions, and the second is opt-in.
    jsonOnce([]);
    render(<SharePanel projectId="p1" />);

    const checkbox = await screen.findByLabelText(/download the cad/i);
    expect(checkbox).not.toBeChecked();
  });

  it("lists a withdrawn link rather than hiding it", async () => {
    // "Who did we share this with, and is it still open" is one question.
    jsonOnce([{ ...LIVE, revoked_at: "2026-09-05T09:00:00Z" }]);
    render(<SharePanel projectId="p1" />);

    expect(await screen.findByText("Acme, for quoting")).toBeInTheDocument();
    expect(screen.getByText(/withdrawn/i)).toBeInTheDocument();
    // A dead link has nothing left to withdraw.
    expect(screen.queryByRole("button", { name: /^withdraw$/i })).not.toBeInTheDocument();
  });

  it("says when a link has never been opened", async () => {
    jsonOnce([LIVE]);
    render(<SharePanel projectId="p1" />);
    expect(await screen.findByText(/not opened yet/i)).toBeInTheDocument();
  });

  it("treats an expired link as dead even though nothing revoked it", async () => {
    jsonOnce([{ ...LIVE, expires_at: "2020-01-01T00:00:00Z" }]);
    render(<SharePanel projectId="p1" />);

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^withdraw$/i })).not.toBeInTheDocument();
  });
});

const PERSONAL: OrganisationMembership = {
  id: "o1",
  name: "Personal",
  slug: "personal",
  is_personal: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  role: "owner",
  domain_role: "engineer",
};

describe("TransferPanel", () => {
  it("renders nothing when there is nowhere to move a project to", () => {
    const { container } = render(
      <TransferPanel projectId="p1" organisations={[PERSONAL]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers only teams the caller administers", () => {
    // The backend answers 404 for the rest, so offering them would be offering
    // a failure.
    render(
      <TransferPanel
        projectId="p1"
        organisations={[
          PERSONAL,
          { ...PERSONAL, id: "o2", name: "Acme", role: "admin", is_personal: false },
          { ...PERSONAL, id: "o3", name: "Visiting", role: "member", is_personal: false },
        ]}
      />,
    );

    expect(screen.getByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Visiting" })).not.toBeInTheDocument();
  });

  it("asks for confirmation before moving, because a transfer is not additive", async () => {
    const user = userEvent.setup();
    render(
      <TransferPanel
        projectId="p1"
        organisations={[
          PERSONAL,
          { ...PERSONAL, id: "o2", name: "Acme", role: "admin", is_personal: false },
        ]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Team"), "o2");
    await user.click(screen.getByRole("button", { name: /^move$/i }));

    expect(screen.getByRole("button", { name: /yes, move it/i })).toBeInTheDocument();
    // Nothing has been sent yet.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("warns that live share links are withdrawn by a move", () => {
    render(
      <TransferPanel
        projectId="p1"
        organisations={[
          PERSONAL,
          { ...PERSONAL, id: "o2", name: "Acme", role: "admin", is_personal: false },
        ]}
      />,
    );
    expect(screen.getByText(/share links are withdrawn/i)).toBeInTheDocument();
  });
});
