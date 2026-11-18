// Sözlük ve kurallar: docs/PLAN.md §1

// accounts: dünyanın hesapları (paylaşım hesapları ve gelen kaynakları). Projeler bunlardan seçer.
// identity: markanın kimliği (ad yazımı, renk, font, logo dosyaları, tanıtım metni); kit: görsel üretimde kullanılan font, renk, logo (render/src/Footage.tsx Kit).
export type World = { id: string; name: string; color: string; color2?: string; description: string; accounts?: Account[]; identity?: string; kit?: Record<string, unknown>; visual?: string };

export type ProjectStatus = "active" | "paused" | "done";
// ongoing: sürekli proje (deadline yok); ritmi projenin otomasyonlarıdır. accountIds: dünyanın hesaplarından bu projenin kullandıkları. brand: gönderi hazırlarken uyulacak marka çerçevesi.
export type Project = { id: string; worldId: string; name: string; description: string; status: ProjectStatus; deadline: string | null; ongoing?: boolean; accountIds?: string[]; sources?: Source[]; brand?: Brand;
  mediaDir?: string; mediaDirs?: string[]; media?: Record<string, "good" | "bad"> }; // mediaDir: diskteki medya klasörü; media: dosya (klasöre göre yol) → İyi/Kötü
export type Brand = { audience: string; pillars: string[]; use: string; avoid: string; example?: string }; // example: kullanıcının onayladığı hedef metin (shared/social.mjs brandExample)

// Projenin kaynağı: not, yüklenen metin dosyası ya da bağlantı. İçerik veride saklanır (diskteki bir yola bağlı değil).
// use: hazırlatırken Claude'a verilsin mi. Bağlantının içeriği çekilmez; adresi ve notu verilir.
export type SourceKind = "note" | "file" | "link";
export type Source = { id: string; kind: SourceKind; title: string; body: string; url?: string; use: boolean; addedAt: string };

// Rou Chrome'da çalışırken canlı durum (server/live.mjs): hangi Chrome, son sayfa, şu anki adım, son adımlar.
export type Live = { browser: string; url: string; step: string; at: string; log: string[]; waiting?: boolean }; // waiting: Claude in Chrome izin/onay bekliyor
// Hesabın dili: tek dil ya da önce Türkçe, altında İngilizcesi (shared/social.mjs LANGS).
export type Lang = "tr" | "en" | "tr+en";
// Hesap: dünyanın paylaşım yeri ya da gelen kaynağı (shared/social.mjs). voice: kısa tarz notu.
// browser: paylaşımı yapacak Chrome (Claude in Chrome cihaz kimliği); check: o Chrome'da açık hesabın son kontrolü.
export type Platform = "instagram" | "linkedin" | "x" | "threads" | "tiktok" | "youtube" | "other";
export type Feed = "gmail" | "gcal" | "slack" | "clickup";
// login: giriş e-postası ya da kullanıcı adı (yalnız gösterim; şifre saklanmaz).
// Hesap analizi sonucu (server/insight.mjs): Instagram becerileriyle.
export type Insight = { at: string; phase?: string; error?: string; score?: number | null; summary?: string; items?: { title: string; detail: string }[] };
export type Account = { insights?: Partial<Record<"profile" | "audit" | "plan", Insight>>; id: string; platform: Platform | Feed; name: string; handle: string; voice: string; lang?: Lang; login?: string; premium?: boolean; browser?: { id: string; name: string }; check?: { at: string; ok: boolean; seen?: string; error?: string }; pbLogin?: { at: string; phase?: string; ok?: boolean; seen?: string; error?: string } };
export type PostFormat = "ig_post" | "ig_reel" | "linkedin" | "tweet" | "thread" | "threads" | "short" | "text";
export type Post =
  | { format: "ig_post"; slides: { title: string; text: string }[]; caption: string; hashtags: string[] }
  | { format: "ig_reel" | "short"; hook: string; scenes: { text: string; sec: number; accent?: string }[]; caption: string; hashtags: string[] }
  | { format: "linkedin" | "text"; text: string }
  | { format: "tweet" | "thread" | "threads"; tweets: string[]; quote?: XTarget; reply?: XTarget };
