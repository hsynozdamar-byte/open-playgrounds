// Rou: Playgrounds'un içindeki asistan. Bağlı model (`claude -p`) Rou kişiliğiyle ve verinin özetiyle konuşur.
// Rou veriyi kendisi değiştirmez: bir iş önerir (action), kullanıcı uygulamada onaylarsa istemci uygular. Ücret: Claude aboneliği.
import { read, update, MEDIA_DIR } from "./store.mjs";
import { describeFiles } from "./attach.mjs";
import { runClaude } from "./claude.mjs";
import { FORMATS, accountOf, isFeed, platformName, taskRef } from "../shared/social.mjs";
import { DEFAULT_ROU, memoryOf, rouOf } from "../shared/rou.mjs";
import { userName } from "../shared/user.mjs";
import { changeOn } from "./change.mjs";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const STATUS = { todo: "yapılacak", doing: "yapılıyor", waiting: "beklemede", done: "bitti" };
const DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const WHO = (s) => ({ claude: "Claude", me: userName(s) });

// Hazırlat'a hazır otomasyon işleri: bugün ya da geçmiş, bitmemiş, hazırlayan bot, çıktısı yok.
function due(s, today, wname) {
  const list = s.tasks.filter((t) => {
    const a = s.automations.find((x) => x.id === t.autoId);
    return a && a.who !== "me" && t.status !== "done" && t.day && t.day <= today && !s.runs.some((r) => r.taskId === t.id && r.status !== "failed");
  }).slice(0, 12);
  return list.length ? list.map((t) => `- (id:${t.id}) ${t.title} [${wname(t.worldId)}] gün ${t.day}, hazırlayan ${WHO(s)[s.automations.find((x) => x.id === t.autoId).who]}`).join("\n") : "(yok)";
}

// Rou'nun hafızası (state.memory): ortak + o Rou'nun kendi kayıtları; rouId yoksa yalnız ortak. withIds: Rou forget için kimlikleri görür.
export function memoryText(s, withIds = false, rouId) {
  const list = memoryOf(s, rouId);
  return list.length ? list.map((m) => `- ${withIds ? `(memId:${m.id}) ` : ""}${rouId ? (m.rouId ? "[kendi] " : "[ortak] ") : ""}${m.text}`).join("\n") : "(henüz yok)";
}

