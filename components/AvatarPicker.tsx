"use client";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

const AVATARS = [
  "😀",
  "😎",
  "🦊",
  "🐼",
  "🐶",
  "🐱",
  "🦄",
  "🐸",
  "🐧",
  "🐨",
  "🐵",
  "🐯",
  "🐰",
  "🐮",
  "🐷",
  "🐹",
];

export default function AvatarPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-8 gap-2">
      {AVATARS.map((a) => (
        <button
          key={a}
          onClick={() => onChange(a)}
          className={`h-10 w-10 rounded-md border flex items-center justify-center text-xl ${
            value === a ? "border-black" : "border-gray-200"
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );
}


