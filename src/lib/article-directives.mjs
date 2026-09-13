const DIRECTIVE_LABELS = {
  defi: "定義",
  definition: "定義",
  thm: "定理",
  theorem: "定理",
  prop: "命題",
  proposition: "命題",
  cor: "系",
  corollary: "系",
  lemma: "補題",
  proof: "証明",
  example: "例",
  exercise: "演習",
  remark: "補足",
  note: "注",
  warning: "注意",
  tip: "ヒント",
};

export const ARTICLE_DIRECTIVE_NAMES = new Set([
  "defi",
  "definition",
  "thm",
  "theorem",
  "prop",
  "proposition",
  "cor",
  "corollary",
  "lemma",
  "proof",
  "example",
  "exercise",
  "remark",
  "note",
  "warning",
  "tip",
  "folding",
  "supp",
  "rem",
]);

const SEMANTIC_CLASSES = {
  defi: "defi",
  definition: "defi",
  thm: "thm",
  theorem: "thm",
  prop: "prop",
  proposition: "prop",
  cor: "cor",
  corollary: "cor",
  lemma: "lemma",
  example: "example",
};

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );

/**
 * Directive titles may contain inline mathematics and explicit emphasis.
 * Keeping the title as MDAST nodes lets remark-math/rehype-mathjax process it
 * just like the rest of an article. Plain titles intentionally remain plain;
 * only authored `**...**` is rendered bold.
 */