// Modelin göreceği veri: kısa, okunur metin. Seçili dünya varsa o dünya önce gelir.
function snapshot(s, lens) {
  const now = new Date();
  const today = iso(now);
  const week = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const wname = (id) => s.worlds.find((w) => w.id === id)?.name ?? "Dünyasız";
  const pname = (id) => s.projects.find((p) => p.id === id)?.name;
  const where = (t) => [wname(t.worldId), pname(t.projectId)].filter(Boolean).join(" › ");
  const at = (t) => s.blocks.filter((b) => b.taskId === t.id && b.start.slice(0, 10) >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const task = (t) => `- (id:${t.id}) ${t.title}${t.topic?.title ? `: ${t.topic.title}` : ""} [${where(t)}] ${STATUS[t.status]}${t.day ? `, gün ${dayOf(t.day)}` : ""}${currentRun(s, t.id) ? `, çıktısı runId:${currentRun(s, t.id).id}` : ""}${at(t) ? `, saat ${at(t).start.slice(11, 16)}-${at(t).end.slice(11, 16)}` : ""}${t.autoId ? ", otomasyon işi" : ""}${t.deadline ? `, deadline ${t.deadline}` : ""}${t.checklist?.length ? `, ${t.checklist.filter((c) => c.done).length}/${t.checklist.length} alt adım` : ""}`;
  const open = s.tasks.filter((t) => t.status !== "done");
  const late = open.filter((t) => (t.deadline && t.deadline < today) || (t.day && t.day < today));
  const todays = open.filter((t) => t.day === today);
  const upcoming = open.filter((t) => t.day && t.day > today && t.day <= week);
  const undated = open.filter((t) => !t.day);
  const doneWeek = s.tasks.filter((t) => t.doneAt && iso(new Date(t.doneAt)) > iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)));
  const mins = s.sessions.filter((x) => iso(new Date(x.start)) === today).reduce((n, x) => n + (new Date(x.end) - new Date(x.start)) / 60000, 0);
  const notes = s.inbox.filter((i) => i.state === "new");
  const list = (arr, max = 25) => (arr.length ? arr.slice(0, max).map(task).join("\n") + (arr.length > max ? `\n(+${arr.length - max} daha)` : "") : "(yok)");
  return [
    `Bugün: ${dayOf(today)}, saat ${pad(now.getHours())}:${pad(now.getMinutes())}. Dün: ${dayOf(iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)))}. Yarın: ${dayOf(iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)))}.`,
    `Paylaşım ya da gönderi görevi açarken gün: kullanıcı "bugün", "şimdi" ya da gün söylemeden "paylaş" dediyse ${today}; saat geç olsa da yarına erteleme. Yalnız açıkça başka gün dediyse o gün.`,
    lens && lens !== "all" ? `Kullanıcı şu an "${wname(lens)}" dünyasına bakıyor.` : "Kullanıcı tüm dünyalara bakıyor.",
    timerLine(s),
    `Dünyalar: ${s.worlds.map((w) => `${w.name} (id:${w.id})${w.description ? ` (${w.description})` : ""}`).join(", ") || "(yok)"}`,
    `Hesaplar (paylaşım): ${s.worlds.flatMap((w) => (w.accounts ?? []).filter((a) => !isFeed(a.platform)).map((a) => `${platformName(a)} ${a.name || ""}${a.handle ? ` ${a.handle}` : ""} (accId:${a.id}) [${w.name}]${a.lang ? ` dil ${a.lang}` : ""}`)).join(", ") || "(yok)"}`,
    `Projeler:\n${s.projects.filter((p) => p.status !== "done").map((p) => `- ${p.name} (id:${p.id}) [${wname(p.worldId)}]${p.status === "paused" ? " durdu" : ""}${p.deadline ? ` deadline ${p.deadline}` : p.ongoing ? " sürekli" : ""}${p.description ? `: ${p.description.replace(/\s+/g, " ").slice(0, 400)}` : ""}${brandLine(p.brand)}`).join("\n") || "(yok)"}`,
    `Bugünün işleri:\n${list(todays)}`,
    `Gecikenler:\n${list(late)}`,
    `Önümüzdeki 7 gün:\n${list(upcoming)}`,
    `Tarihsiz işler:\n${list(undated, 15)}`,
    `Son 7 günde biten: ${doneWeek.length} iş. Bugün odakta çalışılan: ${Math.round(mins)} dk.`,
    `Defter'de bekleyen notlar (en yeni önce):\n${noteList(notes, wname, pname)}`,
    `Otomasyonlar:\n${s.automations.length ? s.automations.map((a) => `- (autoId:${a.id}) ${a.title} [${wname(a.worldId)}] ${a.status === "active" ? "çalışıyor" : "durdu"}, ${a.times?.join(", ") || "saatsiz"}, hazırlayan ${WHO(s)[a.who] ?? a.who}${a.days?.length ? `, günler ${a.days.map((d) => DAYS[d]).join(" ")}` : ""}${a.image ? ", görselli" : ""}${a.browser ? `, Chrome'da (${a.browser.name})` : ""}${a.action ? `\n  talimat: "${a.action.replace(/\s+/g, " ").slice(0, 500)}"` : ""}${a.visual?.trim() ? `\n  kalıcı görsel kuralları (Kullanıcının kararı; talimatla çelişirse bunlar geçerli): "${a.visual.replace(/\s+/g, " ").slice(0, 700)}"` : ""}`).join("\n") : "(yok)"}`,
    `Hazırlanabilecek otomasyon işleri (bugün ve gecikmiş, çıktısı yok):\n${due(s, today, wname)}`,
    `Otomasyon çıktıları (her görevin geçerli çıktısı, en yeni önce; "görev günü" gönderinin takvimdeki günüdür, "hazırlandı" yalnız çıktının üretildiği andır):\n${runLines(s, today, wname)}`,
  ].join("\n\n");
}

// Projenin marka çerçevesi tek satırda: Rou düzenlerken eski hâlini bilsin.
function brandLine(b) {
  if (!b) return "";
  const x = [b.audience && `kitle: ${b.audience}`, b.pillars?.length && `başlıklar: ${b.pillars.join(", ")}`, b.use && `ton/kullan: ${b.use}`, b.avoid && `kaçın: ${b.avoid}`].filter(Boolean);
  return x.length ? `\n  marka: ${x.join("; ")}` : "";
}

// Defter notları kimlikleri ve metinleriyle: Rou onları okuyup dünyaya, projeye, işe dağıtabilsin.
const CAT = { note: "not", idea: "fikir", todo: "yapılacak", link: "link" };
function noteList(notes, wname, pname) {
  if (!notes.length) return "(yok)";
  const list = [...notes].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 40);
  return list.map((i) => {
    const where = i.worldId ? ` [${[wname(i.worldId), pname(i.projectId)].filter(Boolean).join(" › ")}]` : " [yeri yok]";
    const body = (i.body || "").replace(/\s+/g, " ").trim();
    return `- (noteId:${i.id}) ${CAT[i.category ?? "note"]}: ${i.title}${where}${i.url ? ` ${i.url}` : ""}, ${i.receivedAt.slice(0, 10)}${body ? `\n  "${body.slice(0, 500)}${body.length > 500 ? "…" : ""}"` : ""}`;
  }).join("\n") + (notes.length > list.length ? `\n(+${notes.length - list.length} daha)` : "");
}

// Zamanlayıcının durumu: Rou başlatma/duraklatma önerirken bilmeli.
function timerLine(s) {
  const t = s.timer;
  if (!t) return "Zamanlayıcı: çalışmıyor.";
  const task = s.tasks.find((x) => x.id === t.taskId);
  const state = t.pausedAt ? "duraklatıldı" : t.phase === "break" ? "molada" : "çalışıyor";
  return `Zamanlayıcı: ${state}, iş "${task?.title ?? "?"}" (id:${t.taskId}), ${t.mode === "pomo" ? `pomodoro ${t.length} dk` : "serbest"}.`;
}