// X'te alıntılanan ya da yanıtlanan tweet (server/xquote.mjs).
export type XTarget = { url: string; name?: string; handle?: string; avatar?: string; text?: string; media?: { kind: "image" | "video"; thumb: string; video?: string }; inner?: { name?: string; handle?: string; text?: string; media?: { kind: "image" | "video"; thumb: string; video?: string } } };

export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type CheckItem = { id: string; text: string; done: boolean };
export type Task = {
  id: string;
  worldId: string;
  projectId: string | null;
  title: string;
  notes: string;
  status: TaskStatus;
  day: string | null; // ne zaman yapacağım (YYYY-MM-DD), saatsiz
  deadline: string | null; // en geç
  estimate: number | null; // dakika
  checklist: CheckItem[];
  source?: { type: string; url: string; ref?: string };
  by: string;
  createdAt: string;
  doneAt?: string;
  order?: number; // Bugün listesinde elle sıralama
  autoId?: string; // bir otomasyonun o günkü işi
  format?: PostFormat; // sırayla biçimli otomasyonda bu işin biçimi (shared/repeat.mjs formatAt)
  who?: "me" | "claude"; // işi kim yapar (otomasyonsuz iş); yoksa sen
  browser?: { id: string; name: string }; // Rou yapsın: işin yapıldığı Chrome (server/browse.mjs doTask)
  sharer?: "claude" | "me"; // bu gönderiyi kim paylaşır (otomasyonunkini ezer)
  revise?: { note: string; prev: string; at: string; pending?: boolean }; // sıradaki hazırlığın revize notu
  revisions?: { at: string; note: string; runId?: string; prev: string; clear?: { ask: string; keep: string[]; ban: string[]; media: "keep" | "new" | "none" | "any"; text: boolean; visual: boolean; general?: string; rule?: { text: string; autos: string[]; kind: "visual" | "text"; art?: true } }; saved?: string[] }[]; // tüm revize notları, eskiden yeniye (shared/revise.mjs); hiç silinmez
  autoSlot?: string; // otomasyonun hangi saati ("08:00"; saatsizse "")
  autoDay?: string; // otomasyonun hangi günün işi (iş başka güne taşınsa da değişmez)
  post?: PlannedPost; // planlanan sosyal gönderi (Stüdyo › Haftayı planla); otomasyonsuz
  queuedAt?: string; // Rou'nun hazırlama sırasında bekliyor (server/prepare.mjs prepareMany)
  topic?: Topic; // otomasyon işinin konusu (otomasyonun topics'inden gelir ya da elle yazılır)
};
// Planlanan gönderi: hangi hesap, hangi biçim, ne anlatacak. Hazırlatınca Claude brief'e göre yazar.
// accountId boş olabilir: o zaman format seçilen platformdur; format da yoksa hesabı Rou hazırlarken seçer (shared/social.mjs pickAccount).
export type PlannedPost = { accountId: string; format?: PostFormat; brief: string; pillar?: string; at?: string };

// Takvimde ayrılan saat. Yerel saat: "YYYY-MM-DDTHH:MM".
export type Block = { id: string; taskId: string | null; worldId: string; title: string; start: string; end: string; kind: "plan" | "meeting" };

// Gerçekten çalışılan süre. ISO zaman.
export type Session = { id: string; taskId: string; start: string; end: string; mode: "free" | "pomo" | "manual" };

export type InboxItem = {
  id: string;
  worldId: string | null;
  projectId?: string | null; // not bir projeye konduysa (dünyası projenin dünyası)
  source: "note" | "mail" | "slack" | "clickup" | "claude" | string;
  from: string;
  url: string;
  title: string;
  body: string;
  receivedAt: string;
  suggestion?: { title: string; projectId?: string | null; day?: string | null; deadline?: string | null };
  state: "new" | "done";
  category?: NoteCategory; // yoksa "note"
  taskId?: string; // işe çevrildiyse oluşan iş
  autoId?: string; // otomasyona çevrildiyse
};
export type NoteCategory = "note" | "idea" | "todo" | "link";

