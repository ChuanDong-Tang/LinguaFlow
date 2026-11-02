/** Verify access without prompting, then reject an obsolete selection before any upload. */
export async function confirmAccessiblePhoto(
  verify: () => Promise<boolean>,
  isCurrent: () => boolean,
  confirm: () => Promise<void>,
): Promise<void> {
  if (!isCurrent() || !(await verify()) || !isCurrent()) {
    throw new Error("Photo selection is no longer accessible");
  }
  await confirm();
}
