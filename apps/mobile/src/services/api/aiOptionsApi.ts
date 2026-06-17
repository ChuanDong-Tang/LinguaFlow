import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type AiProviderOption = {
  id: string;
  label: string;
  defaultModel: string;
  models: string[];
};

export type AiOptions = {
  defaultProvider: string;
  providers: AiProviderOption[];
};

export async function getAiOptions(): Promise<AiOptions> {
  const res = await fetch(`${BASE_URL}/chat/ai-options`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<AiOptions>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}
