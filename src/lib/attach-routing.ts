/**
 * Which ending a handed-over file gets: a geometry version, or an attachment.
 *
 * Its own module because two components and a hook ask the question, and a copy
 * in each is how one of them ends up sending a spreadsheet to the geometry
 * path — which is the bug this vocabulary replaced.
 *
 * Routing on the extension rather than on content is deliberate at this layer:
 * the backend sniffs the bytes and records what it actually found, so the only
 * decision here is which *destination* the upload has. Those are different
 * endings, not different readings.
 */
const GEOMETRY_EXTENSIONS = [".step", ".stp", ".iges", ".igs", ".stl"] as const;

export function isGeometryFilename(filename: string): boolean {
  const lowered = filename.toLowerCase();
  return GEOMETRY_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}
