export function extractVersionNotes(changelog, version) {
  // 版本标题必须包含发布日期，发布页只截取对应版本，不混入其他版本内容。
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const heading = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "mu");
  const match = heading.exec(changelog);

  if (!match) {
    throw new Error(`CHANGELOG.md is missing a dated ${version} section`);
  }

  const remaining = changelog.slice(match.index);
  const nextHeadingOffset = remaining.slice(match[0].length).search(/^## \[/mu);
  const end = nextHeadingOffset < 0 ? remaining.length : match[0].length + nextHeadingOffset;
  return remaining.slice(0, end).trim();
}
