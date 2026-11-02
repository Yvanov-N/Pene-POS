import { useEffect, useState } from "react";

type ThumbSize = "sm" | "md" | "lg";

const BOX_CLASS: Record<ThumbSize, string> = {
  sm: "h-10 w-10 rounded-md",
  md: "h-14 w-14 rounded-lg",
  lg: "h-16 w-16 rounded-md",
};

const EMOJI_CLASS: Record<ThumbSize, string> = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
};

interface ProductThumbProps {
  product: { name?: string; image_url?: string; emoji?: string };
  size?: ThumbSize;
}

// A product's picture in a fixed square box, falling back to its emoji (or 📦)
// when there's no image or it fails to load -- a dead storage URL or a typo'd
// link must never leave a broken-image icon in a table or on the POS grid.
export function ProductThumb({ product, size = "sm" }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt.
  useEffect(() => {
    setFailed(false);
  }, [product.image_url]);

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden ${BOX_CLASS[size]}`}>
      {product.image_url && !failed ? (
        <img
          src={product.image_url}
          alt={product.name ?? ""}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={EMOJI_CLASS[size]} aria-hidden>
          {product.emoji || "📦"}
        </span>
      )}
    </span>
  );
}
