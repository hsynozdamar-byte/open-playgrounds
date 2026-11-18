import type { Task } from "../types";

// Durum işareti, her yerde aynı: boş halka = yapılacak, yarım dolu = yapılıyor, ara çizgileri = beklemede, tik = bitti.
export function StatusMark({ status, size = 14 }: { status: Task["status"]; size?: number }) {
  return (
    <svg className={`smark s-${status}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--w)" />
          <path d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="var(--w)" strokeWidth="1.7" />
          {status === "doing" && <path d="M8 3.6a4.4 4.4 0 0 1 0 8.8z" fill="var(--w)" />}
          {status === "waiting" && <path d="M6.4 5.8v4.4M9.6 5.8v4.4" stroke="var(--w)" strokeWidth="1.7" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}
