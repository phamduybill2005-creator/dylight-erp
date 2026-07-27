"use client";

// Ô CHỌN NGƯỜI phụ trách dự án — dùng chung cho GEO担当 (phía Nhật) và DOSCO担当 (phía Việt).
// Mặc định là DANH SÁCH SỔ XUỐNG đầy đủ (khỏi gõ tay, khỏi nhớ tên).
// Gặp người mới chưa có trong danh sách -> chọn "— Khác (gõ tay) —" để nhập,
// bấm ↩ để quay lại chọn từ danh sách.

import { useState } from "react";

export default function PersonPicker({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  className?: string;
}) {
  const opts = Array.from(
    new Set(options.map((s) => (s || "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "vi"));
  const [manual, setManual] = useState(false);
  const cls =
    className ??
    "w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel";

  // Đang gõ tay, hoặc giá trị sẵn có không nằm trong danh sách -> hiện ô nhập.
  if (manual || (!!value && !opts.includes(value))) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Gõ tên người phụ trách…"
          className={cls}
        />
        <button
          type="button"
          title="Quay lại chọn từ danh sách"
          onClick={() => {
            setManual(false);
            onChange("");
          }}
          className="shrink-0 rounded-xl2 border border-line px-2 py-2 text-[11px] font-semibold text-muted hover:bg-paper hover:text-ink"
        >
          ↩
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === "__manual__") {
          setManual(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
      className={cls}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
      <option value="__manual__">— Khác (gõ tay) —</option>
    </select>
  );
}
