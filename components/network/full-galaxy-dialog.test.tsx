import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FullGalaxyDialog } from "./full-galaxy-dialog";

const handlers = {
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  onReturn: vi.fn(),
};

describe("FullGalaxyDialog", () => {
  it("shows list-specific confirmation details and the mobile warning", () => {
    const html = renderToStaticMarkup(
      <FullGalaxyDialog
        listLabel="NGSL"
        wordCount={5_205}
        bytes={1_200_000}
        state={{ phase: "confirm" }}
        {...handlers}
      />,
    );

    expect(html).toContain("Load the complete NGSL galaxy?");
    expect(html).toContain("5,205 stars · approximately 1.2 MB");
    expect(html).toContain("could run slowly on mobile devices");
    expect(html).toContain("Load full galaxy");
    expect(html).toContain("Cancel");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("shows preparation progress and a cancel action while loading", () => {
    const html = renderToStaticMarkup(
      <FullGalaxyDialog
        listLabel="Academic"
        wordCount={963}
        bytes={400_000}
        state={{ phase: "loading", stage: "preparing", loaded: 400_000, total: 400_000 }}
        {...handlers}
      />,
    );

    expect(html).toContain("Preparing 963 stars");
    expect(html).toContain("Cancel");
    expect(html).toContain('aria-live="polite"');
  });

  it("offers retry after failure and return after success", () => {
    const failed = renderToStaticMarkup(
      <FullGalaxyDialog listLabel="TOEIC" wordCount={1_000} bytes={50_000}
        state={{ phase: "error", message: "Network unavailable" }} {...handlers} />,
    );
    const ready = renderToStaticMarkup(
      <FullGalaxyDialog listLabel="TOEIC" wordCount={1_000} bytes={50_000}
        state={{ phase: "ready" }} {...handlers} />,
    );

    expect(failed).toContain("Network unavailable");
    expect(failed).toContain("Retry");
    expect(ready).toContain("1,000 stars are ready");
    expect(ready).toContain("Return to constellation view");
  });
});