// "2026-11-10 (Sal)": Rou günü hem tarihle hem adıyla görür ("dünkü", "Salı günkü").
const dayOf = (day) => `${day} (${DAYS[new Date(`${day}T12:00:00`).getDay()]})`;

// Bir görevin geçerli çıktısı (src/runs.ts runOfTask ile aynı): paylaşılmışsa o, yoksa hazırlanması bitmiş en yenisi.
const currentRun = (s, taskId) => s.runs.find((r) => r.taskId === taskId && r.status === "posted") ?? s.runs.find((r) => r.taskId === taskId && !["working", "failed"].includes(r.status)) ?? s.runs.find((r) => r.taskId === taskId && r.status !== "working");

// Otomasyon çıktıları: görev başına TEK satır (geçerli çıktı) ve görevin kendi kimliği, günü, konusu.
// İki görev aynı başlığı taşıyabilir: liste her görevin gününü ve konusunu gösterir, Rou gün ve konuya göre seçer.
export function runLines(s, today, wname = () => "") {
  const RUN = { working: "hazırlanıyor", failed: "hazırlanamadı", ready: "onay bekliyor", approved: "onaylandı", posted: "paylaşıldı" };
  const ids = [...new Set(s.runs.map((r) => r.taskId))].slice(0, 14);
  const list = ids.map((id) => currentRun(s, id)).filter(Boolean);
  if (!list.length) return "(yok)";
  return list.map((r) => {
    const t = s.tasks.find((x) => x.id === r.taskId);
    const body = (r.body || "").replace(/\s+/g, " ").slice(0, 400);
    const acc = t && accountOf(s, taskRef(s, t));
    const late = t?.day && t.day < today && t.status !== "done" && r.status !== "posted";
    const again = s.runs.some((x) => x.taskId === r.taskId && x.status === "working");
    return `- (runId:${r.id}) ${t?.title ?? r.title}${t?.topic?.title ? `: ${t.topic.title}` : ""} [${wname(t?.worldId)}]${t ? ` görev id:${t.id}${t.day ? `, görev günü ${dayOf(t.day)}${t.autoSlot ? ` ${t.autoSlot}` : ""}${late ? ", GECİKMİŞ" : ""}` : ""},` : ""}${r.post ? ` ${FORMATS[r.post.format]?.label ?? "gönderi"}${acc ? `, hesap ${platformName(acc)} ${acc.name || ""}${acc.handle ? ` ${acc.handle}` : ""}` : ""}${r.video ? ", videolu" : ""},` : ""} ${RUN[r.status] ?? r.status}${again ? " (yenisi şu an hazırlanıyor)" : ""}, ${r.by ?? "claude"} hazırladı ${(() => { const d = new Date(r.at); return `${iso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()}${r.images?.length ? `, ${r.images.length} görsel` : ""}${body ? `\n  "${body}"` : ""}`;
  }).join("\n");
}

// Rou'nun önerebileceği işler. Kimlikler sadece verideki (id:...) değerlerinden gelir.
const ACTIONS_ALL = `Yapabileceğin işler (action). Tek iş için tek nesne; birden çok iş için plan (aşağıda):
{"type":"start","taskId":"…","minutes":30}   işin zamanlayıcısını başlat; minutes verilirse o kadar dakikalık pomodoro, verilmezse serbest
{"type":"pause"}  {"type":"resume"}  {"type":"stop"}   çalışan zamanlayıcıyı duraklat / devam ettir / bitir ve kaydet
{"type":"add_task","title":"…","worldId":"…","projectId":"…"|null,"day":"YYYY-MM-DD"|null,"at":"HH:MM"|null,"minutes":60|null}   yeni iş ekle (at verilirse takvime o saatte minutes kadar blok). Bir hesapta paylaşılacak gönderi için kullanma: var olan çıktının kopyası copy_post, yeni gönderi change
{"type":"move","taskId":"…","day":"YYYY-MM-DD"|null}   işi başka güne taşı (null = tarihsiz)
{"type":"schedule","taskId":"…","day":"YYYY-MM-DD","at":"HH:MM","minutes":60|null}   işi takvime o gün o saate koy (blok)
{"type":"edit_task","taskId":"…","title":"…","deadline":"YYYY-MM-DD"|null,"projectId":"…"|null,"minutes":45,"notes":"…","steps":["…"]}   işi düzenle; yalnız değişecek alanları yaz. notes işin notunun sonuna eklenir, steps alt adım olarak eklenir, projectId başka dünyanın projesiyse iş o dünyaya geçer
{"type":"add_project","name":"…","worldId":"…","deadline":"YYYY-MM-DD"|null,"description":"…","ref":"p1"}   yeni proje aç (aynı dünyada aynı adla proje varsa önerme)
{"type":"edit_project","projectId":"…","name":"…","description":"…","deadline":"YYYY-MM-DD"|null,"ongoing":true|false,"status":"active"|"paused"|"done","brand":{"audience":"…","pillars":["…"],"use":"…","avoid":"…"}}   projeyi güncelle; yalnız değişecek alanları yaz. description ve brand alanları tam yeni hâliyle yazılır (eskisini koru, yalnız değişeni değiştir ya da ekle). brand.use = anlatım tonu ve kullanılacak ifadeler, brand.avoid = kaçınılacaklar; projenin gönderileri bunlara göre hazırlanır
{"type":"edit_auto","autoId":"…","title":"…","action":"…","days":[0-6],"times":["HH:MM"],"who":"me"|"claude","status":"active"|"paused","visual":"…"}   otomasyonu güncelle; yalnız değişecek alanları yaz. visual = otomasyonun kalıcı görsel/kapak kuralları (her satır bir kural; eskileri koru, yenisini sona ekle), kullanıcı bir görsel revizesini "hep böyle olsun" diye istediğinde ya da bir grup gönderi için genel görsel kuralı koyduğunda ("bu dünyanın oyun gönderilerinde ..."). Kural birden çok otomasyona uyuyorsa (ör. bir dünyanın bütün oyun gönderileri) her biri için edit_auto içeren bir plan öner; tek otomasyonla yetinme. action = Claude'a talimatın tam yeni hâli (eskisini koru, değişeni işle). days 0=Paz … 6=Cmt
{"type":"done","taskId":"…"}   işi bitti yap
{"type":"note","title":"…","body":"…","worldId":"…"|null}   Defter'e not ekle
Defter işleri (noteId'ler "Defter'de bekleyen notlar" listesinden):
{"type":"note_place","noteId":"…","worldId":"…"|null,"projectId":"…"|null}   notu bir dünyaya ya da projeye koy (projectId verilirse dünya projenin dünyası); not Defter'de kalır
{"type":"note_task","noteId":"…","title":"…","projectId":"…"|null,"worldId":"…"|null,"day":"YYYY-MM-DD"|null,"at":"HH:MM"|null,"minutes":60|null,"ref":"t1"}   notu işe çevir: iş açılır, notun metni işin notuna geçer, not arşive gider. title notun başlığından daha net bir iş adıysa ver, yoksa boş bırak
{"type":"note_attach","noteId":"…","taskId":"…","as":"notes"|"steps"}   notu var olan bir işe ekle: notes = işin notuna, steps = notun satırları işin alt adımları olur. Not arşive gider
{"type":"note_edit","noteId":"…","title":"…","body":"…","category":"note"|"idea"|"todo"|"link"}   notu düzenle: dağınık notu toparla (başlık net, gövde markdown: "- " liste, "- [ ] " yapılacak, "## " ara başlık), kategorisini düzelt. Notun anlamını değiştirme, bilgi ekleme ya da çıkarma
{"type":"note_archive","noteId":"…"}   notu arşivle (işi bitmiş, artık gerekmeyen not)
{"type":"approve","runId":"…"}   onay bekleyen otomasyon çıktısını onayla
{"type":"share","runId":"…"}   onay bekleyen ya da onaylı bir gönderiyi ŞİMDİ hesabında paylaştır (kullanıcı "paylaş", "at", "gönder" derse). X'te metinde bir tweet adresi varsa ve iş "yanıt" ya da "alıntı" diyorsa o tweete yanıt/alıntı olarak atılır; kullanıcı bir tweete yanıt istiyorsa önce revise ile metne tweet adresini ve "yanıt olarak paylaş" notunu yazdır, sonra share. "Yapamam" deme
{"type":"auto","text":"…","worldId":"…"|null}   yeni otomasyon kur: otomasyon formu Claude'un taslağıyla dolu açılır, kullanıcı bakıp kaydeder. text = isteğin tamamı tek cümlede (ne, hangi hesap ya da platform, hangi günler ve saatler, kim hazırlar, ton); worldId istekte geçen dünya, belli değilse null
{"type":"revise","runId":"…","note":"…","worldId":"…"|null,"projectId":"…"|null,"accountId":"…"|null}   kullanıcı sohbette bir çıktıyı beğenmediyse ya da değişiklik istediyse HEMEN bunu öner (ona "Revize iste'ye bas" deme): note = isteğinin tamamı, onun sözleriyle ve eksiksiz (ne değişecek, ne eklenecek, neyi koruyacak). Not işin revize geçmişine kalıcı yazılır, Rou çıktıyı baştan hazırlar. Talimatın da kalıcı değişmesi gerekiyorsa edit_auto'yu ayrıca öner, ama revize'yi bekletme. worldId, projectId, accountId yalnız kullanıcı gönderinin BAŞKA bir dünyada, projede ya da hesapta paylaşılmasını isterse dolar (ör. "bunu öbür dünyanın LinkedIn hesabında paylaş"): accountId Hesaplar listesindeki (accId:…), projectId Projeler'deki (id:…), worldId Dünyalar'daki (id:…); hesap o dünyanın olmalı, proje de. Gönderi oraya taşınır; otomasyon işiyse otomasyondan ayrılıp o hesabın tek seferlik gönderisi olur (otomasyon değişmez) ve yeni hesabın sesi, dili ve proje Bilgi'siyle baştan yazılır. İstenen hesap listede yoksa alanı uydurma, bunu söyle. Taşıma istenmiyorsa üçü de null
{"type":"copy_post","runId":"…","accountId":"…","day":"YYYY-MM-DD"|null,"at":"HH:MM"|null}   bir çıktıyı BAŞKA bir hesapta da paylaştır (kullanıcı "bunu Threads'te de, LinkedIn'de de paylaş" derse): her hesap için bir copy_post (iki hesapsa iki adımlı plan). Kopya o hesabın tek seferlik GÖNDERİ işi olarak açılır, metin ve video/görseller aynen geçer, Gönderiler'de onayını bekler. accountId Hesaplar listesindeki (accId:…); day/at verilmezse kaynağın günü ve saati. Asla add_task ile düz iş açma (düz iş Gönderiler'de görünmez). Yalnız LinkedIn, X ve Threads hesaplarına; Instagram için revise ile taşı. Gönderi bu hesaptan değil de yalnız başka hesapta paylaşılacaksa revise (accountId ile taşıma)
{"type":"set_text","runId":"…","text":"…"}   kullanıcı bir gönderinin son metnini kendisi verdiyse (yapıştırdı, "bu metni kullan", "elle düzenledim") bunu öner, revise DEĞİL: text = onun metni kelimesi kelimesine, tek harfini değiştirme, kısaltma, düzeltme. Görseller ve video aynen kalır, paylaşım klasöründeki metin.txt de güncellenir
{"type":"set_example","projectId":"…","text":"…"}   kullanıcı bir metni bir projenin örneği, referansı, "böyle yazılsın" diye verirse: projenin onaylı örneği olur, o projenin bütün taslakları bu sesi hedefler. text kelimesi kelimesine. Aynı mesajda bir gönderinin metniyse set_text ile birlikte planda öner
{"type":"set_guide","text":"…","mode":"prepend"|"replace"}   kullanıcı bir yazım rehberi, yazı kuralları ya da "genel yazım dili" metni verirse: text = rehberin tamamı kelimesi kelimesine. mode prepend (varsayılan): yeni rehber başa geçer, eskisi altta "Ayrıntılı rehber" olarak kalır, çelişirse yeni geçerli; replace: yalnız "eskisini at, bunu kullan" derse. Rou bütün taslakları bununla yazar ve bununla düzeltir
{"type":"prepare","taskId":"…"}   hazırlayanı Claude olan bir otomasyon işini şimdi hazırlat (Chrome işleri de; yalnız okur ve öneri çıkarır, hiçbir şey göndermez). taskId "Hazırlanabilecek otomasyon işleri" listesinden
{"type":"remember","text":"…","shared":true|false}   kullanıcı hakkında kalıcı bir bilgiyi hafızana ekle (tek kısa cümle, üçüncü tekil: "Maaş beklentisi net 90.000 TL."). shared true: kullanıcı hakkında genel bilgi, tüm Rou'lar bilsin; false: yalnız senin görevinle ilgili
{"type":"forget","memId":"…"}   hafızandan bir bilgiyi sil (memId hafıza listesinden)
{"type":"add_world","name":"…","description":"…"}   yeni dünya aç (aynı adla dünya varsa önerme; description yalnız kullanıcı söylediyse, yoksa boş)
{"type":"change","text":"…","files":["rou-….png"]|null}   yukarıdakilerin yetmediği her şeyi kendin yap: sen Claude'sun ve istenince bu bilgisayarda kodla ve komutlarla çalışırsın. Uygulamaya yeni özellik ya da ekran eklemek, görünüşü değiştirmek (renk, yazı, yerleşim), sunucuyu değiştirmek, birden çok adımlı veri işleri (ör. dünya + proje + otomasyon birlikte), sistem işleri. text = isteğin tamamı, net ve tek başına anlaşılır: ne, nerede, nasıl olacak. Kod değişirse kontrol edilir, bozulursa kendiliğinden geri alınır; sonra Geri al da mümkün. Uzun sürebilir (bir iki dakika). Paylaşılacak tek seferlik bir gönderi (metin, görsel, video) istenirse text içinde bunu GÖNDERİ olarak iste: hangi hesaptan paylaşılacağı (hesap id ya da @kullanıcı) ve dili yazılsın, görev \`pg add ... --post <hesap>\` ile açılsın (düz görev Gönderiler'de görünmez); videoysa CLAUDE.md'deki video kuralları geçerli

Toplu iş (plan): birden çok iş gerekiyorsa tek bir plan öner. Kullanıcı her adımı tek tek açıp kapatabilir, Onayla seçilenleri birlikte yapar, tek Geri al hepsini geri alır.
{"type":"plan","title":"Defteri düzenle","steps":[ {…}, {…} ]}
Plana girebilenler: copy_post, set_example, set_guide, add_task, add_project, edit_task, edit_project, edit_auto, schedule, move, done, note, note_place, note_task, note_attach, note_edit, note_archive, add_world, approve, remember, forget (zamanlayıcı, auto, prepare, share, set_text, change plana girmez, onları tek başına öner). En fazla 40 adım.
Aynı planda yeni açılan bir kayda sonraki adımda bağlanmak için açan adıma "ref" ver ve sonraki adımda kimlik yerine "@ref" yaz: {"type":"add_project","name":"Lansman","worldId":"…","ref":"p1"}, {"type":"note_task","noteId":"…","projectId":"@p1"}.`;

// Rou'nun kod değişikliği (change) kapalıysa model onu hiç görmez.
const actions = () => changeOn() ? ACTIONS_ALL : ACTIONS_ALL.split("\n").filter((l) => !l.startsWith('{"type":"change"')).join("\n")
  + "\nKod değişikliği (change) bu kurulumda kapalı: hazır eylemlerin yetmediği bir isteği yapamayacağını kısaca söyle, change önerme.";
const SHOW = `Gösterme: kullanıcı bir çıktıyı, gönderiyi, Reels'i ya da tweeti görmek isterse (ör. "bugünkü LinkedIn postunu göster", "son Reels nasıl olmuş") "show" alanına o çıktıların runId'lerini yaz (en fazla 3). Uygulama onları gerçek görünümleriyle (önizleme, video) sohbette gösterir; metinde içeriği tekrar yazma, kısa bir yorum yeter. Gösterme onay gerektirmez, action değildir.`;

const WHO_TALKS = (s) => ({ user: userName(s), rou: "Rou" });

// rou: konuşan Rou (state.rous). Varsayılan Rou dışındakiler kendi adı ve kullanıcının verdiği görev talimatıyla konuşur.
function prompt(s, lens, messages, rou = rouOf(s)) {
  const me = userName(s);
  // Önerdiği iş kartı onaylandı mı: onaylanmayan öneri yapılmış sayılmaz.
  const saved = s.chat?.[rou.id] ?? [];
  const actTag = (m) => {
    const x = m.action ? m : saved.find((y) => y.role === "rou" && y.at === m.at && y.text === m.text);
    if (!x?.action || ["undo_change", "show"].includes(x.action.type)) return "";
    return x.act ? " [önerdiği iş onaylandı ve yapıldı]" : " [önerdiği iş ONAYLANMADI, yapılmadı]";
  };
  const talk = messages.slice(-12).map((m) => `${m.role === "rou" ? rou.name : WHO_TALKS(s)[m.role] ?? me}${m.role === "rou" ? actTag(m) : ""}: ${m.text}`).join("\n\n");
  const others = s.rous?.filter((r) => r.id !== rou.id).map((r) => r.name) ?? [];
  return [
    rou.id === DEFAULT_ROU && rou.name === "Rou"
      ? "Sen Rou'sun: Kullanıcının kişisel planlayıcısı Playgrounds'un içinde yaşayan asistan. Sıcak, kısa ve net konuşursun; arkadaş gibi ama işini bilen biri."
      : `Adın ${rou.name}. Kullanıcının kişisel planlayıcısı Playgrounds'un içinde yaşayan asistanlardan (Rou'lar) birisin. Sıcak, kısa ve net konuşursun; arkadaş gibi ama işini bilen biri.`,
    me !== "kullanıcı" ? `Kullanıcının adı: ${me}.` : "",
    rou.persona?.trim() ? `Kullanıcının sana verdiği görev talimatı (buna göre davran):\n${rou.persona.trim()}` : "",
    s.chatSummary?.[rou.id]?.text ? `Kullanıcıyla önceki konuşmalarınızın özeti (son mesajlar aşağıda ayrıca var):\n${s.chatSummary[rou.id].text}` : "",
    others.length ? `Diğer Rou'lar: ${others.join(", ")}. Her birinin sohbeti ve kendi hafızası ayrıdır; ortak hafıza hepinizindir.` : "",
    "Kurallar: Türkçe yaz (kullanıcı İngilizce yazarsa İngilizce). Kısa tut: çoğu cevap 1-3 cümle ya da kısa bir liste. Uzun tire (—) kullanma. Uygulamada yapılacaklara 'görev' denir: Kullanıcıya yazarken 'iş' değil 'görev' de (görev ekle, görevi aç, bugünün görevleri). Sadece aşağıdaki veriye dayan; veride olmayan iş, tarih, rakam ya da olay uydurma, bilmiyorsan söyle. Markdown başlığı kullanma; gerekirse kısa madde işareti kullan.",
    "Hafıza: kullanıcı kalıcı bir bilgi ya da tercih söylerse (iş, maaş beklentisi, çalışma saatleri, sevdiği ve sevmediği şeyler, genel yazı tarzı) ya da 'bunu hatırla' derse remember öner; bir bilgi değiştiyse önce eskisini forget ile sil. Geçici şeyleri (bugünkü ruh hali, tek seferlik iş) hatırlama. Cevaplarında hafızandakileri kullan. [ortak] kayıtları tüm Rou'lar bilir, [kendi] kayıtlar yalnız senin.",
    "Kalıcı kararlar kayda yazılır: kullanıcı bir proje ya da otomasyon için kalıcı bir karar verirse (anlatım tonu, kitle, kural, kaçınılacak şey, paylaşım günleri, kim yapar, görsel olsun olmasın, deadline) bunu hafızaya değil ilgili kayda yaz: proje için edit_project (ton ve kurallar brand'e, projenin ne olduğu description'a), otomasyon için edit_auto (talimat, günler, saatler). Karar o projenin otomasyonlarını da etkiliyorsa (ör. talimatta eski ton yazıyorsa) hepsini tek planda öner. Eski metni koru, yalnız değişeni işle; karar belirsizse ya da hangi proje olduğu belli değilse kısaca sor. remember yalnız kullanıcının kendisi hakkındaki bilgiler için.",
    `Kullanıcı hakkında hatırladıkların:\n${memoryText(s, true, rou.id)}`,
    "İş yapma: kullanıcı bir şey yapmanı isterse (başlat, ekle, taşı, bitir, not al, onayla, otomasyon kur, hazırlat, hatırla, unut, dünya aç; ya da uygulamayı, sunucuyu, bilgisayarda bir şeyi değiştirmek gibi başka her şey) action ile öner. Bir şeyi yapamam deme: hazır eylemler yetmiyorsa change ile kendin yaparsın. Kullanıcı bir şey istediyse iş cevabınla birlikte hemen uygulanır, onay beklemez: ne yaptığını tek cümleyle şimdiki zamanla söyle (ör. \"Yazıyı yeniden hazırlıyorum: ad tam yazılacak, yalnız kapak görseli olacak.\"). 'Onaylarsan', 'yapayım mı', 'ister misin' deme, izin isteme. Yalnız share, approve, forget ve set_guide replace kartta kullanıcının onayını bekler; bunlarda cümle onay beklediğini söylesin (ör. \"Onaylarsan şimdi paylaşırım.\"). Kullanıcı bir şey istemeden, kendi fikrinle bir iş önereceksen action verme, metinde sor. Geçmişte [önerdiği iş ONAYLANMADI] yazan bir öneri yapılmadı: kullanıcı aynı şeyi yeniden isterse bunu söyle ve kartı yeniden öner. Kullanıcı senden bir iş isterse (ör. Gmail'deki abonelikleri temizle, bir sitede bir şey yap) önce o işi ilgili dünyada (kişisel işler Kişisel dünyasında) Rou'ya atanmış bir görev olarak aç ki kartından takip edilsin; işi kendin yap. İş ve paylaşım her zaman sende. Hangi iş olduğu belirsizse action verme, kısaca sor. Kimlikleri sadece verideki (id:...) ve (runId:...) değerlerinden al, asla uydurma. Tarihleri bugüne göre YYYY-MM-DD yaz.",
    "Hangi gönderi: kullanıcı bir gönderiyi günüyle ve konusuyla tarif ederse (\"dünkü lansman gönderisi\", \"Salı günkü\", \"geciken gönderi\") çıktıyı GÖREVİN GÜNÜNE ve metnin anlattığı konuya göre seç: \"görev günü\" o gün olan ve metni o konuyu anlatan çıktı. Aynı adlı birden çok görev olabilir; adla ya da en yeni çıktıyla seçme. \"Hazırlandı\" saati görevin günü değildir: dünkü gönderi bugün yeniden hazırlanmış olabilir. \"Geciken\" yalnız GECİKMİŞ yazan görevdir. Mesajda adı geçen marka ya da proje seçtiğin çıktının metninde ya da konusunda geçmiyorsa o çıktı yanlıştır. Gün ve konu aynı çıktıda buluşmuyorsa action verme, iki adayı günleriyle yazıp hangisi olduğunu sor. Cevabında hangi gönderiyi seçtiğini günü ve konusuyla söyle (ör. \"Salı günkü lansman carousel'ini yeniden hazırlıyorum\").",
    "Verilmiş karar yeniden sorulmaz: Kullanıcının bir kararı veride yazıyorsa (otomasyonun kalıcı görsel kuralları, talimatı, projenin markası, hafıza) onu \"hep böyle olsun mu\" diye yeniden sorma; yazılı karara göre davran.",
    "Defter: Kullanıcının hızlı notları. Defteri düzenlemeni, dağıtmanı, toparlamanı isterse (ya da 'Defteri düzenle' derse) bekleyen notların her birini oku ve en uygun yeri öner: bir dünyanın projesine ait ve yapılacak bir şeyse note_task (proje ve gün belliyse ver), var olan bir işin parçasıysa note_attach, yalnız bir yere aitse note_place, dağınıksa note_edit, bitmiş ya da gereksizse note_archive. Emin olmadığın notu plana koyma, metinde kısaca sor (hangi dünya?). Projesi olmayan bir konu birden çok notta geçiyorsa add_project + ref ile proje aç ve notları içine koy. Hepsini tek planda öner; metinde kısa özet ver (ör. \"7 not: 4'ü işe, 2'si bir projeye, 1'i arşive.\"), notları tek tek sayma, kart zaten gösteriyor.",
    actions(),
    SHOW,
    `Playgrounds verisi (şu an):\n${snapshot(s, lens)}`,
    `Konuşma:\n${talk}`,
    `${rou.name} olarak son mesaja cevap ver. Çıktın SADECE tek bir JSON nesnesi olsun, başka hiçbir şey yazma: {"text":"cevabın","action":null,"show":[]} (action ya da show dolu olabilir).`,
  ].filter(Boolean).join("\n\n");
}

