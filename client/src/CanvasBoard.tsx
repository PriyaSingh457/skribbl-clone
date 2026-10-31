import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Socket } from 'socket.io-client';
import type { Point, Stroke } from './types';

type Props = { socket: Socket; strokes: Stroke[]; canDraw: boolean };
const COLORS = ['#172033', '#e5484d', '#ff922b', '#f3c623', '#2f9e44', '#0ca678', '#15aabf', '#1971c2', '#7048e8', '#d6336c', '#ffffff'];

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, points = stroke.points) {
  if (!points?.length) return;
  context.save();
  context.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x * width, points[0].y * height, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(points[0].x * width, points[0].y * height);
    for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x * width, points[i].y * height);
    context.stroke();
  }
  context.restore();
}

export default function CanvasBoard({ socket, strokes, canDraw }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<{ id: string; color: string; size: number; eraser: boolean; last: Point } | null>(null);
  const liveStrokesRef = useRef<Map<string, Stroke>>(new Map());
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(5);
  const [eraser, setEraser] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(800);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const context = canvas.getContext('2d');
    if (context) context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return context;
  }, []);

  const redraw = useCallback((source: Stroke[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const context = getContext();
    if (!context) return;
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
    for (const stroke of source) drawStroke(context, stroke, rect.width, rect.height);
  }, [getContext]);

  useEffect(() => {
    liveStrokesRef.current = new Map(strokes.map((stroke) => [stroke.id, { ...stroke, points: [...stroke.points] }]));
    redraw(strokes);
  }, [redraw, strokes]);

  useEffect(() => {
    const onStarted = ({ stroke }: { stroke: Stroke }) => {
      liveStrokesRef.current.set(stroke.id, { ...stroke, points: [] });
    };
    const onPoints = ({ id, points }: { id: string; points: Point[] }) => {
      const canvas = canvasRef.current; const context = getContext();
      const stroke = liveStrokesRef.current.get(id);
      if (!canvas || !context || !stroke) return;
      const rect = canvas.getBoundingClientRect();
      for (const point of points) {
        const prior = stroke.points[stroke.points.length - 1];
        drawStroke(context, stroke, rect.width, rect.height, prior ? [prior, point] : [point]);
        stroke.points.push(point);
      }
    };
    const onFinished = ({ id }: { id: string }) => {
      const stroke = liveStrokesRef.current.get(id);
      if (stroke) stroke.complete = true;
    };
    const onCleared = () => { liveStrokesRef.current.clear(); redraw([]); };
    const onUndone = ({ strokes: newStrokes }: { strokes: Stroke[] }) => {
      liveStrokesRef.current = new Map(newStrokes.map((stroke) => [stroke.id, { ...stroke, points: [...stroke.points] }]));
      redraw(newStrokes);
    };
    socket.on('draw_started', onStarted);
    socket.on('draw_points', onPoints);
    socket.on('canvas_cleared', onCleared);
    socket.on('canvas_undone', onUndone);
    socket.on('draw_finished', onFinished);
    return () => {
      socket.off('draw_started', onStarted);
      socket.off('draw_points', onPoints);
      socket.off('canvas_cleared', onCleared);
      socket.off('canvas_undone', onUndone);
      socket.off('draw_finished', onFinished);
    };
  }, [socket, getContext, redraw]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || activeRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    activeRef.current = { id, color: eraser ? '#ffffff' : color, size: eraser ? Math.min(45, Math.max(18, size * 3)) : size, eraser, last: point };
    socket.emit('draw_begin', { id, color: eraser ? '#ffffff' : color, size: eraser ? Math.min(45, Math.max(18, size * 3)) : size, eraser });
    socket.emit('draw_points', { points: [point] });
    const context = getContext(); const canvas = canvasRef.current;
    if (context && canvas) drawStroke(context, { id, color: eraser ? '#ffffff' : color, size: eraser ? Math.min(45, Math.max(18, size * 3)) : size, eraser, points: [point] }, canvas.clientWidth, canvas.clientHeight);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!canDraw || !active) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const context = getContext(); const canvas = canvasRef.current;
    if (context && canvas) drawStroke(context, { id: active.id, color: active.color, size: active.size, eraser: active.eraser, points: [active.last, point] }, canvas.clientWidth, canvas.clientHeight);
    active.last = point;
    socket.emit('draw_points', { points: [point] });
  };
  const end = (event?: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event) event.preventDefault();
    if (!activeRef.current) return;
    socket.emit('draw_end');
    activeRef.current = null;
  };

  return <div className="canvas-wrap">
    <canvas ref={canvasRef} className={`drawing-canvas ${canDraw ? 'canvas-active' : ''}`} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={(event) => { if (activeRef.current && event.buttons === 0) end(); }} aria-label="Shared drawing canvas" />
    {canDraw && <div className="drawing-toolbar">
      <div className="color-palette" aria-label="Brush colors">{COLORS.map((entry) => <button key={entry} title={entry} className={`color-swatch ${color === entry && !eraser ? 'selected' : ''} ${entry === '#ffffff' ? 'white-swatch' : ''}`} style={{ background: entry }} onClick={() => { setColor(entry); setEraser(false); }} />)}</div>
      <label className="brush-control">Brush <input type="range" min="2" max="18" value={size} onChange={(event) => setSize(Number(event.target.value))} /> <span>{size}px</span></label>
      <button className={`tool-button ${eraser ? 'active' : ''}`} onClick={() => setEraser((value) => !value)}>⌫ Eraser</button>
      <button className="tool-button" onClick={() => socket.emit('draw_undo')}>↶ Undo</button>
      <button className="tool-button danger-tool" onClick={() => socket.emit('canvas_clear')}>Clear</button>
    </div>}
    <div className="canvas-footer"><span>{canDraw ? 'Your turn — draw so others can guess' : 'Watch the drawing and send your guess'}</span><span>{Math.round(canvasWidth)} px</span></div>
  </div>;
}
