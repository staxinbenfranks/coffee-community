"use client";

export default function MoveButtons({
  index, total, disabled, onMove,
}: {
  index: number;
  total: number;
  disabled?: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const button = "flex h-11 w-11 items-center justify-center rounded-lg border border-stone-300 bg-white text-lg leading-none disabled:opacity-30";
  return (
    <div className="flex gap-1">
      <button type="button" aria-label="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)} className={button}>↑</button>
      <button type="button" aria-label="Move down" disabled={disabled || index === total - 1} onClick={() => onMove(1)} className={button}>↓</button>
    </div>
  );
}
