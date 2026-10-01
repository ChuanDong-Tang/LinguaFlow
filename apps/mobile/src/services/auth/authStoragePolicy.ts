export function shouldUseIosSimulatorAuthStorage(platform: string, isSimulator: boolean): boolean {
  return platform === "ios" && isSimulator;
}
