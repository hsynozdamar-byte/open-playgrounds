import { useEffect, useState } from "react";
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(i);
  }, [active, ms]);
  return now;
}
