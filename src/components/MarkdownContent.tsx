import ReactMarkdown, { type Components } from "react-markdown";
import { formatStudyGuideMarkdown } from "@/lib/study-guide-format";

type MarkdownContentProps = {
  children: string | null | undefined;
  components?: Components;
  className?: string;
};

/**
 * Shared renderer for all AI- and user-authored Markdown in Momentum.
 * Normalizes the collapsed/escaped table output some models produce into
 * readable labeled lists, and gives links safe, consistent behavior.
 * Raw HTML remains disabled by react-markdown.
 */
export function MarkdownContent({ children, components, className }: MarkdownContentProps) {
  const safeComponents: Components = {
    a: ({ children: linkChildren, href, title }) => (
      <a
        href={href}
        title={title}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cool2 underline underline-offset-2 break-words"
      >
        {linkChildren}
      </a>
    ),
    ...components,
  };

  return (
    <div className={className}>
      <ReactMarkdown components={safeComponents}>
        {formatStudyGuideMarkdown(children ?? "")}
      </ReactMarkdown>
    </div>
  );
}
