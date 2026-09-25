export function SearchHighlight({
  text,
  query,
  range,
}: Readonly<{
  text: string;
  query: string;
  range?: { start: number; end: number };
}>) {
  const start =
    range?.start ?? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const end = range?.end ?? start + query.length;
  if (!query || start < 0 || end <= start || end > text.length)
    return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="search-text-match">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}