// Öneri: tek nesne ya da plan. Model bir "actions" dizisi yazdıysa plana çevrilir; tek adımlı plan tek öneri olur.
const isAct = (a) => a && typeof a === "object" && typeof a.type === "string";
function actionOf(j) {
  let a = isAct(j.action) ? j.action : Array.isArray(j.actions) && j.actions.length ? { type: "plan", title: "", steps: j.actions } : null;
  if (a?.type === "plan") {
    const steps = (Array.isArray(a.steps) ? a.steps : []).filter(isAct).slice(0, 40);
    a = steps.length > 1 ? { type: "plan", title: typeof a.title === "string" ? a.title : "", steps } : steps[0] ?? null;
  }
  return a;
}

// Modelin çıktısından JSON'u çıkar; bozuksa düz metin olarak kabul et.
function parse(out) {
  const m = out.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (typeof j.text === "string") return { text: j.text.trim(), action: actionOf(j), show: Array.isArray(j.show) ? j.show.filter((x) => typeof x === "string").slice(0, 3) : [], ask: typeof j.ask === "string" && j.ask.trim() ? j.ask.trim().slice(0, 600) : "" };
    } catch { /* düz metin */ }
  }
  return { text: out.trim(), action: null, show: [], ask: "" };
}

export async function ask(messages, lens, rouId) {
  const { state } = read();
  // Ekler: son 6 mesajdakiler satır olarak mesaja eklenir; görseller, video kareleri ve belgeler Read ile açılır (yalnız okuma).
  const read_ = [];
  const withFiles = [];
  for (const [i, m] of messages.entries()) {
    if (!m.files?.length || i < messages.length - 6) { withFiles.push(m); continue; }
    const d = await describeFiles(m.files);
    read_.push(...d.read);
    withFiles.push({ ...m, text: `${m.text}${d.lines.length ? `\n[Ekler]\n${d.lines.join("\n")}` : ""}` });
  }
  const look = read_.length ? "\n\nEkler: Kullanıcının eklediği görselleri, video karelerini ve belgeleri Read aracıyla açıp gerçekten bak; cevabını gördüğüne dayandır. Uygulamanın kodunu değiştirme önerisinde (change) ilgili eklerin dosya adlarını files alanına yaz." : "";
  const r = await runClaude(prompt(state, lens, withFiles, rouOf(state, rouId)) + look, read_.length ? 240000 : 120000, undefined,
    read_.length ? { args: ["--allowedTools", "Read", "--add-dir", MEDIA_DIR] } : {});
  if (!r.ok) return { ok: false, error: r.error.slice(0, 300) };
  const { ask: _ask, ...out } = parse(r.out);
  void summarize(rouOf(state, rouId).id);
  return { ok: true, ...out };
}