const titleNodes = (value) => {
  const nodes = [];
  const source = String(value ?? "");
  const pattern = /(\*\*[^*\r\n]+?\*\*|\$[^$\r\n]+\$)/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor)
      nodes.push({ type: "text", value: source.slice(cursor, start) });
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push({ type: "strong", children: titleNodes(token.slice(2, -2)) });
    } else {
      const value = token.slice(1, -1);
      nodes.push({
        type: "inlineMath",
        value,
        data: {
          hName: "code",
          hProperties: { className: ["language-math", "math-inline"] },
          hChildren: [{ type: "text", value }],
        },
      });
    }
    cursor = start + match[0].length;
  }
  if (cursor < source.length)
    nodes.push({ type: "text", value: source.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", value: source }];
};

const titleParagraph = (
  marker,
  { className, tagName = "p", preserveSource = false } = {},
) => {
  const children =
    className && tagName === "p"
      ? [
          {
            type: "html",
            value: `<span class="${escapeHtml(className)}"${preserveSource ? ` data-authored-statement-title="${escapeHtml(marker.title)}"` : ""}>`,
          },
          ...titleNodes(marker.title),
          { type: "html", value: "</span>" },
        ]
      : titleNodes(marker.title);
  return {
    type: "paragraph",
    data: {
      hName: tagName,
      ...(className && tagName !== "p"
        ? { hProperties: { className: [className] } }
        : {}),
    },
    children,
  };
};

export function parseArticleDirectiveMarker(value) {
  const match =
    /^\s*(:{3,4})\s*([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.+?))?\s*$/u.exec(value);
  if (!match) return null;
  const name = match[2].toLowerCase();
  const rawTitle = (match[3] ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/^['"]|['"]$/g, "");
  const idMatch = /\s*\{#([A-Za-z][A-Za-z0-9_-]*)\}\s*$/u.exec(rawTitle);
  const title = (idMatch ? rawTitle.slice(0, idMatch.index) : rawTitle).trim();
  return {
    fence: match[1],
    name,
    title: title || DIRECTIVE_LABELS[name] || name,
    id: idMatch?.[1] ?? "",
  };
}

export function isArticleDirectiveClose(value, minimumLength = 3) {
  const match = /^\s*(:{3,4})\s*$/u.exec(value);
  return Boolean(match && match[1].length >= minimumLength);
}

/**
 * Preserve ordered-list numbering when an unindented display-math block
 * splits one logical list. CommonMark must emit two `<ol>` blocks at that
 * boundary; carrying the continuation start keeps the published article's
 * visible numbering contiguous instead of resetting to 1.
 */
export function remarkArticleOrderedListContinuation() {
  return (tree) => {
    const visit = (parent) => {
      if (!parent || !Array.isArray(parent.children)) return;
      let previousList = null;
      let separatedByDisplayMath = false;
      for (const child of parent.children) {
        if (child?.type === "list" && child.ordered) {
          if (
            previousList &&
            separatedByDisplayMath &&
            (child.start == null || child.start === 1)
          ) {
            const previousStart = Number(previousList.start ?? 1);
            child.start = previousStart + previousList.children.length;
          }
          visit(child);
          previousList = child;
          separatedByDisplayMath = false;
          continue;
        }
        if (child?.type === "math") {
          if (previousList) separatedByDisplayMath = true;
          continue;
        }
        previousList = null;
        separatedByDisplayMath = false;
        visit(child);
      }
    };
    visit(tree);
  };
}

const inlineSource = (node) => {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "inlineMath") return `$${node.value}$`;
  const children = (node.children ?? []).map(inlineSource).join("");
  if (node.type === "strong") return `**${children}**`;
  if (node.type === "emphasis") return `*${children}*`;
  if (node.type === "delete") return `~~${children}~~`;
  if (node.type === "inlineCode") return `\`${node.value}\``;
  if (node.type === "break") return "\n";
  return children;
};

const paragraphText = (node) => {
  if (!node || node.type !== "paragraph" || !Array.isArray(node.children))
    return null;
  const supported = new Set([
    "text",
    "inlineMath",
    "strong",
    "emphasis",
    "delete",
    "inlineCode",
    "break",
  ]);
  const containsUnsupported = (children) =>
    children.some(
      (child) =>
        !supported.has(child.type) ||
        (child.children && containsUnsupported(child.children)),
    );
  if (containsUnsupported(node.children)) return null;
  return node.children.map(inlineSource).join("");
};

const compactDirective = (value) => {
  const lines = String(value).split("\n");
  const marker = parseArticleDirectiveMarker(lines[0] ?? "");
  if (!marker || lines.length < 3) return null;
  const closeIndex = lines.findIndex(
    (line, index) =>
      index > 0 && isArticleDirectiveClose(line, marker.fence.length),
  );
  if (closeIndex < 0 || lines.slice(closeIndex + 1).some((line) => line.trim()))
    return null;
  return {
    marker,
    body: lines.slice(1, closeIndex).join("\n").trim(),
  };
};

const renderedContainer = (tagName, className, children, properties = {}) => ({
  type: "blockquote",
  data: {
    hName: tagName,
    hProperties: {
      ...properties,
      ...(className.length > 0 ? { className } : {}),
    },
  },
  children,
});

const renderedParagraph = (tagName, className, children) => ({
  type: "paragraph",
  data: {
    hName: tagName,
    hProperties: className.length > 0 ? { className } : {},
  },
  children,
});

const textNode = (value) => ({ type: "text", value });

const directiveLabel = (node) => {
  const first = node.children?.[0];
  if (first?.type === "paragraph" && first.data?.directiveLabel === true) {
    return { children: first.children, body: node.children.slice(1) };
  }
  return { children: null, body: node.children ?? [] };
};

const directiveMarkup = (marker) => {
  const safeName = marker.name.replace(/[^a-z0-9_-]/g, "");
  const id = marker.id
    ? ` id="${escapeHtml(marker.id)}" data-statement-id="${escapeHtml(marker.id)}"`
    : "";

  if (marker.name === "proof") {
    return {
      // Keep the common folding class on every proof variant.  Compact
      // directives (for example `::: proof`) bypass the AST container path,
      // so without this class their summary never receives the disclosure
      // arrow styling used by published mathematics pages.
      open: `<details class="proof-details folding" data-directive="proof" open>`,
      title: titleParagraph(marker, { tagName: "summary" }),
      bodyOpen: `<div class="proof-details-inner">`,
      close: "</div></details>",
    };
  }

  if (marker.name === "folding") {
    return {
      open: `<details class="folding" data-directive="folding">`,
      title: titleParagraph(marker, { tagName: "summary" }),
      bodyOpen: `<div class="folding-content">`,
      close: "</div></details>",
    };
  }

  if (marker.name === "supp") {
    return {
      open: `<details class="supp-details" data-directive="supp">`,
      title: titleParagraph(marker, {
        className: "supp-details-summary",
        tagName: "summary",
      }),
      bodyOpen: `<div class="supp-details-inner">`,
      close: "</div></details>",
    };
  }

  if (marker.name === "rem") {
    return {
      open: `<aside class="rem" data-directive="rem" role="note">`,
      title: titleParagraph(marker, { className: "rem-title" }),
      close: "</aside>",
    };
  }

  const semanticClass = SEMANTIC_CLASSES[marker.name];
  if (semanticClass) {
    return {
      open: `<section class="article-directive ${semanticClass}" data-directive="${safeName}"${id}>`,
      title: titleParagraph(marker, {
        className: "thmtitle",
        preserveSource: true,
      }),
      close: "</section>",
    };
  }

  return {
    open: `<section class="article-directive article-directive-${safeName}" data-directive="${safeName}">`,
    title: titleParagraph(marker, {
      className: "article-directive-title",
      tagName: "div",
    }),
    bodyOpen: `<div class="article-directive-body">`,
    close: "</div></section>",
  };
};

const transformContainer = (node, visit, file) => {
  const start = node.position?.start?.offset;
  const opening =
    typeof start === "number"
      ? (String(file?.value ?? "")
          .slice(start)
          .match(/^:{3,}/u)?.[0] ?? "")
      : "";
  if (opening && ![3, 4].includes(opening.length)) {
    file?.fail?.(
      "directive の境界には `:::` または `::::` を使ってください。",
      node,
    );
    return;
  }
  if (!ARTICLE_DIRECTIVE_NAMES.has(String(node.name))) {
    file?.fail?.(`未対応の directive \`${String(node.name)}\` です。`, node);
    return;
  }
  for (const child of node.children ?? []) visit(child);

  const { children: label, body } = directiveLabel(node);
  const name = String(node.name);
  if (name === "rem") {
    const title = renderedParagraph(
      "p",
      ["rem-title"],
      label ?? [textNode("注釈.")],
    );
    node.type = "blockquote";
    node.data = {
      hName: "aside",
      hProperties: { className: ["rem"], role: "note" },
    };
    node.children = [title, ...body];
    delete node.name;
    delete node.attributes;
    return;
  }

  const semanticClass = SEMANTIC_CLASSES[name];
  if (semanticClass) {
    const id = node.attributes?.id;
    node.type = "blockquote";
    node.data = {
      hName: "section",
      hProperties: {
        className: ["article-directive", semanticClass],
        ...(id ? { id, "data-statement-id": id } : {}),
      },
    };
    node.children = [
      renderedParagraph(
        "p",
        ["thmtitle"],
        label ?? [textNode(DIRECTIVE_LABELS[name])],
      ),
      ...body,
    ];
    delete node.name;
    delete node.attributes;
    return;
  }

  const details = name === "supp" || name === "proof" || name === "folding";
  if (!details) {
    node.type = "blockquote";
    node.data = {
      hName: "section",
      hProperties: {
        className: ["article-directive", `article-directive-${name}`],
        "data-directive": name,
      },
    };
    node.children = [
      renderedParagraph(
        "div",
        ["article-directive-title"],
        label ?? [textNode(DIRECTIVE_LABELS[name] ?? name)],
      ),
      renderedContainer("div", ["article-directive-body"], body),
    ];
    delete node.name;
    delete node.attributes;
    return;
  }

  const summaryText =
    name === "supp" ? "補足." : name === "proof" ? "証明." : "折りたたみ";
  const summary = renderedParagraph(
    "summary",
    [
      name === "supp"
        ? "supp-details-summary"
        : name === "proof"
          ? "folding-summary"
          : "folding-summary",
    ],
    label ?? [textNode(summaryText)],
  );
  const inner = renderedContainer(
    "div",
    [
      name === "supp"
        ? "supp-details-inner"
        : name === "proof"
          ? "proof-details-inner"
          : "folding-content",
      ...(name === "proof" ? ["folding-content"] : []),
    ],
    body,
  );
  node.type = "blockquote";
  node.data = {
    hName: "details",
    hProperties: {
      className:
        name === "supp"
          ? ["supp-details"]
          : name === "proof"
            ? ["proof-details", "folding"]
            : ["folding"],
    },
  };
  node.children = [summary, inner];
  delete node.name;
  delete node.attributes;
};

/**
 * Transform the fenced directive syntax emitted by the editor.
 *
 * It handles both remark-directive AST nodes and the ordinary paragraph nodes
 * produced when a title contains inline mathematics. The latter cannot be
 * recognized by remark-directive (for example `:::defi タイトル$G$`), so both
 * forms must use the same renderer.
 */
export function remarkArticleDirectives() {
  return (tree, file) => {
    if (!tree || tree.type !== "root" || !Array.isArray(tree.children)) return;

    const output = [];
    const stack = [];
    const preserveNonContainer = (node) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      const raw =
        typeof start === "number" && typeof end === "number"
          ? String(file.value).slice(start, end)
          : `${node.type === "leafDirective" ? "::" : ":"}${String(node.name)}`;
      if (node.type === "leafDirective") {
        node.type = "paragraph";
        node.children = [textNode(raw)];
      } else {
        node.type = "text";
        node.value = raw;
        delete node.children;
      }
      delete node.name;
      delete node.attributes;
      delete node.data;
    };
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "containerDirective") {
        transformContainer(node, visit, file);
        return;
      }
      if (node.type === "leafDirective" || node.type === "textDirective") {
        preserveNonContainer(node);
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    for (const node of tree.children) {
      if (node.type === "containerDirective") {
        visit(node);
        output.push(node);
        continue;
      }
      visit(node);
      const text = paragraphText(node);
      const compact = text === null ? null : compactDirective(text);
      if (compact) {
        if (!ARTICLE_DIRECTIVE_NAMES.has(compact.marker.name)) {
          file?.fail?.(
            `未対応の directive \`${compact.marker.name}\` です。`,
            node,
          );
          continue;
        }
        const markup = directiveMarkup(compact.marker);
        output.push({ type: "html", value: markup.open });
        if (markup.title) output.push(markup.title);
        if (markup.bodyOpen)
          output.push({ type: "html", value: markup.bodyOpen });
        if (compact.body) {
          output.push({
            type: "paragraph",
            children: [textNode(compact.body)],
          });
        }
        output.push({ type: "html", value: markup.close });
        continue;
      }
      const marker = text === null ? null : parseArticleDirectiveMarker(text);
      if (text !== null && /^\s*:{5,}/u.test(text)) {
        file?.fail?.(
          "directive の境界には `:::` または `::::` を使ってください。",
          node,
        );
        continue;
      }
      if (marker) {
        if (!ARTICLE_DIRECTIVE_NAMES.has(marker.name)) {
          file?.fail?.(`未対応の directive \`${marker.name}\` です。`, node);
          continue;
        }
        const active = stack.at(-1);
        if (active && marker.fence.length > active.fenceLength) {
          file?.fail?.(
            "入れ子の directive は外側より長いコロン列で開始できません。",
            node,
          );
          continue;
        }
        const markup = directiveMarkup(marker);
        output.push({ type: "html", value: markup.open });
        if (markup.title) output.push(markup.title);
        if (markup.bodyOpen)
          output.push({ type: "html", value: markup.bodyOpen });
        stack.push({ fenceLength: marker.fence.length, close: markup.close });
        continue;
      }

      if (node.type === "leafDirective" || node.type === "textDirective") {
        preserveNonContainer(node);
        output.push(node);
        continue;
      }

      const active = stack.at(-1);
      if (
        active &&
        text !== null &&
        isArticleDirectiveClose(text, active.fenceLength)
      ) {
        output.push({ type: "html", value: active.close });
        stack.pop();
        continue;
      }

      output.push(node);
    }

    while (stack.length)
      output.push({ type: "html", value: stack.pop().close });
    tree.children = output;
  };
}
