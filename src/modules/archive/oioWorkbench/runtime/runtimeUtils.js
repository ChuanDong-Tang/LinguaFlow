export function eventTargetElement(ev) {
  const t = ev?.target;
  return t instanceof Element ? t : t?.parentElement ?? null;
}

export function isTypingField(target, textEl) {
  return (
    target === textEl ||
    target?.classList?.contains("cue-input") ||
    target?.classList?.contains("fb-slot")
  );
}

export function isSpaceReservedControl(target) {
  const tag = target.tagName;
  if (tag === "BUTTON") return true;
  if (tag === "INPUT") {
    const type = target.type;
    return type === "checkbox" || type === "radio" || type === "submit" || type === "file";
  }
  return tag === "SELECT";
}

export function isArrowReservedControl(target) {
  return target.tagName === "SELECT";
}
