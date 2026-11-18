// Default writing guide. Rou writes drafts by it (shared/voice.mjs voiceBlock). Change this file, or give Rou your own
// guide in chat (set_guide: state.writingGuide).
export const EDITORIAL_RULES = `# General writing style

Write in natural, fluent, short, clear language (in the language the post is written in). It should read like neither a corporate press release nor marketing copy.

- Say the main point in the first sentence.
- Give concrete detail: what was done, what changed, where it is used.
- No hype or cliches: revolutionary, game-changing, incredible, we are excited to announce.
- Short paragraphs; each paragraph carries new information, never say the same thing twice.
- Mix sentence lengths; split a sentence that runs long.
- Do not lecture the reader or tell them what to feel.
- No em dashes (—).
- Add no number, name, result or event that is not in the source.
- Stop where it should end: no forced closing, no contrived question, no call to engage.

Give only the final text. Add no explanation, analysis or alternative version unless the user asks.`;

export const DETAILED_GUIDE = "";

// The draft writer sees this.
export const WRITING_GUIDE = EDITORIAL_RULES;

// If the user gives a guide to Rou in chat (set_guide), state.writingGuide.text overrides the code; when empty, the guide in this file applies.
export const guideOf = (s) => (typeof s?.writingGuide?.text === "string" && s.writingGuide.text.trim()) || WRITING_GUIDE;
