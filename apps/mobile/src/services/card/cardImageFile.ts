export type AsyncCopyableFile<TDestination> = {
  copy(destination: TDestination): Promise<void>;
};

export function requireCardImageFileSize(value: number | null | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    throw new Error("CARD_IMAGE_FILE_UNAVAILABLE");
  }
  return value as number;
}

export async function copyAndMeasureCardImage<TDestination>(
  source: AsyncCopyableFile<TDestination>,
  destination: TDestination,
  readPersistedSize: () => number | null | undefined,
): Promise<number> {
  await source.copy(destination);
  return requireCardImageFileSize(readPersistedSize());
}
