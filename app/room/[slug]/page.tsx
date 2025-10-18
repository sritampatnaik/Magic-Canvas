"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";
import ShareLink from "@/components/ShareLink";
import type { RealtimeChannel } from "@supabase/supabase-js";

type PeerMeta = { name: string; avatar: string; color: string };
type Cursor = { x: number; y: number; t: number };
type Point = { x: number; y: number };
type Stroke = { id: string; points: Point[]; color: string; width: number; userId: string };
type ImageItem = { id: string; url: string; x: number; y: number; w: number; h: number; img?: HTMLImageElement };

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peersRef = useRef<Record<string, PeerMeta>>({});
  const cursors = useRef<Record<string, Cursor>>({});
  const smoothed = useRef<Record<string, Cursor>>({});
  const [self, setSelf] = useState<{ id: string; name: string; avatar: string } | null>(null);
  const [connId, setConnId] = useState<string>("");
  const [shareUrl, setShareUrl] = useState<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const imagesRef = useRef<ImageItem[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const draggingImageIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const [tool, setTool] = useState<"cursor" | "pen" | "image">("cursor");

  useEffect(() => {
    try { setShareUrl(`${window.location.origin}/room/${slug}/join`); } catch {}
    // create a stable per-tab connection id, used as presence key and cursor map key
    try {
      const key = "cursor_conn_id";
      const existing = sessionStorage.getItem(key);
      const id = existing || crypto.randomUUID();
      sessionStorage.setItem(key, id);
      setConnId(id);
    } catch {}
    try {
      const raw = localStorage.getItem("cursor_user");
      if (!raw) { router.replace(`/room/${slug}/join`); return; }
      const u = JSON.parse(raw);
      if (!u?.id) u.id = getOrCreateClientId();
      setSelf({ id: u.id, name: u.name, avatar: u.avatar });
    } catch { router.replace(`/room/${slug}/join`); }
  }, [router, slug]);

  const color = useMemo(() => {
    const key = connId || self?.id;
    return key ? colorFromString(key) : "#3b82f6";
  }, [self, connId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !self || !connId) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const supa = browserClient();
    const channel = supa.channel(`room:${slug}`, { config: { presence: { key: connId } } });
    channelRef.current = channel;

    const onResize = () => resizeCanvas(canvas);
    onResize();
    window.addEventListener("resize", onResize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // images under
      for (const item of imagesRef.current) {
        if (item.img && item.img.complete) ctx.drawImage(item.img, item.x, item.y, item.w, item.h);
      }
      // strokes over
      for (const s of strokesRef.current) {
        if (s.points.length < 2) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
      }
      // cursors
      const now = performance.now();
      for (const [id, cur] of Object.entries(cursors.current)) {
        const last = smoothed.current[id] || cur;
        const alpha = 0.25;
        const nx = last.x + (cur.x - last.x) * alpha;
        const ny = last.y + (cur.y - last.y) * alpha;
        smoothed.current[id] = { x: nx, y: ny, t: now };
      }
      for (const [id, meta] of Object.entries(peersRef.current)) {
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
      peersRef.current = next;
    });

    channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
      const { key, x, y } = payload as { key: string; x: number; y: number };
      const rect = canvas.getBoundingClientRect();
      cursors.current[key] = { x: clamp(x, 0, rect.width), y: clamp(y, 0, rect.height), t: performance.now() };
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
      // optimistic local update + broadcast using presence key
      cursors.current[connId] = { x, y, t: performance.now() };
      channel.send({ type: "broadcast", event: "cursor", payload: { key: connId, x, y } });
      if (tool === "pen" && currentStrokeRef.current) {
        currentStrokeRef.current.points.push({ x, y });
      }
      if (tool === "cursor" && draggingImageIdRef.current) {
        const id = draggingImageIdRef.current;
        const dx = x - dragOffsetRef.current.x;
        const dy = y - dragOffsetRef.current.y;
        const idx = imagesRef.current.findIndex((i) => i.id === id);
        if (idx >= 0) {
          const { w, h } = imagesRef.current[idx];
          imagesRef.current[idx] = { ...imagesRef.current[idx], x: dx, y: dy, w, h };
        }
      }
    }, 16);

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (tool === "pen") {
        const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x, y }], color, width: 3, userId: self.id };
        currentStrokeRef.current = stroke;
        strokesRef.current = [...strokesRef.current, stroke];
      } else if (tool === "cursor") {
        for (let i = imagesRef.current.length - 1; i >= 0; i--) {
          const it = imagesRef.current[i];
          if (hitImage(it, x, y)) {
            draggingImageIdRef.current = it.id;
            dragOffsetRef.current = { x: x - it.x, y: y - it.y };
            break;
          }
        }
      }
    };

    const onUp = () => {
      if (tool === "pen" && currentStrokeRef.current) {
        channel.send({ type: "broadcast", event: "stroke", payload: currentStrokeRef.current });
        currentStrokeRef.current = null;
      }
      if (tool === "cursor" && draggingImageIdRef.current) {
        const id = draggingImageIdRef.current;
        draggingImageIdRef.current = null;
        const img = imagesRef.current.find((i) => i.id === id);
        if (img) channel.send({ type: "broadcast", event: "image-move", payload: { id, x: img.x, y: img.y } });
      }
    };

    channel.on("broadcast", { event: "stroke" }, ({ payload }) => {
      const stroke = payload as Stroke;
      strokesRef.current = [...strokesRef.current, stroke];
    });

    channel.on("broadcast", { event: "image-add" }, ({ payload }) => {
      const item = payload as ImageItem;
      loadImageItem(item).then((loaded) => {
        imagesRef.current = [...imagesRef.current, loaded];
      });
    });

    channel.on("broadcast", { event: "image-move" }, ({ payload }) => {
      const { id, x, y } = payload as { id: string; x: number; y: number };
      const idx = imagesRef.current.findIndex((i) => i.id === id);
      if (idx >= 0) imagesRef.current[idx] = { ...imagesRef.current[idx], x, y };
    });

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", onResize);
      channel.unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [slug, self, color, tool, connId]);

  return (
    <main className="min-h-screen">
      <div className="fixed inset-0">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-10 w-[min(720px,92vw)]">
        <div className="rounded-xl border border-gray-200 bg-white/90 backdrop-blur px-4 py-2 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <ShareLink url={shareUrl} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTool("cursor")}
                className={`px-3 py-2 rounded-md text-sm border ${tool === "cursor" ? "bg-black text-white border-black" : "border-gray-200"}`}
              >
                Select
              </button>
              <button
                onClick={() => setTool("pen")}
                className={`px-3 py-2 rounded-md text-sm border ${tool === "pen" ? "bg-black text-white border-black" : "border-gray-200"}`}
              >
                Pen
              </button>
              <button
                onClick={() => onAddImage()}
                className={`px-3 py-2 rounded-md text-sm border border-gray-200`}
              >
                Add image
              </button>
            </div>
          </div>
        </div>
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

function throttle<TArgs extends unknown[]>(fn: (...args: TArgs) => void, ms: number) {
  let last = 0;
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: TArgs) => {
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
  });
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

function hitImage(item: ImageItem, x: number, y: number) {
  return x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h;
}

async function loadImageItem(item: ImageItem): Promise<ImageItem> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ ...item, img });
    img.onerror = () => resolve(item);
    img.src = item.url;
  });
}