// Uzun sohbet: Rou her soruda son 12 mesajı görür. Bu pencereden düşen mesajlar arka planda kısa bir özete katlanır
// (state.chatSummary[rouId] = { text, upTo }); özet her soruda verilir, böylece eski konuşma unutulmaz ama bağlam şişmez.
// Kalıcı bilgi (tercih, karar) yine hafızaya (remember) yazılır.
const KEEP = 12;
const summarizing = new Set();
export async function summarize(rouId) {
  if (summarizing.has(rouId)) return;
  const { state: s } = read();
  const list = (s.chat?.[rouId] ?? []).filter((m) => m.text?.trim() && !m.error);
  const prev = s.chatSummary?.[rouId];
  const old = list.slice(0, -KEEP).filter((m) => m.at && (!prev?.upTo || m.at > prev.upTo));
  if (old.length < 8) return;
  summarizing.add(rouId);
  try {
    const r = await runClaude([
      "Kullanıcı ile asistanı Rou arasındaki eski sohbeti özetliyorsun. Özet, Rou'nun ileride bu konuşmayı hatırlaması için.",
      prev?.text ? `Şimdiye kadarki özet:\n${prev.text}` : "",
      `Özete eklenecek mesajlar:\n${old.map((m) => `${m.role === "rou" ? "Rou" : userName(s)} (${m.at.slice(0, 10)}): ${m.text.slice(0, 800)}`).join("\n")}`,
      "Kurallar: Türkçe, en fazla 1200 karakter, kısa maddeler. Yalnız sonra işe yarayacakları tut: verilen kararlar, istekler, açık kalan işler, kullanıcının tercihleri. Selamlaşma ve tekrar edilen şeyleri at. Uydurma. Uzun tire kullanma. SADECE özeti yaz.",
    ].filter(Boolean).join("\n\n"), 90000, undefined, { args: ["--model", "haiku"] });
    if (r.ok && r.out.trim()) update((st) => { st.chatSummary = { ...(st.chatSummary ?? {}), [rouId]: { text: r.out.trim().replace(/^```\w*\n?|\n?```$/g, "").trim().slice(0, 1500), upTo: old[old.length - 1].at, at: new Date().toISOString() } }; });
  } finally { summarizing.delete(rouId); }
}
