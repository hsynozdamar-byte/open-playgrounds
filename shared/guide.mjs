// Varsayılan yazım rehberi. Rou taslağı buna göre yazar (shared/voice.mjs voiceBlock). Değiştirmek için yalnız bu dosya,
// ya da sohbette Rou'ya kendi rehberini ver (set_guide: state.writingGuide).
export const EDITORIAL_RULES = `# Genel Yazım Dili

Metinleri doğal, akıcı, kısa ve anlaşılır bir Türkçeyle yaz. Ne kurumsal bir basın bülteni ne de pazarlama yazısı gibi görünsün.

- Asıl söylenecek şeyi ilk cümlede söyle.
- Somut ayrıntı ver: ne yapıldı, ne değişti, nerede kullanıldı.
- Abartı ve klişe yok: devrim, oyun değiştirici, inanılmaz, heyecanla duyuruyoruz.
- Kısa paragraflar; her paragraf yeni bir bilgi taşısın, aynı şeyi iki kez söyleme.
- Cümle uzunlukları karışık olsun; uzayan cümleyi ikiye böl.
- Okura ders verme, ne hissetmesi gerektiğini söyleme.
- Uzun tire (—) kullanma.
- Kaynakta olmayan rakam, isim, sonuç ya da olay ekleme.
- Bitmesi gereken yerde bitir: zorunlu kapanış, yapay soru, etkileşim çağrısı yok.

Yalnızca son metni sun. Kullanıcı istemedikçe açıklama, analiz veya alternatif versiyon ekleme.`;

export const DETAILED_GUIDE = "";

// Taslağı yazan bunu görür.
export const WRITING_GUIDE = EDITORIAL_RULES;

// Kullanıcı rehberi sohbette Rou'ya verirse (set_guide) state.writingGuide.text kodu ezer; boşsa bu dosyadaki rehber geçerli.
export const guideOf = (s) => (typeof s?.writingGuide?.text === "string" && s.writingGuide.text.trim()) || WRITING_GUIDE;