// Otomasyon: seçili günlerde her saat için o günün işini açar (shared/repeat.mjs).
// who = "claude" ise Claude her işin çıktısını hazırlar (Run), kullanıcı onaylar.
// Otomasyonun bir adımı: ne yapılacak, hangi araçla, nerede (paylaşımda hangi hesap).
// Hazırlayan botun (who) adımlarını bot yapar; diğerleri her işte kontrol listesi olarak sana düşer.
export type StepKind = "text" | "image" | "video" | "post" | "other";
export type Step = { id: string; kind: StepKind; tool: string; account?: string; note?: string };
export type Automation = {
  id: string;
  every?: { hours: number; from: string; to: string }; // aralıklı: from–to arası her N saatte bir (times bundan üretilir)
  worldId: string;
  projectId: string | null;
  title: string;
  action: string; // Claude'a talimat
  times: string[]; // ["08:00", "20:00"]; boşsa saatsiz
  minutes: number;
  days: number[]; // 0=Paz … 6=Cmt
  status: "active" | "paused";
  who: "me" | "claude";
  accountId?: string; // projenin hangi hesabında paylaşılacak; yoksa ilk hesap
  platforms?: string[]; // hesap bağlı değilken nerede paylaşılacağı (instagram, tiktok, x...); hesap bağlanınca hesabınki geçerli
  format?: PostFormat; // gönderinin biçimi; yoksa hesabın platformunun ilk biçimi
  formats?: PostFormat[]; // sırayla biçimler (ör. ig_reel, ig_post); her çalışma sıradakini alır
  formatsFrom?: string; // sıra sayımının başladığı gün; yoksa createdAt
  steps?: Step[];
  browser?: { id: string; name: string }; // Chrome'da çalışır (server/browse.mjs): hazırlıkta okur ve önerir, onaylanınca yapar
  folder?: string; // dosyalar çalışma klasörü › <folder ya da başlık>
  output?: "text" | "post" | "video" | "report"; // hesap bağlı değilken çıktının türü (shared/stages.mjs)
  approve?: false; // onay beklemez: çıktı gelince iş biter (ör. haftalık rapor)
  visual?: string; // kalıcı görsel/kapak kuralları (kullanıcının revizelerinden): bu otomasyonun her görseline uygulanır
  attach?: "image" | "video"; // metin gönderisine (LinkedIn, X, Threads) ek: Rou tek görsel ya da dikey video da üretir
  voice?: "me"; // video kullanıcının sesiyle: metin hazırlanınca ses kaydı ona düşer
  horizon: string | null; // işi açılmış son gün
  ideas?: { at: string; by?: string; asked?: string; phase?: string; error?: string; items?: { title: string; brief: string; why: string; trend?: string; url?: string }[] }; // içerik önerileri (server/ideas.mjs)
  createdAt: string;
  color?: string; // seri rengi (hex, shared/series.mjs): bu serinin kapak ve slaytlarında vurgu bu renk; listelerde renk noktası
  sharer?: "claude" | "me"; // paylaşımı kim yapar (varsayılan Rou); me: kullanıcı kendisi paylaşır, "Paylaştım" der
  autoShare?: boolean; // onaylanan gönderi saatinde kendiliğinden paylaşılır; kapalıysa "Şimdi paylaş" bekler
  topics?: Record<string, Topic>; // ileri tarihli çalışmaların konusu, anahtar "YYYY-MM-DD HH:MM" (shared/repeat.mjs topicKey); iş açılınca göreve geçer
};
// Bir gönderinin önceden bilinen konusu: başlık ve ne anlatacağı. Rou önerir ya da kullanıcı yazar; hazırlarken Rou buna göre yazar.
export type Topic = { title: string; brief: string; source?: string }; // source: gösterilecek gerçek işin adresi ya da dosyası (server/plan.mjs)
// Bir işin hazırlanan çıktısı. images: data/media altındaki dosyalar; on: paylaşım günü; by: hazırlayan (claude, me...).
export type Run = {
  id: string;
  taskId?: string;
  at: string;
  title: string;
  body: string;
  status: "working" | "failed" | "ready" | "approved" | "posted" | "acted";
  plan?: false; // Rou'nun doğrudan yaptığı tek iş: onaylanacak plan yok (server/browse.mjs startDirect)
  images?: string[];
  video?: string; // media/<dosya>.mp4 (Reels)
  asIs?: boolean; // işin kendi dosyaları olduğu gibi paylaşılıyor (şablon çizilmedi); post.slides kullanılmaz
  order?: string[]; // Instagram carousel'inde video ile görsellerin sırası (Rou'nun verdiği); yoksa video başta
  copyOf?: string; // başka bir hesaba kopyalandığı kaynak çıktı (shared/revise.mjs copyPost)
  cover?: string; // videonun kapak karesi (media/<dosya>.png)
  voice?: string; // media/<dosya>: kullanıcının okuduğu ses (a.voice === "me")
  transcript?: string; // sesin dökümü (server/voice.mjs)
  post?: Post; // sosyal gönderinin yapılı hâli; önizleme bundan çizilir, body kopyalanacak metindir
  attach?: Post; // metin gönderisinin eki: görselin slaytı (ig_post, 1 slayt) ya da videonun sahneleri (short); yeniden üretim bundan
  renderError?: string; // görsel/video üretilemediyse neden
  needs?: string[]; // Rou'ya göre görseli belirgin biçimde iyileştirecek ama elinde olmayanlar (logo, gerçek ekran görüntüsü...)
  review?: { score?: number; notes?: string[]; rounds?: number }; // Rou'nun karelere bakarak verdiği puan (server/prepare.mjs polish)
  phase?: string; // hazırlanırken hangi adımda: "Yazıyor", "Kontrol ediyor", "Video hazırlanıyor"
  queued?: string; // bu hazırlık sürerken yeni revize geldi: bitince kendiliğinden başlar (server/prepare.mjs queueAfter)
  footage?: { key: string; from: number; sec: number; why?: string }; // revizede seçilen oynanış kesiti
  on?: string | null;
  by?: string;
  template?: string; // görsel/video şablonu (render/src/look.tsx TEMPLATES); yoksa "night"
  edited?: boolean; // kullanıcı düzenledi
  versions?: { at: string; why: string; post?: Post; attach?: Post; body?: string; images?: string[]; video?: string; template?: string }[]; // eski hâller (shared/versions.mjs), en yeni başta
  kitHash?: string; // görseller hangi kitle çizildi; kit değişince onay bekleyen görsel yeniden çizilir (server/schedule.mjs)
  slim?: boolean; // saklama: 90 günü geçen paylaşılmış gönderinin görseli küçültüldü, video kaldırıldı (server/retention.mjs)
  publish?: { phase?: string; error?: string; at: string; live?: Live; by?: "claude"; handoff?: boolean; reason?: string; dir?: string }; // paylaşılıyor, paylaşılamadı ya da kullanıcıya kaldı (handoff: paket paylaşım klasöründe)
  tried?: "claude"[]; // paylaşmayı deneyenler (yedek zincir)
  approvedVia?: "auto"; // zamanlayıcı onayladı (approve: false)
  reviseNote?: string;
  answers?: string; // bu çıktı hangi revize notuna cevap (revisions[].at)
  found?: { from: string; note: string; fix?: string; facts?: string[] }; // Rou'nun bilgisayarda bulup eklediği görsellerin kaynağı
  topicMiss?: string; // Konu kaynakta yoktu: Rou en yakın gerçek içeriği yazdı, nedeni (metinden sökülen "KONU UYMADI" satırı)
  reviseGaps?: { ask: string; why: string }[]; // Rou'nun yapamadığı revize istekleri ve nedeni
  shareSentAt?: string; // paylaşım başladı (zamanlayıcı bir kez başlatır)
  approvedAt?: string; // onaylandı
  postedAt?: string; // paylaşıldı
  postUrl?: string;
  items?: RunItem[]; // Chrome otomasyonunun önerdikleri; seçilenler onaylanınca yapılır
  act?: { phase?: string; error?: string; note?: string; at: string; question?: string; url?: string; loggedOut?: string; qa?: { q: string; a: string }[]; live?: Live }; // uygulama turu (tek işte Rou yapsın: soru-cevap, son sayfa)
  live?: Live; // Chrome'da hazırlık sürerken canlı adımlar
};
// files: otomasyonun klasörüne göre yollar. answer: kullanıcının, önceki denemede sorulan soruya cevabı.
export type RunItem = { id: string; title: string; detail: string; url?: string; files?: string[]; score?: number; pick: boolean; answer?: string; result?: { done: boolean; at: string; note?: string; question?: string; url?: string } };

