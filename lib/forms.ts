export function textValue(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

export function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

export function nullableText(formData: FormData, key: string) {
  const value = textValue(formData, key);
  return value.length > 0 ? value : null;
}

export function nullableNumber(formData: FormData, key: string) {
  const raw = textValue(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function fileValue(formData: FormData, key: string) {
  const file = formData.get(key);
  return file instanceof File && file.size > 0 ? file : null;
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
