import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import {
  parseArticleDirectiveMarker,
  remarkArticleDirectives,
  remarkArticleOrderedListContinuation,
} from "../../src/lib/article-directives.mjs";

type TestNode = {
  value?: string;
  data?: {
    hName?: string;
    hProperties?: {
      className?: string[];
      role?: string;
      id?: string;
      "data-statement-id"?: string;
    };
  };
  children?: TestNode[];
};

const parse = async (source: string) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkMath)
    .use(remarkArticleDirectives);
  return processor.run(processor.parse(source), { value: source });
};

const render = async (source: string) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkArticleOrderedListContinuation)
    .use(remarkArticleDirectives)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify, { allowDangerousHtml: true });
  return String(await processor.process(source));
};

const plainText = (node: unknown): string => {
  if (!node || typeof node !== "object") return "";
  const value = "value" in node ? node.value : undefined;
  if (typeof value === "string") return value;
  const children = "children" in node ? node.children : undefined;
  return Array.isArray(children) ? children.map(plainText).join("") : "";
};

describe("math article directives", () => {
  it("renders nested containers with explicit boundaries", async () => {
    const tree = await parse(`::::folding[外側]
本文

:::rem[注意]
注釈
:::
::::`);
    const folding = (tree as unknown as TestNode).children?.[0];
    expect(folding).toBeDefined();
    if (!folding) throw new Error("folding directive was not rendered");
    expect(folding.data?.hName).toBe("details");
    expect(folding.data?.hProperties?.className).toContain("folding");
    const inner = folding.children?.[1];
    const annotation = inner?.children?.find(
      (child) => child.data?.hName === "aside",
    );
    expect(annotation?.data?.hProperties).toMatchObject({
      className: ["rem"],
      role: "note",
    });
    expect(plainText(annotation)).toContain("注意注釈");
  });

  it("leaves one- and two-colon text unchanged", async () => {
    const source = "参照 [群の定義:命題 4] と ::note";
    const tree = await parse(source);
    expect(plainText(tree)).toBe(source);
  });

  it("renders semantic directives emitted by the editor", async () => {
    const tree = await parse(`:::defi タイトル$ab$ {#defi-id}

定義本文

:::`);
    const root = tree as unknown as TestNode;
    expect(plainText(root)).toContain('class="article-directive defi"');
    expect(plainText(root)).toContain('data-statement-id="defi-id"');
    expect(plainText(root)).toContain("タイトルab</span>定義本文");
    expect(plainText(root)).toContain(
      'data-authored-statement-title="タイトル$ab$"',
    );
  });

  it("supports every semantic directive family used by the editor", async () => {
    const source = ["defi", "prop", "lemma", "cor", "remark"]
      .map((name) => `:::${name} 見出し\n\n本文\n\n:::`)
      .join("\n\n");
    const tree = (await parse(source)) as unknown as TestNode;
    const rendered = plainText(tree);
    expect(rendered.match(/data-directive="/gu)).toHaveLength(5);
    expect(rendered).toContain('class="article-directive defi"');
    expect(rendered).toContain('class="article-directive prop"');
    expect(rendered).toContain('class="article-directive lemma"');
    expect(rendered).toContain('class="article-directive cor"');
    expect(rendered).toContain(
      'class="article-directive article-directive-remark"',
    );
  });

  it("rejects unsupported container names", async () => {
    await expect(parse(":::unknown\n本文\n:::")).rejects.toThrow(
      "未対応の directive",
    );
  });

  it("accepts only three- and four-colon fences", async () => {
    await expect(parse(":::::proof\n本文 ◻\n:::::")).rejects.toThrow(
      "境界には `:::` または `::::`",
    );
  });

  it("allows same-width nested directives emitted by the editor", async () => {
    const tree = await parse(
      [
        ":::defi 定義",
        "",
        ":::folding 補足",
        "",
        "本文",
        ":::",
        "",
        ":::",
      ].join("\n"),
    );
    expect(plainText(tree)).toContain('data-directive="defi"');
    expect(plainText(tree)).toContain('data-directive="folding"');
  });

  it("gives compact proof directives the folding class used by the arrow CSS", async () => {
    const tree = await parse("::: proof\n本文\n:::");
    expect(plainText(tree)).toContain(
      '<details class="proof-details folding" data-directive="proof" open>',
    );
  });

  it("renders a directive whose body has no blank line after its marker", async () => {
    const tree = await parse(
      ["::: remark", "補足の本文", "複数行の本文", ":::"].join("\n"),
    );
    expect(plainText(tree)).toContain(
      'class="article-directive article-directive-remark"',
    );
    expect(plainText(tree)).toContain("補足の本文\n複数行の本文");
  });

  it("parses directive titles with an optional statement id", () => {
    expect(
      parseArticleDirectiveMarker(":::cor 系 $G$ {#cor-id}"),
    ).toMatchObject({
      fence: ":::",
      name: "cor",
      title: "系 $G$",
      id: "cor-id",
    });
  });

  it("keeps ordered-list numbering across a display-math block", async () => {
    const html = await render(
      [
        "1. 最初の項目",
        "2. 次の項目",
        "",
        "$$",
        "x = y",
        "$$",
        "",
        "1. 数式の後の項目",
      ].join("\n"),
    );
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("<li>数式の後の項目</li>");
  });

  it("keeps explicit folding-title emphasis while leaving plain titles unbold", async () => {
    const html = await render(
      [
        ":::folding **重要な補足**",
        "",
        "本文",
        "",
        ":::",
        "",
        ":::folding 通常の補足",
        "",
        "本文",
        "",
        ":::",
      ].join("\n"),
    );
    expect(html).toContain("<summary><strong>重要な補足</strong></summary>");
    expect(html).toContain("<summary>通常の補足</summary>");
  });
});