// Duraklatılınca: base = o ana kadar sayılan saniye, pausedAt = duraklatma anı. Devam edince startedAt yeni parçanın başı olur.
// carry = 1 dk'dan kısa kaldığı için henüz oturuma yazılmamış saniye (src/timer.ts commit).
export type Timer = { taskId: string; startedAt: string; mode: "free" | "pomo"; phase: "focus" | "break"; length: number; round: number; base?: number; pausedAt?: string; carry?: number };

export type State = {
  version: 3;
  worlds: World[];
  projects: Project[];
  tasks: Task[];
  blocks: Block[];
  sessions: Session[];
  inbox: InboxItem[];
  timer: Timer | null;
  automations: Automation[];
  runs: Run[];
  talk?: Talk[]; // dış öneri kanalı (pg propose)
  notices?: Notice[]; // sistemin geri dönüşleri, yeni önce (shared/notices.mjs): zil ve Rou sohbeti
  rous?: Rou[]; // Rou'lar (shared/rou.mjs); ilki varsayılan Rou
  writingGuide?: { text: string; at: string }; // sohbette verilen yazım rehberi; shared/guide.mjs guideOf kodu ezer
  chatSummary?: Record<string, { text: string; upTo: string; at: string }>; // server/rou.mjs summarize: son 12 mesajın dışına düşen konuşmanın özeti
  chat?: Record<string, ChatMsg[]>; // Rou id'sine göre sohbetler (tarayıcı ve Mac uygulaması aynı geçmişi görür)
  chatFrom?: string; // varsayılan Rou'da "Yeni sohbet": kanalın bundan önceki mesajları sohbette gizlenir
  memory?: Memory[]; // Rou'ların kullanıcı hakkında hatırladıkları
  trash?: Bin[]; // Çöp Kutusu, 30 gün (shared/trash.mjs)
  change?: { id: string; text: string; phase: string; at: string; rouId?: string; done?: boolean; error?: string; restart?: boolean; code?: boolean; waiting?: boolean }; // Rou'nun yaptığı kod değişikliğinin durumu (server/change.mjs)
  changes?: { id: string; text: string; sha?: string; at: string; undone?: boolean; error?: string }[]; // sha yoksa yalnız veri işi; error: olmadı
  settings?: { userName?: string; workHints?: string; workDirs?: string[] }; // Ayarlar: kullanıcının adı (Rou istemleri), işlerinin nerede durduğu ve Rou'nun okuyabileceği klasörler
  changeQueue?: { id: string; text: string; rouId: string; at: string; tries?: number }[]; // onaylanıp sırasını bekleyen değişiklikler
};

