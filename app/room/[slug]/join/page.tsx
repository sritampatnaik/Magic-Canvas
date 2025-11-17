"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AvatarPicker from "@/components/AvatarPicker";

export default function JoinPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("😀");

  useEffect(() => {
    try {
      const prev = localStorage.getItem("cursor_user");
      if (prev) {
        const parsed = JSON.parse(prev);
        if (parsed?.name) setName(parsed.name);
        if (parsed?.avatar) setAvatar(parsed.avatar);
      }
    } catch {}
  }, [slug]);

  return (
    <main className="min-h-screen max-w-xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Choose your name and avatar</h1>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex"
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Avatar</label>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
        <div>
          <button
            onClick={() => {
              if (!name.trim()) return;
              const id = getOrCreateClientId();
              const user = { id, name: name.trim(), avatar };
              localStorage.setItem("cursor_user", JSON.stringify(user));
              router.push(`/room/${slug}`);
            }}
            className="rounded-md bg-black text-white px-5 py-3 text-sm font-medium hover:bg-black/85"
          >
            Enter room
          </button>
        </div>
        
        {/* Hand Gestures Help Section */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h2 className="text-lg font-semibold mb-4">🪄 Hand Gesture Controls</h2>
          <p className="text-sm text-gray-600 mb-4">
            Once inside, enable <strong>Magic Mode</strong> to control the canvas with hand gestures:
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className="text-2xl">☝️</span>
              <div>
                <p className="font-medium text-sm">Pointing Up</p>
                <p className="text-xs text-gray-600">Draw with pen - point and move to create strokes</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className="text-2xl">✋</span>
              <div>
                <p className="font-medium text-sm">Open Palm</p>
                <p className="text-xs text-gray-600">Eraser - move your palm to erase drawings</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className="text-2xl">✌️</span>
              <div>
                <p className="font-medium text-sm">Victory / Peace</p>
                <p className="text-xs text-gray-600">Select area - drag to create selection box for AI generation</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className="text-2xl">👍</span>
              <div>
                <p className="font-medium text-sm">Thumbs Up</p>
                <p className="text-xs text-gray-600">Start voice assistant - talk to change colors, brush size, or generate images</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className="text-2xl">👎</span>
              <div>
                <p className="font-medium text-sm">Thumbs Down</p>
                <p className="text-xs text-gray-600">Stop voice assistant</p>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <p className="text-xs text-blue-800">
              <strong>💡 Tip:</strong> You can also use your mouse/trackpad with the toolbar buttons for traditional drawing!
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function getOrCreateClientId(): string {
  try {
    const key = "cursor_user_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}


