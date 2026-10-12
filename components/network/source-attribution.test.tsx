import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SourceAttribution } from "./source-attribution";
const source = { sourceId: "wiktionary", externalId: "who", url: "https://en.wiktionary.org/wiki/who", retrievedAt: null, contentHash: null, label: "Wiktionary", attribution: "Wiktionary contributors", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };
test("renders source, author credit and licence as usable links", () => {
  const html = renderToStaticMarkup(<SourceAttribution sources={[source]} label="Meaning source" />);
  expect(html).toContain('href="https://en.wiktionary.org/wiki/who"');
  expect(html).toContain('href="https://creativecommons.org/licenses/by-sa/4.0/"');
  expect(html).toContain("Wiktionary contributors");
  expect(html).toContain("Meaning source");
});
test("never renders an executable source URL", () => {
  const html = renderToStaticMarkup(<SourceAttribution sources={[{ ...source, url: "javascript:alert(1)", licenseUrl: "data:text/html,bad" }]} />);
  expect(html).not.toContain("href=");
});
