// The user's name (Settings › Account, state.settings.userName); "user" when unset.
export const userName = (s) => s?.settings?.userName?.trim() || "user";
