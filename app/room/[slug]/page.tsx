"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";
import ShareLink from "@/components/ShareLink";
import { fal } from "@fal-ai/client";
import { createHandDetector, createGestureRecognizer } from "@/lib/hand/mediapipe";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Conversation } from "@elevenlabs/client";
import { Hand, Mic } from "lucide-react";

type PeerMeta = { name: string; avatar: string; color: string };
type Cursor = { x: number; y: number; t: number };
type Point = { x: number; y: number };
type Stroke = { id: string; points: Point[]; color: string; width: number; userId: string; mode?: 'draw' | 'erase' };
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
  const handEnabledRef = useRef<boolean>(false);
  const gesturesEnabledRef = useRef<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<{ detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks?: Array<Array<{ x: number; y: number; z: number }>> } | null; close?: () => void } | null>(null);
  const gestureDetectorRef = useRef<{ recognizeForVideo: (video: HTMLVideoElement, timestamp: number) => { gestures?: Array<Array<{ categoryName: string; score: number }>> } | null; close?: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectTsRef = useRef<number>(0);
  const originalConsoleInfoRef = useRef<typeof console.info | null>(null);
  const originalConsoleLogRef = useRef<typeof console.log | null>(null);
  const originalConsoleErrorRef = useRef<typeof console.error | null>(null);
  const gestureByKeyRef = useRef<Record<string, string>>({});
  const currentGestureEmojiRef = useRef<string | null>(null);
  const toolByKeyRef = useRef<Record<string, { tool: 'cursor' | 'pen' | 'eraser'; color: string }>>({});
  const gestureStrokeActiveRef = useRef<boolean>(false);
  // Selection via Victory gesture
  const selectionActiveRef = useRef<boolean>(false);
  const selectionStartRef = useRef<Point | null>(null);
  const selectionRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const selectionByKeyRef = useRef<Record<string, { x: number; y: number; w: number; h: number } | null>>({});
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Configure fal client to use proxy
  fal.config({ proxyUrl: "/api/fal/proxy" });
  const gestureMap: Record<string, string> = {
    Thumb_Up: "👍",
    Thumb_Down: "👎",
    Open_Palm: "✋",
    Pointing_Up: "☝️",
    Victory: "✌️",
    ILoveYou: "🤟",
    Closed_Fist: "✊",
    OK: "👌",
    Call_Me: "🤙",
  };
  const strokesRef = useRef<Stroke[]>([]);
  const imagesRef = useRef<ImageItem[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const draggingImageIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const [tool, setTool] = useState<"cursor" | "pen" | "image" | "eraser" | "select">("cursor");
  const brushWidthRef = useRef<number>(3);
  const activeStrokeIndexByIdRef = useRef<Record<string, number>>({});
  const [handAndGesturesEnabled, setHandAndGesturesEnabled] = useState(false);
  
  // ElevenLabs state
  const conversationRef = useRef<Conversation | null>(null);
  const elevenLabsEnabledRef = useRef<boolean>(false);
  const elevenLabsInitializingRef = useRef<boolean>(false);
  const lastThumbGestureRef = useRef<number>(0);
  const [elevenLabsActive, setElevenLabsActive] = useState(false);

  // Color name to hex mapping
  const parseColorName = (colorName: string | undefined): string => {
    const currentColor = toolByKeyRef.current[connId]?.color || color;
    if (!colorName) return currentColor;
    
    const colorMap: Record<string, string> = {
      red: '#ef4444', darkred: '#b91c1c', lightred: '#fca5a5',
      blue: '#3b82f6', darkblue: '#1e40af', lightblue: '#93c5fd',
      green: '#10b981', darkgreen: '#047857', lightgreen: '#6ee7b7',
      yellow: '#eab308', darkyellow: '#a16207', lightyellow: '#fde047',
      purple: '#a855f7', darkpurple: '#7e22ce', lightpurple: '#d8b4fe',
      orange: '#f97316', darkorange: '#c2410c', lightorange: '#fdba74',
      pink: '#ec4899', darkpink: '#be185d', lightpink: '#f9a8d4',
      black: '#000000', white: '#ffffff', gray: '#6b7280', grey: '#6b7280',
      brown: '#92400e', cyan: '#06b6d4', teal: '#14b8a6',
    };
    const normalized = colorName.toLowerCase().replace(/[\s-]/g, '');
    return colorMap[normalized] || currentColor;
  };

  // ElevenLabs conversation lifecycle
  const startElevenLabs = async () => {
    // Prevent multiple simultaneous initialization attempts
    if (elevenLabsEnabledRef.current || elevenLabsInitializingRef.current) {
      console.log('[ElevenLabs] Already active or initializing, skipping...');
      return;
    }
    
    elevenLabsInitializingRef.current = true;
    
    try {
      console.log('[ElevenLabs] Starting conversation...');
      const res = await fetch('/api/elevenlabs/signed-url');
      const { signedUrl, error } = await res.json();
      
      if (error || !signedUrl) {
        console.error('[ElevenLabs] Failed to get signed URL:', error);
        elevenLabsInitializingRef.current = false;
        return;
      }

      console.log('[ElevenLabs] Starting conversation with signed URL');
      
      const conversation = await Conversation.startSession({
        signedUrl,
        clientTools: {
          change_pen_color: async (params: { color?: string; name?: string; colour?: string } | string) => {
            const colorName = typeof params === 'string' ? params : (params?.color || params?.name || params?.colour);
            
            if (!colorName) {
              return 'I need you to specify which color you want. For example, say "change to red" or "make it blue".';
            }
            
            const newColor = parseColorName(colorName);
            setTool('pen');
            toolByKeyRef.current[connId] = { tool: 'pen', color: newColor };
            channelRef.current?.send({ type: 'broadcast', event: 'tool', payload: { key: connId, tool: 'pen', color: newColor } });
            return `Pen color changed to ${colorName}. Draw to see your new color!`;
          },
          change_brush_size: async (params: { size?: number | string; thickness?: number | string; width?: number | string; action?: string; increase?: boolean; decrease?: boolean } | string) => {
            let size: number | string | undefined;
            
            if (typeof params === 'string') {
              const lower = params.toLowerCase();
              if (lower.includes('thick') || lower.includes('big') || lower.includes('large') || lower.includes('increase')) {
                size = Math.min(brushWidthRef.current + 3, 20);
              } else if (lower.includes('thin') || lower.includes('small') || lower.includes('decrease')) {
                size = Math.max(brushWidthRef.current - 3, 1);
              } else {
                const parsed = parseInt(params);
                if (!isNaN(parsed)) size = Math.max(1, Math.min(20, parsed));
              }
            } else {
              size = params?.size || params?.thickness || params?.width;
              
              if (params?.action === 'increase' || params?.increase === true) {
                size = Math.min(brushWidthRef.current + 3, 20);
              } else if (params?.action === 'decrease' || params?.decrease === true) {
                size = Math.max(brushWidthRef.current - 3, 1);
              }
            }
            
            if (typeof size === 'string') {
              const parsed = parseInt(size);
              if (!isNaN(parsed)) size = parsed;
            }
            
            if (typeof size !== 'number' || isNaN(size)) {
              return 'Please specify a brush size between 1 and 20, or say "make it thicker" or "make it thinner".';
            }
            
            const newSize = Math.max(1, Math.min(20, size));
            brushWidthRef.current = newSize;
            
            if (newSize <= 3) return `Brush is now thin (size ${newSize})`;
            else if (newSize <= 8) return `Brush is now medium (size ${newSize})`;
            else return `Brush is now thick (size ${newSize})`;
          },
          generate_image: async (params: { prompt?: string }) => {
            console.log('═══════════════════════════════════════');
            console.log('[🎨 IMAGE GEN] 🚀 TOOL INVOKED!');
            console.log('[🎨 IMAGE GEN] Tool called with params:', params);
            
            const prompt = params?.prompt;
            if (!prompt) {
              console.log('[🎨 IMAGE GEN] ❌ No prompt provided');
              return 'Please specify what you want to generate';
            }
            console.log('[🎨 IMAGE GEN] ✓ Prompt:', prompt);
            
            if (!selectionRectRef.current) {
              console.log('[🎨 IMAGE GEN] ❌ No selection area');
              return 'Please select an area on the canvas first using the Victory gesture or Select Area tool';
            }
            console.log('[🎨 IMAGE GEN] ✓ Selection rect:', selectionRectRef.current);
            
            try {
              const rect = selectionRectRef.current;
              const canvas = canvasRef.current!;
              console.log('[🎨 IMAGE GEN] Canvas size:', canvas.width, 'x', canvas.height);
              
              const dpr = Math.max(1, window.devicePixelRatio || 1);
              console.log('[🎨 IMAGE GEN] DPR:', dpr);
              
              // Crop selected area
              const src = document.createElement('canvas');
              const sctx = src.getContext('2d')!;
              const sw = Math.max(1, Math.floor(rect.w * dpr));
              const sh = Math.max(1, Math.floor(rect.h * dpr));
              src.width = sw;
              src.height = sh;
              sctx.fillStyle = '#ffffff';
              sctx.fillRect(0, 0, sw, sh);
              sctx.drawImage(canvas, Math.floor(rect.x * dpr), Math.floor(rect.y * dpr), sw, sh, 0, 0, sw, sh);
              console.log('[🎨 IMAGE GEN] Cropped size:', sw, 'x', sh);
              
              // Resize to 512x512
              const sized = document.createElement('canvas');
              const szctx = sized.getContext('2d')!;
              sized.width = 512; sized.height = 512;
              szctx.imageSmoothingEnabled = true;
              szctx.imageSmoothingQuality = 'high';
              szctx.drawImage(src, 0, 0, sized.width, sized.height);
              const dataUrl = sized.toDataURL('image/png');
              console.log('[🎨 IMAGE GEN] ✓ Image prepared, calling Fal.ai...');
              
              setGenerating(true);
              
              const fullPrompt = `Using the selected child-like sketch as reference, ${prompt}. Preserve the composition; amplify shapes and rhythm; use vibrant colors; painterly style; high quality.`;
              console.log('[🎨 IMAGE GEN] Full prompt:', fullPrompt);
              
              type FalGenResult = { data?: { images?: Array<{ url: string }> }; images?: Array<{ url: string }> };
              const result = await fal.subscribe('fal-ai/nano-banana/edit', {
                input: { prompt: fullPrompt, image_urls: [dataUrl], sync_mode: true },
                pollInterval: 1500,
                logs: false,
              }) as FalGenResult;
              
              console.log('[🎨 IMAGE GEN] Fal.ai result:', result);
              
              const url = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
              if (url) {
                console.log('[🎨 IMAGE GEN] ✓ Image URL:', url);
                const item: ImageItem = { id: crypto.randomUUID(), url, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
                const loaded = await loadImageItem(item);
                imagesRef.current = [...imagesRef.current, loaded];
                channelRef.current?.send({ type: 'broadcast', event: 'image-add', payload: item });
                selectionByKeyRef.current[connId] = null;
                selectionRectRef.current = null;
                setShowGenerate(false);
                setGenerating(false);
                console.log('[🎨 IMAGE GEN] ✅ Complete!');
                return 'Image generated successfully! It should appear on the canvas now.';
              }
              
              console.log('[🎨 IMAGE GEN] ❌ No URL in result');
              setGenerating(false);
              return 'Failed to generate image - no URL returned';
            } catch (error: unknown) {
              console.error('[🎨 IMAGE GEN] ❌ Error:', error);
              setGenerating(false);
              const message = error instanceof Error ? error.message : 'Unknown error';
              return `Error generating image: ${message}`;
            }
          }
        },
        onConnect: () => {
          console.log('[ElevenLabs] ✅ Connected');
          console.log('[ElevenLabs] 🔧 Tools available:', ['change_pen_color', 'change_brush_size', 'generate_image']);
          elevenLabsEnabledRef.current = true;
          elevenLabsInitializingRef.current = false;
          setElevenLabsActive(true);
        },
        onDisconnect: () => {
          console.log('[ElevenLabs] ❌ Disconnected');
          elevenLabsEnabledRef.current = false;
          elevenLabsInitializingRef.current = false;
          setElevenLabsActive(false);
        },
        onError: (error) => {
          console.error('[ElevenLabs] ⚠️ Error:', error);
        },
        onModeChange: (mode) => {
          console.log('[ElevenLabs] 🎤 Mode:', mode);
        },
      });

      conversationRef.current = conversation;

    } catch (error) {
      console.error('[ElevenLabs] Failed to start:', error);
      elevenLabsEnabledRef.current = false;
      elevenLabsInitializingRef.current = false;
      setElevenLabsActive(false);
    }
  };

  const stopElevenLabs = async () => {
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch (error) {
        console.error('[ElevenLabs] Error stopping conversation:', error);
      }
      conversationRef.current = null;
    }
    elevenLabsEnabledRef.current = false;
    elevenLabsInitializingRef.current = false;
    setElevenLabsActive(false);
  };

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
      // strokes first
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const s of strokesRef.current) {
        if (s.points.length < 2) continue;
        if (s.mode === 'erase') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0,0,0,1)';
          ctx.lineWidth = s.width;
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.width;
        }
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
      }
      ctx.restore();

      // images on top of strokes
      for (const item of imagesRef.current) {
        if (item.img && item.img.complete) ctx.drawImage(item.img, item.x, item.y, item.w, item.h);
      }

      // render selection rectangles
      for (const rect of Object.values(selectionByKeyRef.current)) {
        if (!rect) continue;
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.globalAlpha = 1;
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
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
      
      // Get tool and gesture info
      const toolInfo = toolByKeyRef.current[id];
      const currentTool = toolInfo?.tool || 'cursor';
      const brushColor = toolInfo?.color || colorFromString(id);
      const gestureEmoji = gestureByKeyRef.current[id];
      
      ctx.save();
      
      // Draw cursor shape based on tool
      if (currentTool === 'eraser') {
        // Draw white circle for eraser (showing actual eraser size)
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // Draw triangle for pen/cursor, with brush color
        ctx.fillStyle = brushColor;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + 12, c.y + 4);
        ctx.lineTo(c.x + 6, c.y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      ctx.restore();
      
      // Draw username and emoji in pill (always visible)
      if (meta?.name) {
        ctx.save();
        ctx.font = "14px sans-serif";
        
        // Measure text with emoji if present
        const displayText = gestureEmoji ? `${gestureEmoji} ${meta.name}` : meta.name;
        const textWidth = ctx.measureText(displayText).width;
        
        const px = c.x + 14;
        const py = c.y + 2;
        const pillWidth = textWidth + 16;
        const pillHeight = 24;
        
        // Draw pill background
        ctx.fillStyle = brushColor;
        ctx.beginPath();
        ctx.roundRect(px, py, pillWidth, pillHeight, 12);
        ctx.fill();
        
        // Draw text
        ctx.fillStyle = "#fff";
        ctx.fillText(displayText, px + 8, py + 17);
        ctx.restore();
      }
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
        channel.send({ type: "broadcast", event: "stroke-append", payload: { id: currentStrokeRef.current.id, point: { x, y } } });
      }
      // Manual selection drag update
      if (tool === "select" && selectionActiveRef.current && selectionStartRef.current) {
        const sx = selectionStartRef.current.x;
        const sy = selectionStartRef.current.y;
        const rx = Math.min(sx, x);
        const ry = Math.min(sy, y);
        const rw = Math.abs(x - sx);
        const rh = Math.abs(y - sy);
        selectionRectRef.current = { x: rx, y: ry, w: rw, h: rh };
        selectionByKeyRef.current[connId] = selectionRectRef.current;
        channelRef.current?.send({ type: 'broadcast', event: 'selection-update', payload: { key: connId, x: rx, y: ry, w: rw, h: rh } });
      }
      if (tool === "eraser" && currentStrokeRef.current && currentStrokeRef.current.mode === 'erase') {
        currentStrokeRef.current.points.push({ x, y });
        channel.send({ type: 'broadcast', event: 'stroke-append', payload: { id: currentStrokeRef.current.id, point: { x, y } } });
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
        const currentColor = toolByKeyRef.current[connId]?.color || color;
        const currentWidth = brushWidthRef.current;
        const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x, y }], color: currentColor, width: currentWidth, userId: self?.id || connId };
        currentStrokeRef.current = stroke;
        strokesRef.current = [...strokesRef.current, stroke];
      } else if (tool === "select") {
        selectionActiveRef.current = true;
        selectionStartRef.current = { x, y };
        selectionRectRef.current = { x, y, w: 0, h: 0 };
        selectionByKeyRef.current[connId] = selectionRectRef.current;
        channelRef.current?.send({ type: 'broadcast', event: 'selection-start', payload: { key: connId, x, y } });
      } else if (tool === "eraser") {
        const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x, y }], color: '#000', width: 48, userId: self?.id || connId, mode: 'erase' };
        currentStrokeRef.current = stroke;
        strokesRef.current = [...strokesRef.current, stroke];
        channel.send({ type: 'broadcast', event: 'stroke-start', payload: stroke });
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
      if ((tool === "pen" || tool === 'eraser') && currentStrokeRef.current) {
        channel.send({ type: "broadcast", event: "stroke-end", payload: { id: currentStrokeRef.current.id } });
        currentStrokeRef.current = null;
      }
      if (tool === 'select' && selectionActiveRef.current) {
        selectionActiveRef.current = false;
        selectionStartRef.current = null;
        channelRef.current?.send({ type: 'broadcast', event: 'selection-end', payload: { key: connId } });
        if (selectionRectRef.current) setShowGenerate(true);
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
      const idx = strokesRef.current.findIndex((s) => s.id === stroke.id);
      if (idx === -1) {
        strokesRef.current = [...strokesRef.current, stroke];
      } else {
        strokesRef.current[idx] = stroke;
      }
    });

    channel.on("broadcast", { event: "stroke-start" }, ({ payload }) => {
      const s = payload as Stroke;
      strokesRef.current = [...strokesRef.current, { ...s }];
      activeStrokeIndexByIdRef.current[s.id] = strokesRef.current.length - 1;
    });

    channel.on("broadcast", { event: "stroke-append" }, ({ payload }) => {
      const { id, point } = payload as { id: string; point: Point };
      const idx = activeStrokeIndexByIdRef.current[id];
      if (idx == null) return;
      const s = strokesRef.current[idx];
      if (!s) return;
      s.points.push(point);
    });

    channel.on("broadcast", { event: "stroke-end" }, ({ payload }) => {
      const { id } = payload as { id: string };
      delete activeStrokeIndexByIdRef.current[id];
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

    channel.on("broadcast", { event: "gesture" }, ({ payload }) => {
      const { key, emoji } = payload as { key: string; emoji: string };
      gestureByKeyRef.current[key] = emoji;
    });
    channel.on("broadcast", { event: "tool" }, ({ payload }) => {
      const { key, tool, color } = payload as { key: string; tool: 'cursor' | 'pen' | 'eraser'; color: string };
      toolByKeyRef.current[key] = { tool, color };
    });
    channel.on("broadcast", { event: "selection-start" }, ({ payload }) => {
      const { key, x, y } = payload as { key: string; x: number; y: number };
      selectionByKeyRef.current[key] = { x, y, w: 0, h: 0 };
    });
    channel.on("broadcast", { event: "selection-update" }, ({ payload }) => {
      const { key, x, y, w, h } = payload as { key: string; x: number; y: number; w: number; h: number };
      selectionByKeyRef.current[key] = { x, y, w, h };
    });
    channel.on("broadcast", { event: "selection-end" }, ({ payload }) => {
      const { key } = payload as { key: string };
      selectionByKeyRef.current[key] = null;
    });

    // (RPS handlers removed)

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
      // Cleanup ElevenLabs on unmount
      if (conversationRef.current) {
        conversationRef.current.endSession().catch(() => {});
      }
    };
  }, [slug, self, color, tool, connId]);

  return (
    <main className="min-h-screen">
      <div className="fixed inset-0">
        <canvas ref={canvasRef} className="w-full h-full block cursor-none" />
        <video ref={videoRef} className="hidden" playsInline muted />
      </div>
      {showGenerate && selectionRectRef.current && (
        <div className="fixed z-20" style={{ left: selectionRectRef.current.x + selectionRectRef.current.w + 8, top: selectionRectRef.current.y }}>
          <button
            disabled={generating}
            onClick={async () => {
              if (!selectionRectRef.current) return;
              try {
                setGenerating(true);
                const prompt = 'Using the selected child-like sketch as reference, generate an abstract painting in a contemporary style. Preserve the composition and gesture; amplify shapes and rhythm; use a rich, vibrant color palette; painterly brush strokes; textured canvas look; high quality; avoid photorealism; keep abstraction and child-like spontaneity.';
                // Crop selection from the canvas (respect DPR), with solid background to avoid transparent->black previews
                const rect = selectionRectRef.current;
                const canvas = canvasRef.current!;
                const dpr = Math.max(1, window.devicePixelRatio || 1);
                const src = document.createElement('canvas');
                const sctx = src.getContext('2d')!;
                const sw = Math.max(1, Math.floor(rect.w * dpr));
                const sh = Math.max(1, Math.floor(rect.h * dpr));
                src.width = sw;
                src.height = sh;
                // Optional: paint a white background to prevent viewer black background for transparent areas
                sctx.fillStyle = '#ffffff';
                sctx.fillRect(0, 0, sw, sh);
                // drawImage: sx,sy in device pixels
                sctx.drawImage(
                  canvas,
                  Math.floor(rect.x * dpr),
                  Math.floor(rect.y * dpr),
                  sw,
                  sh,
                  0,
                  0,
                  sw,
                  sh
                );
                // Downscale to 512x512 for faster i2i
                const sized = document.createElement('canvas');
                const szctx = sized.getContext('2d')!;
                sized.width = 512; sized.height = 512;
                szctx.imageSmoothingEnabled = true;
                szctx.imageSmoothingQuality = 'high';
                szctx.drawImage(src, 0, 0, sized.width, sized.height);
                const dataUrl = sized.toDataURL('image/png');
                await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl, contentType: 'image/png' }) });
                type FalGenResult = { data?: { images?: Array<{ url: string }> }; images?: Array<{ url: string }> };
                // Prefer image-to-image nano-banana edit with inline base64
                console.log('[FAL] Calling fal-ai/nano-banana/edit...');
                const result = await fal.subscribe('fal-ai/nano-banana/edit', {
                  input: { prompt, image_urls: [dataUrl], sync_mode: true },
                  pollInterval: 1500,
                  logs: false,
                }) as FalGenResult;
                console.log('[FAL] Result:', result);
                const url = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
                console.log('[FAL] Image URL:', url);
                if (!url) {
                  console.error('[FAL] No image URL returned');
                  return;
                }
                // Create image item and load it
                const item: ImageItem = { id: crypto.randomUUID(), url, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
                console.log('[FAL] Loading image item:', item);
                const loaded = await loadImageItem(item);
                console.log('[FAL] Image loaded:', loaded, 'img:', loaded.img, 'img.complete:', loaded.img?.complete, 'img.width:', loaded.img?.width, 'img.height:', loaded.img?.height);
                imagesRef.current = [...imagesRef.current, loaded];
                console.log('[FAL] Added to imagesRef, total images:', imagesRef.current.length);
                channelRef.current?.send({ type: 'broadcast', event: 'image-add', payload: item });
                // Clear local selection overlay after successful placement
                selectionByKeyRef.current[connId] = null;
                selectionRectRef.current = null;
                setShowGenerate(false);
              } finally {
                setGenerating(false);
              }
            }}
            className="px-2 py-1 rounded-md text-xs border border-gray-200 bg-white shadow"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      )}
      
      {/* Gesture Guide - Bottom Right */}
      <div className="fixed bottom-4 right-4 z-10 max-w-xs">
        <div className="rounded-xl border border-gray-200 bg-white/95 backdrop-blur shadow-lg">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Hand className="w-4 h-4" />
              Gesture Controls
            </h3>
          </div>
          <div className="p-3 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-lg">☝️</span>
              <span className="text-gray-700">Point to draw</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">✋</span>
              <span className="text-gray-700">Palm to erase</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">✌️</span>
              <span className="text-gray-700">Victory to select</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">👍</span>
              <span className="text-gray-700">Thumbs up for voice</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">👎</span>
              <span className="text-gray-700">Thumbs down to stop</span>
            </div>
          </div>
          {handAndGesturesEnabled && (
            <div className="px-3 pb-3">
              <div className="text-xs text-green-700 bg-green-50 rounded-md px-2 py-1.5 border border-green-200">
                ✓ Magic Mode Active
              </div>
            </div>
          )}
          {elevenLabsActive && (
            <div className="px-3 pb-3">
              <div className="text-xs text-red-700 bg-red-50 rounded-md px-2 py-1.5 border border-red-200 flex items-center gap-1.5">
                <Mic className="w-3 h-3" />
                Voice Assistant Active
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-10 w-[min(720px,92vw)]">
        <div className="rounded-xl border border-gray-200 bg-white/90 backdrop-blur px-4 py-2 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <ShareLink url={shareUrl} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  // Unified toggle: both Hand + Gestures
                  if (handEnabledRef.current || gesturesEnabledRef.current) {
                    handEnabledRef.current = false;
                    gesturesEnabledRef.current = false;
                    setHandAndGesturesEnabled(false);
                    // Stop ElevenLabs if active
                    if (elevenLabsEnabledRef.current) {
                      stopElevenLabs();
                    }
                    if (streamRef.current) {
                      streamRef.current.getTracks().forEach((t) => t.stop());
                      streamRef.current = null;
                    }
                    if (detectorRef.current && typeof detectorRef.current.close === 'function') {
                      try { detectorRef.current.close(); } catch {}
                    }
                    detectorRef.current = null;
                    if (gestureDetectorRef.current && typeof gestureDetectorRef.current.close === 'function') {
                      try { gestureDetectorRef.current.close(); } catch {}
                    }
                    gestureDetectorRef.current = null;
                    if (originalConsoleInfoRef.current) { console.info = originalConsoleInfoRef.current; originalConsoleInfoRef.current = null; }
                    if (originalConsoleLogRef.current) { console.log = originalConsoleLogRef.current; originalConsoleLogRef.current = null; }
                    return;
                  }
                  try {
                    if (!originalConsoleInfoRef.current) {
                      originalConsoleInfoRef.current = console.info;
                      console.info = (...args: unknown[]) => {
                        const first = args?.[0];
                        if (typeof first === 'string' && first.includes('TensorFlow Lite XNNPACK delegate')) return;
                        return originalConsoleInfoRef.current?.apply(console, args);
                      };
                    }
                    if (!originalConsoleLogRef.current) {
                      originalConsoleLogRef.current = console.log;
                      console.log = (...args: unknown[]) => {
                        const first = args?.[0];
                        if (typeof first === 'string' && first.includes('TensorFlow Lite XNNPACK delegate')) return;
                        return originalConsoleLogRef.current?.apply(console, args);
                      };
                    }
                    // also suppress console.error for the same noisy Mediapipe info line
                    if (!originalConsoleErrorRef.current) {
                      originalConsoleErrorRef.current = console.error;
                      console.error = (...args: unknown[]) => {
                        const first = args?.[0];
                        if (typeof first === 'string' && first.includes('TensorFlow Lite XNNPACK delegate')) return;
                        return originalConsoleErrorRef.current?.apply(console, args);
                      };
                    }
                    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
                    const video = videoRef.current!;
                    video.srcObject = stream;
                    await video.play();
                    streamRef.current = stream;
                    detectorRef.current = await createHandDetector();
                    gestureDetectorRef.current = await createGestureRecognizer();
                    handEnabledRef.current = true;
                    gesturesEnabledRef.current = true;
                    setHandAndGesturesEnabled(true);
                    const rafLoop = () => {
                      if (!handEnabledRef.current) return;
                      const canvas = canvasRef.current;
                      const channel = channelRef.current;
                      if (!canvas || !channel) return;
                      if (
                        video.paused ||
                        video.ended ||
                        video.readyState < 2 ||
                        video.videoWidth === 0 ||
                        video.videoHeight === 0 ||
                        !detectorRef.current?.detectForVideo
                      ) {
                        requestAnimationFrame(rafLoop);
                        return;
                      }
                      const rect = canvas.getBoundingClientRect();
                      let ts = performance.now();
                      if (ts <= lastDetectTsRef.current) ts = lastDetectTsRef.current + 1;
                      lastDetectTsRef.current = ts;
                      try {
                        const handsRes = detectorRef.current.detectForVideo(video, ts);
                        const tip = handsRes?.landmarks?.[0]?.[8];
                        if (tip) {
                          const x = (1 - tip.x) * rect.width;
                          const y = tip.y * rect.height;
                          cursors.current[connId] = { x, y, t: ts };
                          channel.send({ type: "broadcast", event: "cursor", payload: { key: connId, x, y } });
                        }
                        if (gestureDetectorRef.current?.recognizeForVideo) {
                          const gRes = gestureDetectorRef.current.recognizeForVideo(video, ts);
                          const top = gRes?.gestures?.[0]?.[0];
                          const name = top?.categoryName as string | undefined;
                          const emoji = name ? gestureMap[name] : undefined;
                          if (emoji && emoji !== currentGestureEmojiRef.current) {
                            currentGestureEmojiRef.current = emoji;
                            channel.send({ type: "broadcast", event: "gesture", payload: { key: connId, emoji } });
                            gestureByKeyRef.current[connId] = emoji;
                          }
                          
                          // ElevenLabs activation via Thumb gestures (with debouncing)
                          if (name === 'Thumb_Up' && !elevenLabsEnabledRef.current) {
                            const now = performance.now();
                            if (now - lastThumbGestureRef.current > 1000) {
                              lastThumbGestureRef.current = now;
                              startElevenLabs();
                            }
                          } else if (name === 'Thumb_Down' && elevenLabsEnabledRef.current) {
                            const now = performance.now();
                            if (now - lastThumbGestureRef.current > 1000) {
                              lastThumbGestureRef.current = now;
                              stopElevenLabs();
                            }
                          }
                          
                          // Gesture-to-tool mapping (broadcast tool state)
                          if (!currentStrokeRef.current && name) {
                            const currentColor = toolByKeyRef.current[connId]?.color || color;
                            if (name === 'Pointing_Up' && tool !== 'pen') {
                              setTool('pen');
                              toolByKeyRef.current[connId] = { tool: 'pen', color: currentColor };
                              channel.send({ type: 'broadcast', event: 'tool', payload: { key: connId, tool: 'pen', color: currentColor } });
                            } else if (name === 'Open_Palm' && tool !== 'eraser') {
                              setTool('eraser');
                              toolByKeyRef.current[connId] = { tool: 'eraser', color: currentColor };
                              channel.send({ type: 'broadcast', event: 'tool', payload: { key: connId, tool: 'eraser', color: currentColor } });
                            }
                          }

                          // Hand-driven drawing/erasing
                          if (tip && name === 'Pointing_Up') {
                            const hx = (1 - tip.x) * rect.width;
                            const hy = tip.y * rect.height;
                            if (!gestureStrokeActiveRef.current && !currentStrokeRef.current) {
                              const currentColor = toolByKeyRef.current[connId]?.color || color;
                              const currentWidth = brushWidthRef.current;
                              const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x: hx, y: hy }], color: currentColor, width: currentWidth, userId: self?.id || connId };
                              currentStrokeRef.current = stroke;
                              strokesRef.current = [...strokesRef.current, stroke];
                              channel.send({ type: 'broadcast', event: 'stroke-start', payload: stroke });
                              gestureStrokeActiveRef.current = true;
                            } else if (currentStrokeRef.current) {
                              currentStrokeRef.current.points.push({ x: hx, y: hy });
                              channel.send({ type: 'broadcast', event: 'stroke-append', payload: { id: currentStrokeRef.current.id, point: { x: hx, y: hy } } });
                            }
                          } else if (gestureStrokeActiveRef.current && currentStrokeRef.current) {
                            channel.send({ type: 'broadcast', event: 'stroke-end', payload: { id: currentStrokeRef.current.id } });
                            currentStrokeRef.current = null;
                            gestureStrokeActiveRef.current = false;
                          }

                          if (tip && name === 'Open_Palm') {
                            const hx = (1 - tip.x) * rect.width;
                            const hy = tip.y * rect.height;
                            // gesture-based erase stroke (destination-out)
                            if (!currentStrokeRef.current || currentStrokeRef.current.mode !== 'erase') {
                              const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x: hx, y: hy }], color: '#000', width: 48, userId: self?.id || connId, mode: 'erase' };
                              currentStrokeRef.current = stroke;
                              strokesRef.current = [...strokesRef.current, stroke];
                              channel.send({ type: 'broadcast', event: 'stroke-start', payload: stroke });
                            } else {
                              currentStrokeRef.current.points.push({ x: hx, y: hy });
                              channel.send({ type: 'broadcast', event: 'stroke-append', payload: { id: currentStrokeRef.current.id, point: { x: hx, y: hy } } });
                            }
                          } else if (currentStrokeRef.current && currentStrokeRef.current.mode === 'erase') {
                            channel.send({ type: 'broadcast', event: 'stroke-end', payload: { id: currentStrokeRef.current.id } });
                            currentStrokeRef.current = null;
                          }
                          // Selection (Victory)
                          if (tip && name === 'Victory') {
                            const hx = (1 - tip.x) * rect.width;
                            const hy = tip.y * rect.height;
                            if (!selectionActiveRef.current) {
                              selectionActiveRef.current = true;
                              selectionStartRef.current = { x: hx, y: hy };
                              selectionRectRef.current = { x: hx, y: hy, w: 0, h: 0 };
                              channel.send({ type: 'broadcast', event: 'selection-start', payload: { key: connId, x: hx, y: hy } });
                            } else if (selectionStartRef.current) {
                              const sx = selectionStartRef.current.x;
                              const sy = selectionStartRef.current.y;
                              const rx = Math.min(sx, hx);
                              const ry = Math.min(sy, hy);
                              const rw = Math.abs(hx - sx);
                              const rh = Math.abs(hy - sy);
                              selectionRectRef.current = { x: rx, y: ry, w: rw, h: rh };
                              selectionByKeyRef.current[connId] = selectionRectRef.current;
                              channel.send({ type: 'broadcast', event: 'selection-update', payload: { key: connId, x: rx, y: ry, w: rw, h: rh } });
                            }
                          } else if (selectionActiveRef.current) {
                            selectionActiveRef.current = false;
                            selectionStartRef.current = null;
                            channel.send({ type: 'broadcast', event: 'selection-end', payload: { key: connId } });
                            // Show generate button for local selection
                            if (selectionRectRef.current) setShowGenerate(true);
                          }
                        }
                      } catch {}
                      requestAnimationFrame(rafLoop);
                    };
                    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                      const rvc = (video as { requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => void }).requestVideoFrameCallback.bind(video);
                      const onFrame = (_now: number, meta: { mediaTime?: number }) => {
                        if (!handEnabledRef.current) return;
                        const canvas = canvasRef.current;
                        const channel = channelRef.current;
                        if (!canvas || !channel) return;
                        const rect = canvas.getBoundingClientRect();
                        let ts = Math.max((meta?.mediaTime || 0) * 1000, performance.now());
                        if (ts <= lastDetectTsRef.current) ts = lastDetectTsRef.current + 1;
                        lastDetectTsRef.current = ts;
                        try {
                          if (!detectorRef.current?.detectForVideo) { rvc(onFrame); return; }
                          const handsRes = detectorRef.current.detectForVideo(video, ts);
                          const tip = handsRes?.landmarks?.[0]?.[8];
                          if (tip) {
                            const x = (1 - tip.x) * rect.width;
                            const y = tip.y * rect.height;
                            cursors.current[connId] = { x, y, t: ts };
                            channel.send({ type: "broadcast", event: "cursor", payload: { key: connId, x, y } });
                          }
                          if (gestureDetectorRef.current?.recognizeForVideo) {
                            const gRes = gestureDetectorRef.current.recognizeForVideo(video, ts);
                            const top = gRes?.gestures?.[0]?.[0];
                            const name = top?.categoryName as string | undefined;
                            const emoji = name ? gestureMap[name] : undefined;
                            if (emoji && emoji !== currentGestureEmojiRef.current) {
                              currentGestureEmojiRef.current = emoji;
                              channel.send({ type: "broadcast", event: "gesture", payload: { key: connId, emoji } });
                              gestureByKeyRef.current[connId] = emoji;
                            }
                            
                            // ElevenLabs activation via Thumb gestures (with debouncing)
                            if (name === 'Thumb_Up' && !elevenLabsEnabledRef.current) {
                              const now = performance.now();
                              if (now - lastThumbGestureRef.current > 1000) {
                                lastThumbGestureRef.current = now;
                                startElevenLabs();
                              }
                            } else if (name === 'Thumb_Down' && elevenLabsEnabledRef.current) {
                              const now = performance.now();
                              if (now - lastThumbGestureRef.current > 1000) {
                                lastThumbGestureRef.current = now;
                                stopElevenLabs();
                              }
                            }
                            
                            if (!currentStrokeRef.current && name) {
                              const currentColor = toolByKeyRef.current[connId]?.color || color;
                              if (name === 'Pointing_Up' && tool !== 'pen') {
                                setTool('pen');
                                toolByKeyRef.current[connId] = { tool: 'pen', color: currentColor };
                                channel.send({ type: 'broadcast', event: 'tool', payload: { key: connId, tool: 'pen', color: currentColor } });
                              } else if (name === 'Open_Palm' && tool !== 'eraser') {
                                setTool('eraser');
                                toolByKeyRef.current[connId] = { tool: 'eraser', color: currentColor };
                                channel.send({ type: 'broadcast', event: 'tool', payload: { key: connId, tool: 'eraser', color: currentColor } });
                              }
                            }

                            if (tip && name === 'Pointing_Up') {
                              const hx = (1 - tip.x) * rect.width;
                              const hy = tip.y * rect.height;
                              if (!gestureStrokeActiveRef.current && !currentStrokeRef.current) {
                                const currentColor = toolByKeyRef.current[connId]?.color || color;
                                const currentWidth = brushWidthRef.current;
                                const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x: hx, y: hy }], color: currentColor, width: currentWidth, userId: self?.id || connId };
                                currentStrokeRef.current = stroke;
                                strokesRef.current = [...strokesRef.current, stroke];
                                channel.send({ type: 'broadcast', event: 'stroke-start', payload: stroke });
                                gestureStrokeActiveRef.current = true;
                              } else if (currentStrokeRef.current) {
                                currentStrokeRef.current.points.push({ x: hx, y: hy });
                                channel.send({ type: 'broadcast', event: 'stroke-append', payload: { id: currentStrokeRef.current.id, point: { x: hx, y: hy } } });
                              }
                            } else if (gestureStrokeActiveRef.current && currentStrokeRef.current) {
                              channel.send({ type: 'broadcast', event: 'stroke-end', payload: { id: currentStrokeRef.current.id } });
                              currentStrokeRef.current = null;
                              gestureStrokeActiveRef.current = false;
                            }

                            if (tip && name === 'Open_Palm') {
                              const hx = (1 - tip.x) * rect.width;
                              const hy = tip.y * rect.height;
                              if (!currentStrokeRef.current || currentStrokeRef.current.mode !== 'erase') {
                                const stroke: Stroke = { id: crypto.randomUUID(), points: [{ x: hx, y: hy }], color: '#000', width: 48, userId: self?.id || connId, mode: 'erase' };
                                currentStrokeRef.current = stroke;
                                strokesRef.current = [...strokesRef.current, stroke];
                                channel.send({ type: 'broadcast', event: 'stroke-start', payload: stroke });
                              } else {
                                currentStrokeRef.current.points.push({ x: hx, y: hy });
                                channel.send({ type: 'broadcast', event: 'stroke-append', payload: { id: currentStrokeRef.current.id, point: { x: hx, y: hy } } });
                              }
                            } else if (currentStrokeRef.current && currentStrokeRef.current.mode === 'erase') {
                              channel.send({ type: 'broadcast', event: 'stroke-end', payload: { id: currentStrokeRef.current.id } });
                              currentStrokeRef.current = null;
                            }
                            if (tip && name === 'Victory') {
                              const hx = (1 - tip.x) * rect.width;
                              const hy = tip.y * rect.height;
                              if (!selectionActiveRef.current) {
                                selectionActiveRef.current = true;
                                selectionStartRef.current = { x: hx, y: hy };
                                selectionRectRef.current = { x: hx, y: hy, w: 0, h: 0 };
                                channel.send({ type: 'broadcast', event: 'selection-start', payload: { key: connId, x: hx, y: hy } });
                              } else if (selectionStartRef.current) {
                                const sx = selectionStartRef.current.x;
                                const sy = selectionStartRef.current.y;
                                const rx = Math.min(sx, hx);
                                const ry = Math.min(sy, hy);
                                const rw = Math.abs(hx - sx);
                                const rh = Math.abs(hy - sy);
                                selectionRectRef.current = { x: rx, y: ry, w: rw, h: rh };
                                selectionByKeyRef.current[connId] = selectionRectRef.current;
                                channel.send({ type: 'broadcast', event: 'selection-update', payload: { key: connId, x: rx, y: ry, w: rw, h: rh } });
                              }
                            } else if (selectionActiveRef.current) {
                              selectionActiveRef.current = false;
                              selectionStartRef.current = null;
                              channel.send({ type: 'broadcast', event: 'selection-end', payload: { key: connId } });
                              if (selectionRectRef.current) setShowGenerate(true);
                            }
                          }
                        } catch {}
                        rvc(onFrame);
                      };
                      rvc(onFrame);
                    } else {
                      requestAnimationFrame(rafLoop);
                    }
                  } catch (e) {
                    console.warn("Hand control failed:", e);
                    handEnabledRef.current = false;
                  }
                }}
                className={`p-2.5 rounded-md text-sm border flex items-center justify-center ${handAndGesturesEnabled ? 'bg-black text-white border-black' : 'border-gray-200'}`}
                title="Magic Mode (Hand Gestures)"
              >
                <Hand className="w-5 h-5 mr-2" /> Magic Mode
              </button>
              {elevenLabsActive && (
                <button
                  className="p-2.5 rounded-md border border-red-300 bg-red-50 flex items-center justify-center"
                  title="Voice Active"
                >
                  <Mic className="w-5 h-5 text-red-600 animate-pulse" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* RPS overlay removed */}
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

async function loadImageItem(item: ImageItem, sourceOverride?: string): Promise<ImageItem> {
  return new Promise((resolve) => {
    const src = sourceOverride || item.url;
    const isBlobOrData = src.startsWith('blob:') || src.startsWith('data:');
    const tryLoad = (withCORS: boolean) => {
      const img = new Image();
      if (withCORS && !isBlobOrData) img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ ...item, img });
      img.onerror = () => {
        if (withCORS) tryLoad(false);
        else resolve(item);
      };
      img.src = src;
    };
    tryLoad(true);
  });
}


