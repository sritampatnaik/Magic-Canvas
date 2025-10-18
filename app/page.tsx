"use client";

import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-lg text-center">
        <h1 className="text-3xl font-semibold tracking-tight mb-6">Realtime Cursor Rooms</h1>
        <p className="text-gray-500 mb-8">Create a room and share the link. Pick a name and avatar to join. See everyone’s cursors live on a canvas.</p>
        <button
          onClick={async () => {
            try {
              setLoading(true);
              const res = await fetch("/api/rooms", { method: "POST" });
              const json = await res.json();
              if (json?.url) {
                window.location.href = json.url;
              }
            } finally {
              setLoading(false);
            }
          }}
          className="inline-flex items-center justify-center rounded-md bg-black text-white px-5 py-3 text-sm font-medium hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-black/20 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Creating…" : "Create Room"}
        </button>
        <div className="mt-10 text-xs text-gray-400">
          <a href="https://supabase.com/docs/guides/realtime" target="_blank" rel="noreferrer" className="hover:text-gray-600">
            Powered by Supabase Realtime
          </a>
        </div>
      </div>
    </main>
  );
}


