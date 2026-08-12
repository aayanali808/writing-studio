'use client';

import { useMemo } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';

/**
 * Renders Claude's Markdown in the panes.
 *
 * Parsing is memoised because the chat and ask popovers re-render on every
 * streamed chunk — without it the whole reply would be re-parsed per token.
 *
 * Styling lives in `.studio-md` in globals.css rather than in classes here, so
 * the three panes that show model output look the same by construction.
 */
export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  return (
    <div className={className ? `studio-md ${className}` : 'studio-md'}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <InlineView nodes={block.content} />
        </p>
      );

    case 'heading': {
      // Model output starts at ## as often as #, and a side pane has no room
      // for a display-size heading either way, so levels are capped at h3 and
      // sized down in CSS.
      const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[
        Math.min(Math.max(block.level, 1), 4) - 1
      ];
      return (
        <Tag>
          <InlineView nodes={block.content} />
        </Tag>
      );
    }

    case 'quote':
      return (
        <blockquote>
          {block.content.map((child, index) => (
            <BlockView key={index} block={child} />
          ))}
        </blockquote>
      );

    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );

    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          {item.map((child, childIndex) => (
            <BlockView key={childIndex} block={child} />
          ))}
        </li>
      ));

      return block.ordered ? (
        <ol start={block.start}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }

    case 'table':
      return (
        <div className="studio-md-scroll">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index}>
                    <InlineView nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <InlineView nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'rule':
      return <hr />;
  }
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return node.text;
          case 'code':
            return <code key={index}>{node.text}</code>;
          case 'strong':
            return (
              <strong key={index}>
                <InlineView nodes={node.content} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <InlineView nodes={node.content} />
              </em>
            );
          case 'strike':
            return (
              <s key={index}>
                <InlineView nodes={node.content} />
              </s>
            );
          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <InlineView nodes={node.content} />
              </a>
            );
        }
      })}
    </>
  );
}
