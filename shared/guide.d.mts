export const EDITORIAL_RULES: string;
export const DETAILED_GUIDE: string;
export const WRITING_GUIDE: string;
export function guideOf(s: { writingGuide?: { text?: string } } | null | undefined): string;
