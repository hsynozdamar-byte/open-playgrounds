import { WRITING_GUIDE } from "./guide.mjs";

// Rou'nun yazı sesi. Hesabın tarzı notu ve marka kuralı bunun üstündedir.
export const VOICE = [
  "İlk cümle gönderinin konusunu ya da asıl fikrini doğrudan söyler. Uzun giriş ve bağlam hazırlığı yok.",
  "Her paragraf yeni bir bilgi taşır; önceki cümleyi başka kelimelerle tekrar etme.",
  "Somut yaz: ne yapıldı, ne değişti, nerede kullanıldı. Soyut değerlendirme yerine gerçek ayrıntı.",
  "Kapanış tek bir doğal düşünce; slogan, etkileşim çağrısı ya da yapay soru yok.",
  "Dolgu ve savunan kalıplar yok: 'açıkçası', 'yani', 'aslında', 'özetle'.",
  "Abartma: devrim, dönüm noktası, oyun değiştirici yok. Plan ve hedefi gerçekleşmiş gibi yazma.",
  "Yok: madde işaretli liste, emoji, ünlem yağmuru, 'Bu bir X değil, bir Y' kalıbı, uydurma alıntı.",
].join("\n");

// Kişisel hesaplar için ton örnekleri; boşsa yalnız kurallar ve projenin onaylı örneği geçerli.
export const VOICE_SAMPLES = [];

// Ana ses: rehber ve ek kurallardan önce gelir, çelişirse bu kazanır.
export const VOICE_CORE = [
  "Direkt konuya gir. Uzun giriş, bağlam hazırlığı ve gereksiz açıklama yok.",
  "Açık yaz: konuyu hiç bilmeyen biri ilk okumada ne olduğunu anlasın. Ürünü ilk geçtiği yerde yarım cümleyle tanıt; iç terim ve kod adı açıklamadan geçmez.",
  "Kişisel hesapta ben dili; edilgen cümleden kaçın.",
  "Konuşur gibi yaz, yapay samimiyet yok.",
  "Teknik terimi zorlama: AI, app, UI, prototype Türkçeleştirilmek zorunda değil.",
  "Bir fikir, birkaç kısa cümle. Aynı şeyi iki kez anlatmak yok.",
  "Süreçten konuş: ne yaptın, neyle karşılaştın, nasıl çözdün.",
  "Fikrini söyle, ders verme.",
  "Abartı yok: devrim niteliğinde, oyun değiştirici, inanılmaz deneyim.",
  "Bitmesi gereken yerde bitir. Zorunlu sonuç paragrafı ve etkileşim çağrısı yok.",
].join("\n");
export const LENGTH = [
  "X: 60-240 karakter, genelde 1-3 cümle.",
  "Threads: 150-400 karakter, en çok 2 kısa paragraf.",
  "LinkedIn: 250-650 karakter, 3-5 kısa paragraf; iki dilli gönderide her dil ayrı.",
  "Instagram açıklaması: 120-350 karakter, 2-4 cümle; gerekirse tek CTA ve az hashtag.",
  "Bunlar hedef aralık; tek cümle yetiyorsa uzatma. Kurumsal hesaplar kendi sesinde kalır ama yine bu uzunlukta.",
].join("\n");

// İngilizce hesaplar (account.lang en ya da tr+en'in İngilizce yarısı): aynı ana ses, İngilizcenin doğal karşılığıyla.
export const VOICE_CORE_EN = [
  "Get to the point in the first line. No warm-up, no context-setting.",
  "Be clear: someone who has never heard of the product should get it on first read. Introduce the app or game in half a sentence the first time; no unexplained internal names.",
  "First person on personal accounts: I designed, I tried, I shipped. Active voice.",
  "Write like you talk, plain everyday English. Short sentences, contractions are fine. Not a translation from Turkish.",
  "Talk about the process: what you made, what went wrong, how you fixed it. No design philosophy, no lessons for the reader.",
  "No hype or LinkedIn phrases: game-changer, excited to announce, here's the thing, let's dive in, the best part.",
  "Stop when it's done. No wrap-up line, no question for engagement, no call to action unless the format asks for one.",
].join("\n");

// Önce ana ses ve uzunluk, sonra yazım rehberi ve eski ek kurallar (ayrıntı için); çelişirse ana ses kazanır (özellikle uzunluk ve paragraf sayısı).
export const voiceBlock = (guide = WRITING_GUIDE, lang) => `ANA SES (en önemli; aşağıdakilerle çelişirse bu geçerli, özellikle uzunlukta):\n${VOICE_CORE}${lang === "en" || lang === "tr+en" ? `\n\nİngilizce metin için aynı ses (${lang === "en" ? "bu hesap İngilizce" : "iki dilli metnin İngilizce yarısı"}):\n${VOICE_CORE_EN}` : ""}\n\nUZUNLUK:\n${LENGTH}${VOICE_SAMPLES.length ? `\n\nKullanıcının kendi yazısından örnekler (tonu al, cümleleri kopyalama):\n${VOICE_SAMPLES.map((x) => `"""${x}"""`).join("\n")}` : ""}\n\nAyrıntılı rehber (ana sesle çelişen yerlerde, ör. "3-4 paragraf", ana ses geçerli):\n"""\n${guide}\n"""\n\nEski ek kurallar (aynı şekilde):\n${VOICE}`;
