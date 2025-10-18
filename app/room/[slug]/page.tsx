"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

type PeerMeta = { name: string; avatar: string; color: string };
type Cursor = { x: number; y: number; t: number };

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerMeta>>({});
  const cursors = useRef<Record<string, Cursor>>({});
  const smoothed = useRef<Record<string, Cursor>>({});

  const self = useMemo(() => {
    try {
      const raw = localStorage.getItem("cursor_user");
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (!u?.id) u.id = getOrCreateClientId();
      return u as { id: string; name: string; avatar: string };
    } catch {
      return null;
    }
  }, []);

  const color = useMemo(() => (self ? colorFromString(self.id) : "#3b82f6"), [self]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !self) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const supa = browserClient();
    const channel = supa.channel(`room:${slug}`, { config: { presence: { key: self.id } } });

    const onResize = () => resizeCanvas(canvas);
    onResize();
    window.addEventListener("resize", onResize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      // smooth
      for (const [id, cur] of Object.entries(cursors.current)) {
        const last = smoothed.current[id] || cur;
        const alpha = 0.25;
        const nx = last.x + (cur.x - last.x) * alpha;
        const ny = last.y + (cur.y - last.y) * alpha;
        smoothed.current[id] = { x: nx, y: ny, t: now };
      }
      // draw
      for (const [id, meta] of Object.entries(peers)) {
        const c = smoothed.current[id] || cursors.current[id];
        if (!c) continue;
        const isIdle = now - c.t > 3000;
        ctx.globalAlpha = isIdle ? 0.55 : 1;
        drawCursor(ctx, c.x, c.y, meta);
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(draw);
    };
    const raf = requestAnimationFrame(draw);

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<PeerMeta>>;
      const next: Record<string, PeerMeta> = {};
      for (const [id, arr] of Object.entries(state)) {
        const meta = arr[0];
        if (meta) next[id] = meta;
      }
      setPeers(next);
    });

    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      const { userId, x, y } = payload as { userId: string; x: number; y: number };
      const rect = canvas.getBoundingClientRect();
      cursors.current[userId] = { x: clamp(x, 0, rect.width), y: clamp(y, 0, rect.height), t: performance.now() };
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name: self.name, avatar: self.avatar, color });
      }
    });

    const onMove = throttle((e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      channel.send({ type: "broadcast", event: "cursor", payload: { userId: self.id, x, y } });
    }, 33);

    window.addEventListener("pointermove", onMove);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      channel.unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [slug, self, color]);

  if (!self) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Missing profile. Please rejoin the room.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="fixed inset-0">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </main>
  );
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  meta: { name: string; avatar: string; color: string }
) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = meta.color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 10, y + 20);
  ctx.lineTo(x - 10, y + 20);
  ctx.closePath();
  ctx.fill();

  const label = `${meta.avatar}  ${meta.name}`;
  const paddingX = 10,
    paddingY = 6;
  ctx.font = "500 13px ui-sans-serif, system-ui, -apple-system";
  const w = ctx.measureText(label).width + paddingX * 2;
  const h = 26;
  const rx = 10;
  const px = x - w / 2,
    py = y - 36 - h;
  roundRect(ctx, px, py, w, h, rx);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.fillText(label, px + paddingX, py + h - paddingY);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let t: any;
  return ((...args: any[]) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(t);
      t = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  }) as T;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

function colorFromString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 85% 54%)`;
}