// Rou'ya eklenen dosya: data/media/<file>, /media/<file> olarak sunulur.
export type Att = { file: string; name: string; kind: "image" | "video" | "audio" | "file" };
export type ChatMsg = { role: "user" | "rou"; text: string; at?: string; error?: boolean; action?: { type: string; [k: string]: unknown }; act?: "done" | "no"; show?: string[]; files?: Att[] };
// rouId yoksa ortak hafıza: tüm Rou'lar bilir.
export type Memory = { id: string; text: string; at: string; rouId?: string };
// persona: kullanıcının bu Rou'ya verdiği görev talimatı. color boşsa siyah.
export type Rou = { id: string; name: string; color: string; persona: string };
export type Bin = {
  id: string;
  kind: "world" | "project" | "task" | "auto" | "run" | "note" | "account" | "source";
  title: string;
  at: string;
  recs: Partial<Pick<State, "worlds" | "projects" | "tasks" | "blocks" | "sessions" | "inbox" | "automations" | "runs">> & {
    account?: { worldId: string; acc: Account; projectIds?: string[] };
    source?: { projectId: string; src: Source };
  };
};

// Kanaldaki bir mesaj. Önerisi (action) kullanıcı onaylayınca uygulanır; act onun kararı.
// from "agent": dışarıdan bir araç (Claude Code, MCP, ileride bağlanacak araç) `pg propose` ile öneri bıraktı; name aracın adı.
// Bildirim: paylaşıldı, paylaşılamadı, sana kaldı, onay bekliyor, hazırlanamadı. Düğmeler işin şimdiki durumundan (noticeCtas).
export type Notice = { id: string; at: string; kind: "posted" | "share_failed" | "handoff" | "ready" | "failed" | "ask"; title: string; text?: string; by?: "claude"; runId?: string; taskId?: string; worldId?: string; read?: boolean };
export type Talk = { id: string; from: "rou" | "agent"; name?: string; text: string; at: string; action?: { type: string; [k: string]: unknown }; act?: "done" | "no"; show?: string[] };
