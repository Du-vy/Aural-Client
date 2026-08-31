import { useMemo } from "react";

import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

interface MarkdownProps {
  source: string;
  onOpenLink(url: string): void;
}

/**
 * Renders a Markdown subset as React elements.
 *
 * Nothing here builds markup from the source: every string ends up as a text
 * child, which React escapes. A `.md` file in a channel was written by whoever
 * uploaded it, so that property is the whole point of rendering it this way.
 */
export function Markdown({ source, onOpenLink }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  return (
    <div className="md">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} block={block} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block, onOpenLink }: { block: Block; onOpenLink(url: string): void }) {
  switch (block.type) {
    case "heading": {
      // The level decides the class rather than the tag: a preview sits inside
      // a conversation, and dropping an <h1> into it would claim a place in the
      // page outline that a quoted file has no business claiming.
      return (
        <p className={`md__h md__h--${block.level}`}>
          <InlineRun nodes={block.children} onOpenLink={onOpenLink} />
        </p>
      );
    }

    case "paragraph":
      return (
        <p className="md__p">
          <InlineRun nodes={block.children} onOpenLink={onOpenLink} />
        </p>
      );

    case "code":
      return (
        <pre className="md__pre">
          <code>{block.value}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="md__quote">
          <InlineRun nodes={block.children} onOpenLink={onOpenLink} />
        </blockquote>
      );

    case "rule":
      return <hr className="md__rule" />;

    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className="md__list">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineRun nodes={item} onOpenLink={onOpenLink} />
            </li>
          ))}
        </List>
      );
    }

    case "table":
      return (
        <div className="md__table-wrap">
          <table className="md__table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index}>
                    <InlineRun nodes={cell} onOpenLink={onOpenLink} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <InlineRun nodes={cell} onOpenLink={onOpenLink} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return null;
  }
}

function InlineRun({ nodes, onOpenLink }: { nodes: Inline[]; onOpenLink(url: string): void }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <span key={index}>{node.value}</span>;
          case "strong":
            return (
              <strong key={index}>
                <InlineRun nodes={node.children} onOpenLink={onOpenLink} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <InlineRun nodes={node.children} onOpenLink={onOpenLink} />
              </em>
            );
          case "strike":
            return (
              <s key={index}>
                <InlineRun nodes={node.children} onOpenLink={onOpenLink} />
              </s>
            );
          case "code":
            return (
              <code key={index} className="md__code">
                {node.value}
              </code>
            );
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                className="msg__link"
                // A link in an uploaded file goes through the same confirmation
                // a link in a message does: the file is no more trusted than
                // the person who sent it.
                onClick={(event) => {
                  event.preventDefault();
                  onOpenLink(node.href);
                }}
              >
                <InlineRun nodes={node.children} onOpenLink={onOpenLink} />
              </a>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
