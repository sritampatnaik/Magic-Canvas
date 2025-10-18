"use client";

import { useState } from "react";

export default function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white"
      />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="rounded-md bg-black text-white px-3 py-2 text-sm hover:bg-black/85"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}


