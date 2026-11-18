// Tekrarlayan görevin (otomasyonun) penceresini her yerden açar: proje, gönderi penceresi, Otomasyonlar. Pencere App'te (AutoViewHost).
export const openAutoView = (id: string) => dispatchEvent(new CustomEvent("pg-auto-view", { detail: id }));
