import { describe, expect, it, vi } from "vite-plus/test";
import { DemoImageServiceBuilder, DemoImageShellSingleton } from "./demo-image.ts";

const pointer = {
  name: "Demo",
  sessionId: "session",
  reviewUUID: "uuid",
  reviewId: "review-id",
  appDir: "/project/.lgtm/review-id",
  url: "http://localhost:4000/",
  reviewPath: "/project/.lgtm/review-id/review.json",
};

describe("DemoImageShellSingleton", () => {
  it("creates a light macOS browser shell around the review", () => {
    const markup = DemoImageShellSingleton.createMarkup({
      theme: "light",
      url: 'http://localhost:4000/?name="demo"&kind=diff',
    });

    expect(markup).toContain('data-theme="light"');
    expect(markup).toContain('aria-label="macOS browser preview"');
    expect(markup).toContain('class="traffic-light close"');
    expect(markup).toContain("lgtm review");
    expect(markup).toContain('src="http://localhost:4000/?name=&quot;demo&quot;&amp;kind=diff"');
  });

  it("creates the dark presentation theme", () => {
    const markup = DemoImageShellSingleton.createMarkup({
      theme: "dark",
      url: "http://localhost:4000/",
    });

    expect(markup).toContain('data-theme="dark"');
    expect(markup).toContain("--canvas: #08090a");
    expect(markup).toContain("--floor: #d0d6e0");
    expect(markup).toContain("linear-gradient(var(--canvas) 10%, var(--floor) 100%)");
    expect(markup).toContain("right: 0");
    expect(markup).toContain("left: 0");
    expect(markup).toContain("width: min(1280px, calc(100vw - 160px))");
    expect(markup).toContain("height: calc(100vh - 288px)");
    expect(markup).toContain("transform: translateY(-48px)");
  });
});

describe("DemoImageService", () => {
  it("renders and stops a headless demo review", async () => {
    const openReview = vi.fn().mockResolvedValue(pointer);
    const stopReview = vi.fn().mockResolvedValue(true);
    const renderBrowserImage = vi.fn().mockResolvedValue("/project/demo.jpg");
    const rm = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const Renderer = DemoImageServiceBuilder({
      config: {},
      deps: {
        mkdtemp: vi.fn().mockResolvedValue("/tmp/lgtm-demo"),
        openReview,
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            files: [{ location: "demo.ts", comments: [] }],
            documentComments: [],
          }),
        ),
        rm,
        stopReview,
        writeFile,
        renderBrowserImage,
      },
    });

    const result = await Renderer.render({
      comments: {
        files: [
          {
            location: "demo.ts",
            comments: [
              {
                id: "comment",
                fileLocation: "demo.ts",
                selectedRowIds: ["additions:1-1"],
                selectedText: "demo",
                side: "additions",
                selectedRange: { start: 1, end: 1 },
                startLine: 1,
                endLine: 1,
                lineNumbers: [1],
                comment: "Explain this.",
                createdAt: "2026-07-15T12:00:00.000Z",
                updatedAt: "2026-07-15T12:00:00.000Z",
              },
            ],
          },
        ],
        documentComments: [],
      },
      input: { kind: "diff", name: "Demo", files: [] },
      output: "/project/demo.jpg",
      theme: "light",
    });

    expect(result).toBe("/project/demo.jpg");
    expect(openReview).toHaveBeenCalledWith(expect.anything(), {
      cwd: "/tmp/lgtm-demo",
      openBrowser: false,
      reviewUUID: "preview",
      sessionId: "demo",
      trackAsActiveReview: false,
    });
    expect(stopReview).toHaveBeenCalledWith("/tmp/lgtm-demo", pointer.reviewPath);
    expect(rm).toHaveBeenCalledWith("/tmp/lgtm-demo", { force: true, recursive: true });
    expect(writeFile.mock.calls[0]?.[1]).toContain("Explain this.");
  });

  it("stops the review when image rendering fails", async () => {
    const stopReview = vi.fn().mockResolvedValue(true);
    const Renderer = DemoImageServiceBuilder({
      config: {},
      deps: {
        mkdtemp: vi.fn().mockResolvedValue("/tmp/lgtm-demo"),
        openReview: vi.fn().mockResolvedValue(pointer),
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            files: [{ location: "demo.ts", comments: [] }],
            documentComments: [],
          }),
        ),
        rm: vi.fn().mockResolvedValue(undefined),
        stopReview,
        writeFile: vi.fn().mockResolvedValue(undefined),
        renderBrowserImage: vi.fn().mockRejectedValue(new Error("Capture failed")),
      },
    });

    await expect(
      Renderer.render({
        comments: { files: [], documentComments: [] },
        input: { kind: "diff", name: "Demo", files: [] },
        output: "/project/demo.jpg",
        theme: "light",
      }),
    ).rejects.toThrow("Capture failed");
    expect(stopReview).toHaveBeenCalledWith("/tmp/lgtm-demo", pointer.reviewPath);
  });
});
