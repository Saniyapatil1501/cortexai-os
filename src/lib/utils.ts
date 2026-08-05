import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseUTCDateTime(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  // Standardize space to T for ISO format
  let cleanStr = dateStr.trim().replace(" ", "T");
  if (!cleanStr.endsWith("Z") && !cleanStr.match(/[+-]\d{2}:?\d{2}$/)) {
    cleanStr = `${cleanStr}Z`;
  }
  const parsed = new Date(cleanStr);
  if (isNaN(parsed.getTime())) {
    const fallbackParsed = new Date(dateStr);
    return isNaN(fallbackParsed.getTime()) ? new Date() : fallbackParsed;
  }
  return parsed;
}
