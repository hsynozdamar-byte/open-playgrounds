// Opens the window of a repeating task (automation) from anywhere: project, post window, Automations. The window lives in App (AutoViewHost).
export const openAutoView = (id: string) => dispatchEvent(new CustomEvent("pg-auto-view", { detail: id }));
