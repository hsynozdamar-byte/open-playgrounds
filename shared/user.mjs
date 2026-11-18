// Kullanıcının adı (Ayarlar › Hesap, state.settings.userName); yoksa "kullanıcı".
export const userName = (s) => s?.settings?.userName?.trim() || "kullanıcı";
