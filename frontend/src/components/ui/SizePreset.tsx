import { Field } from "./Field";

export function SizePreset({
  value,
  onChange,
}: {
  value: { w: number; h: number };
  onChange: (w: number, h: number) => void;
}) {
  const presets = [
    [1920, 1080, "1080p"],
    [2560, 1440, "1440p"],
    [3840, 2160, "4K"],
    [1080, 1920, "竖屏"],
  ] as const;
  return (
    <>
      <Field label="导出尺寸">
        <select
          value={`${value.w}x${value.h}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split("x").map(Number);
            onChange(w, h);
          }}
        >
          {presets.map(([w, h, label]) => (
            <option value={`${w}x${h}`} key={label}>
              {label} · {w}×{h}
            </option>
          ))}
          <option value={`${value.w}x${value.h}`}>
            自定义 · {value.w}×{value.h}
          </option>
        </select>
      </Field>
      <div className="two-fields">
        <Field label="宽度">
          <input
            type="number"
            min="1"
            max="8192"
            value={value.w}
            onChange={(e) => onChange(Number(e.target.value), value.h)}
          />
        </Field>
        <Field label="高度">
          <input
            type="number"
            min="1"
            max="8192"
            value={value.h}
            onChange={(e) => onChange(value.w, Number(e.target.value))}
          />
        </Field>
      </div>
    </>
  );
}