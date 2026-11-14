import { splitNumbers } from "./format";

/** Text with every digit run drawn in the number font (`.num`). */
export function NumText({ text }: { text: string }) {
  return (
    <>
      {splitNumbers(text).map((part, i) =>
        part.num ? (
          <span key={i} className="num">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
