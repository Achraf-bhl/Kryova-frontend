import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_KEY } from "@/lib/crash-report";

import { CrashReportButton } from "./crash-report-button";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

function offer(configured = true) {
  fetchMock.mockResolvedValueOnce(
    Response.json({ configured, logs: [{ name: "backend.log", tail: "boom" }] }),
  );
}

describe("CrashReportButton", () => {
  it("shows the whole report and sends nothing until Send is pressed", async () => {
    const user = userEvent.setup();
    offer();
    render(<CrashReportButton error={{ message: "Failed to fetch" }} route="/dashboard" />);

    await user.click(screen.getByRole("button", { name: "Send a report" }));

    const text = (await screen.findByLabelText("Report text")) as HTMLTextAreaElement;
    expect(text.value).toContain("Failed to fetch");
    expect(text.value).toContain("Conversation: not included.");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the GET for the preview, no POST
  });

  it("posts the previewed text with consent when Send is pressed", async () => {
    const user = userEvent.setup();
    offer();
    fetchMock.mockResolvedValueOnce(Response.json({ sent: true }));
    render(<CrashReportButton error={{ message: "Failed to fetch" }} route="/dashboard" />);

    await user.click(screen.getByRole("button", { name: "Send a report" }));
    await user.click(await screen.findByRole("button", { name: "Send" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Report sent");
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(init.body as string);
    expect(body.consent).toBe(true);
    expect(body.report).toContain("Failed to fetch");
  });

  it("does not offer the conversation unless the page can supply one, and defaults it off", async () => {
    const user = userEvent.setup();
    offer();
    const { unmount } = render(<CrashReportButton error={{}} route="/x" />);
    await user.click(screen.getByRole("button", { name: "Send a report" }));
    await screen.findByLabelText("Report text");
    expect(screen.queryByLabelText(/Include this conversation/)).not.toBeInTheDocument();
    unmount();

    offer();
    const loadTranscript = vi.fn().mockResolvedValue([{ role: "user", content: "make a bracket" }]);
    render(<CrashReportButton error={{}} route="/x" loadTranscript={loadTranscript} />);
    await user.click(screen.getByRole("button", { name: "Send a report" }));
    const box = await screen.findByLabelText(/Include this conversation/);
    expect(box).not.toBeChecked();
    expect(loadTranscript).not.toHaveBeenCalled();

    await user.click(box);
    await waitFor(() =>
      expect((screen.getByLabelText("Report text") as HTMLTextAreaElement).value).toContain(
        "make a bracket",
      ),
    );
  });

  it("disables Send and says why when no destination is configured", async () => {
    const user = userEvent.setup();
    offer(false);
    render(<CrashReportButton error={{}} route="/x" />);

    await user.click(screen.getByRole("button", { name: "Send a report" }));

    expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/no place to send reports/)).toBeInTheDocument();
  });

  it("shows a failed send and keeps the text to copy", async () => {
    const user = userEvent.setup();
    offer();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "down" }, { status: 502 }));
    render(<CrashReportButton error={{ message: "oops" }} route="/x" />);

    await user.click(screen.getByRole("button", { name: "Send a report" }));
    await user.click(await screen.findByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not sent: down");
    expect((screen.getByLabelText("Report text") as HTMLTextAreaElement).value).toContain("oops");
  });

  it("renders nothing once the person said stop asking, and remembers it", async () => {
    const user = userEvent.setup();
    offer();
    const { container } = render(<CrashReportButton error={{}} route="/x" />);
    await user.click(screen.getByRole("button", { name: "Send a report" }));

    await user.click(await screen.findByRole("button", { name: "Don't ask again" }));

    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("never");

    const again = render(<CrashReportButton error={{}} route="/x" />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it("disappears on a web deployment, where the route is a 404", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const { container } = render(<CrashReportButton error={{}} route="/x" />);

    await user.click(screen.getByRole("button", { name: "Send a report" }));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
