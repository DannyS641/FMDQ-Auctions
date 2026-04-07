import { FileText, Download } from "lucide-react";
import type { FileRef } from "@/types";

type Props = {
  documents: FileRef[];
};

export function DocumentList({ documents }: Props) {
  const visible = documents.filter(
    (d) => !d.visibility || d.visibility === "bidder_visible"
  );

  if (visible.length === 0) {
    return <p className="text-sm text-slate">No documents available.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((doc, i) => (
        <a
          key={i}
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink transition hover:border-neon/30 hover:bg-[#eef3ff] hover:text-neon"
        >
          <FileText size={16} className="shrink-0 text-slate" />
          <span className="flex-1 truncate">{doc.name}</span>
          <Download size={14} className="shrink-0 opacity-40" />
        </a>
      ))}
    </div>
  );
}
