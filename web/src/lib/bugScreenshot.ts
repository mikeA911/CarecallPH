// Screenshot of the portal page (the content area, not the sidebar or the
// CC panel) for a bug report. With `masked`, patient details are blurred
// first: table cells, form fields, values, links and paragraphs in the page,
// and anything marked data-phi. Headings, labels, buttons and error messages
// stay readable. The blur is a class on <html> for the moment of capture.
// Loaded on demand so the library isn't in every page load.

const MAX_CHARS = 2_900_000; // the database refuses more than 3,000,000

export async function captureBugScreenshot(masked: boolean): Promise<string> {
  const target = document.querySelector("main.content") as HTMLElement | null;
  if (!target) throw new Error("Nothing to capture on this page.");
  const { domToJpeg } = await import("modern-screenshot");
  if (masked) document.documentElement.classList.add("bug-capture-mask");
  try {
    let quality = 0.7;
    for (let scale = 1; scale >= 0.5; scale -= 0.25) {
      const url = await domToJpeg(target, { scale, quality, backgroundColor: "#ffffff" });
      if (url.length <= MAX_CHARS) return url;
      quality = 0.6;
    }
    throw new Error("This page is too long to capture. Scroll to the problem and describe it instead.");
  } finally {
    document.documentElement.classList.remove("bug-capture-mask");
  }
}
