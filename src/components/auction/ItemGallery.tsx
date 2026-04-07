import { useState } from "react";
import { cn } from "@/lib/cn";
import type { FileRef } from "@/types";

type Props = {
  images: FileRef[];
  title: string;
};

export function ItemGallery({ images, title }: Props) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-3xl bg-ash text-slate/30 text-4xl">
        ⬜
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Main image */}
      <div className="overflow-hidden rounded-3xl bg-ash">
        <img
          src={images[active].url}
          alt={`${title} — image ${active + 1}`}
          className="h-72 w-full object-cover sm:h-96"
        />
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 transition",
                i === active ? "border-neon" : "border-transparent opacity-60 hover:opacity-100"
              )}
            >
              <img src={img.url} alt={`Thumbnail ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
