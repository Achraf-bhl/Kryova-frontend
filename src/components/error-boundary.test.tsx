import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorDetail, isUsefulErrorMessage } from "./error-boundary";

describe("isUsefulErrorMessage", () => {
  it("accepts a message the backend actually wrote", () => {
    expect(isUsefulErrorMessage("Mesh would exceed 400000 elements")).toBe(true);
  });

  it("rejects React's production redaction", () => {
    // In a production build React replaces the real message with this and hands
    // the client only a digest. Rendering it tells the user nothing.
    expect(
      isUsefulErrorMessage(
        "An error occurred in the Server Components render. The specific message is omitted in production builds",
      ),
    ).toBe(false);
  });

  it("rejects empty and whitespace-only messages", () => {
    expect(isUsefulErrorMessage("")).toBe(false);
    expect(isUsefulErrorMessage("   ")).toBe(false);
    expect(isUsefulErrorMessage(undefined)).toBe(false);
  });
});

describe("ErrorDetail", () => {
  it("shows a real message", () => {
    render(<ErrorDetail error={{ message: "Mesh would exceed 400000 elements" }} />);
    expect(screen.getByText("Mesh would exceed 400000 elements")).toBeInTheDocument();
  });

  it("shows the digest so the user can quote it in a report", () => {
    render(<ErrorDetail error={{ message: "boom", digest: "1221426528" }} />);
    expect(screen.getByText(/1221426528/)).toBeInTheDocument();
  });

  it("falls back to the digest alone when the message is redacted", () => {
    render(
      <ErrorDetail
        error={{
          message: "An error occurred in the Server Components render.",
          digest: "abc123",
        }}
      />,
    );
    expect(screen.queryByText(/An error occurred in the Server/)).not.toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("renders nothing when there is neither a useful message nor a digest", () => {
    const { container } = render(<ErrorDetail error={{ message: "  " }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
