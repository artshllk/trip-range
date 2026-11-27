/** Bounded integer control. Out-of-range values are unrepresentable: buttons stop at the bounds. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const clamped = Math.min(max, Math.max(min, value));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <b aria-hidden="true">{label}</b>
      <button
        type="button"
        aria-label={`− ${label}`}
        disabled={clamped <= min}
        onClick={() => onChange(Math.max(min, clamped - 1))}
      >
        −
      </button>
      <output aria-live="polite">{clamped}</output>
      <button
        type="button"
        aria-label={`+ ${label}`}
        disabled={clamped >= max}
        onClick={() => onChange(Math.min(max, clamped + 1))}
      >
        +
      </button>
    </div>
  );
}
