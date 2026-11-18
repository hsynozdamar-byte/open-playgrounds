import { Check } from "lucide-react";

// Notun metni: ``` kod bloğu, > alıntı, düz satırlar, "## " ara başlık, "- " liste, "- [ ] " yapılacak (tıklayınca işaretlenir), **kalın**.
export function NoteBody({ text, onToggle }: { text: string; onToggle?: (body: string) => void }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => list.length && (out.push(<ul key={`u${out.length}`}>{list}</ul>), (list = []));
  let code: string[] | null = null;
  lines.forEach((raw, n) => {
    if (/^\s*```/.test(raw)) {
      if (code) { out.push(<pre key={n} className="ncode"><code>{code.join("\n")}</code></pre>); code = null; }
      else { flush(); code = []; }
      return;
    }
    if (code) { code.push(raw); return; }
    const todo = raw.match(/^\s*[-*] \[( |x|X)\]\s?(.*)$/);
    const item = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const head = raw.match(/^#{1,3}\s+(.*)$/);
    const quote = raw.match(/^>\s?(.*)$/);
    if (todo) {
      const on = todo[1] !== " ";
      const flip = () => onToggle?.(lines.map((l, j) => (j === n ? l.replace(/\[( |x|X)\]/, on ? "[ ]" : "[x]") : l)).join("\n"));
      list.push(
        <li key={n} className={`ntodo ${on ? "on" : ""}`}>
          <button type="button" role="checkbox" aria-checked={on} disabled={!onToggle} onClick={flip}><span className="rpbox">{on && <Check size={11} strokeWidth={3} />}</span></button>
          <span>{inline(todo[2])}</span>
        </li>,
      );
    } else if (item) list.push(<li key={n}>{inline(item[1])}</li>);
    else {
      flush();
      if (head) out.push(<h4 key={n}>{inline(head[1])}</h4>);
      else if (quote) out.push(<blockquote key={n} className="nquote">{inline(quote[1])}</blockquote>);
      else if (raw.trim()) out.push(<p key={n}>{inline(raw)}</p>);
      else if (out.length) out.push(<span key={n} className="nbr" />);
    }
  });
  flush();
  if (code) out.push(<pre key="code" className="ncode"><code>{(code as string[]).join("\n")}</code></pre>);
  return <div className="nbody">{out}</div>;
}
const inline = (t: string) => t.split(/(\*\*[^*]+\*\*)/).map((x, k) => (x.startsWith("**") && x.endsWith("**") && x.length > 4 ? <b key={k}>{x.slice(2, -2)}</b> : x));
